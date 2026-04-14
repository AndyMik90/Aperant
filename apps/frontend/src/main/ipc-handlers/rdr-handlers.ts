/**
 * RDR (Recover Debug Resend) Handlers
 *
 * Handles automatic recovery, debugging, and resending of stuck/errored tasks.
 * Works in conjunction with MCP tools for Claude Manager to analyze and fix tasks.
 *
 * Processing modes:
 * - Batch 1: JSON Errors → Auto-fix JSON structure
 * - Batch 2: Incomplete Tasks → Auto-submit "Request Changes" to resume
 * - Batch 3: QA Rejected / Other Errors → Queue for MCP/Claude Code analysis
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import type { IPCResult, AppSettings } from '../../shared/types';
import { JSON_ERROR_PREFIX } from '../../shared/constants/task';
import { projectStore } from '../project-store';
import { isElectron } from '../electron-compat';
import { outputMonitor } from '../claude-code/output-monitor';
import type { AgentManager } from '../agent/agent-manager';
import { readSettingsFile } from '../settings-utils';
import { getUsageMonitor } from '../claude-profile/usage-monitor';

const MANUAL_RDR_TEST_PROMPT = 'Aperant test prompt: manual RDR connection check.';

async function sendMessageWithActiveRdrMechanism(
  identifier: number | string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  const settings = (readSettingsFile() || {}) as Partial<AppSettings>;
  const { DEFAULT_RDR_MECHANISMS } = await import('../../shared/constants/config');

  const mechanisms = settings.rdrMechanisms || DEFAULT_RDR_MECHANISMS;
  const activeMechanismId = settings.activeMechanismId || mechanisms[0]?.id;
  const activeMechanism = mechanisms.find((mechanism) => mechanism.id === activeMechanismId) || mechanisms[0];

  if (activeMechanism) {
    console.log(`[RDR] Using mechanism: "${activeMechanism.name}"`);
    console.log(`[RDR] Template: ${activeMechanism.template}`);
  } else {
    console.error('[RDR] No RDR mechanism found, using default');
  }

  const { sendRdrMessage } = await import('../platform/rdr-message-sender');
  return sendRdrMessage(identifier, message, activeMechanism?.template);
}

/**
 * Reset rdrAttempts for all tasks across all projects.
 * Called on app startup (unless it's a P6B programmatic restart).
 * This ensures priorities start fresh each session — P1 by default.
 */
export function resetAllRdrAttempts(): void {
  const projects = projectStore.getProjects();
  for (const project of projects) {
    if (!project.path) continue;
    const specsDir = path.join(project.path, '.auto-claude', 'specs');
    if (!existsSync(specsDir)) continue;

    try {
      const dirs = readdirSync(specsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const dir of dirs) {
        const metadataPath = path.join(specsDir, dir, 'task_metadata.json');
        if (!existsSync(metadataPath)) continue;
        try {
          const raw = readFileSync(metadataPath, 'utf-8');
          const metadata = JSON.parse(raw);
          if (metadata.rdrAttempts && metadata.rdrAttempts > 0) {
            // Don't reset rdrAttempts for backlog/pending/queue tasks — rdrAttempts > 0
            // is the signal that a task was previously processed by RDR and regressed.
            // Without this, regression detection can't distinguish "new task" from "regressed task"
            // after an app restart (the gap that caused 43 tasks to go undetected).
            const planPath = path.join(specsDir, dir, 'implementation_plan.json');
            try {
              const planRaw = readFileSync(planPath, 'utf-8');
              const plan = JSON.parse(planRaw);
              const status = plan.status || plan.planStatus;
              if (status === 'pending' || status === 'backlog' || status === 'queue') {
                continue; // Preserve rdrAttempts — regression signal
              }
            } catch { /* can't read plan — reset as before */ }
            const updated = { ...metadata, rdrAttempts: 0, rdrLastAttempt: null };
            writeFileSync(metadataPath, JSON.stringify(updated, null, 2));
          }
        } catch { /* skip unreadable files */ }
      }
    } catch { /* skip unreadable dirs */ }
  }
  // Load persisted RDR pause state (survives crashes)
  loadRdrPauseState();
  console.log('[RDR] Reset rdrAttempts for active/done tasks (preserved backlog/pending for regression detection)');
}

/**
 * Read the raw plan status directly from implementation_plan.json on disk.
 * ProjectStore maps start_requested → backlog, losing the original status.
 * This lets RDR detect tasks that were supposed to start but never did.
 */
function getRawPlanStatus(projectPath: string, specId: string): string | undefined {
  const planPath = path.join(projectPath, '.auto-claude', 'specs', specId, 'implementation_plan.json');
  try {
    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
    return plan.status;
  } catch {
    return undefined;
  }
}

interface WorktreeInfo {
  status?: string;
  planStatus?: string;
  qaSignoff?: string;    // qa_signoff.status from worktree plan
  exitReason?: string;   // exitReason from worktree plan
}

function getWorktreeInfo(projectPath: string, specId: string): WorktreeInfo {
  const worktreePlanPath = path.join(projectPath, '.auto-claude', 'worktrees', 'tasks', specId, '.auto-claude', 'specs', specId, 'implementation_plan.json');
  try {
    const plan = JSON.parse(readFileSync(worktreePlanPath, 'utf-8'));
    return {
      status: plan.status,
      planStatus: plan.planStatus,
      qaSignoff: plan.qa_signoff?.status,
      exitReason: plan.exitReason,
    };
  } catch {
    return {};
  }
}

// Note: ipcMain and BrowserWindow are imported directly from 'electron' via ESM
// (externalized by electron-vite). window-manager and mcp-server are loaded
// dynamically when needed to avoid module resolution issues after compilation.

// ============================================================================
// Timer-Based Batching State
// ============================================================================

// Pending tasks collected before timer fires
interface PendingRdrTask {
  projectId: string;
  task: TaskInfo;
}

let pendingTasks: PendingRdrTask[] = [];
let batchTimer: NodeJS.Timeout | null = null;
const BATCH_COLLECTION_WINDOW_MS = 30000; // 30 seconds

// ============================================================================
// RDR Rate Limit Pause
// ============================================================================
//
// When a task agent detects a rate limit, both Claude Code and task agents are
// on the same subscription — so RDR must STOP sending until the limit resets.
// State is persisted to disk so it survives app crashes/restarts.

interface RdrPauseState {
  paused: boolean;
  warning: boolean;          // true at 80%+ — show timer, but RDR still sends
  reason: string;
  pausedAt: number;          // epoch ms
  rateLimitResetAt: number;  // epoch ms — when the rate limit expires
}

const RDR_PAUSE_FILE = path.join(
  process.env.APPDATA || os.homedir(),
  'auto-claude-ui',
  'rdr-pause.json'
);

let rdrPauseState: RdrPauseState = { paused: false, warning: false, reason: '', pausedAt: 0, rateLimitResetAt: 0 };

/** Get current RDR pause state for diagnostics */
export function getRdrPauseState(): RdrPauseState {
  return { ...rdrPauseState };
}

/** Check if RDR is currently paused — auto-expires if reset time has passed while app was running */
export function isRdrPaused(): boolean {
  if ((rdrPauseState.paused || rdrPauseState.warning) && rdrPauseState.rateLimitResetAt > 0 && Date.now() >= rdrPauseState.rateLimitResetAt) {
    console.log('[RDR] Rate limit reset time passed — auto-resuming');
    rdrPauseState = { paused: false, warning: false, reason: '', pausedAt: 0, rateLimitResetAt: 0 };
    persistRdrPauseState();
    try {
      const allWindows = BrowserWindow?.getAllWindows() || [];
      for (const win of allWindows) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.RDR_RATE_LIMIT_CLEARED, { reason: 'Rate limit expired' });
        }
      }
    } catch {}
    return false;
  }
  return rdrPauseState.paused;
}

/** Persist pause state to disk so it survives crashes (async to avoid blocking event loop) */
function persistRdrPauseState(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeFile } = require('fs/promises');
    writeFile(RDR_PAUSE_FILE, JSON.stringify(rdrPauseState, null, 2))
      .catch((writeErr: unknown) => console.error('[RDR] Failed to persist pause state:', writeErr));
  } catch (err) {
    console.error('[RDR] Failed to persist pause state:', err);
  }
}

/** Load pause state from disk on startup */
function loadRdrPauseState(): void {
  try {
    if (!existsSync(RDR_PAUSE_FILE)) return;
    const raw = readFileSync(RDR_PAUSE_FILE, 'utf-8');
    const loaded = JSON.parse(raw) as RdrPauseState;

    // Backcompat: old files may not have `warning` field
    if (loaded.warning === undefined) loaded.warning = loaded.paused;

    // If rate limit reset time has passed, auto-clear both pause and warning
    if ((loaded.paused || loaded.warning) && loaded.rateLimitResetAt > 0 && Date.now() >= loaded.rateLimitResetAt) {
      console.log('[RDR] Rate limit expired during restart — resuming RDR');
      rdrPauseState = { paused: false, warning: false, reason: '', pausedAt: 0, rateLimitResetAt: 0 };
      persistRdrPauseState();
      return;
    }

    rdrPauseState = loaded;
    if (rdrPauseState.paused) {
      const remainingMin = Math.ceil((rdrPauseState.rateLimitResetAt - Date.now()) / 60_000);
      console.log(`[RDR] Loaded persisted pause state — still paused (resets in ${remainingMin}min)`);
    } else if (rdrPauseState.warning) {
      const remainingMin = Math.ceil((rdrPauseState.rateLimitResetAt - Date.now()) / 60_000);
      console.log(`[RDR] Loaded persisted warning state — session high (resets in ${remainingMin}min), RDR still active`);
    }
  } catch {
    // Corrupted file — start fresh
    rdrPauseState = { paused: false, warning: false, reason: '', pausedAt: 0, rateLimitResetAt: 0 };
  }
}

/** Pause RDR — block all sends until rate limit resets (100% session usage) */
export function pauseRdr(reason: string, rateLimitResetAt: number, provider?: string): void {
  // Reject invalid or already-past reset times — stale cached usage data can trigger
  // pauseRdr() after the limit has already reset, creating a zombie pause state
  if (!rateLimitResetAt || !Number.isFinite(rateLimitResetAt) || rateLimitResetAt <= Date.now()) {
    console.log(`[RDR] Ignoring pauseRdr — reset time already passed or invalid (${rateLimitResetAt})`);
    return;
  }

  rdrPauseState = {
    paused: true,
    warning: true,
    reason,
    pausedAt: Date.now(),
    rateLimitResetAt,
  };
  persistRdrPauseState();

  const remainingMin = Math.ceil((rateLimitResetAt - Date.now()) / 60_000);
  console.log(`[RDR] PAUSED: ${reason} (resets in ${remainingMin}min)${provider ? ` [provider: ${provider}]` : ''}`);

  // Notify renderer (include provider so renderer can filter per-project)
  try {
    const allWindows = BrowserWindow?.getAllWindows() || [];
    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.RDR_RATE_LIMITED, {
          paused: true,
          warning: true,
          reason,
          rateLimitResetAt,
          provider, // "anthropic" | "minimax" | undefined (global)
        });
      }
    }
  } catch (err) {
    console.error('[RDR] Failed to notify renderer of pause:', err);
  }
}

/** Warn RDR — show countdown timer but DON'T block sends (80-99% session usage) */
export function warnRdr(reason: string, rateLimitResetAt: number): void {
  // Don't downgrade a pause to a warning
  if (rdrPauseState.paused) return;

  // Reject invalid or already-past reset times (same guard as pauseRdr)
  if (!rateLimitResetAt || !Number.isFinite(rateLimitResetAt) || rateLimitResetAt <= Date.now()) {
    console.log(`[RDR] Ignoring warnRdr — reset time already passed or invalid (${rateLimitResetAt})`);
    return;
  }

  rdrPauseState = {
    paused: false,
    warning: true,
    reason,
    pausedAt: Date.now(),
    rateLimitResetAt,
  };
  persistRdrPauseState();

  const remainingMin = Math.ceil((rateLimitResetAt - Date.now()) / 60_000);
  console.log(`[RDR] WARNING: ${reason} (resets in ${remainingMin}min) — RDR still active`);

  // Notify renderer to show timer (but NOT block sends)
  try {
    const allWindows = BrowserWindow?.getAllWindows() || [];
    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.RDR_RATE_LIMITED, {
          paused: false,
          warning: true,
          reason,
          rateLimitResetAt,
        });
      }
    }
  } catch (err) {
    console.error('[RDR] Failed to notify renderer of warning:', err);
  }
}

/** Resume RDR — rate limit cleared, trigger immediate send */
export function resumeRdr(reason: string, provider?: string): void {
  // ALWAYS notify renderer even if main process already cleared — prevents desync
  // where renderer stays paused after overnight rate limit reset

  console.log(`[RDR] RESUMED: ${reason}${provider ? ` [provider: ${provider}]` : ''}`);
  rdrPauseState = { paused: false, warning: false, reason: '', pausedAt: 0, rateLimitResetAt: 0 };
  persistRdrPauseState();

  // Notify renderer (include provider so it can filter per-project)
  try {
    const allWindows = BrowserWindow?.getAllWindows() || [];
    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.RDR_RATE_LIMIT_CLEARED, { reason, provider });
      }
    }
  } catch (err) {
    console.error('[RDR] Failed to notify renderer of resume:', err);
  }

  // Trigger immediate RDR processing for pending tasks
  if (pendingTasks.length > 0) {
    console.log(`[RDR] Processing ${pendingTasks.length} pending tasks after rate limit cleared`);
    processPendingTasks(true);
  }
}

// Agent manager reference — set during registration, used to check if agent IS running
let agentManagerRef: AgentManager | null = null;

/** Check if an agent process is currently running for this task (real process check, not timestamp guessing) */
function isTaskAgentRunning(taskId: string): boolean {
  return agentManagerRef?.isRunning(taskId) ?? false;
}

