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
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { TimeAgo } from '@/components/common/TimeDisplay';
import { usePlaybooks, useTogglePlaybook, useDeletePlaybook, type Playbook } from '@/hooks/usePlaybooks';
import { useUserRole } from '@/hooks/useUserRole';
import { canEditFeature, canDeleteFeature } from '@/lib/permissions';
import { useToast } from '@/hooks/use-toast';
import type { StepType, Severity } from '@/types/soar';
import { cn } from '@/lib/utils';

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
  const { data: playbooks = [], isLoading } = usePlaybooks();
  const togglePlaybook = useTogglePlaybook();
  const deletePlaybook = useDeletePlaybook();
  const { role } = useUserRole();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);

  const canEdit = canEditFeature('playbooks', role);
  const canDelete = canDeleteFeature('playbooks', role);

  const filteredPlaybooks = playbooks.filter(
    (pb) =>
      pb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (pb.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
  );

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    try {
      await togglePlaybook.mutateAsync({ id, enabled: !currentEnabled });
      toast({ title: `Playbook ${!currentEnabled ? 'enabled' : 'disabled'}` });
    } catch (error) {
      toast({ title: 'Failed to update playbook', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePlaybook.mutateAsync(id);
      toast({ title: 'Playbook deleted' });
    } catch (error) {
      toast({ title: 'Failed to delete playbook', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
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
          <Button onClick={() => setIsBuilderOpen(true)}>
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
            const trigger = playbook.trigger as { source?: string; rule_ids?: string[]; severity_threshold?: Severity };
            const steps = playbook.steps as { id: string; type: StepType; name: string }[];

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
                          onCheckedChange={() => handleToggle(playbook.id, playbook.enabled)}
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
                          <DropdownMenuItem>
                            <Play className="h-4 w-4 mr-2" />
                            Simulate
                          </DropdownMenuItem>
                          {canDelete && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => handleDelete(playbook.id)}
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
                  {/* Trigger Info */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Trigger:</span>
                    <Badge variant="secondary" className="text-xs">
                      {trigger.source || 'wazuh'}
                    </Badge>
                    <span className="text-muted-foreground">•</span>
                    <span className="font-mono">
                      Rules: {trigger.rule_ids?.join(', ') || 'N/A'}
                    </span>
                    <span className="text-muted-foreground">•</span>
                    {trigger.severity_threshold && (
                      <SeverityBadge severity={trigger.severity_threshold} />
                    )}
                  </div>

                  {/* Steps Visualization */}
                  <div className="flex items-center gap-1 overflow-x-auto py-2">
                    {steps.map((step, index) => {
                      const Icon = stepTypeIcons[step.type] || Zap;
                      return (
                        <div key={step.id} className="flex items-center">
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

      {/* Playbook Builder Dialog */}
      <PlaybookBuilderDialog
        open={isBuilderOpen || !!selectedPlaybook}
        onOpenChange={(open) => {
          setIsBuilderOpen(open);
          if (!open) setSelectedPlaybook(null);
        }}
        playbook={selectedPlaybook}
      />
    </div>
  );
}

interface PlaybookBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbook?: Playbook | null;
}

function PlaybookBuilderDialog({
  open,
  onOpenChange,
  playbook,
}: PlaybookBuilderDialogProps) {
  const isEditing = !!playbook;
  const trigger = playbook?.trigger as { source?: string; rule_ids?: string[]; severity_threshold?: string } | undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Playbook' : 'Create New Playbook'}
          </DialogTitle>
          <DialogDescription>
            Configure trigger conditions and response steps
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Playbook Name</Label>
              <Input
                placeholder="e.g., SSH Brute Force Response"
                defaultValue={playbook?.name}
              />
            </div>
            <div className="space-y-2">
              <Label>Source</Label>
              <Select defaultValue={trigger?.source || 'wazuh'}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wazuh">Wazuh</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="Describe what this playbook does..."
              defaultValue={playbook?.description || ''}
            />
          </div>

          <div className="space-y-4">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Trigger Configuration
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rule IDs (comma-separated)</Label>
                <Input
                  placeholder="100002, 100003"
                  defaultValue={trigger?.rule_ids?.join(', ') || ''}
                />
              </div>
              <div className="space-y-2">
                <Label>Minimum Severity</Label>
                <Select defaultValue={trigger?.severity_threshold || 'high'}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-primary" />
                Response Steps
              </h4>
              <Button variant="outline" size="sm">
                <Plus className="h-3 w-3 mr-1" />
                Add Step
              </Button>
            </div>

            {!playbook?.steps || (playbook.steps as unknown[]).length === 0 ? (
              <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground">
                <p className="text-sm">No steps configured yet</p>
                <p className="text-xs mt-1">Add steps to define the response workflow</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {(playbook.steps as unknown[]).length} steps configured
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary">
            <FlaskConical className="h-4 w-4 mr-2" />
            Simulate
          </Button>
          <Button>{isEditing ? 'Save Changes' : 'Create Playbook'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
