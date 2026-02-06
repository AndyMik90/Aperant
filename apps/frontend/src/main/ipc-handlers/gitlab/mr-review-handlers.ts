/**
 * GitLab MR Review IPC handlers
 *
 * Handles AI-powered MR review:
 * 1. Get MR diff
 * 2. Run AI review with code analysis
 * 3. Post review comments (notes)
 * 4. Merge MR
 * 5. Assign users
 * 6. Approve MR
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { IPC_CHANNELS, MODEL_ID_MAP, DEFAULT_FEATURE_MODELS, DEFAULT_FEATURE_THINKING } from '../../../shared/constants';
import type { AuthFailureInfo } from '../../../shared/types/terminal';
import { getGitLabConfig, gitlabFetch, encodeProjectPath } from './utils';
import { readSettingsFile } from '../../settings-utils';
import type { Project, AppSettings } from '../../../shared/types';
import type {
  MRReviewResult,
  MRReviewProgress,
  NewCommitsCheck,
} from './types';
import { createContextLogger } from '../github/utils/logger';
import { withProjectOrNull } from '../github/utils/project-middleware';
import { createIPCCommunicators } from '../github/utils/ipc-communicator';
import {
  runPythonSubprocess,
  getPythonPath,
  buildRunnerArgs,
} from '../github/utils/subprocess-runner';
import { getRunnerEnv } from '../github/utils/runner-env';

/**
 * Get the GitLab runner path
 */
function getGitLabRunnerPath(backendPath: string): string {
  return path.join(backendPath, 'runners', 'gitlab', 'runner.py');
}

// Debug logging
const { debug: debugLog } = createContextLogger('GitLab MR');

/**
 * Registry of running MR review processes
 * Key format: `${projectId}:${mrIid}`
 */
const runningReviews = new Map<string, import('child_process').ChildProcess>();

const REBASE_POLL_INTERVAL_MS = 1000;
// Default rebase timeout (60 seconds). Can be overridden via GITLAB_REBASE_TIMEOUT_MS env var
const REBASE_TIMEOUT_MS = parseInt(process.env.GITLAB_REBASE_TIMEOUT_MS || '60000', 10);

/**
 * Get the registry key for an MR review
 */
function getReviewKey(projectId: string, mrIid: number): string {
  return `${projectId}:${mrIid}`;
}

/**
 * Get the GitLab directory for a project
 */
function getGitLabDir(project: Project): string {
  return path.join(project.path, '.auto-claude', 'gitlab');
}

async function waitForRebaseCompletion(
  token: string,
  instanceUrl: string,
  encodedProject: string,
  mrIid: number
): Promise<void> {
  const deadline = Date.now() + REBASE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const mrData = await gitlabFetch(
      token,
      instanceUrl,
      `/projects/${encodedProject}/merge_requests/${mrIid}`
    ) as { rebase_in_progress?: boolean };

    if (!mrData.rebase_in_progress) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, REBASE_POLL_INTERVAL_MS));
  }

  throw new Error('Rebase did not complete before timeout');
}

/**
 * Get saved MR review result
 */
