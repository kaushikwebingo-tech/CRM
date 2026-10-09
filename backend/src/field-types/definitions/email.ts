import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeText, importCell } from '../shared';

const configSchema = z.object({});

type Config = z.infer<typeof configSchema>;

const TEXT_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
];

export const emailField: FieldTypeDef<Config, string> = {
  key: 'email',
  label: 'Email',
  group: 'basic',
  configSchema,
  valueSchema() {
    return z.string().email();
  },
  sqlType: 'text',
  operators: TEXT_OPERATORS,
  normalize(input) {
    const value = normalizeText(input, 320);
    if (!value) return null;
    const lowered = value.toLowerCase();
    return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(lowered) ? lowered : null;
  },
  toSearchText(value) { return value; },
  toExportString(value) { return value; },
  parseImport(raw) { return raw.trim().toLowerCase() || null; },
  formComponent: 'EmailInput',
  cellComponent: 'EmailCell',
  filterComponent: 'TextFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: true,
};
