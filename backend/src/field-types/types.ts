import { ZodType } from 'zod';

export type FilterOperator =
  | 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'before' | 'after' | 'within'
  | 'is_true' | 'is_false'
  | 'in' | 'not_in'
  | 'has_any' | 'has_all' | 'has_none'
  | 'is_empty' | 'is_not_empty';

export type SqlCastType = 'text' | 'numeric' | 'boolean' | 'timestamptz' | 'uuid' | 'jsonb';

export interface FieldTypeDef<TConfig = unknown, TValue = unknown> {
  key: string;
  label: string;
  group: 'basic' | 'advanced' | 'relation' | 'system';
  configSchema: ZodType<TConfig, any, any>;
  valueSchema(config: TConfig): ZodType<TValue>;
  sqlType: SqlCastType;
  operators: FilterOperator[];
  normalize(input: unknown, config: TConfig): TValue | null;
  toSearchText(value: TValue, config: TConfig): string;
  toExportString(value: TValue, config: TConfig): string;
  parseImport(raw: string, config: TConfig): TValue | null;
  formComponent: string;
  cellComponent: string;
  filterComponent: string;
  isSortable: boolean;
  canBeIndexed: boolean;
  canBeUnique: boolean;
}
