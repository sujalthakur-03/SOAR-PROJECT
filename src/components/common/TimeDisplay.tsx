import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface TimeAgoProps {
  date: string;
  className?: string;
  prefix?: string;
}

export function TimeAgo({ date, className, prefix }: TimeAgoProps) {
  // Defensive guard: return placeholder if date is missing or invalid
  if (!date) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  try {
    const parsedDate = new Date(date);
    // Check for Invalid Date
    if (isNaN(parsedDate.getTime())) {
      return <span className={cn('text-muted-foreground', className)}>—</span>;
    }

    const timeAgo = formatDistanceToNow(parsedDate, { addSuffix: true });

    return (
      <span className={cn('text-muted-foreground', className)}>
        {prefix && `${prefix} `}
        {timeAgo}
      </span>
    );
  } catch {
    // Catch any date parsing errors
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }
}

interface CountdownProps {
  expiresAt: string;
  className?: string;
}

export function Countdown({ expiresAt, className }: CountdownProps) {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diffMs = expiry.getTime() - now.getTime();

  if (diffMs <= 0) {
    return <span className={cn('text-status-error font-medium', className)}>Expired</span>;
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const isUrgent = diffMs < 1000 * 60 * 30; // Less than 30 minutes

  return (
    <span
      className={cn(
        'font-mono text-sm',
        isUrgent ? 'text-status-error' : 'text-status-warning',
        className
      )}
    >
      {hours}h {minutes}m remaining
    </span>
  );
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}
