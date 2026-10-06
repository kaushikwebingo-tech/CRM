import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';

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
    return input.length > 0 ? input : null;
  },
  toSearchText(value) { return value.map(v => v.name).join(', '); },
  toExportString(value) { return value.map(v => v.name).join(', '); },
  parseImport() { return null; },
  formComponent: 'FileInput',
  cellComponent: 'FileCell',
  filterComponent: 'BooleanFilter',
  isSortable: false,
  canBeIndexed: false,
  canBeUnique: false,
};
