import { useMemo } from 'react';
import { Play, Trash2, Check, X, Clock, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { PhaseProgressIndicator } from '../PhaseProgressIndicator';
import type { InsightsQueuedTask } from '../../stores/insights-task-queue-store';
import type { Task } from '../../../shared/types';
import { formatRelativeTime } from '../../lib/utils';

interface TaskQueueCardProps {
  task: InsightsQueuedTask;
  linkedTask?: Task;
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

// Phase-to-color mapping (matches Kanban column colors)
const phaseColorMap: Record<string, { dot: string; badge: string; label: string }> = {
  starting:  { dot: 'bg-primary',     badge: 'bg-primary/10 text-primary border-primary/30',           label: 'Starting' },
  planning:  { dot: 'bg-amber-500',   badge: 'bg-amber-500/10 text-amber-500 border-amber-500/30',    label: 'Planning' },
  coding:    { dot: 'bg-blue-500',    badge: 'bg-blue-500/10 text-blue-500 border-blue-500/30',        label: 'Coding' },
  qa_review: { dot: 'bg-purple-500',  badge: 'bg-purple-500/10 text-purple-500 border-purple-500/30',  label: 'QA Review' },
  qa_fixing: { dot: 'bg-orange-500',  badge: 'bg-orange-500/10 text-orange-500 border-orange-500/30',  label: 'Fixing' },
  complete:  { dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30', label: 'Complete' },
  failed:    { dot: 'bg-red-500',     badge: 'bg-red-500/10 text-red-500 border-red-500/30',           label: 'Failed' },
};

// Base status config (for non-running or no linked task)
const statusConfig = {
  pending: {
    color: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
    dot: 'bg-blue-500',
    icon: Clock,
    label: 'Pending',
  },
  running: {
    color: 'bg-green-500/10 text-green-500 border-green-500/30',
    dot: 'bg-green-500',
    icon: Clock,
    label: 'Running',
  },
  complete: {
    color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
    dot: 'bg-emerald-500',
    icon: Check,
    label: 'Complete',
  },
  failed: {
    color: 'bg-red-500/10 text-red-500 border-red-500/30',
    dot: 'bg-red-500',
    icon: X,
    label: 'Failed',
  },
};

export function TaskQueueCard({ task, linkedTask, onStart, onDelete, onView, isCollapsed }: TaskQueueCardProps) {
  const baseConfig = statusConfig[task.status];
  const phase = linkedTask?.executionProgress?.phase;

  // Derive phase-aware config for running tasks
  const config = useMemo(() => {
    if (task.status !== 'running' || !phase) return baseConfig;
    const pc = phaseColorMap[phase];
    if (!pc) return baseConfig;
    return {
      color: pc.badge,
      dot: pc.dot,
      icon: baseConfig.icon,
      label: pc.label,
    };
  }, [task.status, phase, baseConfig]);

  const StatusIcon = config.icon;

  if (isCollapsed) {
    // Collapsed view - status dot with phase color
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
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
            >
              <div className={cn('w-2 h-2 rounded-full', config.dot)} />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{task.title} — {config.label}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const hasKanbanLink = task.taskId && (task.status === 'running' || task.status === 'complete');

  return (
    <div
      className={cn(
        'p-3 border-b border-border/50 hover:bg-accent/30 transition-colors overflow-hidden min-w-0',
        hasKanbanLink && 'cursor-pointer'
      )}
      onClick={() => {
        if (hasKanbanLink) {
          onView(task.taskId!);
        }
      }}
    >
      {/* Header with phase-aware status badge */}
      <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
        <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0.5 flex items-center gap-1', config.color)}>
          <StatusIcon className="w-3 h-3" />
          {config.label}
        </Badge>

        <div className="flex items-center gap-1">
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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-sm font-medium mb-1 line-clamp-2 break-words">{task.title}</div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{task.title}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Description */}
      {task.description && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-xs text-muted-foreground mb-2 line-clamp-2 break-words">{task.description}</div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{task.description}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Metadata badges */}
      {task.metadata && (
        <div className="flex flex-wrap gap-1 mb-2 min-w-0">
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

      {/* Running task - phase-aware progress */}
      {task.status === 'running' && (
        <div className="mb-2">
          {linkedTask?.executionProgress?.phase ? (
            <PhaseProgressIndicator
              phase={linkedTask.executionProgress.phase}
              subtasks={linkedTask.subtasks || []}
              phaseProgress={linkedTask.executionProgress?.phaseProgress}
              isRunning={true}
              isStuck={false}
            />
          ) : task.startedAt ? (
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Clock className="w-3 h-3" />
                <span>{formatElapsedTime(task.startedAt)}</span>
              </div>
              <div className="h-1 bg-accent rounded-full overflow-hidden">
                <div className="h-full w-1/3 bg-primary animate-pulse" />
              </div>
            </div>
          ) : null}
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
      <div className="flex gap-1.5 min-w-0">
        {task.status === 'pending' && (
          <>
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
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task.id);
              }}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Remove
            </Button>
          </>
        )}

        {task.status === 'failed' && (
          <>
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
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task.id);
              }}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
