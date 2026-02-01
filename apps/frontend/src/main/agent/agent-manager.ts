import { EventEmitter } from 'events';
import path from 'path';
import { existsSync } from 'fs';
import { AgentState } from './agent-state';
import { AgentEvents } from './agent-events';
import { AgentProcessManager } from './agent-process';
import { AgentQueueManager } from './agent-queue';
import { getClaudeProfileManager, initializeClaudeProfileManager } from '../claude-profile-manager';
import {
  SpecCreationMetadata,
  TaskExecutionOptions,
  RoadmapConfig
} from './types';
import type { IdeationConfig } from '../../shared/types';

/**
 * Phase 6: Agent mode for multi-agent support
 */
export type AgentMode = 'planning' | 'coding' | 'reviewing' | 'idle';

/**
 * Phase 6: Agent statistics for monitoring
 */
export interface AgentStats {
  planning: number;
  coding: number;
  reviewing: number;
  idle: number;
  total: number;
}

/**
 * Main AgentManager - orchestrates agent process lifecycle
 * This is a slim facade that delegates to focused modules
 */
export class AgentManager extends EventEmitter {
  private state: AgentState;
  private events: AgentEvents;
  private processManager: AgentProcessManager;
  private queueManager: AgentQueueManager;
  private taskExecutionContext: Map<string, {
    projectPath: string;
    specId: string;
    options: TaskExecutionOptions;
    isSpecCreation?: boolean;
    taskDescription?: string;
    specDir?: string;
    metadata?: SpecCreationMetadata;
    baseBranch?: string;
    swapCount: number;
  }> = new Map();

  /**
   * Phase 6: Track mode for each running agent
   * Maps taskId to agent mode
   */
  private agentModes: Map<string, AgentMode> = new Map();

  constructor() {
    super();

    // Initialize modular components
    this.state = new AgentState();
    this.events = new AgentEvents();
    this.processManager = new AgentProcessManager(this.state, this.events, this);
    this.queueManager = new AgentQueueManager(this.state, this.events, this.processManager, this);

    // Listen for auto-swap restart events
    this.on('auto-swap-restart-task', (taskId: string, newProfileId: string) => {
      console.log('[AgentManager] Received auto-swap-restart-task event:', { taskId, newProfileId });
      const success = this.restartTask(taskId, newProfileId);
      console.log('[AgentManager] Task restart result:', success ? 'SUCCESS' : 'FAILED');
    });

    // Listen for task completion to clean up context (prevent memory leak)
    this.on('exit', (taskId: string, code: number | null) => {
      // Clean up context when:
      // 1. Task completed successfully (code === 0), or
      // 2. Task failed and won't be restarted (handled by auto-swap logic)

      // Phase 6: Clean up agent mode when process exits
      this.agentModes.delete(taskId);

      // Note: Auto-swap restart happens BEFORE this exit event is processed,
      // so we need a small delay to allow restart to preserve context
      setTimeout(() => {
        const context = this.taskExecutionContext.get(taskId);
        if (!context) return; // Already cleaned up or restarted

        // If task completed successfully, always clean up
        if (code === 0) {
          this.taskExecutionContext.delete(taskId);
          return;
        }

        // If task failed and hit max retries, clean up
        if (context.swapCount >= 2) {
          this.taskExecutionContext.delete(taskId);
        }
        // Otherwise keep context for potential restart
      }, 1000); // Delay to allow restart logic to run first
    });
  }

  /**
   * Configure paths for Python and auto-claude source
   */
  configure(pythonPath?: string, autoBuildSourcePath?: string): void {
    this.processManager.configure(pythonPath, autoBuildSourcePath);
  }

