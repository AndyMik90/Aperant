import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Square, Play, RefreshCw, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../ui/alert-dialog';
import { blurAndClose } from '../../../hooks/useSafeDialogClose';
import type { Task } from '../../../../shared/types';

interface CodingPhaseBannerProps {
  task: Task;
  isRunning: boolean;
  isAgentStopped: boolean;
  isStuck: boolean;
  isRecovering: boolean;
  completedSubtasks: number;
  totalSubtasks: number;
  onStartStop: () => void;
  onRecover: () => void;
  onRestartCoding: () => void;
  isRestartingCoding: boolean;
}

/**
 * Banner shown above tabs for the coding phase.
 * Follows the same layout pattern as PlanningReview:
 * [Icon] Status Title  Description    [Action Buttons]
 */
export function CodingPhaseBanner({
  task,
  isRunning,
  isAgentStopped,
  isStuck,
  isRecovering,
  completedSubtasks,
  totalSubtasks,
  onStartStop,
  onRecover,
  onRestartCoding,
  isRestartingCoding,
}: CodingPhaseBannerProps) {
  const { t } = useTranslation(['tasks']);
  const [showRestartDialog, setShowRestartDialog] = useState(false);

  if (isStuck) {
    return (
      <div className="border-b border-warning/30 bg-warning/5">
        <div className="px-5 py-3 flex items-center gap-3">
          <RotateCcw className="h-4 w-4 text-warning flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground">
              {t('phaseBanners.coding.stuck', { defaultValue: 'Task is Stuck' })}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              {t('phaseBanners.coding.stuckDesc', { defaultValue: 'The agent encountered an issue and needs recovery.' })}
            </span>
          </div>
          <Button
            variant="warning"
            size="sm"
            className="h-7 gap-1.5"
            onClick={onRecover}
            disabled={isRecovering}
          >
            {isRecovering ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            {t('tasks:actions.recover')}
          </Button>
        </div>
      </div>
    );
  }

  if (isRunning) {
    return (
      <div className="border-b border-info/30 bg-info/5">
        <div className="px-5 py-3 flex items-center gap-3">
          <Code className="h-4 w-4 text-info flex-shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground">
              {t('phaseBanners.coding.running', { defaultValue: 'Writing code...' })}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              {t('phaseBanners.coding.progress', {
                defaultValue: '{{current}}/{{total}} subtasks completed',
                current: completedSubtasks,
                total: totalSubtasks,
              })}
            </span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 gap-1.5"
            onClick={onStartStop}
          >
            <Square className="h-3 w-3" />
            {t('tasks:actions.stop')}
          </Button>
        </div>
      </div>
    );
  }

  // Paused / Stopped state
  return (
    <>
      <div className="border-b border-info/30 bg-info/5">
        <div className="px-5 py-3 flex items-center gap-3">
          <Code className="h-4 w-4 text-info flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground">
              {t('phaseBanners.coding.paused', { defaultValue: 'Coding Paused' })}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              {t('phaseBanners.coding.progress', {
                defaultValue: '{{current}}/{{total}} subtasks completed',
                current: completedSubtasks,
                total: totalSubtasks,
              })}
            </span>
          </div>
          {isAgentStopped && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5"
              onClick={() => setShowRestartDialog(true)}
              disabled={isRestartingCoding}
            >
              {isRestartingCoding ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {t('tasks:actions.restartCoding')}
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            className="h-7 gap-1.5"
            onClick={onStartStop}
          >
            <Play className="h-3 w-3" />
            {isAgentStopped
              ? t('tasks:actions.resume')
              : t('tasks:actions.run')}
          </Button>
        </div>
      </div>

      {/* Restart Coding Confirmation Dialog */}
      <AlertDialog open={showRestartDialog} onOpenChange={(open) => {
        if (!open) {
          blurAndClose(() => setShowRestartDialog(false));
        } else {
          setShowRestartDialog(true);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-warning" />
              {t('tasks:actions.restartCodingTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                <p dangerouslySetInnerHTML={{ __html: t('tasks:actions.restartCodingDesc', { title: task.title }) }} />
                <p>{t('tasks:actions.restartCodingPlanNote')}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel', { defaultValue: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setShowRestartDialog(false);
                onRestartCoding();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('tasks:actions.restartCoding')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
