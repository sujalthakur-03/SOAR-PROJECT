import { BarChart3, TrendingDown, TrendingUp, Clock, Zap, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { mockMetrics } from '@/data/mockData';
import { formatDuration } from '@/components/common/TimeDisplay';
import { cn } from '@/lib/utils';

export function MetricsDashboard() {
  const m = mockMetrics;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          SOAR Metrics
        </h2>
        <p className="text-muted-foreground text-sm mt-1">Key performance indicators for SOC leadership</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <Clock className="h-5 w-5 text-primary" />
              <span className={cn("text-xs flex items-center gap-1", m.mttr_trend < 0 ? "text-status-success" : "text-status-error")}>
                {m.mttr_trend < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                {Math.abs(m.mttr_trend)}%
              </span>
            </div>
            <p className="text-2xl font-bold mt-2">{formatDuration(m.mttr_seconds)}</p>
            <p className="text-xs text-muted-foreground">Mean Time to Respond</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Zap className="h-5 w-5 text-primary" />
            <p className="text-2xl font-bold mt-2">{m.automation_rate}%</p>
            <p className="text-xs text-muted-foreground">Automation Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <AlertTriangle className="h-5 w-5 text-primary" />
            <p className="text-2xl font-bold mt-2">{m.alerts_processed_24h}</p>
            <p className="text-xs text-muted-foreground">Alerts (24h)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex gap-2">
              <span className="text-status-success">{m.connector_health.healthy} OK</span>
              <span className="text-status-warning">{m.connector_health.degraded} Degraded</span>
              <span className="text-status-error">{m.connector_health.error} Error</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Connector Health</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Top Playbooks</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {m.top_playbooks.map((pb) => (
              <div key={pb.id} className="flex items-center justify-between">
                <span className="text-sm font-medium">{pb.name}</span>
                <div className="flex items-center gap-4 text-sm">
                  <span>{pb.execution_count} runs</span>
                  <span className="text-status-success">{pb.success_rate}% success</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
