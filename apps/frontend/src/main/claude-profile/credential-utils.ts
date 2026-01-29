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
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir, userInfo } from 'os';
import { join } from 'path';
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
  const normalizedConfigDir = configDir.startsWith('~')
    ? join(homedir(), configDir.slice(1))
    : configDir;

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
  identifier: string
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
  const isDebug = process.env.DEBUG === 'true';
  const now = Date.now();

  // Return cached credentials if available and fresh
  const cached = credentialCache.get(cacheKey);
  if (!forceRefresh && cached) {
    const ttl = cached.credentials.error ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS;
    if ((now - cached.timestamp) < ttl) {
      if (isDebug) {
        const cacheAge = now - cached.timestamp;
        console.warn('[CredentialUtils:Linux:CACHE] Returning cached credentials:', {
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
      console.warn('[CredentialUtils:Linux] Invalid credentials path rejected:', { credentialsPath });
    }
    const invalidResult = { token: null, email: null, error: 'Invalid credentials path' };
    credentialCache.set(cacheKey, { credentials: invalidResult, timestamp: now });
    return invalidResult;
  }

  // Check if credentials file exists
  if (!existsSync(credentialsPath)) {
    if (isDebug) {
      console.warn('[CredentialUtils:Linux] Credentials file not found:', credentialsPath);
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
      console.warn('[CredentialUtils:Linux] Failed to parse credentials JSON:', credentialsPath);
      const errorResult = { token: null, email: null };
      credentialCache.set(cacheKey, { credentials: errorResult, timestamp: now });
      return errorResult;
    }

    // Validate JSON structure
    if (!validateCredentialData(data)) {
      console.warn('[CredentialUtils:Linux] Invalid credentials data structure:', credentialsPath);
      const invalidResult = { token: null, email: null };
      credentialCache.set(cacheKey, { credentials: invalidResult, timestamp: now });
      return invalidResult;
    }

    const { token, email } = extractCredentials(data);

    // Validate token format if present
    if (token && !isValidTokenFormat(token)) {
      console.warn('[CredentialUtils:Linux] Invalid token format in:', credentialsPath);
      const result = { token: null, email };
      credentialCache.set(cacheKey, { credentials: result, timestamp: now });
      return result;
    }

    const credentials = { token, email };
    credentialCache.set(cacheKey, { credentials, timestamp: now });

    if (isDebug) {
      console.warn('[CredentialUtils:Linux] Retrieved credentials from file:', credentialsPath, {
        hasToken: !!token,
        hasEmail: !!email,
        tokenFingerprint: getTokenFingerprint(token),
        forceRefresh
      });
    }
    return credentials;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[CredentialUtils:Linux] Failed to read credentials file:', credentialsPath, errorMessage);
    const errorResult = { token: null, email: null, error: `Failed to read credentials: ${errorMessage}` };
    credentialCache.set(cacheKey, { credentials: errorResult, timestamp: now });
    return errorResult;
  }
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
    const psScript = `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.Runtime.WindowsRuntime

      # Use CredRead from advapi32.dll to read generic credentials
      $sig = @'
      [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

      [DllImport("advapi32.dll", SetLastError = true)]
      public static extern bool CredFree(IntPtr cred);
'@
      Add-Type -MemberDefinition $sig -Namespace Win32 -Name Credential

      $credPtr = [IntPtr]::Zero
      # CRED_TYPE_GENERIC = 1
      $success = [Win32.Credential]::CredRead("${escapePowerShellString(targetName)}", 1, 0, [ref]$credPtr)

      if ($success) {
        try {
          $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [Type][System.Management.Automation.PSCredential].Assembly.GetType('Microsoft.PowerShell.Commands.CREDENTIAL'))

          # Read the credential blob (password field)
          $blobSize = $cred.CredentialBlobSize
          if ($blobSize -gt 0) {
            $blob = [byte[]]::new($blobSize)
            [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blob, 0, $blobSize)
            $password = [System.Text.Encoding]::Unicode.GetString($blob)
            Write-Output $password
          }
        } finally {
          [Win32.Credential]::CredFree($credPtr) | Out-Null
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
// Cross-Platform Public API
// =============================================================================

/**
 * Retrieve Claude Code OAuth credentials (token and email) from platform-specific
 * secure storage.
 *
 * - macOS: Reads from Keychain
 * - Linux: Reads from .credentials.json file
 * - Windows: Reads from Windows Credential Manager
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
    return getCredentialsFromWindowsCredentialManager(configDir, forceRefresh);
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

    credentialCache.delete(macOSKey);
    credentialCache.delete(linuxSecretKey);
    credentialCache.delete(linuxFileKey);
    credentialCache.delete(windowsKey);
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
  const isDebug = process.env.DEBUG === 'true';

  // Defense-in-depth: Validate credentials path is within expected boundaries
  if (!isValidCredentialsPath(credentialsPath)) {
    if (isDebug) {
      console.warn('[CredentialUtils:Linux:Full] Invalid credentials path rejected:', { credentialsPath });
    }
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: 'Invalid credentials path' };
  }

  // Check if credentials file exists
  if (!existsSync(credentialsPath)) {
    if (isDebug) {
      console.warn('[CredentialUtils:Linux:Full] Credentials file not found:', credentialsPath);
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
      console.warn('[CredentialUtils:Linux:Full] Failed to parse credentials JSON:', credentialsPath);
      return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null };
    }

    // Validate JSON structure
    if (!validateCredentialData(data)) {
      console.warn('[CredentialUtils:Linux:Full] Invalid credentials data structure:', credentialsPath);
      return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null };
    }

    const { token, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier } = extractFullCredentials(data);

    // Validate token format if present
    if (token && !isValidTokenFormat(token)) {
      console.warn('[CredentialUtils:Linux:Full] Invalid token format in:', credentialsPath);
      return { token: null, email, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier };
    }

    if (isDebug) {
      console.warn('[CredentialUtils:Linux:Full] Retrieved full credentials from file:', credentialsPath, {
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
    console.warn('[CredentialUtils:Linux:Full] Failed to read credentials file:', credentialsPath, errorMessage);
    return { token: null, email: null, refreshToken: null, expiresAt: null, scopes: null, subscriptionType: null, rateLimitTier: null, error: `Failed to read credentials: ${errorMessage}` };
  }
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
    const psScript = `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.Runtime.WindowsRuntime

      # Use CredRead from advapi32.dll to read generic credentials
      $sig = @'
      [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

      [DllImport("advapi32.dll", SetLastError = true)]
      public static extern bool CredFree(IntPtr cred);
'@
      Add-Type -MemberDefinition $sig -Namespace Win32 -Name Credential

      $credPtr = [IntPtr]::Zero
      # CRED_TYPE_GENERIC = 1
      $success = [Win32.Credential]::CredRead("${escapePowerShellString(targetName)}", 1, 0, [ref]$credPtr)

      if ($success) {
        try {
          $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [Type][System.Management.Automation.PSCredential].Assembly.GetType('Microsoft.PowerShell.Commands.CREDENTIAL'))

          # Read the credential blob (password field)
          $blobSize = $cred.CredentialBlobSize
          if ($blobSize -gt 0) {
            $blob = [byte[]]::new($blobSize)
            [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blob, 0, $blobSize)
            $password = [System.Text.Encoding]::Unicode.GetString($blob)
            Write-Output $password
          }
        } finally {
          [Win32.Credential]::CredFree($credPtr) | Out-Null
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
    return getFullCredentialsFromWindowsCredentialManager(configDir);
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
    const psScript = `
      $ErrorActionPreference = 'Stop'

      # Use CredWrite from advapi32.dll to write generic credentials
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
    return updateWindowsCredentialManagerCredentials(configDir, credentials);
  }

  return { success: false, error: `Unsupported platform: ${process.platform}` };
}