/** Staleness threshold: if agent process exists but plan hasn't been updated in this many ms, consider stalled.
 *  15 minutes is generous — even planning phase updates updated_at within the first few minutes. */
const STALE_AGENT_THRESHOLD_MS = 15 * 60 * 1000;

/** Minimum agent age before staleness check applies. Don't flag freshly-started agents. */
const STALE_AGENT_MIN_AGE_MS = 10 * 60 * 1000;

/** Check if an agent process exists but is stalled (alive but making no progress).
 *  Rate-limited agents may keep their process alive while the SDK retries internally,
 *  making isTaskAgentRunning() return true even though the agent is effectively dead.
 *  Uses plan file updated_at + agent startedAt to detect this. */
function isTaskAgentStalled(taskId: string, taskUpdatedAt?: string): boolean {
  if (!agentManagerRef) return false;
  if (!agentManagerRef.isRunning(taskId)) return false; // Not running = not stalled (it's dead)

  const procInfo = agentManagerRef.getProcessInfo(taskId);
  if (!procInfo) return false;

  const now = Date.now();
  const agentAge = now - procInfo.startedAt.getTime();

  // Don't flag agents that just started — give them time to produce first plan update
  if (agentAge < STALE_AGENT_MIN_AGE_MS) return false;

  // If we have updated_at from the plan file, check how stale it is
  if (taskUpdatedAt) {
    const lastUpdate = new Date(taskUpdatedAt).getTime();
    if (!Number.isNaN(lastUpdate)) {
      const staleDuration = now - lastUpdate;
      if (staleDuration > STALE_AGENT_THRESHOLD_MS) {
        console.log(`[RDR] Agent for ${taskId} is STALLED: process alive for ${Math.round(agentAge / 60_000)}min, plan last updated ${Math.round(staleDuration / 60_000)}min ago`);
        return true;
      }
      return false; // Plan was updated recently — agent is active
    }
  }

  // No updated_at available — fall back to agent age alone
  // If the agent has been running for >30 min with no plan update data, it's suspicious
  if (agentAge > STALE_AGENT_THRESHOLD_MS * 2) {
    console.log(`[RDR] Agent for ${taskId} is STALLED: process alive for ${Math.round(agentAge / 60_000)}min with no updated_at data`);
    return true;
  }

  return false;
}

/** Check if a task was previously started by looking for execution artifacts in the raw plan.
 *  Detects planning-phase regressions where no worktree/exitReason/planStatus signals exist.
 *  These fields are written by the agent/file-watcher when a task enters execution. */
function wasTaskPreviouslyStarted(projectPath: string, specId: string): boolean {
  const planPath = path.join(projectPath, '.auto-claude', 'specs', specId, 'implementation_plan.json');
  try {
    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
    return !!(plan.start_requested_at || plan.executionPhase || plan.lastEvent);
  } catch { return false; }
}

// Types for RDR processing
interface RdrProcessResult {
  taskId: string;
  action: 'json_fixed' | 'json_unfixable' | 'recovery_triggered' | 'fix_submitted' | 'resumed' | 'no_action' | 'error';
  reason?: string;
  error?: string;
}

export interface TaskInfo {
  specId: string;
  title?: string;
  status: string;
  reviewReason?: string;
  description?: string;
  subtasks?: Array<{ status: string; name?: string }>;
  phases?: Array<{ subtasks?: Array<{ status: string; updated_at?: string }> }>;
  exitReason?: string;
  planStatus?: string;
  created_at?: string;
  updated_at?: string;
  qaSignoff?: string;     // qa_signoff.status from worktree/main plan
  rdrDisabled?: boolean;  // If true, RDR will skip this task
  metadata?: { stuckSince?: string; forceRecovery?: boolean; rdrAttempts?: number; rdrLastAttempt?: string };  // Task recovery metadata
}

export interface RdrBatch {
  type: 'json_error' | 'incomplete' | 'qa_rejected' | 'errors' | 'recovery';
  taskIds: string[];
  tasks: TaskInfo[];
}

interface RdrProcessingSummary {
  processed: number;
  jsonFixed: number;
  fixSubmitted: number;
  queuedForMcp: number;
  results?: RdrProcessResult[];
  batches: Array<{ type: string; count: number }>;
  message?: string;  // Optional status message for queued tasks
}

// RDR Intervention Types (matches shared/types/task.ts)
type InterventionType = 'recovery' | 'resume' | 'stuck' | 'incomplete';

/**
 * Calculate task progress from phases/subtasks
 * Returns percentage of completed subtasks (0-100)
 * Reused from auto-shutdown-handlers logic
 *
 * NOTE: Handles both 'subtasks' and 'chunks' naming conventions
 * (some implementation_plan.json files use 'chunks' instead of 'subtasks')
 */
function calculateTaskProgress(task: TaskInfo): number {
  if (!task.phases || task.phases.length === 0) {
    return 0;
  }

  // Flatten all subtasks from all phases
  // Handle both 'subtasks' and 'chunks' naming conventions (Bug fix)
  const allSubtasks = task.phases.flatMap(phase =>
    phase.subtasks || (phase as { chunks?: Array<{ status: string }> }).chunks || []
  ).filter(Boolean);

  // If no subtasks exist, check if all phases are completed
  // This handles tasks that complete all phases but have no individual subtasks
  if (allSubtasks.length === 0) {
    const allPhasesComplete = task.phases.every(
      (p: any) => p.status === 'completed'
    );
    return allPhasesComplete ? 100 : 0;
  }

  const completed = allSubtasks.filter(s => s.status === 'completed').length;
  return Math.round((completed / allSubtasks.length) * 100);
}

/**
 * Enrich a task with worktree plan data when the worktree has a more active status.
 * The ProjectStore dedup prefers main (for KanbanBoard display), but worktrees have
 * the ACTUAL agent progress. Tasks showing human_review 100% in main may actually be
 * ai_review or in_progress in the worktree (still being worked on by the agent).
 *
 * Path: <project>/.auto-claude/worktrees/tasks/<taskId>/.auto-claude/specs/<taskId>/implementation_plan.json
 */
export function enrichTaskWithWorktreeData(task: TaskInfo, projectPath: string): TaskInfo {
  // Read qa_signoff from MAIN plan file (authoritative for completion status).
  // projectStore.loadTasksFromSpecsDir() doesn't extract this field, so task.qaSignoff
  // is always undefined unless we read it here.
  const mainPlanPath = path.join(
    projectPath, '.auto-claude', 'specs', task.specId, 'implementation_plan.json'
  );
  try {
    if (existsSync(mainPlanPath)) {
      const mainPlan = JSON.parse(readFileSync(mainPlanPath, 'utf-8'));
      const mainQaSignoff = mainPlan.qa_signoff?.status as string | undefined;
      if (mainQaSignoff) {
        task = { ...task, qaSignoff: mainQaSignoff };
      }
    }
  } catch { /* ignore parse errors — main plan may be corrupted */ }

  const worktreePlanPath = path.join(
    projectPath, '.auto-claude', 'worktrees', 'tasks', task.specId,
    '.auto-claude', 'specs', task.specId, 'implementation_plan.json'
  );

  if (!existsSync(worktreePlanPath)) {
    return task;
  }

  try {
    const worktreePlan = JSON.parse(readFileSync(worktreePlanPath, 'utf-8'));
    const worktreeStatus = worktreePlan.status as string;

    // Terminal statuses in worktree mean the agent is done - don't override
    // NOTE: 'completed' is NOT terminal here - it means the agent finished subtasks
    // but may still need QA/transition. Auto-shutdown treats it as needing attention.
    if (worktreeStatus === 'done' || worktreeStatus === 'pr_created') {
      return task;
    }

    // Map raw plan status to Kanban TaskStatus — must match projectStore.determineTaskStatusAndReason()
    // Without this mapping, raw statuses like "planning"/"coding"/"review" bypass the active task
    // check in determineInterventionType() (which expects "in_progress"/"ai_review"), causing
    // running agents to be falsely flagged as needing intervention.
    const RAW_TO_KANBAN_STATUS: Record<string, string> = {
      'pending': 'backlog',
      'start_requested': 'backlog',
      'planning': 'in_progress',
      'in_progress': 'in_progress',
      'coding': 'in_progress',
      'review': 'ai_review',
      'qa_review': 'ai_review',
      'qa_fixing': 'ai_review',
      'completed': 'done',
      'done': 'done',
      'human_review': 'human_review',
      'ai_review': 'ai_review',
      'pr_created': 'pr_created',
      'backlog': 'backlog',
      'error': 'error',
      'queue': 'queue',
      'queued': 'queue'
    };
    const mappedStatus = RAW_TO_KANBAN_STATUS[worktreeStatus] || worktreeStatus;

    // Enrich for ANY non-terminal worktree status that differs from main (using mapped status)
    // Terminal statuses (done, pr_created) already handled above
    // This eliminates the entire class of "missing status" bugs — any new status
    // the backend introduces (qa_revalidation, review, approved, etc.) is auto-covered
    if (mappedStatus !== task.status) {
      console.log(`[RDR] Enriching task ${task.specId}: main=${task.status} → worktree=${mappedStatus} (raw: ${worktreeStatus})`);
      return {
        ...task,
        status: mappedStatus,
        phases: worktreePlan.phases || task.phases,
        planStatus: worktreePlan.status, // Keep raw status for planStatus (used by other checks)
        updated_at: worktreePlan.updated_at || worktreePlan.last_updated || task.updated_at,
        exitReason: worktreePlan.exitReason !== undefined ? worktreePlan.exitReason : task.exitReason,
        reviewReason: worktreePlan.reviewReason !== undefined ? worktreePlan.reviewReason : task.reviewReason,
        // NOTE: Do NOT propagate worktree qaSignoff here — only main plan's qaSignoff
        // is authoritative for the "legitimate completion" skip in determineInterventionType().
        // Worktree qa_signoff may be premature (written by QA agent before rate limit crash).
        // Keep task.metadata (from task_metadata.json: stuckSince, rdrAttempts, forceRecovery)
        // Don't overwrite with worktreePlan.metadata (plan's metadata: created_at, complexity)
      };
    }

    // Even if status matches, propagate exitReason so crash detection works.
    // NOTE: Do NOT propagate worktree qaSignoff — only main plan's qaSignoff is authoritative.
    // Worktree qa_signoff may be premature (QA agent wrote approval before rate limit crash).
    const worktreeExitReason = worktreePlan.exitReason as string | undefined;
    if (worktreeExitReason !== undefined) {
      return {
        ...task,
        exitReason: worktreeExitReason,
      };
    }
  } catch (e) {
    // Silently fall through - use main data
  }

  return task;
}

/**
 * Check if task is legitimate human review (shouldn't be flagged by RDR)
 *
 * Logic:
 * - QA-approved tasks at 100% = ALWAYS legitimate (authoritative completion signal)
 * - Tasks at 100% with qaSignoff='approved' = legitimate
 * - Tasks at 100% with reviewReason='completed' but NO qaSignoff = NOT legitimate (QA didn't run)
 * - Tasks at 100% with no qaSignoff and no reviewReason = NOT legitimate (stuck)
 * - Tasks with crash exitReason = NOT legitimate
 * - Tasks at <100% = NOT legitimate (incomplete work)
 */
function isLegitimateHumanReview(task: TaskInfo): boolean {
  const progress = calculateTaskProgress(task);

  // User explicitly stopped this task without QA approval — not a legitimate review
  // But if QA already approved the work, the stop is just a session artifact
  if (task.reviewReason === 'stopped' && task.qaSignoff !== 'approved') {
    return false;
  }

  // QA-approved tasks at 100% are done — exitReason is a session-level artifact, not work-quality
  // If QA agent wrote approved, it validated the work. Crashes happen AFTER approval was written.
  // NOTE: reviewReason='completed' alone is NOT sufficient — it means coder finished subtasks, not QA approved
  if (progress === 100 && task.qaSignoff === 'approved') {
    return true;
  }

  // Tasks at 100% with NO qaSignoff and NO reviewReason are NOT legitimate
  // (QA validation crashed or still running)
  if (progress === 100 && !task.reviewReason && !task.qaSignoff) {
    return false;  // Flag for intervention - validation didn't complete properly
  }

  // Tasks with crash/error exitReason are NOT legitimate (even at 100%)
  // This catches tasks that completed subtasks but then crashed during validation/QA
  if (task.exitReason === 'error' ||
      task.exitReason === 'auth_failure' ||
      task.exitReason === 'prompt_loop' ||
      task.exitReason === 'rate_limit_crash') {
    return false;  // Flag for intervention - crashed/errored
  }

  // Tasks at 100% with error/failure reviewReasons are NOT legitimate
  // These reviewReasons explicitly indicate failure states that need intervention:
  // - 'errors' = XState error state (task crashed/agent died)
  // - 'qa_rejected' = QA agent explicitly rejected the work
  if (progress === 100 && (
    task.reviewReason === 'errors' ||
    task.reviewReason === 'qa_rejected'
  )) {
    return false;  // Flag for intervention — error/rejection, not legitimate review
  }

  // Tasks at 100% with other reviewReasons = legitimate (except 'completed' without qaSignoff)
  // 'completed' without qaSignoff means coder finished but QA never ran — NOT legitimate
  if (progress === 100 && task.reviewReason !== 'completed') {
    return true;  // Don't flag - task has a non-completion reviewReason, waiting for user action
  }
  // Fall through: reviewReason=completed without qaSignoff = NOT legitimate (QA never ran)

  return false;
}

/**
 * Determine what type of intervention a task needs
 * Returns null if task doesn't need intervention
 *
 * Types:
 * - 'recovery': Task crashed/errored (exitReason: error, reviewReason: errors/qa_rejected)
 * - 'resume': Task paused mid-work (rate_limit_crash, incomplete_work)
 * - 'stuck': Task bounced to human_review with incomplete subtasks (no clear exit reason)
 * - 'incomplete': Task has pending subtasks in active boards (in_progress, ai_review)
 */
