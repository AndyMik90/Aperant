/**
 * Auto-Claude MCP Server Utilities
 *
 * Helper functions for MCP tools to interact with Auto-Claude's task system.
 * These utilities wrap the existing task management functionality.
 */

import path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import type { Dirent } from 'fs';
import { spawn } from 'child_process';
import { projectStore } from '../project-store';
import { titleGenerator } from '../title-generator';
import { AUTO_BUILD_PATHS, getSpecsDir } from '../../shared/constants';
import { PROVIDER_REGISTRY } from '../../shared/constants/providers';
import type { Project, ProviderAccount, Task, TaskMetadata, TaskStatus } from '../../shared/types';
import { getProviderAccountState } from '../services/provider-account-service';
import type {
  TaskOptions,
  CreatedTask,
  TaskSummary,
  TaskStatusDetail,
  MCPResult,
  PhaseModels,
  PhaseThinking
} from './types';

function normalizeProviderLookup(value: string): string {
  return value.trim().toLowerCase();
}

function getOrderedProviderAccounts(
  accounts: ProviderAccount[],
  priorityOrder: string[],
  disabledIds: string[]
): ProviderAccount[] {
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  return [
    ...priorityOrder.map((accountId) => accountMap.get(accountId)).filter((account): account is ProviderAccount => !!account),
    ...disabledIds.map((accountId) => accountMap.get(accountId)).filter((account): account is ProviderAccount => !!account),
  ];
}

async function resolveTaskProviderId(provider?: string): Promise<string | undefined> {
  if (!provider?.trim()) {
    return undefined;
  }

  const rawProvider = provider.trim();
  const normalizedProvider = normalizeProviderLookup(rawProvider);
  const state = await getProviderAccountState();

  if (state.accounts.some((account) => account.id === rawProvider)) {
    return rawProvider;
  }

  const exactNameMatch = state.accounts.find(
    (account) => normalizeProviderLookup(account.name) === normalizedProvider
  );
  if (exactNameMatch) {
    return exactNameMatch.id;
  }

  const providerLookupIds = new Set<string>([normalizedProvider]);
  for (const providerInfo of PROVIDER_REGISTRY) {
    if (normalizeProviderLookup(providerInfo.name) === normalizedProvider) {
      providerLookupIds.add(providerInfo.id);
    }
  }

  const orderedAccounts = getOrderedProviderAccounts(
    state.accounts,
    state.globalPriorityOrder,
    state.disabledAutoSwitchAccountIds
  );

  const providerMatch = orderedAccounts.find((account) => providerLookupIds.has(account.provider))
    ?? state.accounts.find((account) => providerLookupIds.has(account.provider));

  return providerMatch?.id ?? rawProvider;
}

/**
 * Resolve a project from either UUID or filesystem path.
 * Falls back to path-based lookup when UUID doesn't match (common with in-memory vs on-disk UUID mismatch).
 */
export function resolveProjectPath(
  projectId: string,
  projectPath?: string
): { projectPath: string; project?: Project } | { error: string } {
  // Try UUID first
  const project = projectStore.getProject(projectId);
  if (project) {
    return { projectPath: project.path, project };
  }

  // Fall back to path-based lookup
  if (projectPath) {
    const byPath = projectStore.getProjectByPath(projectPath);
    if (byPath) {
      return { projectPath: byPath.path, project: byPath };
    }
    // Path provided but not in store — use it directly if specs dir exists on disk
    if (existsSync(path.join(projectPath, '.auto-claude', 'specs'))) {
      return { projectPath };
    }
  }

  return { error: `Project not found: ${projectId}${projectPath ? ` (path: ${projectPath})` : ''}` };
}

/**
 * Convert MCP TaskOptions to internal TaskMetadata
 */
