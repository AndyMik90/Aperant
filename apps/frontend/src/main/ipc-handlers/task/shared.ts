import type { Task, Project } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { existsSync, rmSync, lstatSync, realpathSync } from 'fs';
import { rm } from 'fs/promises';
import { execFileSync } from 'child_process';
import { getToolPath } from '../../cli-tool-manager';
import path from 'path';
import { isWindows } from '../../platform';

/**
 * Result of a worktree deletion operation
 */
export interface WorktreeDeleteResult {
  success: boolean;
  error?: string;
  method?: 'git' | 'force';
}

/**
 * Validate that a worktree path is safe to delete.
 * Ensures the path:
 * 1. Is within the project's worktree directory (.auto-claude/worktrees/)
 * 2. Is not a symlink escaping the expected directory
 *
 * @param worktreePath - Full path to the worktree directory
 * @param projectPath - Project root path
 * @returns Object with valid flag and optional error message
 */
function validateWorktreePath(worktreePath: string, projectPath: string): { valid: boolean; error?: string } {
  // Normalize paths for consistent comparison
  const normalizedWorktreePath = path.normalize(worktreePath);
  const normalizedProjectPath = path.normalize(projectPath);

  // Expected worktree root: {project}/.auto-claude/worktrees/
  const expectedWorktreeRoot = path.join(normalizedProjectPath, '.auto-claude', 'worktrees');

  // Check if path is within expected worktree directory
  if (!normalizedWorktreePath.startsWith(expectedWorktreeRoot + path.sep) &&
      normalizedWorktreePath !== expectedWorktreeRoot) {
    return {
      valid: false,
      error: `Path is outside worktree directory: ${worktreePath}`
    };
  }

  // Check for realpath escape if the path exists (covers symlinked parents too)
  if (existsSync(worktreePath)) {
    try {
      const realPath = realpathSync(worktreePath);
      const normalizedRealPath = path.normalize(realPath);

      if (
        !normalizedRealPath.startsWith(expectedWorktreeRoot + path.sep) &&
        normalizedRealPath !== expectedWorktreeRoot
      ) {
        const stats = lstatSync(worktreePath);
        return {
          valid: false,
          error: stats.isSymbolicLink()
            ? `Symlink points outside worktree directory: ${worktreePath} -> ${realPath}`
            : `Resolved path is outside worktree directory: ${worktreePath} -> ${realPath}`
        };
      }
    } catch (err) {
      // If we can't stat, let the deletion attempt handle the error
      console.warn(`Could not validate path ${worktreePath}:`, err);
    }
  }

  return { valid: true };
}

/**
 * Delays execution for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Delete a directory with retry logic for Windows file locking issues.
 * On Windows, files can be locked by other processes (IDE, antivirus, etc.)
 * which causes immediate deletion to fail. This retries with linear backoff.
 */
async function deleteDirectoryWithRetry(
  dirPath: string,
  maxRetries: number = 5,
  retryDelay: number = 500,
  logPrefix: string = '[forceDeleteWorktree]'
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rm(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return; // Success
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const waitTime = retryDelay * attempt; // Linear backoff
        console.warn(
          `${logPrefix} Directory deletion attempt ${attempt}/${maxRetries} failed, ` +
          `retrying in ${waitTime}ms: ${lastError.message}`
        );
        await delay(waitTime);
      }
    }
  }

  // All retries exhausted
  throw lastError || new Error('Failed to delete directory after retries');
}

/**
 * Robustly delete a worktree by trying git worktree remove first,
 * then falling back to force-delete if git fails (orphaned worktrees).
 * Always prunes stale worktree references afterward.
 *
 * On Windows, uses async retry logic with exponential backoff to handle
 * file locking issues from IDEs, antivirus, etc.
 *
 * Security: Validates that the path is within the expected worktree directory
 * and is not a symlink escaping to an unauthorized location.
 *
 * @param worktreePath - Full path to the worktree directory
 * @param projectPath - Project root path (for running git commands)
 * @returns Result indicating success/failure and method used
 */
