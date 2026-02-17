import { useMemo } from 'react';
import { cn } from '../../lib/utils';
import type { InsightsQueuedTask } from '../../stores/insights-task-queue-store';

interface DependencyGraphViewProps {
  tasks: InsightsQueuedTask[];
  onTaskClick?: (task: InsightsQueuedTask) => void;
}

interface GraphNode {
  task: InsightsQueuedTask;
  depth: number;
}

const statusDotColors: Record<string, string> = {
  pending: 'bg-blue-500',
  running: 'bg-green-500',
  complete: 'bg-emerald-500',
  failed: 'bg-red-500',
};

export function DependencyGraphView({ tasks, onTaskClick }: DependencyGraphViewProps) {
  const nodes = useMemo(() => {
    // Build title -> task lookup
    const taskByTitle = new Map<string, InsightsQueuedTask>();
    for (const t of tasks) {
      taskByTitle.set(t.title.toLowerCase(), t);
    }

    // Build adjacency: parent (dependency) -> children
    const children = new Map<string, string[]>();
    const hasParent = new Set<string>();

    for (const t of tasks) {
      const deps = t.metadata?.dependencies || [];
      for (const dep of deps) {
        const depLower = dep.toLowerCase();
        // Find matching task by substring
        const parent = tasks.find(p =>
          p.title.toLowerCase().includes(depLower) || depLower.includes(p.title.toLowerCase())
        );
        if (parent && parent.id !== t.id) {
          if (!children.has(parent.id)) children.set(parent.id, []);
          children.get(parent.id)!.push(t.id);
          hasParent.add(t.id);
        }
      }
    }

    // Root tasks have no parent
    const roots = tasks.filter(t => !hasParent.has(t.id));

    // BFS to assign depths (handles cycles by visited set)
    const result: GraphNode[] = [];
    const visited = new Set<string>();
    const queue: Array<{ task: InsightsQueuedTask; depth: number }> = roots.map(t => ({ task: t, depth: 0 }));

    while (queue.length > 0) {
      const { task, depth } = queue.shift()!;
      if (visited.has(task.id)) continue;
      visited.add(task.id);
      result.push({ task, depth });

      const childIds = children.get(task.id) || [];
      for (const childId of childIds) {
        const childTask = tasks.find(t => t.id === childId);
        if (childTask && !visited.has(childId)) {
          queue.push({ task: childTask, depth: depth + 1 });
        }
      }
    }

    // Add any unvisited tasks (isolated or in cycles)
    for (const t of tasks) {
      if (!visited.has(t.id)) {
        result.push({ task: t, depth: 0 });
      }
    }

    return result;
  }, [tasks]);

  if (nodes.length === 0) return null;

  return (
    <div className="py-1">
      {nodes.map((node) => (
        <div
          key={node.task.id}
          className={cn(
            'py-1.5 px-2 flex items-center gap-2 text-xs cursor-pointer',
            'hover:bg-accent/30 transition-colors rounded-sm',
            'relative'
          )}
          style={{ paddingLeft: `${node.depth * 20 + 8}px` }}
          onClick={() => onTaskClick?.(node.task)}
        >
          {/* Connector line for child nodes */}
          {node.depth > 0 && (
            <div
              className="absolute border-l border-b border-muted-foreground/30"
              style={{
                left: `${(node.depth - 1) * 20 + 16}px`,
                top: 0,
                width: '12px',
                height: '50%',
              }}
            />
          )}
          {/* Status dot */}
          <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusDotColors[node.task.status] || 'bg-gray-500')} />
          {/* Title */}
          <span className="truncate">{node.task.title}</span>
        </div>
      ))}
    </div>
  );
}
