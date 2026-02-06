import type { BrowserWindow } from "electron";
import path from "path";
import { existsSync } from "fs";
import { IPC_CHANNELS, AUTO_BUILD_PATHS, getSpecsDir } from "../../shared/constants";
import {
  wouldPhaseRegress,
  isTerminalPhase,
  isValidExecutionPhase,
  isValidPhaseTransition,
  type ExecutionPhase,
} from "../../shared/constants/phase-protocol";
import type {
  SDKRateLimitInfo,
  Task,
  TaskStatus,
  Project,
  ImplementationPlan,
} from "../../shared/types";
import { AgentManager } from "../agent";
import type { ProcessType, ExecutionProgressData } from "../agent";
import { TerminalManager } from "../terminal/terminal-manager";
import { titleGenerator } from "../title-generator";
import { fileWatcher } from "../file-watcher";
import { projectStore } from "../project-store";
import { notificationService } from "../notification-service";
import { persistPlanStatusSync, getPlanPath } from "./task/plan-file-utils";
import { findTaskWorktree } from "../worktree-paths";
import { findTaskAndProject } from "./task/shared";
import { safeSendToRenderer } from "./utils";
import { SDKOutputParser } from "../agent/parsers/sdk-output-parser";
import { parseRalphPromise } from "../agent/parsers/ralph-promise-parser";
import type { StepCompleteBlock, TaskCompleteBlock } from "../../shared/types/structured-output";
import { recordTaskTimestamp } from "../utils/task-timestamps";

// Track SDK output parsers per task for stateful parsing
const taskParsers = new Map<string, SDKOutputParser>();

// Track Ralph step progress per task
const taskStepProgress = new Map<string, { completed: number; total: number }>();

/**
 * Get or create an SDK output parser for a task
 */
function getTaskParser(taskId: string): SDKOutputParser {
  let parser = taskParsers.get(taskId);
  if (!parser) {
    parser = new SDKOutputParser();
    taskParsers.set(taskId, parser);
  }
  return parser;
}

/**
 * Clean up parser and Ralph progress tracking for a task when it exits
 */
function cleanupTaskParser(taskId: string): void {
  taskParsers.delete(taskId);
  taskStepProgress.delete(taskId);
}

/**
 * Validates status transitions to prevent invalid state changes.
 * FIX (ACS-55, ACS-71): Adds guardrails against bad status transitions.
 * FIX (PR Review): Uses comprehensive wouldPhaseRegress() utility instead of hardcoded checks.
 * FIX (ACS-203): Adds phase completion validation to prevent phase overlaps.
 * FIX-10: Gate enforcement - planning->coding ONLY via TASK_START_BUILD
 *
 * IMPORTANT: This validator is only called for AGENT-INITIATED status changes
 * (via execution-progress events). User-initiated changes go through separate paths:
 * - TASK_UPDATE_STATUS: Status change only (Kanban drag - now disabled)
 * - TASK_START_BUILD: User clicks "Start Build" (the ONLY way to start coding)
 *
 * @param task - The current task (may be undefined if not found)
 * @param newStatus - The proposed new status
 * @param phase - The execution phase that triggered this transition
 * @returns true if transition is valid, false if it should be blocked
 */
