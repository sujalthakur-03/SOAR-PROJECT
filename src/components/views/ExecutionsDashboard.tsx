/**
 * ExecutionsDashboard - Execution-Centric SOC View
 *
 * PRIMARY ARCHITECTURAL CONSTRAINT: Execution = Alert + Response
 * This component displays EXECUTIONS, not raw alerts.
 * Alert data is accessed ONLY through trigger_data within executions.
 */

import { useState, useEffect, useRef } from 'react';
import {
  Play,
  RefreshCw,
  Eye,
  Filter,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  PauseCircle,
  ActivityIcon,
  Search,
  GitBranch,
  Zap,
  Bell,
  ChevronDown,
  ChevronRight,
  Box,
  FileText,
  Shield,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Server,
  Globe,
  Mail,
  Hash,
  RotateCcw,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { TimeAgo } from '@/components/common/TimeDisplay';
import { useExecutions, useExecution, useReExecute, type ExecutionFilters } from '@/hooks/useExecutions';
import { usePlaybooks } from '@/hooks/usePlaybooks';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type ExecutionState = 'EXECUTING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED';

const StateIcons: Record<ExecutionState, any> = {
  EXECUTING: Play,
  WAITING_APPROVAL: PauseCircle,
  COMPLETED: CheckCircle2,
  FAILED: XCircle,
};

const StateColors: Record<ExecutionState, string> = {
  EXECUTING: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  WAITING_APPROVAL: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  COMPLETED: 'bg-green-500/10 text-green-500 border-green-500/20',
  FAILED: 'bg-red-500/10 text-red-500 border-red-500/20',
};

const StepTypeIcons: Record<string, any> = {
  enrichment: Search,
  condition: GitBranch,
  action: Zap,
  notification: Bell,
};

const StepTypeColors: Record<string, string> = {
  enrichment: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  condition: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  action: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  notification: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
};

export function ExecutionsDashboard() {
  const { toast } = useToast();
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);
  const [isLivePolling, setIsLivePolling] = useState<boolean>(true);
  const previousExecutionIdsRef = useRef<Set<string>>(new Set());
  const [reExecTarget, setReExecTarget] = useState<any>(null);
  const reExecuteMutation = useReExecute();

  // Active playbooks — shows which playbooks are armed and listening for alerts
  const { data: playbooks } = usePlaybooks();

  // Build execution filters based on UI selections
  const filters: ExecutionFilters = {
    ...(stateFilter !== 'all' && { state: stateFilter as ExecutionFilters['state'] }),
    ...(severityFilter !== 'all' && { severity: severityFilter }),
    limit: 50,
    sort_by: 'event_time',
    sort_order: 'desc',
  };

  const { data, isLoading, refetch, dataUpdatedAt } = useExecutions(filters, isLivePolling);
  const executions = data?.executions || [];
  const total = data?.total || 0;

  // Detect new executions and notify
  useEffect(() => {
    if (executions.length > 0 && previousExecutionIdsRef.current.size > 0) {
      const currentIds = new Set(executions.map((e: any) => e.execution_id));
      const newExecutions = executions.filter(
        (e: any) => !previousExecutionIdsRef.current.has(e.execution_id)
      );

      if (newExecutions.length > 0 && isLivePolling) {
        const firstNew = newExecutions[0];
        toast({
          title: 'New Execution',
          description: `${firstNew.playbook_name} - ${firstNew.execution_id.slice(0, 8)}...`,
          duration: 3000,
        });
      }

      previousExecutionIdsRef.current = currentIds;
    } else if (executions.length > 0) {
      previousExecutionIdsRef.current = new Set(executions.map((e: any) => e.execution_id));
    }
  }, [executions, isLivePolling, toast]);

  // Calculate state counts for summary cards
  const stateCounts = {
    EXECUTING: executions.filter((e: any) => e.state === 'EXECUTING').length,
    WAITING_APPROVAL: executions.filter((e: any) => e.state === 'WAITING_APPROVAL').length,
    COMPLETED: executions.filter((e: any) => e.state === 'COMPLETED').length,
    FAILED: executions.filter((e: any) => e.state === 'FAILED').length,
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
            <ActivityIcon className="h-6 w-6 text-primary" />
            Live Executions
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time executions from CyberSentinel ({total} total)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={isLivePolling ? "secondary" : "outline"}
            size="sm"
            onClick={() => setIsLivePolling(!isLivePolling)}
          >
            <div className={cn(
              "flex items-center gap-1.5",
              isLivePolling && "text-status-success"
            )}>
              {isLivePolling && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-status-success" />
                </span>
              )}
              {isLivePolling ? 'Live' : 'Paused'}
            </div>
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* State Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {(['EXECUTING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED'] as ExecutionState[]).map((state) => {
          const Icon = StateIcons[state];
          const count = stateCounts[state];

          return (
            <Card
              key={state}
              className={cn(
                'cursor-pointer transition-all hover:scale-[1.02]',
                stateFilter === state && 'ring-2 ring-primary'
              )}
              onClick={() => setStateFilter(stateFilter === state ? 'all' : state)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      {state.replace('_', ' ')}
                    </p>
                    <p className="text-2xl font-bold mt-1">{count}</p>
                  </div>
                  <div className={cn('p-2 rounded-lg', StateColors[state])}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Active Playbooks — Live Execution Readiness */}
      {(() => {
        const allPlaybooks = Array.isArray(playbooks) ? playbooks : [];
        const enabledPlaybooks = allPlaybooks.filter(p => p.enabled);

        if (enabledPlaybooks.length === 0 && allPlaybooks.length === 0) return null;

        return (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Play className="h-4 w-4 text-green-500" />
                  Active Playbooks
                  <Badge variant="secondary" className="text-xs ml-1">
                    {enabledPlaybooks.length} live
                  </Badge>
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {enabledPlaybooks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No playbooks are currently enabled. Enable a playbook to start receiving live executions.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {enabledPlaybooks.map((pb) => {
                    const trigger = pb.trigger as { severity_threshold?: string; rule_ids?: string | string[] } | null;
                    const severity = trigger?.severity_threshold;
                    const stepCount = pb.steps?.length || 0;

                    return (
                      <div
                        key={pb.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-green-500/5 border-green-500/20"
                      >
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                        </span>
                        <span className="text-sm font-medium">{pb.name}</span>
                        <Badge variant="outline" className="text-xs">
                          v{pb.version}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {stepCount} step{stepCount !== 1 ? 's' : ''}
                        </Badge>
                        {severity && (
                          <Badge variant="outline" className="text-xs capitalize">
                            {severity}+
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
            {(stateFilter !== 'all' || severityFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStateFilter('all');
                  setSeverityFilter('all');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">State</label>
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All States" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  <SelectItem value="EXECUTING">Executing</SelectItem>
                  <SelectItem value="WAITING_APPROVAL">Waiting Approval</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Severity (from trigger_data)</label>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Severities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Executions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Executions {stateFilter !== 'all' && `(${stateFilter.replace('_', ' ')})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Execution ID</TableHead>
                <TableHead>Playbook</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Event Time</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No executions found matching the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                executions.map((execution: any) => {
                  const Icon = StateIcons[execution.state as ExecutionState];
                  const severity = execution.trigger_data?.severity || 'info';
                  const triggerSource = execution.trigger_source || 'webhook';
                  const duration = execution.duration_ms
                    ? `${Math.round(execution.duration_ms / 1000)}s`
                    : execution.started_at
                    ? `${Math.round((Date.now() - new Date(execution.started_at).getTime()) / 1000)}s`
                    : '-';

                  return (
                    <TableRow
                      key={execution.execution_id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors duration-200"
                      onClick={() => setSelectedExecution(execution.execution_id)}
                    >
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {execution.execution_id}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{execution.playbook_name}</span>
                          <span className="text-xs text-muted-foreground">{execution.playbook_id}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={triggerSource === 'simulation' ? 'secondary' : 'outline'}
                          className={cn(
                            'text-xs capitalize',
                            triggerSource === 'simulation' && 'bg-purple-500/10 text-purple-600 border-purple-500/20'
                          )}
                        >
                          {triggerSource}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <SeverityBadge severity={severity} />
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('gap-1.5', StateColors[execution.state as ExecutionState])}>
                          <Icon className="h-3 w-3" />
                          {execution.state.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <TimeAgo timestamp={execution.event_time} />
                          <span className="text-xs text-muted-foreground">
                            {execution.event_time_source}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          {duration}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="View details"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedExecution(execution.execution_id);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Re-execute with same alert data"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReExecTarget(execution);
                            }}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Re-Execute Confirmation Dialog */}
      <Dialog open={!!reExecTarget} onOpenChange={(open) => { if (!open) setReExecTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-execute Playbook</DialogTitle>
            <DialogDescription>
              Re-run this playbook with the same alert data? A new execution will be created.
            </DialogDescription>
          </DialogHeader>
          {reExecTarget && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Playbook:</span>
                <span className="font-medium">{reExecTarget.playbook_name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Source IP:</span>
                <span className="font-mono">
                  {reExecTarget.trigger_data?.data?.srcip || reExecTarget.trigger_data?.source_ip || 'N/A'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Original Execution:</span>
                <Badge variant="outline" className="font-mono text-xs">{reExecTarget.execution_id}</Badge>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReExecTarget(null)}>Cancel</Button>
            <Button
              disabled={reExecuteMutation.isPending}
              onClick={() => {
                if (!reExecTarget) return;
                reExecuteMutation.mutate(
                  { playbook_id: reExecTarget.playbook_id, trigger_data: reExecTarget.trigger_data },
                  {
                    onSuccess: (data) => {
                      toast({
                        title: 'Execution Created',
                        description: `New execution ${data.execution_id || data.execution?.execution_id || ''} started.`,
                      });
                      setReExecTarget(null);
                    },
                    onError: (err: any) => {
                      toast({
                        title: 'Re-execute Failed',
                        description: err.message || 'Failed to create execution',
                        variant: 'destructive',
                      });
                    },
                  }
                );
              }}
            >
              {reExecuteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Re-execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Execution Detail Dialog */}
      {selectedExecution && (
        <ExecutionDetailDialog
          execution_id={selectedExecution}
          open={!!selectedExecution}
          onClose={() => setSelectedExecution(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART STEP RENDERERS — type-aware rendering for each step's output
// ═══════════════════════════════════════════════════════════════════════════════

/** Render enrichment output (VirusTotal, AbuseIPDB, etc.) as a human-readable verdict */
function EnrichmentOutputRenderer({ output, actionType }: { output: any; actionType?: string }) {
  if (!output) return null;

  // VirusTotal-style IP/hash/domain lookup
  if (output.malicious_votes != null || output.reputation_score != null || output.is_malicious != null) {
    const total = output.total_vendors || (
      (output.malicious_votes || 0) + (output.suspicious_votes || 0) +
      (output.harmless_votes || 0) + (output.undetected_votes || 0)
    );
    const malicious = output.malicious_votes || 0;
    const suspicious = output.suspicious_votes || 0;
    const isMalicious = output.is_malicious ?? malicious > 0;
    const score = output.reputation_score;

    return (
      <div className="space-y-3">
        {/* Verdict banner */}
        <div className={cn(
          'flex items-center gap-3 p-3 rounded-lg border',
          isMalicious
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-green-500/10 border-green-500/30'
        )}>
          {isMalicious ? (
            <ShieldAlert className="h-6 w-6 text-red-500 shrink-0" />
          ) : (
            <ShieldCheck className="h-6 w-6 text-green-500 shrink-0" />
          )}
          <div>
            <p className={cn('font-semibold text-sm', isMalicious ? 'text-red-500' : 'text-green-500')}>
              {isMalicious ? 'MALICIOUS' : 'CLEAN'}
            </p>
            <p className="text-xs text-muted-foreground">
              {malicious}/{total} vendors flagged as malicious
              {suspicious > 0 && `, ${suspicious} suspicious`}
            </p>
          </div>
          {score != null && (
            <div className="ml-auto text-right">
              <p className="text-lg font-bold">{score}</p>
              <p className="text-xs text-muted-foreground">reputation</p>
            </div>
          )}
        </div>

        {/* Detail grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {output.ip && (
            <div className="flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">IP:</span>
              <span className="font-mono">{output.ip}</span>
            </div>
          )}
          {output.country && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Country:</span>
              <span>{output.country}</span>
            </div>
          )}
          {output.as_owner && (
            <div className="flex items-center gap-1.5 col-span-2">
              <span className="text-muted-foreground">AS Owner:</span>
              <span>{output.as_owner}</span>
            </div>
          )}
          {output.network && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Network:</span>
              <span className="font-mono">{output.network}</span>
            </div>
          )}
          {output.last_analysis_date && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Last Scan:</span>
              <span>{new Date(output.last_analysis_date).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Vote breakdown bar */}
        {total > 0 && (
          <div>
            <div className="flex gap-1 h-2 rounded-full overflow-hidden">
              {malicious > 0 && (
                <div className="bg-red-500" style={{ width: `${(malicious / total) * 100}%` }} />
              )}
              {suspicious > 0 && (
                <div className="bg-yellow-500" style={{ width: `${(suspicious / total) * 100}%` }} />
              )}
              {(output.harmless_votes || 0) > 0 && (
                <div className="bg-green-500" style={{ width: `${((output.harmless_votes || 0) / total) * 100}%` }} />
              )}
              {(output.undetected_votes || 0) > 0 && (
                <div className="bg-gray-400" style={{ width: `${((output.undetected_votes || 0) / total) * 100}%` }} />
              )}
            </div>
            <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Malicious ({malicious})</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Suspicious ({suspicious})</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Harmless ({output.harmless_votes || 0})</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400 inline-block" /> Undetected ({output.undetected_votes || 0})</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Generic enrichment — show key-value pairs nicely
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      {Object.entries(output).map(([key, value]) => (
        <div key={key} className="flex items-start gap-1.5">
          <span className="text-muted-foreground shrink-0">{key.replace(/_/g, ' ')}:</span>
          <span className="font-mono break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Render condition step output — which branch was taken and why */
function ConditionOutputRenderer({ output, meta }: { output: any; meta?: any }) {
  if (!output) return null;

  const branchTaken = output.branch_taken;
  const result = output.result;
  const nextStep = output.next_step;

  return (
    <div className="space-y-2">
      <div className={cn(
        'flex items-center gap-3 p-3 rounded-lg border',
        result ? 'bg-green-500/10 border-green-500/30' : 'bg-orange-500/10 border-orange-500/30'
      )}>
        <GitBranch className={cn('h-5 w-5 shrink-0', result ? 'text-green-500' : 'text-orange-500')} />
        <div className="flex-1">
          <p className="text-sm font-medium">
            Condition evaluated: <span className={result ? 'text-green-500' : 'text-orange-500'}>{result ? 'TRUE' : 'FALSE'}</span>
          </p>
          {output.evaluated_value != null && (
            <p className="text-xs text-muted-foreground">Evaluated value: {JSON.stringify(output.evaluated_value)}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <ArrowRight className="h-3 w-3" />
          <Badge variant="outline" className="font-mono">{branchTaken}</Badge>
          {nextStep && nextStep !== '__END__' && (
            <span className="text-muted-foreground">({nextStep})</span>
          )}
          {nextStep === '__END__' && (
            <span className="text-muted-foreground">(pipeline end)</span>
          )}
        </div>
      </div>
      {meta?.condition && (
        <div className="text-xs text-muted-foreground">
          Rule: <span className="font-mono">{meta.condition.field} {meta.condition.operator} {JSON.stringify(meta.condition.value)}</span>
        </div>
      )}
    </div>
  );
}

/** Render action step output — IP blocked, firewall rule created, etc. */
function ActionOutputRenderer({ output, meta }: { output: any; meta?: any }) {
  if (!output) return null;

  const success = output.success;

  // Shadow mode
  if (output.skipped && output.reason === 'shadow_mode') {
    return (
      <div className="p-3 rounded-lg border bg-yellow-500/10 border-yellow-500/30">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-yellow-500" />
          <div>
            <p className="text-sm font-medium text-yellow-500">Shadow Mode — Action Skipped</p>
            <p className="text-xs text-muted-foreground">This action would have executed but was skipped due to shadow mode.</p>
          </div>
        </div>
        {output.would_execute && (
          <pre className="text-xs bg-background border rounded p-2 mt-2 overflow-x-auto">
            {JSON.stringify(output.would_execute, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  // Normal action result
  return (
    <div className="space-y-2">
      <div className={cn(
        'flex items-center gap-3 p-3 rounded-lg border',
        success ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
      )}>
        {success ? (
          <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 text-red-500 shrink-0" />
        )}
        <div className="flex-1">
          <p className={cn('text-sm font-medium', success ? 'text-green-500' : 'text-red-500')}>
            {success ? 'Action Executed Successfully' : 'Action Failed'}
          </p>
          {meta?.action_type && (
            <p className="text-xs text-muted-foreground">Action: {meta.action_type.replace(/_/g, ' ')}</p>
          )}
        </div>
      </div>

      {/* Action-specific details */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {output.ip && (
          <div className="flex items-center gap-1.5">
            <Globe className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">IP:</span>
            <span className="font-mono">{output.ip}</span>
          </div>
        )}
        {output.ruleId && (
          <div className="flex items-center gap-1.5">
            <Hash className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Rule ID:</span>
            <span className="font-mono">{output.ruleId}</span>
          </div>
        )}
        {output.duration && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Block Duration:</span>
            <span>{output.duration}</span>
          </div>
        )}
        {output.simulated != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Simulated:</span>
            <Badge variant={output.simulated ? 'secondary' : 'outline'} className="text-[10px]">
              {output.simulated ? 'Yes (demo)' : 'No (live)'}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}

/** Render notification step output — delivery status */
function NotificationOutputRenderer({ output, meta }: { output: any; meta?: any }) {
  if (!output) return null;

  const sent = output.sent ?? output.success;
  const innerOutput = output.output || output;

  return (
    <div className={cn(
      'flex items-center gap-3 p-3 rounded-lg border',
      sent ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
    )}>
      {sent ? (
        <Mail className="h-5 w-5 text-green-500 shrink-0" />
      ) : (
        <XCircle className="h-5 w-5 text-red-500 shrink-0" />
      )}
      <div className="flex-1">
        <p className={cn('text-sm font-medium', sent ? 'text-green-500' : 'text-red-500')}>
          {sent ? 'Notification Sent' : 'Notification Failed'}
        </p>
        {innerOutput.recipients && (
          <p className="text-xs text-muted-foreground">
            To: {Array.isArray(innerOutput.recipients) ? innerOutput.recipients.join(', ') : innerOutput.recipients}
          </p>
        )}
        {innerOutput.channels && Array.isArray(innerOutput.channels) && (
          <p className="text-xs text-muted-foreground">
            Channels: {innerOutput.channels.map((c: any) => c.channel || c).join(', ')}
          </p>
        )}
        {innerOutput.subject && (
          <p className="text-xs text-muted-foreground">Subject: {innerOutput.subject}</p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION DETAIL DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ExecutionDetailDialog - Full execution pipeline view
 * Shows: Incoming alert log -> each pipeline step with smart rendering -> final result
 */
function ExecutionDetailDialog({
  execution_id,
  open,
  onClose,
}: {
  execution_id: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: execution, isLoading } = useExecution(execution_id, open);
  const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(new Set());
  const [showRawTrigger, setShowRawTrigger] = useState(false);

  // Fetch playbook DSL to enrich step display with names, types, parameters
  const { data: playbook } = useQuery({
    queryKey: ['playbook-detail', execution?.playbook_id],
    queryFn: () => apiClient.getPlaybook(execution!.playbook_id),
    enabled: !!execution?.playbook_id,
  });

  // Build step metadata map from playbook DSL
  const stepMetaMap = new Map<string, { name: string; type: string; parameters: any; connector_id?: string; action_type?: string; condition?: any }>();
  const dslSteps = playbook?.dsl?.steps || playbook?.steps || [];
  for (const s of dslSteps) {
    stepMetaMap.set(s.step_id, {
      name: s.name || s.step_id,
      type: s.type || 'action',
      parameters: s.parameters || {},
      connector_id: s.connector_id,
      action_type: s.action_type,
      condition: s.condition,
    });
  }

  const toggleStep = (stepId: string) => {
    setCollapsedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  if (isLoading || !execution) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const ExecIcon = StateIcons[execution.state as ExecutionState];
  const td = execution.trigger_data || {};

  // Extract structured fields from Wazuh/CyberSentinel trigger_data
  const ruleInfo = td.rule || {};
  const agentInfo = td.agent || {};
  const srcIp = td.data?.srcip || td.source_ip || '';
  const srcPort = td.data?.srcport || '';
  const dstUser = td.data?.dstuser || '';
  const dstIp = td.data?.dstip || td.destination_ip || '';
  const fullLog = td.full_log || '';
  const mitreInfo = ruleInfo.mitre || {};

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="font-mono">
              {execution.execution_id}
            </Badge>
            <Badge className={cn('gap-1.5', StateColors[execution.state as ExecutionState])}>
              <ExecIcon className="h-3 w-3" />
              {execution.state}
            </Badge>
            <span className="text-sm font-normal text-muted-foreground">
              {execution.playbook_name}
            </span>
            {execution.duration_ms != null && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Clock className="h-3 w-3" />
                {formatDuration(execution.duration_ms)}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">

          {/* ══════════════════════════════════════════════════════════════════
              SECTION 1: INCOMING ALERT / LOG
              Shows the raw log line and structured alert data from Wazuh
              ══════════════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-orange-500" />
                Incoming Alert Log
                <Badge variant="secondary" className="text-xs">{execution.trigger_source || 'webhook'}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Raw syslog line */}
              {fullLog && (
                <div className="p-2.5 bg-black/80 rounded-lg">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Terminal className="h-3 w-3 text-green-400" />
                    <span className="text-[10px] text-green-400 uppercase tracking-wider">Raw Log</span>
                  </div>
                  <p className="font-mono text-xs text-green-300 break-all leading-relaxed">{fullLog}</p>
                </div>
              )}

              {/* Structured alert data */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {/* Rule info */}
                {ruleInfo.id && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-24 shrink-0">Rule ID:</span>
                    <Badge variant="outline" className="font-mono text-xs">{ruleInfo.id}</Badge>
                    {ruleInfo.level != null && (
                      <Badge variant={ruleInfo.level >= 10 ? 'destructive' : 'secondary'} className="text-xs">
                        Level {ruleInfo.level}
                      </Badge>
                    )}
                  </div>
                )}
                {ruleInfo.description && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-24 shrink-0">Description:</span>
                    <span className="text-xs font-medium">{ruleInfo.description}</span>
                  </div>
                )}

                {/* Source IP + Port */}
                {srcIp && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-24 shrink-0">Source IP:</span>
                    <Badge variant="outline" className="font-mono text-xs gap-1">
                      <Globe className="h-3 w-3" />
                      {srcIp}{srcPort && `:${srcPort}`}
                    </Badge>
                  </div>
                )}

                {/* Destination / Target user */}
                {(dstUser || dstIp) && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-24 shrink-0">
                      {dstUser ? 'Target User:' : 'Dest IP:'}
                    </span>
                    <Badge variant="outline" className="font-mono text-xs">
                      {dstUser || dstIp}
                    </Badge>
                  </div>
                )}

                {/* Agent */}
                {agentInfo.name && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-24 shrink-0">Agent:</span>
                    <div className="flex items-center gap-1.5">
                      <Server className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs">{agentInfo.name}</span>
                      {agentInfo.ip && <span className="text-xs text-muted-foreground">({agentInfo.ip})</span>}
                    </div>
                  </div>
                )}

                {/* Event time */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-24 shrink-0">Event Time:</span>
                  <span className="text-xs">{new Date(execution.event_time).toLocaleString()}</span>
                </div>
              </div>

              {/* MITRE ATT&CK Tags */}
              {(mitreInfo.tactic?.length > 0 || mitreInfo.technique?.length > 0 || mitreInfo.id?.length > 0) && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Shield className="h-3.5 w-3.5 text-red-400" />
                  <span className="text-xs text-muted-foreground">MITRE ATT&CK:</span>
                  {mitreInfo.id?.map((id: string) => (
                    <Badge key={id} variant="destructive" className="text-[10px]">{id}</Badge>
                  ))}
                  {mitreInfo.tactic?.map((t: string) => (
                    <Badge key={t} variant="outline" className="text-[10px] border-red-500/30 text-red-400">{t}</Badge>
                  ))}
                  {mitreInfo.technique?.map((t: string) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
              )}

              {/* Rule groups */}
              {ruleInfo.groups?.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">Groups:</span>
                  {ruleInfo.groups.map((g: string) => (
                    <Badge key={g} variant="outline" className="text-[10px]">{g}</Badge>
                  ))}
                </div>
              )}

              {/* Toggle raw JSON */}
              <button
                onClick={() => setShowRawTrigger(!showRawTrigger)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                {showRawTrigger ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {showRawTrigger ? 'Hide' : 'Show'} raw trigger data
              </button>
              {showRawTrigger && (
                <pre className="text-xs bg-background border rounded p-2 overflow-x-auto max-h-64">
                  {JSON.stringify(td, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>

          {/* ══════════════════════════════════════════════════════════════════
              SECTION 2: EXECUTION PIPELINE — each step with smart rendering
              All steps expanded by default, click to collapse
              ══════════════════════════════════════════════════════════════════ */}
          {execution.steps && execution.steps.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Play className="h-4 w-4 text-blue-500" />
                  Execution Pipeline
                  <span className="text-muted-foreground font-normal">
                    ({execution.steps.filter((s: any) => s.state === 'COMPLETED').length}/{execution.steps.length} steps completed)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-0">
                  {execution.steps.map((step: any, index: number) => {
                    const meta = stepMetaMap.get(step.step_id);
                    const stepName = meta?.name || step.step_id;
                    const stepType = meta?.type || 'action';
                    const StepIcon = StepTypeIcons[stepType] || Box;
                    const typeColor = StepTypeColors[stepType] || 'bg-gray-500/10 text-gray-500 border-gray-500/20';
                    const isCollapsed = collapsedSteps.has(step.step_id);
                    const isLast = index === execution.steps.length - 1;

                    return (
                      <div key={step.step_id}>
                        <div className="border rounded-lg overflow-hidden">
                          {/* Step Header */}
                          <div
                            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => toggleStep(step.step_id)}
                          >
                            {/* State icon */}
                            <div className="shrink-0">
                              {step.state === 'COMPLETED' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                              {step.state === 'FAILED' && <XCircle className="h-5 w-5 text-red-500" />}
                              {step.state === 'EXECUTING' && <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
                              {step.state === 'PENDING' && <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/40" />}
                              {step.state === 'SKIPPED' && <div className="h-5 w-5 rounded-full border-2 border-dashed border-yellow-500/60" />}
                              {!['COMPLETED', 'FAILED', 'EXECUTING', 'PENDING', 'SKIPPED'].includes(step.state) && (
                                <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/40" />
                              )}
                            </div>

                            {/* Step type icon */}
                            <div className={cn('p-1.5 rounded', typeColor)}>
                              <StepIcon className="h-3.5 w-3.5" />
                            </div>

                            {/* Step name */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Step {index + 1}</span>
                                <span className="font-medium text-sm truncate">{stepName}</span>
                              </div>
                            </div>

                            {/* Badges */}
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant="outline" className={cn('text-xs capitalize', typeColor)}>
                                {stepType}
                              </Badge>
                              <Badge variant="outline" className="text-xs">{step.state}</Badge>
                              {step.duration_ms != null && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatDuration(step.duration_ms)}
                                </span>
                              )}
                              <div className="text-muted-foreground">
                                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </div>
                            </div>
                          </div>

                          {/* Step content — expanded by default */}
                          {!isCollapsed && (
                            <div className="border-t px-4 py-3 space-y-3 bg-muted/20">
                              {/* Timestamps row */}
                              {(step.started_at || step.completed_at) && (
                                <div className="flex gap-4 text-xs text-muted-foreground">
                                  {step.started_at && <span>Started: {new Date(step.started_at).toLocaleString()}</span>}
                                  {step.completed_at && <span>Completed: {new Date(step.completed_at).toLocaleString()}</span>}
                                </div>
                              )}

                              {/* Connector info */}
                              {meta?.connector_id && (
                                <div className="text-xs flex items-center gap-2">
                                  <span className="text-muted-foreground">Connector:</span>
                                  <Badge variant="outline" className="text-xs font-mono">{meta.connector_id}</Badge>
                                  {meta.action_type && (
                                    <>
                                      <span className="text-muted-foreground">Action:</span>
                                      <Badge variant="secondary" className="text-xs">{meta.action_type}</Badge>
                                    </>
                                  )}
                                </div>
                              )}

                              {/* Parameters */}
                              {meta?.parameters && Object.keys(meta.parameters).length > 0 && (
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Parameters</p>
                                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                                    {Object.entries(meta.parameters).map(([key, value]) => (
                                      <div key={key} className="flex items-start gap-1.5">
                                        <span className="text-muted-foreground shrink-0">{key}:</span>
                                        <span className="font-mono break-all">{String(value)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* SMART OUTPUT RENDERING based on step type */}
                              {step.output != null && stepType === 'enrichment' && (
                                <EnrichmentOutputRenderer output={step.output} actionType={meta?.action_type} />
                              )}
                              {step.output != null && stepType === 'condition' && (
                                <ConditionOutputRenderer output={step.output} meta={meta} />
                              )}
                              {step.output != null && stepType === 'action' && (
                                <ActionOutputRenderer output={step.output} meta={meta} />
                              )}
                              {step.output != null && stepType === 'notification' && (
                                <NotificationOutputRenderer output={step.output} meta={meta} />
                              )}
                              {/* Fallback for unknown step types */}
                              {step.output != null && !['enrichment', 'condition', 'action', 'notification'].includes(stepType) && (
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Output</p>
                                  <pre className="text-xs bg-background border rounded p-2 overflow-x-auto max-h-48">
                                    {typeof step.output === 'string' ? step.output : JSON.stringify(step.output, null, 2)}
                                  </pre>
                                </div>
                              )}

                              {/* PENDING state — show what this step would do */}
                              {step.state === 'PENDING' && meta && (
                                <div className="p-2.5 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10">
                                  <p className="text-xs text-muted-foreground italic">
                                    Pending — {stepType === 'enrichment' && 'will query connector for enrichment data'}
                                    {stepType === 'action' && `will execute ${meta.action_type?.replace(/_/g, ' ') || 'action'}`}
                                    {stepType === 'condition' && 'will evaluate condition and branch'}
                                    {stepType === 'notification' && 'will send notification'}
                                    {!['enrichment', 'action', 'condition', 'notification'].includes(stepType) && 'waiting for previous steps'}
                                  </p>
                                </div>
                              )}

                              {/* Error display */}
                              {step.error && (
                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                                  <div className="flex items-center gap-2 mb-1">
                                    <AlertTriangle className="h-4 w-4 text-red-500" />
                                    <p className="text-xs font-medium text-red-500">Error</p>
                                    {step.error.code && (
                                      <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400">{step.error.code}</Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-red-400">
                                    {step.error.message || (typeof step.error === 'string' ? step.error : JSON.stringify(step.error))}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Pipeline connector arrow between steps */}
                        {!isLast && (
                          <div className="flex justify-center py-1">
                            <div className="w-px h-4 bg-border" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              SECTION 3: EXECUTION METADATA (collapsed by default)
              ══════════════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Hash className="h-4 w-4 text-muted-foreground" />
                Execution Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-muted-foreground text-xs">Playbook:</span>
                  <p className="font-medium text-xs">{execution.playbook_name} ({execution.playbook_id})</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Webhook ID:</span>
                  <p className="font-mono text-xs">{execution.webhook_id}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Fingerprint:</span>
                  <p className="font-mono text-xs truncate">{execution.fingerprint}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Trigger Source:</span>
                  <p className="text-xs">{execution.trigger_source || 'webhook'}</p>
                </div>
              </div>

              {/* Trigger Snapshot */}
              {execution.trigger_snapshot && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-1.5">Trigger Snapshot (Audit Trail)</p>
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <Badge variant="outline" className="font-mono text-[10px]">{execution.trigger_snapshot.trigger_id}</Badge>
                    <Badge variant="outline" className="text-[10px]">v{execution.trigger_snapshot.version}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{execution.trigger_snapshot.match}</Badge>
                    <span className="text-muted-foreground">{new Date(execution.trigger_snapshot.snapshot_at).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
