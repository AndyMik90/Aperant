import { useState, useCallback } from 'react';
import { CheckCircle2, Clock, XCircle, AlertCircle, ListChecks, FileCode, ChevronRight, ChevronsUpDown } from 'lucide-react';
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setExpandedIds(prev => {
      if (prev.size === task.subtasks.length) {
        return new Set();
      }
      return new Set(task.subtasks.map(s => s.id));
    });
  }, [task.subtasks]);

  const allExpanded = expandedIds.size === task.subtasks.length && task.subtasks.length > 0;

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
            <div className="flex items-center gap-2">
              <span className="tabular-nums">{progress}%</span>
              <button
                type="button"
                onClick={toggleAll}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-secondary"
              >
                <ChevronsUpDown className="h-3 w-3" />
                {allExpanded ? t('tasks:subtasks.collapseAll', 'Collapse all') : t('tasks:subtasks.expandAll', 'Expand all')}
              </button>
            </div>
          </div>
          {task.subtasks.map((subtask, index) => {
            const isExpanded = expandedIds.has(subtask.id);
            const hasDetails = (subtask.description && subtask.description !== subtask.title) ||
              (subtask.files && subtask.files.length > 0) ||
              subtask.verification;

            return (
              <div
                key={subtask.id}
                className={cn(
                  'rounded-xl border border-border bg-secondary/30 transition-all duration-200 hover:bg-secondary/50 overflow-hidden',
                  subtask.status === 'in_progress' && 'border-[var(--info)]/50 bg-[var(--info-light)] ring-1 ring-info/20',
                  subtask.status === 'completed' && 'border-[var(--success)]/50 bg-[var(--success-light)]',
                  subtask.status === 'failed' && 'border-[var(--error)]/50 bg-[var(--error-light)]'
                )}
              >
                {/* Collapsed header — always visible */}
                <button
                  type="button"
                  onClick={() => toggleExpand(subtask.id)}
                  className="flex items-center gap-2 w-full p-3 text-left cursor-pointer"
                >
                  <div className="shrink-0">
                    {getSubtaskStatusIcon(subtask.status)}
                  </div>
                  <span className={cn(
                    'text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0',
                    subtask.status === 'completed' ? 'bg-success/20 text-success' :
                    subtask.status === 'in_progress' ? 'bg-info/20 text-info' :
                    subtask.status === 'failed' ? 'bg-destructive/20 text-destructive' :
                    'bg-muted text-muted-foreground'
                  )}>
                    #{index + 1}
                  </span>
                  <span className="text-sm font-medium text-foreground flex-1 min-w-0 line-clamp-2">
                    {subtask.title || t('tasks:subtasks.untitled')}
                  </span>
                  {hasDetails && (
                    <ChevronRight className={cn(
                      'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                      isExpanded && 'rotate-90'
                    )} />
                  )}
                </button>

                {/* Expanded details */}
                {isExpanded && hasDetails && (
                  <div className="px-3 pb-3 pt-0 ml-6 border-t border-border/30 mt-0">
                    {subtask.description && subtask.description !== subtask.title && (
                      <p className="mt-2 text-xs text-muted-foreground break-words whitespace-pre-wrap">
                        {subtask.description}
                      </p>
                    )}
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
                    {subtask.verification && (
                      <div className="mt-2 text-xs text-muted-foreground/80">
                        <span className="font-medium">Verification:</span> {subtask.verification.type}
                        {subtask.verification.run && (
                          <code className="ml-1 text-[11px] bg-muted px-1 py-0.5 rounded">{subtask.verification.run}</code>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
