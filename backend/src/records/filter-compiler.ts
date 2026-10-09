import { ValidationError } from '../common/errors';
import { CompiledModule, SqlExpr } from '../metadata/schema-compiler';
import { FilterOperator } from '../field-types/types';

export interface FilterRule {
  field: string;
  op: FilterOperator;
  value?: unknown;
}

export interface FilterGroup {
  and?: (FilterRule | FilterGroup)[];
  or?: (FilterRule | FilterGroup)[];
}

export type FilterNode = FilterRule | FilterGroup;

const CORE_FIELDS: Record<string, { expr: string; type: string; operators: FilterOperator[] }> = {
  display_name: {
    expr: 'r.display_name',
    type: 'text',
    operators: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  },
  owner_id: {
    expr: 'r.owner_id',
    type: 'uuid',
    operators: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  },
  stage_id: {
    expr: 'r.stage_id',
    type: 'uuid',
    operators: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  },
  pipeline_id: {
    expr: 'r.pipeline_id',
    type: 'uuid',
    operators: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  },
  created_at: {
    expr: 'r.created_at',
    type: 'timestamptz',
    operators: ['eq', 'before', 'after', 'between', 'within', 'is_empty', 'is_not_empty'],
  },
  updated_at: {
    expr: 'r.updated_at',
    type: 'timestamptz',
    operators: ['eq', 'before', 'after', 'between', 'within', 'is_empty', 'is_not_empty'],
  },
};



const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function arrayCast(sqlType: string): string {
  switch (sqlType) {
    case 'uuid': return '::uuid[]';
    case 'numeric': return '::numeric[]';
    case 'date': return '::date[]';
    case 'timestamptz': return '::timestamptz[]';
    case 'boolean': return '::boolean[]';
    default: return '::text[]';
  }
}

type WithinWindow = {
  kind: 'range' | 'before' | 'after';
  lower: (tz: string) => string;
  upper?: (tz: string) => string;
};

/**
 * Each boundary is `date_trunc(... , now() AT TIME ZONE $tz)` converted back to
 * an instant, so Postgres handles the timezone and DST rather than the Node
 * process's local clock.
 */
const DAY = (offset: number) => (tz: string) =>
  `((date_trunc('day', (now() AT TIME ZONE ${tz})) + interval '${offset} day') AT TIME ZONE ${tz})`;
/**
 * Postgres has a `quarter` truncation unit but no `quarter` interval unit, so a
 * quarter offset has to be expressed in months.
 */
const TRUNC = (unit: string, offset: number) => (tz: string) => {
  const step = unit === 'quarter' ? `${offset * 3} month` : `${offset} ${unit}`;
  return `((date_trunc('${unit}', (now() AT TIME ZONE ${tz})) + interval '${step}') AT TIME ZONE ${tz})`;
};

const WITHIN_TOKENS: Record<string, WithinWindow> = {
  today:        { kind: 'range', lower: DAY(0),  upper: DAY(1) },
  yesterday:    { kind: 'range', lower: DAY(-1), upper: DAY(0) },
  tomorrow:     { kind: 'range', lower: DAY(1),  upper: DAY(2) },
  this_week:    { kind: 'range', lower: TRUNC('week', 0),    upper: TRUNC('week', 1) },
  last_week:    { kind: 'range', lower: TRUNC('week', -1),   upper: TRUNC('week', 0) },
  this_month:   { kind: 'range', lower: TRUNC('month', 0),   upper: TRUNC('month', 1) },
  last_month:   { kind: 'range', lower: TRUNC('month', -1),  upper: TRUNC('month', 0) },
  this_quarter: { kind: 'range', lower: TRUNC('quarter', 0), upper: TRUNC('quarter', 1) },
  last_quarter: { kind: 'range', lower: TRUNC('quarter', -1),upper: TRUNC('quarter', 0) },
  this_year:    { kind: 'range', lower: TRUNC('year', 0),    upper: TRUNC('year', 1) },
  last_7_days:  { kind: 'range', lower: DAY(-7), upper: DAY(1) },
  next_7_days:  { kind: 'range', lower: DAY(0),  upper: DAY(8) },
  last_30_days: { kind: 'range', lower: DAY(-30), upper: DAY(1) },
  next_30_days: { kind: 'range', lower: DAY(0),  upper: DAY(31) },
  overdue:      { kind: 'before', lower: DAY(0) },
  upcoming:     { kind: 'after',  lower: DAY(1) },
};

export class FilterCompiler {
  private params: unknown[] = [];
  private paramIndex = 1;

