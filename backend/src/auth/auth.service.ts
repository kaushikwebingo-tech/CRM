import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../db/connection';
import { users, roles } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import * as argon2 from 'argon2';

@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  async findUserByEmail(email: string, orgId?: string) {
    const conditions = [eq(users.email, email)];
    if (orgId) {
      conditions.push(eq(users.orgId, orgId));
    }
    const [user] = await this.db.select().from(users).where(and(...conditions)).limit(1);
    return user;
  }

  async validatePassword(user: any, password: string): Promise<boolean> {
    return argon2.verify(user.passwordHash, password);
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  async getUserById(id: string) {
    const [row] = await this.db.select({
      id: users.id,
      orgId: users.orgId,
      email: users.email,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      isActive: users.isActive,
      roleId: roles.id,
      roleName: roles.name,
      rolePermissions: roles.permissions,
    }).from(users).leftJoin(roles, eq(users.roleId, roles.id)).where(eq(users.id, id)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      orgId: row.orgId,
      email: row.email,
      fullName: row.fullName,
      avatarUrl: row.avatarUrl,
      isActive: row.isActive,
      role: row.roleId ? {
        id: row.roleId,
        name: row.roleName,
        permissions: row.rolePermissions || {},
      } : {
        id: '',
        name: 'User',
        permissions: {},
      },
    };
  }

  async listUsers(orgId: string) {
    const rows = await this.db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      isActive: users.isActive,
    }).from(users).where(and(eq(users.orgId, orgId), eq(users.isActive, true)));
    return rows;
  }
}
