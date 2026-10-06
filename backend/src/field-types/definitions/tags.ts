import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

const configSchema = z.object({});

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
  normalize(input) {
    if (!Array.isArray(input)) return null;
    const arr = input.filter(x => x != null).map(String).map(s => s.trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  },
  toSearchText(value) { return value.join(', '); },
  toExportString(value) { return value.join(','); },
  parseImport(raw) {
    const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  },
  formComponent: 'TagsInput',
  cellComponent: 'TagsCell',
  filterComponent: 'MultiSelectFilter',
  isSortable: false,
  canBeIndexed: true,
  canBeUnique: false,
};
