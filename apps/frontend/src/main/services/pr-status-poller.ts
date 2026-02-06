/**
 * PR Status Poller Service
 *
 * Main process service for polling GitHub PR status updates at intelligent intervals.
 * Runs in the Electron main process to avoid renderer throttling when backgrounded.
 *
 * Features:
 * - Multi-tier polling intervals (60s for active PRs, 5min for stable)
 * - ETag-based conditional requests to minimize API usage
 * - Rate limit monitoring with automatic pause/resume
 * - PR classification based on recent activity
 *
 * @module pr-status-poller
 */

import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  PRStatus,
  PollingMetadata,
  PRStatusUpdate,
  ChecksStatus,
  ReviewsStatus,
  MergeableState,
  PRPollingTier,
  GitHubRateLimitInfo,
} from '../../shared/types/pr-status';
import {
  POLLING_INTERVALS,
  RATE_LIMIT_THRESHOLDS,
  ACTIVITY_THRESHOLD_MS,
} from '../../shared/types/pr-status';
import {
  githubFetchWithETag,
  clearETagCache,
} from '../ipc-handlers/github/utils';
import { safeSendToRenderer } from '../ipc-handlers/utils';

/**
 * PR data from GitHub API (minimal fields needed for status polling)
 */
interface PRData {
  number: number;
  updated_at: string;
  mergeable_state?: string;
  mergeable?: boolean | null;
}

/**
 * Combined status response from GitHub API
 */
interface CombinedStatusResponse {
  state: 'success' | 'pending' | 'failure' | 'error';
  statuses: Array<{ state: string }>;
}

/**
 * Check runs response from GitHub API
 */
interface CheckRunsResponse {
  total_count: number;
  check_runs: Array<{
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: string | null;
  }>;
}

/**
 * Reviews response from GitHub API
 */
interface ReviewsResponse {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  user: { login: string };
}

/**
 * Internal PR polling state
 */
interface PRPollingState {
  prNumber: number;
  tier: PRPollingTier;
  lastActivity: Date;
  lastPolled: Date | null;
  checksStatus: ChecksStatus;
  reviewsStatus: ReviewsStatus;
  mergeableState: MergeableState;
  /** Pending retry for unknown mergeable state */
  mergeableRetryTimeout?: NodeJS.Timeout;
}

/**
 * Project polling context
 */
interface ProjectPollingContext {
  projectId: string;
  owner: string;
  repo: string;
  token: string;
  prStates: Map<number, PRPollingState>;
  /** Timer for active tier polling */
  activeTimer: NodeJS.Timeout | null;
  /** Timer for stable tier polling */
  stableTimer: NodeJS.Timeout | null;
  /** Timer for full refresh */
  fullRefreshTimer: NodeJS.Timeout | null;
}

/**
 * PRStatusPoller - Main process service for intelligent PR status polling
 *
 * Singleton service that manages PR status polling across all projects.
 * Runs timers in the main process to avoid Electron's background throttling.
 */
export class PRStatusPoller {
  private static instance: PRStatusPoller | null = null;

  /** Active polling contexts by project ID */
  private contexts: Map<string, ProjectPollingContext> = new Map();

  /** Rate limit state */
  private rateLimitInfo: GitHubRateLimitInfo | null = null;
  private isPausedForRateLimit = false;
  private rateLimitResumeTimeout: NodeJS.Timeout | null = null;

  /** Main window getter for sending updates */
  private getMainWindow: (() => BrowserWindow | null) | null = null;

