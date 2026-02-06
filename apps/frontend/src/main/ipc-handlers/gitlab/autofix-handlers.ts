/**
 * GitLab Auto-Fix IPC handlers
 *
 * Handles automatic fixing of GitLab issues by:
 * 1. Detecting issues with configured labels (e.g., "auto-fix")
 * 2. Creating specs from issues
 * 3. Running the build pipeline
 * 4. Creating MRs when complete
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS } from '../../../shared/constants';
import { getGitLabConfig, gitlabFetch, encodeProjectPath } from './utils';
import { withProjectOrNull } from '../github/utils/project-middleware';
import type { Project } from '../../../shared/types';
import type {
  GitLabAutoFixConfig,
  GitLabAutoFixQueueItem,
  GitLabAutoFixProgress,
  GitLabIssueBatch,
  GitLabAnalyzePreviewResult,
} from './types';

// Debug logging
function debugLog(message: string, ...args: unknown[]): void {
  console.log(`[GitLab AutoFix] ${message}`, ...args);
}

function sanitizeIssueUrl(rawUrl: unknown, instanceUrl: string): string {
  if (typeof rawUrl !== 'string') return '';
  try {
    const parsedUrl = new URL(rawUrl);
    const parsedInstanceUrl = new URL(instanceUrl);
    // Validate that instance URL uses HTTPS for security
    if (parsedInstanceUrl.protocol !== 'https:') {
      console.warn(`[GitLab AutoFix] Instance URL does not use HTTPS: ${instanceUrl}`);
      return '';
    }
    const expectedHost = parsedInstanceUrl.host;
    // Validate protocol is HTTPS for security
    if (parsedUrl.protocol !== 'https:') return '';
    // Reject URLs with embedded credentials (security risk)
    if (parsedUrl.username || parsedUrl.password) return '';
    if (parsedUrl.host !== expectedHost) return '';
    return parsedUrl.toString();
  } catch {
    return '';
  }
}

/**
 * Validate that a resolved path stays within the project directory
 * Prevents path traversal attacks via malicious project.path values
 */
function validatePathWithinProject(projectPath: string, resolvedPath: string): void {
  const normalizedProject = path.resolve(projectPath);
  const normalizedResolved = path.resolve(resolvedPath);

  if (!normalizedResolved.startsWith(normalizedProject + path.sep) && normalizedResolved !== normalizedProject) {
    throw new Error('Invalid path: path traversal detected');
  }
}

/**
 * Get the GitLab directory for a project
 */
function getGitLabDir(project: Project): string {
  const gitlabDir = path.join(project.path, '.auto-claude', 'gitlab');
  validatePathWithinProject(project.path, gitlabDir);
  return gitlabDir;
}

/**
 * Get the auto-fix config for a project
 */
function getAutoFixConfig(project: Project): GitLabAutoFixConfig {
  const configPath = path.join(getGitLabDir(project), 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        enabled: data.auto_fix_enabled ?? false,
        labels: data.auto_fix_labels ?? ['auto-fix'],
        requireHumanApproval: data.require_human_approval ?? true,
        model: data.model ?? 'claude-sonnet-4-5-20250929',
        thinkingLevel: data.thinking_level ?? 'medium',
      };
    } catch {
      // Return defaults
    }
  }

  return {
    enabled: false,
    labels: ['auto-fix'],
    requireHumanApproval: true,
    model: 'claude-sonnet-4-5-20250929',
    thinkingLevel: 'medium',
  };
}

/**
 * Save the auto-fix config for a project
 */
