import { useState, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  useDroppable,
} from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ModuleDef, StageDef, FieldDef } from '@/api/schema';
import { getFieldComponent } from '@/components/fields/registry';
import { CellBoundary } from '@/components/error-boundary';
import { RecordItem } from '@/api/records';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, User as UserIcon, Eye, EyeOff, GripVertical } from 'lucide-react';

export interface KanbanBoardProps {
  module: ModuleDef;
  records: RecordItem[];
  /** From the kanban view's `config.cardFields`; falls back to module order. */
  cardFields?: string[];
  onSelectRecord: (record: RecordItem) => void;
  onStageChange: (recordId: string, targetStageId: string) => Promise<void>;
}

/**
 * Which fields a card shows.
 *
 * The card used to read `data.budget`, `data.company` and `data.source`
 * directly and print a ₹ in front of the budget — three field keys and a
 * currency hardcoded into a component, which Guardrails 13 and 14 exist to
 * prevent: the same card is used by every module, and a "Site Visit" has none
 * of those fields. The keys now come from the view's `cardFields` config, or
 * from the first few non-system fields of the module, and each value is
 * rendered by its own type's Cell component.
 */
function resolveCardFields(module: ModuleDef, cardFields?: string[]): FieldDef[] {
  const byKey = new Map(module.fields.map((f) => [f.key, f] as const));
  if (cardFields && cardFields.length > 0) {
    return cardFields.map((k) => byKey.get(k)).filter((f): f is FieldDef => Boolean(f));
  }
  return module.fields.filter((f) => !f.isSystem).slice(0, 3);
}

