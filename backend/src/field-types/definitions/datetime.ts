import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeDateTime, importCell } from '../shared';

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
    return normalizeDateTime(input);
  },
  toSearchText(value) { return value; },
  toExportString(value) { return value; },
  parseImport(raw) {
    return normalizeDateTime(importCell(raw));
  },
  formComponent: 'DateTimeInput',
  cellComponent: 'DateTimeCell',
  filterComponent: 'DateFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
