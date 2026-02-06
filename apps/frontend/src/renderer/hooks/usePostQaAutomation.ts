/**
 * Hook for handling post-QA automation
 * Automatically triggers actions (create PR, merge) after successful QA review
 */

import { useEffect, useRef } from 'react';
import { useTaskStore } from '../stores/task-store';
import { useProjectStore } from '../stores/project-store';
import type { IPCResult, PostQaAction, Task } from '../../shared/types';

const STATE_SETTLE_DELAY_MS = 1000; // Allow UI state to settle after status change

interface PostQaAutomationOptions {
  /** Callback when automation is triggered */
  onAutomationTriggered?: (taskId: string, action: PostQaAction) => void;
  /** Callback when automation fails */
  onAutomationFailed?: (taskId: string, error: string) => void;
  /** Callback for automation progress updates */
  onAutomationProgress?: (taskId: string, status: 'starting' | 'success' | 'failed', message: string) => void;
}

/**
 * Hook that listens for task status changes and triggers post-QA automation
 *
 * When a task transitions to 'human_review' with reviewReason='completed'
 * and has postQaAction set in metadata, it automatically:
 * - Creates a PR (for 'auto_create_pr')
 * - Merges the worktree (for 'auto_merge')
 * - Archives the task after successful action
 */
export function usePostQaAutomation(options: PostQaAutomationOptions = {}) {
  const { onAutomationTriggered, onAutomationFailed, onAutomationProgress } = options;
  const tasks = useTaskStore((state) => state.tasks);
  const projects = useProjectStore((state) => state.projects);

  // Track processed task IDs to avoid duplicate automation
  const processedTasks = useRef<Set<string>>(new Set());
  // Track timeout IDs for cleanup on unmount
  const timeoutIds = useRef<Set<NodeJS.Timeout>>(new Set());

  useEffect(() => {
    // Cleanup: remove processed tasks that are archived or completed
    for (const task of tasks) {
      if (processedTasks.current.has(task.id)) {
        if (task.status === 'done' || task.status === 'pr_created') {
          processedTasks.current.delete(task.id);
        }
      }
    }

    for (const task of tasks) {
      // Skip if already processed
      if (processedTasks.current.has(task.id)) {
        continue;
      }

      // Check if task is in human_review with completed review reason
      if (
        task.status === 'human_review' &&
        task.reviewReason === 'completed' &&
        task.metadata?.postQaAction &&
        task.metadata.postQaAction !== 'do_nothing'
      ) {
        const postQaAction = task.metadata.postQaAction;
        console.log(`[PostQaAutomation] Task ${task.id} completed QA, triggering action: ${postQaAction}`);

        // Mark as processed to avoid duplicate automation
        processedTasks.current.add(task.id);

        // Find the project for this task
        const project = projects.find(p => p.id === task.projectId);
        if (!project) {
          console.error(`[PostQaAutomation] Project not found for task ${task.id}`);
          onAutomationFailed?.(task.id, 'Project not found');
          continue;
        }

        // Trigger automation after a short delay to ensure state is settled
        const timeoutId = setTimeout(async () => {
          // Re-validate task state before executing to prevent race conditions
          const currentTask = tasks.find(t => t.id === task.id);
          if (!currentTask ||
              currentTask.status !== 'human_review' ||
              currentTask.reviewReason !== 'completed' ||
              currentTask.metadata?.postQaAction !== postQaAction) {
            console.log(`[PostQaAutomation] Task ${task.id} state changed, skipping automation`);
            processedTasks.current.delete(task.id);
            return;
          }

          try {
            if (postQaAction === 'auto_create_pr') {
              await handleAutoCreatePR(task, project, onAutomationProgress);
              onAutomationTriggered?.(task.id, 'auto_create_pr');
            } else if (postQaAction === 'auto_merge') {
              await handleAutoMerge(task, project, onAutomationProgress);
              onAutomationTriggered?.(task.id, 'auto_merge');
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[PostQaAutomation] Failed to execute ${postQaAction} for task ${task.id}:`, error);
            onAutomationProgress?.(task.id, 'failed', errorMessage);
            onAutomationFailed?.(task.id, errorMessage);

            // Remove from processed set so it can be retried
            processedTasks.current.delete(task.id);
          }
        }, STATE_SETTLE_DELAY_MS);

        // Store timeout ID for cleanup
        timeoutIds.current.add(timeoutId);
      }
    }

    // Cleanup function: clear all pending timeouts on unmount
    return () => {
      timeoutIds.current.forEach(id => clearTimeout(id));
      timeoutIds.current.clear();
    };
  }, [tasks, projects, onAutomationTriggered, onAutomationFailed, onAutomationProgress]);
}

/**
 * Execute an automation action with common error handling and progress reporting
 */
async function executeAutomationAction(
  action: 'auto_create_pr' | 'auto_merge',
  task: Task,
  project: { id: string },
  executeApi: () => Promise<IPCResult>,
  onAutomationProgress?: (taskId: string, status: 'starting' | 'success' | 'failed', message: string) => void
): Promise<void> {
  console.log(`[PostQaAutomation] Executing ${action} for task ${task.id}`);

  onAutomationProgress?.(task.id, 'starting', `Starting ${action.replace(/_/g, ' ')}...`);

  if (!window.electronAPI) {
    const error = 'ElectronAPI not available';
    onAutomationProgress?.(task.id, 'failed', error);
    throw new Error(error);
  }

  const result = await executeApi();

  if (!result.success) {
    const error = result.error || (result.data as { message?: string } | undefined)?.message || `${action} failed`;
    onAutomationProgress?.(task.id, 'failed', error);
    throw new Error(error);
  }

  console.log(`[PostQaAutomation] ${action} completed successfully for task ${task.id}`);
  onAutomationProgress?.(task.id, 'success', `${action.replace(/_/g, ' ')} completed successfully`);

  await archiveTask(task.id, project.id);
}

/**
 * Handle auto-create PR action
 */
async function handleAutoCreatePR(
  task: Task,
  project: { id: string },
  onAutomationProgress?: (taskId: string, status: 'starting' | 'success' | 'failed', message: string) => void
): Promise<void> {
  return executeAutomationAction(
    'auto_create_pr',
    task,
    project,
    async () => window.electronAPI?.createWorktreePR?.(task.id, {
      title: task.title,
      draft: false
    }) ?? { success: false, error: 'createWorktreePR API not available' },
    onAutomationProgress
  );
}

/**
 * Handle auto-merge action
 */
async function handleAutoMerge(
  task: Task,
  project: { id: string },
  onAutomationProgress?: (taskId: string, status: 'starting' | 'success' | 'failed', message: string) => void
): Promise<void> {
  return executeAutomationAction(
    'auto_merge',
    task,
    project,
    async () => window.electronAPI?.mergeWorktree?.(task.id) ?? { success: false, error: 'mergeWorktree API not available' },
    onAutomationProgress
  );
}

/**
 * Archive task after successful automation
 */
async function archiveTask(taskId: string, projectId: string): Promise<void> {
  console.log(`[PostQaAutomation] Archiving task ${taskId}`);

  if (!window.electronAPI?.archiveTasks) {
    throw new Error('archiveTasks API not available');
  }

  const result = await window.electronAPI.archiveTasks(projectId, [taskId]);

  if (!result.success) {
    console.error(`[PostQaAutomation] Failed to archive task ${taskId}:`, result.error);
  } else {
    console.log(`[PostQaAutomation] Task ${taskId} archived successfully`);
  }
}
