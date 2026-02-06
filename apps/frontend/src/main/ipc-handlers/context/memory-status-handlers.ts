import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { IPC_CHANNELS, getSpecsDir, AUTO_BUILD_PATHS } from '../../../shared/constants';
import type { IPCResult, GraphitiMemoryStatus, GraphitiMemoryState } from '../../../shared/types';
import { projectStore } from '../../project-store';
import {
  loadProjectEnvVars,
  loadGlobalSettings,
  isGraphitiEnabled,
  validateEmbeddingConfiguration,
  getGraphitiDatabaseDetails
} from './utils';
import { buildMemoryEnvVars } from '../../memory-env-builder';
import { readSettingsFile } from '../../settings-utils';
import type { AppSettings } from '../../../shared/types/settings';

/**
 * Load Graphiti state from most recent spec directory
 */
export function loadGraphitiStateFromSpecs(
  projectPath: string,
  autoBuildPath?: string
): GraphitiMemoryState | null {
  if (!autoBuildPath) return null;

  const specsBaseDir = getSpecsDir(autoBuildPath);
  const specsDir = path.join(projectPath, specsBaseDir);

  if (!existsSync(specsDir)) {
    return null;
  }

  const specDirs = readdirSync(specsDir)
    .filter((f: string) => {
      try {
        const specPath = path.join(specsDir, f);
        return statSync(specPath).isDirectory();
      } catch {
        // Directory was deleted or inaccessible - skip it
        return false;
      }
    })
    .sort()
    .reverse();

  for (const specDir of specDirs) {
    const statePath = path.join(specsDir, specDir, AUTO_BUILD_PATHS.GRAPHITI_STATE);
    if (existsSync(statePath)) {
      try {
        const stateContent = readFileSync(statePath, 'utf-8');
        return JSON.parse(stateContent);
      } catch {
      }
    }
  }

  return null;
}

/**
 * Build memory status from environment configuration
 *
 * Priority (same as agent-process.ts getCombinedEnv):
 * 1. App-wide memory settings from settings.json (from onboarding)
 * 2. Project's .env files
 */
export function buildMemoryStatus(
  projectPath: string,
  autoBuildPath?: string,
  memoryState?: GraphitiMemoryState | null
): GraphitiMemoryStatus {
  // Load app-wide memory settings from settings.json (set during onboarding)
  const appSettings = (readSettingsFile() || {}) as Partial<AppSettings>;
  const memoryEnvVars = buildMemoryEnvVars(appSettings as AppSettings);

  // Load project-specific env vars
  const projectEnvVars = loadProjectEnvVars(projectPath, autoBuildPath);
  const globalSettings = loadGlobalSettings();

  // Merge: app-wide memory settings -> project env vars
  // Project settings can override app-wide settings
  const effectiveEnvVars = { ...memoryEnvVars, ...projectEnvVars };

  // If we have initialized state from specs, use it
  if (memoryState?.initialized) {
    const dbDetails = getGraphitiDatabaseDetails(effectiveEnvVars);
    return {
      enabled: true,
      available: true,
      database: memoryState.database || 'auto_claude_memory',
      dbPath: dbDetails.dbPath
    };
  }

  // Check environment configuration using merged env vars
  const graphitiEnabled = isGraphitiEnabled(effectiveEnvVars);
  const embeddingValidation = validateEmbeddingConfiguration(effectiveEnvVars, globalSettings);

  if (!graphitiEnabled) {
    return {
      enabled: false,
      available: false,
      reason: 'Graphiti not configured'
    };
  }

  if (!embeddingValidation.valid) {
    return {
      enabled: true,
      available: false,
      reason: embeddingValidation.reason
    };
  }

  const dbDetails = getGraphitiDatabaseDetails(effectiveEnvVars);
  return {
    enabled: true,
    available: true,
    dbPath: dbDetails.dbPath,
    database: dbDetails.database
  };
}

/**
 * Register memory status handlers
 */
export function registerMemoryStatusHandlers(
  _getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_STATUS,
    async (_, projectId: string): Promise<IPCResult<GraphitiMemoryStatus>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const memoryStatus = buildMemoryStatus(project.path, project.autoBuildPath);

      return {
        success: true,
        data: memoryStatus
      };
    }
  );
}