function determineInterventionType(task: TaskInfo, hasWorktree?: boolean, rawPlanStatus?: string, worktreeInfo?: WorktreeInfo, wasStartedBefore?: boolean, projectPath?: string): InterventionType | null {
  // Skip completed/archived tasks - these never need intervention
  if (task.status === 'done' || task.status === 'pr_created') {
    return null;
  }

  // QA completion check: either qa_signoff=approved OR qa_report.md means genuinely complete.
  // qa_report.md is an additional signal (written on manual user approval or by QA pipeline).
  const qaApprovedProgress = calculateTaskProgress(task);
  const isQaApproved = task.qaSignoff === 'approved';
  const hasQaReport = projectPath
    ? existsSync(path.join(projectPath, '.auto-claude', 'specs', task.specId, 'qa_report.md'))
    : false;

  if (qaApprovedProgress === 100 && (isQaApproved || hasQaReport)) {
    if (task.status === 'human_review') {
      const worktreeTerminal = !worktreeInfo?.status ||
        worktreeInfo.status === 'human_review' || worktreeInfo.status === 'done' || worktreeInfo.status === 'pr_created';

      if (worktreeTerminal && (isQaApproved || hasQaReport)) {
        // Either qa_signoff=approved OR qa_report.md exists — genuinely complete
        console.log(`[RDR] Task ${task.specId} QA-complete at 100% on human_review — skipping (qa_signoff=${isQaApproved}, qa_report=${hasQaReport})`);
        return null;
      }
      if (!worktreeTerminal) {
        // Worktree stuck at non-standard status — needs recovery
        console.log(`[RDR] Task ${task.specId} QA-approved but worktree stuck at '${worktreeInfo?.status}' — needs recovery`);
        return 'incomplete';
      }
    } else {
      // Task is QA-approved but stuck on wrong board (e.g. ai_review, start_requested)
      // Don't return null — let it fall through to normal detection which will flag for recovery
      console.log(`[RDR] Task ${task.specId} QA-approved at 100% but stuck at ${task.status} — needs recovery to human_review`);
    }
  }

  // TESTING: forceRecovery flag bypasses all recency and progress checks
  if (task.metadata?.forceRecovery) {
    console.log(`[RDR] Task ${task.specId} has forceRecovery flag - forcing intervention (status=${task.status})`);
    return 'stuck';
  }

  // REGRESSED: Task went back to backlog/pending but has a worktree (agent previously started work)
  // This means the agent crashed or was interrupted and the task regressed
  // STUCK START: Task has start_requested in raw plan but ProjectStore mapped it to backlog
  // This means the file watcher never picked it up and the agent never started
  if (task.status === 'backlog' || task.status === 'pending' || task.status === 'plan_review' || task.status === 'queue') {
    // STUCK TASK: If task has metadata.stuckSince, it's in recovery mode - ALWAYS flag it
    // (applies to all three statuses, not just plan_review)
    if (task.metadata?.stuckSince) {
      console.log(`[RDR] Task ${task.specId} is STUCK (recovery mode since ${task.metadata.stuckSince}) - flagging for intervention`);
      return 'stuck';
    }

    // Check if agent is actually running right now (not timestamp guessing)
    // Prevents false positives for tasks actively running their planning phase
    if (isTaskAgentRunning(task.specId)) {
      console.log(`[RDR] Task ${task.specId} in ${task.status} - agent IS running - SKIPPING`);
      return null;
    }

    if (task.status === 'plan_review') {
      console.log(`[RDR] Task ${task.specId} in plan_review - needs to start coding`);
      return 'incomplete';
    }
    if (hasWorktree) {
      console.log(`[RDR] Task ${task.specId} regressed to ${task.status} but has worktree - needs restart`);
      return 'incomplete';
    }
    if (rawPlanStatus === 'start_requested') {
      console.log(`[RDR] Task ${task.specId} has start_requested but never started - needs restart`);
      return 'incomplete';
    }
    // REGRESSION: Task was previously started (by user OR master LLM) but crashed back
    // to queue/backlog during planning. No worktree exists yet (planning doesn't create one),
    // but exitReason/planStatus/phases show evidence of prior execution.
    // Without this check, master-LLM-started tasks that fail during planning go undetected.
    if (task.exitReason) {
      console.log(`[RDR] Task ${task.specId} regressed to ${task.status} with exitReason '${task.exitReason}' - was previously started, needs restart`);
      return 'incomplete';
    }
    if (task.planStatus && task.planStatus !== 'pending' && task.planStatus !== 'draft') {
      console.log(`[RDR] Task ${task.specId} regressed to ${task.status} with planStatus '${task.planStatus}' - was previously started, needs restart`);
      return 'incomplete';
    }
    // REGRESSION via RDR history: Task was previously processed by RDR (rdrAttempts > 0)
    if (task.metadata?.rdrAttempts && task.metadata.rdrAttempts > 0) {
      console.log(`[RDR] Task ${task.specId} regressed to ${task.status} with rdrAttempts=${task.metadata.rdrAttempts} - previously processed by RDR, needs restart`);
      return 'incomplete';
    }
    // REGRESSION via execution artifacts: Task has start_requested_at, executionPhase, or
    // lastEvent in the raw plan — proving it was previously started and ran planning.
    // This catches first-time regressions where no worktree/exitReason/rdrAttempts exist.
    if (wasStartedBefore) {
      console.log(`[RDR] Task ${task.specId} regressed to ${task.status} - was previously started (start_requested_at/executionPhase found), needs restart`);
      return 'incomplete';
    }
    return null;
  }

  const progress = calculateTaskProgress(task);

  // Check if this is legitimate human review (any human_review at 100% = waiting for user)
  if (task.status === 'human_review' && isLegitimateHumanReview(task)) {
    // Check if worktree has ANY non-terminal status that differs from human_review
    // This catches qa_revalidation, start_requested, in_progress, approved, etc.
    const worktreeNonTerminal = worktreeInfo?.status &&
      worktreeInfo.status !== 'human_review' &&
      worktreeInfo.status !== 'done' &&
      worktreeInfo.status !== 'pr_created';

    if (worktreeNonTerminal) {
      // Exception: start_requested with QA approved = work IS done, just needs board move
      if (worktreeInfo!.status === 'start_requested' && task.qaSignoff === 'approved') {
        console.log(`[RDR] Task ${task.specId} worktree start_requested but main plan QA approved — skipping`);
        return null;
      }
      console.log(`[RDR] Task ${task.specId} at 100% but worktree at '${worktreeInfo!.status}' — needs intervention`);
      return 'incomplete';
    }
    return null;
  }

  // If we got here with human_review status, it's NOT legitimate - flag it
  // This catches plan_review tasks and any other invalid human_review states
  if (task.status === 'human_review') {
    // task has human_review status but isLegitimateHumanReview returned false
    // This means it's a plan_review task (needs to start coding) or
    // a task at <100% (QA crashed/incomplete)
    if (task.reviewReason === 'plan_review') {
      // FILTER: Only flag plan_review if there's evidence of actual problems
      // Tasks at 100% with no exit reason are likely false positives
      // (planStatus: 'review' is stale from spec creation and never gets cleared)
      if (progress === 100 && !task.exitReason) {
        console.log(`[RDR] ⏭️  Skipping ${task.specId} - plan_review but 100% complete with no errors (likely false positive)`);
        return null;
      }
      console.log(`[RDR] Task ${task.specId} in plan_review - needs to start coding`);
      return 'incomplete';
    }
    // Other invalid human_review cases (QA crashed, incomplete work)
    console.log(`[RDR] Task ${task.specId} in human_review but not legitimate (progress=${progress}%)`);
    return 'stuck';
  }

  // ── ACTIVE TASKS (MUST come before exitReason check) ──
  // These statuses mean the agent should be running. Check if agent IS running right now.
  // exitReason is STALE from previous sessions — ignore it if agent is actually alive.
  if (task.status === 'in_progress' || task.status === 'ai_review' ||
      task.status === 'qa_approved' || task.status === 'completed') {
    // STUCK TASK: If task has metadata.stuckSince, it's in recovery mode - ALWAYS flag it
    if (task.metadata?.stuckSince) {
      console.log(`[RDR] Task ${task.specId} is STUCK (recovery mode since ${task.metadata.stuckSince}) - flagging for intervention`);
      return 'stuck';
    }

    // Check if agent process is actually running right now (not timestamp guessing)
    if (isTaskAgentRunning(task.specId)) {
      console.log(`[RDR] Task ${task.specId} in ${task.status} - agent IS running - SKIPPING`);
      return null;
    }
    // Agent NOT running — it died. Flag for continuation.
    console.log(`[RDR] Task ${task.specId} in active status ${task.status} at ${progress}% - agent NOT running, needs continuation (exit=${task.exitReason || 'none'})`);
    return 'incomplete';
  }

  // ── RECOVERY: Crashed with error or QA rejected (non-active statuses only) ──
  // Only reached for statuses like human_review, start_requested, etc.
  // Active statuses (in_progress, ai_review) are already handled above with recency check.
  if (task.exitReason === 'error' ||
      task.exitReason === 'auth_failure' ||
      task.reviewReason === 'errors' ||
      task.reviewReason === 'qa_rejected') {
    return 'recovery';
  }

  // RESUME: Rate limited or paused mid-task (non-active statuses only)
  if (task.exitReason === 'rate_limit_crash' ||
      task.exitReason === 'prompt_loop' ||
      task.reviewReason === 'incomplete_work') {
    return 'resume';
  }

  // STUCK: In human_review with incomplete subtasks (< 100%)
  // Note: human_review at 100% is already caught by isLegitimateHumanReview above
  if (task.status === 'human_review' && progress < 100) {
    console.log(`[RDR] Task ${task.specId} in human_review at ${progress}% - stuck with incomplete work`);
    return 'stuck';
  }

  // start_requested = a previous RDR recovery set this status but agent didn't restart
  if (task.status === 'start_requested') {
    console.log(`[RDR] Task ${task.specId} stuck at start_requested — needs restart`);
    return 'incomplete';
  }

  // Empty plan - needs intervention
  if (!task.phases || task.phases.length === 0) {
    return 'recovery';
  }

  // Catch-all: any task reaching here has a non-terminal status we didn't explicitly handle
  // If agent isn't running and task has work (phases), it needs intervention
  if (!isTaskAgentRunning(task.specId) && task.phases && task.phases.length > 0) {
    console.log(`[RDR] Task ${task.specId} in unhandled status '${task.status}' - agent NOT running, flagging as incomplete`);
    return 'incomplete';
  }
  console.log(`[RDR] Task ${task.specId}: no intervention needed (status=${task.status})`);
  return null;
}

// Interface for rich task info used in RDR messages
interface RichTaskInfo {
  specId: string;
  status: string;
  reviewReason?: string;
  interventionType: InterventionType | null;
  progress: {
    completed: number;
    total: number;
    percentage: number;
    lastSubtaskName?: string;
    lastSubtaskIndex?: number;
  };
  currentPhase?: 'planning' | 'coding' | 'validation';
  lastLogs: Array<{
    timestamp: string;
    phase: string;
    content: string;
  }>;
  errors?: {
    exitReason?: string;
    reviewReason?: string;
    errorSummary?: string;
  };
}

/**
 * Get the last N log entries from task_logs.json
 * Combines entries from all phases and sorts by timestamp
 */
function getLastLogEntries(projectPath: string, specId: string, count: number = 3): Array<{
  timestamp: string;
  phase: string;
  content: string;
}> {
  // Prefer worktree logs (has latest agent activity) over main
  const worktreeLogsPath = path.join(
    projectPath, '.auto-claude', 'worktrees', 'tasks', specId,
    '.auto-claude', 'specs', specId, 'task_logs.json'
  );
  const mainLogsPath = path.join(projectPath, '.auto-claude', 'specs', specId, 'task_logs.json');
  const logsPath = existsSync(worktreeLogsPath) ? worktreeLogsPath : mainLogsPath;

  if (!existsSync(logsPath)) {
    return [];
  }

  try {
    const content = readFileSync(logsPath, 'utf-8');
    const taskLogs = JSON.parse(content);

    if (!taskLogs?.phases) {
      return [];
    }

    const allEntries: Array<{ timestamp: string; phase: string; content: string }> = [];

    // Collect entries from all phases
    for (const phase of ['planning', 'coding', 'validation'] as const) {
      const phaseLog = taskLogs.phases[phase];
      if (phaseLog?.entries) {
        for (const entry of phaseLog.entries) {
          if (entry.content && entry.timestamp) {
            allEntries.push({
              timestamp: entry.timestamp,
              phase,
              content: entry.content.substring(0, 100)  // Truncate long content
            });
          }
        }
      }
    }

    // Sort by timestamp descending and take last N
    return allEntries
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, count);
  } catch (error) {
    console.error(`[RDR] Failed to read task logs for ${specId}:`, error);
    return [];
  }
}

/**
 * Check session usage using the Usage Monitor (real-time API data).
 * Single threshold:
 *   - 100%: limited = true, warning = true (pause RDR + show orange timer until reset)
 */
