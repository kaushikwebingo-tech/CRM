import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeDate, importCell } from '../shared';

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
  sqlType: 'date',
  operators: DATE_OPERATORS,
  normalize(input) {
    return normalizeDate(input);
  },
  toSearchText(value) { return value; },
  toExportString(value) { return value; },
  parseImport(raw) {
    return normalizeDate(importCell(raw));
  },
  formComponent: 'DateInput',
  cellComponent: 'DateCell',
  filterComponent: 'DateFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
