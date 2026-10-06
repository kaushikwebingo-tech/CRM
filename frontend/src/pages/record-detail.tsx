import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSchema } from '@/hooks/use-schema';
import { fetchRecord, updateRecord, changeStage, deleteRecord, fetchTimeline, TimelineEvent } from '@/api/records';
import { getFieldComponent } from '@/components/fields/registry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  ArrowLeft,
  Save,
  Trash2,
  Mail,
  Phone,
  Copy,
  Check,
  Clock,
  User as UserIcon,
  MessageSquare,
  Send,
  AlertCircle,
  History,
  GitCommit,
} from 'lucide-react';

export function RecordDetail(): JSX.Element {
  const { moduleKey, recordId } = useParams<{ moduleKey: string; recordId: string }>();
  const navigate = useNavigate();
  const { getModule } = useSchema();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const moduleDef = moduleKey ? getModule(moduleKey) : undefined;

  const {
    data: record,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['records', moduleKey, recordId],
    queryFn: () => (moduleKey && recordId ? fetchRecord(moduleKey, recordId) : null),
    enabled: Boolean(moduleKey && recordId),
  });

  const { data: timelineEvents } = useQuery<TimelineEvent[]>({
    queryKey: ['records', moduleKey, recordId, 'timeline'],
    queryFn: () => (moduleKey && recordId ? fetchTimeline(moduleKey, recordId) : []),
    enabled: Boolean(moduleKey && recordId),
  });

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [displayName, setDisplayName] = useState('');
  const [currentStageId, setCurrentStageId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('');
  const [copiedId, setCopiedId] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (record) {
      setDisplayName(record.display_name || '');
      setCurrentStageId(record.stage_id || '');
      setFormData(record.data || {});
      setIsDirty(false);
    }
  }, [record]);

  const sections = Array.from(
    new Set(
      moduleDef?.fields
        .filter((f) => !f.isSystem && f.key !== 'stage_id' && f.key !== 'owner_id')
        .map((f) => f.section || 'General') || []
    )
  );

  useEffect(() => {
    if (sections.length > 0 && (!activeTab || !sections.includes(activeTab))) {
      setActiveTab(sections[0]);
    }
  }, [sections, activeTab]);

  const updateMut = useMutation({
    mutationFn: (payload: { display_name?: string; stage_id?: string; data?: Record<string, unknown> }) =>
      updateRecord(moduleKey!, recordId!, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(['records', moduleKey, recordId], updated);
      queryClient.invalidateQueries({ queryKey: ['records', moduleKey, 'list'] });
      queryClient.invalidateQueries({ queryKey: ['records', moduleKey, recordId, 'timeline'] });
      setIsDirty(false);
      toast({
        title: 'Changes saved',
        description: `${updated.display_name} has been updated successfully.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to save',
        description: err.message || 'An error occurred while saving.',
        variant: 'destructive',
      });
    },
  });

  const stageMut = useMutation({
    mutationFn: (stageId: string) => changeStage(moduleKey!, recordId!, stageId),
    onSuccess: (updated) => {
      setCurrentStageId(updated.stage_id || '');
      queryClient.setQueryData(['records', moduleKey, recordId], updated);
      queryClient.invalidateQueries({ queryKey: ['records', moduleKey, 'list'] });
      queryClient.invalidateQueries({ queryKey: ['records', moduleKey, recordId, 'timeline'] });
      toast({
        title: 'Stage updated',
        description: 'Pipeline stage has been updated.',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Stage update failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteRecord(moduleKey!, recordId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records', moduleKey] });
      toast({
        title: 'Record deleted',
        description: 'The record was soft deleted.',
      });
      navigate(`/m/${moduleKey}`);
    },
    onError: (err: any) => {
      toast({
        title: 'Delete failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  if (!moduleKey || !recordId) {
    return <div className="p-8 text-red-500 font-medium">Invalid route parameters.</div>;
  }

  if (isLoading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-6 w-32 bg-slate-200 rounded" />
        <div className="h-20 bg-slate-200 rounded-lg" />
        <div className="h-12 bg-slate-200 rounded-lg" />
        <div className="h-96 bg-slate-200 rounded-lg" />
      </div>
    );
  }

  if (error || !record || !moduleDef) {
    return (
      <div className="p-8 max-w-7xl mx-auto text-center space-y-4">
        <AlertCircle className="h-12 w-12 text-rose-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-800">Record Not Found</h2>
        <p className="text-sm text-slate-500">
          The requested record could not be loaded or may have been deleted.
        </p>
        <Button onClick={() => navigate(`/m/${moduleKey}`)} variant="outline">
          Back to {moduleDef?.labelPlural || 'Module'}
        </Button>
      </div>
    );
  }

  const defaultPipeline = moduleDef.pipelines?.find((p) => p.isDefault) || moduleDef.pipelines?.[0];
  const stages = defaultPipeline?.stages || [];
  const currentStage = stages.find((s) => s.id === currentStageId);

  const handleFieldChange = (key: string, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
    setIsDirty(true);
  };

  const handleSaveAll = () => {
    updateMut.mutate({
      display_name: displayName,
      stage_id: currentStageId || undefined,
      data: formData,
    });
  };

  const handleStageChange = (newStageId: string) => {
    if (newStageId === currentStageId) return;
    setCurrentStageId(newStageId);
    stageMut.mutate(newStageId);
  };

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to delete "${displayName}"?`)) {
      deleteMut.mutate();
    }
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(recordId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const emailValue = String(formData.email || '');
  const phoneValue = String(formData.phone || '');
  const commentsList: Array<{ id: string; text: string; author: string; createdAt: string }> =
    Array.isArray(formData._comments) ? formData._comments : [];

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    const commentItem = {
      id: crypto.randomUUID(),
      text: newComment.trim(),
      author: 'You',
      createdAt: new Date().toISOString(),
    };
    const updatedComments = [commentItem, ...commentsList];
    const updatedData = { ...formData, _comments: updatedComments };
    setFormData(updatedData);
    setNewComment('');
    updateMut.mutate({
      display_name: displayName,
      stage_id: currentStageId || undefined,
      data: updatedData,
    });
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) return 'R';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  const activeSectionFields = moduleDef.fields.filter(
    (f) => (f.section || 'General') === activeTab && !f.isSystem && f.key !== 'stage_id' && f.key !== 'owner_id'
  );

  return (
    <div className="min-h-full bg-slate-50 flex flex-col pb-12">
      <div className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              to={`/m/${moduleKey}`}
              className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
              title={`Back to ${moduleDef.labelPlural}`}
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>

            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-lg flex items-center justify-center shadow-sm">
                {getInitials(displayName)}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <Input
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      setIsDirty(true);
                    }}
                    className="font-bold text-xl text-slate-900 h-9 px-2 -ml-2 border-transparent hover:border-slate-300 focus:border-blue-500 bg-transparent hover:bg-white focus:bg-white transition-colors rounded"
                  />
                  {currentStage && (
                    <Badge
                      variant="outline"
                      className={`text-xs font-semibold ${
                        currentStage.type === 'won'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : currentStage.type === 'lost'
                          ? 'bg-rose-50 text-rose-700 border-rose-300'
                          : 'bg-blue-50 text-blue-700 border-blue-300'
                      }`}
                    >
                      {currentStage.label}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                  <span className="font-mono flex items-center gap-1">
                    ID: {recordId.substring(0, 8)}...
                    <button
                      type="button"
                      onClick={handleCopyId}
                      className="text-slate-400 hover:text-slate-700 ml-0.5"
                      title="Copy full UUID"
                    >
                      {copiedId ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-slate-400" />
                    Created: {new Date(record.createdAt || (record as any).created_at).toLocaleDateString()}
                  </span>
                  {record.owner && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <UserIcon className="h-3 w-3 text-slate-400" />
                        {record.owner.fullName}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto">
            {emailValue && (
              <a
                href={`mailto:${emailValue}`}
                className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-600 hover:text-blue-600 hover:border-blue-300 transition-colors shadow-sm"
                title={`Email ${emailValue}`}
              >
                <Mail className="h-4 w-4" />
              </a>
            )}

            {phoneValue && (
              <a
                href={`tel:${phoneValue}`}
                className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-600 hover:text-emerald-600 hover:border-emerald-300 transition-colors shadow-sm"
                title={`Call ${phoneValue}`}
              >
                <Phone className="h-4 w-4" />
              </a>
            )}

            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleDelete}
              className="h-9 w-9 text-slate-500 hover:text-rose-600 hover:border-rose-300"
              title="Delete record"
            >
              <Trash2 className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              onClick={handleSaveAll}
              disabled={updateMut.isPending || !isDirty}
              className={`h-9 gap-1.5 px-4 font-semibold text-white shadow-sm transition-all ${
                isDirty
                  ? 'bg-blue-600 hover:bg-blue-700 animate-pulse'
                  : 'bg-slate-700 hover:bg-slate-800 opacity-90'
              }`}
            >
              <Save className="h-4 w-4" />
              <span>{updateMut.isPending ? 'Saving...' : isDirty ? 'Save Changes' : 'Saved'}</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto w-full px-6 pt-6 space-y-6">
        {moduleDef.hasPipeline && stages.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 overflow-x-auto">
            <div className="flex items-center min-w-max gap-1">
              {stages.map((stage) => {
                const isActive = stage.id === currentStageId;
                const isWon = stage.type === 'won';
                const isLost = stage.type === 'lost';

                let bgClass = 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200';
                if (isActive) {
                  if (isWon) {
                    bgClass = 'bg-emerald-600 text-white border-emerald-600 shadow-sm';
                  } else if (isLost) {
                    bgClass = 'bg-rose-600 text-white border-rose-600 shadow-sm';
                  } else {
                    bgClass = 'bg-blue-600 text-white border-blue-600 shadow-sm';
                  }
                }

                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => handleStageChange(stage.id)}
                    disabled={stageMut.isPending}
                    className={`relative flex items-center px-4 py-2 text-xs font-semibold rounded-lg border transition-all ${bgClass}`}
                  >
                    <span className="truncate">{stage.label}</span>
                    {isActive && <Check className="ml-1.5 h-3.5 w-3.5 stroke-[2.5]" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50/70 px-4 pt-3 flex items-center gap-1 overflow-x-auto">
                {sections.map((sectionName) => {
                  const isCurrent = activeTab === sectionName;
                  return (
                    <button
                      key={sectionName}
                      type="button"
                      onClick={() => setActiveTab(sectionName)}
                      className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                        isCurrent
                          ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                          : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                      }`}
                    >
                      {sectionName}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setActiveTab('__timeline__')}
                  className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    activeTab === '__timeline__'
                      ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                      : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                  }`}
                >
                  <History className="h-4 w-4" />
                  <span>Timeline & Audit</span>
                  {timelineEvents && timelineEvents.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 font-bold">
                      {timelineEvents.length}
                    </span>
                  )}
                </button>
              </div>

              <div className="p-6">
                {activeTab === '__timeline__' ? (
                  <div className="space-y-4">
                    {timelineEvents && timelineEvents.length > 0 ? (
                      <div className="relative border-l border-slate-200 ml-4 space-y-6 py-2">
                        {timelineEvents.map((ev) => (
                          <div key={ev.id} className="relative pl-6">
                            <div className="absolute -left-2.5 top-1 h-5 w-5 rounded-full bg-white border-2 border-blue-600 flex items-center justify-center">
                              <GitCommit className="h-2.5 w-2.5 text-blue-600" />
                            </div>

                            <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-800">
                                    {ev.actor_name || 'System User'}
                                  </span>
                                  <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                                    {ev.type.replace('_', ' ')}
                                  </Badge>
                                </div>
                                <span className="text-slate-400">
                                  {new Date(ev.created_at).toLocaleString()}
                                </span>
                              </div>

                              {ev.type === 'stage_changed' ? (
                                <p className="text-xs text-slate-700">
                                  Stage changed to{' '}
                                  <span className="font-bold text-blue-600">
                                    {String(ev.payload?.to_stage_label || ev.changes?.stage_id?.to || 'new stage')}
                                  </span>
                                </p>
                              ) : ev.changes && Object.keys(ev.changes).length > 0 ? (
                                <div className="text-xs text-slate-600 space-y-1 pt-1">
                                  {Object.entries(ev.changes).map(([k, diff]) => (
                                    <div
                                      key={k}
                                      className="font-mono text-[11px] bg-white px-2 py-1 rounded border border-slate-100"
                                    >
                                      <span className="text-slate-500 font-sans">{k}:</span>{' '}
                                      <span className="text-rose-600 line-through">
                                        {String(diff.from ?? 'empty')}
                                      </span>{' '}
                                      <span className="text-slate-400">→</span>{' '}
                                      <span className="text-emerald-600 font-semibold">
                                        {String(diff.to ?? 'empty')}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-500">Event recorded</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-12 text-center text-slate-400 text-sm">
                        No audit events recorded yet.
                      </div>
                    )}
                  </div>
                ) : activeSectionFields.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-sm">
                    No fields configured in this section.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                    {activeSectionFields.map((fieldDef) => {
                      const ComponentSet = getFieldComponent(fieldDef.type);
                      const FieldInput = ComponentSet.Input;
                      const val = formData[fieldDef.key];

                      return (
                        <div
                          key={fieldDef.key}
                          className={fieldDef.type === 'long_text' ? 'md:col-span-2' : ''}
                        >
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                            {fieldDef.label}
                            {fieldDef.isRequired && <span className="text-red-500 ml-1">*</span>}
                          </label>

                          <div className="bg-slate-50/50 p-1 rounded-lg border border-slate-200/80 focus-within:border-blue-500 focus-within:bg-white focus-within:ring-1 focus-within:ring-blue-500 transition-all">
                            <FieldInput
                              field={fieldDef}
                              value={val}
                              onChange={(newVal) => handleFieldChange(fieldDef.key, newVal)}
                              disabled={updateMut.isPending}
                            />
                          </div>

                          {fieldDef.helpText && (
                            <p className="mt-1 text-xs text-slate-400">{fieldDef.helpText}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-3">
                <MessageSquare className="h-4 w-4 text-blue-600" />
                <span>Comments & Notes</span>
              </div>

              <div className="space-y-2">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment or internal note..."
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddComment}
                    disabled={!newComment.trim() || updateMut.isPending}
                    className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 text-xs h-8"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Post Note</span>
                  </Button>
                </div>
              </div>

              <div className="space-y-3 pt-2 max-h-96 overflow-y-auto">
                {commentsList.length === 0 ? (
                  <p className="text-xs text-slate-400 italic text-center py-4">
                    No comments yet. Leave a note above.
                  </p>
                ) : (
                  commentsList.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-semibold text-slate-700">{c.author}</span>
                        <span className="text-[10px]">{new Date(c.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{c.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                System Metadata
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span className="text-slate-500">Module</span>
                  <span className="font-medium text-slate-800">{moduleDef.labelSingular}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span className="text-slate-500">Record UUID</span>
                  <span className="font-mono text-slate-700">{recordId}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span className="text-slate-500">Last Modified</span>
                  <span className="text-slate-700">
                    {new Date(record.updatedAt || (record as any).updated_at).toLocaleString()}
                  </span>
                </div>
                {record.stage_since && (
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">In Current Stage Since</span>
                    <span className="text-slate-700">
                      {new Date(record.stage_since).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