function isSessionLimitReached(): { limited: boolean; warning: boolean; resetTime?: number; reason?: string } {
  const monitor = getUsageMonitor();
  const usage = monitor.getCurrentUsage();
  if (!usage) return { limited: false, warning: false };

  const sessionPct = usage.sessionPercent;
  const weeklyPct = usage.weeklyPercent;

  // Only trigger at 100%+ (pause RDR). No 80% warning tier — user explicitly removed it.
  if (sessionPct < 100 && weeklyPct < 100) return { limited: false, warning: false };

  // Use whichever limit is more constrained (higher %) as the binding constraint
  if (weeklyPct > sessionPct) {
    if (!usage.weeklyResetTimestamp) {
      // No real reset timestamp — stale cached data. Don't re-pause with fabricated timestamps.
      // Without a real timestamp, Date.now()+7d creates an infinite re-pause loop.
      console.log(`[RDR] isSessionLimitReached: no weeklyResetTimestamp — stale cache, not limited`);
      return { limited: false, warning: false };
    }
    const resetTime = new Date(usage.weeklyResetTimestamp).getTime();
    if (!Number.isFinite(resetTime) || resetTime <= Date.now()) {
      console.log(`[RDR] isSessionLimitReached: weekly reset time already passed (stale cache) — not limited`);
      return { limited: false, warning: false };
    }
    return {
      limited: weeklyPct >= 100,
      warning: true,
      resetTime,
      reason: `Weekly at ${weeklyPct}% (resets ${usage.weeklyResetTime || 'in ~7 days'})`
    };
  }

  if (!usage.sessionResetTimestamp) {
    // No real reset timestamp — stale cached data. Don't re-pause with fabricated timestamps.
    // Without a real timestamp, Date.now()+5h creates an infinite re-pause loop:
    // pause expires → isSessionLimitReached re-pauses with new Date.now()+5h → repeat forever.
    console.log(`[RDR] isSessionLimitReached: no sessionResetTimestamp — stale cache, not limited`);
    return { limited: false, warning: false };
  }
  const resetTime = new Date(usage.sessionResetTimestamp).getTime();
  if (!Number.isFinite(resetTime) || resetTime <= Date.now()) {
    console.log(`[RDR] isSessionLimitReached: session reset time already passed (stale cache) — not limited`);
    return { limited: false, warning: false };
  }
  return {
    limited: sessionPct >= 100,
    warning: true,
    resetTime,
    reason: `Session at ${sessionPct}% (resets ${usage.sessionResetTime || 'in ~5h'})`
  };
}

/**
 * Get current active phase from task_logs.json
 */
function getCurrentPhase(projectPath: string, specId: string): 'planning' | 'coding' | 'validation' | undefined {
  // Prefer worktree logs (has latest agent activity) over main
  const worktreeLogsPath = path.join(
    projectPath, '.auto-claude', 'worktrees', 'tasks', specId,
    '.auto-claude', 'specs', specId, 'task_logs.json'
  );
  const mainLogsPath = path.join(projectPath, '.auto-claude', 'specs', specId, 'task_logs.json');
  const logsPath = existsSync(worktreeLogsPath) ? worktreeLogsPath : mainLogsPath;

  if (!existsSync(logsPath)) {
    return undefined;
  }

  try {
    const content = readFileSync(logsPath, 'utf-8');
    const taskLogs = JSON.parse(content);

    if (!taskLogs?.phases) {
      return undefined;
    }

    // Find the active phase
    for (const phase of ['validation', 'coding', 'planning'] as const) {
      if (taskLogs.phases[phase]?.status === 'active') {
        return phase;
      }
    }

    // Find most recent started phase
    for (const phase of ['validation', 'coding', 'planning'] as const) {
      if (taskLogs.phases[phase]?.started_at) {
        return phase;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Gather rich task information for RDR messages
 * Includes progress, logs, errors, and intervention type
 */
function gatherRichTaskInfo(task: TaskInfo, projectPath: string): RichTaskInfo {
  // Calculate progress from subtasks/phases (handle both 'subtasks' and 'chunks' naming)
  const allSubtasks = task.phases?.flatMap(p => p.subtasks || (p as any).chunks || []) || task.subtasks || [];
  const completed = allSubtasks.filter(s => s.status === 'completed').length;
  const total = allSubtasks.length;

  // Find last completed subtask
  let lastSubtaskName: string | undefined;
  let lastSubtaskIndex: number | undefined;
  for (let i = allSubtasks.length - 1; i >= 0; i--) {
    if (allSubtasks[i].status === 'completed') {
      lastSubtaskName = (allSubtasks[i] as any).name || (allSubtasks[i] as any).description?.substring(0, 50);
      lastSubtaskIndex = i + 1;
      break;
    }
  }

  // Get intervention type (checks if agent IS running, not timestamp guessing)
  const worktreeDir = path.join(projectPath, '.auto-claude', 'worktrees', 'tasks', task.specId);
  const hasWorktree = existsSync(worktreeDir);
  const rawPlanStatus = getRawPlanStatus(projectPath, task.specId);
  const worktreeInfo = getWorktreeInfo(projectPath, task.specId);
  const wasStarted = wasTaskPreviouslyStarted(projectPath, task.specId);
  const interventionType = determineInterventionType(task, hasWorktree, rawPlanStatus, worktreeInfo, wasStarted, projectPath);

  // Get last logs
  const lastLogs = getLastLogEntries(projectPath, task.specId, 3);

  // Get current phase
  const currentPhase = getCurrentPhase(projectPath, task.specId);

  // Build error info if applicable
  let errors: RichTaskInfo['errors'];
  if (task.exitReason || task.reviewReason === 'errors' || task.reviewReason === 'qa_rejected') {
    errors = {
      exitReason: task.exitReason,
      reviewReason: task.reviewReason,
      errorSummary: task.reviewReason === 'qa_rejected'
        ? 'QA found issues with implementation'
        : task.exitReason || 'Task failed during execution'
    };
  }

  return {
    specId: task.specId,
    status: task.status,
    reviewReason: task.reviewReason,
    interventionType,
    progress: {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      lastSubtaskName,
      lastSubtaskIndex
    },
    currentPhase,
    lastLogs,
    errors
  };
}

/**
 * Attempt to fix common JSON errors in implementation_plan.json
 */
function attemptJsonFix(rawContent: string): string | null {
  try {
    // First, try parsing as-is
    JSON.parse(rawContent);
    return rawContent; // Already valid
  } catch {
    // Attempt fixes
    let fixed = rawContent;

    // Remove trailing commas before } or ]
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

    // Count braces and add missing ones
    const openBraces = (fixed.match(/{/g) || []).length;
    const closeBraces = (fixed.match(/}/g) || []).length;
    if (openBraces > closeBraces) {
      fixed += '}'.repeat(openBraces - closeBraces);
    }

    // Count brackets
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/]/g) || []).length;
    if (openBrackets > closeBrackets) {
      fixed += ']'.repeat(openBrackets - closeBrackets);
    }

    try {
      JSON.parse(fixed);
      return fixed;
    } catch {
      return null; // Could not fix
    }
  }
}

/**
 * Get all task info for multiple tasks from project store
 */
function getAllTaskInfo(projectId: string, taskIds: string[]): TaskInfo[] {
  const tasks = projectStore.getTasks(projectId);

  if (!tasks || tasks.length === 0) {
    return [];
  }

  return tasks
    .filter((t): t is typeof t & { specId: string } => taskIds.includes(t.specId) || taskIds.includes(t.id))
    .map(task => ({
      specId: task.specId,
      status: task.status,
      reviewReason: task.reviewReason,
      description: task.description,
      subtasks: task.subtasks,
      phases: task.phases,           // CRITICAL: Needed for calculateTaskProgress()
      exitReason: task.exitReason,   // Needed for recovery detection
      planStatus: task.planStatus,   // Needed for plan_review detection
      rdrDisabled: task.metadata?.rdrDisabled  // Respect per-task RDR opt-out
    }));
}

/**
 * Get implementation plan path for a task
 */
function getPlanPath(projectPath: string, specId: string): string {
  return path.join(projectPath, '.auto-claude', 'specs', specId, 'implementation_plan.json');
}

/**
 * Increment RDR attempt counter for tasks
 * Updates task_metadata.json with attempt count and timestamp
 */
function incrementRdrAttempts(projectPath: string, taskIds: string[]): void {
  const now = new Date().toISOString();

  for (const specId of taskIds) {
    try {
      const metadataPath = path.join(projectPath, '.auto-claude', 'specs', specId, 'task_metadata.json');
      let metadata: any = {};

      // Read existing metadata if it exists
      if (existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
        } catch (readErr) {
          console.warn(`[RDR] Failed to read metadata for ${specId}, starting fresh:`, readErr);
        }
      }

      // Increment attempts counter
      metadata.rdrAttempts = (metadata.rdrAttempts || 0) + 1;
      metadata.rdrLastAttempt = now;

      // Write back updated metadata
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      console.log(`[RDR] Incremented RDR attempts for ${specId} to ${metadata.rdrAttempts}`);
    } catch (error) {
      console.error(`[RDR] Failed to increment RDR attempts for ${specId}:`, error);
      // Continue with other tasks even if one fails
    }
  }
}

/**
 * Categorize tasks into batches by problem type
 */
export function categorizeTasks(tasks: TaskInfo[], projectPath?: string): RdrBatch[] {
  const batches: RdrBatch[] = [];

  // Filter out tasks with RDR disabled
  const rdrEnabledTasks = tasks.filter(t => !t.rdrDisabled);
  if (rdrEnabledTasks.length < tasks.length) {
    console.log(`[RDR] Skipping ${tasks.length - rdrEnabledTasks.length} tasks with RDR disabled`);
  }

  // Batch 1: JSON Errors (tasks with JSON parse error in description)
  const jsonErrors = rdrEnabledTasks.filter(t => t.description?.startsWith(JSON_ERROR_PREFIX));
  if (jsonErrors.length > 0) {
    batches.push({ type: 'json_error', taskIds: jsonErrors.map(t => t.specId), tasks: jsonErrors });
    console.log(`[RDR] Batch 1 - JSON Errors: ${jsonErrors.length} tasks`);
  }

  // Track which tasks are already categorized to avoid duplicates
  const categorized = new Set<string>(jsonErrors.map(t => t.specId));

  // Batch 2: Incomplete Tasks (has incomplete subtasks, NOT an error state)
  // Accepts ANY active status (human_review, in_progress, ai_review) - not just human_review
  // Uses both flat subtasks and phases.subtasks for detection
  const incomplete = rdrEnabledTasks.filter(t => {
    if (categorized.has(t.specId)) return false;
    if (t.description?.startsWith(JSON_ERROR_PREFIX)) return false;
    if (t.reviewReason === 'errors' || t.reviewReason === 'qa_rejected') return false;
    if (t.exitReason === 'error' || t.exitReason === 'auth_failure') return false;

    // Check flat subtasks (from project-store Task object)
    if (t.subtasks && t.subtasks.length > 0 && t.subtasks.some(s => s.status !== 'completed')) {
      return true;
    }

    // Check phases subtasks (from implementation_plan.json)
    const progress = calculateTaskProgress(t);
    if (t.phases && t.phases.length > 0 && progress < 100) {
      return true;
    }

    return false;
  });
  // Split incomplete tasks: active-board tasks (agent died mid-work) need P2 recovery,
  // others (human_review/backlog) just need P1 restart
  const incompleteP1 = incomplete.filter(t =>
    t.status !== 'in_progress' && t.status !== 'ai_review'
  );
  const incompleteP2 = incomplete.filter(t =>
    (t.status === 'in_progress' || t.status === 'ai_review') &&
    (!isTaskAgentRunning(t.specId) || isTaskAgentStalled(t.specId, t.updated_at))
  );

  // Mark ALL incomplete tasks as categorized (including running-agent gap between P1/P2)
  // to prevent re-evaluation in Batch 2c, 3, 4, or 5
  incomplete.forEach(t => categorized.add(t.specId));

  if (incompleteP1.length > 0) {
    batches.push({ type: 'incomplete', taskIds: incompleteP1.map(t => t.specId), tasks: incompleteP1 });
    console.log(`[RDR] Batch 2a - Incomplete (P1 restart): ${incompleteP1.length} tasks`);
  }
  if (incompleteP2.length > 0) {
    batches.push({ type: 'recovery', taskIds: incompleteP2.map(t => t.specId), tasks: incompleteP2 });
    console.log(`[RDR] Batch 2b - Incomplete (P2 recovery): ${incompleteP2.length} tasks`);
  }

  // Batch 2c: Complete tasks stuck on active boards (agent died after finishing work)
  // These are 100% complete but never transitioned to human_review
  const completeStalledOnActiveBoard = rdrEnabledTasks.filter(t => {
    if (categorized.has(t.specId)) return false;
    if (t.description?.startsWith(JSON_ERROR_PREFIX)) return false;
    if (t.reviewReason === 'errors' || t.reviewReason === 'qa_rejected' || t.reviewReason === 'stopped') return false;
    if (t.exitReason === 'error' || t.exitReason === 'auth_failure') return false;
    if (t.status !== 'in_progress' && t.status !== 'ai_review') return false;
    if (isTaskAgentRunning(t.specId) && !isTaskAgentStalled(t.specId, t.updated_at)) return false;

    // Both progress sources must agree when both are available
    const progress = calculateTaskProgress(t);
    const allSubtasksDone = t.subtasks && t.subtasks.length > 0 && t.subtasks.every(s => s.status === 'completed');
    const hasSubtasks = t.subtasks && t.subtasks.length > 0;
    const hasPhases = t.phases && t.phases.length > 0;
    if (hasSubtasks && hasPhases) {
      return progress === 100 && allSubtasksDone;
    }
    return progress === 100 || allSubtasksDone;
  });
  if (completeStalledOnActiveBoard.length > 0) {
    batches.push({ type: 'recovery', taskIds: completeStalledOnActiveBoard.map(t => t.specId), tasks: completeStalledOnActiveBoard });
    completeStalledOnActiveBoard.forEach(t => categorized.add(t.specId));
    console.log(`[RDR] Batch 2c - Complete but stalled on active board (P2 recovery): ${completeStalledOnActiveBoard.length} tasks`);
  }

  // Batch 2d: Tasks on active boards with dead agents and no progress
  // Agent started and died before producing any subtasks/phases (e.g., bad file paths in spec)
  const deadAgentNoProgress = rdrEnabledTasks.filter(t => {
    if (categorized.has(t.specId)) return false;
    if (t.description?.startsWith(JSON_ERROR_PREFIX)) return false;
    if (t.reviewReason === 'errors' || t.reviewReason === 'qa_rejected' || t.reviewReason === 'stopped') return false;
    if (t.exitReason === 'error' || t.exitReason === 'auth_failure') return false;
    if (t.status !== 'in_progress' && t.status !== 'ai_review') return false;
    if (isTaskAgentRunning(t.specId)) return false; // Agent must be dead

    // No subtasks AND no meaningful phases = agent died before doing anything
    const hasSubtasks = t.subtasks && t.subtasks.length > 0;
    const hasPhases = t.phases && t.phases.length > 0 && t.phases.some((p: any) => p.status !== 'pending');
    return !hasSubtasks && !hasPhases;
  });
  if (deadAgentNoProgress.length > 0) {
    batches.push({ type: 'recovery', taskIds: deadAgentNoProgress.map(t => t.specId), tasks: deadAgentNoProgress });
    deadAgentNoProgress.forEach(t => categorized.add(t.specId));
    console.log(`[RDR] Batch 2d - Dead agent, no progress (P2 recovery): ${deadAgentNoProgress.length} tasks`);
  }

  // Batch 3: QA Rejected
  const qaRejected = rdrEnabledTasks.filter(t =>
    !categorized.has(t.specId) &&
    t.reviewReason === 'qa_rejected' &&
    !t.description?.startsWith(JSON_ERROR_PREFIX)
  );
  if (qaRejected.length > 0) {
    batches.push({ type: 'qa_rejected', taskIds: qaRejected.map(t => t.specId), tasks: qaRejected });
    qaRejected.forEach(t => categorized.add(t.specId));
    console.log(`[RDR] Batch 3 - QA Rejected: ${qaRejected.length} tasks`);
  }

  // Batch 4: Errors (reviewReason=errors OR exitReason=error/auth_failure)
  const errors = rdrEnabledTasks.filter(t =>
    !categorized.has(t.specId) &&
    !t.description?.startsWith(JSON_ERROR_PREFIX) &&
    (t.reviewReason === 'errors' || t.exitReason === 'error' || t.exitReason === 'auth_failure')
  );
  if (errors.length > 0) {
    batches.push({ type: 'errors', taskIds: errors.map(t => t.specId), tasks: errors });
    errors.forEach(t => categorized.add(t.specId));
    console.log(`[RDR] Batch 4 - Errors: ${errors.length} tasks`);
  }

  // Batch 5: Catch-all for tasks that need intervention but don't fit above categories
  // (e.g., empty plans with 0 phases, tasks in active status with no subtasks)
  const uncategorized = rdrEnabledTasks.filter(t => {
    if (categorized.has(t.specId)) return false;
    // Pass full worktreeInfo so determineInterventionType can check worktree status
    const wtInfo = projectPath ? getWorktreeInfo(projectPath, t.specId) : undefined;
    const hasWt = Boolean(wtInfo?.status);
    const rawStatus = projectPath ? getRawPlanStatus(projectPath, t.specId) : undefined;
    const wasStarted = projectPath ? wasTaskPreviouslyStarted(projectPath, t.specId) : false;
    const intervention = determineInterventionType(t, hasWt, rawStatus, wtInfo, wasStarted, projectPath);
    return intervention !== null;
  });
  if (uncategorized.length > 0) {
    batches.push({ type: 'errors', taskIds: uncategorized.map(t => t.specId), tasks: uncategorized });
    console.log(`[RDR] Batch 5 - Uncategorized (needs recovery): ${uncategorized.length} tasks`);
  }

  return batches;
}

