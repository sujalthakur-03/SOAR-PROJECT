import { useState, useEffect, useCallback } from 'react';
import { X, AlertCircle, CheckCircle2, Info, Play, Loader2, ChevronDown, ChevronUp, FileText, Terminal, Database, Copy, Link, Plus, Trash2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Node } from '@xyflow/react';
import type { PlaybookNodeData } from './nodeTypes';
import { useConnectors } from '@/hooks/useConnectors';
import { usePlaybookWebhook, useCreateWebhook, useCreateTrigger } from '@/hooks/usePlaybooks';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { getStepDefinition } from './StepPalette';
import { PlaybookLogsPanel, type StepTestLog } from './PlaybookLogsPanel';
import { VariableContextExplorer } from './VariableContextExplorer';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface StepConfigPanelProps {
  node: Node | null;
  playbookId?: string;
  onClose: () => void;
  onUpdate: (nodeId: string, data: Partial<PlaybookNodeData>) => void;
  nodes?: Node[]; // For dynamic test input generation
}

interface ValidationError {
  field: string;
  message: string;
}

interface StepTestResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  duration?: number;
}

// Default test input data for simulating steps
const DEFAULT_TEST_INPUT = {
  trigger_data: {
    rule_id: "5710",
    rule_name: "SSH Authentication Failure",
    severity: "high",
    source_ip: "192.168.1.100",
    destination_ip: "10.0.0.5",
    username: "admin",
    agent_name: "web-server-01",
    agent_id: "agent-001",
    failed_attempts: 8,
    file_hash: "d41d8cd98f00b204e9800998ecf8427e",
    domain: "malicious-site.com",
    event_count: 15
  },
  vt_result: {
    malicious_votes: 7,
    total_votes: 20,
    reputation_score: 35
  },
  abuseipdb_result: {
    abuse_confidence_score: 85,
    country_code: "RU"
  },
  enrichment_result: {
    reputation_score: 75,
    is_malicious: true
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function validateStepConfig(stepType: string, subtype: string | undefined, config: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  // Common validation for connector-based steps
  if (['enrichment', 'action', 'notification'].includes(stepType)) {
    if (!config.connector_id) {
      errors.push({ field: 'connector_id', message: 'Connector is required' });
    }
  }

  // Type-specific validation
  switch (stepType) {
    case 'enrichment':
      if (!config.action) {
        errors.push({ field: 'action', message: 'Action is required' });
      }
      if (!config.observable_field) {
        errors.push({ field: 'observable_field', message: 'Observable field is required' });
      }
      break;

    case 'condition':
      if (!config.field) {
        errors.push({ field: 'field', message: 'Field to evaluate is required' });
      }
      if (!config.operator) {
        errors.push({ field: 'operator', message: 'Operator is required' });
      }
      if (config.value === undefined || config.value === '') {
        errors.push({ field: 'value', message: 'Comparison value is required' });
      }
      break;

    case 'approval':
      if (!config.approver_role) {
        errors.push({ field: 'approver_role', message: 'Approver role is required' });
      }
      if (!config.timeout_seconds || (config.timeout_seconds as number) < 60) {
        errors.push({ field: 'timeout_seconds', message: 'Timeout must be at least 60 seconds' });
      }
      break;

    case 'action':
      if (!config.action) {
        errors.push({ field: 'action', message: 'Action type is required' });
      }
      // Validate parameters for specific actions
      if (subtype === 'cybersentinel_block_ip' || config.action === 'cybersentinel_block_ip') {
        const params = config.parameters as Record<string, unknown> || {};
        if (!params.ip) {
          errors.push({ field: 'parameters.ip', message: 'No IP selected to block' });
        }
      }
      if (subtype === 'block_ip') {
        const params = config.parameters as Record<string, unknown> || {};
        if (!params.ip) {
          errors.push({ field: 'parameters.ip', message: 'IP address is required' });
        }
      }
      if (subtype === 'kill_process') {
        const params = config.parameters as Record<string, unknown> || {};
        if (!params.pid && !params.process_name) {
          errors.push({ field: 'parameters', message: 'PID or process name is required' });
        }
      }
      break;

    case 'notification':
      if (!config.channel) {
        errors.push({ field: 'channel', message: 'Notification channel is required' });
      }
      if (!config.recipients) {
        errors.push({ field: 'recipients', message: 'Recipients are required' });
      }
      break;

    case 'delay':
      if (!config.duration_seconds || (config.duration_seconds as number) < 1) {
        errors.push({ field: 'duration_seconds', message: 'Duration must be at least 1 second' });
      }
      break;
  }

  return errors;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function FieldLabel({ label, tooltip, required }: { label: string; tooltip?: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-sm">{label}{required && <span className="text-destructive">*</span>}</Label>
      {tooltip && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs text-xs">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function ValidationBadge({ errors }: { errors: ValidationError[] }) {
  if (errors.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>Valid</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-destructive">
      <AlertCircle className="h-3.5 w-3.5" />
      <span>{errors.length} error{errors.length > 1 ? 's' : ''}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

interface StepTestRunnerProps {
  stepType: string;
  subtype?: string;
  config: Record<string, unknown>;
  isValid: boolean;
  nodes?: Node[]; // For dynamic test input generation
}

function StepTestRunner({ stepType, subtype, config, isValid, nodes = [] }: StepTestRunnerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<StepTestResult | null>(null);
  const [testInput, setTestInput] = useState(JSON.stringify(DEFAULT_TEST_INPUT, null, 2));
  const [inputError, setInputError] = useState<string | null>(null);
  const [logs, setLogs] = useState<StepTestLog[]>([]);
  const [executionContext, setExecutionContext] = useState<Record<string, unknown>>({});
  const [activeTab, setActiveTab] = useState<'config' | 'logs' | 'context'>('config');

  // Reset test result when config changes
  useEffect(() => {
    setTestResult(null);
  }, [config, stepType, subtype]);

  // Helper to add log entries
  const addLog = useCallback((log: Omit<StepTestLog, 'timestamp'>) => {
    setLogs(prev => [...prev, { ...log, timestamp: Date.now() }]);
  }, []);

  const runTest = useCallback(async () => {
    // Parse input
    let parsedInput: Record<string, unknown>;
    try {
      parsedInput = JSON.parse(testInput);
      setInputError(null);
    } catch {
      setInputError('Invalid JSON format');
      return;
    }

    setIsRunning(true);
    setTestResult(null);
    setLogs([]);
    setActiveTab('logs');

    const startTime = Date.now();

    // Log test start
    addLog({
      level: 'info',
      category: 'system',
      message: `Starting ${stepType} step test...`,
    });

    // Simulate step execution based on type
    await new Promise(resolve => setTimeout(resolve, 500)); // Visual delay

    try {
      let result: StepTestResult;

      switch (stepType) {
        case 'trigger':
          addLog({
            level: 'info',
            category: 'trigger',
            message: 'Processing trigger data...',
            data: parsedInput.trigger_data,
          });
          result = {
            success: true,
            output: { trigger_data: parsedInput.trigger_data },
            duration: Date.now() - startTime
          };
          addLog({
            level: 'success',
            category: 'trigger',
            message: 'Trigger data received',
            duration: result.duration,
          });
          setExecutionContext(result.output);
          break;

        case 'enrichment': {
          const outputVar = (config.output_variable as string) || 'enrichment_result';
          const observableField = (config.observable_field as string) || 'source_ip';
          const triggerData = parsedInput.trigger_data as Record<string, unknown>;
          const inputValue = triggerData?.[observableField];

          addLog({
            level: 'info',
            category: 'enrichment',
            message: `Extracting observable: ${observableField} = ${inputValue}`,
            data: { observable_field: observableField, value: inputValue },
          });

          addLog({
            level: 'info',
            category: 'enrichment',
            message: `Calling connector: ${config.connector_id} / ${config.action}`,
          });

          // Build input parameters based on action type
          const connectorId = config.connector_id as string;
          const actionType = config.action as string;
          const testParams: Record<string, unknown> = {};

          if (actionType?.includes('ip') || observableField === 'source_ip' || observableField === 'destination_ip') {
            testParams.ip = inputValue;
            testParams.source_ip = inputValue;
          }
          if (actionType?.includes('domain') || observableField === 'domain') {
            testParams.domain = inputValue;
          }
          if (actionType?.includes('hash') || observableField === 'file_hash') {
            testParams.hash = inputValue;
            testParams.file_hash = inputValue;
          }
          if (actionType?.includes('url') || observableField === 'url') {
            testParams.url = inputValue;
          }
          testParams.observable = inputValue;

          // Call real backend connector
          let enrichmentData: Record<string, unknown>;
          try {
            addLog({
              level: 'info',
              category: 'enrichment',
              message: `Invoking real connector: ${connectorId}.${actionType}`,
              data: testParams,
            });

            const testResult = await apiClient.testConnector(connectorId, {
              action: actionType,
              parameters: testParams,
            });

            if (testResult.success && testResult.output) {
              enrichmentData = testResult.output as Record<string, unknown>;
              addLog({
                level: 'success',
                category: 'enrichment',
                message: `Real API call succeeded (${testResult.duration_ms}ms)`,
                data: enrichmentData,
              });
            } else {
              // Connector returned an error -- show it but still store partial result
              const errMsg = testResult.error || 'Unknown connector error';
              addLog({
                level: 'error',
                category: 'enrichment',
                message: `Connector error: ${errMsg}`,
                data: testResult,
              });
              enrichmentData = {
                error: errMsg,
                error_code: testResult.error_code,
                input_value: inputValue,
              };
            }
          } catch (apiError: any) {
            // Network/HTTP error -- fall back to showing the error
            addLog({
              level: 'warning',
              category: 'enrichment',
              message: `API call failed: ${apiError.message}. Check connector config.`,
            });
            enrichmentData = {
              error: apiError.message,
              input_value: inputValue,
            };
          }

          result = {
            success: !enrichmentData.error,
            output: {
              [outputVar]: enrichmentData,
              _step_info: {
                connector: connectorId,
                action: actionType,
                observable_field: observableField,
                input_value: inputValue,
              },
            },
            duration: Date.now() - startTime,
          };

          addLog({
            level: enrichmentData.error ? 'warning' : 'success',
            category: 'enrichment',
            message: enrichmentData.error
              ? `Enrichment completed with errors: ${outputVar}`
              : `Enrichment complete: ${outputVar}`,
            data: enrichmentData,
            duration: result.duration,
          });

          setExecutionContext(prev => ({ ...prev, ...result.output }));
          break;
        }

        case 'condition': {
          const field = (config.field as string) || '';
          const operator = (config.operator as string) || 'equals';
          const value = config.value;

          addLog({
            level: 'info',
            category: 'condition',
            message: `Evaluating condition: ${field} ${operator} ${value}`,
          });

          // Resolve field value from input using dot notation
          let fieldValue: unknown = parsedInput;
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
          let conditionResult = false;
          switch (operator) {
            case 'equals':
              conditionResult = fieldValue == value;
              break;
            case 'not_equals':
              conditionResult = fieldValue != value;
              break;
            case 'greater_than':
              conditionResult = Number(fieldValue) > Number(value);
              break;
            case 'less_than':
              conditionResult = Number(fieldValue) < Number(value);
              break;
            case 'greater_or_equal':
              conditionResult = Number(fieldValue) >= Number(value);
              break;
            case 'less_or_equal':
              conditionResult = Number(fieldValue) <= Number(value);
              break;
            case 'contains':
              conditionResult = String(fieldValue).includes(String(value));
              break;
            case 'not_contains':
              conditionResult = !String(fieldValue).includes(String(value));
              break;
            case 'in':
              conditionResult = String(value).split(',').map(s => s.trim()).includes(String(fieldValue));
              break;
          }

          result = {
            success: true,
            output: {
              condition_result: conditionResult,
              branch_taken: conditionResult ? 'TRUE' : 'FALSE',
              _evaluation: {
                field: field,
                field_value: fieldValue,
                operator: operator,
                compare_value: value
              }
            },
            duration: Date.now() - startTime
          };

          addLog({
            level: 'success',
            category: 'condition',
            message: `Condition evaluated to: ${conditionResult ? 'TRUE' : 'FALSE'}`,
            data: result.output,
            duration: result.duration,
          });

          setExecutionContext(prev => ({ ...prev, ...result.output }));
          break;
        }

        case 'approval':
          addLog({
            level: 'info',
            category: 'system',
            message: 'Simulating approval step (auto-approved in test mode)',
          });

          result = {
            success: true,
            output: {
              _simulated: true,
              approved: true,
              approver: 'Test User (Simulated)',
              approval_time: new Date().toISOString(),
              message: 'Auto-approved in test mode'
            },
            duration: Date.now() - startTime
          };

          addLog({
            level: 'success',
            category: 'system',
            message: 'Approval step passed (simulated)',
            duration: result.duration,
          });

          setExecutionContext(prev => ({ ...prev, ...result.output }));
          break;

        case 'action': {
          const isCyberSentinelBlock = config.action === 'cybersentinel_block_ip' || subtype === 'cybersentinel_block_ip';
          const actionParams = (config.parameters || {}) as Record<string, unknown>;

          addLog({
            level: 'info',
            category: 'action',
            message: isCyberSentinelBlock
              ? `CyberSentinel Blocklist: Blocking IP ${actionParams.ip || '(unresolved)'}...`
              : `Executing action: ${config.action}`,
            data: config.parameters,
          });

          if (isCyberSentinelBlock) {
            // Resolve IP from trigger data for preview
            let resolvedIP = String(actionParams.ip || '');
            if (resolvedIP.includes('{{trigger_data.source_ip}}')) {
              const triggerData = parsedInput.trigger_data as Record<string, unknown>;
              resolvedIP = String(triggerData?.source_ip || resolvedIP);
            }

            result = {
              success: true,
              output: {
                _simulated: true,
                ip: resolvedIP,
                blocklist: 'cybersentinel_blocked_ips',
                status: 'blocked',
                enforced_by: 'CyberSentinel Control Plane',
                timestamp: new Date().toISOString(),
                reason: String(actionParams.reason || 'Blocked by CyberSentinel playbook'),
                ttl_minutes: actionParams.ttl ? Number(actionParams.ttl) : null,
              },
              duration: Date.now() - startTime
            };

            addLog({
              level: 'success',
              category: 'action',
              message: `CyberSentinel Blocklist: IP ${resolvedIP} would be blocked (simulation)`,
              data: result.output,
              duration: result.duration,
            });

            addLog({
              level: 'info',
              category: 'action',
              message: 'Enforced by CyberSentinel Control Plane. No blocklist changes made during simulation.',
            });
          } else {
            result = {
              success: true,
              output: {
                _simulated: true,
                action_executed: true,
                action_type: config.action,
                parameters: config.parameters,
                action_id: `action-test-${Date.now()}`,
                message: 'Action would execute in production'
              },
              duration: Date.now() - startTime
            };

            addLog({
              level: 'success',
              category: 'action',
              message: `Action completed: ${config.action}`,
              data: result.output,
              duration: result.duration,
            });
          }

          setExecutionContext(prev => ({ ...prev, ...result.output }));
          break;
        }

        case 'notification':
          addLog({
            level: 'info',
            category: 'notification',
            message: `Sending notification to: ${config.recipients}`,
            data: { channel: config.channel, message: config.message },
          });

          result = {
            success: true,
            output: {
              _simulated: true,
              notification_sent: true,
              channel: config.channel,
              recipients: config.recipients,
              message_preview: config.message || 'No message template configured',
              message: 'Notification would be sent in production'
            },
            duration: Date.now() - startTime
          };

          addLog({
            level: 'success',
            category: 'notification',
            message: `Notification sent successfully`,
            duration: result.duration,
          });

          setExecutionContext(prev => ({ ...prev, ...result.output }));
          break;

        case 'delay':
          result = {
            success: true,
            output: {
              _simulated: true,
              delayed: true,
              duration_seconds: config.duration_seconds,
              message: `Would delay for ${config.duration_seconds}s in production`
            },
            duration: Date.now() - startTime
          };
          break;

        case 'stop':
          result = {
            success: true,
            output: {
              stopped: true,
              reason: config.reason || 'Execution stopped',
              message: 'Playbook execution would stop here'
            },
            duration: Date.now() - startTime
          };
          break;

        default:
          result = {
            success: true,
            output: { message: 'Step type not fully simulated' },
            duration: Date.now() - startTime
          };
      }

      setTestResult(result);
      addLog({
        level: 'success',
        category: 'system',
        message: 'Test completed successfully',
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setTestResult({
        success: false,
        error: errorMsg,
        duration: Date.now() - startTime
      });
      addLog({
        level: 'error',
        category: 'system',
        message: `Test failed: ${errorMsg}`,
        data: error,
      });
    }

    setIsRunning(false);
  }, [stepType, config, testInput, addLog]);

  // Don't show test runner for certain step types
  if (stepType === 'end') return null;

  return (
    <div className="border-t border-border mt-4 pt-4">
      <button
        type="button"
        className="flex items-center justify-between w-full text-sm font-medium hover:text-primary"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="flex items-center gap-2">
          <Play className="h-3.5 w-3.5" />
          Test This Step
        </span>
        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {isExpanded && (
        <div className="mt-3">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="config" className="text-xs">
                <FileText className="h-3 w-3 mr-1" />
                Config
              </TabsTrigger>
              <TabsTrigger value="logs" className="text-xs">
                <Terminal className="h-3 w-3 mr-1" />
                Logs {logs.length > 0 && `(${logs.length})`}
              </TabsTrigger>
              <TabsTrigger value="context" className="text-xs">
                <Database className="h-3 w-3 mr-1" />
                Context
              </TabsTrigger>
            </TabsList>

            <TabsContent value="config" className="space-y-3 mt-3">
              <div className="space-y-2">
                <Label className="text-xs">Test Input (JSON)</Label>
                <Textarea
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  className={cn(
                    'font-mono text-xs h-32 resize-none',
                    inputError && 'border-destructive'
                  )}
                  placeholder="Enter test input data..."
                  disabled={isRunning}
                />
                {inputError && (
                  <p className="text-xs text-destructive">{inputError}</p>
                )}
              </div>

              <Button
                size="sm"
                onClick={runTest}
                disabled={isRunning || !isValid}
                className="w-full"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 mr-2" />
                    Run Step Test
                  </>
                )}
              </Button>

              {!isValid && (
                <p className="text-xs text-muted-foreground text-center">
                  Fix validation errors above before testing
                </p>
              )}

              {testResult && (
                <div className={cn(
                  'p-3 rounded-lg border text-xs',
                  testResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-destructive/10 border-destructive/30'
                )}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn(
                      'font-medium',
                      testResult.success ? 'text-emerald-600' : 'text-destructive'
                    )}>
                      {testResult.success ? '✓ Test Passed' : '✗ Test Failed'}
                    </span>
                    {testResult.duration && (
                      <span className="text-muted-foreground">
                        {testResult.duration}ms
                      </span>
                    )}
                  </div>

                  {testResult.error && (
                    <p className="text-destructive">{testResult.error}</p>
                  )}

                  {testResult.output && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        View Output
                      </summary>
                      <pre className="mt-2 p-2 bg-muted rounded overflow-auto max-h-40 text-[10px]">
                        {JSON.stringify(testResult.output, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="logs" className="mt-3">
              <div className="h-[300px] border border-border rounded-lg overflow-hidden">
                <PlaybookLogsPanel logs={logs} isRunning={isRunning} />
              </div>
            </TabsContent>

            <TabsContent value="context" className="mt-3">
              <div className="h-[300px]">
                <VariableContextExplorer
                  context={executionContext}
                  onVariableSelect={(path) => {
                    // Could auto-fill selected field with this variable
                    console.log('Selected variable:', path);
                  }}
                  compact
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function StepConfigPanel({ node, playbookId, onClose, onUpdate, nodes = [] }: StepConfigPanelProps) {
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);

  if (!node) return null;

  const nodeData = node.data as PlaybookNodeData;
  const stepType = nodeData.stepType;
  const subtype = nodeData.subtype;
  const config = (nodeData.config || {}) as Record<string, unknown>;

  // Load available connectors from API
  const { data: connectorsData } = useConnectors();
  const connectors = Array.isArray(connectorsData) ? connectorsData : [];

  // Validate on config change
  useEffect(() => {
    const errors = validateStepConfig(stepType, subtype, config);
    setValidationErrors(errors);

    // Update node with validation errors for visual feedback
    onUpdate(node.id, { validationErrors: errors.map(e => e.message) });
  }, [stepType, subtype, config, node.id]);

  const handleLabelChange = (label: string) => {
    onUpdate(node.id, { label });
  };

  const handleConfigChange = (key: string, value: unknown) => {
    onUpdate(node.id, { config: { ...config, [key]: value } });
  };

  const handleParameterChange = (key: string, value: unknown) => {
    const params = (config.parameters || {}) as Record<string, unknown>;
    onUpdate(node.id, { config: { ...config, parameters: { ...params, [key]: value } } });
  };

  const getFieldError = (field: string) => {
    return validationErrors.find(e => e.field === field)?.message;
  };

  // Get step definition for additional context
  const stepDef = subtype ? getStepDefinition(subtype) : undefined;

  return (
    <div className="w-80 border-l border-border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h3 className="font-semibold text-sm">Configure Step</h3>
          <p className="text-xs text-muted-foreground capitalize">{stepType}</p>
        </div>
        <div className="flex items-center gap-2">
          <ValidationBadge errors={validationErrors} />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Step Name */}
        <div className="space-y-2">
          <FieldLabel label="Step Name" required />
          <Input
            value={nodeData.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Enter step name..."
          />
        </div>

        {/* Step-specific configuration */}
        {stepType === 'trigger' && (
          <TriggerConfig
            config={config}
            playbookId={playbookId}
            onConfigChange={handleConfigChange}
            getFieldError={getFieldError}
          />
        )}

        {stepType === 'enrichment' && (
          <EnrichmentConfig
            subtype={subtype}
            config={config}
            connectors={connectors}
            onConfigChange={handleConfigChange}
            getFieldError={getFieldError}
          />
        )}

        {stepType === 'condition' && (
          <ConditionConfig
            subtype={subtype}
            config={config}
            onConfigChange={handleConfigChange}
            getFieldError={getFieldError}
          />
        )}

        {stepType === 'action' && (
          <ActionConfig
            subtype={subtype}
            config={config}
            connectors={connectors}
            onConfigChange={handleConfigChange}
            onParameterChange={handleParameterChange}
            getFieldError={getFieldError}
          />
        )}

        {stepType === 'notification' && (
          <NotificationConfig
            subtype={subtype}
            config={config}
            connectors={connectors}
            onConfigChange={handleConfigChange}
            getFieldError={getFieldError}
          />
        )}

        {stepType === 'approval' && (
          <ApprovalConfig
            subtype={subtype}
            config={config}
            onConfigChange={handleConfigChange}
            getFieldError={getFieldError}
          />
        )}

        {stepType === 'delay' && (
          <DelayConfig
            config={config}
            onConfigChange={handleConfigChange}
            getFieldError={getFieldError}
          />
        )}

        {stepType === 'stop' && (
          <StopConfig
            config={config}
            onConfigChange={handleConfigChange}
          />
        )}

        {/* Step Test Runner */}
        <StepTestRunner
          stepType={stepType}
          subtype={subtype}
          config={config}
          isValid={validationErrors.length === 0}
          nodes={nodes}
        />
      </div>

      {/* Validation Errors Footer */}
      {validationErrors.length > 0 && (
        <div className="p-4 border-t border-border bg-destructive/5">
          <p className="text-xs font-medium text-destructive mb-2">Validation Errors:</p>
          <ul className="text-xs text-destructive space-y-1">
            {validationErrors.map((error, i) => (
              <li key={i}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────────────
// COPY-TO-CLIPBOARD HELPER (works over HTTP)
// ───────────────────────────────────────────────────────────────────────────────

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for non-secure contexts (HTTP)
  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch {
      reject(new Error('Copy failed'));
    }
    document.body.removeChild(textarea);
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// TRIGGER CONDITION TYPES
// ───────────────────────────────────────────────────────────────────────────────

interface TriggerCondition {
  field: string;
  operator: string;
  value: string;
}

function TriggerConfig({
  config,
  playbookId,
  onConfigChange,
  getFieldError
}: {
  config: Record<string, unknown>;
  playbookId?: string;
  onConfigChange: (key: string, value: unknown) => void;
  getFieldError: (field: string) => string | undefined;
}) {
  const { toast } = useToast();

  // Webhook state
  const { data: webhookData, isLoading: webhookLoading, error: webhookError } = usePlaybookWebhook(playbookId);
  const createWebhook = useCreateWebhook();
  const createTrigger = useCreateTrigger();

  // Track the freshly-created webhook URL (contains secret, only shown once)
  const [freshWebhookUrl, setFreshWebhookUrl] = useState<string | null>(null);

  // Trigger conditions local state
  const [conditions, setConditions] = useState<TriggerCondition[]>([
    { field: 'rule.id', operator: 'equals', value: '' },
  ]);
  const [matchType, setMatchType] = useState<'ALL' | 'ANY'>('ALL');
  const [conditionsInitialized, setConditionsInitialized] = useState(false);

  // Populate conditions from existing trigger data
  useEffect(() => {
    if (webhookData?.trigger?.conditions && !conditionsInitialized) {
      const existingConditions = webhookData.trigger.conditions;
      if (Array.isArray(existingConditions) && existingConditions.length > 0) {
        setConditions(existingConditions.map((c: any) => ({
          field: c.field || '',
          operator: c.operator || 'equals',
          value: c.value || '',
        })));
      }
      if (webhookData.trigger.match) {
        setMatchType(webhookData.trigger.match === 'ANY' ? 'ANY' : 'ALL');
      }
      setConditionsInitialized(true);
    }
  }, [webhookData, conditionsInitialized]);

  const webhookExists = !!(webhookData && !webhookError);

  const handleActivateWebhook = async () => {
    if (!playbookId) return;
    try {
      const result = await createWebhook.mutateAsync({ playbookId });
      const url = result.webhook_url || result.url;
      if (url) {
        setFreshWebhookUrl(url);
      }
      toast({ title: 'Webhook activated', description: 'Copy the URL below for your forwarder config.' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create webhook';
      toast({ title: 'Failed to activate webhook', description: msg, variant: 'destructive' });
    }
  };

  const handleSaveTrigger = async () => {
    if (!playbookId) return;
    const validConditions = conditions.filter(c => c.field && c.value);
    if (validConditions.length === 0) {
      toast({ title: 'No conditions to save', description: 'Add at least one condition with field and value.', variant: 'destructive' });
      return;
    }
    try {
      await createTrigger.mutateAsync({
        playbookId,
        triggerDef: {
          conditions: validConditions,
          match: matchType,
          name: `trigger-${playbookId}`,
        },
      });
      toast({ title: 'Trigger conditions saved' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to save trigger';
      toast({ title: 'Failed to save trigger', description: msg, variant: 'destructive' });
    }
  };

  const addCondition = () => {
    setConditions([...conditions, { field: '', operator: 'equals', value: '' }]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, patch: Partial<TriggerCondition>) => {
    setConditions(conditions.map((c, i) => i === index ? { ...c, ...patch } : c));
  };

  return (
    <>
      {/* ── Section A: Playbook ID ── */}
      <div className="space-y-2">
        <FieldLabel label="Playbook ID" tooltip="Unique identifier for this playbook. Use in API calls and forwarder config." />
        {playbookId ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted px-3 py-2 rounded border font-mono truncate">
              {playbookId}
            </code>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => {
                copyToClipboard(playbookId).then(
                  () => toast({ title: 'Playbook ID copied' }),
                  () => toast({ title: 'Failed to copy', variant: 'destructive' })
                );
              }}
              title="Copy Playbook ID"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">Save playbook first to get an ID</p>
        )}
      </div>

      {/* ── Existing trigger fields ── */}
      <div className="space-y-2">
        <FieldLabel label="Source" tooltip="The source system for alerts" />
        <Select
          value={(config.source as string) || 'cybersentinel'}
          onValueChange={(v) => onConfigChange('source', v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cybersentinel">CyberSentinel</SelectItem>
            <SelectItem value="elastic">Elastic SIEM</SelectItem>
            <SelectItem value="splunk">Splunk</SelectItem>
            <SelectItem value="webhook">Generic Webhook</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <FieldLabel label="Rule IDs" tooltip="Comma-separated list of rule IDs to match (leave empty for all)" />
        <Input
          value={(config.rule_ids as string) || ''}
          onChange={(e) => onConfigChange('rule_ids', e.target.value)}
          placeholder="5710, 5712, 5720"
        />
      </div>

      <div className="space-y-2">
        <FieldLabel label="Minimum Severity" tooltip="Only trigger for alerts at or above this severity" />
        <Select
          value={(config.severity_threshold as string) || 'medium'}
          onValueChange={(v) => onConfigChange('severity_threshold', v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Section B: Webhook Integration ── */}
      {playbookId && (
        <div className="space-y-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <Link className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Webhook Integration</span>
          </div>

          {webhookLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading webhook status...
            </div>
          )}

          {/* Fresh webhook URL (just created, contains secret) */}
          {freshWebhookUrl && (
            <div className="space-y-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-600">Webhook Active</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] bg-background px-2 py-1.5 rounded border font-mono break-all leading-relaxed">
                  {freshWebhookUrl}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    copyToClipboard(freshWebhookUrl).then(
                      () => toast({ title: 'Webhook URL copied' }),
                      () => toast({ title: 'Failed to copy', variant: 'destructive' })
                    );
                  }}
                  title="Copy Webhook URL"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-amber-500 font-medium">
                Copy this URL now. The secret won't be shown again.
              </p>
              <p className="text-[10px] text-muted-foreground">
                Use this URL in your forwarder's <code className="bg-muted px-1 rounded">routing_rules.yaml</code>
              </p>
            </div>
          )}

          {/* Existing webhook (masked) */}
          {!freshWebhookUrl && webhookExists && (
            <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                    Active
                  </Badge>
                  {webhookData.webhook_id && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {webhookData.webhook_id}
                    </span>
                  )}
                </div>
              </div>
              {webhookData.url && (
                <code className="block text-[10px] bg-background px-2 py-1.5 rounded border font-mono break-all text-muted-foreground">
                  {webhookData.url}
                </code>
              )}
              <p className="text-[10px] text-muted-foreground">
                Webhook is active. Secret is masked for security.
              </p>
            </div>
          )}

          {/* No webhook yet */}
          {!freshWebhookUrl && !webhookExists && !webhookLoading && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleActivateWebhook}
              disabled={createWebhook.isPending}
            >
              {createWebhook.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  Activating...
                </>
              ) : (
                <>
                  <Shield className="h-3.5 w-3.5 mr-2" />
                  Activate Webhook
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {/* ── Section C: Trigger Conditions ── */}
      {playbookId && (webhookExists || freshWebhookUrl) && (
        <div className="space-y-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Trigger Conditions</span>
            </div>
            <Select value={matchType} onValueChange={(v) => setMatchType(v as 'ALL' | 'ANY')}>
              <SelectTrigger className="w-20 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ALL</SelectItem>
                <SelectItem value="ANY">ANY</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            {conditions.map((cond, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Input
                  value={cond.field}
                  onChange={(e) => updateCondition(index, { field: e.target.value })}
                  placeholder="rule.id"
                  className="h-8 text-xs flex-1"
                />
                <Select
                  value={cond.operator}
                  onValueChange={(v) => updateCondition(index, { operator: v })}
                >
                  <SelectTrigger className="h-8 w-[90px] text-xs shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equals">equals</SelectItem>
                    <SelectItem value="contains">contains</SelectItem>
                    <SelectItem value="regex">regex</SelectItem>
                    <SelectItem value="gt">gt</SelectItem>
                    <SelectItem value="lt">lt</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={cond.value}
                  onChange={(e) => updateCondition(index, { value: e.target.value })}
                  placeholder="120000"
                  className="h-8 text-xs flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeCondition(index)}
                  disabled={conditions.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={addCondition}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Condition
          </Button>

          <Button
            size="sm"
            className="w-full"
            onClick={handleSaveTrigger}
            disabled={createTrigger.isPending}
          >
            {createTrigger.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Trigger'
            )}
          </Button>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENRICHMENT CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

function EnrichmentConfig({
  subtype,
  config,
  connectors,
  onConfigChange,
  getFieldError
}: {
  subtype?: string;
  config: Record<string, unknown>;
  connectors: any[];
  onConfigChange: (key: string, value: unknown) => void;
  getFieldError: (field: string) => string | undefined;
}) {
  // Get connector options based on subtype
  const connectorOptions = connectors.filter(c =>
    ['threat_intel', 'enrichment', 'virustotal', 'abuseipdb', 'alienvault', 'geoip', 'dns'].some(t =>
      c.type?.toLowerCase().includes(t) || c.name?.toLowerCase().includes(t)
    )
  );

  // Action options based on subtype
  const actionOptions = getEnrichmentActions(subtype);

  return (
    <>
      <div className="space-y-2">
        <FieldLabel label="Connector" tooltip="Select the enrichment connector to use" required />
        <Select
          value={(config.connector_id as string) || ''}
          onValueChange={(v) => onConfigChange('connector_id', v)}
        >
          <SelectTrigger className={getFieldError('connector_id') ? 'border-destructive' : ''}>
            <SelectValue placeholder="Select connector..." />
          </SelectTrigger>
          <SelectContent>
            {connectorOptions.length > 0 ? (
              connectorOptions.map((connector) => (
                <SelectItem key={connector.id} value={connector.id}>
                  {connector.name}
                </SelectItem>
              ))
            ) : (
              <>
                <SelectItem value="virustotal">VirusTotal</SelectItem>
                <SelectItem value="abuseipdb">AbuseIPDB</SelectItem>
                <SelectItem value="alienvault-otx">AlienVault OTX</SelectItem>
                <SelectItem value="geoip">GeoIP</SelectItem>
                <SelectItem value="dns">DNS Resolver</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
        {getFieldError('connector_id') && (
          <p className="text-xs text-destructive">{getFieldError('connector_id')}</p>
        )}
      </div>

      <div className="space-y-2">
        <FieldLabel label="Action" tooltip="The enrichment action to perform" required />
        <Select
          value={(config.action as string) || ''}
          onValueChange={(v) => onConfigChange('action', v)}
        >
          <SelectTrigger className={getFieldError('action') ? 'border-destructive' : ''}>
            <SelectValue placeholder="Select action..." />
          </SelectTrigger>
          <SelectContent>
            {actionOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {getFieldError('action') && (
          <p className="text-xs text-destructive">{getFieldError('action')}</p>
        )}
      </div>

      <div className="space-y-2">
        <FieldLabel label="Observable Field" tooltip="The field from trigger data to use as input" required />
        <Select
          value={(config.observable_field as string) || 'source_ip'}
          onValueChange={(v) => onConfigChange('observable_field', v)}
        >
          <SelectTrigger className={getFieldError('observable_field') ? 'border-destructive' : ''}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="source_ip">Source IP</SelectItem>
            <SelectItem value="destination_ip">Destination IP</SelectItem>
            <SelectItem value="file_hash">File Hash</SelectItem>
            <SelectItem value="domain">Domain</SelectItem>
            <SelectItem value="url">URL</SelectItem>
            <SelectItem value="username">Username</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <FieldLabel label="Output Variable" tooltip="Variable name to store the enrichment result" />
        <Input
          value={(config.output_variable as string) || ''}
          onChange={(e) => onConfigChange('output_variable', e.target.value)}
          placeholder="e.g., vt_result"
        />
      </div>
    </>
  );
}

function getEnrichmentActions(subtype?: string): { value: string; label: string }[] {
  if (subtype?.includes('virustotal')) {
    return [
      { value: 'lookup_ip', label: 'Lookup IP Reputation' },
      { value: 'lookup_hash', label: 'Lookup File Hash' },
      { value: 'lookup_url', label: 'Lookup URL' },
      { value: 'lookup_domain', label: 'Lookup Domain' },
    ];
  }
  if (subtype?.includes('abuseipdb')) {
    return [
      { value: 'check_ip', label: 'Check IP Reputation' },
      { value: 'report_ip', label: 'Report IP' },
    ];
  }
  if (subtype?.includes('alienvault')) {
    return [
      { value: 'lookup_ip', label: 'Lookup IP' },
      { value: 'lookup_hash', label: 'Lookup Hash' },
      { value: 'lookup_domain', label: 'Lookup Domain' },
    ];
  }
  if (subtype === 'geoip') {
    return [
      { value: 'lookup_ip', label: 'GeoIP Lookup' },
    ];
  }
  if (subtype === 'dns_reverse') {
    return [
      { value: 'reverse_lookup', label: 'Reverse DNS Lookup' },
      { value: 'forward_lookup', label: 'Forward DNS Lookup' },
    ];
  }
  return [
    { value: 'lookup_ip', label: 'Lookup IP' },
    { value: 'lookup_hash', label: 'Lookup Hash' },
    { value: 'lookup_domain', label: 'Lookup Domain' },
    { value: 'lookup_url', label: 'Lookup URL' },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

// Common fields available in trigger data
const COMMON_FIELDS = [
  { value: 'trigger_data.severity', label: 'Severity', category: 'trigger' },
  { value: 'trigger_data.rule_id', label: 'Rule ID', category: 'trigger' },
  { value: 'trigger_data.rule_name', label: 'Rule Name', category: 'trigger' },
  { value: 'trigger_data.source_ip', label: 'Source IP', category: 'trigger' },
  { value: 'trigger_data.destination_ip', label: 'Destination IP', category: 'trigger' },
  { value: 'trigger_data.username', label: 'Username', category: 'trigger' },
  { value: 'trigger_data.agent_name', label: 'Agent Name', category: 'trigger' },
  { value: 'trigger_data.failed_attempts', label: 'Failed Attempts', category: 'trigger' },
  { value: 'trigger_data.event_count', label: 'Event Count', category: 'trigger' },
  { value: 'vt_result.malicious_votes', label: 'VT Malicious Votes', category: 'enrichment' },
  { value: 'abuseipdb_result.abuse_confidence_score', label: 'AbuseIPDB Score', category: 'enrichment' },
  { value: 'enrichment_result.reputation_score', label: 'Reputation Score', category: 'enrichment' },
  { value: 'enrichment_result.is_malicious', label: 'Is Malicious', category: 'enrichment' },
  { value: 'otx_ip_result.pulse_count', label: 'OTX Pulse Count', category: 'enrichment' },
  { value: 'otx_ip_result.reputation', label: 'OTX Reputation', category: 'enrichment' },
  { value: 'otx_ip_result.confidence', label: 'OTX Confidence', category: 'enrichment' },
];

function ConditionConfig({
  subtype,
  config,
  onConfigChange,
  getFieldError
}: {
  subtype?: string;
  config: Record<string, unknown>;
  onConfigChange: (key: string, value: unknown) => void;
  getFieldError: (field: string) => string | undefined;
}) {
  const [useCustomField, setUseCustomField] = useState(false);
  const defaultField = getDefaultConditionField(subtype);
  const currentField = (config.field as string) || defaultField;

  // Check if current field is in the common fields list
  const isCustomField = currentField && !COMMON_FIELDS.some(f => f.value === currentField);

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <FieldLabel label="Field" tooltip="The field to evaluate (supports dot notation)" required />
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setUseCustomField(!useCustomField)}
          >
            {useCustomField || isCustomField ? 'Use preset' : 'Custom field'}
          </button>
        </div>

        {(useCustomField || isCustomField) ? (
          <Input
            value={currentField}
            onChange={(e) => onConfigChange('field', e.target.value)}
            placeholder="e.g., trigger_data.custom_field"
            className={getFieldError('field') ? 'border-destructive' : ''}
          />
        ) : (
          <Select
            value={currentField || '__select__'}
            onValueChange={(v) => v !== '__select__' && onConfigChange('field', v)}
          >
            <SelectTrigger className={getFieldError('field') ? 'border-destructive' : ''}>
              <SelectValue placeholder="Select a field..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__select__" disabled>Select a field...</SelectItem>
              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">Trigger Data</div>
              {COMMON_FIELDS.filter(f => f.category === 'trigger').map(f => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground mt-1">Enrichment Results</div>
              {COMMON_FIELDS.filter(f => f.category === 'enrichment').map(f => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {getFieldError('field') && (
          <p className="text-xs text-destructive">{getFieldError('field')}</p>
        )}
      </div>

      <div className="space-y-2">
        <FieldLabel label="Operator" required />
        <Select
          value={(config.operator as string) || 'equals'}
          onValueChange={(v) => onConfigChange('operator', v)}
        >
          <SelectTrigger className={getFieldError('operator') ? 'border-destructive' : ''}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="equals">Equals (==)</SelectItem>
            <SelectItem value="not_equals">Not Equals (!=)</SelectItem>
            <SelectItem value="greater_than">Greater Than (&gt;)</SelectItem>
            <SelectItem value="less_than">Less Than (&lt;)</SelectItem>
            <SelectItem value="greater_or_equal">Greater or Equal (&gt;=)</SelectItem>
            <SelectItem value="less_or_equal">Less or Equal (&lt;=)</SelectItem>
            <SelectItem value="contains">Contains</SelectItem>
            <SelectItem value="not_contains">Not Contains</SelectItem>
            <SelectItem value="regex">Regex Match</SelectItem>
            <SelectItem value="in">In List</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <FieldLabel label="Value" tooltip="The value to compare against (can be a number, string, or template like {{var}})" required />
        <Input
          value={String(config.value ?? '')}
          onChange={(e) => {
            const val = e.target.value;
            // Keep as string if it contains template syntax or letters
            if (val.includes('{{') || /[a-zA-Z]/.test(val)) {
              onConfigChange('value', val);
            } else {
              // Try to parse as number
              const num = Number(val);
              onConfigChange('value', val === '' ? '' : (isNaN(num) ? val : num));
            }
          }}
          placeholder="e.g., 5, 'critical', or {{var}}"
          className={getFieldError('value') ? 'border-destructive' : ''}
        />
        {getFieldError('value') && (
          <p className="text-xs text-destructive">{getFieldError('value')}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Use numbers for thresholds, strings for exact matches, or <code className="bg-muted px-1 rounded">{'{{variable}}'}</code> for dynamic values.
        </p>
      </div>

      {subtype === 'time_window' && (
        <div className="space-y-2">
          <FieldLabel label="Time Window (minutes)" tooltip="Time window for event counting" />
          <Input
            type="number"
            value={(config.time_window_minutes as number) || 2}
            onChange={(e) => onConfigChange('time_window_minutes', parseInt(e.target.value))}
            min={1}
            max={60}
          />
        </div>
      )}

      <div className="p-3 rounded-lg bg-muted/50 border border-border mt-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          <strong>Branching:</strong> Connect the "True" (green) and "False" (red) handles to define workflow paths.
        </p>
        <p className="text-xs text-muted-foreground">
          <strong>Tip:</strong> Use "Test Flow" to see how conditions evaluate with sample data.
        </p>
      </div>
    </>
  );
}

function getDefaultConditionField(subtype?: string): string {
  switch (subtype) {
    case 'severity_threshold': return 'severity';
    case 'match_field': return 'rule_id';
    case 'failed_attempts': return 'failed_attempts';
    case 'time_window': return 'event_count';
    case 'reputation_check': return 'enrichment.reputation_score';
    default: return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

function ActionConfig({
  subtype,
  config,
  connectors,
  onConfigChange,
  onParameterChange,
  getFieldError
}: {
  subtype?: string;
  config: Record<string, unknown>;
  connectors: any[];
  onConfigChange: (key: string, value: unknown) => void;
  onParameterChange: (key: string, value: unknown) => void;
  getFieldError: (field: string) => string | undefined;
}) {
  const params = (config.parameters || {}) as Record<string, unknown>;

  // Filter connectors based on action type
  const connectorOptions = connectors.filter(c =>
    ['firewall', 'edr', 'action', 'active-directory', 'cybersentinel', 'cybersentinel_blocklist'].some(t =>
      c.type?.toLowerCase().includes(t) || c.name?.toLowerCase().includes(t)
    )
  );

  return (
    <>
      <div className="space-y-2">
        <FieldLabel label="Connector" tooltip="Select the action connector" required />
        <Select
          value={(config.connector_id as string) || ''}
          onValueChange={(v) => onConfigChange('connector_id', v)}
        >
          <SelectTrigger className={getFieldError('connector_id') ? 'border-destructive' : ''}>
            <SelectValue placeholder="Select connector..." />
          </SelectTrigger>
          <SelectContent>
            {connectorOptions.length > 0 ? (
              connectorOptions.map((connector) => (
                <SelectItem key={connector.id} value={connector.id}>
                  {connector.name}
                </SelectItem>
              ))
            ) : (
              <>
                <SelectItem value="cybersentinel_blocklist">CyberSentinel Blocklist</SelectItem>
                <SelectItem value="firewall">Firewall</SelectItem>
                <SelectItem value="cybersentinel">CyberSentinel Agent</SelectItem>
                <SelectItem value="active-directory">Active Directory</SelectItem>
                <SelectItem value="edr">EDR</SelectItem>
                <SelectItem value="watchlist">Watchlist</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <FieldLabel label="Action" tooltip="The action to execute" required />
        <Select
          value={(config.action as string) || ''}
          onValueChange={(v) => onConfigChange('action', v)}
        >
          <SelectTrigger className={getFieldError('action') ? 'border-destructive' : ''}>
            <SelectValue placeholder="Select action..." />
          </SelectTrigger>
          <SelectContent>
            {getActionOptions(subtype).map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* CyberSentinel Block IP parameters */}
      {(subtype === 'cybersentinel_block_ip' || config.action === 'cybersentinel_block_ip') && (
        <>
          <div className="space-y-2">
            <FieldLabel label="IP Source" tooltip="Where to get the IP address to block" required />
            <Select
              value={
                (params.ip as string)?.includes('trigger_data.source_ip') ? 'trigger_source_ip' :
                (params.ip as string)?.includes('enrichment') ? 'enrichment_ip' :
                'custom'
              }
              onValueChange={(v) => {
                switch (v) {
                  case 'trigger_source_ip':
                    onParameterChange('ip', '{{trigger_data.source_ip}}');
                    break;
                  case 'enrichment_ip':
                    onParameterChange('ip', '{{enrichment_result.reputation.ip}}');
                    break;
                  case 'custom':
                    onParameterChange('ip', '');
                    break;
                }
              }}
            >
              <SelectTrigger className={getFieldError('parameters.ip') ? 'border-destructive' : ''}>
                <SelectValue placeholder="Select IP source..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trigger_source_ip">Trigger &rarr; source_ip</SelectItem>
                <SelectItem value="enrichment_ip">Enrichment &rarr; reputation.ip</SelectItem>
                <SelectItem value="custom">Custom value</SelectItem>
              </SelectContent>
            </Select>
            {getFieldError('parameters.ip') && (
              <p className="text-xs text-destructive">{getFieldError('parameters.ip')}</p>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel label="IP Address" tooltip="The resolved IP address or a {{variable}} template" required />
            <Input
              value={(params.ip as string) || ''}
              onChange={(e) => onParameterChange('ip', e.target.value)}
              placeholder="{{trigger_data.source_ip}}"
              className={getFieldError('parameters.ip') ? 'border-destructive' : ''}
            />
            {params.ip && typeof params.ip === 'string' && !params.ip.includes('{{') && (
              <p className="text-xs text-muted-foreground">
                Preview: <code className="bg-muted px-1 rounded">{params.ip}</code>
              </p>
            )}
            {params.ip && typeof params.ip === 'string' && params.ip.includes('{{') && (
              <p className="text-xs text-muted-foreground">
                Resolves at runtime from: <code className="bg-muted px-1 rounded">{params.ip}</code>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel label="Reason" tooltip="Supports {{variables}} for dynamic values" />
            <Input
              value={(params.reason as string) || 'Blocked by CyberSentinel playbook'}
              onChange={(e) => onParameterChange('reason', e.target.value)}
              placeholder="e.g., Blocked due to {{trigger_data.rule_name}}"
            />
          </div>

          <div className="space-y-2">
            <FieldLabel label="TTL (minutes)" tooltip="Time-to-live for the block. Leave empty for permanent." />
            <Input
              type="number"
              value={(params.ttl as string) || ''}
              onChange={(e) => onParameterChange('ttl', e.target.value)}
              placeholder="Empty = permanent"
              min={1}
            />
          </div>

          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 mt-2">
            <p className="text-xs text-blue-400 font-medium mb-1">CyberSentinel Blocklist</p>
            <p className="text-xs text-muted-foreground">
              Enforced by CyberSentinel Control Plane. The IP will be added to the centrally managed blocklist.
              During simulation, no blocklist changes are made.
            </p>
          </div>
        </>
      )}

      {/* Firewall Block IP parameters */}
      {(subtype === 'block_ip' || config.action === 'block_ip') && !(subtype === 'cybersentinel_block_ip' || config.action === 'cybersentinel_block_ip') && (
        <>
          <div className="space-y-2">
            <FieldLabel label="IP Address" tooltip="Use {{trigger_data.source_ip}} for dynamic value" required />
            <Input
              value={(params.ip as string) || '{{trigger_data.source_ip}}'}
              onChange={(e) => onParameterChange('ip', e.target.value)}
              placeholder="{{trigger_data.source_ip}}"
              className={getFieldError('parameters.ip') ? 'border-destructive' : ''}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel label="Duration" tooltip="How long to block the IP" />
            <Select
              value={(params.duration as string) || '24h'}
              onValueChange={(v) => onParameterChange('duration', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">1 Hour</SelectItem>
                <SelectItem value="4h">4 Hours</SelectItem>
                <SelectItem value="24h">24 Hours</SelectItem>
                <SelectItem value="7d">7 Days</SelectItem>
                <SelectItem value="30d">30 Days</SelectItem>
                <SelectItem value="permanent">Permanent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {(subtype === 'disable_user' || config.action === 'disable_user') && (
        <div className="space-y-2">
          <FieldLabel label="Username" tooltip="Use {{trigger_data.username}} for dynamic value" required />
          <Input
            value={(params.username as string) || '{{trigger_data.username}}'}
            onChange={(e) => onParameterChange('username', e.target.value)}
            placeholder="{{trigger_data.username}}"
          />
        </div>
      )}

      {(subtype === 'kill_process' || config.action === 'kill_process') && (
        <>
          <div className="space-y-2">
            <FieldLabel label="Agent ID" tooltip="The agent to execute the action on" />
            <Input
              value={(params.agent_id as string) || '{{trigger_data.agent_id}}'}
              onChange={(e) => onParameterChange('agent_id', e.target.value)}
              placeholder="{{trigger_data.agent_id}}"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel label="PID" tooltip="Process ID to terminate" />
            <Input
              value={(params.pid as string) || ''}
              onChange={(e) => onParameterChange('pid', e.target.value)}
              placeholder="Enter PID..."
            />
          </div>
          <div className="space-y-2">
            <FieldLabel label="Process Name" tooltip="Or specify process name" />
            <Input
              value={(params.process_name as string) || ''}
              onChange={(e) => onParameterChange('process_name', e.target.value)}
              placeholder="e.g., malware.exe"
            />
          </div>
        </>
      )}

      {(subtype === 'add_watchlist' || config.action === 'add_ip') && (
        <>
          <div className="space-y-2">
            <FieldLabel label="IP Address" required />
            <Input
              value={(params.ip as string) || '{{trigger_data.source_ip}}'}
              onChange={(e) => onParameterChange('ip', e.target.value)}
              placeholder="{{trigger_data.source_ip}}"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel label="Watchlist Name" />
            <Input
              value={(params.watchlist_name as string) || 'suspicious_ips'}
              onChange={(e) => onParameterChange('watchlist_name', e.target.value)}
              placeholder="suspicious_ips"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel label="TTL (hours)" tooltip="Time to live in the watchlist" />
            <Input
              type="number"
              value={(params.ttl_hours as number) || 72}
              onChange={(e) => onParameterChange('ttl_hours', parseInt(e.target.value))}
              min={1}
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <FieldLabel label="Reason" tooltip="Audit log reason for the action" />
        <Input
          value={(params.reason as string) || 'Executed by CyberSentinel playbook'}
          onChange={(e) => onParameterChange('reason', e.target.value)}
          placeholder="Action reason..."
        />
      </div>
    </>
  );
}

function getActionOptions(subtype?: string): { value: string; label: string }[] {
  switch (subtype) {
    case 'cybersentinel_block_ip':
      return [
        { value: 'cybersentinel_block_ip', label: 'Block IP (CyberSentinel Blocklist)' },
      ];
    case 'block_ip':
      return [
        { value: 'block_ip', label: 'Block IP (Firewall)' },
        { value: 'unblock_ip', label: 'Unblock IP' },
      ];
    case 'disable_user':
      return [
        { value: 'disable_user', label: 'Disable User Account' },
        { value: 'enable_user', label: 'Enable User Account' },
        { value: 'reset_password', label: 'Reset Password' },
      ];
    case 'kill_process':
      return [
        { value: 'kill_process', label: 'Kill Process' },
        { value: 'suspend_process', label: 'Suspend Process' },
      ];
    case 'add_watchlist':
      return [
        { value: 'add_ip', label: 'Add to Watchlist' },
        { value: 'remove_ip', label: 'Remove from Watchlist' },
      ];
    case 'isolate_host':
      return [
        { value: 'isolate_host', label: 'Isolate Host' },
        { value: 'unisolate_host', label: 'Remove Isolation' },
      ];
    default:
      return [
        { value: 'block_ip', label: 'Block IP' },
        { value: 'isolate_host', label: 'Isolate Host' },
        { value: 'disable_user', label: 'Disable User' },
        { value: 'kill_process', label: 'Kill Process' },
        { value: 'execute', label: 'Execute Custom' },
      ];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

function NotificationConfig({
  subtype,
  config,
  connectors,
  onConfigChange,
  getFieldError
}: {
  subtype?: string;
  config: Record<string, unknown>;
  connectors: any[];
  onConfigChange: (key: string, value: unknown) => void;
  getFieldError: (field: string) => string | undefined;
}) {
  const connectorOptions = connectors.filter(c =>
    ['email', 'smtp', 'slack', 'notification', 'webhook'].some(t =>
      c.type?.toLowerCase().includes(t) || c.name?.toLowerCase().includes(t)
    )
  );

  // Default channel based on subtype
  const defaultChannel = subtype === 'email_smtp' ? 'email' : subtype === 'slack' ? 'slack' : 'webhook';

  return (
    <>
      <div className="space-y-2">
        <FieldLabel label="Connector" required />
        <Select
          value={(config.connector_id as string) || ''}
          onValueChange={(v) => onConfigChange('connector_id', v)}
        >
          <SelectTrigger className={getFieldError('connector_id') ? 'border-destructive' : ''}>
            <SelectValue placeholder="Select connector..." />
          </SelectTrigger>
          <SelectContent>
            {connectorOptions.length > 0 ? (
              connectorOptions.map((connector) => (
                <SelectItem key={connector.id} value={connector.id}>
                  {connector.name}
                </SelectItem>
              ))
            ) : (
              <>
                <SelectItem value="smtp">SMTP Email</SelectItem>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="webhook">Custom Webhook</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <FieldLabel label="Channel" required />
        <Select
          value={(config.channel as string) || defaultChannel}
          onValueChange={(v) => onConfigChange('channel', v)}
        >
          <SelectTrigger className={getFieldError('channel') ? 'border-destructive' : ''}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="slack">Slack</SelectItem>
            <SelectItem value="webhook">Webhook</SelectItem>
            <SelectItem value="teams">Microsoft Teams</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <FieldLabel
          label="Recipients"
          tooltip={config.channel === 'slack' ? 'Slack channel (e.g., #security-alerts)' : 'Email addresses or webhook URL'}
          required
        />
        <Input
          value={(config.recipients as string) || ''}
          onChange={(e) => onConfigChange('recipients', e.target.value)}
          placeholder={config.channel === 'slack' ? '#security-alerts' : 'soc-team@example.com'}
          className={getFieldError('recipients') ? 'border-destructive' : ''}
        />
        {getFieldError('recipients') && (
          <p className="text-xs text-destructive">{getFieldError('recipients')}</p>
        )}
      </div>

      {(config.channel === 'email' || subtype === 'email_smtp') && (
        <div className="space-y-2">
          <FieldLabel label="Subject" />
          <Input
            value={(config.subject as string) || ''}
            onChange={(e) => onConfigChange('subject', e.target.value)}
            placeholder="Security Alert: {{trigger_data.rule_name}}"
          />
        </div>
      )}

      <div className="space-y-2">
        <FieldLabel label="Message Template" tooltip="Use {{field}} for dynamic values" />
        <Textarea
          value={(config.message as string) || ''}
          onChange={(e) => onConfigChange('message', e.target.value)}
          placeholder="Alert: {{trigger_data.rule_name}}&#10;Severity: {{trigger_data.severity}}&#10;Source IP: {{trigger_data.source_ip}}"
          rows={5}
          className="font-mono text-xs"
        />
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

function ApprovalConfig({
  subtype,
  config,
  onConfigChange,
  getFieldError
}: {
  subtype?: string;
  config: Record<string, unknown>;
  onConfigChange: (key: string, value: unknown) => void;
  getFieldError: (field: string) => string | undefined;
}) {
  return (
    <>
      <div className="space-y-2">
        <FieldLabel label="Approver Role" tooltip="Who can approve this step" required />
        <Select
          value={(config.approver_role as string) || 'senior_analyst'}
          onValueChange={(v) => onConfigChange('approver_role', v)}
        >
          <SelectTrigger className={getFieldError('approver_role') ? 'border-destructive' : ''}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="analyst">SOC Analyst</SelectItem>
            <SelectItem value="senior_analyst">Senior Analyst</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="manager">SOC Manager</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <FieldLabel label="Timeout (seconds)" tooltip="Time before approval times out" required />
        <Input
          type="number"
          value={(config.timeout_seconds as number) || 3600}
          onChange={(e) => onConfigChange('timeout_seconds', parseInt(e.target.value))}
          min={60}
          className={getFieldError('timeout_seconds') ? 'border-destructive' : ''}
        />
        <p className="text-xs text-muted-foreground">
          {Math.floor(((config.timeout_seconds as number) || 3600) / 60)} minutes
        </p>
      </div>

      <div className="space-y-2">
        <FieldLabel label="Approval Message" tooltip="Message shown to the approver" />
        <Textarea
          value={(config.approval_message as string) || ''}
          onChange={(e) => onConfigChange('approval_message', e.target.value)}
          placeholder="Approve action for alert {{trigger_data.rule_name}}?"
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <FieldLabel
          label="Auto-skip for Severity"
          tooltip="Automatically approve (skip) for alerts at or above this severity"
        />
        <Select
          value={(config.auto_skip_severity as string) || 'none'}
          onValueChange={(v) => onConfigChange('auto_skip_severity', v === 'none' ? null : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Never auto-skip</SelectItem>
            <SelectItem value="critical">Critical only</SelectItem>
            <SelectItem value="high">High and above</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="p-3 rounded-lg bg-muted/50 border border-border mt-4">
        <p className="text-xs text-muted-foreground">
          <strong>Note:</strong> Connect all three handles:
        </p>
        <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
          <li className="text-emerald-500">Approved - when approval is granted</li>
          <li className="text-red-500">Rejected - when approval is denied</li>
          <li className="text-amber-500">Timeout - when approval expires</li>
        </ul>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELAY CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

function DelayConfig({
  config,
  onConfigChange,
  getFieldError
}: {
  config: Record<string, unknown>;
  onConfigChange: (key: string, value: unknown) => void;
  getFieldError: (field: string) => string | undefined;
}) {
  const durationSeconds = (config.duration_seconds as number) || 60;

  return (
    <>
      <div className="space-y-2">
        <FieldLabel label="Duration (seconds)" tooltip="How long to pause execution" required />
        <Input
          type="number"
          value={durationSeconds}
          onChange={(e) => onConfigChange('duration_seconds', parseInt(e.target.value))}
          min={1}
          max={86400}
          className={getFieldError('duration_seconds') ? 'border-destructive' : ''}
        />
        {getFieldError('duration_seconds') && (
          <p className="text-xs text-destructive">{getFieldError('duration_seconds')}</p>
        )}
      </div>

      <div className="p-3 rounded-lg bg-muted/50 border border-border">
        <p className="text-xs text-muted-foreground">
          Execution will pause for{' '}
          <strong>
            {durationSeconds >= 3600
              ? `${Math.floor(durationSeconds / 3600)}h ${Math.floor((durationSeconds % 3600) / 60)}m`
              : durationSeconds >= 60
              ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
              : `${durationSeconds}s`}
          </strong>
        </p>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOP CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

function StopConfig({
  config,
  onConfigChange
}: {
  config: Record<string, unknown>;
  onConfigChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <FieldLabel label="Stop Reason" tooltip="Reason for stopping execution (for audit)" />
        <Input
          value={(config.reason as string) || 'Execution stopped by playbook logic'}
          onChange={(e) => onConfigChange('reason', e.target.value)}
          placeholder="Execution stopped..."
        />
      </div>

      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 mt-4">
        <p className="text-xs text-amber-600">
          <strong>Warning:</strong> This step will terminate the playbook execution immediately.
        </p>
      </div>
    </>
  );
}