function validateStatusTransition(
  task: Task | undefined,
  newStatus: TaskStatus,
  phase: string
): boolean {
  // Can't validate without task data - allow the transition
  if (!task) return true;

  // FIX-10: Block automatic planning->coding transitions from agent events
  // This gate ensures users must explicitly click "Start Build" to start coding.
  // Agent-initiated events should NOT auto-promote tasks from planning to coding.
  if (task.status === "planning" && newStatus === "coding") {
    console.warn(
      `[validateStatusTransition] FIX-10: Blocking auto planning->coding for task ${task.id} (phase: ${phase}). User must click "Start Build".`
    );
    return false;
  }

  // Don't allow human_review without subtasks
  // This prevents tasks from jumping to review before planning is complete
  if (newStatus === "human_review" && (!task.subtasks || task.subtasks.length === 0)) {
    console.warn(
      `[validateStatusTransition] Blocking human_review - task ${task.id} has no subtasks (phase: ${phase})`
    );
    return false;
  }

  // FIX (PR Review): Use comprehensive phase regression check instead of hardcoded checks
  // This handles all phase regressions (qa_review→coding, complete→coding, etc.)
  // not just the specific coding→planning case
  const currentPhase = task.executionProgress?.phase;
  const completedPhases = task.executionProgress?.completedPhases || [];

  if (currentPhase && isValidExecutionPhase(currentPhase) && isValidExecutionPhase(phase)) {
    // Block transitions from terminal phases (complete/failed)
    if (isTerminalPhase(currentPhase)) {
      console.warn(
        `[validateStatusTransition] Blocking transition from terminal phase: ${currentPhase} for task ${task.id}`
      );
      return false;
    }

    // Block any phase regression (going backwards in the workflow)
    // Note: Cast phase to ExecutionPhase since isValidExecutionPhase() type guard doesn't narrow through function calls
    if (wouldPhaseRegress(currentPhase, phase as ExecutionPhase)) {
      console.warn(
        `[validateStatusTransition] Blocking phase regression: ${currentPhase} -> ${phase} for task ${task.id}`
      );
      return false;
    }

    // FIX (ACS-203): Validate phase transitions based on completed phases
    // This prevents multiple phases from being active simultaneously
    // e.g., coding starting while planning is still marked as active
    const newPhase = phase as ExecutionPhase;
    if (!isValidPhaseTransition(currentPhase, newPhase, completedPhases)) {
      console.warn(
        `[validateStatusTransition] Blocking invalid phase transition: ${currentPhase} -> ${newPhase} for task ${task.id}`,
        {
          currentPhase,
          newPhase,
          completedPhases,
          reason: "Prerequisite phases not completed",
        }
      );
      return false;
    }
  }

  return true;
}

/**
 * Register all agent-events-related IPC handlers
 */
