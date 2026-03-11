import { useState } from 'react';
import { GitMerge, Copy, Check, Sparkles, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import { persistTaskStatus } from '../../../stores/task-store';
import type { Task } from '../../../../shared/types';

interface StagedSuccessMessageProps {
  stagedSuccess: string;
  suggestedCommitMessage?: string;
  task: Task;
  hasWorktree?: boolean;
  projectPath?: string;
  onClose?: () => void;
  onReviewAgain?: () => void;
}

/**
 * Displays success message after changes have been freshly staged in the main project.
 * Includes AI-generated commit message and action buttons (mark done, delete worktree, review again).
 */
export function StagedSuccessMessage({
  stagedSuccess,
  suggestedCommitMessage,
  task,
  hasWorktree = false,
  onClose,
  onReviewAgain
}: StagedSuccessMessageProps) {
  const [commitMessage, setCommitMessage] = useState(suggestedCommitMessage || '');
  const [copied, setCopied] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMarkingDone, setIsMarkingDone] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCopy = async () => {
    if (!commitMessage) return;
    try {
      await navigator.clipboard.writeText(commitMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDeleteWorktreeAndMarkDone = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      const result = await window.electronAPI.discardWorktree(task.id, true);

      if (!result.success) {
        setError(result.error || 'Failed to delete worktree');
        return;
      }

      const statusResult = await persistTaskStatus(task.id, 'done');
      if (!statusResult.success) {
        setError('Worktree deleted but failed to update task status: ' + (statusResult.error || 'Unknown error'));
        return;
      }

      onClose?.();
    } catch (err) {
      console.error('Error deleting worktree:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete worktree');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMarkDoneOnly = async () => {
    setIsMarkingDone(true);
    setError(null);

    try {
      const result = await persistTaskStatus(task.id, 'done', { keepWorktree: true });
      if (!result.success) {
        setError(result.error || 'Failed to mark as done');
        return;
      }
      onClose?.();
    } catch (err) {
      console.error('Error marking task as done:', err);
      setError(err instanceof Error ? err.message : 'Failed to mark as done');
    } finally {
      setIsMarkingDone(false);
    }
  };

  const handleReviewAgain = async () => {
    if (!onReviewAgain) return;

    setIsResetting(true);
    setError(null);

    try {
      const result = await window.electronAPI.clearStagedState(task.id);

      if (!result.success) {
        setError(result.error || 'Failed to reset staged state');
        return;
      }

      onReviewAgain();
    } catch (err) {
      console.error('Error resetting staged state:', err);
      setError(err instanceof Error ? err.message : 'Failed to reset staged state');
    } finally {
      setIsResetting(false);
    }
  };

  const anyActionInProgress = isDeleting || isMarkingDone || isResetting;

  return (
    <div className="rounded-xl border border-success/30 bg-success/10 p-4">
      <h3 className="font-medium text-sm text-foreground mb-2 flex items-center gap-2">
        <GitMerge className="h-4 w-4 text-success" />
        Changes Staged Successfully
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        {stagedSuccess}
      </p>

      {/* Commit Message Section */}
      {suggestedCommitMessage && (
        <div className="bg-background/50 rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-purple-400" />
              AI-generated commit message
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-6 px-2 text-xs"
              disabled={!commitMessage}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1 text-success" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <Textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            className="font-mono text-xs min-h-[100px] bg-background/80 resize-y"
            placeholder="Commit message..."
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Edit as needed, then copy and use with <code className="bg-background px-1 rounded">git commit -m "..."</code>
          </p>
        </div>
      )}

      <div className="bg-background/50 rounded-lg p-3 mb-3">
        <p className="text-xs text-muted-foreground mb-2">Next steps:</p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Review staged changes with <code className="bg-background px-1 rounded">git status</code> and <code className="bg-background px-1 rounded">git diff --staged</code></li>
          <li>Commit when ready: <code className="bg-background px-1 rounded">git commit -m "your message"</code></li>
          <li>Push to remote when satisfied</li>
        </ol>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          {hasWorktree ? (
            <Button
              onClick={handleDeleteWorktreeAndMarkDone}
              disabled={anyActionInProgress}
              size="sm"
              variant="default"
              className="flex-1"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cleaning up...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Delete Worktree & Mark Done
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleMarkDoneOnly}
              disabled={anyActionInProgress}
              size="sm"
              variant="default"
              className="flex-1"
            >
              {isMarkingDone ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Marking done...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Mark as Done
                </>
              )}
            </Button>
          )}
        </div>

        {/* Secondary actions row */}
        <div className="flex gap-2">
          {hasWorktree && (
            <Button
              onClick={handleMarkDoneOnly}
              disabled={anyActionInProgress}
              size="sm"
              variant="outline"
              className="flex-1"
            >
              {isMarkingDone ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Marking done...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Mark Done Only
                </>
              )}
            </Button>
          )}

          {hasWorktree && onReviewAgain && (
            <Button
              onClick={handleReviewAgain}
              disabled={anyActionInProgress}
              size="sm"
              variant="outline"
              className="flex-1"
            >
              {isResetting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Review Again
                </>
              )}
            </Button>
          )}
        </div>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        {hasWorktree && (
          <p className="text-xs text-muted-foreground">
            "Delete Worktree & Mark Done" cleans up the isolated workspace. "Mark Done Only" keeps it for reference.
          </p>
        )}
      </div>
    </div>
  );
}