  /**
   * Start spec creation process
   */
  async startSpecCreation(
    taskId: string,
    projectPath: string,
    taskDescription: string,
    specDir?: string,
    metadata?: SpecCreationMetadata,
    baseBranch?: string
  ): Promise<void> {
    // Pre-flight auth check: Verify active profile has valid authentication
    // Ensure profile manager is initialized to prevent race condition
    let profileManager;
    try {
      profileManager = await initializeClaudeProfileManager();
    } catch (error) {
      console.error('[AgentManager] Failed to initialize profile manager:', error);
      this.emit('error', taskId, 'Failed to initialize profile manager. Please check file permissions and disk space.');
      return;
    }
    if (!profileManager.hasValidAuth()) {
      this.emit('error', taskId, 'Claude authentication required. Please authenticate in Settings > Claude Profiles before starting tasks.');
      return;
    }

    // Ensure Python environment is ready before spawning process (prevents exit code 127 race condition)
    const pythonStatus = await this.processManager.ensurePythonEnvReady('AgentManager');
    if (!pythonStatus.ready) {
      this.emit('error', taskId, `Python environment not ready: ${pythonStatus.error || 'initialization failed'}`);
      return;
    }

    const autoBuildSource = this.processManager.getAutoBuildSourcePath();

    if (!autoBuildSource) {
      this.emit('error', taskId, 'Auto-build source path not found. Please configure it in App Settings.');
      return;
    }

    const specRunnerPath = path.join(autoBuildSource, 'runners', 'spec_runner.py');

    if (!existsSync(specRunnerPath)) {
      this.emit('error', taskId, `Spec runner not found at: ${specRunnerPath}`);
      return;
    }

    // Get combined environment variables
    const combinedEnv = this.processManager.getCombinedEnv(projectPath);

    // spec_runner.py will auto-start run.py after spec creation completes
    const args = [specRunnerPath, '--task', taskDescription, '--project-dir', projectPath];

    // Pass spec directory if provided (for UI-created tasks that already have a directory)
    if (specDir) {
      args.push('--spec-dir', specDir);
    }

    // Pass base branch if specified (ensures worktrees are created from the correct branch)
    if (baseBranch) {
      args.push('--base-branch', baseBranch);
    }

    // Check if user requires review before coding
    if (!metadata?.requireReviewBeforeCoding) {
      // Auto-approve: When user starts a task from the UI without requiring review
      args.push('--auto-approve');
    }

    // Pass model and thinking level configuration
    // For auto profile, use phase-specific config; otherwise use single model/thinking
    if (metadata?.isAutoProfile && metadata.phaseModels && metadata.phaseThinking) {
      // Pass the spec phase model and thinking level to spec_runner
      args.push('--model', metadata.phaseModels.spec);
      args.push('--thinking-level', metadata.phaseThinking.spec);
    } else if (metadata?.model) {
      // Non-auto profile: use single model and thinking level
      args.push('--model', metadata.model);
      if (metadata.thinkingLevel) {
        args.push('--thinking-level', metadata.thinkingLevel);
      }
    }

    // Workspace mode: --direct skips worktree isolation (default is isolated for safety)
    if (metadata?.useWorktree === false) {
      args.push('--direct');
    }

    // Store context for potential restart
    this.storeTaskContext(taskId, projectPath, '', {}, true, taskDescription, specDir, metadata, baseBranch);

    // Note: This is spec-creation but it chains to task-execution via run.py
    await this.processManager.spawnProcess(taskId, autoBuildSource, args, combinedEnv, 'task-execution');

    // Phase 6: Track agent mode - spec creation starts as 'coding' (will transition internally)
    this.agentModes.set(taskId, 'coding');
  }

