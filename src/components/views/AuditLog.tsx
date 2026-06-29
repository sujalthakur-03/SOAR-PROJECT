import { useMemo, useState } from 'react';
import { FileText, Loader2, RefreshCw, Filter, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useAuditLogs, AuditFilters } from '@/hooks/useAuditLogs';
import { cn } from '@/lib/utils';

// Sentinel value used in <Select> items because Radix's Select rejects an empty-string value.
// We map ALL_VALUE → undefined when building the actual filter passed to the API.
const ALL_VALUE = '__all__';

const ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'execute',
  'approve',
  'reject',
  'login',
  'logout',
  'config_change',
  'webhook_triggered',
  'secret_rotated',
];

const RESOURCE_TYPES = [
  'playbook',
  'execution',
  'approval',
  'connector',
  'user',
  'webhook',
  'system',
  'case',
  'auth',
];

type TimeRangeKey = '1h' | '24h' | '7d' | 'all';

const TIME_RANGES: Array<{ key: TimeRangeKey; label: string; ms?: number }> = [
  { key: '1h', label: 'Last 1 hour', ms: 60 * 60 * 1000 },
  { key: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'all', label: 'All time' },
];

// Lightweight type guard for entries — backend may evolve so we type loosely.
interface AuditEntry {
  id?: string;
  _id?: string;
  timestamp: string;
  actor_email?: string;
  actor_role?: string;
  actor_ip?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  resource_name?: string;
  outcome?: 'success' | 'failure' | 'partial';
  error_message?: string;
  details?: Record<string, unknown>;
}

export function AuditLog() {
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('24h');
  const [actorEmail, setActorEmail] = useState('');
  const [actionFilter, setActionFilter] = useState<string>(ALL_VALUE);
  const [resourceFilter, setResourceFilter] = useState<string>(ALL_VALUE);

  // Build the filter object that gets sent to the API. start_date is derived
  // from the time range; the rest pass through verbatim. Empty strings and the
  // sentinel ALL_VALUE collapse to omitted fields so the server doesn't try to
  // match on them.
  const filters: AuditFilters = useMemo(() => {
    const f: AuditFilters = { limit: 200 };
    const range = TIME_RANGES.find((r) => r.key === timeRange);
    if (range?.ms) {
      f.start_date = new Date(Date.now() - range.ms).toISOString();
    }
    const email = actorEmail.trim();
    if (email) f.actor_email = email;
    if (actionFilter && actionFilter !== ALL_VALUE) f.action = actionFilter;
    if (resourceFilter && resourceFilter !== ALL_VALUE) f.resource_type = resourceFilter;
    return f;
  }, [timeRange, actorEmail, actionFilter, resourceFilter]);

  const { data, isLoading, isFetching, refetch } = useAuditLogs(filters);

  // Backend returns { data: AuditEntry[], total, limit, offset }. Be defensive.
  const auditLogs: AuditEntry[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data as AuditEntry[];
    if (Array.isArray((data as { data?: unknown }).data)) {
      return (data as { data: AuditEntry[] }).data;
    }
    return [];
  }, [data]);
  const total = (data as { total?: number } | undefined)?.total ?? auditLogs.length;

  const hasFilters =
    timeRange !== '24h' ||
    actorEmail.trim() !== '' ||
    actionFilter !== ALL_VALUE ||
    resourceFilter !== ALL_VALUE;

  const clearFilters = () => {
    setTimeRange('24h');
    setActorEmail('');
    setActionFilter(ALL_VALUE);
    setResourceFilter(ALL_VALUE);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Audit Log
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Immutable record of all SOAR activities — playbook create/edit/delete, case actions,
            login/logout, webhook triggers, and more.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('h-4 w-4 mr-2', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="audit-time-range" className="text-xs">
                Time range
              </Label>
              <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRangeKey)}>
                <SelectTrigger id="audit-time-range">
                  <SelectValue placeholder="Time range" />
                </SelectTrigger>
                <SelectContent>
                  {TIME_RANGES.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-actor" className="text-xs">
                Actor (email)
              </Label>
              <Input
                id="audit-actor"
                placeholder="user@cybersentinel.local"
                value={actorEmail}
                onChange={(e) => setActorEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-action" className="text-xs">
                Action
              </Label>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger id="audit-action">
                  <SelectValue placeholder="Any action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Any action</SelectItem>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-resource" className="text-xs">
                Resource type
              </Label>
              <Select value={resourceFilter} onValueChange={setResourceFilter}>
                <SelectTrigger id="audit-resource">
                  <SelectValue placeholder="Any resource" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Any resource</SelectItem>
                  {RESOURCE_TYPES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasFilters && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Filter className="h-3 w-3" /> Filters active
              </span>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-3 w-3 mr-1" />
                Clear filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Result count */}
      <div className="text-xs text-muted-foreground">
        {isLoading ? (
          'Loading…'
        ) : (
          <>
            Showing <span className="font-medium text-foreground">{auditLogs.length}</span> of{' '}
            <span className="font-medium text-foreground">{total}</span> events
          </>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No audit logs match the current filters
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Timestamp</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead className="w-36">IP</TableHead>
                  <TableHead className="w-32">Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead className="w-24">Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.map((entry) => (
                  <TableRow key={entry.id || entry._id}>
                    <TableCell className="font-mono text-xs">
                      {new Date(entry.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{entry.actor_email || '—'}</div>
                      <div className="text-xs text-muted-foreground">{entry.actor_role || ''}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.actor_ip || '—'}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {entry.action}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {entry.resource_type && (
                          <Badge variant="outline" className="text-xs">
                            {entry.resource_type}
                          </Badge>
                        )}
                        {entry.resource_name && (
                          <span className="text-xs">{entry.resource_name}</span>
                        )}
                        {entry.resource_id && entry.resource_id !== entry.resource_name && (
                          <code className="text-xs text-muted-foreground">
                            {entry.resource_id}
                          </code>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs',
                          entry.outcome === 'success'
                            ? 'border-status-success text-status-success'
                            : entry.outcome === 'failure'
                            ? 'border-status-error text-status-error'
                            : 'border-status-warning text-status-warning'
                        )}
                      >
                        {entry.outcome || 'success'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
