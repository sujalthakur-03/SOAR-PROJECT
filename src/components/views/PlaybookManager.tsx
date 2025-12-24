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
import { SeverityBadge } from '@/components/common/StatusBadges';
import { TimeAgo } from '@/components/common/TimeDisplay';
import { 
  usePlaybooks, 
  useTogglePlaybook, 
  useDeletePlaybook, 
  useCreatePlaybook,
  type Playbook 
} from '@/hooks/usePlaybooks';
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
  const { data: playbooks = [], isLoading } = usePlaybooks();
  const togglePlaybook = useTogglePlaybook();
  const deletePlaybook = useDeletePlaybook();
  const createPlaybook = useCreatePlaybook();
  const { role } = useUserRole();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

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

  const handleSavePlaybook = async (data: {
    name: string;
    description: string;
    trigger: Record<string, unknown>;
    steps: Record<string, unknown>[];
  }) => {
    try {
      await createPlaybook.mutateAsync(data);
      toast({ title: 'Playbook created successfully' });
      setIsEditorOpen(false);
      setSelectedPlaybook(null);
    } catch (error) {
      toast({ title: 'Failed to create playbook', variant: 'destructive' });
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
    </div>
  );
}
