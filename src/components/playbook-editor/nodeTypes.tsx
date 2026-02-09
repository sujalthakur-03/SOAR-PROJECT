import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  FlaskConical, GitBranch, UserCheck, Zap, Bell, Play, Flag,
  Timer, StopCircle, Shield, AlertTriangle, Globe, Mail,
  MessageSquare, Webhook, Ban, UserX, Skull, ListPlus, Hash, Clock, Users,
  AlertOctagon, Info, Loader2, Check, XCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StepType } from '@/types/soar';
import type { ValidationIssue } from './PlaybookValidator';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type TestStatus = 'running' | 'success' | 'error' | 'pending';

export interface PlaybookNodeData extends Record<string, unknown> {
  label: string;
  stepType: StepType | 'trigger' | 'end' | 'delay' | 'stop';
  subtype?: string;
  config?: Record<string, unknown>;
  validationErrors?: string[];
  validationIssues?: ValidationIssue[];
  hasGraphError?: boolean;
  testStatus?: TestStatus;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ICON MAPPINGS BY SUBTYPE
// ═══════════════════════════════════════════════════════════════════════════════

const subtypeIcons: Record<string, React.ElementType> = {
  // Enrichment
  virustotal_ip: Shield,
  abuseipdb_ip: AlertTriangle,
  alienvault_ip: Globe,
  alienvault_hash: Hash,
  alienvault_domain: Globe,
  geoip: Globe,
  dns_reverse: Globe,

  // Condition
  severity_threshold: AlertTriangle,
  match_field: GitBranch,
  failed_attempts: AlertTriangle,
  time_window: Clock,
  reputation_check: Shield,

  // Action
  cybersentinel_block_ip: Shield,
  block_ip: Ban,
  disable_user: UserX,
  kill_process: Skull,
  add_watchlist: ListPlus,
  isolate_host: Shield,

  // Notification
  email_smtp: Mail,
  slack: MessageSquare,
  webhook_custom: Webhook,

  // Control
  approval_analyst: UserCheck,
  approval_manager: Users,
  delay_wait: Timer,
  stop_execution: StopCircle,
};

const getIconForStep = (stepType: string, subtype?: string): React.ElementType => {
  if (subtype && subtypeIcons[subtype]) {
    return subtypeIcons[subtype];
  }

  switch (stepType) {
    case 'trigger': return Play;
    case 'enrichment': return FlaskConical;
    case 'condition': return GitBranch;
    case 'approval': return UserCheck;
    case 'action': return Zap;
    case 'notification': return Bell;
    case 'delay': return Timer;
    case 'stop': return StopCircle;
    case 'end': return Flag;
    default: return Zap;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// NODE STYLES
// ═══════════════════════════════════════════════════════════════════════════════

interface NodeStyle {
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
}

const getNodeStyle = (stepType: string, subtype?: string, hasError?: boolean, testStatus?: TestStatus): NodeStyle => {
  // Test status overrides
  if (testStatus === 'running') {
    return {
      bg: 'bg-primary/10',
      border: 'border-primary',
      iconBg: 'bg-primary/20',
      iconColor: 'text-primary'
    };
  }
  if (testStatus === 'success') {
    return {
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500',
      iconBg: 'bg-emerald-500/20',
      iconColor: 'text-emerald-500'
    };
  }
  if (testStatus === 'error') {
    return {
      bg: 'bg-destructive/10',
      border: 'border-destructive',
      iconBg: 'bg-destructive/20',
      iconColor: 'text-destructive'
    };
  }

  // Error state overrides all styles
  if (hasError) {
    return {
      bg: 'bg-destructive/10',
      border: 'border-destructive',
      iconBg: 'bg-destructive/20',
      iconColor: 'text-destructive'
    };
  }

  // Special styles for subtypes
  if (subtype) {
    if (subtype.includes('virustotal')) {
      return { bg: 'bg-blue-500/10', border: 'border-blue-500', iconBg: 'bg-blue-500/20', iconColor: 'text-blue-500' };
    }
    if (subtype.includes('abuseipdb')) {
      return { bg: 'bg-orange-500/10', border: 'border-orange-500', iconBg: 'bg-orange-500/20', iconColor: 'text-orange-500' };
    }
    if (subtype.includes('alienvault')) {
      return { bg: 'bg-purple-500/10', border: 'border-purple-500', iconBg: 'bg-purple-500/20', iconColor: 'text-purple-500' };
    }
    if (subtype === 'block_ip' || subtype === 'disable_user' || subtype === 'kill_process' || subtype === 'isolate_host') {
      return { bg: 'bg-red-500/10', border: 'border-red-500', iconBg: 'bg-red-500/20', iconColor: 'text-red-500' };
    }
    if (subtype === 'email_smtp') {
      return { bg: 'bg-blue-400/10', border: 'border-blue-400', iconBg: 'bg-blue-400/20', iconColor: 'text-blue-400' };
    }
    if (subtype === 'slack') {
      return { bg: 'bg-purple-400/10', border: 'border-purple-400', iconBg: 'bg-purple-400/20', iconColor: 'text-purple-400' };
    }
  }

  // Default styles by step type
  switch (stepType) {
    case 'trigger':
      return { bg: 'bg-emerald-500/10', border: 'border-emerald-500', iconBg: 'bg-emerald-500/20', iconColor: 'text-emerald-500' };
    case 'enrichment':
      return { bg: 'bg-blue-500/10', border: 'border-blue-500', iconBg: 'bg-blue-500/20', iconColor: 'text-blue-500' };
    case 'condition':
      return { bg: 'bg-yellow-500/10', border: 'border-yellow-500', iconBg: 'bg-yellow-500/20', iconColor: 'text-yellow-500' };
    case 'approval':
      return { bg: 'bg-orange-500/10', border: 'border-orange-500', iconBg: 'bg-orange-500/20', iconColor: 'text-orange-500' };
    case 'action':
      return { bg: 'bg-red-500/10', border: 'border-red-500', iconBg: 'bg-red-500/20', iconColor: 'text-red-500' };
    case 'notification':
      return { bg: 'bg-purple-500/10', border: 'border-purple-500', iconBg: 'bg-purple-500/20', iconColor: 'text-purple-500' };
    case 'delay':
      return { bg: 'bg-slate-500/10', border: 'border-slate-500', iconBg: 'bg-slate-500/20', iconColor: 'text-slate-500' };
    case 'stop':
      return { bg: 'bg-gray-500/10', border: 'border-gray-500', iconBg: 'bg-gray-500/20', iconColor: 'text-gray-500' };
    case 'end':
      return { bg: 'bg-muted', border: 'border-muted-foreground', iconBg: 'bg-muted-foreground/20', iconColor: 'text-muted-foreground' };
    default:
      return { bg: 'bg-primary/10', border: 'border-primary', iconBg: 'bg-primary/20', iconColor: 'text-primary' };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEST STATUS INDICATOR
// ═══════════════════════════════════════════════════════════════════════════════

function TestStatusIndicator({ status }: { status?: TestStatus }) {
  if (!status) return null;

  return (
    <div className={cn(
      'absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center border-2 border-background',
      status === 'running' && 'bg-primary',
      status === 'success' && 'bg-emerald-500',
      status === 'error' && 'bg-destructive'
    )}>
      {status === 'running' && <Loader2 className="h-3 w-3 text-white animate-spin" />}
      {status === 'success' && <Check className="h-3 w-3 text-white" />}
      {status === 'error' && <XCircle className="h-3 w-3 text-white" />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INLINE ERROR PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface InlineErrorPanelProps {
  issues: ValidationIssue[];
}

function InlineErrorPanel({ issues }: InlineErrorPanelProps) {
  if (!issues || issues.length === 0) return null;

  const primaryIssue = issues.find(i => i.severity === 'error') || issues[0];
  const isError = primaryIssue.severity === 'error';
  const hasMultiple = issues.length > 1;

  return (
    <div
      className={cn(
        'mt-2 p-2 rounded-md border text-xs',
        isError
          ? 'bg-destructive/10 border-destructive/30'
          : 'bg-amber-500/10 border-amber-500/30'
      )}
    >
      <div className="flex items-start gap-1.5">
        {isError ? (
          <AlertOctagon className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
        ) : (
          <Info className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p className={cn('font-medium', isError ? 'text-destructive' : 'text-amber-600')}>
            {primaryIssue.message}
          </p>
          <p className="text-muted-foreground mt-0.5 leading-snug">
            {primaryIssue.remediation}
          </p>
          {hasMultiple && (
            <p className={cn('mt-1 text-[10px]', isError ? 'text-destructive/70' : 'text-amber-500/70')}>
              +{issues.length - 1} more issue{issues.length > 2 ? 's' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY ERROR PANEL (for backwards compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

interface LegacyErrorPanelProps {
  errors: string[];
}

function LegacyErrorPanel({ errors }: LegacyErrorPanelProps) {
  if (!errors || errors.length === 0) return null;

  return (
    <div className="mt-2 p-1.5 rounded bg-destructive/10 border border-destructive/20">
      <p className="text-xs text-destructive">{errors[0]}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER NODE
// ═══════════════════════════════════════════════════════════════════════════════

export const TriggerNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as PlaybookNodeData;
  const hasError = nodeData.hasGraphError || (nodeData.validationIssues?.some(i => i.severity === 'error'));
  const style = getNodeStyle('trigger', undefined, hasError, nodeData.testStatus);
  const Icon = Play;

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border-2 min-w-[180px] shadow-md transition-all relative',
        style.bg,
        style.border,
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        hasError && !nodeData.testStatus && 'animate-pulse-subtle',
        nodeData.testStatus === 'running' && 'animate-pulse'
      )}
    >
      <TestStatusIndicator status={nodeData.testStatus} />

      <div className="flex items-center gap-2">
        <div className={cn('p-1.5 rounded-md', style.iconBg)}>
          <Icon className={cn('h-4 w-4', style.iconColor)} />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trigger</p>
          <p className="text-sm font-semibold">{nodeData.label}</p>
        </div>
      </div>

      {/* Enhanced validation issues */}
      {nodeData.validationIssues && nodeData.validationIssues.length > 0 && (
        <InlineErrorPanel issues={nodeData.validationIssues} />
      )}

      {/* Legacy validation errors */}
      {!nodeData.validationIssues && nodeData.validationErrors && (
        <LegacyErrorPanel errors={nodeData.validationErrors} />
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
      />
    </div>
  );
});
TriggerNode.displayName = 'TriggerNode';

// ═══════════════════════════════════════════════════════════════════════════════
// STEP NODE (Main node type for all step types)
// ═══════════════════════════════════════════════════════════════════════════════

export const StepNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as PlaybookNodeData;
  const stepType = nodeData.stepType;
  const subtype = nodeData.subtype;
  const hasError = nodeData.hasGraphError || (nodeData.validationIssues?.some(i => i.severity === 'error'));
  const style = getNodeStyle(stepType, subtype, hasError, nodeData.testStatus);
  const Icon = getIconForStep(stepType, subtype);

  // Determine if this step type needs multiple output handles
  const isCondition = stepType === 'condition';
  const isApproval = stepType === 'approval';

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border-2 min-w-[200px] max-w-[280px] shadow-md transition-all relative',
        style.bg,
        style.border,
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        hasError && !nodeData.testStatus && 'animate-pulse-subtle',
        nodeData.testStatus === 'running' && 'animate-pulse'
      )}
    >
      <TestStatusIndicator status={nodeData.testStatus} />

      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />

      <div className="flex items-center gap-2">
        <div className={cn('p-1.5 rounded-md shrink-0', style.iconBg)}>
          <Icon className={cn('h-4 w-4', style.iconColor)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {stepType}
          </p>
          <p className="text-sm font-semibold truncate">{nodeData.label}</p>
        </div>
        {hasError && !nodeData.testStatus && (
          <AlertOctagon className="h-4 w-4 text-destructive shrink-0" />
        )}
      </div>

      {/* Enhanced validation issues */}
      {nodeData.validationIssues && nodeData.validationIssues.length > 0 && (
        <InlineErrorPanel issues={nodeData.validationIssues} />
      )}

      {/* Legacy validation errors */}
      {!nodeData.validationIssues && nodeData.validationErrors && nodeData.validationErrors.length > 0 && (
        <LegacyErrorPanel errors={nodeData.validationErrors} />
      )}

      {/* Condition step: True/False handles */}
      {isCondition && (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background !left-[25%]"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            className="!w-3 !h-3 !bg-red-500 !border-2 !border-background !left-[75%]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-2 px-4">
            <span className="text-emerald-500">True</span>
            <span className="text-red-500">False</span>
          </div>
        </>
      )}

      {/* Approval step: Approved/Rejected/Timeout handles */}
      {isApproval && (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="approved"
            className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background !left-[20%]"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="rejected"
            className="!w-3 !h-3 !bg-red-500 !border-2 !border-background !left-[50%]"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="timeout"
            className="!w-3 !h-3 !bg-amber-500 !border-2 !border-background !left-[80%]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-2 px-1">
            <span className="text-emerald-500">OK</span>
            <span className="text-red-500">No</span>
            <span className="text-amber-500">Time</span>
          </div>
        </>
      )}

      {/* Default: single output handle */}
      {!isCondition && !isApproval && (
        <Handle
          type="source"
          position={Position.Bottom}
          className={cn('!w-3 !h-3 !border-2 !border-background', style.iconBg.replace('/20', ''))}
        />
      )}
    </div>
  );
});
StepNode.displayName = 'StepNode';

// ═══════════════════════════════════════════════════════════════════════════════
// END NODE
// ═══════════════════════════════════════════════════════════════════════════════

export const EndNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as PlaybookNodeData;
  const style = getNodeStyle('end', undefined, false, nodeData.testStatus);
  const Icon = Flag;

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border-2 min-w-[120px] shadow-md transition-all relative',
        style.bg,
        style.border,
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        nodeData.testStatus === 'running' && 'animate-pulse'
      )}
    >
      <TestStatusIndicator status={nodeData.testStatus} />

      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />
      <div className="flex items-center gap-2 justify-center">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold text-muted-foreground">End</p>
      </div>
    </div>
  );
});
EndNode.displayName = 'EndNode';

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export const nodeTypes = {
  trigger: TriggerNode,
  step: StepNode,
  end: EndNode,
};
