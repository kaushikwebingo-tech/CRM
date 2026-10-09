import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeUuid, importCell } from '../shared';

const configSchema = z.object({});

type Config = z.infer<typeof configSchema>;

const USER_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty',
];

export const userField: FieldTypeDef<Config, string> = {
  key: 'user',
  label: 'User',
  group: 'relation',
  configSchema,
  valueSchema() {
    return z.string().uuid();
  },
  sqlType: 'uuid',
  operators: USER_OPERATORS,
  normalize(input) {
    return normalizeUuid(input);
  },
  toSearchText() { return ''; },
  toExportString(value) { return value; },
  parseImport(raw) {
    return normalizeUuid(importCell(raw));
  },
  formComponent: 'UserInput',
  cellComponent: 'UserCell',
  filterComponent: 'UserFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
