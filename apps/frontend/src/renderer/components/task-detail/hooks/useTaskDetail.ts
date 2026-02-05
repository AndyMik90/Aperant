import { useState, useRef, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import { useSettingsStore } from '../../../stores/settings-store';
import { checkTaskRunning, isIncompleteHumanReview, getTaskProgress, useTaskStore, loadTasks, hasRecentActivity } from '../../../stores/task-store';
import type { Task, TaskLogs, TaskLogPhase, WorktreeStatus, WorktreeDiff, MergeConflict, MergeStats, GitConflictInfo, ImageAttachment } from '../../../../shared/types';

/**
 * Validates task subtasks structure to prevent infinite loops during resume.
 * Returns true if task has valid subtasks, false otherwise.
 */
function validateTaskSubtasks(task: Task): boolean {
  // Check if subtasks array exists
  if (!task.subtasks || !Array.isArray(task.subtasks)) {
    console.warn('[validateTaskSubtasks] Task has no subtasks array:', task.id);
    return false;
  }

  // If subtasks array is empty and task is incomplete, it needs plan reload
  if (task.subtasks.length === 0) {
    console.warn('[validateTaskSubtasks] Task has empty subtasks array:', task.id);
    return false;
  }

  // Validate each subtask has minimum required fields
  for (let i = 0; i < task.subtasks.length; i++) {
    const subtask = task.subtasks[i];
    if (!subtask || typeof subtask !== 'object') {
      console.warn(`[validateTaskSubtasks] Invalid subtask at index ${i}:`, subtask);
      return false;
    }

    // Description is critical - we can't show a subtask without it
    if (!subtask.description || typeof subtask.description !== 'string' || subtask.description.trim() === '') {
      console.warn(`[validateTaskSubtasks] Subtask at index ${i} missing description:`, subtask);
      return false;
    }

    // ID is required for tracking
    if (!subtask.id || typeof subtask.id !== 'string') {
      console.warn(`[validateTaskSubtasks] Subtask at index ${i} missing id:`, subtask);
      return false;
    }
  }

  return true;
}

export interface UseTaskDetailOptions {
  task: Task;
}

export function useTaskDetail({ task }: UseTaskDetailOptions) {
  const [feedback, setFeedback] = useState('');
  const [feedbackImages, setFeedbackImages] = useState<ImageAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [isStuck, setIsStuck] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [hasCheckedRunning, setHasCheckedRunning] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [worktreeStatus, setWorktreeStatus] = useState<WorktreeStatus | null>(null);
  const [worktreeDiff, setWorktreeDiff] = useState<WorktreeDiff | null>(null);
  const [isLoadingWorktree, setIsLoadingWorktree] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [showDiffDialog, setShowDiffDialog] = useState(false);
  const [stageOnly, setStageOnly] = useState(false); // Default to full merge for proper cleanup (fixes #243)
  const [stagedSuccess, setStagedSuccess] = useState<string | null>(null);
  const [stagedProjectPath, setStagedProjectPath] = useState<string | undefined>(undefined);
  const [suggestedCommitMessage, setSuggestedCommitMessage] = useState<string | undefined>(undefined);
  const [phaseLogs, setPhaseLogs] = useState<TaskLogs | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Set<TaskLogPhase>>(new Set());
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Merge preview state
  const [mergePreview, setMergePreview] = useState<{
    files: string[];
    conflicts: MergeConflict[];
    summary: MergeStats;
    gitConflicts?: GitConflictInfo;
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [showPRDialog, setShowPRDialog] = useState(false);
  const [isCreatingPR, setIsCreatingPR] = useState(false);

  const selectedProject = useProjectStore((state) => state.getSelectedProject());
  const logOrder = useSettingsStore(s => s.settings.logOrder);
  const isRunning = task.status === 'in_progress';
  // isActiveTask includes ai_review for stuck detection (CHANGELOG documents this feature)
  const isActiveTask = task.status === 'in_progress' || task.status === 'ai_review';
  const needsReview = task.status === 'human_review';
  const executionPhase = task.executionProgress?.phase;
  const hasActiveExecution = executionPhase && executionPhase !== 'idle' && executionPhase !== 'complete' && executionPhase !== 'failed';
  const isIncomplete = isIncompleteHumanReview(task);
  const taskProgress = getTaskProgress(task);

  // Catastrophic stuck detection — last-resort safety net.
  // XState handles all normal process-exit transitions via PROCESS_EXITED events.
  // This only fires if XState somehow fails to transition after 60s with no activity.
  useEffect(() => {
    if (!isActiveTask) {
      setIsStuck(false);
      setHasCheckedRunning(false);
      return;
    }

    const intervalId = setInterval(() => {
      if (hasRecentActivity(task.id)) {
        setIsStuck(false);
        return;
      }

      checkTaskRunning(task.id).then((actuallyRunning) => {
        if (hasRecentActivity(task.id)) {
          setIsStuck(false);
        } else {
          setIsStuck(!actuallyRunning);
        }
        setHasCheckedRunning(true);
      });
    }, 60_000);

    return () => clearInterval(intervalId);
  }, [task.id, isActiveTask]);

  // Handle scroll events in logs to detect if user scrolled away from anchor
  const handleLogsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isReverseOrder = logOrder === 'reverse-chronological';

    // Check distance from top for reverse order, bottom for chronological
    const isAtAnchor = isReverseOrder
      ? target.scrollTop < 100
      : target.scrollHeight - target.scrollTop - target.clientHeight < 100;

    setIsUserScrolledUp(!isAtAnchor);
  };

  // Auto-scroll logs to anchor (top for reverse, bottom for chronological) only if user hasn't scrolled away
  useEffect(() => {
    const isReverseOrder = logOrder === 'reverse-chronological';

    if (activeTab === 'logs' && !isUserScrolledUp) {
      if (isReverseOrder && logsContainerRef.current) {
        logsContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (!isReverseOrder && logsEndRef.current) {
        logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [activeTab, isUserScrolledUp, logOrder, phaseLogs]);

  // Reset scroll state when switching to logs tab
  useEffect(() => {
    if (activeTab === 'logs') {
      setIsUserScrolledUp(false);
    }
  }, [activeTab]);

  // Reset feedback images when task changes to prevent image leakage between tasks
  useEffect(() => {
    setFeedbackImages([]);
  }, []);

  // Load worktree status when task is in human_review
  useEffect(() => {
    if (needsReview) {
      setIsLoadingWorktree(true);
      setWorkspaceError(null);

      Promise.all([
        window.electronAPI.getWorktreeStatus(task.id),
        window.electronAPI.getWorktreeDiff(task.id)
      ]).then(([statusResult, diffResult]) => {
        if (statusResult.success && statusResult.data) {
          setWorktreeStatus(statusResult.data);
        }
        if (diffResult.success && diffResult.data) {
          setWorktreeDiff(diffResult.data);
        }
      }).catch((err) => {
        console.error('Failed to load worktree info:', err);
      }).finally(() => {
        setIsLoadingWorktree(false);
      });
    } else {
      setWorktreeStatus(null);
      setWorktreeDiff(null);
    }
  }, [task.id, needsReview]);

  // Load and watch phase logs
  useEffect(() => {
    if (!selectedProject) return;

    const loadLogs = async () => {
      setIsLoadingLogs(true);
      try {
        const result = await window.electronAPI.getTaskLogs(selectedProject.id, task.specId);
        if (result.success && result.data) {
          setPhaseLogs(result.data);
          // Auto-expand active phase
          const activePhase = (['planning', 'coding', 'validation'] as TaskLogPhase[]).find(
            phase => result.data?.phases[phase]?.status === 'active'
          );
          if (activePhase) {
            setExpandedPhases(new Set([activePhase]));
          }
        }
      } catch (err) {
        console.error('Failed to load task logs:', err);
      } finally {
        setIsLoadingLogs(false);
      }
    };

    loadLogs();

    // Start watching for log changes
    window.electronAPI.watchTaskLogs(selectedProject.id, task.specId);

    // Listen for log changes
    const unsubscribe = window.electronAPI.onTaskLogsChanged((specId, logs) => {
      if (specId === task.specId) {
        setPhaseLogs(logs);
        // Auto-expand newly active phase
        const activePhase = (['planning', 'coding', 'validation'] as TaskLogPhase[]).find(
          phase => logs.phases[phase]?.status === 'active'
        );
        if (activePhase) {
          setExpandedPhases(prev => {
            const next = new Set(prev);
            next.add(activePhase);
            return next;
          });
        }
      }
    });

    return () => {
      unsubscribe();
      window.electronAPI.unwatchTaskLogs(task.specId);
    };
  }, [selectedProject, task.specId]);

  // Toggle phase expansion
  const togglePhase = useCallback((phase: TaskLogPhase) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  }, []);

  // Add a feedback image
  const addFeedbackImage = useCallback((image: ImageAttachment) => {
    setFeedbackImages(prev => [...prev, image]);
  }, []);

  // Add multiple feedback images at once
  const addFeedbackImages = useCallback((images: ImageAttachment[]) => {
    setFeedbackImages(prev => [...prev, ...images]);
  }, []);

  // Remove a feedback image by ID
  const removeFeedbackImage = useCallback((imageId: string) => {
    setFeedbackImages(prev => prev.filter(img => img.id !== imageId));
  }, []);

  // Clear all feedback images
  const clearFeedbackImages = useCallback(() => {
    setFeedbackImages([]);
  }, []);

  // Track if we've already loaded preview for this task to prevent infinite loops
  const hasLoadedPreviewRef = useRef<string | null>(null);

  // Clear merge preview state when switching to a different task
  useEffect(() => {
    if (hasLoadedPreviewRef.current !== task.id) {
      setMergePreview(null);
      hasLoadedPreviewRef.current = null;
    }
  }, [task.id]);

  // Load merge preview (conflict detection) and refresh worktree status
  const loadMergePreview = useCallback(async () => {
    setIsLoadingPreview(true);
    // Clear any previous workspace error before loading
    setWorkspaceError(null);

    try {
      // Fetch both merge preview and updated worktree status in parallel
      // This ensures the branch information (currentProjectBranch) is refreshed
      // when the user clicks the refresh button after switching branches locally
      // Use Promise.allSettled to handle partial failures - if one API call fails,
      // the other's result is still processed rather than being discarded
      const [previewResult, statusResult] = await Promise.allSettled([
        window.electronAPI.mergeWorktreePreview(task.id),
        window.electronAPI.getWorktreeStatus(task.id)
      ]);

      const errors: string[] = [];

      // Process merge preview result if fulfilled
      if (previewResult.status === 'fulfilled') {
        const result = previewResult.value;
        if (result.success && result.data?.preview) {
          setMergePreview(result.data.preview);
        } else if (!result.success && result.error) {
          errors.push(`Merge preview: ${result.error}`);
        }
      } else {
        console.error('[useTaskDetail] Failed to load merge preview:', previewResult.reason);
        errors.push('Failed to load merge preview');
      }

      // Update worktree status with fresh branch information if fulfilled
      if (statusResult.status === 'fulfilled') {
        const result = statusResult.value;
        if (result.success && result.data) {
          setWorktreeStatus(result.data);
        } else if (!result.success && result.error) {
          errors.push(`Worktree status: ${result.error}`);
        }
      } else {
        console.error('[useTaskDetail] Failed to load worktree status:', statusResult.reason);
        errors.push('Failed to load worktree status');
      }

      // Set workspace error if any API calls failed
      if (errors.length > 0) {
        setWorkspaceError(errors.join('; '));
      }
    } catch (err) {
      console.error('[useTaskDetail] Unexpected error in loadMergePreview:', err);
      setWorkspaceError('An unexpected error occurred while loading workspace information');
    } finally {
      hasLoadedPreviewRef.current = task.id;
      setIsLoadingPreview(false);
    }
  }, [task.id]);

  // Handle "Review Again" - clears staged state and reloads worktree info
  const handleReviewAgain = useCallback(async () => {
    // Clear staged success state if it was set in this session
    setStagedSuccess(null);
    setStagedProjectPath(undefined);
    setSuggestedCommitMessage(undefined);

    // Reset merge preview to force re-check
    setMergePreview(null);
    hasLoadedPreviewRef.current = null;

    // Reset workspace error state
    setWorkspaceError(null);

    // Reload worktree status
    setIsLoadingWorktree(true);
    try {
      const [statusResult, diffResult] = await Promise.all([
        window.electronAPI.getWorktreeStatus(task.id),
        window.electronAPI.getWorktreeDiff(task.id)
      ]);
      if (statusResult.success && statusResult.data) {
        setWorktreeStatus(statusResult.data);
      }
      if (diffResult.success && diffResult.data) {
        setWorktreeDiff(diffResult.data);
      }

      // Reload task data from store to reflect cleared staged state
      // (clearStagedState IPC already invalidated the cache)
      if (selectedProject) {
        await loadTasks(selectedProject.id);
      }
    } catch (err) {
      console.error('Failed to reload worktree info:', err);
    } finally {
      setIsLoadingWorktree(false);
    }
  }, [task.id, selectedProject]);

  // NOTE: Merge preview is NO LONGER auto-loaded on modal open.
  // User must click "Check for Conflicts" button to trigger the expensive preview operation.
  // This improves modal open performance significantly (avoids 1-30+ second Python subprocess).

  /**
   * Reloads implementation plan for an incomplete task to ensure subtasks are properly loaded.
   * This prevents the "Task Incomplete" infinite loop when resuming stuck tasks.
   */
  const reloadPlanForIncompleteTask = useCallback(async (): Promise<boolean> => {
    if (!selectedProject) {
      console.error('[reloadPlanForIncompleteTask] No selected project');
      return false;
    }

    // Only reload if task is incomplete and subtasks are invalid
    if (!isIncomplete) {
      return true; // Not incomplete, no reload needed
    }

    // Check if subtasks are valid
    if (validateTaskSubtasks(task)) {
      console.log('[reloadPlanForIncompleteTask] Subtasks are valid, no reload needed');
      return true; // Subtasks are valid, proceed
    }

    console.warn('[reloadPlanForIncompleteTask] Task has invalid subtasks, reloading plan:', {
      taskId: task.id,
      specId: task.specId,
      subtaskCount: task.subtasks?.length || 0
    });

    setIsLoadingPlan(true);
    try {
      // Reload tasks from the project to get fresh implementation plan
      const result = await window.electronAPI.getTasks(selectedProject.id);

      if (!result.success || !result.data) {
        console.error('[reloadPlanForIncompleteTask] Failed to reload tasks:', result.error);
        return false;
      }

      // Find the updated task in the result
      const updatedTask = result.data.find(t => t.id === task.id || t.specId === task.specId);
      if (!updatedTask) {
        console.error('[reloadPlanForIncompleteTask] Task not found in reloaded tasks');
        return false;
      }

      // Validate the reloaded subtasks
      if (!validateTaskSubtasks(updatedTask)) {
        console.error('[reloadPlanForIncompleteTask] Reloaded task still has invalid subtasks');
        return false;
      }

      console.log('[reloadPlanForIncompleteTask] Successfully reloaded plan with valid subtasks:', {
        taskId: task.id,
        subtaskCount: updatedTask.subtasks?.length ?? 0
      });

      // FIX (PR Review): Update the Zustand store with the reloaded task data
      // Without this, the UI continues to display stale/invalid subtasks
      const store = useTaskStore.getState();
      store.updateTask(task.id, {
        subtasks: updatedTask.subtasks,
        title: updatedTask.title,
        description: updatedTask.description,
        metadata: updatedTask.metadata,
        updatedAt: new Date()
      });

      return true;
    } catch (err) {
      console.error('[reloadPlanForIncompleteTask] Error reloading plan:', err);
      return false;
    } finally {
      setIsLoadingPlan(false);
    }
  }, [selectedProject, task, isIncomplete]);

  return {
    // State
    feedback,
    feedbackImages,
    isSubmitting,
    activeTab,
    isUserScrolledUp,
    isStuck,
    isRecovering,
    hasCheckedRunning,
    showDeleteDialog,
    isDeleting,
    deleteError,
    isEditDialogOpen,
    worktreeStatus,
    worktreeDiff,
    isLoadingWorktree,
    isMerging,
    isDiscarding,
    showDiscardDialog,
    workspaceError,
    showDiffDialog,
    stageOnly,
    stagedSuccess,
    stagedProjectPath,
    suggestedCommitMessage,
    phaseLogs,
    isLoadingLogs,
    expandedPhases,
    logsEndRef,
    logsContainerRef,
    selectedProject,
    isRunning,
    needsReview,
    executionPhase,
    hasActiveExecution,
    isIncomplete,
    taskProgress,
    mergePreview,
    isLoadingPreview,
    showConflictDialog,
    showPRDialog,
    isCreatingPR,
    isLoadingPlan,

    // Setters
    setFeedback,
    setFeedbackImages,
    setIsSubmitting,
    setActiveTab,
    setIsUserScrolledUp,
    setIsStuck,
    setIsRecovering,
    setHasCheckedRunning,
    setShowDeleteDialog,
    setIsDeleting,
    setDeleteError,
    setIsEditDialogOpen,
    setWorktreeStatus,
    setWorktreeDiff,
    setIsLoadingWorktree,
    setIsMerging,
    setIsDiscarding,
    setShowDiscardDialog,
    setWorkspaceError,
    setShowDiffDialog,
    setStageOnly,
    setStagedSuccess,
    setStagedProjectPath,
    setSuggestedCommitMessage,
    setPhaseLogs,
    setIsLoadingLogs,
    setExpandedPhases,
    setMergePreview,
    setIsLoadingPreview,
    setShowConflictDialog,
    setShowPRDialog,
    setIsCreatingPR,

    // Handlers
    handleLogsScroll,
    togglePhase,
    loadMergePreview,
    addFeedbackImage,
    addFeedbackImages,
    removeFeedbackImage,
    clearFeedbackImages,
    handleReviewAgain,
    reloadPlanForIncompleteTask,
  };
}
