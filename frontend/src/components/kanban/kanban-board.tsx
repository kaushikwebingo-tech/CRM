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
import { ModuleDef, StageDef } from '@/api/schema';
import { RecordItem } from '@/api/records';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, User as UserIcon, Eye, EyeOff, GripVertical } from 'lucide-react';

export interface KanbanBoardProps {
  module: ModuleDef;
  records: RecordItem[];
  onSelectRecord: (record: RecordItem) => void;
  onStageChange: (recordId: string, targetStageId: string) => Promise<void>;
}

function KanbanCard({
  record,
  onClick,
  isOverlay = false,
}: {
  record: RecordItem;
  onClick?: () => void;
  isOverlay?: boolean;
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

  const budget = record.data?.budget;
  const company = record.data?.company;
  const source = record.data?.source;

  const formatDaysInStage = (since: string | null) => {
    if (!since) return null;
    const diff = Date.now() - new Date(since).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
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

      {Boolean(company) && (
        <p className="text-xs text-slate-500 mt-1 font-medium truncate">{String(company)}</p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
        {budget !== undefined && budget !== null && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            ₹{Number(budget).toLocaleString()}
          </span>
        )}

        {Boolean(source) && (
          <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-normal">
            {String(source)}
          </Badge>
        )}
      </div>

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
  onSelectRecord,
}: {
  stage: StageDef;
  records: RecordItem[];
  onSelectRecord: (record: RecordItem) => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `stage:${stage.id}`,
    data: { stageId: stage.id },
  });

  const totalBudget = useMemo(() => {
    return records.reduce((acc, r) => {
      const b = Number(r.data?.budget);
      return !isNaN(b) ? acc + b : acc;
    }, 0);
  }, [records]);

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

          {totalBudget > 0 && (
            <span className="font-semibold text-slate-700">
              ₹{totalBudget.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 p-2.5 space-y-2.5 overflow-y-auto min-h-[450px] max-h-[calc(100vh-270px)]">
        {records.map((rec) => (
          <KanbanCard key={rec.id} record={rec} onClick={() => onSelectRecord(rec)} />
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
  onSelectRecord,
  onStageChange,
}: KanbanBoardProps): JSX.Element {
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
                key={stage.id}
                stage={stage}
                records={recordsByStage.get(stage.id) || []}
                onSelectRecord={onSelectRecord}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeRecord ? <KanbanCard record={activeRecord} isOverlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
