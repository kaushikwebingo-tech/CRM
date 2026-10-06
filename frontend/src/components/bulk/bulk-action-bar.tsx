import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { bulkAction, fetchOrgUsers } from '@/api/records';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  Users,
  GitCommit,
  Trash2,
  X,
  ChevronDown,
  Check,
} from 'lucide-react';

export interface BulkActionBarProps {
  selectedIds: string[];
  moduleKey: string;
  stages?: Array<{ id: string; label: string }>;
  onClearSelection: () => void;
  onSuccess: () => void;
}

export function BulkActionBar({
  selectedIds,
  moduleKey,
  stages = [],
  onClearSelection,
  onSuccess,
}: BulkActionBarProps): JSX.Element | null {
  const { toast } = useToast();
  const [assignOpen, setAssignOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['org-users'],
    queryFn: fetchOrgUsers,
  });

  const bulkMut = useMutation({
    mutationFn: (payload: { action: 'assign' | 'update' | 'delete'; record_ids: string[]; data?: Record<string, unknown> }) =>
      bulkAction(moduleKey, payload),
    onSuccess: (res, vars) => {
      setAssignOpen(false);
      setStageOpen(false);
      onClearSelection();
      onSuccess();

      let actionDesc = 'Records updated';
      if (vars.action === 'assign') actionDesc = `Assigned ${res.count} records`;
      if (vars.action === 'delete') actionDesc = `Deleted ${res.count} records`;
      if (vars.action === 'update') actionDesc = `Updated stage for ${res.count} records`;

      toast({
        title: 'Bulk Action Completed',
        description: actionDesc,
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Bulk Action Failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  if (selectedIds.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl border border-slate-700 animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center gap-2 border-r border-slate-700 pr-3">
        <span className="flex items-center justify-center bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5">
          {selectedIds.length}
        </span>
        <span className="text-sm font-medium text-slate-200">selected</span>
      </div>

      <div className="relative">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setAssignOpen(!assignOpen);
            setStageOpen(false);
          }}
          className="text-slate-200 hover:text-white hover:bg-slate-800 text-xs h-8 gap-1.5"
        >
          <Users className="h-3.5 w-3.5" />
          <span>Assign</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>

        {assignOpen && (
          <div className="absolute bottom-full mb-2 left-0 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-1 z-50 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase font-semibold text-slate-400 px-2 py-1">
              Select Assignee
            </div>
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() =>
                  bulkMut.mutate({
                    action: 'assign',
                    record_ids: selectedIds,
                    data: { owner_id: u.id },
                  })
                }
                className="w-full text-left px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700 hover:text-white rounded flex items-center justify-between"
              >
                <div className="truncate">
                  <div className="font-medium truncate">{u.fullName}</div>
                  <div className="text-[10px] text-slate-400 truncate">{u.email}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {stages.length > 0 && (
        <div className="relative">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStageOpen(!stageOpen);
              setAssignOpen(false);
            }}
            className="text-slate-200 hover:text-white hover:bg-slate-800 text-xs h-8 gap-1.5"
          >
            <GitCommit className="h-3.5 w-3.5" />
            <span>Change Stage</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>

          {stageOpen && (
            <div className="absolute bottom-full mb-2 left-0 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-1 z-50">
              <div className="text-[10px] uppercase font-semibold text-slate-400 px-2 py-1">
                Select Stage
              </div>
              {stages.map((stg) => (
                <button
                  key={stg.id}
                  type="button"
                  onClick={() =>
                    bulkMut.mutate({
                      action: 'update',
                      record_ids: selectedIds,
                      data: { stage_id: stg.id },
                    })
                  }
                  className="w-full text-left px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700 hover:text-white rounded flex items-center gap-2"
                >
                  <Check className="h-3 w-3 text-transparent" />
                  <span>{stg.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (window.confirm(`Delete ${selectedIds.length} records?`)) {
            bulkMut.mutate({
              action: 'delete',
              record_ids: selectedIds,
            });
          }
        }}
        className="text-rose-300 hover:text-rose-100 hover:bg-rose-950/50 text-xs h-8 gap-1.5"
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span>Delete</span>
      </Button>

      <div className="border-l border-slate-700 pl-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={onClearSelection}
          className="h-7 w-7 text-slate-400 hover:text-white hover:bg-slate-800"
          title="Deselect all"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