  /**
   * Start planning agent for a newly created task.
   *
   * This method is called at task creation (Phase 2: Agent at Task Creation).
   * The agent runs in planning mode:
   * - Creates worktree for isolated development
   * - Creates initial spec.md and implementation_plan.json
   * - Responds to user chat messages
   * - Does NOT auto-continue to coding (waits for "Start Build" button)
   *
   * @param taskId - The task/spec ID
   * @param projectPath - Path to the project
   * @param taskDescription - Description of the task
   * @param specDir - Directory for the spec files (already created by TASK_CREATE)
   * @param metadata - Task metadata including model configuration
   * @param baseBranch - Base branch for worktree creation
   * @returns true if agent was started successfully
   */
  async startPlanningAgent(
    taskId: string,
    projectPath: string,
    taskDescription: string,
    specDir: string,
    metadata?: SpecCreationMetadata,
    baseBranch?: string
  ): Promise<boolean> {
    console.log('[AgentManager] Starting planning agent for task:', taskId);

    // Pre-flight auth check: Verify active profile has valid authentication
    let profileManager;
    try {
      profileManager = await initializeClaudeProfileManager();
    } catch (error) {
      console.error('[AgentManager] Failed to initialize profile manager:', error);
      this.emit('error', taskId, 'Failed to initialize profile manager. Please check file permissions and disk space.');
      return false;
    }
    if (!profileManager.hasValidAuth()) {
      this.emit('error', taskId, 'Claude authentication required. Please authenticate in Settings > Claude Profiles before starting tasks.');
      return false;
    }

    // Ensure Python environment is ready before spawning process
    const pythonStatus = await this.processManager.ensurePythonEnvReady('AgentManager');
    if (!pythonStatus.ready) {
      this.emit('error', taskId, `Python environment not ready: ${pythonStatus.error || 'initialization failed'}`);
      return false;
    }

    const autoBuildSource = this.processManager.getAutoBuildSourcePath();

    if (!autoBuildSource) {
      this.emit('error', taskId, 'Auto-build source path not found. Please configure it in App Settings.');
      return false;
    }

    const specRunnerPath = path.join(autoBuildSource, 'runners', 'spec_runner.py');

    if (!existsSync(specRunnerPath)) {
      this.emit('error', taskId, `Spec runner not found at: ${specRunnerPath}`);
      return false;
    }

    // Get combined environment variables
    const combinedEnv = this.processManager.getCombinedEnv(projectPath);

    // Build arguments for spec_runner.py in PLANNING MODE
    // Key difference from startSpecCreation: NO --auto-approve flag
    // This means the agent creates the spec but pauses before coding
    const args = [specRunnerPath, '--task', taskDescription, '--project-dir', projectPath];

    // Pass spec directory (already created by TASK_CREATE)
    args.push('--spec-dir', specDir);

    // Pass base branch if specified (ensures worktrees are created from the correct branch)
    if (baseBranch) {
      args.push('--base-branch', baseBranch);
    }

    // PLANNING MODE: Pass --auto-approve to skip CLI review (user approves via "Start Build" in UI)
    // Pass --no-build to prevent automatic run.py execution (build starts when user clicks "Start Build")
    args.push('--auto-approve');
    args.push('--no-build');

    // Pass model and thinking level configuration
    if (metadata?.isAutoProfile && metadata.phaseModels && metadata.phaseThinking) {
      // For auto profile, use spec phase config for planning
      args.push('--model', metadata.phaseModels.spec);
      args.push('--thinking-level', metadata.phaseThinking.spec);
    } else if (metadata?.model) {
      // Non-auto profile: use single model and thinking level
      args.push('--model', metadata.model);
      if (metadata.thinkingLevel) {
        args.push('--thinking-level', metadata.thinkingLevel);
      }
    }

    // Workspace mode: --direct skips worktree isolation (default is isolated for safety)
    if (metadata?.useWorktree === false) {
      args.push('--direct');
    }

    // Store context for potential restart (mark as planning mode)
    this.storeTaskContext(taskId, projectPath, '', {}, true, taskDescription, specDir, metadata, baseBranch);

    // Spawn the planning agent process
    try {
      await this.processManager.spawnProcess(taskId, autoBuildSource, args, combinedEnv, 'planning');
      console.log('[AgentManager] Planning agent started successfully for task:', taskId);

      // Phase 6: Track agent mode
      this.agentModes.set(taskId, 'planning');

      return true;
    } catch (error) {
      console.error('[AgentManager] Failed to start planning agent:', error);
      this.emit('error', taskId, `Failed to start planning agent: ${error instanceof Error ? error.message : 'unknown error'}`);
      return false;
    }
  }

