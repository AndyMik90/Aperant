import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, getSpecsDir } from '../../../shared/constants';
import type { IPCResult, TaskLogs, TaskLogStreamChunk } from '../../../shared/types';
import path from 'path';
import { existsSync } from 'fs';
import { projectStore } from '../../project-store';
import { taskLogService } from '../../task-log-service';
import { isValidTaskId } from '../../utils/spec-path-helpers';
import { debugLog, debugWarn } from '../../../shared/utils/debug-logger';
import { ensureAbsolutePath } from '../../utils/path-helpers';

/**
 * Register task logs handlers
 */
export function registerTaskLogsHandlers(getMainWindow: () => BrowserWindow | null): void {
  /**
   * Get task logs from spec directory
   * Returns logs organized by phase (planning, coding, validation)
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_LOGS_GET,
    async (_, projectId: string, specId: string): Promise<IPCResult<TaskLogs | null>> => {
      try {
        if (!isValidTaskId(specId)) {
          return { success: false, error: 'Invalid spec ID' };
        }

        const project = projectStore.getProject(projectId);
        if (!project) {
          console.error('[TASK_LOGS_GET] Project not found:', projectId);
          return { success: false, error: 'Project not found' };
        }

        // Defense-in-depth: project.path is normally absolute from ProjectStore,
        // but we guard here against edge cases (e.g., manually edited store file)
        const absoluteProjectPath = ensureAbsolutePath(project.path);
        const specsRelPath = getSpecsDir(project.autoBuildPath);
        const specDir = path.join(absoluteProjectPath, specsRelPath, specId);

        debugLog('[TASK_LOGS_GET] Path resolution:', {
          projectId,
          specId,
          absoluteProjectPath,
          specsRelPath,
          specDir,
        });

        if (!existsSync(specDir)) {
          debugWarn('[TASK_LOGS_GET] Spec directory not found:', specDir);
          return { success: false, error: 'Spec directory not found' };
        }

        const logs = taskLogService.loadLogs(specDir, absoluteProjectPath, specsRelPath, specId);

        debugLog('[TASK_LOGS_GET] Logs loaded:', {
          specId,
          hasLogs: !!logs,
          phaseCounts: logs ? {
            planning: logs.phases.planning?.entries?.length || 0,
            coding: logs.phases.coding?.entries?.length || 0,
            validation: logs.phases.validation?.entries?.length || 0
          } : null
        });

        return { success: true, data: logs };
      } catch (error) {
        console.error('[TASK_LOGS_GET] Failed to get task logs:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get task logs'
        };
      }
    }
  );

  /**
   * Start watching a spec for log changes
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_LOGS_WATCH,
    async (_, projectId: string, specId: string): Promise<IPCResult> => {
      try {
        if (!isValidTaskId(specId)) {
          return { success: false, error: 'Invalid spec ID' };
        }

        const project = projectStore.getProject(projectId);
        if (!project) {
          console.error('[TASK_LOGS_WATCH] Project not found:', projectId);
          return { success: false, error: 'Project not found' };
        }

        const absoluteProjectPath = ensureAbsolutePath(project.path);
        const specsRelPath = getSpecsDir(project.autoBuildPath);
        const specDir = path.join(absoluteProjectPath, specsRelPath, specId);

        debugLog('[TASK_LOGS_WATCH] Starting watch:', {
          projectId,
          specId,
          absoluteProjectPath,
          specDir,
        });

        if (!existsSync(specDir)) {
          debugWarn('[TASK_LOGS_WATCH] Spec directory not found:', specDir);
          return { success: false, error: 'Spec directory not found' };
        }

        taskLogService.startWatching(specId, specDir, absoluteProjectPath, specsRelPath);
        return { success: true };
      } catch (error) {
        console.error('[TASK_LOGS_WATCH] Failed to start watching task logs:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start watching'
        };
      }
    }
  );

  /**
   * Stop watching a spec for log changes
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_LOGS_UNWATCH,
    async (_, specId: string): Promise<IPCResult> => {
      try {
        if (!isValidTaskId(specId)) {
          return { success: false, error: 'Invalid spec ID' };
        }

        taskLogService.stopWatching(specId);
        return { success: true };
      } catch (error) {
        console.error('Failed to stop watching task logs:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to stop watching'
        };
      }
    }
  );

  /**
   * Setup task log service event forwarding to renderer
   */
  taskLogService.on('logs-changed', (specId: string, logs: TaskLogs) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.TASK_LOGS_CHANGED, specId, logs);
    }
  });

  taskLogService.on('stream-chunk', (specId: string, chunk: TaskLogStreamChunk) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.TASK_LOGS_STREAM, specId, chunk);
    }
  });
}
