import { Controller, Get, Post, Patch, Body, Param, Inject } from '@nestjs/common';
import { CurrentOrg } from '../common/decorators';
import { DATABASE } from '../db/connection';
import { users, roles } from '../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { AuthService } from './auth.service';
import { NotFoundError, ConflictError } from '../common/errors';
import { RequireAdmin } from './permissions.guard';

@Controller('users')
export class UsersController {
  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly authService: AuthService
  ) {}

  @Get()
  async list(@CurrentOrg() orgId: string) {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        isActive: users.isActive,
        createdAt: users.createdAt,
        roleId: users.roleId,
        roleName: roles.name,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.orgId, orgId))
      .orderBy(asc(users.createdAt));

    return rows.map((r: any) => ({
      id: r.id,
      email: r.email,
      fullName: r.fullName,
      avatarUrl: r.avatarUrl,
      isActive: r.isActive,
      createdAt: r.createdAt,
      role: r.roleId
        ? {
            id: r.roleId,
            name: r.roleName,
          }
        : null,
    }));
  }

  @RequireAdmin('manageUsers', 'change a user role')
  @Patch(':id/role')
  async assignRole(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: { roleId: string | null }
  ) {
    const [existing] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.id, id)))
      .limit(1);

    if (!existing) {
      throw new NotFoundError('User not found');
    }

    if (body.roleId) {
      const [role] = await this.db
        .select()
        .from(roles)
        .where(and(eq(roles.orgId, orgId), eq(roles.id, body.roleId)))
        .limit(1);

      if (!role) {
        throw new NotFoundError('Role not found');
      }
    }

    const [updated] = await this.db
      .update(users)
      .set({ roleId: body.roleId || null })
      .where(and(eq(users.orgId, orgId), eq(users.id, id)))
      .returning();

    return updated;
  }

  @RequireAdmin('manageUsers', 'create a user')
  @Post()
  async createUser(
    @CurrentOrg() orgId: string,
    @Body()
    body: {
      email: string;
      fullName: string;
      roleId?: string;
      password?: string;
    }
  ) {
    if (!body.email || !body.fullName) {
      throw new ConflictError('Email and full name are required');
    }

    const [existing] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.email, body.email)))
      .limit(1);

    if (existing) {
      throw new ConflictError('User with this email already exists in this organization');
    }

    const passwordHash = await this.authService.hashPassword(body.password || 'welcome123');

    const [created] = await this.db
      .insert(users)
      .values({
        orgId,
        email: body.email.toLowerCase().trim(),
        fullName: body.fullName.trim(),
        passwordHash,
        roleId: body.roleId || null,
        isActive: true,
      })
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        roleId: users.roleId,
        isActive: users.isActive,
        createdAt: users.createdAt,
      });

    return created;
  }
}
