import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

const configSchema = z.object({
  targetModuleKey: z.string(),
});

type Config = z.infer<typeof configSchema>;

const LOOKUP_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty',
];

export const lookupField: FieldTypeDef<Config, string> = {
  key: 'lookup',
  label: 'Lookup',
  group: 'relation',
  configSchema,
  valueSchema() {
    return z.string().uuid();
  },
  sqlType: 'uuid',
  operators: LOOKUP_OPERATORS,
  normalize(input) {
    if (input == null || input === '') return null;
    return String(input).trim();
  },
  toSearchText() { return ''; },
  toExportString(value) { return value; },
  parseImport(raw) { return raw.trim() || null; },
  formComponent: 'LookupInput',
  cellComponent: 'LookupCell',
  filterComponent: 'LookupFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