function getReviewResult(project: Project, mrIid: number): MRReviewResult | null {
  const reviewPath = path.join(getGitLabDir(project), 'mr', `review_${mrIid}.json`);

  if (fs.existsSync(reviewPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
      return {
        mrIid: data.mr_iid,
        project: data.project,
        success: data.success,
        findings: data.findings?.map((f: Record<string, unknown>) => ({
          id: f.id,
          severity: f.severity,
          category: f.category,
          title: f.title,
          description: f.description,
          file: f.file,
          line: f.line,
          endLine: f.end_line,
          suggestedFix: f.suggested_fix,
          fixable: f.fixable ?? false,
        })) ?? [],
        summary: data.summary ?? '',
        overallStatus: data.overall_status ?? 'comment',
        reviewedAt: data.reviewed_at ?? new Date().toISOString(),
        reviewedCommitSha: data.reviewed_commit_sha,
        isFollowupReview: data.is_followup_review ?? false,
        previousReviewId: data.previous_review_id,
        resolvedFindings: data.resolved_findings ?? [],
        unresolvedFindings: data.unresolved_findings ?? [],
        newFindingsSinceLastReview: data.new_findings_since_last_review ?? [],
        hasPostedFindings: data.has_posted_findings ?? false,
        postedFindingIds: data.posted_finding_ids ?? [],
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Get GitLab MR model and thinking settings from app settings
 */
function getGitLabMRSettings(): { model: string; thinkingLevel: string } {
  const rawSettings = readSettingsFile() as Partial<AppSettings> | undefined;

  // Get feature models/thinking with defaults
  const featureModels = rawSettings?.featureModels ?? DEFAULT_FEATURE_MODELS;
  const featureThinking = rawSettings?.featureThinking ?? DEFAULT_FEATURE_THINKING;

  // Use GitHub PRs settings as fallback (GitLab MRs not yet in settings)
  const modelShort = featureModels.githubPrs ?? DEFAULT_FEATURE_MODELS.githubPrs;
  const thinkingLevel = featureThinking.githubPrs ?? DEFAULT_FEATURE_THINKING.githubPrs;

  // Convert model short name to full model ID
  const model = MODEL_ID_MAP[modelShort] ?? MODEL_ID_MAP['opus'];

  debugLog('GitLab MR settings', { modelShort, model, thinkingLevel });

  return { model, thinkingLevel };
}

/**
 * Validate GitLab module is properly set up
 */
async function validateGitLabModule(project: Project): Promise<{ valid: boolean; backendPath?: string; error?: string }> {
  if (!project.autoBuildPath) {
    return { valid: false, error: 'Auto Build path not configured for this project' };
  }

  const backendPath = path.join(project.path, project.autoBuildPath);

  // Check if the runners directory exists
  const runnersPath = path.join(backendPath, 'runners', 'gitlab');
  if (!fs.existsSync(runnersPath)) {
    return { valid: false, error: 'GitLab runners not found. Please ensure the backend is properly installed.' };
  }

  return { valid: true, backendPath };
}

/**
 * Run the Python MR reviewer
 */
async function runMRReview(
  project: Project,
  mrIid: number,
  mainWindow: BrowserWindow
): Promise<MRReviewResult> {
  const validation = await validateGitLabModule(project);

  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const backendPath = validation.backendPath!;

  const { sendProgress } = createIPCCommunicators<MRReviewProgress, MRReviewResult>(
    mainWindow,
    {
      progress: IPC_CHANNELS.GITLAB_MR_REVIEW_PROGRESS,
      error: IPC_CHANNELS.GITLAB_MR_REVIEW_ERROR,
      complete: IPC_CHANNELS.GITLAB_MR_REVIEW_COMPLETE,
    },
    project.id
  );

  const { model, thinkingLevel } = getGitLabMRSettings();
  const args = buildRunnerArgs(
    getGitLabRunnerPath(backendPath),
    project.path,
    'review-mr',
    [mrIid.toString()],
    { model, thinkingLevel }
  );

  debugLog('Spawning MR review process', { args, model, thinkingLevel });

  // Get runner environment with PYTHONPATH for bundled packages (fixes #139)
  const subprocessEnv = await getRunnerEnv();

  const { process: childProcess, promise } = runPythonSubprocess<MRReviewResult>({
    pythonPath: getPythonPath(backendPath),
    args,
    cwd: backendPath,
    env: subprocessEnv,
    onProgress: (percent, message) => {
      debugLog('Progress update', { percent, message });
      sendProgress({
        phase: 'analyzing',
        mrIid,
        progress: percent,
        message,
      });
    },
    onStdout: (line) => debugLog('STDOUT:', line),
    onStderr: (line) => debugLog('STDERR:', line),
    onAuthFailure: (authFailureInfo: AuthFailureInfo) => {
      debugLog('Auth failure detected in MR review', authFailureInfo);
      mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_AUTH_FAILURE, authFailureInfo);
    },
    onComplete: () => {
      const reviewResult = getReviewResult(project, mrIid);
      if (!reviewResult) {
        throw new Error('Review completed but result not found');
      }
      debugLog('Review result loaded', { findingsCount: reviewResult.findings.length });
      return reviewResult;
    },
  });

  // Register the running process
  const reviewKey = getReviewKey(project.id, mrIid);
  runningReviews.set(reviewKey, childProcess);
  debugLog('Registered review process', { reviewKey, pid: childProcess.pid });

  try {
    const result = await promise;

    if (!result.success) {
      throw new Error(result.error ?? 'Review failed');
    }

    return result.data!;
  } finally {
    runningReviews.delete(reviewKey);
    debugLog('Unregistered review process', { reviewKey });
  }
}

/**
 * Register MR review handlers
 */
export function registerMRReviewHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering MR review handlers');

  // Get MR diff (feature parity with GitHub PR diff)
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_MR_GET_DIFF,
    async (_, projectId: string, mrIid: number): Promise<string | null> => {
      return withProjectOrNull(projectId, async (project) => {
        const config = await getGitLabConfig(project);
        if (!config) return null;

        try {
          // Validate mrIid
          if (!Number.isInteger(mrIid) || mrIid <= 0) {
            throw new Error('Invalid MR IID');
          }

          const encodedProject = encodeProjectPath(config.project);
          const diff = await gitlabFetch(
            config.token,
            config.instanceUrl,
            `/projects/${encodedProject}/merge_requests/${mrIid}/changes`
          ) as { changes: Array<{ diff: string }> };

          // Combine all file diffs
          return diff.changes.map(c => c.diff).join('\n');
        } catch (error) {
          debugLog('Failed to get MR diff', { mrIid, error: error instanceof Error ? error.message : error });
          return null;
        }
      });
    }
  );

  // Get saved review
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_MR_GET_REVIEW,
    async (_, projectId: string, mrIid: number): Promise<MRReviewResult | null> => {
      return withProjectOrNull(projectId, async (project) => {
        return getReviewResult(project, mrIid);
      });
    }
  );

  // Run AI review
  ipcMain.on(
    IPC_CHANNELS.GITLAB_MR_REVIEW,
    async (_, projectId: string, mrIid: number) => {
      debugLog('runMRReview handler called', { projectId, mrIid });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          const { sendProgress, sendComplete } = createIPCCommunicators<MRReviewProgress, MRReviewResult>(
            mainWindow,
            {
              progress: IPC_CHANNELS.GITLAB_MR_REVIEW_PROGRESS,
              error: IPC_CHANNELS.GITLAB_MR_REVIEW_ERROR,
              complete: IPC_CHANNELS.GITLAB_MR_REVIEW_COMPLETE,
            },
            projectId
          );

          debugLog('Starting MR review', { mrIid });
          sendProgress({
            phase: 'fetching',
            mrIid,
            progress: 5,
            message: 'Assigning you to MR...',
          });

          // Auto-assign current user to MR
          const config = await getGitLabConfig(project);
          if (config) {
            try {
              const encodedProject = encodeProjectPath(config.project);
              // Get current user
              const user = await gitlabFetch(config.token, config.instanceUrl, '/user') as { id: number; username: string };
              debugLog('Auto-assigning user to MR', { mrIid, username: user.username });

              // Assign to MR
              await gitlabFetch(
                config.token,
                config.instanceUrl,
                `/projects/${encodedProject}/merge_requests/${mrIid}`,
                {
                  method: 'PUT',
                  body: JSON.stringify({ assignee_ids: [user.id] }),
                }
              );
              debugLog('User assigned successfully', { mrIid, username: user.username });
            } catch (assignError) {
              debugLog('Failed to auto-assign user', { mrIid, error: assignError instanceof Error ? assignError.message : assignError });
            }
          }

          sendProgress({
            phase: 'fetching',
            mrIid,
            progress: 10,
            message: 'Fetching MR data...',
          });

          const result = await runMRReview(project, mrIid, mainWindow);

          debugLog('MR review completed', { mrIid, findingsCount: result.findings.length });
          sendProgress({
            phase: 'complete',
            mrIid,
            progress: 100,
            message: 'Review complete!',
          });

          sendComplete(result);
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        debugLog('MR review failed', { mrIid, error: errorMessage });
        const { sendError } = createIPCCommunicators<MRReviewProgress, MRReviewResult>(
          mainWindow,
          {
            progress: IPC_CHANNELS.GITLAB_MR_REVIEW_PROGRESS,
            error: IPC_CHANNELS.GITLAB_MR_REVIEW_ERROR,
            complete: IPC_CHANNELS.GITLAB_MR_REVIEW_COMPLETE,
          },
          projectId
        );
        sendError({ mrIid, error: `MR review failed for MR #${mrIid}: ${errorMessage}` });
      }
    }
  );

  // Post review as note to MR
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_MR_POST_REVIEW,
    async (_, projectId: string, mrIid: number, selectedFindingIds?: string[]): Promise<boolean> => {
      debugLog('postMRReview handler called', { projectId, mrIid, selectedCount: selectedFindingIds?.length });
      const postResult = await withProjectOrNull(projectId, async (project) => {
        const result = getReviewResult(project, mrIid);
        if (!result) {
          debugLog('No review result found', { mrIid });
          return false;
        }

        const config = await getGitLabConfig(project);
        if (!config) {
          debugLog('No GitLab config found');
          return false;
        }

        try {
          // Filter findings if selection provided
          const selectedSet = selectedFindingIds ? new Set(selectedFindingIds) : null;
          const findings = selectedSet
            ? result.findings.filter(f => selectedSet.has(f.id))
            : result.findings;

          debugLog('Posting findings', { total: result.findings.length, selected: findings.length });

          // Build note body
          let body = `## Auto Claude MR Review\n\n${result.summary}\n\n`;

          if (findings.length > 0) {
            const countText = selectedSet
              ? `${findings.length} selected of ${result.findings.length} total`
              : `${findings.length} total`;
            body += `### Findings (${countText})\n\n`;

            for (const f of findings) {
              const emoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' }[f.severity] || '⚪';
              body += `#### ${emoji} [${f.severity.toUpperCase()}] ${f.title}\n`;
              body += `📁 \`${f.file}:${f.line}\`\n\n`;
              body += `${f.description}\n\n`;
              const suggestedFix = f.suggestedFix?.trim();
              if (suggestedFix) {
                body += `**Suggested fix:**\n\`\`\`\n${suggestedFix}\n\`\`\`\n\n`;
              }
            }
          } else {
            body += `*No findings selected for this review.*\n\n`;
          }

          body += `---\n*This review was generated by Auto Claude.*`;

          const encodedProject = encodeProjectPath(config.project);

          // Post as note (comment) to the MR
          await gitlabFetch(
            config.token,
            config.instanceUrl,
            `/projects/${encodedProject}/merge_requests/${mrIid}/notes`,
            {
              method: 'POST',
              body: JSON.stringify({ body }),
            }
          );

          debugLog('Review note posted successfully', { mrIid });

          // Update the stored review result with posted findings
          // Use atomic write with temp file to prevent race conditions
          const reviewPath = path.join(getGitLabDir(project), 'mr', `review_${mrIid}.json`);
          const tempPath = `${reviewPath}.tmp.${randomUUID()}`;
          try {
            const data = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
            data.has_posted_findings = true;
            const newPostedIds = findings.map(f => f.id);
            const existingPostedIds = data.posted_finding_ids || [];
            data.posted_finding_ids = [...new Set([...existingPostedIds, ...newPostedIds])];
            // Write to temp file first, then rename atomically
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
            fs.renameSync(tempPath, reviewPath);
            debugLog('Updated review result with posted findings', { mrIid, postedCount: newPostedIds.length });
          } catch (error) {
            // Clean up temp file if it exists
            try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup errors */ }
            debugLog('Failed to update review result file', { error: error instanceof Error ? error.message : error });
          }

          return true;
        } catch (error) {
          debugLog('Failed to post review', { mrIid, error: error instanceof Error ? error.message : error });
          return false;
        }
      });
      return postResult ?? false;
    }
  );

  // Post note to MR
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_MR_POST_NOTE,
    async (_, projectId: string, mrIid: number, body: string): Promise<boolean> => {
      debugLog('postMRNote handler called', { projectId, mrIid });
      const postResult = await withProjectOrNull(projectId, async (project) => {
        const config = await getGitLabConfig(project);
        if (!config) return false;

        try {
          const encodedProject = encodeProjectPath(config.project);
          await gitlabFetch(
            config.token,
            config.instanceUrl,
            `/projects/${encodedProject}/merge_requests/${mrIid}/notes`,
            {
              method: 'POST',
              body: JSON.stringify({ body }),
            }
          );
          debugLog('Note posted successfully', { mrIid });
          return true;
        } catch (error) {
          debugLog('Failed to post note', { mrIid, error: error instanceof Error ? error.message : error });
          return false;
        }
      });
      return postResult ?? false;
    }
  );

  // Merge MR
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_MR_MERGE,
    async (_, projectId: string, mrIid: number, mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<boolean> => {
      debugLog('mergeMR handler called', { projectId, mrIid, mergeMethod });
      const mergeResult = await withProjectOrNull(projectId, async (project) => {
        const config = await getGitLabConfig(project);
        if (!config) return false;

        try {
          // Validate mrIid
          if (!Number.isInteger(mrIid) || mrIid <= 0) {
            throw new Error('Invalid MR IID');
          }

          const encodedProject = encodeProjectPath(config.project);

          // Determine merge options based on method
          const mergeOptions: Record<string, unknown> = {};
          if (mergeMethod === 'squash') {
            mergeOptions.squash = true;
          } else if (mergeMethod === 'rebase') {
            debugLog('Rebasing MR before merge', { mrIid });
            await gitlabFetch(
              config.token,
              config.instanceUrl,
              `/projects/${encodedProject}/merge_requests/${mrIid}/rebase`,
              { method: 'POST' }
            );
            await waitForRebaseCompletion(
              config.token,
              config.instanceUrl,
              encodedProject,
              mrIid
            );
          }

          debugLog('Merging MR', { mrIid, method: mergeMethod, options: mergeOptions });

          await gitlabFetch(
            config.token,
            config.instanceUrl,
            `/projects/${encodedProject}/merge_requests/${mrIid}/merge`,
            {
              method: 'PUT',
              body: JSON.stringify(mergeOptions),
            }
          );

          debugLog('MR merged successfully', { mrIid });
          return true;
        } catch (error) {
          debugLog('Failed to merge MR', { mrIid, error: error instanceof Error ? error.message : error });
          return false;
        }
      });
      return mergeResult ?? false;
    }
  );

  // Assign users to MR
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_MR_ASSIGN,
    async (_, projectId: string, mrIid: number, userIds: number[]): Promise<boolean> => {
      debugLog('assignMR handler called', { projectId, mrIid, userIds });
      const assignResult = await withProjectOrNull(projectId, async (project) => {
        const config = await getGitLabConfig(project);
        if (!config) return false;

        try {
          const encodedProject = encodeProjectPath(config.project);
          await gitlabFetch(
            config.token,
            config.instanceUrl,
            `/projects/${encodedProject}/merge_requests/${mrIid}`,
            {
              method: 'PUT',
              body: JSON.stringify({ assignee_ids: userIds }),
            }
          );
          debugLog('Users assigned successfully', { mrIid, userIds });
          return true;
        } catch (error) {
          debugLog('Failed to assign users', { mrIid, userIds, error: error instanceof Error ? error.message : error });
          return false;
        }
      });
      return assignResult ?? false;
    }
  );

  // Approve MR
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_MR_APPROVE,
    async (_, projectId: string, mrIid: number): Promise<boolean> => {
      debugLog('approveMR handler called', { projectId, mrIid });
      const approveResult = await withProjectOrNull(projectId, async (project) => {
        const config = await getGitLabConfig(project);
        if (!config) return false;

        try {
          const encodedProject = encodeProjectPath(config.project);
          await gitlabFetch(
            config.token,
            config.instanceUrl,
            `/projects/${encodedProject}/merge_requests/${mrIid}/approve`,
            {
              method: 'POST',
            }
          );
          debugLog('MR approved successfully', { mrIid });
          return true;
        } catch (error) {
          debugLog('Failed to approve MR', { mrIid, error: error instanceof Error ? error.message : error });
          return false;
        }
      });
      return approveResult ?? false;
    }
  );

  // Cancel MR review
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_MR_REVIEW_CANCEL,
    async (_, projectId: string, mrIid: number): Promise<boolean> => {
      debugLog('cancelMRReview handler called', { projectId, mrIid });
      const reviewKey = getReviewKey(projectId, mrIid);
      const childProcess = runningReviews.get(reviewKey);

      if (!childProcess) {
        debugLog('No running review found to cancel', { reviewKey });
        return false;
      }

      try {
        debugLog('Killing review process', { reviewKey, pid: childProcess.pid });
        childProcess.kill('SIGTERM');

        setTimeout(() => {
          if (!childProcess.killed) {
            debugLog('Force killing review process', { reviewKey, pid: childProcess.pid });
            childProcess.kill('SIGKILL');
          }
        }, 1000);

        runningReviews.delete(reviewKey);
        debugLog('Review process cancelled', { reviewKey });
        return true;
      } catch (error) {
        debugLog('Failed to cancel review', { reviewKey, error: error instanceof Error ? error.message : error });
        return false;
      }
    }
  );

  // Check for new commits since last review
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_MR_CHECK_NEW_COMMITS,
    async (_, projectId: string, mrIid: number): Promise<NewCommitsCheck> => {
      debugLog('checkNewCommits handler called', { projectId, mrIid });

      const result = await withProjectOrNull(projectId, async (project) => {
        const gitlabDir = path.join(project.path, '.auto-claude', 'gitlab');
        const reviewPath = path.join(gitlabDir, 'mr', `review_${mrIid}.json`);

        if (!fs.existsSync(reviewPath)) {
          return { hasNewCommits: false };
        }

        let review: MRReviewResult;
        try {
          const data = fs.readFileSync(reviewPath, 'utf-8');
          review = JSON.parse(data);
        } catch {
          return { hasNewCommits: false };
        }

        const reviewedCommitSha = review.reviewedCommitSha || (review as any).reviewed_commit_sha;
        if (!reviewedCommitSha) {
          debugLog('No reviewedCommitSha in review', { mrIid });
          return { hasNewCommits: false };
        }

        const config = await getGitLabConfig(project);
        if (!config) {
          return { hasNewCommits: false };
        }

        try {
          const encodedProject = encodeProjectPath(config.project);
          const mrData = await gitlabFetch(
            config.token,
            config.instanceUrl,
            `/projects/${encodedProject}/merge_requests/${mrIid}`
          ) as { sha: string; diff_refs: { head_sha: string } };

          const currentHeadSha = mrData.sha || mrData.diff_refs?.head_sha;

          if (reviewedCommitSha === currentHeadSha) {
            return {
              hasNewCommits: false,
              currentSha: currentHeadSha,
              reviewedSha: reviewedCommitSha,
            };
          }

          // Get commits to count new ones
          const commits = await gitlabFetch(
            config.token,
            config.instanceUrl,
            `/projects/${encodedProject}/merge_requests/${mrIid}/commits`
          ) as Array<{ id: string }>;

          // Find how many commits are after the reviewed one
          let newCommitCount = 0;
          for (const commit of commits) {
            if (commit.id === reviewedCommitSha) break;
            newCommitCount++;
          }

          return {
            hasNewCommits: true,
            currentSha: currentHeadSha,
            reviewedSha: reviewedCommitSha,
            newCommitCount: newCommitCount || 1,
          };
        } catch (error) {
          debugLog('Error checking new commits', { mrIid, error: error instanceof Error ? error.message : error });
          return { hasNewCommits: false };
        }
      });

      return result ?? { hasNewCommits: false };
    }
  );

  // Run follow-up review
  ipcMain.on(
    IPC_CHANNELS.GITLAB_MR_FOLLOWUP_REVIEW,
    async (_, projectId: string, mrIid: number) => {
      debugLog('followupReview handler called', { projectId, mrIid });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          const { sendProgress, sendError, sendComplete } = createIPCCommunicators<MRReviewProgress, MRReviewResult>(
            mainWindow,
            {
              progress: IPC_CHANNELS.GITLAB_MR_REVIEW_PROGRESS,
              error: IPC_CHANNELS.GITLAB_MR_REVIEW_ERROR,
              complete: IPC_CHANNELS.GITLAB_MR_REVIEW_COMPLETE,
            },
            projectId
          );

          const validation = await validateGitLabModule(project);
          if (!validation.valid) {
            sendError({ mrIid, error: validation.error || 'GitLab module validation failed' });
            return;
          }

          const backendPath = validation.backendPath!;
          const reviewKey = getReviewKey(projectId, mrIid);

          if (runningReviews.has(reviewKey)) {
            debugLog('Follow-up review already running', { reviewKey });
            return;
          }

          debugLog('Starting follow-up review', { mrIid });
          sendProgress({
            phase: 'fetching',
            mrIid,
            progress: 5,
            message: 'Starting follow-up review...',
          });

          const { model, thinkingLevel } = getGitLabMRSettings();
          const args = buildRunnerArgs(
            getGitLabRunnerPath(backendPath),
            project.path,
            'followup-review-mr',
            [mrIid.toString()],
            { model, thinkingLevel }
          );

          debugLog('Spawning follow-up review process', { args, model, thinkingLevel });

          // Get runner environment with PYTHONPATH for bundled packages (fixes #139)
          const followupSubprocessEnv = await getRunnerEnv();

          const { process: childProcess, promise } = runPythonSubprocess<MRReviewResult>({
            pythonPath: getPythonPath(backendPath),
            args,
            cwd: backendPath,
            env: followupSubprocessEnv,
            onProgress: (percent, message) => {
              debugLog('Progress update', { percent, message });
              sendProgress({
                phase: 'analyzing',
                mrIid,
                progress: percent,
                message,
              });
            },
            onStdout: (line) => debugLog('STDOUT:', line),
            onStderr: (line) => debugLog('STDERR:', line),
            onAuthFailure: (authFailureInfo: AuthFailureInfo) => {
              debugLog('Auth failure detected in follow-up MR review', authFailureInfo);
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_AUTH_FAILURE, authFailureInfo);
            },
            onComplete: () => {
              const reviewResult = getReviewResult(project, mrIid);
              if (!reviewResult) {
                throw new Error('Follow-up review completed but result not found');
              }
              debugLog('Follow-up review result loaded', { findingsCount: reviewResult.findings.length });
              return reviewResult;
            },
          });

          runningReviews.set(reviewKey, childProcess);
          debugLog('Registered follow-up review process', { reviewKey, pid: childProcess.pid });

          try {
            const result = await promise;

            if (!result.success) {
              throw new Error(result.error ?? 'Follow-up review failed');
            }

            debugLog('Follow-up review completed', { mrIid, findingsCount: result.data?.findings.length });
            sendProgress({
              phase: 'complete',
              mrIid,
              progress: 100,
              message: 'Follow-up review complete!',
            });

            sendComplete(result.data!);
          } finally {
            runningReviews.delete(reviewKey);
            debugLog('Unregistered follow-up review process', { reviewKey });
          }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        debugLog('Follow-up review failed', { mrIid, error: errorMessage });
        const { sendError } = createIPCCommunicators<MRReviewProgress, MRReviewResult>(
          mainWindow,
          {
            progress: IPC_CHANNELS.GITLAB_MR_REVIEW_PROGRESS,
            error: IPC_CHANNELS.GITLAB_MR_REVIEW_ERROR,
            complete: IPC_CHANNELS.GITLAB_MR_REVIEW_COMPLETE,
          },
          projectId
        );
        sendError({ mrIid, error: `Follow-up review failed for MR #${mrIid}: ${errorMessage}` });
      }
    }
  );

  debugLog('MR review handlers registered');
}
