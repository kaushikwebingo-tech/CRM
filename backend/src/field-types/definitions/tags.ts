import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeStringArray, importCell } from '../shared';

const configSchema = z.object({
  maxTags: z.number().int().min(1).max(500).default(50),
});

type Config = z.infer<typeof configSchema>;

const TAGS_OPERATORS: FilterOperator[] = [
  'has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty',
];

export const tagsField: FieldTypeDef<Config, string[]> = {
  key: 'tags',
  label: 'Tags',
  group: 'advanced',
  configSchema,
  valueSchema() {
    return z.array(z.string());
  },
  sqlType: 'jsonb',
  operators: TAGS_OPERATORS,
  normalize(input, config) {
    return normalizeStringArray(input, { maxItems: config?.maxTags ?? 50, maxLength: 120 });
  },
  toSearchText(value) { return value.join(', '); },
  toExportString(value) { return value.join(','); },
  parseImport(raw, config) {
    const cell = importCell(raw);
    if (!cell) return null;
    return normalizeStringArray(cell.split(',').map((s) => s.trim()).filter(Boolean), {
      maxItems: config?.maxTags ?? 50,
      maxLength: 120,
    });
  },
  formComponent: 'TagsInput',
  cellComponent: 'TagsCell',
  filterComponent: 'MultiSelectFilter',
  isSortable: false,
  canBeIndexed: true,
  canBeUnique: false,
};
