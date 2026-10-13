export type NotificationChannel = 'in_app' | 'push' | 'sms' | 'email';

export interface CreateNotificationDto {
  userId: string;
  eventType: string;
  title: string;
  body: string;
  channel?: NotificationChannel;
  data?: Record<string, unknown>;
}

export interface RegisterDeviceTokenDto {
  token: string;
  platform?: 'web' | 'android' | 'ios';
}

export interface NotificationItem {
  id: string;
  orgId: string;
  userId: string;
  eventType: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  data: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}
