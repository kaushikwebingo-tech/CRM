import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plug,
  Plus,
  Mail,
  Globe,
  Trash2,
  RefreshCw,
  Send,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
  Server,
  Key,
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
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

export interface ConnectorItem {
  id: string;
  orgId: string;
  providerKey: string;
  name: string;
  config: {
    host?: string;
    port?: number;
    secure?: boolean;
    fromAddress?: string;
    fromName?: string;
    baseUrl?: string;
    _health?: {
      ok: boolean;
      detail?: string;
      lastCheckedAt?: string;
    };
    [key: string]: any;
  };
  isActive: boolean;
  createdAt: string;
}

export interface ProviderItem {
  key: string;
  label: string;
  category: string;
  icon: string;
  capabilities: string[];
}

export function SettingsConnectorsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [createOpen, setCreateOpen] = useState(false);
  const [testMailOpen, setTestMailOpen] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorItem | null>(null);

  const [providerKey, setProviderKey] = useState('smtp');
  const [connectorName, setConnectorName] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpFromAddress, setSmtpFromAddress] = useState('');
  const [smtpFromName, setSmtpFromName] = useState('');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookApiKey, setWebhookApiKey] = useState('');

  const [testToEmail, setTestToEmail] = useState('');
  const [testSubject, setTestSubject] = useState('Test Email from Connected SMTP');
  const [testBody, setTestBody] = useState('This confirms your SMTP connector is healthy and delivering mail.');

  const { data: connectors = [], isLoading } = useQuery<ConnectorItem[]>({
    queryKey: ['connectors'],
    queryFn: () => api.get<ConnectorItem[]>('/api/connectors'),
  });

  const { data: providers = [] } = useQuery<ProviderItem[]>({
    queryKey: ['connectors-providers'],
    queryFn: () => api.get<ProviderItem[]>('/api/connectors/providers'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post('/api/connectors', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      setCreateOpen(false);
      resetForm();
      toast({ title: 'Connector created', description: 'Connector encrypted in vault and ready for use' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create connector',
        description: err.message || 'Validation error',
        variant: 'destructive',
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/api/connectors/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      toast({ title: 'Updated', description: 'Connector status updated' });
    },
  });

  const healthCheckMutation = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; detail?: string }>(`/api/connectors/${id}/health-check`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      if (data.ok) {
        toast({ title: 'Health check passed', description: data.detail || 'Connection verified' });
      } else {
        toast({
          title: 'Health check failed',
          description: data.detail || 'Connection refused',
          variant: 'destructive',
        });
      }
    },
    onError: (err: any) => {
      toast({ title: 'Health check error', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/connectors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      toast({ title: 'Deleted', description: 'Connector removed' });
    },
  });

  const sendTestMailMutation = useMutation({
    mutationFn: ({ id, toEmail, subject, text }: { id: string; toEmail: string; subject: string; text: string }) =>
      api.post<{ success: boolean; messageId: string }>(`/api/connectors/${id}/test-email`, {
        toEmail,
        subject,
        text,
      }),
    onSuccess: (res) => {
      setTestMailOpen(false);
      toast({
        title: 'Test Email Sent!',
        description: `Delivered via SMTP. Message ID: ${res.messageId}`,
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Test email failed',
        description: err.message || 'Failed to send mail',
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setConnectorName('');
    setSmtpHost('');
    setSmtpPort(587);
    setSmtpSecure(false);
    setSmtpFromAddress('');
    setSmtpFromName('');
    setSmtpUser('');
    setSmtpPass('');
    setWebhookUrl('');
    setWebhookApiKey('');
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectorName.trim()) {
      toast({ title: 'Validation', description: 'Connector name is required', variant: 'destructive' });
      return;
    }

    if (providerKey === 'smtp') {
      if (!smtpHost || !smtpFromAddress || !smtpUser || !smtpPass) {
        toast({ title: 'Validation', description: 'Please fill in all SMTP required fields', variant: 'destructive' });
        return;
      }
      createMutation.mutate({
        providerKey: 'smtp',
        name: connectorName.trim(),
        config: {
          host: smtpHost.trim(),
          port: Number(smtpPort),
          secure: Boolean(smtpSecure),
          fromAddress: smtpFromAddress.trim(),
          fromName: smtpFromName.trim() || undefined,
        },
        credentials: {
          user: smtpUser.trim(),
          pass: smtpPass,
        },
      });
    } else {
      if (!webhookUrl) {
        toast({ title: 'Validation', description: 'Webhook URL is required', variant: 'destructive' });
        return;
      }
      createMutation.mutate({
        providerKey: 'webhook_out',
        name: connectorName.trim(),
        config: {
          baseUrl: webhookUrl.trim(),
        },
        credentials: {
          apiKey: webhookApiKey || undefined,
        },
      });
    }
  };

  return (
    <div className="flex-1 p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Plug className="h-6 w-6 text-blue-600" />
            Connected Apps & Connectors
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Dynamic integration connectors with AES-256 vault encryption, rate limiting, and automated health checks
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4" />
          Add Connected App
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold text-slate-500">
              Total Connectors
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{connectors.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Configured provider instances</CardContent>
        </Card>

        <Card className="border border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold text-slate-500">
              Healthy & Active
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-600">
              {connectors.filter((c) => c.isActive && c.config?._health?.ok).length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Passing connection health probes</CardContent>
        </Card>

        <Card className="border border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold text-slate-500">
              Security Vault
            </CardDescription>
            <CardTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Key className="h-4 w-4 text-amber-500" /> AES-256-GCM Vault
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Credentials encrypted at rest</CardContent>
        </Card>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Active Connectors</h2>
          <span className="text-xs text-slate-400">Decoupled provider architecture</span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-slate-400">Loading connectors...</div>
        ) : connectors.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
              <Plug className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-800">No connected apps yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Connect an SMTP server or external provider to enable automated email templates and workflows.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add your first connector
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {connectors.map((connector) => {
              const isSmtp = connector.providerKey === 'smtp';
              const health = connector.config?._health;
              const isHealthy = health ? health.ok : true;

              return (
                <div key={connector.id} className="p-6 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                  <div className="space-y-2 min-w-0 flex-1 pr-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                        {isSmtp ? <Mail className="h-4 w-4 text-blue-600" /> : <Globe className="h-4 w-4 text-amber-600" />}
                      </div>
                      <span className="font-semibold text-slate-900 text-base">{connector.name}</span>
                      <Badge variant="outline" className="font-mono text-xs uppercase bg-slate-50">
                        {connector.providerKey}
                      </Badge>
                      <Badge
                        className={cn(
                          'text-xs font-semibold',
                          connector.isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600',
                        )}
                      >
                        {connector.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                      <Badge
                        className={cn(
                          'text-xs flex items-center gap-1',
                          isHealthy
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800',
                        )}
                      >
                        {isHealthy ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <AlertCircle className="h-3 w-3 text-red-600" />
                        )}
                        {isHealthy ? 'Healthy' : 'Failing Probes'}
                      </Badge>
                    </div>

                    <div className="text-xs text-slate-500 flex items-center gap-4">
                      {isSmtp && (
                        <span>
                          Host: <span className="font-mono text-slate-700">{connector.config.host}:{connector.config.port}</span> · From: <span className="font-mono text-slate-700">{connector.config.fromAddress}</span>
                        </span>
                      )}
                      {!isSmtp && (
                        <span>
                          URL: <span className="font-mono text-slate-700">{connector.config.baseUrl}</span>
                        </span>
                      )}
                      {health?.detail && (
                        <span className="text-slate-400">· Probe: {health.detail}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => healthCheckMutation.mutate(connector.id)}
                      disabled={healthCheckMutation.isPending}
                      className="text-xs flex items-center gap-1.5"
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5 text-slate-500', healthCheckMutation.isPending && 'animate-spin')} />
                      Probe Health
                    </Button>

                    {isSmtp && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedConnector(connector);
                          setTestToEmail(connector.config.fromAddress || '');
                          setTestMailOpen(true);
                        }}
                        className="text-xs flex items-center gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50"
                      >
                        <Send className="h-3.5 w-3.5 text-blue-600" />
                        Test Mail
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleMutation.mutate({ id: connector.id, isActive: !connector.isActive })}
                    >
                      {connector.isActive ? (
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
                          title: 'Delete Connector',
                          description: `Are you sure you want to delete connector "${connector.name}"?`,
                          confirmText: 'Delete',
                          variant: 'destructive',
                        });
                        if (ok) {
                          deleteMutation.mutate(connector.id);
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <form onSubmit={handleCreateSubmit} className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Server className="h-5 w-5 text-blue-600" />
                Add Connected App Connector
              </DialogTitle>
              <DialogDescription>
                Credentials are encrypted with AES-256-GCM in the vault and decrypted strictly at runtime.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Provider</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={providerKey}
                    onChange={(e) => setProviderKey(e.target.value)}
                  >
                    {providers.length > 0 ? (
                      providers.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="smtp">SMTP Email</option>
                        <option value="webhook_out">Generic Outbound Webhook</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Connector Instance Name</label>
                  <Input
                    required
                    placeholder="e.g. Kolkata Office SMTP"
                    value={connectorName}
                    onChange={(e) => setConnectorName(e.target.value)}
                  />
                </div>
              </div>

              {providerKey === 'smtp' && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">SMTP Server Settings</h4>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1">
                      <label className="text-xs font-medium text-slate-700">Host</label>
                      <Input
                        required
                        placeholder="smtp.example.com"
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Port</label>
                      <Input
                        type="number"
                        required
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(parseInt(e.target.value, 10) || 587)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">From Email Address</label>
                      <Input
                        required
                        type="email"
                        placeholder="sales@company.com"
                        value={smtpFromAddress}
                        onChange={(e) => setSmtpFromAddress(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">From Name</label>
                      <Input
                        placeholder="Sales Team"
                        value={smtpFromName}
                        onChange={(e) => setSmtpFromName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Username / Account</label>
                      <Input
                        required
                        placeholder="smtp_user"
                        value={smtpUser}
                        onChange={(e) => setSmtpUser(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Password / Secret</label>
                      <Input
                        required
                        type="password"
                        placeholder="••••••••••••"
                        value={smtpPass}
                        onChange={(e) => setSmtpPass(e.target.value)}
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 pt-1">
                    <input
                      type="checkbox"
                      checked={smtpSecure}
                      onChange={(e) => setSmtpSecure(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Use SSL / TLS direct connection (Port 465)
                  </label>
                </div>
              )}

              {providerKey === 'webhook_out' && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-700">Base URL</label>
                    <Input
                      required
                      placeholder="https://api.external.com/v1"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-700">API Key / Secret Token</label>
                    <Input
                      type="password"
                      placeholder="sk_live_..."
                      value={webhookApiKey}
                      onChange={(e) => setWebhookApiKey(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                {createMutation.isPending ? 'Verifying...' : 'Save & Encrypt'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={testMailOpen} onOpenChange={setTestMailOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedConnector || !testToEmail) return;
              sendTestMailMutation.mutate({
                id: selectedConnector.id,
                toEmail: testToEmail.trim(),
                subject: testSubject.trim(),
                text: testBody.trim(),
              });
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="h-5 w-5 text-blue-600" />
                Send Test Email
              </DialogTitle>
              <DialogDescription>
                Sends an actual test email via connector "{selectedConnector?.name}" to verify delivery.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Recipient Email</label>
                <Input
                  required
                  type="email"
                  placeholder="recipient@example.com"
                  value={testToEmail}
                  onChange={(e) => setTestToEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Subject</label>
                <Input
                  required
                  value={testSubject}
                  onChange={(e) => setTestSubject(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Message Body</label>
                <textarea
                  rows={3}
                  required
                  className="w-full p-2.5 rounded-md border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={testBody}
                  onChange={(e) => setTestBody(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTestMailOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={sendTestMailMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {sendTestMailMutation.isPending ? 'Sending...' : 'Send Test Mail'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
