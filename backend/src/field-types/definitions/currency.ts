import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeNumber, importCell } from '../shared';

const configSchema = z.object({
  currencyCode: z.string().length(3).default('USD'),
});

type Config = z.infer<typeof configSchema>;

const CURRENCY_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty',
];

export const currencyField: FieldTypeDef<Config, number> = {
  key: 'currency',
  label: 'Currency',
  group: 'basic',
  configSchema,
  valueSchema() {
    return z.number();
  },
  sqlType: 'numeric',
  operators: CURRENCY_OPERATORS,
  normalize(input) {
    return normalizeNumber(input, { precision: 2 });
  },
  toSearchText(value) { return String(value); },
  toExportString(value) { return String(value); },
  parseImport(raw) {
    return normalizeNumber(importCell(raw), { precision: 2 });
  },
  formComponent: 'CurrencyInput',
  cellComponent: 'CurrencyCell',
  filterComponent: 'NumberFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
