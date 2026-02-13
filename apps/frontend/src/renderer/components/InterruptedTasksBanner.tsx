import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Play, X } from 'lucide-react';
import { Button } from './ui/button';
import { useTaskStore } from '../stores/task-store';

/**
 * Banner shown at the top of the Kanban board when interrupted coding tasks
 * are detected after app restart.
 *
 * Only shows tasks matching:
 * - status === 'coding'
 * - isAgentStopped === true (process not running)
 *
 * Excludes: planning tasks, human_review tasks, already running tasks.
 */
export function InterruptedTasksBanner() {
  const { t } = useTranslation(['tasks', 'common']);
  const interruptedCodingTaskIds = useTaskStore((state) => state.interruptedCodingTaskIds);
  const resumeAllInterrupted = useTaskStore((state) => state.resumeAllInterrupted);
  const clearInterruptedCodingTaskIds = useTaskStore((state) => state.clearInterruptedCodingTaskIds);

  if (interruptedCodingTaskIds.length === 0) {
    return null;
  }

  const count = interruptedCodingTaskIds.length;

  return (
    <div className="mx-6 mt-4 mb-2 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
        <span className="text-sm text-foreground">
          {count === 1
            ? t('banner.interruptedSingle', {
                defaultValue: '1 coding task was interrupted when the app closed.',
              })
            : t('banner.interruptedMultiple', {
                defaultValue: '{{count}} coding tasks were interrupted when the app closed.',
                count,
              })}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          variant="default"
          size="sm"
          className="h-7 px-3 gap-1.5"
          onClick={resumeAllInterrupted}
        >
          <Play className="h-3 w-3" />
          {t('banner.resumeAll', { defaultValue: 'Resume All' })}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={clearInterruptedCodingTaskIds}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
