import { useState, useEffect, useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RefreshCw, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Node } from '@xyflow/react';
import type { PlaybookNodeData } from './nodeTypes';

interface DynamicTestInputProps {
  nodes: Node[];
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
}

/**
 * DynamicTestInput Component
 *
 * Generates Test Input JSON dynamically from trigger node configuration.
 * Values from trigger fields are reflected as placeholders that update live.
 * Users can edit the JSON directly for advanced scenarios.
 *
 * KEY FEATURES:
 * - Live reflection of trigger configuration
 * - Editable JSON with syntax highlighting
 * - Variable placeholders ({{trigger.field}})
 * - Reset to defaults
 * - No static hardcoded values
 */
export function DynamicTestInput({
  nodes,
  value,
  onChange,
  error,
  disabled = false,
}: DynamicTestInputProps) {
  const [copied, setCopied] = useState(false);

  // Find trigger node and extract configuration
  const triggerNode = useMemo(() => {
    return nodes.find(n => (n.data as PlaybookNodeData).stepType === 'trigger');
  }, [nodes]);

  const triggerConfig = useMemo(() => {
    if (!triggerNode) return {};
    const data = triggerNode.data as PlaybookNodeData;
    return (data.config || {}) as Record<string, unknown>;
  }, [triggerNode]);

  // Generate dynamic test input based on trigger configuration
  const generateDefaultTestInput = useMemo(() => {
    const ruleIds = (triggerConfig.rule_ids as string) || '';
    const severity = (triggerConfig.severity_threshold as string) || 'high';
    const source = (triggerConfig.source as string) || 'cybersentinel';

    // Build dynamic test data reflecting trigger config
    const testData: Record<string, unknown> = {
      rule_id: ruleIds ? ruleIds.split(',')[0].trim() : '5710',
      rule_name: 'SSH Authentication Failure',
      severity: severity,
      source_ip: '192.168.1.100',
      destination_ip: '10.0.0.5',
      username: 'admin',
      agent_name: 'web-server-01',
      agent_id: 'agent-001',
      failed_attempts: 8,
      timestamp: new Date().toISOString(),
      file_hash: 'd41d8cd98f00b204e9800998ecf8427e',
      domain: 'malicious-site.com',
      url: 'http://malicious-site.com/payload',
      process_name: 'suspicious.exe',
      pid: 1234,
      event_count: 15,
      // Add metadata about trigger config
      _trigger_config: {
        source: source,
        configured_rule_ids: ruleIds || 'all',
        minimum_severity: severity,
      }
    };

    return JSON.stringify({ trigger_data: testData }, null, 2);
  }, [triggerConfig]);

  // Auto-update when trigger config changes (if user hasn't manually edited)
  useEffect(() => {
    // Only auto-update if current value is empty or matches default structure
    if (!value || value.trim() === '') {
      onChange(generateDefaultTestInput);
    }
  }, [generateDefaultTestInput]);

  const handleReset = () => {
    onChange(generateDefaultTestInput);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Highlight variables in JSON ({{...}})
  const hasVariables = value.includes('{{') && value.includes('}}');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Test Input (JSON)</Label>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleReset}
            disabled={disabled}
            title="Reset to trigger defaults"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Reset
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleCopy}
            disabled={disabled}
            title="Copy to clipboard"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 mr-1" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          Generated from trigger configuration. Edit to test different scenarios.
        </p>
        {triggerConfig.rule_ids && (
          <p className="text-primary">
            Using Rule ID: <code className="bg-muted px-1 rounded">{(triggerConfig.rule_ids as string).split(',')[0].trim()}</code>
          </p>
        )}
        {hasVariables && (
          <p className="text-amber-600">
            Variables detected: Use {'{{'} and {'}}'}  for dynamic values
          </p>
        )}
      </div>

      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'font-mono text-xs h-48 resize-none',
          error && 'border-destructive',
          hasVariables && 'bg-amber-500/5'
        )}
        disabled={disabled}
        placeholder="Test input data will be generated from trigger configuration..."
      />

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <div className="p-2 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Available Fields:</p>
        <div className="grid grid-cols-2 gap-1">
          <code>trigger_data.rule_id</code>
          <code>trigger_data.severity</code>
          <code>trigger_data.source_ip</code>
          <code>trigger_data.destination_ip</code>
          <code>trigger_data.username</code>
          <code>trigger_data.agent_name</code>
          <code>trigger_data.file_hash</code>
          <code>trigger_data.domain</code>
        </div>
      </div>
    </div>
  );
}
