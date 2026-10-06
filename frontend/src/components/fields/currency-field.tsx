import { FieldInputProps, FieldCellProps } from './types';
import { Input } from '@/components/ui/input';

export function CurrencyInput({ field, value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  const currencyCode = (field.config as { currencyCode?: string })?.currencyCode || 'INR';

  return (
    <div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
          {currencyCode === 'INR' ? '₹' : currencyCode}
        </span>
        <Input
          type="number"
          value={value ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            onChange(val === '' ? null : Number(val));
          }}
          disabled={disabled}
          placeholder="0.00"
          className={`pl-8 ${error ? 'border-red-500' : ''}`}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function CurrencyCell({ field, value }: FieldCellProps): JSX.Element {
  if (value === null || value === undefined || value === '') {
    return <span className="text-slate-400 font-normal">—</span>;
  }
  const currencyCode = (field.config as { currencyCode?: string })?.currencyCode || 'INR';
  const symbol = currencyCode === 'INR' ? '₹' : `${currencyCode} `;
  return (
    <span className="font-mono text-slate-900 font-medium">
      {symbol}{Number(value).toLocaleString('en-IN')}
    </span>
  );
}
