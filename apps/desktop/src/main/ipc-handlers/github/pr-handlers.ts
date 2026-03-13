/**
 * GitHub PR Review IPC handlers
 *
 * Handles AI-powered PR review:
 * 1. List and fetch PRs
 * 2. Run AI review with code analysis
 * 3. Post review comments
 * 4. Apply fixes
 */

import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import {
  IPC_CHANNELS,
  DEFAULT_FEATURE_MODELS,
  DEFAULT_FEATURE_THINKING,
} from "../../../shared/constants";
import { getGitHubConfig, githubFetch, normalizeRepoReference } from "./utils";
import { readSettingsFile } from "../../settings-utils";
import { getAugmentedEnv } from "../../env-utils";
import { getMemoryService } from "../context/memory-service-factory";
import type { Project, AppSettings } from "../../../shared/types";
import { createContextLogger } from "./utils/logger";
import { withProjectOrNull } from "./utils/project-middleware";
import { createIPCCommunicators } from "./utils/ipc-communicator";
import {
  runMultiPassReview,
  type PRContext,
  type PRReviewEngineConfig,
  type ChangedFile,
  type AIBotComment,
} from "../../ai/runners/github/pr-review-engine";
import {
  ParallelFollowupReviewer,
  type FollowupReviewContext,
  type PreviousReviewResult,
} from "../../ai/runners/github/parallel-followup";
import {
  ParallelOrchestratorReviewer,
  type ParallelOrchestratorConfig,
} from "../../ai/runners/github/parallel-orchestrator";
import type { ModelShorthand, ThinkingLevel } from "../../ai/config/types";
import { getPRStatusPoller } from "../../services/pr-status-poller";
import { safeBreadcrumb, safeCaptureException } from "../../sentry";
import { sanitizeForSentry } from "../../../shared/utils/sentry-privacy";
import { PRReviewStateManager } from "../../pr-review-state-manager";
import type { PRReviewResult as PreloadPRReviewResult } from "../../../preload/api/modules/github-api";
import type {
  StartPollingRequest,
  StopPollingRequest,
  PollingMetadata,
} from "../../../shared/types/pr-status";

/**
 * GraphQL response type for PR list query
 * Note: repository can be null if the repo doesn't exist or user lacks access
 */
interface GraphQLPRNode {
  number: number;
  title: string;
  body: string | null;
  state: string;
  author: { login: string } | null;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  assignees: { nodes: Array<{ login: string }> };
  createdAt: string;
  updatedAt: string;
  url: string;
}

interface GraphQLPRListResponse {
  data: {
    repository: {
      pullRequests: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        nodes: GraphQLPRNode[];
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
}

/**
 * Maps a GraphQL PR node to the frontend PRData format.
 * Shared between listPRs and listMorePRs handlers.
 */
function mapGraphQLPRToData(pr: GraphQLPRNode): PRData {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    state: pr.state.toLowerCase(),
    author: { login: pr.author?.login ?? "unknown" },
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    assignees: pr.assignees.nodes.map((a) => ({ login: a.login })),
    files: [],
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    htmlUrl: pr.url,
  };
}

/**
 * Make a GraphQL request to GitHub API
 */
async function githubGraphQL<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  // CodeQL: file data in outbound request - validate token is a non-empty string before use
  // lgtm[js/file-access-to-http] - Official GitHub GraphQL API endpoint
  const safeToken = typeof token === 'string' && token.length > 0 ? token : '';
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${safeToken}`,
      "Content-Type": "application/json",
      "User-Agent": "Aperant",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    // Log detailed error for debugging, throw generic message for safety
    console.error(`GitHub GraphQL HTTP error: ${response.status} ${response.statusText}`);
    throw new Error("Failed to connect to GitHub API");
  }

  const result = await response.json() as T & { errors?: Array<{ message: string }> };

  // Check for GraphQL-level errors
  if (result.errors && result.errors.length > 0) {
    // Log detailed errors for debugging, throw generic message for safety
    console.error(`GitHub GraphQL errors: ${result.errors.map(e => e.message).join(", ")}`);
    throw new Error("GitHub API request failed");
  }

  return result;
}

/**
 * GraphQL query to fetch PRs with diff stats
 */
const LIST_PRS_QUERY = `
query($owner: String!, $repo: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: $first, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        body
        state
        author { login }
        headRefName
        baseRefName
        additions
        deletions
        changedFiles
        assignees(first: 10) { nodes { login } }
        createdAt
        updatedAt
        url
      }
    }
  }
}
`;

/**
 * Sanitize network data before writing to file
 * Removes potentially dangerous characters and limits length
 */
function sanitizeNetworkData(data: string, maxLength = 1000000): string {
  // Remove null bytes and other control characters except newlines/tabs/carriage returns
  // Using code points instead of escape sequences to avoid no-control-regex ESLint rule
  const controlCharsPattern = new RegExp(
    "[" +
      String.fromCharCode(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08) + // \x00-\x08
      String.fromCharCode(0x0b, 0x0c) + // \x0B, \x0C (skip \x0A which is newline)
      String.fromCharCode(
        0x0e,
        0x0f,
        0x10,
        0x11,
        0x12,
        0x13,
        0x14,
        0x15,
        0x16,
        0x17,
        0x18,
        0x19,
        0x1a,
        0x1b,
        0x1c,
        0x1d,
        0x1e,
        0x1f
      ) + // \x0E-\x1F
      String.fromCharCode(0x7f) + // \x7F (DEL)
      "]",
    "g"
  );
  let sanitized = data.replace(controlCharsPattern, "");

  // Limit length to prevent DoS
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

// Debug logging
const { debug: debugLog, trace: traceLog } = createContextLogger("GitHub PR");

/**
 * Sentinel value indicating a review is waiting for CI checks to complete.
 * Used as a placeholder in runningReviews before the actual process is spawned.
 */
const CI_WAIT_PLACEHOLDER = Symbol("CI_WAIT_PLACEHOLDER");
type CIWaitPlaceholder = typeof CI_WAIT_PLACEHOLDER;

/**
 * Registry of running PR review abort controllers
 * Key format: `${projectId}:${prNumber}`
 * Value can be:
 * - AbortController: actual running review (used to cancel)
 * - CI_WAIT_PLACEHOLDER: review is waiting for CI checks to complete
 */
const runningReviews = new Map<string, AbortController | CIWaitPlaceholder>();

/**
 * Registry of abort controllers for CI wait cancellation
 * Key format: `${projectId}:${prNumber}`
 */
const ciWaitAbortControllers = new Map<string, AbortController>();

/**
 * Get the registry key for a PR review
 */
function getReviewKey(projectId: string, prNumber: number): string {
  return `${projectId}:${prNumber}`;
}

/**
 * Returns env vars for Claude.md usage; enabled unless explicitly opted out.
 */
function getClaudeMdEnv(project: Project): Record<string, string> | undefined {
  return project.settings?.useClaudeMd !== false ? { USE_CLAUDE_MD: "true" } : undefined;
}

/**
 * PR review finding from AI analysis
 */
export interface PRReviewFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  category: "security" | "quality" | "style" | "test" | "docs" | "pattern" | "performance" | "verification_failed";
  title: string;
  description: string;
  file: string;
  line: number;
  endLine?: number;
  suggestedFix?: string;
  fixable: boolean;
  validationStatus?: "confirmed_valid" | "dismissed_false_positive" | "needs_human_review" | null;
  validationExplanation?: string;
  sourceAgents?: string[];
  crossValidated?: boolean;
}

/**
 * Complete PR review result
 */
export interface PRReviewResult {
  prNumber: number;
  repo: string;
  success: boolean;
  findings: PRReviewFinding[];
  summary: string;
  overallStatus: "approve" | "request_changes" | "comment" | "in_progress";
  reviewId?: number;
  reviewedAt: string;
  error?: string;
  // Follow-up review fields
  reviewedCommitSha?: string;
  reviewedFileBlobs?: Record<string, string>; // filename → blob SHA for rebase-resistant follow-ups
  isFollowupReview?: boolean;
  previousReviewId?: number;
  resolvedFindings?: string[];
  unresolvedFindings?: string[];
  newFindingsSinceLastReview?: string[];
  // Track if findings have been posted to GitHub (enables follow-up review)
  hasPostedFindings?: boolean;
  postedFindingIds?: string[];
  postedAt?: string;
  // In-progress review tracking
  inProgressSince?: string;
}

/**
 * Result of checking for new commits since last review
 */
export interface NewCommitsCheck {
  hasNewCommits: boolean;
  newCommitCount: number;
  lastReviewedCommit?: string;
  currentHeadCommit?: string;
  /** Whether new commits happened AFTER findings were posted (for "Ready for Follow-up" status) */
  hasCommitsAfterPosting?: boolean;
  /** Whether new commits touch files that had findings (requires verification) */
  hasOverlapWithFindings?: boolean;
  /** Files from new commits that overlap with finding files */
  overlappingFiles?: string[];
  /** Whether this appears to be a merge from base branch (develop/main) */
  isMergeFromBase?: boolean;
}

/**
 * Lightweight merge readiness check result
 * Used for real-time validation of AI verdict freshness
 */
export interface MergeReadiness {
  /** PR is in draft mode */
  isDraft: boolean;
  /** GitHub's mergeable status */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  /** Branch is behind base branch (out of date) */
  isBehind: boolean;
  /** Simplified CI status */
  ciStatus: "passing" | "failing" | "pending" | "none";
  /** List of blockers that contradict a "ready to merge" verdict */
  blockers: string[];
}

/**
 * PR review memory stored in the memory layer
 * Represents key insights and learnings from a PR review
 */
export interface PRReviewMemory {
  prNumber: number;
  repo: string;
  verdict: string;
  timestamp: string;
  summary: {
    verdict: string;
    verdict_reasoning?: string;
    finding_counts?: Record<string, number>;
    total_findings?: number;
    blockers?: string[];
    risk_assessment?: Record<string, string>;
  };
  keyFindings: Array<{
    severity: string;
    category: string;
    title: string;
    description: string;
    file: string;
    line: number;
  }>;
  patterns: string[];
  gotchas: string[];
  isFollowup: boolean;
}

/**
 * Save PR review insights to the Electron memory layer (LadybugDB)
 *
 * Called after a PR review completes to persist learnings for cross-session context.
 * Extracts key findings, patterns, and gotchas from the review result.
 *
 * @param result The completed PR review result
 * @param repo Repository name (owner/repo)
 * @param isFollowup Whether this is a follow-up review
 */
async function savePRReviewToMemory(
  result: PRReviewResult,
  repo: string,
  isFollowup: boolean = false
): Promise<void> {
  const settings = readSettingsFile();
  if (!settings?.memoryEnabled) {
    debugLog("Memory not enabled, skipping PR review memory save");
    return;
  }

  try {
    const memoryService = await getMemoryService();

    // Prioritize findings: critical > high > medium > low
    // Include all critical/high, top 5 medium, top 3 low
    const criticalFindings = result.findings.filter((f) => f.severity === "critical");
    const highFindings = result.findings.filter((f) => f.severity === "high");
    const mediumFindings = result.findings.filter((f) => f.severity === "medium").slice(0, 5);
    const lowFindings = result.findings.filter((f) => f.severity === "low").slice(0, 3);

    const keyFindingsToSave = [
      ...criticalFindings,
      ...highFindings,
      ...mediumFindings,
      ...lowFindings,
    ].map((f) => ({
      severity: f.severity,
      category: f.category,
      title: f.title,
      description: f.description.substring(0, 500),
      file: f.file,
      line: f.line,
    }));

    // Extract gotchas: security issues, critical bugs, and common mistakes
    const gotchaCategories = ["security", "error_handling", "data_validation", "race_condition"];
    const gotchasToSave = result.findings
      .filter(
        (f) =>
          f.severity === "critical" ||
          f.severity === "high" ||
          gotchaCategories.includes(f.category?.toLowerCase() || "")
      )
      .map((f) => `[${f.category}] ${f.title}: ${f.description.substring(0, 300)}`);

    // Extract patterns: group findings by category to identify recurring issues
    const categoryGroups = result.findings.reduce(
      (acc, f) => {
        const cat = f.category || "general";
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Patterns are categories that appear multiple times (indicates a systematic issue)
    const patternsToSave = Object.entries(categoryGroups)
      .filter(([_, count]) => count >= 2)
      .map(([category, count]) => `${category}: ${count} occurrences`);

    // Build content string for new memory system
    const episodeName = `PR #${result.prNumber} ${isFollowup ? "Follow-up " : ""}Review - ${repo}`;
    const contentParts = [
      episodeName,
      `Verdict: ${result.overallStatus || "unknown"}`,
      `Findings: ${result.findings.length} total (${criticalFindings.length} critical, ${highFindings.length} high)`,
    ];

    if (patternsToSave.length > 0) {
      contentParts.push(`Patterns: ${patternsToSave.join('; ')}`);
    }

    if (gotchasToSave.length > 0) {
      contentParts.push(`Gotchas: ${gotchasToSave.slice(0, 3).join('; ')}`);
    }

    if (keyFindingsToSave.length > 0) {
      contentParts.push(`Key findings: ${keyFindingsToSave.slice(0, 5).map(f => `[${f.severity}] ${f.title}`).join('; ')}`);
    }

    if (isFollowup && result.resolvedFindings && result.unresolvedFindings) {
      contentParts.push(`Resolved: ${result.resolvedFindings.length}, Unresolved: ${result.unresolvedFindings.length}`);
    }

    const contentString = contentParts.join('\n');

    // Store using the new memory service
    await memoryService.store({
      type: 'module_insight',
      content: contentString,
      source: 'agent_explicit',
      confidence: 0.8,
      projectId: repo,
      relatedFiles: keyFindingsToSave.map(f => f.file).filter(Boolean).slice(0, 10),
      relatedModules: [],
      tags: ['pr_review', repo.replace('/', '_'), `pr_${result.prNumber}`],
    });

    debugLog("PR review saved to memory", { prNumber: result.prNumber });
  } catch (error) {
    debugLog("Error saving PR review to memory", {
      error: error instanceof Error ? error.message : error,
    });
  }
}

/**
 * PR data from GitHub API
 */
export interface PRData {
  number: number;
  title: string;
  body: string;
  state: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  assignees: Array<{ login: string }>;
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
    status: string;
  }>;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

/**
 * PR list result with pagination info
 */
export interface PRListResult {
  prs: PRData[];
  hasNextPage: boolean; // True if more PRs exist beyond the 100 limit
  endCursor?: string | null; // Cursor for fetching next page (null if no more pages)
}

