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

const MULTI_SELECT_OPERATORS: FilterOperator[] = [
  'has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty',
];

export const multiSelectField: FieldTypeDef<Config, string[]> = {
  key: 'multi_select',
  label: 'Multi Select',
  group: 'basic',
  configSchema,
  valueSchema(config) {
    const validIds = config.options?.map(o => o.id) || [];
    return z.array(z.string().refine(val => validIds.includes(val), { message: 'Invalid option' }));
  },
  sqlType: 'jsonb',
  operators: MULTI_SELECT_OPERATORS,
  normalize(input) {
    if (!Array.isArray(input)) return null;
    const arr = input.filter(x => x != null).map(String).map(s => s.trim());
    return arr.length > 0 ? arr : null;
  },
  toSearchText(value, config) {
    return value.map(v => config.options?.find(o => o.id === v)?.label || v).join(', ');
  },
  toExportString(value) { return value.join(','); },
  parseImport(raw) {
    const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  },
  formComponent: 'MultiSelectInput',
  cellComponent: 'MultiSelectCell',
  filterComponent: 'MultiSelectFilter',
  isSortable: false,
  canBeIndexed: true,
  canBeUnique: false,
};
