import { useState, useCallback, useRef, useMemo } from 'react';
import { ReactFlowProvider, type Node, type Edge } from '@xyflow/react';
import { X, Save, FlaskConical, Play, AlertCircle, CheckCircle2, Code, AlertOctagon, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlaybookCanvas, type PlaybookCanvasRef } from './PlaybookCanvas';
import type { PlaybookNodeData } from './nodeTypes';
import type { Playbook } from '@/hooks/usePlaybooks';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { GraphValidationResult, ValidationIssue } from './PlaybookValidator';
import { TestFlowSimulator } from './TestFlowSimulator';
import { cn } from '@/lib/utils';

interface PlaybookSaveData {
  playbook_id?: string;  // Present when editing, absent when creating
  name: string;
  description: string;
  trigger: Record<string, unknown>;
  steps: Record<string, unknown>[];
  ui_end_position?: { x: number; y: number };  // Position of the End node, if one exists
}

interface VisualPlaybookEditorProps {
  playbook?: Playbook | null;
  onSave: (data: PlaybookSaveData) => void;
  onClose: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DSL CONVERSION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

// Branch fields: SAVE shape is always string[] (canonical, decided 2026-06).
// READ shape may be string (legacy single-target) OR string[]. The
// convertDSLToNodes loader normalizes via toTargetArray() before use.
type BranchTargets = string | string[];

interface DSLStep {
  step_id: string;
  type: string;
  name: string;
  connector_id?: string;
  action_type?: string;
  parameters?: Record<string, unknown>;
  condition?: {
    field: string;
    operator: string;
    value: unknown;
    time_window_minutes?: number;
  };
  on_true?: BranchTargets;
  on_false?: BranchTargets;
  on_success?: BranchTargets;
  on_failure?: string;
  approvers?: string[];
  timeout_hours?: number;
  on_approved?: BranchTargets;
  on_rejected?: BranchTargets;
  on_timeout?: BranchTargets;
  channel?: string;
  recipients?: string | string[];
  message?: string;
  subject?: string;
  duration_seconds?: number;
  on_complete?: BranchTargets;
  auto_skip_severity?: string;
  reason?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Coerce a branch field to string[]. Legacy single-string and empty values
 *  both normalize cleanly. Used everywhere the canvas reads a DSL field. */
function toTargetArray(field: BranchTargets | undefined | null): string[] {
  if (field == null || field === '') return [];
  if (Array.isArray(field)) return field.filter((t): t is string => typeof t === 'string' && t !== '');
  if (typeof field === 'string') return [field];
  return [];
}

/**
 * Map notification channel to backend action_type.
 * Backend validates action_type on all connector steps (enrichment, action, notification).
 * This mapping is internal — never exposed in UI.
 */
const NOTIFICATION_CHANNEL_TO_ACTION_TYPE: Record<string, string> = {
  email: 'send_email',
  slack: 'slack',
  webhook: 'webhook',
  teams: 'teams',
  pagerduty: 'pagerduty',
};

function deriveNotificationActionType(channel: string): string {
  return NOTIFICATION_CHANNEL_TO_ACTION_TYPE[channel] || channel || 'email';
}

function convertNodesToDSL(
  nodes: Node[],
  edges: Edge[]
): { trigger: Record<string, unknown>; steps: DSLStep[]; ui_end_position?: { x: number; y: number } } {
  const triggerNode = nodes.find((n) => (n.data as PlaybookNodeData).stepType === 'trigger');
  const triggerData = triggerNode?.data as PlaybookNodeData | undefined;
  const trigger = { ...((triggerData?.config as Record<string, unknown>) || {}) };
  // Persist trigger node's canvas position so layout survives save → reload.
  if (triggerNode) {
    trigger.ui_position = { x: triggerNode.position.x, y: triggerNode.position.y };
  }

  // Locate the End node (if any) and capture its position separately.
  const endNode = nodes.find((n) => (n.data as PlaybookNodeData).stepType === 'end');
  const ui_end_position = endNode
    ? { x: endNode.position.x, y: endNode.position.y }
    : undefined;

  const stepNodes = nodes.filter((n) => {
    const nodeData = n.data as PlaybookNodeData;
    return nodeData.stepType !== 'trigger' && nodeData.stepType !== 'end';
  });

  const edgeMap = new Map<string, { target: string; sourceHandle?: string | null }[]>();
  edges.forEach((edge) => {
    const existing = edgeMap.get(edge.source) || [];
    existing.push({ target: edge.target, sourceHandle: edge.sourceHandle });
    edgeMap.set(edge.source, existing);
  });

  // Capture the trigger's outgoing edges as entry points into the step graph.
  // Without this, the load side has no way to know which step(s) the trigger
  // connects to, and falls back to "first step in array" — losing all
  // user-drawn trigger→step connections after save→reload.
  // Stored at trigger.next_steps as string[] of step_ids (same wire format as
  // step.on_success arrays for consistency).
  if (triggerNode) {
    const triggerOutgoing = edgeMap.get(triggerNode.id) || [];
    const stepIdSet = new Set(stepNodes.map((n) => n.id));
    const triggerTargets = triggerOutgoing
      .map((e) => e.target)
      .filter((t) => stepIdSet.has(t));   // only keep edges to step nodes
    trigger.next_steps = triggerTargets;
  }

  const endNodeIds = new Set(
    nodes
      .filter((n) => (n.data as PlaybookNodeData).stepType === 'end')
      .map((n) => n.id)
  );

  const steps: DSLStep[] = stepNodes.map((node) => {
    const nodeData = node.data as PlaybookNodeData;
    const config = (nodeData.config as Record<string, unknown>) || {};
    const outgoingEdges = edgeMap.get(node.id) || [];

    // Resolve a single React Flow target id → DSL step_id (or '__END__').
    const resolveTarget = (targetId: string | undefined): string | null => {
      if (!targetId) return null;
      if (endNodeIds.has(targetId)) return '__END__';
      return targetId;
    };

    // Collect ALL outgoing edges that match a given sourceHandle into a
    // string[] of resolved DSL targets. Multi-parent → multi-child fan-out is
    // a first-class DSL shape (chosen 2026-06: "Always array"). Single-child
    // playbooks just have length-1 arrays — engine + validator accept both
    // string and array for backward-compat with legacy data.
    const collectTargets = (matcher: (handle: string | null | undefined) => boolean): string[] => {
      return outgoingEdges
        .filter((e) => matcher(e.sourceHandle))
        .map((e) => resolveTarget(e.target))
        .filter((t): t is string => t !== null);
    };
    const successMatcher = (h: string | null | undefined) => !h || h === 'success';

    const step: DSLStep = {
      step_id: node.id,
      type: nodeData.stepType,
      name: nodeData.label,
      // Persist canvas position so layout survives save → reload.
      ui_position: { x: node.position.x, y: node.position.y },
    };

    switch (nodeData.stepType) {
      case 'enrichment': {
        step.connector_id = (config.connector_id as string) || (config.connector as string) || '';
        step.action_type = (config.action as string) || 'lookup';
        step.parameters = {
          observable_field: config.observable_field || 'source_ip',
          output_variable: config.output_variable || 'enrichment_result',
        };
        step.on_success = collectTargets(successMatcher);
        step.on_failure = 'continue';
        break;
      }

      case 'condition': {
        step.condition = {
          field: (config.field as string) || '',
          operator: (config.operator as string) || 'equals',
          value: config.value ?? '',
        };
        if (config.time_window_minutes) {
          step.condition.time_window_minutes = config.time_window_minutes as number;
        }
        const trueTargets = collectTargets((h) => h === 'true');
        const falseTargets = collectTargets((h) => h === 'false');
        step.on_true = trueTargets.length > 0 ? trueTargets : ['__END__'];
        step.on_false = falseTargets.length > 0 ? falseTargets : ['__END__'];
        break;
      }

      case 'approval': {
        step.approvers = [config.approver_role as string || 'senior_analyst'];
        step.timeout_hours = Math.ceil(((config.timeout_seconds as number) || 3600) / 3600);
        step.message = (config.approval_message as string) || '';
        if (config.auto_skip_severity) {
          step.auto_skip_severity = config.auto_skip_severity as string;
        }
        const approvedTargets = collectTargets((h) => h === 'approved');
        const rejectedTargets = collectTargets((h) => h === 'rejected');
        const timeoutTargets = collectTargets((h) => h === 'timeout');
        step.on_approved = approvedTargets.length > 0 ? approvedTargets : ['__END__'];
        step.on_rejected = rejectedTargets.length > 0 ? rejectedTargets : ['fail'];
        step.on_timeout = timeoutTargets.length > 0 ? timeoutTargets : ['fail'];
        break;
      }

      case 'action': {
        step.connector_id = (config.connector_id as string) || (config.connector as string) || '';
        step.action_type = (config.action as string) || 'execute';
        step.parameters = (config.parameters as Record<string, unknown>) || {};
        step.on_success = collectTargets(successMatcher);
        step.on_failure = 'stop';
        break;
      }

      case 'notification': {
        step.connector_id = (config.connector_id as string) || (config.connector as string) || '';
        const channel = (config.channel as string) || 'email';
        step.channel = channel;
        step.action_type = deriveNotificationActionType(channel);
        step.recipients = (config.recipients as string) || '';
        step.message = (config.message as string) || '';
        if (config.subject) {
          step.subject = config.subject as string;
        }
        step.on_success = collectTargets(() => true);   // notification has no labeled handles
        step.on_failure = 'continue';
        break;
      }

      case 'delay': {
        step.duration_seconds = (config.duration_seconds as number) || 60;
        step.on_complete = collectTargets(() => true);
        break;
      }

      case 'stop': {
        step.reason = (config.reason as string) || 'Execution stopped by playbook';
        break;
      }

      default: {
        step.on_complete = collectTargets(() => true);
        step.config = config;
      }
    }

    return step;
  });

  return { trigger, steps, ui_end_position };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DSL TO NODES CONVERSION (for editing existing playbooks)
// ═══════════════════════════════════════════════════════════════════════════════

function convertDSLToNodes(
  playbook: {
    trigger?: Record<string, unknown> | null;
    steps: Record<string, unknown>[];
    ui_end_position?: { x: number; y: number };
  }
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const stepIdToNodeId = new Map<string, string>();
  let nodeCounter = 1;

  // Helper: parse a stored ui_position field, accepting either {x,y} or
  // null/undefined. Returns null when the value is missing or invalid so
  // the caller can fall back to the auto-layout default.
  const readUiPosition = (raw: unknown): { x: number; y: number } | null => {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.x !== 'number' || typeof obj.y !== 'number') return null;
    return { x: obj.x, y: obj.y };
  };

  // Trigger node — prefer saved ui_position, fall back to fixed top-center.
  const triggerNodeId = `trigger-${nodeCounter++}`;
  const triggerConfig = (playbook.trigger || {
    source: 'cybersentinel',
    severity_threshold: 'high',
    rule_ids: '',
  }) as Record<string, unknown>;
  const triggerPos = readUiPosition(triggerConfig.ui_position) || { x: 250, y: 50 };
  nodes.push({
    id: triggerNodeId,
    type: 'trigger',
    position: triggerPos,
    data: {
      label: 'Alert Received',
      stepType: 'trigger',
      subtype: 'webhook',
      config: triggerConfig,
    } as PlaybookNodeData,
  });

  // Create an end node to connect terminal steps
  const endNodeId = `end-${nodeCounter++}`;
  const endNodeUsed = { value: false };

  // Calculate positions for steps (vertical layout)
  const stepSpacing = 150;
  const startY = 200;

  // First pass: create nodes for all steps
  const steps = playbook.steps || [];
  steps.forEach((step, index) => {
    const stepData = step as DSLStep;
    const nodeId = `node-${nodeCounter++}`;
    stepIdToNodeId.set(stepData.step_id, nodeId);

    // Determine node type and config based on step type
    let nodeType = 'step';
    const config: Record<string, unknown> = {};

    switch (stepData.type) {
      case 'enrichment':
        config.connector_id = stepData.connector_id || '';
        config.action = stepData.action_type || 'lookup';
        config.observable_field = stepData.parameters?.observable_field || 'source_ip';
        config.output_variable = stepData.parameters?.output_variable || 'enrichment_result';
        break;
      case 'condition':
        if (stepData.condition) {
          config.field = stepData.condition.field || '';
          config.operator = stepData.condition.operator || 'equals';
          config.value = stepData.condition.value ?? '';
          if (stepData.condition.time_window_minutes) {
            config.time_window_minutes = stepData.condition.time_window_minutes;
          }
        }
        break;
      case 'approval':
        config.approver_role = stepData.approvers?.[0] || 'senior_analyst';
        config.timeout_seconds = (stepData.timeout_hours || 1) * 3600;
        config.approval_message = stepData.message || '';
        if (stepData.auto_skip_severity) {
          config.auto_skip_severity = stepData.auto_skip_severity;
        }
        break;
      case 'action':
        config.connector_id = stepData.connector_id || '';
        config.action = stepData.action_type || 'execute';
        config.parameters = stepData.parameters || {};
        break;
      case 'notification':
        config.connector_id = stepData.connector_id || '';
        config.channel = stepData.channel || 'email';
        config.recipients = stepData.recipients || '';
        config.message = stepData.message || '';
        if (stepData.subject) {
          config.subject = stepData.subject;
        }
        break;
      case 'delay':
        config.duration_seconds = stepData.duration_seconds || 60;
        break;
      case 'stop':
        config.reason = stepData.reason || 'Execution stopped by playbook';
        break;
      default:
        Object.assign(config, stepData.config || {});
    }

    const stepPos =
      readUiPosition(stepData.ui_position) ||
      { x: 250, y: startY + index * stepSpacing };
    nodes.push({
      id: nodeId,
      type: nodeType,
      position: stepPos,
      data: {
        label: stepData.name || `${stepData.type} step`,
        stepType: stepData.type as PlaybookNodeData['stepType'],
        subtype: stepData.type,
        config,
      } as PlaybookNodeData,
    });
  });

  // Second pass: create edges based on step transitions

  // Trigger → step edges. Reads trigger.next_steps (string[] of step_ids)
  // saved by convertNodesToDSL. If absent or empty (legacy / freshly imported
  // playbooks with no trigger.next_steps field), fall back to "connect
  // trigger to first step in array" — the original single-target behavior.
  const triggerNextRaw = (triggerConfig.next_steps ?? triggerConfig.next_step);
  const triggerNextSteps = toTargetArray(triggerNextRaw as BranchTargets | undefined | null);
  const triggerTargetStepIds: string[] =
    triggerNextSteps.length > 0
      ? triggerNextSteps
      : (steps.length > 0 ? [(steps[0] as DSLStep).step_id] : []);
  triggerTargetStepIds.forEach((stepId, idx) => {
    const targetNodeId = stepIdToNodeId.get(stepId);
    if (targetNodeId) {
      edges.push({
        id: `e-trigger-${targetNodeId}-${idx}`,
        source: triggerNodeId,
        target: targetNodeId,
        type: 'smoothstep',
        animated: true,
        style: { strokeWidth: 2 },
      });
    }
  });

  // Helper to resolve target step_id to node_id
  const resolveTargetNodeId = (targetStepId: string | undefined | null): string | null => {
    if (!targetStepId) return null;
    if (targetStepId === '__END__') {
      endNodeUsed.value = true;
      return endNodeId;
    }
    return stepIdToNodeId.get(targetStepId) || null;
  };

  // Resolve a BranchTargets field (string | string[]) into an array of
  // {nodeId, stepId} pairs for edge generation. Filters out null targets
  // (e.g. references to deleted steps).
  const resolveTargetList = (field: BranchTargets | undefined | null) =>
    toTargetArray(field)
      .filter((t) => t !== 'fail')   // 'fail' is a sentinel, not a renderable node
      .map((stepId) => ({ stepId, nodeId: resolveTargetNodeId(stepId) }))
      .filter((p): p is { stepId: string; nodeId: string } => p.nodeId !== null);

  // Create edges for each step's transitions
  steps.forEach((step) => {
    const stepData = step as DSLStep;
    const sourceNodeId = stepIdToNodeId.get(stepData.step_id);
    if (!sourceNodeId) return;

    // Helper to push edges for a branch with a labeled source handle.
    const pushBranchEdges = (
      targets: { stepId: string; nodeId: string }[],
      handle: string,
      label?: string
    ) => {
      targets.forEach(({ nodeId }, idx) => {
        const edge: Edge = {
          id: `e-${sourceNodeId}-${handle}-${nodeId}-${idx}`,
          source: sourceNodeId,
          target: nodeId,
          sourceHandle: handle === 'success' ? undefined : handle,
          type: 'smoothstep',
          animated: true,
          style: { strokeWidth: 2 },
        };
        if (label) {
          edge.label = label;
          edge.labelStyle = { fill: 'hsl(var(--foreground))', fontWeight: 500, fontSize: 11 };
          edge.labelBgStyle = { fill: 'hsl(var(--card))', fillOpacity: 0.9 };
        }
        edges.push(edge);
      });
    };

    switch (stepData.type) {
      case 'condition': {
        pushBranchEdges(resolveTargetList(stepData.on_true), 'true', 'true');
        pushBranchEdges(resolveTargetList(stepData.on_false), 'false', 'false');
        break;
      }
      case 'approval': {
        pushBranchEdges(resolveTargetList(stepData.on_approved), 'approved', 'approved');
        pushBranchEdges(resolveTargetList(stepData.on_rejected), 'rejected', 'rejected');
        pushBranchEdges(resolveTargetList(stepData.on_timeout), 'timeout', 'timeout');
        break;
      }
      default: {
        // action, enrichment, notification, delay, stop, anything else:
        // use on_success first, then on_complete as fallback. Both are arrays.
        const targets =
          resolveTargetList(stepData.on_success).length > 0
            ? resolveTargetList(stepData.on_success)
            : resolveTargetList(stepData.on_complete);
        pushBranchEdges(targets, 'success');
        break;
      }
    }
  });

  // Add end node if it was used
  if (endNodeUsed.value) {
    const endPos =
      readUiPosition(playbook.ui_end_position) ||
      { x: 250, y: startY + steps.length * stepSpacing };
    nodes.push({
      id: endNodeId,
      type: 'end',
      position: endPos,
      data: {
        label: 'End',
        stepType: 'end',
      } as PlaybookNodeData,
    });
  }

  return { nodes, edges };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface ValidationErrorPanelProps {
  result: GraphValidationResult;
  expanded: boolean;
  onToggle: () => void;
}

function ValidationErrorPanel({ result, expanded, onToggle }: ValidationErrorPanelProps) {
  const errorCount = result.errors.length;
  const warningCount = result.warnings.length;
  const totalCount = errorCount + warningCount;

  if (totalCount === 0) return null;

  const hasErrors = errorCount > 0;

  return (
    <div
      className={cn(
        'border-t transition-all',
        hasErrors ? 'bg-destructive/5 border-destructive/30' : 'bg-amber-500/5 border-amber-500/30'
      )}
    >
      <button
        onClick={onToggle}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-black/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          {hasErrors ? (
            <AlertOctagon className="h-4 w-4 text-destructive" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-500" />
          )}
          <span className={cn('text-sm font-medium', hasErrors ? 'text-destructive' : 'text-amber-600')}>
            {errorCount > 0 && `${errorCount} error${errorCount > 1 ? 's' : ''}`}
            {errorCount > 0 && warningCount > 0 && ', '}
            {warningCount > 0 && `${warningCount} warning${warningCount > 1 ? 's' : ''}`}
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2 max-h-48 overflow-y-auto">
          {result.errors.map((issue) => (
            <ValidationIssueRow key={issue.id} issue={issue} />
          ))}
          {result.warnings.map((issue) => (
            <ValidationIssueRow key={issue.id} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ValidationIssueRowProps {
  issue: ValidationIssue;
}

function ValidationIssueRow({ issue }: ValidationIssueRowProps) {
  const isError = issue.severity === 'error';

  return (
    <div
      className={cn(
        'p-2 rounded border text-xs',
        isError
          ? 'bg-destructive/10 border-destructive/20'
          : 'bg-amber-500/10 border-amber-500/20'
      )}
    >
      <div className="flex items-start gap-2">
        {isError ? (
          <AlertOctagon className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p className={cn('font-medium', isError ? 'text-destructive' : 'text-amber-600')}>
            {issue.nodeName ? `${issue.nodeName}: ` : ''}{issue.message}
          </p>
          <p className="text-muted-foreground mt-0.5">{issue.remediation}</p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function VisualPlaybookEditor({ playbook, onSave, onClose }: VisualPlaybookEditorProps) {
  const { toast } = useToast();
  const [name, setName] = useState(playbook?.name || '');
  const [description, setDescription] = useState(playbook?.description || '');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [showDSLPreview, setShowDSLPreview] = useState(false);
  const [validationResult, setValidationResult] = useState<GraphValidationResult | null>(null);
  const [errorPanelExpanded, setErrorPanelExpanded] = useState(true);

  // Test flow state
  const [showTestSimulator, setShowTestSimulator] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [hasTestedOnce, setHasTestedOnce] = useState(false);

  const canvasRef = useRef<PlaybookCanvasRef>(null);

  // Determine if this is EDIT mode: playbook has a backend-assigned ID
  // Uses playbook_id (canonical backend field) or id (normalized frontend alias)
  // Does NOT gate on steps — an existing playbook with 0 steps is still an edit
  const isEditMode = Boolean(playbook?.playbook_id || playbook?.id);

  // Compute playbookId for webhook/trigger integration
  const playbookId = playbook?.playbook_id || playbook?.id || undefined;

  // Compute initial nodes/edges from existing playbook DSL (EDIT mode)
  const initialGraphData = useMemo(() => {
    if (isEditMode && playbook) {
      return convertDSLToNodes({
        trigger: playbook.trigger || null,
        steps: playbook.steps || [],
        ui_end_position: (playbook as { ui_end_position?: { x: number; y: number } })
          .ui_end_position,
      });
    }
    return null;
  }, [isEditMode, playbook]);

  const handleNodesChange = useCallback((newNodes: Node[]) => {
    setNodes(newNodes);
  }, []);

  const handleEdgesChange = useCallback((newEdges: Edge[]) => {
    setEdges(newEdges);
  }, []);

  const handleValidationChange = useCallback((result: GraphValidationResult) => {
    setValidationResult(result);
    if (showValidationErrors && result.errors.length > 0) {
      setErrorPanelExpanded(true);
    }
  }, [showValidationErrors]);

  const handleNodeHighlight = useCallback((nodeId: string | null, status: 'running' | 'success' | 'error' | 'pending' | null) => {
    canvasRef.current?.highlightNode(nodeId, status);
  }, []);

  const handleTestComplete = useCallback(() => {
    setHasTestedOnce(true);
    setShowValidationErrors(true);
  }, []);

  const isValid = validationResult?.valid ?? false;
  const hasErrors = (validationResult?.errors.length ?? 0) > 0;
  const hasWarnings = (validationResult?.warnings.length ?? 0) > 0;

  // Calculate if playbook has any steps (required for backend)
  const stepNodes = nodes.filter((n) => {
    const nodeData = n.data as PlaybookNodeData;
    return nodeData.stepType !== 'trigger' && nodeData.stepType !== 'end';
  });
  const hasSteps = stepNodes.length > 0;
  const hasValidName = name && name.trim() !== '';

  // Determine if save button should be disabled
  const canSave = hasValidName && hasSteps && !(hasTestedOnce && hasErrors);

  const handlePreviewDSL = useCallback(() => {
    setShowDSLPreview(true);
  }, []);

  const handleSave = useCallback(() => {
    // VALIDATION 1: Name is required
    if (!name || name.trim() === '') {
      toast({
        title: 'Cannot save playbook',
        description: 'Playbook name is required',
        variant: 'destructive',
      });
      return;
    }

    // VALIDATION 2: Must have at least one step (backend requirement)
    const stepNodes = nodes.filter((n) => {
      const nodeData = n.data as PlaybookNodeData;
      return nodeData.stepType !== 'trigger' && nodeData.stepType !== 'end';
    });

    if (stepNodes.length === 0) {
      toast({
        title: 'Cannot save playbook',
        description: 'Playbook must contain at least one step. Add steps to the canvas before saving.',
        variant: 'destructive',
      });
      return;
    }

    // VALIDATION 3: Check for validation errors if tested
    if (hasErrors && hasTestedOnce) {
      toast({
        title: 'Cannot save playbook',
        description: 'Fix all validation errors first. Use "Test Flow" to identify issues.',
        variant: 'destructive',
      });
      return;
    }

    // VALIDATION 4: Warn about validation errors if NOT tested
    if (!hasTestedOnce) {
      toast({
        title: 'Playbook not tested',
        description: 'Consider testing the playbook flow before saving',
      });
    }

    if (hasWarnings && validationResult) {
      toast({
        title: 'Saved with warnings',
        description: validationResult.warnings[0].message,
      });
    }

    const { trigger, steps, ui_end_position } = convertNodesToDSL(nodes, edges);

    // Strict CREATE vs UPDATE separation:
    // CREATE: { name, description, trigger, steps } — no playbook_id
    // UPDATE: { playbook_id, name, description, trigger, steps }
    const saveData: PlaybookSaveData = {
      name: name.trim(),
      description: description.trim(),
      trigger,
      steps,
    };
    if (ui_end_position) {
      saveData.ui_end_position = ui_end_position;
    }

    // Only attach playbook_id for EDIT mode (triggers PUT path in PlaybookManager)
    const existingId = playbook?.playbook_id || playbook?.id;
    if (existingId) {
      saveData.playbook_id = existingId;
    }

    onSave(saveData);
  }, [name, description, nodes, edges, hasErrors, hasWarnings, hasTestedOnce, validationResult, onSave, toast, playbook]);

  const handleOpenTestSimulator = useCallback(() => {
    setShowTestSimulator(true);
  }, []);

  const dslPreview = showDSLPreview ? convertNodesToDSL(nodes, edges) : null;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Playbook Name"
                className={cn(
                  'font-semibold text-lg h-8 w-64 border-none shadow-none focus-visible:ring-0 px-0',
                  !name.trim() && 'text-destructive placeholder:text-destructive/50'
                )}
              />
            </div>
            {/* Mode indicator badge */}
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded font-medium',
                isEditMode
                  ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                  : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
              )}
            >
              {isEditMode ? `Editing v${playbook?.version || 1}` : 'New Playbook'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Validation status indicator - only show after testing */}
          {hasTestedOnce && validationResult && (
            <div
              className={cn(
                'flex items-center gap-1.5 text-sm px-2 py-1 rounded',
                isValid
                  ? 'text-emerald-500 bg-emerald-500/10'
                  : hasErrors
                  ? 'text-destructive bg-destructive/10'
                  : 'text-amber-500 bg-amber-500/10'
              )}
            >
              {isValid ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : hasErrors ? (
                <AlertOctagon className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <span>
                {isValid
                  ? 'Valid'
                  : hasErrors
                  ? `${validationResult.errors.length} error${validationResult.errors.length > 1 ? 's' : ''}`
                  : `${validationResult.warnings.length} warning${validationResult.warnings.length > 1 ? 's' : ''}`}
              </span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreviewDSL}
          >
            <Code className="h-4 w-4 mr-2" />
            Preview DSL
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleOpenTestSimulator}
          >
            <FlaskConical className="h-4 w-4 mr-2" />
            Test Flow
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!canSave}
            title={
              !hasValidName
                ? 'Playbook name is required'
                : !hasSteps
                ? 'Add at least one step to the canvas'
                : hasTestedOnce && hasErrors
                ? 'Fix validation errors before saving'
                : 'Save playbook'
            }
          >
            <Save className="h-4 w-4 mr-2" />
            {isEditMode ? 'Update Playbook' : 'Create Playbook'}
          </Button>
        </div>
      </div>

      {/* Description bar */}
      <div className="border-b border-border px-4 py-2 bg-muted/30">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a description for this playbook..."
          className="border-none shadow-none focus-visible:ring-0 bg-transparent text-sm text-muted-foreground"
        />
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <ReactFlowProvider>
          <PlaybookCanvas
            ref={canvasRef}
            initialNodes={initialGraphData?.nodes}
            initialEdges={initialGraphData?.edges}
            playbookId={playbookId}
            playbookName={name}
            showValidationErrors={showValidationErrors}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onValidationChange={handleValidationChange}
          />
        </ReactFlowProvider>
      </div>

      {/* Validation error panel - only show after testing */}
      {showValidationErrors && validationResult && (validationResult.errors.length > 0 || validationResult.warnings.length > 0) && (
        <ValidationErrorPanel
          result={validationResult}
          expanded={errorPanelExpanded}
          onToggle={() => setErrorPanelExpanded(!errorPanelExpanded)}
        />
      )}

      {/* Test Flow Simulator */}
      {showTestSimulator && (
        <TestFlowSimulator
          nodes={nodes}
          edges={edges}
          playbookId={playbook?.id}
          onNodeHighlight={handleNodeHighlight}
          onClose={() => setShowTestSimulator(false)}
          onValidationComplete={handleTestComplete}
        />
      )}

      {/* DSL Preview Dialog */}
      <Dialog open={showDSLPreview} onOpenChange={setShowDSLPreview}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Playbook DSL Preview</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="p-4 bg-muted rounded-lg text-xs font-mono overflow-auto">
              {JSON.stringify(
                isEditMode
                  ? {
                      playbook_id: playbook?.playbook_id || playbook?.id,
                      name,
                      description,
                      version: playbook?.version || 1,
                      dsl: dslPreview,
                    }
                  : {
                      name,
                      description,
                      dsl: dslPreview,
                    },
                null,
                2
              )}
            </pre>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowDSLPreview(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                const text = JSON.stringify(
                  isEditMode
                    ? {
                        playbook_id: playbook?.playbook_id || playbook?.id,
                        name,
                        description,
                        version: playbook?.version || 1,
                        dsl: dslPreview,
                      }
                    : {
                        name,
                        description,
                        dsl: dslPreview,
                      },
                  null,
                  2
                );
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(text).then(
                    () => toast({ title: 'Copied to clipboard' }),
                    () => toast({ title: 'Failed to copy', variant: 'destructive' })
                  );
                } else {
                  // Fallback for non-secure contexts (HTTP)
                  const textarea = document.createElement('textarea');
                  textarea.value = text;
                  textarea.style.position = 'fixed';
                  textarea.style.opacity = '0';
                  document.body.appendChild(textarea);
                  textarea.select();
                  try {
                    document.execCommand('copy');
                    toast({ title: 'Copied to clipboard' });
                  } catch {
                    toast({ title: 'Failed to copy', variant: 'destructive' });
                  }
                  document.body.removeChild(textarea);
                }
              }}
            >
              Copy DSL
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
