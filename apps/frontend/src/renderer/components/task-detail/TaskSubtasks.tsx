import { CheckCircle2, Clock, XCircle, AlertCircle, ListChecks, FileCode } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn, calculateProgress } from '../../lib/utils';
import type { Task } from '../../../shared/types';

interface TaskSubtasksProps {
  task: Task;
}

function getSubtaskStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />;
    case 'in_progress':
      return <Clock className="h-4 w-4 text-[var(--info)] animate-pulse" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-[var(--error)]" />;
    default:
      return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  }
}

export function TaskSubtasks({ task }: TaskSubtasksProps) {
  const { t } = useTranslation(['tasks']);
  const progress = calculateProgress(task.subtasks);

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden p-4 space-y-3">
      {task.subtasks.length === 0 ? (
        <div className="text-center py-12">
          <ListChecks className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground mb-1">No subtasks defined</p>
          <p className="text-xs text-muted-foreground/70">
            Implementation subtasks will appear here after planning
          </p>
        </div>
      ) : (
        <>
          {/* Progress summary */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pb-2 border-b border-border/50">
            <span>{task.subtasks.filter(c => c.status === 'completed').length} of {task.subtasks.length} completed</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          {task.subtasks.map((subtask, index) => (
            <div
              key={subtask.id}
              className={cn(
                'rounded-xl border border-border bg-secondary/30 p-3 transition-all duration-200 hover:bg-secondary/50 overflow-hidden',
                subtask.status === 'in_progress' && 'border-[var(--info)]/50 bg-[var(--info-light)] ring-1 ring-info/20',
                subtask.status === 'completed' && 'border-[var(--success)]/50 bg-[var(--success-light)]',
                subtask.status === 'failed' && 'border-[var(--error)]/50 bg-[var(--error-light)]'
              )}
            >
              <div className="flex items-start gap-2 w-full overflow-hidden">
                <div className="shrink-0">
                  {getSubtaskStatusIcon(subtask.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 w-full">
                    <span className={cn(
                      'text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 mt-0.5',
                      subtask.status === 'completed' ? 'bg-success/20 text-success' :
                      subtask.status === 'in_progress' ? 'bg-info/20 text-info' :
                      subtask.status === 'failed' ? 'bg-destructive/20 text-destructive' :
                      'bg-muted text-muted-foreground'
                    )}>
                      #{index + 1}
                    </span>
                    <span className="text-sm font-medium text-foreground break-words flex-1 min-w-0">
                      {subtask.title || t('tasks:subtasks.untitled')}
                    </span>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2 cursor-default break-words">
                        {subtask.description}
                      </p>
                    </TooltipTrigger>
                    {subtask.description && subtask.description.length > 80 && (
                      <TooltipContent side="bottom" className="max-w-sm">
                        <p className="text-xs">{subtask.description}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                  {subtask.files && subtask.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {subtask.files.map((file) => (
                        <Tooltip key={file}>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="secondary"
                              className="text-xs font-mono cursor-help"
                            >
                              <FileCode className="mr-1 h-3 w-3" />
                              {file.split('/').pop()}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="font-mono text-xs">
                            {file}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
