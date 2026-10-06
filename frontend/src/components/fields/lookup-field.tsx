import { FieldInputProps, FieldCellProps } from './types';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Link2, Hash } from 'lucide-react';

export function UserInput({ value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <Input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        placeholder="Assign user ID"
        className={error ? 'border-red-500' : ''}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function UserCell({ value, record }: FieldCellProps): JSX.Element {
  if (record?.owner?.fullName) {
    return (
      <div className="inline-flex items-center gap-1.5 text-sm text-slate-800">
        <span className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-semibold">
          {record.owner.fullName.charAt(0).toUpperCase()}
        </span>
        <span className="truncate">{record.owner.fullName}</span>
      </div>
    );
  }
  if (!value) return <span className="text-slate-400 font-normal">—</span>;
  return <span className="text-xs text-slate-500 font-mono truncate">{String(value)}</span>;
}

export function LookupInput({ value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <Input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        placeholder="Target record ID"
        className={error ? 'border-red-500' : ''}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function LookupCell({ field, value, record }: FieldCellProps): JSX.Element {
  const expanded = record?._expanded?.[field.key];
  if (expanded?.displayName) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-blue-600 font-medium">
        <Link2 className="h-3.5 w-3.5 text-slate-400" />
        <span className="truncate">{expanded.displayName}</span>
      </span>
    );
  }
  if (!value) return <span className="text-slate-400 font-normal">—</span>;
  return <span className="text-xs text-slate-500 font-mono truncate">{String(value)}</span>;
}

export function AutoNumberInput({ value }: FieldInputProps): JSX.Element {
  return (
    <div className="relative">
      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      <Input
        type="text"
        value={value ? String(value) : 'Auto-generated on save'}
        disabled={true}
        className="pl-9 bg-slate-50 text-slate-500 cursor-not-allowed"
      />
    </div>
  );
}

export function AutoNumberCell({ value }: FieldCellProps): JSX.Element {
  if (value === null || value === undefined) return <span className="text-slate-400 font-normal">—</span>;
  return (
    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
      #{value}
    </span>
  );
}

export function TagsInput({ value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  const rawStr = Array.isArray(value) ? value.join(', ') : (value ?? '');

  return (
    <div>
      <Input
        type="text"
        value={rawStr}
        onChange={(e) => {
          const str = e.target.value;
          const tags = str.split(',').map((s) => s.trim()).filter(Boolean);
          onChange(tags.length > 0 ? tags : null);
        }}
        disabled={disabled}
        placeholder="tag1, tag2, tag3"
        className={error ? 'border-red-500' : ''}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function TagsCell({ value }: FieldCellProps): JSX.Element {
  if (!value || !Array.isArray(value) || value.length === 0) {
    return <span className="text-slate-400 font-normal">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {value.map((t: string) => (
        <Badge key={t} variant="secondary" className="text-[11px] font-normal px-1.5 py-0">
          {t}
        </Badge>
      ))}
    </div>
  );
}
