/**
 * Windows Executable Path Discovery Utility
 *
 * Provides reusable logic for finding Windows executables in common installation
 * locations. Handles environment variable expansion and security validation.
 *
 * Used by cli-tool-manager.ts for Git, GitHub CLI, Claude CLI, etc.
 * Follows the same pattern as homebrew-python.ts for platform-specific detection.
 */

import { existsSync } from 'fs';
import { access, constants } from 'fs/promises';
import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

export interface WindowsToolPaths {
  toolName: string;
  executable: string;
  patterns: string[];
}

export const WINDOWS_GIT_PATHS: WindowsToolPaths = {
  toolName: 'Git',
  executable: 'git.exe',
  patterns: [
    '%PROGRAMFILES%\\Git\\cmd',
    '%PROGRAMFILES(X86)%\\Git\\cmd',
    '%LOCALAPPDATA%\\Programs\\Git\\cmd',
    '%USERPROFILE%\\scoop\\apps\\git\\current\\cmd',
    '%PROGRAMFILES%\\Git\\bin',
    '%PROGRAMFILES(X86)%\\Git\\bin',
    '%PROGRAMFILES%\\Git\\mingw64\\bin',
  ],
};

export const WINDOWS_GLAB_PATHS: WindowsToolPaths = {
  toolName: 'GitLab CLI',
  executable: 'glab.exe',
  patterns: [
    // Official Inno Setup installer path (DefaultDirName={autopf}\glab)
    '%PROGRAMFILES%\\glab',
    '%PROGRAMFILES(X86)%\\glab',
    '%LOCALAPPDATA%\\Programs\\glab',
  ],
};

