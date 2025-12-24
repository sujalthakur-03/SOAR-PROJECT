import { FlaskConical, GitBranch, UserCheck, Zap, Bell, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StepType } from '@/types/soar';

interface StepPaletteProps {
  onDragStart: (event: React.DragEvent, stepType: StepType | 'end') => void;
}

const stepItems: { type: StepType | 'end'; label: string; icon: React.ElementType; description: string; color: string }[] = [
  { type: 'enrichment', label: 'Enrichment', icon: FlaskConical, description: 'Gather additional context', color: 'text-chart-1 bg-chart-1/10 border-chart-1/30' },
  { type: 'condition', label: 'Condition', icon: GitBranch, description: 'Branch based on criteria', color: 'text-chart-3 bg-chart-3/10 border-chart-3/30' },
  { type: 'approval', label: 'Approval', icon: UserCheck, description: 'Require human approval', color: 'text-chart-4 bg-chart-4/10 border-chart-4/30' },
  { type: 'action', label: 'Action', icon: Zap, description: 'Execute response action', color: 'text-chart-5 bg-chart-5/10 border-chart-5/30' },
  { type: 'notification', label: 'Notification', icon: Bell, description: 'Send alerts/notifications', color: 'text-chart-2 bg-chart-2/10 border-chart-2/30' },
  { type: 'end', label: 'End', icon: Flag, description: 'Terminate workflow', color: 'text-muted-foreground bg-muted border-border' },
];

export function StepPalette({ onDragStart }: StepPaletteProps) {
  return (
    <div className="w-64 border-r border-border bg-card p-4 space-y-3 overflow-y-auto">
      <div>
        <h3 className="font-semibold text-sm">Step Palette</h3>
        <p className="text-xs text-muted-foreground">Drag steps to the canvas</p>
      </div>
      
      <div className="space-y-2">
        {stepItems.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-md',
                item.color
              )}
            >
              <div className="p-2 rounded-md bg-background/50">
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs opacity-70">{item.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
