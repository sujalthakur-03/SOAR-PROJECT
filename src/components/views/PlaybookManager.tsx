import { useState } from 'react';
import {
  PlayCircle,
  Plus,
  Search,
  MoreVertical,
  Trash2,
  Copy,
  Edit,
  Play,
  ArrowRight,
  Zap,
  GitBranch,
  UserCheck,
  Bell,
  FlaskConical,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { TimeAgo } from '@/components/common/TimeDisplay';
import {
  usePlaybooks,
  useTogglePlaybook,
  useDeletePlaybook,
  useCreatePlaybook,
  useUpdatePlaybook,
  type Playbook
} from '@/hooks/usePlaybooks';
import { useCreateExecution } from '@/hooks/useExecutions';
import { useUserRole } from '@/hooks/useUserRole';
import { canEditFeature, canDeleteFeature } from '@/lib/permissions';
import { useToast } from '@/hooks/use-toast';
import type { StepType, Severity } from '@/types/soar';
import { cn } from '@/lib/utils';
import { VisualPlaybookEditor } from '@/components/playbook-editor/VisualPlaybookEditor';

const stepTypeIcons: Record<StepType, React.ElementType> = {
  enrichment: FlaskConical,
  condition: GitBranch,
  approval: UserCheck,
  action: Zap,
  notification: Bell,
};

const stepTypeColors: Record<StepType, string> = {
  enrichment: 'text-chart-1',
  condition: 'text-chart-3',
  approval: 'text-chart-4',
  action: 'text-chart-5',
  notification: 'text-chart-2',
};

export function PlaybookManager() {
  const { data, isLoading } = usePlaybooks();
  const playbooks = Array.isArray(data) ? data : [];
  const togglePlaybook = useTogglePlaybook();
  const deletePlaybook = useDeletePlaybook();
  const createPlaybook = useCreatePlaybook();
  const updatePlaybook = useUpdatePlaybook();
  const createExecution = useCreateExecution();
  const { role } = useUserRole();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [playbookToDelete, setPlaybookToDelete] = useState<Playbook | null>(null);
  const [playbookToSimulate, setPlaybookToSimulate] = useState<Playbook | null>(null);
  const [simulateTriggerData, setSimulateTriggerData] = useState('');
  const [selectedScenario, setSelectedScenario] = useState<string>('');
  const [simulationResult, setSimulationResult] = useState<{ execution_id: string; state: string } | null>(null);

  const canEdit = canEditFeature('playbooks', role);
  const canDelete = canDeleteFeature('playbooks', role);

  const filteredPlaybooks = playbooks.filter(
    (pb) =>
      pb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (pb.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
  );

  const handleToggle = async (id: string, currentEnabled: boolean, version: number) => {
    try {
      // Pass version so backend can find the specific version to toggle,
      // even when the playbook is disabled (no "active" version to look up).
      await togglePlaybook.mutateAsync({ id, enabled: !currentEnabled, version });
      toast({ title: `Playbook ${!currentEnabled ? 'enabled' : 'disabled'}` });
    } catch (error) {
      toast({ title: 'Failed to update playbook', variant: 'destructive' });
    }
  };

  const handleConfirmDelete = async () => {
    if (!playbookToDelete) return;
    try {
      await deletePlaybook.mutateAsync(playbookToDelete.id);
      toast({ title: `Playbook "${playbookToDelete.name}" deleted` });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to delete playbook';
      toast({ title: 'Failed to delete playbook', description: msg, variant: 'destructive' });
    } finally {
      setPlaybookToDelete(null);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMULATION SCENARIOS
  // Analyses the playbook's trigger config and steps to generate realistic
  // CyberSentinel EDR alert payloads that match what the forwarder would send.
  // ═══════════════════════════════════════════════════════════════════════════

  interface SimScenario {
    id: string;
    label: string;
    description: string;
    data: Record<string, unknown>;
  }

  const buildScenarios = (playbook: Playbook): SimScenario[] => {
    const trigger = playbook.trigger as {
      rule_ids?: string | string[];
      severity_threshold?: string;
      source?: string;
    } | null;
    const steps = (playbook.steps || []) as Record<string, unknown>[];

    // Extract rule IDs from trigger
    const rawRuleIds = trigger?.rule_ids;
    const ruleIds: string[] = Array.isArray(rawRuleIds)
      ? rawRuleIds
      : typeof rawRuleIds === 'string' && rawRuleIds.trim()
        ? rawRuleIds.split(',').map(s => s.trim()).filter(Boolean)
        : [];
    const primaryRuleId = ruleIds[0] || '5710';
    const severity = trigger?.severity_threshold || 'high';

    // Detect what the playbook steps actually need
    const hasEnrichment = steps.some((s: any) => s.type === 'enrichment');
    const hasBlockIP = steps.some((s: any) =>
      s.type === 'action' && (s.action_type?.includes('block_ip') || s.parameters?.ip)
    );
    const hasCondition = steps.some((s: any) => s.type === 'condition');
    const hasApproval = steps.some((s: any) => s.type === 'approval');
    const hasNotification = steps.some((s: any) => s.type === 'notification');

    // Extract observable fields used by enrichment steps
    const observableFields = new Set<string>();
    steps.forEach((s: any) => {
      if (s.type === 'enrichment' && s.parameters?.observable_field) {
        observableFields.add(s.parameters.observable_field);
      }
    });

    // Extract condition fields to understand what data the playbook evaluates
    const conditionFields = new Set<string>();
    steps.forEach((s: any) => {
      if (s.type === 'condition' && s.condition?.field) {
        conditionFields.add(s.condition.field);
      }
    });

    const now = new Date().toISOString();
    const scenarios: SimScenario[] = [];

    // ── Scenario 1: Matching alert that should trigger the full flow ──
    scenarios.push({
      id: 'matching-alert',
      label: 'Matching Alert (Full Flow)',
      description: `Realistic alert matching rule ${primaryRuleId} at ${severity} severity. Exercises all playbook steps.`,
      data: {
        timestamp: now,
        rule: {
          id: primaryRuleId,
          name: detectRuleName(primaryRuleId),
          level: severityToLevel(severity),
        },
        agent: {
          id: '001',
          name: 'web-server-01',
          ip: '10.0.0.5',
        },
        data: {
          source_ip: '203.0.113.47',
          destination_ip: '10.0.0.5',
          protocol: 'ssh',
          attempts: 23,
          user: 'root',
        },
        severity,
        // Flattened fields used by the execution engine input resolver
        rule_id: primaryRuleId,
        rule_name: detectRuleName(primaryRuleId),
        source_ip: '203.0.113.47',
        destination_ip: '10.0.0.5',
        username: 'root',
        agent_name: 'web-server-01',
        agent_id: 'agent-001',
        failed_attempts: 23,
        event_count: 23,
        mitre_technique: 'T1110.001',
        mitre_tactic: 'Credential Access',
      },
    });

    // ── Scenario 2: Known-malicious IP (triggers block path) ──
    if (hasEnrichment || hasBlockIP) {
      scenarios.push({
        id: 'malicious-ip',
        label: 'Known Malicious IP',
        description: 'Source IP from a known C2 server. Enrichment should flag it, condition should route to block.',
        data: {
          timestamp: now,
          rule: {
            id: primaryRuleId,
            name: detectRuleName(primaryRuleId),
            level: 12,
          },
          agent: {
            id: '003',
            name: 'prod-app-01',
            ip: '10.0.0.10',
          },
          data: {
            source_ip: '185.220.101.34',
            destination_ip: '10.0.0.10',
            protocol: 'ssh',
            attempts: 150,
            user: 'admin',
          },
          severity: 'critical',
          rule_id: primaryRuleId,
          rule_name: detectRuleName(primaryRuleId),
          source_ip: '185.220.101.34',
          destination_ip: '10.0.0.10',
          username: 'admin',
          agent_name: 'prod-app-01',
          agent_id: 'agent-003',
          failed_attempts: 150,
          event_count: 150,
          file_hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
          domain: 'c2-server.evil.net',
          mitre_technique: 'T1071.001',
          mitre_tactic: 'Command and Control',
        },
      });
    }

    // ── Scenario 3: Benign IP (should NOT trigger block) ──
    if (hasCondition) {
      scenarios.push({
        id: 'benign-ip',
        label: 'Benign Source (False Positive)',
        description: 'Internal IP with low failed attempts. Tests the false-positive path where conditions evaluate to false.',
        data: {
          timestamp: now,
          rule: {
            id: primaryRuleId,
            name: detectRuleName(primaryRuleId),
            level: 5,
          },
          agent: {
            id: '002',
            name: 'dev-server-01',
            ip: '10.0.1.20',
          },
          data: {
            source_ip: '10.0.1.50',
            destination_ip: '10.0.1.20',
            protocol: 'ssh',
            attempts: 2,
            user: 'developer',
          },
          severity: 'low',
          rule_id: primaryRuleId,
          rule_name: detectRuleName(primaryRuleId),
          source_ip: '10.0.1.50',
          destination_ip: '10.0.1.20',
          username: 'developer',
          agent_name: 'dev-server-01',
          agent_id: 'agent-002',
          failed_attempts: 2,
          event_count: 2,
          mitre_technique: 'T1078',
          mitre_tactic: 'Initial Access',
        },
      });
    }

    // ── Scenario 4: Critical infrastructure alert ──
    if (hasApproval || hasNotification) {
      scenarios.push({
        id: 'critical-infra',
        label: 'Critical Infrastructure',
        description: 'Alert from a production database server. Should trigger approval gates and SOC notifications.',
        data: {
          timestamp: now,
          rule: {
            id: primaryRuleId,
            name: detectRuleName(primaryRuleId),
            level: 15,
          },
          agent: {
            id: '005',
            name: 'db-primary-01',
            ip: '10.0.0.20',
          },
          data: {
            source_ip: '192.168.1.200',
            destination_ip: '10.0.0.20',
            protocol: 'ssh',
            attempts: 50,
            user: 'root',
          },
          severity: 'critical',
          rule_id: primaryRuleId,
          rule_name: detectRuleName(primaryRuleId),
          source_ip: '192.168.1.200',
          destination_ip: '10.0.0.20',
          username: 'root',
          agent_name: 'db-primary-01',
          agent_id: 'agent-005',
          failed_attempts: 50,
          event_count: 50,
          mitre_technique: 'T1110.003',
          mitre_tactic: 'Credential Access',
        },
      });
    }

    return scenarios;
  };

  function detectRuleName(ruleId: string): string {
    const ruleNames: Record<string, string> = {
      '5710': 'SSH Brute Force Attempt',
      '5712': 'SSH Authentication Failure',
      '5720': 'Multiple SSH Failures',
      '87100': 'Malware Detected',
      '87101': 'Ransomware Signature',
      '87102': 'Trojan Detected',
      '5401': 'Sudo Command Executed',
      '5402': 'Su Command Executed',
      '5501': 'PAM Authentication Failure',
      '80001': 'Network Anomaly Detected',
      '120000': 'SSH Failed Login',
    };
    return ruleNames[ruleId] || `Alert Rule ${ruleId}`;
  }

  function severityToLevel(severity: string): number {
    switch (severity) {
      case 'critical': return 15;
      case 'high': return 10;
      case 'medium': return 7;
      case 'low': return 3;
      default: return 5;
    }
  }

  const handleOpenSimulate = (playbook: Playbook) => {
    const scenarios = buildScenarios(playbook);
    const first = scenarios[0];
    setSelectedScenario(first.id);
    setSimulateTriggerData(JSON.stringify(first.data, null, 2));
    setSimulationResult(null);
    setPlaybookToSimulate(playbook);
  };

  const handleScenarioChange = (scenarioId: string) => {
    if (!playbookToSimulate) return;
    const scenarios = buildScenarios(playbookToSimulate);
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (scenario) {
      setSelectedScenario(scenarioId);
      setSimulateTriggerData(JSON.stringify(scenario.data, null, 2));
    }
  };

  const handleConfirmSimulate = async () => {
    if (!playbookToSimulate) return;

    let triggerData: any;
    try {
      triggerData = JSON.parse(simulateTriggerData);
    } catch {
      toast({ title: 'Invalid JSON', description: 'Fix the trigger data JSON and try again.', variant: 'destructive' });
      return;
    }

    try {
      const result = await createExecution.mutateAsync({
        playbook_id: playbookToSimulate.playbook_id || playbookToSimulate.id,
        trigger_data: triggerData,
        trigger_source: 'simulation',
      });
      const execId = result.execution_id || result.id;
      setSimulationResult({ execution_id: execId, state: result.state || 'EXECUTING' });
      toast({
        title: 'Simulation started',
        description: `Execution ${execId} created`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to start simulation';
      toast({ title: 'Simulation failed', description: msg, variant: 'destructive' });
    }
  };

  const handleSavePlaybook = async (data: {
    playbook_id?: string;
    name: string;
    description: string;
    trigger: Record<string, unknown>;
    steps: Record<string, unknown>[];
  }) => {
    try {
      const { playbook_id, ...playbookData } = data;

      if (playbook_id) {
        // EDIT MODE: Use PUT /api/playbooks/:id
        await updatePlaybook.mutateAsync({
          id: playbook_id,
          data: playbookData,
        });
        toast({ title: 'Playbook updated successfully' });
        setIsEditorOpen(false);
        setSelectedPlaybook(null);
      } else {
        // CREATE MODE: Use POST /api/playbooks
        const result = await createPlaybook.mutateAsync(playbookData);
        toast({
          title: 'Playbook created successfully',
          description: 'Configure the webhook and trigger below.',
        });
        // Reopen in edit mode with the new playbook_id so user can
        // immediately see the ID, activate webhook, and set trigger conditions
        setSelectedPlaybook({
          id: result.playbook_id,
          playbook_id: result.playbook_id,
          name: data.name,
          description: data.description || null,
          enabled: true,
          version: result.version || 1,
          trigger: data.trigger,
          steps: data.steps as Record<string, unknown>[],
          created_at: result.created_at || new Date().toISOString(),
          updated_at: result.updated_at || new Date().toISOString(),
        });
        setIsEditorOpen(true);
      }
    } catch (error) {
      const action = data.playbook_id ? 'update' : 'create';
      const errorMessage = error instanceof Error ? error.message : `Failed to ${action} playbook`;

      // Show detailed error message from backend validation
      toast({
        title: `Failed to ${action} playbook`,
        description: errorMessage,
        variant: 'destructive',
      });

      console.error(`Playbook ${action} failed:`, error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show visual editor when open
  if (isEditorOpen || selectedPlaybook) {
    return (
      <VisualPlaybookEditor
        playbook={selectedPlaybook}
        onSave={handleSavePlaybook}
        onClose={() => {
          setIsEditorOpen(false);
          setSelectedPlaybook(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <PlayCircle className="h-6 w-6 text-primary" />
            Playbooks
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Create and manage automated response playbooks
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setIsEditorOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Playbook
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search playbooks..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Playbooks Grid */}
      {filteredPlaybooks.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No playbooks found
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredPlaybooks.map((playbook) => {
            // SOAR v3 Option A: Triggers own playbooks, not vice versa
            // Safely extract trigger metadata with defensive fallbacks
            const trigger = playbook.trigger as { source?: string; rule_ids?: string | string[]; severity_threshold?: Severity } | null | undefined;
            const steps = playbook.steps as { step_id: string; type: StepType; name: string }[];

            // Normalize rule_ids: config input stores as string, backend may return array
            const rawRuleIds = trigger?.rule_ids;
            const ruleIdsList: string[] = Array.isArray(rawRuleIds)
              ? rawRuleIds
              : typeof rawRuleIds === 'string' && rawRuleIds.trim()
                ? rawRuleIds.split(',').map(s => s.trim()).filter(Boolean)
                : [];

            // Ingestion method: webhook (default), CyberSentinel alerts, scheduled, manual
            const ingestionMethod = trigger?.source || 'Webhook';
            const hasRuleBinding = ruleIdsList.length > 0;
            const hasSeverityFilter = trigger?.severity_threshold;

            return (
              <Card
                key={playbook.id}
                className={cn(
                  'transition-all hover:border-primary/50',
                  !playbook.enabled && 'opacity-60'
                )}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {canEdit && (
                        <Switch
                          checked={playbook.enabled}
                          onCheckedChange={() => handleToggle(playbook.id, playbook.enabled, playbook.version)}
                        />
                      )}
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {playbook.name}
                          <Badge variant="outline" className="text-xs font-normal">
                            v{playbook.version}
                          </Badge>
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {playbook.description}
                        </p>
                      </div>
                    </div>
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSelectedPlaybook(playbook)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Copy className="h-4 w-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenSimulate(playbook)}>
                            <Play className="h-4 w-4 mr-2" />
                            Simulate
                          </DropdownMenuItem>
                          {canDelete && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setPlaybookToDelete(playbook)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Ingestion Method - SOAR v3 compliant terminology */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Ingestion:</span>
                    <Badge variant="secondary" className="text-xs">
                      {ingestionMethod}
                    </Badge>
                    {hasRuleBinding && (
                      <>
                        <span className="text-muted-foreground">•</span>
                        <span className="font-mono">
                          Rules: {ruleIdsList.join(', ')}
                        </span>
                      </>
                    )}
                    {hasSeverityFilter && (
                      <>
                        <span className="text-muted-foreground">•</span>
                        <SeverityBadge severity={trigger.severity_threshold!} />
                      </>
                    )}
                    {!hasRuleBinding && !hasSeverityFilter && (
                      <>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">Manual/API execution</span>
                      </>
                    )}
                  </div>

                  {/* Steps Visualization */}
                  <div className="flex items-center gap-1 overflow-x-auto py-2">
                    {steps.map((step, index) => {
                      const Icon = stepTypeIcons[step.type] || Zap;
                      return (
                        <div key={step.step_id || `step-${index}`} className="flex items-center">
                          <div
                            className={cn(
                              'flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs',
                              stepTypeColors[step.type] || 'text-foreground'
                            )}
                          >
                            <Icon className="h-3 w-3" />
                            <span className="whitespace-nowrap">{step.name}</span>
                          </div>
                          {index < steps.length - 1 && (
                            <ArrowRight className="h-3 w-3 mx-1 text-muted-foreground flex-shrink-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                    <span>
                      <strong className="text-foreground">{playbook.executionCount}</strong>{' '}
                      executions
                    </span>
                    {playbook.lastExecution && (
                      <span>
                        Last run <TimeAgo date={playbook.lastExecution} className="text-xs" />
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!playbookToDelete} onOpenChange={(open) => { if (!open) setPlaybookToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Playbook</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{playbookToDelete?.name}</strong> and all its
              version history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Simulate Dialog */}
      <Dialog open={!!playbookToSimulate} onOpenChange={(open) => { if (!open) { setPlaybookToSimulate(null); setSimulationResult(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              Simulate: {playbookToSimulate?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Scenario picker */}
            {playbookToSimulate && (() => {
              const scenarios = buildScenarios(playbookToSimulate);
              return (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Alert Scenario</Label>
                  <div className="grid gap-2">
                    {scenarios.map((scenario) => (
                      <button
                        key={scenario.id}
                        type="button"
                        onClick={() => handleScenarioChange(scenario.id)}
                        className={cn(
                          'text-left p-3 rounded-lg border transition-all',
                          selectedScenario === scenario.id
                            ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                            : 'border-border hover:border-primary/40 hover:bg-muted/50'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{scenario.label}</span>
                          {selectedScenario === scenario.id && (
                            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                              Selected
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{scenario.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Editable trigger data */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Trigger Data (editable)</Label>
                <span className="text-[10px] text-muted-foreground font-mono">
                  trigger_source: simulation
                </span>
              </div>
              <Textarea
                value={simulateTriggerData}
                onChange={(e) => setSimulateTriggerData(e.target.value)}
                className="font-mono text-xs h-48 resize-none"
              />
              <p className="text-[11px] text-muted-foreground">
                This is a full CyberSentinel EDR alert payload. The execution engine resolves step inputs
                from these fields (e.g. <code className="bg-muted px-1 rounded">source_ip</code> for enrichment,
                <code className="bg-muted px-1 rounded ml-1">severity</code> for conditions).
              </p>
            </div>

            {/* Playbook steps preview */}
            {playbookToSimulate && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Execution Path</Label>
                <div className="flex items-center gap-1 flex-wrap p-3 rounded-lg bg-muted/50 border">
                  <Badge variant="secondary" className="text-xs">Trigger</Badge>
                  {(playbookToSimulate.steps as { type: string; name: string }[]).map((step, i) => {
                    const Icon = stepTypeIcons[step.type as StepType] || Zap;
                    return (
                      <div key={i} className="flex items-center">
                        <ArrowRight className="h-3 w-3 mx-1 text-muted-foreground" />
                        <div className={cn(
                          'flex items-center gap-1 px-2 py-0.5 rounded text-xs',
                          stepTypeColors[step.type as StepType] || 'text-foreground',
                          'bg-background border'
                        )}>
                          <Icon className="h-3 w-3" />
                          <span className="whitespace-nowrap">{step.name}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Simulation result */}
            {simulationResult && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium text-emerald-600">Execution Created</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">ID:</span>
                  <code className="font-mono bg-background px-2 py-0.5 rounded border">{simulationResult.execution_id}</code>
                  <Badge variant="outline" className="text-xs">{simulationResult.state}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  View progress on the Executions dashboard. The engine is running playbook steps against this trigger data.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => { setPlaybookToSimulate(null); setSimulationResult(null); }}>
              {simulationResult ? 'Close' : 'Cancel'}
            </Button>
            {!simulationResult && (
              <Button
                onClick={handleConfirmSimulate}
                disabled={createExecution.isPending}
              >
                {createExecution.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating Execution...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Simulation
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
