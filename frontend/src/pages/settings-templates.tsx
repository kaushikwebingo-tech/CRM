import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Plus,
  Mail,
  MessageSquare,
  Smartphone,
  Eye,
  Send,
  Trash2,
  Edit2,
  Check,
  AlertCircle,
  CheckCircle2,
  Sparkles,
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
import { ConnectorItem } from './settings-connectors';

export interface TemplateItem {
  id: string;
  orgId: string;
  channel: 'email' | 'whatsapp' | 'sms';
  name: string;
  subject: string | null;
  body: string;
  variables: string[];
  createdAt: string;
  deletedAt: string | null;
}

export interface PreviewResponse {
  recordId: string;
  displayName: string;
  renderedSubject: string;
  renderedBody: string;
  variablesUsed: string[];
}

export interface TestSendResponse {
  success: boolean;
  messageId: string;
  renderedSubject: string;
  renderedBody: string;
  record: {
    id: string;
    displayName: string;
  };
}

export function SettingsTemplatesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { getModule } = useSchema();

  const [channelFilter, setChannelFilter] = useState<'all' | 'email' | 'whatsapp' | 'sms'>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TemplateItem | null>(null);

  const [tplChannel, setTplChannel] = useState<'email' | 'whatsapp' | 'sms'>('email');
  const [tplName, setTplName] = useState('');
  const [tplSubject, setTplSubject] = useState('');
  const [tplBody, setTplBody] = useState('');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTargetTemplate, setPreviewTargetTemplate] = useState<TemplateItem | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);

  const [testSendOpen, setTestSendOpen] = useState(false);
  const [testSendTargetTemplate, setTestSendTargetTemplate] = useState<TemplateItem | null>(null);
  const [testConnectorId, setTestConnectorId] = useState('');
  const [testToEmail, setTestToEmail] = useState('');
  const [testSendResult, setTestSendResult] = useState<TestSendResponse | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const leadModule = getModule('lead');

  const { data: templates = [], isLoading } = useQuery<TemplateItem[]>({
    queryKey: ['templates', channelFilter],
    queryFn: () => {
      const q = channelFilter !== 'all' ? `?channel=${channelFilter}` : '';
      return api.get<TemplateItem[]>(`/api/templates${q}`);
    },
  });

  const { data: connectors = [] } = useQuery<ConnectorItem[]>({
    queryKey: ['connectors'],
    queryFn: () => api.get<ConnectorItem[]>('/api/connectors'),
  });

  const { data: leadRecordResponse } = useQuery({
    queryKey: ['records', 'lead', 'picker'],
    queryFn: () => fetchRecords('lead', { limit: 25 }),
  });

  const leadRecords = leadRecordResponse?.records || [];

  const smtpConnectors = useMemo(
    () => connectors.filter((c) => c.isActive && c.providerKey === 'smtp'),
    [connectors],
  );

  const availableVariables = useMemo(() => {
    const list: Array<{ key: string; label: string; sample: string }> = [
      { key: 'display_name', label: 'Lead Name', sample: 'Acme Enterprise' },
      { key: 'stage', label: 'Pipeline Stage', sample: 'Qualified' },
      { key: 'created_at', label: 'Creation Timestamp', sample: '2026-10-12' },
      { key: 'owner.fullName', label: 'Advisor Name', sample: 'Admin User' },
      { key: 'owner.email', label: 'Advisor Email', sample: 'admin@webingo.com' },
      { key: 'org.name', label: 'Company Name', sample: 'Webingo HQ' },
      { key: 'link.record', label: 'Record Direct Link', sample: 'http://localhost:5173/...' },
      { key: 'link.unsubscribe', label: 'Unsubscribe Link', sample: 'http://localhost:5173/...' },
    ];

    if (leadModule?.fields) {
      for (const field of leadModule.fields) {
        if (!field.isSystem) {
          list.push({
            key: `data.${field.key}`,
            label: `${field.label}`,
            sample: field.key,
          });
        }
      }
    }
    return list;
  }, [leadModule]);

  const createMutation = useMutation({
    mutationFn: (payload: { channel: string; name: string; subject?: string; body: string }) =>
      api.post<TemplateItem>('/api/templates', payload),
    onSuccess: () => {
      toast({ title: 'Template created successfully', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setEditorOpen(false);
      resetEditor();
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create template',
        description: err.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; channel: string; name: string; subject?: string; body: string }) =>
      api.patch<TemplateItem>(`/api/templates/${payload.id}`, {
        channel: payload.channel,
        name: payload.name,
        subject: payload.subject,
        body: payload.body,
      }),
    onSuccess: () => {
      toast({ title: 'Template updated successfully', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setEditorOpen(false);
      resetEditor();
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to update template',
        description: err.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/templates/${id}`),
    onSuccess: () => {
      toast({ title: 'Template deleted', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to delete template',
        description: err.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const previewMutation = useMutation({
    mutationFn: (payload: {
      templateId?: string;
      recordId: string;
      subject?: string;
      body?: string;
      channel?: string;
    }) => api.post<PreviewResponse>('/api/templates/preview', payload),
    onSuccess: (data) => {
      setPreviewData(data);
    },
    onError: (err: any) => {
      toast({
        title: 'Preview resolution failed',
        description: err.message || 'Check variables against compiled module',
        variant: 'destructive',
      });
    },
  });

  const testSendMutation = useMutation({
    mutationFn: (payload: {
      templateId?: string;
      recordId: string;
      connectorId: string;
      toEmail: string;
      subject?: string;
      body?: string;
    }) => api.post<TestSendResponse>('/api/templates/test-send', payload),
    onSuccess: (data) => {
      setTestSendResult(data);
      toast({
        title: 'Test email dispatched successfully',
        description: `Message ID: ${data.messageId}`,
        variant: 'success',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Test dispatch failed',
        description: err.message || 'Check connector credentials and recipient address',
        variant: 'destructive',
      });
    },
  });

  function resetEditor() {
    setEditingTemplate(null);
    setTplChannel('email');
    setTplName('');
    setTplSubject('');
    setTplBody('');
  }

  function handleOpenCreate() {
    resetEditor();
    setTplChannel(channelFilter === 'all' ? 'email' : channelFilter);
    setEditorOpen(true);
  }

  function handleOpenEdit(t: TemplateItem) {
    setEditingTemplate(t);
    setTplChannel(t.channel);
    setTplName(t.name);
    setTplSubject(t.subject || '');
    setTplBody(t.body);
    setEditorOpen(true);
  }

  async function handleDelete(t: TemplateItem) {
    const ok = await confirm({
      title: `Delete template "${t.name}"?`,
      message: 'This template will be removed and will no longer be available in automations.',
      confirmText: 'Delete',
      variant: 'destructive',
    });
    if (ok) {
      deleteMutation.mutate(t.id);
    }
  }

  function handleSaveEditor() {
    if (!tplName.trim()) {
      toast({ title: 'Template name is required', variant: 'destructive' });
      return;
    }
    if (!tplBody.trim()) {
      toast({ title: 'Template body is required', variant: 'destructive' });
      return;
    }

    if (editingTemplate) {
      updateMutation.mutate({
        id: editingTemplate.id,
        channel: tplChannel,
        name: tplName,
        subject: tplChannel === 'email' ? tplSubject : undefined,
        body: tplBody,
      });
    } else {
      createMutation.mutate({
        channel: tplChannel,
        name: tplName,
        subject: tplChannel === 'email' ? tplSubject : undefined,
        body: tplBody,
      });
    }
  }

  function handleInsertVariable(varKey: string, target: 'body' | 'subject' = 'body') {
    const tag = `{{${varKey}}}`;
    if (target === 'subject') {
      setTplSubject((prev) => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + tag);
    } else {
      setTplBody((prev) => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + tag);
    }
    setCopiedKey(varKey);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  function handleInsertFormatter(pipe: string) {
    setTplBody((prev) => prev + ` ${pipe}`);
  }

  function handleInsertConditional() {
    const snippet = `{{#if data.budget}}Budget: {{data.budget | currency}}{{else}}Custom Proposal{{/if}}`;
    setTplBody((prev) => prev + (prev && !prev.endsWith('\n') ? '\n' : '') + snippet);
  }

  function handleOpenPreview(t: TemplateItem) {
    setPreviewTargetTemplate(t);
    setPreviewData(null);
    const defaultRecId = leadRecords[0]?.id || '';
    setSelectedRecordId(defaultRecId);
    setPreviewOpen(true);
    if (defaultRecId) {
      previewMutation.mutate({
        templateId: t.id,
        recordId: defaultRecId,
        channel: t.channel,
      });
    }
  }

  function handleRunPreview() {
    if (!selectedRecordId) {
      toast({ title: 'Select a record to preview against', variant: 'destructive' });
      return;
    }
    if (!previewTargetTemplate) return;
    previewMutation.mutate({
      templateId: previewTargetTemplate.id,
      recordId: selectedRecordId,
      channel: previewTargetTemplate.channel,
    });
  }

  function handleOpenTestSend(t: TemplateItem) {
    setTestSendTargetTemplate(t);
    setTestSendResult(null);
    const defaultRecId = leadRecords[0]?.id || '';
    setSelectedRecordId(defaultRecId);
    const firstConnector = smtpConnectors[0]?.id || '';
    setTestConnectorId(firstConnector);
    setTestToEmail('admin@webingo.com');
    setTestSendOpen(true);
  }

  function handleExecuteTestSend() {
    if (!testSendTargetTemplate) return;
    if (!testConnectorId) {
      toast({ title: 'Select an active SMTP connector', variant: 'destructive' });
      return;
    }
    if (!selectedRecordId) {
      toast({ title: 'Select a lead record', variant: 'destructive' });
      return;
    }
    if (!testToEmail.trim()) {
      toast({ title: 'Destination email is required', variant: 'destructive' });
      return;
    }

    testSendMutation.mutate({
      templateId: testSendTargetTemplate.id,
      recordId: selectedRecordId,
      connectorId: testConnectorId,
      toEmail: testToEmail.trim(),
    });
  }

  function renderChannelBadge(channel: string) {
    switch (channel) {
      case 'email':
        return (
          <Badge className="bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1">
            <Mail className="h-3 w-3" /> Email
          </Badge>
        );
      case 'whatsapp':
        return (
          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> WhatsApp
          </Badge>
        );
      case 'sms':
        return (
          <Badge className="bg-amber-50 text-amber-700 border-amber-200 flex items-center gap-1">
            <Smartphone className="h-3 w-3" /> SMS
          </Badge>
        );
      default:
        return <Badge variant="outline">{channel}</Badge>;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Universal Templates</h1>
          <p className="text-sm text-slate-500">
            One resolver across Email, WhatsApp, and SMS channels with safe variable interpolation and formatters.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleOpenCreate} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New Template
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        {(['all', 'email', 'whatsapp', 'sms'] as const).map((ch) => (
          <button
            key={ch}
            onClick={() => setChannelFilter(ch)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize',
              channelFilter === ch
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            {ch === 'all' ? 'All Channels' : ch}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse h-48 bg-slate-100 border-slate-200" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-slate-300">
          <FileText className="h-10 w-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800">No templates found</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mt-1 mb-4">
            Create multi-channel templates with compiled variable replacement to dispatch automated messages.
          </p>
          <Button onClick={handleOpenCreate} variant="outline" className="gap-2">
            <Plus className="h-4 w-4" />
            Create First Template
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((tpl) => (
            <Card key={tpl.id} className="flex flex-col justify-between hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base font-semibold text-slate-900 line-clamp-1">
                      {tpl.name}
                    </CardTitle>
                    {renderChannelBadge(tpl.channel)}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-500 hover:text-slate-900"
                      onClick={() => handleOpenEdit(tpl)}
                      title="Edit template"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-700"
                      onClick={() => handleDelete(tpl)}
                      title="Delete template"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {tpl.channel === 'email' && tpl.subject && (
                  <CardDescription className="text-xs text-slate-600 line-clamp-1 font-medium mt-1">
                    Subject: {tpl.subject}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                <div className="p-2.5 bg-slate-50 rounded border border-slate-100 text-xs text-slate-700 font-mono line-clamp-3 min-h-[4rem] whitespace-pre-wrap">
                  {tpl.body}
                </div>
                {tpl.variables && tpl.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tpl.variables.slice(0, 4).map((v) => (
                      <span
                        key={v}
                        className="px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded font-mono"
                      >
                        {`{{${v}}}`}
                      </span>
                    ))}
                    {tpl.variables.length > 4 && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-500 rounded">
                        +{tpl.variables.length - 4} more
                      </span>
                    )}
                  </div>
                )}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs"
                    onClick={() => handleOpenPreview(tpl)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview Live
                  </Button>
                  {tpl.channel === 'email' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                      onClick={() => handleOpenTestSend(tpl)}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Test Send
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? `Edit Template: ${editingTemplate.name}` : 'Create New Template'}
            </DialogTitle>
            <DialogDescription>
              Templates resolve compiled lead records and user namespaces safely across all delivery channels.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Template Name</label>
                <Input
                  placeholder="e.g. Lead Welcome Notification"
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Delivery Channel</label>
                <div className="flex items-center gap-2">
                  {(['email', 'whatsapp', 'sms'] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setTplChannel(ch)}
                      className={cn(
                        'flex-1 py-2 px-3 text-xs font-medium rounded-md border transition-colors flex items-center justify-center gap-1.5 capitalize',
                        tplChannel === ch
                          ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {ch === 'email' && <Mail className="h-3.5 w-3.5" />}
                      {ch === 'whatsapp' && <MessageSquare className="h-3.5 w-3.5" />}
                      {ch === 'sms' && <Smartphone className="h-3.5 w-3.5" />}
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {tplChannel === 'email' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">Email Subject Line</label>
                  <span className="text-[10px] text-slate-400">Supports variable interpolation</span>
                </div>
                <Input
                  placeholder="e.g. Welcome {{display_name}} to {{org.name}}"
                  value={tplSubject}
                  onChange={(e) => setTplSubject(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">Available Variables & Helpers</label>
                <span className="text-[10px] text-slate-400">Click to insert tag into editor</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-md border border-slate-200 space-y-2.5">
                <div>
                  <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Standard & Dynamic Lead Variables
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {availableVariables.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => handleInsertVariable(v.key, 'body')}
                        className="px-2 py-1 text-xs bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50 rounded text-slate-700 font-mono transition-colors flex items-center gap-1"
                        title={v.label}
                      >
                        {copiedKey === v.key ? (
                          <Check className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <Plus className="h-3 w-3 text-slate-400" />
                        )}
                        {`{{${v.key}}}`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 text-xs">
                  <span className="text-[11px] font-medium text-slate-500">Pipes:</span>
                  {[
                    { pipe: '| upper', label: 'upper' },
                    { pipe: '| lower', label: 'lower' },
                    { pipe: '| capitalize', label: 'capitalize' },
                    { pipe: '| currency', label: 'currency (₹)' },
                    { pipe: '| date', label: 'date' },
                  ].map((p) => (
                    <button
                      key={p.pipe}
                      type="button"
                      onClick={() => handleInsertFormatter(p.pipe)}
                      className="px-2 py-0.5 text-[11px] bg-slate-200/80 hover:bg-slate-300 rounded font-mono text-slate-700"
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleInsertConditional}
                    className="ml-auto px-2 py-0.5 text-[11px] bg-blue-100 text-blue-800 hover:bg-blue-200 rounded font-medium flex items-center gap-1"
                  >
                    <Sparkles className="h-3 w-3" />
                    Insert #if Conditional
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Template Message Body</label>
              <textarea
                rows={8}
                value={tplBody}
                onChange={(e) => setTplBody(e.target.value)}
                placeholder="Write your template here with {{display_name}}, {{data.requirement}}, {{owner.fullName}}..."
                className="w-full rounded-md border border-slate-200 p-3 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEditor}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-blue-600" />
              Live Preview: {previewTargetTemplate?.name}
            </DialogTitle>
            <DialogDescription>
              Interpolates template variables against a real lead record in the database.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Select Real Record</label>
              <div className="flex gap-2">
                <select
                  value={selectedRecordId}
                  onChange={(e) => setSelectedRecordId(e.target.value)}
                  className="flex-1 rounded-md border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">-- Choose a Lead Record --</option>
                  {leadRecords.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.display_name} ({r.id.slice(0, 8)}...)
                    </option>
                  ))}
                </select>
                <Button
                  onClick={handleRunPreview}
                  disabled={!selectedRecordId || previewMutation.isPending}
                  size="sm"
                >
                  {previewMutation.isPending ? 'Resolving...' : 'Refresh Preview'}
                </Button>
              </div>
            </div>

            {previewData && (
              <div className="space-y-3 pt-2">
                <div className="p-3 bg-blue-50/60 border border-blue-100 rounded text-xs space-y-1">
                  <div className="flex justify-between text-slate-700">
                    <span className="font-semibold">Context Record:</span>
                    <span className="font-mono">{previewData.displayName}</span>
                  </div>
                  <div className="flex justify-between text-slate-700">
                    <span className="font-semibold">Variables Detected:</span>
                    <span className="font-mono text-blue-700">
                      {previewData.variablesUsed.join(', ') || 'None'}
                    </span>
                  </div>
                </div>

                {previewData.renderedSubject && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-600">Rendered Subject:</div>
                    <div className="p-2.5 bg-slate-100 rounded text-sm font-medium text-slate-900 border border-slate-200">
                      {previewData.renderedSubject}
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-600">Rendered Output:</div>
                  <div className="p-3.5 bg-white rounded border border-slate-200 text-sm text-slate-900 whitespace-pre-wrap font-sans shadow-inner">
                    {previewData.renderedBody}
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
            {previewTargetTemplate?.channel === 'email' && (
              <Button
                onClick={() => {
                  setPreviewOpen(false);
                  if (previewTargetTemplate) handleOpenTestSend(previewTargetTemplate);
                }}
                className="gap-1.5"
              >
                <Send className="h-4 w-4" />
                Proceed to Test Send
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testSendOpen} onOpenChange={setTestSendOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-600" />
              Test Email Dispatch: {testSendTargetTemplate?.name}
            </DialogTitle>
            <DialogDescription>
              Renders the template against a lead record and sends real email through a configured SMTP connector.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">SMTP Connector</label>
              <select
                value={testConnectorId}
                onChange={(e) => setTestConnectorId(e.target.value)}
                className="w-full rounded-md border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">-- Choose Connected SMTP --</option>
                {smtpConnectors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.config.host}:{c.config.port})
                  </option>
                ))}
              </select>
              {smtpConnectors.length === 0 && (
                <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  No active SMTP connectors found. Please configure one in Settings &gt; Connectors.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Context Lead Record</label>
              <select
                value={selectedRecordId}
                onChange={(e) => setSelectedRecordId(e.target.value)}
                className="w-full rounded-md border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">-- Choose Lead Record --</option>
                {leadRecords.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.display_name} ({r.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Recipient Email Address</label>
              <Input
                placeholder="recipient@example.com"
                value={testToEmail}
                onChange={(e) => setTestToEmail(e.target.value)}
              />
            </div>

            {testSendResult && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md space-y-1 text-xs">
                <div className="font-semibold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Email delivered to SMTP transport
                </div>
                <div className="text-emerald-700 font-mono">
                  Message ID: {testSendResult.messageId}
                </div>
                <div className="text-slate-700 pt-1">
                  <strong>Subject:</strong> {testSendResult.renderedSubject}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setTestSendOpen(false)}>
              Close
            </Button>
            <Button
              onClick={handleExecuteTestSend}
              disabled={
                !testConnectorId ||
                !selectedRecordId ||
                !testToEmail ||
                testSendMutation.isPending
              }
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {testSendMutation.isPending ? 'Sending...' : 'Send Test Mail'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
