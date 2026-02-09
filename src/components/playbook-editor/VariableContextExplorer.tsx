import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Search,
  Database,
  Zap,
  Activity,
  Bell,
} from 'lucide-react';

interface VariableNode {
  path: string;
  key: string;
  value: unknown;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  category: 'trigger' | 'enrichment' | 'action' | 'notification' | 'system';
  children?: VariableNode[];
}

interface VariableContextExplorerProps {
  context: Record<string, unknown>;
  onVariableSelect?: (path: string) => void;
  className?: string;
  compact?: boolean;
}

/**
 * VariableContextExplorer Component
 *
 * Interactive tree explorer for execution context variables.
 * Shows trigger_data, enrichment_results, action_outputs in expandable format.
 *
 * KEY FEATURES:
 * - Nested JSON tree with expand/collapse
 * - Click-to-copy variable paths ({{path}})
 * - Search/filter variables
 * - Category-based organization
 * - Type indicators
 * - Reusable in Conditions, Actions, Notifications
 */
export function VariableContextExplorer({
  context,
  onVariableSelect,
  className,
  compact = false,
}: VariableContextExplorerProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['trigger_data', 'enrichment']));
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Parse context into hierarchical variable tree
  const variableTree = useMemo(() => {
    const buildTree = (
      obj: unknown,
      parentPath: string = '',
      category: VariableNode['category']
    ): VariableNode[] => {
      if (obj === null || obj === undefined) return [];
      if (typeof obj !== 'object') return [];

      const entries = Array.isArray(obj)
        ? obj.map((item, index) => [String(index), item] as [string, unknown])
        : Object.entries(obj);

      return entries.map(([key, value]) => {
        const path = parentPath ? `${parentPath}.${key}` : key;
        const valueType = Array.isArray(value)
          ? 'array'
          : value === null
          ? 'null'
          : typeof value;

        const node: VariableNode = {
          path,
          key,
          value,
          type: valueType as VariableNode['type'],
          category,
        };

        if (valueType === 'object' && value !== null) {
          node.children = buildTree(value, path, category);
        }

        return node;
      });
    };

    const tree: VariableNode[] = [];

    // Trigger data
    if (context.trigger_data) {
      tree.push({
        path: 'trigger_data',
        key: 'trigger_data',
        value: context.trigger_data,
        type: 'object',
        category: 'trigger',
        children: buildTree(context.trigger_data, 'trigger_data', 'trigger'),
      });
    }

    // Enrichment results (collect all enrichment outputs)
    const enrichmentKeys = Object.keys(context).filter(
      k => k.endsWith('_result') || k.includes('enrichment') || k.startsWith('vt_') || k.startsWith('abuseipdb_')
    );
    if (enrichmentKeys.length > 0) {
      enrichmentKeys.forEach(key => {
        tree.push({
          path: key,
          key,
          value: context[key],
          type: 'object',
          category: 'enrichment',
          children: buildTree(context[key], key, 'enrichment'),
        });
      });
    }

    // Action outputs
    const actionKeys = Object.keys(context).filter(
      k => k.startsWith('action_') || k.includes('output')
    );
    if (actionKeys.length > 0) {
      actionKeys.forEach(key => {
        tree.push({
          path: key,
          key,
          value: context[key],
          type: 'object',
          category: 'action',
          children: buildTree(context[key], key, 'action'),
        });
      });
    }

    return tree;
  }, [context]);

  // Filter tree by search query
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return variableTree;

    const query = searchQuery.toLowerCase();
    const filterNode = (node: VariableNode): VariableNode | null => {
      const matchesSearch = node.path.toLowerCase().includes(query) ||
        String(node.value).toLowerCase().includes(query);

      if (matchesSearch) return node;

      if (node.children) {
        const filteredChildren = node.children
          .map(filterNode)
          .filter((n): n is VariableNode => n !== null);

        if (filteredChildren.length > 0) {
          return { ...node, children: filteredChildren };
        }
      }

      return null;
    };

    return variableTree.map(filterNode).filter((n): n is VariableNode => n !== null);
  }, [variableTree, searchQuery]);

  const toggleExpanded = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleCopyPath = async (path: string) => {
    const variablePath = `{{${path}}}`;
    try {
      await navigator.clipboard.writeText(variablePath);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);

      if (onVariableSelect) {
        onVariableSelect(variablePath);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getCategoryIcon = (category: VariableNode['category']) => {
    switch (category) {
      case 'trigger': return <Database className="h-3.5 w-3.5 text-emerald-500" />;
      case 'enrichment': return <Zap className="h-3.5 w-3.5 text-blue-500" />;
      case 'action': return <Activity className="h-3.5 w-3.5 text-red-500" />;
      case 'notification': return <Bell className="h-3.5 w-3.5 text-purple-500" />;
      default: return <Database className="h-3.5 w-3.5" />;
    }
  };

  const renderNode = (node: VariableNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const hasChildren = node.children && node.children.length > 0;
    const isCopied = copiedPath === node.path;

    return (
      <div key={node.path} style={{ paddingLeft: `${depth * 12}px` }}>
        <div
          className={cn(
            'group flex items-center gap-1 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer text-xs',
            compact && 'py-0.5'
          )}
        >
          {hasChildren ? (
            <button
              onClick={() => toggleExpanded(node.path)}
              className="shrink-0 hover:bg-muted rounded p-0.5"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : (
            <div className="w-4" />
          )}

          {depth === 0 && getCategoryIcon(node.category)}

          <code className="flex-1 font-mono text-[11px] text-foreground truncate">
            <span className="text-primary">{node.key}</span>
            {node.type !== 'object' && node.type !== 'array' && (
              <>
                <span className="text-muted-foreground mx-1">:</span>
                <span className={cn(
                  node.type === 'string' && 'text-emerald-600',
                  node.type === 'number' && 'text-blue-600',
                  node.type === 'boolean' && 'text-amber-600',
                  node.type === 'null' && 'text-muted-foreground'
                )}>
                  {node.type === 'string' ? `"${String(node.value).slice(0, 30)}..."` : String(node.value)}
                </span>
              </>
            )}
          </code>

          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0">
            {node.type}
          </Badge>

          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 shrink-0"
            onClick={() => handleCopyPath(node.path)}
            title={`Copy {{${node.path}}}`}
          >
            {isCopied ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>

        {hasChildren && isExpanded && (
          <div>
            {node.children!.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn('flex flex-col h-full border border-border rounded-lg bg-card', className)}>
      {/* Header */}
      <div className="p-3 border-b border-border">
        <h4 className="text-sm font-medium mb-2">Variable Context</h4>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search variables..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1 p-2">
        {filteredTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-8 text-center">
            <Database className="h-10 w-10 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">
              {searchQuery ? 'No variables match search' : 'No variables available'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {searchQuery ? 'Try a different search term' : 'Run a step test to populate context'}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredTree.map(node => renderNode(node))}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t border-border bg-muted/30">
        <p className="text-[10px] text-muted-foreground">
          Click <Copy className="h-3 w-3 inline" /> to copy variable path
        </p>
      </div>
    </div>
  );
}
