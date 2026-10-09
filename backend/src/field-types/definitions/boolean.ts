import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeBoolean, importCell } from '../shared';

const configSchema = z.object({});

type Config = z.infer<typeof configSchema>;

const BOOLEAN_OPERATORS: FilterOperator[] = [
  'is_true', 'is_false', 'is_empty', 'is_not_empty',
];

export const booleanField: FieldTypeDef<Config, boolean> = {
  key: 'boolean',
  label: 'Checkbox',
  group: 'basic',
  configSchema,
  valueSchema() {
    return z.boolean();
  },
  sqlType: 'boolean',
  operators: BOOLEAN_OPERATORS,
  normalize(input) {
    return normalizeBoolean(input);
  },
  toSearchText(value) { return value ? 'Yes' : 'No'; },
  toExportString(value) { return value ? 'true' : 'false'; },
  parseImport(raw) {
    return normalizeBoolean(importCell(raw));
  },
  formComponent: 'CheckboxInput',
  cellComponent: 'CheckboxCell',
  filterComponent: 'BooleanFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