/**
 * Submit "Request Changes" for a task (auto-resume with feedback)
 * This writes QA_FIX_REQUEST.md and sets status to start_requested
 */
async function submitRequestChanges(
  projectPath: string,
  taskId: string,
  feedback: string
): Promise<RdrProcessResult> {
  try {
    const specDir = path.join(projectPath, '.auto-claude', 'specs', taskId);
    const fixRequestPath = path.join(specDir, 'QA_FIX_REQUEST.md');
    const planPath = path.join(specDir, 'implementation_plan.json');

    if (!existsSync(specDir)) {
      return { taskId, action: 'error', error: 'Spec directory not found' };
    }

    // Write fix request file
    const content = `# Fix Request (RDR Auto-Generated)

${feedback}

---
Generated at: ${new Date().toISOString()}
Source: RDR Auto-Recovery System
`;
    writeFileSync(fixRequestPath, content);
    console.log(`[RDR] Wrote fix request to ${fixRequestPath}`);

    // Update implementation_plan.json to trigger restart
    if (existsSync(planPath)) {
      const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
      plan.status = 'start_requested';
      plan.start_requested_at = new Date().toISOString();
      plan.rdr_feedback = feedback;
      plan.rdr_iteration = (plan.rdr_iteration || 0) + 1;
      writeFileSync(planPath, JSON.stringify(plan, null, 2));
      console.log(`[RDR] Set status=start_requested for task ${taskId}`);
    }

    return { taskId, action: 'fix_submitted', reason: feedback };
  } catch (error) {
    console.error(`[RDR] Failed to submit fix request for ${taskId}:`, error);
    return { taskId, action: 'error', error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Process JSON error batch - auto-fix JSON files
 */
async function processJsonErrorBatch(
  batch: RdrBatch,
  projectPath: string,
  mainWindow: BrowserWindow | null,
  projectId: string
): Promise<RdrProcessResult[]> {
  const results: RdrProcessResult[] = [];

  for (const task of batch.tasks) {
    const planPath = getPlanPath(projectPath, task.specId);

    if (existsSync(planPath)) {
      const rawContent = readFileSync(planPath, 'utf-8');
      const fixedContent = attemptJsonFix(rawContent);

      if (fixedContent && fixedContent !== rawContent) {
        writeFileSync(planPath, fixedContent);
        console.log(`[RDR] Fixed JSON for task ${task.specId}`);

        // Notify renderer to refresh task list
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.TASK_LIST_REFRESH, projectId);
        }

        results.push({ taskId: task.specId, action: 'json_fixed' });
      } else if (!fixedContent) {
        results.push({ taskId: task.specId, action: 'json_unfixable', reason: 'Could not auto-fix JSON structure' });
      } else {
        results.push({ taskId: task.specId, action: 'json_fixed', reason: 'JSON was already valid' });
      }
    } else {
      results.push({ taskId: task.specId, action: 'json_unfixable', reason: 'Plan file not found' });
    }
  }

  return results;
}

/**
 * Process incomplete tasks batch - auto-submit Request Changes to resume
 */
async function processIncompleteBatch(
  batch: RdrBatch,
  projectPath: string,
  mainWindow: BrowserWindow | null,
  projectId: string
): Promise<RdrProcessResult[]> {
  const results: RdrProcessResult[] = [];

  for (const task of batch.tasks) {
    // Use phases-based calculation (same as auto-shutdown) instead of flat subtasks
    const allSubtasks = task.phases?.flatMap(p => p.subtasks || (p as any).chunks || []) || task.subtasks || [];
    const completedCount = allSubtasks.filter((s: any) => s.status === 'completed').length;
    const totalCount = allSubtasks.length;
    const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const feedback = `## Resume Task (RDR Auto-Recovery)

**Progress:** ${completedCount}/${totalCount} subtasks completed (${percentage}%)

**Action Required:** Continue implementation from where it stopped. Complete the remaining ${totalCount - completedCount} subtasks.

**Note:** This task was automatically resumed by the RDR system because it had incomplete subtasks.`;

    const result = await submitRequestChanges(projectPath, task.specId, feedback);
    results.push(result);

    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.RDR_TASK_PROCESSED, {
        projectId,
        taskId: task.specId,
        result
      });
    }
  }

  return results;
}

/**
 * Process QA rejected / error batches - queue for MCP/Claude Code analysis
 * Writes a signal file that Claude Code can pick up via the get_rdr_batches MCP tool
 */
async function processMcpBatch(
  batch: RdrBatch,
  projectPath: string,
  mainWindow: BrowserWindow | null,
  projectId: string,
  allMcpBatches?: RdrBatch[]
): Promise<RdrProcessResult[]> {
  const results: RdrProcessResult[] = [];

  // These batches need intelligent analysis
  console.log(`[RDR] Batch type=${batch.type} queued for MCP/Claude Code analysis: ${batch.taskIds.length} tasks`);

  // Write signal file for Claude Code to pick up
  // If allMcpBatches is provided, write all of them (batched call)
  // Otherwise, write just this batch (individual call)
  const batchesToWrite = allMcpBatches || [batch];
  writeRdrSignalFile(projectPath, projectId, batchesToWrite);

  // Emit event for renderer notification
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.RDR_BATCH_READY, {
      projectId,
      batchType: batch.type,
      taskIds: batch.taskIds,
      taskCount: batch.tasks.length,
      signalWritten: true,
      tasks: batch.tasks.map(t => ({
        specId: t.specId,
        reviewReason: t.reviewReason,
        description: t.description?.substring(0, 200),
        subtasksTotal: t.subtasks?.length || 0,
        subtasksCompleted: t.subtasks?.filter(s => s.status === 'completed').length || 0
      }))
    });
  }

  for (const task of batch.tasks) {
    results.push({
      taskId: task.specId,
      action: 'no_action',
      reason: `Queued for Claude Code analysis via MCP (batch: ${batch.type}). Signal file written.`
    });
  }

  return results;
}

// ============================================================================
// Timer-Based Batching Functions
// ============================================================================

/**
 * Get intervention type label for display
 */
function getInterventionTypeLabel(type: InterventionType | null): string {
  switch (type) {
    case 'recovery': return 'RECOVERY';
    case 'resume': return 'RESUME';
    case 'stuck': return 'STUCK';
    case 'incomplete': return 'INCOMPLETE';
    default: return 'UNKNOWN';
  }
}

/**
 * Derive which Kanban board a task belongs to based on enriched status and phase.
 * Status (from worktree enrichment) is most reliable; currentPhase is fallback.
 */
function getTaskBoard(status: string, currentPhase?: string): string {
  if (status === 'in_progress' || status === 'coding') return 'In Progress';
  if (status === 'ai_review' || status === 'qa_approved' || status === 'completed') return 'AI Review';
  if (status === 'human_review') return 'Human Review';
  if (status === 'planning') return 'Planning';
  // Fallback: derive from currentPhase in task_logs.json
  if (currentPhase === 'coding') return 'In Progress';
  if (currentPhase === 'validation') return 'AI Review';
  if (currentPhase === 'planning') return 'Planning';
  return 'Unknown';
}

/**
 * Generate a prompt for Claude Code to analyze the batch
 * Enhanced with rich task info including intervention type, progress, and logs
 */
