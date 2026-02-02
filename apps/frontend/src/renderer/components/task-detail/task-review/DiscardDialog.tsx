import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('taskReview');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <FolderX className="h-5 w-5 text-destructive" />
            {t('discard.title')}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-3">
              <p>
                {t('discard.description', { title: task.title })}
              </p>
              <p className="text-destructive">
                {t('discard.warning')}
              </p>
              {worktreeStatus?.exists && (
                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-muted-foreground">{t('discard.filesChanged')}</span>
                    <span>{worktreeStatus.filesChanged || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('discard.lines')}</span>
                    <span className="text-success">+{worktreeStatus.additions || 0}</span>
                    <span className="text-destructive">-{worktreeStatus.deletions || 0}</span>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDiscarding}>{t('discard.cancel')}</AlertDialogCancel>
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('discard.discarding')}
              </>
            ) : (
              <>
                <FolderX className="mr-2 h-4 w-4" />
                {t('discard.discard')}
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
