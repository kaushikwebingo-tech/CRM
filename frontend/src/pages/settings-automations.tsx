import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap,
  Plus,
  Play,
  Pause,
  Trash2,
  Activity,
  GitBranch,
  Clock,
  StopCircle,
  Edit2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Sliders,
  FileCheck,
} from 'lucide-react';
import { api } from '@/api/client';
import { fetchRecords } from '@/api/records';
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

export interface ActionNodeModel {
  id: string;
  type: 'action';
  handler: string;
  config: Record<string, any>;
  next: string | null;
}

export interface BranchNodeModel {
  id: string;
  type: 'branch';
  conditions: {
    field: string;
    op: string;
    value: any;
  };
  onTrue: string;
  onFalse: string | null;
}

export interface WaitNodeModel {
  id: string;
  type: 'wait';
  mode: 'duration' | 'until_field';
  config: {
    durationMinutes?: number;
    durationHours?: number;
    durationDays?: number;
    fieldKey?: string;
  };
  next: string | null;
}

export interface StopNodeModel {
  id: string;
  type: 'stop';
  reason?: string;
}

export type CanvasNode = ActionNodeModel | BranchNodeModel | WaitNodeModel | StopNodeModel;

export interface AutomationRule {
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
  actions: CanvasNode[] | { nodes: CanvasNode[] } | any[];
  createdAt: string;
}

export interface NodeStepLog {
  nodeId: string;
  type: string;
  handler?: string;
  status: string;
  outcome?: boolean;
  nextNodeId?: string | null;
  durationMs?: number;
  output?: any;
  error?: string;
  timestamp?: string;
}

export interface DryRunResponse {
  success: boolean;
  recordId: string;
  displayName: string;
  conditionsPassed: boolean;
  message?: string;
  steps: NodeStepLog[];
  finalState?: Record<string, unknown>;
}

export interface AutomationRunItem {
  id: number;
  orgId: string;
  automationId: string;
  recordId: string | null;
  status: 'running' | 'waiting' | 'success' | 'failed' | 'skipped' | 'cancelled';
  log: {
    steps?: NodeStepLog[];
    currentNodeId?: string;
    resumeAt?: string;
    reason?: string;
    error?: string;
    finalState?: Record<string, unknown>;
    [key: string]: any;
  } | null;
  startedAt: string;
  finishedAt: string | null;
}