function generateBatchPrompt(batches: RdrBatch[], projectId: string, projectPath: string): string {
  const lines: string[] = [
    '/auto-claude-rdr',
    '',
    `**PROJECT_ID:** ${projectId}`,
    `**PROJECT_PATH:** ${projectPath}`,
    '',
    '# [AUTO-CLAUDE RDR] Recovery Manager Role',
    '',
    '**YOU ARE THE CLAUDE MANAGER** for the Auto-Claude autonomous coding system.',
    '**YOUR ROLE:** Recover stuck tasks using ONLY MCP tools, NOT manual fixes.',
    '',
    `**Timestamp:** ${new Date().toISOString()}`,
    `**Total Batches:** ${batches.length}`,
    '',
    '## CRITICAL: Priority System',
    '',
    '**P1 (AUTO-CONTINUE):** Restart tasks via `process_rdr_batch`',
    '- For errors, incomplete, qa_rejected batches on human_review/backlog',
    '',
    '**P2 (RECOVERY):** Recover stuck tasks via `recover_stuck_task`',
    '- For tasks on in_progress/ai_review with dead agents',
    '- Agent died mid-work, needs recovery context to resume',
    '',
    '**P3 (FIX):** Auto-fix JSON errors via `process_rdr_batch`',
    '',
    '**P4 (MANUAL - RARE):** Last resort only',
    '',
    '## ⚠️ STRICT RULES',
    '',
    '1. **ONLY USE** MCP tool: `mcp__auto-claude-manager__process_rdr_batch`',
    '2. **DO NOT** read files (no Read, Grep, Glob)',
    '3. **DO NOT** edit files (no Edit, Write)',
    '4. **DO NOT** try to fix manually',
    '5. **CALL MCP TOOL IMMEDIATELY** - One call per batch type',
    '',
    '## Tasks Detected',
    ''
  ];

  // Enhanced task details with rich info
  for (const batch of batches) {
    lines.push(`### ${batch.type.toUpperCase()}: ${batch.taskIds.length} tasks`);
    lines.push('');

    for (const task of batch.tasks) {
      // Gather rich info for this task
      const richInfo = gatherRichTaskInfo(task, projectPath);
      const typeLabel = getInterventionTypeLabel(richInfo.interventionType);

      lines.push(`#### ${task.specId}`);
      lines.push(`**Status:** ${task.status} | **Reason:** ${task.reviewReason || 'none'} | **Type:** ${typeLabel}`);
      lines.push(`**Progress:** ${richInfo.progress.completed}/${richInfo.progress.total} subtasks (${richInfo.progress.percentage}%)`);

      if (richInfo.currentPhase) {
        lines.push(`**Current Phase:** ${richInfo.currentPhase}`);
      }

      if (richInfo.progress.lastSubtaskName) {
        lines.push(`**Last Subtask:** #${richInfo.progress.lastSubtaskIndex} - ${richInfo.progress.lastSubtaskName}`);
      }

      // Show last logs if available
      if (richInfo.lastLogs.length > 0) {
        lines.push('');
        lines.push('**Recent Activity:**');
        for (const log of richInfo.lastLogs) {
          const time = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });
          lines.push(`- [${time}] (${log.phase}) ${log.content}`);
        }
      }

      // Show errors if applicable
      if (richInfo.errors) {
        lines.push('');
        lines.push('**Errors:**');
        if (richInfo.errors.exitReason) {
          lines.push(`- Exit Reason: ${richInfo.errors.exitReason}`);
        }
        if (richInfo.errors.errorSummary) {
          lines.push(`- Summary: ${richInfo.errors.errorSummary}`);
        }
      }

      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  lines.push('## IMMEDIATE ACTION');
  lines.push('');
  lines.push('Call MCP tools NOW for EACH batch:');
  lines.push('');
  for (const batch of batches) {
    if (batch.type === 'recovery') {
      // P2: Use recover_stuck_task for stuck active-board tasks (agent died mid-work)
      lines.push(`  // P2 RECOVERY: Agent died on active board — use recover_stuck_task`);
      for (const taskId of batch.taskIds) {
        lines.push(`  mcp__auto-claude-manager__recover_stuck_task({`);
        lines.push(`    projectId: "${projectId}",`);
        lines.push(`    projectPath: "${projectPath}",`);
        lines.push(`    taskId: "${taskId}",`);
        lines.push(`    autoRestart: true`);
        lines.push(`  })`);
        lines.push('');
      }
    } else {
      // P1: Use process_rdr_batch for restart/fix
      lines.push(`  mcp__auto-claude-manager__process_rdr_batch({`);
      lines.push(`    projectId: "${projectId}",`);
      lines.push(`    projectPath: "${projectPath}",`);
      lines.push(`    batchType: "${batch.type}",`);
      lines.push(`    fixes: [${batch.taskIds.map(id => `{ taskId: "${id}" }`).join(', ')}]`);
      lines.push(`  })`);
    }
    lines.push('');
  }
  lines.push('**REMEMBER:** Call MCP tool ONLY. NO manual fixes. System auto-recovers.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Write signal file for Claude Code to pick up via MCP
 * Enhanced with rich task info including intervention type, progress, and logs
 */
function writeRdrSignalFile(
  projectPath: string,
  projectId: string,
  batches: RdrBatch[]
): void {
  const signalDir = path.join(projectPath, '.auto-claude');
  const signalPath = path.join(signalDir, 'rdr-pending.json');

  const signal = {
    timestamp: new Date().toISOString(),
    projectId,
    batches: batches.map(b => ({
      type: b.type,
      taskCount: b.taskIds.length,
      taskIds: b.taskIds,
      tasks: b.tasks.map(t => {
        // Gather rich info for each task
        const richInfo = gatherRichTaskInfo(t, projectPath);
        return {
          specId: t.specId,
          description: t.description?.substring(0, 200),
          status: t.status,
          reviewReason: t.reviewReason,
          exitReason: t.exitReason,
          interventionType: richInfo.interventionType,
          progress: richInfo.progress,
          currentPhase: richInfo.currentPhase,
          lastLogs: richInfo.lastLogs,
          errors: richInfo.errors
        };
      })
    })),
    prompt: generateBatchPrompt(batches, projectId, projectPath)
  };

  writeFileSync(signalPath, JSON.stringify(signal, null, 2));
  console.log(`[RDR] Wrote signal file: ${signalPath}`);
  console.log(`[RDR] Signal contains ${batches.length} batches with ${batches.reduce((sum, b) => sum + b.taskIds.length, 0)} total tasks`);
}

/**
 * Read and clear the RDR signal file if it exists
 * Returns the signal data or null if no file exists
 * Enhanced with rich task info including intervention type, progress, and logs
 */
export function readAndClearSignalFile(projectPath: string): {
  timestamp: string;
  projectId: string;
  batches: Array<{
    type: string;
    taskCount: number;
    taskIds: string[];
    tasks: Array<{
      specId: string;
      description?: string;
      status?: string;
      reviewReason?: string;
      exitReason?: string;
      interventionType?: InterventionType | null;
      progress?: {
        completed: number;
        total: number;
        percentage: number;
        lastSubtaskName?: string;
        lastSubtaskIndex?: number;
      };
      currentPhase?: 'planning' | 'coding' | 'validation';
      lastLogs?: Array<{
        timestamp: string;
        phase: string;
        content: string;
      }>;
      errors?: {
        exitReason?: string;
        reviewReason?: string;
        errorSummary?: string;
      };
      // Legacy fields for backwards compatibility
      subtasksCompleted?: number;
      subtasksTotal?: number;
    }>;
  }>;
  prompt: string;
} | null {
  const signalPath = path.join(projectPath, '.auto-claude', 'rdr-pending.json');

  if (!existsSync(signalPath)) {
    return null;
  }

  try {
    const content = readFileSync(signalPath, 'utf-8');
    const signal = JSON.parse(content);

    // Clear signal file after reading
    unlinkSync(signalPath);
    console.log(`[RDR] Read and cleared signal file: ${signalPath}`);

    return signal;
  } catch (error) {
    console.error(`[RDR] Failed to read signal file:`, error);
    return null;
  }
}

/**
 * Queue a task for RDR processing with timer-based batching
 * Tasks are collected for BATCH_COLLECTION_WINDOW_MS before processing
 */
export function queueTaskForRdr(projectId: string, task: TaskInfo): void {
  console.log(`[RDR] Queuing task ${task.specId} for batched processing`);

  // Add to pending tasks
  pendingTasks.push({ projectId, task });

  // Start or reset timer
  if (batchTimer) {
    clearTimeout(batchTimer);
  }

  batchTimer = setTimeout(async () => {
    await processPendingTasks();
  }, BATCH_COLLECTION_WINDOW_MS);

  console.log(`[RDR] Timer set - will process ${pendingTasks.length} tasks in ${BATCH_COLLECTION_WINDOW_MS}ms`);
}

/**
 * Check if Claude Code is currently busy
 * Returns true if Claude is at prompt, processing, or session is active
 *
 * IMPORTANT: MCP Monitor is checked FIRST because it definitively tracks the
 * user's Claude Code session. OutputMonitor scans ALL ~/.claude/projects/ JSONL
 * files and cannot distinguish user sessions from task agent sessions. When MCP
 * says idle but OutputMonitor says PROCESSING, the PROCESSING is likely from a
 * task agent running in a worktree - not the user's session.
 */
async function checkClaudeCodeBusy(): Promise<boolean> {
  try {
    console.log('[RDR] Checking if Claude Code is busy...');

    // 0. CHECK RATE LIMIT PAUSE (highest priority)
    if (isRdrPaused()) {
      const remainingMin = Math.ceil((rdrPauseState.rateLimitResetAt - Date.now()) / 60_000);
      console.log(`[RDR] BLOCKED: RDR paused — rate limit active (resets in ${remainingMin}min)`);
      return true;
    }

    // 1. PRIMARY: Check MCP connection (definitive for user's Claude Code)
    // MCP Monitor only tracks user's Claude Code -> Auto-Claude MCP server connection
    // Task agents do NOT connect to this MCP server
    let mcpAvailable = false;
    if (process.platform === 'win32') {
      try {
        const { mcpMonitor } = await import('../mcp-server');
        if (mcpMonitor) {
          mcpAvailable = true;
          if (mcpMonitor.isBusy()) {
            console.log('[RDR] BUSY: User Claude Code is actively calling MCP tools');
            const status = mcpMonitor.getStatus();
            console.log('[RDR]   MCP Status:', {
              activeToolName: status.activeToolName,
              timeSinceLastRequest: `${status.timeSinceLastRequest}ms`
            });
            return true;
          }
          console.log('[RDR] MCP Monitor: No active connections');
        }
      } catch (error) {
        console.warn('[RDR] MCP monitor check skipped:', error);
      }
    }

    // 2. SECONDARY: Check OutputMonitor
    // CAUTION: OutputMonitor scans ALL ~/.claude/projects/ JSONL files
    // It cannot distinguish user sessions from task agent sessions
    if (outputMonitor) {
      await outputMonitor.isAtPrompt();
      const state = outputMonitor.getCurrentState();

      if (state === 'PROCESSING') {
        if (mcpAvailable) {
          // MCP says idle but OutputMonitor says busy
          // This likely means a task agent is running, not the user's session
          console.log('[RDR] OutputMonitor says PROCESSING but MCP is idle');
          console.log('[RDR] Likely task agent activity (not user session) - proceeding with RDR');
          // Fall through - don't block
        } else {
          // No MCP monitor available - OutputMonitor is our only source
          // Trust it to avoid interrupting the user
          console.log('[RDR] BUSY: OutputMonitor says PROCESSING (no MCP to verify)');
          return true;
        }
      } else if (state === 'AT_PROMPT') {
        console.log('[RDR] OutputMonitor: AT_PROMPT (waiting for input - OK for RDR)');
      } else {
        console.log('[RDR] OutputMonitor: IDLE - proceeding with RDR');
      }
    } else {
      console.warn('[RDR] Output Monitor not available');
    }

    // All checks passed - Claude is truly idle
    console.log('[RDR] ALL CHECKS PASSED: Claude Code is IDLE (safe to send)');
    return false;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[RDR] ERROR: Failed to check busy state:', errorMessage);
    // FAIL SAFE: Assume busy on error to prevent interrupting ongoing work
    return true;
  }
}

/**
 * Process all collected pending tasks after timer expires
 * @param skipBusyCheck - If true, skip the busy check (used when triggered by idle event)
 */
async function processPendingTasks(skipBusyCheck: boolean = false): Promise<void> {
  if (pendingTasks.length === 0) {
    console.log(`[RDR] No pending tasks to process`);
    return;
  }

  console.log(`[RDR] Processing ${pendingTasks.length} pending tasks (skipBusyCheck=${skipBusyCheck})`);

  // CRITICAL: Check if Claude Code is busy before processing
  // Skip this check when triggered by idle event - we KNOW it's idle
  if (!skipBusyCheck) {
    const isBusy = await checkClaudeCodeBusy();
    if (isBusy) {
      console.log(`[RDR] ⏸️  Claude Code is BUSY - rescheduling ${pendingTasks.length} tasks for 60s later`);
      console.log(`[RDR]    ⏰ Next retry at: ${new Date(Date.now() + 60000).toISOString()}`);

      // Reschedule for later (retry in 60 seconds)
      if (batchTimer) {
        clearTimeout(batchTimer);
      }
      batchTimer = setTimeout(async () => {
        console.log('[RDR] ⏰ RETRY: Attempting to process pending tasks again...');
        await processPendingTasks();
      }, 60000); // Retry in 60 seconds
      return;
    }
  } else {
    console.log(`[RDR] ✅ Triggered by idle event - skipping busy check`);
  }

  console.log(`[RDR] ✅ Claude is IDLE - proceeding to process ${pendingTasks.length} tasks`);

  // Group tasks by project
  const tasksByProject = new Map<string, TaskInfo[]>();
  for (const { projectId, task } of pendingTasks) {
    const existing = tasksByProject.get(projectId) || [];
    existing.push(task);
    tasksByProject.set(projectId, existing);
  }

  // Clear pending tasks and timer
  pendingTasks = [];
  batchTimer = null;

  // Process each project's tasks
  for (const [projectId, tasks] of tasksByProject) {
    const project = projectStore.getProject(projectId);
    if (!project) {
      console.error(`[RDR] Project not found: ${projectId}`);
      continue;
    }

    const mainWindow = BrowserWindow.getAllWindows()[0] || null;

    // Categorize tasks into batches
    const batches = categorizeTasks(tasks, project.path);
    console.log(`[RDR] Categorized ${tasks.length} tasks into ${batches.length} batches for project ${projectId}`);

    // Check usage monitor for session limit BEFORE processing
    const rateLimitCheck = isSessionLimitReached();
    if (rateLimitCheck.limited && rateLimitCheck.resetTime) {
      console.log(`[RDR] Session limit reached (${rateLimitCheck.reason}) — pausing RDR`);
      pauseRdr(rateLimitCheck.reason || 'Session limit reached', rateLimitCheck.resetTime);
      continue; // Skip this project — rate limited
    } else if (rateLimitCheck.warning && rateLimitCheck.resetTime) {
      warnRdr(rateLimitCheck.reason || 'Session usage high', rateLimitCheck.resetTime);
      // Don't skip — RDR keeps sending at 80-99%
    }

    // Increment RDR attempt counter for all tasks being processed
    const allTaskIds = batches.flatMap(b => b.taskIds);
    if (allTaskIds.length > 0) {
      incrementRdrAttempts(project.path, allTaskIds);
    }

    // Process auto-fixable batches immediately
    for (const batch of batches) {
      if (batch.type === 'json_error') {
        await processJsonErrorBatch(batch, project.path, mainWindow, projectId);
      } else if (batch.type === 'incomplete') {
        await processIncompleteBatch(batch, project.path, mainWindow, projectId);
      }
    }

    // Write signal file for batches needing Claude Code analysis
    const mcpBatches = batches.filter(b => b.type === 'qa_rejected' || b.type === 'errors' || b.type === 'recovery');
    if (mcpBatches.length > 0) {
      writeRdrSignalFile(project.path, projectId, mcpBatches);

      // Also emit event for renderer (optional, signal file is the main mechanism)
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.RDR_BATCH_READY, {
          projectId,
          batchCount: mcpBatches.length,
          taskCount: mcpBatches.reduce((sum, b) => sum + b.taskIds.length, 0),
          signalWritten: true
        });
      }
    }

    console.log(`[RDR] Completed batch processing for project ${projectId}`);
  }
}

/**
 * Immediately process all pending tasks (bypass timer)
 * Useful for testing or when user wants immediate processing
 */
export async function flushPendingTasks(): Promise<void> {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  await processPendingTasks();
}

/**
 * Get the current number of pending tasks
 */
export function getPendingTaskCount(): number {
  return pendingTasks.length;
}

// ============================================================================
// Event-Driven RDR Processing
// ============================================================================

/**
 * Set up event-driven RDR processing
 * Subscribes to OutputMonitor's 'idle' event to trigger processing immediately
 * when Claude Code finishes its current work, instead of waiting for fixed timers
 */
