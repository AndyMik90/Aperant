/**
 * Issue Create IPC handler (Phase 3)
 *
 * Creates GitHub issues via `gh issue create`.
 * Uses temp file pattern for body content (--body-file).
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IPC_CHANNELS } from '../../../shared/constants';
import { getAugmentedEnv } from '../../env-utils';
import { getToolPath } from '../../cli-tool-manager';
import { createContextLogger } from './utils/logger';
import { withProject } from './utils/project-middleware';
import { validateLabel, validateLogin } from '../../../shared/utils/mutation-validation';
import type { CreateIssueParams, CreateIssueResult } from '../../../shared/types/ai-triage';

const { debug: debugLog } = createContextLogger('Issue Create');

const MAX_TITLE_LENGTH = 256;

/**
 * Write content to a temp file and return the path.
 * Uses mkdtempSync for secure temp directory creation.
 */
function writeTempFile(prefix: string, content: string): string {
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
    const tmpDir = path.dirname(tmpPath);
    if (tmpDir !== os.tmpdir()) {
      fs.rmdirSync(tmpDir);
    }
  } catch {
          // Already cleaned up or never created
  }
}

/**
 * Spawn a command and return stdout as a promise.
 * Non-blocking alternative to execFileSync.
 */
function spawnAsync(
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string> }
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Parse issue number from gh CLI output URL.
 * gh issue create outputs: https://github.com/{owner}/{repo}/issues/{number}
 */
function parseIssueUrl(output: string): { number: number; url: string } {
  const url = output.trim();
  const match = url.match(/\/issues\/(\d+)$/);
  if (!match) {
    throw new Error(`Could not parse issue URL from gh output: ${url}`);
  }
  return { number: Number.parseInt(match[1], 10), url };
}

/**
 * Register issue create handler
 */
export function registerIssueCreateHandler(
  _getMainWindow: () => BrowserWindow | null,
): void {
  debugLog('Registering Issue Create handler');

  ipcMain.handle(
    IPC_CHANNELS.GITHUB_ISSUE_CREATE,
    async (_, projectId: string, params: CreateIssueParams): Promise<CreateIssueResult> => {
      debugLog('createIssue handler called', { projectId, title: params.title });

      return withProject(projectId, async (project) => {
        // Validate params
        if (!params.title || params.title.trim().length === 0) {
          throw new Error('Title is required');
        }
        if (params.title.length > MAX_TITLE_LENGTH) {
          throw new Error(`Title too long (max ${MAX_TITLE_LENGTH} characters)`);
        }

        // Validate labels
        if (params.labels && params.labels.length > 0) {
          for (const label of params.labels) {
            const labelValidation = validateLabel(label);
            if (!labelValidation.valid) {
              throw new Error(labelValidation.error);
            }
          }
        }

        // Validate assignees
        if (params.assignees && params.assignees.length > 0) {
          for (const assignee of params.assignees) {
            const loginValidation = validateLogin(assignee);
            if (!loginValidation.valid) {
              throw new Error(loginValidation.error);
            }
          }
        }

        const tmpPath = writeTempFile('gh-create-body', params.body || '');
        try {
          const ghArgs = ['issue', 'create', '--title', params.title, '--body-file', tmpPath];

          if (params.labels && params.labels.length > 0) {
            ghArgs.push('--label', params.labels.join(','));
          }

          if (params.assignees && params.assignees.length > 0) {
            ghArgs.push('--assignee', params.assignees.join(','));
          }

          const output = await spawnAsync(getToolPath('gh'), ghArgs, {
            cwd: project.path,
            env: getAugmentedEnv(),
          });

          const result = parseIssueUrl(output);
          debugLog('Issue created', { number: result.number, url: result.url });
          return result;
        } finally {
          cleanupTempFile(tmpPath);
        }
      });
    },
  );

  debugLog('Issue Create handler registered');
}
