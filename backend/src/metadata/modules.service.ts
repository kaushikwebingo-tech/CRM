import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../db/connection';
import { modules, pipelines, pipelineStages, views } from '../db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
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
        ...data,
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
    const [updated] = await this.db.update(modules)
      .set({ ...data, schemaVersion: mod.schemaVersion + 1, updatedAt: new Date() })
      .where(eq(modules.id, mod.id))
      .returning();
    return updated;
  }

  async softDelete(orgId: string, key: string) {
    const mod = await this.getByKey(orgId, key);
    if (mod.isSystem) throw new ForbiddenError('Cannot delete system module');
    await this.db.update(modules).set({ deletedAt: new Date() }).where(eq(modules.id, mod.id));
  }

  async bumpSchemaVersion(moduleId: string) {
    const [mod] = await this.db.select({ schemaVersion: modules.schemaVersion }).from(modules).where(eq(modules.id, moduleId)).limit(1);
    if (!mod) return;
    await this.db.update(modules).set({ schemaVersion: mod.schemaVersion + 1, updatedAt: new Date() }).where(eq(modules.id, moduleId));
  }
}
