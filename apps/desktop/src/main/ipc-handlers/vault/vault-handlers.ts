/**
 * Vault IPC Handlers
 *
 * Handles all vault-related IPC communication between the renderer
 * and main process. Provides read/write access to external vault
 * directories for context injection and learning persistence.
 */

import { ipcMain } from 'electron';
import { readFile, writeFile, mkdir, stat, readdir, realpath } from 'fs/promises';
import path from 'path';
import type { IPCResult } from '../../../shared/types';
import type { VaultConfig, VaultFile, VaultSearchResult, VaultContext } from './types';
import {
  isValidVaultPath,
  resolveVaultFilePath,
  readVaultClaudeMd,
  listVaultLearnings,
  listVaultFiles,
  MAX_FILE_SIZE,
} from './utils';

// IPC channel names for vault operations
const VAULT_CHANNELS = {
  VALIDATE_PATH: 'vault:validatePath',
  LIST_FILES: 'vault:listFiles',
  READ_FILE: 'vault:readFile',
  SEARCH: 'vault:search',
  GET_CONTEXT: 'vault:getContext',
  SAVE_LEARNING: 'vault:saveLearning',
} as const;

/**
 * Validate vault config has required fields and path is valid.
 * Used as a guard at the start of each handler.
 */
async function validateVaultConfig(
  config: VaultConfig | null
): Promise<{ valid: true } | { valid: false; error: string }> {
  if (!config) {
    return { valid: false, error: 'Vault is not configured' };
  }
  if (!config.enabled) {
    return { valid: false, error: 'Vault integration is disabled' };
  }
  const pathCheck = await isValidVaultPath(config.path);
  if (!pathCheck.valid) {
    return { valid: false, error: pathCheck.error ?? 'Invalid vault path' };
  }
  return { valid: true };
}

/**
 * Register all vault IPC handlers
 */