export function SettingsAutomationsPage(): JSX.Element {
  const { modules } = useSchema();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [selectedRuleForRuns, setSelectedRuleForRuns] = useState<AutomationRule | null>(null);
  const [dryRunTargetRule, setDryRunTargetRule] = useState<AutomationRule | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);
  const [isExecutingDryRun, setIsExecutingDryRun] = useState(false);

  const [ruleName, setRuleName] = useState('');
  const [triggerModuleKey, setTriggerModuleKey] = useState('lead');
  const [triggerEventType, setTriggerEventType] = useState('record.created');
  const [conditionField, setConditionField] = useState('');
  const [conditionOp, setConditionOp] = useState('eq');
  const [conditionValue, setConditionValue] = useState('');
  const [nodes, setNodes] = useState<CanvasNode[]>([]);

  const activeModule = useMemo(
    () => modules.find((m) => m.key === triggerModuleKey) || modules[0],
    [modules, triggerModuleKey],
  );

  const { data: automations = [], isLoading } = useQuery<AutomationRule[]>({
    queryKey: ['automations'],
    queryFn: () => api.get<AutomationRule[]>('/api/automations'),
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery<AutomationRunItem[]>({
    queryKey: ['automation-runs', selectedRuleForRuns?.id],
    queryFn: () =>
      selectedRuleForRuns
        ? api.get<AutomationRunItem[]>(`/api/automations/${selectedRuleForRuns.id}/runs`)
        : Promise.resolve([]),
    enabled: Boolean(selectedRuleForRuns),
    refetchInterval: selectedRuleForRuns ? 3000 : false,
  });

  const { data: moduleRecordsData } = useQuery({
    queryKey: ['sample-records', dryRunTargetRule?.trigger?.moduleKey || triggerModuleKey],
    queryFn: () =>
      fetchRecords(dryRunTargetRule?.trigger?.moduleKey || triggerModuleKey, { limit: 10 }),
    enabled: Boolean(dryRunTargetRule || builderOpen),
  });

  const sampleRecords = moduleRecordsData?.records || [];

  const createOrUpdateMutation = useMutation({
    mutationFn: (payload: { id?: string; data: any }) => {
      if (payload.id) {
        return api.patch(`/api/automations/${payload.id}`, payload.data);
      }
      return api.post('/api/automations', payload.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      setBuilderOpen(false);
      setEditingRule(null);
      toast({ title: 'Success', description: 'Automation rule saved successfully' });
    },
    onError: (err: any) => {
      toast({
        title: 'Error saving rule',
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
      toast({ title: 'Status Updated', description: 'Rule state updated' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/automations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      toast({ title: 'Deleted', description: 'Automation removed' });
    },
  });

  const openCreateBuilder = () => {
    setEditingRule(null);
    setRuleName('');
    setTriggerModuleKey(modules[0]?.key || 'lead');
    setTriggerEventType('record.created');
    setConditionField('');
    setConditionOp('eq');
    setConditionValue('');
    setNodes([
      {
        id: 'node_1',
        type: 'action',
        handler: 'update_field',
        config: { fieldKey: 'city', value: 'Kolkata' },
        next: null,
      },
    ]);
    setBuilderOpen(true);
  };

  const openEditBuilder = (rule: AutomationRule) => {
    setEditingRule(rule);
    setRuleName(rule.name);
    setTriggerModuleKey(rule.trigger?.moduleKey || 'lead');
    setTriggerEventType(rule.trigger?.eventType || 'record.created');

    const cond = rule.conditions as any;
    if (cond?.field) {
      setConditionField(cond.field);
      setConditionOp(cond.op || 'eq');
      setConditionValue(cond.value != null ? String(cond.value) : '');
    } else {
      setConditionField('');
      setConditionOp('eq');
      setConditionValue('');
    }

    let parsedNodes: CanvasNode[] = [];
    if (Array.isArray(rule.actions)) {
      const actionsList = rule.actions as any[];
      if (actionsList.length > 0 && actionsList[0].type && ['action', 'branch', 'wait', 'stop'].includes(actionsList[0].type)) {
        parsedNodes = actionsList as CanvasNode[];
      } else {
        parsedNodes = actionsList.map((act: any, idx: number) => ({
          id: act.id || `node_${idx + 1}`,
          type: 'action',
          handler: act.type,
          config: act.config || {},
          next: idx < actionsList.length - 1 ? (actionsList[idx + 1]?.id || `node_${idx + 2}`) : null,
        }));
      }
    } else if (typeof rule.actions === 'object' && rule.actions && Array.isArray((rule.actions as any).nodes)) {
      parsedNodes = (rule.actions as any).nodes;
    }
    setNodes(parsedNodes);
    setBuilderOpen(true);
  };

  const handleSaveRule = () => {
    if (!ruleName.trim()) {
      toast({ title: 'Validation', description: 'Rule name is required', variant: 'destructive' });
      return;
    }
    if (nodes.length === 0) {
      toast({ title: 'Validation', description: 'At least one node is required in the graph', variant: 'destructive' });
      return;
    }

    const payload = {
      name: ruleName.trim(),
      isActive: editingRule ? editingRule.isActive : true,
      moduleId: activeModule?.id || null,
      trigger: {
        eventType: triggerEventType,
        moduleKey: triggerModuleKey,
      },
      conditions: conditionField.trim()
        ? {
            field: conditionField.trim(),
            op: conditionOp,
            value: conditionValue,
          }
        : null,
      actions: {
        nodes,
      },
    };

    createOrUpdateMutation.mutate({
      id: editingRule?.id,
      data: payload,
    });
  };

  const addActionNode = () => {
    const nextId = `node_${nodes.length + 1}`;
    const newNode: ActionNodeModel = {
      id: nextId,
      type: 'action',
      handler: 'update_field',
      config: { fieldKey: activeModule?.fields[0]?.key || 'city', value: 'Updated' },
      next: null,
    };
    if (nodes.length > 0) {
      const last = { ...nodes[nodes.length - 1] };
      if ('next' in last && last.next === null) {
        last.next = nextId;
        setNodes([...nodes.slice(0, -1), last, newNode]);
        return;
      }
    }
    setNodes([...nodes, newNode]);
  };

  const addBranchNode = () => {
    const branchId = `node_${nodes.length + 1}`;
    const trueActionId = `node_${nodes.length + 2}`;
    const falseActionId = `node_${nodes.length + 3}`;

    const trueNode: ActionNodeModel = {
      id: trueActionId,
      type: 'action',
      handler: 'update_field',
      config: { fieldKey: 'city', value: 'Branch True' },
      next: null,
    };
    const falseNode: ActionNodeModel = {
      id: falseActionId,
      type: 'action',
      handler: 'update_field',
      config: { fieldKey: 'city', value: 'Branch False' },
      next: null,
    };

    const branchNode: BranchNodeModel = {
      id: branchId,
      type: 'branch',
      conditions: {
        field: activeModule?.fields[0]?.key || 'source',
        op: 'eq',
        value: 'Website',
      },
      onTrue: trueActionId,
      onFalse: falseActionId,
    };

    if (nodes.length > 0) {
      const last = { ...nodes[nodes.length - 1] };
      if ('next' in last && last.next === null) {
        last.next = branchId;
        setNodes([...nodes.slice(0, -1), last, branchNode, trueNode, falseNode]);
        return;
      }
    }

    setNodes([...nodes, branchNode, trueNode, falseNode]);
  };

  const addWaitNode = () => {
    const waitId = `node_${nodes.length + 1}`;
    const newNode: WaitNodeModel = {
      id: waitId,
      type: 'wait',
      mode: 'duration',
      config: {
        durationMinutes: 60,
      },
      next: null,
    };

    if (nodes.length > 0) {
      const last = { ...nodes[nodes.length - 1] };
      if ('next' in last && last.next === null) {
        last.next = waitId;
        setNodes([...nodes.slice(0, -1), last, newNode]);
        return;
      }
    }
    setNodes([...nodes, newNode]);
  };

  const addStopNode = () => {
    const stopId = `node_${nodes.length + 1}`;
    const newNode: StopNodeModel = {
      id: stopId,
      type: 'stop',
      reason: 'Workflow finished',
    };

    if (nodes.length > 0) {
      const last = { ...nodes[nodes.length - 1] };
      if ('next' in last && last.next === null) {
        last.next = stopId;
        setNodes([...nodes.slice(0, -1), last, newNode]);
        return;
      }
    }
    setNodes([...nodes, newNode]);
  };

  const removeNode = (nodeId: string) => {
    setNodes(nodes.filter((n) => n.id !== nodeId));
  };

  const updateNode = (index: number, updated: CanvasNode) => {
    const copy = [...nodes];
    copy[index] = updated;
    setNodes(copy);
  };

  const triggerDryRun = async () => {
    if (!selectedRecordId) {
      toast({ title: 'Validation', description: 'Please pick a record to test with', variant: 'destructive' });
      return;
    }
    setIsExecutingDryRun(true);
    setDryRunResult(null);

    try {
      let res: DryRunResponse;
      if (dryRunTargetRule?.id) {
        res = await api.post<DryRunResponse>(`/api/automations/${dryRunTargetRule.id}/test`, {
          recordId: selectedRecordId,
        });
      } else {
        const draftPayload = {
          name: ruleName.trim() || 'Dry Run Draft',
          trigger: {
            eventType: triggerEventType,
            moduleKey: triggerModuleKey,
          },
          conditions: conditionField.trim()
            ? {
                field: conditionField.trim(),
                op: conditionOp,
                value: conditionValue,
              }
            : null,
          actions: {
            nodes,
          },
        };
        res = await api.post<DryRunResponse>('/api/automations/test', {
          recordId: selectedRecordId,
          rule: draftPayload,
        });
      }
      setDryRunResult(res);
    } catch (err: any) {
      toast({
        title: 'Dry run execution error',
        description: err.message || 'Failed to simulate rule',
        variant: 'destructive',
      });
    } finally {
      setIsExecutingDryRun(false);
    }
  };

  return (
    <div className="flex-1 p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Zap className="h-6 w-6 text-amber-500" />
            Automations & Graph Engine
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Build branching sales automations with wait nodes, dry-run record testing, and transactional durable execution
          </p>
        </div>
        <Button onClick={openCreateBuilder} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
          <Plus className="h-4 w-4" />
          Create Automation Rule
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold text-slate-500">
              Total Automations
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{automations.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Configured rule graphs</CardContent>
        </Card>

        <Card className="border border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold text-slate-500">
              Active Listeners
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-600">
              {automations.filter((a) => a.isActive).length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Live on transactional outbox</CardContent>
        </Card>

        <Card className="border border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold text-slate-500">
              Node Capabilities
            </CardDescription>
            <CardTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-purple-600" /> Branch & <Clock className="h-4 w-4 text-amber-600" /> Wait
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Condition re-eval on resume</CardContent>
        </Card>

        <Card className="border border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold text-slate-500">
              Engine Status
            </CardDescription>
            <CardTitle className="text-lg font-bold text-blue-600 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Graph Worker Active
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Fast resume & recovery</CardContent>
        </Card>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Configured Automation Rules</h2>
          <span className="text-xs text-slate-400">Metadata-driven graph runner</span>
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
                Create a sales automation rule with branching and scheduled wait actions to automate lead updates.
              </p>
            </div>
            <Button onClick={openCreateBuilder} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Build your first rule
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {automations.map((auto) => {
              const targetModuleKey = auto.trigger?.moduleKey || 'lead';
              const targetModule = modules.find((m) => m.key === targetModuleKey);
              const nodeCount = Array.isArray(auto.actions)
                ? auto.actions.length
                : (auto.actions as any)?.nodes?.length || 1;

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
                        {auto.trigger?.eventType}
                      </Badge>
                      <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                        {String(targetModule?.labelSingular || targetModuleKey)}
                      </Badge>
                      <span className="text-xs text-slate-500 flex items-center gap-1 font-mono">
                        <Sliders className="h-3 w-3 text-slate-400" />
                        {nodeCount} graph {nodeCount === 1 ? 'node' : 'nodes'}
                      </span>
                    </div>

                    {auto.conditions && (
                      <div className="text-xs text-slate-600 bg-slate-100/70 px-2.5 py-1 rounded inline-block font-mono">
                        Filter: {(auto.conditions as any).field} {(auto.conditions as any).op} {String((auto.conditions as any).value ?? '')}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDryRunTargetRule(auto);
                        setSelectedRecordId('');
                        setDryRunResult(null);
                      }}
                      className="text-xs flex items-center gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-purple-600" />
                      Dry Run
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedRuleForRuns(auto)}
                      className="text-xs flex items-center gap-1.5"
                    >
                      <Activity className="h-3.5 w-3.5 text-slate-500" />
                      Run Logs
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditBuilder(auto)}
                      className="text-xs flex items-center gap-1.5"
                    >
                      <Edit2 className="h-3.5 w-3.5 text-slate-500" />
                      Edit Graph
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
                          description: `Are you sure you want to delete automation "${auto.name}"?`,
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

      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900">
                  {editingRule ? 'Edit Automation Graph' : 'Visual Automation Graph Builder'}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Configure triggers, conditions, branches, and wait schedules
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDryRunTargetRule(null);
                  setSelectedRecordId('');
                  setDryRunResult(null);
                }}
                className="text-xs flex items-center gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50"
              >
                <Sparkles className="h-3.5 w-3.5 text-purple-600" />
                Dry Run Test
              </Button>
              <Button
                onClick={handleSaveRule}
                disabled={createOrUpdateMutation.isPending}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
              >
                {createOrUpdateMutation.isPending ? 'Saving...' : 'Save Automation'}
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-100/50">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">General Settings</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-semibold text-slate-700">Automation Name</label>
                  <Input
                    placeholder="e.g. Follow-up Stalled Kolkata Deals"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Target Module</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={triggerModuleKey}
                    onChange={(e) => setTriggerModuleKey(e.target.value)}
                  >
                    {modules.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.labelPlural} ({m.key})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-amber-200 shadow-sm space-y-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-amber-500" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-bold text-slate-900">Trigger</h3>
                </div>
                <Badge variant="outline" className="text-xs font-mono bg-amber-50 text-amber-700 border-amber-200">
                  {triggerEventType}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Event Type</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={triggerEventType}
                    onChange={(e) => setTriggerEventType(e.target.value)}
                  >
                    <option value="record.created">Record Created</option>
                    <option value="record.updated">Record Updated</option>
                    <option value="record.stage_changed">Stage Moved</option>
                    <option value="record.deleted">Record Deleted</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Module Scope</label>
                  <Input disabled value={activeModule?.labelSingular || triggerModuleKey} className="bg-slate-50" />
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-blue-200 shadow-sm space-y-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-blue-500" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCheck className="h-4 w-4 text-blue-500" />
                  <h3 className="text-sm font-bold text-slate-900">Initial Conditions Filter (Optional)</h3>
                </div>
                <span className="text-xs text-slate-400">Must evaluate true before graph execution</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={conditionField}
                    onChange={(e) => setConditionField(e.target.value)}
                  >
                    <option value="">No Filter (Always Run)</option>
                    {activeModule?.fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} ({f.key})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={conditionOp}
                    onChange={(e) => setConditionOp(e.target.value)}
                  >
                    <option value="eq">Equals (==)</option>
                    <option value="neq">Not Equals (!=)</option>
                    <option value="contains">Contains</option>
                    <option value="gt">Greater Than (&gt;)</option>
                    <option value="lt">Less Than (&lt;)</option>
                    <option value="is_empty">Is Empty</option>
                    <option value="is_not_empty">Is Not Empty</option>
                  </select>
                </div>
                <div>
                  <Input
                    placeholder="Comparison Value"
                    value={conditionValue}
                    onChange={(e) => setConditionValue(e.target.value)}
                    className="h-10 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                  <Sliders className="h-4 w-4" />
                  Workflow Node Sequence
                </h3>

                <div className="flex items-center gap-2">
                  <Button onClick={addActionNode} variant="outline" size="sm" className="text-xs h-8">
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Action Node
                  </Button>
                  <Button onClick={addBranchNode} variant="outline" size="sm" className="text-xs h-8 text-purple-700 border-purple-200 hover:bg-purple-50">
                    <GitBranch className="h-3.5 w-3.5 mr-1" />
                    Branch Node
                  </Button>
                  <Button onClick={addWaitNode} variant="outline" size="sm" className="text-xs h-8 text-amber-700 border-amber-200 hover:bg-amber-50">
                    <Clock className="h-3.5 w-3.5 mr-1" />
                    Wait Node
                  </Button>
                  <Button onClick={addStopNode} variant="outline" size="sm" className="text-xs h-8 text-red-700 border-red-200 hover:bg-red-50">
                    <StopCircle className="h-3.5 w-3.5 mr-1" />
                    Stop Node
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                {nodes.map((node, index) => {
                  return (
                    <div
                      key={node.id}
                      className={cn(
                        'bg-white p-5 rounded-xl border shadow-sm space-y-3 relative overflow-hidden transition-all',
                        node.type === 'action' && 'border-slate-200',
                        node.type === 'branch' && 'border-purple-200 bg-purple-50/20',
                        node.type === 'wait' && 'border-amber-200 bg-amber-50/20',
                        node.type === 'stop' && 'border-red-200 bg-red-50/20',
                      )}
                    >
                      <div
                        className={cn(
                          'absolute top-0 left-0 bottom-0 w-1.5',
                          node.type === 'action' && 'bg-blue-500',
                          node.type === 'branch' && 'bg-purple-500',
                          node.type === 'wait' && 'bg-amber-500',
                          node.type === 'stop' && 'bg-red-500',
                        )}
                      />

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                            {node.id}
                          </span>
                          <span className="text-sm font-bold text-slate-900 capitalize flex items-center gap-1.5">
                            {node.type === 'action' && <Zap className="h-4 w-4 text-blue-500" />}
                            {node.type === 'branch' && <GitBranch className="h-4 w-4 text-purple-500" />}
                            {node.type === 'wait' && <Clock className="h-4 w-4 text-amber-500" />}
                            {node.type === 'stop' && <StopCircle className="h-4 w-4 text-red-500" />}
                            {node.type} Node
                          </span>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeNode(node.id)}
                          className="h-7 w-7 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {node.type === 'action' && (
                        <div className="space-y-3 pt-1">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[11px] font-semibold text-slate-600">Handler</label>
                              <select
                                className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={node.handler}
                                onChange={(e) => {
                                  updateNode(index, {
                                    ...node,
                                    handler: e.target.value,
                                    config: {},
                                  });
                                }}
                              >
                                <option value="update_field">Update Field</option>
                                <option value="assign_owner">Assign Owner (Round Robin)</option>
                                <option value="change_stage">Change Pipeline Stage</option>
                                <option value="create_record">Create Linked Record</option>
                                <option value="webhook">Webhook Dispatch</option>
                              </select>
                            </div>

                            {node.handler === 'update_field' && (
                              <div className="space-y-1">
                                <label className="text-[11px] font-semibold text-slate-600">Target Field</label>
                                <select
                                  className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  value={node.config.fieldKey || ''}
                                  onChange={(e) => {
                                    updateNode(index, {
                                      ...node,
                                      config: { ...node.config, fieldKey: e.target.value },
                                    });
                                  }}
                                >
                                  {activeModule?.fields.map((f) => (
                                    <option key={f.key} value={f.key}>
                                      {f.label} ({f.key})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {node.handler === 'change_stage' && (
                              <div className="space-y-1">
                                <label className="text-[11px] font-semibold text-slate-600">Target Stage</label>
                                <select
                                  className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  value={node.config.stageId || ''}
                                  onChange={(e) => {
                                    updateNode(index, {
                                      ...node,
                                      config: { ...node.config, stageId: e.target.value },
                                    });
                                  }}
                                >
                                  <option value="">Select Stage...</option>
                                  {activeModule?.pipelines?.[0]?.stages.map((st) => (
                                    <option key={st.id} value={st.id}>
                                      {st.label} ({st.key})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>

                          {node.handler === 'update_field' && (
                            <div className="space-y-1">
                              <label className="text-[11px] font-semibold text-slate-600">New Value / Template</label>
                              <Input
                                placeholder="Value or {{display_name}} template"
                                value={String(node.config.value ?? '')}
                                onChange={(e) => {
                                  updateNode(index, {
                                    ...node,
                                    config: { ...node.config, value: e.target.value },
                                  });
                                }}
                                className="h-9 text-xs font-mono"
                              />
                            </div>
                          )}

                          {node.handler === 'assign_owner' && (
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[11px] font-semibold text-slate-600">Strategy</label>
                                <select
                                  className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  value={node.config.strategy || 'round_robin'}
                                  onChange={(e) => {
                                    updateNode(index, {
                                      ...node,
                                      config: { ...node.config, strategy: e.target.value },
                                    });
                                  }}
                                >
                                  <option value="round_robin">Round Robin (Active Team Pool)</option>
                                  <option value="fixed">Fixed User</option>
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[11px] font-semibold text-slate-600">Specific User ID (Optional)</label>
                                <Input
                                  placeholder="Leave blank for automatic pool"
                                  value={node.config.ownerId || ''}
                                  onChange={(e) => {
                                    updateNode(index, {
                                      ...node,
                                      config: { ...node.config, ownerId: e.target.value },
                                    });
                                  }}
                                  className="h-9 text-xs"
                                />
                              </div>
                            </div>
                          )}

                          {node.handler === 'webhook' && (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <select
                                  className="w-24 h-9 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold"
                                  value={node.config.method || 'POST'}
                                  onChange={(e) => {
                                    updateNode(index, {
                                      ...node,
                                      config: { ...node.config, method: e.target.value },
                                    });
                                  }}
                                >
                                  <option value="POST">POST</option>
                                  <option value="PUT">PUT</option>
                                  <option value="PATCH">PATCH</option>
                                </select>
                                <Input
                                  placeholder="https://api.domain.com/webhook"
                                  value={node.config.url || ''}
                                  onChange={(e) => {
                                    updateNode(index, {
                                      ...node,
                                      config: { ...node.config, url: e.target.value },
                                    });
                                  }}
                                  className="h-9 text-xs font-mono flex-1"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {node.type === 'branch' && (
                        <div className="space-y-3 pt-1">
                          <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <label className="text-[11px] font-semibold text-slate-600">Field</label>
                              <select
                                className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={node.conditions.field}
                                onChange={(e) => {
                                  updateNode(index, {
                                    ...node,
                                    conditions: { ...node.conditions, field: e.target.value },
                                  });
                                }}
                              >
                                {activeModule?.fields.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label} ({f.key})
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[11px] font-semibold text-slate-600">Operator</label>
                              <select
                                className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={node.conditions.op}
                                onChange={(e) => {
                                  updateNode(index, {
                                    ...node,
                                    conditions: { ...node.conditions, op: e.target.value },
                                  });
                                }}
                              >
                                <option value="eq">Equals (==)</option>
                                <option value="neq">Not Equals (!=)</option>
                                <option value="contains">Contains</option>
                                <option value="gt">Greater Than (&gt;)</option>
                                <option value="lt">Less Than (&lt;)</option>
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[11px] font-semibold text-slate-600">Value</label>
                              <Input
                                placeholder="Value"
                                value={String(node.conditions.value ?? '')}
                                onChange={(e) => {
                                  updateNode(index, {
                                    ...node,
                                    conditions: { ...node.conditions, value: e.target.value },
                                  });
                                }}
                                className="h-9 text-xs"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 bg-purple-50/70 p-3 rounded-lg border border-purple-100">
                            <div className="flex items-center justify-between text-xs font-semibold text-purple-900">
                              <span>True Path Node Target:</span>
                              <Input
                                value={node.onTrue || ''}
                                onChange={(e) => {
                                  updateNode(index, {
                                    ...node,
                                    onTrue: e.target.value,
                                  });
                                }}
                                className="w-28 h-7 text-xs font-mono"
                              />
                            </div>
                            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                              <span>False Path Node Target:</span>
                              <Input
                                placeholder="None (End)"
                                value={node.onFalse || ''}
                                onChange={(e) => {
                                  updateNode(index, {
                                    ...node,
                                    onFalse: e.target.value || null,
                                  });
                                }}
                                className="w-28 h-7 text-xs font-mono"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {node.type === 'wait' && (
                        <div className="space-y-3 pt-1">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[11px] font-semibold text-slate-600">Wait Duration (Minutes)</label>
                              <Input
                                type="number"
                                min={1}
                                value={node.config.durationMinutes || 60}
                                onChange={(e) => {
                                  updateNode(index, {
                                    ...node,
                                    config: { ...node.config, durationMinutes: parseInt(e.target.value, 10) || 0 },
                                  });
                                }}
                                className="h-9 text-xs font-mono"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] font-semibold text-slate-600">Next Node Target</label>
                              <Input
                                placeholder="Next node ID"
                                value={node.next || ''}
                                onChange={(e) => {
                                  updateNode(index, {
                                    ...node,
                                    next: e.target.value || null,
                                  });
                                }}
                                className="h-9 text-xs font-mono"
                              />
                            </div>
                          </div>
                          <div className="text-[11px] text-amber-700 bg-amber-100/60 p-2 rounded">
                            Notice: When wait completes, the engine re-checks original conditions on the record before continuing.
                          </div>
                        </div>
                      )}

                      {node.type === 'stop' && (
                        <div className="space-y-1 pt-1">
                          <label className="text-[11px] font-semibold text-slate-600">Reason</label>
                          <Input
                            placeholder="Reason for ending workflow"
                            value={node.reason || ''}
                            onChange={(e) => {
                              updateNode(index, {
                                ...node,
                                reason: e.target.value,
                              });
                            }}
                            className="h-9 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="text-xs text-slate-400 font-mono">
              Graph contains {nodes.length} nodes
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setBuilderOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSaveRule}
                disabled={createOrUpdateMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {createOrUpdateMutation.isPending ? 'Saving...' : 'Save Rule'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(dryRunTargetRule) || isExecutingDryRun || Boolean(dryRunResult)}
        onOpenChange={(open) => {
          if (!open) {
            setDryRunTargetRule(null);
            setDryRunResult(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-purple-900">
              <Sparkles className="h-5 w-5 text-purple-600" />
              Dry Run Test Simulation
            </DialogTitle>
            <DialogDescription>
              Test automation logic on an actual record without dispatching webhooks or mutating the real database.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 flex-1 overflow-y-auto">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Select Test Record</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-purple-500"
                value={selectedRecordId}
                onChange={(e) => setSelectedRecordId(e.target.value)}
              >
                <option value="">-- Choose a record to test --</option>
                {sampleRecords.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.display_name} ({r.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>

            <Button
              onClick={triggerDryRun}
              disabled={!selectedRecordId || isExecutingDryRun}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center gap-2"
            >
              {isExecutingDryRun ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Simulating Graph Execution...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run Dry Run
                </>
              )}
            </Button>

            {dryRunResult && (
              <div className="space-y-3 pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">
                      Record: {dryRunResult.displayName}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      ID: {dryRunResult.recordId}
                    </span>
                  </div>

                  <Badge
                    className={cn(
                      dryRunResult.conditionsPassed
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800',
                    )}
                  >
                    {dryRunResult.conditionsPassed ? 'Conditions Passed' : 'Conditions Failed'}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                    Execution Steps
                  </span>

                  <div className="space-y-2">
                    {dryRunResult.steps.map((st, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg border border-slate-200 bg-white shadow-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                              {st.nodeId}
                            </span>
                            <span className="font-semibold text-slate-800 capitalize">
                              {st.type} {st.handler ? `(${st.handler})` : ''}
                            </span>
                          </div>

                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase',
                              st.status === 'simulated' && 'bg-blue-100 text-blue-800',
                              st.status === 'matched' && 'bg-purple-100 text-purple-800',
                              st.status === 'failed' && 'bg-red-100 text-red-800',
                              st.status === 'skipped' && 'bg-slate-100 text-slate-800',
                            )}
                          >
                            {st.status}
                          </span>
                        </div>

                        {st.outcome !== undefined && (
                          <div className="text-[11px] font-mono text-purple-700">
                            Branch Evaluation: {st.outcome ? 'TRUE' : 'FALSE'} &rarr; Next: {st.nextNodeId || 'End'}
                          </div>
                        )}

                        {st.output && (
                          <div className="text-[11px] font-mono bg-slate-50 p-2 rounded text-slate-700 border border-slate-100">
                            {JSON.stringify(st.output)}
                          </div>
                        )}

                        {st.error && (
                          <div className="text-[11px] font-mono bg-red-50 p-2 rounded text-red-700 border border-red-100">
                            Error: {st.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDryRunTargetRule(null);
                setDryRunResult(null);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedRuleForRuns)}
        onOpenChange={(open) => !open && setSelectedRuleForRuns(null)}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600" />
              Execution Logs: {selectedRuleForRuns?.name}
            </DialogTitle>
            <DialogDescription>
              Durable execution history with step-by-step node outcomes, wait suspensions, and condition re-check logs.
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
                  className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'px-2.5 py-0.5 rounded-full font-bold text-[11px] capitalize',
                          run.status === 'success' && 'bg-emerald-100 text-emerald-800',
                          run.status === 'failed' && 'bg-red-100 text-red-800',
                          run.status === 'waiting' && 'bg-amber-100 text-amber-800',
                          run.status === 'running' && 'bg-blue-100 text-blue-800',
                          run.status === 'cancelled' && 'bg-purple-100 text-purple-800',
                          run.status === 'skipped' && 'bg-slate-200 text-slate-700',
                        )}
                      >
                        {run.status}
                      </span>
                      <span className="text-slate-500 font-mono text-[11px]">Run #{run.id}</span>
                      {run.recordId && (
                        <span className="text-slate-400 font-mono text-[11px]">
                          (Record: {run.recordId.slice(0, 8)})
                        </span>
                      )}
                    </div>
                    <span className="text-slate-400">
                      {new Date(run.startedAt).toLocaleTimeString()} · {new Date(run.startedAt).toLocaleDateString()}
                    </span>
                  </div>

                  {run.status === 'waiting' && run.log?.resumeAt && (
                    <div className="bg-amber-50 text-amber-800 p-2.5 rounded-lg border border-amber-200 flex items-center gap-2 font-mono text-[11px]">
                      <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                      <span>
                        Run suspended in wait state. Scheduled to resume at: {new Date(run.log.resumeAt).toLocaleString()}
                      </span>
                    </div>
                  )}

                  {run.status === 'cancelled' && run.log?.reason && (
                    <div className="bg-purple-50 text-purple-800 p-2.5 rounded-lg border border-purple-200 flex items-center gap-2 font-mono text-[11px]">
                      <AlertCircle className="h-4 w-4 text-purple-600 shrink-0" />
                      <span>Cancelled on resume: {run.log.reason}</span>
                    </div>
                  )}

                  {run.log?.steps && Array.isArray(run.log.steps) && (
                    <div className="space-y-1.5 pt-1">
                      <span className="font-semibold text-slate-600 text-[11px] block">Node Step Outcomes:</span>
                      <div className="space-y-1">
                        {run.log.steps.map((st: any, idx: number) => (
                          <div
                            key={idx}
                            className="bg-slate-50 p-2 rounded border border-slate-100 flex items-center justify-between text-[11px]"
                          >
                            <div className="flex items-center gap-2 font-mono">
                              <span className="font-bold text-slate-700">{st.nodeId}:</span>
                              <span className="text-slate-600">{st.type}</span>
                              {st.handler && <span className="text-blue-600 font-semibold">[{st.handler}]</span>}
                              {st.outcome !== undefined && (
                                <span className={st.outcome ? 'text-emerald-600' : 'text-slate-500'}>
                                  (outcome: {st.outcome ? 'TRUE' : 'FALSE'})
                                </span>
                              )}
                            </div>

                            <span
                              className={cn(
                                'font-bold uppercase text-[10px]',
                                st.status === 'success' && 'text-emerald-700',
                                st.status === 'matched' && 'text-purple-700',
                                st.status === 'waiting' && 'text-amber-700',
                                st.status === 'failed' && 'text-red-700',
                                st.status === 'skipped' && 'text-slate-500',
                              )}
                            >
                              {st.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {run.log && !run.log.steps && (
                    <div className="bg-slate-900 text-slate-100 p-2.5 rounded font-mono text-[11px] overflow-x-auto max-h-36">
                      <pre>{JSON.stringify(run.log, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRuleForRuns(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
