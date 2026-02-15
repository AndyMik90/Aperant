import { useTranslation } from 'react-i18next';
import { CheckCircle2, Archive } from 'lucide-react';
import { Button } from '../../ui/button';
import { archiveTasks } from '../../../stores/task-store';
import type { Task } from '../../../../shared/types';

interface DonePhaseBannerProps {
  task: Task;
}

/**
 * Banner shown above tabs for the done phase.
 * Follows the same layout pattern as PlanningReview:
 * [Icon] Status Title  Description    [Action Buttons]
 */
export function DonePhaseBanner({ task }: DonePhaseBannerProps) {
  const { t } = useTranslation(['tasks']);

  const handleArchive = async () => {
    if (task.projectId) {
      await archiveTasks(task.projectId, [task.id]);
    }
  };

  return (
    <div className="border-b border-success/30 bg-success/5">
      <div className="px-5 py-3 flex items-center gap-3">
        <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">
            {t('phaseBanners.done.title', { defaultValue: 'Task Complete' })}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            {t('phaseBanners.done.description', { defaultValue: 'All work has been completed and approved.' })}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          onClick={handleArchive}
        >
          <Archive className="h-3 w-3" />
          {t('tasks:actions.archive')}
        </Button>
      </div>
    </div>
  );
}
