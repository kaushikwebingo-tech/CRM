import { FieldInputProps, FieldCellProps } from './types';
import { Input } from '@/components/ui/input';
import { Mail, Phone, ExternalLink } from 'lucide-react';

export function EmailInput({ value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          type="email"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="name@company.com"
          className={`pl-9 ${error ? 'border-red-500' : ''}`}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function PhoneInput({ value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <div className="relative">
        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          type="tel"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="+919876543210"
          className={`pl-9 ${error ? 'border-red-500' : ''}`}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function UrlInput({ value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  return (
    <div>
      <Input
        type="url"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="https://example.com"
        className={error ? 'border-red-500' : ''}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function EmailCell({ value }: FieldCellProps): JSX.Element {
  if (!value) return <span className="text-slate-400 font-normal">—</span>;
  return (
    <a
      href={`mailto:${value}`}
      className="inline-flex items-center gap-1.5 text-blue-600 hover:underline text-sm font-medium"
      onClick={(e) => e.stopPropagation()}
    >
      <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      <span className="truncate">{String(value)}</span>
    </a>
  );
}

export function PhoneCell({ value }: FieldCellProps): JSX.Element {
  if (!value) return <span className="text-slate-400 font-normal">—</span>;
  return (
    <a
      href={`tel:${value}`}
      className="inline-flex items-center gap-1.5 text-slate-700 hover:text-blue-600 font-mono text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      <span>{String(value)}</span>
    </a>
  );
}

export function UrlCell({ value }: FieldCellProps): JSX.Element {
  if (!value) return <span className="text-slate-400 font-normal">—</span>;
  return (
    <a
      href={String(value)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="truncate">{String(value)}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}
