import { api, newIdempotencyKey } from '@/api/client';

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
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
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
  schemaVersion: number | string;
}

export interface RecordCountResponse {
  count: number;
  /** True when the number is the planner's estimate (Plan Section 14). */
  approximate?: boolean;
}

export interface RecordListParams {
  cursor?: string;
  sort?: string;
  filter?: string;
  q?: string;
  limit?: number;
  /**
   * The field keys the view actually displays.
   *
   * Plan Section 14, "Select what is needed": a list view asks for six columns
   * instead of a forty-key data blob, and "the table view sends this
   * automatically from the view's column config".
   */
  fields?: string[];
}

export function fetchRecords(
  moduleKey: string,
  params?: RecordListParams
): Promise<RecordListResponse> {
  return api.get<RecordListResponse>(`/api/modules/${moduleKey}/records`, {
    cursor: params?.cursor,
    sort: params?.sort,
    filter: params?.filter,
    q: params?.q,
    limit: params?.limit,
    fields: params?.fields && params.fields.length > 0 ? params.fields.join(',') : undefined,
  });
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
  },
  idempotencyKey?: string
): Promise<RecordItem> {
  // A double-clicked Save or a retried request replays the same key, and the
  // API returns the original response instead of creating a second record
  // (Guardrail 12).
  return api.post<RecordItem>(`/api/modules/${moduleKey}/records`, body, {
    'Idempotency-Key': idempotencyKey ?? newIdempotencyKey(),
  });
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
  filter?: string,
  q?: string,
): Promise<RecordCountResponse> {
  // `q` is passed so the header count matches the list the user is looking at;
  // the endpoint previously ignored it and the two disagreed.
  return api.get<RecordCountResponse>(`/api/modules/${moduleKey}/records/count`, { filter, q });
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

export function addNote(
  moduleKey: string,
  recordId: string,
  data: { content: string; attachments?: any[] }
): Promise<TimelineEvent> {
  return api.post<TimelineEvent>(`/api/modules/${moduleKey}/records/${recordId}/notes`, data);
}

export function addAttachment(
  moduleKey: string,
  recordId: string,
  fileData: { key: string; name: string; size: number; mime: string; url: string }
): Promise<TimelineEvent> {
  return api.post<TimelineEvent>(`/api/modules/${moduleKey}/records/${recordId}/attachments`, fileData);
}

export async function uploadFile(
  file: File
): Promise<{ key: string; name: string; size: number; mime: string; url: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/files/upload', {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'File upload failed' }));
    throw new Error(err.message || 'File upload failed');
  }
  return res.json();
}

export interface SearchResultItem {
  id: string;
  display_name: string;
  module_id: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  module_key: string;
  module_label: string;
  module_icon: string | null;
  module_color: string | null;
  owner_name: string | null;
}

export function searchGlobal(q: string): Promise<SearchResultItem[]> {
  return api.get<SearchResultItem[]>('/api/search', { q });
}


