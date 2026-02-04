/**
 * Agent Drift IPC Handlers
 *
 * Handles communication between renderer and main process for drift monitoring.
 * Drift data is emitted from the Python backend via stdout markers and forwarded
 * to the renderer for display in the task detail panel.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';

// Drift report structure (matches Python DriftReport.to_dict())
export interface DriftReport {
  run_id: string;
  timestamp: string;
  overall_drift_score: number;
  component_scores: Record<string, number>;
  anomalies: string[];
  alert_level: 'normal' | 'warning' | 'critical';
  is_interim?: boolean;
  tool_count?: number;
  session_duration_ms?: number;
  recent_tools?: Array<{ tool: string; time: number; success: boolean }>;
  baseline_info?: BaselineInfo;
}

// Baseline info structure
export interface BaselineInfo {
  exists: boolean;
  created_at?: string;
  updated_at?: string;
  run_count?: number;
  historical_count?: number;
  tool_count?: number;
  tools?: string[];
  poisoning_warning?: boolean;
}

// Drift settings
export interface DriftSettings {
  enabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  showBadge: boolean;
  showAlertBanner: boolean;
}

const DEFAULT_DRIFT_SETTINGS: DriftSettings = {
  enabled: true,
  warningThreshold: 0.3,
  criticalThreshold: 0.5,
  showBadge: true,
  showAlertBanner: true,
};

/**
 * Parse drift report from stdout marker
 * Format: __DRIFT_REPORT__:{json}
 */
export function parseDriftReport(line: string): DriftReport | null {
  const DRIFT_MARKER = '__DRIFT_REPORT__:';
  if (!line.includes(DRIFT_MARKER)) {
    return null;
  }

  try {
    const jsonStart = line.indexOf(DRIFT_MARKER) + DRIFT_MARKER.length;
    const jsonStr = line.substring(jsonStart).trim();
    return JSON.parse(jsonStr) as DriftReport;
  } catch (error) {
    console.error('[drift-handlers] Failed to parse drift report:', error);
    return null;
  }
}

/**
 * Parse interim drift report from stdout marker
 * Format: __DRIFT_INTERIM__:{json}
 */
export function parseDriftInterim(line: string): DriftReport | null {
  const INTERIM_MARKER = '__DRIFT_INTERIM__:';
  if (!line.includes(INTERIM_MARKER)) {
    return null;
  }

  try {
    const jsonStart = line.indexOf(INTERIM_MARKER) + INTERIM_MARKER.length;
    const jsonStr = line.substring(jsonStart).trim();
    return JSON.parse(jsonStr) as DriftReport;
  } catch (error) {
    console.error('[drift-handlers] Failed to parse interim drift report:', error);
    return null;
  }
}

/**
 * Get drift reports directory for a spec
 */
function getDriftDir(specDir: string): string {
  return path.join(specDir, 'drift', 'reports');
}

/**
 * Get drift settings path for the app
 */
function getDriftSettingsPath(projectDir: string): string {
  return path.join(projectDir, '.auto-claude', 'drift-settings.json');
}

/**
 * Load drift report for a spec
 */
function loadDriftReport(specDir: string): DriftReport | null {
  const driftDir = getDriftDir(specDir);
  if (!existsSync(driftDir)) {
    return null;
  }

  // Find most recent report
  const files = require('fs').readdirSync(driftDir) as string[];
  const jsonFiles = files
    .filter((f: string) => f.endsWith('.json'))
    .sort()
    .reverse();

  if (jsonFiles.length === 0) {
    return null;
  }

  try {
    const content = readFileSync(path.join(driftDir, jsonFiles[0]), 'utf-8');
    return JSON.parse(content) as DriftReport;
  } catch (error) {
    console.error('[drift-handlers] Failed to load drift report:', error);
    return null;
  }
}

/**
 * Load baseline info for a spec
 */
function loadBaselineInfo(specDir: string): BaselineInfo {
  const baselinePath = path.join(specDir, 'drift', 'baseline.json');

  if (!existsSync(baselinePath)) {
    return { exists: false };
  }

  try {
    const content = readFileSync(baselinePath, 'utf-8');
    const baseline = JSON.parse(content);

    return {
      exists: true,
      created_at: baseline.created_at,
      updated_at: baseline.updated_at,
      run_count: baseline.run_count,
      historical_count: baseline.historical_vectors?.length || 0,
      tool_count: Object.keys(baseline.vector?.tool_frequency || {}).length,
      tools: Object.keys(baseline.vector?.tool_frequency || {}),
      poisoning_warning: baseline.variance_bounds?._original_checksum ? false : undefined,
    };
  } catch (error) {
    console.error('[drift-handlers] Failed to load baseline info:', error);
    return { exists: false };
  }
}

