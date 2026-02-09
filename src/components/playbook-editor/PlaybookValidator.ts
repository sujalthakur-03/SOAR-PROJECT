/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PLAYBOOK GRAPH VALIDATOR
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Validates playbook graph structure, step configurations, and transition rules.
 * Returns actionable errors for SOC analysts with specific remediation guidance.
 */

import type { Node, Edge } from '@xyflow/react';
import type { PlaybookNodeData } from './nodeTypes';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  nodeId: string | null;
  nodeName: string | null;
  code: string;
  message: string;
  remediation: string;
}

export interface GraphValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  nodeErrors: Map<string, ValidationIssue[]>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR CODES
// ═══════════════════════════════════════════════════════════════════════════════

export const ValidationCodes = {
  // Structure errors
  NO_TRIGGER: 'NO_TRIGGER',
  NO_STEPS: 'NO_STEPS',
  DISCONNECTED_STEP: 'DISCONNECTED_STEP',

  // Transition errors
  ENRICHMENT_TO_ACTION_NO_CONDITION: 'ENRICHMENT_TO_ACTION_NO_CONDITION',
  INVALID_TRANSITION: 'INVALID_TRANSITION',

  // Branch errors
  CONDITION_MISSING_TRUE: 'CONDITION_MISSING_TRUE',
  CONDITION_MISSING_FALSE: 'CONDITION_MISSING_FALSE',
  APPROVAL_MISSING_APPROVED: 'APPROVAL_MISSING_APPROVED',
  APPROVAL_MISSING_REJECTED: 'APPROVAL_MISSING_REJECTED',
  APPROVAL_MISSING_TIMEOUT: 'APPROVAL_MISSING_TIMEOUT',

  // Config errors
  ACTION_MISSING_CONNECTOR: 'ACTION_MISSING_CONNECTOR',
  ACTION_MISSING_IP: 'ACTION_MISSING_IP',
  ACTION_MISSING_PROCESS: 'ACTION_MISSING_PROCESS',
  ACTION_MISSING_USERNAME: 'ACTION_MISSING_USERNAME',
  NOTIFICATION_MISSING_RECIPIENT: 'NOTIFICATION_MISSING_RECIPIENT',
  NOTIFICATION_MISSING_CHANNEL: 'NOTIFICATION_MISSING_CHANNEL',
  NOTIFICATION_MISSING_TEMPLATE: 'NOTIFICATION_MISSING_TEMPLATE',
  ENRICHMENT_MISSING_CONNECTOR: 'ENRICHMENT_MISSING_CONNECTOR',
  CONDITION_MISSING_FIELD: 'CONDITION_MISSING_FIELD',
  CONDITION_MISSING_VALUE: 'CONDITION_MISSING_VALUE',
  APPROVAL_MISSING_ROLE: 'APPROVAL_MISSING_ROLE',

  // Name validation
  PLAYBOOK_NAME_REQUIRED: 'PLAYBOOK_NAME_REQUIRED',
  STEP_NAME_REQUIRED: 'STEP_NAME_REQUIRED',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════════

export function validatePlaybookGraph(
  playbookName: string,
  nodes: Node[],
  edges: Edge[]
): GraphValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const nodeErrors = new Map<string, ValidationIssue[]>();

  const addIssue = (issue: ValidationIssue) => {
    if (issue.severity === 'error') {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }

    if (issue.nodeId) {
      const existing = nodeErrors.get(issue.nodeId) || [];
      existing.push(issue);
      nodeErrors.set(issue.nodeId, existing);
    }
  };

  // Get helper data
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edgesBySource = new Map<string, Edge[]>();
  const edgesByTarget = new Map<string, Edge[]>();

  edges.forEach(e => {
    const sourceEdges = edgesBySource.get(e.source) || [];
    sourceEdges.push(e);
    edgesBySource.set(e.source, sourceEdges);

    const targetEdges = edgesByTarget.get(e.target) || [];
    targetEdges.push(e);
    edgesByTarget.set(e.target, targetEdges);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // 1. PLAYBOOK NAME VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════════

  if (!playbookName.trim()) {
    addIssue({
      id: 'name-required',
      severity: 'error',
      nodeId: null,
      nodeName: null,
      code: ValidationCodes.PLAYBOOK_NAME_REQUIRED,
      message: 'Playbook name is required',
      remediation: 'Enter a descriptive name for this playbook at the top of the editor.',
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 2. STRUCTURE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════════

  const triggerNode = nodes.find(n => (n.data as PlaybookNodeData).stepType === 'trigger');
  const stepNodes = nodes.filter(n => {
    const data = n.data as PlaybookNodeData;
    return data.stepType !== 'trigger' && data.stepType !== 'end';
  });

  if (!triggerNode) {
    addIssue({
      id: 'no-trigger',
      severity: 'error',
      nodeId: null,
      nodeName: null,
      code: ValidationCodes.NO_TRIGGER,
      message: 'Playbook must have a trigger',
      remediation: 'Every playbook needs a Trigger node. The default trigger should already be present.',
    });
  }

  if (stepNodes.length === 0) {
    addIssue({
      id: 'no-steps',
      severity: 'warning',
      nodeId: null,
      nodeName: null,
      code: ValidationCodes.NO_STEPS,
      message: 'Playbook has no steps',
      remediation: 'Drag steps from the Step Palette on the left to build your workflow.',
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 3. CONNECTIVITY VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════════

  if (triggerNode) {
    const connectedNodes = new Set<string>();
    const queue = [triggerNode.id];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (connectedNodes.has(nodeId)) continue;
      connectedNodes.add(nodeId);

      const outgoingEdges = edgesBySource.get(nodeId) || [];
      outgoingEdges.forEach(e => queue.push(e.target));
    }

    stepNodes.forEach(node => {
      if (!connectedNodes.has(node.id)) {
        const data = node.data as PlaybookNodeData;
        addIssue({
          id: `disconnected-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          nodeName: data.label,
          code: ValidationCodes.DISCONNECTED_STEP,
          message: `Step "${data.label}" is not connected to the workflow`,
          remediation: 'Connect this step to the workflow by drawing an edge from a previous step.',
        });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 4. TRANSITION RULES VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════════

  nodes.forEach(node => {
    const data = node.data as PlaybookNodeData;
    const outgoingEdges = edgesBySource.get(node.id) || [];

    // Check each outgoing edge for invalid transitions
    outgoingEdges.forEach(edge => {
      const targetNode = nodeMap.get(edge.target);
      if (!targetNode) return;

      const targetData = targetNode.data as PlaybookNodeData;

      // RULE: Enrichment → Action requires Condition in between
      if (data.stepType === 'enrichment' && targetData.stepType === 'action') {
        addIssue({
          id: `enrichment-action-${node.id}-${targetNode.id}`,
          severity: 'error',
          nodeId: targetNode.id,
          nodeName: targetData.label,
          code: ValidationCodes.ENRICHMENT_TO_ACTION_NO_CONDITION,
          message: 'Invalid Transition: Action after Enrichment without Condition',
          remediation: `Insert a Condition step between "${data.label}" and "${targetData.label}" to evaluate the enrichment result before taking action.`,
        });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // 5. BRANCH VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════════

  stepNodes.forEach(node => {
    const data = node.data as PlaybookNodeData;
    const outgoingEdges = edgesBySource.get(node.id) || [];

    // Condition steps must have both True and False branches
    if (data.stepType === 'condition') {
      const hasTrue = outgoingEdges.some(e => e.sourceHandle === 'true');
      const hasFalse = outgoingEdges.some(e => e.sourceHandle === 'false');

      if (!hasTrue) {
        addIssue({
          id: `condition-true-${node.id}`,
          severity: 'error',
          nodeId: node.id,
          nodeName: data.label,
          code: ValidationCodes.CONDITION_MISSING_TRUE,
          message: `Condition "${data.label}" missing True branch`,
          remediation: 'Connect the green "True" handle to the step that should execute when the condition is true.',
        });
      }

      if (!hasFalse) {
        addIssue({
          id: `condition-false-${node.id}`,
          severity: 'error',
          nodeId: node.id,
          nodeName: data.label,
          code: ValidationCodes.CONDITION_MISSING_FALSE,
          message: `Condition "${data.label}" missing False branch`,
          remediation: 'Connect the red "False" handle to the step that should execute when the condition is false (or to an End node).',
        });
      }
    }

    // Approval steps should have all three branches
    if (data.stepType === 'approval') {
      const hasApproved = outgoingEdges.some(e => e.sourceHandle === 'approved');
      const hasRejected = outgoingEdges.some(e => e.sourceHandle === 'rejected');
      const hasTimeout = outgoingEdges.some(e => e.sourceHandle === 'timeout');

      if (!hasApproved) {
        addIssue({
          id: `approval-approved-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          nodeName: data.label,
          code: ValidationCodes.APPROVAL_MISSING_APPROVED,
          message: `Approval "${data.label}" missing Approved branch`,
          remediation: 'Connect the green "Approved" handle to the action that should execute when approval is granted.',
        });
      }

      if (!hasRejected) {
        addIssue({
          id: `approval-rejected-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          nodeName: data.label,
          code: ValidationCodes.APPROVAL_MISSING_REJECTED,
          message: `Approval "${data.label}" missing Rejected branch`,
          remediation: 'Connect the red "Rejected" handle to handle denial scenarios (e.g., notification or End).',
        });
      }

      if (!hasTimeout) {
        addIssue({
          id: `approval-timeout-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          nodeName: data.label,
          code: ValidationCodes.APPROVAL_MISSING_TIMEOUT,
          message: `Approval "${data.label}" missing Timeout branch`,
          remediation: 'Connect the amber "Timeout" handle to handle cases where no one responds in time.',
        });
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // 6. STEP CONFIGURATION VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════════

  stepNodes.forEach(node => {
    const data = node.data as PlaybookNodeData;
    const config = (data.config || {}) as Record<string, unknown>;

    // Step name validation
    if (!data.label || data.label.trim() === '') {
      addIssue({
        id: `name-${node.id}`,
        severity: 'error',
        nodeId: node.id,
        nodeName: 'Unnamed Step',
        code: ValidationCodes.STEP_NAME_REQUIRED,
        message: 'Step name is required',
        remediation: 'Click on this step and enter a descriptive name.',
      });
    }

    // Type-specific validation
    switch (data.stepType) {
      case 'action': {
        // Action must have connector
        if (!config.connector_id && !config.connector) {
          addIssue({
            id: `action-connector-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.ACTION_MISSING_CONNECTOR,
            message: `Action "${data.label}" missing connector`,
            remediation: 'Select a connector (e.g., Firewall, CyberSentinel Agent) for this action.',
          });
        }

        // Block IP action requires IP
        const params = (config.parameters || {}) as Record<string, unknown>;
        const action = config.action as string;
        const subtype = data.subtype;

        if ((subtype === 'cybersentinel_block_ip' || action === 'cybersentinel_block_ip') && !params.ip) {
          addIssue({
            id: `action-ip-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.ACTION_MISSING_IP,
            message: `"${data.label}" — No IP selected to block`,
            remediation: 'Select an IP source (Trigger source_ip, Enrichment IP, or Custom value) in the step configuration.',
          });
        }

        if ((subtype === 'block_ip' || action === 'block_ip') && !(subtype === 'cybersentinel_block_ip' || action === 'cybersentinel_block_ip') && !params.ip) {
          addIssue({
            id: `action-ip-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.ACTION_MISSING_IP,
            message: `Block IP action "${data.label}" missing IP address`,
            remediation: 'Specify the IP to block. Use {{trigger_data.source_ip}} for dynamic value.',
          });
        }

        // Kill process requires PID or process name
        if ((subtype === 'kill_process' || action === 'kill_process') && !params.pid && !params.process_name) {
          addIssue({
            id: `action-process-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.ACTION_MISSING_PROCESS,
            message: `Kill Process action "${data.label}" missing PID or process name`,
            remediation: 'Specify either a PID or process name to terminate.',
          });
        }

        // Disable user requires username
        if ((subtype === 'disable_user' || action === 'disable_user') && !params.username) {
          addIssue({
            id: `action-username-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.ACTION_MISSING_USERNAME,
            message: `Disable User action "${data.label}" missing username`,
            remediation: 'Specify the username. Use {{trigger_data.username}} for dynamic value.',
          });
        }
        break;
      }

      case 'notification': {
        if (!config.connector_id && !config.connector) {
          addIssue({
            id: `notification-connector-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.ACTION_MISSING_CONNECTOR,
            message: `Notification "${data.label}" missing connector`,
            remediation: 'Select a notification connector (SMTP, Slack, Webhook).',
          });
        }

        if (!config.channel) {
          addIssue({
            id: `notification-channel-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.NOTIFICATION_MISSING_CHANNEL,
            message: `Notification "${data.label}" missing channel`,
            remediation: 'Select a notification channel (Email, Slack, Webhook).',
          });
        }

        if (!config.recipients) {
          addIssue({
            id: `notification-recipient-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.NOTIFICATION_MISSING_RECIPIENT,
            message: `Notification "${data.label}" missing recipients`,
            remediation: 'Specify email addresses, Slack channels, or webhook URL.',
          });
        }
        break;
      }

      case 'enrichment': {
        if (!config.connector_id && !config.connector) {
          addIssue({
            id: `enrichment-connector-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.ENRICHMENT_MISSING_CONNECTOR,
            message: `Enrichment "${data.label}" missing connector`,
            remediation: 'Select an enrichment source (VirusTotal, AbuseIPDB, etc.).',
          });
        }
        break;
      }

      case 'condition': {
        if (!config.field && !config.expression) {
          addIssue({
            id: `condition-field-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.CONDITION_MISSING_FIELD,
            message: `Condition "${data.label}" missing field to evaluate`,
            remediation: 'Specify the field to check (e.g., severity, enrichment.score).',
          });
        }

        if (config.value === undefined || config.value === '') {
          addIssue({
            id: `condition-value-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.CONDITION_MISSING_VALUE,
            message: `Condition "${data.label}" missing comparison value`,
            remediation: 'Specify the value to compare against.',
          });
        }
        break;
      }

      case 'approval': {
        if (!config.approver_role && !config.approvers) {
          addIssue({
            id: `approval-role-${node.id}`,
            severity: 'error',
            nodeId: node.id,
            nodeName: data.label,
            code: ValidationCodes.APPROVAL_MISSING_ROLE,
            message: `Approval "${data.label}" missing approver role`,
            remediation: 'Select who can approve this action (Analyst, Senior Analyst, Manager).',
          });
        }
        break;
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    nodeErrors,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all issues for a specific node
 */
export function getNodeIssues(result: GraphValidationResult, nodeId: string): ValidationIssue[] {
  return result.nodeErrors.get(nodeId) || [];
}

/**
 * Check if a node has errors (not just warnings)
 */
export function nodeHasErrors(result: GraphValidationResult, nodeId: string): boolean {
  const issues = result.nodeErrors.get(nodeId) || [];
  return issues.some(i => i.severity === 'error');
}

/**
 * Get the primary error message for a node (for inline display)
 */
export function getNodePrimaryError(result: GraphValidationResult, nodeId: string): ValidationIssue | null {
  const issues = result.nodeErrors.get(nodeId) || [];
  return issues.find(i => i.severity === 'error') || issues[0] || null;
}

/**
 * Format issues for display in error panel
 */
export function formatIssuesForDisplay(issues: ValidationIssue[]): string[] {
  return issues.map(i =>
    i.nodeName
      ? `${i.nodeName}: ${i.message}`
      : i.message
  );
}
