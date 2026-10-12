import { z } from 'zod';

export interface DomainEvent {
  id: string | number;
  orgId: string;
  type: string;
  moduleKey?: string;
  recordId?: string;
  aggregateId: string;
  actor?: { id: string | null; type: 'user' | 'system' | 'automation' };
  occurredAt: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  snapshot?: {
    display_name?: string;
    data?: Record<string, unknown>;
    stage_id?: string;
    pipeline_id?: string;
    owner_id?: string;
  };
  causationChain?: string[];
  payload?: Record<string, unknown>;
}

export interface ActionContext {
  orgId: string;
  event: DomainEvent;
  record?: {
    id: string;
    displayName: string;
    data: Record<string, unknown>;
    stageId?: string;
    pipelineId?: string;
    ownerId?: string;
  };
  resolve(template: string): string;
  sql?: any;
  redis?: any;
}

export interface ActionResult {
  success: boolean;
  statusCode?: number;
  responseBody?: unknown;
  error?: string;
  durationMs: number;
}

export interface ActionHandler<TConfig = any> {
  key: string;
  label: string;
  configSchema: z.ZodSchema<any>;
  requiresConnector?: string;
  execute(ctx: ActionContext, config: TConfig): Promise<ActionResult>;
}

export interface AutomationTrigger {
  eventType: string;
  moduleKey?: string;
  fieldKey?: string;
  toValue?: unknown;
  fromStageIds?: string[];
  toStageIds?: string[];
  fieldKeys?: string[];
  offsetDays?: number;
  timeOfDay?: string;
  cron?: string;
  channel?: string;
  sourceId?: string;
  [key: string]: unknown;
}

export type AutomationNodeType = 'action' | 'branch' | 'wait' | 'stop';

export interface ActionNode {
  id: string;
  type: 'action';
  handler: string;
  config: Record<string, unknown>;
  next: string | null;
}

export interface BranchNode {
  id: string;
  type: 'branch';
  conditions: Record<string, unknown>;
  onTrue: string;
  onFalse: string | null;
}

export interface WaitConfig {
  durationMinutes?: number;
  durationHours?: number;
  durationDays?: number;
  fieldKey?: string;
  offsetDays?: number;
}

export interface WaitNode {
  id: string;
  type: 'wait';
  mode: 'duration' | 'until_field';
  config: WaitConfig;
  next: string | null;
}

export interface StopNode {
  id: string;
  type: 'stop';
  reason?: string;
}

export type AutomationNode = ActionNode | BranchNode | WaitNode | StopNode;

export interface AutomationSettings {
  runOnce?: boolean;
  reentrant?: boolean;
  maxRunsPerRecordPerDay?: number;
}

export interface AutomationActionConfig {
  type: string;
  config: Record<string, unknown>;
}

export interface Automation {
  id: string;
  orgId: string;
  moduleId: string | null;
  name: string;
  isActive: boolean;
  trigger: AutomationTrigger;
  conditions: Record<string, unknown> | null;
  actions: AutomationActionConfig[] | AutomationNode[] | { nodes: AutomationNode[]; settings?: AutomationSettings };
  nodes?: AutomationNode[];
  settings?: AutomationSettings;
  createdAt: string;
  deletedAt: string | null;
}

export interface NodeStepLog {
  nodeId: string;
  type: AutomationNodeType | 'trigger';
  handler?: string;
  status: 'success' | 'failed' | 'simulated' | 'waiting' | 'stopped' | 'skipped' | 'matched';
  outcome?: boolean;
  nextNodeId?: string | null;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  timestamp?: string;
}

export interface AutomationRun {
  id: number;
  orgId: string;
  automationId: string;
  recordId: string | null;
  status: 'running' | 'waiting' | 'success' | 'failed' | 'skipped' | 'cancelled';
  log: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DryRunResult {
  success: boolean;
  recordId: string;
  displayName: string;
  conditionsPassed: boolean;
  message?: string;
  steps: NodeStepLog[];
  finalState?: Record<string, unknown>;
}
