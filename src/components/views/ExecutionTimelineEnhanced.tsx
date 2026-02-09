import { useState } from 'react';
import {
  Radio,
  RefreshCw,
  Eye,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  Activity,
  Timer,
  Zap,
  AlertCircle,
  FolderOpen,
  Search,
  GitBranch,
  Bell,
  Box,
  FileText,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Server,
  Globe,
  Mail,
  Hash,
  Play,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StateBadge, SeverityBadge } from '@/components/common/StatusBadges';
import { TimeAgo } from '@/components/common/TimeDisplay';
import { useToast } from '@/hooks/use-toast';
import { useExecutions, useExecution, useReExecute, type Execution } from '@/hooks/useExecutions';
import { useExecutionTimeline } from '@/hooks/useExecutionTimeline';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
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

/** Safely convert any backend value to a renderable string */
function safeStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try { return JSON.stringify(val); } catch { return String(val); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART STEP RENDERERS — type-aware rendering for each step type
// ═══════════════════════════════════════════════════════════════════════════════

/** Render enrichment output (VirusTotal, AbuseIPDB, etc.) */
function EnrichmentOutputRenderer({ output }: { output: any }) {
  if (!output) return null;

  // VirusTotal-style lookup
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
        <div className="grid grid-cols-2 gap-2 text-xs">
          {output.ip && (
            <div className="flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">IP:</span>
              <span className="font-mono">{output.ip}</span>
            </div>
          )}
          {output.country && (
            <div><span className="text-muted-foreground">Country:</span> {output.country}</div>
          )}
          {output.as_owner && (
            <div className="col-span-2"><span className="text-muted-foreground">AS Owner:</span> {output.as_owner}</div>
          )}
          {output.network && (
            <div><span className="text-muted-foreground">Network:</span> <span className="font-mono">{output.network}</span></div>
          )}
        </div>
        {total > 0 && (
          <div>
            <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
              {malicious > 0 && <div className="bg-red-500" style={{ width: `${(malicious / total) * 100}%` }} />}
              {suspicious > 0 && <div className="bg-yellow-500" style={{ width: `${(suspicious / total) * 100}%` }} />}
              {(output.harmless_votes || 0) > 0 && <div className="bg-green-500" style={{ width: `${((output.harmless_votes || 0) / total) * 100}%` }} />}
              {(output.undetected_votes || 0) > 0 && <div className="bg-gray-400" style={{ width: `${((output.undetected_votes || 0) / total) * 100}%` }} />}
            </div>
            <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Malicious ({malicious})</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />Suspicious ({suspicious})</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Harmless ({output.harmless_votes || 0})</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />Undetected ({output.undetected_votes || 0})</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Generic enrichment
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

/** Render condition step — which branch was taken */
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
          {output.evaluated_value != null && (
            <p className="text-xs text-muted-foreground">Evaluated value: {JSON.stringify(output.evaluated_value)}</p>
          )}
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

/** Render action step — IP blocked, firewall rule, etc. */
function ActionOutputRenderer({ output, meta }: { output: any; meta?: any }) {
  if (!output) return null;
  // Detect success from various connector output formats:
  // - Email/generic: output.success === true
  // - Blocklist: output.status === 'blocked' or 'already_blocked'
  const success = output.success === true
    || output.status === 'blocked'
    || output.status === 'already_blocked';

  if (output.skipped && output.reason === 'shadow_mode') {
    return (
      <div className="p-3 rounded-lg border bg-yellow-500/10 border-yellow-500/30">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-yellow-500" />
          <div>
            <p className="text-sm font-medium text-yellow-500">Shadow Mode — Action Skipped</p>
            <p className="text-xs text-muted-foreground">Would have executed but skipped due to shadow mode.</p>
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
      <div className="grid grid-cols-2 gap-2 text-xs">
        {output.ip && (
          <div className="flex items-center gap-1.5">
            <Globe className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">IP:</span>
            <span className="font-mono">{output.ip}</span>
          </div>
        )}
        {output.status && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Status:</span>
            <Badge variant="outline" className="text-[10px]">{output.status.replace(/_/g, ' ')}</Badge>
          </div>
        )}
        {output.blocklist && (
          <div className="flex items-center gap-1.5">
            <Shield className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Blocklist:</span>
            <span className="font-mono">{output.blocklist}</span>
          </div>
        )}
        {output.enforced_by && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Enforced by:</span>
            <span>{output.enforced_by}</span>
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
        {(output.simulated != null || output._simulated != null) && (
          <div>
            <span className="text-muted-foreground">Simulated:</span>{' '}
            <Badge variant={(output.simulated || output._simulated) ? 'secondary' : 'outline'} className="text-[10px]">
              {(output.simulated || output._simulated) ? 'Yes (demo)' : 'No (live)'}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}

/** Render notification step — delivery status */
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
        {inner.channels && Array.isArray(inner.channels) && (
          <p className="text-xs text-muted-foreground">
            Channels: {inner.channels.map((c: any) => c.channel || c).join(', ')}
          </p>
        )}
        {inner.subject && <p className="text-xs text-muted-foreground">Subject: {inner.subject}</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION DETAIL PANEL — shown in the sheet when clicking Eye
// ═══════════════════════════════════════════════════════════════════════════════

function ExecutionDetailPanel({ execution }: { execution: Execution }) {
  const [createCaseOpen, setCreateCaseOpen] = useState(false);
  const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(new Set());
  const [showRawTrigger, setShowRawTrigger] = useState(false);

  // Fetch the FULL execution document (with steps, trigger_data, output, errors)
  const {
    data: fullExecution,
    isLoading: execLoading,
  } = useExecution(execution.executionId || execution.execution_id, true);

  // Fetch SLA/timeline data for SLA status display
  const {
    data: timelineData,
    isLoading: tlLoading,
    error: tlError,
    refetch,
  } = useExecutionTimeline(execution.executionId || execution.execution_id);

  // Fetch playbook DSL to get step names, types, parameters
  const { data: playbook } = useQuery({
    queryKey: ['playbook-detail', execution.playbook_id],
    queryFn: () => apiClient.getPlaybook(execution.playbook_id),
    enabled: !!execution.playbook_id,
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
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  if (execLoading || tlLoading) {
    return (
      <div className="space-y-4 py-4">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (tlError) {
    return (
      <div className="py-8 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Failed to load execution details</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  // Use full execution data, fall back to the list-level execution
  const exec = fullExecution || execution;
  const td = (exec as any).trigger_data || {};
  const steps = (exec as any).steps || [];

  // Extract structured fields from Wazuh/CyberSentinel trigger_data
  const ruleInfo = td.rule || {};
  const agentInfo = td.agent || {};
  const srcIp = td.data?.srcip || td.source_ip || '';
  const srcPort = td.data?.srcport || '';
  const dstUser = td.data?.dstuser || '';
  const dstIp = td.data?.dstip || td.destination_ip || '';
  const fullLog = td.full_log || '';
  const mitreInfo = ruleInfo.mitre || {};
  const sla_status = timelineData?.sla_status || (exec as any).sla_status;
  const hasSLABreach = sla_status?.acknowledge?.breached || sla_status?.containment?.breached || sla_status?.resolution?.breached;

  return (
    <div className="space-y-5 py-4">

      {/* Actions bar */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setCreateCaseOpen(true)}>
          <FolderOpen className="h-3.5 w-3.5" />
          Create Case
        </Button>
      </div>
      <CreateCaseModal
        open={createCaseOpen}
        onOpenChange={setCreateCaseOpen}
        executionId={safeStr(execution.executionId || execution.execution_id)}
        executionData={{
          execution_id: execution.execution_id || execution.executionId,
          playbook_name: execution.playbook_name || execution.playbookName,
          trigger_data: td,
        }}
      />

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 1: INCOMING ALERT LOG
          ══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-orange-500" />
            Incoming Alert Log
            <Badge variant="secondary" className="text-xs">{(exec as any).trigger_source || 'webhook'}</Badge>
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

          {/* Structured alert fields */}
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
              <span className="text-xs">{new Date((exec as any).event_time || execution.started_at || '').toLocaleString()}</span>
            </div>
          </div>

          {/* MITRE ATT&CK */}
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

          {/* Raw JSON toggle */}
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
          SECTION 2: EXECUTION PIPELINE — all steps with smart rendering
          ══════════════════════════════════════════════════════════════════ */}
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
                      {/* Step header — click to collapse */}
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

                      {/* Step content — expanded by default */}
                      {!isCollapsed && (
                        <div className="border-t px-3 py-3 space-y-3 bg-muted/20">
                          {/* Timestamps */}
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
                              <Badge variant="outline" className="text-[10px] font-mono">{meta.connector_id}</Badge>
                              {meta.action_type && (
                                <>
                                  <span className="text-muted-foreground">Action:</span>
                                  <Badge variant="secondary" className="text-[10px]">{meta.action_type}</Badge>
                                </>
                              )}
                            </div>
                          )}

                          {/* Parameters */}
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

                          {/* SMART OUTPUT per step type */}
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

                          {/* Pending explanation */}
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

                          {/* Error */}
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

                    {/* Pipeline connector between steps */}
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

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 3: SLA STATUS
          ══════════════════════════════════════════════════════════════════ */}
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
                    {s.breached ? <XCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-status-success" />}
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

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 4: EXECUTION METADATA
          ══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Hash className="h-4 w-4 text-muted-foreground" />
            Execution Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-muted-foreground">Playbook:</span>
              <p className="font-medium">{safeStr(execution.playbookName || execution.playbook_name)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Playbook ID:</span>
              <p className="font-mono">{safeStr(execution.playbook_id)}</p>
            </div>
            {(exec as any).webhook_id && (
              <div>
                <span className="text-muted-foreground">Webhook ID:</span>
                <p className="font-mono">{(exec as any).webhook_id}</p>
              </div>
            )}
            {(exec as any).fingerprint && (
              <div>
                <span className="text-muted-foreground">Fingerprint:</span>
                <p className="font-mono truncate">{(exec as any).fingerprint}</p>
              </div>
            )}
          </div>

          {/* Trigger Snapshot */}
          {(exec as any).trigger_snapshot && (
            <div className="pt-2 border-t">
              <p className="text-muted-foreground mb-1">Trigger Snapshot (Audit)</p>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="font-mono text-[10px]">{(exec as any).trigger_snapshot.trigger_id}</Badge>
                <Badge variant="outline" className="text-[10px]">v{(exec as any).trigger_snapshot.version}</Badge>
                <Badge variant="secondary" className="text-[10px]">{(exec as any).trigger_snapshot.match}</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — Execution list with detail sheet
// ═══════════════════════════════════════════════════════════════════════════════

export function ExecutionTimeline() {
  const { toast } = useToast();
  const { data, isLoading, isFetching, refetch } = useExecutions(undefined, false);
  const executions = data?.executions || [];
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [reExecTarget, setReExecTarget] = useState<Execution | null>(null);
  const reExecuteMutation = useReExecute();

  const filteredExecutions = executions.filter((exe) => {
    if (stateFilter === 'all') return true;
    if (stateFilter === 'running') {
      return ['CREATED', 'ENRICHING', 'WAITING_APPROVAL', 'EXECUTING'].includes(exe.state);
    }
    return exe.state === stateFilter;
  });

  const stateCounts = {
    running: executions.filter((e) =>
      ['CREATED', 'ENRICHING', 'WAITING_APPROVAL', 'EXECUTING'].includes(e.state)
    ).length,
    completed: executions.filter((e) => e.state === 'COMPLETED').length,
    failed: executions.filter((e) => e.state === 'FAILED').length,
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary" />
            Playbook Executions
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Monitor real-time and historical playbook runs with detailed drill-down
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
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card
          className={cn('cursor-pointer transition-all hover:shadow-md', stateFilter === 'running' && 'ring-2 ring-status-pending')}
          onClick={() => setStateFilter(stateFilter === 'running' ? 'all' : 'running')}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 text-status-pending animate-spin" />
              <span className="text-sm font-medium">Running</span>
            </div>
            <span className="text-2xl font-bold">{stateCounts.running}</span>
          </CardContent>
        </Card>
        <Card
          className={cn('cursor-pointer transition-all hover:shadow-md', stateFilter === 'COMPLETED' && 'ring-2 ring-status-success')}
          onClick={() => setStateFilter(stateFilter === 'COMPLETED' ? 'all' : 'COMPLETED')}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-status-success" />
              <span className="text-sm font-medium">Completed</span>
            </div>
            <span className="text-2xl font-bold">{stateCounts.completed}</span>
          </CardContent>
        </Card>
        <Card
          className={cn('cursor-pointer transition-all hover:shadow-md', stateFilter === 'FAILED' && 'ring-2 ring-status-error')}
          onClick={() => setStateFilter(stateFilter === 'FAILED' ? 'all' : 'FAILED')}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-status-error" />
              <span className="text-sm font-medium">Failed</span>
            </div>
            <span className="text-2xl font-bold">{stateCounts.failed}</span>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-40 h-8">
            <SelectValue placeholder="All States" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            <SelectItem value="CREATED">Created</SelectItem>
            <SelectItem value="ENRICHING">Enriching</SelectItem>
            <SelectItem value="WAITING_APPROVAL">Waiting Approval</SelectItem>
            <SelectItem value="EXECUTING">Executing</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {filteredExecutions.length} execution{filteredExecutions.length !== 1 && 's'}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {filteredExecutions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No executions found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-28">ID</TableHead>
                  <TableHead>Playbook</TableHead>
                  <TableHead className="w-36">State</TableHead>
                  <TableHead className="w-32">Started</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExecutions.map((execution) => (
                  <TableRow key={execution.id} className="table-row-interactive">
                    <TableCell>
                      <code className="text-xs">
                        {safeStr(execution.executionId || execution.execution_id)}
                      </code>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-sm">
                        {safeStr(execution.playbookName || execution.playbook_name)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StateBadge state={execution.state} />
                    </TableCell>
                    <TableCell>
                      <TimeAgo
                        date={execution.startedAt || execution.started_at || ''}
                        className="text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Sheet>
                          <SheetTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="View details"
                              onClick={() => setSelectedExecution(execution)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </SheetTrigger>
                          <SheetContent className="w-[700px] sm:max-w-[700px] overflow-y-auto">
                            <SheetHeader>
                              <SheetTitle className="flex items-center gap-2">
                                <code className="text-sm">
                                  {safeStr(execution.executionId || execution.execution_id)}
                                </code>
                                <StateBadge state={execution.state} />
                              </SheetTitle>
                            </SheetHeader>
                            {selectedExecution && (
                              <ExecutionDetailPanel execution={selectedExecution} />
                            )}
                          </SheetContent>
                        </Sheet>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Re-execute with same alert data"
                          onClick={() => setReExecTarget(execution)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
                <span className="font-medium">{safeStr(reExecTarget.playbookName || reExecTarget.playbook_name)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Source IP:</span>
                <span className="font-mono">
                  {reExecTarget.trigger_data?.data?.srcip || reExecTarget.trigger_data?.source_ip || 'N/A'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Original Execution:</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {safeStr(reExecTarget.executionId || reExecTarget.execution_id)}
                </Badge>
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
                    onSuccess: (data: any) => {
                      toast({
                        title: 'Execution Created',
                        description: `New execution ${data.execution_id || ''} started.`,
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
    </div>
  );
}
