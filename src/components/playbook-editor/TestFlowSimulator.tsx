import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Play, Pause, SkipForward, RotateCcw, ChevronRight, Check, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api-client';
import type { Node, Edge } from '@xyflow/react';
import type { PlaybookNodeData } from './nodeTypes';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface TestFlowSimulatorProps {
  nodes: Node[];
  edges: Edge[];
  playbookId?: string; // Playbook ID for creating execution
  onNodeHighlight: (nodeId: string | null, status: 'running' | 'success' | 'error' | 'pending' | null) => void;
  onClose: () => void;
  onValidationComplete: () => void;
}

interface SimulationStep {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  timestamp?: number;
  duration?: number;
}

interface LogEntry {
  timestamp: number;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  nodeId?: string;
  data?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAMPLE TRIGGER DATA
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_TRIGGER_DATA = {
  rule_id: "5710",
  rule_name: "SSH Authentication Failure",
  severity: "high",
  source_ip: "192.168.1.100",
  destination_ip: "10.0.0.5",
  username: "admin",
  agent_name: "web-server-01",
  agent_id: "agent-001",
  failed_attempts: 8,
  timestamp: new Date().toISOString(),
  file_hash: "d41d8cd98f00b204e9800998ecf8427e",
  domain: "malicious-site.com",
  url: "http://malicious-site.com/payload",
  process_name: "suspicious.exe",
  pid: 1234,
  event_count: 15
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function TestFlowSimulator({
  nodes,
  edges,
  playbookId,
  onNodeHighlight,
  onClose,
  onValidationComplete
}: TestFlowSimulatorProps) {
  const { toast } = useToast();
  const [triggerData, setTriggerData] = useState(JSON.stringify(DEFAULT_TRIGGER_DATA, null, 2));
  const [triggerDataError, setTriggerDataError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [steps, setSteps] = useState<SimulationStep[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [executionContext, setExecutionContext] = useState<Record<string, unknown>>({});
  const [simulationComplete, setSimulationComplete] = useState(false);
  const [hasErrors, setHasErrors] = useState(false);
  const [createdExecutionId, setCreatedExecutionId] = useState<string | null>(null);

  const pauseRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of logs when new entries appear
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Build execution order from graph
  const buildExecutionOrder = useCallback(() => {
    const executionSteps: SimulationStep[] = [];
    const visited = new Set<string>();

    // Find trigger node
    const triggerNode = nodes.find(n => (n.data as PlaybookNodeData).stepType === 'trigger');
    if (!triggerNode) return [];

    // BFS to build execution order
    const queue: { nodeId: string; branch?: string }[] = [{ nodeId: triggerNode.id }];

    while (queue.length > 0) {
      const { nodeId } = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = nodes.find(n => n.id === nodeId);
      if (!node) continue;

      const data = node.data as PlaybookNodeData;

      // Add to execution steps (except end nodes)
      if (data.stepType !== 'end') {
        executionSteps.push({
          nodeId: node.id,
          nodeName: data.label,
          nodeType: data.stepType,
          status: 'pending'
        });
      }

      // Find outgoing edges and add targets to queue
      const outgoingEdges = edges.filter(e => e.source === nodeId);
      outgoingEdges.forEach(edge => {
        if (!visited.has(edge.target)) {
          queue.push({ nodeId: edge.target, branch: edge.sourceHandle || undefined });
        }
      });
    }

    return executionSteps;
  }, [nodes, edges]);

  // Initialize steps when component mounts
  useEffect(() => {
    setSteps(buildExecutionOrder());
  }, [buildExecutionOrder]);

  // Add log entry
  const addLog = useCallback((level: LogEntry['level'], message: string, nodeId?: string, data?: unknown) => {
    setLogs(prev => [...prev, {
      timestamp: Date.now(),
      level,
      message,
      nodeId,
      data
    }]);
  }, []);

  // Simulate a single step
  const simulateStep = useCallback(async (step: SimulationStep, context: Record<string, unknown>): Promise<{
    success: boolean;
    output?: Record<string, unknown>;
    error?: string;
    nextBranch?: string;
  }> => {
    const node = nodes.find(n => n.id === step.nodeId);
    if (!node) return { success: false, error: 'Node not found' };

    const data = node.data as PlaybookNodeData;
    const config = (data.config || {}) as Record<string, unknown>;

    // Simulate based on step type
    switch (data.stepType) {
      case 'trigger':
        return {
          success: true,
          output: { trigger_data: context.trigger_data }
        };

      case 'enrichment': {
        // Simulate enrichment with mock data
        const observableField = config.observable_field as string || 'source_ip';
        const outputVar = config.output_variable as string || 'enrichment_result';

        // Generate mock enrichment result
        const mockResult = {
          malicious_votes: Math.floor(Math.random() * 10),
          total_votes: 20,
          abuse_confidence_score: Math.floor(Math.random() * 100),
          country_code: 'RU',
          isp: 'Unknown ISP',
          reputation_score: Math.floor(Math.random() * 100)
        };

        return {
          success: true,
          output: { [outputVar]: mockResult }
        };
      }

      case 'condition': {
        const field = config.field as string || '';
        const operator = config.operator as string || 'equals';
        const value = config.value;

        // Resolve field value from context using dot notation
        let fieldValue: unknown = context;
        const fieldParts = field.split('.');
        for (const part of fieldParts) {
          if (fieldValue && typeof fieldValue === 'object') {
            fieldValue = (fieldValue as Record<string, unknown>)[part];
          } else {
            fieldValue = undefined;
            break;
          }
        }

        // Evaluate condition
        let result = false;
        switch (operator) {
          case 'equals':
            result = fieldValue == value;
            break;
          case 'not_equals':
            result = fieldValue != value;
            break;
          case 'greater_than':
            result = Number(fieldValue) > Number(value);
            break;
          case 'less_than':
            result = Number(fieldValue) < Number(value);
            break;
          case 'greater_or_equal':
            result = Number(fieldValue) >= Number(value);
            break;
          case 'less_or_equal':
            result = Number(fieldValue) <= Number(value);
            break;
          case 'contains':
            result = String(fieldValue).includes(String(value));
            break;
        }

        return {
          success: true,
          output: { condition_result: result, field_value: fieldValue },
          nextBranch: result ? 'true' : 'false'
        };
      }

      case 'approval':
        // Simulate auto-approval for testing
        return {
          success: true,
          output: { approved: true, approver: 'Test User' },
          nextBranch: 'approved'
        };

      case 'action':
        // Simulate action execution
        return {
          success: true,
          output: { action_executed: true, action_id: `action-${Date.now()}` }
        };

      case 'notification':
        // Simulate notification
        return {
          success: true,
          output: { notification_sent: true, recipients: config.recipients }
        };

      case 'delay':
        // Don't actually wait, just simulate
        return {
          success: true,
          output: { delayed: true, duration_seconds: config.duration_seconds }
        };

      case 'stop':
        return {
          success: true,
          output: { stopped: true, reason: config.reason }
        };

      default:
        return { success: true, output: {} };
    }
  }, [nodes]);

  // Run simulation - Creates REAL execution in backend
  const runSimulation = useCallback(async () => {
    // Validate playbook ID
    if (!playbookId) {
      toast({
        title: 'Cannot simulate',
        description: 'Playbook must be saved before simulation',
        variant: 'destructive',
      });
      return;
    }

    // Parse trigger data
    let parsedTriggerData: Record<string, unknown>;
    try {
      parsedTriggerData = JSON.parse(triggerData);
      setTriggerDataError(null);
    } catch (e) {
      setTriggerDataError('Invalid JSON format');
      return;
    }

    setIsRunning(true);
    setSimulationComplete(false);
    setHasErrors(false);
    setLogs([]);
    setCreatedExecutionId(null);
    pauseRef.current = false;

    addLog('info', 'Creating real execution in backend...', undefined, parsedTriggerData);

    try {
      // Create REAL execution via backend API
      const execution = await apiClient.createExecution({
        playbook_id: playbookId,
        trigger_data: parsedTriggerData,
        trigger_source: 'simulation',
      });

      setCreatedExecutionId(execution.execution_id);

      addLog('success', `Execution created: ${execution.execution_id}`, undefined, {
        execution_id: execution.execution_id,
        state: execution.state,
      });

      addLog('info', 'Execution is now running in the backend');
      addLog('info', 'View it in Live Executions dashboard for real-time updates');

      toast({
        title: 'Simulation Started',
        description: `Execution ${execution.execution_id} created. Check Live Executions for progress.`,
      });

      setSimulationComplete(true);
      setHasErrors(false);

      // Trigger validation callback
      onValidationComplete();
    } catch (error: any) {
      addLog('error', `Failed to create execution: ${error.message}`, undefined, error);
      setHasErrors(true);
      setSimulationComplete(true);

      toast({
        title: 'Simulation Failed',
        description: error.message || 'Failed to create execution',
        variant: 'destructive',
      });
    } finally {
      setIsRunning(false);
    }
  }, [triggerData, playbookId, addLog, onValidationComplete, toast]);

  // Pause/Resume
  const togglePause = useCallback(() => {
    pauseRef.current = !pauseRef.current;
    setIsPaused(pauseRef.current);
  }, []);

  // Reset simulation
  const resetSimulation = useCallback(() => {
    setIsRunning(false);
    setIsPaused(false);
    setSimulationComplete(false);
    setHasErrors(false);
    setCurrentStepIndex(-1);
    setLogs([]);
    setSteps(buildExecutionOrder());
    onNodeHighlight(null, null);
    pauseRef.current = false;
  }, [buildExecutionOrder, onNodeHighlight]);

  // Format timestamp
  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">Test Playbook Execution</h2>
            <p className="text-sm text-muted-foreground">
              Create a real execution with test data - visible in Live Executions dashboard
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left Panel - Trigger Data & Controls */}
          <div className="w-80 border-r flex flex-col">
            <div className="p-4 border-b">
              <Label className="text-sm font-medium">Trigger Data (JSON)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Edit the sample alert data to test different scenarios
              </p>
              <Textarea
                value={triggerData}
                onChange={(e) => setTriggerData(e.target.value)}
                className={cn(
                  'font-mono text-xs h-48 resize-none',
                  triggerDataError && 'border-destructive'
                )}
                disabled={isRunning}
              />
              {triggerDataError && (
                <p className="text-xs text-destructive mt-1">{triggerDataError}</p>
              )}
            </div>

            <div className="p-4 border-b">
              <Label className="text-sm font-medium mb-2 block">Available Fields</Label>
              <div className="text-xs text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                {Object.keys(DEFAULT_TRIGGER_DATA).map(key => (
                  <div key={key} className="flex items-center gap-2">
                    <code className="text-primary">trigger_data.{key}</code>
                  </div>
                ))}
              </div>
            </div>

