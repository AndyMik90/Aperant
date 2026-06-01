import { useState, useEffect } from 'react';
import { GitPullRequest, Loader2, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Checkbox } from '../../ui/checkbox';
import type { Task, WorktreeStatus, WorktreeCreatePRResult } from '../../../../shared/types';

interface CreatePRDialogProps {
  open: boolean;
  task: Task;
  worktreeStatus: WorktreeStatus | null;
  onOpenChange: (open: boolean) => void;
  onCreatePR: (options: { targetBranch?: string; title?: string; draft?: boolean }) => Promise<WorktreeCreatePRResult | null>;
}

/**
 * Dialog for creating a Pull Request from a worktree branch
 * Allows user to specify target branch, PR title, and draft status
 */
export function CreatePRDialog({
  open,
  task,
  worktreeStatus,
  onOpenChange,
  onCreatePR
}: CreatePRDialogProps) {
  const { t } = useTranslation(['taskReview', 'common']);
  const [targetBranch, setTargetBranch] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<WorktreeCreatePRResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTargetBranch(worktreeStatus?.baseBranch || '');
      setPrTitle(task.title);
      setIsDraft(false);
      setIsCreating(false);
      setResult(null);
      setError(null);
    }
  }, [open, worktreeStatus?.baseBranch, task.title]);

  // Frontend validation functions
  const validateBranchName = (branch: string): string | null => {
    if (!branch.trim()) return null; // Empty is OK, will use default
    // Basic git branch name rules: no spaces, .., @{, \, etc.
    if (!/^[a-zA-Z0-9/_-]+$/.test(branch)) {
      return t('taskReview:pr.errors.invalidBranchName');
    }
    return null;
  };

  const validatePRTitle = (title: string): string | null => {
    if (!title.trim()) {
      return t('taskReview:pr.errors.emptyTitle');
    }
    return null;
  };

  const handleCreatePR = async () => {
    // Frontend validation before submitting
    const branchError = validateBranchName(targetBranch);
    if (branchError) {
      setError(branchError);
      return;
    }

    const titleError = validatePRTitle(prTitle);
    if (titleError) {
      setError(titleError);
      return;
    }

    setIsCreating(true);
    setError(null);
    setResult(null);

    try {
      const prResult = await onCreatePR({
        targetBranch: targetBranch || undefined,
        title: prTitle || undefined,
        draft: isDraft
      });

      if (prResult) {
        if (prResult.success) {
          setResult(prResult);
        } else {
          setError(prResult.error || t('taskReview:pr.errors.unknown'));
        }
      } else {
        setError(t('taskReview:pr.errors.unknown'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taskReview:pr.errors.unknown'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleOpenPR = () => {
    if (result?.prUrl && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(result.prUrl);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5 text-primary" />
            {t('taskReview:pr.title')}
          </DialogTitle>
          <DialogDescription>
            {t('taskReview:pr.description', { taskTitle: task.title })}
          </DialogDescription>
        </DialogHeader>

        {/* Success State */}
        {result?.success && (
          <div className="space-y-4">
            <div className="bg-success/10 border border-success/30 rounded-lg p-4">
              <p className="text-sm text-success font-medium mb-2">
                {result.alreadyExists
                  ? t('taskReview:pr.success.alreadyExists')
                  : t('taskReview:pr.success.created')}
              </p>
              {result.prUrl && (
                <button
                  type="button"
                  data-testid="pr-link-button"
                  onClick={handleOpenPR}
                  className="text-sm text-primary hover:underline flex items-center gap-1 bg-transparent border-none cursor-pointer p-0"
                >
                  {result.prUrl}
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>
                {t('common:buttons.close')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Error State */}
        {error && !result?.success && (
          <div className="space-y-4">
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
              <p className="text-sm text-destructive">{error}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                {t('common:buttons.cancel')}
              </Button>
              <Button onClick={handleCreatePR} disabled={isCreating}>
                {t('taskReview:pr.actions.retry')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Form State */}
        {!result?.success && !error && (
          <div className="space-y-4">
            {/* Branch Info */}
            <div className="bg-muted/50 rounded-lg p-3 text-sm" data-testid="pr-stats-container">
              <div className="flex justify-between mb-1">
                <span className="text-muted-foreground">{t('taskReview:pr.labels.sourceBranch')}:</span>
                <span className="font-mono">{worktreeStatus?.branch || t('taskReview:pr.labels.unknown')}</span>
              </div>
              {worktreeStatus?.exists && (
                <>
                  <div className="flex justify-between mb-1">
                    <span className="text-muted-foreground">{t('taskReview:pr.labels.commits')}:</span>
                    <span>{worktreeStatus.commitCount || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('taskReview:pr.labels.changes')}:</span>
                    <span>
                      <span className="text-success">+{worktreeStatus.additions || 0}</span>
                      {' / '}
                      <span className="text-destructive">-{worktreeStatus.deletions || 0}</span>
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Target Branch */}
            <div className="space-y-2">
              <Label htmlFor="targetBranch">{t('taskReview:pr.labels.targetBranch')}</Label>
              <Input
                id="targetBranch"
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                placeholder={worktreeStatus?.baseBranch || 'main'}
              />
              <p className="text-xs text-muted-foreground">
                {t('taskReview:pr.hints.targetBranch')}
              </p>
            </div>

            {/* PR Title (optional) */}
            <div className="space-y-2">
              <Label htmlFor="prTitle">{t('taskReview:pr.labels.prTitle')}</Label>
              <Input
                id="prTitle"
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
                placeholder={task.title}
              />
              <p className="text-xs text-muted-foreground">
                {t('taskReview:pr.hints.prTitle')}
              </p>
            </div>

            {/* Draft PR Checkbox */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="draft-pr-checkbox"
                checked={isDraft}
                onCheckedChange={(checked) => setIsDraft(checked === true)}
              />
              <label htmlFor="draft-pr-checkbox" className="text-sm cursor-pointer">
                {t('taskReview:pr.labels.draftPR')}
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose} disabled={isCreating}>
                {t('common:buttons.cancel')}
              </Button>
              <Button onClick={handleCreatePR} disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t('taskReview:pr.actions.creating')}
                  </>
                ) : (
                  <>
                    <GitPullRequest className="me-2 h-4 w-4" />
                    {t('taskReview:pr.actions.create')}
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
