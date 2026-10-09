import {
  createElement,
  createContext,
  useContext,
  useMemo,
  type ReactNode,
  type FunctionComponentElement,
  type ProviderProps,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchSchema,
  readCachedSchema,
  modulePermission,
  canAdmin,
  type SchemaBundle,
  type ModuleDef,
  type PermissionMap,
  type ModulePermission,
  type AdminPermission,
} from '@/api/schema';

export interface SchemaContextValue {
  schema: SchemaBundle | null;
  /** True only while there is nothing at all to render. */
  isLoading: boolean;
  /** True while revalidating in the background, with cached data on screen. */
  isRefreshing: boolean;
  error: Error | null;
  modules: ModuleDef[];
  permissions: PermissionMap | null;
  getModule: (key: string) => ModuleDef | undefined;
  permissionFor: (moduleKey: string) => ModulePermission;
  can: (capability: keyof AdminPermission) => boolean;
}

export const SchemaContext = createContext<SchemaContextValue | undefined>(undefined);

export function SchemaProvider({
  children,
}: {
  children: ReactNode;
}): FunctionComponentElement<ProviderProps<SchemaContextValue | undefined>> {
  // Seeding the query with the cached bundle is what removes the blocking
  // spinner on a reload (Guardrail 17: render stale, revalidate).
  const cached = useMemo(() => readCachedSchema(), []);

  const {
    data: schema,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['schema'],
    queryFn: fetchSchema,
    initialData: cached ?? undefined,
    staleTime: 5 * 60 * 1000,
  });

  const modules = schema?.modules ?? [];

  const value: SchemaContextValue = {
    schema: schema ?? null,
    isLoading: !schema && isFetching,
    isRefreshing: Boolean(schema) && isFetching,
    error: (error as Error) ?? null,
    modules,
    permissions: schema?.permissions ?? null,
    getModule: (key: string) => modules.find((m) => m.key === key),
    permissionFor: (moduleKey: string) => modulePermission(schema?.permissions, moduleKey),
    can: (capability: keyof AdminPermission) => canAdmin(schema?.permissions, capability),
  };

  return createElement(SchemaContext.Provider, { value }, children);
}

export function useSchema(): SchemaContextValue {
  const context = useContext(SchemaContext);
  if (context === undefined) {
    throw new Error('useSchema must be used within a SchemaProvider');
  }
  return context;
}
