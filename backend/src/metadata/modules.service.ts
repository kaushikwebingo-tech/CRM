import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../db/connection';
import { modules, pipelines, pipelineStages, views } from '../db/schema';
import { eq, and, isNull, asc, sql as drizzleSql } from 'drizzle-orm';
import { ConflictError, ForbiddenError, NotFoundError } from '../common/errors';

@Injectable()
export class ModulesService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  async list(orgId: string) {
    return this.db.select().from(modules).where(and(eq(modules.orgId, orgId), isNull(modules.deletedAt))).orderBy(asc(modules.position));
  }

  async getByKey(orgId: string, key: string) {
    const [mod] = await this.db.select().from(modules).where(and(eq(modules.orgId, orgId), eq(modules.key, key), isNull(modules.deletedAt))).limit(1);
    if (!mod) throw new NotFoundError('Module not found');
    return mod;
  }

  async create(orgId: string, data: { key: string; labelSingular: string; labelPlural: string; icon?: string; color?: string; hasPipeline?: boolean; nameFieldLabel?: string }) {
    if (!/^[a-z_][a-z0-9_]*$/.test(data.key)) {
      throw new ConflictError('Key must be snake_case');
    }
    const [existing] = await this.db.select().from(modules).where(and(eq(modules.orgId, orgId), eq(modules.key, data.key))).limit(1);
    if (existing) throw new ConflictError('Module key already exists');

    return this.db.transaction(async (tx: any) => {
      const [mod] = await tx.insert(modules).values({
        orgId,
        key: data.key,
        labelSingular: data.labelSingular,
        labelPlural: data.labelPlural,
        icon: data.icon ?? null,
        color: data.color ?? null,
        hasPipeline: data.hasPipeline ?? false,
        nameFieldLabel: data.nameFieldLabel ?? 'Name',
        isSystem: false,
        position: 0,
      }).returning();

      if (mod.hasPipeline) {
        const [pipeline] = await tx.insert(pipelines).values({
          orgId,
          moduleId: mod.id,
          name: 'Default Pipeline',
          isDefault: true,
        }).returning();
        await tx.insert(pipelineStages).values([
          { orgId, pipelineId: pipeline.id, key: 'new', label: 'New', type: 'open', position: 1 },
          { orgId, pipelineId: pipeline.id, key: 'won', label: 'Won', type: 'won', position: 2 },
          { orgId, pipelineId: pipeline.id, key: 'lost', label: 'Lost', type: 'lost', position: 3 },
        ]);
      }

      await tx.insert(views).values({
        orgId,
        moduleId: mod.id,
        name: 'All',
        isDefault: true,
      });

      return mod;
    });
  }

  async update(orgId: string, key: string, data: any) {
    const mod = await this.getByKey(orgId, key);
    if (data.key !== undefined || data.isSystem !== undefined) {
      throw new ForbiddenError('Cannot update immutable fields');
    }
    // Only these columns may come from a request body; the previous version
    // spread the client's object, so `orgId`, `id` and `deletedAt` were settable.
    const [updated] = await this.db.update(modules)
      .set({
        ...(data.labelSingular !== undefined && { labelSingular: data.labelSingular }),
        ...(data.labelPlural !== undefined && { labelPlural: data.labelPlural }),
        ...(data.icon !== undefined && { icon: data.icon }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.nameFieldLabel !== undefined && { nameFieldLabel: data.nameFieldLabel }),
        ...(data.titleTemplate !== undefined && { titleTemplate: data.titleTemplate }),
        ...(data.position !== undefined && { position: data.position }),
        ...(data.hasPipeline !== undefined && { hasPipeline: data.hasPipeline }),
        schemaVersion: drizzleSql`${modules.schemaVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(modules.id, mod.id))
      .returning();
    return updated;
  }

  async softDelete(orgId: string, key: string) {
    const mod = await this.getByKey(orgId, key);
    if (mod.isSystem) throw new ForbiddenError('Cannot delete system module');
    await this.db.update(modules).set({ deletedAt: new Date() }).where(eq(modules.id, mod.id));
  }

  /**
   * Increments the module's schema version.
   *
   * Plan Section 6: the version is bumped "inside the same transaction as any
   * change to that module's fields or stages", because the compiled schema is
   * cached under `moduleId:schemaVersion` — if the bump is lost, the compiler
   * keeps serving a schema that does not have the new field in it.
   *
   * It is also a single `schema_version + 1` statement rather than a
   * read-then-write: two concurrent field creations both read the same value
   * and one bump used to be silently discarded.
   */
  async bumpSchemaVersion(moduleId: string, tx?: any) {
    const runner = tx ?? this.db;
    await runner
      .update(modules)
      .set({ schemaVersion: drizzleSql`${modules.schemaVersion} + 1`, updatedAt: new Date() })
      .where(eq(modules.id, moduleId));
  }
}
