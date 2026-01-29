/**
 * Configuration Paths Module
 *
 * Provides XDG Base Directory Specification compliant paths for storing
 * application configuration and data. This is essential for AppImage,
 * Flatpak, and Snap installations where the application runs in a
 * sandboxed or immutable filesystem environment.
 *
 * XDG Base Directory Specification:
 * - $XDG_CONFIG_HOME: User configuration (default: ~/.config)
 * - $XDG_DATA_HOME: User data (default: ~/.local/share)
 * - $XDG_CACHE_HOME: User cache (default: ~/.cache)
 *
 * @see https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
 */

import * as path from 'path';
import * as os from 'os';
import { isLinux } from './platform';

const APP_NAME = 'auto-claude';

/**
 * Get the XDG config home directory
 * Uses $XDG_CONFIG_HOME if set, otherwise defaults to ~/.config
 */
export function getXdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

/**
 * Get the XDG data home directory
 * Uses $XDG_DATA_HOME if set, otherwise defaults to ~/.local/share
 */
export function getXdgDataHome(): string {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

/**
 * Get the XDG cache home directory
 * Uses $XDG_CACHE_HOME if set, otherwise defaults to ~/.cache
 */
export function getXdgCacheHome(): string {
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
}

/**
 * Get the application config directory
 * Returns the XDG-compliant path for storing configuration files
 */
export function getAppConfigDir(): string {
  return path.join(getXdgConfigHome(), APP_NAME);
}

/**
 * Get the application data directory
 * Returns the XDG-compliant path for storing application data
 */
export function getAppDataDir(): string {
  return path.join(getXdgDataHome(), APP_NAME);
}

/**
 * Get the application cache directory
 * Returns the XDG-compliant path for storing cache files
 */
export function getAppCacheDir(): string {
  return path.join(getXdgCacheHome(), APP_NAME);
}

/**
 * Get the memories storage directory
 * This is where graph databases are stored (previously ~/.auto-claude/memories)
 */
export function getMemoriesDir(): string {
  // For compatibility, we still support the legacy path
  const legacyPath = path.join(os.homedir(), '.auto-claude', 'memories');

  // On Linux with XDG variables set (AppImage, Flatpak, Snap), use XDG path
  if (isLinux() && (process.env.XDG_DATA_HOME || process.env.APPIMAGE || process.env.SNAP || process.env.FLATPAK_ID)) {
    return path.join(getXdgDataHome(), APP_NAME, 'memories');
  }

  // Default to legacy path for backwards compatibility
  return legacyPath;
}

/**
 * Get the graphs storage directory (alias for memories)
 */
export function getGraphsDir(): string {
  return getMemoriesDir();
}

/**
 * Check if running in an immutable filesystem environment
 * (AppImage, Flatpak, Snap, etc.)
 */
export function isImmutableEnvironment(): boolean {
  return !!(
    process.env.APPIMAGE ||
    process.env.SNAP ||
    process.env.FLATPAK_ID
  );
}

/**
 * Get environment-appropriate path for a given type
 * Handles the differences between regular installs and sandboxed environments
 *
 * @param type - The type of path needed: 'config', 'data', 'cache', 'memories'
 * @returns The appropriate path for the current environment
 */
export function getAppPath(type: 'config' | 'data' | 'cache' | 'memories'): string {
  switch (type) {
    case 'config':
      return getAppConfigDir();
    case 'data':
      return getAppDataDir();
    case 'cache':
      return getAppCacheDir();
    case 'memories':
      return getMemoriesDir();
    default:
      return getAppDataDir();
  }
}