  /**
   * Start task execution (run.py)
   */
  async startTaskExecution(
    taskId: string,
    projectPath: string,
    specId: string,
    options: TaskExecutionOptions = {}
  ): Promise<void> {
    // Pre-flight auth check: Verify active profile has valid authentication
    // Ensure profile manager is initialized to prevent race condition
    let profileManager;
    try {
      profileManager = await initializeClaudeProfileManager();
    } catch (error) {
      console.error('[AgentManager] Failed to initialize profile manager:', error);
      this.emit('error', taskId, 'Failed to initialize profile manager. Please check file permissions and disk space.');
      return;
    }
    if (!profileManager.hasValidAuth()) {
      this.emit('error', taskId, 'Claude authentication required. Please authenticate in Settings > Claude Profiles before starting tasks.');
      return;
    }

    // Ensure Python environment is ready before spawning process (prevents exit code 127 race condition)
    const pythonStatus = await this.processManager.ensurePythonEnvReady('AgentManager');
    if (!pythonStatus.ready) {
      this.emit('error', taskId, `Python environment not ready: ${pythonStatus.error || 'initialization failed'}`);
      return;
    }

    const autoBuildSource = this.processManager.getAutoBuildSourcePath();

    if (!autoBuildSource) {
      this.emit('error', taskId, 'Auto-build source path not found. Please configure it in App Settings.');
      return;
    }

    const runPath = path.join(autoBuildSource, 'run.py');

    if (!existsSync(runPath)) {
      this.emit('error', taskId, `Run script not found at: ${runPath}`);
      return;
    }

    // Get combined environment variables
    const combinedEnv = this.processManager.getCombinedEnv(projectPath);

    const args = [runPath, '--spec', specId, '--project-dir', projectPath];

    // Always use auto-continue when running from UI (non-interactive)
    args.push('--auto-continue');

    // Force: When user starts a task from the UI, that IS their approval
    args.push('--force');

    // Workspace mode: --direct skips worktree isolation (default is isolated for safety)
    if (options.useWorktree === false) {
      args.push('--direct');
    }

    // Pass base branch if specified (ensures worktrees are created from the correct branch)
    if (options.baseBranch) {
      args.push('--base-branch', options.baseBranch);
    }

    // Note: --parallel was removed from run.py CLI - parallel execution is handled internally by the agent
    // The options.parallel and options.workers are kept for future use or logging purposes
    // Note: Model configuration is read from task_metadata.json by the Python scripts,
    // which allows per-phase configuration for planner, coder, and QA phases

    // Store context for potential restart
    this.storeTaskContext(taskId, projectPath, specId, options, false);

    await this.processManager.spawnProcess(taskId, autoBuildSource, args, combinedEnv, 'task-execution');

    // Phase 6: Track agent mode
    this.agentModes.set(taskId, 'coding');
  }

  /**
   * Start QA process
   */
  async startQAProcess(
    taskId: string,
    projectPath: string,
    specId: string
  ): Promise<void> {
    // Ensure Python environment is ready before spawning process (prevents exit code 127 race condition)
    const pythonStatus = await this.processManager.ensurePythonEnvReady('AgentManager');
    if (!pythonStatus.ready) {
      this.emit('error', taskId, `Python environment not ready: ${pythonStatus.error || 'initialization failed'}`);
      return;
    }

    const autoBuildSource = this.processManager.getAutoBuildSourcePath();

    if (!autoBuildSource) {
      this.emit('error', taskId, 'Auto-build source path not found. Please configure it in App Settings.');
      return;
    }

    const runPath = path.join(autoBuildSource, 'run.py');

    if (!existsSync(runPath)) {
      this.emit('error', taskId, `Run script not found at: ${runPath}`);
      return;
    }

    // Get combined environment variables
    const combinedEnv = this.processManager.getCombinedEnv(projectPath);

    const args = [runPath, '--spec', specId, '--project-dir', projectPath, '--qa'];

    await this.processManager.spawnProcess(taskId, autoBuildSource, args, combinedEnv, 'qa-process');

    // Phase 6: Track agent mode
    this.agentModes.set(taskId, 'reviewing');
  }

