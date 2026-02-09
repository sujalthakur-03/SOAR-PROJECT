import { BarChart3, Clock, Zap, Activity, CheckCircle2, Loader2, AlertCircle, FolderOpen, AlertTriangle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSOCKPIs, useMTTR, useSLAStatus } from '@/hooks/useSOCMetrics';
import { usePlaybooks } from '@/hooks/usePlaybooks';
import { useConnectors } from '@/hooks/useConnectors';
import { useCaseStats } from '@/hooks/useCases';
import { formatDuration } from '@/components/common/TimeDisplay';
import { cn } from '@/lib/utils';

/** Format milliseconds to a human-readable duration string */
function formatMs(ms: number): string {
  if (!ms || ms <= 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return formatDuration(Math.round(ms / 1000));
}

/** Safely parse a numeric value that may come as a string from the backend */
function num(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val) || 0;
  return 0;
}

export function MetricsDashboard() {
  const { data: kpisData, isLoading: kpisLoading, error: kpisError } = useSOCKPIs();
  const { data: mttrData, isLoading: mttrLoading, error: mttrError } = useMTTR();
  const { data: slaData, isLoading: slaLoading, error: slaError } = useSLAStatus();
  const { data: playbooksData, isLoading: playbooksLoading } = usePlaybooks();
  const { data: connectorsData, isLoading: connectorsLoading } = useConnectors();
  const { data: caseStats, isLoading: caseStatsLoading } = useCaseStats();

  const playbooks = Array.isArray(playbooksData) ? playbooksData : [];
  const connectors = Array.isArray(connectorsData) ? connectorsData : [];
  const isLoading = kpisLoading || mttrLoading || slaLoading || playbooksLoading || connectorsLoading || caseStatsLoading;

  // ── Extract KPIs from actual backend shape ──────────────────────────────
  // Backend /api/soc/kpis returns: { throughput, backlog, success_rate, automation_coverage, mttr, mtta, sla_compliance }
  const kpi = kpisData as any;
  const totalExecutions = kpi?.throughput?.total_executions ?? kpi?.total_executions ?? 0;
  const activeExecutions = kpi?.backlog?.executing_count ?? kpi?.active_executions ?? 0;
  const pendingApprovals = kpi?.backlog?.waiting_approval_count ?? kpi?.pending_approvals ?? 0;
  const failedExecutions = kpi?.success_rate?.failed_count ?? kpi?.failed_executions ?? 0;
  const automationRate = num(kpi?.automation_coverage?.automation_coverage ?? kpi?.automation_rate ?? 0);
  const avgExecutionTimeMs = kpi?.mttr?.avg_mttr_ms ?? 0;
  const successRate = num(kpi?.success_rate?.success_rate ?? 0);
  const completedCount = kpi?.success_rate?.completed_count ?? 0;

  // ── MTTR from actual backend shape ──────────────────────────────────────
  // Backend /api/soc/metrics/mttr returns: { avg_mttr_ms, min_mttr_ms, max_mttr_ms, p50_mttr_ms, sample_count }
  const mttr = mttrData as any;
  const mttrMs = mttr?.avg_mttr_ms ?? (mttr?.mttr_seconds ? mttr.mttr_seconds * 1000 : 0);
  const mttrFormatted = mttr?.mttr_formatted || formatMs(mttrMs);
  const mttrSampleSize = mttr?.sample_count ?? mttr?.sample_size ?? 0;

  // ── SLA from actual backend shape ───────────────────────────────────────
  // Backend /api/soc/sla/status returns: { overall: { compliance_rate, total_executions, ... }, top_violators: [...] }
  const sla = slaData as any;
  const slaOverall = sla?.overall || sla;
  const slaComplianceRate = num(slaOverall?.compliance_rate ?? 0);
  const totalSLAExecutions = slaOverall?.total_executions ?? 0;
  const slaTotalBreached = (slaOverall?.acknowledge_breached ?? 0) +
    (slaOverall?.containment_breached ?? 0) +
    (slaOverall?.resolution_breached ?? 0);
  const slaWithin = Math.max(0, totalSLAExecutions - slaTotalBreached);

  // SLA compliance by dimension (from KPIs sla_compliance)
  const slaCompliance = kpi?.sla_compliance;
  const slaDimensions = slaCompliance ? [
    { name: 'Acknowledge', data: slaCompliance.acknowledge_sla },
    { name: 'Containment', data: slaCompliance.containment_sla },
    { name: 'Resolution', data: slaCompliance.resolution_sla },
  ].filter(d => d.data && d.data.total > 0) : [];

  // Top violators from SLA status
  const topViolators = (sla?.top_violators || []).filter((v: any) => v.breached > 0);

  // Connector health
  const connectorHealth = {
    healthy: connectors.filter(c => c.status === 'healthy').length,
    degraded: connectors.filter(c => c.status === 'degraded').length,
    error: connectors.filter(c => c.status === 'error').length,
  };

  // Top playbooks by execution count
  const topPlaybooks = playbooks
    .filter(p => p.execution_count && p.execution_count > 0)
    .sort((a, b) => (b.execution_count || 0) - (a.execution_count || 0))
    .slice(0, 5)
    .map(pb => ({
      id: pb.id,
      name: pb.name,
      executionCount: pb.execution_count || 0,
      successRate: pb.success_rate || 0,
    }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasErrors = kpisError || mttrError || slaError;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          SOAR Metrics
        </h2>
        <p className="text-muted-foreground text-sm mt-1">Key performance indicators derived from execution data</p>
      </div>

      {hasErrors && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>Some metrics endpoints returned errors. Displaying available data.</span>
          </CardContent>
        </Card>
      )}

      {/* Row 1: Top-level KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <Clock className="h-5 w-5 text-primary" />
            <p className="text-2xl font-bold mt-2">{mttrFormatted}</p>
            <p className="text-xs text-muted-foreground">Mean Time to Respond</p>
            <p className="text-xs text-muted-foreground mt-1">Sample: {mttrSampleSize} executions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Zap className="h-5 w-5 text-primary" />
            <p className="text-2xl font-bold mt-2">{automationRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">Automation Rate</p>
            <p className="text-xs text-muted-foreground mt-1">Avg exec: {formatMs(avgExecutionTimeMs)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Activity className="h-5 w-5 text-primary" />
            <p className="text-2xl font-bold mt-2">{totalExecutions}</p>
            <p className="text-xs text-muted-foreground">Total Executions</p>
            <div className="flex gap-2 text-xs mt-1">
              <span className="text-status-success">{completedCount} completed</span>
              <span className="text-status-warning">{pendingApprovals} pending</span>
              <span className="text-status-error">{failedExecutions} failed</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <p className="text-2xl font-bold mt-2">{slaComplianceRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">SLA Compliance</p>
            <div className="flex gap-2 text-xs mt-1">
              <span className="text-status-success">{slaWithin} within</span>
              <span className="text-status-error">{slaTotalBreached} breached</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <FolderOpen className="h-5 w-5 text-primary" />
            <p className="text-2xl font-bold mt-2">{caseStats?.total_cases || 0}</p>
            <p className="text-xs text-muted-foreground">Total Cases</p>
            <div className="flex gap-2 text-xs mt-1">
              <span className="text-status-error">{caseStats?.open || 0} open</span>
              <span className="text-status-warning">{caseStats?.investigating || 0} active</span>
              <span className="text-status-success">{caseStats?.resolved || 0} resolved</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Success rate + SLA Compliance breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Success Rate &amp; SLA by Dimension</CardTitle></CardHeader>
          <CardContent>
            {/* Success rate */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-status-success" />
                <span className="text-sm font-medium">Overall Success Rate</span>
              </div>
              <span className={cn(
                "text-sm font-bold",
                successRate >= 90 ? "text-status-success" :
                successRate >= 70 ? "text-status-warning" :
                "text-status-error"
              )}>
                {successRate.toFixed(1)}%
              </span>
            </div>

            {/* SLA by dimension */}
            {slaDimensions.length === 0 ? (
              <p className="text-muted-foreground text-sm">No SLA data available</p>
            ) : (
              <div className="space-y-3">
                {slaDimensions.map((dim) => {
                  const rate = num(dim.data.compliance_rate);
                  return (
                    <div key={dim.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {rate >= 95 ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />
                        ) : rate >= 80 ? (
                          <AlertCircle className="h-3.5 w-3.5 text-status-warning" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-status-error" />
                        )}
                        <span className="text-sm font-medium">{dim.name}</span>
                        <span className="text-xs text-muted-foreground">({dim.data.total} checked)</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className={cn(
                          "font-medium",
                          rate >= 95 ? "text-status-success" :
                          rate >= 80 ? "text-status-warning" :
                          "text-status-error"
                        )}>
                          {rate.toFixed(1)}%
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {dim.data.compliant}/{dim.data.total}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Top violators */}
            {topViolators.length > 0 && (
              <div className="mt-4 pt-3 border-t">
                <p className="text-xs font-medium text-destructive mb-2">SLA Violators</p>
                {topViolators.map((v: any) => (
                  <div key={v.playbook_id} className="flex items-center justify-between text-xs py-1">
                    <span className="text-muted-foreground">{v.playbook_name}</span>
                    <span className="text-destructive font-medium">{v.breached} breached</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Connector Health</span>
              <AlertCircle className="h-5 w-5 text-primary" />
            </div>
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-status-success"></span>
                <span className="text-muted-foreground">{connectorHealth.healthy} Healthy</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-status-warning"></span>
                <span className="text-muted-foreground">{connectorHealth.degraded} Degraded</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-status-error"></span>
                <span className="text-muted-foreground">{connectorHealth.error} Error</span>
              </div>
            </div>

            {/* Backlog info */}
            {kpi?.backlog && (
              <div className="mt-4 pt-3 border-t">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Execution Backlog</span>
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="text-center">
                    <p className="text-lg font-bold">{kpi.backlog.total_backlog || 0}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-status-pending">{activeExecutions}</p>
                    <p className="text-xs text-muted-foreground">Executing</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-status-warning">{pendingApprovals}</p>
                    <p className="text-xs text-muted-foreground">Awaiting</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-status-error">{kpi.backlog.sla_breached_count || 0}</p>
                    <p className="text-xs text-muted-foreground">SLA Risk</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Top playbooks */}
      <Card>
        <CardHeader><CardTitle className="text-base">Top Playbooks (by executions)</CardTitle></CardHeader>
        <CardContent>
          {topPlaybooks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No playbook executions yet</p>
          ) : (
            <div className="space-y-3">
              {topPlaybooks.map((pb) => (
                <div key={pb.id} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{pb.name}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{pb.executionCount} executions</span>
                    <span className={cn(
                      "font-medium",
                      pb.successRate >= 95 ? "text-status-success" :
                      pb.successRate >= 80 ? "text-status-warning" :
                      "text-status-error"
                    )}>
                      {pb.successRate.toFixed(1)}% success
                    </span>
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
