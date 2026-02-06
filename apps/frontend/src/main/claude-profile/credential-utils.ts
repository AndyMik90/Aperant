/**
 * Cross-Platform Credential Utilities
 *
 * Provides functions to retrieve Claude Code OAuth tokens and email from
 * platform-specific secure storage:
 * - macOS: Keychain (via `security` command)
 * - Linux: Secret Service API (via `secret-tool` command), with fallback to .credentials.json file
 * - Windows: Windows Credential Manager (via PowerShell)
 *
 * Supports both:
 * - Default profile: "Claude Code-credentials" service / default config dir
 * - Custom profiles: "Claude Code-credentials-{sha256-8-hash}" where hash is first 8 chars
 *   of SHA256 hash of the CLAUDE_CONFIG_DIR path
 *
 * Mirrors the functionality of apps/backend/core/auth.py get_token_from_keychain()
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { homedir, userInfo } from 'os';
import { dirname, join } from 'path';
import { isMacOS, isWindows, isLinux } from '../platform';

/**
 * Create a safe fingerprint of a token for debug logging.
 * Shows first 8 and last 4 characters, hiding the sensitive middle portion.
 * This is NOT for authentication - only for human-readable debug identification.
 *
 * @param token - The token to create a fingerprint for
 * @returns A safe fingerprint like "sk-ant-oa...xyz9" or "null" if no token
 */
function getTokenFingerprint(token: string | null | undefined): string {
  if (!token) return 'null';
  if (token.length <= 16) return token.slice(0, 4) + '...' + token.slice(-2);
  return token.slice(0, 8) + '...' + token.slice(-4);
}

/**
 * Escape a string for safe interpolation into PowerShell double-quoted strings.
 * Escapes all PowerShell special characters to prevent injection attacks.
 *
 * @param str - The string to escape
 * @returns The escaped string safe for PowerShell interpolation
 */
function escapePowerShellString(str: string): string {
  return str
    .replace(/`/g, '``')   // Backtick is PowerShell's escape character - must be escaped first
    .replace(/\$/g, '`$')  // Dollar sign triggers variable expansion
    .replace(/"/g, '`"');  // Double quotes end the string
}

/**
 * Encode a string to base64 for safe passing to PowerShell.
 * This is the most secure way to pass arbitrary data to PowerShell scripts.
 *
 * @param str - The string to encode
 * @returns Base64-encoded string
 */
function encodeBase64ForPowerShell(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64');
}

/**
 * Credentials retrieved from platform-specific secure storage
 */
export interface PlatformCredentials {
  token: string | null;
  email: string | null;
  error?: string;  // Set when credential access fails (locked, permission denied, etc.)
}

// Legacy alias for backwards compatibility
export type KeychainCredentials = PlatformCredentials;

/**
 * Full OAuth credentials including refresh token and expiry info
 * Used for token refresh operations
 */
export interface FullOAuthCredentials extends PlatformCredentials {
  refreshToken: string | null;
  expiresAt: number | null;  // Unix timestamp in ms when access token expires
  scopes: string[] | null;
  subscriptionType: string | null;  // e.g., "max" for Claude Max subscription
  rateLimitTier: string | null;     // e.g., "default_claude_max_20x"
}

/**
 * Result of updating credentials in the keychain/credential store
 */
export interface UpdateCredentialsResult {
  success: boolean;
  error?: string;
}

/**
 * Cache for credentials to avoid repeated blocking calls
 * Map key is the cache key (e.g., "macos:Claude Code-credentials" or "linux:/home/user/.claude")
 */
interface CredentialCacheEntry {
  credentials: PlatformCredentials;
  timestamp: number;
}

const credentialCache = new Map<string, CredentialCacheEntry>();
// Cache for 5 minutes (300,000 ms) for successful results
const CACHE_TTL_MS = 5 * 60 * 1000;
// Cache for 10 seconds for error results (allows quick retry after unlock)
const ERROR_CACHE_TTL_MS = 10 * 1000;

// Timeouts for credential retrieval operations
const MACOS_KEYCHAIN_TIMEOUT_MS = 5000;
const WINDOWS_CREDMAN_TIMEOUT_MS = 10000;

// Defense-in-depth: Pattern for valid credential target names
// Matches "Claude Code-credentials" or "Claude Code-credentials-{8 hex chars}"
const VALID_TARGET_NAME_PATTERN = /^Claude Code-credentials(-[a-f0-9]{8})?$/;

/**
 * Validate that a credential target name matches the expected format.
 * Defense-in-depth check to prevent injection attacks.
 *
 * @param targetName - The target name to validate
 * @returns true if valid, false otherwise
 */
function isValidTargetName(targetName: string): boolean {
  return VALID_TARGET_NAME_PATTERN.test(targetName);
}

/**
 * Validate that a credentials path is within expected boundaries.
 * Defense-in-depth check to prevent path traversal attacks.
 *
 * @param credentialsPath - The path to validate
 * @returns true if valid, false otherwise
 */
function isValidCredentialsPath(credentialsPath: string): boolean {
  // Credentials path should:
  // 1. Not contain path traversal sequences (works on both Unix and Windows)
  // 2. End with the expected file name
  // Note: We allow custom config directories since they come from user settings
  // The configDir is from profile settings, which is trusted user input
  return (
    !credentialsPath.includes('..') &&
    credentialsPath.endsWith('.credentials.json')
  );
}

/**
 * Calculate the credential storage identifier suffix for a config directory.
 * Claude Code uses SHA256 hash of the config dir path, taking first 8 hex chars.
 *
 * @param configDir - The CLAUDE_CONFIG_DIR path
 * @returns The 8-character hex hash suffix
 */
export function calculateConfigDirHash(configDir: string): string {
  return createHash('sha256').update(configDir).digest('hex').slice(0, 8);
}

/**
 * Normalize Windows path separators for hash consistency with Claude CLI.
 *
 * Claude CLI on Windows uses backslashes, so we must too for hash consistency.
 * Mixed slashes (C:\Users\bill/.claude-profiles) produce different hashes than
 * consistent slashes (C:\Users\bill\.claude-profiles).
 *
 * Supports:
 * - Drive letter paths: C:\Users\...
 * - UNC paths with backslashes: \\server\share
 * - UNC paths with forward slashes: //server/share (normalized to \\server\share)
 *
 * @param path - The path to normalize
 * @returns The path with forward slashes replaced by backslashes on Windows
 */
export function normalizeWindowsPath(path: string): string {
  if (!isWindows()) return path;
  // Match: drive letter (C:), UNC with backslashes (\\), or UNC with forward slashes (//)
  if (!/^[A-Za-z]:|^[\\/]{2}/.test(path)) return path;
  return path.replace(/\//g, '\\');
}

/**
 * Get the Keychain service name for a config directory (macOS).
 *
 * All profiles use hash-based keychain entries for isolation.
 * This prevents interference with external Claude Code CLI which uses
 * "Claude Code-credentials" (no hash) for ~/.claude.
 *
 * @param configDir - CLAUDE_CONFIG_DIR path. Required for isolation.
 * @returns The Keychain service name (e.g., "Claude Code-credentials-d74c9506")
 */
export function getKeychainServiceName(configDir?: string): string {
  // No configDir provided - this should not happen with isolated profiles
  // Fall back to unhashed name for backwards compatibility during migration
  if (!configDir) {
    console.warn('[CredentialUtils] getKeychainServiceName called without configDir - using legacy fallback');
    return 'Claude Code-credentials';
  }

  // Normalize the configDir: expand ~ and resolve to absolute path
  const normalizedConfigDir = normalizeWindowsPath(
    configDir.startsWith('~')
      ? join(homedir(), configDir.slice(1))
      : configDir
  );

  // ALL profiles now use hash-based keychain entries for isolation
  // This prevents interference with external Claude Code CLI
  const hash = calculateConfigDirHash(normalizedConfigDir);
  return `Claude Code-credentials-${hash}`;
}

/**
 * Get the Windows Credential Manager target name for a config directory.
 *
 * @param configDir - Optional CLAUDE_CONFIG_DIR path. If not provided, returns default target name.
 * @returns The Credential Manager target name (e.g., "Claude Code-credentials-d74c9506")
 */
export function getWindowsCredentialTarget(configDir?: string): string {
  // Windows uses the same naming convention as macOS Keychain
  return getKeychainServiceName(configDir);
}

/**
 * Validate the structure of parsed credential JSON data
 * @param data - Parsed JSON data from credential store
 * @returns true if data structure is valid, false otherwise
 */
function validateCredentialData(data: unknown): data is { claudeAiOauth?: { accessToken?: string; email?: string; emailAddress?: string }; email?: string } {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Check if claudeAiOauth exists and is an object
  if (obj.claudeAiOauth !== undefined) {
    if (typeof obj.claudeAiOauth !== 'object' || obj.claudeAiOauth === null) {
      return false;
    }
    const oauth = obj.claudeAiOauth as Record<string, unknown>;
    // Validate accessToken if present
    if (oauth.accessToken !== undefined && typeof oauth.accessToken !== 'string') {
      return false;
    }
    // Validate email if present (can be 'email' or 'emailAddress')
    if (oauth.email !== undefined && typeof oauth.email !== 'string') {
      return false;
    }
    if (oauth.emailAddress !== undefined && typeof oauth.emailAddress !== 'string') {
      return false;
    }
  }

  // Validate top-level email if present
  if (obj.email !== undefined && typeof obj.email !== 'string') {
    return false;
  }

  return true;
}

/**
 * Extract token and email from validated credential data
 */
function extractCredentials(data: { claudeAiOauth?: { accessToken?: string; email?: string; emailAddress?: string }; email?: string }): { token: string | null; email: string | null } {
  // Extract OAuth token from nested structure
  const token = data?.claudeAiOauth?.accessToken || null;

  // Extract email (might be in different locations depending on Claude Code version)
  const email = data?.claudeAiOauth?.email || data?.claudeAiOauth?.emailAddress || data?.email || null;

  return { token, email };
}

/**
 * Extract full credentials including refresh token and expiry from validated credential data
 */
function extractFullCredentials(data: {
  claudeAiOauth?: {
    accessToken?: string;
    email?: string;
    emailAddress?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
  email?: string
}): {
  token: string | null;
  email: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[] | null;
  subscriptionType: string | null;
  rateLimitTier: string | null;
} {
  // Extract OAuth token from nested structure
  const token = data?.claudeAiOauth?.accessToken || null;

  // Extract email (might be in different locations depending on Claude Code version)
  const email = data?.claudeAiOauth?.email || data?.claudeAiOauth?.emailAddress || data?.email || null;

  // Extract refresh token
  const refreshToken = data?.claudeAiOauth?.refreshToken || null;

  // Extract expiry timestamp (Unix timestamp in ms)
  const expiresAt = data?.claudeAiOauth?.expiresAt || null;

  // Extract scopes (array of strings)
  const scopes = data?.claudeAiOauth?.scopes || null;

  // Extract subscription info (determines "Max" vs "API" display in Claude Code)
  const subscriptionType = data?.claudeAiOauth?.subscriptionType || null;
  const rateLimitTier = data?.claudeAiOauth?.rateLimitTier || null;

  return { token, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier };
}

/**
 * Validate token format
 * Use 'sk-ant-' prefix to support future token format versions (oat02, oat03, etc.)
 */
function isValidTokenFormat(token: string): boolean {
  return token.startsWith('sk-ant-');
}

// =============================================================================
// Platform-Specific Credential Reading Helpers (Shared Implementation)
// =============================================================================

/**
 * Execute a credential read operation with platform-specific executable.
 * Shared helper to reduce code duplication across macOS, Linux, and Windows.
 *
 * @param executablePath - Path to the security/secret-tool/powershell executable
 * @param args - Arguments to pass to the executable
 * @param timeout - Timeout in milliseconds
 * @param identifier - Identifier for logging (e.g., "macOS:serviceName", "Linux:attribute")
 * @returns The raw output string or null if not found
 */
function executeCredentialRead(
  executablePath: string,
  args: string[],
  timeout: number,
  _identifier: string
): string | null {
  try {
    const result = execFileSync(executablePath, args, {
      encoding: 'utf-8',
      timeout,
      windowsHide: true,
    });
    return result.trim();
  } catch (error) {
    // Handle expected "not found" errors (macOS exit code 44, Linux/Windows non-zero exit)
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status: number }).status;
      if (status === 44) {
        // macOS: errSecItemNotFound
        return null;
      }
    }
    // Check for "not found" in error message (Linux/Windows)
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('not found') || errorMessage.includes('exit code')) {
      return null;
    }
    // Re-throw unexpected errors
    throw error;
  }
}

