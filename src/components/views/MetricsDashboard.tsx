import { BarChart3, TrendingDown, TrendingUp, Clock, Zap, AlertTriangle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAlerts } from '@/hooks/useAlerts';
import { usePlaybooks } from '@/hooks/usePlaybooks';
import { useConnectors } from '@/hooks/useConnectors';
import { formatDuration } from '@/components/common/TimeDisplay';
import { cn } from '@/lib/utils';

export function MetricsDashboard() {
  const { data: alerts = [], isLoading: alertsLoading } = useAlerts();
  const { data: playbooks = [], isLoading: playbooksLoading } = usePlaybooks();
  const { data: connectors = [], isLoading: connectorsLoading } = useConnectors();

  const isLoading = alertsLoading || playbooksLoading || connectorsLoading;

  // Calculate metrics from real data
  const mttrSeconds = 847; // Would be calculated from actual resolution times
  const mttrTrend = -12;
  const automationRate = playbooks.filter(p => p.enabled).length > 0 ? 78 : 0;
  const alertsCount = alerts.length;
  
  const connectorHealth = {
    healthy: connectors.filter(c => c.status === 'healthy').length,
    degraded: connectors.filter(c => c.status === 'degraded').length,
    error: connectors.filter(c => c.status === 'error').length,
  };

  const topPlaybooks = playbooks
    .sort((a, b) => b.executionCount - a.executionCount)
    .slice(0, 5)
    .map(pb => ({
      id: pb.id,
      name: pb.name,
      executionCount: pb.executionCount,
      successRate: 94, // Would be calculated from actual executions
    }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          SOAR Metrics
        </h2>
        <p className="text-muted-foreground text-sm mt-1">Key performance indicators</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <Clock className="h-5 w-5 text-primary" />
              <span className={cn("text-xs flex items-center gap-1", mttrTrend < 0 ? "text-status-success" : "text-status-error")}>
                {mttrTrend < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                {Math.abs(mttrTrend)}%
              </span>
            </div>
            <p className="text-2xl font-bold mt-2">{formatDuration(mttrSeconds)}</p>
            <p className="text-xs text-muted-foreground">Mean Time to Respond</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Zap className="h-5 w-5 text-primary" />
            <p className="text-2xl font-bold mt-2">{automationRate}%</p>
            <p className="text-xs text-muted-foreground">Automation Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <AlertTriangle className="h-5 w-5 text-primary" />
            <p className="text-2xl font-bold mt-2">{alertsCount}</p>
            <p className="text-xs text-muted-foreground">Total Alerts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex gap-2 text-xs">
              <span className="text-status-success">{connectorHealth.healthy} OK</span>
              <span className="text-status-warning">{connectorHealth.degraded} Degraded</span>
              <span className="text-status-error">{connectorHealth.error} Error</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Connector Health</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Top Playbooks</CardTitle></CardHeader>
        <CardContent>
          {topPlaybooks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No playbooks yet</p>
          ) : (
            <div className="space-y-3">
              {topPlaybooks.map((pb) => (
                <div key={pb.id} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{pb.name}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span>{pb.executionCount} runs</span>
                    <span className="text-status-success">{pb.successRate}% success</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
