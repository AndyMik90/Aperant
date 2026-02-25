/**
 * Platform abstraction for cross-platform operations.
 *
 * This module provides a centralized way to check the current platform
 * that can be easily mocked in tests. Tests can mock the getCurrentPlatform
 * function to test platform-specific behavior without relying on the
 * actual runtime platform.
 */

/**
 * Supported platform identifiers
 */
export type Platform = 'win32' | 'darwin' | 'linux' | 'unknown';

/**
 * Get the current platform identifier.
 *
 * In production, this returns the actual Node.js process.platform.
 * In tests, this can be mocked to test platform-specific behavior.
 *
 * @returns The current platform identifier
 */
export function getCurrentPlatform(): Platform {
  const p = process.platform;
  if (p === 'win32' || p === 'darwin' || p === 'linux') {
    return p;
  }
  return 'unknown';
}

/**
 * Check if the current platform is Windows.
 *
 * @returns true if running on Windows
 */
export function isWindows(): boolean {
  return getCurrentPlatform() === 'win32';
}

/**
 * Check if the current platform is macOS.
 *
 * @returns true if running on macOS
 */
export function isMacOS(): boolean {
  return getCurrentPlatform() === 'darwin';
}

/**
 * Check if the current platform is Linux.
 *
 * @returns true if running on Linux
 */
export function isLinux(): boolean {
  return getCurrentPlatform() === 'linux';
}

/**
 * Check if the current platform is Unix-like (macOS or Linux).
 *
 * @returns true if running on a Unix-like platform
 */
export function isUnix(): boolean {
  return isMacOS() || isLinux();
}
