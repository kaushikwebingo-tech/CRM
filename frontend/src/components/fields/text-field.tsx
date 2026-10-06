import { FieldInputProps, FieldCellProps } from './types';
import { Input } from '@/components/ui/input';

export function TextInput({ field, value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <Input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={`Enter ${field.label.toLowerCase()}`}
        className={error ? 'border-red-500' : ''}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function LongTextInput({ field, value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder={`Enter ${field.label.toLowerCase()}`}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function TextCell({ value }: FieldCellProps): JSX.Element {
  if (value === null || value === undefined || value === '') {
    return <span className="text-slate-400 font-normal">—</span>;
  }
  return <span className="truncate text-slate-800">{String(value)}</span>;
}
