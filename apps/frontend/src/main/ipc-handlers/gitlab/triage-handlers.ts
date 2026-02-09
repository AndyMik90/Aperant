/**
 * GitLab Triage IPC handlers
 *
 * Handles automatic triage of GitLab issues by:
 * 1. Categorizing issues (bug, feature, documentation, etc.)
 * 2. Detecting duplicates, spam, and feature creep
 * 3. Applying labels automatically
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
  GitLabTriageConfig,
  GitLabTriageResult,
  GitLabTriageCategory,
} from './types';
import { sanitizeStringArray } from '../shared/sanitize';

// Debug logging
function debugLog(message: string, ...args: unknown[]): void {
  console.log(`[GitLab Triage] ${message}`, ...args);
}

const TRIAGE_CATEGORIES: GitLabTriageCategory[] = [
  'bug',
  'feature',
  'documentation',
  'question',
  'duplicate',
  'spam',
  'feature_creep',
];

function sanitizeIssueIid(value: unknown): number | null {
  const issueIid = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(issueIid) || issueIid <= 0) {
    return null;
  }
  return issueIid;
}

function sanitizeCategory(value: unknown): GitLabTriageCategory {
  return TRIAGE_CATEGORIES.includes(value as GitLabTriageCategory) ? (value as GitLabTriageCategory) : 'feature';
}

function sanitizeLabels(values: string[]): string[] {
  return sanitizeStringArray(values, 50, 50);
}

function sanitizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sanitizePriority(value: unknown): 'high' | 'medium' | 'low' {
  if (value === 'high' || value === 'low') return value;
  return 'medium';
}

function sanitizeTriagedAt(value: unknown): string {
  if (typeof value !== 'string') return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function sanitizeTriageResult(result: GitLabTriageResult): {
  issue_iid: number;
  category: GitLabTriageCategory;
  confidence: number;
  labels_to_add: string[];
  labels_to_remove: string[];
  priority: 'high' | 'medium' | 'low';
  triaged_at: string;
} | null {
  const issueIid = sanitizeIssueIid(result.issueIid);
  if (!issueIid) return null;
  return {
    issue_iid: issueIid,
    category: sanitizeCategory(result.category),
    confidence: sanitizeConfidence(result.confidence),
    labels_to_add: sanitizeLabels(result.labelsToAdd),
    labels_to_remove: sanitizeLabels(result.labelsToRemove),
    priority: sanitizePriority(result.priority),
    triaged_at: sanitizeTriagedAt(result.triagedAt),
  };
}

/**
 * Get the GitLab directory for a project
 */
function getGitLabDir(project: Project): string {
  return path.join(project.path, '.auto-claude', 'gitlab');
}

/**
 * Get the triage config for a project
 */
function getTriageConfig(project: Project): GitLabTriageConfig {
  const configPath = path.join(getGitLabDir(project), 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        enabled: data.triage_enabled ?? false,
        duplicateThreshold: data.duplicate_threshold ?? 0.85,
        spamThreshold: data.spam_threshold ?? 0.9,
        featureCreepThreshold: data.feature_creep_threshold ?? 0.8,
        enableComments: data.triage_enable_comments ?? true,
      };
    } catch {
      // Return defaults
    }
  }

  return {
    enabled: false,
    duplicateThreshold: 0.85,
    spamThreshold: 0.9,
    featureCreepThreshold: 0.8,
    enableComments: true,
  };
}

/**
 * Save the triage config for a project
 */
function saveTriageConfig(project: Project, config: GitLabTriageConfig): void {
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
    triage_enabled: config.enabled,
    duplicate_threshold: config.duplicateThreshold,
    spam_threshold: config.spamThreshold,
    feature_creep_threshold: config.featureCreepThreshold,
    triage_enable_comments: config.enableComments,
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
}

/**
 * Get triage results for a project
 */
