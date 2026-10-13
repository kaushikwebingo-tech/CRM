import { api } from './client';

export interface NotificationItem {
  id: string;
  userId: string;
  eventType: string;
  title: string;
  body: string;
  channel: string;
  data: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

export async function fetchNotifications(unreadOnly = false): Promise<NotificationsResponse> {
  return api.get<NotificationsResponse>(`/notifications${unreadOnly ? '?unreadOnly=true' : ''}`);
}

export async function markNotificationRead(id: string): Promise<NotificationItem> {
  return api.patch<NotificationItem>(`/notifications/${id}/read`, {});
}

export async function markAllNotificationsRead(): Promise<{ count: number }> {
  return api.post<{ count: number }>('/notifications/read-all', {});
}

export async function registerDeviceToken(
  token: string,
  platform = 'web',
): Promise<{ success: boolean; token: string }> {
  return api.post('/notifications/device-token', { token, platform });
}
