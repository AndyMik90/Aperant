/**
 * Worktree Cleanup Utility
 *
 * Provides a robust, cross-platform worktree cleanup implementation that handles
 * Windows-specific issues with git worktree deletion when untracked files exist.
 *
 * The standard `git worktree remove --force` fails on Windows when the worktree
 * contains untracked files (node_modules, build artifacts, etc.). This utility:
 *
 * 1. Manually deletes the worktree directory with retry logic for file locks
 *    (falls back to shell `rm -rf` on Unix when Node.js rm() fails)
 * 2. Prunes git's internal worktree references
 * 3. Optionally deletes the associated branch
 *
 * Related issue: https://github.com/AndyMik90/Auto-Claude/issues/1539
 */

import { execFileSync } from 'child_process';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';
import { getToolPath } from '../cli-tool-manager';
import { getIsolatedGitEnv } from './git-isolation';
import { getTaskWorktreeDir, getTerminalWorktreeDir, isPathWithinBase } from '../worktree-paths';

/**
 * Options for worktree cleanup operation
 */
export interface WorktreeCleanupOptions {
  /** Absolute path to the worktree directory to delete */
  worktreePath: string;
  /** Absolute path to the main project directory (for git operations) */
  projectPath: string;
  /** Spec ID for generating branch name (e.g., "001-my-feature") */
  specId: string;
  /** Log prefix for console messages (e.g., "[TASK_DELETE]") */
  logPrefix?: string;
  /** Whether to delete the associated branch (default: true) */
  deleteBranch?: boolean;
  /** Explicit branch name to use for deletion (overrides auto-detection fallback) */
  branchName?: string;
  /** Timeout in milliseconds for git operations (default: 30000) */
  timeout?: number;
  /** Maximum retries for directory deletion on Windows (default: 3) */
  maxRetries?: number;
  /** Delay between retries in milliseconds (default: 500) */
  retryDelay?: number;
}

/**
 * Result of the cleanup operation
 */
export interface WorktreeCleanupResult {
  /** Whether the cleanup was successful */
  success: boolean;
  /** The branch that was deleted (if deleteBranch was true) */
  branch?: string;
  /** Warnings that occurred during cleanup (non-fatal issues) */
  warnings: string[];
}

/**
 * Gets the worktree branch name based on spec ID
 */
function getWorktreeBranch(worktreePath: string, specId: string, timeout: number, explicitBranchName?: string): string | null {
  // First try to get branch from the worktree's HEAD
  if (existsSync(worktreePath)) {
    try {
      const branch = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: worktreePath,
        encoding: 'utf-8',
        env: getIsolatedGitEnv(),
        timeout
      }).trim();

      if (branch && branch !== 'HEAD') {
        return branch;
      }
    } catch {
      // Worktree might be corrupted, fall back to explicit name or naming convention
    }
  }

  // Use explicit branch name if provided (e.g., terminal worktrees use terminal/{name})
  if (explicitBranchName) {
    return explicitBranchName;
  }

  // Fall back to the naming convention: auto-claude/{spec-id}
  return `auto-claude/${specId}`;
}

/**
 * Delays execution for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deletes a directory with retry logic for Windows file locking issues
 *
 * On Windows, files can be locked by other processes (IDE, build tools, etc.)
 * which causes immediate deletion to fail. This function retries with linear
 * backoff to handle transient file locks.
 */
async function deleteDirectoryWithRetry(
  dirPath: string,
  maxRetries: number,
  retryDelay: number,
  logPrefix: string
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rm(dirPath, { recursive: true, force: true });
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

  // All retries exhausted - try shell rm -rf as fallback on Unix
  // Node's rm() can fail with ENOTEMPTY on macOS .app bundles
  if (process.platform !== 'win32') {
    try {
      console.warn(`${logPrefix} Node.js rm() failed, trying /bin/rm -rf fallback...`);
      execFileSync('/bin/rm', ['-rf', dirPath], { timeout: 60000 });
      return;
    } catch {
      // Fall through to throw original error
    }
  }

  throw lastError || new Error('Failed to delete directory after retries');
}

