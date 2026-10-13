export type ActivityType = 'task' | 'call' | 'meeting' | 'note';

export interface CreateActivityDto {
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

export interface UpdateActivityDto {
  stageId?: string;
  title?: string;
  dueDate?: string;
  priority?: string;
  assigneeId?: string;
  outcome?: string;
  body?: string;
  isPinned?: boolean;
  data?: Record<string, unknown>;
}

export interface ActivityItem {
  id: string;
  orgId: string;
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
