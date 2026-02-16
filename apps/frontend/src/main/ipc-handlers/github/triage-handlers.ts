/**
 * GitHub Issue Triage IPC handlers
 *
 * Handles AI-powered issue triage:
 * 1. Detect duplicates, spam, feature creep
 * 2. Suggest labels and priority
 * 3. Apply labels to issues
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS, MODEL_ID_MAP, DEFAULT_FEATURE_MODELS, DEFAULT_FEATURE_THINKING } from '../../../shared/constants';
import type { AuthFailureInfo } from '../../../shared/types/terminal';
import { getGitHubConfig } from './utils';
import { readSettingsFile } from '../../settings-utils';
import { getAugmentedEnv } from '../../env-utils';
import type { Project, AppSettings } from '../../../shared/types';
import { createContextLogger } from './utils/logger';
import { withProjectOrNull } from './utils/project-middleware';
import { createIPCCommunicators } from './utils/ipc-communicator';
import { getRunnerEnv } from './utils/runner-env';
import {
  runPythonSubprocess,
  getPythonPath,
  getRunnerPath,
  validateGitHubModule,
  buildRunnerArgs,
} from './utils/subprocess-runner';

// Debug logging
const { debug: debugLog } = createContextLogger('GitHub Triage');

/**
 * Triage categories
 */
export type TriageCategory = 'bug' | 'feature' | 'documentation' | 'question' | 'duplicate' | 'spam' | 'feature_creep';

/**
 * Triage result for a single issue
 */
export interface TriageResult {
  issueNumber: number;
  repo: string;
  category: TriageCategory;
  confidence: number;
  labelsToAdd: string[];
  labelsToRemove: string[];
  isDuplicate: boolean;
  duplicateOf?: number;
  isSpam: boolean;
  isFeatureCreep: boolean;
  suggestedBreakdown: string[];
  priority: 'high' | 'medium' | 'low';
  comment?: string;
  triagedAt: string;
}

/**
 * Triage configuration
 */
export interface TriageConfig {
  enabled: boolean;
  duplicateThreshold: number;
  spamThreshold: number;
  featureCreepThreshold: number;
  enableComments: boolean;
}

/**
 * Triage progress status
 */
export interface TriageProgress {
  phase: 'fetching' | 'analyzing' | 'applying' | 'complete';
  issueNumber?: number;
  progress: number;
  message: string;
  totalIssues: number;
  processedIssues: number;
}

/**
 * Get the GitHub directory for a project
 */
function getGitHubDir(project: Project): string {
  return path.join(project.path, '.auto-claude', 'github');
}

/**
 * Get triage config for a project
 */
function getTriageConfig(project: Project): TriageConfig {
  const configPath = path.join(getGitHubDir(project), 'config.json');

  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      enabled: data.triage_enabled ?? false,
      duplicateThreshold: data.duplicate_threshold ?? 0.80,
      spamThreshold: data.spam_threshold ?? 0.75,
      featureCreepThreshold: data.feature_creep_threshold ?? 0.70,
      enableComments: data.enable_triage_comments ?? false,
    };
  } catch {
    // Return defaults if file doesn't exist or is invalid
  }

  return {
    enabled: false,
    duplicateThreshold: 0.80,
    spamThreshold: 0.75,
    featureCreepThreshold: 0.70,
    enableComments: false,
  };
}

/**
 * Save triage config for a project
 */
function saveTriageConfig(project: Project, config: TriageConfig): void {
  const githubDir = getGitHubDir(project);
  fs.mkdirSync(githubDir, { recursive: true });

  const configPath = path.join(githubDir, 'config.json');
  let existingConfig: Record<string, unknown> = {};

  try {
    existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // Use empty config if file doesn't exist or is invalid
  }

  const updatedConfig = {
    ...existingConfig,
    triage_enabled: config.enabled,
    duplicate_threshold: config.duplicateThreshold,
    spam_threshold: config.spamThreshold,
    feature_creep_threshold: config.featureCreepThreshold,
    enable_triage_comments: config.enableComments,
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
}

/**
 * Get saved triage results for a project
 */
function getTriageResults(project: Project): TriageResult[] {
  const issuesDir = path.join(getGitHubDir(project), 'issues');
  const results: TriageResult[] = [];

  try {
    const files = fs.readdirSync(issuesDir);

    for (const file of files) {
      if (file.startsWith('triage_') && file.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(issuesDir, file), 'utf-8'));
          results.push({
            issueNumber: data.issue_number,
            repo: data.repo,
            category: data.category,
            confidence: data.confidence,
            labelsToAdd: data.labels_to_add ?? [],
            labelsToRemove: data.labels_to_remove ?? [],
            isDuplicate: data.is_duplicate ?? false,
            duplicateOf: data.duplicate_of,
            isSpam: data.is_spam ?? false,
            isFeatureCreep: data.is_feature_creep ?? false,
            suggestedBreakdown: data.suggested_breakdown ?? [],
            priority: data.priority ?? 'medium',
            comment: data.comment,
            triagedAt: data.triaged_at ?? new Date().toISOString(),
          });
        } catch {
          // Skip invalid files
        }
      }
    }
  } catch {
    // Return empty array if directory doesn't exist
    return [];
  }

  return results.sort((a, b) => new Date(b.triagedAt).getTime() - new Date(a.triagedAt).getTime());
}

