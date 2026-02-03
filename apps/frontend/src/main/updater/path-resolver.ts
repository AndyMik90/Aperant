/**
 * Path resolution utilities for Auto Claude updater
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { app } from 'electron';
import { joinPaths, normalizePath } from '../platform';

/**
 * Get the path to the bundled backend source
 */
export function getBundledSourcePath(): string {
  // In production, use app resources
  // In development, use the repo's apps/backend folder
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend');
  }

  // Development mode - prioritize worktree detection
  // Check if we're running from a worktree (app.getAppPath() will be within worktree)
  const appPath = app.getAppPath();
  // Normalize path to use forward slashes for consistent regex matching across platforms
  const normalizedAppPath = normalizePath(appPath);
  const worktreeMatch = normalizedAppPath.match(/(.+\/\.auto-claude\/worktrees\/tasks\/[^/]+)/);
  if (worktreeMatch) {
    const worktreeBackend = joinPaths(worktreeMatch[1], 'apps', 'backend');
    const worktreeMarker = joinPaths(worktreeBackend, 'runners', 'spec_runner.py');
    if (existsSync(worktreeMarker)) {
      console.log('[path-resolver] Using worktree backend:', worktreeBackend);
      return worktreeBackend;
    }
  }

  // Development mode - look for backend in various locations
  const possiblePaths = [
    // New structure: apps/frontend -> apps/backend
    joinPaths(appPath, '..', 'backend'),
    joinPaths(appPath, '..', '..', 'apps', 'backend'),
    joinPaths(process.cwd(), 'apps', 'backend'),
    joinPaths(process.cwd(), '..', 'backend')
  ];

  for (const p of possiblePaths) {
    // Validate it's a proper backend source (must have runners/spec_runner.py)
    const markerPath = joinPaths(p, 'runners', 'spec_runner.py');
    if (existsSync(p) && existsSync(markerPath)) {
      return p;
    }
  }

  // Fallback - warn if this path is also invalid
  const fallback = joinPaths(app.getAppPath(), '..', 'backend');
  const fallbackMarker = joinPaths(fallback, 'runners', 'spec_runner.py');
  if (!existsSync(fallbackMarker)) {
    console.warn(
      `[path-resolver] No valid backend source found in development paths, fallback "${fallback}" may be invalid`
    );
  }
  return fallback;
}

/**
 * Get the path for storing downloaded updates
 */
export function getUpdateCachePath(): string {
  return joinPaths(app.getPath('userData'), 'auto-claude-updates');
}

/**
 * Get the effective source path (considers override from updates and settings)
 */
export function getEffectiveSourcePath(): string {
  // In development mode, always use auto-detection to support worktrees
  // In production (packaged app), check user settings for configured autoBuildPath
  if (app.isPackaged) {
    try {
      const settingsPath = joinPaths(app.getPath('userData'), 'settings.json');
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        if (settings.autoBuildPath && existsSync(settings.autoBuildPath)) {
          // Validate it's a proper backend source (must have runners/spec_runner.py)
          const markerPath = joinPaths(settings.autoBuildPath, 'runners', 'spec_runner.py');
          if (existsSync(markerPath)) {
            return settings.autoBuildPath;
          }
          // Invalid path - log warning and fall through to auto-detection
          console.warn(
            `[path-resolver] Configured autoBuildPath "${settings.autoBuildPath}" is missing runners/spec_runner.py, falling back to bundled source`
          );
        }
      }
    } catch {
      // Ignore settings read errors
    }
  } else {
    console.log('[path-resolver] Dev mode: skipping stored autoBuildPath to support worktrees');
  }

  if (app.isPackaged) {
    // Check for user-updated source first
    const overridePath = joinPaths(app.getPath('userData'), 'backend-source');
    const overrideMarker = joinPaths(overridePath, 'runners', 'spec_runner.py');
    if (existsSync(overridePath) && existsSync(overrideMarker)) {
      return overridePath;
    }
  }

  return getBundledSourcePath();
}

/**
 * Get the path where updates should be installed
 */
export function getUpdateTargetPath(): string {
  if (app.isPackaged) {
    // For packaged apps, store in userData as a source override
    return joinPaths(app.getPath('userData'), 'backend-source');
  } else {
    // In development, update the actual source
    return getBundledSourcePath();
  }
}
