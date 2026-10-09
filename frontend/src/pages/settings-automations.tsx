import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap,
  Plus,
  Play,
  Pause,
  Trash2,
  Activity,
  Globe,
} from 'lucide-react';
import { api } from '@/api/client';
import { useSchema } from '@/hooks/use-schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

export interface AutomationItem {
  id: string;
  orgId: string;
  moduleId: string | null;
  name: string;
  isActive: boolean;
  trigger: {
    eventType: string;
    moduleKey?: string;
    [key: string]: unknown;
  };
  conditions: Record<string, unknown> | null;
  actions: Array<{
    type: string;
    config: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      [key: string]: unknown;
    };
  }>;
  createdAt: string;
}

export interface AutomationRunItem {
  id: number;
  orgId: string;
  automationId: string;
  recordId: string | null;
  status: 'running' | 'success' | 'failed' | 'skipped';
  log: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
}

export function SettingsAutomationsPage(): JSX.Element {
  const { modules } = useSchema();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedAutomationForRuns, setSelectedAutomationForRuns] = useState<AutomationItem | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    moduleKey: 'lead',
    eventType: 'record.created',
    url: '',
    method: 'POST',
    headers: '',
  });

  const { data: automations = [], isLoading } = useQuery<AutomationItem[]>({
    queryKey: ['automations'],
    queryFn: () => api.get<AutomationItem[]>('/api/automations'),
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery<AutomationRunItem[]>({
    queryKey: ['automation-runs', selectedAutomationForRuns?.id],
    queryFn: () =>
      selectedAutomationForRuns
        ? api.get<AutomationRunItem[]>(`/api/automations/${selectedAutomationForRuns.id}/runs`)
        : Promise.resolve([]),
    enabled: Boolean(selectedAutomationForRuns),
    refetchInterval: selectedAutomationForRuns ? 2000 : false,
  });

  const createMutation = useMutation({
    mutationFn: (newAutomation: any) => api.post('/api/automations', newAutomation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      setCreateDialogOpen(false);
      setFormData({
        name: '',
        moduleKey: 'lead',
        eventType: 'record.created',
        url: '',
        method: 'POST',
        headers: '',
      });
      toast({ title: 'Automation created', description: 'Webhook automation is now active' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create automation',
        description: err.message || 'Validation error',
        variant: 'destructive',
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/api/automations/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      toast({ title: 'Updated', description: 'Automation state updated successfully' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/automations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      toast({ title: 'Deleted', description: 'Automation removed' });
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: 'Validation Error', description: 'Name is required', variant: 'destructive' });
      return;
    }
    if (!formData.url.trim()) {
      toast({ title: 'Validation Error', description: 'Webhook URL is required', variant: 'destructive' });
      return;
    }

    let parsedHeaders: Record<string, string> | undefined = undefined;
    if (formData.headers.trim()) {
      try {
        parsedHeaders = JSON.parse(formData.headers);
      } catch {
        toast({
          title: 'Validation Error',
          description: 'Headers must be valid JSON object (e.g. {"Authorization": "Bearer ..."})',
          variant: 'destructive',
        });
        return;
      }
    }

    const payload = {
      name: formData.name.trim(),
      isActive: true,
      trigger: {
        eventType: formData.eventType,
        moduleKey: formData.moduleKey,
      },
      actions: [
        {
          type: 'webhook',
          config: {
            url: formData.url.trim(),
            method: formData.method,
            headers: parsedHeaders,
          },
        },
      ],
    };

    createMutation.mutate(payload);
  };

  const getTriggerLabel = (eventType: string) => {
    switch (eventType) {
      case 'record.created':
        return 'Record Created';
      case 'record.updated':
        return 'Record Updated';
      case 'record.stage_changed':
        return 'Stage Moved';
      case 'record.deleted':
        return 'Record Deleted';
      default:
        return eventType;
    }
  };

  return (
    <div className="flex-1 p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Zap className="h-6 w-6 text-amber-500" />
            Automations & Webhooks
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Transactional outbox events, automatic retries with exponential backoff, and webhook dispatching
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New Webhook
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold text-slate-500">
              Total Automations
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{automations.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Configured event listeners</CardContent>
        </Card>

        <Card className="border border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold text-slate-500">
              Active Outbox Listeners
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-600">
              {automations.filter((a) => a.isActive).length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Actively receiving dispatch triggers</CardContent>
        </Card>

        <Card className="border border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold text-slate-500">
              Worker Status
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-blue-600 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse"></span>
              Live (Concurrency 5)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Poller & Redis instant wake enabled</CardContent>
        </Card>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Configured Automations</h2>
          <span className="text-xs text-slate-400">Filtered by organization</span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-slate-400">Loading automations...</div>
        ) : automations.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-amber-500">
              <Zap className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-800">No automations configured yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Create a webhook automation to receive transactional event notifications whenever leads or records are created or updated.
              </p>
            </div>
            <Button onClick={() => setCreateDialogOpen(true)} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Create your first webhook
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {automations.map((auto) => {
              const primaryAction = auto.actions?.[0];
              const webhookUrl = primaryAction?.config?.url || 'No URL configured';
              const targetModuleKey = auto.trigger?.moduleKey || auto.trigger?.module || 'Any module';
              const targetModule = modules.find((m) => m.key === targetModuleKey);

              return (
                <div key={auto.id} className="p-6 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                  <div className="space-y-2 min-w-0 flex-1 pr-6">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-slate-900 text-base">{auto.name}</span>
                      <Badge
                        variant={auto.isActive ? 'default' : 'secondary'}
                        className={auto.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}
                      >
                        {auto.isActive ? 'Active' : 'Paused'}
                      </Badge>
                      <Badge variant="outline" className="text-xs bg-slate-50 border-slate-200">
                        {getTriggerLabel(auto.trigger.eventType)}
                      </Badge>
                      <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                        {String(targetModule?.labelSingular || targetModuleKey || 'Module')}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-600 font-mono bg-slate-100/80 px-2.5 py-1.5 rounded-md max-w-2xl truncate">
                      <Globe className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="font-semibold text-blue-600 uppercase shrink-0">
                        {primaryAction?.config?.method || 'POST'}
                      </span>
                      <span className="truncate">{webhookUrl}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedAutomationForRuns(auto)}
                      className="text-xs flex items-center gap-1.5"
                    >
                      <Activity className="h-3.5 w-3.5 text-slate-500" />
                      Runs Log
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActiveMutation.mutate({ id: auto.id, isActive: !auto.isActive })}
                      title={auto.isActive ? 'Pause automation' : 'Activate automation'}
                    >
                      {auto.isActive ? (
                        <Pause className="h-4 w-4 text-amber-600" />
                      ) : (
                        <Play className="h-4 w-4 text-emerald-600" />
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Delete Automation',
                          description: `Are you sure you want to delete automation "${auto.name}"? It will no longer process events.`,
                          confirmText: 'Delete Automation',
                          variant: 'destructive',
                        });
                        if (ok) {
                          deleteMutation.mutate(auto.id);
                        }
                      }}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <form onSubmit={handleCreateSubmit} className="space-y-5">
            <DialogHeader>
              <DialogTitle>Create Webhook Automation</DialogTitle>
              <DialogDescription>
                Define an event trigger and webhook target. Events are sent via the transactional outbox engine with automatic retry.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Automation Name</label>
                <Input
                  required
                  placeholder="e.g. Sync New Leads to Slack"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Trigger Module</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.moduleKey}
                    onChange={(e) => setFormData({ ...formData, moduleKey: e.target.value })}
                  >
                    {modules.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.labelPlural} ({m.key})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Event Trigger</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.eventType}
                    onChange={(e) => setFormData({ ...formData, eventType: e.target.value })}
                  >
                    <option value="record.created">Record Created</option>
                    <option value="record.updated">Record Updated</option>
                    <option value="record.stage_changed">Stage Moved</option>
                    <option value="record.deleted">Record Deleted</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Webhook Target URL</label>
                <div className="flex gap-2">
                  <select
                    className="w-24 h-10 px-2 rounded-md border border-slate-300 bg-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.method}
                    onChange={(e) => setFormData({ ...formData, method: e.target.value })}
                  >
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                  <Input
                    required
                    type="url"
                    placeholder="https://your-domain.com/webhook"
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Custom Headers (JSON optional)
                </label>
                <textarea
                  rows={3}
                  placeholder='{"Authorization": "Bearer secret_token"}'
                  value={formData.headers}
                  onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                  className="w-full p-2.5 rounded-md border border-slate-300 bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving...' : 'Create Automation'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedAutomationForRuns)}
        onOpenChange={(open) => !open && setSelectedAutomationForRuns(null)}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600" />
              Execution Logs: {selectedAutomationForRuns?.name}
            </DialogTitle>
            <DialogDescription>
              Recent execution runs recorded by the outbox worker for this automation rule.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 py-2 pr-1">
            {runsLoading ? (
              <div className="text-center py-8 text-sm text-slate-400">Loading runs...</div>
            ) : runs.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400">
                No runs recorded yet. Trigger the event to see execution logs.
              </div>
            ) : (
              runs.map((run) => (
                <div
                  key={run.id}
                  className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full font-medium text-[11px] capitalize',
                          run.status === 'success' && 'bg-emerald-100 text-emerald-800',
                          run.status === 'failed' && 'bg-red-100 text-red-800',
                          run.status === 'running' && 'bg-amber-100 text-amber-800',
                          run.status === 'skipped' && 'bg-slate-200 text-slate-700'
                        )}
                      >
                        {run.status}
                      </span>
                      <span className="text-slate-500 font-mono text-[11px]">Run #{run.id}</span>
                    </div>
                    <span className="text-slate-400">
                      {new Date(run.startedAt).toLocaleTimeString()} · {new Date(run.startedAt).toLocaleDateString()}
                    </span>
                  </div>

                  {run.log && (
                    <div className="bg-slate-900 text-slate-100 p-2.5 rounded font-mono text-[11px] overflow-x-auto max-h-36">
                      <pre>{JSON.stringify(run.log, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedAutomationForRuns(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
