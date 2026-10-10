import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { DATABASE } from '../db/connection';
import { users, roles } from '../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AuditService } from '../metadata/audit.service';


const createUserSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(320),
  fullName: z.string().trim().min(1, 'Full name is required').max(200),
  roleId: z.string().uuid().nullable().optional(),
  password: z.string().min(12, 'A password must be at least 12 characters').max(200).optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  roleId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string) {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        isActive: users.isActive,
        lastSeenAt: users.lastSeenAt,
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
      lastSeenAt: r.lastSeenAt,
      createdAt: r.createdAt,
      role: r.roleId ? { id: r.roleId, name: r.roleName } : null,
    }));
  }

  private async requireUser(orgId: string, id: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.id, id)))
      .limit(1);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  private async requireRole(orgId: string, roleId: string) {
    const [role] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.id, roleId)))
      .limit(1);
    if (!role) throw new NotFoundError('Role not found');
    return role;
  }

  async create(orgId: string, input: unknown, actorId?: string) {
    const data = createUserSchema.parse(input);


    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.email, data.email)))
      .limit(1);
    if (existing) {
      throw new ConflictError('A user with this email already exists', [
        { field: 'email', message: 'This email is already in use' },
      ]);
    }

    if (data.roleId) await this.requireRole(orgId, data.roleId);

  
    const generatedPassword = data.password ? null : randomBytes(12).toString('base64url');
    const passwordHash = await this.authService.hashPassword(data.password ?? generatedPassword!);

    const [created] = await this.db
      .insert(users)
      .values({
        orgId,
        email: data.email,
        fullName: data.fullName,
        passwordHash,
        roleId: data.roleId ?? null,
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

    await this.db.transaction(async (tx: any) => {
      await this.audit.record(tx, {
        orgId,
        actorId,
        entityType: 'user',
        entityId: created.id,
        action: 'created',
        after: { email: created.email, fullName: created.fullName, roleId: created.roleId },
      });
    });

    return { ...created, generatedPassword };
  }

  async update(orgId: string, id: string, input: unknown, actorId?: string) {
    const existing = await this.requireUser(orgId, id);
    const data = updateUserSchema.parse(input);

    if (data.roleId) await this.requireRole(orgId, data.roleId);

    const [updated] = await this.db
      .update(users)
      .set({
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.roleId !== undefined && { roleId: data.roleId }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      })
      .where(and(eq(users.orgId, orgId), eq(users.id, id)))
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        roleId: users.roleId,
        isActive: users.isActive,
      });

    
    if (data.isActive === false || (data.roleId !== undefined && data.roleId !== existing.roleId)) {
      await this.sessionService.destroyUserSessions(id);
    }

    await this.db.transaction(async (tx: any) => {
      await this.audit.record(tx, {
        orgId,
        actorId,
        entityType: 'user',
        entityId: id,
        action: 'updated',
        before: { fullName: existing.fullName, roleId: existing.roleId, isActive: existing.isActive },
        after: updated,
      });
    });

    return updated;
  }

  async deactivate(orgId: string, id: string, actorId?: string) {
    if (id === actorId) {
      throw new ValidationError('You cannot deactivate your own account', [
        { field: 'id', message: 'You cannot deactivate your own account' },
      ]);
    }
    return this.update(orgId, id, { isActive: false }, actorId);
  }
}
