export type RuleKind = 'assignment' | 'sla' | 'scoring' | 'duplicate' | 'validation';

export type AssignmentStrategy =
  | 'fixed'
  | 'round_robin'
  | 'load_balanced'
  | 'by_field_value'
  | 'keep_existing';

export interface EscalationAction {
  atPercent: number;
  notify?: string[];
  reassign?: string;
}

export interface SlaRuleConfig {
  startOn?: string;
  stopOn?: any;
  targetMinutes: number;
  businessHoursOnly?: boolean;
  escalations?: EscalationAction[];
}

export interface AssignmentRuleConfig {
  strategy: AssignmentStrategy;
  ownerId?: string;
  pool?: string[];
  respectWorkingHours?: boolean;
  fallbackOwnerId?: string;
  fieldKey?: string;
  mapping?: Record<string, string>;
  reassignAfterHoursNoAction?: number;
}

export interface ScoringRuleConfig {
  points: number;
  targetField?: string;
  description?: string;
}

export interface CreateRuleDto {
  moduleId: string;
  kind: RuleKind;
  name: string;
  conditions?: Record<string, unknown> | null;
  config: Record<string, unknown>;
  priority?: number;
  isActive?: boolean;
}

export interface UpdateRuleDto {
  name?: string;
  conditions?: Record<string, unknown> | null;
  config?: Record<string, unknown>;
  priority?: number;
  isActive?: boolean;
}

export interface OrgCalendarDto {
  name?: string;
  timezone?: string;
  workingDays?: number[];
  startTime?: string;
  endTime?: string;
  holidays?: string[];
  isDefault?: boolean;
}

export interface SlaInstanceItem {
  id: string;
  orgId: string;
  ruleId: string;
  recordId: string;
  status: 'active' | 'fulfilled' | 'breached' | 'cancelled';
  targetMinutes: number;
  businessHoursOnly: boolean;
  startedAt: string;
  targetAt: string;
  escalationsFired: EscalationAction[];
  fulfilledAt: string | null;
  breachedAt: string | null;
  createdAt: string;
}
