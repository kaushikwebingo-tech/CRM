import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import Redis from 'ioredis';
import { PG_CLIENT } from '../db/connection';
import { REDIS } from '../auth/session.service';
import { AssignmentRuleConfig } from './capture.types';

@Injectable()
export class AssignmentService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async resolveOwner(
    orgId: string,
    sourceId: string,
    config: AssignmentRuleConfig = {},
    data: Record<string, unknown> = {},
  ): Promise<string | null> {
    const strategy = config.strategy || 'fixed';

    if (strategy === 'fixed') {
      const targetId = config.ownerId || (config as any).userId;
      if (targetId) {
        const [u] = await this.sql<any[]>`
          SELECT id
          FROM users
          WHERE id = ${targetId}
            AND org_id = ${orgId}
            AND is_active = true
        `;
        if (u) return u.id;
      }
    }

    if (strategy === 'round_robin' && Array.isArray(config.pool) && config.pool.length > 0) {
      const activeUsers = await this.sql<any[]>`
        SELECT id
        FROM users
        WHERE id = ANY(${config.pool})
          AND org_id = ${orgId}
          AND is_active = true
      `;

      if (activeUsers.length > 0) {
        const userIds = activeUsers.map((u) => u.id);
        const counterKey = `assignment:rr:${orgId}:${sourceId || 'default'}`;
        let nextIndex = 0;
        try {
          const counter = await this.redis.incr(counterKey);
          nextIndex = Math.abs(counter) % userIds.length;
        } catch {
          nextIndex = Math.floor(Math.random() * userIds.length);
        }
        return userIds[nextIndex];
      }
    }

    if (strategy === 'load_balanced' && Array.isArray(config.pool) && config.pool.length > 0) {
      const activeUsers = await this.sql<any[]>`
        SELECT id
        FROM users
        WHERE id = ANY(${config.pool})
          AND org_id = ${orgId}
          AND is_active = true
      `;

      if (activeUsers.length > 0) {
        const userIds = activeUsers.map((u) => u.id);
        const counts = await this.sql<any[]>`
          SELECT owner_id, count(*)::int AS open_count
          FROM records
          WHERE org_id = ${orgId}
            AND owner_id = ANY(${userIds})
            AND deleted_at IS NULL
          GROUP BY owner_id
        `;

        const countMap = new Map<string, number>();
        for (const uid of userIds) {
          countMap.set(uid, 0);
        }
        for (const c of counts) {
          if (c.owner_id) {
            countMap.set(c.owner_id, c.open_count);
          }
        }

        let minUser = userIds[0];
        let minCount = countMap.get(minUser) ?? Infinity;

        for (const uid of userIds) {
          const count = countMap.get(uid) ?? 0;
          if (count < minCount) {
            minCount = count;
            minUser = uid;
          }
        }

        return minUser;
      }
    }

    if (strategy === 'by_field_value' && config.fieldKey && config.mapping) {
      const val = String(data[config.fieldKey] || '').trim();
      const mappedId = config.mapping[val];
      if (mappedId) {
        const [u] = await this.sql<any[]>`
          SELECT id
          FROM users
          WHERE id = ${mappedId}
            AND org_id = ${orgId}
            AND is_active = true
        `;
        if (u) return u.id;
      }

      if (config.fallbackOwnerId) {
        const [fallback] = await this.sql<any[]>`
          SELECT id
          FROM users
          WHERE id = ${config.fallbackOwnerId}
            AND org_id = ${orgId}
            AND is_active = true
        `;
        if (fallback) return fallback.id;
      }
    }

    const [defaultAdmin] = await this.sql<any[]>`
      SELECT id
      FROM users
      WHERE org_id = ${orgId}
        AND is_active = true
      ORDER BY created_at ASC
      LIMIT 1
    `;

    return defaultAdmin ? defaultAdmin.id : null;
  }
}