export function forceDeleteWorktree(worktreePath: string, projectPath: string): WorktreeDeleteResult {
  // Defensive check for undefined/null paths
  if (!worktreePath || typeof worktreePath !== 'string') {
    console.error('forceDeleteWorktree: worktreePath is undefined or not a string');
    return { success: false, error: 'Invalid worktree path: path is undefined' };
  }
  if (!projectPath || typeof projectPath !== 'string') {
    console.error('forceDeleteWorktree: projectPath is undefined or not a string');
    return { success: false, error: 'Invalid project path: path is undefined' };
  }

  // Security: Validate path before any deletion
  const validation = validateWorktreePath(worktreePath, projectPath);
  if (!validation.valid) {
    console.error(`Security: Refusing to delete invalid worktree path: ${validation.error}`);
    return { success: false, error: validation.error };
  }

  let method: 'git' | 'force' = 'git';

  try {
    // Try git worktree remove first
    execFileSync(getToolPath('git'), ['worktree', 'remove', '--force', worktreePath], {
      cwd: projectPath,
      encoding: 'utf-8'
    });
    console.log(`Deleted worktree via git: ${worktreePath}`);
  } catch (gitError) {
    // Git command failed, force delete the directory
    console.warn(`Git worktree remove failed, force deleting: ${gitError}`);
    method = 'force';

    try {
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
        console.log(`Force-deleted worktree directory: ${worktreePath}`);
      }
    } catch (rmError) {
      const errorMessage = rmError instanceof Error ? rmError.message : 'Unknown error';
      console.error(`Failed to force-delete worktree directory: ${errorMessage}`);
      return { success: false, error: `Failed to delete worktree: ${errorMessage}` };
    }
  }

  // Prune stale worktree references, regardless of which path was taken
  try {
    execFileSync(getToolPath('git'), ['worktree', 'prune'], {
      cwd: projectPath,
      encoding: 'utf-8'
    });
  } catch {
    // Prune failure is non-critical
  }

  return { success: true, method };
}

/**
 * Async version of forceDeleteWorktree with Windows retry logic.
 * Use this for handlers that can be async (most IPC handlers).
 *
 * On Windows, file locking by IDEs, antivirus, etc. can cause deletion to fail.
 * This version retries with exponential backoff to handle transient locks.
 *
 * @param worktreePath - Full path to the worktree directory
 * @param projectPath - Project root path (for running git commands)
 * @returns Promise with result indicating success/failure and method used
 */
export async function forceDeleteWorktreeAsync(worktreePath: string, projectPath: string): Promise<WorktreeDeleteResult> {
  // Defensive check for undefined/null paths
  if (!worktreePath || typeof worktreePath !== 'string') {
    console.error('forceDeleteWorktreeAsync: worktreePath is undefined or not a string');
    return { success: false, error: 'Invalid worktree path: path is undefined' };
  }
  if (!projectPath || typeof projectPath !== 'string') {
    console.error('forceDeleteWorktreeAsync: projectPath is undefined or not a string');
    return { success: false, error: 'Invalid project path: path is undefined' };
  }

  // Security: Validate path before any deletion
  const validation = validateWorktreePath(worktreePath, projectPath);
  if (!validation.valid) {
    console.error(`Security: Refusing to delete invalid worktree path: ${validation.error}`);
    return { success: false, error: validation.error };
  }

  let method: 'git' | 'force' = 'git';

  try {
    // Try git worktree remove first
    execFileSync(getToolPath('git'), ['worktree', 'remove', '--force', worktreePath], {
      cwd: projectPath,
      encoding: 'utf-8'
    });
    console.log(`Deleted worktree via git: ${worktreePath}`);
  } catch (gitError) {
    // Git command failed, force delete the directory
    console.warn(`Git worktree remove failed, force deleting: ${gitError}`);
    method = 'force';

    if (existsSync(worktreePath)) {
      if (isWindows()) {
        // Windows: Use async retry logic to handle file locks
        try {
          await deleteDirectoryWithRetry(worktreePath, 5, 500, '[forceDeleteWorktreeAsync]');
          console.log(`Force-deleted worktree directory (async with retry): ${worktreePath}`);
        } catch (rmError) {
          const errorMessage = rmError instanceof Error ? rmError.message : 'Unknown error';
          console.error(`Failed to force-delete worktree directory after retries: ${errorMessage}`);
          return { success: false, error: `Failed to delete worktree: ${errorMessage}` };
        }
      } else {
        // Non-Windows: Use sync delete (no file lock issues)
        try {
          rmSync(worktreePath, { recursive: true, force: true });
          console.log(`Force-deleted worktree directory: ${worktreePath}`);
        } catch (rmError) {
          const errorMessage = rmError instanceof Error ? rmError.message : 'Unknown error';
          console.error(`Failed to force-delete worktree directory: ${errorMessage}`);
          return { success: false, error: `Failed to delete worktree: ${errorMessage}` };
        }
      }
    }
  }

  // Prune stale worktree references, regardless of which path was taken
  try {
    execFileSync(getToolPath('git'), ['worktree', 'prune'], {
      cwd: projectPath,
      encoding: 'utf-8'
    });
  } catch {
    // Prune failure is non-critical
  }

  return { success: true, method };
}

/**
 * Helper function to find task and project by taskId
 */
export const findTaskAndProject = (taskId: string): { task: Task | undefined; project: Project | undefined } => {
  const projects = projectStore.getProjects();
  let task: Task | undefined;
  let project: Project | undefined;

  for (const p of projects) {
    const tasks = projectStore.getTasks(p.id);
    task = tasks.find((t) => t.id === taskId || t.specId === taskId);
    if (task) {
      project = p;
      break;
    }
  }

  return { task, project };
};
