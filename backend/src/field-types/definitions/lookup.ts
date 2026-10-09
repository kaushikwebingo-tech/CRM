import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeUuid, importCell } from '../shared';

const configSchema = z.object({
  targetModuleKey: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  displayFieldKey: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional(),
  onDelete: z.enum(['set_null', 'restrict']).default('set_null'),
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
    return normalizeUuid(input);
  },
  toSearchText() { return ''; },
  toExportString(value) { return value; },
  parseImport(raw) {
    return normalizeUuid(importCell(raw));
  },
  formComponent: 'LookupInput',
  cellComponent: 'LookupCell',
  filterComponent: 'LookupFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
