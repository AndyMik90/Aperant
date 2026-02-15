import { useTranslation } from 'react-i18next';
import { TestTube2, Square } from 'lucide-react';
import { Button } from '../../ui/button';

interface AIReviewPhaseBannerProps {
  isRunning: boolean;
  onStop: () => void;
}

/**
 * Banner shown above tabs for the AI review (testing) phase.
 * Follows the same layout pattern as PlanningReview:
 * [Icon] Status Title  Description    [Action Buttons]
 */
export function AIReviewPhaseBanner({
  isRunning,
  onStop,
}: AIReviewPhaseBannerProps) {
  const { t } = useTranslation(['tasks']);

  if (isRunning) {
    return (
      <div className="border-b border-yellow-500/30 bg-yellow-500/5">
        <div className="px-5 py-3 flex items-center gap-3">
          <TestTube2 className="h-4 w-4 text-yellow-500 flex-shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground">
              {t('phaseBanners.aiReview.running', { defaultValue: 'Running Tests...' })}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              {t('phaseBanners.aiReview.runningDesc', { defaultValue: 'AI is reviewing the implementation and running validation checks.' })}
            </span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 gap-1.5"
            onClick={onStop}
          >
            <Square className="h-3 w-3" />
            {t('tasks:actions.stopTesting', { defaultValue: 'Stop Testing' })}
          </Button>
        </div>
      </div>
    );
  }

  // Not running — show paused state
  return (
    <div className="border-b border-yellow-500/30 bg-yellow-500/5">
      <div className="px-5 py-3 flex items-center gap-3">
        <TestTube2 className="h-4 w-4 text-yellow-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">
            {t('phaseBanners.aiReview.paused', { defaultValue: 'Testing Paused' })}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            {t('phaseBanners.aiReview.pausedDesc', { defaultValue: 'Testing was interrupted. Results may be incomplete.' })}
          </span>
        </div>
      </div>
    </div>
  );
}
