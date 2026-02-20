/**
 * GitHub Issue Mutation IPC handlers.
 * Single-issue operations: edit title, edit body, add/remove labels,
 * add/remove assignees, close, reopen, comment.
 *
 * Uses execFileSync with array args to prevent command injection.
 * Body/comment use temp file pattern (--body-file) for large content.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { execFileSync } from 'child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { IPC_CHANNELS } from '../../../shared/constants/ipc';
import type { MutationResult } from '../../../shared/types/mutations';
import {
  validateTitle,
  validateBody,
  validateLabel,
  validateLogin,
  validateIssueNumber,
} from '../../../shared/utils/mutation-validation';
import { COMMENT_MAX_LENGTH } from '../../../shared/constants/mutations';
import { isValidTransition } from '../../../shared/constants/enrichment';
import {
  readEnrichmentFile,
  writeEnrichmentFile,
  withEnrichmentFileLock,
  appendTransition,
} from './enrichment-persistence';
import { withProject } from './utils/project-middleware';
import { getAugmentedEnv } from '../../env-utils';
import { getToolPath } from '../../cli-tool-manager';
import { createContextLogger } from './utils/logger';

const logger = createContextLogger('GitHub Mutations');

const MAX_TEMP_FILE_SIZE = 65_536; // Match GitHub's limit

/**
 * Write content to a temp file, returning the path.
 * Uses mkdtempSync for secure temp directory creation.
 * Caller is responsible for cleanup via cleanupTempFile.
 */
