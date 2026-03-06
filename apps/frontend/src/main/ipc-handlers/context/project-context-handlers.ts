import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { writeFileAtomicSync } from '../../utils/atomic-file';
import { spawn } from 'child_process';
import { IPC_CHANNELS, getSpecsDir, AUTO_BUILD_PATHS } from '../../../shared/constants';
import type {
  IPCResult,
  Project,
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
import { debugLog } from '../../../shared/utils/debug-logger';

function isChildPath(parentPath: string, candidatePath: string): boolean {
  const rel = path.relative(parentPath, candidatePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Generate a unique key for a child project index entry.
 * Uses path.basename(child.path) and appends a numeric suffix (-2, -3, ...) if the key already exists.
 */
function uniqueChildKey(childPath: string, existingKeys: Record<string, unknown>): string {
  const base = path.basename(childPath);
  if (!(base in existingKeys)) return base;
  let suffix = 2;
  while (`${base}-${suffix}` in existingKeys) {
    suffix++;
  }
  return `${base}-${suffix}`;
}

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
 * Run analyzer.py on a single project to generate its project_index.json.
 * Reuses the same spawn logic as the CONTEXT_REFRESH_INDEX handler.
 */
async function refreshChildIndex(
  childProject: Project,
  autoBuildSource: string
): Promise<ProjectIndex | null> {
  const analyzerPath = path.join(autoBuildSource, 'analyzer.py');
  const indexOutputPath = path.join(childProject.path, AUTO_BUILD_PATHS.PROJECT_INDEX);

  const pythonCmd = getConfiguredPythonPath();
  const [pythonCommand, pythonBaseArgs] = parsePythonCommand(pythonCmd);

  try {
    await new Promise<void>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const ANALYZER_TIMEOUT_MS = 120_000; // 2 minutes

      const proc = spawn(pythonCommand, [
        ...pythonBaseArgs,
        analyzerPath,
        '--project-dir', childProject.path,
        '--output', indexOutputPath
      ], {
        cwd: childProject.path,
        env: {
          ...getAugmentedEnv(),
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        }
      });

      const timeout = setTimeout(() => {
        debugLog(`[project-context] Child analyzer (${childProject.name}) timed out after ${ANALYZER_TIMEOUT_MS}ms, killing process`);
        proc.kill('SIGTERM');
        reject(new Error(`Analyzer timed out after ${ANALYZER_TIMEOUT_MS / 1000}s`));
      }, ANALYZER_TIMEOUT_MS);

      proc.stdout?.on('data', (data) => {
        stdout += data.toString('utf-8');
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      proc.on('close', (code: number) => {
        clearTimeout(timeout);
        if (code === 0) {
          debugLog(`[project-context] Child analyzer (${childProject.name}) stdout:`, stdout);
          resolve();
        } else {
          debugLog(`[project-context] Child analyzer (${childProject.name}) failed with code`, code);
          debugLog(`[project-context] Child analyzer (${childProject.name}) stderr:`, stderr);
          reject(new Error(`Analyzer exited with code ${code}: ${stderr || stdout}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        debugLog(`[project-context] Child analyzer (${childProject.name}) spawn error:`, err);
        reject(err);
      });
    });

    return loadProjectIndex(childProject.path);
  } catch (error) {
    debugLog(`[project-context] Failed to index child ${childProject.name}:`, error);
    return null;
  }
}

/**
 * Aggregate project indexes from child repos into a single customer-level index.
 * Services are prefixed with the repo name to avoid key collisions.
 */
function aggregateChildIndexes(
  customerPath: string,
  childIndexes: Record<string, ProjectIndex>
): ProjectIndex {
  const mergedServices: Record<string, ProjectIndex['services'][string]> = {};
  const mergedInfrastructure: ProjectIndex['infrastructure'] = {};
  const mergedConventions: ProjectIndex['conventions'] = {};

  for (const [repoName, index] of Object.entries(childIndexes)) {
    // Merge services with repo-name prefix to avoid collisions
    if (index.services) {
      for (const [serviceName, serviceInfo] of Object.entries(index.services)) {
        const key = `${repoName}/${serviceName}`;
        mergedServices[key] = serviceInfo;
      }
    }

    // Merge infrastructure (last-write-wins for overlapping keys)
    if (index.infrastructure) {
      Object.assign(mergedInfrastructure, index.infrastructure);
    }

    // Merge conventions (last-write-wins for overlapping keys)
    if (index.conventions) {
      Object.assign(mergedConventions, index.conventions);
    }
  }

  return {
    project_root: customerPath,
    project_type: 'customer',
    services: mergedServices,
    infrastructure: mergedInfrastructure,
    conventions: mergedConventions,
    child_repos: childIndexes
  };
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
      debugLog('Failed to load memories from LadybugDB, falling back to file-based:', error);
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
  getMainWindow: () => BrowserWindow | null
): void {
  /** Send progress event to renderer */
  function sendIndexProgress(message: string, current?: number, total?: number, projectId?: string) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.CONTEXT_INDEX_PROGRESS, { message, current, total, projectId });
    }
  }

  // Get full project context
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_GET,
    async (_, projectId: string): Promise<IPCResult<ProjectContextData>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        // Load project index — for customer projects, load the aggregated index
        let projectIndex: ProjectIndex | null;
        if (project.type === 'customer') {
          projectIndex = loadProjectIndex(project.path);
          // If no aggregated index exists yet, try to build one from existing child indexes
          if (!projectIndex || projectIndex.project_type !== 'customer') {
            const allProjects = projectStore.getProjects();
            const childProjects = allProjects.filter(
              (p) => p.id !== project.id && isChildPath(project.path, p.path)
            );
            const childIndexes: Record<string, ProjectIndex> = {};
            for (const child of childProjects) {
              const childIndex = loadProjectIndex(child.path);
              if (childIndex) {
                const key = uniqueChildKey(child.path, childIndexes);
                childIndexes[key] = childIndex;
              }
            }
            if (Object.keys(childIndexes).length > 0) {
              projectIndex = aggregateChildIndexes(project.path, childIndexes);
            }
          }
        } else {
          projectIndex = loadProjectIndex(project.path);
        }

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
    async (_, projectId: string, force?: boolean): Promise<IPCResult<ProjectIndex>> => {
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

        // Customer projects: aggregate indexes from child repos
        if (project.type === 'customer') {
          const allProjects = projectStore.getProjects();
          const childProjects = allProjects.filter(
            (p) => p.id !== project.id && isChildPath(project.path, p.path)
          );

          if (childProjects.length === 0) {
            return {
              success: false,
              error: 'No child repositories found for this customer project'
            };
          }

          const total = childProjects.length;
          debugLog(`[project-context] Customer project: indexing ${total} child repos (force=${!!force})`);
          sendIndexProgress('progress.discovering_repos', 0, total);

          const childIndexes: Record<string, ProjectIndex> = {};
          const errors: string[] = [];

          for (let i = 0; i < childProjects.length; i++) {
            const child = childProjects[i];
            sendIndexProgress('progress.analyzing_repo', i + 1, total);

            // Check if child already has an index (skip if force=true)
            let childIndex = force ? null : loadProjectIndex(child.path);

            // If no index exists (or force), run analyzer on the child repo
            if (!childIndex) {
              debugLog(`[project-context] Running analyzer for child: ${child.name}`);
              childIndex = await refreshChildIndex(child, autoBuildSource);
            }

            if (childIndex) {
              const key = uniqueChildKey(child.path, childIndexes);
              childIndexes[key] = childIndex;
            } else {
              errors.push(child.name);
            }
          }

          sendIndexProgress('progress.aggregating_results', total, total);

          if (Object.keys(childIndexes).length === 0) {
            sendIndexProgress('');
            return {
              success: false,
              error: `Failed to index any child repos. Failed: ${errors.join(', ')}`
            };
          }

          // Aggregate all child indexes
          const aggregatedIndex = aggregateChildIndexes(project.path, childIndexes);

          // Save aggregated index to customer's .auto-claude/project_index.json
          const indexOutputPath = path.join(project.path, AUTO_BUILD_PATHS.PROJECT_INDEX);
          const indexDir = path.dirname(indexOutputPath);
          if (!existsSync(indexDir)) {
            mkdirSync(indexDir, { recursive: true });
          }
          writeFileAtomicSync(indexOutputPath, JSON.stringify(aggregatedIndex, null, 2), 'utf-8');

          if (errors.length > 0) {
            debugLog(`[project-context] Some child repos failed to index: ${errors.join(', ')}`);
          }

          sendIndexProgress('');
          return { success: true, data: aggregatedIndex };
        }

        // Regular project: run analyzer directly
        sendIndexProgress('progress.analyzing_structure');

        const analyzerPath = path.join(autoBuildSource, 'analyzer.py');
        const indexOutputPath = path.join(project.path, AUTO_BUILD_PATHS.PROJECT_INDEX);

        // Get configured Python path (venv if ready, otherwise bundled/system)
        // This ensures we use the venv Python which has dependencies installed
        const pythonCmd = getConfiguredPythonPath();
        debugLog('[project-context] Using Python:', pythonCmd);

        const [pythonCommand, pythonBaseArgs] = parsePythonCommand(pythonCmd);

        // Run analyzer
        await new Promise<void>((resolve, reject) => {
          let stdout = '';
          let stderr = '';
          const ANALYZER_TIMEOUT_MS = 120_000; // 2 minutes

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

          const timeout = setTimeout(() => {
            debugLog(`[project-context] Analyzer timed out after ${ANALYZER_TIMEOUT_MS}ms, killing process`);
            proc.kill('SIGTERM');
            reject(new Error(`Analyzer timed out after ${ANALYZER_TIMEOUT_MS / 1000}s`));
          }, ANALYZER_TIMEOUT_MS);

          proc.stdout?.on('data', (data) => {
            stdout += data.toString('utf-8');
          });

          proc.stderr?.on('data', (data) => {
            stderr += data.toString('utf-8');
          });

          proc.on('close', (code: number) => {
            clearTimeout(timeout);
            if (code === 0) {
              debugLog('[project-context] Analyzer stdout:', stdout);
              resolve();
            } else {
              debugLog('[project-context] Analyzer failed with code', code);
              debugLog('[project-context] Analyzer stderr:', stderr);
              debugLog('[project-context] Analyzer stdout:', stdout);
              reject(new Error(`Analyzer exited with code ${code}: ${stderr || stdout}`));
            }
          });

          proc.on('error', (err) => {
            clearTimeout(timeout);
            debugLog('[project-context] Analyzer spawn error:', err);
            reject(err);
          });
        });

        sendIndexProgress('');

        // Read the new index
        const projectIndex = loadProjectIndex(project.path);
        if (projectIndex) {
          return { success: true, data: projectIndex };
        }

        return { success: false, error: 'Failed to generate project index' };
      } catch (error) {
        sendIndexProgress('');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to refresh project index'
        };
      }
    }
  );
}
