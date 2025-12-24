import { useState, useCallback } from 'react';
import { ReactFlowProvider, type Node, type Edge } from '@xyflow/react';
import { X, Save, FlaskConical, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { PlaybookCanvas } from './PlaybookCanvas';
import type { PlaybookNodeData } from './nodeTypes';
import type { Playbook } from '@/hooks/usePlaybooks';
import { useToast } from '@/hooks/use-toast';

interface VisualPlaybookEditorProps {
  playbook?: Playbook | null;
  onSave: (data: {
    name: string;
    description: string;
    trigger: Record<string, unknown>;
    steps: Record<string, unknown>[];
  }) => void;
  onClose: () => void;
}

export function VisualPlaybookEditor({ playbook, onSave, onClose }: VisualPlaybookEditorProps) {
  const { toast } = useToast();
  const [name, setName] = useState(playbook?.name || '');
  const [description, setDescription] = useState(playbook?.description || '');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const convertToPlaybookFormat = useCallback(() => {
    const triggerNode = nodes.find((n) => (n.data as PlaybookNodeData).stepType === 'trigger');
    const triggerData = triggerNode?.data as PlaybookNodeData | undefined;
    const trigger = (triggerData?.config as Record<string, unknown>) || {};

    // Build steps from nodes (excluding trigger and end)
    const stepNodes = nodes.filter(
      (n) => {
        const nodeData = n.data as PlaybookNodeData;
        return nodeData.stepType !== 'trigger' && nodeData.stepType !== 'end';
      }
    );

    const steps = stepNodes.map((node, index) => {
      const nodeData = node.data as PlaybookNodeData;
      return {
        id: node.id,
        type: nodeData.stepType,
        name: nodeData.label,
        order: index + 1,
        config: (nodeData.config as Record<string, unknown>) || {},
      };
    });

    return { trigger, steps };
  }, [nodes]);

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: 'Please enter a playbook name', variant: 'destructive' });
      return;
    }

    const { trigger, steps } = convertToPlaybookFormat();
    onSave({ name, description, trigger, steps });
  };

  const handleSimulate = () => {
    toast({ title: 'Simulation started', description: 'Running playbook in test mode...' });
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Playbook Name"
                className="font-semibold text-lg h-8 w-64 border-none shadow-none focus-visible:ring-0 px-0"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleSimulate}>
            <FlaskConical className="h-4 w-4 mr-2" />
            Simulate
          </Button>
          <Button variant="secondary" onClick={handleSimulate}>
            <Play className="h-4 w-4 mr-2" />
            Test Run
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save Playbook
          </Button>
        </div>
      </div>

      {/* Description bar */}
      <div className="border-b border-border px-4 py-2 bg-muted/30">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a description for this playbook..."
          className="border-none shadow-none focus-visible:ring-0 bg-transparent text-sm text-muted-foreground"
        />
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <ReactFlowProvider>
          <PlaybookCanvas
            onNodesChange={(nodes) => setNodes(nodes)}
            onEdgesChange={(edges) => setEdges(edges)}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
