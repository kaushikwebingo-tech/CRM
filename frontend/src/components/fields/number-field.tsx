import { FieldInputProps, FieldCellProps } from './types';
import { Input } from '@/components/ui/input';

export function NumberInput({ field, value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <Input
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val === '' ? null : Number(val));
        }}
        disabled={disabled}
        placeholder={`Enter ${field.label.toLowerCase()}`}
        className={error ? 'border-red-500' : ''}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function NumberCell({ value }: FieldCellProps): JSX.Element {
  if (value === null || value === undefined || value === '') {
    return <span className="text-slate-400 font-normal">—</span>;
  }
  return <span className="text-slate-800 font-mono text-sm">{Number(value).toLocaleString()}</span>;
}

export function PercentCell({ value }: FieldCellProps): JSX.Element {
  if (value === null || value === undefined || value === '') {
    return <span className="text-slate-400 font-normal">—</span>;
  }
  return <span className="text-slate-800 font-mono text-sm">{Number(value)}%</span>;
}
