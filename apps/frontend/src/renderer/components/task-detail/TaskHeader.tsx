import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Pencil, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { TASK_STATUS_LABELS, JSON_ERROR_TITLE_SUFFIX } from '../../../shared/constants';
import type { Task } from '../../../shared/types';

interface TaskHeaderProps {
  task: Task;
  isStuck: boolean;
  isIncomplete: boolean;
  taskProgress: { completed: number; total: number };
  isRunning: boolean;
  onClose: () => void;
  onEdit: () => void;
}

export function TaskHeader({
  task,
  isStuck,
  isIncomplete,
  taskProgress,
  isRunning,
  onClose,
  onEdit
}: TaskHeaderProps) {
  const { t } = useTranslation(['tasks', 'errors']);

  // Handle JSON error suffix with i18n
  const displayTitle = useMemo(() => {
    if (task.title.endsWith(JSON_ERROR_TITLE_SUFFIX)) {
      const baseName = task.title.slice(0, -JSON_ERROR_TITLE_SUFFIX.length);
      return `${baseName} ${t('errors:task.jsonError.titleSuffix')}`;
    }
    return task.title;
  }, [task.title, t]);

  return (
    <div className="flex items-start justify-between p-4 pb-3">
      <div className="flex-1 min-w-0 pr-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <h2 className="font-semibold text-lg text-foreground line-clamp-2 leading-snug cursor-default">
              {displayTitle}
            </h2>
          </TooltipTrigger>
          {displayTitle.length > 40 && (
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-sm">{displayTitle}</p>
            </TooltipContent>
          )}
        </Tooltip>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs font-mono">
            {task.specId}
          </Badge>
          {isStuck ? (
            <Badge variant="warning" className="text-xs flex items-center gap-1 animate-pulse">
              <AlertTriangle className="h-3 w-3" />
              Stuck
            </Badge>
          ) : isIncomplete ? (
            <>
              <Badge variant="warning" className="text-xs flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Incomplete
              </Badge>
              <Badge variant="outline" className="text-xs text-orange-400">
                {taskProgress.completed}/{taskProgress.total} subtasks
              </Badge>
            </>
          ) : (
            <>
              <Badge
                variant={task.status === 'done' ? 'success' : task.status === 'human_review' ? 'purple' : task.status === 'in_progress' ? 'info' : 'secondary'}
                className={cn('text-xs', (task.status === 'in_progress' && !isStuck) && 'status-running')}
              >
                {t(TASK_STATUS_LABELS[task.status])}
              </Badge>
              {task.status === 'human_review' && task.reviewReason && (
                <Badge
                  variant={task.reviewReason === 'completed' ? 'success' : task.reviewReason === 'errors' ? 'destructive' : 'warning'}
                  className="text-xs"
                >
                  {task.reviewReason === 'completed' ? 'Completed' :
                   task.reviewReason === 'errors' ? 'Has Errors' :
                   task.reviewReason === 'plan_review' ? 'Approve Plan' :
                   task.reviewReason === 'stopped' ? 'Stopped' : 'QA Issues'}
                </Badge>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 -mr-1 -mt-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-primary/10 hover:text-primary transition-colors"
                onClick={onEdit}
                disabled={isRunning && !isStuck}
                aria-label={isRunning && !isStuck ? t('kanban.cannotEditWhileRunning') : t('kanban.editTask')}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isRunning && !isStuck ? t('kanban.cannotEditWhileRunning') : t('kanban.editTask')}
          </TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon" className="hover:bg-destructive/10 hover:text-destructive transition-colors" onClick={onClose} aria-label={t('kanban.closeTaskDetailsAriaLabel')}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
