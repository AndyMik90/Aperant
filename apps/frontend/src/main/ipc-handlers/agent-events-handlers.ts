import type { BrowserWindow } from "electron";
import path from "path";
import { existsSync, readFileSync } from "fs";
import { IPC_CHANNELS, AUTO_BUILD_PATHS, getSpecsDir } from "../../shared/constants";
import type {
  SDKRateLimitInfo,
  AuthFailureInfo,
  ImplementationPlan,
} from "../../shared/types";
import { XSTATE_SETTLED_STATES, XSTATE_TO_PHASE, mapStateToLegacy } from "../../shared/state-machines";
import { AgentManager } from "../agent";
import type { ProcessType, ExecutionProgressData } from "../agent";
import { titleGenerator } from "../title-generator";
import { fileWatcher } from "../file-watcher";
import { notificationService } from "../notification-service";
import { persistPlanLastEventSync, getPlanPath, persistPlanPhaseSync, persistPlanStatusAndReasonSync } from "./task/plan-file-utils";
import { findTaskWorktree } from "../worktree-paths";
import { findTaskAndProject } from "./task/shared";
import { safeSendToRenderer } from "./utils";
import { getClaudeProfileManager } from "../claude-profile-manager";
import { taskStateManager } from "../task-state-manager";

/**
 * Register all agent-events-related IPC handlers
 */