/**
 * Parse and validate credential JSON from platform storage.
 * Shared helper to reduce code duplication across platforms.
 *
 * @param credentialsJson - Raw JSON string from credential store
 * @param identifier - Identifier for logging (e.g., "macOS:serviceName")
 * @param extractFn - Function to extract credentials (basic or full)
 * @returns Extracted credentials or null values if invalid
 */
function parseCredentialJson<T extends PlatformCredentials>(
  credentialsJson: string | null,
  identifier: string,
  extractFn: (data: any) => T
): T {
  if (!credentialsJson) {
    return extractFn({}) as T;
  }

  // Parse JSON
  let data: unknown;
  try {
    data = JSON.parse(credentialsJson);
  } catch {
    console.warn(`[CredentialUtils] Failed to parse credential JSON for ${identifier}`);
    return extractFn({}) as T;
  }

  // Validate JSON structure
  if (!validateCredentialData(data)) {
    console.warn(`[CredentialUtils] Invalid credential data structure for ${identifier}`);
    return extractFn({}) as T;
  }

  return extractFn(data);
}

// =============================================================================
// File-Based Credential Helpers (Shared for Linux and Windows)
// =============================================================================

/**
 * Shared implementation for reading credentials from a JSON file.
 * Used by both Linux and Windows file-based credential storage.
 *
 * @param credentialsPath - Path to the credentials file
 * @param cacheKey - Cache key for storing results
 * @param logPrefix - Prefix for log messages (e.g., "Linux", "Windows:File")
 * @param forceRefresh - Whether to bypass cache
 * @returns Platform credentials with token and email
 */
function getCredentialsFromFile(
  credentialsPath: string,
  cacheKey: string,
  logPrefix: string,
  forceRefresh = false
): PlatformCredentials {
  const isDebug = process.env.DEBUG === 'true';
  const now = Date.now();

  // Return cached credentials if available and fresh
  const cached = credentialCache.get(cacheKey);
  if (!forceRefresh && cached) {
    const ttl = cached.credentials.error ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS;
    if ((now - cached.timestamp) < ttl) {
      if (isDebug) {
        const cacheAge = now - cached.timestamp;
        console.warn(`[CredentialUtils:${logPrefix}:CACHE] Returning cached credentials:`, {
          credentialsPath,
          hasToken: !!cached.credentials.token,
          tokenFingerprint: getTokenFingerprint(cached.credentials.token),
          cacheAge: Math.round(cacheAge / 1000) + 's'
        });
      }
      return cached.credentials;
    }
  }

  // Defense-in-depth: Validate credentials path is within expected boundaries
  if (!isValidCredentialsPath(credentialsPath)) {
    if (isDebug) {
      console.warn(`[CredentialUtils:${logPrefix}] Invalid credentials path rejected:`, { credentialsPath });
    }
    const invalidResult = { token: null, email: null, error: 'Invalid credentials path' };
    credentialCache.set(cacheKey, { credentials: invalidResult, timestamp: now });
    return invalidResult;
  }

  // Check if credentials file exists
  if (!existsSync(credentialsPath)) {
    if (isDebug) {
      console.warn(`[CredentialUtils:${logPrefix}] Credentials file not found:`, credentialsPath);
    }
    const notFoundResult = { token: null, email: null };
    credentialCache.set(cacheKey, { credentials: notFoundResult, timestamp: now });
    return notFoundResult;
  }

  try {
    const content = readFileSync(credentialsPath, 'utf-8');

    // Parse JSON
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      console.warn(`[CredentialUtils:${logPrefix}] Failed to parse credentials JSON:`, credentialsPath);
      const errorResult = { token: null, email: null };
      credentialCache.set(cacheKey, { credentials: errorResult, timestamp: now });
      return errorResult;
    }

    // Validate JSON structure
    if (!validateCredentialData(data)) {
      console.warn(`[CredentialUtils:${logPrefix}] Invalid credentials data structure:`, credentialsPath);
      const invalidResult = { token: null, email: null };
      credentialCache.set(cacheKey, { credentials: invalidResult, timestamp: now });
      return invalidResult;
    }

    const { token, email } = extractCredentials(data);

    // Validate token format if present
    if (token && !isValidTokenFormat(token)) {
      console.warn(`[CredentialUtils:${logPrefix}] Invalid token format in:`, credentialsPath);
      const result = { token: null, email };
      credentialCache.set(cacheKey, { credentials: result, timestamp: now });
      return result;
    }

    const credentials = { token, email };
    credentialCache.set(cacheKey, { credentials, timestamp: now });

    if (isDebug) {
      console.warn(`[CredentialUtils:${logPrefix}] Retrieved credentials from file:`, credentialsPath, {
        hasToken: !!token,
        hasEmail: !!email,
        tokenFingerprint: getTokenFingerprint(token),
        forceRefresh
      });
    }
    return credentials;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[CredentialUtils:${logPrefix}] Failed to read credentials file:`, credentialsPath, errorMessage);
    const errorResult = { token: null, email: null, error: `Failed to read credentials: ${errorMessage}` };
    credentialCache.set(cacheKey, { credentials: errorResult, timestamp: now });
    return errorResult;
  }
}

/**
 * Shared implementation for reading full credentials from a JSON file.
 * Used by both Linux and Windows file-based credential storage.
 *
 * @param credentialsPath - Path to the credentials file
 * @param logPrefix - Prefix for log messages (e.g., "Linux:Full", "Windows:File:Full")
 * @returns Full OAuth credentials including refresh token
 */
function getFullCredentialsFromFile(
  credentialsPath: string,
  logPrefix: string
): FullOAuthCredentials {
  const isDebug = process.env.DEBUG === 'true';

  // Defense-in-depth: Validate credentials path is within expected boundaries
  if (!isValidCredentialsPath(credentialsPath)) {
    if (isDebug) {
      console.warn(`[CredentialUtils:${logPrefix}] Invalid credentials path rejected:`, { credentialsPath });
    }
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: 'Invalid credentials path' };
  }

  // Check if credentials file exists
  if (!existsSync(credentialsPath)) {
    if (isDebug) {
      console.warn(`[CredentialUtils:${logPrefix}] Credentials file not found:`, credentialsPath);
    }
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null };
  }

  try {
    const content = readFileSync(credentialsPath, 'utf-8');

    // Parse JSON
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      console.warn(`[CredentialUtils:${logPrefix}] Failed to parse credentials JSON:`, credentialsPath);
      return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null };
    }

    // Validate JSON structure
    if (!validateCredentialData(data)) {
      console.warn(`[CredentialUtils:${logPrefix}] Invalid credentials data structure:`, credentialsPath);
      return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null };
    }

    const { token, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier } = extractFullCredentials(data);

    // Validate token format if present
    if (token && !isValidTokenFormat(token)) {
      console.warn(`[CredentialUtils:${logPrefix}] Invalid token format in:`, credentialsPath);
      return { token: null, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier };
    }

    if (isDebug) {
      console.warn(`[CredentialUtils:${logPrefix}] Retrieved full credentials from file:`, credentialsPath, {
        hasToken: !!token,
        hasEmail: !!email,
        hasRefreshToken: !!refreshToken,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        tokenFingerprint: getTokenFingerprint(token),
        subscriptionType,
        rateLimitTier
      });
    }
    return { token, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[CredentialUtils:${logPrefix}] Failed to read credentials file:`, credentialsPath, errorMessage);
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: `Failed to read credentials: ${errorMessage}` };
  }
}

