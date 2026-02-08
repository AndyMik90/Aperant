import { useState, useMemo, useCallback } from 'react';
import {
  Link2,
  Plus,
  X,
  Search,
  CheckCircle2,
  Circle,
  ArrowRight,
  AlertTriangle,
  GitBranch
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { cn } from '../../lib/utils';
import {
  useTaskStore,
  persistTaskDependencies,
  isTaskBlocked,
  getBlockingTasks,
  getDependentTasks
} from '../../stores/task-store';
import { TASK_STATUS_LABELS } from '../../../shared/constants';
import type { Task } from '../../../shared/types';

interface DependencyEditorProps {
  task: Task;
  readOnly?: boolean;
}

/**
 * Status badge colors for dependency chips
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'done':
    case 'pr_created':
      return 'text-green-500 bg-green-500/10 border-green-500/30';
    case 'coding':
      return 'text-blue-500 bg-blue-500/10 border-blue-500/30';
    case 'human_review':
      return 'text-purple-500 bg-purple-500/10 border-purple-500/30';
    case 'ai_review':
      return 'text-cyan-500 bg-cyan-500/10 border-cyan-500/30';
    case 'planning':
    default:
      return 'text-muted-foreground bg-muted/50 border-border';
  }
}

function getStatusIcon(status: string) {
  if (status === 'done' || status === 'pr_created') {
    return <CheckCircle2 className="h-3 w-3 text-green-500" />;
  }
  return <Circle className="h-3 w-3" />;
}

/**
 * Detect circular dependencies.
 * Returns true if adding `targetId` as a dependency of `taskId` would create a cycle.
 */
function wouldCreateCycle(
  taskId: string,
  targetId: string,
  allTasks: Task[]
): boolean {
  // BFS: follow targetId's dependencies to see if we reach taskId
  const visited = new Set<string>();
  const queue = [targetId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const currentTask = allTasks.find(t => t.id === current);
    if (currentTask?.dependencies) {
      for (const depId of currentTask.dependencies) {
        if (!visited.has(depId)) {
          queue.push(depId);
        }
      }
    }
  }

  return false;
}

export function DependencyEditor({ task, readOnly = false }: DependencyEditorProps) {
  const allTasks = useTaskStore((state) => state.tasks);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Current dependencies (resolved to task objects)
  const currentDeps = useMemo(() => {
    if (!task.dependencies || task.dependencies.length === 0) return [];
    return task.dependencies
      .map(depId => allTasks.find(t => t.id === depId))
      .filter((t): t is Task => t !== undefined);
  }, [task.dependencies, allTasks]);

  // Tasks that depend on THIS task (reverse dependencies)
  const dependentTasks = useMemo(() => getDependentTasks(task, allTasks), [task, allTasks]);

  // Blocking tasks (incomplete dependencies)
  const blockingTasks = useMemo(() => getBlockingTasks(task, allTasks), [task, allTasks]);
  const blocked = isTaskBlocked(task, allTasks);

  // Available tasks to add as dependencies (excluding self, already-added, and would-create-cycle)
  const availableTasks = useMemo(() => {
    const currentDepIds = new Set(task.dependencies || []);
    return allTasks.filter(t => {
      if (t.id === task.id) return false;
      if (currentDepIds.has(t.id)) return false;
      // Filter by search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return t.title.toLowerCase().includes(q) || t.specId.toLowerCase().includes(q);
      }
      return true;
    });
  }, [allTasks, task.id, task.dependencies, searchQuery]);

  const handleAddDependency = useCallback(async (depId: string) => {
    // Check for circular dependency
    if (wouldCreateCycle(task.id, depId, allTasks)) {
      return; // Silently reject - the UI already shows the warning
    }

    setIsSaving(true);
    const newDeps = [...(task.dependencies || []), depId];
    await persistTaskDependencies(task.id, newDeps);
    setIsSaving(false);
  }, [task.id, task.dependencies, allTasks]);

  const handleRemoveDependency = useCallback(async (depId: string) => {
    setIsSaving(true);
    const newDeps = (task.dependencies || []).filter(id => id !== depId);
    await persistTaskDependencies(task.id, newDeps);
    setIsSaving(false);
  }, [task.id, task.dependencies]);

  const hasDeps = currentDeps.length > 0;
  const hasDependents = dependentTasks.length > 0;

  if (!hasDeps && !hasDependents && readOnly) return null;

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <GitBranch className="h-3 w-3 text-purple-400" />
          Dependencies
        </h3>
        {!readOnly && (
          <Popover open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) setSearchQuery(''); }}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={isSaving}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              {/* Search */}
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search tasks..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 text-sm"
                    autoFocus
                  />
                </div>
              </div>

              {/* Task List */}
              <ScrollArea className="max-h-[280px]">
                {availableTasks.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    {searchQuery ? 'No matching tasks' : 'No tasks available'}
                  </div>
                ) : (
                  <div className="p-1">
                    {availableTasks.map(t => {
                      const wouldCycle = wouldCreateCycle(task.id, t.id, allTasks);
                      return (
                        <button
                          key={t.id}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                            wouldCycle
                              ? 'opacity-50 cursor-not-allowed'
                              : 'hover:bg-accent cursor-pointer'
                          )}
                          onClick={() => {
                            if (!wouldCycle) {
                              handleAddDependency(t.id);
                              setIsAddOpen(false);
                              setSearchQuery('');
                            }
                          }}
                          disabled={wouldCycle}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {getStatusIcon(t.status)}
                            <span className="truncate flex-1 font-medium">{t.title}</span>
                            <Badge variant="outline" className={cn('text-[10px] shrink-0', getStatusColor(t.status))}>
                              {t.status.replace('_', ' ')}
                            </Badge>
                          </div>
                          {wouldCycle && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-destructive">
                              <AlertTriangle className="h-3 w-3" />
                              Would create circular dependency
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {t.specId}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Blocked Warning */}
      {blocked && blockingTasks.length > 0 && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-medium text-yellow-500">Blocked</span>
            <span className="text-muted-foreground">
              {' '}— waiting for {blockingTasks.length} task{blockingTasks.length > 1 ? 's' : ''} to complete
            </span>
          </div>
        </div>
      )}

      {/* Dependencies (this task depends on) */}
      {hasDeps && (
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">
            This task depends on:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {currentDeps.map(dep => (
              <Tooltip key={dep.id}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md border text-xs',
                      getStatusColor(dep.status)
                    )}
                  >
                    {getStatusIcon(dep.status)}
                    <span className="max-w-[180px] truncate font-medium">{dep.title}</span>
                    {!readOnly && (
                      <button
                        className="ml-0.5 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                        onClick={() => handleRemoveDependency(dep.id)}
                        disabled={isSaving}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <div className="text-xs">
                    <div className="font-medium">{dep.title}</div>
                    <div className="text-muted-foreground">{dep.specId} · {dep.status.replace('_', ' ')}</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      {/* Dependents (tasks that depend on this task) */}
      {hasDependents && (
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">
            Tasks waiting on this:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {dependentTasks.map(dep => (
              <Tooltip key={dep.id}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs',
                      getStatusColor(dep.status)
                    )}
                  >
                    <ArrowRight className="h-3 w-3" />
                    <span className="max-w-[180px] truncate font-medium">{dep.title}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <div className="text-xs">
                    <div className="font-medium">{dep.title}</div>
                    <div className="text-muted-foreground">{dep.specId} · {dep.status.replace('_', ' ')}</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasDeps && !hasDependents && !readOnly && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          <Link2 className="h-4 w-4" />
          No dependencies. Click "Add" to link tasks that must complete before this one can start.
        </div>
      )}
    </div>
  );
}
