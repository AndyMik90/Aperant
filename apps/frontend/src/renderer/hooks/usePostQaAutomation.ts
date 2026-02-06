/**
 * Hook for handling post-QA automation
 * Automatically triggers actions (create PR, merge) after successful QA review
 */

import { useEffect, useRef } from 'react';
import { useTaskStore } from '../stores/task-store';
import { useProjectStore } from '../stores/project-store';
import type { Task } from '../../shared/types';

interface PostQaAutomationOptions {
  /** Callback when automation is triggered */
  onAutomationTriggered?: (taskId: string, action: 'auto_create_pr' | 'auto_merge') => void;
  /** Callback when automation fails */
  onAutomationFailed?: (taskId: string, error: string) => void;
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
  const { onAutomationTriggered, onAutomationFailed } = options;
  const tasks = useTaskStore((state) => state.tasks);
  const projects = useProjectStore((state) => state.projects);

  // Track processed task IDs to avoid duplicate automation
  const processedTasks = useRef<Set<string>>(new Set());

  useEffect(() => {
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
        setTimeout(async () => {
          try {
            if (postQaAction === 'auto_create_pr') {
              await handleAutoCreatePR(task, project);
              onAutomationTriggered?.(task.id, 'auto_create_pr');
            } else if (postQaAction === 'auto_merge') {
              await handleAutoMerge(task, project);
              onAutomationTriggered?.(task.id, 'auto_merge');
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[PostQaAutomation] Failed to execute ${postQaAction} for task ${task.id}:`, error);
            onAutomationFailed?.(task.id, errorMessage);

            // Remove from processed set so it can be retried
            processedTasks.current.delete(task.id);
          }
        }, 1000);
      }
    }
  }, [tasks, projects, onAutomationTriggered, onAutomationFailed]);
}

/**
 * Handle auto-create PR action
 */
async function handleAutoCreatePR(task: Task, project: { id: string }): Promise<void> {
  console.log(`[PostQaAutomation] Creating PR for task ${task.id}`);

  if (!window.electronAPI?.createWorktreePR) {
    throw new Error('createWorktreePR API not available');
  }

  const result = await window.electronAPI.createWorktreePR(task.id, {
    title: task.title,
    draft: false
  });

  if (!result.success) {
    throw new Error(result.error || 'Failed to create PR');
  }

  console.log(`[PostQaAutomation] PR created successfully: ${result.data?.prUrl}`);

  // Archive the task after successful PR creation
  await archiveTask(task.id, project.id);
}

/**
 * Handle auto-merge action
 */
async function handleAutoMerge(task: Task, project: { id: string }): Promise<void> {
  console.log(`[PostQaAutomation] Merging task ${task.id}`);

  if (!window.electronAPI?.mergeWorktree) {
    throw new Error('mergeWorktree API not available');
  }

  const result = await window.electronAPI.mergeWorktree(task.id);

  if (!result.success) {
    throw new Error(result.data?.message || 'Failed to merge');
  }

  console.log(`[PostQaAutomation] Task ${task.id} merged successfully`);

  // Archive the task after successful merge
  await archiveTask(task.id, project.id);
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