  /**
   * Start roadmap generation process
   */
  startRoadmapGeneration(
    projectId: string,
    projectPath: string,
    refresh: boolean = false,
    enableCompetitorAnalysis: boolean = false,
    refreshCompetitorAnalysis: boolean = false,
    config?: RoadmapConfig
  ): void {
    this.queueManager.startRoadmapGeneration(projectId, projectPath, refresh, enableCompetitorAnalysis, refreshCompetitorAnalysis, config);
  }

  /**
   * Start ideation generation process
   */
  startIdeationGeneration(
    projectId: string,
    projectPath: string,
    config: IdeationConfig,
    refresh: boolean = false
  ): void {
    this.queueManager.startIdeationGeneration(projectId, projectPath, config, refresh);
  }

  /**
   * Kill a specific task's process
   */
  killTask(taskId: string): boolean {
    return this.processManager.killProcess(taskId);
  }

  /**
   * Stop ideation generation for a project
   */
  stopIdeation(projectId: string): boolean {
    return this.queueManager.stopIdeation(projectId);
  }

  /**
   * Check if ideation is running for a project
   */
  isIdeationRunning(projectId: string): boolean {
    return this.queueManager.isIdeationRunning(projectId);
  }

  /**
   * Stop roadmap generation for a project
   */
  stopRoadmap(projectId: string): boolean {
    return this.queueManager.stopRoadmap(projectId);
  }

  /**
   * Check if roadmap is running for a project
   */
  isRoadmapRunning(projectId: string): boolean {
    return this.queueManager.isRoadmapRunning(projectId);
  }

  /**
   * Kill all running processes
   */
  async killAll(): Promise<void> {
    await this.processManager.killAllProcesses();
  }

  /**
   * Check if a task is running
   */
  isRunning(taskId: string): boolean {
    return this.state.hasProcess(taskId);
  }

  /**
   * Send a message to a running task's agent via stdin.
   * The message is queued and processed at the next iteration boundary.
   */
  sendMessageToTask(taskId: string, message: string): boolean {
    return this.processManager.sendMessageToTask(taskId, message);
  }

  /**
   * Get all running task IDs
   */
  getRunningTasks(): string[] {
    return this.state.getRunningTaskIds();
  }

  /**
   * Store task execution context for potential restarts
   */
  private storeTaskContext(
    taskId: string,
    projectPath: string,
    specId: string,
    options: TaskExecutionOptions,
    isSpecCreation?: boolean,
    taskDescription?: string,
    specDir?: string,
    metadata?: SpecCreationMetadata,
    baseBranch?: string
  ): void {
    // Preserve swapCount if context already exists (for restarts)
    const existingContext = this.taskExecutionContext.get(taskId);
    const swapCount = existingContext?.swapCount ?? 0;

    this.taskExecutionContext.set(taskId, {
      projectPath,
      specId,
      options,
      isSpecCreation,
      taskDescription,
      specDir,
      metadata,
      baseBranch,
      swapCount // Preserve existing count instead of resetting
    });
  }

