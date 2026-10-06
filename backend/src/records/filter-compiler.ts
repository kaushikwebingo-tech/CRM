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

export class FilterCompiler {
  private params: unknown[] = [];
  private paramIndex = 1;

  constructor(
    private readonly module: CompiledModule,
    private readonly currentUserId?: string,
    initialParamIndex: number = 1
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
    if (group.and && Array.isArray(group.and)) {
      if (group.and.length === 0) return { sql: '1=1', params: this.params };
      if (group.and.length > 100) throw new ValidationError('Filter group contains too many conditions');
      const parts = group.and.map((child) => this.compileNode(child, depth + 1));
      return { sql: `(${parts.join(' AND ')})`, params: this.params };
    }

    if (group.or && Array.isArray(group.or)) {
      if (group.or.length === 0) return { sql: '1=0', params: this.params };
      if (group.or.length > 100) throw new ValidationError('Filter group contains too many conditions');
      const parts = group.or.map((child) => this.compileNode(child, depth + 1));
      return { sql: `(${parts.join(' OR ')})`, params: this.params };
    }

    throw new ValidationError('Filter group must specify "and" or "or"');
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

    if (CORE_FIELDS[field]) {
      sqlExpr = CORE_FIELDS[field].expr;
      allowedOps = CORE_FIELDS[field].operators;
      fieldType = CORE_FIELDS[field].type;
    } else {
      const compiledField = this.module.fieldsByKey.get(field);
      if (!compiledField) {
        throw new ValidationError(`Unknown field: ${field}`);
      }
      sqlExpr = compiledField.sqlExpr.sql;
      allowedOps = compiledField.operators;
      fieldType = compiledField.type;
    }

    if (!allowedOps.includes(op)) {
      throw new ValidationError(`Operator "${op}" is not allowed for field "${field}" of type "${fieldType}"`);
    }

    if (value === '@me') {
      if (!this.currentUserId) {
        throw new ValidationError('Cannot resolve @me without an authenticated user');
      }
      value = this.currentUserId;
    }

    if (Array.isArray(value) && value.length > 1000) {
      throw new ValidationError('Array value in filter cannot exceed 1000 items');
    }

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
        if (fieldType === 'multi_select' || fieldType === 'tags' || fieldType === 'file') {
          return `(${sqlExpr} IS NULL OR ${sqlExpr} = '[]'::jsonb)`;
        }
        return `(${sqlExpr} IS NULL OR ${sqlExpr}::text = '')`;
      }

      case 'is_not_empty': {
        if (fieldType === 'multi_select' || fieldType === 'tags' || fieldType === 'file') {
          return `(${sqlExpr} IS NOT NULL AND ${sqlExpr} != '[]'::jsonb)`;
        }
        return `(${sqlExpr} IS NOT NULL AND ${sqlExpr}::text != '')`;
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
        return `${sqlExpr} = ANY(${placeholder})`;
      }

      case 'not_in': {
        if (!Array.isArray(value)) {
          throw new ValidationError('Operator "not_in" requires an array value');
        }
        if (value.length === 0) return '1=1';
        const placeholder = this.addParam(value);
        return `(${sqlExpr} IS NULL OR NOT (${sqlExpr} = ANY(${placeholder})))`;
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
        return `${sqlExpr} ?| ${placeholder}`;
      }

      case 'has_all': {
        if (!Array.isArray(value)) throw new ValidationError('has_all requires an array');
        if (value.length === 0) return '1=1';
        const placeholder = this.addParam(value);
        return `${sqlExpr} ?& ${placeholder}`;
      }

      case 'has_none': {
        if (!Array.isArray(value)) throw new ValidationError('has_none requires an array');
        if (value.length === 0) return '1=1';
        const placeholder = this.addParam(value);
        return `NOT (${sqlExpr} ?| ${placeholder})`;
      }

      default:
        throw new ValidationError(`Unsupported operator: ${op}`);
    }
  }

  private compileWithin(sqlExpr: string, token: unknown): string {
    const now = new Date();
    const str = String(token);

    if (str === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const p1 = this.addParam(start.toISOString());
      const p2 = this.addParam(end.toISOString());
      return `${sqlExpr} >= ${p1} AND ${sqlExpr} <= ${p2}`;
    }

    if (str === 'yesterday') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      const p1 = this.addParam(start.toISOString());
      const p2 = this.addParam(end.toISOString());
      return `${sqlExpr} >= ${p1} AND ${sqlExpr} <= ${p2}`;
    }

    if (str === 'this_week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const start = new Date(now.setDate(diff));
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      const p1 = this.addParam(start.toISOString());
      const p2 = this.addParam(end.toISOString());
      return `${sqlExpr} >= ${p1} AND ${sqlExpr} <= ${p2}`;
    }

    if (str === 'last_7_days') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const p1 = this.addParam(start.toISOString());
      const p2 = this.addParam(now.toISOString());
      return `${sqlExpr} >= ${p1} AND ${sqlExpr} <= ${p2}`;
    }

    if (str === 'next_7_days') {
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const p1 = this.addParam(now.toISOString());
      const p2 = this.addParam(end.toISOString());
      return `${sqlExpr} >= ${p1} AND ${sqlExpr} <= ${p2}`;
    }

    if (str === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const p1 = this.addParam(start.toISOString());
      const p2 = this.addParam(end.toISOString());
      return `${sqlExpr} >= ${p1} AND ${sqlExpr} <= ${p2}`;
    }

    if (str === 'last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      const p1 = this.addParam(start.toISOString());
      const p2 = this.addParam(end.toISOString());
      return `${sqlExpr} >= ${p1} AND ${sqlExpr} <= ${p2}`;
    }

    if (str === 'overdue') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const p1 = this.addParam(todayStart.toISOString());
      return `${sqlExpr} < ${p1}`;
    }

    throw new ValidationError(`Invalid "within" token: ${str}`);
  }

  private addParam(val: unknown): string {
    this.params.push(val);
    const placeholder = `$${this.paramIndex}`;
    this.paramIndex += 1;
    return placeholder;
  }
}
