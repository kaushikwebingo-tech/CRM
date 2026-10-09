import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../db/connection';
import { modules, fields, pipelines, pipelineStages } from '../db/schema';
import { eq, and, isNull, inArray, asc } from 'drizzle-orm';
import { z, ZodObject } from 'zod';
import { FilterOperator, SqlCastType } from '../field-types/types';
import { getFieldType } from '../field-types/registry';
import { ValidationError, NotFoundError } from '../common/errors';
import {
  Permissions,
  scopeFor,
  unreadableFields,
  serialisePermissions,
} from '../auth/permissions';
import { createHash } from 'crypto';

export interface CompiledField {
  key: string;
  label: string;
  type: string;
  config: unknown;
  isRequired: boolean;
  isUnique: boolean;
  isSystem: boolean;
  isIndexed: boolean;
  isSearchable: boolean;
  defaultValue: unknown;
  helpText: string | null;
  section: string;
  position: number;
  sqlExpr: SqlExpr;
  operators: FilterOperator[];
  isSortable: boolean;
}

export interface SqlExpr {
  sql: string;
  type: SqlCastType;
  nullable: boolean;
}

/** A field key is immutable, snake_case, and the only thing ever interpolated into SQL. */
export const FIELD_KEY_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** Core columns of `records`. A dynamic field may never shadow one of these. */
export const CORE_COLUMN_KEYS = new Set([
  'id',
  'org_id',
  'module_id',
  'display_name',
  'owner_id',
  'pipeline_id',
  'stage_id',
  'stage_since',
  'data',
  'search_tsv',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
  'deleted_at',
]);

/**
 * The single place in the codebase allowed to produce a column expression for a
 * dynamic field (Plan Section 6, "How a field becomes SQL").
 *
 * Lossy casts go through the crm_try_* helpers from migration 0004 so that one
 * unparseable value cannot fail the query for every row. See that migration for
 * why a bare `::numeric` is not safe here.
 */
export function compileFieldSql(key: string, type: string): SqlExpr {
  const text = `(r.data->>'${key}')`;

  switch (type) {
    case 'text':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'url':
    case 'select':
      return { sql: text, type: 'text', nullable: true };

    case 'number':
    case 'currency':
    case 'percent':
    case 'auto_number':
      return { sql: `crm_try_numeric${text}`, type: 'numeric', nullable: true };

    case 'boolean':
      return { sql: `crm_try_boolean${text}`, type: 'boolean', nullable: true };

    // A date is calendar-only, so it must not acquire a timezone: casting
    // '2026-10-09' to timestamptz anchors it to midnight in the server's zone,
    // which is a different day for an IST team on a UTC box.
    case 'date':
      return { sql: `crm_try_date${text}`, type: 'date', nullable: true };

    case 'datetime':
      return { sql: `crm_try_timestamptz${text}`, type: 'timestamptz', nullable: true };

    case 'user':
    case 'lookup':
      return { sql: `crm_try_uuid${text}`, type: 'uuid', nullable: true };

    // multi_select, tags, file — compared with jsonb containment operators.
    default:
      return { sql: `(r.data->'${key}')`, type: 'jsonb', nullable: true };
  }
}

export interface CompiledModule {
  id: string;
  key: string;
  schemaVersion: number;
  labels: { singular: string; plural: string };
  hasPipeline: boolean;
  nameFieldLabel: string;
  icon: string | null;
  color: string | null;
  fields: CompiledField[];
  fieldsByKey: Map<string, CompiledField>;
  createSchema: ZodObject<any>;
  updateSchema: ZodObject<any>;
  sqlColumns: Map<string, SqlExpr>;
  searchableKeys: string[];
  uniqueKeys: string[];
  defaults: Record<string, unknown>;
}

@Injectable()
export class SchemaCompiler {
  private cache = new Map<string, CompiledModule>();

  constructor(@Inject(DATABASE) private readonly db: any) {}