// =============================================================================
// macOS Keychain Implementation
// =============================================================================

/**
 * Retrieve credentials from macOS Keychain
 */
function getCredentialsFromMacOSKeychain(configDir?: string, forceRefresh = false): PlatformCredentials {
  const serviceName = getKeychainServiceName(configDir);
  const cacheKey = `macos:${serviceName}`;
  const isDebug = process.env.DEBUG === 'true';
  const now = Date.now();

  // Return cached credentials if available and fresh
  const cached = credentialCache.get(cacheKey);
  if (!forceRefresh && cached) {
    const ttl = cached.credentials.error ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS;
    if ((now - cached.timestamp) < ttl) {
      if (isDebug) {
        const cacheAge = now - cached.timestamp;
        console.warn('[CredentialUtils:macOS:CACHE] Returning cached credentials:', {
          serviceName,
          hasToken: !!cached.credentials.token,
          tokenFingerprint: getTokenFingerprint(cached.credentials.token),
          cacheAge: Math.round(cacheAge / 1000) + 's'
        });
      }
      return cached.credentials;
    }
  }

  // Locate the security executable
  let securityPath: string | null = null;
  const candidatePaths = ['/usr/bin/security', '/bin/security'];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      securityPath = candidate;
      break;
    }
  }

  if (!securityPath) {
    const notFoundResult = { token: null, email: null, error: 'macOS security command not found' };
    credentialCache.set(cacheKey, { credentials: notFoundResult, timestamp: now });
    return notFoundResult;
  }

  try {
    // Query macOS Keychain for Claude Code credentials using shared helper
    const credentialsJson = executeCredentialRead(
      securityPath,
      ['find-generic-password', '-s', serviceName, '-w'],
      MACOS_KEYCHAIN_TIMEOUT_MS,
      `macOS:${serviceName}`
    );

    // Parse and validate using shared helper
    const { token, email } = parseCredentialJson(
      credentialsJson,
      `macOS:${serviceName}`,
      extractCredentials
    );

    // Validate token format if present
    if (token && !isValidTokenFormat(token)) {
      console.warn('[CredentialUtils:macOS] Invalid token format for service:', serviceName);
      const result = { token: null, email };
      credentialCache.set(cacheKey, { credentials: result, timestamp: now });
      return result;
    }

    const credentials = { token, email };
    credentialCache.set(cacheKey, { credentials, timestamp: now });

    if (isDebug) {
      console.warn('[CredentialUtils:macOS] Retrieved credentials from Keychain for service:', serviceName, {
        hasToken: !!token,
        hasEmail: !!email,
        tokenFingerprint: getTokenFingerprint(token),
        forceRefresh
      });
    }
    return credentials;
  } catch (error) {
    // Unexpected error (executeCredentialRead already handles "not found" cases)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[CredentialUtils:macOS] Keychain access failed for service:', serviceName, errorMessage);
    const errorResult = { token: null, email: null, error: `Keychain access failed: ${errorMessage}` };
    // Use shorter TTL for errors
    credentialCache.set(cacheKey, { credentials: errorResult, timestamp: now });
    return errorResult;
  }
}

// =============================================================================
// Linux Secret Service Implementation
// =============================================================================

/**
 * Timeout for secret-tool commands (5 seconds)
 */
const LINUX_SECRET_TOOL_TIMEOUT_MS = 5000;

/**
 * Find secret-tool executable path on Linux
 * secret-tool is part of libsecret-tools package
 */
