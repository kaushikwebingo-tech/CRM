import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Edit2,
  ChevronUp,
  ChevronDown,
  Layers,
  GitBranch,
  Settings,
  ExternalLink,
  ShieldCheck,
  Type,
  AlignLeft,
  Hash,
  DollarSign,
  Percent,
  Calendar,
  Clock,
  CheckSquare,
  List,
  CheckCheck,
  Mail,
  Phone,
  Globe,
  User,
  Link as LinkIcon,
  Tags,
  Paperclip,
  Binary,
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

const FIELD_TYPE_DEFINITIONS = [
  { key: 'text', label: 'Single Line Text', group: 'basic', icon: Type, description: 'Names, titles, small text' },
  { key: 'long_text', label: 'Long Text', group: 'basic', icon: AlignLeft, description: 'Descriptions, multiline notes' },
  { key: 'number', label: 'Number', group: 'basic', icon: Hash, description: 'Quantities, units, integers or decimals' },
  { key: 'currency', label: 'Currency', group: 'basic', icon: DollarSign, description: 'Monetary amounts with currency code' },
  { key: 'percent', label: 'Percentage', group: 'basic', icon: Percent, description: '0 to 100 percentage values' },
  { key: 'date', label: 'Date', group: 'basic', icon: Calendar, description: 'Calendar date without time' },
  { key: 'datetime', label: 'Date & Time', group: 'basic', icon: Clock, description: 'Timestamp with date and time' },
  { key: 'boolean', label: 'Checkbox', group: 'basic', icon: CheckSquare, description: 'Yes / No or True / False flag' },
  { key: 'select', label: 'Dropdown Select', group: 'advanced', icon: List, description: 'Single choice from configured options' },
  { key: 'multi_select', label: 'Multi-Select', group: 'advanced', icon: CheckCheck, description: 'Multiple choices from options list' },
  { key: 'email', label: 'Email', group: 'basic', icon: Mail, description: 'Validated email address with mailto links' },
  { key: 'phone', label: 'Phone', group: 'basic', icon: Phone, description: 'Phone number with click-to-call' },
  { key: 'url', label: 'Website URL', group: 'basic', icon: Globe, description: 'Web addresses with external links' },
  { key: 'user', label: 'User Lookup', group: 'relation', icon: User, description: 'Assignee or owner from CRM users' },
  { key: 'lookup', label: 'Record Lookup', group: 'relation', icon: LinkIcon, description: 'Relation to another record in CRM' },
  { key: 'tags', label: 'Tags', group: 'advanced', icon: Tags, description: 'Flexible tag pills array' },
  { key: 'file', label: 'Files / Attachment', group: 'advanced', icon: Paperclip, description: 'Upload document and image attachments' },
  { key: 'auto_number', label: 'Auto Number', group: 'system', icon: Binary, description: 'Sequential auto-generated ID' },
];

