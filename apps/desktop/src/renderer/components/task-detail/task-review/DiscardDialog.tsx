import { FolderX, Loader2 } from 'lucide-react';
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
import type { Task, WorktreeStatus } from '../../../../shared/types';

interface DiscardDialogProps {
  open: boolean;
  task: Task;
  worktreeStatus: WorktreeStatus | null;
  isDiscarding: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}

/**
 * Confirmation dialog for discarding build changes
 */
export function DiscardDialog({
  open,
  task,
  worktreeStatus,
  isDiscarding,
  onOpenChange,
  onDiscard
}: DiscardDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <FolderX className="h-5 w-5 text-destructive" />
            Discard Build
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-3">
              <p>
                Are you sure you want to discard all changes for <strong className="text-foreground">"{task.title}"</strong>?
              </p>
              <p className="text-destructive">
                This will permanently delete the isolated workspace and all uncommitted changes.
                The task will be moved back to Planning status.
              </p>
              {worktreeStatus?.exists && (
                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-muted-foreground">Files changed:</span>
                    <span>{worktreeStatus.filesChanged || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Lines:</span>
                    <span className="text-success">+{worktreeStatus.additions || 0}</span>
                    <span className="text-destructive">-{worktreeStatus.deletions || 0}</span>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDiscarding}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onDiscard();
            }}
            disabled={isDiscarding}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDiscarding ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                Discarding...
              </>
            ) : (
              <>
                <FolderX className="me-2 h-4 w-4" />
                Discard Build
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
