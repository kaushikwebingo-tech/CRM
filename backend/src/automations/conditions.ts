import { DomainEvent } from './automations.types';



interface Rule {
  field: string;
  op: string;
  value?: unknown;
}

interface Group {
  and?: (Rule | Group)[];
  or?: (Rule | Group)[];
}

type Node = Rule | Group;

const MAX_DEPTH = 5;

export function matchesConditions(
  conditions: unknown,
  record: { data?: Record<string, unknown>; stageId?: string | null; ownerId?: string | null } | null,
  event: DomainEvent,
): boolean {
  if (!conditions || typeof conditions !== 'object') return true;
  if (Object.keys(conditions as object).length === 0) return true;

  try {
    return evaluate(conditions as Node, record, event, 0);
  } catch {
    return false;
  }
}

function evaluate(
  node: Node,
  record: { data?: Record<string, unknown>; stageId?: string | null; ownerId?: string | null } | null,
  event: DomainEvent,
  depth: number,
): boolean {
  if (depth > MAX_DEPTH) return false;

  const group = node as Group;
  if (group.and || group.or) {
    let result = true;
    if (group.and) {
      if (!Array.isArray(group.and)) return false;
      result = group.and.every((child) => evaluate(child, record, event, depth + 1));
    }
    if (group.or) {
      if (!Array.isArray(group.or)) return false;
      const anyTrue = group.or.some((child) => evaluate(child, record, event, depth + 1));
      result = group.and ? result && anyTrue : anyTrue;
    }
    return result;
  }

  const rule = node as Rule;
  if (typeof rule.field !== 'string' || typeof rule.op !== 'string') return false;
  return evaluateRule(rule, record, event);
}

function resolveFieldValue(
  field: string,
  record: { data?: Record<string, unknown>; stageId?: string | null; ownerId?: string | null } | null,
  event: DomainEvent,
): unknown {
  switch (field) {
    case 'display_name':
      return event.snapshot?.display_name ?? null;
    case 'stage_id':
      return record?.stageId ?? event.snapshot?.stage_id ?? null;
    case 'owner_id':
      return record?.ownerId ?? null;
    default:
      return record?.data?.[field] ?? event.snapshot?.data?.[field] ?? null;
  }
}

function evaluateRule(
  rule: Rule,
  record: { data?: Record<string, unknown>; stageId?: string | null; ownerId?: string | null } | null,
  event: DomainEvent,
): boolean {
  const actual = resolveFieldValue(rule.field, record, event);
  const expected = rule.value;

  const asNumber = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const asText = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
  const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const isEmpty = (v: unknown) =>
    v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

  switch (rule.op) {
    case 'eq':
      return asText(actual) === asText(expected);
    case 'neq':
      return asText(actual) !== asText(expected);

    case 'contains':
      return asText(actual).toLowerCase().includes(asText(expected).toLowerCase());
    case 'not_contains':
      return !asText(actual).toLowerCase().includes(asText(expected).toLowerCase());
    case 'starts_with':
      return asText(actual).toLowerCase().startsWith(asText(expected).toLowerCase());
    case 'ends_with':
      return asText(actual).toLowerCase().endsWith(asText(expected).toLowerCase());

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = asNumber(actual);
      const b = asNumber(expected);
      if (a === null || b === null) {
        // fall back to a date comparison
        const da = Date.parse(asText(actual));
        const db = Date.parse(asText(expected));
        if (Number.isNaN(da) || Number.isNaN(db)) return false;
        return compare(rule.op, da, db);
      }
      return compare(rule.op, a, b);
    }

    case 'between': {
      const range = asArray(expected);
      if (range.length !== 2) return false;
      const a = asNumber(actual);
      const lo = asNumber(range[0]);
      const hi = asNumber(range[1]);
      if (a === null || lo === null || hi === null) return false;
      return a >= lo && a <= hi;
    }

    case 'before': {
      const da = Date.parse(asText(actual));
      const db = Date.parse(asText(expected));
      return !Number.isNaN(da) && !Number.isNaN(db) && da < db;
    }
    case 'after': {
      const da = Date.parse(asText(actual));
      const db = Date.parse(asText(expected));
      return !Number.isNaN(da) && !Number.isNaN(db) && da > db;
    }

    case 'is_true':
      return actual === true || actual === 'true';
    case 'is_false':
      return actual === false || actual === 'false';

    case 'in':
      return asArray(expected).map(asText).includes(asText(actual));
    case 'not_in':
      return !asArray(expected).map(asText).includes(asText(actual));

    case 'has_any': {
      const have = asArray(actual).map(asText);
      return asArray(expected).map(asText).some((v) => have.includes(v));
    }
    case 'has_all': {
      const have = asArray(actual).map(asText);
      return asArray(expected).map(asText).every((v) => have.includes(v));
    }
    case 'has_none': {
      const have = asArray(actual).map(asText);
      return !asArray(expected).map(asText).some((v) => have.includes(v));
    }

    case 'is_empty':
      return isEmpty(actual);
    case 'is_not_empty':
      return !isEmpty(actual);

    // "when this field changed", which is what makes a field-level trigger useful
    case 'changed':
      return Boolean(event.changes && rule.field in event.changes);
    case 'changed_to':
      return (
        Boolean(event.changes && rule.field in event.changes) &&
        asText(event.changes?.[rule.field]?.to) === asText(expected)
      );
    case 'changed_from':
      return (
        Boolean(event.changes && rule.field in event.changes) &&
        asText(event.changes?.[rule.field]?.from) === asText(expected)
      );

    default:
      return false;
  }
}

function compare(op: string, a: number, b: number): boolean {
  switch (op) {
    case 'gt': return a > b;
    case 'gte': return a >= b;
    case 'lt': return a < b;
    case 'lte': return a <= b;
    default: return false;
  }
}
