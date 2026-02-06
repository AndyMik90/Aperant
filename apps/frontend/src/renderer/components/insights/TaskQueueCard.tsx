import { Play, Trash2, Check, X, Eye, Clock, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import type { InsightsQueuedTask } from '../../stores/insights-task-queue-store';
import { formatRelativeTime } from '../../lib/utils';

interface TaskQueueCardProps {
  task: InsightsQueuedTask;
  onStart: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onView: (taskId: string) => void;
  isCollapsed?: boolean;
}

/**
 * Format elapsed time (for running tasks)
 */
function formatElapsedTime(startedAt: Date): string {
  const elapsed = Date.now() - startedAt.getTime();
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

export function TaskQueueCard({ task, onStart, onDelete, onView, isCollapsed }: TaskQueueCardProps) {
  // Status badge configuration
  const statusConfig = {
    pending: {
      color: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
      icon: Clock,
      label: 'Pending',
    },
    running: {
      color: 'bg-green-500/10 text-green-500 border-green-500/30',
      icon: Clock,
      label: 'Running',
    },
    complete: {
      color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
      icon: Check,
      label: 'Complete',
    },
    failed: {
      color: 'bg-red-500/10 text-red-500 border-red-500/30',
      icon: X,
      label: 'Failed',
    },
  };

  const config = statusConfig[task.status];
  const StatusIcon = config.icon;

  if (isCollapsed) {
    // Collapsed view - just show status dot
    return (
      <div
        className={cn(
          'w-full h-10 flex items-center justify-center border-b border-border/50',
          'hover:bg-accent/50 cursor-pointer transition-colors'
        )}
        onClick={() => {
          if (task.status === 'complete' && task.taskId) {
            onView(task.taskId);
          }
        }}
        title={task.title}
      >
        <div className={cn('w-2 h-2 rounded-full', config.color.split(' ')[0].replace('/10', ''))} />
      </div>
    );
  }

  const hasKanbanLink = task.taskId && (task.status === 'running' || task.status === 'complete');

  return (
    <div
      className={cn(
        'p-3 border-b border-border/50 hover:bg-accent/30 transition-colors',
        hasKanbanLink && 'cursor-pointer'
      )}
      onClick={() => {
        if (hasKanbanLink) {
          onView(task.taskId!);
        }
      }}
    >
      {/* Header with status badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0.5 flex items-center gap-1', config.color)}>
          <StatusIcon className="w-3 h-3" />
          {config.label}
        </Badge>

        <div className="flex items-center gap-1">
          {/* View in Kanban icon (for running/complete tasks with taskId) */}
          {hasKanbanLink && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 hover:bg-primary/10 hover:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                onView(task.taskId!);
              }}
              title="View in Kanban"
            >
              <ExternalLink className="w-3 h-3" />
            </Button>
          )}

          {/* Delete button (only for pending/failed tasks) */}
          {(task.status === 'pending' || task.status === 'failed') && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task.id);
              }}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="text-sm font-medium mb-1 line-clamp-2">{task.title}</div>

      {/* Description */}
      {task.description && (
        <div className="text-xs text-muted-foreground mb-2 line-clamp-2">{task.description}</div>
      )}

      {/* Metadata badges */}
      {task.metadata && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.metadata.category && (
            <Badge variant="outline" className="text-[9px] px-1 py-0">
              {task.metadata.category}
            </Badge>
          )}
          {task.metadata.complexity && (
            <Badge variant="outline" className="text-[9px] px-1 py-0">
              {task.metadata.complexity}
            </Badge>
          )}
        </div>
      )}

      {/* Running task - show elapsed time and progress */}
      {task.status === 'running' && task.startedAt && (
        <div className="mb-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Clock className="w-3 h-3" />
            <span>{formatElapsedTime(task.startedAt)}</span>
          </div>
          {/* Indeterminate progress bar */}
          <div className="h-1 bg-accent rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-green-500 animate-pulse" />
          </div>
        </div>
      )}

      {/* Timestamp */}
      <div className="text-[10px] text-muted-foreground mb-2">
        {task.status === 'complete' && task.completedAt
          ? `Completed ${formatRelativeTime(task.completedAt)}`
          : task.status === 'running' && task.startedAt
          ? `Started ${formatRelativeTime(task.startedAt)}`
          : `Created ${formatRelativeTime(task.createdAt)}`}
      </div>

      {/* Actions */}
      <div className="flex gap-1.5">
        {/* Pending: Show Start button */}
        {task.status === 'pending' && (
          <Button
            size="sm"
            className="h-7 text-xs flex-1"
            onClick={(e) => {
              e.stopPropagation();
              onStart(task.id);
            }}
          >
            <Play className="w-3 h-3 mr-1" />
            Start
          </Button>
        )}

        {/* Complete: Show View in Kanban button */}
        {task.status === 'complete' && task.taskId && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs flex-1"
            onClick={(e) => {
              e.stopPropagation();
              onView(task.taskId!);
            }}
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            View in Kanban
          </Button>
        )}

        {/* Running: Show View in Kanban button */}
        {task.status === 'running' && task.taskId && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs flex-1"
            onClick={(e) => {
              e.stopPropagation();
              onView(task.taskId!);
            }}
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            View in Kanban
          </Button>
        )}

        {/* Failed: Show retry button */}
        {task.status === 'failed' && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs flex-1"
            onClick={(e) => {
              e.stopPropagation();
              onStart(task.id);
            }}
          >
            <Play className="w-3 h-3 mr-1" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
