import { Injectable, Inject } from '@nestjs/common';
import { z } from 'zod';
import { DATABASE } from '../db/connection';
import { fields, modules } from '../db/schema';
import { eq, and, isNull, asc, sql as drizzleSql } from 'drizzle-orm';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../common/errors';
import { getFieldType, getAllFieldTypes } from '../field-types/registry';
import { FIELD_KEY_PATTERN, CORE_COLUMN_KEYS } from './schema-compiler';
import { ModulesService } from './modules.service';
import { AuditService } from './audit.service';


const createFieldSchema = z.object({
  key: z.string().regex(FIELD_KEY_PATTERN, 'Key must be snake_case'),
  label: z.string().min(1).max(120),
  type: z.string().min(1),
  config: z.record(z.unknown()).optional(),
  isRequired: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  isIndexed: z.boolean().optional(),
  isSearchable: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  helpText: z.string().max(500).nullable().optional(),
  section: z.string().min(1).max(80).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});

/** `key` and `type` are immutable after creation (Plan Section 5 + Guardrail 4). */
const updateFieldSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  config: z.record(z.unknown()).optional(),
  isRequired: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  isIndexed: z.boolean().optional(),
  isSearchable: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  helpText: z.string().max(500).nullable().optional(),
  section: z.string().min(1).max(80).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});

