import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../db/connection';
import { roles, users } from '../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { ConflictError, ForbiddenError, NotFoundError } from '../common/errors';

export interface CreateRoleDto {
  name: string;
  permissions?: Record<string, any>;
}

export interface UpdateRoleDto {
  name?: string;
  permissions?: Record<string, any>;
}

@Injectable()
export class RolesService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  async list(orgId: string) {
    return this.db
      .select()
      .from(roles)
      .where(eq(roles.orgId, orgId))
      .orderBy(asc(roles.createdAt));
  }

  async getById(orgId: string, id: string) {
    const [role] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.id, id)))
      .limit(1);

    if (!role) {
      throw new NotFoundError('Role not found');
    }
    return role;
  }

  async create(orgId: string, data: CreateRoleDto) {
    if (!data.name || !data.name.trim()) {
      throw new ConflictError('Role name is required');
    }

    const [role] = await this.db
      .insert(roles)
      .values({
        orgId,
        name: data.name.trim(),
        isSystem: false,
        permissions: data.permissions || {},
      })
      .returning();

    return role;
  }

  async update(orgId: string, id: string, data: UpdateRoleDto) {
    const existing = await this.getById(orgId, id);

    const valuesToUpdate: Record<string, any> = {};
    if (data.name !== undefined) {
      if (existing.isSystem && data.name.trim() !== existing.name) {
        throw new ForbiddenError('System role names cannot be changed');
      }
      valuesToUpdate.name = data.name.trim();
    }
    if (data.permissions !== undefined) {
      valuesToUpdate.permissions = data.permissions;
    }

    const [updated] = await this.db
      .update(roles)
      .set(valuesToUpdate)
      .where(and(eq(roles.orgId, orgId), eq(roles.id, id)))
      .returning();

    return updated;
  }

  async delete(orgId: string, id: string) {
    const existing = await this.getById(orgId, id);
    if (existing.isSystem) {
      throw new ForbiddenError('System roles cannot be deleted');
    }

    const assignedUsers = await this.db
      .select()
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.roleId, id)))
      .limit(1);

    if (assignedUsers.length > 0) {
      throw new ConflictError('Cannot delete role that is assigned to users. Reassign users first.');
    }

    await this.db
      .delete(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.id, id)));

    return { success: true };
  }
}
