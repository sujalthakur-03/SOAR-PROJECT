/**
 * Observable Fields Helper
 *
 * Provides a reusable catalog of fields available to reference from any given
 * step in a playbook. "Available fields" come from two sources:
 *
 *   1. The incoming alert (trigger data) — normalized alert fields that are
 *      always present when a playbook runs.
 *   2. Previous steps — outputs produced by steps that execute BEFORE the
 *      current step in execution order.
 *
 * Fields are rendered into the DSL as template strings, e.g.
 * `{{trigger_data.agent.id}}` or `{{steps.enrich_ip.output.reputation}}`.
 */

import type { Node } from '@xyflow/react';
import type { PlaybookNodeData } from './nodeTypes';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ObservableFieldType =
  | 'ip'
  | 'id'
  | 'string'
  | 'number'
  | 'boolean'
  | 'url'
  | 'hash'
  | 'any';

export interface ObservableField {
  /** Dotted path without template braces, e.g. "trigger_data.agent.id" */
  path: string;
  /** Full template string that gets inserted into the DSL */
  template: string;
  /** Human-readable label shown in the picker */
  label: string;
  /** One-line description explaining what the field is */
  description: string;
  /** Value type for filtering + badge rendering */
  type: Exclude<ObservableFieldType, 'any'>;
  /** Where the field comes from */
  category: 'trigger' | 'step_output';
  /** Populated for step_output fields */
  sourceStepId?: string;
  sourceStepLabel?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger data catalog
// ─────────────────────────────────────────────────────────────────────────────

const TRIGGER_DATA_FIELDS: ObservableField[] = [
  // Agent
  {
    path: 'trigger_data.agent.id',
    template: '{{trigger_data.agent.id}}',
    label: 'Agent ID',
    description: 'Unique identifier of the endpoint agent that produced the alert',
    type: 'id',
    category: 'trigger',
  },
  {
    path: 'trigger_data.agent.name',
    template: '{{trigger_data.agent.name}}',
    label: 'Agent Name',
    description: 'Hostname of the reporting endpoint',
    type: 'string',
    category: 'trigger',
  },
  {
    path: 'trigger_data.agent.ip',
    template: '{{trigger_data.agent.ip}}',
    label: 'Agent IP',
    description: 'Network address of the reporting endpoint',
    type: 'ip',
    category: 'trigger',
  },

  // Rule
  {
    path: 'trigger_data.rule.id',
    template: '{{trigger_data.rule.id}}',
    label: 'Rule ID',
    description: 'Detection rule identifier that produced the alert',
    type: 'id',
    category: 'trigger',
  },
  {
    path: 'trigger_data.rule.name',
    template: '{{trigger_data.rule.name}}',
    label: 'Rule Name',
    description: 'Human-readable name of the detection rule',
    type: 'string',
    category: 'trigger',
  },
  {
    path: 'trigger_data.rule.level',
    template: '{{trigger_data.rule.level}}',
    label: 'Rule Level',
    description: 'Severity level of the detection rule',
    type: 'number',
    category: 'trigger',
  },

  // Normalized network fields
  {
    path: 'trigger_data.source_ip',
    template: '{{trigger_data.source_ip}}',
    label: 'Source IP',
    description: 'Normalized source IP address from the alert',
    type: 'ip',
    category: 'trigger',
  },
  {
    path: 'trigger_data.destination_ip',
    template: '{{trigger_data.destination_ip}}',
    label: 'Destination IP',
    description: 'Normalized destination IP address from the alert',
    type: 'ip',
    category: 'trigger',
  },

  // Identity
  {
    path: 'trigger_data.username',
    template: '{{trigger_data.username}}',
    label: 'Username',
    description: 'User account associated with the alert',
    type: 'string',
    category: 'trigger',
  },
  {
    path: 'trigger_data.user',
    template: '{{trigger_data.user}}',
    label: 'User',
    description: 'Full user object or user identifier from the alert',
    type: 'string',
    category: 'trigger',
  },

  // Process
  {
    path: 'trigger_data.process_name',
    template: '{{trigger_data.process_name}}',
    label: 'Process Name',
    description: 'Name of the process referenced by the alert',
    type: 'string',
    category: 'trigger',
  },
  {
    path: 'trigger_data.pid',
    template: '{{trigger_data.pid}}',
    label: 'Process ID (PID)',
    description: 'OS process identifier referenced by the alert',
    type: 'number',
    category: 'trigger',
  },

  // Raw data.* aliases (as emitted by the upstream sensor)
  {
    path: 'trigger_data.data.srcip',
    template: '{{trigger_data.data.srcip}}',
    label: 'Raw Source IP (data.srcip)',
    description: 'Raw source IP as emitted by the sensor',
    type: 'ip',
    category: 'trigger',
  },
  {
    path: 'trigger_data.data.dstip',
    template: '{{trigger_data.data.dstip}}',
    label: 'Raw Destination IP (data.dstip)',
    description: 'Raw destination IP as emitted by the sensor',
    type: 'ip',
    category: 'trigger',
  },
  {
    path: 'trigger_data.data.url',
    template: '{{trigger_data.data.url}}',
    label: 'URL',
    description: 'URL observed in the alert payload',
    type: 'url',
    category: 'trigger',
  },
  {
    path: 'trigger_data.data.hash',
    template: '{{trigger_data.data.hash}}',
    label: 'File Hash',
    description: 'Hash of the file referenced by the alert',
    type: 'hash',
    category: 'trigger',
  },

  // Timing & severity
  {
    path: 'trigger_data.timestamp',
    template: '{{trigger_data.timestamp}}',
    label: 'Timestamp',
    description: 'When the alert fired (ISO-8601)',
    type: 'string',
    category: 'trigger',
  },
  {
    path: 'trigger_data.severity',
    template: '{{trigger_data.severity}}',
    label: 'Severity',
    description: 'Normalized alert severity (low/medium/high/critical)',
    type: 'string',
    category: 'trigger',
  },

  // MITRE
  {
    path: 'trigger_data.mitre_technique',
    template: '{{trigger_data.mitre_technique}}',
    label: 'MITRE Technique',
    description: 'MITRE ATT&CK technique ID linked to the alert',
    type: 'id',
    category: 'trigger',
  },
  {
    path: 'trigger_data.mitre_tactic',
    template: '{{trigger_data.mitre_tactic}}',
    label: 'MITRE Tactic',
    description: 'MITRE ATT&CK tactic linked to the alert',
    type: 'string',
    category: 'trigger',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function getTriggerDataFields(): ObservableField[] {
  return TRIGGER_DATA_FIELDS.slice();
}

export interface PreviousStepDescriptor {
  step_id: string;
  type: string;
  name: string;
  connector_id?: string;
}

/**
 * Derive the output fields that a given step is expected to produce, based on
 * its step type (and optionally connector).
 */
export function getStepOutputFields(step: PreviousStepDescriptor): ObservableField[] {
  const base = `steps.${step.step_id}.output`;
  const withPrefix = (field: string) => `${base}.${field}`;
  const tpl = (field: string) => `{{${withPrefix(field)}}}`;
  const ctx = {
    sourceStepId: step.step_id,
    sourceStepLabel: step.name,
    category: 'step_output' as const,
  };

  switch (step.type) {
    case 'enrichment': {
      return [
        {
          path: withPrefix('reputation'),
          template: tpl('reputation'),
          label: 'Reputation',
          description: `Reputation verdict returned by ${step.name}`,
          type: 'string',
          ...ctx,
        },
        {
          path: withPrefix('malicious'),
          template: tpl('malicious'),
          label: 'Malicious?',
          description: `Whether ${step.name} flagged the observable as malicious`,
          type: 'boolean',
          ...ctx,
        },
        {
          path: withPrefix('score'),
          template: tpl('score'),
          label: 'Reputation Score',
          description: `Numeric threat score returned by ${step.name}`,
          type: 'number',
          ...ctx,
        },
        {
          path: withPrefix('country'),
          template: tpl('country'),
          label: 'Country',
          description: `Country associated with the observable by ${step.name}`,
          type: 'string',
          ...ctx,
        },
      ];
    }

    case 'condition': {
      return [
        {
          path: withPrefix('result'),
          template: tpl('result'),
          label: 'Condition Result',
          description: `Boolean outcome of the ${step.name} condition`,
          type: 'boolean',
          ...ctx,
        },
      ];
    }

    case 'action': {
      return [
        {
          path: withPrefix('success'),
          template: tpl('success'),
          label: 'Action Success',
          description: `Whether ${step.name} executed successfully`,
          type: 'boolean',
          ...ctx,
        },
        {
          path: withPrefix('blocked_ip'),
          template: tpl('blocked_ip'),
          label: 'Blocked IP',
          description: `IP address that was acted on by ${step.name}`,
          type: 'ip',
          ...ctx,
        },
      ];
    }

    case 'approval': {
      return [
        {
          path: withPrefix('approved'),
          template: tpl('approved'),
          label: 'Approved?',
          description: `Whether ${step.name} was approved by a human operator`,
          type: 'boolean',
          ...ctx,
        },
        {
          path: withPrefix('decision_note'),
          template: tpl('decision_note'),
          label: 'Decision Note',
          description: `Note left by the approver of ${step.name}`,
          type: 'string',
          ...ctx,
        },
      ];
    }

    default:
      return [];
  }
}

/**
 * Return trigger fields plus the outputs of every step that executes BEFORE
 * `currentStepId` in the supplied ordered list of steps. Callers should pass
 * steps in execution order (as stored in the DSL / as laid out in the canvas).
 */
export function getAllAvailableFields(
  currentStepId: string | undefined,
  allSteps: PreviousStepDescriptor[],
): ObservableField[] {
  const trigger = getTriggerDataFields();

  const currentIndex = currentStepId
    ? allSteps.findIndex((s) => s.step_id === currentStepId)
    : -1;

  // If the current step is not in the list, expose all steps' outputs.
  const previousSteps =
    currentIndex === -1 ? allSteps : allSteps.slice(0, currentIndex);

  const stepFields = previousSteps.flatMap((s) => getStepOutputFields(s));
  return [...trigger, ...stepFields];
}

// ─────────────────────────────────────────────────────────────────────────────
// React Flow helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert React Flow nodes into `PreviousStepDescriptor`s in the order they
 * appear in the `nodes` array (which is how the editor stores execution
 * order). Trigger/end/delay/stop nodes are excluded because they either have
 * no outputs of interest or are not addressable as `steps.<id>`.
 */
export function nodesToStepDescriptors(nodes: Node[]): PreviousStepDescriptor[] {
  const out: PreviousStepDescriptor[] = [];
  for (const n of nodes) {
    const data = n.data as PlaybookNodeData | undefined;
    if (!data) continue;
    const type = data.stepType;
    if (!type || type === 'trigger' || type === 'end' || type === 'stop' || type === 'delay') {
      continue;
    }
    const cfg = (data.config || {}) as Record<string, unknown>;
    out.push({
      step_id: n.id,
      type,
      name: data.label || n.id,
      connector_id: (cfg.connector_id as string) || undefined,
    });
  }
  return out;
}
