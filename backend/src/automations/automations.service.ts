import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import { NotFoundError, ValidationError } from '../common/errors';
import {
  Automation,
  AutomationRun,
  AutomationNode,
  AutomationSettings,
  DomainEvent,
  ActionContext,
  DryRunResult,
} from './automations.types';
import { GraphRunnerService, normalizeNodes } from './graph-runner.service';
import { matchesConditions } from './conditions';

export interface CreateAutomationDto {
  name: string;
  moduleId?: string | null;
  isActive?: boolean;
  trigger: {
    eventType: string;
    moduleKey?: string;
    [key: string]: unknown;
  };
  conditions?: Record<string, unknown> | null;
  actions: unknown;
  settings?: AutomationSettings;
}

export interface UpdateAutomationDto {
  name?: string;
  moduleId?: string | null;
  isActive?: boolean;
  trigger?: {
    eventType: string;
    moduleKey?: string;
    [key: string]: unknown;
  };
  conditions?: Record<string, unknown> | null;
  actions?: unknown;
  settings?: AutomationSettings;
}

export interface DryRunDto {
  recordId: string;
  rule?: CreateAutomationDto;
}

@Injectable()
export class AutomationsService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    private readonly graphRunner: GraphRunnerService,
  ) {}

  async list(orgId: string, moduleId?: string): Promise<Automation[]> {
    const rows = moduleId
      ? await this.sql<Automation[]>`
          SELECT *
          FROM automations
          WHERE org_id = ${orgId}
            AND module_id = ${moduleId}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
        `
      : await this.sql<Automation[]>`
          SELECT *
          FROM automations
          WHERE org_id = ${orgId}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
        `;
    return rows;
  }

  async getById(orgId: string, id: string): Promise<Automation> {
    const [row] = await this.sql<Automation[]>`
      SELECT *
      FROM automations
      WHERE id = ${id}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
    `;
    if (!row) {
      throw new NotFoundError(`Automation ${id} not found`);
    }
    return row;
  }

  async create(orgId: string, dto: CreateAutomationDto): Promise<Automation> {
    if (!dto.name || !dto.name.trim()) {
      throw new ValidationError('Name is required', [{ field: 'name', message: 'Name is required' }]);
    }
    if (!dto.trigger || !dto.trigger.eventType) {
      throw new ValidationError('Trigger eventType is required', [
        { field: 'trigger.eventType', message: 'Trigger eventType is required' },
      ]);
    }
    const nodes = normalizeNodes(dto.actions);
    if (nodes.length === 0) {
      throw new ValidationError('At least one action is required', [
        { field: 'actions', message: 'At least one action is required' },
      ]);
    }

    const [created] = await this.sql<Automation[]>`
      INSERT INTO automations (
        org_id,
        module_id,
        name,
        is_active,
        trigger,
        conditions,
        actions
      ) VALUES (
        ${orgId},
        ${dto.moduleId || null},
        ${dto.name.trim()},
        ${dto.isActive ?? true},
        ${JSON.stringify(dto.trigger ?? null)}::text::jsonb,
        ${dto.conditions ? JSON.stringify(dto.conditions) : null}::text::jsonb,
        ${JSON.stringify(dto.actions ?? [])}::text::jsonb
      )
      RETURNING *
    `;

    return created;
  }

  async update(orgId: string, id: string, dto: UpdateAutomationDto): Promise<Automation> {
    const current = await this.getById(orgId, id);

    const next = {
      name: dto.name !== undefined ? dto.name.trim() : (current as any).name,
      moduleId: dto.moduleId !== undefined ? dto.moduleId : (current as any).module_id,
      isActive: dto.isActive !== undefined ? dto.isActive : (current as any).is_active,
      trigger: dto.trigger !== undefined ? dto.trigger : (current as any).trigger,
      conditions: dto.conditions !== undefined ? dto.conditions : (current as any).conditions,
      actions: dto.actions !== undefined ? dto.actions : (current as any).actions,
    };

    if (!next.name) {
      throw new ValidationError('Name is required', [{ field: 'name', message: 'Name is required' }]);
    }
    const nodes = normalizeNodes(next.actions);
    if (nodes.length === 0) {
      throw new ValidationError('At least one action is required', [
        { field: 'actions', message: 'At least one action is required' },
      ]);
    }

    const [updated] = await this.sql<Automation[]>`
      UPDATE automations
      SET
        name = ${next.name},
        module_id = ${next.moduleId ?? null},
        is_active = ${next.isActive ?? false},
        trigger = ${JSON.stringify(next.trigger ?? null)}::text::jsonb,
        conditions = ${next.conditions ? JSON.stringify(next.conditions) : null}::text::jsonb,
        actions = ${JSON.stringify(next.actions ?? [])}::text::jsonb
      WHERE id = ${id}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
      RETURNING *
    `;

    if (!updated) {
      throw new NotFoundError(`Automation ${id} not found`);
    }
    return updated;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.getById(orgId, id);
    await this.sql`
      UPDATE automations
      SET deleted_at = now()
      WHERE id = ${id} AND org_id = ${orgId}
    `;
  }

  async listRuns(orgId: string, automationId: string, limit = 50): Promise<AutomationRun[]> {
    const rows = await this.sql<AutomationRun[]>`
      SELECT *
      FROM automation_runs
      WHERE automation_id = ${automationId}
        AND org_id = ${orgId}
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return rows;
  }

  async getRunById(orgId: string, runId: number): Promise<AutomationRun> {
    const [row] = await this.sql<AutomationRun[]>`
      SELECT *
      FROM automation_runs
      WHERE id = ${runId}
        AND org_id = ${orgId}
    `;
    if (!row) {
      throw new NotFoundError(`Automation run ${runId} not found`);
    }
    return row;
  }

  async dryRun(
    orgId: string,
    params: { automationId?: string; recordId: string; rule?: CreateAutomationDto },
  ): Promise<DryRunResult> {
    const [record] = await this.sql<any[]>`
      SELECT id, display_name, data, stage_id, pipeline_id, owner_id
      FROM records
      WHERE id = ${params.recordId}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
    `;
    if (!record) {
      throw new NotFoundError(`Record ${params.recordId} not found`);
    }

    let targetRule: any;
    if (params.automationId) {
      targetRule = await this.getById(orgId, params.automationId);
    } else if (params.rule) {
      targetRule = params.rule;
    } else {
      throw new ValidationError('Either automationId or rule draft is required', [
        { field: 'rule', message: 'Either automationId or rule draft is required' },
      ]);
    }

    const domainEvent: DomainEvent = {
      id: 'dry_run_event',
      orgId,
      type: targetRule.trigger?.eventType || 'record.updated',
      moduleKey: targetRule.trigger?.moduleKey,
      recordId: record.id,
      aggregateId: record.id,
      actor: { id: null, type: 'user' },
      occurredAt: new Date().toISOString(),
      snapshot: {
        display_name: record.display_name,
        data: record.data || {},
        stage_id: record.stage_id,
        pipeline_id: record.pipeline_id,
        owner_id: record.owner_id,
      },
    };

    const resolveTemplate = (tpl: string): string => {
      if (!tpl || typeof tpl !== 'string') return '';
      return tpl.replace(/\{\{([\w\.]+)\}\}/g, (_, key) => {
        if (key === 'id') return String(record.id);
        if (key === 'displayName' || key === 'display_name') return String(record.display_name || '');
        if (key.startsWith('data.')) {
          const subKey = key.slice(5);
          const val = record.data?.[subKey];
          return val != null ? String(val) : '';
        }
        if (record.data?.[key] != null) return String(record.data[key]);
        return '';
      });
    };

    const conditionsPassed = matchesConditions(
      targetRule.conditions,
      {
        data: record.data || {},
        stageId: record.stage_id,
        ownerId: record.owner_id,
      },
      domainEvent,
    );

    if (!conditionsPassed) {
      return {
        success: false,
        recordId: record.id,
        displayName: record.display_name,
        conditionsPassed: false,
        message: 'Conditions did not match for this record',
        steps: [
          {
            nodeId: 'conditions',
            type: 'branch',
            status: 'failed',
            outcome: false,
            output: 'Record does not satisfy initial automation conditions',
            timestamp: new Date().toISOString(),
          },
        ],
        finalState: record.data,
      };
    }

    const context: ActionContext = {
      orgId,
      event: domainEvent,
      record: {
        id: record.id,
        displayName: record.display_name,
        data: record.data || {},
        stageId: record.stage_id,
        pipelineId: record.pipeline_id,
        ownerId: record.owner_id,
      },
      resolve: resolveTemplate,
      sql: this.sql,
    };

    const execution = await this.graphRunner.executeGraph(targetRule.actions, context, {
      dryRun: true,
    });

    return {
      success: execution.status !== 'failed',
      recordId: record.id,
      displayName: record.display_name,
      conditionsPassed: true,
      steps: execution.steps,
      finalState: execution.finalState,
    };
  }

  async getMatchingAutomations(
    orgId: string,
    eventType: string,
    moduleKey?: string,
    changedKeys?: string[],
  ): Promise<Automation[]> {
    const rows = await this.sql<Automation[]>`
      SELECT *
      FROM automations
      WHERE org_id = ${orgId}
        AND is_active = true
        AND deleted_at IS NULL
    `;

    return rows.filter((auto) => {
      const trig = auto.trigger as any;
      if (!trig) return false;
      const trigEvent = trig.eventType || trig.event_type || trig.event;
      if (trigEvent !== '*' && trigEvent !== eventType) {
        return false;
      }
      const trigModule = trig.moduleKey || trig.module_key || trig.module;
      if (trigModule && moduleKey && trigModule !== moduleKey) {
        return false;
      }

      const watched = trig.fieldKeys || trig.field_keys;
      if (Array.isArray(watched) && watched.length > 0) {
        if (!changedKeys || changedKeys.length === 0) return false;
        if (!watched.some((k: string) => changedKeys.includes(k))) return false;
      }
      return true;
    });
  }
}