export function registerVaultIpcHandlers(): void {
  // -------------------------------------------------------
  // VAULT_VALIDATE_PATH - Validate a vault directory path
  // -------------------------------------------------------
  ipcMain.handle(
    VAULT_CHANNELS.VALIDATE_PATH,
    async (_event, vaultPath: string): Promise<IPCResult<{ valid: boolean }>> => {
      try {
        if (typeof vaultPath !== 'string') {
          return { success: false, error: 'Vault path must be a string' };
        }

        const result = await isValidVaultPath(vaultPath);
        if (!result.valid) {
          return { success: true, data: { valid: false, error: result.error } as { valid: boolean } };
        }

        return { success: true, data: { valid: true } };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error validating vault path';
        console.warn('[Vault] Error validating path:', message);
        return { success: false, error: message };
      }
    }
  );

  // -------------------------------------------------------
  // VAULT_LIST_FILES - List files in vault directory
  // -------------------------------------------------------
  ipcMain.handle(
    VAULT_CHANNELS.LIST_FILES,
    async (
      _event,
      config: VaultConfig,
      subdirectory?: string
    ): Promise<IPCResult<VaultFile[]>> => {
      try {
        const validation = await validateVaultConfig(config);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        // Validate subdirectory if provided
        if (subdirectory !== undefined && typeof subdirectory !== 'string') {
          return { success: false, error: 'Subdirectory must be a string' };
        }

        const files = await listVaultFiles(config.path, subdirectory);
        return { success: true, data: files };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error listing vault files';
        console.warn('[Vault] Error listing files:', message);
        return { success: false, error: message };
      }
    }
  );

  // -------------------------------------------------------
  // VAULT_READ_FILE - Read a file from the vault
  // -------------------------------------------------------
  ipcMain.handle(
    VAULT_CHANNELS.READ_FILE,
    async (
      _event,
      config: VaultConfig,
      relativePath: string
    ): Promise<IPCResult<string>> => {
      try {
        const validation = await validateVaultConfig(config);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        if (typeof relativePath !== 'string' || !relativePath) {
          return { success: false, error: 'File path must be a non-empty string' };
        }

        // Resolve and validate the path is within vault
        const resolvedPath = await resolveVaultFilePath(relativePath, config.path);
        if (!resolvedPath) {
          return { success: false, error: 'File path is outside vault directory' };
        }

        // Check file exists and size
        const fileStat = await stat(resolvedPath);
        if (fileStat.isDirectory()) {
          return { success: false, error: 'Path is a directory, not a file' };
        }
        if (fileStat.size > MAX_FILE_SIZE) {
          return {
            success: false,
            error: `File exceeds maximum size limit (${MAX_FILE_SIZE} bytes)`,
          };
        }

        const content = await readFile(resolvedPath, 'utf-8');
        // Truncate to 50000 chars as defense-in-depth
        const truncated = content.length > MAX_FILE_SIZE ? content.substring(0, MAX_FILE_SIZE) : content;
        return { success: true, data: truncated };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error reading vault file';
        console.warn('[Vault] Error reading file:', message);
        return { success: false, error: message };
      }
    }
  );

  // -------------------------------------------------------
  // VAULT_SEARCH - Search vault files by name/content
  // -------------------------------------------------------
  ipcMain.handle(
    VAULT_CHANNELS.SEARCH,
    async (
      _event,
      config: VaultConfig,
      query: string
    ): Promise<IPCResult<VaultSearchResult>> => {
      try {
        const validation = await validateVaultConfig(config);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        if (typeof query !== 'string' || !query.trim()) {
          return { success: false, error: 'Search query must be a non-empty string' };
        }

        const normalizedQuery = query.trim().toLowerCase();
        const matchingFiles: VaultFile[] = [];

        // Recursively search files in vault
        await searchDirectory(config.path, config.path, normalizedQuery, matchingFiles);

        return {
          success: true,
          data: {
            files: matchingFiles,
            total: matchingFiles.length,
            query,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error searching vault';
        console.warn('[Vault] Error searching:', message);
        return { success: false, error: message };
      }
    }
  );

  // -------------------------------------------------------
  // VAULT_GET_CONTEXT - Get vault context for agent injection
  // -------------------------------------------------------
  ipcMain.handle(
    VAULT_CHANNELS.GET_CONTEXT,
    async (_event, config: VaultConfig): Promise<IPCResult<VaultContext>> => {
      try {
        const validation = await validateVaultConfig(config);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        const [claudeMd, learnings] = await Promise.all([
          readVaultClaudeMd(config.path),
          listVaultLearnings(config.path),
        ]);

        return {
          success: true,
          data: { claudeMd, learnings },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error getting vault context';
        console.warn('[Vault] Error getting context:', message);
        return { success: false, error: message };
      }
    }
  );

  // -------------------------------------------------------
  // VAULT_SAVE_LEARNING - Save a learning to the vault
  // -------------------------------------------------------
  ipcMain.handle(
    VAULT_CHANNELS.SAVE_LEARNING,
    async (
      _event,
      config: VaultConfig,
      fileName: string,
      content: string
    ): Promise<IPCResult<{ path: string }>> => {
      try {
        const validation = await validateVaultConfig(config);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        if (!config.writeEnabled) {
          return { success: false, error: 'Write operations are not enabled for this vault' };
        }

        if (typeof fileName !== 'string' || !fileName.trim()) {
          return { success: false, error: 'File name must be a non-empty string' };
        }

        if (typeof content !== 'string') {
          return { success: false, error: 'Content must be a string' };
        }

        // Sanitize filename: only allow alphanumeric, hyphens, underscores, dots
        const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
        if (!sanitizedName) {
          return { success: false, error: 'Invalid file name after sanitization' };
        }

        // Ensure .md extension
        const finalName = sanitizedName.endsWith('.md') ? sanitizedName : `${sanitizedName}.md`;

        // Build target path within vault/memory/learnings/
        const learningsDir = path.join(config.path, 'memory', 'learnings');

        // Validate the target directory is within vault
        const resolvedVault = await realpath(config.path);
        const resolvedLearningsDir = path.resolve(resolvedVault, 'memory', 'learnings');
        if (!resolvedLearningsDir.startsWith(resolvedVault + path.sep)) {
          return { success: false, error: 'Learnings directory path is invalid' };
        }

        // Create directory if it doesn't exist
        await mkdir(resolvedLearningsDir, { recursive: true });

        const targetPath = path.join(resolvedLearningsDir, finalName);

        // Final path validation
        if (!targetPath.startsWith(resolvedLearningsDir + path.sep)) {
          return { success: false, error: 'Target file path is outside learnings directory' };
        }

        // Truncate content to prevent excessively large files
        const maxWriteSize = MAX_FILE_SIZE;
        const truncatedContent = content.length > maxWriteSize
          ? content.substring(0, maxWriteSize)
          : content;

        await writeFile(targetPath, truncatedContent, 'utf-8');

        const relativePath = path.relative(resolvedVault, targetPath);
        console.warn(`[Vault] Learning saved: ${relativePath}`);

        return { success: true, data: { path: relativePath } };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error saving learning';
        console.warn('[Vault] Error saving learning:', message);
        return { success: false, error: message };
      }
    }
  );
}

// -------------------------------------------------------
// Helper: Recursive directory search
// -------------------------------------------------------

/** Maximum search depth to prevent runaway recursion */
const MAX_SEARCH_DEPTH = 5;

/** Maximum number of search results */
const MAX_SEARCH_RESULTS = 50;

/**
 * Recursively search a directory for files matching the query.
 * Matches against file names and, for markdown files, file content.
 */
async function searchDirectory(
  vaultRoot: string,
  currentDir: string,
  query: string,
  results: VaultFile[],
  depth: number = 0
): Promise<void> {
  if (depth > MAX_SEARCH_DEPTH || results.length >= MAX_SEARCH_RESULTS) {
    return;
  }

  const resolvedVault = await realpath(vaultRoot);

  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= MAX_SEARCH_RESULTS) {
      break;
    }

    // Skip hidden files/directories
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);

    // Validate path is within vault
    const resolvedEntry = path.resolve(fullPath);
    if (!resolvedEntry.startsWith(resolvedVault + path.sep)) {
      continue;
    }

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      await searchDirectory(vaultRoot, fullPath, query, results, depth + 1);
    } else if (entry.isFile()) {
      let matched = false;

      // Match against file name
      if (entry.name.toLowerCase().includes(query)) {
        matched = true;
      }

      // For markdown files, also check content
      if (!matched && entry.name.endsWith('.md')) {
        try {
          const entryStat = await stat(fullPath);
          if (entryStat.size <= MAX_FILE_SIZE) {
            const fileContent = await readFile(fullPath, 'utf-8');
            if (fileContent.toLowerCase().includes(query)) {
              matched = true;
            }
          }
        } catch {
          // Skip files that can't be read
        }
      }

      if (matched) {
        try {
          const entryStat = await stat(fullPath);
          const relativePath = path.relative(resolvedVault, fullPath);
          results.push({
            name: entry.name,
            path: relativePath,
            size: entryStat.size,
            modified: entryStat.mtime.toISOString(),
            isDirectory: false,
          });
        } catch {
          // Skip entries that can't be stat'd
        }
      }
    }
  }
}