export function toTaskMetadata(options?: TaskOptions): TaskMetadata {
  if (!options) {
    return { sourceType: 'manual' };
  }

  const metadata: TaskMetadata = {
    sourceType: 'manual',
    category: options.category,
    complexity: options.complexity,
    priority: options.priority,
    requireReviewBeforeCoding: options.requireReviewBeforeCoding,
    baseBranch: options.baseBranch,
    model: options.model,
    providerId: options.provider,  // Provider name passed through — resolved to account ID at spawn time
  };

  // Convert phase models
  if (options.phaseModels) {
    metadata.isAutoProfile = true;
    metadata.phaseModels = {
      spec: options.phaseModels.specCreation,
      planning: options.phaseModels.planning,
      coding: options.phaseModels.coding,
      qa: options.phaseModels.qaReview,
    };
  }

  // Convert phase thinking
  if (options.phaseThinking) {
    metadata.phaseThinking = {
      spec: options.phaseThinking.specCreation,
      planning: options.phaseThinking.planning,
      coding: options.phaseThinking.coding,
      qa: options.phaseThinking.qaReview,
    };
  }

  // Convert referenced files
  if (options.referencedFiles && options.referencedFiles.length > 0) {
    metadata.referencedFiles = options.referencedFiles.map(filePath => ({
      path: filePath,
      type: 'file' as const,
    }));
  }

  return metadata;
}

/**
 * Create a new task in a project
 */