// IPC communication helpers removed - using createIPCCommunicators instead

/**
 * Get GitHub Issues model and thinking settings from app settings
 */
function getGitHubIssuesSettings(): { model: string; thinkingLevel: string } {
  const rawSettings = readSettingsFile() as Partial<AppSettings> | undefined;

  // Get feature models/thinking with defaults
  const featureModels = rawSettings?.featureModels ?? DEFAULT_FEATURE_MODELS;
  const featureThinking = rawSettings?.featureThinking ?? DEFAULT_FEATURE_THINKING;

  // Get Issues-specific settings (with fallback to defaults)
  const modelShort = featureModels.githubIssues ?? DEFAULT_FEATURE_MODELS.githubIssues;
  const thinkingLevel = featureThinking.githubIssues ?? DEFAULT_FEATURE_THINKING.githubIssues;

  // Convert model short name to full model ID
  const model = MODEL_ID_MAP[modelShort] ?? MODEL_ID_MAP['opus'];

  debugLog('GitHub Issues settings', { modelShort, model, thinkingLevel });

  return { model, thinkingLevel };
}

// getBackendPath function removed - using subprocess-runner utility instead

/**
 * Run the Python triage runner
 */
async function runTriage(
  project: Project,
  issueNumbers: number[] | null,
  applyLabels: boolean,
  mainWindow: BrowserWindow
): Promise<TriageResult[]> {
  // Comprehensive validation of GitHub module
  const validation = await validateGitHubModule(project);

  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const backendPath = validation.backendPath!;

  const { sendProgress } = createIPCCommunicators<TriageProgress, TriageResult[]>(
    mainWindow,
    {
      progress: IPC_CHANNELS.GITHUB_TRIAGE_PROGRESS,
      error: IPC_CHANNELS.GITHUB_TRIAGE_ERROR,
      complete: IPC_CHANNELS.GITHUB_TRIAGE_COMPLETE,
    },
    project.id
  );

  const { model, thinkingLevel } = getGitHubIssuesSettings();
  const additionalArgs = issueNumbers ? issueNumbers.map(n => n.toString()) : [];
  if (applyLabels) {
    additionalArgs.push('--apply-labels');
  }

  const args = buildRunnerArgs(
    getRunnerPath(backendPath),
    project.path,
    'triage',
    additionalArgs,
    { model, thinkingLevel }
  );

  debugLog('Spawning triage process', { args, model, thinkingLevel });

  const subprocessEnv = await getRunnerEnv();

  const { promise } = runPythonSubprocess<TriageResult[]>({
    pythonPath: getPythonPath(backendPath),
    args,
    cwd: backendPath,
    env: subprocessEnv,
    onProgress: (percent, message) => {
      debugLog('Progress update', { percent, message });
      sendProgress({
        phase: 'analyzing',
        progress: percent,
        message,
        totalIssues: 0,
        processedIssues: 0,
      });
    },
    onStdout: (line) => debugLog('STDOUT:', line),
    onStderr: (line) => debugLog('STDERR:', line),
    onAuthFailure: (authFailureInfo: AuthFailureInfo) => {
      debugLog('Auth failure detected in triage', authFailureInfo);
      mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_AUTH_FAILURE, authFailureInfo);
    },
    onComplete: () => {
      // Load results from disk
      const results = getTriageResults(project);
      debugLog('Triage results loaded', { count: results.length });
      return results;
    },
  });

  const result = await promise;

  if (!result.success) {
    throw new Error(result.error ?? 'Triage failed');
  }

  return result.data!;
}

/**
 * Register triage-related handlers
 */
