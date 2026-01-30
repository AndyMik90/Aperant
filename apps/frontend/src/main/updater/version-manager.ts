/**
 * Version management utilities
 *
 * Simplified version that uses only the bundled app version.
 * The "source updater" system has been removed since the backend
 * is bundled with the app and updates via electron-updater.
 */

import { app } from 'electron';

/**
 * Get the current app/framework version from package.json
 *
 * Uses app.getVersion() (from package.json) as the version.
 */
export function getBundledVersion(): string {
  return app.getVersion();
}

/**
 * Parse a version string into its components
 * Handles versions like "2.7.2", "2.7.2-beta.6", "2.7.2-alpha.1"
 *
 * @returns { base: number[], prerelease: { type: string, num: number } | null }
 */
function parseVersion(version: string): {
  base: number[];
  prerelease: { type: string; num: number } | null
} {
  // Split into base version and prerelease suffix
  // e.g., "2.7.2-beta.6" -> ["2.7.2", "beta.6"]
  const [baseStr, prereleaseStr] = version.split('-');

  // Parse base version numbers
  const base = baseStr.split('.').map(n => parseInt(n, 10) || 0);

  // Parse prerelease if present
  let prerelease: { type: string; num: number } | null = null;
  if (prereleaseStr) {
    // Handle formats like "beta.6", "alpha.1", "rc.2"
    const match = prereleaseStr.match(/^([a-zA-Z]+)\.?(\d*)$/);
    if (match) {
      prerelease = {
        type: match[1].toLowerCase(),
        num: parseInt(match[2], 10) || 0
      };
    }
  }

  return { base, prerelease };
}

/**
 * Compare semantic versions with proper pre-release support
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 *
 * Pre-release ordering:
 * - alpha < beta < rc < stable (no prerelease)
 * - 2.7.2-beta.1 < 2.7.2-beta.2 < 2.7.2 (stable)
 * - 2.7.1 < 2.7.2-beta.1 < 2.7.2
 */
export function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  // Compare base versions first
  const maxLen = Math.max(parsedA.base.length, parsedB.base.length);
  for (let i = 0; i < maxLen; i++) {
    const numA = parsedA.base[i] || 0;
    const numB = parsedB.base[i] || 0;

    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  // Base versions are equal, compare prereleases
  // No prerelease = stable = higher than any prerelease of same base
  if (!parsedA.prerelease && !parsedB.prerelease) return 0;
  if (!parsedA.prerelease && parsedB.prerelease) return 1;  // a is stable, b is prerelease
  if (parsedA.prerelease && !parsedB.prerelease) return -1; // a is prerelease, b is stable

  // Both have prereleases - compare type then number
  const prereleaseOrder: Record<string, number> = { alpha: 0, beta: 1, rc: 2 };
  const typeA = prereleaseOrder[parsedA.prerelease?.type] ?? 1;
  const typeB = prereleaseOrder[parsedB.prerelease?.type] ?? 1;

  if (typeA > typeB) return 1;
  if (typeA < typeB) return -1;

  // Same prerelease type, compare numbers
  if (parsedA.prerelease?.num > parsedB.prerelease?.num) return 1;
  if (parsedA.prerelease?.num < parsedB.prerelease?.num) return -1;

  return 0;
}
