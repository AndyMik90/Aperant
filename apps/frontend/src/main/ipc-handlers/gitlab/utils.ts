/**
 * GitLab utility functions
 */

import { readFile, access } from 'fs/promises';
import { execFileSync } from 'child_process';
import path from 'path';
import { Agent as UndiciAgent } from 'undici';
import type { Project } from '../../../shared/types';
import { parseEnvFile } from '../utils';
import type { GitLabConfig } from './types';
import { getAugmentedEnv } from '../../env-utils';
import { getIsolatedGitEnv } from '../../utils/git-isolation';

const DEFAULT_GITLAB_URL = 'https://gitlab.com';

// ============================================
// SSL Verification Cache
// ============================================
// Maps instanceUrl → sslVerify setting, populated by getGitLabConfig().
// gitlabFetch() reads from this cache so callers don't need to thread the option.
const sslVerifyCache = new Map<string, boolean>();

/**
 * Store the SSL verify preference for an instance URL.
 * Called internally by getGitLabConfig().
 */
function cacheSslVerify(instanceUrl: string, verify: boolean): void {
  sslVerifyCache.set(instanceUrl, verify);
}

/**
 * Look up the SSL verify preference for an instance URL (defaults to true).
 * Populated by getGitLabConfig() — must be called before gitlabFetch() for the
 * setting to take effect.
 */
export function getSslVerify(instanceUrl: string): boolean {
  return sslVerifyCache.get(instanceUrl) ?? true;
}

// ============================================
// Error Extraction
// ============================================

// Known TLS error codes — hoisted to module scope to avoid re-allocation per call.
const SSL_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_UNTRUSTED',
]);

/**
 * Extract a human-readable error message from a fetch failure.
 *
 * Node.js fetch (undici) wraps network-level errors in a TypeError with
 * message "fetch failed" and the real cause in error.cause.  This helper
 * digs into the cause chain to surface SSL, DNS, and connectivity errors
 * so users actually know what went wrong with self-hosted instances.
 */
function extractFetchErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  // Dig into error.cause (Node.js fetch wraps network errors)
  const cause = (error as Error & { cause?: Error & { code?: string } }).cause;
  if (cause instanceof Error) {
    const causeMsg = cause.message || '';
    const causeCode = cause.code || '';

    // SSL / TLS certificate errors — check code first (more reliable), then message
    if (
      SSL_ERROR_CODES.has(causeCode) ||
      causeMsg.includes('SELF_SIGNED_CERT') ||
      causeMsg.includes('unable to verify the first certificate')
    ) {
      return (
        `SSL/TLS certificate error: ${causeMsg}. ` +
        'For self-hosted GitLab with self-signed or internal CA certificates, ' +
        'set GITLAB_SSL_VERIFY=false in your .env file, or set the NODE_EXTRA_CA_CERTS ' +
        'environment variable to point to your CA bundle.'
      );
    }

    // DNS resolution failure
    if (causeCode === 'ENOTFOUND' || causeMsg.includes('getaddrinfo')) {
      return (
        `DNS resolution failed: ${causeMsg}. ` +
        'Verify the GITLAB_INSTANCE_URL is correct and the hostname is reachable from this machine.'
      );
    }

    // Connection refused
    if (causeCode === 'ECONNREFUSED') {
      return (
        `Connection refused: ${causeMsg}. ` +
        'The GitLab instance is not accepting connections on the expected port. ' +
        'Check the GITLAB_INSTANCE_URL and ensure the server is running.'
      );
    }

    // Connection reset / broken pipe
    if (causeCode === 'ECONNRESET' || causeCode === 'EPIPE') {
      return `Connection reset: ${causeMsg}. The server closed the connection unexpectedly.`;
    }

    // Network unreachable / timeout
    if (causeCode === 'ETIMEDOUT' || causeCode === 'ENETUNREACH') {
      return (
        `Network unreachable or timed out: ${causeMsg}. ` +
        'Check network connectivity, VPN, proxy, and firewall settings.'
      );
    }

    // Generic cause — still more useful than bare "fetch failed"
    return `${error.message}: ${causeMsg}`;
  }

  // No cause — return the original message (may still be "fetch failed")
  return error.message;
}

function parseInstanceUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeInstanceUrl(value: string | undefined): string | null {
  const candidate = value || DEFAULT_GITLAB_URL;
  return parseInstanceUrl(candidate);
}

function sanitizeToken(value: string | undefined): string | null {
  if (!value) return null;
  let sanitized = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1F || code === 0x7F) {
      continue;
    }
    sanitized += value[i];
  }
  const trimmed = sanitized.trim();
  if (!trimmed) return null;
  return trimmed.length > 512 ? trimmed.substring(0, 512) : trimmed;
}

// Max length for project references (group/project paths)
// GitLab limits project paths to 255 chars, using 1024 as defense-in-depth
const MAX_PROJECT_REF_LENGTH = 1024;

function sanitizeProjectRef(value: string | undefined): string | null {
  if (!value) return null;
  let sanitized = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1F || code === 0x7F) {
      continue;
    }
    sanitized += value[i];
  }
  const trimmed = sanitized.trim();
  if (!trimmed) return null;
  // Reject excessively long inputs as defense-in-depth
  if (trimmed.length > MAX_PROJECT_REF_LENGTH) return null;
  return trimmed;
}

/**
 * Get GitLab token from glab CLI if available
 * Uses augmented PATH to find glab CLI in common locations
 */
function getTokenFromGlabCli(instanceUrl?: string): string | null {
  try {
    // glab auth token outputs the token for the current authenticated host
    const args = ['auth', 'token'];
    if (instanceUrl) {
      const normalized = parseInstanceUrl(instanceUrl);
      if (normalized) {
        const hostname = new URL(normalized).hostname;
        if (hostname !== 'gitlab.com') {
          // For self-hosted, specify the hostname
          args.push('--hostname', hostname);
        }
      }
    }

    const token = execFileSync('glab', args, {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: getAugmentedEnv()
    }).trim();
    return token || null;
  } catch {
    return null;
  }
}

// GitLab environment variable keys (must match env-handlers.ts)
const GITLAB_ENV_KEYS = {
  ENABLED: 'GITLAB_ENABLED',
  TOKEN: 'GITLAB_TOKEN',
  INSTANCE_URL: 'GITLAB_INSTANCE_URL',
  PROJECT: 'GITLAB_PROJECT',
  SSL_VERIFY: 'GITLAB_SSL_VERIFY'
} as const;

/**
 * Check if a file exists (async)
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get GitLab configuration from project environment file
 * Falls back to glab CLI token if GITLAB_TOKEN not in .env
 * Returns null if GitLab is explicitly disabled via GITLAB_ENABLED=false
 */
export async function getGitLabConfig(project: Project): Promise<GitLabConfig | null> {
  if (!project.autoBuildPath) return null;
  const envPath = path.join(project.path, project.autoBuildPath, '.env');
  if (!(await fileExists(envPath))) return null;

  try {
    const content = await readFile(envPath, 'utf-8');
    const vars = parseEnvFile(content);

    // Check if GitLab is explicitly disabled
    if (vars[GITLAB_ENV_KEYS.ENABLED]?.toLowerCase() === 'false') {
      return null;
    }

    let token = sanitizeToken(vars[GITLAB_ENV_KEYS.TOKEN]);
    const projectRef = sanitizeProjectRef(vars[GITLAB_ENV_KEYS.PROJECT]);
    const instanceUrl = normalizeInstanceUrl(vars[GITLAB_ENV_KEYS.INSTANCE_URL]);
    if (!instanceUrl) return null;

    // SSL verification: default true, set GITLAB_SSL_VERIFY=false to disable
    const sslVerifyRaw = vars[GITLAB_ENV_KEYS.SSL_VERIFY]?.toLowerCase();
    const sslVerify = sslVerifyRaw !== 'false' && sslVerifyRaw !== '0';

    // Cache the SSL setting so gitlabFetch() can look it up by instanceUrl
    cacheSslVerify(instanceUrl, sslVerify);

    if (!sslVerify) {
      console.warn(
        `[GitLab] SSL verification disabled for ${instanceUrl}. ` +
        'This is intended for self-hosted instances with self-signed certificates.'
      );
    }

    // If no token in .env, try to get it from glab CLI
    if (!token) {
      const glabToken = sanitizeToken(getTokenFromGlabCli(instanceUrl) ?? undefined);
      if (glabToken) {
        token = glabToken;
      }
    }

    if (!token || !projectRef) return null;
    return { token, instanceUrl, project: projectRef, sslVerify };
  } catch {
    return null;
  }
}