export function ModuleBuilderPage(): JSX.Element {
  const { moduleKey } = useParams<{ moduleKey: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { modules, getModule } = useSchema();

  const currentModule = getModule(moduleKey || '');
  const [activeTab, setActiveTab] = useState<'fields' | 'pipeline' | 'settings'>('fields');

  const [addFieldModalOpen, setAddFieldModalOpen] = useState(false);
  const [selectedFieldType, setSelectedFieldType] = useState<string>('text');
  const [fieldStep, setFieldStep] = useState<1 | 2>(1);

  const [newFieldData, setNewFieldData] = useState({
    label: '',
    key: '',
    section: 'General',
    helpText: '',
    isRequired: false,
    isUnique: false,
    isSearchable: true,
    isIndexed: false,
    currencyCode: 'INR',
    targetModuleKey: 'lead',
    optionsText: 'Option 1, Option 2, Option 3',
  });

  const [editFieldModalOpen, setEditFieldModalOpen] = useState(false);
  const [fieldToEdit, setFieldToEdit] = useState<any>(null);

  const [addStageModalOpen, setAddStageModalOpen] = useState(false);
  const [newStageData, setNewStageData] = useState({
    label: '',
    key: '',
    color: '#3b82f6',
    type: 'open',
    probability: 20,
  });

  const [editStageModalOpen, setEditStageModalOpen] = useState(false);
  const [stageToEdit, setStageToEdit] = useState<any>(null);

  const defaultPipeline = currentModule?.pipelines?.[0];

  const { data: stages = [] } = useQuery({
    queryKey: ['stages', defaultPipeline?.id],
    queryFn: () => (defaultPipeline?.id ? api.get<any[]>(`/api/pipelines/${defaultPipeline.id}/stages`) : Promise.resolve([])),
    enabled: Boolean(defaultPipeline?.id),
    initialData: defaultPipeline?.stages || [],
  });

  const createFieldMutation = useMutation({
    mutationFn: (data: any) => api.post(`/api/modules/${moduleKey}/fields`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      setAddFieldModalOpen(false);
      setFieldStep(1);
      setNewFieldData({
        label: '',
        key: '',
        section: 'General',
        helpText: '',
        isRequired: false,
        isUnique: false,
        isSearchable: true,
        isIndexed: false,
        currencyCode: 'INR',
        targetModuleKey: 'lead',
        optionsText: 'Option 1, Option 2, Option 3',
      });
      toast({ title: 'Field added', description: 'The field was added to the module schema.' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to add field', description: err.message || 'Validation error', variant: 'destructive' });
    },
  });

  const updateFieldMutation = useMutation({
    mutationFn: ({ fieldKey, data }: { fieldKey: string; data: any }) =>
      api.patch(`/api/modules/${moduleKey}/fields/${fieldKey}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      setEditFieldModalOpen(false);
      toast({ title: 'Field updated', description: 'Field metadata has been updated.' });
    },
    onError: (err: any) => {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' });
    },
  });

  const deleteFieldMutation = useMutation({
    mutationFn: (fieldKey: string) => api.del(`/api/modules/${moduleKey}/fields/${fieldKey}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      toast({ title: 'Field removed', description: 'Field was removed from schema.' });
    },
    onError: (err: any) => {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    },
  });

  const reorderFieldsMutation = useMutation({
    mutationFn: (orderedKeys: string[]) => api.post(`/api/modules/${moduleKey}/fields/reorder`, { orderedKeys }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
    },
  });

  const createStageMutation = useMutation({
    mutationFn: (data: any) => api.post(`/api/pipelines/${defaultPipeline?.id}/stages`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      queryClient.invalidateQueries({ queryKey: ['stages', defaultPipeline?.id] });
      setAddStageModalOpen(false);
      setNewStageData({ label: '', key: '', color: '#3b82f6', type: 'open', probability: 20 });
      toast({ title: 'Stage created', description: 'Stage added to pipeline.' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to create stage', description: err.message, variant: 'destructive' });
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ stageId, data }: { stageId: string; data: any }) =>
      api.patch(`/api/pipelines/${defaultPipeline?.id}/stages/${stageId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      queryClient.invalidateQueries({ queryKey: ['stages', defaultPipeline?.id] });
      setEditStageModalOpen(false);
      toast({ title: 'Stage updated', description: 'Pipeline stage updated successfully.' });
    },
  });

  const deleteStageMutation = useMutation({
    mutationFn: (stageId: string) => api.del(`/api/pipelines/${defaultPipeline?.id}/stages/${stageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      queryClient.invalidateQueries({ queryKey: ['stages', defaultPipeline?.id] });
      toast({ title: 'Stage deleted', description: 'Stage removed from pipeline.' });
    },
    onError: (err: any) => {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    },
  });

  const reorderStagesMutation = useMutation({
    mutationFn: (orderedKeys: string[]) =>
      api.post(`/api/pipelines/${defaultPipeline?.id}/stages/reorder`, { orderedKeys }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      queryClient.invalidateQueries({ queryKey: ['stages', defaultPipeline?.id] });
    },
  });

  if (!currentModule) {
    return (
      <div className="p-8 text-center space-y-4">
        <h2 className="text-lg font-bold text-slate-800">Module not found</h2>
        <Button onClick={() => navigate('/settings/modules')}>Back to Modules</Button>
      </div>
    );
  }

  const fields = currentModule.fields || [];

  const sectionsMap = new Map<string, typeof fields>();
  for (const f of fields) {
    const sec = f.section || 'General';
    if (!sectionsMap.has(sec)) {
      sectionsMap.set(sec, []);
    }
    sectionsMap.get(sec)!.push(f);
  }

  const handleFieldLabelChange = (val: string) => {
    const slug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    setNewFieldData((prev) => ({
      ...prev,
      label: val,
      key: slug,
    }));
  };

  const handleAddFieldSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldData.label.trim() || !newFieldData.key.trim()) {
      toast({ title: 'Validation error', description: 'Field label and key are required', variant: 'destructive' });
      return;
    }

    const config: Record<string, any> = {};
    if (selectedFieldType === 'currency') {
      config.currency = newFieldData.currencyCode || 'INR';
    } else if (selectedFieldType === 'lookup') {
      config.targetModuleKey = newFieldData.targetModuleKey;
    } else if (selectedFieldType === 'select' || selectedFieldType === 'multi_select') {
      const opts = newFieldData.optionsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((label, idx) => ({
          id: `opt_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${idx}`,
          label,
          color: '#3b82f6',
        }));
      config.options = opts;
    }

    createFieldMutation.mutate({
      label: newFieldData.label.trim(),
      key: newFieldData.key.trim(),
      type: selectedFieldType,
      section: newFieldData.section.trim() || 'General',
      helpText: newFieldData.helpText.trim() || undefined,
      isRequired: newFieldData.isRequired,
      isUnique: newFieldData.isUnique,
      isSearchable: newFieldData.isSearchable,
      isIndexed: newFieldData.isIndexed,
      config,
    });
  };

  const handleMoveField = (fieldKey: string, direction: 'up' | 'down') => {
    const currentOrder = fields.map((f) => f.key);
    const index = currentOrder.indexOf(fieldKey);
    if (index === -1) return;

    if (direction === 'up' && index > 0) {
      const temp = currentOrder[index - 1];
      currentOrder[index - 1] = currentOrder[index];
      currentOrder[index] = temp;
      reorderFieldsMutation.mutate(currentOrder);
    } else if (direction === 'down' && index < currentOrder.length - 1) {
      const temp = currentOrder[index + 1];
      currentOrder[index + 1] = currentOrder[index];
      currentOrder[index] = temp;
      reorderFieldsMutation.mutate(currentOrder);
    }
  };

  const handleMoveStage = (stageKey: string, direction: 'up' | 'down') => {
    const currentOrder = stages.map((s) => s.key);
    const index = currentOrder.indexOf(stageKey);
    if (index === -1) return;

    if (direction === 'up' && index > 0) {
      const temp = currentOrder[index - 1];
      currentOrder[index - 1] = currentOrder[index];
      currentOrder[index] = temp;
      reorderStagesMutation.mutate(currentOrder);
    } else if (direction === 'down' && index < currentOrder.length - 1) {
      const temp = currentOrder[index + 1];
      currentOrder[index + 1] = currentOrder[index];
      currentOrder[index] = temp;
      reorderStagesMutation.mutate(currentOrder);
    }
  };

  return (
    <div className="flex-1 p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings/modules')}
            className="text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Modules
          </Button>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {currentModule.labelPlural}
              </h1>
              <span className="text-sm font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                {currentModule.key}
              </span>
              {(currentModule as any).isSystem ? (
                <Badge variant="secondary" className="text-xs">
                  <ShieldCheck className="h-3 w-3 mr-1" /> System
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-blue-600 border-blue-200 bg-blue-50">
                  Custom
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Singular: {currentModule.labelSingular} · Name field: {currentModule.nameFieldLabel || 'Name'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link to={`/m/${currentModule.key}`}>
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs">
              <ExternalLink className="h-3.5 w-3.5" />
              View records
            </Button>
          </Link>
          <Button onClick={() => setAddFieldModalOpen(true)} className="flex items-center gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />
            Add Field
          </Button>
        </div>
      </div>

      <div className="flex border-b border-slate-200 gap-6 text-sm font-medium">
        <button
          onClick={() => setActiveTab('fields')}
          className={cn(
            'pb-3 border-b-2 flex items-center gap-2 transition-colors',
            activeTab === 'fields'
              ? 'border-blue-600 text-blue-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          )}
        >
          <Layers className="h-4 w-4" />
          Fields & Layout ({fields.length})
        </button>

        {currentModule.hasPipeline && (
          <button
            onClick={() => setActiveTab('pipeline')}
            className={cn(
              'pb-3 border-b-2 flex items-center gap-2 transition-colors',
              activeTab === 'pipeline'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            )}
          >
            <GitBranch className="h-4 w-4" />
            Pipeline & Stages ({stages.length})
          </button>
        )}

        <button
          onClick={() => setActiveTab('settings')}
          className={cn(
            'pb-3 border-b-2 flex items-center gap-2 transition-colors',
            activeTab === 'settings'
              ? 'border-blue-600 text-blue-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          )}
        >
          <Settings className="h-4 w-4" />
          General Settings
        </button>
      </div>

      {activeTab === 'fields' && (
        <div className="space-y-6">
          {Array.from(sectionsMap.entries()).map(([sectionName, sectionFields]) => (
            <Card key={sectionName} className="border border-slate-200 overflow-hidden shadow-sm">
              <CardHeader className="bg-slate-50/70 py-3 px-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-700">
                    {sectionName} Section
                  </CardTitle>
                  <span className="text-xs text-slate-400">{sectionFields.length} fields</span>
                </div>
              </CardHeader>

              <CardContent className="p-0 divide-y divide-slate-100">
                {sectionFields.map((field) => {
                  const typeDef = FIELD_TYPE_DEFINITIONS.find((t) => t.key === field.type) || {
                    label: field.type,
                    icon: Type,
                  };
                  const TypeIcon = typeDef.icon;
                  const isCoreStatic = field.isSystem || field.key === 'display_name';

                  return (
                    <div
                      key={field.key}
                      className="p-4 px-6 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => handleMoveField(field.key, 'up')}
                            className="text-slate-300 hover:text-slate-600 p-0.5"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleMoveField(field.key, 'down')}
                            className="text-slate-300 hover:text-slate-600 p-0.5"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="w-8 h-8 rounded bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                          <TypeIcon className="h-4 w-4" />
                        </div>

                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">{field.label}</span>
                            <span className="text-xs font-mono text-slate-400">{field.key}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {typeDef.label}
                            </Badge>
                            {field.isRequired && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                Required
                              </Badge>
                            )}
                            {field.isUnique && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-700 bg-amber-50">
                                Unique
                              </Badge>
                            )}
                            {field.helpText && (
                              <span className="text-[11px] text-slate-400 truncate max-w-xs">{field.helpText}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setFieldToEdit(field);
                            setEditFieldModalOpen(true);
                          }}
                          className="h-8 px-2 text-slate-600 hover:text-slate-900"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>

                        {!isCoreStatic && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              const ok = await confirm({
                                title: 'Remove Field',
                                description: `Are you sure you want to remove field "${field.label}" (${field.key})? Data in this field will no longer be visible.`,
                                confirmText: 'Remove Field',
                                variant: 'destructive',
                              });
                              if (ok) {
                                deleteFieldMutation.mutate(field.key);
                              }
                            }}
                            className="h-8 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'pipeline' && (
        <Card className="border border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle className="text-base font-bold text-slate-900">Pipeline Stages</CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Configure stage sequence, probability percentages, and win/loss markers for kanban
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setAddStageModalOpen(true)} className="text-xs flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add Stage
            </Button>
          </CardHeader>

          <CardContent className="p-0 divide-y divide-slate-100">
            {stages.map((stage: any) => (
              <div key={stage.id || stage.key} className="p-4 px-6 flex items-center justify-between hover:bg-slate-50">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => handleMoveStage(stage.key, 'up')} className="text-slate-300 hover:text-slate-600">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleMoveStage(stage.key, 'down')} className="text-slate-300 hover:text-slate-600">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0"
                    style={{ backgroundColor: stage.color || '#3b82f6' }}
                  />

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-900">{stage.label}</span>
                      <span className="text-xs font-mono text-slate-400">{stage.key}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          stage.type === 'won' && 'bg-emerald-50 text-emerald-700 border-emerald-200',
                          stage.type === 'lost' && 'bg-red-50 text-red-700 border-red-200',
                          stage.type === 'open' && 'bg-blue-50 text-blue-700 border-blue-200'
                        )}
                      >
                        {stage.type.toUpperCase()}
                      </Badge>
                    </div>
                    <span className="text-xs text-slate-500">
                      Probability: {stage.probability != null ? `${stage.probability}%` : 'N/A'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStageToEdit(stage);
                      setEditStageModalOpen(true);
                    }}
                    className="h-8 px-2"
                  >
                    <Edit2 className="h-3.5 w-3.5 text-slate-600" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete Pipeline Stage',
                        description: `Are you sure you want to delete stage "${stage.label}" (${stage.key})? Records currently in this stage should be moved first.`,
                        confirmText: 'Delete Stage',
                        variant: 'destructive',
                      });
                      if (ok) {
                        deleteStageMutation.mutate(stage.id);
                      }
                    }}
                    className="h-8 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeTab === 'settings' && (
        <Card className="border border-slate-200 max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base font-bold text-slate-900">Module Configuration</CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Manage display labels and primary name field settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Singular Label</label>
                <Input defaultValue={currentModule.labelSingular} disabled />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Plural Label</label>
                <Input defaultValue={currentModule.labelPlural} disabled />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Unique Key</label>
              <Input defaultValue={currentModule.key} disabled font-mono />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Primary Name Label</label>
              <Input defaultValue={currentModule.nameFieldLabel || 'Name'} disabled />
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={addFieldModalOpen} onOpenChange={setAddFieldModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-blue-600" />
              Add Field to {currentModule.labelPlural}
            </DialogTitle>
            <DialogDescription>
              {fieldStep === 1
                ? 'Step 1: Choose a field data type from the 18 kernel field types.'
                : 'Step 2: Configure field labels, section placement, and validation rules.'}
            </DialogDescription>
          </DialogHeader>

          {fieldStep === 1 ? (
            <div className="flex-1 overflow-y-auto py-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {FIELD_TYPE_DEFINITIONS.map((def) => {
                  const Icon = def.icon;
                  const isSelected = selectedFieldType === def.key;

                  return (
                    <button
                      key={def.key}
                      type="button"
                      onClick={() => setSelectedFieldType(def.key)}
                      className={cn(
                        'p-3 rounded-lg border text-left transition-all flex flex-col justify-between gap-2',
                        isSelected
                          ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={cn(
                            'p-2 rounded-md',
                            isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className="font-semibold text-xs text-slate-900">{def.label}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-tight">{def.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <form id="add-field-form" onSubmit={handleAddFieldSubmit} className="space-y-4 py-2">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-50 text-blue-800 text-xs">
                <span>Selected Field Type: <strong>{FIELD_TYPE_DEFINITIONS.find((t) => t.key === selectedFieldType)?.label}</strong></span>
                <button
                  type="button"
                  onClick={() => setFieldStep(1)}
                  className="text-blue-600 hover:underline font-semibold"
                >
                  Change Type
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Field Label</label>
                  <Input
                    required
                    placeholder="e.g. Property Address"
                    value={newFieldData.label}
                    onChange={(e) => handleFieldLabelChange(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Field Key (snake_case)</label>
                  <Input
                    required
                    placeholder="e.g. property_address"
                    value={newFieldData.key}
                    onChange={(e) => setNewFieldData({ ...newFieldData, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Form Section</label>
                  <Input
                    placeholder="e.g. General, Location, Schedule"
                    value={newFieldData.section}
                    onChange={(e) => setNewFieldData({ ...newFieldData, section: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Help Text (optional)</label>
                  <Input
                    placeholder="Helper instructions for user"
                    value={newFieldData.helpText}
                    onChange={(e) => setNewFieldData({ ...newFieldData, helpText: e.target.value })}
                  />
                </div>
              </div>

              {selectedFieldType === 'currency' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Currency Code</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-xs"
                    value={newFieldData.currencyCode}
                    onChange={(e) => setNewFieldData({ ...newFieldData, currencyCode: e.target.value })}
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              )}

              {selectedFieldType === 'lookup' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Target Linked Module</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-xs"
                    value={newFieldData.targetModuleKey}
                    onChange={(e) => setNewFieldData({ ...newFieldData, targetModuleKey: e.target.value })}
                  >
                    {modules.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.labelPlural} ({m.key})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(selectedFieldType === 'select' || selectedFieldType === 'multi_select') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Options (comma-separated)</label>
                  <Input
                    placeholder="e.g. Scheduled, Completed, Cancelled"
                    value={newFieldData.optionsText}
                    onChange={(e) => setNewFieldData({ ...newFieldData, optionsText: e.target.value })}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newFieldData.isRequired}
                    onChange={(e) => setNewFieldData({ ...newFieldData, isRequired: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Required field
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newFieldData.isUnique}
                    onChange={(e) => setNewFieldData({ ...newFieldData, isUnique: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Unique field
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newFieldData.isSearchable}
                    onChange={(e) => setNewFieldData({ ...newFieldData, isSearchable: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Searchable in Cmd+K
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newFieldData.isIndexed}
                    onChange={(e) => setNewFieldData({ ...newFieldData, isIndexed: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Fast database index
                </label>
              </div>
            </form>
          )}

          <DialogFooter>
            {fieldStep === 1 ? (
              <>
                <Button variant="outline" onClick={() => setAddFieldModalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setFieldStep(2)}>
                  Next: Configure Details
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setFieldStep(1)}>
                  Back
                </Button>
                <Button form="add-field-form" type="submit" disabled={createFieldMutation.isPending}>
                  {createFieldMutation.isPending ? 'Saving...' : 'Add Field'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editFieldModalOpen} onOpenChange={setEditFieldModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (fieldToEdit) {
                updateFieldMutation.mutate({
                  fieldKey: fieldToEdit.key,
                  data: {
                    label: fieldToEdit.label,
                    section: fieldToEdit.section,
                    helpText: fieldToEdit.helpText,
                    isRequired: fieldToEdit.isRequired,
                  },
                });
              }
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Edit Field: {fieldToEdit?.label}</DialogTitle>
              <DialogDescription>Update field display settings and section grouping.</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Label</label>
                <Input
                  value={fieldToEdit?.label || ''}
                  onChange={(e) => setFieldToEdit({ ...fieldToEdit, label: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Section</label>
                <Input
                  value={fieldToEdit?.section || ''}
                  onChange={(e) => setFieldToEdit({ ...fieldToEdit, section: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Help Text</label>
                <Input
                  value={fieldToEdit?.helpText || ''}
                  onChange={(e) => setFieldToEdit({ ...fieldToEdit, helpText: e.target.value })}
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={Boolean(fieldToEdit?.isRequired)}
                  onChange={(e) => setFieldToEdit({ ...fieldToEdit, isRequired: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Required
              </label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditFieldModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateFieldMutation.isPending}>
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addStageModalOpen} onOpenChange={setAddStageModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createStageMutation.mutate({
                label: newStageData.label.trim(),
                key: newStageData.key.trim() || newStageData.label.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                color: newStageData.color,
                type: newStageData.type,
                probability: Number(newStageData.probability),
              });
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Add Pipeline Stage</DialogTitle>
              <DialogDescription>Define a step in the module's progression lifecycle.</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Stage Label</label>
                <Input
                  required
                  placeholder="e.g. Scheduled"
                  value={newStageData.label}
                  onChange={(e) =>
                    setNewStageData({
                      ...newStageData,
                      label: e.target.value,
                      key: e.target.value.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_'),
                    })
                  }
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Stage Key</label>
                <Input
                  required
                  placeholder="e.g. scheduled"
                  value={newStageData.key}
                  onChange={(e) => setNewStageData({ ...newStageData, key: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Type</label>
                  <select
                    className="w-full h-10 px-2 rounded-md border text-xs"
                    value={newStageData.type}
                    onChange={(e) => setNewStageData({ ...newStageData, type: e.target.value })}
                  >
                    <option value="open">Open (In Progress)</option>
                    <option value="won">Won (Success Closure)</option>
                    <option value="lost">Lost (Lost Closure)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Probability %</label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={newStageData.probability}
                    onChange={(e) => setNewStageData({ ...newStageData, probability: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Stage Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={newStageData.color}
                    onChange={(e) => setNewStageData({ ...newStageData, color: e.target.value })}
                    className="h-10 w-14 rounded border cursor-pointer"
                  />
                  <Input
                    value={newStageData.color}
                    onChange={(e) => setNewStageData({ ...newStageData, color: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddStageModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createStageMutation.isPending}>
                Create Stage
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editStageModalOpen} onOpenChange={setEditStageModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (stageToEdit) {
                updateStageMutation.mutate({
                  stageId: stageToEdit.id,
                  data: {
                    label: stageToEdit.label,
                    color: stageToEdit.color,
                    type: stageToEdit.type,
                    probability: Number(stageToEdit.probability),
                  },
                });
              }
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Edit Stage: {stageToEdit?.label}</DialogTitle>
              <DialogDescription>Update stage label, probability, or type.</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Stage Label</label>
                <Input
                  value={stageToEdit?.label || ''}
                  onChange={(e) => setStageToEdit({ ...stageToEdit, label: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Type</label>
                  <select
                    className="w-full h-10 px-2 rounded-md border text-xs"
                    value={stageToEdit?.type || 'open'}
                    onChange={(e) => setStageToEdit({ ...stageToEdit, type: e.target.value })}
                  >
                    <option value="open">Open</option>
                    <option value="won">Won</option>
                    <option value="lost">Lost</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Probability %</label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={stageToEdit?.probability ?? 0}
                    onChange={(e) => setStageToEdit({ ...stageToEdit, probability: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Stage Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={stageToEdit?.color || '#3b82f6'}
                    onChange={(e) => setStageToEdit({ ...stageToEdit, color: e.target.value })}
                    className="h-10 w-14 rounded border cursor-pointer"
                  />
                  <Input
                    value={stageToEdit?.color || '#3b82f6'}
                    onChange={(e) => setStageToEdit({ ...stageToEdit, color: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditStageModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateStageMutation.isPending}>
                Save Stage
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
