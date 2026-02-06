import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { IPC_CHANNELS, getSpecsDir, AUTO_BUILD_PATHS } from '../../../shared/constants';
import type {
  IPCResult,
  ProjectContextData,
  ProjectIndex,
  MemoryEpisode
} from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getMemoryService, isKuzuAvailable } from '../../memory-service';
import { getEffectiveSourcePath } from '../../updater/path-resolver';
import {
  loadGraphitiStateFromSpecs,
  buildMemoryStatus
} from './memory-status-handlers';
import { loadFileBasedMemories } from './memory-data-handlers';
import { parsePythonCommand } from '../../python-detector';
import { getConfiguredPythonPath } from '../../python-env-manager';
import { getAugmentedEnv } from '../../env-utils';

/**
 * Load project index from file
 */
function loadProjectIndex(projectPath: string): ProjectIndex | null {
  const indexPath = path.join(projectPath, AUTO_BUILD_PATHS.PROJECT_INDEX);
  if (!existsSync(indexPath)) {
    return null;
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Load recent memories from LadybugDB with file-based fallback
 */
async function loadRecentMemories(
  projectPath: string,
  autoBuildPath: string | undefined,
  memoryStatusAvailable: boolean,
  dbPath?: string,
  database?: string
): Promise<MemoryEpisode[]> {
  let recentMemories: MemoryEpisode[] = [];

  // Try to load from LadybugDB first if Graphiti is available and Kuzu is installed
  if (memoryStatusAvailable && isKuzuAvailable() && dbPath && database) {
    try {
      const memoryService = getMemoryService({
        dbPath,
        database,
      });
      const graphMemories = await memoryService.getEpisodicMemories(20);
      if (graphMemories.length > 0) {
        recentMemories = graphMemories;
      }
    } catch (error) {
      console.warn('Failed to load memories from LadybugDB, falling back to file-based:', error);
    }
  }

  // Fall back to file-based memory if no graph memories found
  if (recentMemories.length === 0) {
    const specsBaseDir = getSpecsDir(autoBuildPath);
    const specsDir = path.join(projectPath, specsBaseDir);
    recentMemories = loadFileBasedMemories(specsDir, 20);
  }

  return recentMemories;
}

/**
 * Register project context handlers
 */
export function registerProjectContextHandlers(
  _getMainWindow: () => BrowserWindow | null
): void {
  // Get full project context
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_GET,
    async (_, projectId: string): Promise<IPCResult<ProjectContextData>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        // Load project index
        const projectIndex = loadProjectIndex(project.path);

        // Load graphiti state from most recent spec
        const memoryState = loadGraphitiStateFromSpecs(project.path, project.autoBuildPath);

        // Build memory status
        const memoryStatus = buildMemoryStatus(
          project.path,
          project.autoBuildPath,
          memoryState
        );

        // Load recent memories
        const recentMemories = await loadRecentMemories(
          project.path,
          project.autoBuildPath,
          memoryStatus.available,
          memoryStatus.dbPath,
          memoryStatus.database
        );

        return {
          success: true,
          data: {
            projectIndex,
            memoryStatus,
            memoryState,
            recentMemories,
            isLoading: false
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load project context'
        };
      }
    }
  );

  // Refresh project index
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_REFRESH_INDEX,
    async (_, projectId: string): Promise<IPCResult<ProjectIndex>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        // Run the analyzer script to regenerate project_index.json
        const autoBuildSource = getEffectiveSourcePath();

        if (!autoBuildSource) {
          return {
            success: false,
            error: 'Auto-build source path not configured'
          };
        }

        const analyzerPath = path.join(autoBuildSource, 'analyzer.py');
        const indexOutputPath = path.join(project.path, AUTO_BUILD_PATHS.PROJECT_INDEX);

        // Get configured Python path (venv if ready, otherwise bundled/system)
        // This ensures we use the venv Python which has dependencies installed
        const pythonCmd = getConfiguredPythonPath();
        console.log('[project-context] Using Python:', pythonCmd);

        const [pythonCommand, pythonBaseArgs] = parsePythonCommand(pythonCmd);

        // Run analyzer
        await new Promise<void>((resolve, reject) => {
          let stdout = '';
          let stderr = '';

          const proc = spawn(pythonCommand, [
            ...pythonBaseArgs,
            analyzerPath,
            '--project-dir', project.path,
            '--output', indexOutputPath
          ], {
            cwd: project.path,
            env: {
              ...getAugmentedEnv(),
              PYTHONIOENCODING: 'utf-8',
              PYTHONUTF8: '1'
            }
          });

          proc.stdout?.on('data', (data) => {
            stdout += data.toString('utf-8');
          });

          proc.stderr?.on('data', (data) => {
            stderr += data.toString('utf-8');
          });

          proc.on('close', (code: number) => {
            if (code === 0) {
              console.log('[project-context] Analyzer stdout:', stdout);
              resolve();
            } else {
              console.error('[project-context] Analyzer failed with code', code);
              console.error('[project-context] Analyzer stderr:', stderr);
              console.error('[project-context] Analyzer stdout:', stdout);
              reject(new Error(`Analyzer exited with code ${code}: ${stderr || stdout}`));
            }
          });

          proc.on('error', (err) => {
            console.error('[project-context] Analyzer spawn error:', err);
            reject(err);
          });
        });

        // Read the new index
        const projectIndex = loadProjectIndex(project.path);
        if (projectIndex) {
          return { success: true, data: projectIndex };
        }

        return { success: false, error: 'Failed to generate project index' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to refresh project index'
        };
      }
    }
  );
}