export function registerAgenteventsHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null,
  terminalManager: TerminalManager
): void {
  // ============================================
  // Agent Manager Events → Renderer
  // ============================================

  agentManager.on("log", (taskId: string, log: string) => {
    // Include projectId for multi-project filtering (issue #723)
    const { project, task } = findTaskAndProject(taskId);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_LOG, taskId, log, project?.id);

    // Also forward log to task monitor terminal if it exists
    const terminalId = `task-${taskId}`;
    const mainWindow = getMainWindow();
    if (mainWindow) {
      // Format log for terminal display (add newline)
      const terminalOutput = `${log}\r\n`;
      mainWindow.webContents.send(IPC_CHANNELS.TERMINAL_OUTPUT, terminalId, terminalOutput);

      // Parse and emit structured blocks for rich UI
      // This allows TaskMonitorChat to receive pre-parsed blocks
      const parser = getTaskParser(taskId);
      const structuredBlock = parser.parse(log);
      if (structuredBlock) {
        mainWindow.webContents.send(
          IPC_CHANNELS.TERMINAL_STRUCTURED_OUTPUT,
          terminalId,
          structuredBlock
        );
      }

      // RALPH LOOP: Parse for Ralph promise markers
      // Detects <promise>STEP_N_COMPLETE</promise> and <promise>TASK_{ID}_COMPLETE</promise>
      const promiseResult = parseRalphPromise(log);
      if (promiseResult) {
        if (promiseResult.type === 'step_complete' && promiseResult.block) {
          const stepBlock = promiseResult.block as StepCompleteBlock;
          console.log(`[Ralph] Step ${stepBlock.stepNumber} complete for task ${taskId}`);

          // Update step progress tracking
          const progress = taskStepProgress.get(taskId) || { completed: 0, total: 0 };
          progress.completed = Math.max(progress.completed, stepBlock.stepNumber);
          taskStepProgress.set(taskId, progress);

          // Emit step complete event to renderer
          safeSendToRenderer(
            getMainWindow,
            IPC_CHANNELS.TASK_STEP_COMPLETE,
            taskId,
            stepBlock,
            project?.id
          );

          // Also emit structured block for terminal display
          mainWindow.webContents.send(
            IPC_CHANNELS.TERMINAL_STRUCTURED_OUTPUT,
            terminalId,
            stepBlock
          );
        } else if (promiseResult.type === 'task_complete' && promiseResult.block) {
          const taskBlock = promiseResult.block as TaskCompleteBlock;
          console.log(`[Ralph] Task ${taskBlock.specId} complete for task ${taskId}`);

          // Emit task complete event to renderer
          // This signals that autonomous execution is complete and should transition to AI review
          safeSendToRenderer(
            getMainWindow,
            IPC_CHANNELS.TASK_RALPH_COMPLETE,
            taskId,
            taskBlock,
            project?.id
          );

          // Also emit structured block for terminal display
          mainWindow.webContents.send(
            IPC_CHANNELS.TERMINAL_STRUCTURED_OUTPUT,
            terminalId,
            taskBlock
          );

          // Clean up step progress tracking
          taskStepProgress.delete(taskId);
        }
      }
    }
  });

  agentManager.on("error", (taskId: string, error: string) => {
    // Include projectId for multi-project filtering (issue #723)
    const { project } = findTaskAndProject(taskId);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_ERROR, taskId, error, project?.id);
  });

  // Handle SDK rate limit events from agent manager
  agentManager.on("sdk-rate-limit", (rateLimitInfo: SDKRateLimitInfo) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);
  });

  // Handle SDK rate limit events from title generator
  titleGenerator.on("sdk-rate-limit", (rateLimitInfo: SDKRateLimitInfo) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);
  });

  // Handle task complexity classification events
  agentManager.on("complexity-classified", (taskId: string, complexityData: { complexity: 'SIMPLE' | 'MEDIUM' | 'COMPLEX'; reason: string }) => {
    const { project, task } = findTaskAndProject(taskId);
    if (project && task) {
      // Update task metadata with adaptive complexity
      const updatedMetadata = {
        ...task.metadata,
        adaptiveComplexity: complexityData.complexity,
        complexityReason: complexityData.reason,
      };

      // Update task in project store
      projectStore.updateTask(project.id, taskId, {
        ...task,
        metadata: updatedMetadata,
      });

      console.log(`[AgentEventsHandlers] Task ${taskId} complexity set to ${complexityData.complexity}: ${complexityData.reason}`);
    }
  });

  agentManager.on("exit", (taskId: string, code: number | null, processType: ProcessType) => {
    // Get project info early for multi-project filtering (issue #723)
    const { project: exitProject } = findTaskAndProject(taskId);
    const exitProjectId = exitProject?.id;

    // Send final plan state to renderer BEFORE unwatching
    // This ensures the renderer has the final subtask data (fixes 0/0 subtask bug)
    const finalPlan = fileWatcher.getCurrentPlan(taskId);
    if (finalPlan) {
      safeSendToRenderer(
        getMainWindow,
        IPC_CHANNELS.TASK_PROGRESS,
        taskId,
        finalPlan,
        exitProjectId
      );
    }

    fileWatcher.unwatch(taskId);

    // Clean up structured output parser for this task
    cleanupTaskParser(taskId);

    if (processType === "spec-creation") {
      console.warn(`[Task ${taskId}] Spec creation completed with code ${code}`);

      // FIX-7: Notify user when spec is ready for review
      if (code === 0) {
        // Find task and project for notification
        const { task: specTask, project: specProject } = findTaskAndProject(taskId);
        if (specTask && specProject) {
          const specTaskTitle = specTask.title || specTask.specId;
          notificationService.notifySpecReady(specTaskTitle, specProject.id, taskId);
          console.warn(`[Task ${taskId}] Sent spec-ready notification for: ${specTaskTitle}`);

          // Also send an IPC event to the renderer for toast notification
          safeSendToRenderer(
            getMainWindow,
            IPC_CHANNELS.TASK_SPEC_READY,
            taskId,
            specTask.specId,
            specProject.id
          );
        }
      }

      // Notify frontend that the planning agent has stopped so the
      // "Start Build" button becomes visible in the TaskCard UI
      safeSendToRenderer(
        getMainWindow,
        IPC_CHANNELS.TASK_AGENT_STOPPED,
        taskId
      );
      return;
    }

    let task: Task | undefined;
    let project: Project | undefined;

    try {
      const projects = projectStore.getProjects();

      // IMPORTANT: Invalidate cache for all projects to ensure we get fresh data
      // This prevents race conditions where cached task data has stale status
      for (const p of projects) {
        projectStore.invalidateTasksCache(p.id);
      }

      for (const p of projects) {
        const tasks = projectStore.getTasks(p.id);
        task = tasks.find((t) => t.id === taskId || t.specId === taskId);
        if (task) {
          project = p;
          break;
        }
      }

      if (task && project) {
        const taskTitle = task.title || task.specId;
        const mainPlanPath = getPlanPath(project, task);
        const projectId = project.id; // Capture for closure

        // Capture task values for closure
        const taskSpecId = task.specId;
        const projectPath = project.path;
        const autoBuildPath = project.autoBuildPath;

        // Use shared utility for persisting status (prevents race conditions)
        // Persist to both main project AND worktree (if exists) for consistency
        const persistStatus = (status: TaskStatus) => {
          // Persist to main project
          const mainPersisted = persistPlanStatusSync(mainPlanPath, status, projectId);
          if (mainPersisted) {
            console.warn(`[Task ${taskId}] Persisted status to main plan: ${status}`);
          }

          // Also persist to worktree if it exists
          const worktreePath = findTaskWorktree(projectPath, taskSpecId);
          if (worktreePath) {
            const specsBaseDir = getSpecsDir(autoBuildPath);
            const worktreePlanPath = path.join(
              worktreePath,
              specsBaseDir,
              taskSpecId,
              AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN
            );
            if (existsSync(worktreePlanPath)) {
              const worktreePersisted = persistPlanStatusSync(worktreePlanPath, status, projectId);
              if (worktreePersisted) {
                console.warn(`[Task ${taskId}] Persisted status to worktree plan: ${status}`);
              }
            }
          }
        };

        if (code === 0) {
          notificationService.notifyReviewNeeded(taskTitle, project.id, taskId);

          // Fallback: Ensure status is updated even if COMPLETE phase event was missed
          // This prevents tasks from getting stuck in ai_review status
          // FIX (ACS-71): Only move to human_review if subtasks exist AND are all completed
          // If no subtasks exist, the task is still in planning and shouldn't move to human_review
          const isActiveStatus = task.status === "coding" || task.status === "ai_review";
          const hasSubtasks = task.subtasks && task.subtasks.length > 0;
          const hasIncompleteSubtasks =
            hasSubtasks && task.subtasks.some((s) => s.status !== "completed");

          if (isActiveStatus && hasSubtasks && !hasIncompleteSubtasks) {
            // All subtasks completed - safe to move to human_review
            console.warn(
              `[Task ${taskId}] Fallback: Moving to human_review (process exited successfully, all ${task.subtasks.length} subtasks completed)`
            );
            persistStatus("human_review");
            // Include projectId for multi-project filtering (issue #723)
            safeSendToRenderer(
              getMainWindow,
              IPC_CHANNELS.TASK_STATUS_CHANGE,
              taskId,
              "human_review" as TaskStatus,
              projectId
            );
          } else if (isActiveStatus && !hasSubtasks) {
            // No subtasks yet - task is still in planning phase, don't change status
            // This prevents the bug where tasks jump to human_review before planning completes
            console.warn(
              `[Task ${taskId}] Process exited but no subtasks created yet - keeping current status (${task.status})`
            );
          }
        } else {
          notificationService.notifyTaskFailed(taskTitle, project.id, taskId);

          // FIX: Determine failure status based on current phase/status
          // - Planning failure → stay in "planning" (user can retry or fix spec)
          // - Coding failure → stay in "coding" (user can retry)
          // - QA failure → move to "human_review" (needs human intervention)
          let failureStatus: TaskStatus = "human_review";
          const currentPhase = task.executionProgress?.phase;
          const currentStatus = task.status;

          if (currentStatus === "planning" || currentPhase === "planning") {
            // Planning phase failure - keep in planning status
            failureStatus = "planning";
          } else if (currentStatus === "coding" && currentPhase !== "qa_review" && currentPhase !== "qa_fixing") {
            // Coding phase failure (not during QA) - keep in coding status
            failureStatus = "coding";
          }
          // Otherwise (QA failure or other) → human_review (default)

          persistStatus(failureStatus);
          // Include projectId for multi-project filtering (issue #723)
          safeSendToRenderer(
            getMainWindow,
            IPC_CHANNELS.TASK_STATUS_CHANGE,
            taskId,
            failureStatus,
            projectId
          );
        }
      }
    } catch (error) {
      console.error(`[Task ${taskId}] Exit handler error:`, error);
    }
  });

  agentManager.on("execution-progress", (taskId: string, progress: ExecutionProgressData) => {
    // Use shared helper to find task and project (issue #723 - deduplicate lookup)
    const { task, project } = findTaskAndProject(taskId);
    const taskProjectId = project?.id;

    // METRICS-1A: Record timestamps on phase transitions
    if (task && project) {
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const specDir = task.specsPath || path.join(project.path, specsBaseDir, task.specId);
      const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);

      // Record timestamps based on phase transitions
      const prevPhase = task.executionProgress?.phase;
      const currentPhase = progress.phase;

      // Detect phase completions and starts
      if (prevPhase !== currentPhase) {
        // Coding phase completed
        if (prevPhase === 'coding' && (currentPhase === 'qa_review' || currentPhase === 'complete')) {
          recordTaskTimestamp(planPath, 'coding_completed');
        }
        // AI Review started
        if (currentPhase === 'qa_review') {
          recordTaskTimestamp(planPath, 'ai_review_started');
        }
        // AI Review completed (moving to complete or failed)
        if (prevPhase === 'qa_review' && (currentPhase === 'complete' || currentPhase === 'failed')) {
          recordTaskTimestamp(planPath, 'ai_review_completed');
        }
        // QA Fixing phase (still in ai_review status)
        if (prevPhase === 'qa_fixing' && (currentPhase === 'complete' || currentPhase === 'failed')) {
          recordTaskTimestamp(planPath, 'ai_review_completed');
        }
      }
    }

    // Include projectId in execution progress event for multi-project filtering
    safeSendToRenderer(
      getMainWindow,
      IPC_CHANNELS.TASK_EXECUTION_PROGRESS,
      taskId,
      progress,
      taskProjectId
    );

    // FIX-6: Phase-to-status mapping that respects user-controlled gates
    // When task is in 'planning' STATUS, don't auto-transition to 'coding' STATUS
    // User must click "Start Build" to make that transition
    const phaseToStatus: Record<string, TaskStatus | null> = {
      idle: null,
      starting: "coding",  // Starting phase maps to coding status (initialization window)
      planning: null,      // FIX-6: Don't auto-change status when planning phase is emitted
      coding: "coding",
      qa_review: "ai_review",
      qa_fixing: "ai_review",
      complete: "human_review",
      failed: "human_review",
    };

    // FIX-6: Determine new status based on current task status and phase
    // If task is already in 'coding' status and planning phase is emitted, keep it as coding
    // This handles the case where coding agent internally does planning work
    let newStatus = phaseToStatus[progress.phase];

    // Special case: If task is in 'coding' status and phase is 'planning',
    // this is internal planning within coding agent - keep status as 'coding'
    if (task?.status === 'coding' && progress.phase === 'planning') {
      newStatus = 'coding';
    }
    // FIX (ACS-55, ACS-71): Validate status transition before sending/persisting
    if (newStatus && validateStatusTransition(task, newStatus, progress.phase)) {
      // Include projectId in status change event for multi-project filtering
      safeSendToRenderer(
        getMainWindow,
        IPC_CHANNELS.TASK_STATUS_CHANGE,
        taskId,
        newStatus,
        taskProjectId
      );

      // CRITICAL: Persist status to plan file(s) to prevent flip-flop on task list refresh
      // When getTasks() is called, it reads status from the plan file. Without persisting,
      // the status in the file might differ from the UI, causing inconsistent state.
      // Uses shared utility with locking to prevent race conditions.
      // IMPORTANT: We persist to BOTH main project AND worktree (if exists) to ensure
      // consistency, since getTasks() prefers the worktree version.
      if (task && project) {
        try {
          // Persist to main project plan file
          const mainPlanPath = getPlanPath(project, task);
          persistPlanStatusSync(mainPlanPath, newStatus, project.id);

          // Also persist to worktree plan file if it exists
          // This ensures consistency since getTasks() prefers worktree version
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
              persistPlanStatusSync(worktreePlanPath, newStatus, project.id);
            }
          }
        } catch (err) {
          // Ignore persistence errors - UI will still work, just might flip on refresh
          console.warn("[execution-progress] Could not persist status:", err);
        }
      }
    }
  });

  // ============================================
  // File Watcher Events → Renderer
  // ============================================

  fileWatcher.on("progress", (taskId: string, plan: ImplementationPlan) => {
    // Use shared helper to find project (issue #723 - deduplicate lookup)
    const { project } = findTaskAndProject(taskId);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_PROGRESS, taskId, plan, project?.id);
  });

  fileWatcher.on("error", (taskId: string, error: string) => {
    // Include projectId for multi-project filtering (issue #723)
    const { project } = findTaskAndProject(taskId);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_ERROR, taskId, error, project?.id);
  });
}
