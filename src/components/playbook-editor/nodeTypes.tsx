import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FlaskConical, GitBranch, UserCheck, Zap, Bell, Play, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StepType } from '@/types/soar';

export interface PlaybookNodeData extends Record<string, unknown> {
  label: string;
  stepType: StepType | 'trigger' | 'end';
  config?: Record<string, unknown>;
}

const nodeStyles: Record<string, { icon: React.ElementType; bg: string; border: string }> = {
  trigger: { icon: Play, bg: 'bg-emerald-500/10', border: 'border-emerald-500' },
  enrichment: { icon: FlaskConical, bg: 'bg-chart-1/10', border: 'border-chart-1' },
  condition: { icon: GitBranch, bg: 'bg-chart-3/10', border: 'border-chart-3' },
  approval: { icon: UserCheck, bg: 'bg-chart-4/10', border: 'border-chart-4' },
  action: { icon: Zap, bg: 'bg-chart-5/10', border: 'border-chart-5' },
  notification: { icon: Bell, bg: 'bg-chart-2/10', border: 'border-chart-2' },
  end: { icon: Flag, bg: 'bg-muted', border: 'border-muted-foreground' },
};

export const TriggerNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as PlaybookNodeData;
  const style = nodeStyles.trigger;
  const Icon = style.icon;

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border-2 min-w-[160px] shadow-md transition-all',
        style.bg,
        style.border,
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-md bg-emerald-500/20">
          <Icon className="h-4 w-4 text-emerald-500" />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trigger</p>
          <p className="text-sm font-semibold">{nodeData.label}</p>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
      />
    </div>
  );
});
TriggerNode.displayName = 'TriggerNode';

export const StepNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as PlaybookNodeData;
  const stepType = nodeData.stepType as StepType;
  const style = nodeStyles[stepType] || nodeStyles.action;
  const Icon = style.icon;

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border-2 min-w-[180px] shadow-md transition-all',
        style.bg,
        style.border,
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />
      <div className="flex items-center gap-2">
        <div className={cn('p-1.5 rounded-md', style.bg)}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {stepType}
          </p>
          <p className="text-sm font-semibold">{nodeData.label}</p>
        </div>
      </div>
      {stepType === 'condition' ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background !left-[30%]"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            className="!w-3 !h-3 !bg-destructive !border-2 !border-background !left-[70%]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-2 px-2">
            <span>True</span>
            <span>False</span>
          </div>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-primary !border-2 !border-background"
        />
      )}
    </div>
  );
});
StepNode.displayName = 'StepNode';

export const EndNode = memo(({ selected }: NodeProps) => {
  const style = nodeStyles.end;
  const Icon = style.icon;

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border-2 min-w-[120px] shadow-md transition-all',
        style.bg,
        style.border,
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />
      <div className="flex items-center gap-2 justify-center">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold text-muted-foreground">End</p>
      </div>
    </div>
  );
});
EndNode.displayName = 'EndNode';

export const nodeTypes = {
  trigger: TriggerNode,
  step: StepNode,
  end: EndNode,
};
