import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Box, Layers, Plus, ArrowRight, GitBranch, Trash2, Sliders, ExternalLink, ShieldCheck } from 'lucide-react';
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
import { MODULE_ICON_OPTIONS } from '@/lib/module-icons';

// The same bounded set the sidebar resolves from, so an admin can only pick an
// icon the app can actually render.
const AVAILABLE_ICONS = MODULE_ICON_OPTIONS;

const PRESET_COLORS = [
  { name: 'Blue', value: 'blue' },
  { name: 'Emerald', value: 'emerald' },
  { name: 'Amber', value: 'amber' },
  { name: 'Rose', value: 'rose' },
  { name: 'Purple', value: 'purple' },
  { name: 'Indigo', value: 'indigo' },
];

export function SettingsModulesPage(): JSX.Element {
  const { modules } = useSchema();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    labelSingular: '',
    labelPlural: '',
    key: '',
    nameFieldLabel: 'Name',
    icon: 'Box',
    color: 'blue',
    hasPipeline: true,
  });

  const createModuleMutation = useMutation({
    mutationFn: (data: any) => api.post('/api/modules', data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      setCreateDialogOpen(false);
      toast({ title: 'Module created', description: `${formData.labelSingular} module has been created.` });
      navigate(`/settings/modules/${res.key}`);
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create module',
        description: err.message || 'Validation error',
        variant: 'destructive',
      });
    },
  });

  const deleteModuleMutation = useMutation({
    mutationFn: (key: string) => api.del(`/api/modules/${key}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      toast({ title: 'Module deleted', description: 'Module was soft-deleted successfully.' });
    },
    onError: (err: any) => {
      toast({
        title: 'Delete failed',
        description: err.message || 'Cannot delete module',
        variant: 'destructive',
      });
    },
  });

  const handleSingularChange = (val: string) => {
    const slug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    const plural = val ? (val.endsWith('s') ? `${val}es` : `${val}s`) : '';

    setFormData((prev) => ({
      ...prev,
      labelSingular: val,
      labelPlural: prev.labelPlural === '' || prev.labelPlural === `${prev.labelSingular}s` ? plural : prev.labelPlural,
      key: prev.key === '' || prev.key === prev.labelSingular.toLowerCase().replace(/[^a-z0-9]+/g, '_') ? slug : prev.key,
      nameFieldLabel: prev.nameFieldLabel === 'Name' ? `${val} name` : prev.nameFieldLabel,
    }));
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.labelSingular.trim() || !formData.labelPlural.trim() || !formData.key.trim()) {
      toast({
        title: 'Validation error',
        description: 'Singular label, plural label, and module key are required.',
        variant: 'destructive',
      });
      return;
    }

    createModuleMutation.mutate({
      labelSingular: formData.labelSingular.trim(),
      labelPlural: formData.labelPlural.trim(),
      key: formData.key.trim(),
      nameFieldLabel: formData.nameFieldLabel.trim() || 'Name',
      icon: formData.icon,
      color: formData.color,
      hasPipeline: formData.hasPipeline,
    });
  };

  return (
    <div className="flex-1 p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Layers className="h-6 w-6 text-blue-600" />
            Modules & Metadata
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Build custom entities, manage dynamic schema fields, and configure pipelines without writing code
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Create Module
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {modules.map((mod) => {
          const IconDef = AVAILABLE_ICONS.find((i) => i.name === mod.icon)?.icon || Box;
          const isSystem = (mod as any).isSystem;

          return (
            <Card
              key={mod.key}
              className="border border-slate-200 hover:border-slate-300 transition-all hover:shadow-md flex flex-col justify-between"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-semibold">
                      <IconDef className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-bold text-slate-900">
                        {mod.labelPlural}
                      </CardTitle>
                      <CardDescription className="text-xs font-mono text-slate-400">
                        {mod.key}
                      </CardDescription>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    {isSystem ? (
                      <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-700 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> System
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200 bg-blue-50/50">
                        Custom
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 pt-1 flex-1 flex flex-col justify-between">
                <div className="space-y-2 text-xs text-slate-600">
                  <div className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Singular label:</span>
                    <span className="font-medium text-slate-800">{mod.labelSingular}</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Fields defined:</span>
                    <span className="font-semibold text-slate-800">{mod.fields?.length || 0} fields</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Pipeline support:</span>
                    <span className="font-medium flex items-center gap-1">
                      {mod.hasPipeline ? (
                        <span className="text-emerald-600 flex items-center gap-1">
                          <GitBranch className="h-3.5 w-3.5" /> Enabled
                        </span>
                      ) : (
                        <span className="text-slate-400">Disabled</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-400">Name field:</span>
                    <span className="font-medium text-slate-800">{mod.nameFieldLabel || 'Name'}</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <Link
                    to={`/m/${mod.key}`}
                    className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View records
                  </Link>

                  <div className="flex items-center gap-2">
                    {!isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Delete Custom Module',
                            description: `Are you sure you want to permanently delete module "${mod.labelPlural}" (${mod.key})? All its fields, pipeline configuration, and records will be deleted.`,
                            confirmText: 'Delete Module',
                            variant: 'destructive',
                          });
                          if (ok) {
                            deleteModuleMutation.mutate(mod.key);
                          }
                        }}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 px-2"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/settings/modules/${mod.key}`)}
                      className="h-8 text-xs flex items-center gap-1.5"
                    >
                      <Sliders className="h-3.5 w-3.5 text-slate-500" />
                      Configure
                      <ArrowRight className="h-3 w-3 ml-0.5 text-slate-400" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleCreateSubmit} className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-blue-600" />
                Create New Module
              </DialogTitle>
              <DialogDescription>
                Define a new entity in your CRM metadata. Fields, pipelines, and views can be added immediately.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Singular Name</label>
                  <Input
                    required
                    placeholder="e.g. Site Visit"
                    value={formData.labelSingular}
                    onChange={(e) => handleSingularChange(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Plural Name</label>
                  <Input
                    required
                    placeholder="e.g. Site Visits"
                    value={formData.labelPlural}
                    onChange={(e) => setFormData({ ...formData, labelPlural: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Module Key (snake_case)</label>
                  <Input
                    required
                    placeholder="e.g. site_visit"
                    value={formData.key}
                    onChange={(e) => setFormData({ ...formData, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Name Field Label</label>
                  <Input
                    required
                    placeholder="e.g. Visit Title"
                    value={formData.nameFieldLabel}
                    onChange={(e) => setFormData({ ...formData, nameFieldLabel: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Module Icon</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  >
                    {AVAILABLE_ICONS.map((i) => (
                      <option key={i.name} value={i.name}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Color Tag</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  >
                    {PRESET_COLORS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={formData.hasPipeline}
                    onChange={(e) => setFormData({ ...formData, hasPipeline: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-slate-900 block">Enable Stage Pipeline & Kanban</span>
                    <span className="text-slate-500">Automatically provisions default pipeline and stages for tracking progress</span>
                  </div>
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createModuleMutation.isPending}>
                {createModuleMutation.isPending ? 'Creating...' : 'Create Module'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
