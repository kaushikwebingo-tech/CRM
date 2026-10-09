import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeNumber, importCell } from '../shared';

const configSchema = z.object({
  precision: z.number().int().min(0).max(10).optional(),
});

type Config = z.infer<typeof configSchema>;

const NUMBER_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty',
];

export const numberField: FieldTypeDef<Config, number> = {
  key: 'number',
  label: 'Number',
  group: 'basic',
  configSchema,
  valueSchema() {
    return z.number();
  },
  sqlType: 'numeric',
  operators: NUMBER_OPERATORS,
  normalize(input, config) {
    return normalizeNumber(input, { precision: config?.precision });
  },
  toSearchText(value) { return String(value); },
  toExportString(value) { return String(value); },
  parseImport(raw, config) {
    return normalizeNumber(importCell(raw), { precision: config?.precision });
  },
  formComponent: 'NumberInput',
  cellComponent: 'NumberCell',
  filterComponent: 'NumberFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: true,
};
