import { useCallback, useRef, useState, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
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
import { Undo2, Redo2, Trash2 } from 'lucide-react';
import { nodeTypes, type PlaybookNodeData } from './nodeTypes';
import { StepPalette, getStepDefinition, type ExtendedStepType } from './StepPalette';
import { StepConfigPanel } from './StepConfigPanel';
import {
  validatePlaybookGraph,
  type GraphValidationResult,
} from './PlaybookValidator';
import type { StepType } from '@/types/soar';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type NodeHighlightStatus = 'running' | 'success' | 'error' | 'pending' | null;

interface PlaybookCanvasProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  playbookId?: string;
  playbookName?: string;
  showValidationErrors?: boolean;
  onNodesChange?: (nodes: Node[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
  onValidationChange?: (result: GraphValidationResult) => void;
}

export interface PlaybookCanvasRef {
  highlightNode: (nodeId: string | null, status: NodeHighlightStatus) => void;
  getNodes: () => Node[];
  getEdges: () => Edge[];
}

// Command for undo/redo stack
interface Command {
  type: 'add_node' | 'delete_nodes' | 'move_nodes' | 'add_edge' | 'delete_edges' | 'update_node';
  timestamp: number;
  prevNodes: Node[];
  prevEdges: Edge[];
  nextNodes: Node[];
  nextEdges: Edge[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_HISTORY_SIZE = 50;

const defaultNodes: Node[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 250, y: 50 },
    data: {
      label: 'Alert Received',
      stepType: 'trigger',
      subtype: 'webhook',
      config: {
        source: 'cybersentinel',
        severity_threshold: 'high',
        rule_ids: ''
      }
    } as PlaybookNodeData,
  },
];

const defaultEdges: Edge[] = [];

let nodeId = 1;
const getNodeId = () => `node-${++nodeId}`;

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export const PlaybookCanvas = forwardRef<PlaybookCanvasRef, PlaybookCanvasProps>(({
  initialNodes = defaultNodes,
  initialEdges = defaultEdges,
  playbookId,
  playbookName = '',
  showValidationErrors = false,
  onNodesChange: onNodesChangeCallback,
  onEdgesChange: onEdgesChangeCallback,
  onValidationChange,
}, ref) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // Undo/Redo state
  const [undoStack, setUndoStack] = useState<Command[]>([]);
  const [redoStack, setRedoStack] = useState<Command[]>([]);
  const isUndoRedoRef = useRef(false);
  const prevStateRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: initialNodes, edges: initialEdges });

  // Validation state
  const [validationResult, setValidationResult] = useState<GraphValidationResult | null>(null);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Test flow highlight state
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [highlightStatus, setHighlightStatus] = useState<NodeHighlightStatus>(null);

  // ═══════════════════════════════════════════════════════════════════════════════
  // IMPERATIVE HANDLE FOR TEST FLOW
  // ═══════════════════════════════════════════════════════════════════════════════

  useImperativeHandle(ref, () => ({
    highlightNode: (nodeId: string | null, status: NodeHighlightStatus) => {
      setHighlightedNodeId(nodeId);
      setHighlightStatus(status);
    },
    getNodes: () => nodes,
    getEdges: () => edges,
  }), [nodes, edges]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // UPDATE NODE HIGHLIGHT STATUS
  // ═══════════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (highlightedNodeId === null) {
      // Clear all highlights
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const nodeData = node.data as PlaybookNodeData;
          if (nodeData.testStatus) {
            return {
              ...node,
              data: { ...nodeData, testStatus: undefined },
            };
          }
          return node;
        })
      );
      return;
    }

    // Update the highlighted node
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const nodeData = node.data as PlaybookNodeData;
        if (node.id === highlightedNodeId) {
          return {
            ...node,
            data: { ...nodeData, testStatus: highlightStatus },
          };
        }
        // Keep previous success/error status for already executed nodes
        if (nodeData.testStatus === 'success' || nodeData.testStatus === 'error') {
          return node;
        }
        return node;
      })
    );
  }, [highlightedNodeId, highlightStatus, setNodes]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════════

  const runValidation = useCallback(() => {
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }

    validationTimeoutRef.current = setTimeout(() => {
      const result = validatePlaybookGraph(playbookName, nodes, edges);
      setValidationResult(result);

      // Only show validation issues on nodes if showValidationErrors is true
      if (showValidationErrors) {
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            const issues = result.nodeErrors.get(node.id) || [];
            const hasGraphError = issues.some((i) => i.severity === 'error');
            const nodeData = node.data as PlaybookNodeData;

            const prevIssues = nodeData.validationIssues || [];
            const issuesChanged =
              prevIssues.length !== issues.length ||
              prevIssues.some((pi, idx) => pi.id !== issues[idx]?.id);

            if (!issuesChanged && nodeData.hasGraphError === hasGraphError) {
              return node;
            }

            return {
              ...node,
              data: {
                ...nodeData,
                validationIssues: issues,
                hasGraphError,
              },
            };
          })
        );
      } else {
        // Clear validation issues from nodes when not showing
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            const nodeData = node.data as PlaybookNodeData;
            if (nodeData.validationIssues?.length || nodeData.hasGraphError) {
              return {
                ...node,
                data: {
                  ...nodeData,
                  validationIssues: [],
                  hasGraphError: false,
                },
              };
            }
            return node;
          })
        );
      }

      if (onValidationChange) {
        onValidationChange(result);
      }
    }, 300);
  }, [nodes, edges, playbookName, showValidationErrors, setNodes, onValidationChange]);

  useEffect(() => {
    runValidation();
    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, [nodes, edges, playbookName, showValidationErrors, runValidation]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // UNDO/REDO HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════

  const pushToUndoStack = useCallback((prevNodes: Node[], prevEdges: Edge[], nextNodes: Node[], nextEdges: Edge[], type: Command['type']) => {
    if (isUndoRedoRef.current) return;

    const command: Command = {
      type,
      timestamp: Date.now(),
      prevNodes: JSON.parse(JSON.stringify(prevNodes)),
      prevEdges: JSON.parse(JSON.stringify(prevEdges)),
      nextNodes: JSON.parse(JSON.stringify(nextNodes)),
      nextEdges: JSON.parse(JSON.stringify(nextEdges)),
    };

    setUndoStack((stack) => {
      const newStack = [...stack, command];
      if (newStack.length > MAX_HISTORY_SIZE) {
        newStack.shift();
      }
      return newStack;
    });

    setRedoStack([]);
  }, []);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const undo = useCallback(() => {
    if (!canUndo) return;

    isUndoRedoRef.current = true;
    const command = undoStack[undoStack.length - 1];

    setNodes(command.prevNodes);
    setEdges(command.prevEdges);

    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, command]);

    prevStateRef.current = { nodes: command.prevNodes, edges: command.prevEdges };

    if (selectedNode && !command.prevNodes.find((n) => n.id === selectedNode.id)) {
      setSelectedNode(null);
    }

    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 50);
  }, [canUndo, undoStack, setNodes, setEdges, selectedNode]);

  const redo = useCallback(() => {
    if (!canRedo) return;

    isUndoRedoRef.current = true;
    const command = redoStack[redoStack.length - 1];

    setNodes(command.nextNodes);
    setEdges(command.nextEdges);

    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, command]);

    prevStateRef.current = { nodes: command.nextNodes, edges: command.nextEdges };

    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 50);
  }, [canRedo, redoStack, setNodes, setEdges]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // KEYBOARD SHORTCUTS
  // ═══════════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedNodes();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETE FUNCTIONALITY
  // ═══════════════════════════════════════════════════════════════════════════════

  const deleteSelectedNodes = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;

    const nonTriggerNodes = selectedNodes.filter((n) => (n.data as PlaybookNodeData).stepType !== 'trigger');
    if (nonTriggerNodes.length === 0) return;

    const nodeIdsToDelete = new Set(nonTriggerNodes.map((n) => n.id));

    const prevNodes = JSON.parse(JSON.stringify(nodes));
    const prevEdges = JSON.parse(JSON.stringify(edges));

    const newNodes = nodes.filter((n) => !nodeIdsToDelete.has(n.id));
    const newEdges = edges.filter((e) => !nodeIdsToDelete.has(e.source) && !nodeIdsToDelete.has(e.target));

    pushToUndoStack(prevNodes, prevEdges, newNodes, newEdges, 'delete_nodes');

    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedNode(null);
    prevStateRef.current = { nodes: newNodes, edges: newEdges };
  }, [nodes, edges, setNodes, setEdges, pushToUndoStack]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // NOTIFY PARENT OF CHANGES
  // ═══════════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (onNodesChangeCallback) {
      onNodesChangeCallback(nodes);
    }
  }, [nodes, onNodesChangeCallback]);

  useEffect(() => {
    if (onEdgesChangeCallback) {
      onEdgesChangeCallback(edges);
    }
  }, [edges, onEdgesChangeCallback]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // CONNECTION HANDLER
  // ═══════════════════════════════════════════════════════════════════════════════

  const onConnect = useCallback(
    (params: Connection) => {
      const prevEdges = JSON.parse(JSON.stringify(edges));

      let label: string | undefined;
      if (params.sourceHandle === 'true') {
        label = 'true';
      } else if (params.sourceHandle === 'false') {
        label = 'false';
      } else if (params.sourceHandle === 'approved') {
        label = 'approved';
      } else if (params.sourceHandle === 'rejected') {
        label = 'rejected';
      } else if (params.sourceHandle === 'timeout') {
        label = 'timeout';
      }

      const newEdge = {
        ...params,
        type: 'smoothstep',
        animated: true,
        style: { strokeWidth: 2 },
        label,
        labelStyle: { fill: 'hsl(var(--foreground))', fontWeight: 500, fontSize: 11 },
        labelBgStyle: { fill: 'hsl(var(--card))', fillOpacity: 0.9 },
      };

      setEdges((eds) => {
        const newEdges = addEdge(newEdge, eds);
        pushToUndoStack(nodes, prevEdges, nodes, newEdges, 'add_edge');
        prevStateRef.current = { nodes, edges: newEdges };
        return newEdges;
      });
    },
    [setEdges, nodes, edges, pushToUndoStack]
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // DRAG & DROP
  // ═══════════════════════════════════════════════════════════════════════════════

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const stepType = event.dataTransfer.getData('application/reactflow') as ExtendedStepType;
      const subtype = event.dataTransfer.getData('application/step-subtype');
      const configJson = event.dataTransfer.getData('application/step-config');
      const label = event.dataTransfer.getData('application/step-label');

      if (!stepType || !reactFlowInstance || !reactFlowWrapper.current) return;

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      position.x = Math.round(position.x / 15) * 15;
      position.y = Math.round(position.y / 15) * 15;

      let defaultConfig: Record<string, unknown> = {};
      if (configJson) {
        try {
          defaultConfig = JSON.parse(configJson);
        } catch {
          // Use empty config on parse error
        }
      }

      let nodeType: string;
      if (stepType === 'end') {
        nodeType = 'end';
      } else if (stepType === 'trigger') {
        nodeType = 'trigger';
      } else {
        nodeType = 'step';
      }

      const nodeLabel = label || (stepType === 'end' ? 'End' : `New ${stepType.charAt(0).toUpperCase() + stepType.slice(1)}`);

      const newNode: Node = {
        id: getNodeId(),
        type: nodeType,
        position,
        data: {
          label: nodeLabel,
          stepType,
          subtype: subtype || stepType,
          config: defaultConfig,
        } as PlaybookNodeData,
      };

      const prevNodes = JSON.parse(JSON.stringify(nodes));

      setNodes((nds) => {
        const newNodes = nds.concat(newNode);
        pushToUndoStack(prevNodes, edges, newNodes, edges, 'add_node');
        prevStateRef.current = { nodes: newNodes, edges };
        return newNodes;
      });
    },
    [reactFlowInstance, setNodes, nodes, edges, pushToUndoStack]
  );

  const onDragStart = (event: React.DragEvent, stepType: StepType | 'end' | 'delay' | 'stop', stepSubtype?: string) => {
    event.dataTransfer.setData('application/reactflow', stepType);
    if (stepSubtype) {
      event.dataTransfer.setData('application/step-subtype', stepSubtype);
      const stepDef = getStepDefinition(stepSubtype);
      if (stepDef) {
        event.dataTransfer.setData('application/step-config', JSON.stringify(stepDef.defaultConfig));
        event.dataTransfer.setData('application/step-label', stepDef.label);
      }
    }
    event.dataTransfer.effectAllowed = 'move';
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // NODE INTERACTION
  // ═══════════════════════════════════════════════════════════════════════════════

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onNodeUpdate = useCallback(
    (nodeId: string, data: Partial<PlaybookNodeData>) => {
      const prevNodes = JSON.parse(JSON.stringify(nodes));

      setNodes((nds) => {
        const newNodes = nds.map((node) => {
          if (node.id === nodeId) {
            return { ...node, data: { ...node.data, ...data } };
          }
          return node;
        });

        pushToUndoStack(prevNodes, edges, newNodes, edges, 'update_node');
        prevStateRef.current = { nodes: newNodes, edges };
        return newNodes;
      });

      setSelectedNode((prev) =>
        prev && prev.id === nodeId ? { ...prev, data: { ...prev.data, ...data } } : prev
      );
    },
    [setNodes, nodes, edges, pushToUndoStack]
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (isUndoRedoRef.current) return;

      const nonTriggerDeleted = deleted.filter((n) => (n.data as PlaybookNodeData).stepType !== 'trigger');
      if (nonTriggerDeleted.length === 0) return;

      const deletedIds = new Set(nonTriggerDeleted.map((n) => n.id));

      const prevNodes = prevStateRef.current.nodes;
      const prevEdges = prevStateRef.current.edges;
      const newNodes = nodes.filter((n) => !deletedIds.has(n.id));
      const newEdges = edges.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target));

      pushToUndoStack(prevNodes, prevEdges, newNodes, newEdges, 'delete_nodes');
      prevStateRef.current = { nodes: newNodes, edges: newEdges };

      if (selectedNode && deletedIds.has(selectedNode.id)) {
        setSelectedNode(null);
      }
    },
    [nodes, edges, selectedNode, pushToUndoStack]
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (isUndoRedoRef.current) return;

      const deletedIds = new Set(deleted.map((e) => e.id));
      const prevEdges = prevStateRef.current.edges;
      const newEdges = edges.filter((e) => !deletedIds.has(e.id));

      pushToUndoStack(nodes, prevEdges, nodes, newEdges, 'delete_edges');
      prevStateRef.current = { nodes, edges: newEdges };
    },
    [nodes, edges, pushToUndoStack]
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════════

  const selectedNodeCount = useMemo(() => nodes.filter((n) => n.selected).length, [nodes]);
  const hasSelectedNodes = selectedNodeCount > 0;

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
          onEdgesDelete={onEdgesDelete}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
          deleteKeyCode={null}
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
              // Test flow status colors
              if (data.testStatus === 'running') return 'hsl(var(--primary))';
              if (data.testStatus === 'success') return 'hsl(142 76% 36%)';
              if (data.testStatus === 'error') return 'hsl(0 84% 60%)';
              // Validation error color (only when showing errors)
              if (showValidationErrors && (data.hasGraphError || data.validationIssues?.some((i) => i.severity === 'error'))) {
                return 'hsl(0 84% 60%)';
              }
              switch (data.stepType) {
                case 'trigger': return 'hsl(142 76% 36%)';
                case 'enrichment': return 'hsl(217 91% 60%)';
                case 'condition': return 'hsl(45 93% 47%)';
                case 'approval': return 'hsl(24 95% 53%)';
                case 'action': return 'hsl(0 84% 60%)';
                case 'notification': return 'hsl(262 83% 58%)';
                case 'delay': return 'hsl(215 14% 34%)';
                case 'stop': return 'hsl(215 14% 34%)';
                default: return 'hsl(var(--muted-foreground))';
              }
            }}
          />
          <Panel position="top-right" className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 bg-card"
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 bg-card"
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
            {hasSelectedNodes && (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 bg-card text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={deleteSelectedNodes}
                title="Delete selected (Delete)"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </Panel>

          <Panel position="bottom-left" className="text-xs text-muted-foreground bg-card/80 px-2 py-1 rounded border">
            <span className="mr-3">⌘Z Undo</span>
            <span className="mr-3">⌘⇧Z Redo</span>
            <span>⌫ Delete</span>
          </Panel>
        </ReactFlow>
      </div>

      {selectedNode && (
        <StepConfigPanel
          node={selectedNode}
          playbookId={playbookId}
          onClose={() => setSelectedNode(null)}
          onUpdate={onNodeUpdate}
          nodes={nodes}
        />
      )}
    </div>
  );
});

PlaybookCanvas.displayName = 'PlaybookCanvas';
