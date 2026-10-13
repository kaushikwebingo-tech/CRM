import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  fetchReports,
  runReport,
  drillThrough,
  createReport,
  FunnelReportResult,
  DrillThroughItem,
} from '@/api/reports';
import { fetchCalendar, fetchRules } from '@/api/routing';
import { useSchema } from '@/hooks/use-schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import {
  BarChart3,
  TrendingDown,
  Clock,
  ExternalLink,
  Plus,
  RefreshCw,
  Layers,
  ArrowRight,
} from 'lucide-react';

export function ReportsDashboardPage(): JSX.Element {
  const { modules } = useSchema();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [drillModalOpen, setDrillModalOpen] = useState(false);
  const [drillStageLabel, setDrillStageLabel] = useState('');
  const [drillRecords, setDrillRecords] = useState<DrillThroughItem[]>([]);
  const [isDrillLoading, setIsDrillLoading] = useState(false);
  const [newReportModalOpen, setNewReportModalOpen] = useState(false);
  const [newReportName, setNewReportName] = useState('');
  const [newReportModule, setNewReportModule] = useState('lead');

  const { data: reports = [], isLoading: reportsLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: () => fetchReports(),
  });

  const activeReportId = selectedReportId || reports[0]?.id;

  const { data: funnelData, isLoading: funnelLoading, refetch: refetchFunnel } = useQuery<FunnelReportResult>({
    queryKey: ['reports', activeReportId, 'run'],
    queryFn: () => (activeReportId ? runReport<FunnelReportResult>(activeReportId) : null as any),
    enabled: Boolean(activeReportId),
  });

  const { data: calendar } = useQuery({
    queryKey: ['routing', 'calendar'],
    queryFn: () => fetchCalendar(),
  });

  const { data: slaRules = [] } = useQuery({
    queryKey: ['routing', 'rules', 'sla'],
    queryFn: () => fetchRules({ kind: 'sla' }),
  });

  const createReportMut = useMutation({
    mutationFn: (data: any) => createReport(data),
    onSuccess: (newRep) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      setSelectedReportId(newRep.id);
      setNewReportModalOpen(false);
      setNewReportName('');
      toast({
        title: 'Report Created',
        description: `Funnel report "${newRep.name}" created successfully.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create report',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleDrillThrough = async (stageId: string, stageLabel: string) => {
    if (!activeReportId) return;
    setDrillStageLabel(stageLabel);
    setDrillModalOpen(true);
    setIsDrillLoading(true);
    try {
      const records = await drillThrough(activeReportId, stageId, 50);
      setDrillRecords(records);
    } catch (err: any) {
      toast({
        title: 'Drill-through failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setIsDrillLoading(false);
    }
  };

  const handleCreateReport = () => {
    if (!newReportName.trim() || !newReportModule) return;
    createReportMut.mutate({
      name: newReportName.trim(),
      moduleKey: newReportModule,
      type: 'funnel',
      config: {
        aggregate: 'count',
      },
    });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <BarChart3 className="h-6 w-6 text-blue-600" />
            <span>Reports & Funnel Analytics</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Pipeline velocity, stage drop-offs, and drill-through underlying records.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {calendar && (
            <Badge
              variant="outline"
              className="bg-slate-50 text-slate-700 border-slate-200 py-1.5 px-3 flex items-center gap-1.5 text-xs"
            >
              <Clock className="h-3.5 w-3.5 text-blue-600" />
              <span>Office Hours: {calendar.startTime} - {calendar.endTime} ({calendar.timezone})</span>
            </Badge>
          )}

          <Button
            onClick={() => setNewReportModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 text-xs h-9"
          >
            <Plus className="h-4 w-4" />
            <span>New Funnel Report</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Saved Reports
              </span>
              <span className="text-xs text-slate-400 font-semibold">{reports.length}</span>
            </div>

            {reportsLoading ? (
              <div className="space-y-2 py-4 animate-pulse">
                <div className="h-8 bg-slate-100 rounded" />
                <div className="h-8 bg-slate-100 rounded" />
              </div>
            ) : reports.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400">
                No reports saved yet. Click &quot;New Funnel Report&quot; to build one.
              </div>
            ) : (
              <div className="space-y-1">
                {reports.map((rep) => {
                  const isCurrent = rep.id === activeReportId;
                  return (
                    <button
                      key={rep.id}
                      type="button"
                      onClick={() => setSelectedReportId(rep.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-between ${
                        isCurrent
                          ? 'bg-blue-50 text-blue-700 font-bold border border-blue-200'
                          : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <div className="truncate">
                        <div className="truncate">{rep.name}</div>
                        <div className="text-[10px] text-slate-400 capitalize">
                          {rep.moduleKey} • {rep.type}
                        </div>
                      </div>
                      <ArrowRight className="h-3 w-3 shrink-0 ml-2 opacity-50" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Active SLA Policies ({slaRules.length})
            </span>
            {slaRules.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">No SLA escalation rules configured.</div>
            ) : (
              <div className="space-y-2">
                {slaRules.map((sla) => (
                  <div key={sla.id} className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 text-xs space-y-1">
                    <div className="font-semibold text-slate-800">{sla.name}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-slate-400" />
                      <span>Target: {Number((sla.config as any)?.targetMinutes || 60)}m</span>
                      <span>•</span>
                      <span>{(sla.config as any)?.businessHoursOnly ? 'Business Hours' : 'Calendar Time'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6">
          {funnelLoading ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-xs animate-pulse space-y-4">
              <div className="h-6 bg-slate-200 rounded w-1/4" />
              <div className="h-64 bg-slate-100 rounded" />
            </div>
          ) : !funnelData ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
              Select or create a funnel report to inspect pipeline drop-offs.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{funnelData.reportName}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Total Inbound Volume: <strong className="text-slate-800">{funnelData.totalRecords} records</strong>
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchFunnel()}
                  className="h-8 text-xs gap-1.5 text-slate-600"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Refresh</span>
                </Button>
              </div>

              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  {funnelData.stages.map((stage, idx) => {
                    const widthPercent = funnelData.totalRecords > 0
                      ? Math.max(8, (stage.count / funnelData.totalRecords) * 100)
                      : 8;

                    return (
                      <div key={stage.stageId} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                          <div className="flex items-center gap-2">
                            <span className="w-5 text-slate-400 text-right">{idx + 1}.</span>
                            <span className="text-slate-900">{stage.stageLabel}</span>
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {stage.count} records
                            </Badge>
                          </div>

                          <div className="flex items-center gap-3 text-[11px]">
                            {idx > 0 && stage.dropoffRate > 0 && (
                              <span className="text-rose-600 flex items-center gap-0.5" title="Drop-off from previous stage">
                                <TrendingDown className="h-3 w-3" />
                                -{stage.dropoffRate}% drop
                              </span>
                            )}
                            <span className="text-slate-500">
                              {stage.conversionRate}% of pipeline
                            </span>
                          </div>
                        </div>

                        <div
                          onClick={() => handleDrillThrough(stage.stageId, stage.stageLabel)}
                          className="h-9 bg-slate-50 rounded-lg p-1 cursor-pointer hover:bg-slate-100 transition-colors border border-slate-200/60 relative group"
                          title={`Click to drill through ${stage.count} records in ${stage.stageLabel}`}
                        >
                          <div
                            className="h-full rounded-md transition-all flex items-center px-3 text-white text-xs font-bold shadow-xs"
                            style={{
                              width: `${widthPercent}%`,
                              backgroundColor: stage.color || '#2563eb',
                            }}
                          >
                            <span className="truncate">{stage.count}</span>
                          </div>

                          <div className="absolute right-3 top-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-blue-600 font-semibold flex items-center gap-1">
                            <span>Drill Through</span>
                            <ExternalLink className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={drillModalOpen} onOpenChange={setDrillModalOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-blue-600" />
              <span>Drill-Through: {drillStageLabel}</span>
            </DialogTitle>
            <DialogDescription>
              Underlying records currently positioned in this funnel bucket.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 py-2">
            {isDrillLoading ? (
              <div className="py-12 text-center text-slate-400 text-sm animate-pulse">
                Loading underlying records...
              </div>
            ) : drillRecords.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                No records found for this stage.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                {drillRecords.map((rec) => (
                  <div key={rec.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                        <span>{rec.displayName}</span>
                        {Boolean(rec.data.email) && (
                          <span className="text-xs text-slate-400 font-normal">({String(rec.data.email)})</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-3">
                        <span className="font-mono text-[11px]">ID: {rec.id.slice(0, 8)}...</span>
                        <span>Created: {new Date(rec.createdAt).toLocaleDateString()}</span>
                        {Boolean(rec.data.company) && (
                          <span>Company: {String(rec.data.company)}</span>
                        )}
                      </div>
                    </div>

                    <Link
                      to={`/m/${funnelData?.moduleKey || 'lead'}/${rec.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold transition-colors"
                    >
                      <span>Open Record</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={newReportModalOpen} onOpenChange={setNewReportModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              <span>Create Funnel Report</span>
            </DialogTitle>
            <DialogDescription>
              Build a stage drop-off and conversion funnel for any module pipeline.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700">Report Name</label>
              <Input
                placeholder="e.g. Sales Pipeline Conversion Funnel"
                value={newReportName}
                onChange={(e) => setNewReportName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700">Target Module</label>
              <select
                value={newReportModule}
                onChange={(e) => setNewReportModule(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {modules.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.labelPlural} ({m.key})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setNewReportModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateReport}
              disabled={createReportMut.isPending || !newReportName.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <span>{createReportMut.isPending ? 'Creating...' : 'Create Report'}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
