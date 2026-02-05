import { useCallback } from 'react';
import { Play, Square, CheckCircle2, RotateCcw, Trash2, Loader2, AlertTriangle, Link2 } from 'lucide-react';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { blurAndClose } from '../../hooks/useSafeDialogClose';
import type { Task } from '../../../shared/types';

interface TaskActionsProps {
  task: Task;
  isStuck: boolean;
  isIncomplete: boolean;
  isRunning: boolean;
  isRecovering: boolean;
  showDeleteDialog: boolean;
  isDeleting: boolean;
  deleteError: string | null;
  isAgentStopped?: boolean;
  isBlocked?: boolean;
  onStartStop: () => void;
  onRecover: () => void;
  onDelete: () => void;
  onShowDeleteDialog: (show: boolean) => void;
  onStartBuild?: () => void;
}

export function TaskActions({
  task,
  isStuck,
  isIncomplete,
  isRunning,
  isRecovering,
  showDeleteDialog,
  isDeleting,
  deleteError,
  isAgentStopped = false,
  isBlocked = false,
  onStartStop,
  onRecover,
  onDelete,
  onShowDeleteDialog,
  onStartBuild
}: TaskActionsProps) {
  const isPlanning = task.status === 'planning';

  // Safe dialog close handler to prevent aria-hidden focus errors
  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      blurAndClose(() => onShowDeleteDialog(false));
    } else {
      onShowDeleteDialog(true);
    }
  }, [onShowDeleteDialog]);

  return (
    <>
      <div className="p-4">
        {isStuck ? (
          <Button
            className="w-full"
            variant="warning"
            onClick={onRecover}
            disabled={isRecovering}
          >
            {isRecovering ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Recovering...
              </>
            ) : (
              <>
                <RotateCcw className="mr-2 h-4 w-4" />
                Recover Task
              </>
            )}
          </Button>
        ) : isIncomplete ? (
          <Button
            className="w-full"
            variant="default"
            onClick={onStartStop}
          >
            <Play className="mr-2 h-4 w-4" />
            Resume Task
          </Button>
        ) : isPlanning ? (
          // Planning phase - gated workflow matching TaskCard.tsx
          isAgentStopped ? (
            // Agent was stopped - show Resume + Start Build
            <div className="flex flex-col gap-2">
              <Button
                className="w-full"
                variant="outline"
                onClick={onStartStop}
              >
                <Play className="mr-2 h-4 w-4" />
                Resume Planning
              </Button>
              <Button
                className="w-full"
                variant="default"
                onClick={onStartBuild}
                disabled={isBlocked || !onStartBuild}
              >
                {isBlocked ? (
                  <>
                    <Link2 className="mr-2 h-4 w-4" />
                    Blocked
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Start Build
                  </>
                )}
              </Button>
            </div>
          ) : (
            // Agent is running - show Stop only
            <Button
              className="w-full"
              variant="destructive"
              onClick={onStartStop}
            >
              <Square className="mr-2 h-4 w-4" />
              Stop Planning
            </Button>
          )
        ) : task.status === 'coding' && (
          <Button
            className="w-full"
            variant={isRunning ? 'destructive' : 'default'}
            onClick={onStartStop}
          >
            {isRunning ? (
              <>
                <Square className="mr-2 h-4 w-4" />
                Stop Task
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                {isAgentStopped ? 'Resume' : 'Start Task'}
              </>
            )}
          </Button>
        )}
        {task.status === 'done' && (
          <div className="completion-state text-sm">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Task completed successfully</span>
          </div>
        )}

        {/* Delete Button - always visible but disabled when running */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={() => onShowDeleteDialog(true)}
          disabled={isRunning && !isStuck}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Task
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={handleDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Task
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>
                  Are you sure you want to delete <strong className="text-foreground">"{task.title}"</strong>?
                </p>
                <p className="text-destructive">
                  This action cannot be undone. All task files, including the spec, implementation plan, and any generated code will be permanently deleted from the project.
                </p>
                {deleteError && (
                  <p className="text-destructive bg-destructive/10 px-3 py-2 rounded-lg text-sm">
                    {deleteError}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Permanently
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
