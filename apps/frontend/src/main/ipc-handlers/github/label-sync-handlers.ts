/**
 * Label Sync IPC handlers for Phase 4.
 * Creates/removes `ac:*` namespaced labels on GitHub and syncs
 * workflow state labels on individual issues.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { withProject } from './utils/project-middleware';
import { getAugmentedEnv } from '../../env-utils';
import { getToolPath } from '../../cli-tool-manager';
import { readEnrichmentFile } from './enrichment-persistence';
import { createContextLogger } from './utils/logger';
import { IPC_CHANNELS } from '../../../shared/constants/ipc';
import {
  getWorkflowLabels,
  getLabelForState,
  isAutoClaudeLabel,
} from '../../../shared/constants/label-sync';
import type { WorkflowState } from '../../../shared/types/enrichment';
import type { LabelSyncConfig, LabelSyncResult } from '../../../shared/types/label-sync';

const execFileAsync = promisify(execFile);
const logger = createContextLogger('Label Sync');

function getConfigPath(projectPath: string): string {
  return path.join(projectPath, '.auto-claude', 'label-sync.json');
}

function readConfig(projectPath: string): LabelSyncConfig {
  try {
    const configPath = getConfigPath(projectPath);
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as LabelSyncConfig;
    }
  } catch {
          // Fall through to default
  }
  return { enabled: false, lastSyncedAt: null };
}

function writeConfig(projectPath: string, config: LabelSyncConfig): void {
  const configPath = getConfigPath(projectPath);
  const dir = path.join(projectPath, '.auto-claude');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function registerLabelSyncHandlers(
  _getMainWindow: () => BrowserWindow | null,
): void {
  // Enable label sync — create all ac:* labels in the repo
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_LABEL_SYNC_ENABLE,
    async (_, projectId: string) => {
      return withProject(projectId, async (project) => {
        const existingConfig = readConfig(project.path);
        const customization = existingConfig.customization;
        const labels = getWorkflowLabels(customization);
        const env = getAugmentedEnv();
        const result: LabelSyncResult = { created: 0, updated: 0, removed: 0, errors: [] };

        for (const label of labels) {
          try {
            await execFileAsync(getToolPath('gh'), [
              'label', 'create', label.name,
              '--color', label.color,
              '--description', label.description,
              '--force',
            ], { env, cwd: project.path, encoding: 'utf-8' });
            result.created++;
          } catch (error) {
            result.errors.push({
              label: label.name,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        // Save config (preserve customization)
        const config: LabelSyncConfig = {
          enabled: true,
          lastSyncedAt: new Date().toISOString(),
          customization,
        };
        writeConfig(project.path, config);

        logger.debug('Label sync enabled', { result });
        return result;
      });
    },
  );

  // Disable label sync — optionally remove all ac:* labels
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_LABEL_SYNC_DISABLE,
    async (_, projectId: string, cleanup: boolean) => {
      return withProject(projectId, async (project) => {
        const existingConfig = readConfig(project.path);
        const customization = existingConfig.customization;

        if (cleanup) {
          const env = getAugmentedEnv();
          const data = await readEnrichmentFile(project.path);

          // Remove ac:* labels from all issues
          for (const [issueNumber, enrichment] of Object.entries(data.issues)) {
            const label = getLabelForState(enrichment.triageState as WorkflowState, customization);
            try {
              await execFileAsync(getToolPath('gh'), [
                'issue', 'edit', issueNumber,
                '--remove-label', label,
              ], { env, cwd: project.path, encoding: 'utf-8' });
            } catch {
                    // Continue on error — label may not exist on this issue
            }
          }

          // Delete label definitions
          const labels = getWorkflowLabels(customization);
          for (const label of labels) {
            try {
              await execFileAsync(getToolPath('gh'), [
                'label', 'delete', label.name, '--yes',
              ], { env, cwd: project.path, encoding: 'utf-8' });
            } catch {
                    // Continue — label may not exist
            }
          }
        }

        writeConfig(project.path, { enabled: false, lastSyncedAt: null });
        return { success: true };
      });
    },
  );

  // Sync a single issue's label
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_LABEL_SYNC_ISSUE,
    async (_, projectId: string, issueNumber: number, newState: string, _oldState: string | null) => {
      return withProject(projectId, async (project) => {
        const config = readConfig(project.path);
        const customization = config.customization;
        const env = getAugmentedEnv();
        const targetLabel = getLabelForState(newState as WorkflowState, customization);

        // Check current labels to avoid unnecessary API calls (GAP-1 fix)
        try {
          const { stdout: labelsJson } = await execFileAsync(getToolPath('gh'), [
            'issue', 'view', String(issueNumber),
            '--json', 'labels',
            '--jq', '.labels',
          ], { env, cwd: project.path, encoding: 'utf-8' });

          const currentLabels = JSON.parse(labelsJson) as Array<{ name: string }>;
          const hasTargetLabel = currentLabels.some((l) => l.name === targetLabel);

          if (hasTargetLabel) {
            return { skipped: true };
          }

          // Build edit args: remove old ac:* labels, add new one
          const args = ['issue', 'edit', String(issueNumber)];

          for (const label of currentLabels) {
            if (isAutoClaudeLabel(label.name, customization) && label.name !== targetLabel) {
              args.push('--remove-label', label.name);
            }
          }

          args.push('--add-label', targetLabel);

          await execFileAsync(getToolPath('gh'), args, { env, cwd: project.path, encoding: 'utf-8' });
          return { synced: true };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'Sync failed' };
        }
      });
    },
  );

  // Get current label sync config
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_LABEL_SYNC_STATUS,
    async (_, projectId: string) => {
      return withProject(projectId, async (project) => {
        return readConfig(project.path);
      });
    },
  );

  // Bulk sync labels for multiple issues
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_LABEL_SYNC_BULK,
    async (_, projectId: string, issueNumbers: number[]) => {
      return withProject(projectId, async (project) => {
        const config = readConfig(project.path);
        if (!config.enabled) {
          return { synced: 0, errors: 0 };
        }

        const customization = config.customization;
        const env = getAugmentedEnv();
        const data = await readEnrichmentFile(project.path);
        let synced = 0;
        let errors = 0;

        for (const issueNumber of issueNumbers) {
          const enrichment = data.issues[String(issueNumber)];
          if (!enrichment?.triageState) continue;

          const targetLabel = getLabelForState(enrichment.triageState as WorkflowState, customization);

          try {
            // Get current labels
            const { stdout: labelsJson } = await execFileAsync(getToolPath('gh'), [
              'issue', 'view', String(issueNumber),
              '--json', 'labels',
              '--jq', '.labels',
            ], { env, cwd: project.path, encoding: 'utf-8' });

            const currentLabels = JSON.parse(labelsJson) as Array<{ name: string }>;
            if (currentLabels.some((l) => l.name === targetLabel)) {
              synced++;
              continue;
            }

            const args = ['issue', 'edit', String(issueNumber)];
            for (const label of currentLabels) {
              if (isAutoClaudeLabel(label.name, customization) && label.name !== targetLabel) {
                args.push('--remove-label', label.name);
              }
            }
            args.push('--add-label', targetLabel);

            await execFileAsync(getToolPath('gh'), args, { env, cwd: project.path, encoding: 'utf-8' });
            synced++;
          } catch (error) {
            logger.debug('Bulk sync error for issue', { issueNumber, error });
            errors++;
          }
        }

        logger.debug('Bulk label sync complete', { synced, errors });
        return { synced, errors };
      });
    },
  );

  // Save label sync config
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_LABEL_SYNC_SAVE,
    async (_, projectId: string, config: LabelSyncConfig) => {
      return withProject(projectId, async (project) => {
        writeConfig(project.path, config);
        return { success: true };
      });
    },
  );
}
