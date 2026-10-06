import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

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
    if (input === true || input === 'true' || input === 1 || input === '1') return true;
    if (input === false || input === 'false' || input === 0 || input === '0') return false;
    return null;
  },
  toSearchText(value) { return value ? 'Yes' : 'No'; },
  toExportString(value) { return value ? 'true' : 'false'; },
  parseImport(raw) {
    const s = raw.trim().toLowerCase();
    if (['true', 'yes', '1', 'y'].includes(s)) return true;
    if (['false', 'no', '0', 'n'].includes(s)) return false;
    return null;
  },
  formComponent: 'CheckboxInput',
  cellComponent: 'CheckboxCell',
  filterComponent: 'BooleanFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
