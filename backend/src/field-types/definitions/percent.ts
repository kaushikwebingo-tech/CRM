import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

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
    return z.number();
  },
  sqlType: 'numeric',
  operators: NUMBER_OPERATORS,
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
  formComponent: 'PercentInput',
  cellComponent: 'PercentCell',
  filterComponent: 'NumberFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
