import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';

export interface DedupResult {
  isDuplicate: boolean;
  matchedRecordId?: string;
  matchedField?: string;
  matchedValue?: unknown;
}

@Injectable()
export class DedupService {
  constructor(@Inject(PG_CLIENT) private readonly sql: postgres.Sql) {}

  async checkDuplicate(
    orgId: string,
    moduleId: string,
    dedupeOn: string[],
    data: Record<string, unknown>,
  ): Promise<DedupResult> {
    if (!dedupeOn || dedupeOn.length === 0 || !data) {
      return { isDuplicate: false };
    }

    for (const fieldKey of dedupeOn) {
      const rawVal = data[fieldKey];
      if (rawVal == null || rawVal === '') continue;

      if (fieldKey.toLowerCase().includes('email')) {
        const emailStr = String(rawVal).trim().toLowerCase();
        if (emailStr.length > 3) {
          const [rec] = await this.sql<any[]>`
            SELECT id
            FROM records
            WHERE org_id = ${orgId}
              AND module_id = ${moduleId}
              AND deleted_at IS NULL
              AND (
                LOWER(data->>'email') = ${emailStr}
                OR LOWER(data->>${fieldKey}) = ${emailStr}
              )
            ORDER BY created_at DESC
            LIMIT 1
          `;

          if (rec) {
            return {
              isDuplicate: true,
              matchedRecordId: rec.id,
              matchedField: fieldKey,
              matchedValue: emailStr,
            };
          }
        }
      } else if (
        fieldKey.toLowerCase().includes('phone') ||
        fieldKey.toLowerCase().includes('mobile') ||
        fieldKey.toLowerCase().includes('whatsapp')
      ) {
        const digits = String(rawVal).replace(/[^\d]/g, '');
        if (digits.length >= 7) {
          const last10 = digits.slice(-10);
          const [rec] = await this.sql<any[]>`
            SELECT id
            FROM records
            WHERE org_id = ${orgId}
              AND module_id = ${moduleId}
              AND deleted_at IS NULL
              AND (
                data->>'phone' ILIKE ${'%' + last10}
                OR data->>'mobile' ILIKE ${'%' + last10}
                OR data->>'whatsapp' ILIKE ${'%' + last10}
                OR data->>${fieldKey} ILIKE ${'%' + last10}
              )
            ORDER BY created_at DESC
            LIMIT 1
          `;

          if (rec) {
            return {
              isDuplicate: true,
              matchedRecordId: rec.id,
              matchedField: fieldKey,
              matchedValue: rawVal,
            };
          }
        }
      } else {
        const strVal = String(rawVal).trim();
        const [rec] = await this.sql<any[]>`
          SELECT id
          FROM records
          WHERE org_id = ${orgId}
            AND module_id = ${moduleId}
            AND deleted_at IS NULL
            AND data->>${fieldKey} = ${strVal}
          ORDER BY created_at DESC
          LIMIT 1
        `;

        if (rec) {
          return {
            isDuplicate: true,
            matchedRecordId: rec.id,
            matchedField: fieldKey,
            matchedValue: rawVal,
          };
        }
      }
    }

    return { isDuplicate: false };
  }
}
