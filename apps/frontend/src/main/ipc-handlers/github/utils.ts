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
 * ETag cache entry for conditional requests
 */
export interface ETagCacheEntry {
  etag: string;
  data: unknown;
  lastUpdated: Date;
}

/**
 * ETag cache for storing conditional request data
 */
export interface ETagCache {
  [url: string]: ETagCacheEntry;
}

/**
 * Rate limit information extracted from GitHub API response headers
 */
export interface RateLimitInfo {
  remaining: number;
  reset: Date;
  limit: number;
}

/**
 * Response from githubFetchWithETag including cache status and rate limit info
 */
export interface GitHubFetchWithETagResult {
  data: unknown;
  fromCache: boolean;
  rateLimitInfo: RateLimitInfo | null;
}

/**
 * Maximum age for cache entries (30 minutes)
 */
const ETAG_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Maximum number of cache entries before evicting oldest
 */
const ETAG_CACHE_MAX_SIZE = 200;

/**
 * Run eviction every N cache writes to amortize cost
 */
const ETAG_EVICTION_INTERVAL = 10;

/**
 * Counter for cache writes since last eviction
 */
let evictionWriteCounter = 0;

/**
 * Module-level ETag cache instance
 */
const etagCache: ETagCache = {};

/**
 * Get the ETag cache (for testing or external access)
 */
export function getETagCache(): ETagCache {
  return etagCache;
}

/**
 * Clear all ETag cache entries (for testing)
 */
export function clearETagCache(): void {
  for (const key of Object.keys(etagCache)) {
    delete etagCache[key];
  }
  evictionWriteCounter = 0;
}

/**
 * Clear ETag cache entries whose URL contains the given repo path (owner/repo).
 * Used when stopping polling for a specific project so other projects' caches remain valid.
 */
export function clearETagCacheForProject(ownerRepo: string): void {
  const prefix = `https://api.github.com/repos/${ownerRepo}`;
  for (const key of Object.keys(etagCache)) {
    if (key.startsWith(prefix)) {
      delete etagCache[key];
    }
  }
}

/**
 * Evict stale entries (older than TTL) and enforce max size by removing oldest entries.
 */
function evictStaleCacheEntries(): void {
  const now = Date.now();
  const keys = Object.keys(etagCache);

  // Remove expired entries
  for (const key of keys) {
    if (now - etagCache[key].lastUpdated.getTime() > ETAG_CACHE_TTL_MS) {
      delete etagCache[key];
    }
  }

  // Enforce max size by removing oldest entries
  const remainingKeys = Object.keys(etagCache);
  if (remainingKeys.length > ETAG_CACHE_MAX_SIZE) {
    const sorted = remainingKeys.sort(
      (a, b) => etagCache[a].lastUpdated.getTime() - etagCache[b].lastUpdated.getTime()
    );
    const toRemove = sorted.slice(0, sorted.length - ETAG_CACHE_MAX_SIZE);
    for (const key of toRemove) {
      delete etagCache[key];
    }
  }
}

/**
 * Extract rate limit information from GitHub API response headers
 */
export function extractRateLimitInfo(response: Response): RateLimitInfo | null {
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');
  const limit = response.headers.get('X-RateLimit-Limit');

  if (remaining === null || reset === null) {
    return null;
  }

  return {
    remaining: parseInt(remaining, 10),
    reset: new Date(parseInt(reset, 10) * 1000),
    limit: limit ? parseInt(limit, 10) : 5000
  };
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
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://api.github.com${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Auto-Claude-UI',
      ...options.headers
    }
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Request failed');
    throw new Error(`GitHub API error: ${response.status} - ${errorBody}`);
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
    const errorBody = await response.text().catch(() => 'Request failed');
    throw new Error(`GitHub API error: ${response.status} - ${errorBody}`);
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