function findSecretToolPath(): string | null {
  const candidatePaths = [
    '/usr/bin/secret-tool',
    '/bin/secret-tool',
    '/usr/local/bin/secret-tool',
  ];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Get the Secret Service attribute value for a config directory.
 * For default profile, uses "claude-code".
 * For custom profiles, uses "claude-code-{hash}" where hash is first 8 chars of SHA256.
 */
function getSecretServiceAttribute(configDir?: string): string {
  if (!configDir) {
    return 'claude-code';
  }
  // For custom config dirs, create a hashed attribute to avoid conflicts
  const hash = createHash('sha256').update(configDir).digest('hex').slice(0, 8);
  return `claude-code-${hash}`;
}

/**
 * Retrieve credentials from Linux Secret Service using secret-tool CLI.
 *
 * Claude Code stores credentials in Secret Service with:
 * - Label: "Claude Code-credentials"
 * - Attributes: {application: "claude-code"}
 * - Secret: JSON string with claudeAiOauth.accessToken
 */
function getCredentialsFromLinuxSecretService(configDir?: string, forceRefresh = false): PlatformCredentials {
  const attribute = getSecretServiceAttribute(configDir);
  const cacheKey = `linux-secret:${attribute}`;
  const isDebug = process.env.DEBUG === 'true';
  const now = Date.now();

  // Return cached credentials if available and fresh
  const cached = credentialCache.get(cacheKey);
  if (!forceRefresh && cached) {
    const ttl = cached.credentials.error ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS;
    if ((now - cached.timestamp) < ttl) {
      if (isDebug) {
        const cacheAge = now - cached.timestamp;
        console.warn('[CredentialUtils:Linux:SecretService:CACHE] Returning cached credentials:', {
          attribute,
          hasToken: !!cached.credentials.token,
          tokenFingerprint: getTokenFingerprint(cached.credentials.token),
          cacheAge: Math.round(cacheAge / 1000) + 's'
        });
      }
      return cached.credentials;
    }
  }

  // Find secret-tool executable
  const secretToolPath = findSecretToolPath();
  if (!secretToolPath) {
    if (isDebug) {
      console.warn('[CredentialUtils:Linux:SecretService] secret-tool not found, falling back to file storage');
    }
    // Return a special result indicating Secret Service is unavailable
    return { token: null, email: null, error: 'secret-tool not found' };
  }

  try {
    // Query Secret Service for credentials using shared helper
    const credentialsJson = executeCredentialRead(
      secretToolPath,
      ['lookup', 'application', attribute],
      LINUX_SECRET_TOOL_TIMEOUT_MS,
      `Linux:SecretService:${attribute}`
    );

    // Parse and validate using shared helper
    const { token, email } = parseCredentialJson(
      credentialsJson,
      `Linux:SecretService:${attribute}`,
      extractCredentials
    );

    // Validate token format if present
    if (token && !isValidTokenFormat(token)) {
      console.warn('[CredentialUtils:Linux:SecretService] Invalid token format for attribute:', attribute);
      const result = { token: null, email };
      credentialCache.set(cacheKey, { credentials: result, timestamp: now });
      return result;
    }

    const credentials = { token, email };
    credentialCache.set(cacheKey, { credentials, timestamp: now });

    if (isDebug) {
      console.warn('[CredentialUtils:Linux:SecretService] Retrieved credentials from Secret Service:', {
        attribute,
        hasToken: !!token,
        hasEmail: !!email,
        tokenFingerprint: getTokenFingerprint(token),
        forceRefresh
      });
    }
    return credentials;
  } catch (error) {
    // Unexpected error (executeCredentialRead already handles "not found" cases)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[CredentialUtils:Linux:SecretService] Secret Service access failed:', errorMessage);
    // Return error to trigger fallback to file storage
    return { token: null, email: null, error: `Secret Service access failed: ${errorMessage}` };
  }
}

/**
 * Retrieve credentials from Linux - tries Secret Service first, falls back to file
 */
function getCredentialsFromLinux(configDir?: string, forceRefresh = false): PlatformCredentials {
  const isDebug = process.env.DEBUG === 'true';

  // Try Secret Service first (preferred secure storage)
  const secretServiceResult = getCredentialsFromLinuxSecretService(configDir, forceRefresh);

  // If we got a token from Secret Service, use it
  if (secretServiceResult.token) {
    return secretServiceResult;
  }

  // If Secret Service had an error (not just "not found"), log it and try file fallback
  if (secretServiceResult.error && !secretServiceResult.error.includes('not found')) {
    if (isDebug) {
      console.warn('[CredentialUtils:Linux] Secret Service unavailable, trying file fallback:', secretServiceResult.error);
    }
  }

  // Fall back to file-based storage
  return getCredentialsFromLinuxFile(configDir, forceRefresh);
}

// =============================================================================
// Linux Credentials File Implementation (Fallback)
// =============================================================================

/**
 * Get the credentials file path for Linux
 */
function getLinuxCredentialsPath(configDir?: string): string {
  const baseDir = configDir || join(homedir(), '.claude');
  return join(baseDir, '.credentials.json');
}

/**
 * Retrieve credentials from Linux .credentials.json file (fallback when Secret Service unavailable)
 */
function getCredentialsFromLinuxFile(configDir?: string, forceRefresh = false): PlatformCredentials {
  const credentialsPath = getLinuxCredentialsPath(configDir);
  const cacheKey = `linux:${credentialsPath}`;
  return getCredentialsFromFile(credentialsPath, cacheKey, 'Linux', forceRefresh);
}

// =============================================================================
// Windows Credential Manager Implementation
// =============================================================================

/**
 * Retrieve credentials from Windows Credential Manager using PowerShell
 *
 * Windows Credential Manager stores credentials with:
 * - Target Name: "Claude Code-credentials" or "Claude Code-credentials-{hash}"
 * - Type: Generic credential
 * - Password field contains JSON with { claudeAiOauth: { accessToken, email } }
 */
function getCredentialsFromWindowsCredentialManager(configDir?: string, forceRefresh = false): PlatformCredentials {
  const targetName = getWindowsCredentialTarget(configDir);
  const cacheKey = `windows:${targetName}`;
  const isDebug = process.env.DEBUG === 'true';
  const now = Date.now();

  // Return cached credentials if available and fresh
  const cached = credentialCache.get(cacheKey);
  if (!forceRefresh && cached) {
    const ttl = cached.credentials.error ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS;
    if ((now - cached.timestamp) < ttl) {
      if (isDebug) {
        const cacheAge = now - cached.timestamp;
        console.warn('[CredentialUtils:Windows:CACHE] Returning cached credentials:', {
          targetName,
          hasToken: !!cached.credentials.token,
          tokenFingerprint: getTokenFingerprint(cached.credentials.token),
          cacheAge: Math.round(cacheAge / 1000) + 's'
        });
      }
      return cached.credentials;
    }
  }

  // Defense-in-depth: Validate target name format before using in PowerShell
  if (!isValidTargetName(targetName)) {
    const invalidResult = { token: null, email: null, error: 'Invalid credential target name format' };
    credentialCache.set(cacheKey, { credentials: invalidResult, timestamp: now });
    if (isDebug) {
      console.warn('[CredentialUtils:Windows] Invalid target name rejected:', { targetName });
    }
    return invalidResult;
  }

  // Find PowerShell executable
  const psPath = findPowerShellPath();
  if (!psPath) {
    const notFoundResult = { token: null, email: null, error: 'PowerShell not found' };
    credentialCache.set(cacheKey, { credentials: notFoundResult, timestamp: now });
    return notFoundResult;
  }

  try {
    // PowerShell script to read from Credential Manager
    // Uses the Windows Credential Manager API via .NET
    // NOTE: The CREDENTIAL struct must use IntPtr for string fields (blittable requirement)
    // and strings must be manually marshaled after PtrToStructure
    //
    // NOTE: This CREDENTIAL struct uses IntPtr for string fields (TargetName, Comment, etc.)
    // because CredRead returns a pointer to Windows-allocated memory. We must use a "blittable"
    // struct layout where strings are IntPtr, then manually marshal strings via PtrToStringUni.
    // This differs from the CredWrite struct (see updateWindowsCredentialManagerCredentials)
    // which uses string types because the .NET marshaler can automatically convert strings
    // to pointers when CALLING Windows APIs (but not when RECEIVING data from them).
    const psScript = `
      $ErrorActionPreference = 'Stop'

      # Define the CREDENTIAL struct with IntPtr for string fields (required for CredRead marshaling)
      # See comment above for why this differs from the CredWrite struct definition.
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
}
'@

      # Import CredRead and CredFree from advapi32.dll
      Add-Type -MemberDefinition @'
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);

[DllImport("advapi32.dll", SetLastError = true)]
public static extern bool CredFree(IntPtr cred);
'@ -Namespace Win32 -Name CredApi

      $credPtr = [IntPtr]::Zero
      # CRED_TYPE_GENERIC = 1
      $success = [Win32.CredApi]::CredRead("${escapePowerShellString(targetName)}", 1, 0, [ref]$credPtr)

      if ($success) {
        try {
          # Marshal the pointer to our CREDENTIAL struct
          $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [Type][CREDENTIAL])

          # Read the credential blob (password field) - contains the JSON
          $blobSize = $cred.CredentialBlobSize
          if ($blobSize -gt 0) {
            $blob = [byte[]]::new($blobSize)
            [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blob, 0, $blobSize)
            $password = [System.Text.Encoding]::Unicode.GetString($blob)
            Write-Output $password
          }
        } finally {
          [Win32.CredApi]::CredFree($credPtr) | Out-Null
        }
      } else {
        # Credential not found - this is expected if user hasn't authenticated
        Write-Output ""
      }
    `;

    const result = execFileSync(
      psPath,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      {
        encoding: 'utf-8',
        timeout: WINDOWS_CREDMAN_TIMEOUT_MS,
        windowsHide: true,
      }
    );

    const credentialsJson = result.trim() || null;

    // Parse and validate using shared helper
    const { token, email } = parseCredentialJson(
      credentialsJson,
      `Windows:${targetName}`,
      extractCredentials
    );

    // Validate token format if present
    if (token && !isValidTokenFormat(token)) {
      console.warn('[CredentialUtils:Windows] Invalid token format for target:', targetName);
      const result = { token: null, email };
      credentialCache.set(cacheKey, { credentials: result, timestamp: now });
      return result;
    }

    const credentials = { token, email };
    credentialCache.set(cacheKey, { credentials, timestamp: now });

    if (isDebug) {
      console.warn('[CredentialUtils:Windows] Retrieved credentials from Credential Manager for target:', targetName, {
        hasToken: !!token,
        hasEmail: !!email,
        tokenFingerprint: getTokenFingerprint(token),
        forceRefresh
      });
    }
    return credentials;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[CredentialUtils:Windows] Credential Manager access failed for target:', targetName, errorMessage);
    const errorResult = { token: null, email: null, error: `Credential Manager access failed: ${errorMessage}` };
    credentialCache.set(cacheKey, { credentials: errorResult, timestamp: now });
    return errorResult;
  }
}

/**
 * Find PowerShell executable path on Windows
 */
function findPowerShellPath(): string | null {
  // Prefer PowerShell 7+ (pwsh) over Windows PowerShell
  const candidatePaths = [
    join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    join(homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'pwsh.exe'),
    join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// =============================================================================
// Windows Credentials File Implementation (Fallback)
// =============================================================================

/**
 * Get the credentials file path for Windows
 * Claude CLI on Windows stores credentials in .credentials.json files, not Windows Credential Manager
 */
function getWindowsCredentialsPath(configDir?: string): string {
  const baseDir = configDir || join(homedir(), '.claude');
  return join(baseDir, '.credentials.json');
}

/**
 * Retrieve credentials from Windows .credentials.json file
 * This is the primary storage mechanism used by Claude CLI on Windows
 */
function getCredentialsFromWindowsFile(configDir?: string, forceRefresh = false): PlatformCredentials {
  const credentialsPath = getWindowsCredentialsPath(configDir);
  const cacheKey = `windows-file:${credentialsPath}`;
  return getCredentialsFromFile(credentialsPath, cacheKey, 'Windows:File', forceRefresh);
}

/**
 * Retrieve credentials from Windows - checks both file and Credential Manager, uses the most recent valid token.
 * Claude CLI on Windows can store credentials in either location, and they may get out of sync.
 * We compare both sources and return the one with the most recent/valid token.
 */
function getCredentialsFromWindows(configDir?: string, forceRefresh = false): PlatformCredentials {
  const isDebug = process.env.DEBUG === 'true';

  // Get credentials from both sources
  const fileResult = getCredentialsFromWindowsFile(configDir, forceRefresh);
  const credManagerResult = getCredentialsFromWindowsCredentialManager(configDir, forceRefresh);

  // If only one has a token, use that one
  if (fileResult.token && !credManagerResult.token) {
    if (isDebug) {
      console.warn('[CredentialUtils:Windows] Using file credentials (Credential Manager empty)');
    }
    return fileResult;
  }
  if (credManagerResult.token && !fileResult.token) {
    if (isDebug) {
      console.warn('[CredentialUtils:Windows] Using Credential Manager credentials (file empty)');
    }
    return credManagerResult;
  }

  // If neither has a token, return file result (which has the appropriate error)
  if (!fileResult.token && !credManagerResult.token) {
    return fileResult;
  }

  // Both have tokens - prefer file since Claude CLI writes there after login
  if (isDebug) {
    console.warn('[CredentialUtils:Windows] Both sources have tokens, preferring file (Claude CLI primary storage)');
  }
  return fileResult;
}

// =============================================================================
// Cross-Platform Public API
// =============================================================================

/**
 * Retrieve Claude Code OAuth credentials (token and email) from platform-specific
 * secure storage.
 *
 * - macOS: Reads from Keychain
 * - Linux: Tries Secret Service (via secret-tool), falls back to .credentials.json
 * - Windows: Checks both .credentials.json and Credential Manager, prefers file
 *
 * For default profile: reads from "Claude Code-credentials" or default config dir
 * For custom profiles: uses SHA256(configDir).slice(0,8) hash suffix
 *
 * Uses caching (5-minute TTL) to avoid repeated blocking calls.
 *
 * @param configDir - Optional CLAUDE_CONFIG_DIR path for custom profiles
 * @param forceRefresh - Set to true to bypass cache and fetch fresh credentials
 * @returns Object with token and email (both may be null if not found or invalid)
 */
export function getCredentialsFromKeychain(configDir?: string, forceRefresh = false): PlatformCredentials {
  if (isMacOS()) {
    return getCredentialsFromMacOSKeychain(configDir, forceRefresh);
  }

  if (isLinux()) {
    return getCredentialsFromLinux(configDir, forceRefresh);
  }

  if (isWindows()) {
    return getCredentialsFromWindows(configDir, forceRefresh);
  }

  // Unknown platform - return empty
  return { token: null, email: null, error: `Unsupported platform: ${process.platform}` };
}

/**
 * Alias for getCredentialsFromKeychain for semantic clarity on non-macOS platforms
 */
export const getCredentials = getCredentialsFromKeychain;

/**
 * Clear the credentials cache for a specific profile or all profiles.
 * Useful when you know the credentials have changed (e.g., after running claude /login)
 *
 * @param configDir - Optional config dir to clear cache for specific profile. If not provided, clears all.
 */
export function clearKeychainCache(configDir?: string): void {
  if (configDir) {
    // Clear cache for this specific configDir on all platforms
    const macOSKey = `macos:${getKeychainServiceName(configDir)}`;
    const linuxSecretKey = `linux-secret:${getSecretServiceAttribute(configDir)}`;
    const linuxFileKey = `linux:${getLinuxCredentialsPath(configDir)}`;
    const windowsKey = `windows:${getWindowsCredentialTarget(configDir)}`;
    const windowsFileKey = `windows-file:${getWindowsCredentialsPath(configDir)}`;

    credentialCache.delete(macOSKey);
    credentialCache.delete(linuxSecretKey);
    credentialCache.delete(linuxFileKey);
    credentialCache.delete(windowsKey);
    credentialCache.delete(windowsFileKey);
  } else {
    credentialCache.clear();
  }
}

/**
 * Alias for clearKeychainCache for semantic clarity
 */
export const clearCredentialCache = clearKeychainCache;

// =============================================================================
// Extended Credential Operations (Token Refresh Support)
// =============================================================================

/**
 * Retrieve full credentials (including refresh token) from macOS Keychain
 */
function getFullCredentialsFromMacOSKeychain(configDir?: string): FullOAuthCredentials {
  const serviceName = getKeychainServiceName(configDir);
  const isDebug = process.env.DEBUG === 'true';

  // Locate the security executable
  let securityPath: string | null = null;
  const candidatePaths = ['/usr/bin/security', '/bin/security'];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      securityPath = candidate;
      break;
    }
  }

  if (!securityPath) {
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: 'macOS security command not found' };
  }

  try {
    // Query macOS Keychain for Claude Code credentials using shared helper
    const credentialsJson = executeCredentialRead(
      securityPath,
      ['find-generic-password', '-s', serviceName, '-w'],
      MACOS_KEYCHAIN_TIMEOUT_MS,
      `macOS:Full:${serviceName}`
    );

    // Parse and validate using shared helper
    const { token, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier } = parseCredentialJson(
      credentialsJson,
      `macOS:Full:${serviceName}`,
      extractFullCredentials
    );

    // Validate token format if present
    if (token && !isValidTokenFormat(token)) {
      console.warn('[CredentialUtils:macOS:Full] Invalid token format for service:', serviceName);
      return { token: null, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier };
    }

    if (isDebug) {
      console.warn('[CredentialUtils:macOS:Full] Retrieved full credentials from Keychain for service:', serviceName, {
        hasToken: !!token,
        hasEmail: !!email,
        hasRefreshToken: !!refreshToken,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        tokenFingerprint: getTokenFingerprint(token),
        subscriptionType,
        rateLimitTier
      });
    }
    return { token, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier };
  } catch (error) {
    // Unexpected error (executeCredentialRead already handles "not found" cases)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[CredentialUtils:macOS:Full] Keychain access failed for service:', serviceName, errorMessage);
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: `Keychain access failed: ${errorMessage}` };
  }
}

