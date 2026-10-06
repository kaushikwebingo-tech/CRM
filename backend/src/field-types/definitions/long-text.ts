import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

const configSchema = z.object({
  maxLength: z.number().int().min(1).max(50000).optional(),
});

type Config = z.infer<typeof configSchema>;

const TEXT_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
];

export const longTextField: FieldTypeDef<Config, string> = {
  key: 'long_text',
  label: 'Long Text',
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
  formComponent: 'TextareaInput',
  cellComponent: 'LongTextCell',
  filterComponent: 'TextFilter',
  isSortable: false,
  canBeIndexed: false,
  canBeUnique: false,
};
