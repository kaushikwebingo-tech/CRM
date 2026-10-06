import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

const configSchema = z.object({});

type Config = z.infer<typeof configSchema>;

const DATETIME_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'before', 'after', 'within', 'between', 'is_empty', 'is_not_empty',
];

export const datetimeField: FieldTypeDef<Config, string> = {
  key: 'datetime',
  label: 'Date & Time',
  group: 'basic',
  configSchema,
  valueSchema() {
    return z.string().datetime();
  },
  sqlType: 'timestamptz',
  operators: DATETIME_OPERATORS,
  normalize(input) {
    if (!input) return null;
    const d = new Date(String(input));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  },
  toSearchText(value) { return value; },
  toExportString(value) { return value; },
  parseImport(raw) {
    const d = new Date(raw.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  },
  formComponent: 'DateTimeInput',
  cellComponent: 'DateTimeCell',
  filterComponent: 'DateFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
