import { useState, useEffect, useMemo } from 'react';
import { ModuleDef } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ListFilter, Plus, Trash2, Bookmark, Check } from 'lucide-react';
import { cn, generateId } from '@/lib/utils';

export interface FilterCondition {
  id: string;
  field: string;
  op: string;
  value: any;
}

export interface FilterBuilderProps {
  moduleDef: ModuleDef;
  pipelineStages?: Array<{ id: string; label: string }>;
  appliedFilter: Record<string, unknown> | null;
  onApplyFilter: (filter: Record<string, unknown> | null) => void;
  onSaveAsView?: () => void;
}

interface FieldOption {
  key: string;
  label: string;
  type: string;
  /** Operators the backend registry allows for this field. */
  operators?: string[];
  /** For core columns, which have no registry row. */
  coreType?: 'text' | 'uuid' | 'date';
  options?: Array<{ id: string; label: string }>;
}

const WITHIN_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'next_7_days', label: 'Next 7 days' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'last_quarter', label: 'Last quarter' },
  { id: 'this_year', label: 'This year' },
  { id: 'last_30_days', label: 'Last 30 days' },
  { id: 'next_30_days', label: 'Next 30 days' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'upcoming', label: 'Upcoming' },
];

/**
 * Human labels for every operator the backend field-type registry can declare.
 *
 * The operator *list* is never decided here — it comes from the field's
 * `operators`, which the schema bundle carries from the backend registry. The
 * previous version switched on `type`, so multi_select, tags, lookup and file
 * all fell through to the text branch and sent `contains` on a jsonb column,
 * which the API correctly rejects. Guardrail 14: behaviour belongs to the field
 * type, declared once.
 */
const OPERATOR_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  gt: 'greater than',
  gte: 'greater than or equal to',
  lt: 'less than',
  lte: 'less than or equal to',
  between: 'is between',
  before: 'is before',
  after: 'is after',
  within: 'is within',
  is_true: 'is yes',
  is_false: 'is no',
  in: 'is any of',
  not_in: 'is none of',
  has_any: 'has any of',
  has_all: 'has all of',
  has_none: 'has none of',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

/** Operators that take no value at all. */
const VALUELESS_OPERATORS = new Set(['is_empty', 'is_not_empty', 'is_true', 'is_false']);

/** Operators whose value is a list. */
const MULTI_VALUE_OPERATORS = new Set(['in', 'not_in', 'has_any', 'has_all', 'has_none']);

