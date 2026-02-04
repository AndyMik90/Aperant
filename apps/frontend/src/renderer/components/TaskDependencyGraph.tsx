/**
 * TaskDependencyGraph - Simple dependency visualization component
 *
 * SUG-6: Task Dependencies
 * Shows a tree/list view of task dependencies for the selected task.
 * Displays which tasks this task depends on and which tasks depend on it.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, ArrowRight, ArrowLeft, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { useTaskStore, isTaskBlocked, getBlockingTasks, getDependentTasks } from '../stores/task-store';
import type { Task } from '../../shared/types';

interface TaskDependencyGraphProps {
  task: Task;
  onTaskClick?: (taskId: string) => void;
}

export function TaskDependencyGraph({ task, onTaskClick }: TaskDependencyGraphProps) {
  const { t } = useTranslation(['tasks']);
  const tasks = useTaskStore((state) => state.tasks);

  // Get tasks this task depends on (blocking this task)
  const blockingTasks = useMemo(() => getBlockingTasks(task, tasks), [task, tasks]);

  // Get all dependency tasks (including completed ones)
  const allDependencyTasks = useMemo(() => {
    if (!task.dependencies || task.dependencies.length === 0) return [];
    return task.dependencies
      .map((depId) => tasks.find((t) => t.id === depId))
      .filter((t): t is Task => t !== undefined);
  }, [task.dependencies, tasks]);

  // Get tasks that depend on this task
  const dependentTasks = useMemo(() => getDependentTasks(task, tasks), [task, tasks]);

  // Check if this task is blocked
  const isBlocked = useMemo(() => isTaskBlocked(task, tasks), [task, tasks]);

  // Get status icon for a task
  const getStatusIcon = (depTask: Task) => {
    if (depTask.status === 'done') {
      return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    }
    if (depTask.status === 'coding' || depTask.status === 'ai_review') {
      return <Clock className="h-3.5 w-3.5 text-blue-500 animate-pulse" />;
    }
    return <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />;
  };

  // Get status label for a task
  const getStatusLabel = (depTask: Task) => {
    switch (depTask.status) {
      case 'done':
        return t('tasks:status.complete');
      case 'coding':
        return t('tasks:status.coding');
      case 'planning':
        return t('tasks:status.planning');
      case 'ai_review':
        return t('tasks:columns.ai_review');
      case 'human_review':
        return t('tasks:columns.human_review');
      case 'pr_created':
        return t('tasks:columns.pr_created');
      default:
        return depTask.status;
    }
  };

  // Render a task item in the graph
  const renderTaskItem = (depTask: Task, direction: 'dependency' | 'dependent') => (
    <div
      key={depTask.id}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border cursor-pointer',
        'transition-colors hover:bg-accent/50',
        depTask.status === 'done'
          ? 'border-green-500/20 bg-green-500/5'
          : 'border-yellow-500/20 bg-yellow-500/5'
      )}
      onClick={() => onTaskClick?.(depTask.id)}
    >
      {/* Direction indicator */}
      <div className="flex-shrink-0">
        {direction === 'dependency' ? (
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Task info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{depTask.title}</div>
        <div className="text-xs text-muted-foreground truncate">{depTask.specId}</div>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        {getStatusIcon(depTask)}
        <Badge
          variant="outline"
          className={cn(
            'text-[10px]',
            depTask.status === 'done'
              ? 'text-green-500 border-green-500/30'
              : 'text-yellow-500 border-yellow-500/30'
          )}
        >
          {getStatusLabel(depTask)}
        </Badge>
      </div>
    </div>
  );

  // If no dependencies and no dependents, show empty state
  if (allDependencyTasks.length === 0 && dependentTasks.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Link2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">{t('tasks:dependencies.none')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Blocked status banner */}
      {isBlocked && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
          <span className="text-sm text-yellow-500">
            {t('tasks:dependencies.blockedMessage')}
          </span>
        </div>
      )}

      {/* Dependencies section (tasks this task depends on) */}
      {allDependencyTasks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              {t('tasks:dependencies.title')}
            </h4>
            <Badge variant="outline" className="text-xs">
              {allDependencyTasks.length}
            </Badge>
            {blockingTasks.length > 0 && (
              <Badge variant="destructive" className="text-xs">
                {blockingTasks.length} {t('tasks:dependencies.blocked').toLowerCase()}
              </Badge>
            )}
          </div>
          <div className="space-y-2">
            {allDependencyTasks.map((depTask) => renderTaskItem(depTask, 'dependency'))}
          </div>
        </div>
      )}

      {/* Dependents section (tasks that depend on this task) */}
      {dependentTasks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              Dependent Tasks
            </h4>
            <Badge variant="outline" className="text-xs">
              {dependentTasks.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {dependentTasks.map((depTask) => renderTaskItem(depTask, 'dependent'))}
          </div>
        </div>
      )}
    </div>
  );
}
