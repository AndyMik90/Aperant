/**
 * Vault utility functions
 *
 * Provides path validation, context reading, and security checks
 * for external vault directories.
 */

import { readFile, readdir, stat, realpath, access } from 'fs/promises';
import path from 'path';
import type { VaultConfig, VaultFile, VaultLearning } from './types';

/** Maximum characters to read from CLAUDE.md */
const MAX_CLAUDE_MD_CHARS = 10000;

/** Maximum number of learning files to load */
const MAX_LEARNING_FILES = 5;

/** Maximum characters per learning file */
const MAX_LEARNING_CHARS = 2000;

/** Maximum allowed path length */
const MAX_PATH_LENGTH = 1024;

/** Maximum file size for reads (50KB) */
export const MAX_FILE_SIZE = 50000;

/**
 * Sensitive system directories that must never be used as vault paths.
 * Checked against the resolved real path to prevent symlink bypasses.
 */
const SENSITIVE_DIRECTORIES: readonly string[] = [
  '/etc',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/tmp',
  '/private/etc',
  '/private/var',
  // Windows
  '/Windows',
  '/Program Files',
  '/Program Files (x86)',
];

/**
 * Extract vault config from app settings object.
 * Returns null if vault is not configured or disabled.
 */
export function getVaultConfig(settings: Record<string, unknown>): VaultConfig | null {
  const vault = settings.vault as Record<string, unknown> | undefined;
  if (!vault) return null;

  const vaultPath = typeof vault.path === 'string' ? vault.path : '';
  const enabled = typeof vault.enabled === 'boolean' ? vault.enabled : false;

  if (!enabled || !vaultPath) return null;

  return {
    path: vaultPath,
    enabled,
    syncLearnings: typeof vault.syncLearnings === 'boolean' ? vault.syncLearnings : false,
    autoLoad: typeof vault.autoLoad === 'boolean' ? vault.autoLoad : true,
    writeEnabled: typeof vault.writeEnabled === 'boolean' ? vault.writeEnabled : false,
  };
}

/**
 * Validate that a path is safe to use as a vault directory.
 *
 * Checks:
 * - Path is absolute
 * - Path length is within limits
 * - Directory exists and is accessible
 * - Not a sensitive system directory
 * - Symlinks do not escape to sensitive directories
 */
export async function isValidVaultPath(vaultPath: string): Promise<{ valid: boolean; error?: string }> {
  // Check path length
  if (!vaultPath || vaultPath.length > MAX_PATH_LENGTH) {
    return { valid: false, error: 'Vault path is empty or exceeds maximum length' };
  }

  // Must be absolute
  if (!path.isAbsolute(vaultPath)) {
    return { valid: false, error: 'Vault path must be an absolute path' };
  }

  // Check existence and type
  try {
    await access(vaultPath);
  } catch {
    return { valid: false, error: 'Vault path does not exist or is not accessible' };
  }

  let stats;
  try {
    stats = await stat(vaultPath);
  } catch {
    return { valid: false, error: 'Unable to read vault path info' };
  }

  if (!stats.isDirectory()) {
    return { valid: false, error: 'Vault path must be a directory' };
  }

  // Resolve the real path to detect symlink escapes
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(vaultPath);
  } catch {
    return { valid: false, error: 'Unable to resolve vault path' };
  }

  // Check against sensitive directories
  const normalizedResolved = path.normalize(resolvedPath);
  for (const sensitiveDir of SENSITIVE_DIRECTORIES) {
    const normalizedSensitive = path.normalize(sensitiveDir);
    if (
      normalizedResolved === normalizedSensitive ||
      normalizedResolved.startsWith(normalizedSensitive + path.sep)
    ) {
      return { valid: false, error: `Vault path must not be within system directory: ${sensitiveDir}` };
    }
  }

  return { valid: true };
}

/**
 * Validate that a resolved file path is within the vault directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 */
export async function isPathWithinVault(filePath: string, vaultPath: string): Promise<boolean> {
  try {
    const resolvedVault = await realpath(vaultPath);
    const resolvedFile = path.resolve(resolvedVault, filePath);

    // The resolved file path must start with the vault path
    // Add path.sep to prevent matching vault-name-prefix directories
    return resolvedFile === resolvedVault || resolvedFile.startsWith(resolvedVault + path.sep);
  } catch {
    return false;
  }
}

/**
 * Resolve and validate a file path within the vault.
 * Returns the absolute resolved path or null if invalid.
 */
