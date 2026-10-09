import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { MAX_ARRAY_ITEMS } from '../shared';

const configSchema = z.object({});

type Config = z.infer<typeof configSchema>;

const FILE_OPERATORS: FilterOperator[] = [
  'is_empty', 'is_not_empty',
];

interface FileData {
  key: string;
  name: string;
  size: number;
  mime: string;
}

export const fileField: FieldTypeDef<Config, FileData[]> = {
  key: 'file',
  label: 'File',
  group: 'advanced',
  configSchema,
  valueSchema() {
    return z.array(z.object({
      key: z.string(),
      name: z.string(),
      size: z.number(),
      mime: z.string(),
    }));
  },
  sqlType: 'jsonb',
  operators: FILE_OPERATORS,
  normalize(input) {
    if (!Array.isArray(input)) return null;
    if (input.length > 50) return null;

    const files: { key: string; name: string; size: number; mime: string }[] = [];
    for (const item of input) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const candidate = item as Record<string, unknown>;
      const key = typeof candidate.key === 'string' ? candidate.key.trim() : '';
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
      if (!key || !name) return null;
      const size = Number(candidate.size);
      files.push({
        key,
        name,
        size: Number.isFinite(size) && size >= 0 ? size : 0,
        mime: typeof candidate.mime === 'string' ? candidate.mime : 'application/octet-stream',
      });
    }
    return files.length > 0 ? files : null;
  },
  toSearchText(value) {
    return Array.isArray(value) ? value.map((f) => f?.name ?? '').filter(Boolean).join(' ') : '';
  },
  toExportString(value) {
    return Array.isArray(value) ? value.map((f) => f?.name ?? '').filter(Boolean).join(', ') : '';
  },
  parseImport() {
    // Files cannot be created from a CSV cell.
    return null;
  },
  formComponent: 'FileInput',
  cellComponent: 'FileCell',
  filterComponent: 'BooleanFilter',
  isSortable: false,
  canBeIndexed: false,
  canBeUnique: false,
};
