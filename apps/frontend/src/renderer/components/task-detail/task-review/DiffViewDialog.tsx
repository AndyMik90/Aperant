import { useTranslation } from 'react-i18next';
import { Eye, FileCode } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../ui/alert-dialog';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import type { WorktreeDiff } from '../../../../shared/types';

interface DiffViewDialogProps {
  open: boolean;
  worktreeDiff: WorktreeDiff | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog displaying the list of changed files with their status and line changes
 */
export function DiffViewDialog({
  open,
  worktreeDiff,
  onOpenChange
}: DiffViewDialogProps) {
  const { t } = useTranslation('taskReview');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-purple-400" />
            {t('diff.title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {worktreeDiff?.summary || t('diff.noChanges')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex-1 overflow-auto min-h-0 -mx-6 px-6">
          {worktreeDiff?.files && worktreeDiff.files.length > 0 ? (
            <div className="space-y-2">
              {worktreeDiff.files.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileCode className={cn(
                      'h-4 w-4 shrink-0',
                      file.status === 'added' && 'text-success',
                      file.status === 'deleted' && 'text-destructive',
                      file.status === 'modified' && 'text-info',
                      file.status === 'renamed' && 'text-warning'
                    )} />
                    <span className="text-sm font-mono truncate">{file.path}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs',
                        file.status === 'added' && 'bg-success/10 text-success',
                        file.status === 'deleted' && 'bg-destructive/10 text-destructive',
                        file.status === 'modified' && 'bg-info/10 text-info',
                        file.status === 'renamed' && 'bg-warning/10 text-warning'
                      )}
                    >
                      {file.status}
                    </Badge>
                    <span className="text-xs text-success">+{file.additions}</span>
                    <span className="text-xs text-destructive">-{file.deletions}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {t('diff.noChangedFiles')}
            </div>
          )}
        </div>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel>{t('diff.close')}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