function getTriageResults(project: Project): GitLabTriageResult[] {
  const triageDir = path.join(getGitLabDir(project), 'triage');

  if (!fs.existsSync(triageDir)) {
    return [];
  }

  const results: GitLabTriageResult[] = [];
  const files = fs.readdirSync(triageDir);

  for (const file of files) {
    if (file.startsWith('triage_') && file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(triageDir, file), 'utf-8'));
        results.push({
          issueIid: data.issue_iid,
          category: data.category as GitLabTriageCategory,
          confidence: data.confidence,
          labelsToAdd: data.labels_to_add ?? [],
          labelsToRemove: data.labels_to_remove ?? [],
          duplicateOf: data.duplicate_of,
          spamReason: data.spam_reason,
          featureCreepReason: data.feature_creep_reason,
          priority: data.priority,
          comment: data.comment,
          triagedAt: data.triaged_at,
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return results.sort((a, b) => new Date(b.triagedAt).getTime() - new Date(a.triagedAt).getTime());
}

/**
 * Apply labels to an issue
 */
async function applyLabels(
  project: Project,
  issueIid: number,
  labelsToAdd: string[],
  labelsToRemove: string[]
): Promise<boolean> {
  const glConfig = await getGitLabConfig(project);
  if (!glConfig) {
    throw new Error('No GitLab configuration found');
  }

  const encodedProject = encodeProjectPath(glConfig.project);

  // Get current labels
  const issue = await gitlabFetch(
    glConfig.token,
    glConfig.instanceUrl,
    `/projects/${encodedProject}/issues/${issueIid}`
  ) as { labels: string[] };

  // Calculate new labels
  const currentLabels = new Set(issue.labels);
  for (const label of labelsToRemove) {
    currentLabels.delete(label);
  }
  for (const label of labelsToAdd) {
    currentLabels.add(label);
  }

  // Update issue
  await gitlabFetch(
    glConfig.token,
    glConfig.instanceUrl,
    `/projects/${encodedProject}/issues/${issueIid}`,
    {
      method: 'PUT',
      body: JSON.stringify({ labels: Array.from(currentLabels).join(',') }),
    }
  );

  return true;
}

/**
 * Send IPC progress event
 */
function sendProgress(
  mainWindow: BrowserWindow,
  projectId: string,
  progress: { phase: string; progress: number; message: string; issueIid?: number }
): void {
  mainWindow.webContents.send(IPC_CHANNELS.GITLAB_TRIAGE_PROGRESS, projectId, progress);
}

/**
 * Send IPC error event
 */
function sendError(
  mainWindow: BrowserWindow,
  projectId: string,
  error: string
): void {
  mainWindow.webContents.send(IPC_CHANNELS.GITLAB_TRIAGE_ERROR, projectId, error);
}

/**
 * Send IPC complete event
 */
function sendComplete(
  mainWindow: BrowserWindow,
  projectId: string,
  results: GitLabTriageResult[]
): void {
  mainWindow.webContents.send(IPC_CHANNELS.GITLAB_TRIAGE_COMPLETE, projectId, results);
}

/**
 * Register triage related handlers
 */
export function registerTriageHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering Triage handlers');

  // Get triage config
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_TRIAGE_GET_CONFIG,
    async (_, projectId: string): Promise<GitLabTriageConfig | null> => {
      debugLog('getTriageConfig handler called', { projectId });
      return withProjectOrNull(projectId, async (project) => {
        return getTriageConfig(project);
      });
    }
  );

  // Save triage config
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_TRIAGE_SAVE_CONFIG,
    async (_, projectId: string, config: GitLabTriageConfig): Promise<boolean> => {
      debugLog('saveTriageConfig handler called', { projectId, enabled: config.enabled });
      const result = await withProjectOrNull(projectId, async (project) => {
        saveTriageConfig(project, config);
        return true;
      });
      return result ?? false;
    }
  );

  // Get triage results
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_TRIAGE_GET_RESULTS,
    async (_, projectId: string): Promise<GitLabTriageResult[]> => {
      debugLog('getTriageResults handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return getTriageResults(project);
      });
      return result ?? [];
    }
  );

  // Run triage on issues
  ipcMain.on(
    IPC_CHANNELS.GITLAB_TRIAGE_RUN,
    async (_, projectId: string, issueIids?: number[]) => {
      debugLog('runTriage handler called', { projectId, issueIids });
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

          sendProgress(mainWindow, projectId, {
            phase: 'fetching',
            progress: 10,
            message: 'Fetching issues for triage...',
          });

          const encodedProject = encodeProjectPath(glConfig.project);

          // Fetch issues
          const issues = await gitlabFetch(
            glConfig.token,
            glConfig.instanceUrl,
            `/projects/${encodedProject}/issues?state=opened&per_page=100`
          ) as Array<{
            iid: number;
            title: string;
            description?: string;
            labels: string[];
          }>;

          // Filter by issueIids if provided
          const filteredIssues = issueIids && issueIids.length > 0
            ? issues.filter(i => issueIids.includes(i.iid))
            : issues;

          sendProgress(mainWindow, projectId, {
            phase: 'analyzing',
            progress: 30,
            message: `Analyzing ${filteredIssues.length} issues...`,
          });

          // Simple triage logic (in production, this would use AI)
          const triageDir = path.join(getGitLabDir(project), 'triage');
          fs.mkdirSync(triageDir, { recursive: true });

          const results: GitLabTriageResult[] = [];

          for (let i = 0; i < filteredIssues.length; i++) {
            const issue = filteredIssues[i];
            const progress = 30 + Math.floor((i / filteredIssues.length) * 60);

            sendProgress(mainWindow, projectId, {
              phase: 'analyzing',
              progress,
              message: `Triaging issue #${issue.iid}...`,
              issueIid: issue.iid,
            });

            // Simple category detection based on title/description
            let category: GitLabTriageCategory = 'feature';
            const titleLower = issue.title.toLowerCase();
            const descLower = (issue.description || '').toLowerCase();

            if (titleLower.includes('bug') || titleLower.includes('fix') || titleLower.includes('error')) {
              category = 'bug';
            } else if (titleLower.includes('doc') || descLower.includes('documentation')) {
              category = 'documentation';
            } else if (titleLower.includes('question') || titleLower.includes('?')) {
              category = 'question';
            }

            const issueIid = sanitizeIssueIid(issue.iid);
            if (!issueIid) {
              debugLog('Skipping issue with invalid IID', { issueIid: issue.iid });
              continue;
            }

            const result: GitLabTriageResult = {
              issueIid,
              category,
              confidence: 0.75,
              labelsToAdd: [category],
              labelsToRemove: [],
              priority: 'medium',
              triagedAt: new Date().toISOString(),
            };

            const sanitizedResult = sanitizeTriageResult(result);
            if (!sanitizedResult) {
              debugLog('Skipping triage result with invalid IID', { issueIid: result.issueIid });
              continue;
            }

            // Save result
            // lgtm[js/http-to-file-access] - triageDir from controlled project path, issue_iid is numeric
            fs.writeFileSync(
              path.join(triageDir, `triage_${sanitizedResult.issue_iid}.json`),
              JSON.stringify(sanitizedResult, null, 2),
              'utf-8'
            );

            results.push(result);
          }

          sendProgress(mainWindow, projectId, {
            phase: 'complete',
            progress: 100,
            message: `Triaged ${results.length} issues`,
          });

          sendComplete(mainWindow, projectId, results);
        });
      } catch (error) {
        debugLog('Triage failed', { error: error instanceof Error ? error.message : error });
        sendError(mainWindow, projectId, error instanceof Error ? error.message : 'Failed to run triage');
      }
    }
  );

  // Apply triage labels
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_TRIAGE_APPLY_LABELS,
    async (_, projectId: string, issueIid: number, labelsToAdd: string[], labelsToRemove: string[]): Promise<boolean> => {
      debugLog('applyLabels handler called', { projectId, issueIid });
      const result = await withProjectOrNull(projectId, async (project) => {
        return applyLabels(project, issueIid, labelsToAdd, labelsToRemove);
      });
      return result ?? false;
    }
  );

  debugLog('Triage handlers registered');
}
