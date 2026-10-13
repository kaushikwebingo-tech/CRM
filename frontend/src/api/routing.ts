import { api } from './client';

export type RuleKind = 'assignment' | 'sla' | 'scoring' | 'duplicate' | 'validation';

export interface Rule {
  id: string;
  orgId: string;
  moduleId: string;
  kind: RuleKind;
  name: string;
  conditions: Record<string, unknown>;
  config: Record<string, unknown>;
  priority: number;
  isActive: boolean;
  createdAt: string;
}

export interface OrgCalendar {
  id: string;
  orgId: string;
  name: string;
  timezone: string;
  workingDays: number[];
  startTime: string;
  endTime: string;
  holidays: string[];
  isDefault: boolean;
}

export interface SlaInstance {
  id: string;
  ruleId: string;
  recordId: string;
  status: 'active' | 'fulfilled' | 'breached' | 'cancelled';
  targetMinutes: number;
  businessHoursOnly: boolean;
  startedAt: string;
  targetAt: string;
  escalationsFired: Array<{ atPercent: number; notify?: string[]; reassign?: string }>;
  fulfilledAt: string | null;
  breachedAt: string | null;
  createdAt: string;
}

export async function fetchRules(params?: { moduleId?: string; kind?: RuleKind }): Promise<Rule[]> {
  const query = new URLSearchParams();
  if (params?.moduleId) query.set('moduleId', params.moduleId);
  if (params?.kind) query.set('kind', params.kind);
  const qs = query.toString();
  return api.get<Rule[]>(`/routing/rules${qs ? `?${qs}` : ''}`);
}

export async function createRule(data: Partial<Rule>): Promise<Rule> {
  return api.post<Rule>('/routing/rules', data);
}

export async function updateRule(id: string, data: Partial<Rule>): Promise<Rule> {
  return api.patch<Rule>(`/routing/rules/${id}`, data);
}

export async function deleteRule(id: string): Promise<void> {
  return api.del<void>(`/routing/rules/${id}`);
}

export async function fetchCalendar(): Promise<OrgCalendar> {
  return api.get<OrgCalendar>('/routing/calendar');
}

export async function updateCalendar(data: Partial<OrgCalendar>): Promise<OrgCalendar> {
  return api.patch<OrgCalendar>('/routing/calendar', data);
}

export async function evaluateSlas(simulatedDate?: string): Promise<{ evaluated: number; escalated: number; breached: number }> {
  return api.post('/routing/slas/evaluate', { simulatedDate });
}

export async function fetchRecordSlas(recordId: string): Promise<SlaInstance[]> {
  return api.get<SlaInstance[]>(`/routing/slas/record/${recordId}`);
}