  constructor(
    private readonly module: CompiledModule,
    private readonly currentUserId?: string,
    initialParamIndex: number = 1,
    private readonly timezone: string = process.env.ORG_TIMEZONE || 'UTC'
  ) {
    this.paramIndex = initialParamIndex;
  }

  compile(node: unknown, depth: number = 0): { sql: string; params: unknown[] } {
    if (!node || typeof node !== 'object') {
      return { sql: '1=1', params: [] };
    }

    if (depth > 5) {
      throw new ValidationError('Filter nesting depth cannot exceed 5');
    }

    const group = node as FilterGroup;
    if (group.and || group.or) {
      return this.compileGroup(group, depth);
    }

    const rule = node as FilterRule;
    if (typeof rule.field === 'string' && typeof rule.op === 'string') {
      const sql = this.compileRule(rule);
      return { sql, params: this.params };
    }

    throw new ValidationError('Malformed filter expression');
  }

  private compileGroup(group: FilterGroup, depth: number): { sql: string; params: unknown[] } {
    const clauses: string[] = [];

    if (group.and !== undefined) {
      if (!Array.isArray(group.and)) {
        throw new ValidationError('Filter "and" must be an array');
      }
      if (group.and.length > 100) {
        throw new ValidationError('Filter group contains too many conditions');
      }
      clauses.push(
        group.and.length === 0
          ? '1=1'
          : `(${group.and.map((child) => this.compileNode(child, depth + 1)).join(' AND ')})`,
      );
    }

    if (group.or !== undefined) {
      if (!Array.isArray(group.or)) {
        throw new ValidationError('Filter "or" must be an array');
      }
      if (group.or.length > 100) {
        throw new ValidationError('Filter group contains too many conditions');
      }
      clauses.push(
        group.or.length === 0
          ? '1=0'
          : `(${group.or.map((child) => this.compileNode(child, depth + 1)).join(' OR ')})`,
      );
    }

    if (clauses.length === 0) {
      throw new ValidationError('Filter group must specify "and" or "or"');
    }

    // A group with both keys means both apply. Dropping one, as this used to,
    // silently widens the result set — the worst failure mode for a filter.
    return { sql: clauses.length === 1 ? clauses[0] : `(${clauses.join(' AND ')})`, params: this.params };
  }

  private compileNode(node: FilterNode, depth: number): string {
    if (depth > 5) {
      throw new ValidationError('Filter nesting depth cannot exceed 5');
    }

    const group = node as FilterGroup;
    if (group.and || group.or) {
      return this.compileGroup(group, depth).sql;
    }

    const rule = node as FilterRule;
    if (typeof rule.field === 'string' && typeof rule.op === 'string') {
      return this.compileRule(rule);
    }

    throw new ValidationError('Invalid filter node');
  }

