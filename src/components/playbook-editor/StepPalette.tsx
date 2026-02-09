import { useState } from 'react';
import {
  FlaskConical, GitBranch, UserCheck, Zap, Bell, Flag,
  ChevronDown, ChevronRight, Search, Shield, Globe, Hash,
  Timer, Users, Clock, StopCircle, Mail, MessageSquare, Webhook,
  Ban, UserX, Skull, ListPlus, AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import type { StepType } from '@/types/soar';

interface StepPaletteProps {
  onDragStart: (event: React.DragEvent, stepType: StepType | 'end' | 'delay' | 'stop', stepSubtype?: string) => void;
}

// Extended step type to include subtype for specific step configurations
export type ExtendedStepType = StepType | 'end' | 'delay' | 'stop';

export interface StepDefinition {
  type: ExtendedStepType;
  subtype: string;
  label: string;
  icon: React.ElementType;
  description: string;
  color: string;
  // Default configuration for this step type
  defaultConfig: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP DEFINITIONS BY CATEGORY
// ═══════════════════════════════════════════════════════════════════════════════

const enrichmentSteps: StepDefinition[] = [
  {
    type: 'enrichment',
    subtype: 'virustotal_ip',
    label: 'VirusTotal IP Lookup',
    icon: Shield,
    description: 'Check IP reputation via VirusTotal',
    color: 'text-blue-500 bg-blue-500/10 border-blue-500/30',
    defaultConfig: {
      connector_id: 'virustotal',
      action: 'lookup_ip',
      observable_field: 'source_ip',
      output_variable: 'vt_ip_result'
    }
  },
  {
    type: 'enrichment',
    subtype: 'abuseipdb_ip',
    label: 'AbuseIPDB IP Reputation',
    icon: AlertTriangle,
    description: 'Check IP abuse confidence score',
    color: 'text-orange-500 bg-orange-500/10 border-orange-500/30',
    defaultConfig: {
      connector_id: 'abuseipdb',
      action: 'check_ip',
      observable_field: 'source_ip',
      output_variable: 'abuseipdb_result'
    }
  },
  {
    type: 'enrichment',
    subtype: 'alienvault_ip',
    label: 'AlienVault OTX IP',
    icon: Globe,
    description: 'Query AlienVault OTX for IP intel',
    color: 'text-purple-500 bg-purple-500/10 border-purple-500/30',
    defaultConfig: {
      connector_id: 'alienvault-otx',
      action: 'lookup_ip',
      observable_field: 'source_ip',
      output_variable: 'otx_ip_result'
    }
  },
  {
    type: 'enrichment',
    subtype: 'alienvault_hash',
    label: 'AlienVault OTX Hash',
    icon: Hash,
    description: 'Query AlienVault OTX for file hash',
    color: 'text-purple-500 bg-purple-500/10 border-purple-500/30',
    defaultConfig: {
      connector_id: 'alienvault-otx',
      action: 'lookup_hash',
      observable_field: 'file_hash',
      output_variable: 'otx_hash_result'
    }
  },
  {
    type: 'enrichment',
    subtype: 'alienvault_domain',
    label: 'AlienVault OTX Domain',
    icon: Globe,
    description: 'Query AlienVault OTX for domain intel',
    color: 'text-purple-500 bg-purple-500/10 border-purple-500/30',
    defaultConfig: {
      connector_id: 'alienvault-otx',
      action: 'lookup_domain',
      observable_field: 'domain',
      output_variable: 'otx_domain_result'
    }
  },
  {
    type: 'enrichment',
    subtype: 'geoip',
    label: 'GeoIP Enrichment',
    icon: Globe,
    description: 'Get geographic location for IP',
    color: 'text-green-500 bg-green-500/10 border-green-500/30',
    defaultConfig: {
      connector_id: 'geoip',
      action: 'lookup_ip',
      observable_field: 'source_ip',
      output_variable: 'geoip_result'
    }
  },
  {
    type: 'enrichment',
    subtype: 'dns_reverse',
    label: 'DNS Reverse Lookup',
    icon: Globe,
    description: 'Perform reverse DNS lookup',
    color: 'text-cyan-500 bg-cyan-500/10 border-cyan-500/30',
    defaultConfig: {
      connector_id: 'dns',
      action: 'reverse_lookup',
      observable_field: 'source_ip',
      output_variable: 'dns_result'
    }
  },
];

const conditionSteps: StepDefinition[] = [
  {
    type: 'condition',
    subtype: 'severity_threshold',
    label: 'Severity Threshold',
    icon: AlertTriangle,
    description: 'Check if severity >= threshold',
    color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
    defaultConfig: {
      field: 'severity',
      operator: 'greater_or_equal',
      value: 'high',
      severity_levels: ['critical', 'high', 'medium', 'low']
    }
  },
  {
    type: 'condition',
    subtype: 'match_field',
    label: 'Match Field',
    icon: GitBranch,
    description: 'Match rule.id, agent.name, src.ip, etc.',
    color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
    defaultConfig: {
      field: 'rule_id',
      operator: 'equals',
      value: ''
    }
  },
  {
    type: 'condition',
    subtype: 'failed_attempts',
    label: 'Failed Attempts Count',
    icon: AlertTriangle,
    description: 'Check failed login attempts count',
    color: 'text-red-500 bg-red-500/10 border-red-500/30',
    defaultConfig: {
      field: 'failed_attempts',
      operator: 'greater_or_equal',
      value: 5
    }
  },
  {
    type: 'condition',
    subtype: 'time_window',
    label: 'Time Window Condition',
    icon: Clock,
    description: 'N events in M minutes threshold',
    color: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
    defaultConfig: {
      field: 'event_count',
      operator: 'greater_or_equal',
      value: 5,
      time_window_minutes: 2
    }
  },
  {
    type: 'condition',
    subtype: 'reputation_check',
    label: 'Reputation Check',
    icon: Shield,
    description: 'Check enrichment reputation score',
    color: 'text-orange-500 bg-orange-500/10 border-orange-500/30',
    defaultConfig: {
      field: 'enrichment.reputation_score',
      operator: 'greater_than',
      value: 50
    }
  },
];

const actionSteps: StepDefinition[] = [
  {
    type: 'action',
    subtype: 'cybersentinel_block_ip',
    label: 'Block IP (CyberSentinel)',
    icon: Shield,
    description: 'Add IP to CyberSentinel Blocklist',
    color: 'text-red-500 bg-red-500/10 border-red-500/30',
    defaultConfig: {
      connector_id: 'cybersentinel_blocklist',
      action: 'cybersentinel_block_ip',
      parameters: {
        ip: '{{trigger_data.source_ip}}',
        reason: 'Blocked by CyberSentinel playbook',
        ttl: ''
      }
    }
  },
  {
    type: 'action',
    subtype: 'block_ip',
    label: 'Block IP (Firewall)',
    icon: Ban,
    description: 'Block IP via Firewall',
    color: 'text-red-500 bg-red-500/10 border-red-500/30',
    defaultConfig: {
      connector_id: 'firewall',
      action: 'block_ip',
      parameters: {
        ip: '{{trigger_data.source_ip}}',
        duration: '24h',
        reason: 'Blocked by CyberSentinel playbook'
      }
    }
  },
  {
    type: 'action',
    subtype: 'disable_user',
    label: 'Disable User',
    icon: UserX,
    description: 'Disable user account (Linux/AD)',
    color: 'text-red-500 bg-red-500/10 border-red-500/30',
    defaultConfig: {
      connector_id: 'active-directory',
      action: 'disable_user',
      parameters: {
        username: '{{trigger_data.username}}',
        reason: 'Account disabled by CyberSentinel'
      }
    }
  },
  {
    type: 'action',
    subtype: 'kill_process',
    label: 'Kill Process',
    icon: Skull,
    description: 'Terminate process by PID or name',
    color: 'text-red-600 bg-red-600/10 border-red-600/30',
    defaultConfig: {
      connector_id: 'cybersentinel',
      action: 'kill_process',
      parameters: {
        agent_id: '{{trigger_data.agent_id}}',
        pid: '',
        process_name: ''
      }
    }
  },
  {
    type: 'action',
    subtype: 'add_watchlist',
    label: 'Add IP to Watchlist',
    icon: ListPlus,
    description: 'Add IP to monitoring watchlist',
    color: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
    defaultConfig: {
      connector_id: 'watchlist',
      action: 'add_ip',
      parameters: {
        ip: '{{trigger_data.source_ip}}',
        watchlist_name: 'suspicious_ips',
        ttl_hours: 72
      }
    }
  },
  {
    type: 'action',
    subtype: 'isolate_host',
    label: 'Isolate Host',
    icon: Shield,
    description: 'Network isolate compromised host',
    color: 'text-red-700 bg-red-700/10 border-red-700/30',
    defaultConfig: {
      connector_id: 'edr',
      action: 'isolate_host',
      parameters: {
        agent_id: '{{trigger_data.agent_id}}',
        reason: 'Host isolated by CyberSentinel'
      }
    }
  },
];

const notificationSteps: StepDefinition[] = [
  {
    type: 'notification',
    subtype: 'email_smtp',
    label: 'Email (SMTP)',
    icon: Mail,
    description: 'Send email via SMTP connector',
    color: 'text-blue-500 bg-blue-500/10 border-blue-500/30',
    defaultConfig: {
      connector_id: 'smtp',
      channel: 'email',
      recipients: 'soc-team@example.com',
      subject: 'Security Alert: {{trigger_data.rule_name}}',
      message: 'Alert Details:\nRule: {{trigger_data.rule_name}}\nSeverity: {{trigger_data.severity}}\nSource IP: {{trigger_data.source_ip}}\nTimestamp: {{trigger_data.timestamp}}'
    }
  },
  {
    type: 'notification',
    subtype: 'slack',
    label: 'Slack',
    icon: MessageSquare,
    description: 'Send Slack notification',
    color: 'text-purple-500 bg-purple-500/10 border-purple-500/30',
    defaultConfig: {
      connector_id: 'slack',
      channel: 'slack',
      recipients: '#security-alerts',
      message: ':warning: *Security Alert*\n*Rule:* {{trigger_data.rule_name}}\n*Severity:* {{trigger_data.severity}}\n*Source IP:* {{trigger_data.source_ip}}'
    }
  },
  {
    type: 'notification',
    subtype: 'webhook_custom',
    label: 'Webhook (Custom HTTP)',
    icon: Webhook,
    description: 'Send to custom webhook endpoint',
    color: 'text-green-500 bg-green-500/10 border-green-500/30',
    defaultConfig: {
      connector_id: 'webhook',
      channel: 'webhook',
      recipients: 'https://webhook.example.com/alerts',
      message: '{{trigger_data}}'
    }
  },
];

const controlSteps: StepDefinition[] = [
  {
    type: 'approval',
    subtype: 'approval_analyst',
    label: 'Approval (SOC Analyst)',
    icon: UserCheck,
    description: 'Require SOC Analyst approval',
    color: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
    defaultConfig: {
      approver_role: 'analyst',
      timeout_seconds: 3600,
      approval_message: 'Approve action for alert {{trigger_data.rule_name}}?',
      auto_skip_severity: null
    }
  },
  {
    type: 'approval',
    subtype: 'approval_manager',
    label: 'Approval (SOC Manager)',
    icon: Users,
    description: 'Require SOC Manager approval',
    color: 'text-orange-500 bg-orange-500/10 border-orange-500/30',
    defaultConfig: {
      approver_role: 'senior_analyst',
      timeout_seconds: 7200,
      approval_message: 'Manager approval required for {{trigger_data.rule_name}}',
      auto_skip_severity: 'critical'
    }
  },
  {
    type: 'delay' as ExtendedStepType,
    subtype: 'delay_wait',
    label: 'Delay / Wait',
    icon: Timer,
    description: 'Pause execution for specified time',
    color: 'text-slate-500 bg-slate-500/10 border-slate-500/30',
    defaultConfig: {
      duration_seconds: 60
    }
  },
  {
    type: 'stop' as ExtendedStepType,
    subtype: 'stop_execution',
    label: 'Stop Execution',
    icon: StopCircle,
    description: 'Terminate playbook execution',
    color: 'text-gray-500 bg-gray-500/10 border-gray-500/30',
    defaultConfig: {
      reason: 'Execution stopped by playbook logic'
    }
  },
];

// Category definitions
interface StepCategory {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  steps: StepDefinition[];
}

const stepCategories: StepCategory[] = [
  {
    id: 'enrichment',
    label: 'Enrichment',
    icon: FlaskConical,
    color: 'text-chart-1',
    steps: enrichmentSteps
  },
  {
    id: 'condition',
    label: 'Condition',
    icon: GitBranch,
    color: 'text-chart-3',
    steps: conditionSteps
  },
  {
    id: 'action',
    label: 'Action',
    icon: Zap,
    color: 'text-chart-5',
    steps: actionSteps
  },
  {
    id: 'notification',
    label: 'Notification',
    icon: Bell,
    color: 'text-chart-2',
    steps: notificationSteps
  },
  {
    id: 'control',
    label: 'Control',
    icon: UserCheck,
    color: 'text-chart-4',
    steps: controlSteps
  },
];

// Export step definitions for use in other components
export const allStepDefinitions: Map<string, StepDefinition> = new Map();
stepCategories.forEach(cat => {
  cat.steps.forEach(step => {
    allStepDefinitions.set(step.subtype, step);
  });
});

export function getStepDefinition(subtype: string): StepDefinition | undefined {
  return allStepDefinitions.get(subtype);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP PALETTE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function StepPalette({ onDragStart }: StepPaletteProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['enrichment', 'condition', 'action', 'notification', 'control'])
  );
  const [searchQuery, setSearchQuery] = useState('');

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const handleDragStart = (event: React.DragEvent, step: StepDefinition) => {
    // Store both the type and the full step definition in dataTransfer
    event.dataTransfer.setData('application/reactflow', step.type);
    event.dataTransfer.setData('application/step-subtype', step.subtype);
    event.dataTransfer.setData('application/step-config', JSON.stringify(step.defaultConfig));
    event.dataTransfer.setData('application/step-label', step.label);
    event.dataTransfer.effectAllowed = 'move';

    // Call the parent handler
    onDragStart(event, step.type, step.subtype);
  };

  // Filter steps based on search
  const filteredCategories = stepCategories.map(category => ({
    ...category,
    steps: category.steps.filter(step =>
      searchQuery === '' ||
      step.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      step.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })).filter(category => category.steps.length > 0);

  return (
    <div className="w-72 border-r border-border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold text-sm mb-1">Step Palette</h3>
        <p className="text-xs text-muted-foreground mb-3">Drag steps to the canvas</p>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search steps..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredCategories.map((category) => {
          const isExpanded = expandedCategories.has(category.id);
          const CategoryIcon = category.icon;

          return (
            <div key={category.id} className="rounded-lg border border-border/50 overflow-hidden">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.id)}
                className="w-full flex items-center gap-2 p-2.5 hover:bg-muted/50 transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <CategoryIcon className={cn('h-4 w-4', category.color)} />
                <span className="text-sm font-medium flex-1 text-left">{category.label}</span>
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {category.steps.length}
                </span>
              </button>

              {/* Category Steps */}
              {isExpanded && (
                <div className="p-1.5 pt-0 space-y-1">
                  {category.steps.map((step) => {
                    const StepIcon = step.icon;
                    return (
                      <div
                        key={step.subtype}
                        draggable
                        onDragStart={(e) => handleDragStart(e, step)}
                        className={cn(
                          'flex items-center gap-2.5 p-2.5 rounded-md border cursor-grab active:cursor-grabbing',
                          'transition-all hover:scale-[1.01] hover:shadow-sm',
                          step.color
                        )}
                      >
                        <div className="p-1.5 rounded bg-background/60">
                          <StepIcon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{step.label}</p>
                          <p className="text-[10px] opacity-70 truncate">{step.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* End Node */}
        <div className="mt-2 pt-2 border-t border-border">
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/reactflow', 'end');
              e.dataTransfer.setData('application/step-subtype', 'end');
              e.dataTransfer.effectAllowed = 'move';
              onDragStart(e, 'end', 'end');
            }}
            className={cn(
              'flex items-center gap-2.5 p-2.5 rounded-md border cursor-grab active:cursor-grabbing',
              'transition-all hover:scale-[1.01] hover:shadow-sm',
              'text-muted-foreground bg-muted/50 border-border'
            )}
          >
            <div className="p-1.5 rounded bg-background/60">
              <Flag className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">End</p>
              <p className="text-[10px] opacity-70">Terminate workflow</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
