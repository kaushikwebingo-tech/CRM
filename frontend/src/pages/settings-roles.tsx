import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  Plus,
  ShieldCheck,
  Trash2,
  Lock,
  Layers,
  Save,
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

export interface RoleDef {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: {
    modules?: Record<
      string,
      {
        read?: 'all' | 'team' | 'own' | 'none';
        create?: boolean;
        update?: 'all' | 'team' | 'own' | 'none';
        delete?: 'all' | 'team' | 'own' | 'none';
      }
    >;
    admin?: {
      manageModules?: boolean;
      manageUsers?: boolean;
      manageAutomations?: boolean;
    };
  };
  createdAt: string;
}

export function SettingsRolesPage(): JSX.Element {
  const { modules } = useSchema();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [createRoleModalOpen, setCreateRoleModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [cloneFromRoleId, setCloneFromRoleId] = useState<string>('');

  const [permissionsState, setPermissionsState] = useState<RoleDef['permissions']>({});

  const { data: roles = [], isLoading } = useQuery<RoleDef[]>({
    queryKey: ['roles'],
    queryFn: () => api.get<RoleDef[]>('/api/roles'),
  });

  const activeRole = roles.find((r) => r.id === (selectedRoleId || roles[0]?.id));

  const handleSelectRole = (role: RoleDef) => {
    setSelectedRoleId(role.id);
    setPermissionsState(role.permissions || {});
  };

  const createRoleMutation = useMutation({
    mutationFn: (data: any) => api.post<RoleDef>('/api/roles', data),
    onSuccess: (newRole: RoleDef) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setCreateRoleModalOpen(false);
      setNewRoleName('');
      setSelectedRoleId(newRole.id);
      setPermissionsState(newRole.permissions || {});
      toast({ title: 'Role created', description: `Role "${newRole.name}" created successfully.` });
    },
    onError: (err: any) => {
      toast({ title: 'Create failed', description: err.message, variant: 'destructive' });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: any }) =>
      api.patch(`/api/roles/${id}`, { permissions }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast({ title: 'Permissions saved', description: 'Role permissions updated successfully.' });
    },
    onError: (err: any) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setSelectedRoleId(null);
      toast({ title: 'Role deleted', description: 'Custom role removed.' });
    },
    onError: (err: any) => {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleModuleScopeChange = (
    moduleKey: string,
    action: 'read' | 'update' | 'delete',
    scope: 'all' | 'team' | 'own' | 'none'
  ) => {
    setPermissionsState((prev) => {
      const currentModulePerm = prev?.modules?.[moduleKey] || {
        read: 'all',
        create: true,
        update: 'all',
        delete: 'all',
      };
      return {
        ...prev,
        modules: {
          ...prev?.modules,
          [moduleKey]: {
            ...currentModulePerm,
            [action]: scope,
          },
        },
      };
    });
  };

  const handleModuleCreateToggle = (moduleKey: string, allowed: boolean) => {
    setPermissionsState((prev) => {
      const currentModulePerm = prev?.modules?.[moduleKey] || {
        read: 'all',
        create: true,
        update: 'all',
        delete: 'all',
      };
      return {
        ...prev,
        modules: {
          ...prev?.modules,
          [moduleKey]: {
            ...currentModulePerm,
            create: allowed,
          },
        },
      };
    });
  };

  const handleAdminToggle = (permKey: 'manageModules' | 'manageUsers' | 'manageAutomations', val: boolean) => {
    setPermissionsState((prev) => ({
      ...prev,
      admin: {
        ...prev?.admin,
        [permKey]: val,
      },
    }));
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) {
      toast({ title: 'Validation error', description: 'Role name is required', variant: 'destructive' });
      return;
    }

    const templateRole = roles.find((r) => r.id === cloneFromRoleId);
    const initialPerms = templateRole ? templateRole.permissions : {};

    createRoleMutation.mutate({
      name: newRoleName.trim(),
      permissions: initialPerms,
    });
  };

  return (
    <div className="flex-1 p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Shield className="h-6 w-6 text-indigo-600" />
            Roles & RBAC Permissions
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure record access scopes (All, Team, Own, None), granular mutations, and admin controls
          </p>
        </div>
        <Button onClick={() => setCreateRoleModalOpen(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Create Custom Role
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        <Card className="border border-slate-200 lg:col-span-1 shadow-sm">
          <CardHeader className="py-3.5 px-4 border-b border-slate-100">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Roles ({roles.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 space-y-1">
            {isLoading ? (
              <div className="p-4 text-center text-xs text-slate-400">Loading roles...</div>
            ) : (
              roles.map((r) => {
                const isSelected = r.id === (activeRole?.id || roles[0]?.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => handleSelectRole(r)}
                    className={cn(
                      'w-full text-left p-2.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-between',
                      isSelected
                        ? 'bg-indigo-50 text-indigo-900 border border-indigo-200'
                        : 'text-slate-700 hover:bg-slate-100/70 border border-transparent'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Shield className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-indigo-600' : 'text-slate-400')} />
                      <span className="truncate">{r.name}</span>
                    </div>
                    {r.isSystem ? (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-slate-200/60">
                        System
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 text-indigo-600 border-indigo-200">
                        Custom
                      </Badge>
                    )}
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-3 space-y-6">
          {activeRole ? (
            <>
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold text-slate-900">{activeRole.name}</h2>
                    {activeRole.isSystem ? (
                      <Badge variant="secondary" className="text-xs flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> System Role
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-200 bg-indigo-50">
                        Custom Role
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {activeRole.isSystem
                      ? 'System roles are pre-seeded with standardized defaults. Permissions can be customized below.'
                      : 'Custom organization role with tailored access scopes.'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {!activeRole.isSystem && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Delete Custom Role',
                          description: `Are you sure you want to permanently delete role "${activeRole.name}"? Users with this role will need to be reassigned.`,
                          confirmText: 'Delete Role',
                          variant: 'destructive',
                        });
                        if (ok) {
                          deleteRoleMutation.mutate(activeRole.id);
                        }
                      }}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete Role
                    </Button>
                  )}

                  <Button
                    size="sm"
                    onClick={() =>
                      updateRoleMutation.mutate({
                        id: activeRole.id,
                        permissions: permissionsState,
                      })
                    }
                    disabled={updateRoleMutation.isPending}
                    className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save Permissions
                  </Button>
                </div>
              </div>

              <Card className="border border-slate-200 shadow-sm overflow-hidden">
                <CardHeader className="bg-slate-50/70 py-3.5 px-6 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-slate-600" />
                    <CardTitle className="text-sm font-bold text-slate-800">Module Access Scopes Matrix</CardTitle>
                  </div>
                  <CardDescription className="text-xs text-slate-500">
                    Define the record boundary (All, Team, Own, None) that this role can access per module
                  </CardDescription>
                </CardHeader>

                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/70 border-b border-slate-200 font-semibold text-slate-600">
                        <th className="py-3 px-6">Module</th>
                        <th className="py-3 px-4">Read Scope</th>
                        <th className="py-3 px-4 text-center">Create</th>
                        <th className="py-3 px-4">Update Scope</th>
                        <th className="py-3 px-4">Delete Scope</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {modules.map((m) => {
                        const mPerm = permissionsState?.modules?.[m.key] || {
                          read: 'all',
                          create: true,
                          update: 'all',
                          delete: 'all',
                        };

                        return (
                          <tr key={m.key} className="hover:bg-slate-50/60">
                            <td className="py-3.5 px-6 font-semibold text-slate-800">
                              <div className="flex items-center gap-2">
                                <span>{m.labelPlural}</span>
                                <span className="text-[10px] font-mono text-slate-400">({m.key})</span>
                              </div>
                            </td>

                            <td className="py-3 px-4">
                              <select
                                className="h-8 px-2 rounded border border-slate-300 text-xs font-medium focus:ring-1 focus:ring-indigo-500"
                                value={mPerm.read || 'all'}
                                onChange={(e) =>
                                  handleModuleScopeChange(m.key, 'read', e.target.value as any)
                                }
                              >
                                <option value="all">All Records</option>
                                <option value="team">Team Only</option>
                                <option value="own">Own Only</option>
                                <option value="none">None (Hidden)</option>
                              </select>
                            </td>

                            <td className="py-3 px-4 text-center">
                              <input
                                type="checkbox"
                                checked={mPerm.create !== false}
                                onChange={(e) => handleModuleCreateToggle(m.key, e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                            </td>

                            <td className="py-3 px-4">
                              <select
                                className="h-8 px-2 rounded border border-slate-300 text-xs font-medium focus:ring-1 focus:ring-indigo-500"
                                value={mPerm.update || 'all'}
                                onChange={(e) =>
                                  handleModuleScopeChange(m.key, 'update', e.target.value as any)
                                }
                              >
                                <option value="all">All Records</option>
                                <option value="team">Team Only</option>
                                <option value="own">Own Only</option>
                                <option value="none">None (Read Only)</option>
                              </select>
                            </td>

                            <td className="py-3 px-4">
                              <select
                                className="h-8 px-2 rounded border border-slate-300 text-xs font-medium focus:ring-1 focus:ring-indigo-500"
                                value={mPerm.delete || 'all'}
                                onChange={(e) =>
                                  handleModuleScopeChange(m.key, 'delete', e.target.value as any)
                                }
                              >
                                <option value="all">All Records</option>
                                <option value="team">Team Only</option>
                                <option value="own">Own Only</option>
                                <option value="none">None (Forbidden)</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card className="border border-slate-200 shadow-sm">
                <CardHeader className="py-3.5 px-6 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-slate-600" />
                    <CardTitle className="text-sm font-bold text-slate-800">Administrative Privileges</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(permissionsState?.admin?.manageModules)}
                      onChange={(e) => handleAdminToggle('manageModules', e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">Manage Modules & Metadata</span>
                      <span className="text-[11px] text-slate-500">Allow creating and modifying entities, custom fields, and stage pipelines</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(permissionsState?.admin?.manageUsers)}
                      onChange={(e) => handleAdminToggle('manageUsers', e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">Manage Users & Roles</span>
                      <span className="text-[11px] text-slate-500">Allow adding teammates and assigning security roles</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(permissionsState?.admin?.manageAutomations)}
                      onChange={(e) => handleAdminToggle('manageAutomations', e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">Manage Automations & Webhooks</span>
                      <span className="text-[11px] text-slate-500">Allow setting up transactional outbox rules and webhook dispatches</span>
                    </div>
                  </label>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="p-12 text-center text-slate-400">Select a role to configure permissions</div>
          )}
        </div>
      </div>

      <Dialog open={createRoleModalOpen} onOpenChange={setCreateRoleModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Create Custom Role</DialogTitle>
              <DialogDescription>
                Define a tailored role for members of your sales, inspection, or support teams.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Role Name</label>
                <Input
                  required
                  placeholder="e.g. Field Inspector"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Clone Permissions From</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-slate-300 text-xs"
                  value={cloneFromRoleId}
                  onChange={(e) => setCloneFromRoleId(e.target.value)}
                >
                  <option value="">-- Blank Defaults --</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.isSystem ? 'System' : 'Custom'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateRoleModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createRoleMutation.isPending}>
                {createRoleMutation.isPending ? 'Creating...' : 'Create Role'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
