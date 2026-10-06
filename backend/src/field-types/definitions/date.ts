import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

const configSchema = z.object({});

type Config = z.infer<typeof configSchema>;

const DATE_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'before', 'after', 'within', 'between', 'is_empty', 'is_not_empty',
];

export const dateField: FieldTypeDef<Config, string> = {
  key: 'date',
  label: 'Date',
  group: 'basic',
  configSchema,
  valueSchema() {
    return z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  },
  sqlType: 'timestamptz',
  operators: DATE_OPERATORS,
  normalize(input) {
    if (!input) return null;
    if (typeof input === 'string') {
      const match = input.match(/^\d{4}-\d{2}-\d{2}/);
      if (match) return match[0];
      const d = new Date(input);
      if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    return null;
  },
  toSearchText(value) { return value; },
  toExportString(value) { return value; },
  parseImport(raw) {
    const d = new Date(raw.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  },
  formComponent: 'DateInput',
  cellComponent: 'DateCell',
  filterComponent: 'DateFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
