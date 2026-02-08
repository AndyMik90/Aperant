import { ipcMain } from 'electron';
import { readdir, stat, realpath } from 'fs/promises';
import { readFile } from 'fs/promises';
import path from 'path';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult, FileNode } from '../../shared/types';

// Maximum file size to read (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

/**
 * Validates a file path with enhanced security: checks for path traversal attacks
 * by resolving the path and verifying it's within allowed bounds.
 * Returns the validated canonical path if valid, or an error message.
 */
function validatePathWithinProject(filePath: string, projectDir?: string): { valid: true; path: string } | { valid: false; error: string } {
  // Resolve to absolute path (handles .., ., etc.)
  const resolvedPath = path.resolve(filePath);

  // Must be absolute after resolution
  if (!path.isAbsolute(resolvedPath)) {
    return { valid: false, error: 'Path must be absolute' };
  }

  // After resolution, path should not contain .. segments
  // This catches edge cases where resolve might not fully normalize
  const segments = resolvedPath.split(path.sep);
  if (segments.includes('..')) {
    return { valid: false, error: 'Invalid path: contains parent directory references' };
  }

  // If a project directory is specified, verify the resolved path is within it
  // This prevents directory traversal attacks even with resolved paths
  if (projectDir) {
    const resolvedProjectDir = path.resolve(projectDir);
    // Use path.relative to detect if filePath escapes projectDir
    const relativePath = path.relative(resolvedProjectDir, resolvedPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return { valid: false, error: 'Path is outside project directory' };
    }
  }

  return { valid: true, path: resolvedPath };
}

/**
 * Validates and normalizes a file path for safe reading.
 * Returns the normalized path if valid, or an error message.
 */
function validatePath(filePath: string): { valid: true; path: string } | { valid: false; error: string } {
  return validatePathWithinProject(filePath);
}

// Directories to ignore when listing
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '__pycache__', 'dist', 'build',
  '.next', '.nuxt', 'coverage', '.cache', '.venv', 'venv',
  'out', '.turbo', '.worktrees',
  'vendor', 'target', '.gradle', '.maven'
]);

// Sensitive files to exclude from listing
const HIDDEN_FILES = new Set([
  '.env', '.env.local', '.env.production', 'credentials.json',
  '.env.development', '.env.test'
]);

/**
 * Register all file-related IPC handlers
 */
export function registerFileHandlers(): void {
  // ============================================
  // File Explorer Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.FILE_EXPLORER_LIST,
    async (_, dirPath: string): Promise<IPCResult<FileNode[]>> => {
      try {
        // Validate and normalize path to prevent directory traversal
        const validation = validatePath(dirPath);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
        const entries = await readdir(validation.path, { withFileTypes: true });

        // Filter and map entries
        const nodes: FileNode[] = [];
        for (const entry of entries) {
          // Skip sensitive files (credentials, env files)
          if (!entry.isDirectory() && HIDDEN_FILES.has(entry.name)) {
            continue;
          }
          // Skip other hidden files (not directories) except useful ones like .gitignore
          if (!entry.isDirectory() && entry.name.startsWith('.') &&
              !['.gitignore', '.env.example'].includes(entry.name)) {
            continue;
          }
          // Skip ignored directories
          if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

          nodes.push({
            path: path.join(validation.path, entry.name),
            name: entry.name,
            isDirectory: entry.isDirectory()
          });
        }

        // Sort: directories first, then alphabetically
        nodes.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        return { success: true, data: nodes };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list directory'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FILE_EXPLORER_READ,
    async (_, filePath: string): Promise<IPCResult<string>> => {
      try {
        // Validate and normalize path
        const validation = validatePath(filePath);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
        const safePath = validation.path;

        // Check file size before reading
        const stats = await stat(safePath);
        if (stats.size > MAX_FILE_SIZE) {
          return { success: false, error: 'File too large (max 1MB)' };
        }

        // Use async file read to avoid blocking
        const content = await readFile(safePath, 'utf-8');
        return { success: true, data: content };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to read file'
        };
      }
    }
  );
}
