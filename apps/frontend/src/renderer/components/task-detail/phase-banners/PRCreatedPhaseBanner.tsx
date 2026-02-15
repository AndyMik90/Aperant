import { useTranslation } from 'react-i18next';
import { GitPullRequest, CheckCircle2, ExternalLink } from 'lucide-react';
import { Button } from '../../ui/button';
import { persistTaskStatus } from '../../../stores/task-store';
import type { Task } from '../../../../shared/types';

interface PRCreatedPhaseBannerProps {
  task: Task;
  onClose?: () => void;
}

/**
 * Banner shown above tabs for the PR created phase.
 * Follows the same layout pattern as PlanningReview:
 * [Icon] Status Title  Description    [Action Buttons]
 */
export function PRCreatedPhaseBanner({ task, onClose }: PRCreatedPhaseBannerProps) {
  const { t } = useTranslation(['tasks']);

  const handleViewPR = () => {
    if (task.metadata?.prUrl) {
      window.electronAPI?.openExternal(task.metadata.prUrl);
    }
  };

  const handleMarkDone = async () => {
    const result = await persistTaskStatus(task.id, 'done');
    if (result.success && onClose) {
      onClose();
    }
  };

  return (
    <div className="border-b border-success/30 bg-success/5">
      <div className="px-5 py-3 flex items-center gap-3">
        <GitPullRequest className="h-4 w-4 text-success flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">
            {t('phaseBanners.prCreated.title', { defaultValue: 'Pull Request Created' })}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            {t('phaseBanners.prCreated.description', { defaultValue: 'Changes have been pushed and a PR is ready for review.' })}
          </span>
        </div>
        {task.metadata?.prUrl && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
            onClick={handleViewPR}
          >
            <ExternalLink className="h-3 w-3" />
            {t('tasks:actions.viewPR')}
          </Button>
        )}
        <Button
          variant="default"
          size="sm"
          className="h-7 gap-1.5"
          onClick={handleMarkDone}
        >
          <CheckCircle2 className="h-3 w-3" />
          {t('phaseBanners.prCreated.markDone', { defaultValue: 'Mark as Done' })}
        </Button>
      </div>
    </div>
  );
}
