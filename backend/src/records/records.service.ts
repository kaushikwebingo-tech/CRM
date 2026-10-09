import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import { SchemaCompiler, CompiledModule, CompiledField } from '../metadata/schema-compiler';
import { ModulesService } from '../metadata/modules.service';
import { getFieldType } from '../field-types/registry';
import { parseCsv, stringifyCsv } from '../common/csv';
import { FilterCompiler } from './filter-compiler';
import { SearchCompiler } from './search-compiler';
import { encodeCursor, decodeCursor } from './keyset-pagination';

/** The cursor value is bound with the sort expression's own type. */
/** Above this many rows the planner's estimate is used instead of an exact count. */
const EXACT_COUNT_LIMIT = 10_000;

/** Upper bound on a single CSV export, so one request cannot exhaust memory. */
const EXPORT_ROW_LIMIT = 50_000;

const CURSOR_CASTS: Record<string, string> = {
  text: '::text',
  numeric: '::numeric',
  boolean: '::boolean',
  date: '::date',
  timestamptz: '::timestamptz',
  uuid: '::uuid',
  jsonb: '::jsonb',
};
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
  FieldError,
} from '../common/errors';
import {
  asObject,
  asDataObject,
  asOptionalUuid,
  asTrimmedString,
  asUuidArray,
  asInt,
  isUuid,
  parseJsonParam,
  parseSort,
  parseFieldList,
} from '../common/input';
import Redis from 'ioredis';
import { REDIS } from '../auth/session.service';
import {
  parsePermissions,
  assertAdmin,
  assertModuleAction,
  scopeFor,
  unreadableFields,
  readOnlyFields,
} from '../auth/permissions';
import { compileScope, scopeFragment } from '../auth/record-scope';

export interface RecordListQuery {
  view?: string;
  filter?: string;
  sort?: string;
  cursor?: string;
  limit?: number;
  q?: string;
  fields?: string;
}

export interface CurrentUserPayload {
  id: string;
  orgId: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  role: {
    id: string;
    name: string;
    permissions: Record<string, unknown>;
  };
}

