import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { normalizeText, importCell } from '../shared';

const configSchema = z.object({});


const SAFE_SCHEMES = new Set(['http:', 'https:']);

type Config = z.infer<typeof configSchema>;

const TEXT_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
];

export const urlField: FieldTypeDef<Config, string> = {
  key: 'url',
  label: 'URL',
  group: 'basic',
  configSchema,
  valueSchema() {
    return z.string().url();
  },
  sqlType: 'text',
  operators: TEXT_OPERATORS,
  normalize(input) {
    const value = normalizeText(input, 2000);
    if (!value) return null;
    const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(candidate);
      if (!SAFE_SCHEMES.has(url.protocol)) return null;
      if (!url.hostname) return null;
      return url.toString();
    } catch {
      return null;
    }
  },
  toSearchText(value) { return value; },
  toExportString(value) { return value; },
  parseImport(raw) { return urlField.normalize(importCell(raw), {}); },
  formComponent: 'UrlInput',
  cellComponent: 'UrlCell',
  filterComponent: 'TextFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: false,
};