function KanbanCard({
  record,
  fields,
  onClick,
  isOverlay = false,
  isTerminalStage = false,
}: {
  record: RecordItem;
  fields: FieldDef[];
  onClick?: () => void;
  isOverlay?: boolean;
  isTerminalStage?: boolean;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: record.id,
    data: { record },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  /**
   * Plan Section 9: "days in stage stops accruing once a record reaches a
   * terminal stage". It previously kept counting forever on won and lost
   * cards, so a deal closed last year read "412d ago".
   */
  const formatDaysInStage = (since: string | null) => {
    if (!since || isTerminalStage) return null;
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) return null;
    const days = Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 0) return null;
    if (days === 0) return 'Today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  };

  const daysText = formatDaysInStage(record.stage_since);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-lg border bg-white p-3.5 shadow-sm transition-all hover:border-blue-400 hover:shadow-md cursor-pointer ${
        isOverlay ? 'shadow-xl ring-2 ring-blue-500 rotate-1 cursor-grabbing' : 'border-slate-200'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-sm text-slate-800 line-clamp-2 leading-snug group-hover:text-blue-600">
          {record.display_name}
        </h4>
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 p-0.5 -mr-1 -mt-1 rounded"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>

      {fields.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {fields.map((field) => {
            const value = record.data?.[field.key];
            if (value === undefined || value === null || value === '') return null;
            const Cell = getFieldComponent(field.type).Cell;
            return (
              <span key={field.key} className="inline-flex items-center gap-1 text-xs text-slate-600">
                <CellBoundary>
                  <Cell field={field} value={value} record={record} />
                </CellBoundary>
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate-400 mt-3 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1">
          {daysText && (
            <span className="flex items-center gap-1" title={`In stage since ${record.stage_since}`}>
              <Clock className="h-3 w-3 text-slate-400" />
              <span>{daysText}</span>
            </span>
          )}
        </div>

        {record.owner ? (
          <span className="flex items-center gap-1 text-slate-600 font-medium">
            <UserIcon className="h-3 w-3 text-slate-400" />
            <span className="truncate max-w-[90px]">{record.owner.fullName}</span>
          </span>
        ) : (
          <span className="text-[10px] text-slate-300 font-mono">
            {record.id.substring(0, 6)}
          </span>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({
  stage,
  records,
  cardFields,
  totalField,
  onSelectRecord,
}: {
  stage: StageDef;
  records: RecordItem[];
  cardFields: FieldDef[];
  totalField: FieldDef | null;
  onSelectRecord: (record: RecordItem) => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `stage:${stage.id}`,
    data: { stageId: stage.id },
  });

  // The column total is whichever numeric field the module actually has, not a
  // field named "budget".
  const columnTotal = useMemo(() => {
    if (!totalField) return null;
    const sum = records.reduce((acc, r) => {
      const value = Number(r.data?.[totalField.key]);
      return Number.isFinite(value) ? acc + value : acc;
    }, 0);
    return sum > 0 ? sum : null;
  }, [records, totalField]);

  const stageColorClass =
    stage.type === 'won'
      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
      : stage.type === 'lost'
      ? 'border-rose-500 bg-rose-50 text-rose-700'
      : 'border-blue-500 bg-blue-50 text-blue-700';

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-shrink-0 w-80 bg-slate-50/80 rounded-xl border transition-all ${
        isOver
          ? 'border-blue-500 ring-2 ring-blue-400/40 bg-blue-50/20'
          : 'border-slate-200 shadow-sm'
      }`}
    >
      <div className="p-3 border-b border-slate-200 bg-white rounded-t-xl space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                stage.type === 'won'
                  ? 'bg-emerald-500'
                  : stage.type === 'lost'
                  ? 'bg-rose-500'
                  : 'bg-blue-600'
              }`}
            />
            <h3 className="font-bold text-sm text-slate-800 truncate">{stage.label}</h3>
          </div>

          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
            {records.length}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-medium ${stageColorClass}`}>
            {stage.type.toUpperCase()}
          </Badge>

          {columnTotal !== null && totalField && (
            <span className="font-semibold text-slate-700" title={totalField.label}>
              <CellBoundary>
                {(() => {
                  const Cell = getFieldComponent(totalField.type).Cell;
                  return <Cell field={totalField} value={columnTotal} record={{} as RecordItem} />;
                })()}
              </CellBoundary>
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 p-2.5 space-y-2.5 overflow-y-auto min-h-[450px] max-h-[calc(100vh-270px)]">
        {records.map((rec) => (
          <KanbanCard
            key={rec.id}
            record={rec}
            fields={cardFields}
            isTerminalStage={stage.type !== 'open'}
            onClick={() => onSelectRecord(rec)}
          />
        ))}

        {records.length === 0 && (
          <div className="h-32 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-xs text-slate-400">
            Drop cards here
          </div>
        )}
      </div>
    </div>
  );
}

export function KanbanBoard({
  module,
  records,
  cardFields,
  onSelectRecord,
  onStageChange,
}: KanbanBoardProps): JSX.Element {
  const resolvedCardFields = useMemo(
    () => resolveCardFields(module, cardFields),
    [module, cardFields],
  );
  const totalField = useMemo(
    () =>
      module.fields.find((f) => ['currency', 'number', 'percent'].includes(f.type) && !f.isSystem) ??
      null,
    [module],
  );
  const [showTerminalStages, setShowTerminalStages] = useState(true);
  const [activeRecord, setActiveRecord] = useState<RecordItem | null>(null);

  const defaultPipeline = module.pipelines?.find((p) => p.isDefault) || module.pipelines?.[0];
  const allStages = defaultPipeline?.stages || [];

  const visibleStages = useMemo(() => {
    if (showTerminalStages) return allStages;
    return allStages.filter((s) => s.type === 'open');
  }, [allStages, showTerminalStages]);

  const recordsByStage = useMemo(() => {
    const map = new Map<string, RecordItem[]>();
    for (const stage of allStages) {
      map.set(stage.id, []);
    }
    const defaultStageId = allStages[0]?.id;

    for (const rec of records) {
      const targetStageId = rec.stage_id || defaultStageId;
      if (targetStageId && map.has(targetStageId)) {
        map.get(targetStageId)!.push(rec);
      } else if (defaultStageId && map.has(defaultStageId)) {
        map.get(defaultStageId)!.push(rec);
      }
    }
    return map;
  }, [records, allStages]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const record = active.data.current?.record as RecordItem | undefined;
    if (record) {
      setActiveRecord(record);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!event.over) return;
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveRecord(null);

    if (!over) return;

    const recordId = String(active.id);
    let targetStageId: string | null = null;

    if (String(over.id).startsWith('stage:')) {
      targetStageId = String(over.id).replace('stage:', '');
    } else {
      const overRecord = over.data.current?.record as RecordItem | undefined;
      if (overRecord?.stage_id) {
        targetStageId = overRecord.stage_id;
      }
    }

    if (!targetStageId) return;

    const draggingRecord = records.find((r) => r.id === recordId);
    if (draggingRecord && draggingRecord.stage_id !== targetStageId) {
      await onStageChange(recordId, targetStageId);
    }
  };

  if (!defaultPipeline || allStages.length === 0) {
    return (
      <div className="p-12 text-center text-slate-500">
        No pipeline stages configured for this module.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Pipeline:
          </span>
          <span className="text-xs font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">
            {defaultPipeline.name}
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowTerminalStages((prev) => !prev)}
          className="h-8 gap-1.5 text-xs text-slate-600"
        >
          {showTerminalStages ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          <span>{showTerminalStages ? 'Hide Won / Lost' : 'Show All Stages'}</span>
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto pb-4 pt-1">
          <div className="flex items-start gap-4 min-w-max h-full">
            {visibleStages.map((stage) => (
              <KanbanColumn
                cardFields={resolvedCardFields}
                totalField={totalField}
                key={stage.id}
                stage={stage}
                records={recordsByStage.get(stage.id) || []}
                onSelectRecord={onSelectRecord}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeRecord ? <KanbanCard record={activeRecord} fields={resolvedCardFields} isOverlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
