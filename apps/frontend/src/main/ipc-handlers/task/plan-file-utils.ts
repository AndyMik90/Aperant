/**
 * Plan File Utilities
 *
 * Provides thread-safe operations for reading and writing implementation_plan.json files.
 * Uses an in-memory lock to serialize updates and prevent race conditions when multiple
 * IPC handlers try to update the same plan file concurrently.
 *
 * IMPORTANT LIMITATION:
 * The synchronous function `persistPlanStatusSync` does NOT participate in the locking
 * mechanism. It bypasses the async lock entirely, which means:
 * - It can race with concurrent async operations (persistPlanStatus, updatePlanFile, etc.)
 * - It should ONLY be used when you are certain no async operations are pending on the same file
 * - Prefer using the async `persistPlanStatus` whenever possible
 *
 * If you need synchronous behavior, ensure that:
 * 1. No async plan operations are in flight for the same file path
 * 2. The calling context truly cannot use async/await (e.g., synchronous event handlers)
 */

import path from 'path';
import { readFileSync, mkdirSync } from 'fs';
import { AUTO_BUILD_PATHS, getSpecsDir } from '../../../shared/constants';
import type { TaskStatus, Project, Task } from '../../../shared/types';
import { projectStore } from '../../project-store';
import type { TaskEventPayload } from '../../agent/task-event-schema';
import { writeFileAtomicSync } from '../../utils/atomic-file';

// In-memory locks for plan file operations
// Key: plan file path, Value: Promise chain for serializing operations
const planLocks = new Map<string, Promise<void>>();

/**
 * Serialize operations on a specific plan file to prevent race conditions.
 * Each operation waits for the previous one to complete before starting.
 */
async function withPlanLock<T>(planPath: string, operation: () => Promise<T>): Promise<T> {
  // Get or create the lock chain for this file
  const currentLock = planLocks.get(planPath) || Promise.resolve();

  // Create a new promise that will resolve after our operation completes
  let resolve: () => void;
  const newLock = new Promise<void>((r) => { resolve = r; });
  planLocks.set(planPath, newLock);

  try {
    // Wait for any previous operation to complete
    await currentLock;
    // Execute our operation
    return await operation();
  } finally {
    // Release the lock
    resolve!();
    // Clean up if this was the last operation
    if (planLocks.get(planPath) === newLock) {
      planLocks.delete(planPath);
    }
  }
}

/**
 * Check if an error is a "file not found" error
 */
