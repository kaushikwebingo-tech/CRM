import { api } from './client';

export type ActivityType = 'task' | 'call' | 'meeting' | 'note';

export interface Activity {
  id: string;
  activityType: ActivityType;
  title: string;
  relatedToModule: string | null;
  relatedToId: string | null;
  stageId: string | null;
  ownerId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateActivityInput {
  activityType: ActivityType;
  title: string;
  relatedToModule?: string;
  relatedToId?: string;
  dueDate?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assigneeId?: string;
  direction?: 'inbound' | 'outbound';
  outcome?: string;
  durationMinutes?: number;
  startAt?: string;
  endAt?: string;
  location?: string;
  attendees?: string[];
  body?: string;
  isPinned?: boolean;
  data?: Record<string, unknown>;
}

export async function fetchActivities(params?: {
  relatedToId?: string;
  activityType?: string;
  ownerId?: string;
  stageId?: string;
}): Promise<Activity[]> {
  const query = new URLSearchParams();
  if (params?.relatedToId) query.set('relatedToId', params.relatedToId);
  if (params?.activityType) query.set('activityType', params.activityType);
  if (params?.ownerId) query.set('ownerId', params.ownerId);
  if (params?.stageId) query.set('stageId', params.stageId);

  const qs = query.toString();
  return api.get<Activity[]>(`/activities${qs ? `?${qs}` : ''}`);
}

export async function createActivity(input: CreateActivityInput): Promise<Activity> {
  return api.post<Activity>('/activities', input);
}

export async function updateActivity(
  id: string,
  input: Partial<CreateActivityInput> & { stageId?: string },
): Promise<Activity> {
  return api.patch<Activity>(`/activities/${id}`, input);
}

export async function deleteActivity(id: string): Promise<void> {
  return api.del<void>(`/activities/${id}`);
}
