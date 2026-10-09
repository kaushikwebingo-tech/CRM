import { z } from 'zod';
import { ForbiddenError } from '../common/errors';


export type RecordScope = 'all' | 'team' | 'own' | 'none';

export const recordScopeSchema = z.enum(['all', 'team', 'own', 'none']);

export const fieldPermissionSchema = z.object({
  read: z.boolean().default(true),
  write: z.boolean().default(true),
});

export const modulePermissionSchema = z.object({
  read: recordScopeSchema.default('none'),
  create: z.boolean().default(false),
  update: recordScopeSchema.default('none'),
  delete: recordScopeSchema.default('none'),
  fields: z.record(z.string(), fieldPermissionSchema).default({}),
});

export const adminPermissionSchema = z.object({
  manageModules: z.boolean().default(false),
  manageUsers: z.boolean().default(false),
  manageAutomations: z.boolean().default(false),
  manageViews: z.boolean().default(false),
  import: z.boolean().default(false),
  export: z.boolean().default(false),
});

export const permissionsSchema = z.object({

  all: z.boolean().default(false),
  admin: adminPermissionSchema.default({}),
  defaultModule: modulePermissionSchema.optional(),
  modules: z.record(z.string(), modulePermissionSchema).default({}),
});

export type Permissions = z.infer<typeof permissionsSchema>;
export type ModulePermission = z.infer<typeof modulePermissionSchema>;
export type AdminPermission = z.infer<typeof adminPermissionSchema>;

const ALLOW_ALL: ModulePermission = {
  read: 'all',
  create: true,
  update: 'all',
  delete: 'all',
  fields: {},
};

const DENY_ALL: ModulePermission = {
  read: 'none',
  create: false,
  update: 'none',
  delete: 'none',
  fields: {},
};

export function parsePermissions(raw: unknown): Permissions {
  const parsed = permissionsSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  return permissionsSchema.parse({});
}

export function isOwner(permissions: Permissions): boolean {
  return permissions.all === true;
}

export function modulePermission(permissions: Permissions, moduleKey: string): ModulePermission {
  if (isOwner(permissions)) return ALLOW_ALL;
  return permissions.modules[moduleKey] ?? permissions.defaultModule ?? DENY_ALL;
}

export function adminPermission(permissions: Permissions): AdminPermission {
  if (isOwner(permissions)) {
    return {
      manageModules: true,
      manageUsers: true,
      manageAutomations: true,
      manageViews: true,
      import: true,
      export: true,
    };
  }
  return permissions.admin;
}

export function assertAdmin(
  permissions: Permissions,
  capability: keyof AdminPermission,
  what: string,
): void {
  if (!adminPermission(permissions)[capability]) {
    throw new ForbiddenError(`You do not have permission to ${what}`);
  }
}

export function assertModuleAction(
  permissions: Permissions,
  moduleKey: string,
  action: 'read' | 'create' | 'update' | 'delete',
  what: string,
): void {
  const perm = modulePermission(permissions, moduleKey);
  const allowed = action === 'create' ? perm.create : perm[action] !== 'none';
  if (!allowed) {
    throw new ForbiddenError(`You do not have permission to ${what}`);
  }
}

export function scopeFor(
  permissions: Permissions,
  moduleKey: string,
  action: 'read' | 'update' | 'delete',
): RecordScope {
  return modulePermission(permissions, moduleKey)[action];
}

export function unreadableFields(permissions: Permissions, moduleKey: string): Set<string> {
  const perm = modulePermission(permissions, moduleKey);
  const hidden = new Set<string>();
  for (const [key, rule] of Object.entries(perm.fields)) {
    if (rule.read === false) hidden.add(key);
  }
  return hidden;
}

export function readOnlyFields(permissions: Permissions, moduleKey: string): Set<string> {
  const perm = modulePermission(permissions, moduleKey);
  const locked = new Set<string>();
  for (const [key, rule] of Object.entries(perm.fields)) {
    if (rule.write === false) locked.add(key);
  }
  return locked;
}

export function serialisePermissions(permissions: Permissions) {
  return {
    all: permissions.all,
    modules: permissions.modules,
    defaultModule: permissions.defaultModule ?? null,
    admin: adminPermission(permissions),
  };
}
