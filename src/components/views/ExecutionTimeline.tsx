import { useState } from 'react';
import {
  Radio,
  RefreshCw,
  Eye,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  FileJson,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { StateBadge } from '@/components/common/StatusBadges';
import { TimeAgo } from '@/components/common/TimeDisplay';
import { useExecutions, type Execution } from '@/hooks/useExecutions';
import { cn } from '@/lib/utils';

const stepStateIcons = {
  pending: Clock,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: ChevronRight,
};

const stepStateColors = {
  pending: 'text-muted-foreground',
  running: 'text-status-pending animate-spin',
  completed: 'text-status-success',
  failed: 'text-status-error',
  skipped: 'text-muted-foreground',
};

export function ExecutionTimeline() {
  const { data: executions = [], isLoading, refetch } = useExecutions();
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);

  const filteredExecutions = executions.filter((exe) => {
    if (stateFilter !== 'all' && exe.state !== stateFilter) return false;
    return true;
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
            Monitor real-time and historical playbook runs
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
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className={cn('cursor-pointer transition-all', stateFilter === 'running' && 'ring-2 ring-status-pending')} onClick={() => setStateFilter(stateFilter === 'running' ? 'all' : 'running')}>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 text-status-pending animate-spin" />
              <span className="text-sm">Running</span>
            </div>
            <span className="text-2xl font-bold">{stateCounts.running}</span>
          </CardContent>
        </Card>
        <Card className={cn('cursor-pointer transition-all', stateFilter === 'COMPLETED' && 'ring-2 ring-status-success')} onClick={() => setStateFilter(stateFilter === 'COMPLETED' ? 'all' : 'COMPLETED')}>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-status-success" />
              <span className="text-sm">Completed</span>
            </div>
            <span className="text-2xl font-bold">{stateCounts.completed}</span>
          </CardContent>
        </Card>
        <Card className={cn('cursor-pointer transition-all', stateFilter === 'FAILED' && 'ring-2 ring-status-error')} onClick={() => setStateFilter(stateFilter === 'FAILED' ? 'all' : 'FAILED')}>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-status-error" />
              <span className="text-sm">Failed</span>
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
                  <TableHead className="w-20 text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExecutions.map((execution) => (
                  <TableRow key={execution.id} className="table-row-interactive">
                    <TableCell><code className="text-xs">{execution.executionId}</code></TableCell>
                    <TableCell><span className="font-medium text-sm">{execution.playbookName}</span></TableCell>
                    <TableCell><StateBadge state={execution.state} /></TableCell>
                    <TableCell><TimeAgo date={execution.startedAt} className="text-xs" /></TableCell>
                    <TableCell>
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedExecution(execution)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </SheetTrigger>
                        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
                          <SheetHeader>
                            <SheetTitle className="flex items-center gap-2">
                              <code className="text-sm">{execution.executionId}</code>
                              <StateBadge state={execution.state} />
                            </SheetTitle>
                          </SheetHeader>
                          <div className="mt-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div><label className="text-xs text-muted-foreground">Playbook</label><p className="text-sm font-medium">{execution.playbookName}</p></div>
                              <div><label className="text-xs text-muted-foreground">Started</label><p className="text-sm">{new Date(execution.startedAt).toLocaleString()}</p></div>
                            </div>
                            {execution.error && (
                              <div className="bg-status-error/10 border border-status-error/20 rounded-lg p-3">
                                <div className="flex items-center gap-2 text-status-error text-sm font-medium"><AlertTriangle className="h-4 w-4" />Failed</div>
                                <p className="text-sm text-status-error/80 mt-1">{execution.error}</p>
                              </div>
                            )}
                          </div>
                        </SheetContent>
                      </Sheet>
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
