/**
 * GitHub utility functions
 */

import { existsSync, readFileSync } from 'fs';
import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type { Project } from '../../../shared/types';
import { parseEnvFile } from '../utils';
import type { GitHubConfig } from './types';
import { getAugmentedEnv } from '../../env-utils';
import { getToolPath } from '../../cli-tool-manager';

const execFileAsync = promisify(execFile);

/**
 * ETag cache entry
 */
interface ETagCacheEntry {
  etag: string;
  data: unknown;
  lastUpdated: Date;
}

/**
 * Result from githubFetchWithETag
 */
export interface GitHubFetchWithETagResult {
  data: unknown;
  fromCache: boolean;
  rateLimitInfo?: {
    limit: number;
    remaining: number;
    resetAt: Date;
  };
}

/**
 * In-memory ETag cache for GitHub API responses
 * Key: URL, Value: ETag entry with data and timestamp
 */
const etagCache: Record<string, ETagCacheEntry> = {};

/**
 * Counter for tracking cache writes to trigger periodic eviction
 * Evicts stale entries every ETAG_EVICTION_INTERVAL writes
 */
let evictionWriteCounter = 0;

/**
 * Number of cache writes between evictions
 */
const ETAG_EVICTION_INTERVAL = 100;

/**
 * Extract rate limit info from GitHub API response headers
 */
function extractRateLimitInfo(response: Response): {
  limit: number;
  remaining: number;
  resetAt: Date;
} | undefined {
  const limit = response.headers.get('X-RateLimit-Limit');
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');

  if (limit && remaining && reset) {
    return {
      limit: parseInt(limit, 10),
      remaining: parseInt(remaining, 10),
      resetAt: new Date(parseInt(reset, 10) * 1000)
    };
  }
  return undefined;
}

/**
 * Evict stale cache entries older than 1 hour
 */
function evictStaleCacheEntries(): void {
  const now = new Date();
  const oneHour = 60 * 60 * 1000;

  for (const url in etagCache) {
    const entry = etagCache[url];
    const age = now.getTime() - entry.lastUpdated.getTime();
    if (age > oneHour) {
      delete etagCache[url];
    }
  }
}

/**
 * Sanitize token value to prevent control character injection.
 * Removes ASCII control characters (0x00-0x1F, 0x7F) while preserving
 * valid token characters (alphanumeric, punctuation).
 */
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

/**
 * Get GitHub token from gh CLI if available (async to avoid blocking main thread)
 * Uses augmented PATH to find gh CLI in common locations (e.g., Homebrew on macOS)
 */
