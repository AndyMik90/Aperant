/**
 * TaskDependencies - Component to select and display task dependencies
 *
 * SUG-6: Task Dependencies
 * Allows users to select which tasks must complete before this task can start.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, X, Plus, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import { cn } from '../../lib/utils';
import { useTaskStore } from '../../stores/task-store';
import type { Task } from '../../../shared/types';

interface TaskDependenciesProps {
  task: Task;
  onDependenciesChange?: (dependencies: string[]) => void;
  readonly?: boolean;
}

export function TaskDependencies({
  task,
  onDependenciesChange,
  readonly = false,
}: TaskDependenciesProps) {
  const { t } = useTranslation(['tasks']);
  const [open, setOpen] = useState(false);
  const tasks = useTaskStore((state) => state.tasks);

  // Get all tasks that can be added as dependencies (same project, not self, not already dependent)
  const availableTasks = useMemo(() => {
    return tasks.filter(
      (t) =>
        t.id !== task.id &&
        t.projectId === task.projectId &&
        !task.dependencies?.includes(t.id)
    );
  }, [tasks, task.id, task.projectId, task.dependencies]);

  // Get the actual task objects for current dependencies
  const dependencyTasks = useMemo(() => {
    if (!task.dependencies || task.dependencies.length === 0) return [];
    return task.dependencies
      .map((depId) => tasks.find((t) => t.id === depId))
      .filter((t): t is Task => t !== undefined);
  }, [tasks, task.dependencies]);

  // Check if task is blocked (has incomplete dependencies)
  const isBlocked = useMemo(() => {
    return dependencyTasks.some((dep) => dep.status !== 'done');
  }, [dependencyTasks]);

  // Handle adding a dependency
  const handleAddDependency = (dependencyId: string) => {
    const newDeps = [...(task.dependencies || []), dependencyId];
    onDependenciesChange?.(newDeps);
    setOpen(false);
  };

  // Handle removing a dependency
  const handleRemoveDependency = (dependencyId: string) => {
    const newDeps = (task.dependencies || []).filter((id) => id !== dependencyId);
    onDependenciesChange?.(newDeps);
  };

  // Get status badge for a task
  const getStatusBadge = (depTask: Task) => {
    if (depTask.status === 'done') {
      return (
        <Badge variant="outline" className="text-green-500 border-green-500/30 gap-1">
          <CheckCircle className="h-3 w-3" />
          {t('tasks:status.complete')}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 gap-1">
        <AlertCircle className="h-3 w-3" />
        {t(`tasks:status.${depTask.status}`)}
      </Badge>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {t('tasks:dependencies.title', { defaultValue: 'Dependencies' })}
          </span>
          {isBlocked && (
            <Badge variant="destructive" className="text-xs">
              {t('tasks:dependencies.blocked', { defaultValue: 'Blocked' })}
            </Badge>
          )}
        </div>

        {!readonly && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1">
                <Plus className="h-3 w-3" />
                {t('tasks:dependencies.add', { defaultValue: 'Add' })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <Command>
                <CommandInput
                  placeholder={t('tasks:dependencies.searchPlaceholder', {
                    defaultValue: 'Search tasks...',
                  })}
                />
                <CommandList>
                  <CommandEmpty>
                    {t('tasks:dependencies.noTasks', { defaultValue: 'No tasks found.' })}
                  </CommandEmpty>
                  <CommandGroup>
                    {availableTasks.map((availTask) => (
                      <CommandItem
                        key={availTask.id}
                        value={availTask.title}
                        onSelect={() => handleAddDependency(availTask.id)}
                        className="flex items-center gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{availTask.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {t(`tasks:status.${availTask.status}`)}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Dependencies list */}
      {dependencyTasks.length > 0 ? (
        <div className="space-y-2">
          {dependencyTasks.map((depTask) => (
            <div
              key={depTask.id}
              className={cn(
                'flex items-center gap-2 p-2 rounded border',
                depTask.status === 'done'
                  ? 'border-green-500/20 bg-green-500/5'
                  : 'border-yellow-500/20 bg-yellow-500/5'
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{depTask.title}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {depTask.specId}
                </div>
              </div>
              {getStatusBadge(depTask)}
              {!readonly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleRemoveDependency(depTask.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground py-2">
          {t('tasks:dependencies.none', { defaultValue: 'No dependencies' })}
        </div>
      )}

      {/* Blocked message */}
      {isBlocked && (
        <div className="flex items-center gap-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20">
          <AlertCircle className="h-4 w-4 text-yellow-500" />
          <span className="text-sm text-yellow-500">
            {t('tasks:dependencies.blockedMessage', {
              defaultValue: 'This task is blocked until all dependencies are complete.',
            })}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Check if a task is blocked by incomplete dependencies
 */
export function isTaskBlocked(task: Task, allTasks: Task[]): boolean {
  if (!task.dependencies || task.dependencies.length === 0) return false;
  return task.dependencies.some((depId) => {
    const depTask = allTasks.find((t) => t.id === depId);
    return depTask && depTask.status !== 'done';
  });
}

/**
 * Get list of blocking tasks
 */
export function getBlockingTasks(task: Task, allTasks: Task[]): Task[] {
  if (!task.dependencies || task.dependencies.length === 0) return [];
  return task.dependencies
    .map((depId) => allTasks.find((t) => t.id === depId))
    .filter((t): t is Task => t !== undefined && t.status !== 'done');
}
