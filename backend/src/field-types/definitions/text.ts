import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

const configSchema = z.object({
  maxLength: z.number().int().min(1).max(10000).optional(),
});

type Config = z.infer<typeof configSchema>;

const TEXT_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
];

export const textField: FieldTypeDef<Config, string> = {
  key: 'text',
  label: 'Text',
  group: 'basic',
  configSchema,
  valueSchema(config) {
    let s = z.string();
    if (config.maxLength) s = s.max(config.maxLength);
    return s;
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
  formComponent: 'TextInput',
  cellComponent: 'TextCell',
  filterComponent: 'TextFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: true,
};
