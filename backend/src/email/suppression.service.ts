import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import { SuppressionItem, SuppressionReason, MessageChannel } from './email.types';

@Injectable()
export class SuppressionService {
  constructor(@Inject(PG_CLIENT) private readonly sql: postgres.Sql) {}

  async isSuppressed(orgId: string, address: string, channel: MessageChannel = 'email'): Promise<boolean> {
    const normalised = address.trim().toLowerCase();
    const [row] = await this.sql<any[]>`
      SELECT id
      FROM suppression_list
      WHERE org_id = ${orgId}
        AND address = ${normalised}
        AND channel = ${channel}
      LIMIT 1
    `;
    return !!row;
  }

  async suppress(
    orgId: string,
    address: string,
    reason: SuppressionReason,
    detail?: string,
    channel: MessageChannel = 'email',
  ): Promise<SuppressionItem> {
    const normalised = address.trim().toLowerCase();
    const [row] = await this.sql<SuppressionItem[]>`
      INSERT INTO suppression_list (
        org_id,
        address,
        channel,
        reason,
        detail
      ) VALUES (
        ${orgId},
        ${normalised},
        ${channel},
        ${reason},
        ${detail || null}
      )
      ON CONFLICT (org_id, address, channel)
      DO UPDATE SET
        reason = EXCLUDED.reason,
        detail = EXCLUDED.detail,
        created_at = now()
      RETURNING
        id,
        org_id as "orgId",
        address,
        channel,
        reason,
        detail,
        created_at as "createdAt"
    `;
    return row;
  }

  async unsuppress(orgId: string, id: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM suppression_list
      WHERE id = ${id} AND org_id = ${orgId}
    `;
    return result.count > 0;
  }

  async list(orgId: string, channel: MessageChannel = 'email'): Promise<SuppressionItem[]> {
    const rows = await this.sql<SuppressionItem[]>`
      SELECT
        id,
        org_id as "orgId",
        address,
        channel,
        reason,
        detail,
        created_at as "createdAt"
      FROM suppression_list
      WHERE org_id = ${orgId}
        AND channel = ${channel}
      ORDER BY created_at DESC
    `;
    return rows;
  }
}