async function setupEventDrivenProcessing(): Promise<void> {
  if (eventDrivenEnabled) {
    console.log('[RDR] Event-driven processing already enabled');
    return;
  }

  try {
    // Start file watching in OutputMonitor
    await outputMonitor.startWatching();

    // Subscribe to 'idle' event - triggers when Claude Code becomes idle
    idleEventListener = async (event: any) => {
      console.log(`[RDR] 🚀 EVENT: Claude Code became idle`);
      console.log(`[RDR]    📊 State change: ${event.from} -> ${event.to}`);

      // Notify renderer to trigger RDR check (sequential batching)
      try {
        const allWindows = BrowserWindow?.getAllWindows() || [];
        for (const win of allWindows) {
          if (!win.isDestroyed()) {
            win.webContents.send('claude-code-idle', {
              from: event.from,
              to: event.to,
              timestamp: event.timestamp || Date.now()
            });
          }
        }
        console.log('[RDR]    📤 Notified renderer of idle state - triggering next RDR check');
      } catch (error) {
        console.error('[RDR]    ❌ Failed to notify renderer:', error);
      }

      // Also process pending tasks if any (backend processing)
      if (pendingTasks.length > 0) {
        console.log(`[RDR]    🔄 Processing ${pendingTasks.length} pending tasks immediately`);

        // Cancel any pending timer - we'll process immediately
        if (batchTimer) {
          clearTimeout(batchTimer);
          batchTimer = null;
          console.log('[RDR]       ⏰ Cancelled pending timer - using event-driven processing');
        }

        // Small delay to ensure state is stable (prevents rapid re-triggering)
        await new Promise(resolve => setTimeout(resolve, 500));

        // Process pending tasks immediately - skip busy check since we KNOW it's idle
        // The idle event already confirmed Claude is idle, no need to re-check with grace period
        await processPendingTasks(true);
      }
    };

    outputMonitor.on('idle', idleEventListener);
    eventDrivenEnabled = true;

    console.log('[RDR] ✅ Event-driven processing enabled - RDR will trigger immediately when Claude Code becomes idle');
    console.log('[RDR]    📡 Subscribed to OutputMonitor "idle" events');
  } catch (error) {
    console.error('[RDR] ❌ Failed to enable event-driven processing:', error);
    console.log('[RDR]    ⏰ Falling back to timer-based processing');
  }
}

/**
 * Disable event-driven processing (cleanup)
 */
export function disableEventDrivenProcessing(): void {
  if (!eventDrivenEnabled) return;

  if (idleEventListener) {
    outputMonitor.removeListener('idle', idleEventListener);
    idleEventListener = null;
  }

  outputMonitor.stopWatching();
  eventDrivenEnabled = false;
  console.log('[RDR] Event-driven processing disabled');
}

// ============================================================================
// IPC Handlers
// ============================================================================

// Track whether event-driven processing is enabled
let eventDrivenEnabled = false;
let idleEventListener: ((event: any) => void) | null = null;

/**
 * Register RDR IPC handlers
 */