  async compile(moduleId: string): Promise<CompiledModule> {
    const [mod] = await this.db.select().from(modules).where(eq(modules.id, moduleId)).limit(1);
    if (!mod) throw new NotFoundError('Module not found');
    const cacheKey = `${moduleId}:${mod.schemaVersion}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const modFields = await this.db
      .select()
      .from(fields)
      .where(and(eq(fields.moduleId, moduleId), isNull(fields.deletedAt)))
      .orderBy(asc(fields.position), asc(fields.createdAt));
    
    const compiledFields: CompiledField[] = [];
    const fieldsByKey = new Map<string, CompiledField>();
    const sqlColumns = new Map<string, SqlExpr>();
    const searchableKeys: string[] = [];
    const uniqueKeys: string[] = [];
    const defaults: Record<string, unknown> = {};

    sqlColumns.set('display_name', { sql: 'r.display_name', type: 'text', nullable: false });
    sqlColumns.set('owner_id', { sql: 'r.owner_id', type: 'uuid', nullable: true });
    sqlColumns.set('stage_id', { sql: 'r.stage_id', type: 'uuid', nullable: true });
    sqlColumns.set('pipeline_id', { sql: 'r.pipeline_id', type: 'uuid', nullable: true });
    sqlColumns.set('stage_since', { sql: 'r.stage_since', type: 'timestamptz', nullable: true });
    sqlColumns.set('created_at', { sql: 'r.created_at', type: 'timestamptz', nullable: false });
    sqlColumns.set('updated_at', { sql: 'r.updated_at', type: 'timestamptz', nullable: false });

    const createShape: Record<string, any> = {};
    const updateShape: Record<string, any> = {};

    for (const f of modFields) {
      const def = getFieldType(f.type);

      // Defence in depth. FieldsService already enforces this shape on create,
      // but this map is the only place in the codebase that interpolates an
      // identifier into SQL, so it refuses anything it did not prove itself.
      if (!FIELD_KEY_PATTERN.test(f.key)) {
        throw new ValidationError(
          `Field key "${f.key}" on module "${mod.key}" is not a valid identifier and cannot be compiled`,
        );
      }
      if (CORE_COLUMN_KEYS.has(f.key)) {
        throw new ValidationError(
          `Field key "${f.key}" on module "${mod.key}" collides with a core record column`,
        );
      }

      const sqlExpr = compileFieldSql(f.key, f.type);

      const compiled: CompiledField = {
        key: f.key,
        label: f.label,
        type: f.type,
        config: f.config,
        isRequired: f.isRequired,
        isUnique: f.isUnique,
        isSystem: f.isSystem,
        isIndexed: f.isIndexed,
        isSearchable: f.isSearchable,
        defaultValue: f.defaultValue,
        helpText: f.helpText,
        section: f.section,
        position: f.position,
        sqlExpr,
        operators: def.operators,
        isSortable: def.isSortable,
      };

      compiledFields.push(compiled);
      fieldsByKey.set(f.key, compiled);
      sqlColumns.set(f.key, sqlExpr);

      if (f.isSearchable) searchableKeys.push(f.key);
      if (f.isUnique) uniqueKeys.push(f.key);
      if (f.defaultValue !== null && f.defaultValue !== undefined) {
        defaults[f.key] = f.defaultValue;
      }

      if (!f.isSystem) {
        let vSchema = def.valueSchema(f.config as any);
        if (!f.isRequired) vSchema = vSchema.optional().nullable();
        createShape[f.key] = vSchema;
        updateShape[f.key] = vSchema.optional().nullable();
      }
    }

    const createSchema = z.object({
      displayName: z.string().min(1),
      data: z.object(createShape),
    });

    const updateSchema = z.object({
      displayName: z.string().min(1).optional(),
      data: z.object(updateShape).optional(),
    });

    const compiledModule: CompiledModule = {
      id: mod.id,
      key: mod.key,
      schemaVersion: mod.schemaVersion,
      labels: { singular: mod.labelSingular, plural: mod.labelPlural },
      hasPipeline: mod.hasPipeline,
      nameFieldLabel: mod.nameFieldLabel,
      icon: mod.icon,
      color: mod.color,
      fields: compiledFields,
      fieldsByKey,
      createSchema,
      updateSchema,
      sqlColumns,
      searchableKeys,
      uniqueKeys,
      defaults,
    };

    this.cache.set(cacheKey, compiledModule);
    return compiledModule;
  }

  async compileAll(orgId: string): Promise<CompiledModule[]> {
    const mods = await this.db.select().from(modules).where(and(eq(modules.orgId, orgId), isNull(modules.deletedAt)));
    return Promise.all(mods.map((m: any) => this.compile(m.id)));
  }

  invalidate(moduleId: string) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${moduleId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * The one request that makes a fully dynamic UI feel instant (Plan Section 6).
   *
   * It is per-user, not per-org: Section 13 requires the bundle to omit fields
   * the role cannot read, and to carry the role's permission map so the UI can
   * hide actions it is not allowed to take. The ETag therefore covers the role
   * as well as the schema versions.
   */
  async getBundle(orgId: string, permissions?: Permissions) {
    const allModules = await this.db
      .select()
      .from(modules)
      .where(and(eq(modules.orgId, orgId), isNull(modules.deletedAt)))
      .orderBy(asc(modules.position));
    const moduleIds = allModules.map((m: any) => m.id);

    if (moduleIds.length === 0) {
      return {
        modules: [],
        schemaVersion: 0,
        permissions: permissions ? serialisePermissions(permissions) : null,
      };
    }

    const [allFields, allPipelines] = await Promise.all([
      this.db
        .select()
        .from(fields)
        .where(and(inArray(fields.moduleId, moduleIds), isNull(fields.deletedAt)))
        .orderBy(asc(fields.position)),
      this.db
        .select()
        .from(pipelines)
        .where(and(inArray(pipelines.moduleId, moduleIds), isNull(pipelines.deletedAt)))
        .orderBy(asc(pipelines.position)),
    ]);

    const pipelineIds = allPipelines.map((p: any) => p.id);
    const allStages =
      pipelineIds.length > 0
        ? await this.db
            .select()
            .from(pipelineStages)
            .where(and(inArray(pipelineStages.pipelineId, pipelineIds), isNull(pipelineStages.deletedAt)))
            .orderBy(asc(pipelineStages.position))
        : [];

    const visibleModules = allModules.filter((m: any) =>
      permissions ? scopeFor(permissions, m.key, 'read') !== 'none' : true,
    );

    const enrichedModules = visibleModules.map((m: any) => {
      const hidden = permissions ? unreadableFields(permissions, m.key) : new Set<string>();

      const moduleFields = allFields
        .filter((f: any) => f.moduleId === m.id && !hidden.has(f.key))
        .map((f: any) => {
          // The frontend registry is keyed by the component names the field
          // type declares, so the bundle has to carry them (Plan Section 5).
          let typeMeta: Record<string, unknown> = {};
          try {
            const def = getFieldType(f.type);
            typeMeta = {
              formComponent: def.formComponent,
              cellComponent: def.cellComponent,
              filterComponent: def.filterComponent,
              operators: def.operators,
              isSortable: def.isSortable,
              canBeIndexed: def.canBeIndexed,
              canBeUnique: def.canBeUnique,
            };
          } catch {
            // An unknown type must not take out the whole bundle.
            typeMeta = { operators: [], isSortable: false };
          }
          return { ...f, ...typeMeta };
        });

      const modulePipelines = allPipelines
        .filter((p: any) => p.moduleId === m.id)
        .map((p: any) => ({
          ...p,
          stages: allStages.filter((s: any) => s.pipelineId === p.id),
        }));

      return { ...m, fields: moduleFields, pipelines: modulePipelines };
    });

    return {
      modules: enrichedModules,
      schemaVersion: this.bundleVersion(allModules),
      permissions: permissions ? serialisePermissions(permissions) : null,
    };
  }

  /**
   * A cheap, collision-free version for the ETag.
   *
   * The plan suggested summing each module's schema_version, but a sum collides
   * (A:2+B:1 and A:1+B:2 are both 3), so a schema change could serve a stale
   * 304. This hashes the ordered (id, version) pairs instead.
   */
  bundleVersion(allModules: { id: string; schemaVersion?: number }[]): string {
    const pairs = allModules
      .map((m) => `${m.id}:${m.schemaVersion ?? 1}`)
      .sort()
      .join('|');
    return createHash('sha1').update(pairs).digest('hex').slice(0, 16);
  }

  /** Reads just enough to compute the ETag, without assembling the bundle. */
  async bundleEtagSource(orgId: string): Promise<string> {
    const rows = await this.db
      .select({ id: modules.id, schemaVersion: modules.schemaVersion })
      .from(modules)
      .where(and(eq(modules.orgId, orgId), isNull(modules.deletedAt)));
    return this.bundleVersion(rows);
  }
}
