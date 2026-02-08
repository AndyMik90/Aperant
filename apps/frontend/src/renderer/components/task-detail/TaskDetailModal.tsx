import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useToast } from '../../hooks/use-toast';
import { Separator } from '../ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import { TooltipProvider } from '../ui/tooltip';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
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
import {
  Play,
  Square,
  CheckCircle2,
  RotateCcw,
  Trash2,
  Loader2,
  AlertTriangle,
  Pencil,
  X,
  GitPullRequest,
  Link2,
  FileText,
  Code,
  Clock,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { calculateProgress } from '../../lib/utils';
import { startTask, stopTask, startBuild, submitReview, recoverStuckTask, deleteTask, persistTaskStatus, useTaskStore, isTaskBlocked } from '../../stores/task-store';
import { TASK_STATUS_LABELS } from '../../../shared/constants';
import { TaskEditDialog } from '../TaskEditDialog';
import { useTaskDetail } from './hooks/useTaskDetail';
import { blurAndClose } from '../../hooks/useSafeDialogClose';
import { TaskMetadata } from './TaskMetadata';
import { TaskWarnings } from './TaskWarnings';
import { TaskSubtasks } from './TaskSubtasks';
import { TaskFiles } from './TaskFiles';
import { TaskReview } from './TaskReview';
import { ActivityTimeline } from './ActivityTimeline';
import { DependencyEditor } from './DependencyEditor';
import { DriftTab } from '../drift/DriftTab';
import { DriftIndicator } from '../drift/DriftIndicator';
import { SpecDocView } from '../terminal/SpecDocView';
import type { Task, WorktreeCreatePROptions } from '../../../shared/types';

interface TaskDetailModalProps {
  open: boolean;
  task: Task | null;
  onOpenChange: (open: boolean) => void;
  onSwitchToTerminals?: () => void;
  onOpenInbuiltTerminal?: (id: string, cwd: string) => void;
}

export function TaskDetailModal({ open, task, onOpenChange, onSwitchToTerminals, onOpenInbuiltTerminal }: TaskDetailModalProps) {
  // Don't render anything if no task
  if (!task) {
    return null;
  }

  return (
    <TaskDetailModalContent
      open={open}
      task={task}
      onOpenChange={onOpenChange}
      onSwitchToTerminals={onSwitchToTerminals}
      onOpenInbuiltTerminal={onOpenInbuiltTerminal}
    />
  );
}

// Feature flag for Files tab (enabled by default, can be disabled via localStorage)
const isFilesTabEnabled = () => {
  const flag = localStorage.getItem('use_files_tab');
  return flag === null || flag === 'true'; // Enabled by default
};

// Separate component to use hooks only when task exists
function TaskDetailModalContent({ open, task, onOpenChange, onSwitchToTerminals, onOpenInbuiltTerminal }: { open: boolean; task: Task; onOpenChange: (open: boolean) => void; onSwitchToTerminals?: () => void; onOpenInbuiltTerminal?: (id: string, cwd: string) => void }) {
  const { t } = useTranslation(['tasks']);
  const { toast } = useToast();
  const state = useTaskDetail({ task });
  const showFilesTab = isFilesTabEnabled();
  const progressPercent = calculateProgress(task.subtasks);
  const completedSubtasks = task.subtasks.filter(s => s.status === 'completed').length;
  const totalSubtasks = task.subtasks.length;

  // Get all tasks for dependency checking
  const allTasks = useTaskStore((state) => state.tasks);
  // Track if agent is explicitly stopped (for Resume button UI)
  const isAgentStopped = useTaskStore((state) => state.isAgentStopped(task.id));
  // Check if this is a planning phase task
  const isPlanning = task.status === 'planning';
  // Check if task is blocked by dependencies
  const isBlocked = isTaskBlocked(task, allTasks);

  // Event Handlers
  const handleStartStop = async () => {
    if (state.isRunning && !state.isStuck) {
      stopTask(task.id);
    } else {
      // If task is incomplete, validate and reload plan before starting
      if (state.isIncomplete) {
        const isValid = await state.reloadPlanForIncompleteTask();
        if (!isValid) {
          toast({
            title: 'Cannot Resume Task',
            description: 'Failed to load implementation plan. Please try again or check the task files.',
            variant: 'destructive',
            duration: 5000,
          });
          return;
        }
      }
      startTask(task.id);
    }
  };

  const handleRecover = async () => {
    state.setIsRecovering(true);
    const result = await recoverStuckTask(task.id, { autoRestart: true });
    if (result.success) {
      state.setIsStuck(false);
      state.setHasCheckedRunning(false);
    }
    state.setIsRecovering(false);
  };

  const [isRestarting, setIsRestarting] = useState(false);
  const handleRestartFromPlanning = async () => {
    setIsRestarting(true);
    const result = await recoverStuckTask(task.id, { autoRestart: true });
    if (result.success) {
      state.setIsStuck(false);
      state.setHasCheckedRunning(false);
    }
    setIsRestarting(false);
  };

  const handleReject = async () => {
    // Allow submission if there's text feedback OR images attached
    if (!state.feedback.trim() && state.feedbackImages.length === 0) {
      return;
    }
    state.setIsSubmitting(true);
    await submitReview(task.id, false, state.feedback, state.feedbackImages);
    state.setIsSubmitting(false);
    state.setFeedback('');
    state.setFeedbackImages([]);
  };

  const handleDelete = async () => {
    state.setIsDeleting(true);
    state.setDeleteError(null);
    const result = await deleteTask(task.id);
    if (result.success) {
      // Use safe close to prevent aria-hidden focus errors
      blurAndClose(() => {
        state.setShowDeleteDialog(false);
        onOpenChange(false);
      });
    } else {
      state.setDeleteError(result.error || 'Failed to delete task');
    }
    state.setIsDeleting(false);
  };

  const handleMerge = async () => {
    state.setIsMerging(true);
    state.setWorkspaceError(null);
    try {
      const result = await window.electronAPI.mergeWorktree(task.id, { noCommit: state.stageOnly });
      if (result.success && result.data?.success) {
        if (state.stageOnly && result.data.staged) {
          state.setWorkspaceError(null);
          state.setStagedSuccess(result.data.message || 'Changes staged in main project');
          state.setStagedProjectPath(result.data.projectPath);
          state.setSuggestedCommitMessage(result.data.suggestedCommitMessage);
        } else if (result.data.merged) {
          // Full merge completed - show success with "Mark as Done" button
          state.setWorkspaceError(null);
          state.setMergedSuccess(result.data.message || 'Changes merged successfully');
        } else {
          onOpenChange(false);
        }
      } else {
        state.setWorkspaceError(result.data?.message || result.error || 'Failed to merge changes');
      }
    } catch (error) {
      state.setWorkspaceError(error instanceof Error ? error.message : 'Unknown error during merge');
    } finally {
      state.setIsMerging(false);
    }
  };

  const handleDiscard = async () => {
    state.setIsDiscarding(true);
    state.setWorkspaceError(null);
    const result = await window.electronAPI.discardWorktree(task.id);
    if (result.success && result.data?.success) {
      state.setShowDiscardDialog(false);
      onOpenChange(false);
    } else {
      state.setWorkspaceError(result.data?.message || result.error || 'Failed to discard changes');
    }
    state.setIsDiscarding(false);
  };

  const handleCreatePR = async (options: WorktreeCreatePROptions) => {
    state.setIsCreatingPR(true);
    try {
      const result = await window.electronAPI.createWorktreePR(task.id, options);
      if (result.success && result.data) {
        // Update single task in store with new status and prUrl (more efficient than reloading all tasks)
        if (result.data.success && result.data.prUrl && !result.data.alreadyExists) {
          useTaskStore.getState().updateTask(task.id, {
            status: 'pr_created',
            metadata: { ...task.metadata, prUrl: result.data.prUrl }
          });
        }
        return result.data;
      }
      // Propagate IPC error; let CreatePRDialog use its i18n fallback
      return { success: false, error: result.error, prUrl: undefined, alreadyExists: false };
    } catch (error) {
      // Propagate actual error message; let CreatePRDialog handle i18n fallback for undefined
      return { success: false, error: error instanceof Error ? error.message : undefined, prUrl: undefined, alreadyExists: false };
    } finally {
      state.setIsCreatingPR(false);
    }
  };

  const handleMarkDone = async () => {
    const result = await persistTaskStatus(task.id, 'done');
    if (result.success) {
      onOpenChange(false);
    } else {
      state.setWorkspaceError(result.error || 'Failed to mark task as done');
    }
  };

  const handleClose = () => {
    // Show toast notification if task is running
    if (state.isRunning && !state.isStuck) {
      toast({
        title: t('tasks:notifications.backgroundTaskTitle'),
        description: t('tasks:notifications.backgroundTaskDescription'),
        duration: 4000,
      });
    }
    // Use safe close to prevent aria-hidden focus errors
    blurAndClose(() => onOpenChange(false));
  };

  // Helper function to get status badge variant
  const getStatusBadgeVariant = (status: string, isStuck: boolean) => {
    if (isStuck) return 'warning';
    switch (status) {
      case 'done':
      case 'pr_created':
        return 'success';
      case 'human_review':
        return 'purple';
      case 'coding':
        return 'info';
      default:
        return 'secondary';
    }
  };

  // Handle start build transition (from planning to coding)
  const handleStartBuild = async () => {
    if (!isBlocked) {
      await startBuild(task.id);
    }
  };

  // Render primary action button based on state - matching TaskCard.tsx gated workflow
  const renderPrimaryAction = () => {
    if (state.isStuck) {
      return (
        <Button
          variant="warning"
          onClick={handleRecover}
          disabled={state.isRecovering}
        >
          {state.isRecovering ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('tasks:actions.recovering', { defaultValue: 'Recovering...' })}
            </>
          ) : (
            <>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t('tasks:actions.recover', { defaultValue: 'Recover Task' })}
            </>
          )}
        </Button>
      );
    }

    if (state.isIncomplete) {
      return (
        <Button variant="default" onClick={handleStartStop} disabled={state.isLoadingPlan}>
          {state.isLoadingPlan ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('tasks:actions.loadingPlan', { defaultValue: 'Loading Plan...' })}
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              {t('tasks:actions.resume', { defaultValue: 'Resume Task' })}
            </>
          )}
        </Button>
      );
    }

    // Planning phase - gated workflow matching TaskCard.tsx:880-940
    if (isPlanning) {
      if (isAgentStopped) {
        // Agent was stopped - show Resume + Start Build (spec may be ready)
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleStartStop}
              title={t('tasks:tooltips.resumePlanningAgent', { defaultValue: 'Resume planning agent' })}
            >
              <Play className="mr-2 h-4 w-4" />
              {t('tasks:actions.resume', { defaultValue: 'Resume' })}
            </Button>
            <Button
              variant="default"
              onClick={handleStartBuild}
              disabled={isBlocked}
              title={isBlocked
                ? t('tasks:dependencies.blockedTooltip', { defaultValue: 'Cannot start: waiting for dependencies to complete' })
                : t('tasks:tooltips.startBuild', { defaultValue: 'Start build' })
              }
            >
              {isBlocked ? (
                <>
                  <Link2 className="mr-2 h-4 w-4" />
                  {t('tasks:dependencies.blocked', { defaultValue: 'Blocked' })}
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  {t('tasks:actions.startBuild', { defaultValue: 'Start Build' })}
                </>
              )}
            </Button>
          </div>
        );
      } else {
        // Agent is running - show Stop button only (no Start Build during active planning)
        return (
          <Button
            variant="destructive"
            onClick={handleStartStop}
            title={t('tasks:tooltips.stopPlanningAgent', { defaultValue: 'Stop planning agent' })}
          >
            <Square className="mr-2 h-4 w-4" />
            {t('tasks:actions.stop', { defaultValue: 'Stop' })}
          </Button>
        );
      }
    }

    // Coding phase
    if (task.status === 'coding') {
      return (
        <Button
          variant={state.isRunning ? 'destructive' : 'default'}
          onClick={handleStartStop}
        >
          {state.isRunning ? (
            <>
              <Square className="mr-2 h-4 w-4" />
              {t('tasks:actions.stop', { defaultValue: 'Stop Task' })}
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              {isAgentStopped ? t('tasks:actions.resume', { defaultValue: 'Resume' }) : t('tasks:actions.run', { defaultValue: 'Run' })}
            </>
          )}
        </Button>
      );
    }

    if (task.status === 'done') {
      return (
        <div className="completion-state text-sm flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">{t('tasks:status.complete')}</span>
        </div>
      );
    }

    if (task.status === 'pr_created') {
      return (
        <div className="flex items-center gap-4">
          <div className="completion-state text-sm flex items-center gap-2 text-success">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">{t('tasks:status.complete')}</span>
          </div>
           {task.metadata?.prUrl && (
             <button
               type="button"
               onClick={() => window.electronAPI?.openExternal(task.metadata!.prUrl!)}
               className="completion-state text-sm flex items-center gap-2 text-info cursor-pointer hover:underline bg-transparent border-none p-0"
             >
              <GitPullRequest className="h-5 w-5" />
              <span className="font-medium">{t(TASK_STATUS_LABELS[task.status])}</span>
            </button>
          )}
        </div>
      );
    }

    return null;
  };


  return (
    <TooltipProvider delayDuration={300}>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          {/* Semi-transparent overlay - can see background content */}
          <DialogPrimitive.Overlay
            className={cn(
              'fixed inset-0 z-50 bg-black/60',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
            )}
          />

          {/* Full-height centered modal content */}
          <DialogPrimitive.Content
            className={cn(
              'fixed left-[50%] top-4 z-50',
              'translate-x-[-50%]',
              'w-[95vw] max-w-5xl h-[calc(100vh-32px)]',
              'bg-card border border-border rounded-xl',
              'shadow-2xl overflow-hidden flex flex-col',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'duration-200'
            )}
          >
            {/* Header */}
            <div className="p-5 pb-4 border-b border-border shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <DialogPrimitive.Title className="text-xl font-semibold leading-tight text-foreground truncate">
                    {task.title}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description asChild>
                    <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs font-mono">
                        {task.specId}
                      </Badge>
                      {state.isStuck ? (
                        <Badge variant="warning" className="text-xs flex items-center gap-1 animate-pulse">
                          <AlertTriangle className="h-3 w-3" />
                          Stuck
                        </Badge>
                      ) : state.isIncomplete ? (
                        <>
                          <Badge variant="warning" className="text-xs flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Incomplete
                          </Badge>
                        </>
                      ) : (
                        <>
                           <Badge
                             variant={getStatusBadgeVariant(task.status, state.isStuck)}
                             className={cn('text-xs', (task.status === 'coding' && !state.isStuck) && 'status-running')}
                           >
                             {t(TASK_STATUS_LABELS[task.status])}
                           </Badge>
                          {task.status === 'human_review' && task.reviewReason && (
                            <Badge
                              variant={task.reviewReason === 'completed' ? 'success' : task.reviewReason === 'errors' ? 'destructive' : 'warning'}
                              className="text-xs"
                            >
                              {task.reviewReason === 'completed' ? 'Completed' :
                               task.reviewReason === 'errors' ? 'Has Errors' :
                               task.reviewReason === 'plan_review' ? 'Approve Plan' : 'QA Issues'}
                            </Badge>
                          )}
                        </>
                      )}
                      {/* Compact progress indicator */}
                      {totalSubtasks > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">
                          {completedSubtasks}/{totalSubtasks} subtasks
                        </span>
                      )}
                      {/* Drift indicator */}
                      <DriftIndicator taskId={task.id} showLabel size="sm" />
                    </div>
                  </DialogPrimitive.Description>
                </div>
                <div className="flex items-center gap-1 shrink-0 electron-no-drag">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-primary/10 hover:text-primary transition-colors"
                    onClick={() => state.setIsEditDialogOpen(true)}
                    disabled={state.isRunning && !state.isStuck}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <DialogPrimitive.Close asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:bg-muted transition-colors"
                    >
                      <X className="h-5 w-5" />
                      <span className="sr-only">Close</span>
                    </Button>
                  </DialogPrimitive.Close>
                </div>
              </div>

              {/* Progress bar - only show when running or has progress */}
              {(state.isRunning || completedSubtasks > 0) && totalSubtasks > 0 && (
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={progressPercent} className="h-1.5 flex-1" />
                  <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{progressPercent}%</span>
                </div>
              )}

              {/* Warnings - compact inline */}
              {(state.isStuck || state.isIncomplete) && (
                <div className="mt-3">
                  <TaskWarnings
                    isStuck={state.isStuck}
                    isIncomplete={state.isIncomplete}
                    isRecovering={state.isRecovering}
                    taskProgress={state.taskProgress}
                    onRecover={handleRecover}
                    onResume={handleStartStop}
                  />
                </div>
              )}
            </div>

            {/* Body - Single Column with Tabs */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <Tabs value={state.activeTab} onValueChange={state.setActiveTab} className="flex flex-col h-full">
                <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-5 h-auto shrink-0">
                  <TabsTrigger
                    value="overview"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm"
                  >
                    Overview
                  </TabsTrigger>
                  <TabsTrigger
                    value="subtasks"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm"
                  >
                    Subtasks ({task.subtasks.length})
                  </TabsTrigger>
                  {showFilesTab && (
                    <TabsTrigger
                      value="files"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm"
                    >
                      {t('tasks:files.tab')}
                    </TabsTrigger>
                  )}
                  <TabsTrigger
                    value="drift"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm flex items-center gap-1.5"
                  >
                    Drift
                    <DriftIndicator taskId={task.id} size="sm" />
                  </TabsTrigger>
                  <TabsTrigger
                    value="spec"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm flex items-center gap-1.5"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Spec
                  </TabsTrigger>
                  <TabsTrigger
                    value="prompt"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm flex items-center gap-1.5"
                  >
                    <Code className="h-3.5 w-3.5" />
                    Prompt
                  </TabsTrigger>
                  <TabsTrigger
                    value="activity"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm flex items-center gap-1.5"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Activity
                  </TabsTrigger>
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview" className="flex-1 min-h-0 overflow-hidden mt-0">
                  <ScrollArea className="h-full">
                    <div className="p-5 space-y-5 overflow-x-hidden max-w-full">
                      {/* Metadata */}
                      <TaskMetadata task={task} />

                      {/* Dependencies */}
                      <Separator />
                      <DependencyEditor task={task} />

                      {/* Human Review Section */}
                      {state.needsReview && (
                        <>
                          <Separator />
                          <TaskReview
                            task={task}
                            feedback={state.feedback}
                            isSubmitting={state.isSubmitting}
                            worktreeStatus={state.worktreeStatus}
                            worktreeDiff={state.worktreeDiff}
                            isLoadingWorktree={state.isLoadingWorktree}
                            isMerging={state.isMerging}
                            isDiscarding={state.isDiscarding}
                            showDiscardDialog={state.showDiscardDialog}
                            showDiffDialog={state.showDiffDialog}
                            workspaceError={state.workspaceError}
                            stageOnly={state.stageOnly}
                            stagedSuccess={state.stagedSuccess}
                            stagedProjectPath={state.stagedProjectPath}
                            suggestedCommitMessage={state.suggestedCommitMessage}
                            mergedSuccess={state.mergedSuccess}
                            mergePreview={state.mergePreview}
                            isLoadingPreview={state.isLoadingPreview}
                            showConflictDialog={state.showConflictDialog}
                            onFeedbackChange={state.setFeedback}
                            onReject={handleReject}
                            onRestartFromPlanning={handleRestartFromPlanning}
                            isRestarting={isRestarting}
                            images={state.feedbackImages}
                            onImagesChange={state.setFeedbackImages}
                            onMerge={handleMerge}
                            onMarkDone={handleMarkDone}
                            onDiscard={handleDiscard}
                            onShowDiscardDialog={state.setShowDiscardDialog}
                            onShowDiffDialog={state.setShowDiffDialog}
                            onStageOnlyChange={state.setStageOnly}
                            onShowConflictDialog={state.setShowConflictDialog}
                            onLoadMergePreview={state.loadMergePreview}
                            onClose={handleClose}
                            onSwitchToTerminals={onSwitchToTerminals}
                            onOpenInbuiltTerminal={onOpenInbuiltTerminal}
                            onReviewAgain={state.handleReviewAgain}
                            showPRDialog={state.showPRDialog}
                            isCreatingPR={state.isCreatingPR}
                            onShowPRDialog={state.setShowPRDialog}
                            onCreatePR={handleCreatePR}
                          />
                        </>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Subtasks Tab */}
                <TabsContent value="subtasks" className="flex-1 min-h-0 overflow-hidden mt-0">
                  <TaskSubtasks task={task} />
                </TabsContent>

                {/* Files Tab */}
                {showFilesTab && (
                  <TabsContent value="files" className="flex-1 min-h-0 overflow-hidden mt-0">
                    <TaskFiles task={task} />
                  </TabsContent>
                )}

                {/* Drift Tab */}
                <TabsContent value="drift" className="flex-1 min-h-0 overflow-hidden mt-0">
                  <DriftTab taskId={task.id} specDir={task.specsPath || ''} />
                </TabsContent>

                {/* Spec Tab */}
                <TabsContent value="spec" className="flex-1 min-h-0 overflow-hidden mt-0">
                  <SpecDocView taskId={task.id} fileName="spec.md" title="Spec" />
                </TabsContent>

                {/* Prompt Tab (Ralph Loop) */}
                <TabsContent value="prompt" className="flex-1 min-h-0 overflow-hidden mt-0">
                  <SpecDocView taskId={task.id} fileName="ralph_prompt.md" title="Prompt" />
                </TabsContent>

                {/* Activity Tab */}
                <TabsContent value="activity" className="flex-1 min-h-0 overflow-hidden mt-0">
                  <ScrollArea className="h-full">
                    <div className="p-5">
                      <ActivityTimeline taskId={task.id} />
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>

            {/* Footer - Actions */}
            <div className="flex items-center gap-3 px-5 py-3 border-t border-border shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => state.setShowDeleteDialog(true)}
                disabled={state.isRunning && !state.isStuck}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Task
              </Button>
              <div className="flex-1" />
              {renderPrimaryAction()}
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Edit Task Dialog */}
      <TaskEditDialog
        task={task}
        open={state.isEditDialogOpen}
        onOpenChange={state.setIsEditDialogOpen}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={state.showDeleteDialog} onOpenChange={state.setShowDeleteDialog}>
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
                {state.deleteError && (
                  <p className="text-destructive bg-destructive/10 px-3 py-2 rounded-lg text-sm">
                    {state.deleteError}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={state.isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={state.isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {state.isDeleting ? (
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
    </TooltipProvider>
  );
}
