import { z } from 'zod';
import { FieldTypeDef, FilterOperator } from '../types';
import { toScalarString, importCell } from '../shared';


const configSchema = z.object({
  defaultCountry: z.string().length(2).toUpperCase().default('IN'),
  defaultDialCode: z.string().regex(/^\+\d{1,4}$/).optional(),
});

const DIAL_CODES: Record<string, string> = {
  IN: '+91', US: '+1', CA: '+1', GB: '+44', AE: '+971', SG: '+65',
  AU: '+61', NZ: '+64', DE: '+49', FR: '+33', NL: '+31', ZA: '+27',
  BD: '+880', LK: '+94', NP: '+977', PK: '+92', MY: '+60', ID: '+62',
};

type Config = z.infer<typeof configSchema>;

const TEXT_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
];

export const phoneField: FieldTypeDef<Config, string> = {
  key: 'phone',
  label: 'Phone',
  group: 'basic',
  configSchema,
  valueSchema() {
    return z.string().regex(/^\+\d{8,15}$/, 'Must be an E.164 phone number');
  },
  sqlType: 'text',
  operators: TEXT_OPERATORS,
  normalize(input, config) {
    const raw = toScalarString(input);
    if (!raw) return null;

    const cleaned = raw.replace(/[^\d+]/g, '');
    if (!cleaned) return null;

    if (cleaned.startsWith('+')) {
      const digits = cleaned.slice(1);
      return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
    }

    if (cleaned.startsWith('00')) {
      const digits = cleaned.slice(2);
      return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
    }

    const dial =
      config?.defaultDialCode ?? DIAL_CODES[(config?.defaultCountry ?? 'IN').toUpperCase()] ?? null;
    if (!dial) return null;

    const national = cleaned.replace(/^0+/, '');
    if (!/^\d{6,14}$/.test(national)) return null;

    const e164 = `${dial}${national}`;
    return /^\+\d{8,15}$/.test(e164) ? e164 : null;
  },
  toSearchText(value) { return value; },
  toExportString(value) { return value; },
  parseImport(raw, config) { return phoneField.normalize(importCell(raw), config); },
  formComponent: 'PhoneInput',
  cellComponent: 'PhoneCell',
  filterComponent: 'TextFilter',
  isSortable: true,
  canBeIndexed: true,
  canBeUnique: true,
};
