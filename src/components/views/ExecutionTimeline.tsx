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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { mockExecutions } from '@/data/mockData';
import type { Execution, ExecutionStep, ExecutionState } from '@/types/soar';
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
  const [executions] = useState<Execution[]>(mockExecutions);
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(
    null
  );

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

  return (
    <div className="space-y-6">
      {/* Header */}
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
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* State Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card
          className={cn(
            'cursor-pointer transition-all',
            stateFilter === 'running' && 'ring-2 ring-status-pending'
          )}
          onClick={() =>
            setStateFilter(stateFilter === 'running' ? 'all' : 'running')
          }
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 text-status-pending animate-spin" />
              <span className="text-sm">Running</span>
            </div>
            <span className="text-2xl font-bold">{stateCounts.running}</span>
          </CardContent>
        </Card>
        <Card
          className={cn(
            'cursor-pointer transition-all',
            stateFilter === 'COMPLETED' && 'ring-2 ring-status-success'
          )}
          onClick={() =>
            setStateFilter(stateFilter === 'COMPLETED' ? 'all' : 'COMPLETED')
          }
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-status-success" />
              <span className="text-sm">Completed</span>
            </div>
            <span className="text-2xl font-bold">{stateCounts.completed}</span>
          </CardContent>
        </Card>
        <Card
          className={cn(
            'cursor-pointer transition-all',
            stateFilter === 'FAILED' && 'ring-2 ring-status-error'
          )}
          onClick={() =>
            setStateFilter(stateFilter === 'FAILED' ? 'all' : 'FAILED')
          }
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-status-error" />
              <span className="text-sm">Failed</span>
            </div>
            <span className="text-2xl font-bold">{stateCounts.failed}</span>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
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
          {filteredExecutions.length} execution
          {filteredExecutions.length !== 1 && 's'}
        </span>
      </div>

      {/* Executions Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-28">ID</TableHead>
                <TableHead>Playbook</TableHead>
                <TableHead className="w-28">Alert</TableHead>
                <TableHead className="w-36">State</TableHead>
                <TableHead className="w-20">Steps</TableHead>
                <TableHead className="w-32">Started</TableHead>
                <TableHead className="w-20 text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredExecutions.map((execution) => (
                <TableRow key={execution.id} className="table-row-interactive">
                  <TableCell>
                    <code className="text-xs">{execution.id}</code>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-sm">
                      {execution.playbook_name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {execution.alert_id}
                    </code>
                  </TableCell>
                  <TableCell>
                    <StateBadge state={execution.state} />
                  </TableCell>
                  <TableCell>
                    <StepProgress steps={execution.steps} />
                  </TableCell>
                  <TableCell>
                    <TimeAgo date={execution.started_at} className="text-xs" />
                  </TableCell>
                  <TableCell>
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setSelectedExecution(execution)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </SheetTrigger>
                      <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
                        <SheetHeader>
                          <SheetTitle className="flex items-center gap-2">
                            <code className="text-sm">{execution.id}</code>
                            <StateBadge state={execution.state} />
                          </SheetTitle>
                        </SheetHeader>
                        <ExecutionDetail execution={execution} />
                      </SheetContent>
                    </Sheet>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StepProgress({ steps }: { steps: ExecutionStep[] }) {
  const completed = steps.filter((s) => s.state === 'completed').length;
  const total = steps.length;

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {steps.map((step, i) => (
          <div
            key={i}
            className={cn('h-1.5 w-4 rounded-full', {
              'bg-status-success': step.state === 'completed',
              'bg-status-error': step.state === 'failed',
              'bg-status-pending animate-pulse': step.state === 'running',
              'bg-muted': step.state === 'pending' || step.state === 'skipped',
            })}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {completed}/{total}
      </span>
    </div>
  );
}

function ExecutionDetail({ execution }: { execution: Execution }) {
  return (
    <div className="mt-6 space-y-6">
      {/* Overview */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">
            Playbook
          </label>
          <p className="text-sm font-medium">{execution.playbook_name}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">
            Alert ID
          </label>
          <code className="text-sm">{execution.alert_id}</code>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">
            Started
          </label>
          <p className="text-sm">
            {new Date(execution.started_at).toLocaleString()}
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">
            Completed
          </label>
          <p className="text-sm">
            {execution.completed_at
              ? new Date(execution.completed_at).toLocaleString()
              : '—'}
          </p>
        </div>
      </div>

      {/* Error */}
      {execution.error && (
        <div className="bg-status-error/10 border border-status-error/20 rounded-lg p-3">
          <div className="flex items-center gap-2 text-status-error text-sm font-medium mb-1">
            <AlertTriangle className="h-4 w-4" />
            Execution Failed
          </div>
          <p className="text-sm text-status-error/80">{execution.error}</p>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-3">
        <h4 className="font-medium text-sm">Execution Timeline</h4>
        <div className="relative">
          {execution.steps.map((step, index) => {
            const Icon = stepStateIcons[step.state];
            const isLast = index === execution.steps.length - 1;

            return (
              <div key={step.step_id} className="relative flex gap-4 pb-6">
                {/* Connector Line */}
                {!isLast && (
                  <div className="absolute left-3.5 top-8 w-0.5 h-full -translate-x-1/2 bg-border" />
                )}

                {/* Icon */}
                <div
                  className={cn(
                    'flex items-center justify-center h-7 w-7 rounded-full bg-card border z-10',
                    stepStateColors[step.state]
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{step.step_name}</span>
                      <Badge variant="outline" className="text-xs capitalize">
                        {step.type}
                      </Badge>
                    </div>
                    {step.started_at && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(step.started_at).toLocaleTimeString()}
                      </span>
                    )}
                  </div>

                  {/* Error */}
                  {step.error && (
                    <p className="text-xs text-status-error bg-status-error/10 px-2 py-1 rounded">
                      {step.error}
                    </p>
                  )}

                  {/* Input/Output */}
                  {(Object.keys(step.input).length > 0 || step.output) && (
                    <div className="grid grid-cols-2 gap-2">
                      {Object.keys(step.input).length > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <FileJson className="h-3 w-3" />
                            Input
                          </div>
                          <pre className="bg-muted p-2 rounded text-[10px] font-mono overflow-x-auto">
                            {JSON.stringify(step.input, null, 2)}
                          </pre>
                        </div>
                      )}
                      {step.output && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <FileJson className="h-3 w-3" />
                            Output
                          </div>
                          <pre className="bg-muted p-2 rounded text-[10px] font-mono overflow-x-auto">
                            {JSON.stringify(step.output, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