/**
 * Retrieve full credentials (including refresh token) from Linux Secret Service
 */
function getFullCredentialsFromLinuxSecretService(configDir?: string): FullOAuthCredentials {
  const attribute = getSecretServiceAttribute(configDir);
  const isDebug = process.env.DEBUG === 'true';

  // Find secret-tool executable
  const secretToolPath = findSecretToolPath();
  if (!secretToolPath) {
    if (isDebug) {
      console.warn('[CredentialUtils:Linux:SecretService:Full] secret-tool not found');
    }
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: 'secret-tool not found' };
  }

  try {
    // Query Secret Service for credentials using shared helper
    const credentialsJson = executeCredentialRead(
      secretToolPath,
      ['lookup', 'application', attribute],
      LINUX_SECRET_TOOL_TIMEOUT_MS,
      `Linux:SecretService:Full:${attribute}`
    );

    // Parse and validate using shared helper
    const { token, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier } = parseCredentialJson(
      credentialsJson,
      `Linux:SecretService:Full:${attribute}`,
      extractFullCredentials
    );

    if (token && !isValidTokenFormat(token)) {
      console.warn('[CredentialUtils:Linux:SecretService:Full] Invalid token format for attribute:', attribute);
      return { token: null, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier };
    }

    if (isDebug) {
      console.warn('[CredentialUtils:Linux:SecretService:Full] Retrieved full credentials from Secret Service:', {
        attribute,
        hasToken: !!token,
        hasEmail: !!email,
        hasRefreshToken: !!refreshToken,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        tokenFingerprint: getTokenFingerprint(token),
        subscriptionType,
        rateLimitTier
      });
    }
    return { token, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier };
  } catch (error) {
    // Unexpected error (executeCredentialRead already handles "not found" cases)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[CredentialUtils:Linux:SecretService:Full] Secret Service access failed:', errorMessage);
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: `Secret Service access failed: ${errorMessage}` };
  }
}

/**
 * Retrieve full credentials from Linux - tries Secret Service first, falls back to file
 */
function getFullCredentialsFromLinux(configDir?: string): FullOAuthCredentials {
  const isDebug = process.env.DEBUG === 'true';

  // Try Secret Service first
  const secretServiceResult = getFullCredentialsFromLinuxSecretService(configDir);

  if (secretServiceResult.token) {
    return secretServiceResult;
  }

  if (secretServiceResult.error && !secretServiceResult.error.includes('not found')) {
    if (isDebug) {
      console.warn('[CredentialUtils:Linux:Full] Secret Service unavailable, trying file fallback:', secretServiceResult.error);
    }
  }

  // Fall back to file-based storage
  return getFullCredentialsFromLinuxFile(configDir);
}

/**
 * Retrieve full credentials (including refresh token) from Linux .credentials.json file (fallback)
 */
function getFullCredentialsFromLinuxFile(configDir?: string): FullOAuthCredentials {
  const credentialsPath = getLinuxCredentialsPath(configDir);
  return getFullCredentialsFromFile(credentialsPath, 'Linux:Full');
}

/**
 * Retrieve full credentials (including refresh token) from Windows Credential Manager
 */
