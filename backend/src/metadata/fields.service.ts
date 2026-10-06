import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../db/connection';
import { fields, modules } from '../db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { ConflictError, ForbiddenError, NotFoundError } from '../common/errors';
import { getFieldType } from '../field-types/registry';
import { ModulesService } from './modules.service';

@Injectable()
export class FieldsService {
  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly modulesService: ModulesService,
  ) {}

  async list(orgId: string, moduleId: string) {
    return this.db.select().from(fields).where(and(eq(fields.moduleId, moduleId), isNull(fields.deletedAt))).orderBy(asc(fields.position));
  }

  async getByKey(moduleId: string, key: string) {
    const [field] = await this.db.select().from(fields).where(and(eq(fields.moduleId, moduleId), eq(fields.key, key), isNull(fields.deletedAt))).limit(1);
    if (!field) throw new NotFoundError('Field not found');
    return field;
  }

  async create(orgId: string, moduleId: string, data: any) {
    if (!/^[a-z_][a-z0-9_]*$/.test(data.key)) {
      throw new ConflictError('Key must be snake_case');
    }
    const def = getFieldType(data.type);
    const config = def.configSchema.parse(data.config || {});
    
    const [existing] = await this.db.select().from(fields).where(and(eq(fields.moduleId, moduleId), eq(fields.key, data.key))).limit(1);
    if (existing) throw new ConflictError('Field key already exists');

    return this.db.transaction(async (tx: any) => {
      const [field] = await tx.insert(fields).values({
        orgId,
        moduleId,
        ...data,
        config,
      }).returning();
      await this.modulesService.bumpSchemaVersion(moduleId);
      return field;
    });
  }

  async update(orgId: string, moduleId: string, fieldKey: string, data: any) {
    const field = await this.getByKey(moduleId, fieldKey);
    if (data.key !== undefined || data.type !== undefined) {
      throw new ForbiddenError('Key and type are immutable');
    }
    let config = field.config;
    if (data.config) {
      const def = getFieldType(field.type);
      config = def.configSchema.parse(data.config);
    }
    
    return this.db.transaction(async (tx: any) => {
      const [updated] = await tx.update(fields)
        .set({ ...data, config, updatedAt: new Date() })
        .where(eq(fields.id, field.id))
        .returning();
      await this.modulesService.bumpSchemaVersion(moduleId);
      return updated;
    });
  }

  async softDelete(orgId: string, moduleId: string, fieldKey: string) {
    const field = await this.getByKey(moduleId, fieldKey);
    if (field.isSystem) throw new ForbiddenError('Cannot delete system field');
    await this.db.transaction(async (tx: any) => {
      await tx.update(fields).set({ deletedAt: new Date() }).where(eq(fields.id, field.id));
      await this.modulesService.bumpSchemaVersion(moduleId);
    });
  }

  async reorder(orgId: string, moduleId: string, orderedKeys: string[]) {
    await this.db.transaction(async (tx: any) => {
      for (let i = 0; i < orderedKeys.length; i++) {
        await tx.update(fields).set({ position: i }).where(and(eq(fields.moduleId, moduleId), eq(fields.key, orderedKeys[i])));
      }
      await this.modulesService.bumpSchemaVersion(moduleId);
    });
  }
}