/**
 * PR review progress status
 */
export interface PRReviewProgress {
  phase: "fetching" | "analyzing" | "generating" | "posting" | "complete";
  prNumber: number;
  progress: number;
  message: string;
}

/**
 * Result of waiting for CI checks to complete
 */
interface CIWaitResult {
  /** Whether we successfully waited (no timeout) */
  success: boolean;
  /** Whether any checks are still pending (queued or in_progress) */
  hasInProgress: boolean;
  /** Number of checks currently pending (queued or in_progress) */
  inProgressCount: number;
  /** Names of checks still pending (if any) */
  inProgressChecks: string[];
  /** Whether we timed out waiting */
  timedOut: boolean;
  /** Total wait time in seconds */
  waitTimeSeconds: number;
}

/**
 * Wait for CI checks to complete before starting AI review.
 *
 * Polls GitHub API to check if any CI checks are "queued" or "in_progress".
 * Blocks on BOTH statuses because:
 * - "queued" = CI has been triggered but not started yet
 * - "in_progress" = CI is actively running
 *
 * We wait for all checks to reach "completed" status before reviewing,
 * so our review doesn't report "CI is pending" when it will finish soon.
 *
 * @param token GitHub API token
 * @param repo Repository in "owner/repo" format
 * @param headSha The commit SHA to check CI status for
 * @param prNumber PR number (for progress updates)
 * @param sendProgress Callback to send progress updates to frontend
 * @param abortSignal Optional abort signal for cancellation support
 * @returns CIWaitResult with final CI status
 */
async function waitForCIChecks(
  token: string,
  repo: string,
  headSha: string,
  prNumber: number,
  sendProgress: (progress: PRReviewProgress) => void,
  abortSignal?: AbortSignal
): Promise<CIWaitResult> {
  const POLL_INTERVAL_MS = 20000; // 20 seconds
  const MAX_WAIT_MINUTES = 30;
  const MAX_WAIT_MS = MAX_WAIT_MINUTES * 60 * 1000; // 30 minutes
  const MAX_ITERATIONS = Math.floor(MAX_WAIT_MS / POLL_INTERVAL_MS); // 90 iterations

  let iteration = 0;
  const startTime = Date.now();
  // Track last known in-progress state for accurate timeout reporting
  let lastInProgressCount = 0;
  let lastInProgressNames: string[] = [];

  debugLog("Starting CI wait check", { prNumber, headSha, maxIterations: MAX_ITERATIONS });

  while (iteration < MAX_ITERATIONS) {
    // Check for cancellation
    if (abortSignal?.aborted) {
      debugLog("CI wait cancelled by user", { prNumber, iteration });
      return {
        success: false,
        hasInProgress: lastInProgressCount > 0,
        inProgressCount: lastInProgressCount,
        inProgressChecks: lastInProgressNames,
        timedOut: false,
        waitTimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      };
    }

    try {
      // Fetch check runs for the commit
      const checkRuns = (await githubFetch(
        token,
        `/repos/${repo}/commits/${headSha}/check-runs`
      )) as {
        total_count: number;
        check_runs: Array<{
          name: string;
          status: "queued" | "in_progress" | "completed";
          conclusion: string | null;
        }>;
      };

      // Find checks that are not yet completed (queued or in_progress)
      // We block on BOTH statuses to ensure CI is fully done before reviewing
      const inProgressChecks = checkRuns.check_runs.filter(
        (cr) => cr.status === "queued" || cr.status === "in_progress"
      );

      const inProgressCount = inProgressChecks.length;
      const inProgressNames = inProgressChecks.map((cr) => cr.name);

      // Track last known state for timeout reporting
      lastInProgressCount = inProgressCount;
      lastInProgressNames = inProgressNames;

      traceLog("CI check status", {
        prNumber,
        iteration,
        totalChecks: checkRuns.total_count,
        inProgressCount,
        inProgressNames,
      });

      // If no checks are pending (queued or in_progress), we can proceed
      if (inProgressCount === 0) {
        const waitTimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        debugLog("All CI checks completed, proceeding with review", {
          prNumber,
          waitTimeSeconds,
        });

        return {
          success: true,
          hasInProgress: false,
          inProgressCount: 0,
          inProgressChecks: [],
          timedOut: false,
          waitTimeSeconds,
        };
      }

      // Checks are still running - send progress update and wait
      iteration++;
      const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
      const remainingMinutes = MAX_WAIT_MINUTES - elapsedMinutes;

      const checkNames =
        inProgressNames.length <= 3
          ? inProgressNames.join(", ")
          : `${inProgressNames.slice(0, 3).join(", ")} and ${inProgressNames.length - 3} more`;

      sendProgress({
        phase: "fetching",
        prNumber,
        progress: 5, // Keep progress low during wait
        message: `Waiting for CI checks to complete (${checkNames})... ${remainingMinutes}m remaining`,
      });

      debugLog("Waiting for CI checks", {
        prNumber,
        iteration,
        inProgressCount,
        elapsedMinutes,
        remainingMinutes,
      });

      // Wait before next poll (with abort check)
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      // Check for cancellation after wait
      if (abortSignal?.aborted) {
        debugLog("CI wait cancelled by user during poll interval", { prNumber, iteration });
        return {
          success: false,
          hasInProgress: lastInProgressCount > 0,
          inProgressCount: lastInProgressCount,
          inProgressChecks: lastInProgressNames,
          timedOut: false,
          waitTimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        };
      }
    } catch (error) {
      // If we fail to fetch CI status, log and continue with the review
      // This prevents CI check failures from blocking reviews entirely
      debugLog("Failed to fetch CI status, proceeding with review", {
        prNumber,
        error: error instanceof Error ? error.message : error,
      });

      return {
        success: true,
        hasInProgress: false, // Assume no in-progress on error
        inProgressCount: 0,
        inProgressChecks: [],
        timedOut: false,
        waitTimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      };
    }
  }

  // Timed out waiting for CI checks
  const waitTimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  debugLog("CI wait timed out, proceeding with review anyway", {
    prNumber,
    waitTimeSeconds,
    maxWaitSeconds: MAX_WAIT_MS / 1000,
    lastInProgressCount,
    lastInProgressNames,
  });

  return {
    success: false,
    hasInProgress: true,
    inProgressCount: lastInProgressCount,
    inProgressChecks: lastInProgressNames,
    timedOut: true,
    waitTimeSeconds,
  };
}

/**
 * Perform CI wait check before starting a PR review.
 *
 * Encapsulates the common logic for waiting on CI checks, including:
 * - Fetching the PR head SHA
 * - Calling waitForCIChecks
 * - Logging the result
 *
 * @param config GitHub config with token and repo
 * @param prNumber PR number
 * @param sendProgress Progress callback
 * @param reviewType Type of review for logging ("review" or "follow-up review")
 * @param abortSignal Optional abort signal for cancellation support
 * @returns true if the review should proceed, false if cancelled
 */
async function performCIWaitCheck(
  config: { token: string; repo: string },
  prNumber: number,
  sendProgress: (progress: PRReviewProgress) => void,
  reviewType: "review" | "follow-up review",
  abortSignal?: AbortSignal
): Promise<boolean> {
  try {
    sendProgress({
      phase: "fetching",
      prNumber,
      progress: 5,
      message: "Checking CI status...",
    });

    // Get PR head SHA for CI status check
    const pr = (await githubFetch(
      config.token,
      `/repos/${config.repo}/pulls/${prNumber}`
    )) as { head: { sha: string } };

    const ciWaitResult = await waitForCIChecks(
      config.token,
      config.repo,
      pr.head.sha,
      prNumber,
      sendProgress,
      abortSignal
    );

    // Check if cancelled
    if (abortSignal?.aborted || (!ciWaitResult.success && !ciWaitResult.timedOut)) {
      debugLog(`CI wait cancelled, aborting ${reviewType}`, { prNumber });
      return false;
    }

    if (ciWaitResult.timedOut) {
      debugLog(`CI wait timed out, proceeding with ${reviewType}`, {
        prNumber,
        waitTimeSeconds: ciWaitResult.waitTimeSeconds,
      });
    } else if (ciWaitResult.waitTimeSeconds > 0) {
      debugLog(`CI checks completed, starting ${reviewType}`, {
        prNumber,
        waitTimeSeconds: ciWaitResult.waitTimeSeconds,
      });
    }
    return true;
  } catch (ciError) {
    // Don't fail the review if CI check fails, just log and proceed
    debugLog(`Failed to check CI status, proceeding with ${reviewType}`, {
      prNumber,
      error: ciError instanceof Error ? ciError.message : ciError,
    });
    return true;
  }
}

/**
 * Get the GitHub directory for a project
 */
function getGitHubDir(project: Project): string {
  return path.join(project.path, ".auto-claude", "github");
}

/**
 * PR log phase type
 */
type PRLogPhase = "context" | "analysis" | "synthesis";

/**
 * PR log entry type
 */
type PRLogEntryType =
  | "text"
  | "tool_start"
  | "tool_end"
  | "phase_start"
  | "phase_end"
  | "error"
  | "success"
  | "info";

/**
 * Single PR log entry
 */
interface PRLogEntry {
  timestamp: string;
  type: PRLogEntryType;
  content: string;
  phase: PRLogPhase;
  source?: string;
  detail?: string;
  collapsed?: boolean;
}

/**
 * Phase log with entries
 */
interface PRPhaseLog {
  phase: PRLogPhase;
  status: "pending" | "active" | "completed" | "failed";
  started_at: string | null;
  completed_at: string | null;
  entries: PRLogEntry[];
}

/**
 * Complete PR logs structure
 */
interface PRLogs {
  pr_number: number;
  repo: string;
  created_at: string;
  updated_at: string;
  is_followup: boolean;
  phases: {
    context: PRPhaseLog;
    analysis: PRPhaseLog;
    synthesis: PRPhaseLog;
  };
}

/**
 * Parse a log line and extract source and content
 * Returns null if line is not a log line
 */
function parseLogLine(line: string): { source: string; content: string; isError: boolean } | null {
  // Match patterns like [Context], [AI], [Orchestrator], [Followup], [DEBUG ...], [ParallelFollowup], [BotDetector], [ParallelOrchestrator]
  const patterns = [
    /^\[Context\]\s*(.*)$/,
    /^\[AI\]\s*(.*)$/,
    /^\[Orchestrator\]\s*(.*)$/,
    /^\[Followup\]\s*(.*)$/,
    /^\[ParallelFollowup\]\s*(.*)$/,
    /^\[ParallelOrchestrator\]\s*(.*)$/,
    /^\[BotDetector\]\s*(.*)$/,
    /^\[PR Review Engine\]\s*(.*)$/,
    /^\[DEBUG\s+(\w+)\]\s*(.*)$/,
    /^\[ERROR\s+(\w+)\]\s*(.*)$/,
  ];

  // Check for specialist agent logs first (Agent:agent-name format)
  const agentMatch = line.match(/^\[Agent:([\w-]+)\]\s*(.*)$/);
  if (agentMatch) {
    return {
      source: `Agent:${agentMatch[1]}`,
      content: agentMatch[2],
      isError: false,
    };
  }

  // Check for parallel SDK specialist logs (Specialist:name format)
  const specialistMatch = line.match(/^\[Specialist:([\w-]+)\]\s*(.*)$/);
  if (specialistMatch) {
    return {
      source: `Specialist:${specialistMatch[1]}`,
      content: specialistMatch[2],
      isError: false,
    };
  }

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      const isDebugOrError = pattern.source.includes("DEBUG") || pattern.source.includes("ERROR");
      if (isDebugOrError && match.length >= 3) {
        // Skip debug messages that only show message types (not useful)
        if (match[2].match(/^Message #\d+: \w+Message/)) {
          return null;
        }
        return {
          source: match[1],
          content: match[2],
          isError: pattern.source.includes("ERROR"),
        };
      }
      const source = line.match(/^\[(\w+(?:\s+\w+)*)\]/)?.[1] || "Unknown";
      return {
        source,
        content: match[1] || line,
        isError: false,
      };
    }
  }

  // Check for PR progress messages [PR #XXX] [YY%] message
  const prProgressMatch = line.match(/^\[PR #\d+\]\s*\[\s*(\d+)%\]\s*(.*)$/);
  if (prProgressMatch) {
    return {
      source: "Progress",
      content: `[${prProgressMatch[1]}%] ${prProgressMatch[2]}`,
      isError: false,
    };
  }

  // Check for progress messages [XX%]
  const progressMatch = line.match(/^\[(\d+)%\]\s*(.*)$/);
  if (progressMatch) {
    return {
      source: "Progress",
      content: `[${progressMatch[1]}%] ${progressMatch[2]}`,
      isError: false,
    };
  }

  // Catch-all: any [word] or [word_word] prefix not matched above (e.g. review engine phases)
  const genericBracketMatch = line.match(/^\[([\w_]+)\]\s*(.*)$/);
  if (genericBracketMatch) {
    return {
      source: genericBracketMatch[1],
      content: genericBracketMatch[2] || line,
      isError: false,
    };
  }

  // Match final summary lines (Status:, Summary:, Findings:, etc.)
  const summaryPatterns = [
    /^(Status|Summary|Findings|Verdict|Is Follow-up|Resolved|Still Open|New Issues):\s*(.*)$/,
    /^PR #\d+ (Follow-up )?Review Complete$/,
    /^={10,}$/,
    /^-{10,}$/,
    // Markdown headers (## Summary, ### Resolution Status, etc.)
    /^#{1,4}\s+.+$/,
    // Bullet points with content (- ✅ **Resolved**, - **Blocking Issues**, etc.)
    /^[-*]\s+.+$/,
    // Indented bullet points for findings (  - [MEDIUM] ..., . [LOW] ...)
    /^\s+[-.*]\s+\[.+$/,
    // Lines with bold text at start (**Why NEEDS_REVISION:**, **Recommended Actions:**)
    /^\*\*.+\*\*:?\s*$/,
    // Numbered list items (1. Add DANGEROUS_FLAGS...)
    /^\d+\.\s+.+$/,
    // File references (File: apps/desktop/...)
    /^\s+File:\s+.+$/,
  ];
  for (const pattern of summaryPatterns) {
    const match = line.match(pattern);
    if (match) {
      return {
        source: "Summary",
        content: line,
        isError: false,
      };
    }
  }

  return null;
}

/**
 * Determine the phase from source
 */
function getPhaseFromSource(source: string): PRLogPhase {
  // Context phase: gathering PR data, commits, files, feedback
  // Note: "Followup" is context gathering for follow-up reviews (comparing commits, finding changes)
  const contextSources = ["Context", "BotDetector", "Followup", "fetching"];
  // Analysis phase: AI agents analyzing code
  const analysisSources = [
    "AI",
    "Orchestrator",
    "ParallelOrchestrator",
    "ParallelFollowup",
    "orchestrator",
    "PRReview", // Worktree creation and PR-specific analysis
    "ClientCache", // SDK client cache operations
    "analyzing",
    "orchestrating",
    "quick_scan",
    "security",
    "logic",
    "codebase_fit",
    "deep_analysis",
    "structural",
    "quality",
    "validation",
    "dedup",
    "FindingValidator",
  ];
  // Synthesis phase: final summary and results
  // Note: "Progress" logs are redundant (shown in progress bar) but kept for completeness
  const synthesisSources = ["PR Review Engine", "Summary", "Progress", "generating", "posting", "complete", "finalizing", "synthesis", "synthesizing"];

  if (contextSources.includes(source)) return "context";
  if (analysisSources.includes(source)) return "analysis";
  // Specialist agents (Agent:xxx and Specialist:xxx) are part of analysis phase
  if (source.startsWith("Agent:")) return "analysis";
  if (source.startsWith("Specialist:")) return "analysis";
  if (synthesisSources.includes(source)) return "synthesis";
  return "synthesis"; // Default to synthesis for unknown sources
}

/**
 * Create empty PR logs structure
 */
function createEmptyPRLogs(prNumber: number, repo: string, isFollowup: boolean): PRLogs {
  const now = new Date().toISOString();
  const createEmptyPhase = (phase: PRLogPhase): PRPhaseLog => ({
    phase,
    status: "pending",
    started_at: null,
    completed_at: null,
    entries: [],
  });

  return {
    pr_number: prNumber,
    repo,
    created_at: now,
    updated_at: now,
    is_followup: isFollowup,
    phases: {
      context: createEmptyPhase("context"),
      analysis: createEmptyPhase("analysis"),
      synthesis: createEmptyPhase("synthesis"),
    },
  };
}

/**
 * Get PR logs file path
 *
 * Logs are stored at `.auto-claude/github/pr/logs_${prNumber}.json` within the project directory.
 * This provides persistent storage for streaming log data during PR reviews.
 */
function getPRLogsPath(project: Project, prNumber: number): string {
  return path.join(getGitHubDir(project), "pr", `logs_${prNumber}.json`);
}

/**
 * Load PR logs from disk
 *
 * This function is called by:
 * 1. The IPC handler (GITHUB_PR_GET_LOGS) when the frontend polls for log updates
 * 2. The frontend polling mechanism (every 1.5s during active review)
 * 3. The fallback mechanism after review completion
 *
 * Returns null if the logs file doesn't exist yet (review hasn't started)
 * or if the file is corrupted/unreadable.
 */
function loadPRLogs(project: Project, prNumber: number): PRLogs | null {
  const logsPath = getPRLogsPath(project, prNumber);

  try {
    const rawData = fs.readFileSync(logsPath, "utf-8");
    const sanitizedData = sanitizeNetworkData(rawData);
    return JSON.parse(sanitizedData) as PRLogs;
  } catch {
    return null;
  }
}

/**
 * Save PR logs to disk
 *
 * Called by PRLogCollector.save() to persist logs incrementally during review.
 * This enables real-time streaming to the frontend via file-based polling.
 *
 * The logs file is written atomically and includes:
 * - Phase status (pending/active/completed/failed)
 * - Log entries for each phase (context, analysis, synthesis)
 * - Timestamps for created_at and updated_at
 * - Review metadata (PR number, repo, followup status)
 */
function savePRLogs(project: Project, logs: PRLogs): void {
  const logsPath = getPRLogsPath(project, logs.pr_number);
  const prDir = path.dirname(logsPath);

  if (!fs.existsSync(prDir)) {
    fs.mkdirSync(prDir, { recursive: true });
  }

  logs.updated_at = new Date().toISOString();
  fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2), "utf-8");
}

