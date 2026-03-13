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
  MRReviewEngine,
  type MRContext,
  type MRReviewEngineConfig,
} from '../../ai/runners/gitlab/mr-review-engine';
import type { ModelShorthand, ThinkingLevel } from '../../ai/config/types';

// Debug logging
const { debug: debugLog } = createContextLogger('GitLab MR');

/**
 * Registry of running MR review abort controllers
 * Key format: `${projectId}:${mrIid}`
 */
const runningReviews = new Map<string, AbortController>();

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
 * Fetch MR context from GitLab API for TypeScript review engine.
 */
async function fetchMRContext(
  config: { token: string; instanceUrl: string; project: string },
  mrIid: number
): Promise<MRContext> {
  const encodedProject = encodeProjectPath(config.project);

  // Fetch MR metadata
  const mr = await gitlabFetch(
    config.token,
    config.instanceUrl,
    `/projects/${encodedProject}/merge_requests/${mrIid}`
  ) as {
    iid: number;
    title: string;
    description?: string;
    author: { username: string };
    source_branch: string;
    target_branch: string;
    changes_count?: string;
    diff_refs?: { head_sha?: string };
    sha?: string;
  };

  // Fetch changed files
  const changes = await gitlabFetch(
    config.token,
    config.instanceUrl,
    `/projects/${encodedProject}/merge_requests/${mrIid}/changes`
  ) as { changes: Array<{ new_path?: string; old_path?: string; diff: string; new_file?: boolean; deleted_file?: boolean }> };

  // Build diff from changes
  let diff = changes.changes
    .map((c) => {
      const filePath = c.new_path ?? c.old_path ?? 'unknown';
      return `diff --git a/${filePath} b/${filePath}\n${c.diff}`;
    })
    .join('\n');

  if (diff.length > 200000) {
    diff = diff.slice(0, 200000);
  }

  // Count additions/deletions from diff
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) totalAdditions++;
    else if (line.startsWith('-') && !line.startsWith('---')) totalDeletions++;
  }

  return {
    mrIid: mr.iid,
    title: mr.title,
    description: mr.description,
    author: mr.author.username,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    changedFiles: changes.changes,
    diff,
    totalAdditions,
    totalDeletions,
  };
}

/**
 * Save MR review result to disk in the format expected by getReviewResult().
 */
