import { useState } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  Play,
  Eye,
  Filter,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { TimeAgo } from '@/components/common/TimeDisplay';
import { useAlerts, useUpdateAlertStatus, type Alert } from '@/hooks/useAlerts';
import type { Severity } from '@/types/soar';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/hooks/useUserRole';
import { canEditFeature } from '@/lib/permissions';
import { useToast } from '@/hooks/use-toast';

export function AlertsDashboard() {
  const { data: alerts = [], isLoading, refetch } = useAlerts();
  const updateStatus = useUpdateAlertStatus();
  const { role } = useUserRole();
  const { toast } = useToast();
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const canEdit = canEditFeature('alerts', role);

  const filteredAlerts = alerts.filter((alert) => {
    if (severityFilter !== 'all' && alert.severity !== severityFilter) return false;
    if (statusFilter !== 'all' && alert.status !== statusFilter) return false;
    return true;
  });

  const alertCounts = {
    critical: alerts.filter((a) => a.severity === 'critical').length,
    high: alerts.filter((a) => a.severity === 'high').length,
    medium: alerts.filter((a) => a.severity === 'medium').length,
    low: alerts.filter((a) => a.severity === 'low').length,
  };

  const handleStatusChange = async (alertId: string, status: Alert['status']) => {
    try {
      await updateStatus.mutateAsync({ id: alertId, status });
      toast({ title: 'Alert status updated' });
    } catch (error) {
      toast({ title: 'Failed to update status', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-primary" />
            Live Alerts
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time alerts from detection engine
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-status-success">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-success opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-status-success" />
            </span>
            Live
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Severity Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {(['critical', 'high', 'medium', 'low'] as Severity[]).map((severity) => (
          <Card
            key={severity}
            className={cn(
              'cursor-pointer transition-all hover:scale-[1.02]',
              severityFilter === severity && 'ring-2 ring-primary'
            )}
            onClick={() =>
              setSeverityFilter(severityFilter === severity ? 'all' : severity)
            }
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <SeverityBadge severity={severity} />
                <span className="text-2xl font-bold">{alertCounts[severity]}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Filters</span>
              </div>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="w-32 h-8">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severity</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32 h-8">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Rule ID or MITRE..." className="w-48 h-8" />
            </div>
            <span className="text-sm text-muted-foreground">
              {filteredAlerts.length} alert{filteredAlerts.length !== 1 && 's'}
            </span>
          </div>
        </CardHeader>
      </Card>

      {/* Alerts Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-32">Severity</TableHead>
                <TableHead className="w-24">Rule ID</TableHead>
                <TableHead>Alert</TableHead>
                <TableHead className="w-32">Agent</TableHead>
                <TableHead className="w-32">MITRE</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-32">Time</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAlerts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No alerts found
                  </TableCell>
                </TableRow>
              ) : (
                filteredAlerts.map((alert) => (
                  <TableRow key={alert.id} className="table-row-interactive">
                    <TableCell>
                      <SeverityBadge severity={alert.severity} />
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {alert.ruleId}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{alert.ruleName}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-md">
                          {alert.description}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{alert.agentName}</span>
                    </TableCell>
                    <TableCell>
                      {alert.mitreTechnique && (
                        <Badge variant="outline" className="text-xs">
                          {alert.mitreTechnique}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Select
                          value={alert.status}
                          onValueChange={(value) => handleStatusChange(alert.id, value as Alert['status'])}
                        >
                          <SelectTrigger className="h-7 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">New</SelectItem>
                            <SelectItem value="acknowledged">Acknowledged</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="resolved">Resolved</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge
                          variant="outline"
                          className={cn('text-xs capitalize', {
                            'border-status-pending text-status-pending': alert.status === 'new',
                            'border-status-warning text-status-warning': alert.status === 'acknowledged',
                            'border-status-running text-status-running': alert.status === 'in_progress',
                            'border-status-success text-status-success': alert.status === 'resolved',
                          })}
                        >
                          {alert.status.replace('_', ' ')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <TimeAgo date={alert.timestamp} className="text-xs" />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Sheet>
                          <SheetTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setSelectedAlert(alert)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </SheetTrigger>
                          <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
                            <SheetHeader>
                              <SheetTitle className="flex items-center gap-2">
                                <SeverityBadge severity={alert.severity} />
                                <span className="font-mono text-sm">{alert.alertId}</span>
                              </SheetTitle>
                            </SheetHeader>
                            <AlertDetail alert={alert} />
                          </SheetContent>
                        </Sheet>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AlertDetail({ alert }: { alert: Alert }) {
  return (
    <div className="mt-6 space-y-6">
      <div>
        <h3 className="font-semibold text-lg">{alert.ruleName}</h3>
        <p className="text-muted-foreground text-sm mt-1">{alert.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">Rule ID</label>
          <p className="font-mono text-sm">{alert.ruleId}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">Agent</label>
          <p className="text-sm">{alert.agentName}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">Source IP</label>
          <p className="font-mono text-sm">{alert.sourceIp || 'N/A'}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">Destination IP</label>
          <p className="font-mono text-sm">{alert.destinationIp || 'N/A'}</p>
        </div>
        {alert.mitreTechnique && (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">MITRE Technique</label>
              <a
                href={`https://attack.mitre.org/techniques/${alert.mitreTechnique}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary flex items-center gap-1 hover:underline"
              >
                {alert.mitreTechnique}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">MITRE Tactic</label>
              <p className="text-sm">{alert.mitreTactic}</p>
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <Button className="flex-1">
          <Play className="h-4 w-4 mr-2" />
          Run Playbook
        </Button>
        <Button variant="outline" className="flex-1">
          Simulate
        </Button>
      </div>

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-2">
          Raw Alert Data
        </label>
        <pre className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto scrollbar-thin">
          {JSON.stringify(alert.rawData, null, 2)}
        </pre>
      </div>
    </div>
  );
}