  /**
   * Restart task after profile swap
   * @param taskId - The task to restart
   * @param newProfileId - Optional new profile ID to apply (from auto-swap)
   */
  restartTask(taskId: string, newProfileId?: string): boolean {
    console.log('[AgentManager] restartTask called for:', taskId, 'with newProfileId:', newProfileId);

    const context = this.taskExecutionContext.get(taskId);
    if (!context) {
      console.error('[AgentManager] No context for task:', taskId);
      console.log('[AgentManager] Available task contexts:', Array.from(this.taskExecutionContext.keys()));
      return false;
    }

    console.log('[AgentManager] Task context found:', {
      taskId,
      projectPath: context.projectPath,
      specId: context.specId,
      isSpecCreation: context.isSpecCreation,
      swapCount: context.swapCount
    });

    // Prevent infinite swap loops
    if (context.swapCount >= 2) {
      console.error('[AgentManager] Max swap count reached for task:', taskId, '- stopping restart loop');
      return false;
    }

    context.swapCount++;
    console.log('[AgentManager] Incremented swap count to:', context.swapCount);

    // If a new profile was specified, ensure it's set as active before restart
    if (newProfileId) {
      const profileManager = getClaudeProfileManager();
      const currentActiveId = profileManager.getActiveProfile()?.id;
      if (currentActiveId !== newProfileId) {
        console.log('[AgentManager] Setting active profile to:', newProfileId);
        profileManager.setActiveProfile(newProfileId);
      }
    }

    // Kill current process
    console.log('[AgentManager] Killing current process for task:', taskId);
    this.killTask(taskId);

    // Wait for cleanup, then restart
    console.log('[AgentManager] Scheduling task restart in 500ms');
    setTimeout(() => {
      console.log('[AgentManager] Restarting task now:', taskId);
      if (context.isSpecCreation) {
        console.log('[AgentManager] Restarting as spec creation');
        this.startSpecCreation(
          taskId,
          context.projectPath,
          context.taskDescription!,
          context.specDir,
          context.metadata,
          context.baseBranch
        );
      } else {
        console.log('[AgentManager] Restarting as task execution');
        this.startTaskExecution(
          taskId,
          context.projectPath,
          context.specId,
          context.options
        );
      }
    }, 500);

    return true;
  }

  /**
   * Phase 6: Get the mode of a specific agent
   */
  getAgentMode(taskId: string): AgentMode | undefined {
    return this.agentModes.get(taskId);
  }

  /**
   * Phase 6: Set the mode of a specific agent
   * Used when task transitions between phases (e.g., planning -> coding)
   */
  setAgentMode(taskId: string, mode: AgentMode): void {
    if (this.state.hasProcess(taskId)) {
      this.agentModes.set(taskId, mode);
      console.log(`[AgentManager] Set agent mode for ${taskId} to ${mode}`);
    }
  }

  /**
   * Phase 6: Get statistics about running agents
   * Useful for monitoring and resource management
   */
  getAgentStats(): AgentStats {
    const stats: AgentStats = {
      planning: 0,
      coding: 0,
      reviewing: 0,
      idle: 0,
      total: 0
    };

    for (const mode of this.agentModes.values()) {
      stats[mode]++;
      stats.total++;
    }

    return stats;
  }

  /**
   * Phase 6: Graceful shutdown - stops all agents and waits for cleanup
   * Should be called on app close
   */
  async gracefulShutdown(): Promise<void> {
    console.log('[AgentManager] Starting graceful shutdown...');
    const runningTasks = this.getRunningTasks();

    if (runningTasks.length === 0) {
      console.log('[AgentManager] No running tasks to shutdown');
      return;
    }

    console.log(`[AgentManager] Stopping ${runningTasks.length} running agent(s)...`);

    // Send SIGTERM to all processes
    await this.killAll();

    // Wait for processes to exit (with timeout)
    const maxWaitMs = 5000;
    const startTime = Date.now();

    while (this.getRunningTasks().length > 0 && Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const remaining = this.getRunningTasks();
    if (remaining.length > 0) {
      console.warn(`[AgentManager] ${remaining.length} agent(s) did not exit gracefully, forcing kill`);
      // Force kill is already handled by killAll, just log the warning
    }

    // Clear all mode tracking
    this.agentModes.clear();
    this.taskExecutionContext.clear();

    console.log('[AgentManager] Graceful shutdown complete');
  }
}
