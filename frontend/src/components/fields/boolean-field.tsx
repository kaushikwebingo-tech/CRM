import { FieldInputProps, FieldCellProps } from './types';
import { Check, X } from 'lucide-react';

export function BooleanInput({ field, value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
        />
        <span className="text-sm text-slate-700">{field.label}</span>
      </label>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function BooleanCell({ value }: FieldCellProps): JSX.Element {
  if (value === null || value === undefined) {
    return <span className="text-slate-400 font-normal">—</span>;
  }
  return value ? (
    <span className="inline-flex items-center text-emerald-600">
      <Check className="h-4 w-4" />
    </span>
  ) : (
    <span className="inline-flex items-center text-slate-400">
      <X className="h-4 w-4" />
    </span>
  );
}
