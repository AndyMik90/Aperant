import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Play, RotateCcw, Loader2, Unlock } from 'lucide-react';
import { Button } from '../ui/button';
import { getStuckInfo, unstickSubtasks } from '@/stores/task-store';
import { useToast } from '@/hooks/use-toast';
import type { StuckSubtaskInfo } from '@shared/types/task';

interface TaskWarningsProps {
  isStuck: boolean;
  isIncomplete: boolean;
  isRecovering: boolean;
  taskProgress: { completed: number; total: number };
  projectId?: string;
  specId?: string;
  onRecover: () => void;
  onResume: () => void;
}

export function TaskWarnings({
  isStuck,
  isIncomplete,
  isRecovering,
  taskProgress,
  projectId,
  specId,
  onRecover,
  onResume
}: TaskWarningsProps) {
  const { t } = useTranslation('tasks');
  const { toast } = useToast();
  const [stuckSubtasks, setStuckSubtasks] = useState<StuckSubtaskInfo[]>([]);
  const [isLoadingStuck, setIsLoadingStuck] = useState(false);
  const [isUnsticking, setIsUnsticking] = useState(false);

  // Load stuck subtask info when stuck
  useEffect(() => {
    let ignore = false;
    if (isStuck && projectId && specId) {
      setIsLoadingStuck(true);
      getStuckInfo(projectId, specId)
        .then(result => {
          if (!ignore && result.success && result.stuckSubtasks) {
            setStuckSubtasks(result.stuckSubtasks);
          }
        })
        .finally(() => { if (!ignore) setIsLoadingStuck(false); });
    } else {
      setStuckSubtasks([]);
    }
    return () => { ignore = true; };
  }, [isStuck, projectId, specId]);

  const handleUnstick = async () => {
    if (!projectId || !specId) return;
    setIsUnsticking(true);
    try {
      const result = await unstickSubtasks(projectId, specId);
      if (result.success && result.cleared && result.cleared > 0) {
        toast({ title: t('messages.subtasksUnstuck', { count: result.cleared }) });
        setStuckSubtasks([]);
      } else if (result.error) {
        toast({ title: t('errors.unstickFailed'), description: result.error, variant: 'destructive' });
      }
    } finally {
      setIsUnsticking(false);
    }
  };

  if (!isStuck && !isIncomplete) return null;

  return (
    <>
      {/* Stuck Task Warning */}
      {isStuck && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-sm text-foreground mb-1">
                {t('warnings.taskStuck')}
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                {t('warnings.taskStuckDescription')}
              </p>

              {/* Stuck Subtasks Info */}
              {stuckSubtasks.length > 0 && (
                <div className="mb-3 p-2 bg-destructive/10 rounded text-sm">
                  <p className="font-medium text-destructive mb-1">
                    {t('labels.stuckSubtasks')} ({stuckSubtasks.length})
                  </p>
                  <ul className="space-y-1 max-h-32 overflow-y-auto">
                    {stuckSubtasks.map((stuck) => (
                      <li key={stuck.subtask_id} className="text-xs text-muted-foreground">
                        <span className="font-mono">{stuck.subtask_id}</span>:{' '}
                        <span className="truncate" title={stuck.reason}>
                          {stuck.reason.length > 80 ? `${stuck.reason.slice(0, 80)}...` : stuck.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={handleUnstick}
                    disabled={isUnsticking}
                  >
                    {isUnsticking ? (
                      <>
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        {t('actions.unsticking')}
                      </>
                    ) : (
                      <>
                        <Unlock className="mr-1.5 h-3 w-3" />
                        {t('actions.unstickSubtasks')}
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* Loading state for stuck info */}
              {isLoadingStuck && stuckSubtasks.length === 0 && (
                <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('labels.checkingStuck')}
                </div>
              )}

              <Button
                variant="warning"
                size="sm"
                onClick={onRecover}
                disabled={isRecovering}
                className="w-full"
              >
                {isRecovering ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('actions.recovering')}
                  </>
                ) : (
                  <>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {t('actions.recoverRestart')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Incomplete Task Warning */}
      {isIncomplete && !isStuck && (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-orange-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-sm text-foreground mb-1">
                {t('warnings.taskIncomplete')}
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                {t('warnings.taskIncompleteDescription', { completed: taskProgress.completed, total: taskProgress.total })}
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={onResume}
                className="w-full"
              >
                <Play className="mr-2 h-4 w-4" />
                {t('actions.resumeTask')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