export function isSecurePath(pathStr: string): boolean {
  const dangerousPatterns = [
    /[;&|`${}[\]<>!"^]/,  // Shell metacharacters (parentheses removed - safe when quoted)
    /%[^%]+%/,              // Windows environment variable expansion (e.g., %PATH%)
    /\.\.\//,               // Unix directory traversal
    /\.\.\\/,               // Windows directory traversal
    /[\r\n]/,               // Newlines (command injection)
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(pathStr)) {
      return false;
    }
  }

  return true;
}

export function expandWindowsPath(pathPattern: string): string | null {
  const envVars: Record<string, string | undefined> = {
    '%PROGRAMFILES%': process.env.ProgramFiles || 'C:\\Program Files',
    '%PROGRAMFILES(X86)%': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    '%LOCALAPPDATA%': process.env.LOCALAPPDATA,
    '%APPDATA%': process.env.APPDATA,
    '%USERPROFILE%': process.env.USERPROFILE || os.homedir(),
  };

  let expandedPath = pathPattern;

  for (const [placeholder, value] of Object.entries(envVars)) {
    if (expandedPath.includes(placeholder)) {
      if (!value) {
        return null;
      }
      expandedPath = expandedPath.replace(placeholder, value);
    }
  }

  // Verify no unexpanded placeholders remain (indicates unknown variable)
  if (/%[^%]+%/.test(expandedPath)) {
    return null;
  }

  // Normalize the path (resolve double backslashes, etc.)
  return path.normalize(expandedPath);
}

export function getWindowsExecutablePaths(
  toolPaths: WindowsToolPaths,
  logPrefix: string = '[Windows Paths]'
): string[] {
  // Only run on Windows
  if (process.platform !== 'win32') {
    return [];
  }

  const validPaths: string[] = [];

  for (const pattern of toolPaths.patterns) {
    const expandedDir = expandWindowsPath(pattern);

    if (!expandedDir) {
      console.warn(`${logPrefix} Could not expand path pattern: ${pattern}`);
      continue;
    }

    const fullPath = path.join(expandedDir, toolPaths.executable);

    // Security validation - reject potentially dangerous paths
    if (!isSecurePath(fullPath)) {
      console.warn(`${logPrefix} Path failed security validation: ${fullPath}`);
      continue;
    }

    if (existsSync(fullPath)) {
      validPaths.push(fullPath);
    }
  }

  return validPaths;
}

/**
 * Get the Windows system root directory (e.g., C:\Windows).
 * Checks both casing variants of the environment variable with a safe fallback.
 */
export function getSystemRoot(): string {
  return process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
}

/**
 * Get the full path to where.exe.
 * Using the full path ensures where.exe works even when System32 isn't in PATH,
 * which can happen in restricted environments or when Electron doesn't inherit
 * the full system PATH.
 *
 * @returns Full path to where.exe (e.g., C:\Windows\System32\where.exe)
 */
export function getWhereExePath(): string {
  return path.join(getSystemRoot(), 'System32', 'where.exe');
}

/**
 * Get the full path to taskkill.exe.
 * Using the full path ensures taskkill.exe works even when System32 isn't in PATH,
 * which can happen in restricted environments or when Electron doesn't inherit
 * the full system PATH.
 *
 * @returns Full path to taskkill.exe (e.g., C:\Windows\System32\taskkill.exe)
 */
export function getTaskkillExePath(): string {
  return path.join(getSystemRoot(), 'System32', 'taskkill.exe');
}

/**
 * Find a Windows executable using the `where` command.
 * This is the most reliable method as it searches:
 * - All directories in PATH
 * - App Paths registry entries
 * - Current directory
 *
 * Works regardless of where the tool is installed (custom paths, different drives, etc.)
 *
 * @param executable - The executable name (e.g., 'git', 'gh', 'python')
 * @param logPrefix - Prefix for console logging
 * @returns The full path to the executable, or null if not found
 */
export function findWindowsExecutableViaWhere(
  executable: string,
  logPrefix: string = '[Windows Where]'
): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  // Security: Only allow simple executable names (alphanumeric, dash, underscore, dot)
  if (!/^[\w.-]+$/.test(executable)) {
    console.warn(`${logPrefix} Invalid executable name: ${executable}`);
    return null;
  }

  try {
    // Use full path to where.exe to ensure it works even when System32 isn't in PATH
    // This fixes issues in restricted environments or when Electron doesn't inherit system PATH
    const whereExe = getWhereExePath();
    const result = execFileSync(whereExe, [executable], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    }).trim();

    // 'where' returns multiple paths separated by newlines if found in multiple locations
    // Prefer paths with .cmd or .exe extensions (executable files)
    const paths = result.split(/\r?\n/).filter(p => p.trim());

    if (paths.length > 0) {
      // Prefer .cmd, .bat, or .exe extensions, otherwise take first path
      const foundPath = (paths.find(p => /\.(cmd|bat|exe)$/i.test(p)) || paths[0]).trim();

      // Validate the path exists and is secure
      if (existsSync(foundPath) && isSecurePath(foundPath)) {
        console.log(`${logPrefix} Found via where: ${foundPath}`);
        return foundPath;
      }
    }

    return null;
  } catch {
    // 'where' returns exit code 1 if not found, which throws an error
    return null;
  }
}

/**
 * Async version of getWindowsExecutablePaths.
 * Use this in async contexts to avoid blocking the main process.
 */
export async function getWindowsExecutablePathsAsync(
  toolPaths: WindowsToolPaths,
  logPrefix: string = '[Windows Paths]'
): Promise<string[]> {
  // Only run on Windows
  if (process.platform !== 'win32') {
    return [];
  }

  const validPaths: string[] = [];

  for (const pattern of toolPaths.patterns) {
    const expandedDir = expandWindowsPath(pattern);

    if (!expandedDir) {
      console.warn(`${logPrefix} Could not expand path pattern: ${pattern}`);
      continue;
    }

    const fullPath = path.join(expandedDir, toolPaths.executable);

    // Security validation - reject potentially dangerous paths
    if (!isSecurePath(fullPath)) {
      console.warn(`${logPrefix} Path failed security validation: ${fullPath}`);
      continue;
    }

    try {
      await access(fullPath, constants.F_OK);
      validPaths.push(fullPath);
    } catch {
      // File doesn't exist, skip
    }
  }

  return validPaths;
}

/**
 * Async version of findWindowsExecutableViaWhere.
 * Use this in async contexts to avoid blocking the main process.
 *
 * Find a Windows executable using the `where` command.
 * This is the most reliable method as it searches:
 * - All directories in PATH
 * - App Paths registry entries
 * - Current directory
 *
 * Works regardless of where the tool is installed (custom paths, different drives, etc.)
 *
 * @param executable - The executable name (e.g., 'git', 'gh', 'python')
 * @param logPrefix - Prefix for console logging
 * @returns The full path to the executable, or null if not found
 */
export async function findWindowsExecutableViaWhereAsync(
  executable: string,
  logPrefix: string = '[Windows Where]'
): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null;
  }

  // Security: Only allow simple executable names (alphanumeric, dash, underscore, dot)
  if (!/^[\w.-]+$/.test(executable)) {
    console.warn(`${logPrefix} Invalid executable name: ${executable}`);
    return null;
  }

  try {
    // Use full path to where.exe to ensure it works even when System32 isn't in PATH
    // This fixes issues in restricted environments or when Electron doesn't inherit system PATH
    const whereExe = getWhereExePath();
    const { stdout } = await execFileAsync(whereExe, [executable], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });

    // 'where' returns multiple paths separated by newlines if found in multiple locations
    // Prefer paths with .cmd, .bat, or .exe extensions (executable files)
    const paths = stdout.trim().split(/\r?\n/).filter(p => p.trim());

    if (paths.length > 0) {
      // Prefer .cmd, .bat, or .exe extensions, otherwise take first path
      const foundPath = (paths.find(p => /\.(cmd|bat|exe)$/i.test(p)) || paths[0]).trim();

      // Validate the path exists and is secure
      try {
        await access(foundPath, constants.F_OK);
        if (isSecurePath(foundPath)) {
          console.log(`${logPrefix} Found via where: ${foundPath}`);
          return foundPath;
        }
      } catch {
        // Path doesn't exist
      }
    }

    return null;
  } catch {
    // 'where' returns exit code 1 if not found, which throws an error
    return null;
  }
}
