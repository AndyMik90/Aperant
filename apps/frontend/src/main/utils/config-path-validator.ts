/**
 * Config Path Validator
 *
 * Security utility to validate Claude profile config directory paths.
 * Prevents path traversal attacks where malicious code could specify
 * arbitrary paths like /etc or C:\Windows\System32\config.
 */

import path from 'path';
import os from 'os';

/**
 * Validate that a config directory path is safe and within expected boundaries.
 * This prevents path traversal attacks where a malicious renderer could
 * specify arbitrary paths like /etc or C:\Windows\System32\config.
 *
 * @param configDir - The config directory path to validate (may contain ~)
 * @returns true if the path is safe, false otherwise
 */
export function isValidConfigDir(configDir: string): boolean {
  // Expand ~ to home directory for validation
  const expandedPath = configDir.startsWith('~')
    ? path.join(os.homedir(), configDir.slice(1))
    : configDir;

  // Normalize to resolve any .. or . components
  const normalizedPath = path.resolve(expandedPath);
  const homeDir = os.homedir();

  // Allow paths within:
  // 1. User's home directory (~/)
  // 2. ~/.claude (default config directory)
  // 3. ~/.claude-profiles/* (profile config directories)
  // 4. User's app data directory (for custom profiles)
  const allowedPrefixes = [
    homeDir,
    path.join(homeDir, '.claude'),
    path.join(homeDir, '.claude-profiles'),
  ];

  // Check if normalized path starts with any allowed prefix
  // IMPORTANT: Use path separator boundary to prevent attacks like
  // /home/alice-malicious passing validation for /home/alice
  for (const prefix of allowedPrefixes) {
    const resolvedPrefix = path.resolve(prefix);
    // Check for exact match OR starts with prefix + separator
    if (normalizedPath === resolvedPrefix || normalizedPath.startsWith(resolvedPrefix + path.sep)) {
      return true;
    }
  }

  console.warn('[Config Path Validator] Rejected unsafe configDir path:', configDir, '(normalized:', normalizedPath, ')');
  return false;
}
