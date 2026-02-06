import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitPullRequest,
  Loader2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MinusCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Progress } from './ui/progress';
import { ScrollArea } from './ui/scroll-area';
import type { Task, WorktreeCreatePRResult } from '../../shared/types';
import { useTaskStore } from '../stores/task-store';

/**
 * Check if an error message indicates a worktree-related issue (missing worktree, no branch, etc.)
 * This is used to show 'skipped' status instead of 'error' for tasks without worktrees.
 *
 * TODO: This string-based error detection is brittle. The API should ideally return typed error codes
 * instead of relying on message parsing which may break with i18n or message changes.
 */
function isWorktreeRelatedError(errorMsg: string): boolean {
  const lowerMsg = errorMsg.toLowerCase();
  return lowerMsg.includes('worktree') ||
         lowerMsg.includes('no branch') ||
         lowerMsg.includes('not found');
}

/**
 * Result for a single task in the bulk PR creation
 */
interface TaskPRResult {
  taskId: string;
  taskTitle: string;
  status: 'pending' | 'creating' | 'success' | 'skipped' | 'error';
  result?: WorktreeCreatePRResult;
  error?: string;
  alreadyExists?: boolean;
}

interface BulkPRDialogProps {
  open: boolean;
  tasks: Task[];
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

/**
 * Dialog for creating Pull Requests for multiple tasks in bulk
 * Shows progress tracking and results per task
 */
export function BulkPRDialog({
  open,
  tasks,
  onOpenChange,
  onComplete
}: BulkPRDialogProps) {
  const { t } = useTranslation(['taskReview', 'common', 'tasks']);

  // Common options for all PRs
  const [targetBranch, setTargetBranch] = useState('');
  const [isDraft, setIsDraft] = useState(false);

  // Progress tracking
  const [step, setStep] = useState<'options' | 'creating' | 'results'>('options');
  const [taskResults, setTaskResults] = useState<TaskPRResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const isCancelledRef = useRef(false);

  const prevOpenRef = useRef(open);

  // Only reset when transitioning closed→open (not on tasks array changes during async operation)
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    if (open && !wasOpen) {
      setTargetBranch('');
      setIsDraft(false);
      setStep('options');
      setCurrentIndex(0);
      isCancelledRef.current = false;
      setTaskResults(tasks.map(task => ({
        taskId: task.id,
        taskTitle: task.title,
        status: 'pending'
      })));
    }
  }, [open, tasks]);

  // Validation
  const validateBranchName = useCallback((branch: string): string | null => {
    if (!branch.trim()) return null; // Empty is OK, will use default
    if (!/^[a-zA-Z0-9/_-]+$/.test(branch)) {
      return t('taskReview:pr.errors.invalidBranchName');
    }
    return null;
  }, [t]);

  const handleCreatePRs = useCallback(async () => {
    const branchError = validateBranchName(targetBranch);
    if (branchError) {
      return;
    }

    setStep('creating');
    isCancelledRef.current = false;

    const results: TaskPRResult[] = tasks.map(task => ({
      taskId: task.id,
      taskTitle: task.title,
      status: 'pending' as const
    }));
    setTaskResults(results);

    for (let i = 0; i < tasks.length; i++) {
      if (isCancelledRef.current) break;

      setCurrentIndex(i);

      setTaskResults(prev => prev.map((r, idx) =>
        idx === i ? { ...r, status: 'creating' as const } : r
      ));

      try {
        const prResult = await window.electronAPI?.createWorktreePR(tasks[i].id, {
          targetBranch: targetBranch || undefined,
          draft: isDraft
        });

        if (isCancelledRef.current) break;

        if (prResult?.success && prResult.data) {
          const data = prResult.data;
          setTaskResults(prev => prev.map((r, idx) =>
            idx === i ? {
              ...r,
              status: data.success ? 'success' as const : 'error' as const,
              result: data,
              alreadyExists: data.alreadyExists,
              error: data.success ? undefined : (data.error || t('taskReview:pr.errors.unknown'))
            } : r
          ));

          // Update task state in store with new status and prUrl (more efficient than reloading all tasks)
          if (data.success && data.prUrl && !data.alreadyExists) {
            const currentTask = tasks[i];
            useTaskStore.getState().updateTask(currentTask.id, {
              status: 'done',
              metadata: { ...currentTask.metadata, prUrl: data.prUrl }
            });
          }
        } else {
          const errorMsg = prResult?.error || '';
          setTaskResults(prev => prev.map((r, idx) =>
            idx === i ? {
              ...r,
              status: isWorktreeRelatedError(errorMsg) ? 'skipped' as const : 'error' as const,
              error: isWorktreeRelatedError(errorMsg)
                ? t('taskReview:bulkPR.noWorktree')
                : (prResult?.error || t('taskReview:pr.errors.unknown'))
            } : r
          ));
        }
      } catch (err) {
        if (isCancelledRef.current) break;

        const errorMsg = err instanceof Error ? err.message : '';
        setTaskResults(prev => prev.map((r, idx) =>
          idx === i ? {
            ...r,
            status: isWorktreeRelatedError(errorMsg) ? 'skipped' as const : 'error' as const,
            error: isWorktreeRelatedError(errorMsg)
              ? t('taskReview:bulkPR.noWorktree')
              : (err instanceof Error ? err.message : t('taskReview:pr.errors.unknown'))
          } : r
        ));
      }
    }

    if (!isCancelledRef.current) {
      setStep('results');
    }
  }, [tasks, targetBranch, isDraft, t, validateBranchName]);

  const handleClose = () => {
    isCancelledRef.current = true;
    if (step === 'results' && onComplete) {
      onComplete();
    }
    onOpenChange(false);
  };

  const handleOpenPR = (url: string) => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    }
  };

  // Calculate progress
  const completedCount = taskResults.filter(r => r.status === 'success' || r.status === 'error' || r.status === 'skipped').length;
  const successCount = taskResults.filter(r => r.status === 'success').length;
  const errorCount = taskResults.filter(r => r.status === 'error').length;
  const skippedCount = taskResults.filter(r => r.status === 'skipped').length;
  const progress = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5 text-primary" />
            {t('taskReview:bulkPR.title')}
          </DialogTitle>
          <DialogDescription>
            {step === 'options' && t('taskReview:bulkPR.description', { count: tasks.length })}
            {step === 'creating' && t('taskReview:bulkPR.creating', { current: currentIndex + 1, total: tasks.length })}
            {step === 'results' && (skippedCount > 0
              ? t('taskReview:bulkPR.resultsDescriptionWithSkipped', { success: successCount, skipped: skippedCount, failed: errorCount })
              : t('taskReview:bulkPR.resultsDescription', { success: successCount, failed: errorCount })
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Options Step */}
        {step === 'options' && (
          <div className="space-y-4">
            {/* Task List Preview */}
            <div className="space-y-2">
              <Label>{t('taskReview:bulkPR.tasksToProcess')}</Label>
              <ScrollArea className="h-32 rounded-md border border-border p-2">
                <div className="space-y-1">
                  {tasks.map((task, idx) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/50"
                    >
                      <span className="text-muted-foreground">{idx + 1}.</span>
                      <span className="truncate">{task.title}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Common Options */}
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="bulkTargetBranch">{t('taskReview:pr.labels.targetBranch')}</Label>
                <Input
                  id="bulkTargetBranch"
                  value={targetBranch}
                  onChange={(e) => setTargetBranch(e.target.value)}
                  placeholder="main"
                />
                <p className="text-xs text-muted-foreground">
                  {t('taskReview:bulkPR.targetBranchHint')}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-draft-pr-checkbox"
                  checked={isDraft}
                  onCheckedChange={(checked) => setIsDraft(checked === true)}
                />
                <label htmlFor="bulk-draft-pr-checkbox" className="text-sm cursor-pointer">
                  {t('taskReview:pr.labels.draftPR')}
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                {t('common:buttons.cancel')}
              </Button>
              <Button onClick={handleCreatePRs} disabled={tasks.length === 0 || step !== 'options'}>
                <GitPullRequest className="mr-2 h-4 w-4" />
                {t('taskReview:bulkPR.createAll', { count: tasks.length })}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Creating Step */}
        {step === 'creating' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center py-4 space-y-4">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">
                  {t('taskReview:bulkPR.creatingPR', { current: currentIndex + 1, total: tasks.length })}
                </p>
                <p className="text-xs text-muted-foreground truncate max-w-[400px]">
                  {tasks[currentIndex]?.title}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-center text-muted-foreground">
                {completedCount} / {tasks.length} {t('taskReview:bulkPR.completed')}
              </p>
            </div>

            {/* Task Status List */}
            <ScrollArea className="h-40 rounded-md border border-border">
              <div className="p-2 space-y-1">
                {taskResults.map((result, idx) => (
                  <TaskResultRow key={result.taskId} result={result} index={idx} />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Results Step */}
        {step === 'results' && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center justify-center gap-6 py-4">
              {successCount > 0 && (
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">{successCount} {t('taskReview:bulkPR.succeeded')}</span>
                </div>
              )}
              {skippedCount > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MinusCircle className="h-5 w-5" />
                  <span className="font-medium">{skippedCount} {t('taskReview:bulkPR.skipped')}</span>
                </div>
              )}
              {errorCount > 0 && (
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-5 w-5" />
                  <span className="font-medium">{errorCount} {t('taskReview:bulkPR.failed')}</span>
                </div>
              )}
            </div>

            {/* Results List */}
            <ScrollArea className="h-56 rounded-md border border-border">
              <div className="p-2 space-y-2">
                {taskResults.map((result, idx) => (
                  <TaskResultRow
                    key={result.taskId}
                    result={result}
                    index={idx}
                    showDetails
                    onOpenPR={handleOpenPR}
                  />
                ))}
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button onClick={handleClose}>
                {t('common:buttons.close')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Individual task result row component
 */
interface TaskResultRowProps {
  result: TaskPRResult;
  index: number;
  showDetails?: boolean;
  onOpenPR?: (url: string) => void;
}

function TaskResultRow({ result, index, showDetails, onOpenPR }: TaskResultRowProps) {
  const { t } = useTranslation(['taskReview']);

  const getStatusIcon = () => {
    switch (result.status) {
      case 'pending':
        return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
      case 'creating':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'success':
        // Show warning icon for already exists case
        return result.alreadyExists
          ? <AlertTriangle className="h-4 w-4 text-warning" />
          : <CheckCircle2 className="h-4 w-4 text-success" />;
      case 'skipped':
        return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  return (
    <div
      className={`flex items-start gap-2 p-2 rounded text-sm ${
        result.status === 'creating' ? 'bg-primary/5' : ''
      }`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {getStatusIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{index + 1}.</span>
          <span className="truncate font-medium">{result.taskTitle}</span>
        </div>

        {showDetails && result.status === 'success' && result.result?.prUrl && (
          <button
            type="button"
            onClick={() => {
              const prUrl = result.result?.prUrl;
              if (prUrl) onOpenPR?.(prUrl);
            }}
            className="text-xs text-primary hover:underline flex items-center gap-1 mt-1 bg-transparent border-none cursor-pointer p-0"
          >
            {result.alreadyExists
              ? t('taskReview:pr.success.alreadyExists')
              : t('taskReview:pr.success.created')}
            <ExternalLink className="h-3 w-3" />
          </button>
        )}

        {showDetails && result.status === 'skipped' && result.error && (
          <div className="flex items-start gap-1 mt-1">
            <MinusCircle className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
            <span className="text-xs text-muted-foreground">{result.error}</span>
          </div>
        )}

        {showDetails && result.status === 'error' && result.error && (
          <div className="flex items-start gap-1 mt-1">
            <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0 mt-0.5" />
            <span className="text-xs text-destructive">{result.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
