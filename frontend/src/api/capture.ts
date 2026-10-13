import { api } from './client';

export interface LeadSource {
  id: string;
  name: string;
  type: string;
  targetModuleKey: string;
  fieldMapping: Record<string, string>;
  defaults: Record<string, unknown>;
  dedupeOn: string[];
  onDuplicate: string;
  assignTo: Record<string, unknown>;
  config: Record<string, unknown>;
  isActive: boolean;
  secret: string;
  createdAt: string;
}

export interface QuarantineRecord {
  id: string;
  sourceId: string | null;
  sourceType: string;
  rawPayload: Record<string, unknown>;
  errorReason: string;
  errorDetails: Record<string, unknown>;
  status: 'quarantined' | 'replayed' | 'discarded';
  replayedRecordId: string | null;
  createdAt: string;
  replayedAt: string | null;
}

export interface PublicFormSpec {
  sourceId: string;
  name: string;
  title: string;
  description: string;
  submitButtonText: string;
  successMessage: string;
  redirectUrl?: string;
  theme?: {
    primaryColor?: string;
    backgroundColor?: string;
  };
  fields: Array<{
    key: string;
    label: string;
    type: string;
    isRequired: boolean;
    helpText?: string | null;
    config?: Record<string, unknown>;
  }>;
}

export async function fetchLeadSources(): Promise<LeadSource[]> {
  return api.get<LeadSource[]>('/capture/sources');
}

export async function fetchLeadSource(id: string): Promise<LeadSource> {
  return api.get<LeadSource>(`/capture/sources/${id}`);
}

export async function createLeadSource(payload: Partial<LeadSource>): Promise<LeadSource> {
  return api.post<LeadSource>('/capture/sources', payload);
}

export async function updateLeadSource(id: string, payload: Partial<LeadSource>): Promise<LeadSource> {
  return api.patch<LeadSource>(`/capture/sources/${id}`, payload);
}

export async function deleteLeadSource(id: string): Promise<void> {
  return api.del<void>(`/capture/sources/${id}`);
}

export async function fetchQuarantine(status?: string): Promise<QuarantineRecord[]> {
  const query = status ? `?status=${status}` : '';
  return api.get<QuarantineRecord[]>(`/capture/quarantine${query}`);
}

export async function replayQuarantine(
  id: string,
  overrides?: Record<string, unknown>,
): Promise<{ success: boolean; recordId?: string; message?: string }> {
  return api.post(`/capture/quarantine/${id}/replay`, { overrides });
}

export async function discardQuarantine(id: string): Promise<void> {
  return api.del<void>(`/capture/quarantine/${id}`);
}

export async function fetchPublicForm(sourceId: string): Promise<PublicFormSpec> {
  return api.get<PublicFormSpec>(`/public/forms/${sourceId}`);
}

export async function submitPublicForm(
  sourceId: string,
  data: Record<string, unknown>,
): Promise<{ success: boolean; recordId?: string; message?: string; errors?: any[] }> {
  return api.post(`/public/forms/${sourceId}/submit`, data);
}
