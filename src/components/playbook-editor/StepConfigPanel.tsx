import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Node } from '@xyflow/react';
import type { PlaybookNodeData } from './nodeTypes';

interface StepConfigPanelProps {
  node: Node | null;
  onClose: () => void;
  onUpdate: (nodeId: string, data: Partial<PlaybookNodeData>) => void;
}

export function StepConfigPanel({ node, onClose, onUpdate }: StepConfigPanelProps) {
  if (!node) return null;

  const nodeData = node.data as PlaybookNodeData;
  const stepType = nodeData.stepType;
  const config = nodeData.config || {};

  const handleLabelChange = (label: string) => {
    onUpdate(node.id, { label });
  };

  const handleConfigChange = (key: string, value: unknown) => {
    onUpdate(node.id, { config: { ...config, [key]: value } });
  };

  return (
    <div className="w-80 border-l border-border bg-card p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Configure Step</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Step Name</Label>
          <Input
            value={nodeData.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Enter step name..."
          />
        </div>

        {stepType === 'trigger' && (
          <>
            <div className="space-y-2">
              <Label>Source</Label>
              <Select
                value={(config.source as string) || 'wazuh'}
                onValueChange={(v) => handleConfigChange('source', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wazuh">Wazuh</SelectItem>
                  <SelectItem value="elastic">Elastic SIEM</SelectItem>
                  <SelectItem value="splunk">Splunk</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rule IDs (comma-separated)</Label>
              <Input
                value={(config.rule_ids as string) || ''}
                onChange={(e) => handleConfigChange('rule_ids', e.target.value)}
                placeholder="100002, 100003"
              />
            </div>
            <div className="space-y-2">
              <Label>Minimum Severity</Label>
              <Select
                value={(config.severity_threshold as string) || 'high'}
                onValueChange={(v) => handleConfigChange('severity_threshold', v)}
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
          </>
        )}

        {stepType === 'enrichment' && (
          <>
            <div className="space-y-2">
              <Label>Connector</Label>
              <Select
                value={(config.connector as string) || ''}
                onValueChange={(v) => handleConfigChange('connector', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select connector..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="virustotal">VirusTotal</SelectItem>
                  <SelectItem value="abuseipdb">AbuseIPDB</SelectItem>
                  <SelectItem value="shodan">Shodan</SelectItem>
                  <SelectItem value="greynoise">GreyNoise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Action</Label>
              <Select
                value={(config.action as string) || ''}
                onValueChange={(v) => handleConfigChange('action', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select action..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lookup_ip">Lookup IP</SelectItem>
                  <SelectItem value="lookup_hash">Lookup File Hash</SelectItem>
                  <SelectItem value="lookup_domain">Lookup Domain</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {stepType === 'condition' && (
          <>
            <div className="space-y-2">
              <Label>Field</Label>
              <Input
                value={(config.field as string) || ''}
                onChange={(e) => handleConfigChange('field', e.target.value)}
                placeholder="e.g., enrichment.score"
              />
            </div>
            <div className="space-y-2">
              <Label>Operator</Label>
              <Select
                value={(config.operator as string) || 'equals'}
                onValueChange={(v) => handleConfigChange('operator', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="equals">Equals</SelectItem>
                  <SelectItem value="not_equals">Not Equals</SelectItem>
                  <SelectItem value="greater_than">Greater Than</SelectItem>
                  <SelectItem value="less_than">Less Than</SelectItem>
                  <SelectItem value="contains">Contains</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value</Label>
              <Input
                value={(config.value as string) || ''}
                onChange={(e) => handleConfigChange('value', e.target.value)}
                placeholder="Enter comparison value..."
              />
            </div>
          </>
        )}

        {stepType === 'action' && (
          <>
            <div className="space-y-2">
              <Label>Connector</Label>
              <Select
                value={(config.connector as string) || ''}
                onValueChange={(v) => handleConfigChange('connector', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select connector..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wazuh">Wazuh</SelectItem>
                  <SelectItem value="crowdstrike">CrowdStrike</SelectItem>
                  <SelectItem value="paloalto">Palo Alto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Action</Label>
              <Select
                value={(config.action as string) || ''}
                onValueChange={(v) => handleConfigChange('action', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select action..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="block_ip">Block IP</SelectItem>
                  <SelectItem value="isolate_host">Isolate Host</SelectItem>
                  <SelectItem value="disable_user">Disable User</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {stepType === 'approval' && (
          <>
            <div className="space-y-2">
              <Label>Required Role</Label>
              <Select
                value={(config.required_role as string) || 'senior_analyst'}
                onValueChange={(v) => handleConfigChange('required_role', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="analyst">Analyst</SelectItem>
                  <SelectItem value="senior_analyst">Senior Analyst</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Timeout (minutes)</Label>
              <Input
                type="number"
                value={(config.timeout_minutes as number) || 60}
                onChange={(e) => handleConfigChange('timeout_minutes', parseInt(e.target.value))}
                min={1}
              />
            </div>
          </>
        )}

        {stepType === 'notification' && (
          <>
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select
                value={(config.channel as string) || 'slack'}
                onValueChange={(v) => handleConfigChange('channel', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="teams">Microsoft Teams</SelectItem>
                  <SelectItem value="pagerduty">PagerDuty</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Recipients</Label>
              <Input
                value={(config.recipients as string) || ''}
                onChange={(e) => handleConfigChange('recipients', e.target.value)}
                placeholder="#security-team or email@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Message Template</Label>
              <Textarea
                value={(config.message as string) || ''}
                onChange={(e) => handleConfigChange('message', e.target.value)}
                placeholder="Alert: {{alert.rule_name}} triggered..."
                rows={3}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