export function registerAgenteventsHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  taskStateManager.configure(getMainWindow);

  // ============================================
  // Agent Manager Events → Renderer
  // ============================================

  agentManager.on("log", (taskId: string, log: string, projectId?: string) => {
    // Use projectId from event when available; fall back to lookup for backward compatibility
    if (!projectId) {
      const { project } = findTaskAndProject(taskId);
      projectId = project?.id;
    }
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_LOG, taskId, log, projectId);
  });

  agentManager.on("error", (taskId: string, error: string, projectId?: string) => {
    // Use projectId from event when available; fall back to lookup for backward compatibility
    if (!projectId) {
      const { project } = findTaskAndProject(taskId);
      projectId = project?.id;
    }
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_ERROR, taskId, error, projectId);
  });

  // Handle SDK rate limit events from agent manager
  agentManager.on("sdk-rate-limit", (rateLimitInfo: SDKRateLimitInfo) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);
  });

  // Handle SDK rate limit events from title generator
  titleGenerator.on("sdk-rate-limit", (rateLimitInfo: SDKRateLimitInfo) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);
  });

  // Handle auth failure events (401 errors requiring re-authentication)
  agentManager.on("auth-failure", (taskId: string, authFailure: {
    profileId?: string;
    failureType?: 'missing' | 'invalid' | 'expired' | 'unknown';
    message?: string;
    originalError?: string;
  }) => {
    console.warn(`[AgentEvents] Auth failure detected for task ${taskId}:`, authFailure);

    // Get profile name for display
    const profileManager = getClaudeProfileManager();
    const profile = authFailure.profileId
      ? profileManager.getProfile(authFailure.profileId)
      : profileManager.getActiveProfile();

    const authFailureInfo: AuthFailureInfo = {
      profileId: authFailure.profileId || profile?.id || 'unknown',
      profileName: profile?.name,
      failureType: authFailure.failureType || 'unknown',
      message: authFailure.message || 'Authentication failed. Please re-authenticate.',
      originalError: authFailure.originalError,
      taskId,
      detectedAt: new Date(),
    };

    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CLAUDE_AUTH_FAILURE, authFailureInfo);
  });

  agentManager.on("exit", (taskId: string, code: number | null, processType: ProcessType, projectId?: string) => {
    // Use projectId from event to scope the lookup (prevents cross-project contamination)
    const { task: exitTask, project: exitProject } = findTaskAndProject(taskId, projectId);
    const exitProjectId = exitProject?.id || projectId;

    taskStateManager.handleProcessExited(taskId, code, exitTask, exitProject);

    // Send final plan state to renderer BEFORE unwatching
    // This ensures the renderer has the final subtask data (fixes 0/0 subtask bug)
    // Try the file watcher's current path first, then fall back to worktree path
    let finalPlan = fileWatcher.getCurrentPlan(taskId);
    if (!finalPlan && exitTask && exitProject) {
      // File watcher may have been watching the wrong path (main vs worktree)
      // Try reading directly from the worktree
      const worktreePath = findTaskWorktree(exitProject.path, exitTask.specId);
      if (worktreePath) {
        const specsBaseDir = getSpecsDir(exitProject.autoBuildPath);
        const worktreePlanPath = path.join(worktreePath, specsBaseDir, exitTask.specId, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
        try {
          const content = readFileSync(worktreePlanPath, 'utf-8');
          finalPlan = JSON.parse(content);
        } catch {
          // Worktree plan file not readable - not critical
        }
      }
    }
    if (finalPlan) {
      safeSendToRenderer(
        getMainWindow,
        IPC_CHANNELS.TASK_PROGRESS,
        taskId,
        finalPlan,
        exitProjectId
      );
    }

    fileWatcher.unwatch(taskId).catch((err) => {
      console.error(`[agent-events-handlers] Failed to unwatch for ${taskId}:`, err);
    });

    if (processType === "spec-creation") {
      console.warn(`[Task ${taskId}] Spec creation completed with code ${code}`);
      return;
    }

    const { task, project } = findTaskAndProject(taskId, projectId);
    if (!task || !project) return;

    const taskTitle = task.title || task.specId;
    if (code === 0) {
      notificationService.notifyReviewNeeded(taskTitle, project.id, taskId);
    } else {
      notificationService.notifyTaskFailed(taskTitle, project.id, taskId);
    }
  });

  agentManager.on("task-event", (taskId: string, event, projectId?: string) => {
    console.debug(`[agent-events-handlers] Received task-event for ${taskId}:`, event.type, event);

    if (taskStateManager.getLastSequence(taskId) === undefined) {
      const { task, project } = findTaskAndProject(taskId, projectId);
      if (task && project) {
        try {
          const planPath = getPlanPath(project, task);
          const planContent = readFileSync(planPath, "utf-8");
          const plan = JSON.parse(planContent);
          const lastSeq = plan?.lastEvent?.sequence;
          if (typeof lastSeq === "number" && lastSeq >= 0) {
            taskStateManager.setLastSequence(taskId, lastSeq);
          }
        } catch {
          // Ignore missing/invalid plan files
        }
      }
    }

    const { task, project } = findTaskAndProject(taskId, projectId);
    if (!task || !project) {
      console.debug(`[agent-events-handlers] No task/project found for ${taskId}`);
      return;
    }

    console.debug(`[agent-events-handlers] Task state before handleTaskEvent:`, {
      status: task.status,
      reviewReason: task.reviewReason,
      phase: task.executionProgress?.phase
    });

    const accepted = taskStateManager.handleTaskEvent(taskId, event, task, project);
    console.debug(`[agent-events-handlers] Event ${event.type} accepted: ${accepted}`);
    if (!accepted) {
      return;
    }

    const mainPlanPath = getPlanPath(project, task);
    persistPlanLastEventSync(mainPlanPath, event);

    const worktreePath = findTaskWorktree(project.path, task.specId);
    if (worktreePath) {
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const worktreePlanPath = path.join(
        worktreePath,
        specsBaseDir,
        task.specId,
        AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN
      );
      if (existsSync(worktreePlanPath)) {
        persistPlanLastEventSync(worktreePlanPath, event);
      }
    }
  });

  agentManager.on("execution-progress", (taskId: string, progress: ExecutionProgressData, projectId?: string) => {
    // Use projectId from event to scope the lookup (prevents cross-project contamination)
    const { task, project } = findTaskAndProject(taskId, projectId);
    const taskProjectId = project?.id || projectId;

    // Check if XState has already established a terminal/review state for this task.
    // XState is the source of truth for status. When XState is in a terminal state
    // (e.g., plan_review after PLANNING_COMPLETE), execution-progress events from the
    // agent process are stale and must not overwrite XState's persisted status.
    //
    // Example: When requireReviewBeforeCoding=true, the process exits with code 1 after
    // PLANNING_COMPLETE. The exit handler emits execution-progress with phase='failed',
    // which would incorrectly overwrite status='human_review' with status='error' via
    // persistPlanPhaseSync, and send a 'failed' phase to the renderer overwriting the
    // 'planning' phase that XState already emitted via emitPhaseFromState.
    const currentXState = taskStateManager.getCurrentState(taskId);
    const xstateInTerminalState = currentXState && XSTATE_SETTLED_STATES.has(currentXState);

    // Persist phase to plan file for restoration on app refresh
    // Must persist to BOTH main project and worktree (if exists) since task may be loaded from either
    if (task && project && progress.phase && !xstateInTerminalState) {
      const mainPlanPath = getPlanPath(project, task);
      persistPlanPhaseSync(mainPlanPath, progress.phase, project.id);

      // Also persist to worktree if task has one
      const worktreePath = findTaskWorktree(project.path, task.specId);
      if (worktreePath) {
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const worktreeSpecDir = path.join(worktreePath, specsBaseDir, task.specId);
        const worktreePlanPath = path.join(
          worktreeSpecDir,
          AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN
        );
        if (existsSync(worktreePlanPath)) {
          persistPlanPhaseSync(worktreePlanPath, progress.phase, project.id);
        }

        // Re-watch the worktree path if the file watcher is still watching the main project path.
        // This handles the case where the task started before the worktree existed:
        // the initial watch fell back to the main project spec dir, but now the worktree
        // is available and implementation_plan.json is being written there.
        const currentWatchDir = fileWatcher.getWatchedSpecDir(taskId);
        if (currentWatchDir && currentWatchDir !== worktreeSpecDir && existsSync(worktreePlanPath)) {
          console.warn(`[agent-events-handlers] Re-watching worktree path for ${taskId}: ${worktreeSpecDir}`);
          fileWatcher.watch(taskId, worktreeSpecDir).catch((err) => {
            console.error(`[agent-events-handlers] Failed to re-watch worktree for ${taskId}:`, err);
          });
        }
      }
    } else if (xstateInTerminalState && progress.phase) {
      console.debug(`[agent-events-handlers] Skipping persistPlanPhaseSync for ${taskId}: XState in '${currentXState}', not overwriting with phase '${progress.phase}'`);
    }

    // Skip sending execution-progress to renderer when XState has settled.
    // XState's emitPhaseFromState already sent the correct phase to the renderer.
    if (xstateInTerminalState) {
      console.debug(`[agent-events-handlers] Skipping execution-progress to renderer for ${taskId}: XState in '${currentXState}', ignoring phase '${progress.phase}'`);
      return;
    }
    safeSendToRenderer(
      getMainWindow,
      IPC_CHANNELS.TASK_EXECUTION_PROGRESS,
      taskId,
      progress,
      taskProjectId
    );
  });

  // ============================================
  // File Watcher Events → Renderer
  // ============================================

  fileWatcher.on("progress", (taskId: string, plan: ImplementationPlan) => {
    // File watcher events don't carry projectId — fall back to lookup
    const { task, project } = findTaskAndProject(taskId);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_PROGRESS, taskId, plan, project?.id);

    // Re-stamp XState status fields if the backend overwrote the plan file without them.
    // The planner agent writes implementation_plan.json via the Write tool, which replaces
    // the entire file and strips the frontend's status/xstateState/executionPhase fields.
    // This causes tasks to snap back to backlog on refresh.
    const planWithStatus = plan as { xstateState?: string; executionPhase?: string; status?: string };
    const currentXState = taskStateManager.getCurrentState(taskId);
    if (currentXState && !planWithStatus.xstateState && task && project) {
      console.debug(`[agent-events-handlers] Re-stamping XState status on plan file for ${taskId} (state: ${currentXState})`);
      const mainPlanPath = getPlanPath(project, task);
      const { status, reviewReason } = mapStateToLegacy(currentXState);
      const phase = XSTATE_TO_PHASE[currentXState] || 'idle';
      persistPlanStatusAndReasonSync(mainPlanPath, status, reviewReason, project.id, currentXState, phase);

      // Also re-stamp worktree copy if it exists
      const worktreePath = findTaskWorktree(project.path, task.specId);
      if (worktreePath) {
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const worktreePlanPath = path.join(
          worktreePath,
          specsBaseDir,
          task.specId,
          AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN
        );
        if (existsSync(worktreePlanPath)) {
          persistPlanStatusAndReasonSync(worktreePlanPath, status, reviewReason, project.id, currentXState, phase);
        }
      }
    }
  });

  fileWatcher.on("error", (taskId: string, error: string) => {
    // File watcher events don't carry projectId — fall back to lookup
    const { project } = findTaskAndProject(taskId);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_ERROR, taskId, error, project?.id);
  });
}
