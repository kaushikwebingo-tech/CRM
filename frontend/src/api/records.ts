import { api } from '@/api/client';

export interface RecordItem {
  id: string;
  orgId: string;
  moduleId: string;
  display_name: string;
  owner_id: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  stage_since: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  owner?: {
    id: string;
    fullName: string;
    email: string;
  };
  _expanded?: Record<string, { id: string; displayName: string }>;
}

export interface RecordListResponse {
  records: RecordItem[];
  nextCursor: string | null;
  hasMore: boolean;
  schemaVersion: number;
}

export interface RecordListParams {
  cursor?: string;
  sort?: string;
  filter?: string;
  q?: string;
  limit?: number;
}

export function fetchRecords(
  moduleKey: string,
  params?: RecordListParams
): Promise<RecordListResponse> {
  const queryParams: Record<string, string> = {};
  if (params?.cursor) queryParams.cursor = params.cursor;
  if (params?.sort) queryParams.sort = params.sort;
  if (params?.filter) queryParams.filter = params.filter;
  if (params?.q) queryParams.q = params.q;
  if (params?.limit) queryParams.limit = String(params.limit);

  return api.get<RecordListResponse>(`/api/modules/${moduleKey}/records`, queryParams);
}

export function fetchRecord(moduleKey: string, id: string): Promise<RecordItem> {
  return api.get<RecordItem>(`/api/modules/${moduleKey}/records/${id}`);
}

export function createRecord(
  moduleKey: string,
  body: {
    display_name: string;
    owner_id?: string;
    stage_id?: string;
    pipeline_id?: string;
    data?: Record<string, unknown>;
  }
): Promise<RecordItem> {
  return api.post<RecordItem>(`/api/modules/${moduleKey}/records`, body);
}

export function updateRecord(
  moduleKey: string,
  id: string,
  body: {
    display_name?: string;
    owner_id?: string;
    stage_id?: string;
    pipeline_id?: string;
    data?: Record<string, unknown>;
  }
): Promise<RecordItem> {
  return api.patch<RecordItem>(`/api/modules/${moduleKey}/records/${id}`, body);
}

export function deleteRecord(moduleKey: string, id: string): Promise<{ success: boolean }> {
  return api.del<{ success: boolean }>(`/api/modules/${moduleKey}/records/${id}`);
}

export function changeStage(
  moduleKey: string,
  id: string,
  stageId: string
): Promise<RecordItem> {
  return api.patch<RecordItem>(`/api/modules/${moduleKey}/records/${id}/stage`, { stage_id: stageId });
}

export function fetchRecordCount(
  moduleKey: string,
  filter?: string
): Promise<{ count: number }> {
  const params = filter ? { filter } : undefined;
  return api.get<{ count: number }>(`/api/modules/${moduleKey}/records/count`, params);
}

export interface TimelineEvent {
  id: number;
  record_id: string;
  module_id: string;
  type: string;
  actor_id: string | null;
  actor_type: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
  actor_avatar: string | null;
}

export function fetchTimeline(moduleKey: string, recordId: string): Promise<TimelineEvent[]> {
  return api.get<TimelineEvent[]>(`/api/modules/${moduleKey}/records/${recordId}/timeline`);
}

export interface BulkActionPayload {
  action: 'assign' | 'update' | 'delete';
  record_ids: string[];
  data?: Record<string, unknown>;
}

export function bulkAction(
  moduleKey: string,
  payload: BulkActionPayload
): Promise<{ success: boolean; count: number }> {
  return api.post<{ success: boolean; count: number }>(`/api/modules/${moduleKey}/records/bulk`, payload);
}

export function exportCsv(moduleKey: string, params?: RecordListParams): Promise<string> {
  const queryParams: Record<string, string> = {};
  if (params?.filter) queryParams.filter = params.filter;
  if (params?.sort) queryParams.sort = params.sort;
  if (params?.q) queryParams.q = params.q;
  return api.get<string>(`/api/modules/${moduleKey}/export`, queryParams);
}

export interface ImportResult {
  totalRows: number;
  importedCount: number;
  failedCount: number;
  errors: Array<{ row: number; error: string }>;
}

export function importCsv(
  moduleKey: string,
  csvText: string,
  mappings?: Record<string, string>
): Promise<ImportResult> {
  return api.post<ImportResult>(`/api/modules/${moduleKey}/import`, {
    csv: csvText,
    mappings,
  });
}

export interface SavedView {
  id: string;
  moduleId: string;
  name: string;
  type: 'table' | 'kanban';
  config: {
    filter?: Record<string, unknown>;
    sort?: string;
    columns?: string[];
  };
  ownerId?: string | null;
  isDefault?: boolean;
  position?: number;
}

export function fetchViews(moduleKey: string): Promise<SavedView[]> {
  return api.get<SavedView[]>(`/api/modules/${moduleKey}/views`);
}

export function createView(
  moduleKey: string,
  data: {
    name: string;
    type?: string;
    config?: Record<string, unknown>;
    isDefault?: boolean;
  }
): Promise<SavedView> {
  return api.post<SavedView>(`/api/modules/${moduleKey}/views`, data);
}

export function updateView(
  moduleKey: string,
  id: string,
  data: Partial<SavedView>
): Promise<SavedView> {
  return api.patch<SavedView>(`/api/modules/${moduleKey}/views/${id}`, data);
}

export function deleteView(moduleKey: string, id: string): Promise<{ success: boolean }> {
  return api.del<{ success: boolean }>(`/api/modules/${moduleKey}/views/${id}`);
}

export interface OrgUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  isActive: boolean;
}

export function fetchOrgUsers(): Promise<OrgUser[]> {
  return api.get<OrgUser[]>('/api/auth/users');
}

