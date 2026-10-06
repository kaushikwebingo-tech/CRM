import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

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
    if (input == null || input === '') return null;
    const num = Number(input);
    if (Number.isNaN(num)) return null;
    return num;
  },
  toSearchText(value) { return String(value); },
  toExportString(value) { return String(value); },
  parseImport(raw) {
    const num = Number(raw.replace(/[^0-9.-]+/g, ''));
    return Number.isNaN(num) ? null : num;
  },
  formComponent: 'CurrencyInput',
  cellComponent: 'CurrencyCell',
  filterComponent: 'NumberFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
