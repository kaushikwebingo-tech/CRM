import { z } from 'zod';



export const MAX_TEXT_LENGTH = 100_000;
export const MAX_ARRAY_ITEMS = 500;
export const MAX_TAG_LENGTH = 120;


export function toScalarString(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') return input;
  if (typeof input === 'number') return Number.isFinite(input) ? String(input) : null;
  if (typeof input === 'boolean') return String(input);
  return null;
}

export function normalizeText(input: unknown, maxLength?: number): string | null {
  const s = toScalarString(input);
  if (s === null) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  const cap = Math.min(maxLength ?? MAX_TEXT_LENGTH, MAX_TEXT_LENGTH);
  return trimmed.length > cap ? null : trimmed;
}

export function normalizeNumber(
  input: unknown,
  opts: { min?: number; max?: number; precision?: number } = {},
): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'boolean') return null;
  if (typeof input === 'object') return null;

  let raw = typeof input === 'number' ? input : String(input).trim();
  if (typeof raw === 'string') {
    if (!raw) return null;
    raw = raw.replace(/[\s, ]/g, '').replace(/^[^\d+\-.]+/, '');
  }

  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  if (opts.precision !== undefined) {
    const factor = 10 ** opts.precision;
    return Math.round(n * factor) / factor;
  }
  return n;
}

const TRUE_TOKENS = new Set(['true', 't', '1', 'yes', 'y', 'on']);
const FALSE_TOKENS = new Set(['false', 'f', '0', 'no', 'n', 'off']);

export function normalizeBoolean(input: unknown): boolean | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'boolean') return input;
  if (typeof input === 'number') {
    if (input === 1) return true;
    if (input === 0) return false;
    return null;
  }
  const s = String(input).trim().toLowerCase();
  if (TRUE_TOKENS.has(s)) return true;
  if (FALSE_TOKENS.has(s)) return false;
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeUuid(input: unknown): string | null {
  const s = toScalarString(input);
  if (!s) return null;
  const trimmed = s.trim().toLowerCase();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
  );
}

export function normalizeDate(input: unknown): string | null {
  const s = toScalarString(input);
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return isRealDate(Number(y), Number(m), Number(d)) ? `${y}-${m}-${d}` : null;
  }

  const dmy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (!isRealDate(year, month, day)) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function normalizeDateTime(input: unknown): string | null {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input.toISOString();
  }
  const s = toScalarString(input);
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;

  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const ok = isRealDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    return ok ? `${trimmed}T00:00:00.000Z` : null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function normalizeStringArray(
  input: unknown,
  opts: { maxItems?: number; maxLength?: number } = {},
): string[] | null {
  const source = Array.isArray(input) ? input : input === null || input === undefined || input === '' ? [] : [input];
  if (source.length === 0) return null;
  if (source.length > (opts.maxItems ?? MAX_ARRAY_ITEMS)) return null;

  const seen = new Set<string>();
  for (const item of source) {
    const s = toScalarString(item);
    if (s === null) return null;
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (trimmed.length > (opts.maxLength ?? MAX_TAG_LENGTH)) return null;
    seen.add(trimmed);
  }

  return seen.size > 0 ? Array.from(seen) : null;
}

export function importCell(raw: unknown): string {
  const s = toScalarString(raw);
  return s === null ? '' : s.trim();
}


export const optionIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'Option ids may contain letters, numbers, _ and -');

export const optionSchema = z.object({
  id: optionIdSchema,
  label: z.string().min(1).max(120),
  color: z.string().max(40).optional(),
});

export const optionsConfigSchema = z
  .array(optionSchema)
  .max(500)
  .default([])
  .superRefine((options, ctx) => {
    const seen = new Set<string>();
    for (const option of options) {
      if (seen.has(option.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate option id "${option.id}"`,
        });
      }
      seen.add(option.id);
    }
  });

export function optionIds(options?: { id: string }[]): Set<string> {
  return new Set((options ?? []).map((o) => o.id));
}