export function registerRdrHandlers(agentManager?: AgentManager): void {
  agentManagerRef = agentManager || null;
  if (!isElectron || !ipcMain) {
    console.log('[RDR] Skipping handler registration (not in Electron context)');
    return;
  }

  console.log('[RDR] Registering RDR handlers');

  // Start event-driven RDR processing
  setupEventDrivenProcessing();

  // Schedule a startup RDR check — don't rely solely on idle events.
  // After 45s (enough for file watcher and agents to initialize), notify renderer
  // to trigger an RDR scan regardless of OutputMonitor state.
  setTimeout(() => {
    if (rdrPauseState.paused) {
      console.log('[RDR] Startup check skipped — RDR is paused');
      return;
    }
    console.log('[RDR] ⏰ Startup RDR check — notifying renderer to scan for stuck tasks');
    try {
      const allWindows = BrowserWindow?.getAllWindows() || [];
      for (const win of allWindows) {
        if (!win.isDestroyed()) {
          win.webContents.send('claude-code-idle', {
            from: 'startup',
            to: 'startup-check',
            timestamp: Date.now()
          });
        }
      }
    } catch (err) {
      console.error('[RDR] Startup check failed:', err);
    }
  }, 45_000);

  // Renderer queries current RDR pause state (e.g. on mount)
  ipcMain.handle(IPC_CHANNELS.RDR_GET_COOLDOWN_STATUS, () => {
    return {
      success: true,
      data: {
        paused: rdrPauseState.paused,
        warning: rdrPauseState.warning,
        reason: rdrPauseState.reason,
        rateLimitResetAt: rdrPauseState.rateLimitResetAt,
      },
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.TRIGGER_RDR_PROCESSING,
    async (event, projectId: string, taskIds: string[]): Promise<IPCResult<RdrProcessingSummary>> => {
      console.log(`[RDR] Manual trigger - queueing ${taskIds.length} tasks for project ${projectId}`);

      // Get project path
      const project = projectStore.getProject(projectId);

      if (!project) {
        return {
          success: false,
          error: 'Project not found'
        };
      }

      // Get all task info
      const tasks = getAllTaskInfo(projectId, taskIds);
      if (tasks.length === 0) {
        return {
          success: false,
          error: 'No tasks found'
        };
      }

      // CRITICAL FIX: Queue tasks instead of processing immediately
      // This allows retry when Claude becomes idle
      console.log(`[RDR] Queueing ${tasks.length} tasks for batched processing with busy detection`);
      for (const task of tasks) {
        queueTaskForRdr(projectId, task);
      }

      // Check if Claude Code is busy
      const isBusy = await checkClaudeCodeBusy();
      if (isBusy) {
        console.log(`[RDR] ⏸️  Claude Code is BUSY - tasks queued and will be processed when idle`);
        return {
          success: true,
          data: {
            processed: 0,
            jsonFixed: 0,
            fixSubmitted: 0,
            queuedForMcp: tasks.length,
            batches: [{ type: 'queued', count: tasks.length }],
            message: `Tasks queued - will be processed when Claude Code is idle (currently ${isBusy ? 'busy' : 'idle'})`
          }
        };
      }

      // If Claude is idle, processPendingTasks will be called by the timer
      console.log(`[RDR] ✅ Claude is IDLE - timer will process tasks in ${BATCH_COLLECTION_WINDOW_MS}ms`);

      return {
        success: true,
        data: {
          processed: 0,
          jsonFixed: 0,
          fixSubmitted: 0,
          queuedForMcp: tasks.length,
          batches: [{ type: 'queued', count: tasks.length }],
          message: `Tasks queued for processing in ${BATCH_COLLECTION_WINDOW_MS}ms`
        }
      };
    }
  );

  // Immediate RDR ping - writes signal file NOW (no 30s timer)
  // This is triggered by the manual Ping button in the UI
  ipcMain.handle(
    IPC_CHANNELS.PING_RDR_IMMEDIATE,
    async (event, projectId: string, tasks: Array<{
      id: string;
      status: string;
      reviewReason?: string;
      description?: string;
      subtasks?: Array<{ status: string; name?: string }>;
    }>): Promise<IPCResult<{ taskCount: number; signalPath: string }>> => {
      console.log(`[RDR] Ping immediate - ${tasks.length} tasks from project ${projectId}`);

      // Get project path
      const project = projectStore.getProject(projectId);
      if (!project) {
        return {
          success: false,
          error: 'Project not found'
        };
      }

      // Convert renderer Task objects to TaskInfo format
      const taskInfos: TaskInfo[] = tasks.map(t => ({
        specId: t.id,
        status: t.status,
        reviewReason: t.reviewReason,
        description: t.description,
        subtasks: t.subtasks
      }));

      // Categorize tasks into batches
      const batches = categorizeTasks(taskInfos, project.path);
      console.log(`[RDR] Categorized ${tasks.length} tasks into ${batches.length} batches:`);
      for (const batch of batches) {
        console.log(`[RDR]   - ${batch.type}: ${batch.taskIds.length} tasks`);
      }

      // Check usage monitor for session limit BEFORE sending
      const rateLimitCheck = isSessionLimitReached();
      if (rateLimitCheck.limited && rateLimitCheck.resetTime) {
        console.log(`[RDR] Session limit reached (${rateLimitCheck.reason}) — pausing RDR`);
        pauseRdr(rateLimitCheck.reason || 'Session limit reached', rateLimitCheck.resetTime);
        return {
          success: false,
          error: `Rate limited — RDR paused until ${new Date(rateLimitCheck.resetTime).toLocaleTimeString()}`
        };
      } else if (rateLimitCheck.warning && rateLimitCheck.resetTime) {
        warnRdr(rateLimitCheck.reason || 'Session usage high', rateLimitCheck.resetTime);
        // Don't return — RDR keeps sending at 80-99%
      }

      // Increment RDR attempt counter for all tasks being processed
      const allTaskIds = batches.flatMap(b => b.taskIds);
      if (allTaskIds.length > 0) {
        incrementRdrAttempts(project.path, allTaskIds);
      }

      // Write signal file IMMEDIATELY (no timer)
      const signalDir = path.join(project.path, '.auto-claude');
      const signalPath = path.join(signalDir, 'rdr-pending.json');

      // Create .auto-claude dir if needed
      if (!existsSync(signalDir)) {
        const { mkdirSync } = await import('fs');
        mkdirSync(signalDir, { recursive: true });
      }

      const signal = {
        timestamp: new Date().toISOString(),
        projectId,
        source: 'manual_ping',
        batches: batches.map(b => ({
          type: b.type,
          taskCount: b.taskIds.length,
          taskIds: b.taskIds,
          tasks: b.tasks.map(t => {
            // Gather rich info for each task
            const richInfo = gatherRichTaskInfo(t, project.path);
            return {
              specId: t.specId,
              description: t.description?.substring(0, 200),
              status: t.status,
              reviewReason: t.reviewReason,
              exitReason: t.exitReason,
              interventionType: richInfo.interventionType,
              progress: richInfo.progress,
              currentPhase: richInfo.currentPhase,
              lastLogs: richInfo.lastLogs,
              errors: richInfo.errors
            };
          })
        })),
        prompt: generateBatchPrompt(batches, projectId, project.path)
      };

      writeFileSync(signalPath, JSON.stringify(signal, null, 2));
      console.log(`[RDR] Wrote signal file: ${signalPath}`);
      console.log(`[RDR] Signal contains ${batches.length} batches with ${batches.reduce((sum, b) => sum + b.taskIds.length, 0)} total tasks`);

      return {
        success: true,
        data: {
          taskCount: tasks.length,
          signalPath
        }
      };
    }
  );

  // VS Code Window Management handlers
  // These use PowerShell scripts that mirror ClaudeAutoResponse logic

  // Get list of VS Code windows
  ipcMain.handle(
    IPC_CHANNELS.GET_VSCODE_WINDOWS,
    async (): Promise<IPCResult<Array<{ handle: number; title: string; processId: number }>>> => {
      console.log('[RDR] Getting VS Code windows');

      try {
        // Dynamic import to avoid loading Windows-specific code on other platforms
        const { getVSCodeWindows } = await import('../platform/windows/window-manager');
        const windows = getVSCodeWindows();
        console.log(`[RDR] Found ${windows.length} VS Code windows`);

        return {
          success: true,
          data: windows
        };
      } catch (error) {
        console.error('[RDR] Failed to get VS Code windows:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  // Send RDR message to a specific VS Code window
  ipcMain.handle(
    IPC_CHANNELS.SEND_RDR_TO_WINDOW,
    async (event, identifier: number | string, message: string): Promise<IPCResult<{ success: boolean; error?: string }>> => {
      const matchType = typeof identifier === 'number' ? 'handle' : 'title';
      console.log(`[RDR] Preparing to send message to window by ${matchType}: "${identifier}"`);
      console.log(`[RDR] Message length: ${message.length} characters`);

      try {
        const result = await sendMessageWithActiveRdrMechanism(identifier, message);

        if (result.success) {
          console.log('[RDR] Message sent successfully');
        } else {
          console.error('[RDR] Failed to send message:', result.error);
        }

        return {
          success: result.success,
          data: result
        };
      } catch (error) {
        console.error('[RDR] Exception sending message:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SEND_TEST_RDR_TO_WINDOW,
    async (event, identifier: number | string): Promise<IPCResult<{ success: boolean; error?: string }>> => {
      const matchType = typeof identifier === 'number' ? 'handle' : 'title';
      console.log(`[RDR] Preparing to send manual test prompt to window by ${matchType}: "${identifier}"`);

      try {
        const result = await sendMessageWithActiveRdrMechanism(identifier, MANUAL_RDR_TEST_PROMPT);

        if (result.success) {
          console.log('[RDR] Manual test prompt sent successfully');
        } else {
          console.error('[RDR] Failed to send manual test prompt:', result.error);
        }

        return {
          success: result.success,
          data: result
        };
      } catch (error) {
        console.error('[RDR] Exception sending manual test prompt:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );
  // Get detailed RDR batch information for auto-send messages
  ipcMain.handle(
    IPC_CHANNELS.GET_RDR_BATCH_DETAILS,
    async (event, projectId: string): Promise<IPCResult<{
      projectPath: string;
      batches: Array<{ type: string; taskIds: string[]; taskCount: number }>;
      taskDetails: Array<{
        specId: string;
        title: string;
        description: string;
        status: string;
        reviewReason?: string;
        exitReason?: string;
        interventionType?: InterventionType | null;  // Type of intervention needed
        progress?: {                                  // Progress info with last subtask
          completed: number;
          total: number;
          percentage: number;
          lastSubtaskName?: string;
          lastSubtaskIndex?: number;
        };
        subtasks?: Array<{ name: string; status: string }>;
        errorSummary?: string;
        lastLogs?: Array<{ timestamp: string; phase: string; content: string }>;
        board?: string;           // Kanban board: "In Progress", "AI Review", etc.
        currentPhase?: string;    // Agent phase: "coding", "validation", etc.
        qaSignoff?: string;       // qa_signoff.status from worktree/main plan
        rdrAttempts?: number;     // Number of RDR recovery attempts from task_metadata.json
        stuckSince?: string;      // ISO timestamp when task entered recovery mode (yellow outline)
      }>;
    }>> => {
      console.log(`[RDR] Getting batch details for project ${projectId}`);

      try {
        const project = projectStore.getProject(projectId);
        const projectPath = project?.path;
        const rawTasks = projectStore.getTasks(projectId);

        // Filter out archived and rdrDisabled tasks BEFORE enrichment
        const nonArchivedTasks = rawTasks.filter(t => {
          if (t.metadata?.archivedAt) {
            console.log(`[RDR] ⏭️  Skipping ${t.specId} - archived at ${t.metadata.archivedAt}`);
            return false;
          }
          if (t.metadata?.rdrDisabled) {
            console.log(`[RDR] ⏭️  Skipping ${t.specId} - RDR disabled by user`);
            return false;
          }
          return true;
        });

        // Enrich tasks with worktree data before intervention check.
        // ProjectStore dedup prefers main (for board display), but worktrees have
        // actual agent progress. Tasks at human_review 100% in main may be
        // ai_review/in_progress in the worktree.
        const tasks = projectPath
          ? nonArchivedTasks.map(t => enrichTaskWithWorktreeData(t, projectPath))
          : nonArchivedTasks;

        /**
         * Helper: Check if task needs intervention
         * Delegates to centralized determineInterventionType() which uses calculateTaskProgress()
         * to properly check task.phases (same logic as auto-shutdown detection)
         *
         * Tasks at 100% completion + passed AI review = NOT flagged (legitimate human review)
         */
        const needsIntervention = (task: TaskInfo): boolean => {
          // DEBUG: Log data flow for each task
          const progress = calculateTaskProgress(task);
          const phaseCount = task.phases?.length || 0;
          const subtaskCount = task.phases?.flatMap(p =>
            p.subtasks || (p as { chunks?: Array<{ status: string }> }).chunks || []
          ).length || 0;
          console.log(`[RDR] Task ${task.specId}: status=${task.status}, phases=${phaseCount}, subtasks=${subtaskCount}, progress=${progress}%, reviewReason=${task.reviewReason || 'none'}`);

          const wtDir = projectPath ? path.join(projectPath, '.auto-claude', 'worktrees', 'tasks', task.specId) : null;
          const hasWt = wtDir ? existsSync(wtDir) : undefined;
          const rawStatus = projectPath ? getRawPlanStatus(projectPath, task.specId) : undefined;
          const wtInfo = projectPath ? getWorktreeInfo(projectPath, task.specId) : undefined;
          const wasStarted = projectPath ? wasTaskPreviouslyStarted(projectPath, task.specId) : false;
          const interventionType = determineInterventionType(task, hasWt, rawStatus, wtInfo, wasStarted, projectPath);

          if (interventionType) {
            console.log(`[RDR] ✅ Task ${task.specId} needs intervention: type=${interventionType}`);
            return true;
          }

          // Log why task was skipped - be more accurate about the reason
          if (progress === 100 && task.reviewReason === 'completed') {
            console.log(`[RDR] ⏭️  Skipping task ${task.specId} - 100% complete, awaiting merge approval`);
          } else if (progress === 100) {
            console.log(`[RDR] ⏭️  Skipping task ${task.specId} - 100% but reviewReason=${task.reviewReason || 'none'} (should have been caught)`);
          } else if (task.status === 'done' || task.status === 'pr_created') {
            console.log(`[RDR] ⏭️  Skipping task ${task.specId} - status=${task.status}`);
          } else {
            console.log(`[RDR] ⏭️  Skipping task ${task.specId} - no intervention needed (progress=${progress}%)`);
          }

          return false;
        };

        // Filter tasks using enhanced detection (uses centralized calculateTaskProgress)
        const tasksNeedingHelp = tasks.filter(needsIntervention);

        if (tasksNeedingHelp.length === 0) {
          return {
            success: true,
            data: {
              projectPath: projectPath || '',
              batches: [],
              taskDetails: []
            }
          };
        }

        // Convert to TaskInfo format for categorization
        const taskInfos: TaskInfo[] = tasksNeedingHelp.map(t => ({
          specId: t.specId,
          status: t.status,
          reviewReason: t.reviewReason,
          description: t.description,
          subtasks: t.subtasks,
          phases: t.phases,  // Required for calculateTaskProgress()
          exitReason: t.exitReason,
          planStatus: t.planStatus,
          qaSignoff: t.qaSignoff
        }));

        // Categorize into batches
        const batches = categorizeTasks(taskInfos, projectPath);

        // Check usage monitor for session limit BEFORE building the message
        // This is the 30-second polling path — must detect rate limits here
        const rateLimitCheck = isSessionLimitReached();
        if (rateLimitCheck.limited && rateLimitCheck.resetTime) {
          console.log(`[RDR] Session limit reached (${rateLimitCheck.reason}) — pausing RDR`);
          pauseRdr(rateLimitCheck.reason || 'Session limit reached', rateLimitCheck.resetTime);
          return {
            success: true,
            data: {
              projectPath: projectPath || '',
              batches: [],
              taskDetails: []
            }
          };
        } else if (rateLimitCheck.warning && rateLimitCheck.resetTime) {
          warnRdr(rateLimitCheck.reason || 'Session usage high', rateLimitCheck.resetTime);
          // Don't return — continue building message, RDR keeps sending at 80-99%
        }

        // Build detailed task info for the message
        const taskDetails = tasksNeedingHelp.map(task => {
          // Extract error summary if available
          let errorSummary: string | undefined;
          if (task.reviewReason === 'errors') {
            errorSummary = task.exitReason || 'Task failed during execution';
          } else if (task.reviewReason === 'qa_rejected') {
            errorSummary = 'QA found issues with implementation';
          } else if (task.description?.startsWith(JSON_ERROR_PREFIX)) {
            errorSummary = 'JSON parse error in task data';
          }

          // Convert task to TaskInfo for helper functions
          const taskInfo: TaskInfo = {
            specId: task.specId,
            title: task.title,
            status: task.status,
            reviewReason: task.reviewReason,
            description: task.description,
            subtasks: task.subtasks,
            phases: task.phases,
            exitReason: task.exitReason,
            planStatus: task.planStatus,
            qaSignoff: task.qaSignoff
          };

          // Calculate progress from subtasks (handle both 'subtasks' and 'chunks' naming)
          const allSubtasks = task.phases?.flatMap((p: any) => p.subtasks || p.chunks || []) || task.subtasks || [];
          const completed = allSubtasks.filter((s: any) => s.status === 'completed').length;
          const total = allSubtasks.length;

          // Find last completed subtask
          let lastSubtaskName: string | undefined;
          let lastSubtaskIndex: number | undefined;
          for (let i = allSubtasks.length - 1; i >= 0; i--) {
            if (allSubtasks[i].status === 'completed') {
              lastSubtaskName = allSubtasks[i].name || allSubtasks[i].description?.substring(0, 50) || allSubtasks[i].title;
              lastSubtaskIndex = i + 1;
              break;
            }
          }

          // Determine intervention type (checks if agent IS running, not timestamps)
          const taskWtDir = projectPath ? path.join(projectPath, '.auto-claude', 'worktrees', 'tasks', task.specId) : null;
          const taskHasWt = taskWtDir ? existsSync(taskWtDir) : undefined;
          const taskRawStatus = projectPath ? getRawPlanStatus(projectPath, task.specId) : undefined;
          const taskWtInfo = projectPath ? getWorktreeInfo(projectPath, task.specId) : undefined;
          const taskWasStarted = projectPath ? wasTaskPreviouslyStarted(projectPath, task.specId) : false;
          const interventionType = determineInterventionType(taskInfo, taskHasWt, taskRawStatus, taskWtInfo, taskWasStarted, projectPath);

          // Determine board and phase for display grouping
          const currentPhase = projectPath ? getCurrentPhase(projectPath, task.specId) : undefined;
          const board = getTaskBoard(task.status, currentPhase);

          return {
            specId: task.specId,
            title: task.title || task.specId,
            description: task.description?.substring(0, 200) || '',
            status: task.status,
            reviewReason: task.reviewReason,
            exitReason: task.exitReason,
            interventionType,  // Type of intervention needed
            progress: {        // Progress info with last subtask
              completed,
              total,
              percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
              lastSubtaskName,
              lastSubtaskIndex
            },
            subtasks: task.subtasks?.map((s) => ({
              name: s.title || s.id,
              status: s.status
            })),
            errorSummary,
            // Get last 3 log entries for context (prefers worktree logs)
            lastLogs: projectPath ? getLastLogEntries(projectPath, task.specId, 3) : undefined,
            board,
            currentPhase,
            qaSignoff: task.qaSignoff,
            rdrAttempts: task.metadata?.rdrAttempts || 0,
            stuckSince: task.metadata?.stuckSince
          };
        });

        console.log(`[RDR] Found ${taskDetails.length} tasks needing intervention, ${batches.length} batches`);

        return {
          success: true,
          data: {
            projectPath: projectPath || '',
            batches: batches.map(b => ({
              type: b.type,
              taskIds: b.taskIds,
              taskCount: b.taskIds.length
            })),
            taskDetails
          }
        };
      } catch (error) {
        console.error('[RDR] Failed to get batch details:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  // Fallback: Check for recent session file modifications
  async function isClaudeSessionActive(): Promise<boolean> {
    const claudeDir = path.join(os.homedir(), '.claude');
    const sessionsDir = path.join(claudeDir, '.sessions');

    if (!existsSync(sessionsDir)) {
      return false;
    }

    const recentThreshold = Date.now() - 5000; // 5 seconds
    const files = readdirSync(sessionsDir);

    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      try {
        const stats = statSync(filePath);

        // If session file modified in last 5 seconds, Claude is active
        if (stats.mtimeMs > recentThreshold) {
          return true;
        }
      } catch (err) {
        // Ignore files we can't stat
        continue;
      }
    }

    return false;
  }

  // Check if Claude Code is currently busy (in a prompt loop)
  ipcMain.handle(
    IPC_CHANNELS.IS_CLAUDE_CODE_BUSY,
    async (event, identifier: number | string): Promise<IPCResult<boolean>> => {
      try {
        const { isClaudeCodeBusy } = await import('../platform/windows/window-manager');
        const busy = await isClaudeCodeBusy(identifier);
        return { success: true, data: busy };
      } catch (error) {
        console.error('[RDR] Error checking busy state:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Auto-recover tasks that need intervention (with safety filtering)
  // SAFETY: Only recovers tasks that determineInterventionType() flags as needing help.
  // Never touches done, pr_created, backlog, pending, or archived tasks.
  ipcMain.handle(
    IPC_CHANNELS.AUTO_RECOVER_ALL_TASKS,
    async (event, projectId: string): Promise<IPCResult<{ recovered: number; taskIds: string[] }>> => {
      try {
        const tasks = projectStore.getTasks(projectId);

        if (tasks.length === 0) {
          console.log('[RDR] No tasks found in project');
          return { success: true, data: { recovered: 0, taskIds: [] } };
        }

        console.log(`[RDR] Scanning ${tasks.length} tasks for safe auto-recovery`);

        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        // SAFETY: Statuses that must NEVER be changed by auto-recovery
        const NEVER_RECOVER = new Set(['done', 'pr_created', 'backlog', 'pending', 'queue']);

        const recovered: string[] = [];
        const skipped: string[] = [];

        for (const task of tasks) {
          try {
            // SAFETY CHECK 1: Skip terminal/safe statuses
            if (NEVER_RECOVER.has(task.status)) {
              skipped.push(task.specId);
              continue;
            }

            // SAFETY CHECK 2: Skip archived tasks
            if (task.metadata?.archivedAt) {
              console.log(`[RDR] ⏭️  Skipping ${task.specId} - archived`);
              skipped.push(task.specId);
              continue;
            }

            // SAFETY CHECK 2b: Respect per-task RDR opt-out
            if (task.metadata?.rdrDisabled) {
              console.log(`[RDR] ⏭️  Skipping ${task.specId} - RDR disabled by user`);
              skipped.push(task.specId);
              continue;
            }

            // SAFETY CHECK 3: Only recover tasks that actually need intervention
            const taskInfoForCheck: TaskInfo = {
              specId: task.specId,
              status: task.status,
              reviewReason: task.reviewReason,
              phases: task.phases,
              exitReason: task.exitReason,
              planStatus: task.planStatus,
            };
            const recoverWtDir = path.join(project.path, '.auto-claude', 'worktrees', 'tasks', task.specId);
            const recoverHasWt = existsSync(recoverWtDir);
            const recoverRawStatus = getRawPlanStatus(project.path, task.specId);
            const recoverWtInfo = getWorktreeInfo(project.path, task.specId);
            const recoverWasStarted = wasTaskPreviouslyStarted(project.path, task.specId);
            const interventionType = determineInterventionType(taskInfoForCheck, recoverHasWt, recoverRawStatus, recoverWtInfo, recoverWasStarted, project.path);

            if (!interventionType) {
              console.log(`[RDR] ⏭️  Skipping ${task.specId} - no intervention needed (status=${task.status})`);
              skipped.push(task.specId);
              continue;
            }

            const planPath = getPlanPath(project.path, task.specId);

            if (!existsSync(planPath)) {
              console.warn(`[RDR] ⚠️  Plan not found: ${planPath}`);
              continue;
            }

            const planContent = readFileSync(planPath, 'utf-8');
            const plan = JSON.parse(planContent);

            plan.status = 'start_requested';
            plan.updated_at = new Date().toISOString();

            writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf-8');

            console.log(`[RDR] ✅ Recovered ${task.specId} (intervention=${interventionType}, was ${task.status})`);
            recovered.push(task.specId);
          } catch (error) {
            console.error(`[RDR] ❌ Error recovering ${task.specId}:`, error);
          }
        }

        console.log(`[RDR] Recovery complete: ${recovered.length} recovered, ${skipped.length} skipped (safe)`);

        return {
          success: true,
          data: { recovered: recovered.length, taskIds: recovered }
        };
      } catch (error) {
        console.error('[RDR] Auto-recovery failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );
}