            {/* Controls */}
            <div className="p-4 space-y-2">
              <div className="flex gap-2">
                <Button
                  onClick={runSimulation}
                  disabled={isRunning || !playbookId}
                  className="flex-1"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      {simulationComplete ? 'Run Again' : 'Create Execution'}
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={resetSimulation} disabled={isRunning}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>

              {simulationComplete && createdExecutionId && (
                <div className="p-3 rounded border bg-emerald-500/10 border-emerald-500/20 text-emerald-600 text-xs">
                  <p className="font-medium mb-1">Execution Created</p>
                  <p className="font-mono text-[10px]">{createdExecutionId}</p>
                  <p className="mt-1 text-emerald-600/80">Check Live Executions for real-time progress</p>
                </div>
              )}
              {simulationComplete && hasErrors && (
                <div className="p-2 rounded text-sm text-center bg-destructive/10 text-destructive">
                  Failed to create execution
                </div>
              )}
            </div>

            {/* Info Panel */}
            <div className="flex-1 overflow-y-auto p-4 border-t">
              <Label className="text-sm font-medium mb-2 block">How This Works</Label>
              <div className="space-y-3 text-xs text-muted-foreground">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-primary">1</span>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Real Execution</p>
                    <p>Creates actual execution in backend, not mock simulation</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-primary">2</span>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Live Processing</p>
                    <p>Execution runs through real connectors and steps</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-primary">3</span>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">View Progress</p>
                    <p>Check Live Executions dashboard for real-time updates</p>
                  </div>
                </div>
              </div>