/**
 * Normalize a GitLab project reference to group/project format
 * Handles:
 * - group/project (already normalized)
 * - group/subgroup/project (nested groups)
 * - https://gitlab.com/group/project
 * - https://gitlab.com/group/project.git
 * - git@gitlab.com:group/project.git
 * - Numeric project ID (returns as-is)
 */
export function normalizeProjectReference(project: string, instanceUrl: string = DEFAULT_GITLAB_URL): string {
  if (!project) return '';

  // If it's a numeric ID, return as-is
  if (/^\d+$/.test(project)) {
    return project;
  }

  // Remove trailing .git if present
  let normalized = project.replace(/\.git$/, '');

  // Extract hostname for comparison
  let gitlabHostname: string;
  try {
    gitlabHostname = new URL(instanceUrl).hostname;
  } catch {
    gitlabHostname = 'gitlab.com';
  }

  // Escape special regex characters in hostname to prevent ReDoS
  const escapedHostname = gitlabHostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Handle full GitLab URLs
  const httpsPattern = new RegExp(`^https?://${escapedHostname}/`);
  if (httpsPattern.test(normalized)) {
    normalized = normalized.replace(httpsPattern, '');
  } else if (normalized.startsWith(`git@${gitlabHostname}:`)) {
    normalized = normalized.replace(`git@${gitlabHostname}:`, '');
  }

  return normalized.trim();
}

/**
 * URL-encode a project path for GitLab API
 * GitLab API requires project paths to be URL-encoded (e.g., group%2Fproject)
 */
export function encodeProjectPath(projectPath: string): string {
  // If it's a numeric ID, return as-is
  if (/^\d+$/.test(projectPath)) {
    return projectPath;
  }
  return encodeURIComponent(projectPath);
}

// Default timeout for GitLab API requests (30 seconds)
const GITLAB_API_TIMEOUT_MS = 30000;

// ============================================
// Per-request SSL bypass via undici Agent
// ============================================
// Node.js built-in fetch() is undici-based and supports a `dispatcher` option
// to control TLS per-request, avoiding mutation of global process.env.

// Lazy singleton — created on first use, reused for all insecure requests.
let insecureDispatcher: UndiciAgent | undefined;

/**
 * Return a fetch `dispatcher` that skips TLS certificate verification.
 * Returns `undefined` when SSL verification is enabled (use default behavior).
 */
function getInsecureDispatcher(): UndiciAgent | undefined {
  if (insecureDispatcher) return insecureDispatcher;
  insecureDispatcher = new UndiciAgent({ connect: { rejectUnauthorized: false } });
  return insecureDispatcher;
}

/**
 * Validate inputs and build a fully-resolved URL for a GitLab API endpoint.
 * Shared by gitlabFetch and gitlabFetchWithCount.
 */
function resolveApiRequest(
  token: string,
  instanceUrl: string,
  endpoint: string
): { url: string; baseUrl: string; safeToken: string } {
  const baseUrl = parseInstanceUrl(instanceUrl);
  if (!baseUrl) {
    throw new Error('Invalid GitLab instance URL');
  }
  if (!endpoint.startsWith('/')) {
    throw new Error('GitLab endpoint must be a relative path');
  }
  const safeToken = sanitizeToken(token);
  if (!safeToken) {
    throw new Error('Invalid GitLab token');
  }
  return { url: `${baseUrl}/api/v4${endpoint}`, baseUrl, safeToken };
}

/**
 * Build the fetch init object with headers, signal, and optional SSL bypass dispatcher.
 * Widens RequestInit with Record<string, unknown> to allow undici's non-standard
 * `dispatcher` property. Do not remove the widening — see getInsecureDispatcher().
 */
