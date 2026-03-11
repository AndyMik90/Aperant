/**
 * Subtask Iterator
 * ================
 *
 * See apps/desktop/src/main/ai/orchestration/subtask-iterator.ts for the TypeScript implementation.
 * Reads implementation_plan.json, finds the next pending subtask, invokes
 * the coder agent session, and tracks completion/retry/stuck state.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { safeParseJson } from '../../utils/json-repair';
import type { ExtractedInsights, InsightExtractionConfig } from '../runners/insight-extractor';
import { extractSessionInsights } from '../runners/insight-extractor';
import type { SessionResult } from '../session/types';
import type { SubtaskInfo } from './build-orchestrator';
import {
  writeAuthPauseFile,
  writeRateLimitPauseFile,
  waitForAuthResume,
  waitForRateLimitResume,
} from './pause-handler';

// =============================================================================
// Types
// =============================================================================

/** Configuration for the subtask iterator */
export interface SubtaskIteratorConfig {
  /** Spec directory containing implementation_plan.json */
  specDir: string;
  /** Project root directory */
  projectDir: string;
  /** Maximum retries per subtask before marking stuck */
  maxRetries: number;
  /** Delay between subtask iterations (ms) */
  autoContinueDelayMs: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /**
   * Optional fallback spec dir in the main project (worktree mode).
   * Used to check for a RESUME file when the frontend can't find the worktree.
   */
  sourceSpecDir?: string;
  /** Called when a subtask starts */
  onSubtaskStart?: (subtask: SubtaskInfo, attempt: number) => void;
  /** Run the coder session for a subtask; returns the session result */
  runSubtaskSession: (subtask: SubtaskInfo, attempt: number) => Promise<SessionResult>;
  /** Called when a subtask session completes */
  onSubtaskComplete?: (subtask: SubtaskInfo, result: SessionResult) => void;
  /** Called when a subtask is marked stuck */
  onSubtaskStuck?: (subtask: SubtaskInfo, reason: string) => void;
  /** Called when insight extraction completes for a subtask (optional). */
  onInsightsExtracted?: (subtaskId: string, insights: ExtractedInsights) => void;
  /**
   * Whether to extract insights after each successful coder session.
   * Defaults to false (opt-in to avoid extra AI calls in test scenarios).
   */
  extractInsights?: boolean;
}

/** Result of the full subtask iteration */
export interface SubtaskIteratorResult {
  /** Total subtasks processed */
  totalSubtasks: number;
  /** Number of completed subtasks */
  completedSubtasks: number;
  /** IDs of subtasks marked as stuck */
  stuckSubtasks: string[];
  /** Whether iteration was cancelled */
  cancelled: boolean;
}

/** Single subtask result for internal tracking */
export interface SubtaskResult {
  subtaskId: string;
  success: boolean;
  attempts: number;
  stuck: boolean;
  error?: string;
}

// =============================================================================
// Implementation Plan Types
// =============================================================================

interface ImplementationPlan {
  feature?: string;
  workflow_type?: string;
  phases: PlanPhase[];
}

interface PlanPhase {
  id?: string;
  phase?: number;
  name: string;
  subtasks: PlanSubtask[];
}