              {!playbookId && (
                <div className="mt-4 p-3 rounded border bg-amber-500/10 border-amber-500/20 text-amber-600 text-xs">
                  <p className="font-medium">Save playbook first</p>
                  <p className="mt-1">Playbook must be saved before you can test it</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Logs */}
          <div className="flex-1 flex flex-col">
            <div className="p-4 border-b">
              <h3 className="font-medium">Execution Logs</h3>
              <p className="text-xs text-muted-foreground">
                Real-time logs showing data flow through each step
              </p>
            </div>
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-2 font-mono text-xs">
                {logs.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    Click "Create Execution" to start a real backend execution
                  </p>
                ) : (
                  logs.map((log, index) => (
                    <div
                      key={index}
                      className={cn(
                        'p-2 rounded border',
                        log.level === 'error' && 'bg-destructive/5 border-destructive/20 text-destructive',
                        log.level === 'success' && 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600',
                        log.level === 'warning' && 'bg-amber-500/5 border-amber-500/20 text-amber-600',
                        log.level === 'info' && 'bg-muted border-border'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground shrink-0">
                          [{formatTime(log.timestamp)}]
                        </span>
                        <span className="flex-1">{log.message}</span>
                      </div>
                      {log.data && (
                        <pre className="mt-1 text-[10px] text-muted-foreground overflow-x-auto">
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </ScrollArea>

            {/* Context Preview */}
            {Object.keys(executionContext).length > 0 && (
              <div className="border-t p-4">
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium mb-2">
                    Execution Context ({Object.keys(executionContext).length} variables)
                  </summary>
                  <pre className="bg-muted p-2 rounded overflow-auto max-h-32 text-[10px]">
                    {JSON.stringify(executionContext, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
