import { useCallback, useRef, useState } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Undo2, Redo2 } from 'lucide-react';
import { nodeTypes, type PlaybookNodeData } from './nodeTypes';
import { StepPalette } from './StepPalette';
import { StepConfigPanel } from './StepConfigPanel';
import type { StepType } from '@/types/soar';

interface PlaybookCanvasProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onNodesChange?: (nodes: Node[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
}

const defaultNodes: Node[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 250, y: 50 },
    data: { label: 'Alert Received', stepType: 'trigger', config: { source: 'wazuh', severity_threshold: 'high' } } as PlaybookNodeData,
  },
];

const defaultEdges: Edge[] = [];

let nodeId = 1;
const getNodeId = () => `node-${++nodeId}`;

export function PlaybookCanvas({
  initialNodes = defaultNodes,
  initialEdges = defaultEdges,
}: PlaybookCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge = {
        ...params,
        type: 'smoothstep',
        animated: true,
        style: { strokeWidth: 2 },
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const stepType = event.dataTransfer.getData('application/reactflow') as StepType | 'end';

      if (!stepType || !reactFlowInstance || !reactFlowWrapper.current) return;

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      const newNode: Node = {
        id: getNodeId(),
        type: stepType === 'end' ? 'end' : 'step',
        position,
        data: {
          label: stepType === 'end' ? 'End' : `New ${stepType.charAt(0).toUpperCase() + stepType.slice(1)}`,
          stepType,
          config: {},
        } as PlaybookNodeData,
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onDragStart = (event: React.DragEvent, stepType: StepType | 'end') => {
    event.dataTransfer.setData('application/reactflow', stepType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onNodeUpdate = useCallback(
    (nodeId: string, data: Partial<PlaybookNodeData>) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return { ...node, data: { ...node.data, ...data } };
          }
          return node;
        })
      );
      // Update selected node reference
      setSelectedNode((prev) =>
        prev && prev.id === nodeId ? { ...prev, data: { ...prev.data, ...data } } : prev
      );
    },
    [setNodes]
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const deletedIds = new Set(deleted.map((n) => n.id));
      if (selectedNode && deletedIds.has(selectedNode.id)) {
        setSelectedNode(null);
      }
    },
    [selectedNode]
  );

  return (
    <div className="flex h-full bg-background">
      <StepPalette onDragStart={onDragStart} />
      
      <div ref={reactFlowWrapper} className="flex-1 h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onNodesDelete={onNodesDelete}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: true,
            style: { strokeWidth: 2, stroke: 'hsl(var(--primary))' },
          }}
          proOptions={{ hideAttribution: true }}
          className="bg-muted/30"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-background" />
          <Controls showInteractive={false} className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground" />
          <MiniMap 
            className="!bg-card !border-border"
            nodeColor={(node) => {
              const data = node.data as PlaybookNodeData;
              switch (data.stepType) {
                case 'trigger': return 'hsl(142 76% 36%)';
                case 'enrichment': return 'hsl(var(--chart-1))';
                case 'condition': return 'hsl(var(--chart-3))';
                case 'approval': return 'hsl(var(--chart-4))';
                case 'action': return 'hsl(var(--chart-5))';
                case 'notification': return 'hsl(var(--chart-2))';
                default: return 'hsl(var(--muted-foreground))';
              }
            }}
          />
          <Panel position="top-right" className="flex gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8 bg-card">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8 bg-card">
              <Redo2 className="h-4 w-4" />
            </Button>
          </Panel>
        </ReactFlow>
      </div>

      {selectedNode && (
        <StepConfigPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onUpdate={onNodeUpdate}
        />
      )}
    </div>
  );
}