export function registerTriageHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering Triage handlers');

  // Get triage config
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_TRIAGE_GET_CONFIG,
    async (_, projectId: string): Promise<TriageConfig | null> => {
      debugLog('getTriageConfig handler called', { projectId });
      return withProjectOrNull(projectId, async (project) => {
        const config = getTriageConfig(project);
        debugLog('Triage config loaded', { enabled: config.enabled });
        return config;
      });
    }
  );

  // Save triage config
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_TRIAGE_SAVE_CONFIG,
    async (_, projectId: string, config: TriageConfig): Promise<boolean> => {
      debugLog('saveTriageConfig handler called', { projectId, enabled: config.enabled });
      const result = await withProjectOrNull(projectId, async (project) => {
        saveTriageConfig(project, config);
        debugLog('Triage config saved');
        return true;
      });
      return result ?? false;
    }
  );

  // Get triage results
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_TRIAGE_GET_RESULTS,
    async (_, projectId: string): Promise<TriageResult[]> => {
      debugLog('getTriageResults handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        const results = getTriageResults(project);
        debugLog('Triage results loaded', { count: results.length });
        return results;
      });
      return result ?? [];
    }
  );

  // Run triage
  ipcMain.on(
    IPC_CHANNELS.GITHUB_TRIAGE_RUN,
    async (_, projectId: string, issueNumbers?: number[]) => {
      debugLog('runTriage handler called', { projectId, issueNumbers });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          const { sendProgress, sendError: _sendError, sendComplete } = createIPCCommunicators<TriageProgress, TriageResult[]>(
            mainWindow,
            {
              progress: IPC_CHANNELS.GITHUB_TRIAGE_PROGRESS,
              error: IPC_CHANNELS.GITHUB_TRIAGE_ERROR,
              complete: IPC_CHANNELS.GITHUB_TRIAGE_COMPLETE,
            },
            projectId
          );

          debugLog('Starting triage');
          sendProgress({
            phase: 'fetching',
            progress: 10,
            message: 'Fetching issues...',
            totalIssues: 0,
            processedIssues: 0,
          });

          const results = await runTriage(project, issueNumbers ?? null, false, mainWindow);

          debugLog('Triage completed', { resultsCount: results.length });
          sendProgress({
            phase: 'complete',
            progress: 100,
            message: `Triaged ${results.length} issues`,
            totalIssues: results.length,
            processedIssues: results.length,
          });

          sendComplete(results);
        });
      } catch (error) {
        debugLog('Triage failed', { error: error instanceof Error ? error.message : error });
        const { sendError } = createIPCCommunicators<TriageProgress, TriageResult[]>(
          mainWindow,
          {
            progress: IPC_CHANNELS.GITHUB_TRIAGE_PROGRESS,
            error: IPC_CHANNELS.GITHUB_TRIAGE_ERROR,
            complete: IPC_CHANNELS.GITHUB_TRIAGE_COMPLETE,
          },
          projectId
        );
        sendError(error instanceof Error ? error.message : 'Failed to run triage');
      }
    }
  );

  // Apply labels to issues
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_TRIAGE_APPLY_LABELS,
    async (_, projectId: string, issueNumbers: number[]): Promise<boolean> => {
      debugLog('applyTriageLabels handler called', { projectId, issueNumbers });
      const applyResult = await withProjectOrNull(projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) {
          debugLog('No GitHub config found');
          return false;
        }

        try {
          for (const issueNumber of issueNumbers) {
            const triageResults = getTriageResults(project);
            const result = triageResults.find(r => r.issueNumber === issueNumber);

            if (result && result.labelsToAdd.length > 0) {
              debugLog('Applying labels to issue', { issueNumber, labels: result.labelsToAdd });

              // Validate issueNumber to prevent command injection
              if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
                throw new Error('Invalid issue number');
              }

              // Validate labels - reject any that contain shell metacharacters
              const safeLabels = result.labelsToAdd.filter((label: string) => /^[\w\s\-.:]+$/.test(label));
              if (safeLabels.length !== result.labelsToAdd.length) {
                debugLog('Some labels were filtered due to invalid characters', {
                  original: result.labelsToAdd,
                  filtered: safeLabels
                });
              }

              if (safeLabels.length > 0) {
                const { execFileSync } = await import('child_process');
                // Use execFileSync with arguments array to prevent command injection
                execFileSync('gh', ['issue', 'edit', String(issueNumber), '--add-label', safeLabels.join(',')], {
                  cwd: project.path,
                  env: getAugmentedEnv(),
                });
              }
            }
          }
          debugLog('Labels applied successfully');
          return true;
        } catch (error) {
          debugLog('Failed to apply labels', { error: error instanceof Error ? error.message : error });
          return false;
        }
      });
      return applyResult ?? false;
    }
  );

  debugLog('Triage handlers registered');
}
