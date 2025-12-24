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
  Pause,
  ChevronRight,
  ArrowRight,
  Zap,
  GitBranch,
  UserCheck,
  Bell,
  FlaskConical,
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
import { mockPlaybooks } from '@/data/mockData';
import type { Playbook, PlaybookStep, StepType } from '@/types/soar';
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
  const [playbooks, setPlaybooks] = useState<Playbook[]>(mockPlaybooks);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);

  const filteredPlaybooks = playbooks.filter(
    (pb) =>
      pb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pb.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const togglePlaybook = (id: string) => {
    setPlaybooks((prev) =>
      prev.map((pb) => (pb.id === id ? { ...pb, enabled: !pb.enabled } : pb))
    );
  };

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
        <Button onClick={() => setIsBuilderOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Playbook
        </Button>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredPlaybooks.map((playbook) => (
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
                  <Switch
                    checked={playbook.enabled}
                    onCheckedChange={() => togglePlaybook(playbook.id)}
                  />
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Trigger Info */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Trigger:</span>
                <Badge variant="secondary" className="text-xs">
                  {playbook.trigger.source}
                </Badge>
                <span className="text-muted-foreground">•</span>
                <span className="font-mono">
                  Rules: {playbook.trigger.rule_ids.join(', ')}
                </span>
                <span className="text-muted-foreground">•</span>
                <SeverityBadge severity={playbook.trigger.severity_threshold} />
              </div>

              {/* Steps Visualization */}
              <div className="flex items-center gap-1 overflow-x-auto py-2">
                {playbook.steps.map((step, index) => {
                  const Icon = stepTypeIcons[step.type];
                  return (
                    <div key={step.id} className="flex items-center">
                      <div
                        className={cn(
                          'flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs',
                          stepTypeColors[step.type]
                        )}
                      >
                        <Icon className="h-3 w-3" />
                        <span className="whitespace-nowrap">{step.name}</span>
                      </div>
                      {index < playbook.steps.length - 1 && (
                        <ArrowRight className="h-3 w-3 mx-1 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                <span>
                  <strong className="text-foreground">{playbook.execution_count}</strong>{' '}
                  executions
                </span>
                {playbook.last_execution && (
                  <span>
                    Last run <TimeAgo date={playbook.last_execution} className="text-xs" />
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
          {/* Basic Info */}
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
              <Select defaultValue={playbook?.trigger.source || 'wazuh'}>
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
              defaultValue={playbook?.description}
            />
          </div>

          {/* Trigger Configuration */}
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
                  defaultValue={playbook?.trigger.rule_ids.join(', ')}
                />
              </div>
              <div className="space-y-2">
                <Label>Minimum Severity</Label>
                <Select
                  defaultValue={playbook?.trigger.severity_threshold || 'high'}
                >
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

          {/* Steps */}
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

            {playbook?.steps.map((step, index) => (
              <StepEditor key={step.id} step={step} index={index} />
            )) || (
              <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground">
                <p className="text-sm">No steps configured yet</p>
                <p className="text-xs mt-1">Add steps to define the response workflow</p>
              </div>
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

function StepEditor({ step, index }: { step: PlaybookStep; index: number }) {
  const Icon = stepTypeIcons[step.type];

  return (
    <Card className="bg-muted/30">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex items-center justify-center h-8 w-8 rounded-full bg-background border',
              stepTypeColors[step.type]
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Step {index + 1}
                </span>
                <Badge variant="outline" className="text-xs capitalize">
                  {step.type}
                </Badge>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <Input
              defaultValue={step.name}
              className="h-8 text-sm"
              placeholder="Step name"
            />
            <div className="grid grid-cols-2 gap-2">
              <Select defaultValue={step.on_failure}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="On failure" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stop">Stop execution</SelectItem>
                  <SelectItem value="continue">Continue</SelectItem>
                  <SelectItem value="skip">Skip to next</SelectItem>
                </SelectContent>
              </Select>
              {step.timeout_seconds && (
                <Input
                  type="number"
                  defaultValue={step.timeout_seconds}
                  className="h-8 text-xs"
                  placeholder="Timeout (seconds)"
                />
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
