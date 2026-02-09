import { Settings, Server, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getBackendBaseUrl } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';

const fetchHealth = async () => {
  const res = await fetch(`${getBackendBaseUrl()}/health`);
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
};

const fetchStatus = async () => {
  const res = await fetch(`${getBackendBaseUrl()}/status`);
  if (!res.ok) throw new Error('Status check failed');
  return res.json();
};

function SystemTab() {
  const { data: health } = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchHealth,
    refetchInterval: 30000,
  });

  const { data: status } = useQuery({
    queryKey: ['system-status'],
    queryFn: fetchStatus,
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Server className="h-5 w-5 text-primary" />
          System Information
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Backend status and system configuration
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Backend Status</CardTitle>
            <CardDescription>Health and connectivity</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={health?.status === 'healthy' ? 'success' : 'destructive'}>
                {health?.status || 'checking...'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Database</span>
              <Badge variant={status?.database?.connected ? 'success' : 'destructive'}>
                {status?.database?.connected ? 'connected' : health?.database || 'unknown'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Version</span>
              <span className="text-sm font-mono">{health?.version || 'n/a'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Uptime</span>
              <span className="text-sm font-mono">
                {status?.uptime != null
                  ? status.uptime >= 3600
                    ? `${Math.floor(status.uptime / 3600)}h ${Math.floor((status.uptime % 3600) / 60)}m`
                    : `${Math.floor(status.uptime / 60)}m`
                  : 'n/a'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Services</CardTitle>
            <CardDescription>Active platform features</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {status?.features ? (
              Object.entries(status.features).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                  </span>
                  <Badge variant={(value as string).includes('active') ? 'success' : 'outline'}>
                    {value as string}
                  </Badge>
                </div>
              ))
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Webhook Ingestion</span>
                  <Badge variant="success">Active</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Playbook Execution</span>
                  <Badge variant="success">Active</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Case Management</span>
                  <Badge variant="success">Active</Badge>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4" />
              Architecture
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <p className="font-medium">Data Model</p>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Execution-centric (Execution = Alert + Response)</li>
                  <li>Alerts exist only as trigger_data in executions</li>
                  <li>Playbook-specific webhooks for ingestion</li>
                </ul>
              </div>
              <div className="space-y-2">
                <p className="font-medium">Storage</p>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                  <li>MongoDB for all persistent data</li>
                  <li>No OpenSearch dependency</li>
                  <li>Trigger-owns-routing architecture (Option A)</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Settings className="h-6 w-6 text-primary" />
          Settings
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          System configuration and platform status
        </p>
      </div>

      <SystemTab />
    </div>
  );
}
