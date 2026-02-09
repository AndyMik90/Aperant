/**
 * Profile Utilities Module
 * Helper functions for profile operations
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'fs';
import type { ClaudeProfile, APIProfile } from '../../shared/types';
import { getCredentialsFromKeychain } from './credential-utils';

/**
 * Default Claude config directory
 */
export const DEFAULT_CLAUDE_CONFIG_DIR = join(homedir(), '.claude');

/**
 * Default profiles directory for additional accounts
 */
export const CLAUDE_PROFILES_DIR = join(homedir(), '.claude-profiles');

/**
 * Generate a unique ID for a new profile
 */
export function generateProfileId(name: string, existingProfiles: ClaudeProfile[]): string {
  const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let id = baseId;
  let counter = 1;

  while (existingProfiles.some(p => p.id === id)) {
    id = `${baseId}-${counter}`;
    counter++;
  }

  return id;
}

/**
 * Create a new profile directory and initialize it
 */
export async function createProfileDirectory(profileName: string): Promise<string> {
  // Create profiles directory - mkdirSync with recursive:true is idempotent
  // and won't throw if the directory already exists, so no existsSync check needed
  mkdirSync(CLAUDE_PROFILES_DIR, { recursive: true });

  // Create directory for this profile
  const sanitizedName = profileName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const profileDir = join(CLAUDE_PROFILES_DIR, sanitizedName);

  // mkdirSync with recursive:true is idempotent and won't throw if directory exists
  // No existsSync check needed - avoids TOCTOU race condition
  mkdirSync(profileDir, { recursive: true });

  return profileDir;
}

/**
 * Check if a profile has valid authentication
 * (checks for OAuth token or config directory credential files)
 */
