/**
 * PR Status Polling Types
 *
 * Types for the smart PR status polling system that automatically fetches
 * and displays CI checks, review status, and mergeability for GitHub PRs.
 * Used across IPC boundary (main process, preload, renderer).
 */

/**
 * CI checks status - combined from commit status + check runs
 * - success: All checks passed
 * - pending: At least one check pending, none failed
 * - failure: At least one check failed
 * - none: No status checks configured
 */
export type ChecksStatus = 'success' | 'pending' | 'failure' | 'none';

/**
 * Review status - aggregated from all reviewers
 * - approved: At least one approval, no changes requested
 * - changes_requested: Any reviewer requested changes
 * - pending: No reviews or only comments
 * - none: No reviews
 */
export type ReviewsStatus = 'approved' | 'changes_requested' | 'pending' | 'none';

/**
 * Mergeable state
 * - clean: Ready to merge
 * - dirty: Has conflicts
 * - blocked: Branch protection blocks merge
 * - unknown: GitHub still computing (retry after 2s)
 */
export type MergeableState = 'clean' | 'dirty' | 'blocked' | 'unknown';

/**
 * PR classification for polling interval tiers
 * - active: Updated within last 30 minutes (poll every 60s)
 * - stable: No updates for 30+ minutes (poll every 5min)
 */
export type PRPollingTier = 'active' | 'stable';

/**
 * PR status data - represents the current status of a single PR
 */
export interface PRStatus {
  /** PR number */
  prNumber: number;
  /** CI checks status */
  checksStatus: ChecksStatus;
  /** Review status */
  reviewsStatus: ReviewsStatus;
  /** Mergeable state */
  mergeableState: MergeableState;
  /** ISO timestamp of last status poll */
  lastPolled: string | null;
  /** Polling tier classification */
  pollingTier: PRPollingTier;
  /** ISO timestamp of last PR activity (for tier classification) */
  lastActivity: string | null;
}

/**
 * Polling metadata - tracks polling state and rate limits
 */
export interface PollingMetadata {
  /** Whether polling is currently active */
  isPolling: boolean;
  /** ISO timestamp of last successful poll cycle */
  lastPollCycle: string | null;
  /** GitHub API rate limit remaining */
  rateLimitRemaining: number | null;
  /** ISO timestamp when rate limit resets */
  rateLimitReset: string | null;
  /** Whether polling is paused due to rate limit */
  isPausedForRateLimit: boolean;
  /** Error message if polling failed */
  lastError: string | null;
}

/**
 * ETag cache entry - stores cached response with ETag for conditional requests
 */
export interface ETagCacheEntry {
  /** ETag value from response header */
  etag: string;
  /** Cached response data */
  data: unknown;
  /** ISO timestamp when cached */
  lastUpdated: string;
}

/**
 * ETag cache - stores cached responses keyed by endpoint URL
 */
export type ETagCache = Record<string, ETagCacheEntry>;

/**
 * PR status update event - sent from main process to renderer
 */
export interface PRStatusUpdate {
  /** Project ID (owner/repo format) */
  projectId: string;
  /** Array of updated PR statuses */
  statuses: PRStatus[];
  /** Polling metadata */
  metadata: PollingMetadata;
}

/**
 * Start polling request - sent from renderer to main process
 */
export interface StartPollingRequest {
  /** Project ID (owner/repo format) */
  projectId: string;
  /** PR numbers to poll */
  prNumbers: number[];
}

/**
 * Stop polling request - sent from renderer to main process
 */
export interface StopPollingRequest {
  /** Project ID (owner/repo format) */
  projectId: string;
}

/**
 * GitHub API rate limit info - extracted from response headers
 */
export interface GitHubRateLimitInfo {
  /** Requests remaining in current window */
  remaining: number;
  /** Total requests allowed in window */
  limit: number;
  /** Unix timestamp (seconds) when window resets */
  reset: number;
}

/**
 * GitHub fetch result with ETag support
 */
export interface GitHubFetchResult<T = unknown> {
  /** Response data (null if 304 Not Modified) */
  data: T | null;
  /** Whether response came from cache (304 Not Modified) */
  fromCache: boolean;
  /** New ETag from response (if provided) */
  etag: string | null;
  /** Rate limit info from response headers */
  rateLimit: GitHubRateLimitInfo | null;
}

/**
 * Polling intervals in milliseconds
 */
export const POLLING_INTERVALS = {
  /** 60 seconds for recently active PRs */
  ACTIVE: 60_000,
  /** 5 minutes for stable PRs */
  STABLE: 300_000,
  /** 15 minutes for full refresh of all PRs */
  FULL_REFRESH: 900_000,
  /** 2 seconds retry when mergeable state is unknown */
  MERGEABLE_RETRY: 2_000,
} as const;

/**
 * Rate limit thresholds
 */
export const RATE_LIMIT_THRESHOLDS = {
  /** Pause polling when remaining requests drop below this */
  PAUSE_THRESHOLD: 100,
} as const;

/**
 * Activity threshold for PR classification (30 minutes in milliseconds)
 */
export const ACTIVITY_THRESHOLD_MS = 30 * 60 * 1000;
