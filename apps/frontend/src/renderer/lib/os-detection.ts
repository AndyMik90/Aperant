/**
 * OS Detection Utility
 *
 * Provides runtime platform detection for Windows, macOS, and Linux.
 * Uses navigator.userAgentData.platform (modern) with fallback to navigator.platform.
 */

// Type augmentation for navigator.userAgentData (modern User-Agent Client Hints API)
interface NavigatorUAData {
  platform: string;
}
declare global {
  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
}

export type Platform = 'windows' | 'macos' | 'linux' | 'unknown';

/**
 * Get the current platform string at runtime.
 * Uses navigator.userAgentData.platform if available (modern, non-deprecated),
 * otherwise falls back to navigator.platform (deprecated but widely supported).
 *
 * @returns Platform string in lowercase
 */
export function getPlatform(): string {
  // Prefer navigator.userAgentData.platform (modern, non-deprecated)
  if (navigator.userAgentData?.platform) {
    return navigator.userAgentData.platform.toLowerCase();
  }
  // Fallback to navigator.platform (deprecated but widely supported)
  // Use empty string fallback for environments where navigator.platform is undefined
  return (navigator.platform ?? '').toLowerCase();
}

/**
 * Detect if the current OS is Windows.
 *
 * @returns true if running on Windows
 */
export function isWindows(): boolean {
  const platform = getPlatform();
  return platform.startsWith('win');
}

/**
 * Detect if the current OS is macOS.
 *
 * @returns true if running on macOS
 */
export function isMacOS(): boolean {
  const platform = getPlatform();
  return platform.includes('mac') || platform.includes('darwin');
}

/**
 * Detect if the current OS is Linux.
 *
 * @returns true if running on Linux
 */
export function isLinux(): boolean {
  const platform = getPlatform();
  return platform.includes('linux');
}

/**
 * Get the current OS as a Platform enum.
 *
 * @returns Platform enum value
 */
export function getOS(): Platform {
  if (isWindows()) return 'windows';
  if (isMacOS()) return 'macos';
  if (isLinux()) return 'linux';
  return 'unknown';
}
