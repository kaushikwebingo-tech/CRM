import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import Redis from 'ioredis';
import { PG_CLIENT } from '../db/connection';
import { REDIS } from '../auth/session.service';
import { getActionHandler } from './actions/action-registry';
import {
  ActionContext,
  AutomationNode,
  NodeStepLog,
  ActionNode,
  BranchNode,
  WaitNode,
  StopNode,
} from './automations.types';
import { matchesConditions } from './conditions';

export interface GraphExecutionOptions {
  dryRun?: boolean;
  startNodeId?: string | null;
  existingSteps?: NodeStepLog[];
  completedNodeIds?: string[];
  runId?: number;
}

export interface GraphExecutionResult {
  status: 'success' | 'failed' | 'waiting' | 'cancelled';
  steps: NodeStepLog[];
  completedNodeIds: string[];
  currentNodeId?: string | null;
  resumeAt?: string | null;
  error?: string;
  finalState?: Record<string, unknown>;
}

export function normalizeNodes(actions: unknown): AutomationNode[] {
  if (!actions) return [];
  if (typeof actions === 'object' && !Array.isArray(actions) && Array.isArray((actions as any).nodes)) {
    return (actions as any).nodes;
  }
  if (Array.isArray(actions)) {
    if (actions.length === 0) return [];
    const first = actions[0];
    if (first && (first.type === 'action' || first.type === 'branch' || first.type === 'wait' || first.type === 'stop')) {
      return actions.map((item: any) => {
        if (item.type === 'action' && !item.handler && item.action) {
          return { ...item, handler: item.action };
        }
        return item;
      }) as AutomationNode[];
    }
    return actions.map((item: any, idx: number) => ({
      id: item.id || `node_${idx + 1}`,
      type: 'action',
      handler: item.handler || item.action || item.type,
      config: item.config || {},
      next: idx < actions.length - 1 ? (actions[idx + 1].id || `node_${idx + 2}`) : null,
    }));
  }
  return [];
}

