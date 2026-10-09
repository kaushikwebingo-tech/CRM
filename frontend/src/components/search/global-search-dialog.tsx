import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { searchGlobal, SearchResultItem } from '@/api/records';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, Clock, User, ArrowRight, CornerDownLeft } from 'lucide-react';

export interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: GlobalSearchDialogProps): JSX.Element {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTerm(searchTerm.trim());
    }, 200);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => {
    if (!open) {
      setSearchTerm('');
      setDebouncedTerm('');
    }
  }, [open]);

  const { data: results = [], isLoading } = useQuery<SearchResultItem[]>({
    queryKey: ['global-search', debouncedTerm],
    queryFn: () => (debouncedTerm ? searchGlobal(debouncedTerm) : Promise.resolve([])),
    enabled: Boolean(debouncedTerm && open),
  });

  const handleSelect = (item: SearchResultItem) => {
    onOpenChange(false);
    navigate(`/m/${item.module_key}/${item.id}`);
  };

  const grouped = results.reduce<Record<string, SearchResultItem[]>>((acc, item) => {
    const key = item.module_label || 'Records';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden rounded-xl shadow-2xl border border-slate-200">
        <div className="flex items-center border-b border-slate-200 px-4 py-3 bg-slate-50/50">
          <Search className="h-5 w-5 text-slate-400 shrink-0 mr-3" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search records across all modules (leads, contacts, companies)..."
            className="border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-slate-400 p-0 h-auto shadow-none"
            autoFocus
          />
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-600 shrink-0 ml-2" />}
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {!searchTerm.trim() ? (
            <div className="py-10 text-center text-xs text-slate-400 space-y-1">
              <p className="font-medium text-slate-600">Global Universal Search</p>
              <p>Type a name, email, company, or requirement to search across modules.</p>
            </div>
          ) : isLoading ? (
            <div className="py-10 text-center text-xs text-slate-400">Searching...</div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              No records found matching <span className="font-semibold text-slate-800">"{debouncedTerm}"</span>.
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).map(([groupName, items]) => (
                <div key={groupName} className="space-y-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3 py-1">
                    {groupName} ({items.length})
                  </div>
                  <div className="space-y-0.5">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelect(item)}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-blue-50/70 transition-colors flex items-center justify-between group"
                      >
                        <div className="min-w-0 pr-3 space-y-0.5">
                          <div className="text-sm font-semibold text-slate-800 group-hover:text-blue-600 truncate flex items-center gap-2">
                            <span>{item.display_name}</span>
                            <Badge variant="outline" className="text-[10px] font-medium py-0 px-1.5 h-4 text-slate-500">
                              {item.module_label}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-400">
                            {item.owner_name && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                <span>{item.owner_name}</span>
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              <span>{new Date(item.updated_at).toLocaleDateString()}</span>
                            </span>
                          </div>
                        </div>

                        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-blue-600 flex items-center gap-1 text-xs font-medium">
                          <span>Open</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <span>Navigation:</span>
            <kbd className="bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
              ESC to close
            </kbd>
          </div>
          <div className="flex items-center gap-1">
            <span>Select:</span>
            <CornerDownLeft className="h-3 w-3" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
