import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Plus,
  Shield,
  CheckCircle2,
  Mail,
  User,
} from 'lucide-react';
import { api } from '@/api/client';
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
import { RoleDef } from './settings-roles';

export interface UserItem {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  role: {
    id: string;
    name: string;
  } | null;
}

export function SettingsUsersPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [addUserModalOpen, setAddUserModalOpen] = useState(false);
  const [newUserData, setNewUserData] = useState({
    fullName: '',
    email: '',
    roleId: '',
    password: 'welcome123',
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<UserItem[]>({
    queryKey: ['users'],
    queryFn: () => api.get<UserItem[]>('/api/users'),
  });

  const { data: roles = [] } = useQuery<RoleDef[]>({
    queryKey: ['roles'],
    queryFn: () => api.get<RoleDef[]>('/api/roles'),
  });

  const assignRoleMutation = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string | null }) =>
      api.patch(`/api/users/${userId}/role`, { roleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'Role updated', description: 'User role assignment updated successfully.' });
    },
    onError: (err: any) => {
      toast({ title: 'Assignment failed', description: err.message, variant: 'destructive' });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: (data: any) => api.post('/api/users', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setAddUserModalOpen(false);
      setNewUserData({ fullName: '', email: '', roleId: '', password: 'welcome123' });
      toast({ title: 'User created', description: 'New user added to the organization.' });
    },
    onError: (err: any) => {
      toast({ title: 'Create failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserData.fullName.trim() || !newUserData.email.trim()) {
      toast({ title: 'Validation error', description: 'Name and email are required', variant: 'destructive' });
      return;
    }

    createUserMutation.mutate({
      fullName: newUserData.fullName.trim(),
      email: newUserData.email.trim(),
      roleId: newUserData.roleId || undefined,
      password: newUserData.password,
    });
  };

  return (
    <div className="flex-1 p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Users className="h-6 w-6 text-blue-600" />
            Users & Team Members
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage organization members, active security statuses, and role-based access assignments
          </p>
        </div>
        <Button onClick={() => setAddUserModalOpen(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add User
        </Button>
      </div>

      <Card className="border border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="py-4 px-6 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-slate-800">Team Members ({users.length})</CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Assigned security permissions determine which records each user can view and edit
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          {usersLoading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading users...</div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-3 px-6">User</th>
                  <th className="py-3 px-6">Assigned Role</th>
                  <th className="py-3 px-6">Status</th>
                  <th className="py-3 px-6">Joined Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => {
                  const initials = u.fullName
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/60">
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs">
                            {initials || <User className="h-4 w-4" />}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900 block">{u.fullName}</span>
                            <span className="text-slate-400 flex items-center gap-1 font-mono text-[11px]">
                              <Mail className="h-3 w-3" /> {u.email}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-2 max-w-xs">
                          <select
                            className="h-8 px-2.5 rounded-md border border-slate-300 text-xs font-medium focus:ring-1 focus:ring-blue-500 bg-white"
                            value={u.role?.id || ''}
                            onChange={(e) =>
                              assignRoleMutation.mutate({
                                userId: u.id,
                                roleId: e.target.value || null,
                              })
                            }
                          >
                            <option value="">-- No Role (Default) --</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} {r.isSystem ? '(System)' : '(Custom)'}
                              </option>
                            ))}
                          </select>
                          {u.role && (
                            <Badge variant="outline" className="text-[10px] text-blue-700 bg-blue-50 border-blue-200">
                              <Shield className="h-3 w-3 mr-0.5" />
                              {u.role.name}
                            </Badge>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-6">
                        {u.isActive ? (
                          <Badge variant="default" className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-normal">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            Inactive
                          </Badge>
                        )}
                      </td>

                      <td className="py-3.5 px-6 text-slate-400 font-mono text-[11px]">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addUserModalOpen} onOpenChange={setAddUserModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add Team Member</DialogTitle>
              <DialogDescription>
                Create a new user profile and assign their initial access role.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Full Name</label>
                <Input
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={newUserData.fullName}
                  onChange={(e) => setNewUserData({ ...newUserData, fullName: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Email Address</label>
                <Input
                  required
                  type="email"
                  placeholder="e.g. rahul@webingo.com"
                  value={newUserData.email}
                  onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Assign Role</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-slate-300 text-xs bg-white"
                  value={newUserData.roleId}
                  onChange={(e) => setNewUserData({ ...newUserData, roleId: e.target.value })}
                >
                  <option value="">-- Select Role --</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.isSystem ? '(System)' : '(Custom)'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Initial Password</label>
                <Input
                  type="password"
                  placeholder="welcome123"
                  value={newUserData.password}
                  onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddUserModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createUserMutation.isPending}>
                {createUserMutation.isPending ? 'Adding...' : 'Add User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
