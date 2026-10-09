import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeNumber, importCell } from '../shared';

const configSchema = z.object({});

type Config = z.infer<typeof configSchema>;

const NUMBER_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty',
];

export const percentField: FieldTypeDef<Config, number> = {
  key: 'percent',
  label: 'Percent',
  group: 'basic',
  configSchema,
  valueSchema() {
    return z.number().min(0).max(100);
  },
  sqlType: 'numeric',
  operators: NUMBER_OPERATORS,
  normalize(input) {
    return normalizeNumber(input, { min: 0, max: 100, precision: 2 });
  },
  toSearchText(value) { return String(value); },
  toExportString(value) { return String(value); },
  parseImport(raw) {
    return normalizeNumber(importCell(raw).replace(/%$/, ''), { min: 0, max: 100, precision: 2 });
  },
  formComponent: 'PercentInput',
  cellComponent: 'PercentCell',
  filterComponent: 'NumberFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