function isFileNotFoundError(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Get the plan file path for a task
 */
export function getPlanPath(project: Project, task: Task): string {
  const specsBaseDir = getSpecsDir(project.autoBuildPath);
  const specDir = path.join(project.path, specsBaseDir, task.specId);
  return path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
}

/**
 * Map UI TaskStatus to Python-compatible planStatus
 */
export function mapStatusToPlanStatus(status: TaskStatus): string {
  switch (status) {
    case 'queue':
      return 'queued';
    case 'in_progress':
      return 'in_progress';
    case 'ai_review':
    case 'human_review':
      return 'review';
    case 'done':
      return 'completed';
    default:
      return 'pending';
  }
}

/**
 * Persist task status to implementation_plan.json file.
 * This is thread-safe and prevents race conditions when multiple handlers update the same file.
 *
 * @param planPath - Path to the implementation_plan.json file
 * @param status - The TaskStatus to persist
 * @param projectId - Optional project ID to invalidate cache (recommended for performance)
 * @returns true if status was persisted, false if plan file doesn't exist
 */
export async function persistPlanStatus(planPath: string, status: TaskStatus, projectId?: string): Promise<boolean> {
  return withPlanLock(planPath, async () => {
    try {
      console.warn(`[plan-file-utils] Reading implementation_plan.json to update status to: ${status}`, { planPath });
      // Read file directly without existence check to avoid TOCTOU race condition
      const planContent = readFileSync(planPath, 'utf-8');
      const plan = JSON.parse(planContent);

      plan.status = status;
      plan.planStatus = mapStatusToPlanStatus(status);
      plan.updated_at = new Date().toISOString();

      writeFileAtomicSync(planPath, JSON.stringify(plan, null, 2));
      console.warn(`[plan-file-utils] Successfully persisted status: ${status} to implementation_plan.json`);

      // Invalidate tasks cache since status changed
      if (projectId) {
        projectStore.invalidateTasksCache(projectId);
      }

      return true;
    } catch (err) {
      // File not found is expected - return false
      if (isFileNotFoundError(err)) {
        console.warn(`[plan-file-utils] implementation_plan.json not found at ${planPath} - status not persisted`);
        return false;
      }
      console.warn(`[plan-file-utils] Could not persist status to ${planPath}:`, err);
      return false;
    }
  });
}

/**
 * Persist task status synchronously (for use in event handlers where async isn't practical).
 *
 * WARNING: This function bypasses the async locking mechanism entirely!
 *
 * This means it can race with concurrent async operations (persistPlanStatus, updatePlanFile,
 * createPlanIfNotExists) that may be in flight for the same file. Using this function while
 * async operations are pending can result in:
 * - Lost updates (this write may overwrite changes from an async operation, or vice versa)
 * - Corrupted JSON (if writes interleave at the filesystem level)
 * - Inconsistent state between what was written and what the async operation expected to read
 *
 * ONLY use this function when ALL of the following conditions are met:
 * 1. You are in a synchronous context that cannot use async/await (e.g., certain event handlers)
 * 2. You are certain no async plan operations are pending or in-flight for this file path
 * 3. No other code will initiate async plan operations until this function returns
 *
 * When possible, prefer using the async `persistPlanStatus` function instead, which properly
 * participates in the locking mechanism and prevents race conditions.
 *
 * @param planPath - Path to the implementation_plan.json file
 * @param status - The TaskStatus to persist
 * @param projectId - Optional project ID to invalidate cache (recommended for performance)
 * @returns true if status was persisted, false otherwise
 */
export function persistPlanStatusSync(planPath: string, status: TaskStatus, projectId?: string): boolean {
  try {
    // Read file directly without existence check to avoid TOCTOU race condition
    const planContent = readFileSync(planPath, 'utf-8');
    const plan = JSON.parse(planContent);

    plan.status = status;
    plan.planStatus = mapStatusToPlanStatus(status);
    plan.updated_at = new Date().toISOString();

    writeFileAtomicSync(planPath, JSON.stringify(plan, null, 2));

    // Invalidate tasks cache since status changed
    if (projectId) {
      projectStore.invalidateTasksCache(projectId);
    }

    return true;
  } catch (err) {
    // File not found is expected - return false
    if (isFileNotFoundError(err)) {
      return false;
    }
    console.warn(`[plan-file-utils] Could not persist status to ${planPath}:`, err);
    return false;
  }
}

/**
 * Persist lastEvent metadata synchronously.
 *
 * WARNING: This bypasses async locking. Use only in sync event handlers where
 * async isn't practical. Prefer updatePlanFile when possible.
 */
export function persistPlanLastEventSync(planPath: string, event: TaskEventPayload): boolean {
  try {
    const planContent = readFileSync(planPath, 'utf-8');
    const plan = JSON.parse(planContent);

    plan.lastEvent = {
      eventId: event.eventId,
      sequence: event.sequence,
      type: event.type,
      timestamp: event.timestamp
    };
    plan.updated_at = new Date().toISOString();

    writeFileAtomicSync(planPath, JSON.stringify(plan, null, 2));
    return true;
  } catch (err) {
    if (isFileNotFoundError(err)) {
      return false;
    }
    console.warn(`[plan-file-utils] Could not persist lastEvent to ${planPath}:`, err);
    return false;
  }
}

/**
 * Persist task status, reviewReason, XState state, and execution phase synchronously.
 * The xstateState and executionPhase are used to restore the exact machine state on reload,
 * distinguishing between e.g. 'planning' vs 'coding' when both have status 'in_progress'.
 *
 * If the plan file doesn't exist, creates a minimal plan with the status fields.
 * This ensures XState state is persisted even during early phases like spec creation.
 */
export function persistPlanStatusAndReasonSync(
  planPath: string,
  status: TaskStatus,
  reviewReason?: string,
  projectId?: string,
  xstateState?: string,
  executionPhase?: string
): boolean {
  try {
    let plan: Record<string, unknown>;

    try {
      const planContent = readFileSync(planPath, 'utf-8');
      plan = JSON.parse(planContent);
    } catch (readErr) {
      if (!isFileNotFoundError(readErr)) {
        throw readErr;
      }
      // File doesn't exist - create a minimal plan with just status fields
      // The spec runner will populate the full plan later
      const planDir = path.dirname(planPath);
      mkdirSync(planDir, { recursive: true });
      plan = {
        created_at: new Date().toISOString(),
        phases: []
      };
      console.log(`[plan-file-utils] Creating minimal plan for XState persistence: ${planPath}`);
    }

    plan.status = status;
    plan.planStatus = mapStatusToPlanStatus(status);
    plan.reviewReason = reviewReason;
    if (xstateState) {
      plan.xstateState = xstateState;
    }
    if (executionPhase) {
      plan.executionPhase = executionPhase;
    }
    plan.updated_at = new Date().toISOString();

    writeFileAtomicSync(planPath, JSON.stringify(plan, null, 2));

    if (projectId) {
      projectStore.invalidateTasksCache(projectId);
    }

    return true;
  } catch (err) {
    console.warn(`[plan-file-utils] Could not persist status/reason to ${planPath}:`, err);
    return false;
  }
}

/**
 * Persist execution phase to the plan file synchronously.
 * This is called when execution progress updates to ensure the phase
 * is persisted for restoration on app refresh.
 */
export function persistPlanPhaseSync(
  planPath: string,
  phase: string,
  projectId?: string
): boolean {
  try {
    let plan: Record<string, unknown>;

    try {
      const planContent = readFileSync(planPath, 'utf-8');
      plan = JSON.parse(planContent);
    } catch (readErr) {
      if (!isFileNotFoundError(readErr)) {
        throw readErr;
      }
      // File doesn't exist - create minimal plan
      const planDir = path.dirname(planPath);
      mkdirSync(planDir, { recursive: true });
      plan = {
        created_at: new Date().toISOString(),
        phases: []
      };
    }

    // Store the execution phase for restoration
    plan.executionPhase = phase;

    // Also update status to match the phase so the card stays in the correct column on refresh
    // Map execution phase to TaskStatus for column placement
    const phaseToStatus: Record<string, TaskStatus> = {
      'planning': 'in_progress',
      'coding': 'in_progress',
      'qa_review': 'ai_review',
      'qa_fixing': 'ai_review',
      'complete': 'human_review',
      'failed': 'error'
    };
    const mappedStatus = phaseToStatus[phase];
    if (mappedStatus) {
      plan.status = mappedStatus;
      plan.planStatus = mapStatusToPlanStatus(mappedStatus);
    }

    plan.updated_at = new Date().toISOString();

    writeFileAtomicSync(planPath, JSON.stringify(plan, null, 2));

    if (projectId) {
      projectStore.invalidateTasksCache(projectId);
    }

    return true;
  } catch (err) {
    console.warn(`[plan-file-utils] Could not persist phase to ${planPath}:`, err);
    return false;
  }
}

/**
 * Read and update the plan file atomically.
 *
 * @param planPath - Path to the implementation_plan.json file
 * @param updater - Function that receives the current plan and returns the updated plan
 * @returns The updated plan, or null if the file doesn't exist
 */
export async function updatePlanFile<T extends Record<string, unknown>>(
  planPath: string,
  updater: (plan: T) => T
): Promise<T | null> {
  return withPlanLock(planPath, async () => {
    try {
      console.warn(`[plan-file-utils] Reading implementation_plan.json for update`, { planPath });
      // Read file directly without existence check to avoid TOCTOU race condition
      const planContent = readFileSync(planPath, 'utf-8');
      const plan = JSON.parse(planContent) as T;

      const updatedPlan = updater(plan);
      // Add updated_at timestamp - use type assertion since T extends Record<string, unknown>
      (updatedPlan as Record<string, unknown>).updated_at = new Date().toISOString();

      writeFileAtomicSync(planPath, JSON.stringify(updatedPlan, null, 2));
      console.warn(`[plan-file-utils] Successfully updated implementation_plan.json`);
      return updatedPlan;
    } catch (err) {
      // File not found is expected - return null
      if (isFileNotFoundError(err)) {
        console.warn(`[plan-file-utils] implementation_plan.json not found at ${planPath} - update skipped`);
        return null;
      }
      console.warn(`[plan-file-utils] Could not update plan at ${planPath}:`, err);
      return null;
    }
  });
}

/**
 * Create a new plan file if it doesn't exist.
 *
 * @param planPath - Path to the implementation_plan.json file
 * @param task - The task to create the plan for
 * @param status - Initial status for the plan
 * @param xstateState - Optional XState machine state for restoration
 */
export async function createPlanIfNotExists(
  planPath: string,
  task: Task,
  status: TaskStatus,
  xstateState?: string
): Promise<void> {
  return withPlanLock(planPath, async () => {
    // Try to read the file first - if it exists, do nothing
    try {
      readFileSync(planPath, 'utf-8');
      return; // File exists, nothing to do
    } catch (err) {
      if (!isFileNotFoundError(err)) {
        throw err; // Re-throw unexpected errors
      }
      // File doesn't exist, continue to create it
    }

    const plan: Record<string, unknown> = {
      feature: task.title,
      description: task.description || '',
      created_at: task.createdAt.toISOString(),
      updated_at: new Date().toISOString(),
      status: status,
      planStatus: mapStatusToPlanStatus(status),
      phases: []
    };

    // Include xstateState for accurate restoration on reload
    if (xstateState) {
      plan.xstateState = xstateState;
    }

    // Ensure directory exists - use try/catch pattern
    const planDir = path.dirname(planPath);
    try {
      mkdirSync(planDir, { recursive: true });
    } catch (err) {
      // Directory might already exist or be created concurrently - that's fine
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
    }

    writeFileAtomicSync(planPath, JSON.stringify(plan, null, 2));
  });
}

/**
 * Reset all stuck subtasks (in_progress or failed) to pending state.
 * This enables automatic recovery when tasks are interrupted by rate limits or errors.
 * Thread-safe with withPlanLock.
 *
 * @param planPath - Path to the implementation_plan.json file
 * @param projectId - Optional project ID to invalidate cache (recommended for performance)
 * @returns Object with success flag and count of reset subtasks
 */
export async function resetStuckSubtasks(planPath: string, projectId?: string): Promise<{ success: boolean; resetCount: number }> {
  return withPlanLock(planPath, async () => {
    try {
      console.log(`[plan-file-utils] Reading implementation_plan.json to reset stuck subtasks`, { planPath });

      // Read file directly without existence check to avoid TOCTOU race condition
      const planContent = readFileSync(planPath, 'utf-8');
      const plan = JSON.parse(planContent);

      let resetCount = 0;

      // Iterate through all phases and subtasks
      if (plan.phases && Array.isArray(plan.phases)) {
        for (const phase of plan.phases) {
          if (phase.subtasks && Array.isArray(phase.subtasks)) {
            for (const subtask of phase.subtasks) {
              // Only reset subtasks that are stuck (in_progress or failed)
              // NEVER reset completed subtasks to avoid redoing work
              if (subtask.status === 'in_progress' || subtask.status === 'failed') {
                const originalStatus = subtask.status;
                subtask.status = 'pending';
                subtask.started_at = null;
                subtask.completed_at = null;
                resetCount++;
                console.log(`[plan-file-utils] Reset subtask ${subtask.id} from ${originalStatus} to pending`);
              }
            }
          }
        }
      }

      // Only write if we actually reset something
      if (resetCount > 0) {
        plan.updated_at = new Date().toISOString();
        writeFileAtomicSync(planPath, JSON.stringify(plan, null, 2));
        console.log(`[plan-file-utils] Successfully reset ${resetCount} stuck subtask(s) in implementation_plan.json`);

        // Invalidate tasks cache since subtask status changed
        if (projectId) {
          projectStore.invalidateTasksCache(projectId);
        }
      } else {
        console.log(`[plan-file-utils] No stuck subtasks found to reset`);
      }

      return { success: true, resetCount };
    } catch (err) {
      // File not found is expected - return success with 0 count
      if (isFileNotFoundError(err)) {
        console.warn(`[plan-file-utils] implementation_plan.json not found at ${planPath} - no subtasks to reset`);
        return { success: false, resetCount: 0 };
      }
      console.warn(`[plan-file-utils] Could not reset stuck subtasks at ${planPath}:`, err);
      return { success: false, resetCount: 0 };
    }
  });
}

/**
 * Update task_metadata.json to add PR URL.
 * This is a simple JSON file update (no locking needed as it's rarely updated concurrently).
 *
 * @param metadataPath - Path to the task_metadata.json file
 * @param prUrl - The PR URL to add to metadata
 * @returns true if metadata was updated, false if file doesn't exist or failed
 */
export function updateTaskMetadataPrUrl(metadataPath: string, prUrl: string): boolean {
  try {
    let metadata: Record<string, unknown> = {};

    // Try to read existing metadata
    try {
      const content = readFileSync(metadataPath, 'utf-8');
      metadata = JSON.parse(content);
    } catch (err) {
      if (!isFileNotFoundError(err)) {
        throw err;
      }
      // File doesn't exist, will create new one
    }

    // Update with prUrl
    metadata.prUrl = prUrl;

    // Ensure parent directory exists before writing
    mkdirSync(path.dirname(metadataPath), { recursive: true });

    // Write back
    writeFileAtomicSync(metadataPath, JSON.stringify(metadata, null, 2));
    return true;
  } catch (err) {
    console.warn(`[plan-file-utils] Could not update metadata at ${metadataPath}:`, err);
    return false;
  }
}

/**
 * Check if a task has a valid implementation plan with subtasks.
 * A plan is considered valid if it has at least one subtask across all phases.
 *
 * @param project - The project containing the task
 * @param task - The task to check
 * @returns true if the task has a valid plan with subtasks, false otherwise
 */
export function hasPlanWithSubtasks(project: Project, task: Task): boolean {
  try {
    const planPath = getPlanPath(project, task);
    const planContent = readFileSync(planPath, 'utf-8');
    if (!planContent) {
      return false;
    }

    const plan = JSON.parse(planContent);
    // A plan exists if it has phases with subtasks (totalCount > 0)
    const phases = plan.phases as Array<{ subtasks?: Array<unknown> }> | undefined;
    const totalCount = phases?.flatMap(p => p.subtasks || []).length || 0;
    return totalCount > 0;
  } catch {
    // File doesn't exist or is malformed
    return false;
  }
}
