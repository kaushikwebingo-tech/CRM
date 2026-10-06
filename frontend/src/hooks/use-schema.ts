import { createElement, createContext, useContext, type ReactNode, type FunctionComponentElement, type ProviderProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSchema, type SchemaBundle, type ModuleDef } from '@/api/schema';

export interface SchemaContextValue {
  schema: SchemaBundle | null;
  isLoading: boolean;
  modules: ModuleDef[];
  getModule: (key: string) => ModuleDef | undefined;
}

export const SchemaContext = createContext<SchemaContextValue | undefined>(undefined);

export function SchemaProvider({ children }: { children: ReactNode }): FunctionComponentElement<ProviderProps<SchemaContextValue | undefined>> {
  const { data: schema, isLoading } = useQuery({
    queryKey: ['schema'],
    queryFn: fetchSchema,
    staleTime: Infinity,
  });

  const modules = schema?.modules ?? [];

  const getModule = (key: string): ModuleDef | undefined => {
    return modules.find((m) => m.key === key);
  };

  const value: SchemaContextValue = {
    schema: schema ?? null,
    isLoading,
    modules,
    getModule,
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
