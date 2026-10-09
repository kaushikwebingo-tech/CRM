import { useRef, useState } from 'react';
import { FieldInputProps, FieldCellProps } from './types';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Paperclip, X, Download, Loader2 } from 'lucide-react';

interface StoredFile {
  key: string;
  name: string;
  size: number;
  mime: string;
}

function asFileList(value: unknown): StoredFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is StoredFile => Boolean(f) && typeof f === 'object' && typeof (f as StoredFile).key === 'string',
  );
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * A real input for `file` fields.
 *
 * The registry previously mapped `file` to the plain TextInput, so opening a
 * record with attachments and saving replaced the stored array with the text
 * the box happened to contain — silent destruction of the attachments.
 */
export function FileInput({ field, value, onChange, error, disabled }: FieldInputProps): JSX.Element {
  const files = asFileList(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handlePick = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded: StoredFile[] = [];
      for (const file of Array.from(picked)) {
        const result = await api.upload<StoredFile>('/api/files/upload', file);
        uploaded.push({
          key: result.key,
          name: result.name,
          size: result.size,
          mime: result.mime,
        });
      }
      onChange([...files, ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={disabled || uploading}
        onChange={(e) => void handlePick(e.target.files)}
      />

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file) => (
            <li
              key={file.key}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate text-slate-700">{file.name}</span>
              {formatSize(file.size) && (
                <span className="shrink-0 text-[11px] text-slate-400">{formatSize(file.size)}</span>
              )}
              <a
                href={`/api/files/${file.key}`}
                className="shrink-0 text-slate-400 hover:text-blue-600"
                title={`Download ${file.name}`}
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(files.filter((f) => f.key !== file.key))}
                  className="shrink-0 text-slate-400 hover:text-rose-600"
                  title={`Remove ${file.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        className="text-xs"
      >
        {uploading ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Uploading…
          </>
        ) : (
          <>
            <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Attach {field.label.toLowerCase()}
          </>
        )}
      </Button>

      {(uploadError || error) && (
        <p className="text-xs text-rose-500">{uploadError || error}</p>
      )}
    </div>
  );
}

export function FileCell({ value }: FieldCellProps): JSX.Element {
  const files = asFileList(value);
  if (files.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
      <Paperclip className="h-3 w-3 text-slate-400" />
      {files.length === 1 ? files[0].name : `${files.length} files`}
    </span>
  );
}
