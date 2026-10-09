import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { optionsConfigSchema, optionIds, toScalarString, importCell } from '../shared';

const configSchema = z.object({
  options: optionsConfigSchema,
  allowOther: z.boolean().default(false),
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
  normalize(input, config) {
    const raw = toScalarString(input);
    if (!raw) return null;
    const value = raw.trim();
    if (!value) return null;

    const ids = optionIds(config?.options);
    if (ids.has(value)) return value;

    const byLabel = (config?.options ?? []).find(
      (o) => o.label.toLowerCase() === value.toLowerCase(),
    );
    if (byLabel) return byLabel.id;

    return config?.allowOther ? value : null;
  },
  toSearchText(value, config) {
    const option = config.options?.find(o => o.id === value);
    return option ? option.label : value;
  },
  toExportString(value) { return value; },
  parseImport(raw, config) {
    return selectField.normalize(importCell(raw), config);
  },
  formComponent: 'SelectInput',
  cellComponent: 'SelectCell',
  filterComponent: 'SelectFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
