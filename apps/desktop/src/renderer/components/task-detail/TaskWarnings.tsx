import { AlertTriangle, Play, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';

interface TaskWarningsProps {
  isStuck: boolean;
  isIncomplete: boolean;
  isRecovering: boolean;
  taskProgress: { completed: number; total: number };
  onRecover: () => void;
  onResume: () => void;
}

export function TaskWarnings({
  isStuck,
  isIncomplete,
  isRecovering,
  taskProgress,
  onRecover,
  onResume
}: TaskWarningsProps) {
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
                Task Appears Stuck
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                This task is marked as running but no active process was found.
                This can happen if the app crashed or the process was terminated unexpectedly.
              </p>
              <Button
                variant="warning"
                size="sm"
                onClick={onRecover}
                disabled={isRecovering}
                className="w-full"
              >
                {isRecovering ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    Recovering...
                  </>
                ) : (
                  <>
                    <RotateCcw className="me-2 h-4 w-4" />
                    Recover & Restart Task
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
                Task Incomplete
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                This task has a spec and implementation plan but never completed any subtasks ({taskProgress.completed}/{taskProgress.total}).
                The process likely crashed during spec creation. Click Resume to continue implementation.
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={onResume}
                className="w-full"
              >
                <Play className="me-2 h-4 w-4" />
                Resume Task
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