/**
 * Register drift-related IPC handlers
 */
export function registerDriftHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  // Get drift report for a spec
  ipcMain.handle(
    IPC_CHANNELS.DRIFT_GET_REPORT,
    async (_, specDir: string): Promise<IPCResult<DriftReport | null>> => {
      try {
        const report = loadDriftReport(specDir);
        return { success: true, data: report };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get drift report',
        };
      }
    }
  );

  // Get baseline info for a spec
  ipcMain.handle(
    IPC_CHANNELS.DRIFT_GET_BASELINE,
    async (_, specDir: string): Promise<IPCResult<BaselineInfo>> => {
      try {
        const info = loadBaselineInfo(specDir);
        return { success: true, data: info };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get baseline info',
        };
      }
    }
  );

  // Reset baseline for a spec
  ipcMain.handle(
    IPC_CHANNELS.DRIFT_RESET_BASELINE,
    async (_, specDir: string): Promise<IPCResult<void>> => {
      try {
        const baselinePath = path.join(specDir, 'drift', 'baseline.json');

        if (existsSync(baselinePath)) {
          // Backup old baseline
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const backupPath = path.join(
            specDir,
            'drift',
            `baseline.${timestamp}.bak.json`
          );
          require('fs').renameSync(baselinePath, backupPath);
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to reset baseline',
        };
      }
    }
  );

  // Get drift settings
  ipcMain.handle(
    IPC_CHANNELS.DRIFT_GET_SETTINGS,
    async (_, projectDir: string): Promise<IPCResult<DriftSettings>> => {
      try {
        const settingsPath = getDriftSettingsPath(projectDir);

        if (!existsSync(settingsPath)) {
          return { success: true, data: DEFAULT_DRIFT_SETTINGS };
        }

        const content = readFileSync(settingsPath, 'utf-8');
        const settings = { ...DEFAULT_DRIFT_SETTINGS, ...JSON.parse(content) };
        return { success: true, data: settings };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get drift settings',
        };
      }
    }
  );

  // Save drift settings
  ipcMain.handle(
    IPC_CHANNELS.DRIFT_SAVE_SETTINGS,
    async (
      _,
      projectDir: string,
      settings: Partial<DriftSettings>
    ): Promise<IPCResult<void>> => {
      try {
        const settingsPath = getDriftSettingsPath(projectDir);
        const dir = path.dirname(settingsPath);

        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // Load existing and merge
        let existing = DEFAULT_DRIFT_SETTINGS;
        if (existsSync(settingsPath)) {
          const content = readFileSync(settingsPath, 'utf-8');
          existing = { ...DEFAULT_DRIFT_SETTINGS, ...JSON.parse(content) };
        }

        const newSettings = { ...existing, ...settings };
        writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save drift settings',
        };
      }
    }
  );
}

/**
 * Forward drift report to renderer
 */
export function emitDriftReport(
  mainWindow: BrowserWindow | null,
  taskId: string,
  report: DriftReport
): void {
  if (!mainWindow) return;

  mainWindow.webContents.send(IPC_CHANNELS.DRIFT_REPORT_UPDATED, {
    taskId,
    report,
  });

  // Also emit alert if threshold exceeded
  if (report.alert_level === 'warning' || report.alert_level === 'critical') {
    mainWindow.webContents.send(IPC_CHANNELS.DRIFT_ALERT, {
      taskId,
      level: report.alert_level,
      score: report.overall_drift_score,
      anomalies: report.anomalies,
    });
  }
}

/**
 * Forward interim drift report to renderer
 */
export function emitDriftInterim(
  mainWindow: BrowserWindow | null,
  taskId: string,
  report: DriftReport
): void {
  if (!mainWindow) return;

  mainWindow.webContents.send(IPC_CHANNELS.DRIFT_INTERIM_REPORT, {
    taskId,
    report,
  });
}