@Injectable()
export class FieldsService {
  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly modulesService: ModulesService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string, moduleId: string) {
    return this.db
      .select()
      .from(fields)
      .where(and(eq(fields.orgId, orgId), eq(fields.moduleId, moduleId), isNull(fields.deletedAt)))
      .orderBy(asc(fields.position));
  }

  async getByKey(orgId: string, moduleId: string, key: string) {
    const [field] = await this.db
      .select()
      .from(fields)
      .where(
        and(
          eq(fields.orgId, orgId),
          eq(fields.moduleId, moduleId),
          eq(fields.key, key),
          isNull(fields.deletedAt),
        ),
      )
      .limit(1);
    if (!field) throw new NotFoundError('Field not found');
    return field;
  }

  /** `canBeUnique` / `canBeIndexed` were declared by every type and enforced nowhere. */
  private assertCapabilities(type: string, flags: { isUnique?: boolean; isIndexed?: boolean }) {
    const def = getFieldType(type);
    if (flags.isUnique && !def.canBeUnique) {
      throw new ValidationError(`A ${def.label} field cannot be unique`, [
        { field: 'isUnique', message: `A ${def.label} field cannot be unique` },
      ]);
    }
    if (flags.isIndexed && !def.canBeIndexed) {
      throw new ValidationError(`A ${def.label} field cannot be indexed`, [
        { field: 'isIndexed', message: `A ${def.label} field cannot be indexed` },
      ]);
    }
  }

  async create(orgId: string, moduleId: string, input: unknown, actorId?: string) {
    const data = createFieldSchema.parse(input);

    if (CORE_COLUMN_KEYS.has(data.key)) {
      throw new ConflictError(`"${data.key}" is a reserved column name`);
    }

    const known = getAllFieldTypes().some((t) => t.key === data.type);
    if (!known) {
      throw new ValidationError(`Unknown field type "${data.type}"`, [
        { field: 'type', message: `Unknown field type "${data.type}"` },
      ]);
    }

    const def = getFieldType(data.type);
    const config = def.configSchema.parse(data.config ?? {});
    this.assertCapabilities(data.type, data);

    // A soft-deleted field keeps its row, so the uniqueness check has to look
    // at every row, not just the live ones.
    const [existing] = await this.db
      .select()
      .from(fields)
      .where(and(eq(fields.moduleId, moduleId), eq(fields.key, data.key)))
      .limit(1);
    if (existing) throw new ConflictError('Field key already exists');

    return this.db.transaction(async (tx: any) => {
      const [field] = await tx
        .insert(fields)
        .values({
          orgId,
          moduleId,
          key: data.key,
          label: data.label,
          type: data.type,
          config,
          isRequired: data.isRequired ?? false,
          isUnique: data.isUnique ?? false,
          isIndexed: data.isIndexed ?? false,
          isSearchable: data.isSearchable ?? false,
          defaultValue: data.defaultValue ?? null,
          helpText: data.helpText ?? null,
          section: data.section ?? 'General',
          position: data.position ?? 0,
          isSystem: false,
        })
        .returning();

      // In the SAME transaction, so the compiler cannot serve a cached schema
      // that lacks a field which already exists (Plan Section 6).
      await this.modulesService.bumpSchemaVersion(moduleId, tx);
      await this.audit.record(tx, {
        orgId,
        actorId,
        entityType: 'field',
        entityId: field.id,
        action: 'created',
        after: field,
      });
      return field;
    });
  }

  async update(orgId: string, moduleId: string, fieldKey: string, input: unknown, actorId?: string) {
    const raw = (input ?? {}) as Record<string, unknown>;
    if (raw.key !== undefined || raw.type !== undefined) {
      throw new ForbiddenError('Key and type are immutable');
    }

    const field = await this.getByKey(orgId, moduleId, fieldKey);
    const data = updateFieldSchema.parse(raw);

    let config = field.config;
    if (data.config !== undefined) {
      config = getFieldType(field.type).configSchema.parse(data.config);
    }
    this.assertCapabilities(field.type, {
      isUnique: data.isUnique ?? field.isUnique,
      isIndexed: data.isIndexed ?? field.isIndexed,
    });

    return this.db.transaction(async (tx: any) => {
      const [updated] = await tx
        .update(fields)
        .set({
          ...(data.label !== undefined && { label: data.label }),
          ...(data.isRequired !== undefined && { isRequired: data.isRequired }),
          ...(data.isUnique !== undefined && { isUnique: data.isUnique }),
          ...(data.isIndexed !== undefined && { isIndexed: data.isIndexed }),
          ...(data.isSearchable !== undefined && { isSearchable: data.isSearchable }),
          ...(data.defaultValue !== undefined && { defaultValue: data.defaultValue }),
          ...(data.helpText !== undefined && { helpText: data.helpText }),
          ...(data.section !== undefined && { section: data.section }),
          ...(data.position !== undefined && { position: data.position }),
          config,
          updatedAt: new Date(),
        })
        .where(eq(fields.id, field.id))
        .returning();

      await this.modulesService.bumpSchemaVersion(moduleId, tx);
      await this.audit.record(tx, {
        orgId,
        actorId,
        entityType: 'field',
        entityId: field.id,
        action: 'updated',
        before: field,
        after: updated,
      });
      return updated;
    });
  }

  /**
   * Soft delete: the metadata row is marked deleted and the values stay in
   * records.data, so an accidental delete is recoverable (Plan Section 5).
   */
  async softDelete(orgId: string, moduleId: string, fieldKey: string, actorId?: string) {
    const field = await this.getByKey(orgId, moduleId, fieldKey);
    if (field.isSystem) throw new ForbiddenError('Cannot delete system field');

    await this.db.transaction(async (tx: any) => {
      await tx.update(fields).set({ deletedAt: new Date() }).where(eq(fields.id, field.id));
      await this.modulesService.bumpSchemaVersion(moduleId, tx);
      await this.audit.record(tx, {
        orgId,
        actorId,
        entityType: 'field',
        entityId: field.id,
        action: 'deleted',
        before: field,
      });
    });
  }

  async reorder(orgId: string, moduleId: string, orderedKeys: unknown, actorId?: string) {
    const keys = z.array(z.string().regex(FIELD_KEY_PATTERN)).max(500).parse(orderedKeys);

    await this.db.transaction(async (tx: any) => {
      for (let i = 0; i < keys.length; i++) {
        await tx
          .update(fields)
          .set({ position: i })
          .where(
            and(eq(fields.orgId, orgId), eq(fields.moduleId, moduleId), eq(fields.key, keys[i])),
          );
      }
      await this.modulesService.bumpSchemaVersion(moduleId, tx);
      await this.audit.record(tx, {
        orgId,
        actorId,
        entityType: 'field',
        entityId: moduleId,
        action: 'reordered',
        after: { order: keys },
      });
    });
  }
}