@Injectable()
export class RecordsService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly schemaCompiler: SchemaCompiler,
    private readonly modulesService: ModulesService
  ) {}

  /**
   * Serialises a value for a `::text::jsonb` parameter.
   *
   * Binding jsonb through postgres.js is runtime-dependent, and getting it
   * wrong is silent data loss rather than an error, so the form matters:
   *
   *   form                          plain client   Drizzle-patched client
   *   ${JSON.stringify(x)}::jsonb   JSON *string*  object
   *   sql.json(x) / raw object      object         throws at Bind
   *   ${JSON.stringify(x)}::text::jsonb   object   object      <- the only one
   *
   * `drizzle-orm/postgres-js` patches the shared client's serialiser in
   * db/connection.ts, so the API and a standalone script behave differently on
   * the same statement. The explicit `::text` makes Postgres infer the
   * parameter as text, so postgres.js binds a plain string either way and
   * Postgres does the parse. Every jsonb write in this file uses
   * `${this.jsonb(x)}::text::jsonb`.
   */
  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? null);
  }

  /**
   * Coerces and validates the `data` object of a write.
   *
   * Plan Section 5 declares `normalize()` ("what is written to data") and
   * `valueSchema()` ("validates a stored value"); Section 6 lists API
   * validation as the schema compiler's first consumer. The division of labour
   * is: normalize coerces, valueSchema decides, and nothing reaches the
   * transaction until both have run. Writing a value the compiled SQL cast
   * cannot parse is how a single record used to break every list view on a
   * field, so this is the layer that prevents it.
   */
  private validateData(
    compiled: CompiledModule,
    input: Record<string, unknown>,
    mode: 'create' | 'update',
    existingData: Record<string, unknown> = {},
  ): { data: Record<string, unknown>; touched: string[] } {
    const fieldErrors: FieldError[] = [];

    // An unknown key is a client bug. Silently dropping it loses data without
    // telling anyone, which is worse than refusing the write.
    const unknown = Object.keys(input).filter((k) => !compiled.fieldsByKey.has(k));
    for (const key of unknown) {
      fieldErrors.push({ field: key, message: `"${key}" is not a field on this module` });
    }

    const normalized: Record<string, unknown> = {};
    const touched: string[] = [];

    for (const field of compiled.fields) {
      const supplied = Object.prototype.hasOwnProperty.call(input, field.key);

      // PATCH merges: an omitted key means "do not touch".
      if (mode === 'update' && !supplied) continue;

      // A read-only field is owned by the server (auto_number), never the client.
      if (field.isSystem) {
        if (supplied) {
          fieldErrors.push({ field: field.key, message: `"${field.label}" is read-only` });
        }
        continue;
      }

      const raw = supplied
        ? input[field.key]
        : mode === 'create'
          ? compiled.defaults[field.key]
          : undefined;

      let value: unknown = null;
      try {
        value = getFieldType(field.type).normalize(raw as never, field.config as never);
      } catch {
        // normalize() must never decide the request's fate by throwing.
        fieldErrors.push({
          field: field.key,
          message: `"${field.label}" could not be read as ${field.type}`,
        });
        continue;
      }

      // An explicit null clears the field; a value that normalize could not
      // make sense of is rejected rather than silently stored as null.
      if (value === null || value === undefined) {
        const clearedOnPurpose = raw === null || raw === undefined || raw === '';
        if (!clearedOnPurpose) {
          fieldErrors.push({
            field: field.key,
            message: `"${field.label}" is not a valid ${field.type} value`,
          });
          continue;
        }
        if (field.isRequired) {
          fieldErrors.push({ field: field.key, message: `"${field.label}" is required` });
          continue;
        }
        if (supplied) touched.push(field.key);
        continue;
      }

      const parsed = getFieldType(field.type)
        .valueSchema(field.config as never)
        .safeParse(value);

      if (!parsed.success) {
        fieldErrors.push({
          field: field.key,
          message: parsed.error.issues[0]?.message ?? `"${field.label}" is invalid`,
        });
        continue;
      }

      normalized[field.key] = parsed.data;
      if (supplied) touched.push(field.key);
    }

    if (mode === 'create') {
      for (const field of compiled.fields) {
        if (field.isRequired && normalized[field.key] === undefined) {
          fieldErrors.push({ field: field.key, message: `"${field.label}" is required` });
        }
      }
    }

    if (fieldErrors.length > 0) {
      throw new ValidationError(
        fieldErrors.length === 1
          ? fieldErrors[0].message
          : `${fieldErrors.length} fields are invalid`,
        fieldErrors,
      );
    }

    if (mode === 'create') return { data: normalized, touched };

    const merged = { ...existingData };
    for (const key of touched) {
      if (normalized[key] === undefined) delete merged[key];
      else merged[key] = normalized[key];
    }
    return { data: merged, touched };
  }

  /**
   * Rebuilds search_tsv from display_name plus every field whose is_searchable
   * is set, through that type's toSearchText — so a select contributes its
   * option *label* rather than the opaque option id stored in `data`.
   * Plan Section 8, "Search".
   */
  private buildSearchText(
    compiled: CompiledModule,
    displayName: string,
    data: Record<string, unknown>,
  ): string {
    const parts: string[] = [displayName];
    for (const key of compiled.searchableKeys) {
      const field = compiled.fieldsByKey.get(key);
      const value = data[key];
      if (!field || value === undefined || value === null) continue;
      try {
        const text = getFieldType(field.type).toSearchText(value as never, field.config as never);
        if (text) parts.push(String(text));
      } catch {
        // A field that cannot render search text must not fail the write.
      }
    }
    return parts.join(' ').slice(0, 8000);
  }

  /** Rejects a unique collision before the transaction, and again via 23505 if it races. */
  private async assertUnique(
    orgId: string,
    moduleId: string,
    compiled: CompiledModule,
    data: Record<string, unknown>,
    excludeRecordId?: string,
  ): Promise<void> {
    const fieldErrors: FieldError[] = [];

    for (const key of compiled.uniqueKeys) {
      const value = data[key];
      if (value === undefined || value === null || value === '') continue;

      const [clash] = await this.sql`
        SELECT id FROM records
        WHERE org_id = ${orgId}
          AND module_id = ${moduleId}
          AND deleted_at IS NULL
          AND data->>${key} = ${String(value)}
          ${excludeRecordId ? this.sql`AND id <> ${excludeRecordId}` : this.sql``}
        LIMIT 1
      `;

      if (clash) {
        const field = compiled.fieldsByKey.get(key);
        fieldErrors.push({
          field: key,
          message: `Another ${compiled.labels.singular.toLowerCase()} already has this ${(
            field?.label ?? key
          ).toLowerCase()}`,
        });
      }
    }

    if (fieldErrors.length > 0) {
      throw new ConflictError('A unique field already has this value', fieldErrors);
    }
  }

  /**
   * Validates every reference a write carries: the owner must be an active user
   * of this org, the stage must belong to a pipeline of this module, and each
   * lookup target must be a live record of the module its field points at.
   * Without this, a stage id from another module orphans the record and a bad
   * uuid surfaces as a foreign-key 500.
   */
  private async resolveReferences(
    orgId: string,
    moduleId: string,
    compiled: CompiledModule,
    refs: { ownerId?: string | null; stageId?: string | null; pipelineId?: string | null },
    data: Record<string, unknown>,
  ): Promise<{ ownerId: string | null; stageId: string | null; pipelineId: string | null }> {
    const fieldErrors: FieldError[] = [];

    const ownerId = refs.ownerId === undefined ? undefined : asOptionalUuid(refs.ownerId, 'owner_id');
    if (ownerId) {
      const [user] = await this.sql`
        SELECT id FROM users
        WHERE id = ${ownerId} AND org_id = ${orgId} AND is_active = true
        LIMIT 1
      `;
      if (!user) fieldErrors.push({ field: 'owner_id', message: 'Owner is not an active user' });
    }

    let stageId = refs.stageId === undefined ? undefined : asOptionalUuid(refs.stageId, 'stage_id');
    let pipelineId =
      refs.pipelineId === undefined ? undefined : asOptionalUuid(refs.pipelineId, 'pipeline_id');

    if (stageId) {
      const [stage] = await this.sql`
        SELECT ps.id, ps.pipeline_id
        FROM pipeline_stages ps
        JOIN pipelines p ON p.id = ps.pipeline_id
        WHERE ps.id = ${stageId}
          AND ps.org_id = ${orgId}
          AND p.module_id = ${moduleId}
          AND ps.deleted_at IS NULL
          AND p.deleted_at IS NULL
        LIMIT 1
      `;
      if (!stage) {
        fieldErrors.push({
          field: 'stage_id',
          message: 'Stage does not belong to a pipeline of this module',
        });
      } else if (pipelineId && pipelineId !== stage.pipeline_id) {
        fieldErrors.push({
          field: 'stage_id',
          message: 'Stage does not belong to the given pipeline',
        });
      } else {
        // The record's pipeline always follows its stage.
        pipelineId = stage.pipeline_id;
      }
    } else if (pipelineId) {
      const [pipeline] = await this.sql`
        SELECT id FROM pipelines
        WHERE id = ${pipelineId} AND org_id = ${orgId} AND module_id = ${moduleId} AND deleted_at IS NULL
        LIMIT 1
      `;
      if (!pipeline) {
        fieldErrors.push({ field: 'pipeline_id', message: 'Pipeline does not belong to this module' });
      }
    }

    const lookupTargets: { key: string; id: string; targetModuleKey?: string }[] = [];
    for (const field of compiled.fields) {
      if (field.type !== 'lookup' && field.type !== 'user') continue;
      const value = data[field.key];
      if (!value) continue;
      lookupTargets.push({
        key: field.key,
        id: String(value),
        targetModuleKey: (field.config as { targetModuleKey?: string })?.targetModuleKey,
      });
    }

    for (const target of lookupTargets) {
      const field = compiled.fieldsByKey.get(target.key);
      if (field?.type === 'user') {
        const [user] = await this.sql`
          SELECT id FROM users WHERE id = ${target.id} AND org_id = ${orgId} LIMIT 1
        `;
        if (!user) {
          fieldErrors.push({ field: target.key, message: `"${field.label}" is not a user of this organisation` });
        }
        continue;
      }
      const [rec] = await this.sql`
        SELECT r.id, m.key AS module_key
        FROM records r
        JOIN modules m ON m.id = r.module_id
        WHERE r.id = ${target.id} AND r.org_id = ${orgId} AND r.deleted_at IS NULL
        LIMIT 1
      `;
      if (!rec) {
        fieldErrors.push({
          field: target.key,
          message: `"${field?.label ?? target.key}" points at a record that does not exist`,
        });
      } else if (target.targetModuleKey && rec.module_key !== target.targetModuleKey) {
        fieldErrors.push({
          field: target.key,
          message: `"${field?.label ?? target.key}" must point at a ${target.targetModuleKey}`,
        });
      }
    }

    if (fieldErrors.length > 0) {
      throw new ValidationError(fieldErrors[0].message, fieldErrors);
    }

    return {
      ownerId: ownerId ?? null,
      stageId: stageId ?? null,
      pipelineId: pipelineId ?? null,
    };
  }

  /**
   * Rewrites the record_links mirror for one record in the caller's transaction.
   * Plan Section 4, Relations: the mirror is "written in the same transaction as
   * the record" — which has to include updates and deletes, or reverse lookups
   * go stale the first time a lookup field changes.
   */
  private async syncRecordLinks(
    tx: postgres.TransactionSql,
    orgId: string,
    recordId: string,
    compiled: CompiledModule,
    data: Record<string, unknown>,
  ): Promise<void> {
    const links: { key: string; targetId: string }[] = [];
    for (const field of compiled.fields) {
      if (field.type !== 'lookup') continue;
      const value = data[field.key];
      if (typeof value === 'string' && value) links.push({ key: field.key, targetId: value });
    }

    await tx`DELETE FROM record_links WHERE source_record_id = ${recordId}`;
    for (const link of links) {
      await tx`
        INSERT INTO record_links (org_id, source_record_id, source_field_key, target_record_id)
        VALUES (${orgId}, ${recordId}, ${link.key}, ${link.targetId})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  /**
   * Allocates the next value for each auto_number field, inside the write
   * transaction. Plan Section 5: "sequence per module, read-only".
   */
  private async allocateAutoNumbers(
    tx: postgres.TransactionSql,
    orgId: string,
    moduleId: string,
    compiled: CompiledModule,
    data: Record<string, unknown>,
  ): Promise<void> {
    for (const field of compiled.fields) {
      if (field.type !== 'auto_number') continue;

      const [fieldRow] = await tx`
        SELECT id FROM fields WHERE module_id = ${moduleId} AND key = ${field.key} LIMIT 1
      `;
      if (!fieldRow) continue;

      const start = Number((field.config as { startingNumber?: number })?.startingNumber ?? 1);
      const [seq] = await tx`
        INSERT INTO field_sequences (org_id, field_id, next_value)
        VALUES (${orgId}, ${fieldRow.id}, ${Number.isFinite(start) ? start : 1})
        ON CONFLICT (org_id, field_id)
          DO UPDATE SET next_value = field_sequences.next_value + 1
        RETURNING next_value
      `;
      data[field.key] = Number(seq.next_value);
    }
  }


  /**
   * Record-level authorisation.
   *
   * Plan Section 13 + Guardrail 11: the scope becomes part of the predicate, so
   * `own` and `team` are enforced by Postgres and pagination counts stay honest.
   * There was previously no check of any kind here — a Read Only role could
   * create and delete records.
   */
  private authorise(
    currentUser: CurrentUserPayload,
    moduleKey: string,
    action: 'read' | 'create' | 'update' | 'delete',
    what: string,
  ) {
    const permissions = parsePermissions(currentUser.role?.permissions);
    assertModuleAction(permissions, moduleKey, action, what);
    return permissions;
  }

  /** The scope fragment for a tagged-template query. */
  private scopeSql(
    currentUser: CurrentUserPayload,
    moduleKey: string,
    action: 'read' | 'update' | 'delete',
  ) {
    const permissions = parsePermissions(currentUser.role?.permissions);
    return scopeFragment(this.sql, scopeFor(permissions, moduleKey, action), currentUser.id);
  }

  /**
   * Removes fields the role may not read from an outgoing record.
   * Plan Section 13 applies field permission twice: the bundle hides them for
   * usability, the API strips them for security.
   */
  private stripUnreadable(
    currentUser: CurrentUserPayload,
    moduleKey: string,
    records: any[],
  ): any[] {
    const hidden = unreadableFields(parsePermissions(currentUser.role?.permissions), moduleKey);
    if (hidden.size === 0) return records;
    return records.map((r) => {
      if (!r || typeof r !== 'object') return r;
      const data = { ...((r.data as Record<string, unknown>) || {}) };
      for (const key of hidden) delete data[key];
      const expanded = { ...((r._expanded as Record<string, unknown>) || {}) };
      for (const key of hidden) delete expanded[key];
      return { ...r, data, ...(r._expanded ? { _expanded: expanded } : {}) };
    });
  }

  /** Rejects a write to a field the role may read but not write. */
  private assertWritableFields(
    currentUser: CurrentUserPayload,
    moduleKey: string,
    data: Record<string, unknown>,
  ) {
    const permissions = parsePermissions(currentUser.role?.permissions);
    const locked = readOnlyFields(permissions, moduleKey);
    const hidden = unreadableFields(permissions, moduleKey);
    const offending = Object.keys(data).filter((k) => locked.has(k) || hidden.has(k));
    if (offending.length > 0) {
      throw new ForbiddenError(
        `You do not have permission to change: ${offending.join(', ')}`,
      );
    }
  }

  async create(
    orgId: string,
    moduleKey: string,
    body: { display_name: string; owner_id?: string; stage_id?: string; pipeline_id?: string; data?: Record<string, unknown> },
    currentUser: CurrentUserPayload,
    idempotencyKey?: string
  ) {
    const payload = asObject(body);
    this.authorise(currentUser, moduleKey, 'create', `create a ${moduleKey}`);
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);
    this.assertWritableFields(currentUser, moduleKey, asDataObject(payload.data));

    const displayName = asTrimmedString(payload.display_name, 'display_name');
    if (!displayName) {
      throw new ValidationError('display_name is required', [
        { field: 'display_name', message: 'Display name cannot be empty' },
      ]);
    }
    if (displayName.length > 500) {
      throw new ValidationError('display_name is too long', [
        { field: 'display_name', message: 'At most 500 characters' },
      ]);
    }

    const { data: normalizedData } = this.validateData(
      compiled,
      asDataObject(payload.data),
      'create',
    );

    const refs = await this.resolveReferences(
      orgId,
      mod.id,
      compiled,
      {
        ownerId: payload.owner_id as string | null | undefined,
        stageId: payload.stage_id as string | null | undefined,
        pipelineId: payload.pipeline_id as string | null | undefined,
      },
      normalizedData,
    );

    await this.assertUnique(orgId, mod.id, compiled, normalizedData);

    const [record] = await this.sql.begin(async (tx) => {
      await this.allocateAutoNumbers(tx, orgId, mod.id, compiled, normalizedData);
      const searchTsv = this.buildSearchText(compiled, displayName, normalizedData);

      const [insertedRecord] = await tx`
        INSERT INTO records (
          org_id,
          module_id,
          display_name,
          owner_id,
          pipeline_id,
          stage_id,
          stage_since,
          data,
          search_tsv,
          created_by,
          updated_by
        ) VALUES (
          ${orgId},
          ${mod.id},
          ${displayName},
          ${refs.ownerId},
          ${refs.pipelineId},
          ${refs.stageId},
          ${refs.stageId ? new Date().toISOString() : null},
          ${this.jsonb(normalizedData)}::text::jsonb,
          ${searchTsv},
          ${currentUser.id},
          ${currentUser.id}
        )
        RETURNING *
      `;

      await this.syncRecordLinks(tx, orgId, insertedRecord.id, compiled, normalizedData);

      await tx`
        INSERT INTO record_events (
          org_id,
          record_id,
          module_id,
          type,
          actor_id,
          actor_type,
          changes,
          payload
        ) VALUES (
          ${orgId},
          ${insertedRecord.id},
          ${mod.id},
          'created',
          ${currentUser.id},
          'user',
          ${this.jsonb({})}::text::jsonb,
          ${this.jsonb({ display_name: insertedRecord.display_name, data: normalizedData })}::text::jsonb
        )
      `;

      await tx`
        INSERT INTO outbox_events (
          org_id,
          event_type,
          aggregate_id,
          payload,
          available_at
        ) VALUES (
          ${orgId},
          'record.created',
          ${insertedRecord.id},
          ${this.jsonb({
            moduleKey,
            recordId: insertedRecord.id,
            displayName: insertedRecord.display_name,
            actorId: currentUser.id,
            idempotencyKey,
            data: normalizedData,
            snapshot: {
              display_name: insertedRecord.display_name,
              data: normalizedData,
              stage_id: insertedRecord.stage_id,
              pipeline_id: insertedRecord.pipeline_id,
              owner_id: insertedRecord.owner_id,
            },
            causationChain: [],
          })}::text::jsonb,
          now()
        )
      `;

      return [insertedRecord];
    });

    this.redis.publish('outbox:notify', '1').catch(() => {});

    return this.expandLookups(orgId, compiled, [record]).then((res) => res[0]);
  }

  async findById(
    orgId: string,
    moduleKey: string,
    recordId: string,
    currentUser: CurrentUserPayload,
  ) {
    this.authorise(currentUser, moduleKey, 'read', `view this ${moduleKey}`);
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);
    const scope = this.scopeSql(currentUser, moduleKey, 'read');

    const [record] = await this.sql`
      SELECT r.*
      FROM records r
      WHERE r.org_id = ${orgId}
        AND r.module_id = ${mod.id}
        AND r.id = ${recordId}
        AND r.deleted_at IS NULL
        AND ${scope}
      LIMIT 1
    `;

    if (!record) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    const expanded = await this.expandLookups(orgId, compiled, [record]);
    return this.stripUnreadable(currentUser, moduleKey, expanded)[0];
  }

  async update(
    orgId: string,
    moduleKey: string,
    recordId: string,
    body: { display_name?: string; owner_id?: string; stage_id?: string; pipeline_id?: string; data?: Record<string, unknown> },
    currentUser: CurrentUserPayload,
    idempotencyKey?: string
  ) {
    const payload = asObject(body);
    this.authorise(currentUser, moduleKey, 'update', `change this ${moduleKey}`);
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);
    this.assertWritableFields(currentUser, moduleKey, asDataObject(payload.data));
    const scope = this.scopeSql(currentUser, moduleKey, 'update');

    const [existing] = await this.sql`
      SELECT r.*
      FROM records r
      WHERE r.org_id = ${orgId}
        AND r.module_id = ${mod.id}
        AND r.id = ${recordId}
        AND r.deleted_at IS NULL
        AND ${scope}
      LIMIT 1
    `;

    if (!existing) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    const currentData = (existing.data as Record<string, unknown>) || {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    const suppliedDisplayName =
      payload.display_name === undefined ? undefined : asTrimmedString(payload.display_name, 'display_name');
    if (payload.display_name !== undefined && !suppliedDisplayName) {
      throw new ValidationError('display_name cannot be empty', [
        { field: 'display_name', message: 'Display name cannot be empty' },
      ]);
    }

    const { data: updatedData, touched } = this.validateData(
      compiled,
      asDataObject(payload.data),
      'update',
      currentData,
    );

    const refs = await this.resolveReferences(
      orgId,
      mod.id,
      compiled,
      {
        ownerId: payload.owner_id === undefined ? undefined : (payload.owner_id as string | null),
        stageId: payload.stage_id === undefined ? undefined : (payload.stage_id as string | null),
        pipelineId:
          payload.pipeline_id === undefined ? undefined : (payload.pipeline_id as string | null),
      },
      updatedData,
    );

    await this.assertUnique(orgId, mod.id, compiled, updatedData, recordId);

    for (const key of touched) {
      const from = currentData[key];
      const to = updatedData[key];
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        changes[key] = { from: from ?? null, to: to ?? null };
      }
    }

    const newDisplayName = suppliedDisplayName ?? existing.display_name;
    const newOwnerId = payload.owner_id === undefined ? existing.owner_id : refs.ownerId;
    const newStageId = payload.stage_id === undefined ? existing.stage_id : refs.stageId;
    const newPipelineId =
      payload.stage_id !== undefined || payload.pipeline_id !== undefined
        ? refs.pipelineId
        : existing.pipeline_id;

    if (newDisplayName !== existing.display_name) {
      changes.display_name = { from: existing.display_name, to: newDisplayName };
    }
    if (newOwnerId !== existing.owner_id) {
      changes.owner_id = { from: existing.owner_id, to: newOwnerId };
    }
    if (newStageId !== existing.stage_id) {
      changes.stage_id = { from: existing.stage_id, to: newStageId };
    }

    const searchTsv = this.buildSearchText(compiled, newDisplayName, updatedData);

    const [updated] = await this.sql.begin(async (tx) => {
      // A PATCH is a read-modify-write of one jsonb column. The lock has to be
      // taken inside the transaction, and the merge recomputed against the row
      // as it stands now, or a concurrent PATCH of a different key is lost.
      const [locked] = await tx`
        SELECT data, display_name, owner_id, stage_id, pipeline_id, stage_since
        FROM records
        WHERE id = ${recordId} AND org_id = ${orgId} AND deleted_at IS NULL
        LIMIT 1
        FOR UPDATE
      `;

      if (!locked) {
        throw new NotFoundError(`Record ${recordId} not found`);
      }

      const freshData = (locked.data as Record<string, unknown>) || {};
      const mergedData = { ...freshData };
      for (const key of touched) {
        if (updatedData[key] === undefined) delete mergedData[key];
        else mergedData[key] = updatedData[key];
      }

      const mergedDisplayName = suppliedDisplayName ?? locked.display_name;
      const mergedSearchTsv = this.buildSearchText(compiled, mergedDisplayName, mergedData);
      const stageChanged = payload.stage_id !== undefined && refs.stageId !== locked.stage_id;

      const [rec] = await tx`
        UPDATE records
        SET
          display_name = ${mergedDisplayName},
          owner_id = ${payload.owner_id === undefined ? locked.owner_id : refs.ownerId},
          stage_id = ${payload.stage_id === undefined ? locked.stage_id : refs.stageId},
          pipeline_id = ${
            payload.stage_id !== undefined || payload.pipeline_id !== undefined
              ? refs.pipelineId
              : locked.pipeline_id
          },
          stage_since = ${stageChanged ? new Date().toISOString() : locked.stage_since},
          data = ${this.jsonb(mergedData)}::text::jsonb,
          search_tsv = ${mergedSearchTsv},
          updated_by = ${currentUser.id},
          updated_at = now()
        WHERE id = ${recordId}
        RETURNING *
      `;

      await this.syncRecordLinks(tx, orgId, recordId, compiled, mergedData);

      if (Object.keys(changes).length > 0) {
        await tx`
          INSERT INTO record_events (
            org_id,
            record_id,
            module_id,
            type,
            actor_id,
            actor_type,
            changes,
            payload
          ) VALUES (
            ${orgId},
            ${recordId},
            ${mod.id},
            'updated',
            ${currentUser.id},
            'user',
            ${this.jsonb(changes)}::text::jsonb,
            ${this.jsonb({ updated_keys: Object.keys(changes) })}::text::jsonb
          )
        `;

        await tx`
          INSERT INTO outbox_events (
            org_id,
            event_type,
            aggregate_id,
            payload,
            available_at
          ) VALUES (
            ${orgId},
            'record.updated',
            ${recordId},
            ${this.jsonb({
              moduleKey,
              recordId,
              changes,
              actorId: currentUser.id,
              idempotencyKey,
              displayName: rec.display_name,
              snapshot: {
                display_name: rec.display_name,
                data: rec.data,
                stage_id: rec.stage_id,
                pipeline_id: rec.pipeline_id,
                owner_id: rec.owner_id,
              },
              causationChain: [],
            })}::text::jsonb,
            now()
          )
        `;
      }

      if (changes.owner_id) {
        await tx`
          INSERT INTO outbox_events (org_id, event_type, aggregate_id, payload, available_at)
          VALUES (
            ${orgId},
            'record.owner_changed',
            ${recordId},
            ${this.jsonb({
              moduleKey,
              recordId,
              changes: { owner_id: changes.owner_id },
              actorId: currentUser.id,
              displayName: rec.display_name,
              causationChain: [],
            })}::text::jsonb,
            now()
          )
        `;
      }

      return [rec];
    });

    this.redis.publish('outbox:notify', '1').catch(() => {});

    const res = await this.expandLookups(orgId, compiled, [updated]);
    return this.stripUnreadable(currentUser, moduleKey, res)[0];
  }

  async changeStage(
    orgId: string,
    moduleKey: string,
    recordId: string,
    stageId: string,
    currentUser: CurrentUserPayload
  ) {
    this.authorise(currentUser, moduleKey, 'update', `move this ${moduleKey}`);
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);
    const scope = this.scopeSql(currentUser, moduleKey, 'update');

    const [existing] = await this.sql`
      SELECT r.*
      FROM records r
      WHERE r.org_id = ${orgId}
        AND r.module_id = ${mod.id}
        AND r.id = ${recordId}
        AND r.deleted_at IS NULL
        AND ${scope}
      LIMIT 1
    `;

    if (!existing) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    if (existing.stage_id === stageId) {
      const res = await this.expandLookups(orgId, compiled, [existing]);
      return res[0];
    }

    const [targetStage] = await this.sql`
      SELECT ps.id, ps.label, ps.pipeline_id
      FROM pipeline_stages ps
      JOIN pipelines p ON p.id = ps.pipeline_id
      WHERE ps.id = ${stageId}
        AND ps.org_id = ${orgId}
        AND p.module_id = ${mod.id}
        AND ps.deleted_at IS NULL
        AND p.deleted_at IS NULL
      LIMIT 1
    `;

    if (!targetStage) {
      throw new ValidationError(`Invalid stage: stage does not belong to module ${moduleKey}`);
    }

    const [updated] = await this.sql.begin(async (tx) => {
      const [rec] = await tx`
        UPDATE records
        SET
          stage_id = ${stageId},
          pipeline_id = ${targetStage.pipeline_id},
          stage_since = now(),
          updated_by = ${currentUser.id},
          updated_at = now()
        WHERE id = ${recordId}
        RETURNING *
      `;

      await tx`
        INSERT INTO record_events (
          org_id,
          record_id,
          module_id,
          type,
          actor_id,
          actor_type,
          changes,
          payload
        ) VALUES (
          ${orgId},
          ${recordId},
          ${mod.id},
          'stage_changed',
          ${currentUser.id},
          'user',
          ${this.jsonb({
            stage_id: { from: existing.stage_id, to: stageId },
          })}::text::jsonb,
          ${this.jsonb({
            from_stage_id: existing.stage_id,
            to_stage_id: stageId,
            to_stage_label: targetStage.label,
          })}::text::jsonb
        )
      `;

      await tx`
        INSERT INTO outbox_events (
          org_id,
          event_type,
          aggregate_id,
          payload,
          available_at
        ) VALUES (
          ${orgId},
          'record.stage_changed',
          ${recordId},
          ${this.jsonb({
            moduleKey,
            recordId,
            fromStageId: existing.stage_id,
            toStageId: stageId,
            actorId: currentUser.id,
          })}::text::jsonb,
          now()
        )
      `;

      return [rec];
    });

    this.redis.publish('outbox:notify', '1').catch(() => {});

    const res = await this.expandLookups(orgId, compiled, [updated]);
    return res[0];
  }

  async getTimeline(
    orgId: string,
    moduleKey: string,
    recordId: string,
    currentUser: CurrentUserPayload,
  ) {
    // Reading a timeline is reading the record, so the same scope applies.
    await this.findById(orgId, moduleKey, recordId, currentUser);
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const events = await this.sql`
      SELECT
        re.id,
        re.record_id,
        re.module_id,
        re.type,
        re.actor_id,
        re.actor_type,
        re.changes,
        re.payload,
        re.created_at,
        u.full_name as actor_name,
        u.email as actor_email,
        u.avatar_url as actor_avatar
      FROM record_events re
      LEFT JOIN users u ON u.id = re.actor_id
      WHERE re.org_id = ${orgId}
        AND re.record_id = ${recordId}
      ORDER BY re.created_at DESC
      LIMIT 100
    `;
    return events;
  }

  async addNote(
    orgId: string,
    moduleKey: string,
    recordId: string,
    payload: { content: string; attachments?: any[] },
    currentUser: CurrentUserPayload
  ) {
    if (!payload.content || !payload.content.trim()) {
      throw new ValidationError('Note content cannot be empty');
    }
    this.authorise(currentUser, moduleKey, 'update', `add a note to this ${moduleKey}`);
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const scope = this.scopeSql(currentUser, moduleKey, 'update');

    const [existing] = await this.sql`
      SELECT r.id, r.display_name FROM records r
      WHERE r.org_id = ${orgId} AND r.module_id = ${mod.id} AND r.id = ${recordId}
        AND r.deleted_at IS NULL AND ${scope}
      LIMIT 1
    `;
    if (!existing) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    const notePayload = {
      content: payload.content.trim(),
      attachments: payload.attachments || [],
    };

    const [event] = await this.sql.begin(async (tx) => {
      const [ev] = await tx`
        INSERT INTO record_events (
          org_id,
          record_id,
          module_id,
          type,
          actor_id,
          actor_type,
          payload
        ) VALUES (
          ${orgId},
          ${recordId},
          ${mod.id},
          'note',
          ${currentUser.id},
          'user',
          ${this.jsonb(notePayload)}::text::jsonb
        )
        RETURNING *
      `;

      await tx`
        INSERT INTO outbox_events (
          org_id,
          event_type,
          aggregate_id,
          payload,
          available_at
        ) VALUES (
          ${orgId},
          'record.note_added',
          ${recordId},
          ${this.jsonb({
            moduleKey,
            recordId,
            actorId: currentUser.id,
            content: notePayload.content,
          })}::text::jsonb,
          now()
        )
      `;

      return [ev];
    });

    return {
      ...event,
      actor_name: currentUser.fullName,
      actor_email: currentUser.email,
      actor_avatar: currentUser.avatarUrl,
    };
  }

  async addAttachment(
    orgId: string,
    moduleKey: string,
    recordId: string,
    fileData: { key: string; name: string; size: number; mime: string; url: string },
    currentUser: CurrentUserPayload
  ) {
    if (!fileData || !fileData.key || !fileData.name) {
      throw new ValidationError('Invalid attachment file data');
    }
    this.authorise(currentUser, moduleKey, 'update', `attach a file to this ${moduleKey}`);
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const attachScope = this.scopeSql(currentUser, moduleKey, 'update');

    const [existing] = await this.sql`
      SELECT r.id, r.display_name, r.data FROM records r
      WHERE r.org_id = ${orgId} AND r.module_id = ${mod.id} AND r.id = ${recordId}
        AND r.deleted_at IS NULL AND ${attachScope}
      LIMIT 1
    `;
    if (!existing) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    const [event] = await this.sql.begin(async (tx) => {
      const [ev] = await tx`
        INSERT INTO record_events (
          org_id,
          record_id,
          module_id,
          type,
          actor_id,
          actor_type,
          payload
        ) VALUES (
          ${orgId},
          ${recordId},
          ${mod.id},
          'attachment',
          ${currentUser.id},
          'user',
          ${this.jsonb({ file: fileData })}::text::jsonb
        )
        RETURNING *
      `;

      await tx`
        INSERT INTO outbox_events (
          org_id,
          event_type,
          aggregate_id,
          payload,
          available_at
        ) VALUES (
          ${orgId},
          'record.attachment_added',
          ${recordId},
          ${this.jsonb({
            moduleKey,
            recordId,
            actorId: currentUser.id,
            file: fileData,
          })}::text::jsonb,
          now()
        )
      `;

      return [ev];
    });

    return {
      ...event,
      actor_name: currentUser.fullName,
      actor_email: currentUser.email,
      actor_avatar: currentUser.avatarUrl,
    };
  }

  /**
   * Global search across modules.
   *
   * This used to add `r.data::text ILIKE '%q%'`, which seq-scanned every record
   * of the org as text and matched inside fields the user may not be allowed to
   * read. It now searches display_name and the precomputed search_tsv, which is
   * built only from fields flagged is_searchable — the same contract as the
   * per-module `?q=` path, and able to use the trigram indexes.
   */
  async searchGlobal(
    orgId: string,
    query: unknown,
    limit: unknown = 20,
    currentUser?: CurrentUserPayload,
  ) {
    const q = asTrimmedString(query, 'q');
    if (!q) return [];

    const take = asInt(limit, { min: 1, max: 50, fallback: 20 });

    // Global search spans modules, and each module can carry a different record
    // scope. Taking the widest scope across all of them would leak: `read: all`
    // on Leads would also expose other people's Deals when Deals is `own`. So
    // the predicate is one branch per module, each with that module's own scope.
    let accessFilter = this.sql`TRUE`;
    if (currentUser) {
      const permissions = parsePermissions(currentUser.role?.permissions);
      const allModules = await this.modulesService.list(orgId);

      const branches = allModules
        .map((m: any) => ({ id: m.id, scope: scopeFor(permissions, m.key, 'read') }))
        .filter((m: { scope: string }) => m.scope !== 'none')
        .map(
          (m: { id: string; scope: never }) =>
            this.sql`(r.module_id = ${m.id} AND ${scopeFragment(this.sql, m.scope, currentUser.id)})`,
        );

      if (branches.length === 0) return [];

      accessFilter = branches.reduce(
        (acc: never, branch: never) => (acc ? (this.sql`${acc} OR ${branch}` as never) : branch),
        undefined as never,
      );
    }
    const prefix = `${q}%`;
    const contains = `%${q}%`;
    const short = q.length < 3;

    const rows = await this.sql`
      SELECT
        r.id,
        r.display_name,
        r.module_id,
        r.owner_id,
        r.created_at,
        r.updated_at,
        m.key as module_key,
        m.label_singular as module_label,
        m.icon as module_icon,
        m.color as module_color,
        u.full_name as owner_name
      FROM records r
      JOIN modules m ON m.id = r.module_id
      LEFT JOIN users u ON u.id = r.owner_id AND u.org_id = r.org_id
      WHERE r.org_id = ${orgId}
        AND r.deleted_at IS NULL
        AND m.deleted_at IS NULL
        AND (${accessFilter})
        AND (
          ${short
            ? this.sql`r.display_name ILIKE ${prefix}`
            : this.sql`r.display_name ILIKE ${contains} OR r.search_tsv ILIKE ${contains}`}
        )
      ORDER BY
        CASE WHEN r.display_name ILIKE ${prefix} THEN 1 ELSE 2 END,
        r.updated_at DESC
      LIMIT ${take}
    `;

    return rows;
  }

  async delete(orgId: string, moduleKey: string, recordId: string, currentUser: CurrentUserPayload) {
    this.authorise(currentUser, moduleKey, 'delete', `delete this ${moduleKey}`);
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const scope = this.scopeSql(currentUser, moduleKey, 'delete');

    const [existing] = await this.sql`
      SELECT r.id, r.display_name
      FROM records r
      WHERE r.org_id = ${orgId}
        AND r.module_id = ${mod.id}
        AND r.id = ${recordId}
        AND r.deleted_at IS NULL
        AND ${scope}
      LIMIT 1
    `;

    if (!existing) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    await this.sql.begin(async (tx) => {
      await tx`
        UPDATE records
        SET deleted_at = now(), updated_by = ${currentUser.id}
        WHERE id = ${recordId}
      `;

      await tx`
        INSERT INTO record_events (
          org_id,
          record_id,
          module_id,
          type,
          actor_id,
          actor_type,
          payload
        ) VALUES (
          ${orgId},
          ${recordId},
          ${mod.id},
          'deleted',
          ${currentUser.id},
          'user',
          ${this.jsonb({ display_name: existing.display_name })}::text::jsonb
        )
      `;

      await tx`
        INSERT INTO outbox_events (
          org_id,
          event_type,
          aggregate_id,
          payload,
          available_at
        ) VALUES (
          ${orgId},
          'record.deleted',
          ${recordId},
          ${this.jsonb({
            moduleKey,
            recordId,
            actorId: currentUser.id,
          })}::text::jsonb,
          now()
        )
      `;
    });

    return { success: true };
  }

  async bulkAction(
    orgId: string,
    moduleKey: string,
    payload: {
      action: 'assign' | 'update' | 'delete';
      record_ids: string[];
      data?: Record<string, any>;
    },
    currentUser: CurrentUserPayload
  ) {
    const body = asObject(payload);
    const action = asTrimmedString(body.action, 'action');
    if (action !== 'assign' && action !== 'update' && action !== 'delete') {
      throw new ValidationError('"action" must be assign, update or delete', [
        { field: 'action', message: 'Must be assign, update or delete' },
      ]);
    }
    // A non-uuid here used to reach `id = ANY($1)` and surface as a 500.
    const record_ids = asUuidArray(body.record_ids, 'record_ids', 1000);
    const data = asObject(body.data ?? {}, 'data');

    this.authorise(
      currentUser,
      moduleKey,
      action === 'delete' ? 'delete' : 'update',
      action === 'delete' ? `delete ${moduleKey} records` : `change ${moduleKey} records`,
    );
    if (action === 'update') {
      this.assertWritableFields(currentUser, moduleKey, asDataObject(data.data));
    }
    const bulkScope = this.scopeSql(
      currentUser,
      moduleKey,
      action === 'delete' ? 'delete' : 'update',
    );

    const mod = await this.modulesService.getByKey(orgId, moduleKey);

    return await this.sql.begin(async (tx) => {
      if (action === 'assign') {
        const ownerId = asOptionalUuid(data.owner_id, 'owner_id');
        if (ownerId) {
          const [userExists] = await tx`
            SELECT id FROM users WHERE id = ${ownerId} AND org_id = ${orgId} AND is_active = true LIMIT 1
          `;
          if (!userExists) {
            throw new ValidationError('Assigned user not found or inactive');
          }
        }

        const updated = await tx`
          UPDATE records
          SET owner_id = ${ownerId}, updated_by = ${currentUser.id}, updated_at = now()
          WHERE org_id = ${orgId}
            AND module_id = ${mod.id}
            AND id = ANY(${record_ids}::uuid[])
            AND deleted_at IS NULL
            AND ${bulkScope}
          RETURNING id, display_name
        `;

        for (const r of updated) {
          await tx`
            INSERT INTO record_events (
              org_id, record_id, module_id, type, actor_id, actor_type, changes, payload
            ) VALUES (
              ${orgId}, ${r.id}, ${mod.id}, 'updated', ${currentUser.id}, 'user',
              ${this.jsonb({ owner_id: { to: ownerId } })}::text::jsonb,
              ${this.jsonb({ bulk_action: 'assign' })}::text::jsonb
            )
          `;
        }

        await tx`
          INSERT INTO outbox_events (
            org_id, event_type, aggregate_id, payload, available_at
          ) VALUES (
            ${orgId}, 'record.bulk_assigned', ${mod.id},
            ${this.jsonb({ moduleKey, record_ids: updated.map((r: any) => r.id), ownerId, actorId: currentUser.id })}::text::jsonb,
            now()
          )
        `;

        return { success: true, count: updated.length };
      }

      if (action === 'delete') {
        const deleted = await tx`
          UPDATE records
          SET deleted_at = now(), updated_by = ${currentUser.id}
          WHERE org_id = ${orgId}
            AND module_id = ${mod.id}
            AND id = ANY(${record_ids}::uuid[])
            AND deleted_at IS NULL
            AND ${bulkScope}
          RETURNING id, display_name
        `;

        for (const r of deleted) {
          await tx`
            INSERT INTO record_events (
              org_id, record_id, module_id, type, actor_id, actor_type, payload
            ) VALUES (
              ${orgId}, ${r.id}, ${mod.id}, 'deleted', ${currentUser.id}, 'user',
              ${this.jsonb({ display_name: r.display_name, bulk_action: 'delete' })}::text::jsonb
            )
          `;
        }

        await tx`
          INSERT INTO outbox_events (
            org_id, event_type, aggregate_id, payload, available_at
          ) VALUES (
            ${orgId}, 'record.bulk_deleted', ${mod.id},
            ${this.jsonb({ moduleKey, record_ids: deleted.map((r: any) => r.id), actorId: currentUser.id })}::text::jsonb,
            now()
          )
        `;

        return { success: true, count: deleted.length };
      }

      if (action === 'update') {
        const compiled = await this.schemaCompiler.compile(mod.id);

        // This branch used to merge the client's raw JSON straight into the
        // column (`data || $1::jsonb`), bypassing normalize() and valueSchema
        // entirely. That is how an unparseable value got into a typed field and
        // took out every list view that sorted or filtered it. Bulk edits now
        // go through exactly the same validation as a single PATCH.
        const { data: validatedPatch, touched } = this.validateData(
          compiled,
          asDataObject(data.data),
          'update',
          {},
        );

        const refs = await this.resolveReferences(
          orgId,
          mod.id,
          compiled,
          {
            stageId: data.stage_id === undefined ? undefined : (data.stage_id as string | null),
            pipelineId:
              data.pipeline_id === undefined ? undefined : (data.pipeline_id as string | null),
          },
          validatedPatch,
        );

        const rows = await tx`
          SELECT id, display_name, data, stage_id, pipeline_id, stage_since
          FROM records
          WHERE org_id = ${orgId}
            AND module_id = ${mod.id}
            AND id = ANY(${record_ids}::uuid[])
            AND deleted_at IS NULL
            AND ${bulkScope}
          ORDER BY id
          FOR UPDATE
        `;

        const stageSupplied = data.stage_id !== undefined;

        for (const row of rows) {
          const merged = { ...((row.data as Record<string, unknown>) || {}) };
          for (const key of touched) {
            if (validatedPatch[key] === undefined) delete merged[key];
            else merged[key] = validatedPatch[key];
          }

          const changes: Record<string, { from: unknown; to: unknown }> = {};
          for (const key of touched) {
            const from = (row.data as Record<string, unknown>)?.[key] ?? null;
            const to = merged[key] ?? null;
            if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
          }

          const nextStageId = stageSupplied ? refs.stageId : row.stage_id;
          const stageChanged = nextStageId !== row.stage_id;
          if (stageChanged) changes.stage_id = { from: row.stage_id, to: nextStageId };

          if (Object.keys(changes).length === 0) continue;

          await tx`
            UPDATE records
            SET
              stage_id = ${nextStageId},
              pipeline_id = ${stageSupplied ? refs.pipelineId : row.pipeline_id},
              stage_since = ${stageChanged ? new Date().toISOString() : row.stage_since},
              data = ${this.jsonb(merged)}::text::jsonb,
              search_tsv = ${this.buildSearchText(compiled, row.display_name, merged)},
              updated_by = ${currentUser.id},
              updated_at = now()
            WHERE id = ${row.id}
          `;

          await this.syncRecordLinks(tx, orgId, row.id, compiled, merged);

          await tx`
            INSERT INTO record_events (
              org_id, record_id, module_id, type, actor_id, actor_type, changes, payload
            ) VALUES (
              ${orgId}, ${row.id}, ${mod.id}, ${stageChanged ? 'stage_changed' : 'updated'},
              ${currentUser.id}, 'user',
              ${this.jsonb(changes)}::text::jsonb,
              ${this.jsonb({ bulk_action: 'update' })}::text::jsonb
            )
          `;

          // One event per record, keyed to the record — an automation cannot act
          // on an event whose aggregate is a module.
          await tx`
            INSERT INTO outbox_events (org_id, event_type, aggregate_id, payload, available_at)
            VALUES (
              ${orgId},
              ${stageChanged ? 'record.stage_changed' : 'record.updated'},
              ${row.id},
              ${this.jsonb({
                moduleKey,
                recordId: row.id,
                changes,
                actorId: currentUser.id,
                displayName: row.display_name,
                snapshot: {
                  display_name: row.display_name,
                  data: merged,
                  stage_id: nextStageId,
                },
                causationChain: [],
              })}::text::jsonb,
              now()
            )
          `;
        }

        return { success: true, count: rows.length };
      }

      throw new ValidationError(`Unknown bulk action: ${action}`);
    });
  }

  async exportCsv(
    orgId: string,
    moduleKey: string,
    query: RecordListQuery,
    currentUser: CurrentUserPayload
  ): Promise<string> {
    const permissions = this.authorise(currentUser, moduleKey, 'read', `export ${moduleKey} records`);
    assertAdmin(permissions, 'export', 'export records');
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const hidden = unreadableFields(permissions, moduleKey);

    // Pages through the same keyset-paginated list the UI uses, so export never
    // depends on a single oversized query.
    const listRecords: any[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.list(
        orgId,
        moduleKey,
        { ...query, limit: 500, cursor },
        currentUser,
      );
      listRecords.push(...page.records);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && listRecords.length < EXPORT_ROW_LIMIT);

    const exportFields = compiled.fields.filter(
      (f) => (!f.isSystem || f.key === 'display_name' || f.key === 'created_at') && !hidden.has(f.key),
    );
    const headers = [mod.nameFieldLabel || 'Name', ...exportFields.filter(f => f.key !== 'display_name').map((f) => f.label)];

    const rows: string[][] = [headers];

    for (const r of listRecords) {
      const row: string[] = [r.display_name];
      for (const f of exportFields) {
        if (f.key === 'display_name') continue;
        let rawVal = f.key === 'created_at' ? r.createdAt : r.data?.[f.key];
        let strVal = '';
        if (rawVal !== undefined && rawVal !== null) {
          const typeDef = getFieldType(f.type);
          strVal = typeDef.toExportString(rawVal, f.config);
        }
        row.push(strVal);
      }
      rows.push(row);
    }

    return stringifyCsv(rows);
  }

  async importCsv(
    orgId: string,
    moduleKey: string,
    csvContent: string,
    mappings: Record<string, string> = {},
    currentUser: CurrentUserPayload
  ) {
    const permissions = this.authorise(currentUser, moduleKey, 'create', `import ${moduleKey} records`);
    assertAdmin(permissions, 'import', 'import records');
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const parsed = parseCsv(csvContent);
    if (parsed.length < 2) {
      throw new ValidationError('CSV must contain a header row and at least one data row');
    }

    const headers = parsed[0].map((h) => h.trim());
    const dataRows = parsed.slice(1);

    const colToField = new Map<number, { key: string; isDisplayName: boolean; fieldDef?: CompiledField }>();

    for (let c = 0; c < headers.length; c++) {
      const headerName = headers[c];
      const explicitMapping = mappings[headerName] || mappings[headerName.toLowerCase()];
      if (explicitMapping) {
        if (explicitMapping === 'display_name' || explicitMapping === (mod.nameFieldLabel || 'Name')) {
          colToField.set(c, { key: 'display_name', isDisplayName: true });
        } else {
          const field = compiled.fieldsByKey.get(explicitMapping);
          if (field) {
            colToField.set(c, { key: field.key, isDisplayName: false, fieldDef: field });
          }
        }
        continue;
      }

      const lower = headerName.toLowerCase().replace(/[\s_-]+/g, '');
      const nameMatch = (mod.nameFieldLabel || 'Name').toLowerCase().replace(/[\s_-]+/g, '');

      if (lower === 'name' || lower === 'displayname' || lower === nameMatch || lower === 'leadname' || lower === 'title') {
        colToField.set(c, { key: 'display_name', isDisplayName: true });
        continue;
      }

      const matchedField = compiled.fields.find(
        (f) =>
          f.key.toLowerCase().replace(/[\s_-]+/g, '') === lower ||
          f.label.toLowerCase().replace(/[\s_-]+/g, '') === lower
      );

      if (matchedField) {
        colToField.set(c, { key: matchedField.key, isDisplayName: false, fieldDef: matchedField });
      }
    }

    const defaultPipeline = await this.sql`
      SELECT id FROM pipelines WHERE module_id = ${mod.id} AND org_id = ${orgId} AND deleted_at IS NULL ORDER BY is_default DESC, position ASC LIMIT 1
    `;
    let defaultStageId: string | null = null;
    let defaultPipelineId: string | null = null;
    if (defaultPipeline.length > 0) {
      defaultPipelineId = defaultPipeline[0].id;
      const [firstStage] = await this.sql`
        SELECT id FROM pipeline_stages WHERE pipeline_id = ${defaultPipelineId} AND org_id = ${orgId} AND deleted_at IS NULL ORDER BY position ASC LIMIT 1
      `;
      if (firstStage) defaultStageId = firstStage.id;
    }

    let importedCount = 0;
    const errors: Array<{ row: number; error: string }> = [];

    const CHUNK_SIZE = 500;
    for (let i = 0; i < dataRows.length; i += CHUNK_SIZE) {
      const chunk = dataRows.slice(i, i + CHUNK_SIZE);
      await this.sql.begin(async (tx) => {
        for (let j = 0; j < chunk.length; j++) {
          const rowIndex = i + j + 2;
          const row = chunk[j];

          let displayName = '';
          const rowData: Record<string, unknown> = {};
          const rowErrors: string[] = [];

          for (let colIdx = 0; colIdx < row.length; colIdx++) {
            const mapping = colToField.get(colIdx);
            if (!mapping) continue;

            // A row can be shorter than the header, so the cell may be absent.
            const rawCell = row[colIdx] ?? '';
            if (mapping.isDisplayName) {
              displayName = typeof rawCell === 'string' ? rawCell.trim() : '';
            } else if (mapping.fieldDef) {
              const field = mapping.fieldDef;
              let parsedVal: unknown = null;
              try {
                parsedVal = getFieldType(field.type).parseImport(rawCell, field.config as never);
              } catch {
                parsedVal = null;
              }

              const cellWasBlank = String(rawCell).trim() === '';
              if (parsedVal === null || parsedVal === undefined) {
                // A blank cell is simply absent; a non-blank cell that could not
                // be parsed is reported instead of silently dropped.
                if (!cellWasBlank) {
                  rowErrors.push(`"${field.label}": "${String(rawCell).slice(0, 40)}" is not a valid ${field.type}`);
                } else if (field.isRequired) {
                  rowErrors.push(`"${field.label}" is required`);
                }
                continue;
              }

              const parsedSchema = getFieldType(field.type)
                .valueSchema(field.config as never)
                .safeParse(parsedVal);
              if (!parsedSchema.success) {
                rowErrors.push(
                  `"${field.label}": ${parsedSchema.error.issues[0]?.message ?? 'is invalid'}`,
                );
                continue;
              }
              rowData[field.key] = parsedSchema.data;
            }
          }

          for (const field of compiled.fields) {
            if (field.isRequired && rowData[field.key] === undefined) {
              rowErrors.push(`"${field.label}" is required`);
            }
          }

          if (!displayName) {
            displayName = `Imported ${mod.labelSingular} #${rowIndex}`;
          }

          // The row is skipped and reported; one bad row no longer aborts the
          // chunk's transaction and loses the other 499 rows with it.
          if (rowErrors.length > 0) {
            errors.push({ row: rowIndex, error: rowErrors.join('; ') });
            continue;
          }

          await this.allocateAutoNumbers(tx, orgId, mod.id, compiled, rowData);
          const searchTsv = this.buildSearchText(compiled, displayName, rowData);

          const [inserted] = await tx`
            INSERT INTO records (
              org_id,
              module_id,
              display_name,
              pipeline_id,
              stage_id,
              stage_since,
              data,
              search_tsv,
              created_by,
              updated_by
            ) VALUES (
              ${orgId},
              ${mod.id},
              ${displayName},
              ${defaultPipelineId},
              ${defaultStageId},
              ${defaultStageId ? new Date().toISOString() : null},
              ${this.jsonb(rowData)}::text::jsonb,
              ${searchTsv},
              ${currentUser.id},
              ${currentUser.id}
            )
            RETURNING id
          `;

          await this.syncRecordLinks(tx, orgId, inserted.id, compiled, rowData);

          await tx`
            INSERT INTO record_events (
              org_id, record_id, module_id, type, actor_id, actor_type, payload
            ) VALUES (
              ${orgId}, ${inserted.id}, ${mod.id}, 'imported', ${currentUser.id}, 'user',
              ${this.jsonb({ row: rowIndex })}::text::jsonb
            )
          `;

          // One record.created per row, keyed to the record, so an automation
          // sees an imported lead exactly as it sees one created in the UI.
          await tx`
            INSERT INTO outbox_events (org_id, event_type, aggregate_id, payload, available_at)
            VALUES (
              ${orgId}, 'record.created', ${inserted.id},
              ${this.jsonb({
                moduleKey,
                recordId: inserted.id,
                displayName,
                actorId: currentUser.id,
                source: 'csv_import',
                snapshot: { display_name: displayName, data: rowData },
                causationChain: [],
              })}::text::jsonb,
              now()
            )
          `;

          importedCount++;
        }

      });
    }

    return {
      totalRows: dataRows.length,
      importedCount,
      failedCount: errors.length,
      errors,
    };
  }

  /**
   * Resolves a sort key through compiled metadata, which is the only thing
   * allowed to decide a column expression (Plan Section 8 rule 4).
   */
  private resolveSort(
    compiled: CompiledModule,
    key: string,
  ): { sql: string; type: string; isCore: boolean } {
    const core = compiled.sqlColumns.get(key);
    const field = compiled.fieldsByKey.get(key);

    if (field) {
      if (!field.isSortable) {
        throw new ValidationError(`Field "${key}" cannot be sorted`, [
          { field: 'sort', message: `"${field.label}" cannot be sorted` },
        ]);
      }
      return { sql: field.sqlExpr.sql, type: field.sqlExpr.type, isCore: false };
    }

    if (core) {
      return { sql: core.sql, type: core.type, isCore: true };
    }

    throw new ValidationError(`Field "${key}" cannot be sorted`, [
      { field: 'sort', message: `"${key}" is not a sortable field` },
    ]);
  }

  async list(
    orgId: string,
    moduleKey: string,
    query: RecordListQuery,
    currentUser: CurrentUserPayload
  ) {
    const permissions = this.authorise(currentUser, moduleKey, 'read', `view ${moduleKey} records`);
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const limit = asInt(query.limit, { min: 1, max: 200, fallback: 50 });
    const params: unknown[] = [orgId, mod.id];
    const whereConditions: string[] = [
      'r.org_id = $1',
      'r.module_id = $2',
      'r.deleted_at IS NULL',
    ];

    // The record scope is part of the predicate, not a post-fetch filter.
    const scope = compileScope(
      scopeFor(permissions, moduleKey, 'read'),
      currentUser.id,
      params.length + 1,
    );
    whereConditions.push(scope.sql);
    params.push(...scope.params);

    const parsedFilter = parseJsonParam(query.filter, 'filter');
    if (parsedFilter !== undefined) {
      const filterCompiler = new FilterCompiler(compiled, currentUser.id, params.length + 1);
      const compiledFilter = filterCompiler.compile(parsedFilter);
      whereConditions.push(compiledFilter.sql);
      params.push(...compiledFilter.params);
    }

    const q = asTrimmedString(query.q, 'q');
    if (q) {
      const search = SearchCompiler.compile(q, params.length + 1);
      whereConditions.push(search.sql);
      params.push(...search.params);
    }

    const { key: sortFieldKey, dir } = parseSort(query.sort);
    const sort = this.resolveSort(compiled, sortFieldKey);
    const sortSql = sort.sql;

    const cursorRaw = asTrimmedString(query.cursor, 'cursor');
    if (cursorRaw) {
      const decoded = decodeCursor(cursorRaw);
      // A cursor is server-minted and opaque. One that does not decode, or that
      // was minted against a different sort key, is rejected rather than bound
      // into a row comparison where Postgres raises 22P02 for the whole query.
      if (!decoded) {
        throw new ValidationError('The pagination cursor is not valid', [
          { field: 'cursor', message: 'Invalid cursor' },
        ]);
      }
      if (decoded.k !== undefined && decoded.k !== sortFieldKey) {
        throw new ValidationError(
          'The pagination cursor belongs to a different sort order; restart from the first page',
          [{ field: 'cursor', message: 'Cursor does not match the current sort' }],
        );
      }
      if (!isUuid(decoded.id)) {
        throw new ValidationError('The pagination cursor is not valid', [
          { field: 'cursor', message: 'Invalid cursor' },
        ]);
      }

      // The cursor value is cast to the sort expression's own type, so a value
      // of the wrong shape cannot raise mid-query.
      const cast = CURSOR_CASTS[sort.type] ?? '::text';
      const comparison = dir === 'desc' ? '<' : '>';
      const cursorValueIsNull = decoded.c === null || decoded.c === undefined;

      // A plain row comparison `(expr, id) < ($c, $id)` evaluates to NULL for
      // every row whose sort value is NULL, so those rows were silently
      // dropped from every page after the first — records that exist and are
      // never shown. With `NULLS LAST` the null block sits after all non-null
      // values, so the predicate has to say that explicitly.
      if (cursorValueIsNull) {
        const idPlaceholder = `$${params.length + 1}`;
        params.push(decoded.id);
        // We are already inside the null block; only the id tiebreaker applies.
        whereConditions.push(`(${sortSql} IS NULL AND r.id ${comparison} ${idPlaceholder}::uuid)`);
      } else {
        const cPlaceholder = `$${params.length + 1}`;
        const idPlaceholder = `$${params.length + 2}`;
        params.push(decoded.c, decoded.id);
        whereConditions.push(
          `(${sortSql} IS NULL` +
            ` OR ${sortSql} ${comparison} ${cPlaceholder}${cast}` +
            ` OR (${sortSql} = ${cPlaceholder}${cast} AND r.id ${comparison} ${idPlaceholder}::uuid))`,
        );
      }
    }

    const limitPlaceholder = `$${params.length + 1}`;
    params.push(limit + 1);

    // ?fields= lets a list view ask for the columns its config actually shows
    // instead of a whole 40-key data blob (Plan Section 14, "Select what is
    // needed"). Keys are resolved through compiled metadata, never interpolated.
    const requestedFields = parseFieldList(query.fields);
    const projection = this.buildProjection(compiled, requestedFields);

    const querySql = `
      SELECT ${projection}
      FROM records r
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY ${sortSql} ${dir} NULLS LAST, r.id ${dir}
      LIMIT ${limitPlaceholder}
    `;

    const rows = await this.sql.unsafe(querySql, params as never[]);

    const hasMore = rows.length > limit;
    const records = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && records.length > 0) {
      const last = records[records.length - 1];
      let sortVal: unknown;
      if (sort.isCore) {
        // core columns come back as real columns on the row
        sortVal = (last as Record<string, unknown>)[sortFieldKey] ?? null;
      } else {
        const dataObj = (last.data as Record<string, unknown>) || {};
        sortVal = dataObj[sortFieldKey] ?? null;
      }
      nextCursor = encodeCursor({ c: sortVal, id: last.id, k: sortFieldKey });
    }

    const expandedRecords = await this.expandLookups(orgId, compiled, records);

    return {
      records: this.stripUnreadable(currentUser, moduleKey, expandedRecords),
      nextCursor,
      hasMore,
      schemaVersion: compiled.schemaVersion,
    };
  }

  /** Builds the SELECT list. Only keys present in compiled metadata are emitted. */
  private buildProjection(compiled: CompiledModule, requested?: string[]): string {
    if (!requested || requested.length === 0) return 'r.*';

    const base = [
      'r.id',
      'r.org_id',
      'r.module_id',
      'r.display_name',
      'r.owner_id',
      'r.pipeline_id',
      'r.stage_id',
      'r.stage_since',
      'r.created_at',
      'r.updated_at',
    ];

    const dataKeys = requested.filter((k) => compiled.fieldsByKey.has(k));
    if (dataKeys.length === 0) return `${base.join(', ')}, '{}'::jsonb AS data`;

    // jsonb_build_object over validated keys; values stay bound as parameters
    // would be unnecessary here because each key already matched a compiled field.
    const pairs = dataKeys.map((k) => `'${k}', r.data->'${k}'`).join(', ');
    return `${base.join(', ')}, jsonb_strip_nulls(jsonb_build_object(${pairs})) AS data`;
  }

  /**
   * Count for list headers and kanban columns.
   *
   * Plan Section 14, "Count cheaply": an exact COUNT(*) over a filtered 200k-row
   * table is too expensive to pay on every page, so above a threshold the
   * planner's estimate is used and the caller is told the number is approximate.
   * It also honours `q`, which it previously ignored — so the header count no
   * longer disagrees with the list the user is looking at.
   */
  async count(
    orgId: string,
    moduleKey: string,
    filterJson?: string,
    currentUser?: CurrentUserPayload,
    q?: string,
  ): Promise<{ count: number; approximate: boolean }> {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const params: unknown[] = [orgId, mod.id];
    const whereConditions: string[] = [
      'r.org_id = $1',
      'r.module_id = $2',
      'r.deleted_at IS NULL',
    ];

    if (currentUser) {
      const permissions = this.authorise(currentUser, moduleKey, 'read', `count ${moduleKey} records`);
      const scope = compileScope(
        scopeFor(permissions, moduleKey, 'read'),
        currentUser.id,
        params.length + 1,
      );
      whereConditions.push(scope.sql);
      params.push(...scope.params);
    }

    const parsedFilter = parseJsonParam(filterJson, 'filter');
    if (parsedFilter !== undefined) {
      const filterCompiler = new FilterCompiler(compiled, currentUser?.id, params.length + 1);
      const compiledFilter = filterCompiler.compile(parsedFilter);
      whereConditions.push(compiledFilter.sql);
      params.push(...compiledFilter.params);
    }

    const search = asTrimmedString(q, 'q');
    if (search) {
      const compiledSearch = SearchCompiler.compile(search, params.length + 1);
      whereConditions.push(compiledSearch.sql);
      params.push(...compiledSearch.params);
    }

    const where = whereConditions.join(' AND ');

    const estimate = await this.estimateCount(where, params);
    if (estimate !== null && estimate > EXACT_COUNT_LIMIT) {
      return { count: estimate, approximate: true };
    }

    // Stop counting once past the limit instead of scanning the whole table.
    const [result] = await this.sql.unsafe(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT 1 FROM records r WHERE ${where} LIMIT ${EXACT_COUNT_LIMIT + 1}
       ) capped`,
      params as never[],
    );

    const exact = result ? Number(result.count) : 0;
    return exact > EXACT_COUNT_LIMIT
      ? { count: EXACT_COUNT_LIMIT, approximate: true }
      : { count: exact, approximate: false };
  }

  /** Reads the planner's row estimate for the same predicate. Null if unavailable. */
  private async estimateCount(where: string, params: unknown[]): Promise<number | null> {
    try {
      const rows = await this.sql.unsafe(
        `EXPLAIN (FORMAT JSON) SELECT 1 FROM records r WHERE ${where}`,
        params as never[],
      );
      const plan = (rows?.[0] as Record<string, unknown>)?.['QUERY PLAN'];
      const parsed = typeof plan === 'string' ? JSON.parse(plan) : plan;
      const rowCount = parsed?.[0]?.Plan?.['Plan Rows'];
      return typeof rowCount === 'number' ? Math.round(rowCount) : null;
    } catch {
      return null;
    }
  }

  private async expandLookups(
    orgId: string,
    compiled: CompiledModule,
    records: any[]
  ): Promise<any[]> {
    if (records.length === 0) return [];

    const ownerIds = new Set<string>();
    const lookupIds = new Set<string>();

    for (const r of records) {
      if (isUuid(r.owner_id)) ownerIds.add(r.owner_id);
      const d = (r.data as Record<string, unknown>) || {};
      for (const f of compiled.fields) {
        if (f.type === 'lookup' && isUuid(d[f.key])) {
          lookupIds.add(d[f.key] as string);
        }
      }
    }

    const userMap = new Map<string, { id: string; fullName: string; email: string }>();
    if (ownerIds.size > 0) {
      const userRows = await this.sql`
        SELECT id, full_name, email
        FROM users
        WHERE id = ANY(${Array.from(ownerIds)}::uuid[])
          AND org_id = ${orgId}
      `;
      for (const u of userRows) {
        userMap.set(u.id, { id: u.id, fullName: u.full_name, email: u.email });
      }
    }

    const lookupMap = new Map<string, { id: string; displayName: string }>();
    if (lookupIds.size > 0) {
      const recordRows = await this.sql`
        SELECT id, display_name
        FROM records
        WHERE id = ANY(${Array.from(lookupIds)}::uuid[])
          AND org_id = ${orgId}
          AND deleted_at IS NULL
      `;
      for (const lr of recordRows) {
        lookupMap.set(lr.id, { id: lr.id, displayName: lr.display_name });
      }
    }

    return records.map((r) => {
      const expanded = { ...r };
      if (r.owner_id && userMap.has(r.owner_id)) {
        expanded.owner = userMap.get(r.owner_id);
      }
      const d = (r.data as Record<string, unknown>) || {};
      const expandedLookups: Record<string, unknown> = {};
      for (const f of compiled.fields) {
        if (f.type === 'lookup' && d[f.key] && lookupMap.has(d[f.key] as string)) {
          expandedLookups[f.key] = lookupMap.get(d[f.key] as string);
        }
      }
      if (Object.keys(expandedLookups).length > 0) {
        expanded._expanded = expandedLookups;
      }
      return expanded;
    });
  }
}
