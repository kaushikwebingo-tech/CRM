import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import {
  ConsentChannel,
  ConsentPurpose,
  ConsentRecord,
  RecordConsentDto,
  WithdrawConsentDto,
  ConsentCheckResult,
} from './consent.types';
import { ValidationError } from '../common/errors';

@Injectable()
export class ConsentService {
  constructor(@Inject(PG_CLIENT) private readonly sql: postgres.Sql) {}

  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  async checkConsent(
    orgId: string,
    recordId: string,
    channel: ConsentChannel,
    purpose: ConsentPurpose,
  ): Promise<ConsentCheckResult> {
    if (!recordId) {
      return {
        allowed: false,
        reason: 'Record ID is required to verify recipient consent',
      };
    }

    const [row] = await this.sql<any[]>`
      SELECT *
      FROM consents
      WHERE org_id = ${orgId}
        AND record_id = ${recordId}
        AND channel = ${channel}
        AND (purpose = ${purpose} OR purpose = 'marketing')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (purpose === 'marketing') {
      if (!row || row.status !== 'granted') {
        const statusReason = row?.status === 'withdrawn'
          ? `Recipient has explicitly withdrawn consent for ${channel} marketing messages`
          : `Consent is required for ${channel} marketing messages but has not been granted for this recipient`;
        return {
          allowed: false,
          reason: statusReason,
          consent: row ? this.mapRow(row) : undefined,
        };
      }
      return {
        allowed: true,
        consent: this.mapRow(row),
      };
    }

    if (row && row.status === 'withdrawn') {
      return {
        allowed: false,
        reason: `Recipient has explicitly opted out of all ${channel} communications`,
        consent: this.mapRow(row),
      };
    }

    return {
      allowed: true,
      consent: row ? this.mapRow(row) : undefined,
    };
  }

  async recordConsent(orgId: string, dto: RecordConsentDto): Promise<ConsentRecord> {
    if (!dto.recordId) {
      throw new ValidationError('recordId is required', [{ field: 'recordId', message: 'recordId is required' }]);
    }
    if (!dto.channel) {
      throw new ValidationError('channel is required', [{ field: 'channel', message: 'channel is required' }]);
    }
    if (!dto.purpose) {
      throw new ValidationError('purpose is required', [{ field: 'purpose', message: 'purpose is required' }]);
    }

    const grantedAt = dto.status === 'granted' ? new Date().toISOString() : null;
    const withdrawnAt = dto.status === 'withdrawn' ? new Date().toISOString() : null;

    const [row] = await this.sql<any[]>`
      INSERT INTO consents (
        org_id,
        record_id,
        channel,
        purpose,
        status,
        source,
        evidence,
        granted_at,
        withdrawn_at
      ) VALUES (
        ${orgId},
        ${dto.recordId},
        ${dto.channel},
        ${dto.purpose},
        ${dto.status},
        ${dto.source || 'manual'},
        ${this.jsonb(dto.evidence)}::text::jsonb,
        ${grantedAt},
        ${withdrawnAt}
      )
      ON CONFLICT (org_id, record_id, channel, purpose)
      DO UPDATE SET
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        evidence = EXCLUDED.evidence,
        granted_at = CASE WHEN EXCLUDED.status = 'granted' THEN now() ELSE consents.granted_at END,
        withdrawn_at = CASE WHEN EXCLUDED.status = 'withdrawn' THEN now() ELSE consents.withdrawn_at END
      RETURNING *
    `;

    return this.mapRow(row);
  }

  async withdrawConsent(orgId: string, dto: WithdrawConsentDto): Promise<number> {
    if (!dto.recordId) {
      throw new ValidationError('recordId is required', [{ field: 'recordId', message: 'recordId is required' }]);
    }

    let updated: any[];
    if (dto.purpose) {
      updated = await this.sql<any[]>`
        UPDATE consents
        SET status = 'withdrawn', withdrawn_at = now()
        WHERE org_id = ${orgId}
          AND record_id = ${dto.recordId}
          AND channel = ${dto.channel}
          AND purpose = ${dto.purpose}
        RETURNING id
      `;
    } else {
      updated = await this.sql<any[]>`
        UPDATE consents
        SET status = 'withdrawn', withdrawn_at = now()
        WHERE org_id = ${orgId}
          AND record_id = ${dto.recordId}
          AND channel = ${dto.channel}
        RETURNING id
      `;
    }

    if (updated.length === 0) {
      await this.sql`
        INSERT INTO consents (
          org_id,
          record_id,
          channel,
          purpose,
          status,
          source,
          evidence,
          withdrawn_at
        ) VALUES (
          ${orgId},
          ${dto.recordId},
          ${dto.channel},
          ${dto.purpose || 'marketing'},
          'withdrawn',
          'opt_out',
          ${this.jsonb({ reason: dto.reason || 'user_opt_out' })}::text::jsonb,
          now()
        )
        ON CONFLICT (org_id, record_id, channel, purpose)
        DO UPDATE SET status = 'withdrawn', withdrawn_at = now()
      `;
      return 1;
    }

    return updated.length;
  }

  async listForRecord(orgId: string, recordId: string): Promise<ConsentRecord[]> {
    const rows = await this.sql<any[]>`
      SELECT *
      FROM consents
      WHERE org_id = ${orgId}
        AND record_id = ${recordId}
      ORDER BY channel ASC, purpose ASC
    `;
    return rows.map((r) => this.mapRow(r));
  }

  async withdrawByContact(
    orgId: string,
    channel: ConsentChannel,
    contactIdentifier: string,
  ): Promise<void> {
    const clean = contactIdentifier.trim().replace(/[^\w@\.\+\-]/g, '');
    const records = await this.sql<any[]>`
      SELECT id
      FROM records
      WHERE org_id = ${orgId}
        AND deleted_at IS NULL
        AND (
          data->>'phone' ILIKE ${'%' + clean + '%'}
          OR data->>'email' ILIKE ${clean}
          OR display_name ILIKE ${clean}
        )
      LIMIT 20
    `;

    for (const rec of records) {
      await this.withdrawConsent(orgId, {
        recordId: rec.id,
        channel,
        reason: 'inbound_stop_keyword',
      });
    }
  }

  private mapRow(row: any): ConsentRecord {
    return {
      id: row.id,
      orgId: row.org_id,
      recordId: row.record_id,
      channel: row.channel,
      purpose: row.purpose,
      status: row.status,
      source: row.source,
      evidence: row.evidence || {},
      grantedAt: row.granted_at ? new Date(row.granted_at).toISOString() : null,
      withdrawnAt: row.withdrawn_at ? new Date(row.withdrawn_at).toISOString() : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    };
  }
}
