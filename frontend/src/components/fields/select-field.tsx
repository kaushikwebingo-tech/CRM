import { FieldInputProps, FieldCellProps } from './types';
import { Badge } from '@/components/ui/badge';

interface OptionItem {
  id: string;
  label: string;
  color?: string;
}

export function SelectInput({ field, value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  const options = ((field.config as { options?: OptionItem[] })?.options || []);

  return (
    <div>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
      >
        <option value="">Select an option</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function SelectCell({ field, value }: FieldCellProps): JSX.Element {
  if (value === null || value === undefined || value === '') {
    return <span className="text-slate-400 font-normal">—</span>;
  }
  const options = ((field.config as { options?: OptionItem[] })?.options || []);
  const option = options.find((o) => o.id === value);
  const label = option ? option.label : String(value);

  return (
    <Badge variant="secondary" className="font-normal capitalize bg-slate-100 text-slate-700 hover:bg-slate-200">
      {label}
    </Badge>
  );
}

export function MultiSelectInput({ field, value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  const options = ((field.config as { options?: OptionItem[] })?.options || []);
  const selected: string[] = Array.isArray(value) ? value : [];

  const toggleOption = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((item) => item !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-slate-300 min-h-[42px] bg-white">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => toggleOption(opt.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                isSelected
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function MultiSelectCell({ field, value }: FieldCellProps): JSX.Element {
  if (!value || !Array.isArray(value) || value.length === 0) {
    return <span className="text-slate-400 font-normal">—</span>;
  }
  const options = ((field.config as { options?: OptionItem[] })?.options || []);

  return (
    <div className="flex flex-wrap gap-1">
      {value.map((v: string) => {
        const option = options.find((o) => o.id === v);
        const label = option ? option.label : v;
        return (
          <Badge key={v} variant="outline" className="text-xs font-normal">
            {label}
          </Badge>
        );
      })}
    </div>
  );
}
