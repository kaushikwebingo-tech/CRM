import { api } from '@/api/client';

/**
 * A field, exactly as the schema bundle ships it.
 *
 * `operators`, `isSortable` and the three component keys come from the backend
 * field-type registry. The frontend reads them instead of switching on
 * `type` itself, which is what Guardrail 14 requires — behaviour belongs to the
 * field *type*, declared once, so a new type needs no frontend change beyond a
 * registry entry.
 */
export interface FieldDef {
  key: string;
  label: string;
  type: string;
  config: Record<string, unknown>;
  isRequired: boolean;
  isUnique: boolean;
  isSystem: boolean;
  isIndexed: boolean;
  isSearchable: boolean;
  defaultValue: unknown;
  helpText: string | null;
  section: string;
  position: number;

  // resolved from the backend field-type registry
  formComponent?: string;
  cellComponent?: string;
  filterComponent?: string;
  operators?: string[];
  isSortable?: boolean;
  canBeIndexed?: boolean;
  canBeUnique?: boolean;
}

export interface StageDef {
  id: string;
  key: string;
  label: string;
  color: string | null;
  type: 'open' | 'won' | 'lost';
  probability: number | null;
  position: number;
}

export interface PipelineDef {
  id: string;
  name: string;
  isDefault: boolean;
  stages: StageDef[];
}

export interface ModuleDef {
  id: string;
  key: string;
  labelSingular: string;
  labelPlural: string;
  icon: string | null;
  color: string | null;
  hasPipeline: boolean;
  nameFieldLabel: string;
  position: number;
  fields: FieldDef[];
  pipelines: PipelineDef[];
}

export type RecordScope = 'all' | 'team' | 'own' | 'none';

export interface ModulePermission {
  read: RecordScope;
  create: boolean;
  update: RecordScope;
  delete: RecordScope;
  fields: Record<string, { read: boolean; write: boolean }>;
}

export interface AdminPermission {
  manageModules: boolean;
  manageUsers: boolean;
  manageAutomations: boolean;
  manageViews: boolean;
  import: boolean;
  export: boolean;
}

/** The permission map of Plan Section 13, as the bundle delivers it. */
export interface PermissionMap {
  all: boolean;
  modules: Record<string, ModulePermission>;
  defaultModule: ModulePermission | null;
  admin: AdminPermission;
}

export interface SchemaBundle {
  modules: ModuleDef[];
  schemaVersion: string | number;
  permissions: PermissionMap | null;
}

const CACHE_KEY = 'crm.schema.v1';

/**
 * Plan Section 11: the bundle is "persisted to localStorage keyed by schema
 * version ... so a returning user gets a 304 and the app renders from
 * localStorage with no spinner".
 */
export function readCachedSchema(): SchemaBundle | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SchemaBundle;
    // A cache written by an older build can be any shape at all.
    if (!parsed || !Array.isArray(parsed.modules)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedSchema(bundle: SchemaBundle): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(bundle));
  } catch {
    // Private mode, cleared site data or a quota error: the app works without it.
  }
}

export function clearCachedSchema(): void {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export async function fetchSchema(): Promise<SchemaBundle> {
  const bundle = await api.get<SchemaBundle>('/api/schema');
  // A 304 reaches us as an empty object, because the browser served its cache.
  if (!bundle || !Array.isArray(bundle.modules)) {
    const cached = readCachedSchema();
    if (cached) return cached;
    throw new Error('The schema bundle could not be loaded');
  }
  writeCachedSchema(bundle);
  return bundle;
}

/** Permissions resolved for one module, with the plan's deny-by-default. */
export function modulePermission(
  permissions: PermissionMap | null | undefined,
  moduleKey: string,
): ModulePermission {
  if (!permissions) {
    // No map means an older server; allow and let the API be the authority.
    return { read: 'all', create: true, update: 'all', delete: 'all', fields: {} };
  }
  if (permissions.all) {
    return { read: 'all', create: true, update: 'all', delete: 'all', fields: {} };
  }
  return (
    permissions.modules?.[moduleKey] ??
    permissions.defaultModule ?? { read: 'none', create: false, update: 'none', delete: 'none', fields: {} }
  );
}

export function canAdmin(
  permissions: PermissionMap | null | undefined,
  capability: keyof AdminPermission,
): boolean {
  if (!permissions) return true;
  if (permissions.all) return true;
  return Boolean(permissions.admin?.[capability]);
}