export function isProfileAuthenticated(profile: ClaudeProfile): boolean {
  // Check for direct OAuth token first (OAuth-only profiles without configDir)
  // This enables auto-switch to work with profiles that only have oauthToken set
  if (hasValidToken(profile)) {
    return true;
  }

  // Check for configDir-based credentials (legacy or CLI-authenticated profiles)
  const configDir = profile.configDir;
  if (!configDir || !existsSync(configDir)) {
    return false;
  }

  // Check for .claude.json with OAuth account info (modern Claude Code CLI)
  // This is how Claude Code CLI stores OAuth authentication since v1.0
  const claudeJsonPath = join(configDir, '.claude.json');
  if (existsSync(claudeJsonPath)) {
    try {
      const content = readFileSync(claudeJsonPath, 'utf-8');
      const data = JSON.parse(content);
      // Check for oauthAccount which indicates successful OAuth authentication
      if (data && typeof data === 'object' && (data.oauthAccount?.accountUuid || data.oauthAccount?.emailAddress)) {
        // The actual OAuth tokens are stored in platform-specific credential storage:
        // - macOS: Keychain
        // - Windows: Credential Manager
        // - Linux: Secret Service or .credentials.json file
        // We need to verify that the credential store actually has the tokens
        // Expand ~ in configDir before checking credentials
        const expandedConfigDir = configDir.startsWith('~')
          ? configDir.replace(/^~/, homedir())
          : configDir;
        const platformCreds = getCredentialsFromKeychain(expandedConfigDir);
        if (!platformCreds.token) {
          // .claude.json exists but credential store is missing tokens - NOT authenticated
          console.warn(`[profile-utils] Profile has .claude.json but no platform credentials for: ${configDir}`);
          return false;
        }
        return true;
      }
    } catch (error) {
      // Log parse errors for debugging, but fall through to legacy checks
      console.warn(`[profile-utils] Failed to read or parse ${claudeJsonPath}:`, error);
    }
  }

  // Check for .credentials.json with OAuth tokens (Linux CLI storage)
  // On Linux, the Claude CLI stores OAuth tokens in this file
  const credentialsJsonPath = join(configDir, '.credentials.json');
  if (existsSync(credentialsJsonPath)) {
    try {
      const content = readFileSync(credentialsJsonPath, 'utf-8');
      const data = JSON.parse(content);
      // Validate OAuth data structure
      // Check for claudeAiOauth (primary Linux structure)
      if (data && typeof data === 'object' && data.claudeAiOauth) {
        // Validate that claudeAiOauth contains actual auth data
        const hasValidAuth = data.claudeAiOauth.accessToken ||
                             data.claudeAiOauth.refreshToken ||
                             data.claudeAiOauth.email ||
                             data.claudeAiOauth.emailAddress;
        if (hasValidAuth) {
          return true;
        }
      }
      // Check for oauthAccount (alternative structure)
      if (data && typeof data === 'object' && data.oauthAccount?.emailAddress) {
        return true;
      }
      // Check for generic token fields (legacy formats)
      if (data && typeof data === 'object' && (data.accessToken || data.refreshToken || data.token)) {
        return true;
      }
    } catch (error) {
      // Log parse errors for debugging, but fall through to legacy checks
      console.warn(`[profile-utils] Failed to read or parse ${credentialsJsonPath}:`, error);
    }
  }

  // Legacy: Claude stores auth in .claude/credentials or similar files
  // Check for common auth indicators
  const possibleAuthFiles = [
    join(configDir, 'credentials'),
    join(configDir, 'credentials.json'),
    join(configDir, '.credentials'),
    join(configDir, 'settings.json'),  // Often contains auth tokens
  ];

  for (const authFile of possibleAuthFiles) {
    if (existsSync(authFile)) {
      try {
        const content = readFileSync(authFile, 'utf-8');
        // Check if file has actual content (not just empty or placeholder)
        if (content.length > 10) {
          return true;
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  // Also check if there are any session files (indicates authenticated usage)
  const projectsDir = join(configDir, 'projects');
  if (existsSync(projectsDir)) {
    try {
      const projects = readdirSync(projectsDir);
      if (projects.length > 0) {
        return true;
      }
    } catch {
      // Ignore read errors
    }
  }

  return false;
}

/**
 * Check if a profile has a valid OAuth token stored in the profile.
 *
 * DEPRECATED: This function checks for CACHED OAuth tokens which we no longer store.
 * OAuth tokens expire in 8-12 hours, not 1 year. We now use CLAUDE_CONFIG_DIR
 * to let Claude CLI read fresh tokens from Keychain on each invocation.
 *
 * This function is kept for backwards compatibility with existing profiles that
 * have oauthToken stored. For these profiles, we return true (assuming token might
 * still be valid) and let the actual API call determine if re-auth is needed.
 *
 * New profiles will NOT have oauthToken stored (per the auth flow changes).
 * Use isProfileAuthenticated() to check for configDir-based credentials instead.
 *
 * See: docs/LONG_LIVED_AUTH_PLAN.md for full context.
 */
export function hasValidToken(profile: ClaudeProfile): boolean {
  if (!profile?.oauthToken) {
    return false;
  }

  // For legacy profiles with stored oauthToken, return true.
  // The actual token validity is determined by the Keychain (via CLAUDE_CONFIG_DIR).
  // We keep this for backwards compat to avoid breaking existing profiles during migration.
  console.warn('[hasValidToken] DEPRECATED: Profile has cached oauthToken. Using CLAUDE_CONFIG_DIR for fresh tokens.');
  return true;
}

/**
 * Check if an API profile has valid authentication credentials.
 * Validates that both apiKey and baseUrl are present and non-empty.
 *
 * @param profile - The API profile to check
 * @returns true if the profile has both apiKey and baseUrl, false otherwise
 */
export function isAPIProfileAuthenticated(profile: APIProfile): boolean {
  // Check for presence of required fields
  if (!profile?.apiKey || !profile?.baseUrl) {
    return false;
  }

  // Validate that the fields are non-empty strings (after trimming whitespace)
  const hasValidApiKey = typeof profile.apiKey === 'string' && profile.apiKey.trim().length > 0;
  const hasValidBaseUrl = typeof profile.baseUrl === 'string' && profile.baseUrl.trim().length > 0;

  return hasValidApiKey && hasValidBaseUrl;
}

/**
 * Expand ~ in path to home directory
 */
export function expandHomePath(path: string): string {
  if (path?.startsWith('~')) {
    const home = homedir();
    return path.replace(/^~/, home);
  }
  return path;
}

/**
 * Get the email address from a profile's Claude config file (.claude.json).
 *
 * This reads the email directly from Claude's config file, which is the authoritative
 * source for the user's email. This is more reliable than parsing terminal output
 * which may contain ANSI escape codes that corrupt the email.
 *
 * @param configDir - The profile's config directory (e.g., ~/.claude or ~/.claude-profiles/work)
 * @returns The email address if found, null otherwise
 */
export function getEmailFromConfigDir(configDir?: string): string | null {
  if (!configDir) {
    return null;
  }

  // Expand ~ to home directory
  const expandedConfigDir = expandHomePath(configDir);

  // Check .claude.json (primary config file)
  const claudeJsonPath = join(expandedConfigDir, '.claude.json');
  if (existsSync(claudeJsonPath)) {
    try {
      const content = readFileSync(claudeJsonPath, 'utf-8');
      const data = JSON.parse(content);

      // Check for oauthAccount.emailAddress (modern Claude Code CLI format)
      if (data?.oauthAccount?.emailAddress && typeof data.oauthAccount.emailAddress === 'string') {
        return data.oauthAccount.emailAddress;
      }
    } catch (error) {
      console.warn(`[profile-utils] Failed to read email from ${claudeJsonPath}:`, error);
    }
  }

  // Fallback: check .credentials.json (used on some Linux setups)
  const credentialsJsonPath = join(expandedConfigDir, '.credentials.json');
  if (existsSync(credentialsJsonPath)) {
    try {
      const content = readFileSync(credentialsJsonPath, 'utf-8');
      const data = JSON.parse(content);

      // Check claudeAiOauth.email or emailAddress
      const email = data?.claudeAiOauth?.email || data?.claudeAiOauth?.emailAddress || data?.email;
      if (email && typeof email === 'string') {
        return email;
      }
    } catch (error) {
      console.warn(`[profile-utils] Failed to read email from ${credentialsJsonPath}:`, error);
    }
  }

  return null;
}
