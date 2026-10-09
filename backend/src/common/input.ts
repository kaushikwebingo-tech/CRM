import { ValidationError } from './errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export function asString(value: unknown, field?: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return last === undefined ? undefined : asString(last, field);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (field) {
    throw new ValidationError(`"${field}" must be a string`, [
      { field, message: 'Must be a string' },
    ]);
  }
  return undefined;
}

export function asTrimmedString(value: unknown, field?: string): string | undefined {
  const s = asString(value, field);
  if (s === undefined) return undefined;
  const t = s.trim();
  return t === '' ? undefined : t;
}

export function asInt(
  value: unknown,
  opts: { min: number; max: number; fallback: number },
): number {
  const s = asString(value);
  if (s === undefined || s.trim() === '') return opts.fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return opts.fallback;
  return Math.min(Math.max(Math.trunc(n), opts.min), opts.max);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function asUuid(value: unknown, field: string): string {
  const s = asString(value, field);
  if (!isUuid(s)) {
    throw new ValidationError(`"${field}" must be a UUID`, [
      { field, message: 'Must be a valid id' },
    ]);
  }
  return s;
}

export function asOptionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return asUuid(value, field);
}

export function asUuidArray(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`"${field}" must be a non-empty array of ids`, [
      { field, message: 'Must be a non-empty array of ids' },
    ]);
  }
  if (value.length > max) {
    throw new ValidationError(`"${field}" cannot contain more than ${max} ids`, [
      { field, message: `At most ${max} ids` },
    ]);
  }
  const bad = value.filter((v) => !isUuid(v));
  if (bad.length > 0) {
    throw new ValidationError(`"${field}" contains ${bad.length} value(s) that are not ids`, [
      { field, message: 'Contains an invalid id' },
    ]);
  }
  return value as string[];
}

export function asObject(value: unknown, field = 'body'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`"${field}" must be an object`, [
      { field, message: 'Must be an object' },
    ]);
  }
  return value as Record<string, unknown>;
}

export function asDataObject(value: unknown, maxKeys = 500): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  const obj = asObject(value, 'data');
  const keys = Object.keys(obj);
  if (keys.length > maxKeys) {
    throw new ValidationError(`"data" cannot contain more than ${maxKeys} keys`, [
      { field: 'data', message: `At most ${maxKeys} keys` },
    ]);
  }
  return obj;
}

export function parseJsonParam<T = unknown>(raw: unknown, field: string): T | undefined {
  const s = asString(raw, field);
  if (s === undefined || s.trim() === '') return undefined;
  if (s.length > 100_000) {
    throw new ValidationError(`"${field}" is too large`, [{ field, message: 'Too large' }]);
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    throw new ValidationError(`Invalid JSON in "${field}"`, [
      { field, message: 'Must be valid JSON' },
    ]);
  }
}

export function parseSort(raw: unknown): { key: string; dir: 'asc' | 'desc' } {
  const s = asString(raw);
  if (s === undefined || s.trim() === '') return { key: 'created_at', dir: 'desc' };
  const parts = s.split(':');
  if (parts.length > 2) {
    throw new ValidationError('"sort" must be "field" or "field:asc|desc"', [
      { field: 'sort', message: 'Must be "field" or "field:asc|desc"' },
    ]);
  }
  const key = parts[0].trim();
  if (!key || key.length > 64) {
    throw new ValidationError('"sort" must name a field', [
      { field: 'sort', message: 'Must name a field' },
    ]);
  }
  const rawDir = (parts[1] ?? 'desc').trim().toLowerCase();
  if (rawDir !== 'asc' && rawDir !== 'desc') {
    throw new ValidationError('"sort" direction must be "asc" or "desc"', [
      { field: 'sort', message: 'Direction must be asc or desc' },
    ]);
  }
  return { key, dir: rawDir };
}

export function parseFieldList(raw: unknown, max = 100): string[] | undefined {
  const s = asString(raw);
  if (s === undefined || s.trim() === '') return undefined;
  const keys = s
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, max);
  return keys.length > 0 ? keys : undefined;
}
