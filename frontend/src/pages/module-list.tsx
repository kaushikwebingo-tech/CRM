import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSchema } from '@/hooks/use-schema';
import {
  fetchRecords,
  fetchRecordCount,
  createRecord,
  updateRecord,
  deleteRecord,
  changeStage,
  exportCsv,
  RecordItem,
  SavedView,
} from '@/api/records';
import { DynamicTable } from '@/components/dynamic-table/dynamic-table';
import { KanbanBoard } from '@/components/kanban/kanban-board';
import { RecordDrawer } from '@/components/record-drawer/record-drawer';
import { SavedViewsBar } from '@/components/views/saved-views-bar';
import { BulkActionBar } from '@/components/bulk/bulk-action-bar';
import { ImportCsvModal } from '@/components/csv/import-csv-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Plus, Search, X, Table, LayoutGrid, Download, Upload } from 'lucide-react';

export function ModuleList(): JSX.Element {
  const { moduleKey } = useParams<{ moduleKey: string }>();
  const navigate = useNavigate();
  const { getModule } = useSchema();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('created_at:desc');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeRecord, setActiveRecord] = useState<RecordItem | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [activeView, setActiveView] = useState<SavedView | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setRecords([]);
    setNextCursor(null);
    setSelectedIds([]);
  }, [moduleKey, debouncedSearch, sort, activeView]);

  const moduleDef = moduleKey ? getModule(moduleKey) : undefined;

  const activeFilterString = activeView?.config?.filter
    ? JSON.stringify(activeView.config.filter)
    : undefined;

  const { data: countData } = useQuery({
    queryKey: ['records', moduleKey, 'count', debouncedSearch, activeFilterString],
    queryFn: () =>
      moduleKey
        ? fetchRecordCount(moduleKey, activeFilterString)
        : Promise.resolve({ count: 0 }),
    enabled: Boolean(moduleKey),
  });

  const { isLoading, isFetching } = useQuery({
    queryKey: ['records', moduleKey, 'list', debouncedSearch, sort, activeFilterString],
    queryFn: async () => {
      if (!moduleKey) return null;
      const res = await fetchRecords(moduleKey, {
        q: debouncedSearch || undefined,
        sort,
        filter: activeFilterString,
        limit: 50,
      });
      setRecords(res.records);
      setNextCursor(res.nextCursor);
      setHasMore(res.hasMore);
      return res;
    },
    enabled: Boolean(moduleKey),
  });

  const loadMore = async () => {
    if (!moduleKey || !nextCursor || isFetching) return;
    const res = await fetchRecords(moduleKey, {
      q: debouncedSearch || undefined,
      sort,
      filter: activeFilterString,
      cursor: nextCursor,
      limit: 50,
    });
    setRecords((prev) => [...prev, ...res.records]);
    setNextCursor(res.nextCursor);
    setHasMore(res.hasMore);
  };

  const createMut = useMutation({
    mutationFn: (data: any) => createRecord(moduleKey!, data),
    onSuccess: (newRec) => {
      setRecords((prev) => [newRec, ...prev]);
      queryClient.invalidateQueries({ queryKey: ['records', moduleKey, 'count'] });
      setDrawerOpen(false);
      toast({
        title: 'Record created',
        description: `${newRec.display_name} has been created successfully.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create record',
        description: err.message || 'Please check the entered values.',
        variant: 'destructive',
      });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateRecord(moduleKey!, id, data),
    onSuccess: (updatedRec) => {
      setRecords((prev) => prev.map((r) => (r.id === updatedRec.id ? updatedRec : r)));
      setDrawerOpen(false);
      setActiveRecord(null);
      toast({
        title: 'Record updated',
        description: `${updatedRec.display_name} has been updated.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to update record',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRecord(moduleKey!, id),
    onSuccess: (_, id) => {
      setRecords((prev) => prev.filter((r) => r.id !== id));
      setSelectedIds((prev) => prev.filter((item) => item !== id));
      queryClient.invalidateQueries({ queryKey: ['records', moduleKey, 'count'] });
      toast({
        title: 'Record deleted',
        description: 'The record was soft deleted.',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to delete record',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  if (!moduleKey) {
    return <div className="p-6 text-red-500">Module key is missing</div>;
  }

  if (!moduleDef) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px]">
        <h2 className="text-lg font-semibold text-slate-800">Module Not Found</h2>
        <p className="text-sm text-slate-500 mt-1">
          No module definition found for "{moduleKey}".
        </p>
      </div>
    );
  }

  const handleOpenCreate = () => {
    setActiveRecord(null);
    setDrawerOpen(true);
  };

  const handleSelectRecord = (record: RecordItem) => {
    navigate(`/m/${moduleKey}/${record.id}`);
  };

  const handleDeleteRecord = (record: RecordItem) => {
    if (window.confirm(`Are you sure you want to delete "${record.display_name}"?`)) {
      deleteMut.mutate(record.id);
    }
  };

  const stageMut = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      changeStage(moduleKey, id, stageId),
    onSuccess: (updatedRec) => {
      setRecords((prev) => prev.map((r) => (r.id === updatedRec.id ? updatedRec : r)));
      queryClient.invalidateQueries({ queryKey: ['records', moduleKey] });
      toast({
        title: 'Stage updated',
        description: `${updatedRec.display_name} moved to new stage.`,
      });
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ['records', moduleKey] });
      toast({
        title: 'Failed to update stage',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleStageChange = async (recordId: string, targetStageId: string) => {
    setRecords((prev) =>
      prev.map((r) =>
        r.id === recordId ? { ...r, stage_id: targetStageId, stage_since: new Date().toISOString() } : r
      )
    );
    await stageMut.mutateAsync({ id: recordId, stageId: targetStageId });
  };

  const handleSaveRecord = async (formData: any) => {
    if (activeRecord) {
      await updateMut.mutateAsync({ id: activeRecord.id, data: formData });
    } else {
      await createMut.mutateAsync(formData);
    }
  };

  const handleSelectView = (view: SavedView | null) => {
    setActiveView(view);
    if (view) {
      if (view.type === 'kanban') {
        setViewMode('kanban');
      } else {
        setViewMode('table');
      }
      if (view.config?.sort) {
        setSort(view.config.sort);
      }
    }
  };

  const handleExportCsv = async () => {
    try {
      const csvContent = await exportCsv(moduleKey, {
        q: debouncedSearch || undefined,
        filter: activeFilterString,
        sort,
      });
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${moduleKey}-export.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: 'Export complete',
        description: 'CSV file exported successfully.',
      });
    } catch (err: any) {
      toast({
        title: 'Export failed',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  const defaultPipeline = moduleDef.pipelines?.find((p) => p.isDefault) || moduleDef.pipelines?.[0];
  const pipelineStages = defaultPipeline?.stages?.map((s) => ({ id: s.id, label: s.label })) || [];

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <SavedViewsBar
        moduleKey={moduleKey}
        activeViewId={activeView?.id || null}
        onSelectView={handleSelectView}
        currentFilter={activeView?.config?.filter}
        currentSort={sort}
        currentType={viewMode}
      />

      <div className="flex flex-col flex-1 min-h-0 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {moduleDef.labelPlural}
            </h1>
            {countData?.count !== undefined && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                {countData.count.toLocaleString()}
              </span>
            )}

            {moduleDef.hasPipeline && (
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 ml-2">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                    viewMode === 'table'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="Table View"
                >
                  <Table className="h-3.5 w-3.5" />
                  <span>Table</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('kanban')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                    viewMode === 'kanban'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="Kanban Board View"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span>Kanban</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <div className="relative w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${moduleDef.labelPlural.toLowerCase()}...`}
                className="pl-9 pr-8 h-9 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="h-9 px-3 text-xs gap-1.5 border-slate-200 text-slate-700 hover:text-slate-900"
              title="Export CSV"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              <span>Export</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportModalOpen(true)}
              className="h-9 px-3 text-xs gap-1.5 border-slate-200 text-slate-700 hover:text-slate-900"
              title="Import CSV"
            >
              <Upload className="h-3.5 w-3.5 text-slate-500" />
              <span>Import</span>
            </Button>

            <Button
              onClick={handleOpenCreate}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 h-9 px-3.5 text-xs font-semibold"
            >
              <Plus className="h-4 w-4" />
              <span>New {moduleDef.labelSingular}</span>
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {viewMode === 'kanban' && moduleDef.hasPipeline ? (
            <KanbanBoard
              module={moduleDef}
              records={records}
              onSelectRecord={handleSelectRecord}
              onStageChange={handleStageChange}
            />
          ) : (
            <DynamicTable
              module={moduleDef}
              records={records}
              isLoading={isLoading}
              hasMore={hasMore}
              onLoadMore={loadMore}
              sort={sort}
              onSortChange={setSort}
              onSelectRecord={handleSelectRecord}
              onDeleteRecord={handleDeleteRecord}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
            />
          )}
        </div>
      </div>

      <BulkActionBar
        selectedIds={selectedIds}
        moduleKey={moduleKey}
        stages={pipelineStages}
        onClearSelection={() => setSelectedIds([])}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['records', moduleKey] });
        }}
      />

      <ImportCsvModal
        module={moduleDef}
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['records', moduleKey] });
        }}
      />

      <RecordDrawer
        module={moduleDef}
        record={activeRecord}
        isOpen={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setActiveRecord(null);
        }}
        onSave={handleSaveRecord}
      />
    </div>
  );
}