/**
 * Add a log entry to PR logs
 * Returns true if the phase status changed (for triggering immediate save)
 */
function addLogEntry(logs: PRLogs, entry: PRLogEntry): boolean {
  const phase = logs.phases[entry.phase];
  let statusChanged = false;

  // Start the phase if it was pending
  if (phase.status === "pending") {
    phase.status = "active";
    phase.started_at = entry.timestamp;
    statusChanged = true;
  }

  phase.entries.push(entry);
  return statusChanged;
}

/**
 * PR Log Collector - collects logs during review
 * Saves incrementally to disk so frontend can stream logs in real-time
 *
 * Log Streaming Architecture:
 * ===========================
 * This class implements a hybrid push/pull approach for real-time log streaming:
 *
 * 1. **File-Based Storage**: Logs are saved to disk every 3 entries (saveInterval)
 *    - Location: .auto-claude/github/pr/logs_${prNumber}.json
 *    - Format: JSON with phase status and log entries
 *
 * 2. **Push-Based Updates**: Emits IPC events (GITHUB_PR_LOGS_UPDATED) after each save
 *    - Notifies frontend immediately when new logs are available
 *    - Includes phase status and entry count for quick UI updates
 *
 * 3. **Pull-Based Polling**: Frontend polls via loadPRLogs() every 1.5s as fallback
 *    - Ensures logs are displayed even if IPC events are missed
 *    - Provides resilience against event delivery failures
 *
 * This hybrid approach ensures reliable real-time updates while maintaining
 * simplicity and debuggability (logs are always on disk for inspection).
 */
class PRLogCollector {
  private logs: PRLogs;
  private project: Project;
  private currentPhase: PRLogPhase = "context";
  private entryCount: number = 0;
  private saveInterval: number = 3; // Save every N entries for real-time streaming
  private mainWindow: BrowserWindow | null;

  constructor(
    project: Project,
    prNumber: number,
    repo: string,
    isFollowup: boolean,
    mainWindow?: BrowserWindow
  ) {
    this.project = project;
    this.logs = createEmptyPRLogs(prNumber, repo, isFollowup);
    this.mainWindow = mainWindow || null;

    // Trace: Log collector creation (verbose only)
    const logPath = getPRLogsPath(project, prNumber);
    traceLog("PRLogCollector created", {
      prNumber,
      repo,
      isFollowup,
      logPath,
      hasMainWindow: !!this.mainWindow
    });

    // Save initial empty logs so frontend sees the structure immediately
    this.save();
  }

  processLine(line: string): void {
    const parsed = parseLogLine(line);
    if (!parsed) return;

    const phase = getPhaseFromSource(parsed.source);

    // Trace: Log line processing (verbose only - fires on every log line)
    traceLog("PRLogCollector.processLine()", {
      prNumber: this.logs.pr_number,
      phase,
      currentPhase: this.currentPhase,
      source: parsed.source,
      isError: parsed.isError,
      entryCount: this.entryCount
    });

    // Track phase transitions - mark previous phases as complete (only if they were active)
    if (phase !== this.currentPhase) {
      // When moving to a new phase, mark the previous phase as complete
      // Only mark complete if the phase was actually active (received log entries)
      // This prevents marking phases as "completed" if they were skipped
      if (this.currentPhase === "context" && (phase === "analysis" || phase === "synthesis")) {
        if (this.logs.phases.context.status === "active") {
          this.markPhaseComplete("context", true);
        }
      }
      if (this.currentPhase === "analysis" && phase === "synthesis") {
        if (this.logs.phases.analysis.status === "active") {
          this.markPhaseComplete("analysis", true);
        }
      }
      this.currentPhase = phase;
    }

    const entry: PRLogEntry = {
      timestamp: new Date().toISOString(),
      type: parsed.isError ? "error" : "text",
      content: parsed.content,
      phase,
      source: parsed.source,
    };

    const phaseStatusChanged = addLogEntry(this.logs, entry);
    this.entryCount++;

    // Save immediately if phase status changed (so frontend sees phase activation)
    // OR save periodically for real-time streaming (every N entries)
    if (phaseStatusChanged || this.entryCount % this.saveInterval === 0) {
      this.save();
    }
  }

  markPhaseComplete(phase: PRLogPhase, success: boolean): void {
    const phaseLog = this.logs.phases[phase];
    phaseLog.status = success ? "completed" : "failed";
    phaseLog.completed_at = new Date().toISOString();
    // Save immediately so frontend sees the status change
    this.save();
  }

  /**
   * Save logs to disk and notify frontend
   *
   * This method is called:
   * 1. Every N entries (saveInterval = 3) for incremental streaming
   * 2. When phase status changes (pending → active, active → completed)
   * 3. On review finalization (success or failure)
   *
   * Two-step update mechanism:
   * --------------------------
   * 1. **File Write**: Persists logs to disk via savePRLogs()
   *    - Creates/updates .auto-claude/github/pr/logs_${prNumber}.json
   *    - Updates the `updated_at` timestamp
   *
   * 2. **IPC Push Event**: Sends GITHUB_PR_LOGS_UPDATED to renderer
   *    - Contains phase status summary (pending/active/completed/failed)
   *    - Includes entry count for detecting changes
   *    - Enables instant UI updates without polling delay
   *
   * The frontend receives the IPC event and can optionally trigger an
   * immediate poll via loadPRLogs() to fetch the latest log content.
   * This is more efficient than polling alone, as the UI can update
   * immediately when logs are available rather than waiting for the
   * next poll interval (1.5s).
   */
  save(): void {
    const logPath = getPRLogsPath(this.project, this.logs.pr_number);
    traceLog("PRLogCollector.save()", {
      prNumber: this.logs.pr_number,
      logPath,
      entryCount: this.entryCount,
      phases: Object.entries(this.logs.phases).map(([name, phase]) => ({
        name,
        status: phase.status,
        entryCount: phase.entries.length
      }))
    });

    // Step 1: Write logs to disk for persistence and polling-based retrieval
    savePRLogs(this.project, this.logs);

    // Step 2: Emit IPC event to notify renderer of log update (push-based)
    // Uses standard (projectId, data) pattern matching other IPC communicators
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.GITHUB_PR_LOGS_UPDATED, this.project.id, {
        prNumber: this.logs.pr_number,
        phaseStatus: {
          context: this.logs.phases.context.status,
          analysis: this.logs.phases.analysis.status,
          synthesis: this.logs.phases.synthesis.status
        },
        entryCount: this.entryCount
      });
    }
  }

  finalize(success: boolean): void {
    // Mark active phases as completed based on success status
    // Pending phases with no entries should stay pending (they never ran)
    for (const phase of ["context", "analysis", "synthesis"] as PRLogPhase[]) {
      const phaseLog = this.logs.phases[phase];
      if (phaseLog.status === "active") {
        this.markPhaseComplete(phase, success);
      }
      // Note: Pending phases stay pending - they never received any log entries
      // This is correct behavior for follow-up reviews where some phases may be skipped
    }
    this.save();
  }
}

/**
 * Get saved PR review result
 */
function getReviewResult(project: Project, prNumber: number): PRReviewResult | null {
  const reviewPath = path.join(getGitHubDir(project), "pr", `review_${prNumber}.json`);

  try {
    const rawData = fs.readFileSync(reviewPath, "utf-8");
    const sanitizedData = sanitizeNetworkData(rawData);
    const data = JSON.parse(sanitizedData);
    return {
      prNumber: data.pr_number,
      repo: data.repo,
      success: data.success,
      findings:
        data.findings?.map((f: Record<string, unknown>) => ({
          id: f.id,
          severity: f.severity,
          category: f.category,
          title: f.title,
          description: f.description,
          file: f.file,
          line: f.line,
          endLine: f.end_line,
          suggestedFix: f.suggested_fix,
          fixable: f.fixable ?? false,
          validationStatus: f.validation_status ?? null,
          validationExplanation: f.validation_explanation ?? undefined,
          sourceAgents: f.source_agents ?? [],
          crossValidated: f.cross_validated ?? false,
        })) ?? [],
      summary: data.summary ?? "",
      overallStatus: data.overall_status ?? "comment",
      reviewId: data.review_id,
      reviewedAt: data.reviewed_at ?? new Date().toISOString(),
      error: data.error,
      // Follow-up review fields (snake_case -> camelCase)
      reviewedCommitSha: data.reviewed_commit_sha,
      reviewedFileBlobs: data.reviewed_file_blobs,
      isFollowupReview: data.is_followup_review ?? false,
      previousReviewId: data.previous_review_id,
      resolvedFindings: data.resolved_findings ?? [],
      unresolvedFindings: data.unresolved_findings ?? [],
      newFindingsSinceLastReview: data.new_findings_since_last_review ?? [],
      // Track posted findings for follow-up review eligibility
      hasPostedFindings: data.has_posted_findings ?? false,
      postedFindingIds: data.posted_finding_ids ?? [],
      postedAt: data.posted_at,
      // In-progress review tracking
      inProgressSince: data.in_progress_since,
    };
  } catch {
    // File doesn't exist or couldn't be read
    return null;
  }
}

/**
 * Send a PR review state update event to the renderer to refresh the UI immediately.
 * Used after operations that modify review state (post, mark posted, delete).
 */
function sendReviewStateUpdate(
  project: Project,
  prNumber: number,
  projectId: string,
  getMainWindow: () => BrowserWindow | null,
  context: string
): void {
  try {
    const updatedResult = getReviewResult(project, prNumber);
    if (!updatedResult) {
      debugLog("Could not retrieve updated review result for UI notification", { prNumber, context });
      return;
    }
    const mainWindow = getMainWindow();
    if (!mainWindow) return;
    const { sendComplete } = createIPCCommunicators<PRReviewProgress, PRReviewResult>(
      mainWindow,
      {
        progress: IPC_CHANNELS.GITHUB_PR_REVIEW_PROGRESS,
        error: IPC_CHANNELS.GITHUB_PR_REVIEW_ERROR,
        complete: IPC_CHANNELS.GITHUB_PR_REVIEW_COMPLETE,
      },
      projectId
    );
    sendComplete(updatedResult);
    debugLog(`Sent PR review state update ${context}`, { prNumber });
  } catch (uiError) {
    debugLog("Failed to send UI update (non-critical)", {
      prNumber,
      context,
      error: uiError instanceof Error ? uiError.message : uiError,
    });
  }
}

/**
 * Get GitHub PR model and thinking settings from app settings
 */
