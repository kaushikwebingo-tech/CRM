import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeNumber } from '../shared';

const configSchema = z.object({
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  startingNumber: z.number().int().default(1),
});

type Config = z.infer<typeof configSchema>;

const NUMBER_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty',
];

export const autoNumberField: FieldTypeDef<Config, number> = {
  key: 'auto_number',
  label: 'Auto Number',
  group: 'advanced',
  configSchema,
  valueSchema() {
    return z.number();
  },
  sqlType: 'numeric',
  operators: NUMBER_OPERATORS,
  normalize(input) {
 
    return normalizeNumber(input, { precision: 0 });
  },
  toSearchText(value, config) {
    const prefix = config.prefix || '';
    const suffix = config.suffix || '';
    return `${prefix}${value}${suffix}`;
  },
  toExportString(value, config) {
    const prefix = config.prefix || '';
    const suffix = config.suffix || '';
    return `${prefix}${value}${suffix}`;
  },
  parseImport() { return null; },
  formComponent: 'AutoNumberInput',
  cellComponent: 'AutoNumberCell',
  filterComponent: 'NumberFilter',
  isSortable: true,
  canBeIndexed: false,
  canBeUnique: true,
};
