import { Inject, Injectable, Logger } from '@nestjs/common';
import postgres from 'postgres';
import { createHash } from 'crypto';
import { PG_CLIENT } from '../db/connection';
import { FIELD_KEY_PATTERN, compileFieldSql } from './schema-compiler';


@Injectable()
export class IndexPromotionService {
  private readonly logger = new Logger('IndexPromotion');

  constructor(@Inject(PG_CLIENT) private readonly sql: postgres.Sql) {}

  /** `idx_rec_<module>_<field>`, always a valid and unique identifier. */
  indexName(moduleKey: string, fieldKey: string): string {
    if (!FIELD_KEY_PATTERN.test(moduleKey) || !FIELD_KEY_PATTERN.test(fieldKey)) {
      throw new Error(`Refusing to build an index name from "${moduleKey}.${fieldKey}"`);
    }
    const base = `idx_rec_${moduleKey}_${fieldKey}`;
    if (Buffer.byteLength(base) <= 63) return base;
    const digest = createHash('sha1').update(base).digest('hex').slice(0, 8);
    return `${base.slice(0, 54)}_${digest}`;
  }

  async promote(params: {
    orgId: string;
    moduleId: string;
    moduleKey: string;
    fieldKey: string;
    fieldType: string;
  }): Promise<{ created: boolean; index: string }> {
    const name = this.indexName(params.moduleKey, params.fieldKey);
    const expr = compileFieldSql(params.fieldKey, params.fieldType);

    // `r.` is the alias the compiler emits for queries; an index expression has
    // no alias, so it is stripped here rather than parameterised anywhere else.
    const indexedExpression = expr.sql.replace(/\br\.data\b/g, 'data');

    const [existing] = await this.sql`
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${name} LIMIT 1
    `;
    if (existing) return { created: false, index: name };

    // `module_id` is a LEADING COLUMN, not a WHERE predicate.
    //
    // A partial index predicated on `module_id = '<literal uuid>'` is unusable
    // here: every query binds the module id as a parameter, and the planner
    // cannot prove a parameter equals the literal in the predicate, so it never
    // picks the index. Leading with the column makes it usable for exactly the
    // shape the record queries have — org/module equality plus the expression.
    const statement =
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ` +
      `ON records (module_id, (${indexedExpression})) ` +
      `WHERE deleted_at IS NULL`;

    this.logger.log(`promoting ${params.moduleKey}.${params.fieldKey} -> ${name}`);
    await this.sql.unsafe(statement);
    return { created: true, index: name };
  }

  async demote(moduleKey: string, fieldKey: string): Promise<{ dropped: boolean }> {
    const name = this.indexName(moduleKey, fieldKey);
    const [existing] = await this.sql`
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${name} LIMIT 1
    `;
    if (!existing) return { dropped: false };
    await this.sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
    return { dropped: true };
  }

  /**
   * Brings every is_indexed field in the org in line with the indexes that
   * exist. Safe to call repeatedly; runs outside any transaction.
   */
  async reconcile(orgId: string): Promise<{ created: string[]; dropped: string[] }> {
    const rows = await this.sql`
      SELECT m.id AS module_id, m.key AS module_key, f.key AS field_key, f.type, f.is_indexed
      FROM fields f
      JOIN modules m ON m.id = f.module_id
      WHERE f.org_id = ${orgId}
        AND f.deleted_at IS NULL
        AND m.deleted_at IS NULL
    `;

    const created: string[] = [];
    const dropped: string[] = [];

    for (const row of rows) {
      if (!FIELD_KEY_PATTERN.test(row.module_key) || !FIELD_KEY_PATTERN.test(row.field_key)) {
        continue;
      }
      try {
        if (row.is_indexed) {
          const result = await this.promote({
            orgId,
            moduleId: row.module_id,
            moduleKey: row.module_key,
            fieldKey: row.field_key,
            fieldType: row.type,
          });
          if (result.created) created.push(result.index);
        } else {
          const result = await this.demote(row.module_key, row.field_key);
          if (result.dropped) dropped.push(this.indexName(row.module_key, row.field_key));
        }
      } catch (err) {
        this.logger.warn(
          `could not reconcile ${row.module_key}.${row.field_key}: ${(err as Error).message}`,
        );
      }
    }

    return { created, dropped };
  }
}