/**
 * Cleans up a worktree directory in a robust, cross-platform manner
 *
 * This function handles the Windows-specific issue where `git worktree remove --force`
 * fails when the worktree contains untracked files. The approach is:
 *
 * 1. Manually delete the directory with retry logic for file locks
 *    (falls back to shell `rm -rf` on Unix when Node.js rm() fails)
 * 2. Run `git worktree prune` to clean up git's internal references
 * 3. Optionally delete the associated branch
 *
 * All errors except directory deletion are logged but don't fail the operation.
 *
 * @param options - Cleanup configuration options
 * @returns Result object with success status and any warnings
 *
 * @example
 * ```typescript
 * const result = await cleanupWorktree({
 *   worktreePath: 'C:/projects/my-app/.auto-claude/worktrees/tasks/001-feature',
 *   projectPath: 'C:/projects/my-app',
 *   specId: '001-feature',
 *   logPrefix: '[TASK_DELETE]'
 * });
 *
 * if (result.success) {
 *   console.log('Cleanup successful');
 * }
 * ```
 */
export async function cleanupWorktree(options: WorktreeCleanupOptions): Promise<WorktreeCleanupResult> {
  const {
    worktreePath,
    projectPath,
    specId,
    logPrefix = '[WORKTREE_CLEANUP]',
    deleteBranch = true,
    branchName,
    timeout = 30000,
    maxRetries = 3,
    retryDelay = 500
  } = options;

  const warnings: string[] = [];

  // Security: Validate that worktreePath is within the expected worktree directories
  // This prevents path traversal attacks and accidental deletion of wrong directories
  // Supports both task worktrees (.auto-claude/worktrees/tasks) and terminal worktrees (.auto-claude/worktrees/terminal)
  const taskBase = getTaskWorktreeDir(projectPath);
  const terminalBase = getTerminalWorktreeDir(projectPath);
  const isValidPath = isPathWithinBase(worktreePath, taskBase) || isPathWithinBase(worktreePath, terminalBase);

  if (!isValidPath) {
    console.error(`${logPrefix} Security: Path validation failed - worktree path is outside expected directories`);
    return {
      success: false,
      warnings: ['Invalid worktree path']
    };
  }

  // 1. Get the branch name before we delete the directory
  const branch = getWorktreeBranch(worktreePath, specId, timeout, branchName);
  console.warn(`${logPrefix} Starting cleanup for worktree: ${worktreePath}`);
  if (branch) {
    console.warn(`${logPrefix} Associated branch: ${branch}`);
  }

  // 2. Delete the worktree directory manually
  // This is required because `git worktree remove --force` fails on Windows
  // when the directory contains untracked files (node_modules, build artifacts, etc.)
  if (existsSync(worktreePath)) {
    console.warn(`${logPrefix} Deleting worktree directory...`);
    try {
      await deleteDirectoryWithRetry(worktreePath, maxRetries, retryDelay, logPrefix);
      console.warn(`${logPrefix} Worktree directory deleted successfully`);
    } catch (deleteError) {
      // This IS critical - if we can't delete the directory, the cleanup failed
      const msg = deleteError instanceof Error ? deleteError.message : String(deleteError);
      console.error(`${logPrefix} Failed to delete worktree directory: ${msg}`);
      return {
        success: false,
        branch: branch || undefined,
        warnings: [...warnings, `Directory deletion failed: ${msg}`]
      };
    }
  } else {
    console.warn(`${logPrefix} Worktree directory already deleted`);
  }

  // 3. Prune git's internal worktree references
  // After manual deletion, git still thinks the worktree exists in .git/worktrees/
  // Running prune cleans up these stale references
  try {
    execFileSync(getToolPath('git'), ['worktree', 'prune'], {
      cwd: projectPath,
      encoding: 'utf-8',
      env: getIsolatedGitEnv(),
      timeout
    });
    console.warn(`${logPrefix} Git worktree references pruned`);
  } catch (pruneError) {
    // Non-critical - the worktree is already gone, prune is just cleanup
    const msg = pruneError instanceof Error ? pruneError.message : String(pruneError);
    console.warn(`${logPrefix} Failed to prune worktree references (non-critical): ${msg}`);
    warnings.push(`Worktree prune failed: ${msg}`);
  }

  // 4. Delete the branch if requested
  if (deleteBranch && branch) {
    try {
      execFileSync(getToolPath('git'), ['branch', '-D', branch], {
        cwd: projectPath,
        encoding: 'utf-8',
        env: getIsolatedGitEnv(),
        timeout
      });
      console.warn(`${logPrefix} Branch deleted: ${branch}`);
    } catch (branchError) {
      // Non-critical - branch might not exist or already deleted
      const msg = branchError instanceof Error ? branchError.message : String(branchError);
      console.warn(`${logPrefix} Failed to delete branch (non-critical): ${msg}`);
      warnings.push(`Branch deletion failed: ${msg}`);
    }
  }

  console.warn(`${logPrefix} Cleanup completed successfully`);
  return {
    success: true,
    branch: branch || undefined,
    warnings
  };
}
