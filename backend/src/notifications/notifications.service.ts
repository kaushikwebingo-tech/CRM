import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import Redis from 'ioredis';
import { PG_CLIENT } from '../db/connection';
import { REDIS } from '../auth/session.service';
import {
  NotificationChannel,
  CreateNotificationDto,
  RegisterDeviceTokenDto,
  NotificationItem,
} from './notifications.types';
import { NotFoundError } from '../common/errors';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  async send(orgId: string, dto: CreateNotificationDto): Promise<NotificationItem> {
    const channel: NotificationChannel = dto.channel || 'in_app';

    const [row] = await this.sql<any[]>`
      INSERT INTO notifications (
        org_id,
        user_id,
        event_type,
        title,
        body,
        channel,
        data,
        is_read
      ) VALUES (
        ${orgId},
        ${dto.userId},
        ${dto.eventType},
        ${dto.title},
        ${dto.body},
        ${channel},
        ${this.jsonb(dto.data)}::text::jsonb,
        false
      )
      RETURNING *
    `;

    const item: NotificationItem = {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      eventType: row.event_type,
      title: row.title,
      body: row.body,
      channel: row.channel,
      data: row.data || {},
      isRead: row.is_read,
      readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
    };

    try {
      await this.redis.publish(
        `notifications:${dto.userId}`,
        JSON.stringify({ type: 'notification.created', payload: item }),
      );
      await this.redis.publish(
        `realtime:${orgId}:user:${dto.userId}`,
        JSON.stringify({ type: 'notification', data: item }),
      );
    } catch {}

    const tokens = await this.sql<any[]>`
      SELECT token, platform
      FROM device_tokens
      WHERE org_id = ${orgId}
        AND user_id = ${dto.userId}
    `;

    if (tokens.length > 0) {
      try {
        await this.redis.publish(
          'push:dispatch',
          JSON.stringify({
            userId: dto.userId,
            title: dto.title,
            body: dto.body,
            data: dto.data,
            tokens: tokens.map((t) => t.token),
          }),
        );
      } catch {}
    }

    return item;
  }

  async notifyOwner(
    orgId: string,
    userId: string,
    eventType: string,
    title: string,
    body: string,
    data: Record<string, unknown> = {},
  ): Promise<NotificationItem> {
    return this.send(orgId, {
      userId,
      eventType,
      title,
      body,
      channel: 'push',
      data,
    });
  }

  async listForUser(
    orgId: string,
    userId: string,
    unreadOnly = false,
    limit = 50,
  ): Promise<{ items: NotificationItem[]; unreadCount: number }> {
    const rows = unreadOnly
      ? await this.sql<any[]>`
          SELECT *
          FROM notifications
          WHERE org_id = ${orgId}
            AND user_id = ${userId}
            AND is_read = false
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      : await this.sql<any[]>`
          SELECT *
          FROM notifications
          WHERE org_id = ${orgId}
            AND user_id = ${userId}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;

    const [countRow] = await this.sql<any[]>`
      SELECT COUNT(*)::int AS unread
      FROM notifications
      WHERE org_id = ${orgId}
        AND user_id = ${userId}
        AND is_read = false
    `;

    const items: NotificationItem[] = rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      userId: r.user_id,
      eventType: r.event_type,
      title: r.title,
      body: r.body,
      channel: r.channel,
      data: r.data || {},
      isRead: r.is_read,
      readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    }));

    return {
      items,
      unreadCount: countRow?.unread || 0,
    };
  }

  async markAsRead(orgId: string, userId: string, id: string): Promise<NotificationItem> {
    const [row] = await this.sql<any[]>`
      UPDATE notifications
      SET is_read = true, read_at = now()
      WHERE id = ${id}
        AND org_id = ${orgId}
        AND user_id = ${userId}
      RETURNING *
    `;

    if (!row) {
      throw new NotFoundError(`Notification ${id} not found`);
    }

    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      eventType: row.event_type,
      title: row.title,
      body: row.body,
      channel: row.channel,
      data: row.data || {},
      isRead: row.is_read,
      readAt: new Date(row.read_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async markAllAsRead(orgId: string, userId: string): Promise<{ count: number }> {
    const updated = await this.sql<any[]>`
      UPDATE notifications
      SET is_read = true, read_at = now()
      WHERE org_id = ${orgId}
        AND user_id = ${userId}
        AND is_read = false
      RETURNING id
    `;

    return { count: updated.length };
  }

  async registerDeviceToken(
    orgId: string,
    userId: string,
    dto: RegisterDeviceTokenDto,
  ): Promise<{ success: boolean; token: string }> {
    const platform = dto.platform || 'web';

    await this.sql`
      INSERT INTO device_tokens (org_id, user_id, token, platform)
      VALUES (${orgId}, ${userId}, ${dto.token}, ${platform})
      ON CONFLICT (token) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            platform = EXCLUDED.platform,
            org_id = EXCLUDED.org_id
    `;

    return { success: true, token: dto.token };
  }
}