interface PlanSubtask {
  id: string;
  title: string;
  description: string;
  status: string;
  files_to_create?: string[];
  files_to_modify?: string[];
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Iterate through all pending subtasks in the implementation plan.
 *
 * Replaces the inner subtask loop in agents/coder.py:
 * - Reads implementation_plan.json for the next pending subtask
 * - Invokes the coder agent session
 * - Re-reads the plan after each session (the agent updates subtask status)
 * - Tracks retry counts and marks subtasks as stuck after max retries
 * - Continues until all subtasks complete or build is stuck
 */
export async function iterateSubtasks(
  config: SubtaskIteratorConfig,
): Promise<SubtaskIteratorResult> {
  const attemptCounts = new Map<string, number>();
  const stuckSubtasks: string[] = [];
  let completedSubtasks = 0;
  let totalSubtasks = 0;

  while (true) {
    // Check cancellation
    if (config.abortSignal?.aborted) {
      return { totalSubtasks, completedSubtasks, stuckSubtasks, cancelled: true };
    }

    // Load the plan and find next pending subtask
    const plan = await loadImplementationPlan(config.specDir);
    if (!plan) {
      return { totalSubtasks: 0, completedSubtasks: 0, stuckSubtasks, cancelled: false };
    }

    // Count totals
    totalSubtasks = countTotalSubtasks(plan);
    completedSubtasks = countCompletedSubtasks(plan);

    // Find next subtask
    const next = getNextPendingSubtask(plan, stuckSubtasks);
    if (!next) {
      // All subtasks completed or stuck
      break;
    }

    const { subtask, phaseName } = next;
    const subtaskInfo: SubtaskInfo = {
      id: subtask.id,
      description: subtask.description,
      phaseName,
      filesToCreate: subtask.files_to_create,
      filesToModify: subtask.files_to_modify,
      status: subtask.status,
    };

    // Track attempts
    const currentAttempt = (attemptCounts.get(subtask.id) ?? 0) + 1;
    attemptCounts.set(subtask.id, currentAttempt);

    // Check if stuck
    if (currentAttempt > config.maxRetries) {
      stuckSubtasks.push(subtask.id);
      config.onSubtaskStuck?.(
        subtaskInfo,
        `Exceeded max retries (${config.maxRetries})`,
      );
      continue;
    }

    // Notify start
    config.onSubtaskStart?.(subtaskInfo, currentAttempt);

    // Run the session
    const result = await config.runSubtaskSession(subtaskInfo, currentAttempt);

    // Notify complete
    config.onSubtaskComplete?.(subtaskInfo, result);

    // Handle outcomes
    if (result.outcome === 'cancelled') {
      return { totalSubtasks, completedSubtasks, stuckSubtasks, cancelled: true };
    }

    if (result.outcome === 'rate_limited') {
      // Write pause file so the frontend can show a countdown
      const errorMessage = result.error?.message ?? 'Rate limit reached';
      writeRateLimitPauseFile(config.specDir, errorMessage, null);

      // Wait for the rate limit to reset (or user to resume early)
      await waitForRateLimitResume(
        config.specDir,
        MAX_RATE_LIMIT_WAIT_MS_DEFAULT,
        config.sourceSpecDir,
        config.abortSignal,
      );

      // Re-check abort after waiting
      if (config.abortSignal?.aborted) {
        return { totalSubtasks, completedSubtasks, stuckSubtasks, cancelled: true };
      }

      // Continue the loop — subtask will be retried
      continue;
    }

    if (result.outcome === 'auth_failure') {
      // Write pause file so the frontend can show a re-auth prompt
      const errorMessage = result.error?.message ?? 'Authentication failed';
      writeAuthPauseFile(config.specDir, errorMessage);

      // Wait for user to re-authenticate
      await waitForAuthResume(config.specDir, config.sourceSpecDir, config.abortSignal);

      // Re-check abort after waiting
      if (config.abortSignal?.aborted) {
        return { totalSubtasks, completedSubtasks, stuckSubtasks, cancelled: true };
      }

      // Continue — subtask will be retried with fresh auth
      continue;
    }

    // Post-session: if the session completed or hit max_steps (not error), ensure the
    // subtask is marked as completed. The coder agent is instructed to update
    // implementation_plan.json itself, but it doesn't always do so reliably.
    if (result.outcome === 'completed' || result.outcome === 'max_steps' || result.outcome === 'context_window') {
      await ensureSubtaskMarkedCompleted(config.specDir, subtask.id);

      // Re-stamp executionPhase on the worktree plan after the coder session.
      // The coder model's Edit/Write calls can overwrite executionPhase with a
      // stale value (read before persistPlanPhaseSync ran). Since the model is
      // no longer writing, we can safely correct it here.
      await restampExecutionPhase(config.specDir, 'coding');

      // Sync updated phases to main project plan (worktree mode).
      // This keeps the main plan current during execution, not just on exit.
      if (config.sourceSpecDir) {
        await syncPhasesToMain(config.specDir, config.sourceSpecDir);
      }

      // Extract insights from the session (opt-in, never blocks the build)
      if (config.extractInsights) {
        extractInsightsAfterSession(config, subtask, result).then((insights) => {
          if (insights) config.onInsightsExtracted?.(subtask.id, insights);
        }).catch(() => { /* insight extraction is non-blocking */ });
      }
    }

    // For errors, the subtask will be retried on next loop iteration
    // (implementation_plan.json status remains in_progress or pending)

    // Delay before next iteration
    if (config.autoContinueDelayMs > 0) {
      await delay(config.autoContinueDelayMs, config.abortSignal);
    }
  }

  return { totalSubtasks, completedSubtasks, stuckSubtasks, cancelled: false };
}

// =============================================================================
// Post-Session Processing
// =============================================================================

/**
 * Ensure a subtask is marked as completed in implementation_plan.json.
 *
 * The coder agent is instructed to update the subtask status itself, but it
 * doesn't always do so reliably. This function is called after each successful
 * coder session as a fallback: if the subtask is still pending or in_progress,
 * it is marked completed with a timestamp.
 *
 * Only ADD/UPDATE fields — never removes existing data.
 */
async function ensureSubtaskMarkedCompleted(
  specDir: string,
  subtaskId: string,
): Promise<void> {
  const planPath = join(specDir, 'implementation_plan.json');
  try {
    const raw = await readFile(planPath, 'utf-8');
    const plan = safeParseJson<ImplementationPlan>(raw);
    if (!plan) return; // JSON corrupt beyond repair
    let updated = false;

    for (const phase of plan.phases) {
      for (const subtask of phase.subtasks) {
        // Normalize subtask_id → id (Fix 2: planner sometimes writes subtask_id)
        const withLegacyId = subtask as PlanSubtask & { subtask_id?: string };
        if (withLegacyId.subtask_id && !subtask.id) {
          subtask.id = withLegacyId.subtask_id;
          updated = true;
        }

        // Mark this specific subtask as completed if it isn't already
        if (subtask.id === subtaskId && subtask.status !== 'completed') {
          subtask.status = 'completed';
          (subtask as PlanSubtask & { completed_at?: string }).completed_at =
            new Date().toISOString();
          updated = true;
        }
      }
    }

    if (updated) {
      await writeFile(planPath, JSON.stringify(plan, null, 2));
    }
  } catch {
    // Non-fatal: if we can't update the plan the loop will retry or mark stuck
  }
}

/**
 * Re-stamp executionPhase on the plan file after a coder session.
 *
 * During a coder session, the model reads implementation_plan.json, edits
 * subtask statuses, and writes the file back. If the model read the plan
 * before persistPlanPhaseSync set executionPhase to 'coding', the model's
 * write overwrites executionPhase with the stale value (e.g., 'planning').
 *
 * This function runs AFTER the session ends (no more model writes) and
 * corrects executionPhase to the actual current phase.
 *
 * @internal Exported for unit testing only.
 */
export async function restampExecutionPhase(
  specDir: string,
  phase: string,
): Promise<void> {
  const planPath = join(specDir, 'implementation_plan.json');
  try {
    const raw = await readFile(planPath, 'utf-8');
    const plan = safeParseJson<Record<string, unknown>>(raw);
    if (!plan) {
      console.warn(`[restampExecutionPhase] Could not parse implementation_plan.json in ${specDir} — skipping restamp`);
      return;
    }

    if (plan.executionPhase !== phase) {
      plan.executionPhase = phase;
      plan.updated_at = new Date().toISOString();
      await writeFile(planPath, JSON.stringify(plan, null, 2));
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Sync phases from the worktree plan to the main project plan.
 * Keeps the main plan's subtask statuses up-to-date during execution,
 * not just on process exit. Non-fatal: skip silently on any error.
 */
async function syncPhasesToMain(
  worktreeSpecDir: string,
  mainSpecDir: string,
): Promise<void> {
  try {
    const worktreePlanPath = join(worktreeSpecDir, 'implementation_plan.json');
    const mainPlanPath = join(mainSpecDir, 'implementation_plan.json');

    const worktreeRaw = await readFile(worktreePlanPath, 'utf-8');
    const worktreePlan = safeParseJson<ImplementationPlan>(worktreeRaw);
    if (!worktreePlan?.phases) return;

    const mainRaw = await readFile(mainPlanPath, 'utf-8');
    const mainPlan = safeParseJson<Record<string, unknown>>(mainRaw);
    if (!mainPlan) return;

    mainPlan.phases = worktreePlan.phases;
    mainPlan.updated_at = new Date().toISOString();

    await writeFile(mainPlanPath, JSON.stringify(mainPlan, null, 2));
  } catch (err) {
    // Non-fatal: the exit handler will do a final definitive sync.
    // Log so we can diagnose subtask-status-not-updating issues.
    console.warn(
      `[syncPhasesToMain] Failed to sync phases from ${worktreeSpecDir} to ${mainSpecDir}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

// =============================================================================
// Plan Queries
// =============================================================================

/**
 * Load and parse implementation_plan.json.
 */
async function loadImplementationPlan(
  specDir: string,
): Promise<ImplementationPlan | null> {
  const planPath = join(specDir, 'implementation_plan.json');
  try {
    const raw = await readFile(planPath, 'utf-8');
    return safeParseJson<ImplementationPlan>(raw);
  } catch {
    return null;
  }
}

/**
 * Get the next pending subtask from the plan.
 * Skips subtasks that are completed, in_progress (may be worked on by another session),
 * or marked as stuck.
 */
function getNextPendingSubtask(
  plan: ImplementationPlan,
  stuckSubtaskIds: string[],
): { subtask: PlanSubtask; phaseName: string } | null {
  for (const phase of plan.phases) {
    for (const subtask of phase.subtasks) {
      if (
        subtask.status === 'pending' &&
        !stuckSubtaskIds.includes(subtask.id)
      ) {
        return { subtask, phaseName: phase.name };
      }
      // Also pick up in_progress subtasks (may need retry after crash)
      if (
        subtask.status === 'in_progress' &&
        !stuckSubtaskIds.includes(subtask.id)
      ) {
        return { subtask, phaseName: phase.name };
      }
    }
  }
  return null;
}

/**
 * Count total subtasks across all phases.
 */
function countTotalSubtasks(plan: ImplementationPlan): number {
  let count = 0;
  for (const phase of plan.phases) {
    count += phase.subtasks.length;
  }
  return count;
}

/**
 * Count completed subtasks across all phases.
 */
function countCompletedSubtasks(plan: ImplementationPlan): number {
  let count = 0;
  for (const phase of plan.phases) {
    for (const subtask of phase.subtasks) {
      if (subtask.status === 'completed') {
        count++;
      }
    }
  }
  return count;
}

// =============================================================================
// Post-session Insight Extraction
// =============================================================================

/** Default max wait for a rate-limit reset (2 hours), matching Python constant. */
const MAX_RATE_LIMIT_WAIT_MS_DEFAULT = 7_200_000;

/**
 * Run insight extraction for a completed subtask session.
 *
 * This is fire-and-forget — it never blocks the build loop.
 * Returns null on any error so the caller can safely ignore failures.
 */
async function extractInsightsAfterSession(
  config: SubtaskIteratorConfig,
  subtask: PlanSubtask,
  result: SessionResult,
): Promise<ExtractedInsights | null> {
  try {
    const insightConfig: InsightExtractionConfig = {
      subtaskId: subtask.id,
      subtaskDescription: subtask.description,
      sessionNum: 1,
      success: result.outcome === 'completed' || result.outcome === 'max_steps' || result.outcome === 'context_window',
      diff: '',           // Diff gathering requires git; left empty for now
      changedFiles: [],   // Populated by future git integration
      commitMessages: '',
      attemptHistory: [],
    };

    return await extractSessionInsights(insightConfig);
  } catch {
    return null;
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Delay with abort signal support.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