function getGitHubPRSettings(): { model: string; thinkingLevel: string } {
  const rawSettings = readSettingsFile() as Partial<AppSettings> | undefined;

  // Get feature models/thinking with defaults
  const featureModels = rawSettings?.featureModels ?? DEFAULT_FEATURE_MODELS;
  const featureThinking = rawSettings?.featureThinking ?? DEFAULT_FEATURE_THINKING;

  // Get PR-specific settings (with fallback to defaults)
  // Return the raw shorthand — createSimpleClient() handles model-to-provider resolution
  // via resolveModelId() and the priority queue. Do NOT resolve through MODEL_ID_MAP
  // which is Anthropic-only and would silently replace non-Anthropic models.
  const model = featureModels.githubPrs ?? DEFAULT_FEATURE_MODELS.githubPrs;
  const thinkingLevel = featureThinking.githubPrs ?? DEFAULT_FEATURE_THINKING.githubPrs;

  debugLog("GitHub PR settings", { model, thinkingLevel });

  return { model, thinkingLevel };
}

/**
 * Fetch complete PR context from GitHub API for TypeScript review engine.
 */
async function fetchPRContext(
  config: { token: string; repo: string },
  prNumber: number
): Promise<PRContext> {
  // Fetch PR metadata
  const pr = (await githubFetch(
    config.token,
    `/repos/${config.repo}/pulls/${prNumber}`
  )) as {
    number: number;
    title: string;
    body?: string;
    state: string;
    user: { login: string };
    head: { ref: string; sha: string };
    base: { ref: string };
    additions: number;
    deletions: number;
    labels?: Array<{ name: string }>;
  };

  // Fetch files with patches
  const files = (await githubFetch(
    config.token,
    `/repos/${config.repo}/pulls/${prNumber}/files?per_page=100`
  )) as Array<{
    filename: string;
    additions: number;
    deletions: number;
    status: string;
    patch?: string;
  }>;

  // Fetch commits
  const commits = (await githubFetch(
    config.token,
    `/repos/${config.repo}/pulls/${prNumber}/commits?per_page=100`
  )) as Array<{
    sha: string;
    commit: { message: string; committer?: { date?: string } };
  }>;

  // Fetch diff (for full diff context)
  let diff = "";
  let diffTruncated = false;
  try {
    const { execFileSync } = await import("child_process");
    if (Number.isInteger(prNumber) && prNumber > 0) {
      const rawDiff = execFileSync("gh", ["pr", "diff", String(prNumber)], {
        cwd: config.repo.split("/")[1] ? undefined : undefined,
        encoding: "utf-8",
        env: getAugmentedEnv(),
        timeout: 30000,
      });
      if (rawDiff.length > 200000) {
        diff = rawDiff.slice(0, 200000);
        diffTruncated = true;
      } else {
        diff = rawDiff;
      }
    }
  } catch {
    // If gh CLI fails, build diff from patches
    diff = files
      .filter((f) => f.patch)
      .map((f) => `diff --git a/${f.filename} b/${f.filename}\n${f.patch}`)
      .join("\n");
  }

  // Fetch AI bot comments (review comments from known AI tools)
  let aiBotComments: AIBotComment[] = [];
  try {
    const reviewComments = (await githubFetch(
      config.token,
      `/repos/${config.repo}/pulls/${prNumber}/comments?per_page=100`
    )) as Array<{
      id: number;
      user: { login: string };
      body: string;
      path?: string;
      line?: number;
      created_at: string;
    }>;

    const AI_BOTS = ["coderabbitai", "cursor-ai", "greptile", "sourcery-ai", "codeflash-ai"];
    aiBotComments = reviewComments
      .filter((c) => AI_BOTS.some((bot) => c.user.login.toLowerCase().includes(bot)))
      .map((c) => ({
        commentId: c.id,
        author: c.user.login,
        toolName: AI_BOTS.find((bot) => c.user.login.toLowerCase().includes(bot)) ?? c.user.login,
        body: c.body,
        file: c.path,
        line: c.line,
        createdAt: c.created_at,
      }));
  } catch {
    // Non-critical — continue without bot comments
  }

  const changedFiles: ChangedFile[] = files.map((f) => ({
    path: f.filename,
    additions: f.additions,
    deletions: f.deletions,
    status: f.status,
    patch: f.patch,
  }));

  return {
    prNumber: pr.number,
    title: pr.title,
    description: pr.body ?? "",
    author: pr.user.login,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    state: pr.state,
    changedFiles,
    diff,
    diffTruncated,
    repoStructure: "",
    relatedFiles: [],
    commits: commits.map((c) => ({
      oid: c.sha,
      messageHeadline: c.commit.message.split("\n")[0] ?? "",
      committedDate: c.commit.committer?.date ?? "",
    })),
    labels: pr.labels?.map((l) => l.name) ?? [],
    totalAdditions: pr.additions,
    totalDeletions: pr.deletions,
    aiBotComments,
  };
}

/**
 * Save PR review result to disk in the format expected by getReviewResult().
 */
function saveReviewResultToDisk(
  project: Project,
  prNumber: number,
  result: PRReviewResult
): void {
  const prDir = path.join(getGitHubDir(project), "pr");
  fs.mkdirSync(prDir, { recursive: true });
  const reviewPath = path.join(prDir, `review_${prNumber}.json`);

  const data = {
    pr_number: result.prNumber,
    repo: result.repo,
    success: result.success,
    findings: result.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      category: f.category,
      title: f.title,
      description: f.description,
      file: f.file,
      line: f.line,
      end_line: f.endLine,
      suggested_fix: f.suggestedFix,
      fixable: f.fixable,
      validation_status: f.validationStatus ?? null,
      validation_explanation: f.validationExplanation,
      source_agents: f.sourceAgents ?? [],
      cross_validated: f.crossValidated ?? false,
    })),
    summary: result.summary,
    overall_status: result.overallStatus,
    review_id: result.reviewId,
    reviewed_at: result.reviewedAt,
    error: result.error,
    reviewed_commit_sha: result.reviewedCommitSha,
    reviewed_file_blobs: result.reviewedFileBlobs,
    is_followup_review: result.isFollowupReview ?? false,
    previous_review_id: result.previousReviewId,
    resolved_findings: result.resolvedFindings ?? [],
    unresolved_findings: result.unresolvedFindings ?? [],
    new_findings_since_last_review: result.newFindingsSinceLastReview ?? [],
    has_posted_findings: result.hasPostedFindings ?? false,
    posted_finding_ids: result.postedFindingIds ?? [],
    posted_at: result.postedAt,
    in_progress_since: result.inProgressSince,
  };

  // CodeQL: network data validated before write - data object is constructed from typed PRReviewResult
  // fields with explicit property mapping; re-serializing ensures no prototype pollution
  fs.writeFileSync(reviewPath, JSON.stringify(JSON.parse(JSON.stringify(data)), null, 2), "utf-8");
}

/**
 * Run the TypeScript PR reviewer
 */
async function runPRReview(
  project: Project,
  prNumber: number,
  mainWindow: BrowserWindow
): Promise<PRReviewResult> {
  const { sendProgress } = createIPCCommunicators<PRReviewProgress, PRReviewResult>(
    mainWindow,
    {
      progress: IPC_CHANNELS.GITHUB_PR_REVIEW_PROGRESS,
      error: IPC_CHANNELS.GITHUB_PR_REVIEW_ERROR,
      complete: IPC_CHANNELS.GITHUB_PR_REVIEW_COMPLETE,
    },
    project.id
  );

  const config = getGitHubConfig(project);
  if (!config) {
    throw new Error("No GitHub configuration found for project");
  }

  const repo = config.repo;
  const { model, thinkingLevel } = getGitHubPRSettings();
  const reviewKey = getReviewKey(project.id, prNumber);

  safeBreadcrumb({
    category: 'pr-review',
    message: 'Starting TypeScript PR review',
    level: 'info',
    data: { model, thinkingLevel, prNumber, repo },
  });

  // Create log collector for this review
  const logCollector = new PRLogCollector(project, prNumber, repo, false, mainWindow);

  // Create AbortController for cancellation
  const abortController = new AbortController();
  runningReviews.set(reviewKey, abortController);
  debugLog("Registered review abort controller", { reviewKey });

  try {
    logCollector.processLine(`[fetching] Fetching PR #${prNumber} from GitHub...`);
    sendProgress({ phase: "fetching", prNumber, progress: 15, message: "Fetching PR data from GitHub..." });

    const context = await fetchPRContext(config, prNumber);
    logCollector.processLine(`[Context] Fetched ${context.changedFiles.length} changed files, ${context.commits.length} commits`);

    sendProgress({ phase: "analyzing", prNumber, progress: 30, message: "Starting parallel orchestrator review..." });

    const orchestratorConfig: ParallelOrchestratorConfig = {
      repo,
      projectDir: project.path,
      model: model as ModelShorthand,
      thinkingLevel: thinkingLevel as ThinkingLevel,
    };

    const orchestrator = new ParallelOrchestratorReviewer(
      orchestratorConfig,
      (update) => {
        const allowedPhases = new Set(["fetching", "analyzing", "generating", "posting", "complete"]);
        const phase = (allowedPhases.has(update.phase) ? update.phase : "analyzing") as PRReviewProgress["phase"];
        sendProgress({
          phase,
          prNumber,
          progress: update.progress,
          message: update.message,
        });
        // If the message already has a bracket prefix (e.g., [Specialist:security],
        // [ParallelOrchestrator], [FindingValidator]), pass it directly so parseLogLine()
        // extracts the correct source for frontend grouping.
        // Otherwise, wrap with [phase] so bare messages aren't silently dropped.
        const logLine = update.message.startsWith('[')
          ? update.message
          : `[${update.phase}] ${update.message}`;
        logCollector.processLine(logLine);
      },
    );

    const orchestratorResult = await orchestrator.review(context, abortController.signal);

    // Map orchestrator verdict to overallStatus
    const verdictToStatus: Record<string, "approve" | "request_changes" | "comment"> = {
      ready_to_merge: "approve",
      merge_with_changes: "comment",
      needs_revision: "request_changes",
      blocked: "request_changes",
    };
    const overallStatus = verdictToStatus[orchestratorResult.verdict] ?? "comment";

    const result: PRReviewResult = {
      prNumber,
      repo,
      success: true,
      findings: orchestratorResult.findings as PRReviewFinding[],
      summary: orchestratorResult.summary,
      overallStatus,
      reviewedAt: new Date().toISOString(),
    };

    // Save to disk
    saveReviewResultToDisk(project, prNumber, result);
    debugLog("Review result saved to disk", { findingsCount: result.findings.length });

    // Emit synthesis-phase log lines before finalizing
    logCollector.processLine(`[Summary] ${orchestratorResult.findings.length} findings, verdict: ${orchestratorResult.verdict}`);
    logCollector.processLine(`[Summary] Agents: ${orchestratorResult.agentsInvoked.join(", ")}`);

    // Finalize logs
    logCollector.finalize(true);

    safeBreadcrumb({
      category: 'pr-review',
      message: 'PR review completed',
      level: 'info',
      data: { prNumber, findingsCount: result.findings.length, overallStatus },
    });

    // Save PR review insights to memory (async, non-blocking)
    savePRReviewToMemory(result, repo, false).catch((err) => {
      debugLog("Failed to save PR review to memory", { error: (err as Error).message });
    });

    return result;
  } catch (err) {
    logCollector.finalize(false);

    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Review cancelled");
    }

    safeCaptureException(
      err instanceof Error ? err : new Error(String(err)),
      { extra: { prNumber, repo } }
    );
    throw err;
  } finally {
    runningReviews.delete(reviewKey);
    debugLog("Unregistered review abort controller", { reviewKey });
  }
}

/**
 * Shared helper to fetch PRs via GraphQL API.
 * Used by both listPRs and listMorePRs handlers to avoid code duplication.
 */
async function fetchPRsFromGraphQL(
  config: { token: string; repo: string },
  cursor: string | null,
  debugContext: string
): Promise<PRListResult> {
  // Parse owner/repo from config - must be exactly "owner/repo" format
  const normalizedRepo = normalizeRepoReference(config.repo);
  const repoParts = normalizedRepo.split("/");
  if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
    debugLog("Invalid repo format - expected 'owner/repo'", {
      repo: config.repo,
      normalized: normalizedRepo,
      context: debugContext,
    });
    return { prs: [], hasNextPage: false, endCursor: null };
  }
  const [owner, repo] = repoParts;

  try {
    // Use GraphQL API to get PRs with diff stats (REST list endpoint doesn't include them)
    // Fetches up to 100 open PRs (GitHub GraphQL max per request)
    const response = await githubGraphQL<GraphQLPRListResponse>(
      config.token,
      LIST_PRS_QUERY,
      {
        owner,
        repo,
        first: 100, // GitHub GraphQL max is 100
        after: cursor,
      }
    );

    // Handle case where repository doesn't exist or user lacks access
    if (!response.data.repository) {
      debugLog("Repository not found or access denied", { owner, repo, context: debugContext });
      return { prs: [], hasNextPage: false, endCursor: null };
    }

    const { nodes: prNodes, pageInfo } = response.data.repository.pullRequests;

    debugLog(`Fetched PRs via GraphQL (${debugContext})`, {
      count: prNodes.length,
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor,
    });
    return {
      prs: prNodes.map(mapGraphQLPRToData),
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor,
    };
  } catch (error) {
    debugLog(`Failed to fetch PRs (${debugContext})`, {
      error: error instanceof Error ? error.message : error,
    });
    return { prs: [], hasNextPage: false, endCursor: null };
  }
}

/**
 * Register PR-related handlers
 */
