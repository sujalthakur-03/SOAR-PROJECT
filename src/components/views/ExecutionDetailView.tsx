import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  Play,
  RefreshCw,
  Timer,
  FileText,
  Hash,
  Terminal,
  Server,
  Globe,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Search,
  GitBranch,
  Zap,
  Bell,
  Box,
  ChevronRight,
  ChevronDown,
  Mail,
  ArrowRight,
  FolderOpen,
  RotateCcw,
} from 'lucide-react';
import { StateBadge, SeverityBadge } from '@/components/common/StatusBadges';
import { useExecution, useReExecute } from '@/hooks/useExecutions';
import { useExecutionTimeline } from '@/hooks/useExecutionTimeline';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import CreateCaseModal from '@/components/cases/CreateCaseModal';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

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

function formatDuration(ms?: number): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function safeStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try { return JSON.stringify(val); } catch { return String(val); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP RENDERERS
// ═══════════════════════════════════════════════════════════════════════════════

function EnrichmentOutputRenderer({ output }: { output: any }) {
  if (!output) return null;

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
        <div className={cn(
          'flex items-center gap-3 p-3 rounded-lg border',
          isMalicious ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'
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
              {malicious}/{total} vendors flagged malicious
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
      </div>
    );
  }

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

function ConditionOutputRenderer({ output, meta }: { output: any; meta?: any }) {
  if (!output) return null;
  const result = output.result;
  const branchTaken = output.branch_taken;
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
            Condition: <span className={result ? 'text-green-500' : 'text-orange-500'}>{result ? 'TRUE' : 'FALSE'}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <ArrowRight className="h-3 w-3" />
          <Badge variant="outline" className="font-mono">{branchTaken}</Badge>
          <span className="text-muted-foreground">
            {nextStep === '__END__' ? '(pipeline end)' : nextStep ? `(${nextStep})` : ''}
          </span>
        </div>
      </div>
      {meta?.condition && (
        <p className="text-xs text-muted-foreground">
          Rule: <span className="font-mono">{meta.condition.field} {meta.condition.operator} {JSON.stringify(meta.condition.value)}</span>
        </p>
      )}
    </div>
  );
}

function ActionOutputRenderer({ output, meta }: { output: any; meta?: any }) {
  if (!output) return null;
  const success = output.success === true
    || output.status === 'blocked'
    || output.status === 'already_blocked';

  if (output.skipped && output.reason === 'shadow_mode') {
    return (
      <div className="p-3 rounded-lg border bg-yellow-500/10 border-yellow-500/30">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-yellow-500" />
          <div>
            <p className="text-sm font-medium text-yellow-500">Shadow Mode -- Action Skipped</p>
            <p className="text-xs text-muted-foreground">Would have executed but skipped due to shadow mode.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className={cn(
        'flex items-center gap-3 p-3 rounded-lg border',
        success ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
      )}>
        {success ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" /> : <XCircle className="h-5 w-5 text-red-500 shrink-0" />}
        <div className="flex-1">
          <p className={cn('text-sm font-medium', success ? 'text-green-500' : 'text-red-500')}>
            {success ? 'Action Executed Successfully' : 'Action Failed'}
          </p>
          {meta?.action_type && (
            <p className="text-xs text-muted-foreground">Action: {meta.action_type.replace(/_/g, ' ')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationOutputRenderer({ output }: { output: any }) {
  if (!output) return null;
  const sent = output.sent ?? output.success;
  const inner = output.output || output;

  return (
    <div className={cn(
      'flex items-center gap-3 p-3 rounded-lg border',
      sent ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
    )}>
      {sent ? <Mail className="h-5 w-5 text-green-500 shrink-0" /> : <XCircle className="h-5 w-5 text-red-500 shrink-0" />}
      <div className="flex-1">
        <p className={cn('text-sm font-medium', sent ? 'text-green-500' : 'text-red-500')}>
          {sent ? 'Notification Sent' : 'Notification Failed'}
        </p>
        {inner.recipients && (
          <p className="text-xs text-muted-foreground">
            To: {Array.isArray(inner.recipients) ? inner.recipients.join(', ') : inner.recipients}
          </p>
        )}
        {inner.subject && <p className="text-xs text-muted-foreground">Subject: {inner.subject}</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION DETAIL VIEW — Full page component
// ═══════════════════════════════════════════════════════════════════════════════

const ExecutionDetailView = () => {
  const { executionId } = useParams<{ executionId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(new Set());
  const [showRawTrigger, setShowRawTrigger] = useState(false);
  const [createCaseOpen, setCreateCaseOpen] = useState(false);

  const {
    data: execution,
    isLoading: execLoading,
    error: execError,
    refetch: refetchExec,
  } = useExecution(executionId || '', true);

  const {
    data: timelineData,
    isLoading: tlLoading,
    refetch: refetchTimeline,
  } = useExecutionTimeline(executionId || '');

  const reExecuteMutation = useReExecute();

  // Fetch playbook DSL for step metadata
  const { data: playbook } = useQuery({
    queryKey: ['playbook-detail', execution?.playbook_id],
    queryFn: () => apiClient.getPlaybook(execution.playbook_id),
    enabled: !!execution?.playbook_id,
  });

  const toggleStep = (stepId: string) => {
    setCollapsedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handleReExecute = async () => {
    if (!execution) return;
    try {
      await reExecuteMutation.mutateAsync({
        playbook_id: execution.playbook_id,
        trigger_data: execution.trigger_data || {},
      });
      toast({
        title: 'Re-execution triggered',
        description: `Playbook ${execution.playbook_name || execution.playbook_id} re-triggered successfully`,
      });
    } catch (error: any) {
      toast({
        title: 'Re-execution failed',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  if (execLoading || tlLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (execError || !execution) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate('/?view=executions')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Execution Not Found</h1>
        </div>
        <div className="text-center py-12">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">
            {execError ? `Failed to load execution: ${(execError as Error).message}` : `Execution "${executionId}" was not found.`}
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => refetchExec()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
            <Button variant="outline" onClick={() => navigate('/?view=executions')}>
              Back to Executions
            </Button>
          </div>
        </div>
      </div>
    );
  }

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

  const td = execution.trigger_data || {};
  const steps = execution.steps || [];
  const ruleInfo = td.rule || {};
  const agentInfo = td.agent || {};
  const srcIp = td.data?.srcip || td.source_ip || '';
  const srcPort = td.data?.srcport || '';
  const dstUser = td.data?.dstuser || '';
  const dstIp = td.data?.dstip || td.destination_ip || '';
  const fullLog = td.full_log || '';
  const mitreInfo = ruleInfo.mitre || {};
  const sla_status = timelineData?.sla_status || execution.sla_status;
  const hasSLABreach = sla_status?.acknowledge?.breached || sla_status?.containment?.breached || sla_status?.resolution?.breached;

  const severity = td.severity || td.rule?.level_category || '';
  const state = execution.state || '';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/?view=executions')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-3xl font-bold font-mono">
                {execution.execution_id || executionId}
              </h1>
              <StateBadge state={state} />
              {severity && <SeverityBadge severity={severity} />}
              {hasSLABreach && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  SLA BREACH
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              Playbook: {execution.playbook_name || execution.playbook_id}
              {execution.started_at && (
                <> &middot; Started {new Date(execution.started_at).toLocaleString()}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setCreateCaseOpen(true)}>
            <FolderOpen className="h-4 w-4" />
            Create Case
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleReExecute}
            disabled={reExecuteMutation.isPending}
          >
            <RotateCcw className="h-4 w-4" />
            Re-Execute
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetchExec(); refetchTimeline(); }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <CreateCaseModal
        open={createCaseOpen}
        onOpenChange={setCreateCaseOpen}
        executionId={safeStr(execution.execution_id || executionId)}
        executionData={{
          execution_id: execution.execution_id,
          playbook_name: execution.playbook_name,
          trigger_data: td,
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">

          {/* Incoming Alert Log */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-orange-500" />
                Incoming Alert Log
                <Badge variant="secondary" className="text-xs">{execution.trigger_source || 'webhook'}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {fullLog && (
                <div className="p-2.5 bg-black/80 rounded-lg">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Terminal className="h-3 w-3 text-green-400" />
                    <span className="text-[10px] text-green-400 uppercase tracking-wider">Raw Log</span>
                  </div>
                  <p className="font-mono text-xs text-green-300 break-all leading-relaxed">{fullLog}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {ruleInfo.id && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-20 shrink-0">Rule ID:</span>
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
                    <span className="text-muted-foreground text-xs w-20 shrink-0">Description:</span>
                    <span className="text-xs font-medium">{ruleInfo.description}</span>
                  </div>
                )}
                {srcIp && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-20 shrink-0">Source IP:</span>
                    <Badge variant="outline" className="font-mono text-xs gap-1">
                      <Globe className="h-3 w-3" />
                      {srcIp}{srcPort && `:${srcPort}`}
                    </Badge>
                  </div>
                )}
                {(dstUser || dstIp) && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-20 shrink-0">{dstUser ? 'Target:' : 'Dest IP:'}</span>
                    <Badge variant="outline" className="font-mono text-xs">{dstUser || dstIp}</Badge>
                  </div>
                )}
                {agentInfo.name && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-20 shrink-0">Agent:</span>
                    <Server className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs">{agentInfo.name}</span>
                    {agentInfo.ip && <span className="text-xs text-muted-foreground">({agentInfo.ip})</span>}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-20 shrink-0">Event Time:</span>
                  <span className="text-xs">{new Date(execution.event_time || execution.started_at || '').toLocaleString()}</span>
                </div>
              </div>

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

              {ruleInfo.groups?.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">Groups:</span>
                  {ruleInfo.groups.map((g: string) => (
                    <Badge key={g} variant="outline" className="text-[10px]">{g}</Badge>
                  ))}
                </div>
              )}

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

          {/* Execution Pipeline */}
          {steps.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Play className="h-4 w-4 text-blue-500" />
                  Execution Pipeline
                  <span className="text-muted-foreground font-normal">
                    ({steps.filter((s: any) => s.state === 'COMPLETED').length}/{steps.length} completed)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-0">
                  {steps.map((step: any, index: number) => {
                    const meta = stepMetaMap.get(step.step_id);
                    const stepName = meta?.name || step.step_id;
                    const stepType = meta?.type || 'action';
                    const StepIcon = StepTypeIcons[stepType] || Box;
                    const typeColor = StepTypeColors[stepType] || 'bg-gray-500/10 text-gray-500 border-gray-500/20';
                    const isCollapsed = collapsedSteps.has(step.step_id);
                    const isLast = index === steps.length - 1;

                    return (
                      <div key={step.step_id}>
                        <div className="border rounded-lg overflow-hidden">
                          <div
                            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => toggleStep(step.step_id)}
                          >
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
                            <div className={cn('p-1.5 rounded', typeColor)}>
                              <StepIcon className="h-3.5 w-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Step {index + 1}</span>
                                <span className="font-medium text-sm truncate">{stepName}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Badge variant="outline" className={cn('text-[10px] capitalize', typeColor)}>{stepType}</Badge>
                              <Badge variant="outline" className="text-[10px]">{step.state}</Badge>
                              {step.duration_ms != null && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <Clock className="h-2.5 w-2.5" />
                                  {formatDuration(step.duration_ms)}
                                </span>
                              )}
                              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                            </div>
                          </div>

                          {!isCollapsed && (
                            <div className="border-t px-3 py-3 space-y-3 bg-muted/20">
                              {(step.started_at || step.completed_at) && (
                                <div className="flex gap-4 text-xs text-muted-foreground">
                                  {step.started_at && <span>Started: {new Date(step.started_at).toLocaleString()}</span>}
                                  {step.completed_at && <span>Completed: {new Date(step.completed_at).toLocaleString()}</span>}
                                </div>
                              )}

                              {meta?.connector_id && (
                                <div className="text-xs flex items-center gap-2">
                                  <span className="text-muted-foreground">Connector:</span>
                                  <Badge variant="outline" className="text-[10px] font-mono">{meta.connector_id}</Badge>
                                  {meta.action_type && (
                                    <>
                                      <span className="text-muted-foreground">Action:</span>
                                      <Badge variant="secondary" className="text-[10px]">{meta.action_type}</Badge>
                                    </>
                                  )}
                                </div>
                              )}

                              {meta?.parameters && Object.keys(meta.parameters).length > 0 && (
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Parameters</p>
                                  <div className="grid grid-cols-1 gap-1 text-xs">
                                    {Object.entries(meta.parameters).map(([key, value]) => (
                                      <div key={key} className="flex items-start gap-1.5">
                                        <span className="text-muted-foreground shrink-0">{key}:</span>
                                        <span className="font-mono break-all">{String(value)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {step.output != null && stepType === 'enrichment' && <EnrichmentOutputRenderer output={step.output} />}
                              {step.output != null && stepType === 'condition' && <ConditionOutputRenderer output={step.output} meta={meta} />}
                              {step.output != null && stepType === 'action' && <ActionOutputRenderer output={step.output} meta={meta} />}
                              {step.output != null && stepType === 'notification' && <NotificationOutputRenderer output={step.output} />}
                              {step.output != null && !['enrichment', 'condition', 'action', 'notification'].includes(stepType) && (
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Output</p>
                                  <pre className="text-xs bg-background border rounded p-2 overflow-x-auto max-h-48">
                                    {typeof step.output === 'string' ? step.output : JSON.stringify(step.output, null, 2)}
                                  </pre>
                                </div>
                              )}

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

                        {!isLast && (
                          <div className="flex justify-center py-1">
                            <div className="w-px h-3 bg-border" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* SLA Status */}
          {sla_status && (
            <Card className={cn(hasSLABreach && 'border-destructive')}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Timer className="h-4 w-4" />
                  SLA Status
                  {hasSLABreach && <Badge variant="destructive" className="text-xs">Breach Detected</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {['acknowledge', 'containment', 'resolution'].map(dim => {
                  const s = (sla_status as any)?.[dim];
                  if (!s) return null;
                  return (
                    <div key={dim} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        {s.breached ? <XCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
                        <span className="capitalize">{dim}</span>
                      </div>
                      {s.actual_ms !== undefined && (
                        <span className={cn('text-xs', s.breached && 'text-destructive font-medium')}>
                          {formatDuration(s.actual_ms)} / {formatDuration(s.threshold_ms)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Execution Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hash className="h-5 w-5 text-muted-foreground" />
                Execution Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Execution ID:</span>
                <p className="font-mono text-xs mt-0.5">{execution.execution_id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Playbook:</span>
                <p className="font-medium">{execution.playbook_name || 'Unknown'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Playbook ID:</span>
                <p className="font-mono text-xs">{execution.playbook_id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">State:</span>
                <div className="mt-0.5"><StateBadge state={state} /></div>
              </div>
              {severity && (
                <div>
                  <span className="text-muted-foreground">Severity:</span>
                  <div className="mt-0.5"><SeverityBadge severity={severity} /></div>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Trigger Source:</span>
                <p className="font-medium capitalize">{execution.trigger_source || 'webhook'}</p>
              </div>
              {execution.started_at && (
                <div>
                  <span className="text-muted-foreground">Started At:</span>
                  <p>{new Date(execution.started_at).toLocaleString()}</p>
                </div>
              )}
              {execution.completed_at && (
                <div>
                  <span className="text-muted-foreground">Completed At:</span>
                  <p>{new Date(execution.completed_at).toLocaleString()}</p>
                </div>
              )}
              {execution.duration_ms != null && (
                <div>
                  <span className="text-muted-foreground">Duration:</span>
                  <p className="font-medium">{formatDuration(execution.duration_ms)}</p>
                </div>
              )}
              {execution.webhook_id && (
                <div>
                  <span className="text-muted-foreground">Webhook ID:</span>
                  <p className="font-mono text-xs">{execution.webhook_id}</p>
                </div>
              )}
              {execution.fingerprint && (
                <div>
                  <span className="text-muted-foreground">Fingerprint:</span>
                  <p className="font-mono text-xs truncate">{execution.fingerprint}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Error card if failed */}
          {execution.error && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Execution Error
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-destructive">
                  {typeof execution.error === 'string' ? execution.error : execution.error?.message || JSON.stringify(execution.error)}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Trigger Snapshot */}
          {execution.trigger_snapshot && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Trigger Snapshot (Audit)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono text-[10px]">{execution.trigger_snapshot.trigger_id}</Badge>
                  <Badge variant="outline" className="text-[10px]">v{execution.trigger_snapshot.version}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{execution.trigger_snapshot.match}</Badge>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExecutionDetailView;
