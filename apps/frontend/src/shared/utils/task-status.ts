/**
 * Task status utility functions
 */

import type { TaskStatus, ReviewReason } from '../types';

/**
 * Checks if a task is in a completed state.
 * Completed tasks are those in 'done', 'pr_created' status,
 * or 'human_review' with reviewReason 'completed'.
 *
 * @param status - The task status to check
 * @param reviewReason - The review reason (only relevant for human_review status)
 * @returns true if the task is completed, false otherwise
 */
export function isCompletedTask(status: TaskStatus, reviewReason?: ReviewReason): boolean {
  if (status === 'done' || status === 'pr_created') {
    return true;
  }
  // Tasks in human_review with reviewReason 'completed' are also considered completed
  // (all subtasks done and QA passed, ready for final approval/merge)
  if (status === 'human_review' && reviewReason === 'completed') {
    return true;
  }
  return false;
}
