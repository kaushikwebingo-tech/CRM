import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FieldInputProps, FieldCellProps } from './types';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Link2, Hash, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { fetchRecords } from '@/api/records';

interface OrgUser {
  id: string;
  fullName: string;
  email: string;
  isActive?: boolean;
}


export function UserInput({ value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  const { data: users, isLoading } = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => api.get<OrgUser[]>('/api/users'),
    staleTime: 5 * 60 * 1000,
  });

  const options = useMemo(
    () => (users ?? []).filter((u) => u.isActive !== false),
    [users],
  );

  return (
    <div>
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || isLoading}
        className={`h-9 w-full rounded-md border bg-white px-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
          error ? 'border-red-500' : 'border-slate-300'
        }`}
      >
        <option value="">{isLoading ? 'Loading people…' : 'Unassigned'}</option>
        {options.map((user) => (
          <option key={user.id} value={user.id}>
            {user.fullName} ({user.email})
          </option>
        ))}
      </select>
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


export function LookupInput({
  field,
  value,
  onChange,
  error,
  disabled,
  record,
}: FieldInputProps & { record?: { _expanded?: Record<string, { displayName?: string }> } }): JSX.Element {
  const targetModuleKey = (field.config as { targetModuleKey?: string })?.targetModuleKey;
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ['lookup', targetModuleKey, search],
    queryFn: () =>
      fetchRecords(targetModuleKey as string, {
        q: search || undefined,
        limit: 20,
        fields: ['display_name'],
      }),
    enabled: Boolean(targetModuleKey) && open,
    staleTime: 30 * 1000,
  });

  const selectedLabel = record?._expanded?.[field.key]?.displayName;

  if (!targetModuleKey) {
    return (
      <p className="text-xs text-amber-600">
        This lookup has no target module configured yet.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {value && !open ? (
        <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
          <Link2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate">
            {selectedLabel ?? String(value)}
          </span>
          {!disabled && (
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-800"
              onClick={() => setOpen(true)}
            >
              Change
            </button>
          )}
        </div>
      ) : (
        <>
          <Input
            type="text"
            value={search}
            disabled={disabled}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={`Search ${targetModuleKey.replace(/_/g, ' ')}…`}
            className={error ? 'border-red-500' : ''}
          />
          {open && (
            <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm">
              {isFetching && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                </div>
              )}
              {!isFetching && (data?.records.length ?? 0) === 0 && (
                <p className="px-2 py-2 text-xs text-slate-400">No matches</p>
              )}
              {data?.records.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  {option.display_name}
                </button>
              ))}
              {value && (
                <button
                  type="button"
                  className="block w-full border-t border-slate-100 px-2 py-1.5 text-left text-xs text-rose-600 hover:bg-rose-50"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  Clear selection
                </button>
              )}
            </div>
          )}
        </>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
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