@Injectable()
export class GraphRunnerService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async executeGraph(
    rawNodes: unknown,
    ctx: ActionContext,
    options: GraphExecutionOptions = {},
  ): Promise<GraphExecutionResult> {
    const nodes = normalizeNodes(rawNodes);
    if (nodes.length === 0) {
      return {
        status: 'success',
        steps: [],
        completedNodeIds: [],
        finalState: ctx.record?.data || {},
      };
    }

    const nodeMap = new Map<string, AutomationNode>(nodes.map((n) => [n.id, n]));
    let currentId: string | null = options.startNodeId || nodes[0].id;
    const steps: NodeStepLog[] = options.existingSteps ? [...options.existingSteps] : [];
    const completedNodeIds = new Set<string>(options.completedNodeIds || []);

    const workingRecord = ctx.record
      ? {
          ...ctx.record,
          data: { ...(ctx.record.data || {}) },
        }
      : {
          id: ctx.event.recordId || '',
          displayName: ctx.event.snapshot?.display_name || '',
          data: { ...(ctx.event.snapshot?.data || {}) },
          stageId: ctx.event.snapshot?.stage_id,
          pipelineId: ctx.event.snapshot?.pipeline_id,
          ownerId: ctx.event.snapshot?.owner_id,
        };

    const actionContext: ActionContext = {
      ...ctx,
      record: workingRecord,
      sql: this.sql,
      redis: this.redis,
    };

    let stepCount = 0;
    const MAX_STEPS = 100;

    while (currentId && stepCount < MAX_STEPS) {
      stepCount++;
      const node = nodeMap.get(currentId);

      if (!node) {
        steps.push({
          nodeId: currentId,
          type: 'action',
          status: 'failed',
          error: `Node "${currentId}" was not found in automation graph`,
          timestamp: new Date().toISOString(),
        });
        return {
          status: 'failed',
          steps,
          completedNodeIds: Array.from(completedNodeIds),
          error: `Node "${currentId}" not found`,
        };
      }

      if (node.type === 'action') {
        const actionNode = node as ActionNode;
        if (completedNodeIds.has(actionNode.id)) {
          steps.push({
            nodeId: actionNode.id,
            type: 'action',
            handler: actionNode.handler,
            status: 'skipped',
            output: 'Already executed',
            nextNodeId: actionNode.next,
            timestamp: new Date().toISOString(),
          });
          currentId = actionNode.next;
          continue;
        }

        if (options.dryRun) {
          const simulatedOutput = this.simulateAction(actionNode, actionContext, workingRecord);
          steps.push({
            nodeId: actionNode.id,
            type: 'action',
            handler: actionNode.handler,
            status: 'simulated',
            output: simulatedOutput,
            nextNodeId: actionNode.next,
            durationMs: 1,
            timestamp: new Date().toISOString(),
          });
          completedNodeIds.add(actionNode.id);
          currentId = actionNode.next;
          continue;
        }

        const handlerKey = actionNode.handler || (actionNode as any).action;
        const handler = getActionHandler(handlerKey);
        if (!handler) {
          const err = `Action handler "${handlerKey || actionNode.handler}" is not registered`;
          steps.push({
            nodeId: actionNode.id,
            type: 'action',
            handler: actionNode.handler,
            status: 'failed',
            error: err,
            timestamp: new Date().toISOString(),
          });
          return {
            status: 'failed',
            steps,
            completedNodeIds: Array.from(completedNodeIds),
            error: err,
          };
        }

        const execResult = await handler.execute(actionContext, actionNode.config);
        if (!execResult.success) {
          steps.push({
            nodeId: actionNode.id,
            type: 'action',
            handler: actionNode.handler,
            status: 'failed',
            error: execResult.error,
            output: execResult.responseBody,
            durationMs: execResult.durationMs,
            timestamp: new Date().toISOString(),
          });
          return {
            status: 'failed',
            steps,
            completedNodeIds: Array.from(completedNodeIds),
            error: execResult.error,
          };
        }

        steps.push({
          nodeId: actionNode.id,
          type: 'action',
          handler: actionNode.handler,
          status: 'success',
          output: execResult.responseBody,
          nextNodeId: actionNode.next,
          durationMs: execResult.durationMs,
          timestamp: new Date().toISOString(),
        });
        completedNodeIds.add(actionNode.id);
        currentId = actionNode.next;
        continue;
      }

      if (node.type === 'branch') {
        const branchNode = node as BranchNode;
        const matches = matchesConditions(
          branchNode.conditions,
          workingRecord,
          actionContext.event,
        );

        const nextTarget = matches ? branchNode.onTrue : branchNode.onFalse;
        steps.push({
          nodeId: branchNode.id,
          type: 'branch',
          status: 'matched',
          outcome: matches,
          nextNodeId: nextTarget,
          timestamp: new Date().toISOString(),
        });
        completedNodeIds.add(branchNode.id);
        currentId = nextTarget;
        continue;
      }

      if (node.type === 'wait') {
        const waitNode = node as WaitNode;
        const resumeAt = this.calculateResumeAt(waitNode, workingRecord);

        if (options.dryRun) {
          steps.push({
            nodeId: waitNode.id,
            type: 'wait',
            status: 'simulated',
            output: {
              mode: waitNode.mode,
              resumeAt,
              message: `Simulated wait until ${resumeAt}`,
            },
            nextNodeId: waitNode.next,
            timestamp: new Date().toISOString(),
          });
          completedNodeIds.add(waitNode.id);
          currentId = waitNode.next;
          continue;
        }

        steps.push({
          nodeId: waitNode.id,
          type: 'wait',
          status: 'waiting',
          output: {
            resumeAt,
          },
          nextNodeId: waitNode.next,
          timestamp: new Date().toISOString(),
        });
        completedNodeIds.add(waitNode.id);

        return {
          status: 'waiting',
          steps,
          completedNodeIds: Array.from(completedNodeIds),
          currentNodeId: waitNode.next,
          resumeAt,
        };
      }

      if (node.type === 'stop') {
        const stopNode = node as StopNode;
        steps.push({
          nodeId: stopNode.id,
          type: 'stop',
          status: 'stopped',
          output: {
            reason: stopNode.reason || 'Workflow stopped',
          },
          timestamp: new Date().toISOString(),
        });
        completedNodeIds.add(stopNode.id);
        currentId = null;
        break;
      }
    }

    if (stepCount >= MAX_STEPS) {
      const err = 'Automation exceeded maximum step limit (cycle detected)';
      return {
        status: 'failed',
        steps,
        completedNodeIds: Array.from(completedNodeIds),
        error: err,
      };
    }

    return {
      status: 'success',
      steps,
      completedNodeIds: Array.from(completedNodeIds),
      finalState: workingRecord.data,
    };
  }

  private simulateAction(
    node: ActionNode,
    ctx: ActionContext,
    record: { id: string; displayName: string; data: Record<string, unknown>; stageId?: string; ownerId?: string },
  ): Record<string, unknown> {
    switch (node.handler) {
      case 'update_field': {
        const fieldKey = String(node.config.fieldKey || '');
        const val = typeof node.config.value === 'string' ? ctx.resolve(node.config.value) : node.config.value;
        const prev = record.data[fieldKey];
        record.data[fieldKey] = val;
        return {
          fieldKey,
          previousValue: prev,
          newValue: val,
        };
      }
      case 'assign_owner': {
        const prev = record.ownerId;
        const nextOwner = (node.config.ownerId as string) || (Array.isArray(node.config.pool) && node.config.pool[0]) || 'round_robin_user';
        record.ownerId = nextOwner;
        return {
          strategy: node.config.strategy || 'fixed',
          previousOwnerId: prev,
          newOwnerId: nextOwner,
        };
      }
      case 'change_stage': {
        const prev = record.stageId;
        const nextStage = String(node.config.stageId || '');
        record.stageId = nextStage;
        return {
          previousStageId: prev,
          newStageId: nextStage,
        };
      }
      case 'create_record': {
        return {
          targetModuleKey: node.config.targetModuleKey,
          displayName: node.config.displayNameTemplate ? ctx.resolve(String(node.config.displayNameTemplate)) : 'Created record',
          fieldMapping: node.config.fieldMapping,
        };
      }
      case 'webhook': {
        return {
          url: ctx.resolve(String(node.config.url || '')),
          method: node.config.method || 'POST',
        };
      }
      default:
        return {
          simulatedHandler: node.handler,
          config: node.config,
        };
    }
  }

  private calculateResumeAt(
    node: WaitNode,
    record: { data: Record<string, unknown> },
  ): string {
    const config = node.config || {};
    if (node.mode === 'until_field' && config.fieldKey) {
      const rawDate = record.data[config.fieldKey];
      if (rawDate) {
        const target = new Date(String(rawDate));
        if (!isNaN(target.getTime())) {
          if (config.offsetDays) {
            target.setDate(target.getDate() + Number(config.offsetDays));
          }
          return target.toISOString();
        }
      }
    }

    const durationMinutes =
      (Number(config.durationMinutes) || 0) +
      (Number(config.durationHours) || 0) * 60 +
      (Number(config.durationDays) || 0) * 1440;

    const ms = Math.max(durationMinutes * 60 * 1000, 1000);
    return new Date(Date.now() + ms).toISOString();
  }
}
