/**
 * Git Environment Isolation Utility
 *
 * Prevents git environment variable contamination between worktrees
 * and the main repository. When running git commands in a worktree context,
 * environment variables like GIT_DIR, GIT_WORK_TREE, etc. can leak and
 * cause files to appear in the wrong repository.
 *
 * This utility clears problematic git env vars before spawning git processes,
 * ensuring each git operation targets the correct repository.
 *
 * Related fix: .husky/pre-commit hook also clears these vars.
 * Backend equivalent: apps/backend/core/git_executable.py:get_isolated_git_env()
 */

import { execFileSync } from 'child_process';
import { getToolPath } from '../cli-tool-manager';

/**
 * Git environment variables that can cause cross-contamination between worktrees.
 *
 * GIT_DIR: Overrides the location of the .git directory
 * GIT_WORK_TREE: Overrides the working tree location
 * GIT_INDEX_FILE: Overrides the index file location
 * GIT_OBJECT_DIRECTORY: Overrides the object store location
 * GIT_ALTERNATE_OBJECT_DIRECTORIES: Additional object stores
 * GIT_AUTHOR_*: Can cause wrong commit attribution in automated contexts
 * GIT_COMMITTER_*: Can cause wrong commit attribution in automated contexts
 */
export const GIT_ENV_VARS_TO_CLEAR = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_DATE',
] as const;

/**
 * Creates a clean environment for git subprocess operations.
 *
 * Copies the current process environment and removes git-specific
 * variables that can interfere with worktree operations.
 *
 * Also sets HUSKY=0 to disable the user's pre-commit hooks when
 * Auto-Claude manages commits, preventing double-hook execution
 * and potential conflicts.
 *
 * @param baseEnv - Optional base environment to start from. Defaults to process.env
 * @returns Clean environment object safe for git subprocess operations
 *
 * @example
 * ```typescript
 * import { spawn } from 'child_process';
 * import { getIsolatedGitEnv } from './git-isolation';
 *
 * spawn('git', ['status'], {
 *   cwd: worktreePath,
 *   env: getIsolatedGitEnv(),
 * });
 * ```
 */
export function getIsolatedGitEnv(
  baseEnv: NodeJS.ProcessEnv = process.env
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...baseEnv };

  for (const varName of GIT_ENV_VARS_TO_CLEAR) {
    delete env[varName];
  }

  env.HUSKY = '0';

  return env;
}

/**
 * Creates spawn options with isolated git environment.
 *
 * Convenience function that returns common spawn options
 * with the isolated environment already set.
 *
 * @param cwd - Working directory for the command
 * @param additionalOptions - Additional spawn options to merge
 * @returns Spawn options object with isolated git environment
 *
 * @example
 * ```typescript
 * import { execFileSync } from 'child_process';
 * import { getIsolatedGitSpawnOptions } from './git-isolation';
 *
 * execFileSync('git', ['status'], getIsolatedGitSpawnOptions(worktreePath));
 * ```
 */
export function getIsolatedGitSpawnOptions(
  cwd: string,
  additionalOptions: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    cwd,
    env: getIsolatedGitEnv(),
    encoding: 'utf-8',
    ...additionalOptions,
  };
}

/**
 * Result type for detectWorktreeBranch function.
 */
export interface WorktreeBranchDetectionResult {
  /** The branch name to use for deletion */
  branch: string;
  /** Whether the fallback branch pattern was used */
  usingFallback: boolean;
}

/**
 * Detects the branch name in a worktree with safety validation.
 *
 * This function prevents a critical bug where git rev-parse in a corrupted/orphaned
 * worktree can return the main project's current branch instead of the worktree's branch.
 * It validates the detected branch matches the expected pattern before using it.
 *
 * @param worktreePath - Path to the worktree directory
 * @param specId - The spec ID used to generate the expected branch name
 * @param options - Optional configuration
 * @param options.timeout - Timeout in milliseconds for git commands (default: 30000)
 * @param options.logPrefix - Prefix for log messages (e.g., "[TASK_UPDATE_STATUS]")
 * @returns Object containing the branch name and whether fallback was used
 *
 * @example
 * ```typescript
 * import { detectWorktreeBranch } from './utils/git-isolation';
 * import { getToolPath } from './cli-tool-manager';
 *
 * const { branch, usingFallback } = detectWorktreeBranch(
 *   worktreePath,
 *   task.specId,
 *   { timeout: 30000, logPrefix: '[TASK_WORKTREE_DISCARD]' }
 * );
 * ```
 */
export function detectWorktreeBranch(
  worktreePath: string,
  specId: string,
  options: { timeout?: number; logPrefix?: string } = {}
): WorktreeBranchDetectionResult {
  const { timeout = 30000, logPrefix = '[WORKTREE_BRANCH_DETECTION]' } = options;
  const expectedBranch = `auto-claude/${specId}`;
  let branch = expectedBranch;
  let usingFallback = false;

  try {
    const detectedBranch = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout,
      env: getIsolatedGitEnv()
    }).trim();

    // SECURITY: Use strict exact-match validation (not prefix matching) to prevent
    // accidentally deleting a different task's auto-claude branch. When git rev-parse
    // returns an unexpected branch, we MUST fall back to the expected pattern rather
    // than risking deletion of the wrong branch. This is critical for data safety.
    if (detectedBranch === expectedBranch) {
      branch = detectedBranch;
    } else {
      console.warn(`${logPrefix} Detected branch '${detectedBranch}' doesn't match expected branch '${expectedBranch}', using fallback: ${expectedBranch}`);
      usingFallback = true;
    }
  } catch (branchError) {
    // If we can't get branch name, use the default pattern
    usingFallback = true;
    console.warn(`${logPrefix} Could not get branch name, using fallback pattern: ${branch}`, branchError);
  }

  return { branch, usingFallback };
}

/**
 * Refreshes the git index to ensure accurate status after external commits.
 *
 * Git caches file stat information in its index. When files are modified
 * externally (e.g., by another process or IDE), the cached stat info can
 * become stale, causing `git status` to report false positives for
 * uncommitted changes.
 *
 * This function runs `git update-index --refresh` which updates the cached
 * stat information to match the actual file system state.
 *
 * @param cwd - Working directory where the git command should run
 *
 * @example
 * ```typescript
 * import { refreshGitIndex } from './git-isolation';
 *
 * // Call before git status to ensure accurate results
 * refreshGitIndex(projectPath);
 * const status = execFileSync('git', ['status', '--porcelain'], { cwd: projectPath });
 * ```
 */
export function refreshGitIndex(cwd: string): void {
  try {
    execFileSync(getToolPath('git'), ['update-index', '--refresh'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getIsolatedGitEnv(),
    });
  } catch {
    // Ignore refresh errors - it's a best-effort optimization
  }
}
