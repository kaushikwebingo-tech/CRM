import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

const configSchema = z.object({
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  startingNumber: z.number().int().default(1),
});

type Config = z.infer<typeof configSchema>;

export const autoNumberField: FieldTypeDef<Config, number> = {
  key: 'auto_number',
  label: 'Auto Number',
  group: 'advanced',
  configSchema,
  valueSchema() {
    return z.number();
  },
  sqlType: 'numeric',
  operators: [],
  normalize(input) {
    if (input == null || input === '') return null;
    const num = Number(input);
    if (Number.isNaN(num)) return null;
    return num;
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
  isSortable: false,
  canBeIndexed: false,
  canBeUnique: true,
};