function getFullCredentialsFromWindowsCredentialManager(configDir?: string): FullOAuthCredentials {
  const targetName = getWindowsCredentialTarget(configDir);
  const isDebug = process.env.DEBUG === 'true';

  // Defense-in-depth: Validate target name format before using in PowerShell
  if (!isValidTargetName(targetName)) {
    const invalidResult = { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: 'Invalid credential target name format' };
    if (isDebug) {
      console.warn('[CredentialUtils:Windows:Full] Invalid target name rejected:', { targetName });
    }
    return invalidResult;
  }

  // Find PowerShell executable
  const psPath = findPowerShellPath();
  if (!psPath) {
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: 'PowerShell not found' };
  }

  try {
    // PowerShell script to read from Credential Manager (same as basic credentials)
    // NOTE: The CREDENTIAL struct must use IntPtr for string fields (blittable requirement)
    const psScript = `
      $ErrorActionPreference = 'Stop'

      # Define the CREDENTIAL struct with IntPtr for string fields (required for marshaling)
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
}
'@

      # Import CredRead and CredFree from advapi32.dll
      Add-Type -MemberDefinition @'
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);

[DllImport("advapi32.dll", SetLastError = true)]
public static extern bool CredFree(IntPtr cred);
'@ -Namespace Win32 -Name CredApi

      $credPtr = [IntPtr]::Zero
      # CRED_TYPE_GENERIC = 1
      $success = [Win32.CredApi]::CredRead("${escapePowerShellString(targetName)}", 1, 0, [ref]$credPtr)

      if ($success) {
        try {
          # Marshal the pointer to our CREDENTIAL struct
          $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [Type][CREDENTIAL])

          # Read the credential blob (password field) - contains the JSON
          $blobSize = $cred.CredentialBlobSize
          if ($blobSize -gt 0) {
            $blob = [byte[]]::new($blobSize)
            [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blob, 0, $blobSize)
            $password = [System.Text.Encoding]::Unicode.GetString($blob)
            Write-Output $password
          }
        } finally {
          [Win32.CredApi]::CredFree($credPtr) | Out-Null
        }
      } else {
        # Credential not found - this is expected if user hasn't authenticated
        Write-Output ""
      }
    `;

    const result = execFileSync(
      psPath,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      {
        encoding: 'utf-8',
        timeout: WINDOWS_CREDMAN_TIMEOUT_MS,
        windowsHide: true,
      }
    );

    const credentialsJson = result.trim() || null;

    // Parse and validate using shared helper
    const { token, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier } = parseCredentialJson(
      credentialsJson,
      `Windows:Full:${targetName}`,
      extractFullCredentials
    );

    // Validate token format if present
    if (token && !isValidTokenFormat(token)) {
      console.warn('[CredentialUtils:Windows:Full] Invalid token format for target:', targetName);
      return { token: null, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier };
    }

    if (isDebug) {
      console.warn('[CredentialUtils:Windows:Full] Retrieved full credentials from Credential Manager for target:', targetName, {
        hasToken: !!token,
        hasEmail: !!email,
        hasRefreshToken: !!refreshToken,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        tokenFingerprint: getTokenFingerprint(token),
        subscriptionType,
        rateLimitTier
      });
    }
    return { token, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[CredentialUtils:Windows:Full] Credential Manager access failed for target:', targetName, errorMessage);
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: `Credential Manager access failed: ${errorMessage}` };
  }
}

/**
 * Retrieve full credentials (including refresh token) from Windows .credentials.json file
 * This is the primary storage mechanism used by Claude CLI on Windows
 */
function getFullCredentialsFromWindowsFile(configDir?: string): FullOAuthCredentials {
  const credentialsPath = getWindowsCredentialsPath(configDir);
  return getFullCredentialsFromFile(credentialsPath, 'Windows:File:Full');
}

/**
 * Retrieve full credentials from Windows - checks both file and Credential Manager, uses the most recent valid token.
 * Claude CLI on Windows can store credentials in either location, and they may get out of sync.
 * We compare both sources and return the one with the later expiry time (most recently refreshed).
 */
function getFullCredentialsFromWindows(configDir?: string): FullOAuthCredentials {
  const isDebug = process.env.DEBUG === 'true';

  // Get credentials from both sources
  const fileResult = getFullCredentialsFromWindowsFile(configDir);
  const credManagerResult = getFullCredentialsFromWindowsCredentialManager(configDir);

  // If only one has a token, use that one
  if (fileResult.token && !credManagerResult.token) {
    if (isDebug) {
      console.warn('[CredentialUtils:Windows:Full] Using file credentials (Credential Manager empty)');
    }
    return fileResult;
  }
  if (credManagerResult.token && !fileResult.token) {
    if (isDebug) {
      console.warn('[CredentialUtils:Windows:Full] Using Credential Manager credentials (file empty)');
    }
    return credManagerResult;
  }

  // If neither has a token, return file result (which has the appropriate error)
  if (!fileResult.token && !credManagerResult.token) {
    return fileResult;
  }

  // Both have tokens - prefer file since Claude CLI writes there after login
  // This is consistent with getCredentialsFromWindows() which also prefers file.
  // Using file as primary ensures consistency: the same token is returned whether
  // calling getCredentialsFromKeychain() or getFullCredentialsFromKeychain().
  if (isDebug) {
    console.warn('[CredentialUtils:Windows:Full] Both sources have tokens, preferring file (Claude CLI primary storage)');
  }
  return fileResult;
}

/**
 * Get full credentials including refresh token and expiry from platform-specific secure storage.
 * This is an extended version of getCredentialsFromKeychain that returns all credential data
 * needed for token refresh operations.
 *
 * @param configDir - Optional config directory for profile-specific credentials
 * @returns Full credentials including refresh token and expiry information
 */
export function getFullCredentialsFromKeychain(configDir?: string): FullOAuthCredentials {
  if (isMacOS()) {
    return getFullCredentialsFromMacOSKeychain(configDir);
  }

  if (isLinux()) {
    return getFullCredentialsFromLinux(configDir);
  }

  if (isWindows()) {
    return getFullCredentialsFromWindows(configDir);
  }

  // Unknown platform - return empty
  return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: `Unsupported platform: ${process.platform}` };
}

/**
 * Update credentials in macOS Keychain with new tokens
 */
function updateMacOSKeychainCredentials(
  configDir: string | undefined,
  credentials: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
  }
): UpdateCredentialsResult {
  const serviceName = getKeychainServiceName(configDir);
  const isDebug = process.env.DEBUG === 'true';

  // Locate the security executable
  let securityPath: string | null = null;
  const candidatePaths = ['/usr/bin/security', '/bin/security'];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      securityPath = candidate;
      break;
    }
  }

  if (!securityPath) {
    return { success: false, error: 'macOS security command not found' };
  }

  try {
    // Read existing credentials to preserve email, subscriptionType, and rateLimitTier
    const existing = getFullCredentialsFromMacOSKeychain(configDir);

    // Build new credential JSON with all fields
    // IMPORTANT: Preserve subscriptionType and rateLimitTier from existing credentials
    // These fields determine "Max" vs "API" display in Claude Code and are NOT returned
    // by the OAuth token refresh endpoint - they must be preserved from the original auth.
    const newCredentialData = {
      claudeAiOauth: {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt,
        scopes: credentials.scopes || existing.scopes || [],
        email: existing.email || undefined,
        emailAddress: existing.email || undefined,
        subscriptionType: existing.subscriptionType || undefined,
        rateLimitTier: existing.rateLimitTier || undefined
      },
      email: existing.email || undefined
    };

    const credentialsJson = JSON.stringify(newCredentialData);

    // CRITICAL FIX: The -U flag only updates if the account name matches exactly.
    // Claude Code CLI stores credentials with the system username as the account,
    // but we were using 'claude-ai-oauth'. This mismatch caused updates to create
    // a NEW entry instead of updating the existing one, leading to stale tokens.
    //
    // Solution: Delete any existing entry first, then add fresh.
    // This ensures we don't end up with multiple entries with different account names.

    // Step 1: Delete existing entry (ignore errors if not found)
    try {
      execFileSync(
        securityPath,
        ['delete-generic-password', '-s', serviceName],
        {
          encoding: 'utf-8',
          timeout: MACOS_KEYCHAIN_TIMEOUT_MS,
          windowsHide: true,
        }
      );
      if (isDebug) {
        console.warn('[CredentialUtils:macOS:Update] Deleted existing Keychain entry for service:', serviceName);
      }
    } catch {
      // Entry didn't exist - that's fine, we'll create it
      if (isDebug) {
        console.warn('[CredentialUtils:macOS:Update] No existing entry to delete for service:', serviceName);
      }
    }

    // Step 2: Add new entry with system username as account name
    // Claude Code CLI uses the system username, so we must match that for compatibility
    const accountName = userInfo().username;
    execFileSync(
      securityPath,
      ['add-generic-password', '-s', serviceName, '-a', accountName, '-w', credentialsJson],
      {
        encoding: 'utf-8',
        timeout: MACOS_KEYCHAIN_TIMEOUT_MS,
        windowsHide: true,
      }
    );

    if (isDebug) {
      console.warn('[CredentialUtils:macOS:Update] Successfully updated Keychain credentials for service:', serviceName);
    }

    // Clear cached credentials to ensure fresh values are read
    clearCredentialCache(configDir);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[CredentialUtils:macOS:Update] Failed to update Keychain credentials:', errorMessage);
    return { success: false, error: `Keychain update failed: ${errorMessage}` };
  }
}

/**
 * Update credentials in Linux Secret Service with new tokens
 */
function updateLinuxSecretServiceCredentials(
  configDir: string | undefined,
  credentials: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
  }
): UpdateCredentialsResult {
  const attribute = getSecretServiceAttribute(configDir);
  const isDebug = process.env.DEBUG === 'true';

  // Find secret-tool executable
  const secretToolPath = findSecretToolPath();
  if (!secretToolPath) {
    if (isDebug) {
      console.warn('[CredentialUtils:Linux:SecretService:Update] secret-tool not found');
    }
    return { success: false, error: 'secret-tool not found' };
  }

  try {
    // Read existing credentials to preserve email, subscriptionType, and rateLimitTier
    const existing = getFullCredentialsFromLinuxSecretService(configDir);

    // Build new credential JSON with all fields
    // IMPORTANT: Preserve subscriptionType and rateLimitTier from existing credentials
    const newCredentialData = {
      claudeAiOauth: {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt,
        scopes: credentials.scopes || existing.scopes || [],
        email: existing.email || undefined,
        emailAddress: existing.email || undefined,
        subscriptionType: existing.subscriptionType || undefined,
        rateLimitTier: existing.rateLimitTier || undefined
      },
      email: existing.email || undefined
    };

    const credentialsJson = JSON.stringify(newCredentialData);

    // Use secret-tool store to update credentials
    // secret-tool store --label="Claude Code-credentials" application claude-code
    execFileSync(
      secretToolPath,
      ['store', '--label=Claude Code-credentials', 'application', attribute],
      {
        encoding: 'utf-8',
        timeout: LINUX_SECRET_TOOL_TIMEOUT_MS,
        input: credentialsJson,
        windowsHide: true,
      }
    );

    if (isDebug) {
      console.warn('[CredentialUtils:Linux:SecretService:Update] Successfully updated Secret Service credentials for attribute:', attribute);
    }

    // Clear cached credentials to ensure fresh values are read
    clearCredentialCache(configDir);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[CredentialUtils:Linux:SecretService:Update] Failed to update Secret Service credentials:', errorMessage);
    return { success: false, error: `Secret Service update failed: ${errorMessage}` };
  }
}