function writeTempFile(prefix: string, content: string): string {
  if (Buffer.byteLength(content, 'utf-8') > MAX_TEMP_FILE_SIZE) {
    throw new Error(`Content exceeds maximum size of ${MAX_TEMP_FILE_SIZE} bytes`);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const tmpPath = path.join(tmpDir, 'content.txt');
  fs.writeFileSync(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
  return tmpPath;
}

/**
 * Remove temp file, ignoring errors if already deleted.
 */
function cleanupTempFile(tmpPath: string): void {
  try {
    fs.unlinkSync(tmpPath);
    // Also remove the parent temp directory created by mkdtempSync
    const tmpDir = path.dirname(tmpPath);
    if (tmpDir !== os.tmpdir()) {
      fs.rmdirSync(tmpDir);
    }
  } catch {
          // Already cleaned up or never created
  }
}

/**
 * Auto-transition enrichment when an issue is closed.
 * Transitions to 'done' with resolution 'completed' if the current state allows it.
 */
async function transitionEnrichmentOnClose(
  projectPath: string,
  issueNumber: number,
): Promise<void> {
  try {
    await withEnrichmentFileLock(projectPath, async () => {
      const data = await readEnrichmentFile(projectPath);
      const key = String(issueNumber);
      const enrichment = data.issues[key];

      if (!enrichment) return;

      const from = enrichment.triageState;

      // Only transition if closing is valid from current state
      if (from === 'done') return; // Already done
      if (!isValidTransition(from, 'done') && from !== 'blocked') return;

      enrichment.previousState = undefined;
      enrichment.triageState = 'done';
      enrichment.resolution = 'completed';
      enrichment.updatedAt = new Date().toISOString();
      data.issues[key] = enrichment;

      await writeEnrichmentFile(projectPath, data);
      await appendTransition(projectPath, {
        issueNumber,
        from,
        to: 'done',
        actor: 'user',
        resolution: 'completed',
        timestamp: enrichment.updatedAt,
      });

      logger.debug(`Auto-transitioned issue #${issueNumber} from ${from} to done`);
    });
  } catch (error) {
    logger.debug(`Failed to auto-transition enrichment on close for #${issueNumber}`, error);
  }
}

/**
 * Auto-transition enrichment when an issue is reopened.
 * Transitions from 'done' to 'ready'.
 */
async function transitionEnrichmentOnReopen(
  projectPath: string,
  issueNumber: number,
): Promise<void> {
  try {
    await withEnrichmentFileLock(projectPath, async () => {
      const data = await readEnrichmentFile(projectPath);
      const key = String(issueNumber);
      const enrichment = data.issues[key];

      if (!enrichment) return;

      const from = enrichment.triageState;

      // Only transition if currently done
      if (from !== 'done') return;
      if (!isValidTransition('done', 'ready')) return;

      enrichment.triageState = 'ready';
      enrichment.resolution = undefined;
      enrichment.updatedAt = new Date().toISOString();
      data.issues[key] = enrichment;

      await writeEnrichmentFile(projectPath, data);
      await appendTransition(projectPath, {
        issueNumber,
        from: 'done',
        to: 'ready',
        actor: 'user',
        timestamp: enrichment.updatedAt,
      });

      logger.debug(`Auto-transitioned issue #${issueNumber} from done to ready`);
    });
  } catch (error) {
    logger.debug(`Failed to auto-transition enrichment on reopen for #${issueNumber}`, error);
  }
}

export function registerMutationHandlers(
  _getMainWindow: () => BrowserWindow | null,
): void {
  // ---- Edit Title ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_ISSUE_EDIT_TITLE,
    async (_, projectId: string, issueNumber: number, title: string): Promise<MutationResult> => {
      const numValidation = validateIssueNumber(issueNumber);
      if (!numValidation.valid) {
        return { success: false, issueNumber, error: numValidation.error };
      }

      const titleValidation = validateTitle(title);
      if (!titleValidation.valid) {
        return { success: false, issueNumber, error: titleValidation.error };
      }

      return withProject(projectId, async (project) => {
        try {
          execFileSync(getToolPath('gh'), ['issue', 'edit', String(issueNumber), '--title', title], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });
          return { success: true, issueNumber };
        } catch (error) {
          return {
            success: false,
            issueNumber,
            error: error instanceof Error ? error.message : 'Failed to edit title',
          };
        }
      });
    },
  );

  // ---- Edit Body ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_ISSUE_EDIT_BODY,
    async (_, projectId: string, issueNumber: number, body: string | null): Promise<MutationResult> => {
      const numValidation = validateIssueNumber(issueNumber);
      if (!numValidation.valid) {
        return { success: false, issueNumber, error: numValidation.error };
      }

      const bodyValidation = validateBody(body);
      if (!bodyValidation.valid) {
        return { success: false, issueNumber, error: bodyValidation.error };
      }

      return withProject(projectId, async (project) => {
        // Null body means clear the body
        if (body === null) {
          try {
            execFileSync(getToolPath('gh'), ['issue', 'edit', String(issueNumber), '--body', ''], {
              cwd: project.path,
              env: getAugmentedEnv(),
            });
            return { success: true, issueNumber };
          } catch (error) {
            return {
              success: false,
              issueNumber,
              error: error instanceof Error ? error.message : 'Failed to clear body',
            };
          }
        }

        // Use temp file for body content
        const tmpPath = writeTempFile('gh-body', body);
        try {
          execFileSync(getToolPath('gh'), ['issue', 'edit', String(issueNumber), '--body-file', tmpPath], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });
          return { success: true, issueNumber };
        } catch (error) {
          return {
            success: false,
            issueNumber,
            error: error instanceof Error ? error.message : 'Failed to edit body',
          };
        } finally {
          cleanupTempFile(tmpPath);
        }
      });
    },
  );

  // ---- Add Labels ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_ISSUE_ADD_LABELS,
    async (_, projectId: string, issueNumber: number, labels: string[]): Promise<MutationResult> => {
      const numValidation = validateIssueNumber(issueNumber);
      if (!numValidation.valid) {
        return { success: false, issueNumber, error: numValidation.error };
      }

      for (const label of labels) {
        const labelValidation = validateLabel(label);
        if (!labelValidation.valid) {
          return { success: false, issueNumber, error: labelValidation.error };
        }
      }

      return withProject(projectId, async (project) => {
        try {
          execFileSync(getToolPath('gh'), ['issue', 'edit', String(issueNumber), '--add-label', labels.join(',')], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });
          return { success: true, issueNumber };
        } catch (error) {
          return {
            success: false,
            issueNumber,
            error: error instanceof Error ? error.message : 'Failed to add labels',
          };
        }
      });
    },
  );

  // ---- Remove Labels ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_ISSUE_REMOVE_LABELS,
    async (_, projectId: string, issueNumber: number, labels: string[]): Promise<MutationResult> => {
      const numValidation = validateIssueNumber(issueNumber);
      if (!numValidation.valid) {
        return { success: false, issueNumber, error: numValidation.error };
      }

      for (const label of labels) {
        const labelValidation = validateLabel(label);
        if (!labelValidation.valid) {
          return { success: false, issueNumber, error: labelValidation.error };
        }
      }

      return withProject(projectId, async (project) => {
        try {
          execFileSync(getToolPath('gh'), ['issue', 'edit', String(issueNumber), '--remove-label', labels.join(',')], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });
          return { success: true, issueNumber };
        } catch (error) {
          return {
            success: false,
            issueNumber,
            error: error instanceof Error ? error.message : 'Failed to remove labels',
          };
        }
      });
    },
  );

  // ---- Add Assignees ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_ISSUE_ADD_ASSIGNEES,
    async (_, projectId: string, issueNumber: number, assignees: string[]): Promise<MutationResult> => {
      const numValidation = validateIssueNumber(issueNumber);
      if (!numValidation.valid) {
        return { success: false, issueNumber, error: numValidation.error };
      }

      for (const assignee of assignees) {
        const loginValidation = validateLogin(assignee);
        if (!loginValidation.valid) {
          return { success: false, issueNumber, error: loginValidation.error };
        }
      }

      return withProject(projectId, async (project) => {
        try {
          execFileSync(getToolPath('gh'), ['issue', 'edit', String(issueNumber), '--add-assignee', assignees.join(',')], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });
          return { success: true, issueNumber };
        } catch (error) {
          return {
            success: false,
            issueNumber,
            error: error instanceof Error ? error.message : 'Failed to add assignees',
          };
        }
      });
    },
  );

  // ---- Remove Assignees ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_ISSUE_REMOVE_ASSIGNEES,
    async (_, projectId: string, issueNumber: number, assignees: string[]): Promise<MutationResult> => {
      const numValidation = validateIssueNumber(issueNumber);
      if (!numValidation.valid) {
        return { success: false, issueNumber, error: numValidation.error };
      }

      for (const assignee of assignees) {
        const loginValidation = validateLogin(assignee);
        if (!loginValidation.valid) {
          return { success: false, issueNumber, error: loginValidation.error };
        }
      }

      return withProject(projectId, async (project) => {
        try {
          execFileSync(getToolPath('gh'), ['issue', 'edit', String(issueNumber), '--remove-assignee', assignees.join(',')], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });
          return { success: true, issueNumber };
        } catch (error) {
          return {
            success: false,
            issueNumber,
            error: error instanceof Error ? error.message : 'Failed to remove assignees',
          };
        }
      });
    },
  );

  // ---- Close Issue ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_ISSUE_CLOSE,
    async (_, projectId: string, issueNumber: number): Promise<MutationResult> => {
      const numValidation = validateIssueNumber(issueNumber);
      if (!numValidation.valid) {
        return { success: false, issueNumber, error: numValidation.error };
      }

      return withProject(projectId, async (project) => {
        try {
          execFileSync(getToolPath('gh'), ['issue', 'close', String(issueNumber)], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });

          // Auto-transition enrichment to done
          await transitionEnrichmentOnClose(project.path, issueNumber);

          return { success: true, issueNumber };
        } catch (error) {
          return {
            success: false,
            issueNumber,
            error: error instanceof Error ? error.message : 'Failed to close issue',
          };
        }
      });
    },
  );

  // ---- Reopen Issue ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_ISSUE_REOPEN,
    async (_, projectId: string, issueNumber: number): Promise<MutationResult> => {
      const numValidation = validateIssueNumber(issueNumber);
      if (!numValidation.valid) {
        return { success: false, issueNumber, error: numValidation.error };
      }

      return withProject(projectId, async (project) => {
        try {
          execFileSync(getToolPath('gh'), ['issue', 'reopen', String(issueNumber)], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });

          // Auto-transition enrichment from done to ready
          await transitionEnrichmentOnReopen(project.path, issueNumber);

          return { success: true, issueNumber };
        } catch (error) {
          return {
            success: false,
            issueNumber,
            error: error instanceof Error ? error.message : 'Failed to reopen issue',
          };
        }
      });
    },
  );

  // ---- Comment on Issue ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_ISSUE_COMMENT,
    async (_, projectId: string, issueNumber: number, body: string): Promise<MutationResult> => {
      const numValidation = validateIssueNumber(issueNumber);
      if (!numValidation.valid) {
        return { success: false, issueNumber, error: numValidation.error };
      }

      if (!body.trim()) {
        return { success: false, issueNumber, error: 'Comment cannot be empty' };
      }

      if (body.length > COMMENT_MAX_LENGTH) {
        return { success: false, issueNumber, error: `Comment exceeds ${COMMENT_MAX_LENGTH} characters` };
      }

      return withProject(projectId, async (project) => {
        const tmpPath = writeTempFile('gh-comment', body);
        try {
          execFileSync(getToolPath('gh'), ['issue', 'comment', String(issueNumber), '--body-file', tmpPath], {
            cwd: project.path,
            env: getAugmentedEnv(),
          });
          return { success: true, issueNumber };
        } catch (error) {
          return {
            success: false,
            issueNumber,
            error: error instanceof Error ? error.message : 'Failed to add comment',
          };
        } finally {
          cleanupTempFile(tmpPath);
        }
      });
    },
  );
}
