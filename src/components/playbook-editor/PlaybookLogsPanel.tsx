import { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle2, Info, Loader2, Clock } from 'lucide-react';

export interface StepTestLog {
  timestamp: number;
  level: 'info' | 'success' | 'warning' | 'error' | 'debug';
  category: 'trigger' | 'enrichment' | 'condition' | 'action' | 'notification' | 'system';
  message: string;
  nodeId?: string;
  nodeName?: string;
  data?: unknown;
  duration?: number;
}

interface PlaybookLogsPanelProps {
  logs: StepTestLog[];
  isRunning?: boolean;
  className?: string;
}

/**
 * PlaybookLogsPanel Component
 *
 * Displays test execution logs in a Shuffle-like format.
 * Logs are ONLY shown during step testing, never during production execution.
 *
 * KEY FEATURES:
 * - Categorized logs (Trigger, Enrichment, Action, etc.)
 * - Timestamped entries
 * - Collapsible JSON viewer
 * - Color-coded by severity
 * - Auto-scroll to latest
 * - No polling (push-based only)
 */
export function PlaybookLogsPanel({
  logs,
  isRunning = false,
  className,
}: PlaybookLogsPanelProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  const getCategoryIcon = (category: StepTestLog['category']) => {
    switch (category) {
      case 'trigger':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'enrichment':
        return <Info className="h-3.5 w-3.5 text-blue-500" />;
      case 'action':
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
      case 'condition':
        return <Info className="h-3.5 w-3.5 text-amber-500" />;
      case 'notification':
        return <Info className="h-3.5 w-3.5 text-purple-500" />;
      case 'system':
        return <Info className="h-3.5 w-3.5 text-muted-foreground" />;
      default:
        return <Info className="h-3.5 w-3.5" />;
    }
  };

  const getCategoryColor = (category: StepTestLog['category']) => {
    switch (category) {
      case 'trigger': return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600';
      case 'enrichment': return 'bg-blue-500/10 border-blue-500/20 text-blue-600';
      case 'action': return 'bg-red-500/10 border-red-500/20 text-red-600';
      case 'condition': return 'bg-amber-500/10 border-amber-500/20 text-amber-600';
      case 'notification': return 'bg-purple-500/10 border-purple-500/20 text-purple-600';
      case 'system': return 'bg-muted border-border text-muted-foreground';
      default: return 'bg-muted border-border';
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">Test Logs</h3>
          {isRunning && (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running
            </Badge>
          )}
          {!isRunning && logs.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {logs.length} entries
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Real-time logs from step testing (test mode only)
        </p>
      </div>

      <ScrollArea className="flex-1 p-4">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <Clock className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No logs yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Run a step test to see execution logs
            </p>
          </div>
        ) : (
          <div className="space-y-2 font-mono text-xs">
            {logs.map((log, index) => (
              <div
                key={index}
                className={cn(
                  'p-3 rounded-lg border',
                  log.level === 'error' && 'bg-destructive/5 border-destructive/20 text-destructive',
                  log.level === 'success' && 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600',
                  log.level === 'warning' && 'bg-amber-500/5 border-amber-500/20 text-amber-600',
                  log.level === 'info' && 'bg-muted border-border',
                  log.level === 'debug' && 'bg-muted/50 border-border/50 text-muted-foreground'
                )}
              >
                {/* Header */}
                <div className="flex items-start gap-2 mb-1">
                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    [{formatTime(log.timestamp)}]
                  </span>
                  {getCategoryIcon(log.category)}
                  <Badge variant="outline" className={cn('text-[9px] px-1 py-0 h-4', getCategoryColor(log.category))}>
                    {log.category.toUpperCase()}
                  </Badge>
                  {log.nodeName && (
                    <span className="text-muted-foreground text-[10px]">
                      {log.nodeName}
                    </span>
                  )}
                  {log.duration !== undefined && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 ml-auto">
                      {log.duration}ms
                    </Badge>
                  )}
                </div>

                {/* Message */}
                <div className="pl-[52px]">
                  <p className="text-foreground">{log.message}</p>

                  {/* Data */}
                  {log.data && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground text-[10px]">
                        View Data
                      </summary>
                      <pre className="mt-1 p-2 bg-black/5 dark:bg-white/5 rounded overflow-auto max-h-40 text-[9px] leading-relaxed">
                        {JSON.stringify(log.data, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Footer with summary */}
      {logs.length > 0 && (
        <div className="p-3 border-t border-border bg-muted/30">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{logs.filter(l => l.level === 'success').length} success</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-destructive" />
              <span>{logs.filter(l => l.level === 'error').length} errors</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span>{logs.filter(l => l.level === 'warning').length} warnings</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