/**
 * Update credentials in Linux - tries Secret Service first, falls back to file
 */
function updateLinuxCredentials(
  configDir: string | undefined,
  credentials: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
  }
): UpdateCredentialsResult {
  const isDebug = process.env.DEBUG === 'true';

  // Try Secret Service first
  const secretToolPath = findSecretToolPath();
  if (secretToolPath) {
    const secretServiceResult = updateLinuxSecretServiceCredentials(configDir, credentials);
    if (secretServiceResult.success) {
      return secretServiceResult;
    }
    if (isDebug) {
      console.warn('[CredentialUtils:Linux:Update] Secret Service update failed, trying file fallback:', secretServiceResult.error);
    }
  }

  // Fall back to file-based storage
  return updateLinuxFileCredentials(configDir, credentials);
}

/**
 * Update credentials in Linux .credentials.json file with new tokens (fallback)
 */
function updateLinuxFileCredentials(
  configDir: string | undefined,
  credentials: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
  }
): UpdateCredentialsResult {
  const credentialsPath = getLinuxCredentialsPath(configDir);
  const isDebug = process.env.DEBUG === 'true';


  // Defense-in-depth: Validate credentials path
  if (!isValidCredentialsPath(credentialsPath)) {
    return { success: false, error: 'Invalid credentials path' };
  }

  try {
    // Read existing credentials to preserve email, subscriptionType, and rateLimitTier
    const existing = getFullCredentialsFromLinuxFile(configDir);

    // Build new credential JSON with all fields
    // IMPORTANT: Preserve subscriptionType and rateLimitTier from existing credentials
    const newCredentialData = {
      claudeAiOauth: {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt,
        scopes: credentials.scopes || existing.scopes || [],
        email: existing.email || undefined,
        emailAddress: existing.email || undefined,
        subscriptionType: existing.subscriptionType || undefined,
        rateLimitTier: existing.rateLimitTier || undefined
      },
      email: existing.email || undefined
    };

    const credentialsJson = JSON.stringify(newCredentialData, null, 2);

    // Ensure directory exists (matching Windows behavior)
    const dirPath = dirname(credentialsPath);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }

    // Write to file with secure permissions (0600)
    writeFileSync(credentialsPath, credentialsJson, { mode: 0o600, encoding: 'utf-8' });

    if (isDebug) {
      console.warn('[CredentialUtils:Linux:Update] Successfully updated credentials file:', credentialsPath);
    }

    // Clear cached credentials to ensure fresh values are read
    clearCredentialCache(configDir);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[CredentialUtils:Linux:Update] Failed to update credentials file:', errorMessage);
    return { success: false, error: `File update failed: ${errorMessage}` };
  }
}

/**
 * Update credentials in Windows Credential Manager with new tokens
 */
function updateWindowsCredentialManagerCredentials(
  configDir: string | undefined,
  credentials: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
  }
): UpdateCredentialsResult {
  const targetName = getWindowsCredentialTarget(configDir);
  const isDebug = process.env.DEBUG === 'true';

  // Defense-in-depth: Validate target name format
  if (!isValidTargetName(targetName)) {
    return { success: false, error: 'Invalid credential target name format' };
  }

  // Find PowerShell executable
  const psPath = findPowerShellPath();
  if (!psPath) {
    return { success: false, error: 'PowerShell not found' };
  }

  try {
    // Read existing credentials to preserve email, subscriptionType, and rateLimitTier
    const existing = getFullCredentialsFromWindowsCredentialManager(configDir);

    // Build new credential JSON with all fields
    // IMPORTANT: Preserve subscriptionType and rateLimitTier from existing credentials
    const newCredentialData = {
      claudeAiOauth: {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt,
        scopes: credentials.scopes || existing.scopes || [],
        email: existing.email || undefined,
        emailAddress: existing.email || undefined,
        subscriptionType: existing.subscriptionType || undefined,
        rateLimitTier: existing.rateLimitTier || undefined
      },
      email: existing.email || undefined
    };

    const credentialsJson = JSON.stringify(newCredentialData);
    // Use base64 encoding for maximum security - prevents all injection attacks
    const base64Json = encodeBase64ForPowerShell(credentialsJson);

    // PowerShell script to write to Credential Manager
    //
    // NOTE: This CREDENTIAL struct uses string types for TargetName, Comment, etc.
    // because CredWrite accepts data FROM us, and the .NET marshaler can automatically
    // convert string fields to the appropriate Unicode pointers when CALLING Windows APIs.
    // This differs from the CredRead struct (see getCredentialsFromWindowsCredentialManager)
    // which must use IntPtr because we're RECEIVING data from Windows and need to manually
    // marshal the strings from Windows-allocated memory.
    const psScript = `
      $ErrorActionPreference = 'Stop'

      # Use CredWrite from advapi32.dll to write generic credentials
      # This struct uses string types (auto-marshaled) unlike CredRead which needs IntPtr.
      $sig = @'
      [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
      public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
      }

      [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern bool CredWrite(ref CREDENTIAL credential, int flags);
'@
      Add-Type -MemberDefinition $sig -Namespace Win32 -Name Credential

      # Decode base64 JSON (more secure than string escaping)
      $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64Json}'))
      $jsonBytes = [System.Text.Encoding]::Unicode.GetBytes($json)
      $jsonPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($jsonBytes.Length)
      [System.Runtime.InteropServices.Marshal]::Copy($jsonBytes, 0, $jsonPtr, $jsonBytes.Length)

      try {
        $cred = New-Object Win32.Credential+CREDENTIAL
        $cred.Type = 1  # CRED_TYPE_GENERIC
        $cred.TargetName = "${escapePowerShellString(targetName)}"
        $cred.CredentialBlob = $jsonPtr
        $cred.CredentialBlobSize = $jsonBytes.Length
        $cred.Persist = 2  # CRED_PERSIST_LOCAL_MACHINE
        $cred.UserName = "claude-ai-oauth"

        $success = [Win32.Credential]::CredWrite([ref]$cred, 0)
        if (-not $success) {
          throw "CredWrite failed"
        }
        Write-Output "SUCCESS"
      } finally {
        [System.Runtime.InteropServices.Marshal]::FreeHGlobal($jsonPtr)
      }
    `;

    const result = execFileSync(
      psPath,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      {
        encoding: 'utf-8',
        timeout: WINDOWS_CREDMAN_TIMEOUT_MS,
        windowsHide: true,
      }
    );

    if (result.trim() !== 'SUCCESS') {
      return { success: false, error: 'Credential Manager update failed' };
    }

    if (isDebug) {
      console.warn('[CredentialUtils:Windows:Update] Successfully updated Credential Manager for target:', targetName);
    }

    // Clear cached credentials to ensure fresh values are read
    clearCredentialCache(configDir);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[CredentialUtils:Windows:Update] Failed to update Credential Manager:', errorMessage);
    return { success: false, error: `Credential Manager update failed: ${errorMessage}` };
  }
}

/**
 * Restrict Windows file permissions to current user only using icacls.
 * This is a best-effort operation - if it fails, we log a warning but don't fail the overall operation.
 *
 * @param filePath - Path to the file to secure
 */
function restrictWindowsFilePermissions(filePath: string): void {
  const isDebug = process.env.DEBUG === 'true';

  try {
    // Use icacls to:
    // 1. Disable inheritance and remove all inherited permissions (/inheritance:r)
    // 2. Grant full control to the current user only (/grant:r %USERNAME%:F)
    // This mimics Unix 0600 permissions (owner read/write only)
    const username = userInfo().username;

    // First, disable inheritance and remove inherited permissions
    execFileSync('icacls', [filePath, '/inheritance:r'], {
      windowsHide: true,
      timeout: 5000,
    });

    // Then grant full control to current user only
    execFileSync('icacls', [filePath, '/grant:r', `${username}:F`], {
      windowsHide: true,
      timeout: 5000,
    });

    if (isDebug) {
      console.warn('[CredentialUtils:Windows] Set restrictive permissions on:', filePath);
    }
  } catch (error) {
    // Non-fatal: log warning but don't fail the operation
    // The file is still protected by the user's home directory permissions
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[CredentialUtils:Windows] Could not set restrictive file permissions:', errorMessage);
  }
}