  private compileRule(rule: FilterRule): string {
    const { field, op } = rule;
    let { value } = rule;

    let sqlExpr: string;
    let allowedOps: FilterOperator[];
    let fieldType: string;
    let sqlType: string;

    const compiledField = this.module.fieldsByKey.get(field);
    if (compiledField) {
      sqlExpr = compiledField.sqlExpr.sql;
      allowedOps = compiledField.operators;
      fieldType = compiledField.type;
      sqlType = compiledField.sqlExpr.type;
    } else if (CORE_FIELDS[field]) {
      sqlExpr = CORE_FIELDS[field].expr;
      allowedOps = CORE_FIELDS[field].operators;
      fieldType = CORE_FIELDS[field].type;
      sqlType = CORE_FIELDS[field].type;
    } else {
      throw new ValidationError(`Unknown field: ${field}`, [
        { field: 'filter', message: `"${field}" is not a field on this module` },
      ]);
    }

    if (!allowedOps.includes(op)) {
      throw new ValidationError(`Operator "${op}" is not allowed for field "${field}" of type "${fieldType}"`);
    }

    value = this.resolveMe(value);

    if (Array.isArray(value) && value.length > 1000) {
      throw new ValidationError('Array value in filter cannot exceed 1000 items');
    }

    // Plan Section 8 rule 3 binds every value, but binding a value of the wrong
    // shape still raises inside Postgres (22P02) and fails the whole query, so
    // the shape is checked here where it can still be a clean 400.
    value = this.assertValueShape(field, sqlType, op, value);

    switch (op) {
      case 'eq': {
        const placeholder = this.addParam(value);
        return `${sqlExpr} = ${placeholder}`;
      }

      case 'neq': {
        const placeholder = this.addParam(value);
        return `(${sqlExpr} IS NULL OR ${sqlExpr} != ${placeholder})`;
      }

      case 'gt': {
        const placeholder = this.addParam(value);
        return `${sqlExpr} > ${placeholder}`;
      }

      case 'gte': {
        const placeholder = this.addParam(value);
        return `${sqlExpr} >= ${placeholder}`;
      }

      case 'lt': {
        const placeholder = this.addParam(value);
        return `${sqlExpr} < ${placeholder}`;
      }

      case 'lte': {
        const placeholder = this.addParam(value);
        return `${sqlExpr} <= ${placeholder}`;
      }

      case 'between': {
        if (!Array.isArray(value) || value.length !== 2) {
          throw new ValidationError(`Operator "between" requires an array of 2 values`);
        }
        const p1 = this.addParam(value[0]);
        const p2 = this.addParam(value[1]);
        return `${sqlExpr} BETWEEN ${p1} AND ${p2}`;
      }

      case 'contains': {
        const placeholder = this.addParam(`%${String(value)}%`);
        return `${sqlExpr} ILIKE ${placeholder}`;
      }

      case 'not_contains': {
        const placeholder = this.addParam(`%${String(value)}%`);
        return `(${sqlExpr} IS NULL OR ${sqlExpr} NOT ILIKE ${placeholder})`;
      }

      case 'starts_with': {
        const placeholder = this.addParam(`${String(value)}%`);
        return `${sqlExpr} ILIKE ${placeholder}`;
      }

      case 'ends_with': {
        const placeholder = this.addParam(`%${String(value)}`);
        return `${sqlExpr} ILIKE ${placeholder}`;
      }

      case 'is_empty': {
        if (sqlType === 'jsonb') {
          return `(${sqlExpr} IS NULL OR ${sqlExpr} = '[]'::jsonb OR ${sqlExpr} = 'null'::jsonb)`;
        }
        if (sqlType === 'text') {
          return `(${sqlExpr} IS NULL OR ${sqlExpr} = '')`;
        }
        return `${sqlExpr} IS NULL`;
      }

      case 'is_not_empty': {
        if (sqlType === 'jsonb') {
          return `(${sqlExpr} IS NOT NULL AND ${sqlExpr} != '[]'::jsonb AND ${sqlExpr} != 'null'::jsonb)`;
        }
        if (sqlType === 'text') {
          return `(${sqlExpr} IS NOT NULL AND ${sqlExpr} != '')`;
        }
        return `${sqlExpr} IS NOT NULL`;
      }

      case 'is_true': {
        return `${sqlExpr} IS TRUE`;
      }

      case 'is_false': {
        return `${sqlExpr} IS FALSE`;
      }

      case 'in': {
        if (!Array.isArray(value)) {
          throw new ValidationError('Operator "in" requires an array value');
        }
        if (value.length === 0) return '1=0';
        const placeholder = this.addParam(value);
        return `${sqlExpr} = ANY(${placeholder}${arrayCast(sqlType)})`;
      }

      case 'not_in': {
        if (!Array.isArray(value)) {
          throw new ValidationError('Operator "not_in" requires an array value');
        }
        if (value.length === 0) return '1=1';
        const placeholder = this.addParam(value);
        return `(${sqlExpr} IS NULL OR NOT (${sqlExpr} = ANY(${placeholder}${arrayCast(sqlType)})))`;
      }

      case 'before': {
        const placeholder = this.addParam(value);
        return `${sqlExpr} < ${placeholder}`;
      }

      case 'after': {
        const placeholder = this.addParam(value);
        return `${sqlExpr} > ${placeholder}`;
      }

      case 'within': {
        return this.compileWithin(sqlExpr, value);
      }

      case 'has_any': {
        if (!Array.isArray(value)) throw new ValidationError('has_any requires an array');
        if (value.length === 0) return '1=0';
        const placeholder = this.addParam(value);
        return `${sqlExpr} ?| ${placeholder}::text[]`;
      }

      case 'has_all': {
        if (!Array.isArray(value)) throw new ValidationError('has_all requires an array');
        if (value.length === 0) return '1=1';
        const placeholder = this.addParam(value);
        return `${sqlExpr} ?& ${placeholder}::text[]`;
      }

      case 'has_none': {
        if (!Array.isArray(value)) throw new ValidationError('has_none requires an array');
        if (value.length === 0) return '1=1';
        const placeholder = this.addParam(value);
        return `NOT (${sqlExpr} ?| ${placeholder}::text[])`;
      }

      default:
        throw new ValidationError(`Unsupported operator: ${op}`);
    }
  }

