/**
 * Homebrew Python Detection Utility
 *
 * Shared logic for finding Python installations in Homebrew directories.
 * Used by both python-detector.ts and cli-tool-manager.ts to ensure
 * consistent Python detection across the application.
 */

import { existsSync } from 'fs';
import path from 'path';

/**
 * Validation result for a Python installation.
 */
export interface PythonValidation {
  valid: boolean;
  version?: string;
  message: string;
}

/**
 * Find the first valid Homebrew Python installation.
 * Checks common Homebrew paths for Python 3, including versioned installations.
 * Prioritizes newer Python versions (3.14, 3.13, 3.12, 3.11, 3.10).
 *
 * Note: This list should be updated when new Python versions are released.
 * Check for specific versions first to ensure we find the latest available version.
 *
 * @param validateFn - Function to validate a Python path and return validation result
 * @param logPrefix - Prefix for log messages (e.g., '[Python]', '[CLI Tools]')
 * @returns The path to Homebrew Python, or null if not found
 */
export function findHomebrewPython(
  validateFn: (pythonPath: string) => PythonValidation,
  logPrefix: string
): string | null {
  const homebrewDirs = [
    '/opt/homebrew/bin',  // Apple Silicon (M1/M2/M3)
    '/usr/local/bin'      // Intel Mac
  ];

  // Check for specific Python versions first (newest to oldest), then fall back to generic python3.
  // This ensures we find the latest available version that meets our requirements.
  const pythonNames = [
    'python3.14',
    'python3.13',
    'python3.12',
    'python3.11',
    'python3.10',
    'python3',
  ];

  for (const dir of homebrewDirs) {
    for (const name of pythonNames) {
      const pythonPath = path.join(dir, name);
      if (existsSync(pythonPath)) {
        try {
          // Validate that this Python meets version requirements
          const validation = validateFn(pythonPath);
          if (validation.valid) {
            console.log(`${logPrefix} Found valid Homebrew Python: ${pythonPath} (${validation.version})`);
            return pythonPath;
          } else {
            console.warn(`${logPrefix} ${pythonPath} rejected: ${validation.message}`);
          }
        } catch (error) {
          // Version check failed (e.g., timeout, permission issue), try next candidate
          console.warn(`${logPrefix} Failed to validate ${pythonPath}: ${error}`);
        }
      }
    }
  }

  console.log(`${logPrefix} No valid Homebrew Python found in ${homebrewDirs.join(', ')}`);
  return null;
}
