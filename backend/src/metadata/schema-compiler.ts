import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../db/connection';
import { modules, fields, pipelines, pipelineStages } from '../db/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { z, ZodObject } from 'zod';
import { FilterOperator, SqlCastType } from '../field-types/types';
import { getFieldType } from '../field-types/registry';

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
    if (!mod) throw new Error('Module not found');
    const cacheKey = `${moduleId}:${mod.schemaVersion}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const modFields = await this.db.select().from(fields).where(and(eq(fields.moduleId, moduleId), isNull(fields.deletedAt)));
    
    const compiledFields: CompiledField[] = [];
    const fieldsByKey = new Map<string, CompiledField>();
    const sqlColumns = new Map<string, SqlExpr>();
    const searchableKeys: string[] = [];
    const uniqueKeys: string[] = [];
    const defaults: Record<string, unknown> = {};

    sqlColumns.set('display_name', { sql: 'r.display_name', type: 'text', nullable: false });
    sqlColumns.set('owner_id', { sql: 'r.owner_id', type: 'uuid', nullable: true });
    sqlColumns.set('stage_id', { sql: 'r.stage_id', type: 'uuid', nullable: true });
    sqlColumns.set('created_at', { sql: 'r.created_at', type: 'timestamptz', nullable: false });
    sqlColumns.set('updated_at', { sql: 'r.updated_at', type: 'timestamptz', nullable: false });

    const createShape: Record<string, any> = {};
    const updateShape: Record<string, any> = {};

    for (const f of modFields) {
      const def = getFieldType(f.type);
      let sqlExpr: SqlExpr;
      
      if (['text', 'long_text', 'email', 'phone', 'url', 'select'].includes(f.type)) {
        sqlExpr = { sql: `(r.data->>'${f.key}')`, type: 'text', nullable: true };
      } else if (['number', 'currency', 'percent', 'auto_number'].includes(f.type)) {
        sqlExpr = { sql: `(r.data->>'${f.key}')::numeric`, type: 'numeric', nullable: true };
      } else if (f.type === 'boolean') {
        sqlExpr = { sql: `(r.data->>'${f.key}')::boolean`, type: 'boolean', nullable: true };
      } else if (['date', 'datetime'].includes(f.type)) {
        sqlExpr = { sql: `(r.data->>'${f.key}')::timestamptz`, type: 'timestamptz', nullable: true };
      } else if (['user', 'lookup'].includes(f.type)) {
        sqlExpr = { sql: `(r.data->>'${f.key}')::uuid`, type: 'uuid', nullable: true };
      } else {
        sqlExpr = { sql: `(r.data->'${f.key}')`, type: 'jsonb', nullable: true };
      }

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

  async getBundle(orgId: string) {
    const allModules = await this.db.select().from(modules).where(and(eq(modules.orgId, orgId), isNull(modules.deletedAt)));
    const moduleIds = allModules.map((m: any) => m.id);
    
    if (moduleIds.length === 0) {
      return { modules: [], schemaVersion: 0, fields: [], pipelines: [], stages: [] };
    }

    const allFields = await this.db.select().from(fields).where(and(inArray(fields.moduleId, moduleIds), isNull(fields.deletedAt)));
    const allPipelines = await this.db.select().from(pipelines).where(and(inArray(pipelines.moduleId, moduleIds), isNull(pipelines.deletedAt)));
    const pipelineIds = allPipelines.map((p: any) => p.id);
    const allStages = pipelineIds.length > 0 ? await this.db.select().from(pipelineStages).where(and(inArray(pipelineStages.pipelineId, pipelineIds), isNull(pipelineStages.deletedAt))) : [];

    const aggregateVersion = allModules.reduce((acc: number, m: any) => acc + (m.schemaVersion || 1), 0);

    const enrichedModules = allModules.map((m: any) => {
      const moduleFields = allFields
        .filter((f: any) => f.moduleId === m.id)
        .sort((a: any, b: any) => a.position - b.position);
      
      const modulePipelines = allPipelines
        .filter((p: any) => p.moduleId === m.id)
        .sort((a: any, b: any) => a.position - b.position)
        .map((p: any) => ({
          ...p,
          stages: allStages
            .filter((s: any) => s.pipelineId === p.id)
            .sort((a: any, b: any) => a.position - b.position),
        }));

      return {
        ...m,
        fields: moduleFields,
        pipelines: modulePipelines,
      };
    });

    return {
      modules: enrichedModules,
      schemaVersion: aggregateVersion,
      fields: allFields,
      pipelines: allPipelines,
      stages: allStages,
    };
  }
}