/**
 * Update credentials in Windows .credentials.json file with new tokens (fallback).
 *
 * This is the fallback method for Windows when Credential Manager is unavailable.
 * Claude CLI on Windows primarily uses file-based storage (.credentials.json),
 * so this fallback ensures credentials are persisted even if Credential Manager fails.
 *
 * Security: We use icacls to restrict file permissions to the current user only,
 * mimicking Unix 0600 permissions. This prevents other users on multi-user systems
 * from reading the OAuth tokens.
 *
 * @param configDir - Config directory for the profile (undefined for default profile)
 * @param credentials - New credentials to store
 * @returns Result indicating success or failure
 */
function updateWindowsFileCredentials(
  configDir: string | undefined,
  credentials: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
  }
): UpdateCredentialsResult {
  const credentialsPath = getWindowsCredentialsPath(configDir);
  const isDebug = process.env.DEBUG === 'true';

  // Defense-in-depth: Validate credentials path
  if (!isValidCredentialsPath(credentialsPath)) {
    return { success: false, error: 'Invalid credentials path' };
  }

  try {
    // Read existing credentials to preserve email and other fields
    const existing = getFullCredentialsFromWindowsFile(configDir);

    // Build new credential JSON with all fields
    const newCredentialData = {
      claudeAiOauth: {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt,
        scopes: credentials.scopes || existing.scopes || [],
        email: existing.email || undefined,
        emailAddress: existing.email || undefined,
        subscriptionType: existing.subscriptionType || undefined,
        rateLimitTier: existing.rateLimitTier || undefined
      },
      email: existing.email || undefined
    };

    const credentialsJson = JSON.stringify(newCredentialData, null, 2);

    // Ensure directory exists with secure permissions
    const dirPath = dirname(credentialsPath);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
      // Restrict directory permissions to current user only (mimics Unix 0700)
      restrictWindowsFilePermissions(dirPath);
    }

    // Atomic file write: write to temp file, set permissions, then rename.
    // This prevents a race condition where the file briefly exists with default permissions.
    const tempPath = `${credentialsPath}.${Date.now()}.tmp`;
    try {
      // Write to temp file
      writeFileSync(tempPath, credentialsJson, { encoding: 'utf-8' });

      // Restrict temp file permissions to current user only (mimics Unix 0600)
      restrictWindowsFilePermissions(tempPath);

      // Atomic rename (on same filesystem, this is atomic on Windows)
      renameSync(tempPath, credentialsPath);
    } catch (writeError) {
      // Clean up temp file on error
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      throw writeError;
    }

    if (isDebug) {
      console.warn('[CredentialUtils:Windows:Update] Successfully updated credentials file:', credentialsPath);
    }

    // Clear cached credentials to ensure fresh values are read
    clearCredentialCache(configDir);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[CredentialUtils:Windows:Update] Failed to update credentials file:', errorMessage);
    return { success: false, error: `File update failed: ${errorMessage}` };
  }
}

/**
 * Update credentials in Windows - writes to file FIRST (primary storage), then Credential Manager.
 *
 * Claude CLI on Windows primarily uses file-based storage (.credentials.json).
 * We write to file first to ensure Claude CLI always has the latest tokens,
 * then update Credential Manager for forward compatibility.
 *
 * IMPORTANT: The write order matters! If we wrote to Credential Manager first and file
 * write failed, Claude CLI would read stale tokens from the file while Credential Manager
 * has the new tokens - an inconsistent state. By writing to file first, we ensure the
 * primary storage is always up-to-date.
 *
 * @param configDir - Config directory for the profile (undefined for default profile)
 * @param credentials - New credentials to store
 * @returns Result indicating success or failure
 */
function updateWindowsCredentials(
  configDir: string | undefined,
  credentials: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
  }
): UpdateCredentialsResult {
  const isDebug = process.env.DEBUG === 'true';

  // Write to file FIRST - this is what Claude CLI reads on Windows
  const fileResult = updateWindowsFileCredentials(configDir, credentials);
  if (!fileResult.success) {
    // File write failed - don't proceed with Credential Manager to avoid inconsistent state
    console.error('[CredentialUtils:Windows:Update] File update failed:', fileResult.error);
    return fileResult;
  }

  // File write succeeded - now update Credential Manager for forward compatibility
  const psPath = findPowerShellPath();
  if (psPath) {
    const credManagerResult = updateWindowsCredentialManagerCredentials(configDir, credentials);
    if (!credManagerResult.success) {
      // Credential Manager failed but file succeeded - this is acceptable
      // Claude CLI will use the file, which has the latest tokens
      if (isDebug) {
        console.warn('[CredentialUtils:Windows:Update] Credential Manager update failed (file update succeeded):', credManagerResult.error);
      }
    }
  }

  // Return success since file (primary storage) was updated successfully
  return { success: true };
}

/**
 * Update credentials in the platform-specific secure storage with new tokens.
 * Called after a successful OAuth token refresh to persist the new tokens.
 *
 * CRITICAL: This must be called immediately after token refresh because the old tokens
 * are revoked by Anthropic as soon as new tokens are issued.
 *
 * @param configDir - Config directory for the profile (undefined for default profile)
 * @param credentials - New credentials to store
 * @returns Result indicating success or failure
 */
export function updateKeychainCredentials(
  configDir: string | undefined,
  credentials: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
  }
): UpdateCredentialsResult {
  if (isMacOS()) {
    return updateMacOSKeychainCredentials(configDir, credentials);
  }

  if (isLinux()) {
    return updateLinuxCredentials(configDir, credentials);
  }

  if (isWindows()) {
    return updateWindowsCredentials(configDir, credentials);
  }

  return { success: false, error: `Unsupported platform: ${process.platform}` };
}

// =============================================================================
// Profile Subscription Metadata Helper
// =============================================================================

/**
 * Result of updating profile subscription metadata
 */
export interface UpdateSubscriptionMetadataResult {
  /** Whether subscriptionType was updated */
  subscriptionTypeUpdated: boolean;
  /** Whether rateLimitTier was updated */
  rateLimitTierUpdated: boolean;
  /** The subscriptionType value (if found) */
  subscriptionType?: string | null;
  /** The rateLimitTier value (if found) */
  rateLimitTier?: string | null;
}

/**
 * Options for updateProfileSubscriptionMetadata
 */
export interface UpdateSubscriptionMetadataOptions {
  /**
   * If true, only update fields that are currently missing (undefined/null/empty).
   * This is useful for migration/initialization code that should not overwrite existing values.
   * Default: false (always update if credentials have values)
   */
  onlyIfMissing?: boolean;
}

/**
 * Update a profile's subscription metadata (subscriptionType, rateLimitTier) from Keychain credentials.
 *
 * This helper centralizes the common pattern of reading subscription info from Keychain
 * and updating a profile object. It's used after OAuth login, onboarding completion,
 * and profile authentication verification.
 *
 * NOTE: This function mutates the profile object directly. The caller is responsible
 * for saving the profile after calling this function.
 *
 * @param profile - The profile object to update (must have subscriptionType and rateLimitTier properties)
 * @param configDirOrCredentials - Either a config directory path to read credentials from,
 *                                  or pre-fetched FullOAuthCredentials to avoid redundant reads
 * @param options - Optional settings like onlyIfMissing
 * @returns Information about what was updated
 *
 * @example
 * ```typescript
 * // Option 1: Pass configDir - helper fetches credentials
 * const result = updateProfileSubscriptionMetadata(profile, profile.configDir);
 *
 * // Option 2: Pass pre-fetched credentials (more efficient when already fetched)
 * const fullCreds = getFullCredentialsFromKeychain(profile.configDir);
 * const result = updateProfileSubscriptionMetadata(profile, fullCreds);
 *
 * // Option 3: Only populate if missing (for migration/initialization)
 * const result = updateProfileSubscriptionMetadata(profile, profile.configDir, { onlyIfMissing: true });
 *
 * if (result.subscriptionTypeUpdated || result.rateLimitTierUpdated) {
 *   profileManager.saveProfile(profile);
 * }
 * ```
 */
export function updateProfileSubscriptionMetadata(
  profile: { subscriptionType?: string | null; rateLimitTier?: string | null },
  configDirOrCredentials: string | undefined | FullOAuthCredentials,
  options?: UpdateSubscriptionMetadataOptions
): UpdateSubscriptionMetadataResult {
  const result: UpdateSubscriptionMetadataResult = {
    subscriptionTypeUpdated: false,
    rateLimitTierUpdated: false,
  };

  const onlyIfMissing = options?.onlyIfMissing ?? false;

  // Determine if we received pre-fetched credentials or a configDir
  const fullCreds: FullOAuthCredentials =
    typeof configDirOrCredentials === 'object' && configDirOrCredentials !== null
      ? configDirOrCredentials
      : getFullCredentialsFromKeychain(configDirOrCredentials);

  // Update subscriptionType if credentials have it and (not onlyIfMissing OR profile doesn't have it)
  if (fullCreds.subscriptionType && (!onlyIfMissing || !profile.subscriptionType)) {
    profile.subscriptionType = fullCreds.subscriptionType;
    result.subscriptionTypeUpdated = true;
    result.subscriptionType = fullCreds.subscriptionType;
  }

  // Update rateLimitTier if credentials have it and (not onlyIfMissing OR profile doesn't have it)
  if (fullCreds.rateLimitTier && (!onlyIfMissing || !profile.rateLimitTier)) {
    profile.rateLimitTier = fullCreds.rateLimitTier;
    result.rateLimitTierUpdated = true;
    result.rateLimitTier = fullCreds.rateLimitTier;
  }

  return result;
}
