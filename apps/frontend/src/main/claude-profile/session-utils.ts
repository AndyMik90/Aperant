/**
 * Session Utilities
 *
 * Handles Claude Code session migration between profiles.
 * Sessions are stored in CLAUDE_CONFIG_DIR/projects/{cwd-path-hash}/{session-id}.jsonl
 * and can be copied between profiles to enable session continuity after profile switches.
 */

import { existsSync } from 'fs';
import { mkdir, copyFile, cp, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { isNodeError } from '../utils/type-guards';

/**
 * Convert a working directory path to the Claude projects path format.
 * Claude uses a sanitized path format: /Users/foo/bar -> -Users-foo-bar
 *
 * LIMITATION: This function has a known collision risk where paths containing dashes
 * can collide with paths using directory separators. For example:
 * - '/foo/bar-baz' -> 'foo-bar-baz'
 * - '/foo/bar/baz' -> 'foo-bar-baz'
 *
 * This behavior matches Claude CLI's existing convention for compatibility and is
 * accepted as a low-probability edge case in typical project directory structures.
 *
 * @param cwd - The working directory path to convert
 * @returns The sanitized path format used by Claude for project identification
 */
export function cwdToProjectPath(cwd: string): string {
  // Normalize to forward slashes first (cross-platform: Windows C:\foo\bar -> C:/foo/bar)
  const normalized = cwd.replace(/\\/g, '/');
  // Remove Windows drive letter (C:, D:, etc.) to avoid colons in directory names
  // Then replace all path separators with dashes (keeping leading dash for Unix paths)
  return normalized.replace(/^[a-zA-Z]:/, '').replace(/\//g, '-');
}

/**
 * Get the full path to a session file for a given profile config directory.
 *
 * @param configDir - The profile's CLAUDE_CONFIG_DIR path
 * @param cwd - The working directory where the session was created
 * @param sessionId - The session UUID
 * @returns Full path to the session .jsonl file
 */
export function getSessionFilePath(configDir: string, cwd: string, sessionId: string): string {
  const expandedConfigDir = configDir.startsWith('~')
    ? configDir.replace(/^~/, homedir())
    : configDir;

  const projectPath = cwdToProjectPath(cwd);
  return join(expandedConfigDir, 'projects', projectPath, `${sessionId}.jsonl`);
}

/**
 * Get the full path to a session's tool-results directory.
 *
 * @param configDir - The profile's CLAUDE_CONFIG_DIR path
 * @param cwd - The working directory where the session was created
 * @param sessionId - The session UUID
 * @returns Full path to the session directory (contains tool-results/)
 */
export function getSessionDirPath(configDir: string, cwd: string, sessionId: string): string {
  const expandedConfigDir = configDir.startsWith('~')
    ? configDir.replace(/^~/, homedir())
    : configDir;

  const projectPath = cwdToProjectPath(cwd);
  return join(expandedConfigDir, 'projects', projectPath, sessionId);
}

/**
 * Result of a session migration operation
 */
export interface SessionMigrationResult {
  success: boolean;
  sessionId: string;
  sourceProfile: string;
  targetProfile: string;
  filesCopied: number;
  error?: string;
}

/**
 * Migrate a Claude Code session from one profile to another.
 *
 * This copies the session .jsonl file and any associated tool-results directory
 * from the source profile's config directory to the target profile's config directory.
 *
 * After migration, the session can be resumed with the target profile's credentials
 * using `claude --resume {sessionId}`.
 *
 * @param sourceConfigDir - Source profile's CLAUDE_CONFIG_DIR
 * @param targetConfigDir - Target profile's CLAUDE_CONFIG_DIR
 * @param cwd - Working directory where the session was created
 * @param sessionId - The session UUID to migrate
 * @returns Migration result with success status and details
 */
export async function migrateSession(
  sourceConfigDir: string,
  targetConfigDir: string,
  cwd: string,
  sessionId: string
): Promise<SessionMigrationResult> {
  const result: SessionMigrationResult = {
    success: false,
    sessionId,
    sourceProfile: sourceConfigDir,
    targetProfile: targetConfigDir,
    filesCopied: 0
  };

  // Get source and target paths (declared outside try block for error cleanup)
  const sourceFile = getSessionFilePath(sourceConfigDir, cwd, sessionId);
  const targetFile = getSessionFilePath(targetConfigDir, cwd, sessionId);
  const sourceDir = getSessionDirPath(sourceConfigDir, cwd, sessionId);
  const targetDir = getSessionDirPath(targetConfigDir, cwd, sessionId);

  try {
    // Ensure target directory exists (do this first, before any file operations)
    const targetParentDir = dirname(targetFile);
    await mkdir(targetParentDir, { recursive: true });
    console.warn('[SessionUtils] Ensured target directory exists:', targetParentDir);

    // Attempt to copy the session .jsonl file
    // This will throw if source doesn't exist or target cannot be written
    // Note: copyFile silently overwrites by default (no COPYFILE_EXCL flag)
    try {
      await copyFile(sourceFile, targetFile);
      result.filesCopied++;
      console.warn('[SessionUtils] Copied session file:', sourceFile, '->', targetFile);
    } catch (copyError) {
      // Check common error cases for better error messages
      if (isNodeError(copyError)) {
        if (copyError.code === 'ENOENT') {
          result.error = `Source session file not found: ${sourceFile}`;
        } else {
          result.error = `Failed to copy session file: ${copyError.message}`;
        }
      } else if (copyError instanceof Error) {
        result.error = `Failed to copy session file: ${copyError.message}`;
      } else {
        result.error = 'Unknown error copying session file';
      }
      console.warn('[SessionUtils] Migration failed:', result.error);
      return result;
    }

    // Attempt to copy the session directory (tool-results) if it exists
    // Use try-catch instead of existsSync to avoid TOCTOU race
    try {
      await cp(sourceDir, targetDir, { recursive: true });
      result.filesCopied++;
      console.warn('[SessionUtils] Copied session directory:', sourceDir, '->', targetDir);
    } catch (dirCopyError) {
      // If source directory doesn't exist, that's fine - not all sessions have tool-results
      if (isNodeError(dirCopyError) && dirCopyError.code === 'ENOENT') {
        console.warn('[SessionUtils] No session directory to copy (this is normal):', sourceDir);
      } else {
        // Other errors are real problems, but we already copied the main file
        // Log the error but continue (partial success)
        console.warn('[SessionUtils] Warning: Failed to copy session directory:',
          dirCopyError instanceof Error ? dirCopyError.message : 'Unknown error');
      }
    }

    result.success = true;
    console.warn('[SessionUtils] Session migration successful:', {
      sessionId,
      filesCopied: result.filesCopied
    });

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error during migration';
    console.error('[SessionUtils] Migration error:', result.error);

    // Clean up partially migrated session file to enable retry
    // Use try-catch instead of existsSync to avoid TOCTOU race
    try {
      await unlink(targetFile);
      console.warn('[SessionUtils] Cleaned up partial migration file:', targetFile);
    } catch (cleanupError) {
      // If file doesn't exist during cleanup, that's fine
      if (!(isNodeError(cleanupError) && cleanupError.code === 'ENOENT')) {
        console.error('[SessionUtils] Failed to cleanup partial migration:',
          cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error');
      }
    }

    return result;
  }
}

/**
 * Check if a session exists in a profile's config directory.
 *
 * @param configDir - The profile's CLAUDE_CONFIG_DIR path
 * @param cwd - The working directory where the session was created
 * @param sessionId - The session UUID to check
 * @returns true if the session file exists
 */
export function sessionExists(configDir: string, cwd: string, sessionId: string): boolean {
  const sessionFile = getSessionFilePath(configDir, cwd, sessionId);
  return existsSync(sessionFile);
}
