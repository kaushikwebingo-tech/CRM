import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

const configSchema = z.object({});

type Config = z.infer<typeof configSchema>;

const TEXT_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
];

export const phoneField: FieldTypeDef<Config, string> = {
  key: 'phone',
  label: 'Phone',
  group: 'basic',
  configSchema,
  valueSchema() {
    return z.string();
  },
  sqlType: 'text',
  operators: TEXT_OPERATORS,
  normalize(input) {
    if (input == null || input === '') return null;
    return String(input).trim();
  },
  toSearchText(value) { return value; },
  toExportString(value) { return value; },
  parseImport(raw) { return raw.trim() || null; },
  formComponent: 'PhoneInput',
  cellComponent: 'PhoneCell',
  filterComponent: 'TextFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: true,
};
