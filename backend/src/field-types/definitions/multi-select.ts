import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { optionsConfigSchema, optionIds, normalizeStringArray, importCell } from '../shared';

const configSchema = z.object({
  options: optionsConfigSchema,
  maxSelected: z.number().int().min(1).max(500).optional(),
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
  normalize(input, config) {
    const values = normalizeStringArray(input, { maxItems: config?.maxSelected ?? 500 });
    if (!values) return null;

    const ids = optionIds(config?.options);
    const labelIndex = new Map(
      (config?.options ?? []).map((o) => [o.label.toLowerCase(), o.id] as const),
    );

    const resolved: string[] = [];
    for (const value of values) {
      if (ids.has(value)) {
        resolved.push(value);
        continue;
      }
      const byLabel = labelIndex.get(value.toLowerCase());
      if (byLabel) {
        resolved.push(byLabel);
        continue;
      }
      return null;
    }

    const unique = Array.from(new Set(resolved));
    return unique.length > 0 ? unique : null;
  },
  toSearchText(value, config) {
    return value.map(v => config.options?.find(o => o.id === v)?.label || v).join(', ');
  },
  toExportString(value) { return value.join(','); },
  parseImport(raw, config) {
    const cell = importCell(raw);
    if (!cell) return null;
    return multiSelectField.normalize(cell.split(',').map((s) => s.trim()).filter(Boolean), config);
  },
  formComponent: 'MultiSelectInput',
  cellComponent: 'MultiSelectCell',
  filterComponent: 'MultiSelectFilter',
  isSortable: false,
  canBeIndexed: true,
  canBeUnique: false,
};
