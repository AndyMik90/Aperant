import { useTranslation } from 'react-i18next';
import { AlertTriangle, GitMerge } from 'lucide-react';
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
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import { getSeverityIcon, getSeverityVariant } from './utils';
import type { MergeConflict, MergeStats, GitConflictInfo } from '../../../../shared/types';

interface ConflictDetailsDialogProps {
  open: boolean;
  mergePreview: { files: string[]; conflicts: MergeConflict[]; summary: MergeStats; gitConflicts?: GitConflictInfo } | null;
  stageOnly: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge: () => void;
}

/**
 * Dialog displaying detailed information about merge conflicts
 */
export function ConflictDetailsDialog({
  open,
  mergePreview,
  stageOnly,
  onOpenChange,
  onMerge
}: ConflictDetailsDialogProps) {
  const { t } = useTranslation('taskReview');
  const conflictCount = mergePreview?.conflicts.length || 0;
  const autoMergeable = mergePreview?.summary.autoMergeable || 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            {t('conflict.title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('conflict.potentialConflicts', { count: conflictCount })}
            {mergePreview && autoMergeable > 0 && (
              <span className="text-success ml-1">
                {t('conflict.canBeAutoMerged', { count: autoMergeable })}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex-1 overflow-auto min-h-0 -mx-6 px-6">
          {mergePreview?.conflicts && mergePreview.conflicts.length > 0 ? (
            <div className="space-y-3">
              {mergePreview.conflicts.map((conflict, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "p-3 rounded-lg border",
                    conflict.canAutoMerge
                      ? "bg-secondary/30 border-border"
                      : conflict.severity === 'high' || conflict.severity === 'critical'
                        ? "bg-destructive/10 border-destructive/30"
                        : "bg-warning/10 border-warning/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {getSeverityIcon(conflict.severity)}
                      <span className="text-sm font-mono truncate">{conflict.file}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="secondary"
                        className={cn('text-xs', getSeverityVariant(conflict.severity))}
                      >
                        {conflict.severity}
                      </Badge>
                      {conflict.canAutoMerge && (
                        <Badge variant="secondary" className="text-xs bg-success/10 text-success">
                          {t('conflict.autoMerge')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    {conflict.location && (
                      <div><span className="text-foreground/70">{t('conflict.location')}</span> {conflict.location}</div>
                    )}
                    {conflict.reason && (
                      <div><span className="text-foreground/70">{t('conflict.reason')}</span> {conflict.reason}</div>
                    )}
                    {conflict.strategy && (
                      <div><span className="text-foreground/70">{t('conflict.strategy')}</span> {conflict.strategy}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {t('conflict.noConflicts')}
            </div>
          )}
        </div>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel>{t('conflict.close')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onOpenChange(false);
              onMerge();
            }}
            className="bg-warning text-warning-foreground hover:bg-warning/90"
          >
            <GitMerge className="mr-2 h-4 w-4" />
            {stageOnly ? t('merge.buttons.stageWithAIMerge') : t('merge.buttons.mergeWithAI')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