/** Fallback for core columns, which have no row in the field registry. */
const CORE_OPERATORS: Record<string, string[]> = {
  text: ['contains', 'eq', 'neq', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  uuid: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  date: ['within', 'before', 'after', 'eq', 'is_empty', 'is_not_empty'],
};

function getOperatorsForField(field: FieldOption): Array<{ key: string; label: string }> {
  const declared =
    field.operators && field.operators.length > 0
      ? field.operators
      : CORE_OPERATORS[field.coreType ?? 'text'] ?? CORE_OPERATORS.text;

  return declared.map((key) => ({ key, label: OPERATOR_LABELS[key] ?? key }));
}

function parseFilterToConditions(filter: any): FilterCondition[] {
  if (!filter || typeof filter !== 'object') return [];
  if (Array.isArray(filter.and)) {
    return filter.and
      .filter((item: any) => item && typeof item === 'object' && item.field && item.op)
      .map((item: any) => ({
        id: generateId(),
        field: String(item.field),
        op: String(item.op),
        value: item.value ?? '',
      }));
  }
  if (filter.field && filter.op) {
    return [
      {
        id: generateId(),
        field: String(filter.field),
        op: String(filter.op),
        value: filter.value ?? '',
      },
    ];
  }
  return [];
}

export function FilterBuilder({
  moduleDef,
  pipelineStages = [],
  appliedFilter,
  onApplyFilter,
  onSaveAsView,
}: FilterBuilderProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);

  useEffect(() => {
    setConditions(parseFilterToConditions(appliedFilter));
  }, [appliedFilter]);

  const availableFields = useMemo<FieldOption[]>(() => {
    // display_name is the one field key this component may name (Guardrail 13);
    // the core columns below are record columns, not dynamic fields.
    const list: FieldOption[] = [
      {
        key: 'display_name',
        label: moduleDef.nameFieldLabel || 'Name',
        type: 'text',
        coreType: 'text',
      },
    ];

    if (moduleDef.hasPipeline) {
      list.push({
        key: 'stage_id',
        label: 'Stage',
        type: 'stage',
        coreType: 'uuid',
        options: pipelineStages.map((st) => ({ id: st.id, label: st.label })),
      });
    }

    list.push({ key: 'created_at', label: 'Created', type: 'datetime', coreType: 'date' });
    list.push({ key: 'updated_at', label: 'Last updated', type: 'datetime', coreType: 'date' });

    for (const f of moduleDef.fields) {
      if (f.key === 'display_name') continue;

      // Any type whose config declares options contributes a picker, so a new
      // option-bearing type needs no change here.
      const rawOptions = (f.config as { options?: unknown })?.options;
      const opts = Array.isArray(rawOptions)
        ? rawOptions.map((o: any) =>
            typeof o === 'string'
              ? { id: o, label: o }
              : { id: String(o?.id ?? o?.value ?? o?.label ?? ''), label: String(o?.label ?? o?.id ?? '') },
          ).filter((o) => o.id)
        : undefined;

      list.push({
        key: f.key,
        label: f.label,
        type: f.type,
        operators: f.operators,
        options: opts,
      });
    }

    return list;
  }, [moduleDef, pipelineStages]);

  const numericFieldSet = useMemo(() => {
    const s = new Set<string>();
    for (const f of availableFields) {
      if (['number', 'currency', 'percent'].includes(f.type)) {
        s.add(f.key);
      }
    }
    return s;
  }, [availableFields]);

  const activeCount = useMemo(() => {
    return parseFilterToConditions(appliedFilter).length;
  }, [appliedFilter]);

  const handleAddCondition = () => {
    const defaultField = availableFields[0]?.key || 'display_name';
    const ops = getOperatorsForField(availableFields[0] ?? { key: 'display_name', label: '', type: 'text', coreType: 'text' as const });
    setConditions((prev) => [
      ...prev,
      {
        id: generateId(),
        field: defaultField,
        op: ops[0]?.key || 'eq',
        value: '',
      },
    ]);
  };

  const handleRemoveCondition = (id: string) => {
    setConditions((prev) => prev.filter((c) => c.id !== id));
  };

  const handleFieldChange = (id: string, newFieldKey: string) => {
    const targetField = availableFields.find((f) => f.key === newFieldKey);
    const ops = getOperatorsForField(targetField ?? { key: 'display_name', label: '', type: 'text', coreType: 'text' as const });
    setConditions((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const newOp = ops[0]?.key || 'eq';
        let defaultValue = '';
        if (targetField?.type === 'stage' && targetField.options?.[0]) {
          defaultValue = targetField.options[0].id;
        } else if (targetField?.type === 'select' && targetField.options?.[0]) {
          defaultValue = targetField.options[0].id;
        } else if (newOp === 'within') {
          defaultValue = 'today';
        }
        return {
          ...c,
          field: newFieldKey,
          op: newOp,
          value: defaultValue,
        };
      })
    );
  };

  const handleOpChange = (id: string, newOp: string) => {
    setConditions((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        let val = c.value;
        if (VALUELESS_OPERATORS.has(newOp)) {
          val = '';
        } else if (newOp === 'within' && (!val || !WITHIN_OPTIONS.some((o) => o.id === val))) {
          val = 'today';
        }
        return {
          ...c,
          op: newOp,
          value: val,
        };
      })
    );
  };

  const handleValueChange = (id: string, newValue: any) => {
    setConditions((prev) =>
      prev.map((c) => (c.id === id ? { ...c, value: newValue } : c))
    );
  };

  const handleApply = () => {
    const valid = conditions.filter((c) => {
      if (!c.field || !c.op) return false;
      if (VALUELESS_OPERATORS.has(c.op)) return true;
      return c.value !== '' && c.value !== undefined && c.value !== null;
    });

    if (valid.length === 0) {
      onApplyFilter(null);
      setOpen(false);
      return;
    }

    const payload = {
      and: valid.map((c) => {
        const isNum = numericFieldSet.has(c.field);
        const parsedVal = isNum && !Number.isNaN(Number(c.value)) ? Number(c.value) : c.value;
        if (VALUELESS_OPERATORS.has(c.op)) {
          return { field: c.field, op: c.op };
        }
        return { field: c.field, op: c.op, value: parsedVal };
      }),
    };

    onApplyFilter(payload);
    setOpen(false);
  };

  const handleClear = () => {
    setConditions([]);
    onApplyFilter(null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-9 px-3 text-xs gap-1.5 border-slate-200 text-slate-700 hover:text-slate-900 transition-all',
            activeCount > 0 &&
              'bg-blue-50/70 border-blue-300 text-blue-700 font-semibold hover:bg-blue-100/70'
          )}
        >
          <ListFilter className="h-3.5 w-3.5" />
          <span>Filter</span>
          {activeCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-bold bg-blue-600 text-white leading-none">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[540px] max-w-[95vw] p-0 shadow-2xl border-slate-200 rounded-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-slate-50/50 rounded-t-xl">
          <div className="flex items-center gap-2">
            <ListFilter className="h-4 w-4 text-slate-600" />
            <h3 className="text-xs font-semibold text-slate-900">
              Filter {moduleDef.labelPlural}
            </h3>
          </div>
          {conditions.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="text-[11px] font-medium text-slate-500 hover:text-red-600 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="p-4 space-y-2.5 max-h-[360px] overflow-y-auto">
          {conditions.length === 0 ? (
            <div className="text-center py-6 px-4">
              <p className="text-xs text-slate-500">No filter conditions applied.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddCondition}
                className="mt-3 h-8 text-xs gap-1.5 border-dashed"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add condition</span>
              </Button>
            </div>
          ) : (
            conditions.map((cond, index) => {
              const currentField = availableFields.find((f) => f.key === cond.field);
              const fieldType = currentField?.type || 'text';
              const ops = getOperatorsForField(currentField ?? { key: 'display_name', label: '', type: 'text', coreType: 'text' as const });
              const isNoValueOp = VALUELESS_OPERATORS.has(cond.op);
              const isMultiValueOp = MULTI_VALUE_OPERATORS.has(cond.op);

              return (
                <div
                  key={cond.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-xs"
                >
                  <span className="w-12 text-[11px] font-semibold uppercase text-slate-400 shrink-0 text-center">
                    {index === 0 ? 'Where' : 'And'}
                  </span>

                  <select
                    value={cond.field}
                    onChange={(e) => handleFieldChange(cond.id, e.target.value)}
                    className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 shrink-0 max-w-[130px]"
                  >
                    {availableFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={cond.op}
                    onChange={(e) => handleOpChange(cond.id, e.target.value)}
                    className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 shrink-0 max-w-[120px]"
                  >
                    {ops.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>

                  <div className="flex-1 min-w-0">
                    {isNoValueOp ? (
                      <span className="text-[11px] italic text-slate-400 px-2">No value needed</span>
                    ) : cond.op === 'within' ? (
                      <select
                        value={cond.value || 'today'}
                        onChange={(e) => handleValueChange(cond.id, e.target.value)}
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {WITHIN_OPTIONS.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.label}
                          </option>
                        ))}
                      </select>
                    ) : isMultiValueOp && currentField?.options && currentField.options.length > 0 ? (
                      // in / not_in / has_any / has_all / has_none take a list,
                      // which is exactly what multi_select and tags filters need.
                      <select
                        multiple
                        value={Array.isArray(cond.value) ? cond.value : cond.value ? [cond.value] : []}
                        onChange={(e) =>
                          handleValueChange(
                            cond.id,
                            Array.from(e.target.selectedOptions).map((o) => o.value),
                          )
                        }
                        className="min-h-[64px] w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {currentField.options.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : isMultiValueOp ? (
                      // A free-form list (tags has no option list of its own).
                      <Input
                        type="text"
                        placeholder="Comma-separated values..."
                        value={Array.isArray(cond.value) ? cond.value.join(', ') : cond.value}
                        onChange={(e) =>
                          handleValueChange(
                            cond.id,
                            e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                          )
                        }
                        className="h-8 text-xs"
                      />
                    ) : currentField?.options && currentField.options.length > 0 ? (
                      <select
                        value={cond.value}
                        onChange={(e) => handleValueChange(cond.id, e.target.value)}
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">Select option...</option>
                        {currentField.options.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : ['number', 'currency', 'percent'].includes(fieldType) ? (
                      <Input
                        type="number"
                        placeholder="Number value..."
                        value={cond.value}
                        onChange={(e) => handleValueChange(cond.id, e.target.value)}
                        className="h-8 text-xs"
                      />
                    ) : ['date', 'datetime'].includes(fieldType) ? (
                      <Input
                        type="date"
                        value={cond.value}
                        onChange={(e) => handleValueChange(cond.id, e.target.value)}
                        className="h-8 text-xs"
                      />
                    ) : (
                      <Input
                        type="text"
                        placeholder="Filter value..."
                        value={cond.value}
                        onChange={(e) => handleValueChange(cond.id, e.target.value)}
                        className="h-8 text-xs"
                      />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveCondition(cond.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 transition-colors shrink-0 rounded-md hover:bg-slate-100"
                    title="Remove condition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {conditions.length > 0 && (
          <div className="px-4 pb-2">
            <button
              type="button"
              onClick={handleAddCondition}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 py-1"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add another condition</span>
            </button>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 bg-slate-50/50 rounded-b-xl">
          <div>
            {onSaveAsView && conditions.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  handleApply();
                  onSaveAsView();
                }}
                className="h-8 text-xs gap-1.5 text-slate-600 hover:text-slate-900"
                title="Save current filters as a new View tab"
              >
                <Bookmark className="h-3.5 w-3.5" />
                <span>Save as View</span>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Apply Filters</span>
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
