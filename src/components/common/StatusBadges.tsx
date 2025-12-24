import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { Severity, ExecutionState, ConnectorStatus } from '@/types/soar';

const severityBadgeVariants = cva(
  'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide',
  {
    variants: {
      severity: {
        critical: 'severity-critical',
        high: 'severity-high',
        medium: 'severity-medium',
        low: 'severity-low',
        info: 'severity-info',
      },
    },
    defaultVariants: {
      severity: 'info',
    },
  }
);

interface SeverityBadgeProps extends VariantProps<typeof severityBadgeVariants> {
  severity: Severity;
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <span className={cn(severityBadgeVariants({ severity }), className)}>
      {severity}
    </span>
  );
}

const stateBadgeVariants = cva(
  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium',
  {
    variants: {
      state: {
        CREATED: 'bg-muted text-muted-foreground',
        ENRICHING: 'bg-status-pending/15 text-status-pending',
        WAITING_APPROVAL: 'bg-status-warning/15 text-status-warning',
        EXECUTING: 'bg-status-running/15 text-status-running',
        COMPLETED: 'bg-status-success/15 text-status-success',
        FAILED: 'bg-status-error/15 text-status-error',
      },
    },
    defaultVariants: {
      state: 'CREATED',
    },
  }
);

interface StateBadgeProps {
  state: ExecutionState;
  className?: string;
}

export function StateBadge({ state, className }: StateBadgeProps) {
  const isRunning = ['ENRICHING', 'EXECUTING', 'WAITING_APPROVAL'].includes(state);

  return (
    <span className={cn(stateBadgeVariants({ state }), className)}>
      {isRunning && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
        </span>
      )}
      {state.replace('_', ' ')}
    </span>
  );
}

const connectorStatusVariants = cva(
  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium',
  {
    variants: {
      status: {
        healthy: 'bg-status-success/15 text-status-success',
        degraded: 'bg-status-warning/15 text-status-warning',
        error: 'bg-status-error/15 text-status-error',
        disabled: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      status: 'disabled',
    },
  }
);

interface ConnectorStatusBadgeProps {
  status: ConnectorStatus;
  className?: string;
}

export function ConnectorStatusBadge({ status, className }: ConnectorStatusBadgeProps) {
  return (
    <span className={cn(connectorStatusVariants({ status }), className)}>
      <span
        className={cn('h-1.5 w-1.5 rounded-full', {
          'bg-status-success': status === 'healthy',
          'bg-status-warning': status === 'degraded',
          'bg-status-error': status === 'error',
          'bg-muted-foreground': status === 'disabled',
        })}
      />
      {status}
    </span>
  );
}