export async function resolveVaultFilePath(
  relativePath: string,
  vaultPath: string
): Promise<string | null> {
  try {
    const resolvedVault = await realpath(vaultPath);
    const resolvedFile = path.resolve(resolvedVault, relativePath);

    // Ensure the resolved path is within the vault
    if (resolvedFile !== resolvedVault && !resolvedFile.startsWith(resolvedVault + path.sep)) {
      return null;
    }

    return resolvedFile;
  } catch {
    return null;
  }
}

/**
 * Read CLAUDE.md from vault root for context injection.
 * Returns null if the file does not exist or is too large.
 */
export async function readVaultClaudeMd(vaultPath: string): Promise<string | null> {
  try {
    const claudeMdPath = path.join(vaultPath, 'CLAUDE.md');

    // Validate the path is within vault
    const resolvedVault = await realpath(vaultPath);
    const resolvedClaudeMd = await realpath(claudeMdPath).catch(() => path.resolve(resolvedVault, 'CLAUDE.md'));
    if (!resolvedClaudeMd.startsWith(resolvedVault + path.sep) && resolvedClaudeMd !== resolvedVault) {
      return null;
    }

    const fileStat = await stat(claudeMdPath);
    if (fileStat.size > MAX_FILE_SIZE) {
      return null;
    }

    const content = await readFile(claudeMdPath, 'utf-8');
    return content.length > MAX_CLAUDE_MD_CHARS ? content.substring(0, MAX_CLAUDE_MD_CHARS) : content;
  } catch {
    return null;
  }
}

/**
 * List learning files from vault/memory/learnings/ directory.
 * Returns up to MAX_LEARNING_FILES files, each truncated to MAX_LEARNING_CHARS.
 */
export async function listVaultLearnings(vaultPath: string): Promise<VaultLearning[]> {
  const learnings: VaultLearning[] = [];

  try {
    const learningsDir = path.join(vaultPath, 'memory', 'learnings');

    // Validate the path is within vault
    const resolvedVault = await realpath(vaultPath);
    const resolvedLearnings = await realpath(learningsDir).catch(() =>
      path.resolve(resolvedVault, 'memory', 'learnings')
    );
    if (!resolvedLearnings.startsWith(resolvedVault + path.sep)) {
      return [];
    }

    let entries;
    try {
      entries = await readdir(learningsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    // Filter to markdown files only
    const mdFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .slice(0, MAX_LEARNING_FILES);

    for (const entry of mdFiles) {
      try {
        const filePath = path.join(learningsDir, entry.name);

        // Validate path is within vault
        const resolvedFile = path.resolve(filePath);
        if (!resolvedFile.startsWith(resolvedVault + path.sep)) {
          continue;
        }

        const fileStat = await stat(filePath);
        if (fileStat.size > MAX_FILE_SIZE) {
          continue;
        }

        const content = await readFile(filePath, 'utf-8');
        const truncated = content.length > MAX_LEARNING_CHARS
          ? content.substring(0, MAX_LEARNING_CHARS)
          : content;

        learnings.push({
          name: entry.name,
          path: path.join('memory', 'learnings', entry.name),
          content: truncated,
        });
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // Return empty if the directory structure doesn't exist
  }

  return learnings;
}

/**
 * List files and directories within a vault subdirectory.
 */
export async function listVaultFiles(
  vaultPath: string,
  subdirectory?: string
): Promise<VaultFile[]> {
  const resolvedVault = await realpath(vaultPath);
  const targetDir = subdirectory
    ? path.resolve(resolvedVault, subdirectory)
    : resolvedVault;

  // Validate target is within vault
  if (targetDir !== resolvedVault && !targetDir.startsWith(resolvedVault + path.sep)) {
    throw new Error('Subdirectory path is outside vault');
  }

  const entries = await readdir(targetDir, { withFileTypes: true });
  const files: VaultFile[] = [];

  for (const entry of entries) {
    // Skip hidden files/directories (e.g., .git, .obsidian)
    if (entry.name.startsWith('.')) {
      continue;
    }

    try {
      const fullPath = path.join(targetDir, entry.name);

      // Validate each entry path is within vault
      const resolvedEntry = path.resolve(fullPath);
      if (!resolvedEntry.startsWith(resolvedVault + path.sep)) {
        continue;
      }

      const entryStat = await stat(fullPath);
      const relativePath = path.relative(resolvedVault, fullPath);

      files.push({
        name: entry.name,
        path: relativePath,
        size: entryStat.size,
        modified: entryStat.mtime.toISOString(),
        isDirectory: entryStat.isDirectory(),
      });
    } catch {
      // Skip entries that can't be stat'd
    }
  }

  // Sort: directories first, then by name
  files.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return files;
}