  /** Last error for each project */
  private lastErrors: Map<string, string> = new Map();

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): PRStatusPoller {
    if (!PRStatusPoller.instance) {
      PRStatusPoller.instance = new PRStatusPoller();
    }
    return PRStatusPoller.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static resetInstance(): void {
    if (PRStatusPoller.instance) {
      PRStatusPoller.instance.stopAllPolling();
      PRStatusPoller.instance = null;
    }
  }

  /**
   * Set the main window getter for sending IPC updates to renderer
   */
  setMainWindowGetter(getter: () => BrowserWindow | null): void {
    this.getMainWindow = getter;
  }

  /**
   * Start polling for a project's PRs
   *
   * @param projectId - Project identifier (owner/repo format)
   * @param prNumbers - PR numbers to poll
   * @param token - GitHub API token
   */
  async startPolling(
    projectId: string,
    prNumbers: number[],
    token: string
  ): Promise<void> {
    // Stop existing polling for this project
    this.stopPolling(projectId);

    // Parse owner/repo from projectId
    const [owner, repo] = projectId.split('/');
    if (!owner || !repo) {
      console.error(`[PRStatusPoller] Invalid project ID format: ${projectId}`);
      return;
    }

    // Initialize polling context
    const context: ProjectPollingContext = {
      projectId,
      owner,
      repo,
      token,
      prStates: new Map(),
      activeTimer: null,
      stableTimer: null,
      fullRefreshTimer: null,
    };

    // Initialize PR states
    for (const prNumber of prNumbers) {
      context.prStates.set(prNumber, {
        prNumber,
        tier: 'stable', // Will be updated on first poll
        lastActivity: new Date(),
        lastPolled: null,
        checksStatus: 'none',
        reviewsStatus: 'none',
        mergeableState: 'unknown',
      });
    }

    this.contexts.set(projectId, context);

    console.log(
      `[PRStatusPoller] Started polling for ${projectId} with ${prNumbers.length} PRs`
    );

    // Run initial poll immediately
    await this.pollAllPRs(context);

    // Start polling timers
    this.startPollingTimers(context);
  }

  /**
   * Stop polling for a project
   */
  stopPolling(projectId: string): void {
    const context = this.contexts.get(projectId);
    if (!context) {
      return;
    }

    // Clear all timers
    if (context.activeTimer) {
      clearInterval(context.activeTimer);
    }
    if (context.stableTimer) {
      clearInterval(context.stableTimer);
    }
    if (context.fullRefreshTimer) {
      clearInterval(context.fullRefreshTimer);
    }

    // Clear mergeable retry timeouts
    for (const state of context.prStates.values()) {
      if (state.mergeableRetryTimeout) {
        clearTimeout(state.mergeableRetryTimeout);
      }
    }

    // Clear ETag cache for this project's endpoints
    clearETagCache();

    this.contexts.delete(projectId);
    this.lastErrors.delete(projectId);

    console.log(`[PRStatusPoller] Stopped polling for ${projectId}`);
  }

  /**
   * Stop all polling (cleanup)
   */
  stopAllPolling(): void {
    for (const projectId of this.contexts.keys()) {
      this.stopPolling(projectId);
    }

    // Clear rate limit resume timeout
    if (this.rateLimitResumeTimeout) {
      clearTimeout(this.rateLimitResumeTimeout);
      this.rateLimitResumeTimeout = null;
    }

    this.isPausedForRateLimit = false;
    this.rateLimitInfo = null;
  }

  /**
   * Add PRs to an existing polling context
   */
  addPRs(projectId: string, prNumbers: number[]): void {
    const context = this.contexts.get(projectId);
    if (!context) {
      console.warn(
        `[PRStatusPoller] No polling context for ${projectId}, cannot add PRs`
      );
      return;
    }

    for (const prNumber of prNumbers) {
      if (!context.prStates.has(prNumber)) {
        context.prStates.set(prNumber, {
          prNumber,
          tier: 'stable',
          lastActivity: new Date(),
          lastPolled: null,
          checksStatus: 'none',
          reviewsStatus: 'none',
          mergeableState: 'unknown',
        });
      }
    }

    console.log(
      `[PRStatusPoller] Added ${prNumbers.length} PRs to ${projectId}`
    );
  }

  /**
   * Remove PRs from an existing polling context
   */
  removePRs(projectId: string, prNumbers: number[]): void {
    const context = this.contexts.get(projectId);
    if (!context) {
      return;
    }

    for (const prNumber of prNumbers) {
      const state = context.prStates.get(prNumber);
      if (state?.mergeableRetryTimeout) {
        clearTimeout(state.mergeableRetryTimeout);
      }
      context.prStates.delete(prNumber);
    }

    console.log(
      `[PRStatusPoller] Removed ${prNumbers.length} PRs from ${projectId}`
    );
  }

  /**
   * Get current polling metadata for a project
   */
  getPollingMetadata(projectId: string): PollingMetadata {
    const context = this.contexts.get(projectId);
    const lastError = this.lastErrors.get(projectId) ?? null;

    return {
      isPolling: context !== undefined,
      lastPollCycle: context
        ? new Date().toISOString()
        : null,
      rateLimitRemaining: this.rateLimitInfo?.remaining ?? null,
      rateLimitReset: this.rateLimitInfo
        ? new Date(this.rateLimitInfo.reset * 1000).toISOString()
        : null,
      isPausedForRateLimit: this.isPausedForRateLimit,
      lastError,
    };
  }

  /**
   * Check if polling is paused due to rate limit
   */
  isPaused(): boolean {
    return this.isPausedForRateLimit;
  }

  /**
   * Start polling timers for a context
   */
  private startPollingTimers(context: ProjectPollingContext): void {
    // Active tier polling (60s)
    context.activeTimer = setInterval(() => {
      if (!this.isPausedForRateLimit) {
        this.pollPRsByTier(context, 'active');
      }
    }, POLLING_INTERVALS.ACTIVE);

    // Stable tier polling (5min)
    context.stableTimer = setInterval(() => {
      if (!this.isPausedForRateLimit) {
        this.pollPRsByTier(context, 'stable');
      }
    }, POLLING_INTERVALS.STABLE);

    // Full refresh (15min)
    context.fullRefreshTimer = setInterval(() => {
      if (!this.isPausedForRateLimit) {
        this.pollAllPRs(context);
      }
    }, POLLING_INTERVALS.FULL_REFRESH);
  }

  /**
   * Poll all PRs in a context
   */
  private async pollAllPRs(context: ProjectPollingContext): Promise<void> {
    const prNumbers = Array.from(context.prStates.keys());
    await this.pollPRs(context, prNumbers);
  }

  /**
   * Poll PRs of a specific tier
   */
  private async pollPRsByTier(
    context: ProjectPollingContext,
    tier: PRPollingTier
  ): Promise<void> {
    const prNumbers: number[] = [];
    for (const [prNumber, state] of context.prStates) {
      if (state.tier === tier) {
        prNumbers.push(prNumber);
      }
    }

    if (prNumbers.length > 0) {
      await this.pollPRs(context, prNumbers);
    }
  }

  /**
   * Poll specific PRs and update their status
   */
  private async pollPRs(
    context: ProjectPollingContext,
    prNumbers: number[]
  ): Promise<void> {
    if (this.isPausedForRateLimit) {
      return;
    }

    const updatedStatuses: PRStatus[] = [];

    for (const prNumber of prNumbers) {
      try {
        const status = await this.fetchPRStatus(context, prNumber);
        if (status) {
          updatedStatuses.push(status);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(
          `[PRStatusPoller] Error polling PR #${prNumber}: ${message}`
        );
        this.lastErrors.set(context.projectId, message);
      }
    }

    // Send update to renderer
    if (updatedStatuses.length > 0) {
      this.sendStatusUpdate(context.projectId, updatedStatuses);
    }
  }

  /**
   * Fetch status for a single PR
   */
  private async fetchPRStatus(
    context: ProjectPollingContext,
    prNumber: number
  ): Promise<PRStatus | null> {
    const state = context.prStates.get(prNumber);
    if (!state) {
      return null;
    }

    const { owner, repo, token } = context;

    try {
      // Fetch PR data (for updated_at and mergeable state)
      const prEndpoint = `/repos/${owner}/${repo}/pulls/${prNumber}`;
      const prResult = await githubFetchWithETag(token, prEndpoint);
      this.updateGitHubRateLimitInfo(prResult.rateLimitInfo);

      const prData = prResult.data as PRData;

      // Update last activity and classify tier
      const lastActivity = new Date(prData.updated_at);
      const tier = this.classifyPR(lastActivity);
      state.lastActivity = lastActivity;
      state.tier = tier;

      // Fetch CI status
      const checksStatus = await this.fetchChecksStatus(context, prNumber);

      // Fetch review status
      const reviewsStatus = await this.fetchReviewsStatus(context, prNumber);

      // Determine mergeable state
      const mergeableState = this.determineMergeableState(
        prData,
        context,
        state
      );

      // Update state
      state.checksStatus = checksStatus;
      state.reviewsStatus = reviewsStatus;
      state.mergeableState = mergeableState;
      state.lastPolled = new Date();

      return {
        prNumber,
        checksStatus,
        reviewsStatus,
        mergeableState,
        lastPolled: state.lastPolled.toISOString(),
        pollingTier: tier,
        lastActivity: lastActivity.toISOString(),
      };
    } catch (error) {
      // Check for rate limit error
      if (
        error instanceof Error &&
        error.message.includes('403')
      ) {
        this.pauseForRateLimit();
      }
      throw error;
    }
  }

  /**
   * Fetch CI checks status (combined status + check runs)
   */
  private async fetchChecksStatus(
    context: ProjectPollingContext,
    prNumber: number
  ): Promise<ChecksStatus> {
    const { owner, repo, token } = context;

    try {
      // Get PR head SHA first (from cached PR data or fetch it)
      const prEndpoint = `/repos/${owner}/${repo}/pulls/${prNumber}`;
      const prResult = await githubFetchWithETag(token, prEndpoint);
      this.updateGitHubRateLimitInfo(prResult.rateLimitInfo);

      const prData = prResult.data as { head: { sha: string } };
      const headSha = prData.head.sha;

      // Fetch combined status
      const statusEndpoint = `/repos/${owner}/${repo}/commits/${headSha}/status`;
      const statusResult = await githubFetchWithETag(token, statusEndpoint);
      this.updateGitHubRateLimitInfo(statusResult.rateLimitInfo);

      const statusData = statusResult.data as CombinedStatusResponse;

      // Fetch check runs
      const checksEndpoint = `/repos/${owner}/${repo}/commits/${headSha}/check-runs`;
      const checksResult = await githubFetchWithETag(token, checksEndpoint);
      this.updateGitHubRateLimitInfo(checksResult.rateLimitInfo);

      const checksData = checksResult.data as CheckRunsResponse;

      // Aggregate status
      return this.aggregateChecksStatus(statusData, checksData);
    } catch (error) {
      console.error(
        `[PRStatusPoller] Error fetching checks status for PR #${prNumber}:`,
        error
      );
      return 'none';
    }
  }

  /**
   * Aggregate checks status from combined status and check runs
   */
  private aggregateChecksStatus(
    statusData: CombinedStatusResponse,
    checksData: CheckRunsResponse
  ): ChecksStatus {
    const hasStatuses = statusData.statuses.length > 0;
    const hasCheckRuns = checksData.total_count > 0;

    if (!hasStatuses && !hasCheckRuns) {
      return 'none';
    }

    // Check for failures
    const statusFailed = statusData.statuses.some(
      (s) => s.state === 'failure' || s.state === 'error'
    );
    const checksFailed = checksData.check_runs.some(
      (c) => c.status === 'completed' && c.conclusion === 'failure'
    );

    if (statusFailed || checksFailed) {
      return 'failure';
    }

    // Check for pending
    const statusPending = statusData.statuses.some((s) => s.state === 'pending');
    const checksPending = checksData.check_runs.some(
      (c) => c.status === 'queued' || c.status === 'in_progress'
    );

    if (statusPending || checksPending) {
      return 'pending';
    }

    // All passed
    return 'success';
  }

  /**
   * Fetch review status
   */
  private async fetchReviewsStatus(
    context: ProjectPollingContext,
    prNumber: number
  ): Promise<ReviewsStatus> {
    const { owner, repo, token } = context;

    try {
      const endpoint = `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
      const result = await githubFetchWithETag(token, endpoint);
      this.updateGitHubRateLimitInfo(result.rateLimitInfo);

      const reviews = result.data as ReviewsResponse[];

      return this.aggregateReviewsStatus(reviews);
    } catch (error) {
      console.error(
        `[PRStatusPoller] Error fetching reviews for PR #${prNumber}:`,
        error
      );
      return 'none';
    }
  }

  /**
   * Aggregate review status from all reviews
   * Uses latest review per user to determine final status
   */
  private aggregateReviewsStatus(reviews: ReviewsResponse[]): ReviewsStatus {
    if (reviews.length === 0) {
      return 'none';
    }

    // Get latest review per user
    const latestByUser = new Map<string, ReviewsResponse>();
    for (const review of reviews) {
      latestByUser.set(review.user.login, review);
    }

    const latestReviews = Array.from(latestByUser.values());

    // Check for changes requested (takes priority)
    const hasChangesRequested = latestReviews.some(
      (r) => r.state === 'CHANGES_REQUESTED'
    );
    if (hasChangesRequested) {
      return 'changes_requested';
    }

    // Check for approvals
    const hasApproval = latestReviews.some((r) => r.state === 'APPROVED');
    if (hasApproval) {
      return 'approved';
    }

    // Has reviews but no actionable state
    const hasActionableReview = latestReviews.some(
      (r) =>
        r.state === 'APPROVED' ||
        r.state === 'CHANGES_REQUESTED' ||
        r.state === 'PENDING'
    );
    if (hasActionableReview) {
      return 'pending';
    }

    // Only comments/dismissed
    return 'none';
  }

  /**
   * Determine mergeable state from PR data
   */
  private determineMergeableState(
    prData: PRData,
    context: ProjectPollingContext,
    state: PRPollingState
  ): MergeableState {
    // Clear any pending retry
    if (state.mergeableRetryTimeout) {
      clearTimeout(state.mergeableRetryTimeout);
      state.mergeableRetryTimeout = undefined;
    }

    // GitHub returns null when still computing
    if (prData.mergeable === null) {
      // Schedule retry after 2s
      state.mergeableRetryTimeout = setTimeout(() => {
        this.pollPRs(context, [prData.number]);
      }, POLLING_INTERVALS.MERGEABLE_RETRY);

      return 'unknown';
    }

    // Map GitHub's mergeable_state to our enum
    switch (prData.mergeable_state) {
      case 'clean':
        return 'clean';
      case 'dirty':
      case 'unknown':
        return 'dirty';
      case 'blocked':
        return 'blocked';
      case 'unstable':
        // Has conflicts but might still be mergeable
        return prData.mergeable ? 'clean' : 'dirty';
      case 'behind':
        // Branch is behind base, but mergeable
        return prData.mergeable ? 'clean' : 'dirty';
      default:
        return 'unknown';
    }
  }

  /**
   * Classify PR into polling tier based on activity
   */
  private classifyPR(lastActivity: Date): PRPollingTier {
    const now = new Date();
    const timeSinceActivity = now.getTime() - lastActivity.getTime();

    return timeSinceActivity < ACTIVITY_THRESHOLD_MS ? 'active' : 'stable';
  }

  /**
   * Update rate limit info and check thresholds
   */
  private updateGitHubRateLimitInfo(info: { remaining: number; reset: Date; limit: number } | null): void {
    if (!info) {
      return;
    }

    // Convert Date to Unix timestamp (seconds)
    this.rateLimitInfo = {
      remaining: info.remaining,
      limit: info.limit,
      reset: Math.floor(info.reset.getTime() / 1000),
    };

    // Check if we should pause
    if (info.remaining < RATE_LIMIT_THRESHOLDS.PAUSE_THRESHOLD) {
      this.pauseForRateLimit();
    }
  }

  /**
   * Pause polling due to rate limit
   */
  private pauseForRateLimit(): void {
    if (this.isPausedForRateLimit) {
      return;
    }

    this.isPausedForRateLimit = true;
    console.warn(
      `[PRStatusPoller] Pausing polling due to rate limit (remaining: ${this.rateLimitInfo?.remaining})`
    );

    // Schedule resume after rate limit reset
    if (this.rateLimitInfo) {
      const resetTime = this.rateLimitInfo.reset * 1000;
      const now = Date.now();
      const delayMs = Math.max(0, resetTime - now) + 1000; // Add 1s buffer

      this.rateLimitResumeTimeout = setTimeout(() => {
        this.resumePolling();
      }, delayMs);

      console.log(
        `[PRStatusPoller] Will resume polling in ${Math.round(delayMs / 1000)}s`
      );
    }

    // Send pause notification to all active contexts
    for (const projectId of this.contexts.keys()) {
      this.sendStatusUpdate(projectId, []);
    }
  }

  /**
   * Resume polling after rate limit reset
   */
  private resumePolling(): void {
    if (!this.isPausedForRateLimit) {
      return;
    }

    this.isPausedForRateLimit = false;
    this.rateLimitResumeTimeout = null;

    console.log('[PRStatusPoller] Resuming polling after rate limit reset');

    // Trigger immediate poll for all contexts
    for (const context of this.contexts.values()) {
      this.pollAllPRs(context);
    }
  }

  /**
   * Send status update to renderer via IPC
   */
  private sendStatusUpdate(projectId: string, statuses: PRStatus[]): void {
    if (!this.getMainWindow) {
      return;
    }

    const update: PRStatusUpdate = {
      projectId,
      statuses,
      metadata: this.getPollingMetadata(projectId),
    };

    safeSendToRenderer(
      this.getMainWindow,
      IPC_CHANNELS.GITHUB_PR_STATUS_UPDATE,
      update
    );
  }
}

/**
 * Get the global PRStatusPoller instance
 */
export function getPRStatusPoller(): PRStatusPoller {
  return PRStatusPoller.getInstance();
}