function buildFetchInit(
  options: RequestInit,
  signal: AbortSignal,
  safeToken: string,
  sslVerify: boolean
): RequestInit & Record<string, unknown> {
  const init: RequestInit & Record<string, unknown> = {
    ...options,
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      'PRIVATE-TOKEN': safeToken
    }
  };
  if (!sslVerify) {
    init.dispatcher = getInsecureDispatcher();
  }
  return init;
}

/**
 * Handle errors from a GitLab API fetch call.
 * Only applies network-error extraction to actual fetch failures (TypeError "fetch failed");
 * HTTP-level errors (4xx/5xx) are re-thrown as-is since they already have clear messages.
 */
function handleFetchError(error: unknown, url: string, endpoint: string): never {
  if (error instanceof Error && error.name === 'AbortError') {
    throw new Error(`GitLab API timeout after ${GITLAB_API_TIMEOUT_MS / 1000}s: ${url}`);
  }
  // Only extract cause for network-level fetch failures (SSL, DNS, connection errors).
  // HTTP errors (4xx/5xx) already have clear messages and don't need rewriting.
  // Check for 'cause' in error alongside message since the exact "fetch failed" text is an implementation detail.
  if (error instanceof TypeError && (error.message === 'fetch failed' || 'cause' in error)) {
    const message = extractFetchErrorMessage(error);
    console.warn(`[GitLab] Network error: ${endpoint} → ${message}`);
    throw new Error(message, { cause: error });
  }
  throw error;
}

/**
 * Make a request to the GitLab API with timeout
 */
export async function gitlabFetch(
  token: string,
  instanceUrl: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  const { url, baseUrl, safeToken } = resolveApiRequest(token, instanceUrl, endpoint);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITLAB_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      url,
      buildFetchInit(options, controller.signal, safeToken, getSslVerify(baseUrl))
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitLab API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    return response.json();
  } catch (error) {
    handleFetchError(error, url, endpoint);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make a request to the GitLab API and return both data and total count from headers
 * Useful for paginated endpoints where we need the total count
 */
export async function gitlabFetchWithCount(
  token: string,
  instanceUrl: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: unknown; totalCount: number }> {
  const { url, baseUrl, safeToken } = resolveApiRequest(token, instanceUrl, endpoint);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITLAB_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      url,
      buildFetchInit(options, controller.signal, safeToken, getSslVerify(baseUrl))
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitLab API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    // Get total count from X-Total header (GitLab's pagination header)
    const totalCountHeader = response.headers.get('X-Total');
    const totalCount = totalCountHeader ? parseInt(totalCountHeader, 10) : 0;

    const data = await response.json();
    return { data, totalCount };
  } catch (error) {
    handleFetchError(error, url, endpoint);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get project ID from a project path
 * GitLab API can work with either numeric IDs or URL-encoded paths
 */
export async function getProjectIdFromPath(
  token: string,
  instanceUrl: string,
  pathWithNamespace: string
): Promise<number> {
  const encodedPath = encodeProjectPath(pathWithNamespace);
  const project = await gitlabFetch(token, instanceUrl, `/projects/${encodedPath}`) as { id: number };
  return project.id;
}

/**
 * Detect GitLab project from git remote URL
 */
export function detectGitLabProjectFromRemote(projectPath: string): { project: string; instanceUrl: string } | null {
  try {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe',
      env: getIsolatedGitEnv()
    }).trim();

    if (!remoteUrl) return null;

    // Parse the remote URL to extract instance URL and project path
    let instanceUrl = DEFAULT_GITLAB_URL;
    let project = '';

    // SSH format: git@gitlab.example.com:group/project.git
    const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) {
      instanceUrl = `https://${sshMatch[1]}`;
      project = sshMatch[2];
    }

    // HTTPS format: https://gitlab.example.com/group/project.git
    const httpsMatch = remoteUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      instanceUrl = `https://${httpsMatch[1]}`;
      project = httpsMatch[2];
    }

    if (project) {
      return { project, instanceUrl };
    }

    return null;
  } catch {
    return null;
  }
}
