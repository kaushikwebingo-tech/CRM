import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

const configSchema = z.object({
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
    color: z.string().optional(),
  })).default([]),
});

type Config = z.infer<typeof configSchema>;

const SELECT_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty',
];

export const selectField: FieldTypeDef<Config, string> = {
  key: 'select',
  label: 'Single Select',
  group: 'basic',
  configSchema,
  valueSchema(config) {
    const validIds = config.options?.map(o => o.id) || [];
    return z.string().refine(val => validIds.includes(val), { message: 'Invalid option' });
  },
  sqlType: 'text',
  operators: SELECT_OPERATORS,
  normalize(input) {
    if (input == null || input === '') return null;
    return String(input).trim();
  },
  toSearchText(value, config) {
    const option = config.options?.find(o => o.id === value);
    return option ? option.label : value;
  },
  toExportString(value) { return value; },
  parseImport(raw) { return raw.trim() || null; },
  formComponent: 'SelectInput',
  cellComponent: 'SelectCell',
  filterComponent: 'SelectFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