export function registerPRHandlers(getMainWindow: () => BrowserWindow | null): void {
  debugLog("Registering PR handlers");

  const stateManager = new PRReviewStateManager(getMainWindow);

  // Reset XState actors when GitHub auth changes
  ipcMain.on(IPC_CHANNELS.GITHUB_AUTH_CHANGED, () => {
    stateManager.handleAuthChange();
  });

  // List open PRs - fetches up to 100 open PRs at once, returns hasNextPage and endCursor from API
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_LIST,
    async (_, projectId: string): Promise<PRListResult> => {
      debugLog("listPRs handler called", { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) {
          debugLog("No GitHub config found for project");
          return { prs: [], hasNextPage: false, endCursor: null };
        }
        return fetchPRsFromGraphQL(config, null, "initial");
      });
      return result ?? { prs: [], hasNextPage: false, endCursor: null };
    }
  );

  // Load more PRs (pagination) - fetches next page of PRs using cursor
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_LIST_MORE,
    async (_, projectId: string, cursor: string): Promise<PRListResult> => {
      debugLog("listMorePRs handler called", { projectId, cursor });
      const result = await withProjectOrNull(projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) {
          debugLog("No GitHub config found for project");
          return { prs: [], hasNextPage: false, endCursor: null };
        }
        return fetchPRsFromGraphQL(config, cursor, "pagination");
      });
      return result ?? { prs: [], hasNextPage: false, endCursor: null };
    }
  );

  // Get single PR
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_GET,
    async (_, projectId: string, prNumber: number): Promise<PRData | null> => {
      debugLog("getPR handler called", { projectId, prNumber });
      return withProjectOrNull(projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) return null;

        try {
          const pr = (await githubFetch(
            config.token,
            `/repos/${config.repo}/pulls/${prNumber}`
          )) as {
            number: number;
            title: string;
            body?: string;
            state: string;
            user: { login: string };
            head: { ref: string };
            base: { ref: string };
            additions: number;
            deletions: number;
            changed_files: number;
            assignees?: Array<{ login: string }>;
            created_at: string;
            updated_at: string;
            html_url: string;
          };

          const files = (await githubFetch(
            config.token,
            `/repos/${config.repo}/pulls/${prNumber}/files`
          )) as Array<{
            filename: string;
            additions: number;
            deletions: number;
            status: string;
          }>;

          return {
            number: pr.number,
            title: pr.title,
            body: pr.body ?? "",
            state: pr.state,
            author: { login: pr.user.login },
            headRefName: pr.head.ref,
            baseRefName: pr.base.ref,
            additions: pr.additions ?? 0,
            deletions: pr.deletions ?? 0,
            changedFiles: pr.changed_files ?? 0,
            assignees: pr.assignees?.map((a: { login: string }) => ({ login: a.login })) ?? [],
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions ?? 0,
              deletions: f.deletions ?? 0,
              status: f.status,
            })),
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            htmlUrl: pr.html_url,
          };
        } catch {
          return null;
        }
      });
    }
  );

  // Get PR diff
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_GET_DIFF,
    async (_, projectId: string, prNumber: number): Promise<string | null> => {
      return withProjectOrNull(projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) return null;

        try {
          const { execFileSync } = await import("child_process");
          // Validate prNumber to prevent command injection
          if (!Number.isInteger(prNumber) || prNumber <= 0) {
            throw new Error("Invalid PR number");
          }
          // Use execFileSync with arguments array to prevent command injection
          const diff = execFileSync("gh", ["pr", "diff", String(prNumber)], {
            cwd: project.path,
            encoding: "utf-8",
            env: getAugmentedEnv(),
          });
          return diff;
        } catch {
          return null;
        }
      });
    }
  );

  // Get saved review
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_GET_REVIEW,
    async (_, projectId: string, prNumber: number): Promise<PRReviewResult | null> => {
      return withProjectOrNull(projectId, async (project) => {
        return getReviewResult(project, prNumber);
      });
    }
  );

  // Batch get saved reviews - more efficient than individual calls
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_GET_REVIEWS_BATCH,
    async (
      _,
      projectId: string,
      prNumbers: number[]
    ): Promise<Record<number, PRReviewResult | null>> => {
      debugLog("getReviewsBatch handler called", { projectId, count: prNumbers.length });
      const result = await withProjectOrNull(projectId, async (project) => {
        const reviews: Record<number, PRReviewResult | null> = {};
        for (const prNumber of prNumbers) {
          reviews[prNumber] = getReviewResult(project, prNumber);
        }
        debugLog("Batch loaded reviews", {
          count: Object.values(reviews).filter((r) => r !== null).length,
        });
        return reviews;
      });
      return result ?? {};
    }
  );

  /**
   * Get PR review logs (IPC Handler)
   *
   * This handler is called by the frontend's polling mechanism to retrieve
   * the latest log data from disk.
   *
   * Polling Strategy (Frontend):
   * ============================
   * 1. **Initial Load**: When logs section expands, loads logs once via this handler
   * 2. **Active Review Polling**: Every 1.5s while review is running (isReviewing = true)
   * 3. **Final Refresh**: One final poll when review completes to capture final status
   * 4. **Fallback Load**: 500ms delayed load after completion if polling missed final logs
   *
   * Why Polling + Push Hybrid?
   * ===========================
   * - Push (IPC events): Fast notifications when logs are saved by PRLogCollector
   * - Pull (polling): Guarantees logs are fetched even if IPC events are missed
   * - File-based: Simple, debuggable, survives app crashes/restarts
   *
   * Returns null if logs file doesn't exist yet (review hasn't started).
   */
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_GET_LOGS,
    async (_, projectId: string, prNumber: number): Promise<PRLogs | null> => {
      return withProjectOrNull(projectId, async (project) => {
        return loadPRLogs(project, prNumber);
      });
    }
  );

  // Run AI review
  ipcMain.on(IPC_CHANNELS.GITHUB_PR_REVIEW, async (_, projectId: string, prNumber: number) => {
    debugLog("runPRReview handler called", { projectId, prNumber });
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      debugLog("No main window available");
      return;
    }

    const reviewKey = getReviewKey(projectId, prNumber);

    try {
      await withProjectOrNull(projectId, async (project) => {
        const { sendProgress, sendComplete } = createIPCCommunicators<
          PRReviewProgress,
          PRReviewResult
        >(
          mainWindow,
          {
            progress: IPC_CHANNELS.GITHUB_PR_REVIEW_PROGRESS,
            error: IPC_CHANNELS.GITHUB_PR_REVIEW_ERROR,
            complete: IPC_CHANNELS.GITHUB_PR_REVIEW_COMPLETE,
          },
          projectId
        );

        // Check if already running — notify renderer so it can display ongoing logs
        if (runningReviews.has(reviewKey)) {
          debugLog("Review already running, notifying renderer", { reviewKey });
          sendProgress({
            phase: "analyzing",
            prNumber,
            progress: 50,
            message: "Review is already in progress. Reconnecting to ongoing review...",
          });
          return;
        }

        // Register as running BEFORE CI wait to prevent race conditions
        // Use CI_WAIT_PLACEHOLDER sentinel until real process is spawned
        runningReviews.set(reviewKey, CI_WAIT_PLACEHOLDER);
        const abortController = new AbortController();
        ciWaitAbortControllers.set(reviewKey, abortController);
        debugLog("Registered review placeholder", { reviewKey });

        // Notify XState immediately — renderer gets instant "reviewing" state
        stateManager.handleStartReview(projectId, prNumber);

        try {
          debugLog("Starting PR review", { prNumber });
          const startProgress: PRReviewProgress = {
            phase: "fetching",
            prNumber,
            progress: 5,
            message: "Assigning you to PR...",
          };
          sendProgress(startProgress);
          stateManager.handleProgress(projectId, prNumber, startProgress);

          // Auto-assign current user to PR
          const config = getGitHubConfig(project);
          if (config) {
            try {
              // Get current user
              const user = (await githubFetch(config.token, "/user")) as { login: string };
              debugLog("Auto-assigning user to PR", { prNumber, username: user.login });

              // Assign to PR
              await githubFetch(config.token, `/repos/${config.repo}/issues/${prNumber}/assignees`, {
                method: "POST",
                body: JSON.stringify({ assignees: [user.login] }),
              });
              debugLog("User assigned successfully", { prNumber, username: user.login });
            } catch (assignError) {
              // Don't fail the review if assignment fails, just log it
              debugLog("Failed to auto-assign user", {
                prNumber,
                error: assignError instanceof Error ? assignError.message : assignError,
              });
            }
          }

          // Wait for CI checks to complete before starting review
          if (config) {
            const shouldProceed = await performCIWaitCheck(
              config,
              prNumber,
              sendProgress,
              "review",
              abortController.signal
            );
            if (!shouldProceed) {
              debugLog("Review cancelled during CI wait", { reviewKey });
              return;
            }
          }

          // Clean up abort controller since CI wait is done
          ciWaitAbortControllers.delete(reviewKey);

          const fetchProgress: PRReviewProgress = {
            phase: "fetching",
            prNumber,
            progress: 10,
            message: "Fetching PR data...",
          };
          sendProgress(fetchProgress);
          stateManager.handleProgress(projectId, prNumber, fetchProgress);

          const result = await runPRReview(project, prNumber, mainWindow);

          if (result.overallStatus === "in_progress") {
            // Review is already running externally (detected by BotDetector).
            // Send the result as-is so the renderer can activate external review polling.
            debugLog("PR review already in progress externally", { prNumber });
            sendProgress({
              phase: "complete",
              prNumber,
              progress: 100,
              message: "Review already in progress",
            });
            stateManager.handleComplete(projectId, prNumber, result as unknown as PreloadPRReviewResult);
            sendComplete(result);
            return;
          }

          debugLog("PR review completed", { prNumber, findingsCount: result.findings.length });
          sendProgress({
            phase: "complete",
            prNumber,
            progress: 100,
            message: "Review complete!",
          });

          stateManager.handleComplete(projectId, prNumber, result as unknown as PreloadPRReviewResult);
          sendComplete(result);
        } finally {
          // Clean up in case we exit before runPRReview was called (e.g., cancelled during CI wait)
          // runPRReview also has its own cleanup, but delete is idempotent
          // Only delete if still placeholder (don't delete actual process entry set by runPRReview)
          const entry = runningReviews.get(reviewKey);
          if (entry === CI_WAIT_PLACEHOLDER) {
            runningReviews.delete(reviewKey);
          }
          ciWaitAbortControllers.delete(reviewKey);
        }
      });
    } catch (error) {
      debugLog("PR review failed", {
        prNumber,
        error: error instanceof Error ? error.message : error,
      });
      const { sendError } = createIPCCommunicators<PRReviewProgress, PRReviewResult>(
        mainWindow,
        {
          progress: IPC_CHANNELS.GITHUB_PR_REVIEW_PROGRESS,
          error: IPC_CHANNELS.GITHUB_PR_REVIEW_ERROR,
          complete: IPC_CHANNELS.GITHUB_PR_REVIEW_COMPLETE,
        },
        projectId
      );
      const errorMessage = error instanceof Error ? error.message : "Failed to run PR review";
      stateManager.handleError(projectId, prNumber, errorMessage);
      sendError({ prNumber, error: errorMessage });
    }
  });

  // Post review to GitHub
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_POST_REVIEW,
    async (
      _,
      projectId: string,
      prNumber: number,
      selectedFindingIds?: string[],
      options?: { forceApprove?: boolean }
    ): Promise<boolean> => {
      debugLog("postPRReview handler called", {
        projectId,
        prNumber,
        selectedCount: selectedFindingIds?.length,
        forceApprove: options?.forceApprove,
      });
      const postResult = await withProjectOrNull(projectId, async (project) => {
        const result = getReviewResult(project, prNumber);
        if (!result) {
          debugLog("No review result found", { prNumber });
          return false;
        }

        const config = getGitHubConfig(project);
        if (!config) {
          debugLog("No GitHub config found");
          return false;
        }

        try {
          // Filter findings if selection provided
          const selectedSet = selectedFindingIds ? new Set(selectedFindingIds) : null;
          const findings = selectedSet
            ? result.findings.filter((f) => selectedSet.has(f.id))
            : result.findings;

          debugLog("Posting findings", {
            total: result.findings.length,
            selected: findings.length,
          });

          // Build review body - different format for auto-approve with suggestions
          let body: string;

          if (options?.forceApprove) {
            // Auto-approve format: clean approval message with optional suggestions
            body = `## ✅ Aperant Review - APPROVED\n\n`;
            body += `**Status:** Ready to Merge\n\n`;
            body += `**Summary:** ${result.summary}\n\n`;

            if (findings.length > 0) {
              body += `---\n\n`;
              body += `### 💡 Suggestions (${findings.length})\n\n`;
              body += `*These are non-blocking suggestions for consideration:*\n\n`;

              for (const f of findings) {
                const emoji =
                  { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" }[f.severity] || "⚪";
                body += `#### ${emoji} [${f.id}] [${f.severity.toUpperCase()}] ${f.title}\n`;
                body += `📁 \`${f.file}:${f.line}\`\n\n`;
                body += `${f.description}\n\n`;
                const suggestedFix = f.suggestedFix?.trim();
                if (suggestedFix) {
                  body += `**Suggested fix:**\n\`\`\`\n${suggestedFix}\n\`\`\`\n\n`;
                }
              }
            }

            body += `---\n*This automated review found no blocking issues. The PR can be safely merged.*\n\n`;
            body += `*Generated by Aperant*`;
          } else {
            // Standard review format
            body = `## 🤖 Aperant PR Review\n\n${result.summary}\n\n`;

            if (findings.length > 0) {
              // Show selected count vs total if filtered
              const countText = selectedSet
                ? `${findings.length} selected of ${result.findings.length} total`
                : `${findings.length} total`;
              body += `### Findings (${countText})\n\n`;

              for (const f of findings) {
                const emoji =
                  { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" }[f.severity] || "⚪";
                body += `#### ${emoji} [${f.id}] [${f.severity.toUpperCase()}] ${f.title}\n`;
                body += `📁 \`${f.file}:${f.line}\`\n\n`;
                body += `${f.description}\n\n`;
                // Only show suggested fix if it has actual content
                const suggestedFix = f.suggestedFix?.trim();
                if (suggestedFix) {
                  body += `**Suggested fix:**\n\`\`\`\n${suggestedFix}\n\`\`\`\n\n`;
                }
              }
            } else {
              body += `*No findings selected for this review.*\n\n`;
            }

            body += `---\n*This review was generated by Aperant.*`;
          }

          // Determine review status based on selected findings (or force approve)
          let overallStatus = result.overallStatus;
          if (options?.forceApprove) {
            // Force approve regardless of findings
            overallStatus = "approve";
          } else if (selectedSet) {
            const hasBlocker = findings.some(
              (f) => f.severity === "critical" || f.severity === "high"
            );
            overallStatus = hasBlocker
              ? "request_changes"
              : findings.length > 0
                ? "comment"
                : "approve";
          }

          // Map to GitHub API event type
          const event =
            overallStatus === "approve"
              ? "APPROVE"
              : overallStatus === "request_changes"
                ? "REQUEST_CHANGES"
                : "COMMENT";

          debugLog("Posting review to GitHub", {
            prNumber,
            status: overallStatus,
            event,
            findingsCount: findings.length,
          });

          // Post review via GitHub API to capture review ID
          let reviewId: number;
          try {
            const reviewResponse = (await githubFetch(
              config.token,
              `/repos/${config.repo}/pulls/${prNumber}/reviews`,
              {
                method: "POST",
                body: JSON.stringify({
                  body,
                  event,
                }),
              }
            )) as { id: number };
            reviewId = reviewResponse.id;
          } catch (error) {
            // GitHub doesn't allow REQUEST_CHANGES or APPROVE on your own PR
            // Fall back to COMMENT if that's the error
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (
              errorMsg.includes("Can not request changes on your own pull request") ||
              errorMsg.includes("Can not approve your own pull request")
            ) {
              debugLog("Cannot use REQUEST_CHANGES/APPROVE on own PR, falling back to COMMENT", {
                prNumber,
              });
              const fallbackResponse = (await githubFetch(
                config.token,
                `/repos/${config.repo}/pulls/${prNumber}/reviews`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    body,
                    event: "COMMENT",
                  }),
                }
              )) as { id: number };
              reviewId = fallbackResponse.id;
            } else {
              throw error;
            }
          }
          debugLog("Review posted successfully", { prNumber, reviewId });

          // Update the stored review result with the review ID and posted findings
          const reviewPath = path.join(getGitHubDir(project), "pr", `review_${prNumber}.json`);
          try {
            const rawData = fs.readFileSync(reviewPath, "utf-8");
            // Sanitize network data before parsing (review may contain data from GitHub API)
            const sanitizedData = sanitizeNetworkData(rawData);
            const data = JSON.parse(sanitizedData);
            data.review_id = reviewId;
            // Track posted findings to enable follow-up review
            data.has_posted_findings = true;
            const newPostedIds = findings.map((f) => f.id);
            const existingPostedIds = data.posted_finding_ids || [];
            data.posted_finding_ids = [...new Set([...existingPostedIds, ...newPostedIds])];
            data.posted_at = new Date().toISOString();
            fs.writeFileSync(reviewPath, JSON.stringify(data, null, 2), "utf-8");
            debugLog("Updated review result with review ID and posted findings", {
              prNumber,
              reviewId,
              postedCount: newPostedIds.length,
            });
          } catch {
            // File doesn't exist or couldn't be read - this is expected for new reviews
            debugLog("Review result file not found or unreadable, skipping update", { prNumber });
          }

          // Send state update event to refresh UI immediately (non-blocking)
          sendReviewStateUpdate(project, prNumber, projectId, getMainWindow, "after posting");

          return true;
        } catch (error) {
          debugLog("Failed to post review", {
            prNumber,
            error: error instanceof Error ? error.message : error,
          });
          return false;
        }
      });
      return postResult ?? false;
    }
  );

  // Mark review as posted (persists has_posted_findings to disk)
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_MARK_REVIEW_POSTED,
    async (_, projectId: string, prNumber: number): Promise<boolean> => {
      debugLog("markReviewPosted handler called", { projectId, prNumber });
      const result = await withProjectOrNull(projectId, async (project) => {
        try {
          const reviewPath = path.join(getGitHubDir(project), "pr", `review_${prNumber}.json`);

          // Read file directly without separate existence check to avoid TOCTOU race condition
          // If file doesn't exist, readFileSync will throw ENOENT which we handle below
          const rawData = fs.readFileSync(reviewPath, "utf-8");
          // Sanitize data before parsing (review may contain data from GitHub API)
          const sanitizedData = sanitizeNetworkData(rawData);
          const data = JSON.parse(sanitizedData);

          // Mark as posted
          data.has_posted_findings = true;
          data.posted_at = new Date().toISOString();

          fs.writeFileSync(reviewPath, JSON.stringify(data, null, 2), "utf-8");
          debugLog("Marked review as posted", { prNumber });

          // Send state update event to refresh UI immediately (non-blocking)
          sendReviewStateUpdate(project, prNumber, projectId, getMainWindow, "after marking posted");

          return true;
        } catch (error) {
          // Handle file not found (ENOENT) separately for clearer logging
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            debugLog("Review file not found", { prNumber });
            return false;
          }
          debugLog("Failed to mark review as posted", {
            prNumber,
            error: error instanceof Error ? error.message : error,
          });
          return false;
        }
      });
      return result ?? false;
    }
  );

  // Post comment to PR
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_POST_COMMENT,
    async (_, projectId: string, prNumber: number, body: string): Promise<boolean> => {
      debugLog("postPRComment handler called", { projectId, prNumber });
      const postResult = await withProjectOrNull(projectId, async (project) => {
        try {
          const { execFileSync } = await import("child_process");
          const { writeFileSync, unlinkSync } = await import("fs");
          const { join } = await import("path");

          debugLog("Posting comment to PR", { prNumber });

          // Validate prNumber to prevent command injection
          if (!Number.isInteger(prNumber) || prNumber <= 0) {
            throw new Error("Invalid PR number");
          }

          // Use temp file to avoid shell escaping issues
          const tmpFile = join(project.path, ".auto-claude", "tmp_comment_body.txt");
          try {
            writeFileSync(tmpFile, body, "utf-8");
            // Use execFileSync with arguments array to prevent command injection
            execFileSync("gh", ["pr", "comment", String(prNumber), "--body-file", tmpFile], {
              cwd: project.path,
              env: getAugmentedEnv(),
            });
            unlinkSync(tmpFile);
          } catch (error) {
            try {
              unlinkSync(tmpFile);
            } catch {
              // Ignore cleanup errors
            }
            throw error;
          }

          debugLog("Comment posted successfully", { prNumber });
          return true;
        } catch (error) {
          debugLog("Failed to post comment", {
            prNumber,
            error: error instanceof Error ? error.message : error,
          });
          return false;
        }
      });
      return postResult ?? false;
    }
  );

  // Delete review from PR
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_DELETE_REVIEW,
    async (_, projectId: string, prNumber: number): Promise<boolean> => {
      debugLog("deletePRReview handler called", { projectId, prNumber });
      const deleteResult = await withProjectOrNull(projectId, async (project) => {
        const result = getReviewResult(project, prNumber);
        if (!result || !result.reviewId) {
          debugLog("No review ID found for deletion", { prNumber });
          return false;
        }

        const config = getGitHubConfig(project);
        if (!config) {
          debugLog("No GitHub config found");
          return false;
        }

        try {
          debugLog("Deleting review from GitHub", { prNumber, reviewId: result.reviewId });

          // Delete review via GitHub API
          await githubFetch(
            config.token,
            `/repos/${config.repo}/pulls/${prNumber}/reviews/${result.reviewId}`,
            {
              method: "DELETE",
            }
          );

          debugLog("Review deleted successfully", { prNumber, reviewId: result.reviewId });

          // Clear the review ID from the stored result
          const reviewPath = path.join(getGitHubDir(project), "pr", `review_${prNumber}.json`);
          try {
            const rawData = fs.readFileSync(reviewPath, "utf-8");
            const sanitizedData = sanitizeNetworkData(rawData);
            const data = JSON.parse(sanitizedData);
            delete data.review_id;
            fs.writeFileSync(reviewPath, JSON.stringify(data, null, 2), "utf-8");
            debugLog("Cleared review ID from result file", { prNumber });
          } catch {
            // File doesn't exist or couldn't be read - this is expected if review wasn't saved
            debugLog("Review result file not found or unreadable, skipping update", { prNumber });
          }

          // Send state update event to refresh UI immediately (non-blocking)
          sendReviewStateUpdate(project, prNumber, projectId, getMainWindow, "after deletion");

          return true;
        } catch (error) {
          debugLog("Failed to delete review", {
            prNumber,
            error: error instanceof Error ? error.message : error,
          });
          return false;
        }
      });
      return deleteResult ?? false;
    }
  );

  // Merge PR
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_MERGE,
    async (
      _,
      projectId: string,
      prNumber: number,
      mergeMethod: "merge" | "squash" | "rebase" = "squash"
    ): Promise<boolean> => {
      debugLog("mergePR handler called", { projectId, prNumber, mergeMethod });
      const mergeResult = await withProjectOrNull(projectId, async (project) => {
        try {
          const { execFileSync } = await import("child_process");
          debugLog("Merging PR", { prNumber, method: mergeMethod });

          // Validate prNumber to prevent command injection
          if (!Number.isInteger(prNumber) || prNumber <= 0) {
            throw new Error("Invalid PR number");
          }

          // Validate mergeMethod to prevent command injection
          const validMethods = ["merge", "squash", "rebase"];
          if (!validMethods.includes(mergeMethod)) {
            throw new Error("Invalid merge method");
          }

          // Use execFileSync with arguments array to prevent command injection
          execFileSync("gh", ["pr", "merge", String(prNumber), `--${mergeMethod}`], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });
          debugLog("PR merged successfully", { prNumber });
          return true;
        } catch (error) {
          debugLog("Failed to merge PR", {
            prNumber,
            error: error instanceof Error ? error.message : error,
          });
          return false;
        }
      });
      return mergeResult ?? false;
    }
  );

  // Assign user to PR
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_ASSIGN,
    async (_, projectId: string, prNumber: number, username: string): Promise<boolean> => {
      debugLog("assignPR handler called", { projectId, prNumber, username });
      const assignResult = await withProjectOrNull(projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) return false;

        try {
          // Use GitHub API to add assignee
          await githubFetch(config.token, `/repos/${config.repo}/issues/${prNumber}/assignees`, {
            method: "POST",
            body: JSON.stringify({ assignees: [username] }),
          });
          debugLog("User assigned successfully", { prNumber, username });
          return true;
        } catch (error) {
          debugLog("Failed to assign user", {
            prNumber,
            username,
            error: error instanceof Error ? error.message : error,
          });
          return false;
        }
      });
      return assignResult ?? false;
    }
  );

  // Cancel PR review
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_REVIEW_CANCEL,
    async (_, projectId: string, prNumber: number): Promise<boolean> => {
      debugLog("cancelPRReview handler called", { projectId, prNumber });
      const reviewKey = getReviewKey(projectId, prNumber);
      const entry = runningReviews.get(reviewKey);

      if (!entry) {
        debugLog("No running review found to cancel", { reviewKey });
        return false;
      }

      // Handle CI wait placeholder - review is waiting for CI checks
      if (entry === CI_WAIT_PLACEHOLDER) {
        debugLog("Review is in CI wait phase, aborting wait", { reviewKey });
        const abortController = ciWaitAbortControllers.get(reviewKey);
        if (abortController) {
          abortController.abort();
          ciWaitAbortControllers.delete(reviewKey);
        }
        runningReviews.delete(reviewKey);
        stateManager.handleCancel(projectId, prNumber);
        debugLog("CI wait cancelled", { reviewKey });
        return true;
      }

      // Handle actual AbortController - abort the running TypeScript review
      const reviewAbortController = entry;
      try {
        debugLog("Aborting review", { reviewKey });
        reviewAbortController.abort();

        // Clean up the registry
        runningReviews.delete(reviewKey);
        stateManager.handleCancel(projectId, prNumber);
        debugLog("Review aborted", { reviewKey });
        return true;
      } catch (error) {
        debugLog("Failed to cancel review", {
          reviewKey,
          error: error instanceof Error ? error.message : error,
        });
        return false;
      }
    }
  );

  // Check for new commits since last review
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_CHECK_NEW_COMMITS,
    async (_, projectId: string, prNumber: number): Promise<NewCommitsCheck> => {
      debugLog("checkNewCommits handler called", { projectId, prNumber });

      const result = await withProjectOrNull(projectId, async (project) => {
        // Check if review exists and has reviewed_commit_sha
        const githubDir = path.join(project.path, ".auto-claude", "github");
        const reviewPath = path.join(githubDir, "pr", `review_${prNumber}.json`);

        let review: PRReviewResult;
        try {
          const rawData = fs.readFileSync(reviewPath, "utf-8");
          const sanitizedData = sanitizeNetworkData(rawData);
          review = JSON.parse(sanitizedData);
        } catch {
          // File doesn't exist or couldn't be read
          return { hasNewCommits: false, newCommitCount: 0 };
        }

        // Normalize snake_case to camelCase for backwards compatibility with old saved files
        const reviewedCommitSha = review.reviewedCommitSha ?? (review as any).reviewed_commit_sha;
        if (!reviewedCommitSha) {
          debugLog("No reviewedCommitSha in review", { prNumber });
          return { hasNewCommits: false, newCommitCount: 0 };
        }

        // Get current PR HEAD
        const config = getGitHubConfig(project);
        if (!config) {
          return { hasNewCommits: false, newCommitCount: 0 };
        }

        // Fetch PR data to get current HEAD (before try block so it's accessible in catch)
        let currentHeadSha: string;
        try {
          const prData = (await githubFetch(
            config.token,
            `/repos/${config.repo}/pulls/${prNumber}`
          )) as { head: { sha: string }; commits: number };
          currentHeadSha = prData.head.sha;
        } catch (error) {
          debugLog("Error fetching PR data", {
            prNumber,
            error: error instanceof Error ? error.message : error,
          });
          return { hasNewCommits: false, newCommitCount: 0 };
        }

        // Early return if SHAs match - no new commits
        if (reviewedCommitSha === currentHeadSha) {
          return {
            hasNewCommits: false,
            newCommitCount: 0,
            lastReviewedCommit: reviewedCommitSha,
            currentHeadCommit: currentHeadSha,
            hasCommitsAfterPosting: false,
          };
        }

        // Try to get detailed comparison
        try {
          // Get comparison to count new commits and see what files changed
          const comparison = (await githubFetch(
            config.token,
            `/repos/${config.repo}/compare/${reviewedCommitSha}...${currentHeadSha}`
          )) as {
            ahead_by?: number;
            total_commits?: number;
            commits?: Array<{
              commit: { committer: { date: string }; message: string };
              parents?: Array<{ sha: string }>;
            }>;
            files?: Array<{ filename: string }>;
          };

          // Check if findings have been posted and if new commits are after the posting date
          const postedAt = review.postedAt || (review as any).posted_at;
          let hasCommitsAfterPosting = true; // Default to true if we can't determine

          if (postedAt && comparison.commits && comparison.commits.length > 0) {
            const postedAtDate = new Date(postedAt);
            // Check if any commit is newer than when findings were posted
            hasCommitsAfterPosting = comparison.commits.some((c) => {
              const commitDate = new Date(c.commit.committer.date);
              return commitDate > postedAtDate;
            });
            debugLog("Comparing commit dates with posted_at", {
              prNumber,
              postedAt,
              latestCommitDate:
                comparison.commits[comparison.commits.length - 1]?.commit.committer.date,
              hasCommitsAfterPosting,
            });
          } else if (!postedAt) {
            // If findings haven't been posted yet, we can't determine "after posting"
            // Follow-up should only be available after initial review is posted to GitHub
            hasCommitsAfterPosting = false;
          }

          // Check if this looks like a merge from base branch (develop/main)
          // Merge commits always have 2+ parents, so we check for that AND a merge-like message
          // Pattern matches: "Merge branch", "Merge pull request", "Merge remote-tracking",
          // "Merge 'develop' into", "Merge develop into", GitHub's "Update branch" button, etc.
          const isMergeFromBase = comparison.commits?.some((c) => {
            const hasTwoParents = (c.parents?.length ?? 0) >= 2;
            const isMergeMessage = /^merge\s+/i.test(c.commit.message);
            return hasTwoParents && isMergeMessage;
          }) ?? false;

          // Get files that had findings from the review
          const findingFiles = new Set<string>(
            (review.findings || []).map((f) => f.file).filter(Boolean)
          );

          // Get files changed in the new commits
          const newCommitFiles = (comparison.files || []).map((f) => f.filename);

          // Check for overlap between new commit files and finding files
          const overlappingFiles = newCommitFiles.filter((f) => findingFiles.has(f));
          const hasOverlapWithFindings = overlappingFiles.length > 0;

          debugLog("File overlap check", {
            prNumber,
            findingFilesCount: findingFiles.size,
            newCommitFilesCount: newCommitFiles.length,
            overlappingFiles,
            hasOverlapWithFindings,
            isMergeFromBase,
          });

          return {
            hasNewCommits: true,
            newCommitCount: comparison.ahead_by || comparison.total_commits || 1,
            lastReviewedCommit: reviewedCommitSha,
            currentHeadCommit: currentHeadSha,
            hasCommitsAfterPosting,
            hasOverlapWithFindings,
            overlappingFiles: overlappingFiles.length > 0 ? overlappingFiles : undefined,
            isMergeFromBase,
          };
        } catch (error) {
          // Comparison failed (e.g., force push made old commit unreachable)
          // Since we already verified SHAs differ, treat as having new commits
          debugLog(
            "Comparison failed but SHAs differ - likely force push, treating as new commits",
            {
              prNumber,
              reviewedCommitSha,
              currentHeadSha,
              error: error instanceof Error ? error.message : error,
            }
          );
          // Note: hasOverlapWithFindings, overlappingFiles, isMergeFromBase intentionally omitted
          // since we can't determine them without the comparison API. UI defaults to safe behavior
          // (hasOverlapWithFindings ?? true) which prompts user to verify.
          return {
            hasNewCommits: true,
            newCommitCount: 1, // Unknown count due to force push
            lastReviewedCommit: reviewedCommitSha,
            currentHeadCommit: currentHeadSha,
            hasCommitsAfterPosting: true, // Assume yes for force push scenarios
          };
        }
      });

      return result ?? { hasNewCommits: false, newCommitCount: 0 };
    }
  );

  // Check merge readiness (lightweight freshness check for verdict validation)
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_CHECK_MERGE_READINESS,
    async (_, projectId: string, prNumber: number): Promise<MergeReadiness> => {
      debugLog("checkMergeReadiness handler called", { projectId, prNumber });

      const defaultResult: MergeReadiness = {
        isDraft: false,
        mergeable: "UNKNOWN",
        isBehind: false,
        ciStatus: "none",
        blockers: [],
      };

      const result = await withProjectOrNull(projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) {
          debugLog("No GitHub config found for checkMergeReadiness");
          return defaultResult;
        }

        try {
          // Fetch PR data including mergeable status
          const pr = (await githubFetch(
            config.token,
            `/repos/${config.repo}/pulls/${prNumber}`
          )) as {
            draft: boolean;
            mergeable: boolean | null;
            mergeable_state: string;
            head: { sha: string };
          };

          // Determine mergeable status
          let mergeable: MergeReadiness["mergeable"] = "UNKNOWN";
          if (pr.mergeable === true) {
            mergeable = "MERGEABLE";
          } else if (pr.mergeable === false || pr.mergeable_state === "dirty") {
            mergeable = "CONFLICTING";
          }

          // Check if branch is behind base (out of date)
          // GitHub's mergeable_state can be: 'behind', 'blocked', 'clean', 'dirty', 'has_hooks', 'unknown', 'unstable'
          const isBehind = pr.mergeable_state === "behind";

          // Fetch combined commit status for CI
          let ciStatus: MergeReadiness["ciStatus"] = "none";
          try {
            const status = (await githubFetch(
              config.token,
              `/repos/${config.repo}/commits/${pr.head.sha}/status`
            )) as {
              state: "success" | "pending" | "failure" | "error";
              total_count: number;
            };

            if (status.total_count === 0) {
              // No status checks, check for check runs (GitHub Actions)
              const checkRuns = (await githubFetch(
                config.token,
                `/repos/${config.repo}/commits/${pr.head.sha}/check-runs`
              )) as {
                total_count: number;
                check_runs: Array<{ conclusion: string | null; status: string }>;
              };

              if (checkRuns.total_count > 0) {
                const hasFailing = checkRuns.check_runs.some(
                  (cr) => cr.conclusion === "failure" || cr.conclusion === "cancelled"
                );
                const hasPending = checkRuns.check_runs.some((cr) => cr.status !== "completed");

                if (hasFailing) {
                  ciStatus = "failing";
                } else if (hasPending) {
                  ciStatus = "pending";
                } else {
                  ciStatus = "passing";
                }
              }
            } else {
              // Use combined status
              if (status.state === "success") {
                ciStatus = "passing";
              } else if (status.state === "pending") {
                ciStatus = "pending";
              } else {
                ciStatus = "failing";
              }
            }
          } catch (err) {
            debugLog("Failed to fetch CI status", {
              prNumber,
              error: err instanceof Error ? err.message : err,
            });
            // Continue without CI status
          }

          // Build blockers list
          const blockers: string[] = [];
          if (pr.draft) {
            blockers.push("PR is in draft mode");
          }
          if (mergeable === "CONFLICTING") {
            blockers.push("Merge conflicts detected");
          }
          if (isBehind) {
            blockers.push("Branch is out of date with base branch. Update to check for conflicts.");
          }
          if (ciStatus === "failing") {
            blockers.push("CI checks are failing");
          }

          debugLog("checkMergeReadiness result", {
            prNumber,
            isDraft: pr.draft,
            mergeable,
            isBehind,
            ciStatus,
            blockers,
          });

          return {
            isDraft: pr.draft,
            mergeable,
            isBehind,
            ciStatus,
            blockers,
          };
        } catch (error) {
          debugLog("Failed to check merge readiness", {
            prNumber,
            error: error instanceof Error ? error.message : error,
          });
          return defaultResult;
        }
      });

      return result ?? defaultResult;
    }
  );

  // Update PR branch (sync with base branch)
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_UPDATE_BRANCH,
    async (_, projectId: string, prNumber: number): Promise<{ success: boolean; error?: string }> => {
      debugLog("updateBranch handler called", { projectId, prNumber });

      const updateResult = await withProjectOrNull(projectId, async (project) => {
        try {
          const { execFile } = await import("child_process");
          const { promisify } = await import("util");
          const execFileAsync = promisify(execFile);
          debugLog("Updating PR branch", { prNumber });

          // Validate prNumber to prevent command injection
          if (!Number.isInteger(prNumber) || prNumber <= 0) {
            throw new Error("Invalid PR number");
          }

          // Use gh pr update-branch to sync with base branch (async to avoid blocking main process)
          // --rebase is not used to avoid force-push requirements
          await execFileAsync("gh", ["pr", "update-branch", String(prNumber)], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });

          debugLog("PR branch updated successfully", { prNumber });
          return { success: true };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          debugLog("Failed to update PR branch", { prNumber, error: errorMessage });

          // Map common error patterns to user-friendly messages
          let friendlyError = errorMessage;
          if (errorMessage.includes("permission") || errorMessage.includes("403")) {
            friendlyError = "You don't have permission to update this branch.";
          } else if (errorMessage.includes("401") || errorMessage.toLowerCase().includes("auth") || errorMessage.toLowerCase().includes("token")) {
            friendlyError = "Authentication failed. Try running 'gh auth login' to re-authenticate.";
          } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
            friendlyError = "Pull request not found. It may have been closed or deleted.";
          } else if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit")) {
            friendlyError = "GitHub API rate limit exceeded. Please wait and try again.";
          } else if (errorMessage.includes("conflict")) {
            friendlyError = "Cannot update branch due to merge conflicts. Resolve conflicts manually.";
          } else if (errorMessage.toLowerCase().includes("protected") || errorMessage.toLowerCase().includes("branch protection")) {
            friendlyError = "Branch protection rules prevent this update.";
          } else if (errorMessage.includes("ENOTFOUND") || errorMessage.includes("ECONNREFUSED") || errorMessage.includes("ETIMEDOUT")) {
            friendlyError = "Network error. Check your internet connection and try again.";
          } else if (errorMessage.toLowerCase().includes("already up to date")) {
            return { success: true }; // Not an error
          }

          return { success: false, error: friendlyError };
        }
      });

      return updateResult ?? { success: false, error: "Project not found" };
    }
  );

  // Run follow-up review
  ipcMain.on(
    IPC_CHANNELS.GITHUB_PR_FOLLOWUP_REVIEW,
    async (_, projectId: string, prNumber: number) => {
      debugLog("followupReview handler called", { projectId, prNumber });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog("No main window available");
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          const { sendProgress, sendError, sendComplete } = createIPCCommunicators<
            PRReviewProgress,
            PRReviewResult
          >(
            mainWindow,
            {
              progress: IPC_CHANNELS.GITHUB_PR_REVIEW_PROGRESS,
              error: IPC_CHANNELS.GITHUB_PR_REVIEW_ERROR,
              complete: IPC_CHANNELS.GITHUB_PR_REVIEW_COMPLETE,
            },
            projectId
          );

          const config = getGitHubConfig(project);
          if (!config) {
            sendError({ prNumber, error: "No GitHub configuration found for project" });
            return;
          }

          const reviewKey = getReviewKey(projectId, prNumber);

          // Check if already running
          if (runningReviews.has(reviewKey)) {
            debugLog("Follow-up review already running", { reviewKey });
            return;
          }

          // Register as running BEFORE CI wait to prevent race conditions
          // Use CI_WAIT_PLACEHOLDER sentinel until real process is spawned
          runningReviews.set(reviewKey, CI_WAIT_PLACEHOLDER);
          const abortController = new AbortController();
          ciWaitAbortControllers.set(reviewKey, abortController);
          debugLog("Registered follow-up review placeholder", { reviewKey });

          // Get previous result for XState followup context
          const previousResultForState = getReviewResult(project, prNumber) ?? undefined;
          stateManager.handleStartFollowupReview(projectId, prNumber, previousResultForState as PreloadPRReviewResult | undefined);

          try {
            debugLog("Starting follow-up review", { prNumber });
            const followupStartProgress: PRReviewProgress = {
              phase: "fetching",
              prNumber,
              progress: 5,
              message: "Starting follow-up review...",
            };
            sendProgress(followupStartProgress);
            stateManager.handleProgress(projectId, prNumber, followupStartProgress);

            // Wait for CI checks to complete before starting follow-up review
            const shouldProceed = await performCIWaitCheck(
              config,
              prNumber,
              sendProgress,
              "follow-up review",
              abortController.signal
            );
            if (!shouldProceed) {
              debugLog("Follow-up review cancelled during CI wait", { reviewKey });
              return;
            }

            // Clean up abort controller since CI wait is done
            ciWaitAbortControllers.delete(reviewKey);

            const repo = config.repo;
            const { model, thinkingLevel } = getGitHubPRSettings();

            safeBreadcrumb({
              category: 'pr-review',
              message: 'Starting TypeScript follow-up PR review',
              level: 'info',
              data: { model, thinkingLevel, prNumber, repo },
            });

            // Create log collector for this follow-up review
            const logCollector = new PRLogCollector(project, prNumber, repo, true, mainWindow);

            // Upgrade to real AbortController now that CI wait is done
            const reviewAbortController = new AbortController();
            runningReviews.set(reviewKey, reviewAbortController);
            debugLog("Registered follow-up review abort controller", { reviewKey });

            // Fetch incremental PR data for follow-up
            const fetchChangesProgress: PRReviewProgress = { phase: "fetching", prNumber, progress: 20, message: "Fetching PR changes since last review..." };
            sendProgress(fetchChangesProgress);
            stateManager.handleProgress(projectId, prNumber, fetchChangesProgress);

            // Get the previous review result for context
            const previousReviewResult = getReviewResult(project, prNumber);
            const previousReview: PreviousReviewResult = {
              reviewId: previousReviewResult?.reviewId,
              prNumber,
              findings: previousReviewResult?.findings ?? [],
              summary: previousReviewResult?.summary,
            };

            // Fetch current PR commits
            const currentCommits = (await githubFetch(
              config.token,
              `/repos/${config.repo}/pulls/${prNumber}/commits?per_page=100`
            )) as Array<{ sha: string; commit: { message: string; committer?: { date?: string } } }>;

            const currentSha = currentCommits[currentCommits.length - 1]?.sha ?? "";
            const previousSha = previousReviewResult?.reviewedCommitSha ?? "";

            // Get diff since last review
            let diffSinceReview = "";
            try {
              const filesChanged = (await githubFetch(
                config.token,
                `/repos/${config.repo}/pulls/${prNumber}/files?per_page=100`
              )) as Array<{ filename: string; patch?: string; status: string }>;
              diffSinceReview = filesChanged
                .filter((f) => f.patch)
                .map((f) => `diff --git a/${f.filename} b/${f.filename}\n${f.patch}`)
                .join("\n");
            } catch {
              // Non-critical
            }

            // Fetch comments since last review
            const contributorComments: Array<Record<string, unknown>> = [];
            const aiBotComments: Array<Record<string, unknown>> = [];
            try {
              const allComments = (await githubFetch(
                config.token,
                `/repos/${config.repo}/issues/${prNumber}/comments?per_page=100`
              )) as Array<{ id: number; user: { login: string }; body: string; created_at: string }>;
              const AI_BOTS = ["coderabbitai", "cursor-ai", "greptile", "sourcery-ai", "codeflash-ai"];
              for (const c of allComments) {
                const isBot = AI_BOTS.some((bot) => c.user.login.toLowerCase().includes(bot));
                if (isBot) {
                  aiBotComments.push({ id: c.id, author: c.user.login, body: c.body, created_at: c.created_at });
                } else {
                  contributorComments.push({ id: c.id, author: c.user.login, body: c.body, created_at: c.created_at });
                }
              }
            } catch {
              // Non-critical
            }

            const followupContext: FollowupReviewContext = {
              prNumber,
              previousReview,
              previousCommitSha: previousSha,
              currentCommitSha: currentSha,
              commitsSinceReview: currentCommits.map((c) => ({
                sha: c.sha,
                message: c.commit.message,
                committedAt: c.commit.committer?.date ?? "",
              })),
              filesChangedSinceReview: [],
              diffSinceReview,
              contributorCommentsSinceReview: contributorComments,
              aiBotCommentsSinceReview: aiBotComments,
              prReviewsSinceReview: [],
            };

            const analyzeProgress: PRReviewProgress = { phase: "analyzing", prNumber, progress: 35, message: "Running follow-up analysis..." };
            sendProgress(analyzeProgress);
            stateManager.handleProgress(projectId, prNumber, analyzeProgress);

            const followupReviewer = new ParallelFollowupReviewer(
              {
                repo,
                model: model as ModelShorthand,
                thinkingLevel: thinkingLevel as ThinkingLevel,
              },
              (update) => {
                const allowedPhases = new Set(["fetching", "analyzing", "generating", "posting", "complete"]);
                const phase = (allowedPhases.has(update.phase) ? update.phase : "analyzing") as PRReviewProgress["phase"];
                const progressUpdate: PRReviewProgress = {
                  phase,
                  prNumber,
                  progress: update.progress,
                  message: update.message,
                };
                sendProgress(progressUpdate);
                stateManager.handleProgress(projectId, prNumber, progressUpdate);
                // If the message already has a bracket prefix, pass it directly so
                // parseLogLine() extracts the correct source for frontend grouping.
                // Otherwise, wrap with [phase] so bare messages aren't silently dropped.
                const logLine = update.message.startsWith('[')
                  ? update.message
                  : `[${update.phase}] ${update.message}`;
                logCollector.processLine(logLine);
              }
            );

            const followupResult = await followupReviewer.review(followupContext, reviewAbortController.signal);

            // Build PRReviewResult from FollowupReviewResult
            const result: PRReviewResult = {
              prNumber,
              repo,
              success: true,
              findings: followupResult.findings as PRReviewFinding[],
              summary: followupResult.summary,
              overallStatus: followupResult.overallStatus as PRReviewResult["overallStatus"],
              reviewedAt: new Date().toISOString(),
              reviewedCommitSha: followupResult.reviewedCommitSha,
              isFollowupReview: true,
              previousReviewId: typeof followupResult.previousReviewId === "number" ? followupResult.previousReviewId : undefined,
              resolvedFindings: followupResult.resolvedFindings,
              unresolvedFindings: followupResult.unresolvedFindings,
              newFindingsSinceLastReview: followupResult.newFindingsSinceLastReview,
            };

            // Save to disk
            saveReviewResultToDisk(project, prNumber, result);
            debugLog("Follow-up review result saved to disk", { findingsCount: result.findings.length });

            // Finalize logs
            logCollector.finalize(true);

            safeBreadcrumb({
              category: 'pr-review',
              message: 'Follow-up PR review completed',
              level: 'info',
              data: { prNumber, findingsCount: result.findings.length },
            });

            // Save follow-up PR review insights to memory (async, non-blocking)
            savePRReviewToMemory(result, repo, true).catch((err) => {
              debugLog("Failed to save follow-up PR review to memory", { error: (err as Error).message });
            });

            debugLog("Follow-up review completed", {
              prNumber,
              findingsCount: result.findings.length,
            });
            sendProgress({
              phase: "complete",
              prNumber,
              progress: 100,
              message: "Follow-up review complete!",
            });

            stateManager.handleComplete(projectId, prNumber, result as unknown as PreloadPRReviewResult);
            sendComplete(result);
          } finally {
            // Always clean up registry, whether we exit normally or via error
            runningReviews.delete(reviewKey);
            ciWaitAbortControllers.delete(reviewKey);
            debugLog("Unregistered follow-up review", { reviewKey });
          }
        });
      } catch (error) {
        debugLog("Follow-up review failed", {
          prNumber,
          error: error instanceof Error ? error.message : error,
        });
        const { sendError } = createIPCCommunicators<PRReviewProgress, PRReviewResult>(
          mainWindow,
          {
            progress: IPC_CHANNELS.GITHUB_PR_REVIEW_PROGRESS,
            error: IPC_CHANNELS.GITHUB_PR_REVIEW_ERROR,
            complete: IPC_CHANNELS.GITHUB_PR_REVIEW_COMPLETE,
          },
          projectId
        );
        const followupErrorMessage = error instanceof Error ? error.message : "Failed to run follow-up review";
        stateManager.handleError(projectId, prNumber, followupErrorMessage);
        sendError({ prNumber, error: followupErrorMessage });
      }
    }
  );

  // Get workflows awaiting approval for a PR (fork PRs)
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_WORKFLOWS_AWAITING_APPROVAL,
    async (
      _,
      projectId: string,
      prNumber: number
    ): Promise<{
      awaiting_approval: number;
      workflow_runs: Array<{ id: number; name: string; html_url: string; workflow_name: string }>;
      can_approve: boolean;
      error?: string;
    }> => {
      debugLog("getWorkflowsAwaitingApproval handler called", { projectId, prNumber });
      const result = await withProjectOrNull(projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) {
          return {
            awaiting_approval: 0,
            workflow_runs: [],
            can_approve: false,
            error: "No GitHub config",
          };
        }

        try {
          // First get the PR's head SHA
          const prData = (await githubFetch(
            config.token,
            `/repos/${config.repo}/pulls/${prNumber}`
          )) as { head?: { sha?: string } };

          const headSha = prData?.head?.sha;
          if (!headSha) {
            return { awaiting_approval: 0, workflow_runs: [], can_approve: false };
          }

          // Query workflow runs with action_required status
          const runsData = (await githubFetch(
            config.token,
            `/repos/${config.repo}/actions/runs?status=action_required&per_page=100`
          )) as {
            workflow_runs?: Array<{
              id: number;
              name: string;
              html_url: string;
              head_sha: string;
              workflow?: { name?: string };
            }>;
          };

          const allRuns = runsData?.workflow_runs || [];

          // Filter to only runs for this PR's head SHA
          const prRuns = allRuns
            .filter((run) => run.head_sha === headSha)
            .map((run) => ({
              id: run.id,
              name: run.name,
              html_url: run.html_url,
              workflow_name: run.workflow?.name || "Unknown",
            }));

          debugLog("Found workflows awaiting approval", { prNumber, count: prRuns.length });

          return {
            awaiting_approval: prRuns.length,
            workflow_runs: prRuns,
            can_approve: true, // Assume token has permission; will fail if not
          };
        } catch (error) {
          debugLog("Failed to get workflows awaiting approval", {
            prNumber,
            error: error instanceof Error ? error.message : error,
          });
          return {
            awaiting_approval: 0,
            workflow_runs: [],
            can_approve: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      });

      return result ?? { awaiting_approval: 0, workflow_runs: [], can_approve: false };
    }
  );

  // Approve a workflow run
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_WORKFLOW_APPROVE,
    async (_, projectId: string, runId: number): Promise<boolean> => {
      debugLog("approveWorkflow handler called", { projectId, runId });
      const result = await withProjectOrNull(projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) {
          debugLog("No GitHub config found");
          return false;
        }

        try {
          // Approve the workflow run
          await githubFetch(config.token, `/repos/${config.repo}/actions/runs/${runId}/approve`, {
            method: "POST",
          });

          debugLog("Workflow approved successfully", { runId });
          return true;
        } catch (error) {
          debugLog("Failed to approve workflow", {
            runId,
            error: error instanceof Error ? error.message : error,
          });
          return false;
        }
      });

      return result ?? false;
    }
  );

  // Get PR review memories from the memory layer
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_MEMORY_GET,
    async (_, projectId: string, limit: number = 10): Promise<PRReviewMemory[]> => {
      debugLog("getPRReviewMemories handler called", { projectId, limit });
      const result = await withProjectOrNull(projectId, async (project) => {
        const memoryDir = path.join(getGitHubDir(project), "memory", project.name || "unknown");
        const memories: PRReviewMemory[] = [];

        // Try to load from file-based storage
        try {
          const indexPath = path.join(memoryDir, "reviews_index.json");
          if (!fs.existsSync(indexPath)) {
            debugLog("No PR review memories found", { projectId });
            return [];
          }

          const indexContent = fs.readFileSync(indexPath, "utf-8");
          const index = JSON.parse(sanitizeNetworkData(indexContent));
          const reviews = index.reviews || [];

          // Load individual review memories
          for (const entry of reviews.slice(0, limit)) {
            try {
              const reviewPath = path.join(memoryDir, `pr_${entry.pr_number}_review.json`);
              if (fs.existsSync(reviewPath)) {
                const reviewContent = fs.readFileSync(reviewPath, "utf-8");
                const memory = JSON.parse(sanitizeNetworkData(reviewContent));
                memories.push({
                  prNumber: memory.pr_number,
                  repo: memory.repo,
                  verdict: memory.summary?.verdict || "unknown",
                  timestamp: memory.timestamp,
                  summary: memory.summary,
                  keyFindings: memory.key_findings || [],
                  patterns: memory.patterns || [],
                  gotchas: memory.gotchas || [],
                  isFollowup: memory.is_followup || false,
                });
              }
            } catch (err) {
              debugLog("Failed to load PR review memory", {
                prNumber: entry.pr_number,
                error: err instanceof Error ? err.message : err,
              });
            }
          }

          debugLog("Loaded PR review memories", { count: memories.length });
          return memories;
        } catch (error) {
          debugLog("Failed to load PR review memories", {
            error: error instanceof Error ? error.message : error,
          });
          return [];
        }
      });
      return result ?? [];
    }
  );

  // Search PR review memories
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_MEMORY_SEARCH,
    async (_, projectId: string, query: string, limit: number = 10): Promise<PRReviewMemory[]> => {
      debugLog("searchPRReviewMemories handler called", { projectId, query, limit });
      const result = await withProjectOrNull(projectId, async (project) => {
        const memoryDir = path.join(getGitHubDir(project), "memory", project.name || "unknown");
        const memories: PRReviewMemory[] = [];
        const queryLower = query.toLowerCase();

        // Search through file-based storage
        try {
          const indexPath = path.join(memoryDir, "reviews_index.json");
          if (!fs.existsSync(indexPath)) {
            return [];
          }

          const indexContent = fs.readFileSync(indexPath, "utf-8");
          const index = JSON.parse(sanitizeNetworkData(indexContent));
          const reviews = index.reviews || [];

          // Search individual review memories
          for (const entry of reviews) {
            try {
              const reviewPath = path.join(memoryDir, `pr_${entry.pr_number}_review.json`);
              if (fs.existsSync(reviewPath)) {
                const reviewContent = fs.readFileSync(reviewPath, "utf-8");

                // Check if content matches query
                if (reviewContent.toLowerCase().includes(queryLower)) {
                  const memory = JSON.parse(sanitizeNetworkData(reviewContent));
                  memories.push({
                    prNumber: memory.pr_number,
                    repo: memory.repo,
                    verdict: memory.summary?.verdict || "unknown",
                    timestamp: memory.timestamp,
                    summary: memory.summary,
                    keyFindings: memory.key_findings || [],
                    patterns: memory.patterns || [],
                    gotchas: memory.gotchas || [],
                    isFollowup: memory.is_followup || false,
                  });
                }
              }

              // Stop if we have enough
              if (memories.length >= limit) {
                break;
              }
            } catch (err) {
              debugLog("Failed to search PR review memory", {
                prNumber: entry.pr_number,
                error: err instanceof Error ? err.message : err,
              });
            }
          }

          debugLog("Found matching PR review memories", { count: memories.length, query });
          return memories;
        } catch (error) {
          debugLog("Failed to search PR review memories", {
            error: error instanceof Error ? error.message : error,
          });
          return [];
        }
      });
      return result ?? [];
    }
  );

  // ============================================================================
  // PR Status Polling Handlers
  // ============================================================================

  // Initialize PRStatusPoller with main window getter for IPC updates
  const prStatusPoller = getPRStatusPoller();
  prStatusPoller.setMainWindowGetter(getMainWindow);

  // Start polling PR status for a project
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_STATUS_POLL_START,
    async (
      _,
      request: StartPollingRequest
    ): Promise<{ success: boolean; error?: string }> => {
      debugLog("startStatusPolling handler called", {
        projectId: request.projectId,
        prCount: request.prNumbers.length,
      });

      const result = await withProjectOrNull(request.projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) {
          debugLog("No GitHub config found for project, cannot start polling");
          return { success: false, error: "No GitHub configuration found" };
        }

        try {
          await prStatusPoller.startPolling(
            request.projectId,
            request.prNumbers,
            config.token
          );
          debugLog("Status polling started successfully", {
            projectId: request.projectId,
          });
          return { success: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          debugLog("Failed to start status polling", {
            projectId: request.projectId,
            error: message,
          });
          return { success: false, error: message };
        }
      });
      return result ?? { success: false, error: "Project not found" };
    }
  );

  // Stop polling PR status for a project
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_STATUS_POLL_STOP,
    async (
      _,
      request: StopPollingRequest
    ): Promise<{ success: boolean }> => {
      debugLog("stopStatusPolling handler called", {
        projectId: request.projectId,
      });

      try {
        prStatusPoller.stopPolling(request.projectId);
        debugLog("Status polling stopped successfully", {
          projectId: request.projectId,
        });
        return { success: true };
      } catch (error) {
        debugLog("Failed to stop status polling", {
          projectId: request.projectId,
          error: error instanceof Error ? error.message : error,
        });
        return { success: false };
      }
    }
  );

  // Get current polling metadata for a project
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_PR_STATUS_UPDATE,
    async (_, projectId: string): Promise<PollingMetadata> => {
      debugLog("getPollingMetadata handler called", { projectId });
      return prStatusPoller.getPollingMetadata(projectId);
    }
  );

  debugLog("PR handlers registered");
}