  /**
   * Relative date tokens.
   *
   * Plan Section 8: "`within` takes a relative token rather than a date, so a
   * saved view stays correct tomorrow." The boundaries are computed in the
   * org's timezone, not the server's — "today" for a Kolkata team on a UTC box
   * is otherwise off by five and a half hours, which silently drops or adds a
   * day's worth of follow-ups.
   */

  /**
   * Rejects a value whose shape the bound parameter's type cannot accept.
   *
   * Without this, `{field:'owner_id', op:'in', value:['oops']}` reaches
   * Postgres, raises 22P02 and fails the entire list query. The value is also
   * normalised here (numeric strings to numbers) so a filter built by a form
   * does not depend on the client's JSON types.
   */
  private assertValueShape(
    field: string,
    sqlType: string,
    op: FilterOperator,
    value: unknown,
  ): unknown {
    const needsNoValue: FilterOperator[] = ['is_empty', 'is_not_empty', 'is_true', 'is_false'];
    if (needsNoValue.includes(op)) return value;

    // `within` carries a relative token ('today', 'this_quarter'), not a date,
    // so it is validated against the token table in compileWithin instead.
    if (op === 'within') return value;

    const check = (v: unknown): unknown => {
      if (v === null || v === undefined) return v;
      switch (sqlType) {
        case 'uuid':
          if (typeof v !== 'string' || !UUID_RE.test(v)) {
            throw new ValidationError(`"${field}" expects an id`, [
              { field: 'filter', message: `"${field}" expects an id` },
            ]);
          }
          return v;
        case 'numeric': {
          const n = typeof v === 'number' ? v : Number(v);
          if (!Number.isFinite(n)) {
            throw new ValidationError(`"${field}" expects a number`, [
              { field: 'filter', message: `"${field}" expects a number` },
            ]);
          }
          return n;
        }
        case 'boolean':
          if (typeof v === 'boolean') return v;
          if (v === 'true' || v === 'false') return v === 'true';
          throw new ValidationError(`"${field}" expects true or false`, [
            { field: 'filter', message: `"${field}" expects true or false` },
          ]);
        case 'date':
        case 'timestamptz': {
          if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) {
            throw new ValidationError(`"${field}" expects a date`, [
              { field: 'filter', message: `"${field}" expects a date` },
            ]);
          }
          const parsed = new Date(v);
          if (Number.isNaN(parsed.getTime())) {
            throw new ValidationError(`"${field}" expects a valid date`, [
              { field: 'filter', message: `"${field}" expects a valid date` },
            ]);
          }
          return v;
        }
        default:
          if (typeof v === 'object') {
            throw new ValidationError(`"${field}" expects a text value`, [
              { field: 'filter', message: `"${field}" expects a text value` },
            ]);
          }
          return typeof v === 'string' ? v : String(v);
      }
    };

    // jsonb containment operators compare against option ids, always text.
    if (op === 'has_any' || op === 'has_all' || op === 'has_none') {
      if (!Array.isArray(value)) {
        throw new ValidationError(`"${op}" requires an array`, [
          { field: 'filter', message: `"${op}" requires an array` },
        ]);
      }
      return value.map((v) => String(v));
    }

    return Array.isArray(value) ? value.map(check) : check(value);
  }

  private compileWithin(sqlExpr: string, token: unknown): string {
    const str = String(token);
    const window = WITHIN_TOKENS[str];
    if (!window) {
      throw new ValidationError(`Invalid "within" token: ${str}`, [
        { field: 'filter', message: `Unknown date range "${str}"` },
      ]);
    }

    const tz = this.addParam(this.timezone);

    if (window.kind === 'before') {
      return `${sqlExpr} < ${window.lower(tz)}`;
    }
    if (window.kind === 'after') {
      return `${sqlExpr} >= ${window.lower(tz)}`;
    }
    return `${sqlExpr} >= ${window.lower(tz)} AND ${sqlExpr} < ${window.upper!(tz)}`;
  }

  private resolveMe(value: unknown): unknown {
    if (value === '@me') {
      if (!this.currentUserId) {
        throw new ValidationError('Cannot resolve @me without an authenticated user');
      }
      return this.currentUserId;
    }
    if (Array.isArray(value)) {
      return value.map((v) => (v === '@me' ? this.resolveMe(v) : v));
    }
    return value;
  }

  private addParam(val: unknown): string {
    this.params.push(val);
    const placeholder = `$${this.paramIndex}`;
    this.paramIndex += 1;
    return placeholder;
  }
}