function saveAutoFixConfig(project: Project, config: GitLabAutoFixConfig): void {
  const gitlabDir = getGitLabDir(project);
  fs.mkdirSync(gitlabDir, { recursive: true });

  const configPath = path.join(gitlabDir, 'config.json');
  let existingConfig: Record<string, unknown> = {};

  try {
    existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // Use empty config
  }

  const updatedConfig = {
    ...existingConfig,
    auto_fix_enabled: config.enabled,
    auto_fix_labels: config.labels,
    require_human_approval: config.requireHumanApproval,
    model: config.model,
    thinking_level: config.thinkingLevel,
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
}

/**
 * Get the auto-fix queue for a project
 */
function getAutoFixQueue(project: Project): GitLabAutoFixQueueItem[] {
  const issuesDir = path.join(getGitLabDir(project), 'issues');

  if (!fs.existsSync(issuesDir)) {
    return [];
  }

  const queue: GitLabAutoFixQueueItem[] = [];
  const files = fs.readdirSync(issuesDir);

  for (const file of files) {
    if (file.startsWith('autofix_') && file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(issuesDir, file), 'utf-8'));
        queue.push({
          issueIid: data.issue_iid,
          project: data.project,
          status: data.status,
          specId: data.spec_id,
          mrIid: data.mr_iid,
          error: data.error,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return queue.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Get batches from disk
 */
function getBatches(project: Project): GitLabIssueBatch[] {
  const batchesDir = path.join(getGitLabDir(project), 'batches');

  if (!fs.existsSync(batchesDir)) {
    return [];
  }

  const batches: GitLabIssueBatch[] = [];
  const files = fs.readdirSync(batchesDir);

  for (const file of files) {
    if (file.startsWith('batch_') && file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf-8'));
        batches.push({
          id: data.batch_id,
          issues: data.issues.map((i: Record<string, unknown>) => ({
            iid: i.iid as number,
            title: i.title as string,
            similarity: i.similarity as number ?? 1.0,
          })),
          commonThemes: data.common_themes ?? [],
          confidence: data.confidence ?? 1.0,
          reasoning: data.reasoning ?? '',
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return batches;
}

/**
 * Check for issues with auto-fix labels
 */
async function checkAutoFixLabels(project: Project): Promise<number[]> {
  const config = getAutoFixConfig(project);
  if (!config.enabled || config.labels.length === 0) {
    return [];
  }

  const glConfig = await getGitLabConfig(project);
  if (!glConfig) {
    return [];
  }

  const encodedProject = encodeProjectPath(glConfig.project);

  // Fetch open issues
  const issues = await gitlabFetch(
    glConfig.token,
    glConfig.instanceUrl,
    `/projects/${encodedProject}/issues?state=opened&per_page=100`
  ) as Array<{
    iid: number;
    labels: string[];
  }>;

  // Filter for issues with matching labels
  const queue = getAutoFixQueue(project);
  const pendingIssues = new Set(queue.map(q => q.issueIid));

  const matchingIssues: number[] = [];

  for (const issue of issues) {
    // Skip already in queue
    if (pendingIssues.has(issue.iid)) continue;

    // Check for matching labels
    const issueLabels = issue.labels.map(l => l.toLowerCase());
    const hasMatchingLabel = config.labels.some(
      label => issueLabels.includes(label.toLowerCase())
    );

    if (hasMatchingLabel) {
      matchingIssues.push(issue.iid);
    }
  }

  return matchingIssues;
}

/**
 * Check for NEW issues not yet in the auto-fix queue (no labels required)
 */
async function checkNewIssues(project: Project): Promise<Array<{ iid: number }>> {
  const config = getAutoFixConfig(project);
  if (!config.enabled) {
    return [];
  }

  const glConfig = await getGitLabConfig(project);
  if (!glConfig) {
    return [];
  }

  const queue = getAutoFixQueue(project);
  const pendingIssues = new Set(queue.map(q => q.issueIid));
  const encodedProject = encodeProjectPath(glConfig.project);

  // Fetch open issues
  const issues = await gitlabFetch(
    glConfig.token,
    glConfig.instanceUrl,
    `/projects/${encodedProject}/issues?state=opened&per_page=100`
  ) as Array<{
    iid: number;
  }>;

  // Filter for new issues not in queue
  return issues
    .filter(issue => !pendingIssues.has(issue.iid))
    .map(issue => ({ iid: issue.iid }));
}

/**
 * Send IPC progress event
 */
function sendProgress(
  mainWindow: BrowserWindow,
  projectId: string,
  progress: GitLabAutoFixProgress
): void {
  mainWindow.webContents.send(IPC_CHANNELS.GITLAB_AUTOFIX_PROGRESS, projectId, progress);
}

/**
 * Send IPC error event
 */
function sendError(
  mainWindow: BrowserWindow,
  projectId: string,
  error: string
): void {
  mainWindow.webContents.send(IPC_CHANNELS.GITLAB_AUTOFIX_ERROR, projectId, error);
}

/**
 * Send IPC complete event
 */
function sendComplete(
  mainWindow: BrowserWindow,
  projectId: string,
  data: GitLabAutoFixQueueItem
): void {
  mainWindow.webContents.send(IPC_CHANNELS.GITLAB_AUTOFIX_COMPLETE, projectId, data);
}

/**
 * Start auto-fix for an issue
 */
async function startAutoFix(
  project: Project,
  issueIid: number,
  mainWindow: BrowserWindow
): Promise<void> {
  const glConfig = await getGitLabConfig(project);
  if (!glConfig) {
    throw new Error('No GitLab configuration found');
  }

  sendProgress(mainWindow, project.id, {
    phase: 'fetching',
    issueIid,
    progress: 10,
    message: `Fetching issue #${issueIid}...`,
  });

  const encodedProject = encodeProjectPath(glConfig.project);

  // Fetch the issue
  const issue = await gitlabFetch(
    glConfig.token,
    glConfig.instanceUrl,
    `/projects/${encodedProject}/issues/${issueIid}`
  ) as {
    iid: number;
    title: string;
    description?: string;
    labels: string[];
    web_url: string;
  };

  sendProgress(mainWindow, project.id, {
    phase: 'analyzing',
    issueIid,
    progress: 30,
    message: 'Analyzing issue...',
  });

  sendProgress(mainWindow, project.id, {
    phase: 'creating_spec',
    issueIid,
    progress: 50,
    message: 'Creating spec from issue...',
  });

  // Validate issueIid
  if (!Number.isInteger(issueIid) || issueIid <= 0) {
    throw new Error('Invalid issue IID');
  }

  // Save auto-fix state
  const issuesDir = path.join(getGitLabDir(project), 'issues');
  fs.mkdirSync(issuesDir, { recursive: true });

  const state: GitLabAutoFixQueueItem = {
    issueIid,
    project: glConfig.project,
    status: 'creating_spec',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Validate and sanitize network data before writing to file
  const sanitizedIssueUrl = sanitizeIssueUrl(issue.web_url, glConfig.instanceUrl);
  const sanitizedProject = typeof glConfig.project === 'string' ? glConfig.project : '';

  fs.writeFileSync(
    path.join(issuesDir, `autofix_${issueIid}.json`),
    JSON.stringify({
      issue_iid: state.issueIid,
      project: sanitizedProject,
      status: state.status,
      created_at: state.createdAt,
      updated_at: state.updatedAt,
      issue_url: sanitizedIssueUrl,
    }, null, 2),
    'utf-8'
  );

  sendProgress(mainWindow, project.id, {
    phase: 'complete',
    issueIid,
    progress: 100,
    message: 'Auto-fix spec created! Start the build to continue.',
  });

  sendComplete(mainWindow, project.id, state);
}

/**
 * Register auto-fix related handlers
 */
export function registerAutoFixHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering AutoFix handlers');

  // Get auto-fix config
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_AUTOFIX_GET_CONFIG,
    async (_, projectId: string): Promise<GitLabAutoFixConfig | null> => {
      debugLog('getAutoFixConfig handler called', { projectId });
      return withProjectOrNull(projectId, async (project) => {
        return getAutoFixConfig(project);
      });
    }
  );

  // Save auto-fix config
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_AUTOFIX_SAVE_CONFIG,
    async (_, projectId: string, config: GitLabAutoFixConfig): Promise<boolean> => {
      debugLog('saveAutoFixConfig handler called', { projectId, enabled: config.enabled });
      const result = await withProjectOrNull(projectId, async (project) => {
        saveAutoFixConfig(project, config);
        return true;
      });
      return result ?? false;
    }
  );

  // Get auto-fix queue
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_AUTOFIX_GET_QUEUE,
    async (_, projectId: string): Promise<GitLabAutoFixQueueItem[]> => {
      debugLog('getAutoFixQueue handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return getAutoFixQueue(project);
      });
      return result ?? [];
    }
  );

  // Check for issues with auto-fix labels
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_AUTOFIX_CHECK_LABELS,
    async (_, projectId: string): Promise<number[]> => {
      debugLog('checkAutoFixLabels handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return checkAutoFixLabels(project);
      });
      return result ?? [];
    }
  );

  // Check for NEW issues not yet in auto-fix queue
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_AUTOFIX_CHECK_NEW,
    async (_, projectId: string): Promise<Array<{ iid: number }>> => {
      debugLog('checkNewIssues handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return checkNewIssues(project);
      });
      return result ?? [];
    }
  );

  // Start auto-fix for an issue
  ipcMain.on(
    IPC_CHANNELS.GITLAB_AUTOFIX_START,
    async (_, projectId: string, issueIid: number) => {
      debugLog('startAutoFix handler called', { projectId, issueIid });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          await startAutoFix(project, issueIid, mainWindow);
        });
      } catch (error) {
        debugLog('Auto-fix failed', { issueIid, error: error instanceof Error ? error.message : error });
        sendError(mainWindow, projectId, error instanceof Error ? error.message : 'Failed to start auto-fix');
      }
    }
  );

  // Get batches for a project
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_AUTOFIX_GET_BATCHES,
    async (_, projectId: string): Promise<GitLabIssueBatch[]> => {
      debugLog('getBatches handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return getBatches(project);
      });
      return result ?? [];
    }
  );

  // Analyze issues and preview proposed batches (proactive workflow)
  ipcMain.on(
    IPC_CHANNELS.GITLAB_AUTOFIX_ANALYZE_PREVIEW,
    async (_, projectId: string, issueIids?: number[], maxIssues?: number) => {
      debugLog('analyzePreview handler called', { projectId, issueIids, maxIssues });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          const glConfig = await getGitLabConfig(project);
          if (!glConfig) {
            throw new Error('No GitLab configuration found');
          }

          mainWindow.webContents.send(
            IPC_CHANNELS.GITLAB_AUTOFIX_ANALYZE_PREVIEW_PROGRESS,
            projectId,
            { phase: 'analyzing', progress: 10, message: 'Fetching issues for analysis...' }
          );

          const encodedProject = encodeProjectPath(glConfig.project);
          const limit = maxIssues ?? 50;

          // Fetch issues
          const issues = await gitlabFetch(
            glConfig.token,
            glConfig.instanceUrl,
            `/projects/${encodedProject}/issues?state=opened&per_page=${limit}`
          ) as Array<{
            iid: number;
            title: string;
            labels: string[];
          }>;

          // Filter by issueIids if provided
          const filteredIssues = issueIids && issueIids.length > 0
            ? issues.filter(i => issueIids.includes(i.iid))
            : issues;

          mainWindow.webContents.send(
            IPC_CHANNELS.GITLAB_AUTOFIX_ANALYZE_PREVIEW_PROGRESS,
            projectId,
            { phase: 'analyzing', progress: 50, message: `Analyzing ${filteredIssues.length} issues...` }
          );

          // Simple grouping for now - in production this would use AI to group similar issues
          const result: GitLabAnalyzePreviewResult = {
            success: true,
            totalIssues: filteredIssues.length,
            analyzedIssues: filteredIssues.length,
            alreadyBatched: 0,
            proposedBatches: [],
            singleIssues: filteredIssues.map(i => ({
              iid: i.iid,
              title: i.title,
              labels: i.labels,
            })),
            message: `Found ${filteredIssues.length} issues to analyze`,
          };

          mainWindow.webContents.send(
            IPC_CHANNELS.GITLAB_AUTOFIX_ANALYZE_PREVIEW_COMPLETE,
            projectId,
            result
          );
        });
      } catch (error) {
        debugLog('Analyze preview failed', { error: error instanceof Error ? error.message : error });
        mainWindow.webContents.send(
          IPC_CHANNELS.GITLAB_AUTOFIX_ANALYZE_PREVIEW_ERROR,
          projectId,
          error instanceof Error ? error.message : 'Failed to analyze issues'
        );
      }
    }
  );

  // Approve and execute selected batches
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_AUTOFIX_APPROVE_BATCHES,
    async (_, projectId: string, approvedBatches: GitLabIssueBatch[]): Promise<{ success: boolean; batches?: GitLabIssueBatch[]; error?: string }> => {
      debugLog('approveBatches handler called', { projectId, batchCount: approvedBatches.length });
      const result = await withProjectOrNull(projectId, async (project) => {
        try {
          const batchesDir = path.join(getGitLabDir(project), 'batches');
          fs.mkdirSync(batchesDir, { recursive: true });

          // Save approved batches
          for (const batch of approvedBatches) {
            const batchFile = path.join(batchesDir, `batch_${batch.id}.json`);
            fs.writeFileSync(batchFile, JSON.stringify({
              batch_id: batch.id,
              issues: batch.issues.map(i => ({
                iid: i.iid,
                title: i.title,
                similarity: i.similarity,
              })),
              common_themes: batch.commonThemes,
              confidence: batch.confidence,
              reasoning: batch.reasoning,
              status: 'pending',
              created_at: new Date().toISOString(),
            }, null, 2), 'utf-8');
          }

          const batches = getBatches(project);
          return { success: true, batches };
        } catch (error) {
          debugLog('Approve batches failed', { error: error instanceof Error ? error.message : error });
          return { success: false, error: error instanceof Error ? error.message : 'Failed to approve batches' };
        }
      });
      return result ?? { success: false, error: 'Project not found' };
    }
  );

  debugLog('AutoFix handlers registered');
}
