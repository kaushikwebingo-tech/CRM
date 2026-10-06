import { FieldInputProps, FieldCellProps } from './types';
import { Input } from '@/components/ui/input';

export function DateInput({ value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <Input
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className={error ? 'border-red-500' : ''}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function DateTimeInput({ value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <Input
        type="datetime-local"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className={error ? 'border-red-500' : ''}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function DateCell({ value }: FieldCellProps): JSX.Element {
  if (!value) {
    return <span className="text-slate-400 font-normal">—</span>;
  }
  try {
    const d = new Date(value);
    return <span className="text-slate-700 text-sm">{d.toLocaleDateString()}</span>;
  } catch {
    return <span className="text-slate-700 text-sm">{String(value)}</span>;
  }
}

export function DateTimeCell({ value }: FieldCellProps): JSX.Element {
  if (!value) {
    return <span className="text-slate-400 font-normal">—</span>;
  }
  try {
    const d = new Date(value);
    return <span className="text-slate-700 text-sm">{d.toLocaleString()}</span>;
  } catch {
    return <span className="text-slate-700 text-sm">{String(value)}</span>;
  }
}
