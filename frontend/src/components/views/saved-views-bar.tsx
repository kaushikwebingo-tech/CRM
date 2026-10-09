import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchViews, createView, deleteView, SavedView } from '@/api/records';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { X, Bookmark, LayoutGrid, Table } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';

export interface SavedViewsBarProps {
  moduleKey: string;
  activeViewId: string | null;
  onSelectView: (view: SavedView | null) => void;
  currentFilter?: Record<string, unknown>;
  currentSort?: string;
  currentType?: 'table' | 'kanban';
}

export function SavedViewsBar({
  moduleKey,
  activeViewId,
  onSelectView,
  currentFilter,
  currentSort,
  currentType = 'table',
}: SavedViewsBarProps): JSX.Element {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [viewName, setViewName] = useState('');

  const { data: views = [] } = useQuery({
    queryKey: ['views', moduleKey],
    queryFn: () => fetchViews(moduleKey),
    enabled: Boolean(moduleKey),
  });

  const createMut = useMutation({
    mutationFn: (data: { name: string; type: string; config: Record<string, unknown> }) =>
      createView(moduleKey, data),
    onSuccess: (newView) => {
      queryClient.invalidateQueries({ queryKey: ['views', moduleKey] });
      setModalOpen(false);
      setViewName('');
      onSelectView(newView);
      toast({
        title: 'View saved',
        description: `View "${newView.name}" has been saved.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to save view',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteView(moduleKey, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views', moduleKey] });
      onSelectView(null);
      toast({
        title: 'View deleted',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to delete view',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleSave = () => {
    if (!viewName.trim()) return;
    createMut.mutate({
      name: viewName.trim(),
      type: currentType,
      config: {
        filter: currentFilter,
        sort: currentSort,
      },
    });
  };

  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-2.5">
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        <button
          type="button"
          onClick={() => onSelectView(null)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
            activeViewId === null
              ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          All
        </button>

        {views.map((v) => {
          const isActive = activeViewId === v.id;
          return (
            <div
              key={v.id}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectView(v)}
                className="flex items-center gap-1.5"
              >
                {v.type === 'kanban' ? (
                  <LayoutGrid className="h-3 w-3 text-slate-400 group-hover:text-slate-600" />
                ) : (
                  <Table className="h-3 w-3 text-slate-400 group-hover:text-slate-600" />
                )}
                <span>{v.name}</span>
              </button>

              {!v.isDefault && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await confirm({
                      title: 'Delete Saved View',
                      description: `Are you sure you want to delete view "${v.name}"? This action cannot be undone.`,
                      confirmText: 'Delete View',
                      variant: 'destructive',
                    });
                    if (ok) {
                      deleteMut.mutate(v.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity ml-1"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setViewName('');
            setModalOpen(true);
          }}
          className="h-7 text-xs text-slate-600 hover:text-slate-900 gap-1"
        >
          <Bookmark className="h-3.5 w-3.5" />
          <span>Save View</span>
        </Button>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save Current View</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">
                View Name
              </label>
              <Input
                placeholder="e.g. My Open Leads, High Budget Leads"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                autoFocus
              />
            </div>
            <p className="text-xs text-slate-500">
              This will save the current layout, filter settings, and sort order for quick access anytime.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!viewName.trim() || createMut.isPending}
              onClick={handleSave}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {createMut.isPending ? 'Saving...' : 'Save View'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