export async function createTask(
  projectId: string,
  description: string,
  title?: string,
  options?: TaskOptions,
  projectPathFallback?: string
): Promise<MCPResult<CreatedTask>> {
  try {
    const resolved = resolveProjectPath(projectId, projectPathFallback);
    if ('error' in resolved) {
      return { success: false, error: resolved.error };
    }
    const project = resolved.project;
    if (!project) {
      return { success: false, error: `Project not registered in store. Path: ${resolved.projectPath}` };
    }

    // Auto-generate title if empty using Claude AI
    let finalTitle = title || '';
    if (!finalTitle.trim()) {
      console.warn('[MCP] Title is empty, generating with Claude AI...');
      try {
        const generatedTitle = await titleGenerator.generateTitle(description);
        if (generatedTitle) {
          finalTitle = generatedTitle;
          console.warn('[MCP] Generated title:', finalTitle);
        } else {
          // Fallback: create title from first line of description
          finalTitle = description.split('\n')[0].substring(0, 60);
          if (finalTitle.length === 60) finalTitle += '...';
        }
      } catch (err) {
        console.error('[MCP] Title generation error:', err);
        finalTitle = description.split('\n')[0].substring(0, 60);
        if (finalTitle.length === 60) finalTitle += '...';
      }
    }

    // Generate a unique spec ID based on existing specs
    const specsBaseDir = getSpecsDir(project.autoBuildPath);
    const specsDir = path.join(project.path, specsBaseDir);

    // Find next available spec number
    let specNumber = 1;
    if (existsSync(specsDir)) {
      const existingDirs = readdirSync(specsDir, { withFileTypes: true })
        .filter((d: Dirent) => d.isDirectory())
        .map((d: Dirent) => d.name);

      const existingNumbers = existingDirs
        .map((name: string) => {
          const match = name.match(/^(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter((n: number) => n > 0);

      if (existingNumbers.length > 0) {
        specNumber = Math.max(...existingNumbers) + 1;
      }
    }

    // Create spec ID with zero-padded number and slugified title
    const slugifiedTitle = finalTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
    const specId = `${String(specNumber).padStart(3, '0')}-${slugifiedTitle}`;

    // Create spec directory
    const specDir = path.join(specsDir, specId);
    mkdirSync(specDir, { recursive: true });

    // Build task metadata
    // IMPORTANT: Clear archivedAt to prevent tasks from being "born archived"
    // when recreating tasks in existing spec directories
    const taskMetadata = {
      ...toTaskMetadata(options),
      providerId: await resolveTaskProviderId(options?.provider),
      archivedAt: undefined
    };

    // Create initial implementation_plan.json
    const now = new Date().toISOString();
    const implementationPlan = {
      feature: finalTitle,
      description: description,
      created_at: now,
      updated_at: now,
      status: 'pending',
      phases: []
    };

    const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
    writeFileSync(planPath, JSON.stringify(implementationPlan, null, 2));

    // Save task metadata
    const metadataPath = path.join(specDir, 'task_metadata.json');
    writeFileSync(metadataPath, JSON.stringify(taskMetadata, null, 2));

    // Create requirements.json
    const requirements = {
      task_description: description,
      workflow_type: options?.category || 'feature'
    };

    const requirementsPath = path.join(specDir, AUTO_BUILD_PATHS.REQUIREMENTS);
    writeFileSync(requirementsPath, JSON.stringify(requirements, null, 2));

    // Invalidate cache to pick up new task
    projectStore.invalidateTasksCache(projectId);

    return {
      success: true,
      data: {
        taskId: specId,
        specPath: specDir,
        title: finalTitle,
        status: 'backlog' as TaskStatus,
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to create task: ${message}` };
  }
}

/**
 * List all tasks for a project
 */
export function listTasks(
  projectId: string,
  statusFilter?: TaskStatus,
  projectPathFallback?: string
): MCPResult<TaskSummary[]> {
  try {
    const resolved = resolveProjectPath(projectId, projectPathFallback);
    if ('error' in resolved) {
      return { success: false, error: resolved.error };
    }
    const project = resolved.project;
    if (!project) {
      return { success: false, error: `Project not registered in store. Path: ${resolved.projectPath}` };
    }

    const tasks = projectStore.getTasks(project.id);

    let filteredTasks = tasks;
    if (statusFilter) {
      filteredTasks = tasks.filter(t => t.status === statusFilter);
    }

    const summaries: TaskSummary[] = filteredTasks.map(task => ({
      taskId: task.specId,
      projectPath: project.path, // ADD THIS - fixes MCP tools that need to write files
      title: task.title,
      description: task.description || '',
      status: task.status,
      createdAt: task.createdAt || new Date().toISOString(),
      updatedAt: task.updatedAt,
    }));

    return { success: true, data: summaries };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to list tasks: ${message}` };
  }
}

/**
 * Get detailed status of a task
 */
export function getTaskStatus(
  projectId: string,
  taskId: string,
  projectPathFallback?: string
): MCPResult<TaskStatusDetail> {
  try {
    const resolved = resolveProjectPath(projectId, projectPathFallback);
    if ('error' in resolved) {
      return { success: false, error: resolved.error };
    }
    const resolvedId = resolved.project?.id || projectId;
    const tasks = projectStore.getTasks(resolvedId);
    const task = tasks.find(t => t.specId === taskId || t.id === taskId);

    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    const detail: TaskStatusDetail = {
      taskId: task.specId,
      title: task.title,
      status: task.status,
      phase: task.currentPhase,
      progress: task.progress,
      subtaskCount: task.subtaskCount,
      completedSubtasks: task.completedSubtasks,
      error: task.error,
      reviewReason: task.reviewReason,
    };

    return { success: true, data: detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get task status: ${message}` };
  }
}

/**
 * Execute a command after a delay
 */
export function executeCommand(
  command: string,
  args: string[] = [],
  delaySeconds: number = 60
): Promise<{ executed: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    console.warn(`[MCP] Scheduling command execution in ${delaySeconds} seconds: ${command} ${args.join(' ')}`);

    setTimeout(() => {
      console.warn(`[MCP] Executing command: ${command} ${args.join(' ')}`);

      try {
        const child = spawn(command, args, {
          shell: true,
          detached: true,
          stdio: 'pipe',
        });

        let output = '';
        let errorOutput = '';

        child.stdout?.on('data', (data) => {
          output += data.toString();
        });

        child.stderr?.on('data', (data) => {
          errorOutput += data.toString();
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve({ executed: true, output });
          } else {
            resolve({ executed: true, output, error: errorOutput || `Exit code: ${code}` });
          }
        });

        child.on('error', (err) => {
          resolve({ executed: false, error: err.message });
        });

        // Don't wait for the command to complete if it's a shutdown command
        if (command.toLowerCase().includes('shutdown') || command.toLowerCase().includes('poweroff')) {
          child.unref();
          resolve({ executed: true, output: 'Shutdown command started' });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolve({ executed: false, error: message });
      }
    }, delaySeconds * 1000);
  });
}

/**
 * Request a task to start execution
 *
 * This writes a special 'start_requested' status to the implementation_plan.json file.
 * The Electron file watcher detects this change and triggers actual task execution.
 */
export function startTask(
  projectId: string,
  taskId: string,
  projectPathFallback?: string
): MCPResult<{ message: string }> {
  try {
    const resolved = resolveProjectPath(projectId, projectPathFallback);
    if ('error' in resolved) {
      return { success: false, error: resolved.error };
    }
    const project = resolved.project;
    if (!project) {
      return { success: false, error: `Project not registered in store. Path: ${resolved.projectPath}` };
    }

    // Find the task's spec directory
    const specsBaseDir = getSpecsDir(project.autoBuildPath);
    const specDir = path.join(project.path, specsBaseDir, taskId);

    if (!existsSync(specDir)) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
    if (!existsSync(planPath)) {
      return { success: false, error: `Implementation plan not found for task: ${taskId}` };
    }

    // Read current plan
    const planContent = readFileSync(planPath, 'utf-8');
    const plan = JSON.parse(planContent);

    // Check current status
    const currentStatus = plan.status || 'pending';
    if (currentStatus !== 'pending') {
      return {
        success: false,
        error: `Task cannot be started. Current status: ${currentStatus}. Only tasks with 'pending' status can be started.`
      };
    }

    // Update status to 'start_requested' - file watcher will detect this and trigger execution
    plan.status = 'start_requested';
    plan.updated_at = new Date().toISOString();
    plan.start_requested_at = new Date().toISOString();

    writeFileSync(planPath, JSON.stringify(plan, null, 2));

    console.warn(`[MCP] Task start requested: ${taskId}`);

    return {
      success: true,
      data: {
        message: `Task ${taskId} start requested. The Electron app will begin execution shortly.`
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to start task: ${message}` };
  }
}

/**
 * Read exitReason from a task's implementation plan
 */
function getTaskExitReason(projectId: string, taskId: string): string | undefined {
  try {
    const project = projectStore.getProject(projectId);
    if (!project) return undefined;

    const specsBaseDir = getSpecsDir(project.autoBuildPath);
    const planPath = path.join(project.path, specsBaseDir, taskId, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);

    if (!existsSync(planPath)) return undefined;

    const content = readFileSync(planPath, 'utf-8');
    const plan = JSON.parse(content);
    return plan.exitReason;
  } catch {
    return undefined;
  }
}

/**
 * Poll result with rate limit crash information
 */
export interface PollResult {
  completed: boolean;
  statuses: Record<string, TaskStatus>;
  timedOut?: boolean;
  rateLimitCrashes?: string[];  // Task IDs that crashed due to rate limit
}

/**
 * Poll for task status changes
 * Returns additional info about tasks that crashed due to rate limit (Bug #5)
 */
export async function pollTaskStatuses(
  projectId: string,
  taskIds: string[],
  targetStatus: TaskStatus,
  intervalMs: number = 30000,
  timeoutMs?: number
): Promise<PollResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const checkStatuses = () => {
      // Check timeout
      if (timeoutMs && (Date.now() - startTime) > timeoutMs) {
        const statuses: Record<string, TaskStatus> = {};
        const rateLimitCrashes: string[] = [];

        for (const taskId of taskIds) {
          const result = getTaskStatus(projectId, taskId);
          statuses[taskId] = result.data?.status || 'error';

          // Check for rate limit crash
          const exitReason = getTaskExitReason(projectId, taskId);
          if (exitReason === 'rate_limit_crash') {
            rateLimitCrashes.push(taskId);
          }
        }

        resolve({ completed: false, statuses, timedOut: true, rateLimitCrashes });
        return;
      }

      // Check all task statuses
      let allReachedTarget = true;
      const statuses: Record<string, TaskStatus> = {};
      const rateLimitCrashes: string[] = [];

      for (const taskId of taskIds) {
        const result = getTaskStatus(projectId, taskId);
        const status = result.data?.status || 'error';
        statuses[taskId] = status;

        // Check for rate limit crash (Bug #5)
        // Tasks that crashed due to rate limit should not count as "completed"
        const exitReason = getTaskExitReason(projectId, taskId);
        if (exitReason === 'rate_limit_crash') {
          rateLimitCrashes.push(taskId);
          console.warn(`[MCP] Task ${taskId} is in human_review due to rate limit crash - not counting as complete`);
          allReachedTarget = false;
          continue;
        }

        if (status !== targetStatus) {
          allReachedTarget = false;
        }

        // If any task is in error state, consider it as not reaching target
        if (status === 'error') {
          allReachedTarget = false;
        }
      }

      if (allReachedTarget) {
        resolve({ completed: true, statuses, rateLimitCrashes });
      } else {
        // Schedule next check
        setTimeout(checkStatuses, intervalMs);
      }
    };

    // Start polling
    checkStatuses();
  });
}
