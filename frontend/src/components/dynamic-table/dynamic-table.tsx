import { useMemo, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ModuleDef } from '@/api/schema';
import { RecordItem } from '@/api/records';
import { getFieldComponent } from '@/components/fields/registry';
import { CellBoundary } from '@/components/error-boundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, ArrowUp, ArrowDown, Trash2, Edit2 } from 'lucide-react';

export interface DynamicTableProps {
  module: ModuleDef;
  records: RecordItem[];
  /**
   * The active view's `config.columns`. Plan Section 4 stores columns on the
   * view and Section 14 expects the grid to ask for only those; the table used
   * to render every non-system field regardless, so a saved view's column
   * choice did nothing and the Owner column was never shown at all.
   */
  columns?: string[];
  error?: Error | null;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  sort?: string;
  onSortChange: (newSort: string) => void;
  onSelectRecord: (record: RecordItem) => void;
  onDeleteRecord: (record: RecordItem) => void;
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
}

export function DynamicTable({
  module,
  records,
  columns: viewColumns,
  error,
  isLoading,
  hasMore,
  onLoadMore,
  sort,
  onSortChange,
  onSelectRecord,
  onDeleteRecord,
  selectedIds,
  onSelectedIdsChange,
}: DynamicTableProps): JSX.Element {
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const [currentSortKey, currentSortDir] = (sort || 'created_at:desc').split(':');

  const handleHeaderSort = (key: string) => {
    if (currentSortKey === key) {
      onSortChange(`${key}:${currentSortDir === 'asc' ? 'desc' : 'asc'}`);
    } else {
      onSortChange(`${key}:asc`);
    }
  };

  const columns = useMemo<ColumnDef<RecordItem>[]>(() => {
    const cols: ColumnDef<RecordItem>[] = [];

    if (onSelectedIdsChange) {
      const allSelected = records.length > 0 && records.every((r) => (selectedIds || []).includes(r.id));
      const someSelected = records.some((r) => (selectedIds || []).includes(r.id)) && !allSelected;

      cols.push({
        id: 'select',
        header: () => (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(input) => {
              if (input) input.indeterminate = someSelected;
            }}
            onChange={(e) => {
              if (e.target.checked) {
                onSelectedIdsChange(records.map((r) => r.id));
              } else {
                onSelectedIdsChange([]);
              }
            }}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
          />
        ),
        cell: ({ row }) => {
          const isChecked = (selectedIds || []).includes(row.original.id);
          return (
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(e) => {
                e.stopPropagation();
                if (isChecked) {
                  onSelectedIdsChange((selectedIds || []).filter((id) => id !== row.original.id));
                } else {
                  onSelectedIdsChange([...(selectedIds || []), row.original.id]);
                }
              }}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
            />
          );
        },
        size: 40,
      });
    }

    cols.push({
      id: 'display_name',
      accessorKey: 'display_name',
      header: () => (
        <button
          type="button"
          onClick={() => handleHeaderSort('display_name')}
          className="flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
        >
          <span>{module.nameFieldLabel || 'Name'}</span>
          {currentSortKey === 'display_name' ? (
            currentSortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 opacity-0 group-hover:opacity-100" />
          )}
        </button>
      ),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onSelectRecord(row.original)}
          className="font-medium text-blue-600 hover:underline text-left truncate block max-w-xs"
        >
          {row.original.display_name}
        </button>
      ),
      size: 200,
    });

    if (module.hasPipeline) {
      const defaultPipeline = module.pipelines?.find((p) => p.isDefault) || module.pipelines?.[0];
      const stagesMap = new Map(defaultPipeline?.stages?.map((s) => [s.id, s]) || []);

      cols.push({
        id: 'stage_id',
        accessorKey: 'stage_id',
        header: () => <span className="font-semibold text-slate-700">Stage</span>,
        cell: ({ row }) => {
          const stageId = row.original.stage_id;
          const stage = stageId ? stagesMap.get(stageId) : null;
          if (!stage) return <span className="text-slate-400">—</span>;

          const colorClasses =
            stage.type === 'won'
              ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
              : stage.type === 'lost'
              ? 'bg-rose-100 text-rose-800 border-rose-200'
              : 'bg-blue-100 text-blue-800 border-blue-200';

          return (
            <Badge variant="outline" className={`font-medium ${colorClasses}`}>
              {stage.label}
            </Badge>
          );
        },
        size: 140,
      });
    }

    // `stage_id` and `owner_id` are core record columns rendered above, not
    // dynamic fields, so they are excluded here rather than duplicated.
    const CORE_RENDERED = new Set(['stage_id', 'owner_id', 'display_name']);
    const wantsOwner = !viewColumns || viewColumns.length === 0 || viewColumns.includes('owner_id');
    const byKey = new Map(module.fields.map((f) => [f.key, f] as const));

    const visibleFields =
      viewColumns && viewColumns.length > 0
        ? viewColumns
            .filter((key) => !CORE_RENDERED.has(key))
            .map((key) => byKey.get(key))
            .filter((f): f is NonNullable<typeof f> => Boolean(f))
        : module.fields.filter((f) => !f.isSystem && !CORE_RENDERED.has(f.key));

    if (wantsOwner) {
      cols.push({
        id: 'owner_id',
        accessorKey: 'owner_id',
        header: () => (
          <button
            type="button"
            onClick={() => handleHeaderSort('owner_id')}
            className="flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
          >
            <span>Owner</span>
            {currentSortKey === 'owner_id' ? (
              currentSortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
            ) : (
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>
        ),
        cell: ({ row }) =>
          row.original.owner ? (
            <span className="truncate text-slate-700">{row.original.owner.fullName}</span>
          ) : (
            <span className="text-slate-300">Unassigned</span>
          ),
        size: 140,
      });
    }

    for (const field of visibleFields) {
      cols.push({
        id: field.key,
        accessorFn: (row) => row.data?.[field.key],
        header: () =>
          // A header that offers to sort an unsortable field just produces a
          // 400 the user cannot act on, so it renders as plain text instead.
          field.isSortable === false ? (
            <span className="font-semibold text-slate-700">{field.label}</span>
          ) : (
            <button
              type="button"
              onClick={() => handleHeaderSort(field.key)}
              className="flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900 group"
            >
              <span>{field.label}</span>
              {currentSortKey === field.key ? (
                currentSortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 opacity-0 group-hover:opacity-100" />
              )}
            </button>
          ),
        cell: ({ row }) => {
          const FieldCell = getFieldComponent(field.type).Cell;
          const value = row.original.data?.[field.key];
          return (
            <CellBoundary>
              <FieldCell field={field} value={value} record={row.original} />
            </CellBoundary>
          );
        },
        size: 160,
      });
    }

    cols.push({
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: () => (
        <button
          type="button"
          onClick={() => handleHeaderSort('created_at')}
          className="flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
        >
          <span>Created</span>
          {currentSortKey === 'created_at' ? (
            currentSortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
          )}
        </button>
      ),
      cell: ({ row }) => {
        const rawDate = row.original.created_at || row.original.createdAt;
        if (!rawDate) return <span className="text-slate-400">—</span>;
        const parsed = new Date(rawDate);
        if (Number.isNaN(parsed.getTime())) return <span className="text-slate-400">—</span>;
        return (
          <span className="text-slate-500 text-xs font-mono">
            {parsed.toLocaleDateString()}
          </span>
        );
      },
      size: 110,
    });

    cols.push({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSelectRecord(row.original)}
            className="h-7 w-7 text-slate-500 hover:text-slate-800"
            title="Edit"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDeleteRecord(row.original)}
            className="h-7 w-7 text-slate-500 hover:text-red-600"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
      size: 70,
    });

    return cols;
  }, [module, viewColumns, currentSortKey, currentSortDir, onSelectRecord, onDeleteRecord, selectedIds, onSelectedIdsChange, records]);

  const table = useReactTable({
    data: records,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  if (isLoading && records.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
        <div className="h-6 w-48 bg-slate-200 animate-pulse rounded" />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error && records.length === 0) {
    // A rejected request used to fall through to the empty state, so a
    // permission error or a bad filter read as "you have no records".
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-10 text-center">
        <h3 className="text-sm font-semibold text-slate-900">
          These {module.labelPlural.toLowerCase()} could not be loaded
        </h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{error.message}</p>
      </div>
    );
  }

  if (!isLoading && records.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
          <span className="text-xl">📂</span>
        </div>
        <h3 className="text-sm font-semibold text-slate-900">No {module.labelPlural.toLowerCase()} yet</h3>
        <p className="mt-1 text-sm text-slate-500">Get started by creating your first {module.labelSingular.toLowerCase()}.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm flex flex-col h-full overflow-hidden">
      <div ref={tableContainerRef} className="flex-1 overflow-auto max-h-[calc(100vh-230px)]">
        <table className="w-full text-left text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-600 select-none whitespace-nowrap"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <tr
                  key={row.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={`border-b border-slate-100 hover:bg-slate-50/80 transition-colors flex items-center ${
                    selectedIds?.includes(row.original.id) ? 'bg-blue-50/50' : ''
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="px-4 py-2.5 truncate"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="border-t border-slate-200 p-3 bg-slate-50 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoading}
            className="text-xs font-medium"
          >
            {isLoading ? 'Loading...' : 'Load More Records'}
          </Button>
        </div>
      )}
    </div>
  );
}