async function getTokenFromGhCliAsync(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(getToolPath('gh'), ['auth', 'token'], {
      encoding: 'utf-8',
      env: getAugmentedEnv()
    });
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Get GitHub token from gh CLI if available (sync version for getGitHubConfig)
 * Uses augmented PATH to find gh CLI in common locations (e.g., Homebrew on macOS)
 */
function getTokenFromGhCliSync(): string | null {
  try {
    const token = execFileSync(getToolPath('gh'), ['auth', 'token'], {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: getAugmentedEnv()
    }).trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Get a fresh GitHub token for subprocess use (async to avoid blocking main thread)
 * Always fetches fresh from gh CLI - no caching to ensure account changes are reflected
 * @returns The current GitHub token or null if not authenticated
 */
export async function getGitHubTokenForSubprocess(): Promise<string | null> {
  return getTokenFromGhCliAsync();
}

/**
 * Get GitHub configuration from project environment file
 * Falls back to gh CLI token if GITHUB_TOKEN not in .env
 */
export function getGitHubConfig(project: Project): GitHubConfig | null {
  if (!project.autoBuildPath) return null;
  const envPath = path.join(project.path, project.autoBuildPath, '.env');
  if (!existsSync(envPath)) return null;

  try {
    const content = readFileSync(envPath, 'utf-8');
    const vars = parseEnvFile(content);
    let token: string | undefined = vars['GITHUB_TOKEN'];
    const repo = vars['GITHUB_REPO'];

    // If no token in .env, try to get it from gh CLI (sync version for sync function)
    if (!token) {
      const ghToken = getTokenFromGhCliSync();
      if (ghToken) {
        token = ghToken;
      }
    }

    if (!token || !repo) return null;
    return { token, repo };
  } catch {
    return null;
  }
}

/**
 * Normalize a GitHub repository reference to owner/repo format
 * Handles:
 * - owner/repo (already normalized)
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 */
export function normalizeRepoReference(repo: string): string {
  if (!repo) return '';

  // Remove trailing .git if present
  let normalized = repo.replace(/\.git$/, '');

  // Handle full GitHub URLs
  if (normalized.startsWith('https://github.com/')) {
    normalized = normalized.replace('https://github.com/', '');
  } else if (normalized.startsWith('http://github.com/')) {
    normalized = normalized.replace('http://github.com/', '');
  } else if (normalized.startsWith('git@github.com:')) {
    normalized = normalized.replace('git@github.com:', '');
  }

  return normalized.trim();
}

/**
 * Make a request to the GitHub API
 */
export async function githubFetch(
  token: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  // Sanitize token to prevent control character injection
  const safeToken = sanitizeToken(token);
  if (!safeToken) {
    throw new Error('Invalid GitHub token');
  }

  // Validate endpoint: either relative path or trusted GitHub URL
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://api.github.com${endpoint}`;

  // Security check: ensure URL points to github.com or api.github.com
  if (url.startsWith('http')) {
    const allowedHosts = ['github.com', 'api.github.com', 'gist.github.com'];
    let urlHost: string;
    try {
      urlHost = new URL(url).host;
    } catch {
      throw new Error(`Invalid GitHub URL: ${url}`);
    }
    // Check if the host ends with one of the allowed hosts (supports subdomains)
    const isAllowed = allowedHosts.some(allowed =>
      urlHost === allowed || urlHost.endsWith(`.${allowed}`)
    );
    if (!isAllowed) {
      throw new Error(`Unauthorized GitHub host: ${urlHost}`);
    }
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${safeToken}`,
      'User-Agent': 'Auto-Claude-UI',
      ...options.headers
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} - Request failed`);
  }

  return response.json();
}

/**
 * Make a request to the GitHub API with ETag caching support
 * Uses If-None-Match header for conditional requests.
 * Returns 304 responses from cache without counting against rate limit.
 */
export async function githubFetchWithETag(
  token: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<GitHubFetchWithETagResult> {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://api.github.com${endpoint}`;

  const cached = etagCache[url];
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'Auto-Claude-UI'
  };

  // Add If-None-Match header if we have a cached ETag
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers
    }
  });

  const rateLimitInfo = extractRateLimitInfo(response);

  // Handle 304 Not Modified - return cached data
  if (response.status === 304 && cached) {
    return {
      data: cached.data,
      fromCache: true,
      rateLimitInfo
    };
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} - Request failed`);
  }

  const data = await response.json();

  // Store new ETag if present
  const newETag = response.headers.get('ETag');
  if (newETag) {
    etagCache[url] = {
      etag: newETag,
      data,
      lastUpdated: new Date()
    };
    evictionWriteCounter++;
    if (evictionWriteCounter >= ETAG_EVICTION_INTERVAL) {
      evictionWriteCounter = 0;
      evictStaleCacheEntries();
    }
  }

  return {
    data,
    fromCache: false,
    rateLimitInfo
  };
}

/**
 * Clear all ETag cache entries for a specific project
 * @param projectId - The project identifier to clear cache for
 */
export function clearETagCacheForProject(projectId: string): void {
  const urlsToDelete: string[] = [];

  for (const url in etagCache) {
    // Match URLs that contain the project ID
    if (url.includes(projectId)) {
      urlsToDelete.push(url);
    }
  }

  for (const url of urlsToDelete) {
    delete etagCache[url];
  }
}
