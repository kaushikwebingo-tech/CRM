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
  actions: AutomationActionConfig[];
  createdAt: string;
  deletedAt: string | null;
}

export interface AutomationRun {
  id: number;
  orgId: string;
  automationId: string;
  recordId: string | null;
  status: 'running' | 'success' | 'failed' | 'skipped';
  log: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
}
