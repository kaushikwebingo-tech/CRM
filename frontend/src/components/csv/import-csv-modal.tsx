import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importCsv, ImportResult } from '@/api/records';
import { ModuleDef } from '@/api/schema';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { UploadCloud, CheckCircle, AlertCircle, FileText, ArrowRight } from 'lucide-react';
import { useToast } from '@/components/ui/toast';

export interface ImportCsvModalProps {
  module: ModuleDef;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportCsvModal({
  module,
  isOpen,
  onClose,
  onSuccess,
}: ImportCsvModalProps): JSX.Element {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);

  const resetState = () => {
    setCsvText('');
    setFileName('');
    setHeaders([]);
    setPreviewRows([]);
    setMappings({});
    setResult(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      setCsvText(text);

      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        const parsedHeaders = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
        setHeaders(parsedHeaders);

        const initialMappings: Record<string, string> = {};
        for (const h of parsedHeaders) {
          const lower = h.toLowerCase().replace(/[\s_-]+/g, '');
          const nameMatch = (module.nameFieldLabel || 'Name').toLowerCase().replace(/[\s_-]+/g, '');
          if (lower === 'name' || lower === 'displayname' || lower === nameMatch || lower === 'leadname' || lower === 'title') {
            initialMappings[h] = 'display_name';
            continue;
          }
          const matchedField = module.fields.find(
            (f) =>
              f.key.toLowerCase().replace(/[\s_-]+/g, '') === lower ||
              f.label.toLowerCase().replace(/[\s_-]+/g, '') === lower
          );
          if (matchedField) {
            initialMappings[h] = matchedField.key;
          }
        }
        setMappings(initialMappings);

        const previews = lines.slice(1, 4).map((line) =>
          line.split(',').map((c) => c.replace(/^"|"$/g, '').trim())
        );
        setPreviewRows(previews);
      }
    };
    reader.readAsText(file);
  };

  const importMut = useMutation({
    mutationFn: () => importCsv(module.key, csvText, mappings),
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['records', module.key] });
      onSuccess();
      toast({
        title: 'Import completed',
        description: `Successfully imported ${res.importedCount.toLocaleString()} records.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Import failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const availableFieldOptions = [
    { key: 'display_name', label: `${module.nameFieldLabel || 'Name'} (Primary Title)` },
    ...module.fields
      .filter((f) => !f.isSystem || f.key === 'display_name')
      .map((f) => ({ key: f.key, label: f.label })),
  ];

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetState();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <UploadCloud className="h-5 w-5 text-blue-600" />
            <span>Import {module.labelPlural} from CSV</span>
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-5 py-3">
            {!csvText ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-8 text-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-blue-50/20"
              >
                <input
                  type="file"
                  accept=".csv"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <div className="p-3 bg-blue-100 text-blue-600 rounded-full">
                    <UploadCloud className="h-6 w-6" />
                  </div>
                  <div className="text-sm font-semibold text-slate-800">
                    Click to select or drag and drop CSV file
                  </div>
                  <div className="text-xs text-slate-500">
                    Standard comma-separated format (.csv) up to 10,000 rows
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between bg-slate-100 px-3.5 py-2 rounded-lg text-xs">
                  <div className="flex items-center gap-2 text-slate-800 font-medium">
                    <FileText className="h-4 w-4 text-blue-600" />
                    <span>{fileName}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCsvText('');
                      setFileName('');
                      setHeaders([]);
                    }}
                    className="h-6 text-xs text-slate-500 hover:text-slate-800"
                  >
                    Change file
                  </Button>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Field Mapping
                  </div>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 max-h-56 overflow-y-auto">
                    {headers.map((hdr) => (
                      <div
                        key={hdr}
                        className="flex items-center justify-between px-3.5 py-2 text-xs hover:bg-slate-50"
                      >
                        <div className="font-mono text-slate-700 font-medium truncate w-1/3">
                          {hdr}
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0 mx-2" />
                        <div className="w-1/2">
                          <select
                            value={mappings[hdr] || ''}
                            onChange={(e) =>
                              setMappings((prev) => ({
                                ...prev,
                                [hdr]: e.target.value,
                              }))
                            }
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="">— Do not import —</option>
                            {availableFieldOptions.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {previewRows.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                      Preview (First {previewRows.length} rows)
                    </div>
                    <div className="border border-slate-200 rounded-lg overflow-x-auto text-[11px]">
                      <table className="w-full border-collapse">
                        <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                          <tr>
                            {headers.map((h) => (
                              <th key={h} className="px-3 py-1.5 text-left truncate">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewRows.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              {r.map((c, j) => (
                                <td key={j} className="px-3 py-1 text-slate-600 truncate max-w-[120px]">
                                  {c}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="py-6 flex flex-col items-center justify-center space-y-3">
            <div className="p-3 bg-emerald-100 text-emerald-600 rounded-full">
              <CheckCircle className="h-8 w-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-800">
              Import Completed Successfully
            </h3>
            <div className="text-xs text-slate-600 text-center space-y-1">
              <div>
                Imported <strong>{result.importedCount.toLocaleString()}</strong> of{' '}
                {result.totalRows.toLocaleString()} rows.
              </div>
              {result.failedCount > 0 && (
                <div className="text-amber-600 flex items-center justify-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{result.failedCount} rows failed</span>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetState();
                  onClose();
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!csvText || importMut.isPending}
                onClick={() => importMut.mutate()}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {importMut.isPending ? 'Importing...' : 'Start Import'}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                resetState();
                onClose();
              }}
              className="bg-slate-900 text-white hover:bg-slate-800"
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
