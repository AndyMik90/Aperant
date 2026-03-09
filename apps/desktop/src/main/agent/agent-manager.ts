import { EventEmitter } from 'events';
import path from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { AgentState } from './agent-state';
import { AgentEvents } from './agent-events';
import { AgentProcessManager } from './agent-process';
import { AgentQueueManager } from './agent-queue';
import { getClaudeProfileManager, initializeClaudeProfileManager } from '../claude-profile-manager';
import type { ClaudeProfileManager } from '../claude-profile-manager';
import { getOperationRegistry } from '../claude-profile/operation-registry';
import {
  SpecCreationMetadata,
  TaskExecutionOptions,
  RoadmapConfig
} from './types';
import type { IdeationConfig } from '../../shared/types';
import { resetStuckSubtasks } from '../ipc-handlers/task/plan-file-utils';
import { AUTO_BUILD_PATHS, getSpecsDir } from '../../shared/constants';
import { projectStore } from '../project-store';
import { resolveAuth, resolveAuthFromQueue } from '../ai/auth/resolver';
import { resolveModelId } from '../ai/config/phase-config';
import { detectProviderFromModel } from '../ai/providers/factory';
import { resolveModelEquivalent } from '../../shared/constants/models';
import type { BuiltinProvider } from '../../shared/types/provider-account';
import type { AgentExecutorConfig, SerializableSessionConfig, SerializedSecurityProfile } from '../ai/agent/types';
import { getSecurityProfile } from '../ai/security/security-profile';
import { createOrGetWorktree } from '../ai/worktree';
import { findTaskWorktree } from '../worktree-paths';
import { readSettingsFile } from '../settings-utils';
import type { ProviderAccount } from '../../shared/types/provider-account';
import { tryLoadPrompt } from '../ai/prompts/prompt-loader';

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
    projectId?: string;
    /** Generation counter to prevent stale cleanup after restart */
    generation: number;
  }> = new Map();

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
    this.on('exit', (taskId: string, code: number | null, _processType?: string, _projectId?: string) => {
      // Clean up context when:
      // 1. Task completed successfully (code === 0), or
      // 2. Task failed and won't be restarted (handled by auto-swap logic)

      // Capture generation at exit time to prevent race conditions with restarts
      const contextAtExit = this.taskExecutionContext.get(taskId);
      const generationAtExit = contextAtExit?.generation;

      // Note: Auto-swap restart happens BEFORE this exit event is processed,
      // so we need a small delay to allow restart to preserve context
      setTimeout(() => {
        const context = this.taskExecutionContext.get(taskId);
        if (!context) return; // Already cleaned up or restarted

        // Check if the context's generation matches - if not, a restart incremented it
        // and this cleanup is for a stale exit event that shouldn't affect the new task
        if (generationAtExit !== undefined && context.generation !== generationAtExit) {
          return; // Stale exit event - task was restarted, don't clean up new context
        }

        // If task completed successfully, always clean up
        if (code === 0) {
          this.taskExecutionContext.delete(taskId);
          // Unregister from OperationRegistry
          getOperationRegistry().unregisterOperation(taskId);
          return;
        }

        // If task failed and hit max retries, clean up
        if (context.swapCount >= 2) {
          this.taskExecutionContext.delete(taskId);
          // Unregister from OperationRegistry
          getOperationRegistry().unregisterOperation(taskId);
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
   * Check if any provider account is configured (API key or OAuth).
   * Used to bypass the legacy hasValidAuth() check for non-Anthropic providers.
   */
  private hasAnyProviderAccount(): boolean {
    const settings = readSettingsFile();
    const accounts = (settings?.providerAccounts as ProviderAccount[] | undefined) ?? [];
    return accounts.length > 0;
  }

  /**
   * Resolve auth using the provider accounts priority queue.
   * Falls back to legacy Claude profile if no provider accounts exist.
   */
  private async resolveAuthFromProviderQueue(
    requestedModel: string,
    preferredProvider?: string | null,
  ): Promise<{
    auth: { apiKey?: string; baseURL?: string; oauthTokenFilePath?: string } | null;
    provider: string;
    modelId: string;
    configDir?: string;
  }> {
    // Read provider accounts and priority order from settings
    const settings = readSettingsFile();
    const accounts = (settings?.providerAccounts as ProviderAccount[] | undefined) ?? [];
    const priorityOrder = (settings?.globalPriorityOrder as string[] | undefined) ?? [];

    if (accounts.length > 0 && priorityOrder.length > 0) {
      // Sort accounts by priority order
      const orderedQueue = priorityOrder
        .map(id => accounts.find(a => a.id === id))
        .filter((a): a is ProviderAccount => a != null);

      // Add any accounts not in the priority order at the end
      for (const account of accounts) {
        if (!priorityOrder.includes(account.id)) {
          orderedQueue.push(account);
        }
      }

      // If a preferred provider is specified, reorder queue to try that provider first
      if (preferredProvider) {
        const preferred: ProviderAccount[] = [];
        const rest: ProviderAccount[] = [];
        for (const acct of orderedQueue) {
          if (acct.provider === preferredProvider) {
            preferred.push(acct);
          } else {
            rest.push(acct);
          }
        }
        orderedQueue.splice(0, orderedQueue.length, ...preferred, ...rest);
      }

      const resolved = await resolveAuthFromQueue(requestedModel, orderedQueue);
      if (resolved) {
        console.warn(`[AgentManager] Resolved auth from provider queue: account=${resolved.accountId} provider=${resolved.resolvedProvider} model=${resolved.resolvedModelId}`);
        return {
          auth: resolved,
          provider: resolved.resolvedProvider,
          modelId: resolved.resolvedModelId,
          configDir: undefined, // Queue-based auth handles its own token refresh
        };
      }
      console.warn('[AgentManager] No available account in provider queue, falling back to legacy profile');
    }

    // Fallback: legacy Claude profile system
    const profileManager = getClaudeProfileManager();
    const activeProfile = profileManager?.getActiveProfile();
    const configDir = activeProfile?.configDir;
    const auth = await resolveAuth({ provider: 'anthropic', configDir });
    const provider = detectProviderFromModel(requestedModel) ?? 'anthropic';
    return { auth, provider, modelId: requestedModel, configDir };
  }

  /**
   * Run startup recovery scan to detect and reset stuck subtasks on app launch
   * Scans all projects for implementation_plan.json files and resets any stuck subtasks
   */
  async runStartupRecoveryScan(): Promise<void> {
    console.log('[AgentManager] Running startup recovery scan for stuck subtasks...');

    try {
      // Get all projects from the store
      const projects = projectStore.getProjects();

      if (projects.length === 0) {
        console.log('[AgentManager] No projects found - skipping startup recovery scan');
        return;
      }

      let totalScanned = 0;
      let totalReset = 0;

      // Scan each project for stuck subtasks
      for (const project of projects) {
        if (!project.autoBuildPath) {
          continue; // Skip projects that haven't been initialized yet
        }

        const specsDir = path.join(project.path, getSpecsDir(project.autoBuildPath));

        // Check if specs directory exists
        if (!existsSync(specsDir)) {
          continue;
        }

        // Read all spec directories
        try {
          const specDirs = readdirSync(specsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

          // Process each spec directory
          for (const specDirName of specDirs) {
            const planPath = path.join(specsDir, specDirName, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);

            // Check if implementation_plan.json exists
            if (!existsSync(planPath)) {
              continue;
            }

            totalScanned++;

            // Reset stuck subtasks (pass project.id to invalidate tasks cache)
            const { success, resetCount } = await resetStuckSubtasks(planPath, project.id);

            if (success && resetCount > 0) {
              totalReset += resetCount;
              console.log(`[AgentManager] Startup recovery: Reset ${resetCount} stuck subtask(s) in ${specDirName}`);
            }
          }
        } catch (err) {
          console.warn(`[AgentManager] Failed to scan specs directory for project ${project.name}:`, err);
        }
      }

      if (totalReset > 0) {
        console.log(`[AgentManager] Startup recovery complete: Reset ${totalReset} stuck subtask(s) across ${totalScanned} task(s)`);
      } else {
        console.log(`[AgentManager] Startup recovery complete: No stuck subtasks found (scanned ${totalScanned} task(s))`);
      }
    } catch (err) {
      console.error('[AgentManager] Startup recovery scan failed:', err);
    }
  }

  /**
   * Register a task with the unified OperationRegistry for proactive swap support.
   * Extracted helper to avoid code duplication between spec creation and task execution.
   * @private
   */
  private registerTaskWithOperationRegistry(
    taskId: string,
    operationType: 'spec-creation' | 'task-execution',
    metadata: Record<string, unknown>
  ): void {
    const profileManager = getClaudeProfileManager();
    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile) {
      return;
    }

    // Keep internal state tracking for backward compatibility
    this.assignProfileToTask(taskId, activeProfile.id, activeProfile.name, 'proactive');

    // Register with unified registry for proactive swap
    // Note: We don't provide a stopFn because restartTask() already handles stopping
    // the task internally via killTask() before restarting. Providing a separate
    // stopFn would cause a redundant double-kill during profile swaps.
    const operationRegistry = getOperationRegistry();
    operationRegistry.registerOperation(
      taskId,
      operationType,
      activeProfile.id,
      activeProfile.name,
      (newProfileId: string) => this.restartTask(taskId, newProfileId),
      { metadata }
    );
    console.log('[AgentManager] Task registered with OperationRegistry:', {
      taskId,
      profileId: activeProfile.id,
      profileName: activeProfile.name,
      type: operationType
    });
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
    baseBranch?: string,
    projectId?: string
  ): Promise<void> {
    // Pre-flight auth check: Verify active profile has valid authentication
    // Ensure profile manager is initialized to prevent race condition
    let profileManager: ClaudeProfileManager;
    try {
      profileManager = await initializeClaudeProfileManager();
    } catch (error) {
      console.error('[AgentManager] Failed to initialize profile manager:', error);
      this.emit('error', taskId, 'Failed to initialize profile manager. Please check file permissions and disk space.');
      return;
    }
    if (!profileManager.hasValidAuth() && !this.hasAnyProviderAccount()) {
      this.emit('error', taskId, 'Authentication required. Please add an account in Settings > Accounts before starting tasks.');
      return;
    }

    // Reset stuck subtasks if restarting an existing spec creation task
    if (specDir) {
      const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
      console.log('[AgentManager] Resetting stuck subtasks before spec creation restart:', planPath);
      try {
        const { success, resetCount } = await resetStuckSubtasks(planPath);
        if (success && resetCount > 0) {
          console.log(`[AgentManager] Successfully reset ${resetCount} stuck subtask(s) before spec creation`);
        }
      } catch (err) {
        console.warn('[AgentManager] Failed to reset stuck subtasks before spec creation:', err);
      }
    }

    // Resolve model and thinking level for the spec phase
    const specModelShorthand = metadata?.phaseModels?.spec
      ? metadata.phaseModels.spec
      : (metadata?.model ?? 'sonnet');

    // Determine the preferred provider (from metadata or task_metadata.json)
    const preferredProvider = (
      specDir ? this.resolveTaskPhaseProvider(specDir, 'spec') : null
    ) ?? (metadata?.provider as string | undefined) ?? null;

    // Resolve the model ID, translating to the target provider's equivalent if needed
    let specModelId: string;
    if (preferredProvider && preferredProvider !== 'anthropic') {
      const equiv = resolveModelEquivalent(specModelShorthand, preferredProvider as BuiltinProvider)
        ?? resolveModelEquivalent(resolveModelId(specModelShorthand), preferredProvider as BuiltinProvider);
      specModelId = equiv?.modelId ?? specModelShorthand;
    } else {
      specModelId = resolveModelId(specModelShorthand);
    }

    // Load system prompt from prompts directory
    const systemPrompt = this.loadPrompt('spec_orchestrator') ?? this.buildDefaultSpecPrompt(taskDescription, specDir);

    // Resolve auth from provider accounts priority queue (falls back to legacy profile)
    const resolved = await this.resolveAuthFromProviderQueue(specModelId, preferredProvider);

    // Build the serializable session config for the worker
    const resolvedSpecDir = specDir ?? path.join(projectPath, '.auto-claude', 'specs', taskId);
    const sessionConfig: SerializableSessionConfig = {
      agentType: 'spec_orchestrator' as const,
      systemPrompt,
      phase: 'spec' as const,
      initialMessages: [
        {
          role: 'user',
          content: `Task: ${taskDescription}\n\nProject directory: ${projectPath}${specDir ? `\nSpec directory: ${specDir}` : ''}${baseBranch ? `\nBase branch: ${baseBranch}` : ''}${metadata?.requireReviewBeforeCoding ? '\nRequire review before coding: true' : '\nAuto-approve: true'}`,
        },
      ],
      maxSteps: 1000,
      specDir: resolvedSpecDir,
      projectDir: projectPath,
      provider: resolved.provider,
      modelId: resolved.modelId,
      apiKey: resolved.auth?.apiKey,
      baseURL: resolved.auth?.baseURL,
      configDir: resolved.configDir,
      oauthTokenFilePath: resolved.auth?.oauthTokenFilePath,
      mcpOptions: {
        context7Enabled: true,
        memoryEnabled: !!process.env.GRAPHITI_MCP_URL,
        linearEnabled: !!process.env.LINEAR_API_KEY,
      },
      toolContext: {
        cwd: projectPath,
        projectDir: projectPath,
        specDir: resolvedSpecDir,
        securityProfile: this.serializeSecurityProfile(projectPath),
      },
    };

    const executorConfig: AgentExecutorConfig = {
      taskId,
      projectId,
      processType: 'spec-creation',
      session: sessionConfig,
    };

    // Store context for potential restart
    this.storeTaskContext(taskId, projectPath, '', {}, true, taskDescription, specDir, metadata, baseBranch, projectId);

    // Register with unified OperationRegistry for proactive swap support
    this.registerTaskWithOperationRegistry(taskId, 'spec-creation', { projectPath, taskDescription, specDir });

    await this.processManager.spawnWorkerProcess(taskId, executorConfig, {}, 'spec-creation', projectId);

    // Note (Python fallback preserved for reference):
    // const combinedEnv = this.processManager.getCombinedEnv(projectPath);
    // const args = [specRunnerPath, '--task', taskDescription, '--project-dir', projectPath];
    // await this.processManager.spawnProcess(taskId, projectPath, args, combinedEnv, 'task-execution', projectId);
  }

  /**
   * Start task execution (build orchestrator)
   */
  async startTaskExecution(
    taskId: string,
    projectPath: string,
    specId: string,
    options: TaskExecutionOptions = {},
    projectId?: string
  ): Promise<void> {
    // Pre-flight auth check: Verify active profile has valid authentication
    // Ensure profile manager is initialized to prevent race condition
    let profileManager: ClaudeProfileManager;
    try {
      profileManager = await initializeClaudeProfileManager();
    } catch (error) {
      console.error('[AgentManager] Failed to initialize profile manager:', error);
      this.emit('error', taskId, 'Failed to initialize profile manager. Please check file permissions and disk space.');
      return;
    }
    if (!profileManager.hasValidAuth() && !this.hasAnyProviderAccount()) {
      this.emit('error', taskId, 'Authentication required. Please add an account in Settings > Accounts before starting tasks.');
      return;
    }

    // Resolve the spec directory from specId
    const project = projectStore.getProjects().find((p) => p.id === projectId || p.path === projectPath);
    const specsBaseDir = getSpecsDir(project?.autoBuildPath);
    const specDir = path.join(projectPath, specsBaseDir, specId);

    // Load model configuration from task_metadata.json if available
    const modelId = await this.resolveTaskModelId(specDir, 'planning');
    const preferredProvider = this.resolveTaskPhaseProvider(specDir, 'planning');

    // Load system prompt (planner prompt for build orchestrator entry point)
    const systemPrompt = this.loadPrompt('planner') ?? this.buildDefaultPlannerPrompt(specId, projectPath);

    // Resolve auth from provider accounts priority queue (falls back to legacy profile)
    const resolved = await this.resolveAuthFromProviderQueue(modelId, preferredProvider);

    // Create or get existing git worktree for task isolation
    // This matches the Python backend's WorktreeManager.create_worktree() behavior
    let worktreePath: string | null = null;
    let worktreeSpecDir = specDir;
    const useWorktree = options.useWorktree !== false; // Default to true (matching Python backend)
    if (useWorktree) {
      try {
        const baseBranch = options.baseBranch ?? project?.settings?.mainBranch ?? 'main';
        const result = await createOrGetWorktree(
          projectPath,
          specId,
          baseBranch,
          options.useLocalBranch ?? false,
          project?.settings?.pushNewBranches !== false,
          project?.autoBuildPath,
        );
        worktreePath = result.worktreePath;
        // Spec dir in the worktree (spec files were copied by createOrGetWorktree)
        worktreeSpecDir = path.join(worktreePath, specsBaseDir, specId);
        console.warn(`[AgentManager] Task ${taskId} will run in worktree: ${worktreePath}`);
      } catch (err) {
        console.error(`[AgentManager] Failed to create worktree for ${taskId}:`, err);
        // Fall back to running in project root (non-fatal)
        console.warn(`[AgentManager] Falling back to project root for ${taskId}`);
      }
    }

    const effectiveCwd = worktreePath ?? projectPath;
    const effectiveProjectDir = worktreePath ?? projectPath;

    // Load initial context from spec directory
    const initialMessages = this.buildTaskExecutionMessages(worktreeSpecDir, specId, effectiveProjectDir);

    // Build the serializable session config for the worker
    const sessionConfig: SerializableSessionConfig = {
      agentType: 'build_orchestrator' as const,
      systemPrompt,
      initialMessages,
      maxSteps: 1000,
      specDir: worktreeSpecDir,
      projectDir: effectiveProjectDir,
      // When running in a worktree, sourceSpecDir points to the main project spec dir
      // so the subtask iterator can sync phase updates in real time (not just on exit).
      sourceSpecDir: worktreePath ? specDir : undefined,
      provider: resolved.provider,
      modelId: resolved.modelId,
      apiKey: resolved.auth?.apiKey,
      baseURL: resolved.auth?.baseURL,
      configDir: resolved.configDir,
      oauthTokenFilePath: resolved.auth?.oauthTokenFilePath,
      mcpOptions: {
        context7Enabled: true,
        memoryEnabled: !!process.env.GRAPHITI_MCP_URL,
        linearEnabled: !!process.env.LINEAR_API_KEY,
      },
      toolContext: {
        cwd: effectiveCwd,
        projectDir: effectiveProjectDir,
        specDir: worktreeSpecDir,
        securityProfile: this.serializeSecurityProfile(effectiveProjectDir),
      },
    };

    const executorConfig: AgentExecutorConfig = {
      taskId,
      projectId,
      processType: 'task-execution',
      session: sessionConfig,
    };

    // Store context for potential restart
    this.storeTaskContext(taskId, projectPath, specId, options, false, undefined, undefined, undefined, undefined, projectId);

    // Register with unified OperationRegistry for proactive swap support
    this.registerTaskWithOperationRegistry(taskId, 'task-execution', { projectPath, specId, options });

    await this.processManager.spawnWorkerProcess(taskId, executorConfig, {}, 'task-execution', projectId);

    // Note (Python fallback preserved for reference):
    // const combinedEnv = this.processManager.getCombinedEnv(projectPath);
    // const args = [runPath, '--spec', specId, '--project-dir', projectPath, '--auto-continue', '--force'];
    // await this.processManager.spawnProcess(taskId, projectPath, args, combinedEnv, 'task-execution', projectId);
  }

  /**
   * Start QA process (qa_reviewer agent)
   */
  async startQAProcess(
    taskId: string,
    projectPath: string,
    specId: string,
    projectId?: string
  ): Promise<void> {
    // Ensure profile manager is initialized for auth resolution
    let profileManager: ClaudeProfileManager;
    try {
      profileManager = await initializeClaudeProfileManager();
    } catch (error) {
      console.error('[AgentManager] Failed to initialize profile manager:', error);
      this.emit('error', taskId, 'Failed to initialize profile manager. Please check file permissions and disk space.');
      return;
    }
    if (!profileManager.hasValidAuth() && !this.hasAnyProviderAccount()) {
      this.emit('error', taskId, 'Authentication required. Please add an account in Settings > Accounts before starting tasks.');
      return;
    }

    // Resolve the spec directory from specId
    const project = projectStore.getProjects().find((p) => p.id === projectId || p.path === projectPath);
    const specsBaseDir = getSpecsDir(project?.autoBuildPath);
    const specDir = path.join(projectPath, specsBaseDir, specId);

    // Load model configuration from task_metadata.json if available
    const modelId = await this.resolveTaskModelId(specDir, 'qa');
    const preferredProvider = this.resolveTaskPhaseProvider(specDir, 'qa');

    // Load system prompt for QA reviewer
    const systemPrompt = this.loadPrompt('qa_reviewer') ?? this.buildDefaultQAPrompt(specId, projectPath);

    // Resolve auth from provider accounts priority queue (falls back to legacy profile)
    const resolved = await this.resolveAuthFromProviderQueue(modelId, preferredProvider);

    // Find existing worktree for QA (created during task execution)
    const worktreePath = findTaskWorktree(projectPath, specId);
    const effectiveCwd = worktreePath ?? projectPath;
    const effectiveProjectDir = worktreePath ?? projectPath;
    const effectiveSpecDir = worktreePath
      ? path.join(worktreePath, specsBaseDir, specId)
      : specDir;

    if (worktreePath) {
      console.warn(`[AgentManager] QA for ${taskId} will run in worktree: ${worktreePath}`);
    } else {
      console.warn(`[AgentManager] No worktree found for ${taskId}, QA running in project root`);
    }

    // Load initial context from spec directory
    const qaInitialMessages = this.buildQAInitialMessages(effectiveSpecDir, specId, effectiveProjectDir);

    // Build the serializable session config for the worker
    const sessionConfig: SerializableSessionConfig = {
      agentType: 'qa_reviewer',
      systemPrompt,
      initialMessages: qaInitialMessages,
      maxSteps: 1000,
      specDir: effectiveSpecDir,
      projectDir: effectiveProjectDir,
      provider: resolved.provider,
      modelId: resolved.modelId,
      apiKey: resolved.auth?.apiKey,
      baseURL: resolved.auth?.baseURL,
      configDir: resolved.configDir,
      oauthTokenFilePath: resolved.auth?.oauthTokenFilePath,
      mcpOptions: {
        context7Enabled: true,
        memoryEnabled: !!process.env.GRAPHITI_MCP_URL,
        linearEnabled: !!process.env.LINEAR_API_KEY,
      },
      toolContext: {
        cwd: effectiveCwd,
        projectDir: effectiveProjectDir,
        specDir: effectiveSpecDir,
        securityProfile: this.serializeSecurityProfile(effectiveProjectDir),
      },
    };

    const executorConfig: AgentExecutorConfig = {
      taskId,
      projectId,
      processType: 'qa-process',
      session: sessionConfig,
    };

    await this.processManager.spawnWorkerProcess(taskId, executorConfig, {}, 'qa-process', projectId);

    // Note (Python fallback preserved for reference):
    // const combinedEnv = this.processManager.getCombinedEnv(projectPath);
    // const args = [runPath, '--spec', specId, '--project-dir', projectPath, '--qa'];
    // await this.processManager.spawnProcess(taskId, projectPath, args, combinedEnv, 'qa-process', projectId);
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
    baseBranch?: string,
    projectId?: string
  ): void {
    // Preserve swapCount if context already exists (for restarts)
    const existingContext = this.taskExecutionContext.get(taskId);
    const swapCount = existingContext?.swapCount ?? 0;
    // Increment generation on each store (restarts) to invalidate pending cleanup callbacks
    const generation = (existingContext?.generation ?? 0) + 1;

    this.taskExecutionContext.set(taskId, {
      projectPath,
      specId,
      options,
      isSpecCreation,
      taskDescription,
      specDir,
      metadata,
      baseBranch,
      swapCount, // Preserve existing count instead of resetting
      projectId,
      generation, // Incremented to prevent stale exit cleanup
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

    // Wait for cleanup, then reset stuck subtasks and restart
    console.log('[AgentManager] Scheduling task restart in 500ms');
    setTimeout(async () => {
      // Reset stuck subtasks before restart to avoid picking up stale in-progress states
      if (context.specId || context.specDir) {
        const planPath = context.specDir
          ? path.join(context.specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN)
          : path.join(context.projectPath, AUTO_BUILD_PATHS.SPECS_DIR, context.specId, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);

        console.log('[AgentManager] Resetting stuck subtasks before restart:', planPath);
        try {
          const { success, resetCount } = await resetStuckSubtasks(planPath);
          if (success && resetCount > 0) {
            console.log(`[AgentManager] Successfully reset ${resetCount} stuck subtask(s)`);
          }
        } catch (err) {
          console.warn('[AgentManager] Failed to reset stuck subtasks:', err);
        }
      }

      console.log('[AgentManager] Restarting task now:', taskId);
      if (context.isSpecCreation) {
        console.log('[AgentManager] Restarting as spec creation');
        if (!context.taskDescription) {
          console.error('[AgentManager] Cannot restart spec creation: taskDescription is missing');
          return;
        }
        this.startSpecCreation(
          taskId,
          context.projectPath,
          context.taskDescription,
          context.specDir,
          context.metadata,
          context.baseBranch,
          context.projectId
        );
      } else {
        console.log('[AgentManager] Restarting as task execution');
        this.startTaskExecution(
          taskId,
          context.projectPath,
          context.specId,
          context.options,
          context.projectId
        );
      }
    }, 500);

    return true;
  }

  // ============================================
  // Queue Routing Methods (Rate Limit Recovery)
  // ============================================

  /**
   * Get running tasks grouped by profile
   * Used by queue routing to determine profile load
   */
  getRunningTasksByProfile(): { byProfile: Record<string, string[]>; totalRunning: number } {
    return this.state.getRunningTasksByProfile();
  }

  /**
   * Assign a profile to a task
   * Records which profile is being used for a task
   */
  assignProfileToTask(
    taskId: string,
    profileId: string,
    profileName: string,
    reason: 'proactive' | 'reactive' | 'manual'
  ): void {
    this.state.assignProfileToTask(taskId, profileId, profileName, reason);
  }

  /**
   * Get the profile assignment for a task
   */
  getTaskProfileAssignment(taskId: string): { profileId: string; profileName: string; reason: string } | undefined {
    return this.state.getTaskProfileAssignment(taskId);
  }

  /**
   * Update the session ID for a task (for session resume)
   */
  updateTaskSession(taskId: string, sessionId: string): void {
    this.state.updateTaskSession(taskId, sessionId);
  }

  /**
   * Get the session ID for a task
   */
  getTaskSessionId(taskId: string): string | undefined {
    return this.state.getTaskSessionId(taskId);
  }

  // ============================================
  // Private helpers for TypeScript agent path
  // ============================================

  /**
   * Serialize a project's SecurityProfile (Sets) into a SerializedSecurityProfile (arrays)
   * for transfer across worker thread boundaries.
   */
  private serializeSecurityProfile(projectDir: string): SerializedSecurityProfile {
    const profile = getSecurityProfile(projectDir);
    return {
      baseCommands: [...profile.baseCommands],
      stackCommands: [...profile.stackCommands],
      scriptCommands: [...profile.scriptCommands],
      customCommands: [...profile.customCommands],
      customScripts: {
        shellScripts: profile.customScripts.shellScripts,
      },
    };
  }

  /**
   * Resolve the model ID for a task by reading task_metadata.json.
   * Falls back to the default sonnet model if metadata is not available.
   *
   * @param specDir - The spec directory path
   * @param phase - The execution phase ('planning', 'coding', 'qa', 'spec')
   */
  private async resolveTaskModelId(specDir: string, phase: 'planning' | 'coding' | 'qa' | 'spec'): Promise<string> {
    try {
      const metadataPath = path.join(specDir, 'task_metadata.json');
      if (existsSync(metadataPath)) {
        const raw = readFileSync(metadataPath, 'utf-8');
        const metadata = JSON.parse(raw) as {
          isAutoProfile?: boolean;
          phaseModels?: Record<string, string>;
          phaseProviders?: Record<string, string>;
          provider?: string;
          model?: string;
        };

        // Determine the target provider for this phase
        const targetProvider = (metadata.phaseProviders?.[phase] ?? metadata.provider ?? null) as BuiltinProvider | null;

        let shorthand: string | undefined;
        if (metadata.phaseModels?.[phase]) {
          shorthand = metadata.phaseModels[phase];
        } else if (metadata.model) {
          shorthand = metadata.model;
        }

        // If shorthand is empty (e.g., Ollama presets use '' because models are dynamic),
        // try reading the user's per-provider phase config from settings
        if (!shorthand && targetProvider) {
          const settings = readSettingsFile();
          const providerPhaseModels = (settings?.providerAgentConfig as Record<string, Record<string, unknown>> | undefined)?.[targetProvider]?.customPhaseModels as Record<string, string> | undefined;
          if (providerPhaseModels?.[phase]) {
            shorthand = providerPhaseModels[phase];
          }
        }

        if (shorthand) {
          // First resolve to a full model ID (handles Anthropic shorthands like 'opus' → 'claude-opus-4-6')
          const baseModelId = resolveModelId(shorthand);

          // If the target provider is non-Anthropic, translate the model ID to the
          // target provider's equivalent. This ensures the queue resolution succeeds
          // when the user has swapped away from Anthropic.
          if (targetProvider && targetProvider !== 'anthropic') {
            const equiv = resolveModelEquivalent(shorthand, targetProvider)
              ?? resolveModelEquivalent(baseModelId, targetProvider);
            if (equiv) {
              return equiv.modelId;
            }
            // If no equivalence found and the model is already a raw model name
            // (e.g., user-configured Ollama model), pass it through unchanged
            return shorthand;
          }

          return baseModelId;
        }

        // Still no model but have a target provider — resolve 'sonnet' equivalent
        if (targetProvider && targetProvider !== 'anthropic') {
          const equiv = resolveModelEquivalent('sonnet', targetProvider);
          if (equiv) return equiv.modelId;
        }
      }
    } catch {
      // Fall through to default
    }

    // Default: resolve 'sonnet' (Anthropic fallback)
    return resolveModelId('sonnet');
  }

  /**
   * Resolve the provider override for a phase from task_metadata.json.
   * Returns null if no per-phase provider is specified (use default queue).
   */
  private resolveTaskPhaseProvider(specDir: string, phase: 'planning' | 'coding' | 'qa' | 'spec'): string | null {
    try {
      const metadataPath = path.join(specDir, 'task_metadata.json');
      if (existsSync(metadataPath)) {
        const raw = readFileSync(metadataPath, 'utf-8');
        const metadata = JSON.parse(raw) as {
          phaseProviders?: Record<string, string>;
          provider?: string;
        };
        // Per-phase provider (cross-provider mode) takes precedence,
        // then fall back to the single task-level provider (e.g. 'ollama')
        return metadata.phaseProviders?.[phase] ?? metadata.provider ?? null;
      }
    } catch {
      // Fall through
    }
    return null;
  }

  /**
   * Load a system prompt from the prompts directory.
   * Returns null if the prompt file is not found.
   *
   * @param promptName - The prompt filename without extension (e.g., 'planner', 'qa_reviewer')
   */
  private loadPrompt(promptName: string): string | null {
    return tryLoadPrompt(promptName);
  }

  /**
   * Build a minimal default system prompt for spec orchestration
   * when the prompt file is not found.
   */
  private buildDefaultSpecPrompt(taskDescription: string, specDir?: string): string {
    return `You are a spec creation agent. Your job is to create a detailed specification and implementation plan for the following task:\n\n${taskDescription}${specDir ? `\n\nSpec directory: ${specDir}` : ''}\n\nCreate a spec.md with requirements and an implementation_plan.json with phases and subtasks.`;
  }

  /**
   * Build a minimal default system prompt for the planner/build orchestrator
   * when the prompt file is not found.
   */
  private buildDefaultPlannerPrompt(specId: string, projectPath: string): string {
    return `You are a planning agent. Your job is to review the spec and create an implementation plan for spec ${specId} in project ${projectPath}. Read the spec.md and create implementation_plan.json with phases and subtasks.`;
  }

  /**
   * Build a minimal default system prompt for the QA reviewer
   * when the prompt file is not found.
   */
  private buildDefaultQAPrompt(specId: string, projectPath: string): string {
    return `You are a QA reviewer agent. Your job is to review the implementation of spec ${specId} in project ${projectPath}. Check that all requirements in spec.md are implemented correctly and write a qa_report.md with Status: PASSED or Status: FAILED.`;
  }

  /**
   * Build initial messages for task execution (build_orchestrator).
   * Includes the spec.md and implementation_plan.json content for agent context.
   */
  private buildTaskExecutionMessages(
    specDir: string,
    specId: string,
    projectPath: string,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const parts: string[] = [];

    parts.push(`You are implementing spec ${specId} in project: ${projectPath}`);
    parts.push(`Spec directory: ${specDir}`);
    parts.push('');

    // Read spec.md
    const specPath = path.join(specDir, 'spec.md');
    try {
      if (existsSync(specPath)) {
        const specContent = readFileSync(specPath, 'utf-8');
        parts.push('## Specification (spec.md)');
        parts.push('');
        parts.push(specContent);
        parts.push('');
      }
    } catch {
      // Not critical — agent can read spec itself
    }

    // Read implementation_plan.json if it exists (resume scenario)
    const planPath = path.join(specDir, 'implementation_plan.json');
    try {
      if (existsSync(planPath)) {
        const planContent = readFileSync(planPath, 'utf-8');
        parts.push('## Implementation Plan (implementation_plan.json)');
        parts.push('');
        parts.push('```json');
        parts.push(planContent);
        parts.push('```');
        parts.push('');
        parts.push('Resume implementing the pending/in-progress subtasks. Do NOT redo completed subtasks. Update each subtask status to "completed" in implementation_plan.json after finishing it.');
      } else {
        parts.push('No implementation plan exists yet. Start by creating implementation_plan.json with phases and subtasks, then implement each subtask.');
      }
    } catch {
      // Fall through
    }

    return [{ role: 'user', content: parts.join('\n') }];
  }

  /**
   * Build initial messages for QA process.
   * Includes spec.md and implementation plan to give QA agent full context.
   */
  private buildQAInitialMessages(
    specDir: string,
    specId: string,
    projectPath: string,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const parts: string[] = [];

    parts.push(`You are reviewing the implementation of spec ${specId} in project: ${projectPath}`);
    parts.push(`Spec directory: ${specDir}`);
    parts.push('');

    // Read spec.md
    const specPath = path.join(specDir, 'spec.md');
    try {
      if (existsSync(specPath)) {
        const specContent = readFileSync(specPath, 'utf-8');
        parts.push('## Specification (spec.md)');
        parts.push('');
        parts.push(specContent);
        parts.push('');
      }
    } catch {
      // Not critical
    }

    // Read implementation_plan.json to show what was planned/completed
    const planPath = path.join(specDir, 'implementation_plan.json');
    try {
      if (existsSync(planPath)) {
        const planContent = readFileSync(planPath, 'utf-8');
        parts.push('## Implementation Plan (implementation_plan.json)');
        parts.push('');
        parts.push('```json');
        parts.push(planContent);
        parts.push('```');
        parts.push('');
      }
    } catch {
      // Fall through
    }

    parts.push('Review the implementation against the specification. Check that all requirements are met, the code is correct, and tests pass. Write your findings to qa_report.md with "Status: PASSED" or "Status: FAILED" and a list of any issues found.');

    return [{ role: 'user', content: parts.join('\n') }];
  }
}