function saveMRReviewResultToDisk(
  project: Project,
  mrIid: number,
  result: MRReviewResult,
  reviewedCommitSha?: string
): void {
  const mrDir = path.join(getGitLabDir(project), 'mr');
  fs.mkdirSync(mrDir, { recursive: true });
  const reviewPath = path.join(mrDir, `review_${mrIid}.json`);

  const data = {
    mr_iid: result.mrIid,
    project: result.project,
    success: result.success,
    findings: result.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      category: f.category,
      title: f.title,
      description: f.description,
      file: f.file,
      line: f.line,
      end_line: f.endLine,
      suggested_fix: f.suggestedFix,
      fixable: f.fixable ?? false,
    })),
    summary: result.summary,
    overall_status: result.overallStatus,
    reviewed_at: result.reviewedAt,
    reviewed_commit_sha: reviewedCommitSha ?? result.reviewedCommitSha,
    is_followup_review: result.isFollowupReview ?? false,
    previous_review_id: result.previousReviewId,
    resolved_findings: result.resolvedFindings ?? [],
    unresolved_findings: result.unresolvedFindings ?? [],
    new_findings_since_last_review: result.newFindingsSinceLastReview ?? [],
    has_posted_findings: result.hasPostedFindings ?? false,
    posted_finding_ids: result.postedFindingIds ?? [],
  };

  fs.writeFileSync(reviewPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Run the TypeScript MR reviewer using MRReviewEngine
 */
async function runMRReview(
  project: Project,
  mrIid: number,
  mainWindow: BrowserWindow
): Promise<MRReviewResult> {
  const { sendProgress } = createIPCCommunicators<MRReviewProgress, MRReviewResult>(
    mainWindow,
    {
      progress: IPC_CHANNELS.GITLAB_MR_REVIEW_PROGRESS,
      error: IPC_CHANNELS.GITLAB_MR_REVIEW_ERROR,
      complete: IPC_CHANNELS.GITLAB_MR_REVIEW_COMPLETE,
    },
    project.id
  );

  const config = await getGitLabConfig(project);
  if (!config) {
    throw new Error('No GitLab configuration found for project');
  }

  const { model, thinkingLevel } = getGitLabMRSettings();
  const reviewKey = getReviewKey(project.id, mrIid);

  debugLog('Starting TypeScript MR review', { model, thinkingLevel, mrIid });

  sendProgress({ phase: 'fetching', mrIid, progress: 15, message: 'Fetching MR data from GitLab...' });

  const context = await fetchMRContext(config, mrIid);

  sendProgress({ phase: 'analyzing', mrIid, progress: 30, message: 'Starting AI review...' });

  const reviewConfig: MRReviewEngineConfig = {
    model: model as ModelShorthand,
    thinkingLevel: thinkingLevel as ThinkingLevel,
  };

  // Create AbortController for cancellation
  const abortController = new AbortController();
  runningReviews.set(reviewKey, abortController);
  debugLog('Registered review abort controller', { reviewKey });

  try {
    const engine = new MRReviewEngine(reviewConfig, (update) => {
      sendProgress({ phase: 'analyzing', mrIid, progress: update.progress, message: update.message });
    });

    const reviewResult = await engine.runReview(context, abortController.signal);

    // Map verdict to overallStatus
    const verdictToStatus: Record<string, MRReviewResult['overallStatus']> = {
      ready_to_merge: 'approve',
      merge_with_changes: 'comment',
      needs_revision: 'request_changes',
      blocked: 'request_changes',
    };
    const overallStatus = verdictToStatus[reviewResult.verdict] ?? 'comment';

    const result: MRReviewResult = {
      mrIid,
      project: config.project,
      success: true,
      findings: reviewResult.findings,
      summary: reviewResult.summary,
      overallStatus,
      reviewedAt: new Date().toISOString(),
    };

    // Save to disk
    saveMRReviewResultToDisk(project, mrIid, result);
    debugLog('MR review result saved to disk', { findingsCount: result.findings.length });

    return result;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Review cancelled');
    }
    throw err;
  } finally {
    runningReviews.delete(reviewKey);
    debugLog('Unregistered review abort controller', { reviewKey });
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
          let body = `## Aperant MR Review\n\n${result.summary}\n\n`;

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

          body += `---\n*This review was generated by Aperant.*`;

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
      const abortController = runningReviews.get(reviewKey);

      if (!abortController) {
        debugLog('No running review found to cancel', { reviewKey });
        return false;
      }

      try {
        debugLog('Aborting MR review', { reviewKey });
        abortController.abort();
        runningReviews.delete(reviewKey);
        debugLog('Review aborted', { reviewKey });
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

          const config = await getGitLabConfig(project);
          if (!config) {
            sendError({ mrIid, error: 'No GitLab configuration found for project' });
            return;
          }

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

          debugLog('Running TypeScript follow-up review', { model, thinkingLevel, mrIid });

          sendProgress({ phase: 'fetching', mrIid, progress: 15, message: 'Fetching MR data from GitLab...' });

          const context = await fetchMRContext(config, mrIid);

          sendProgress({ phase: 'analyzing', mrIid, progress: 30, message: 'Starting follow-up AI review...' });

          const reviewConfig: MRReviewEngineConfig = {
            model: model as ModelShorthand,
            thinkingLevel: thinkingLevel as ThinkingLevel,
          };

          const abortController = new AbortController();
          runningReviews.set(reviewKey, abortController);
          debugLog('Registered follow-up review abort controller', { reviewKey });

          try {
            const engine = new MRReviewEngine(reviewConfig, (update) => {
              sendProgress({ phase: 'analyzing', mrIid, progress: update.progress, message: update.message });
            });

            const reviewResult = await engine.runReview(context, abortController.signal);

            const verdictToStatus: Record<string, MRReviewResult['overallStatus']> = {
              ready_to_merge: 'approve',
              merge_with_changes: 'comment',
              needs_revision: 'request_changes',
              blocked: 'request_changes',
            };
            const overallStatus = verdictToStatus[reviewResult.verdict] ?? 'comment';

            const result: MRReviewResult = {
              mrIid,
              project: config.project,
              success: true,
              findings: reviewResult.findings,
              summary: reviewResult.summary,
              overallStatus,
              reviewedAt: new Date().toISOString(),
              isFollowupReview: true,
            };

            // Save to disk
            saveMRReviewResultToDisk(project, mrIid, result);
            debugLog('Follow-up review result saved to disk', { findingsCount: result.findings.length });

            debugLog('Follow-up review completed', { mrIid, findingsCount: result.findings.length });
            sendProgress({
              phase: 'complete',
              mrIid,
              progress: 100,
              message: 'Follow-up review complete!',
            });

            sendComplete(result);
          } finally {
            runningReviews.delete(reviewKey);
            debugLog('Unregistered follow-up review', { reviewKey });
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
