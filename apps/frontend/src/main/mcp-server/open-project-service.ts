import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import type { Project } from '../../shared/types';
import { ensureProjectReadyForAutomation } from '../project-initializer';
import { projectStore } from '../project-store';

export interface OpenProjectForMcpOptions {
  projectPath: string;
  setActive: boolean;
  appDataRoot?: string;
  notifyRendererTaskRefresh?: (projectId: string) => void;
}

export interface OpenProjectForMcpSuccess {
  success: true;
  project: Project;
  isNew: boolean;
}

export interface OpenProjectForMcpFailure {
  success: false;
  error: string;
}

export type OpenProjectForMcpResult = OpenProjectForMcpSuccess | OpenProjectForMcpFailure;

function getAppDataRoot(): string {
  return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
}

function writeOpenProjectSignal(appDataRoot: string, project: Project): void {
  const signalPath = join(appDataRoot, 'auto-claude-ui', 'open-project-signal.json');
  mkdirSync(dirname(signalPath), { recursive: true });
  writeFileSync(signalPath, JSON.stringify({
    projectId: project.id,
    projectPath: project.path,
    timestamp: Date.now(),
  }), 'utf-8');
  console.log('[MCP:open_project] Signal file written:', signalPath);
}

export function openProjectForMcp({
  projectPath,
  setActive,
  appDataRoot = getAppDataRoot(),
  notifyRendererTaskRefresh,
}: OpenProjectForMcpOptions): OpenProjectForMcpResult {
  if (!existsSync(projectPath)) {
    return {
      success: false,
      error: `Directory does not exist: ${projectPath}`,
    };
  }

  const bootstrapResult = ensureProjectReadyForAutomation(projectPath);
  if (!bootstrapResult.success) {
    return {
      success: false,
      error: bootstrapResult.error || 'Failed to prepare project for Aperant automation.',
    };
  }

  const existing = projectStore.getProjectByPath(projectPath);
  const project = projectStore.addProject(projectPath);
  const isNew = !existing;

  if (setActive) {
    const tabState = projectStore.getTabState();
    const openIds = tabState.openProjectIds.includes(project.id)
      ? tabState.openProjectIds
      : [...tabState.openProjectIds, project.id];
    projectStore.saveTabState({
      openProjectIds: openIds,
      activeProjectId: project.id,
      tabOrder: openIds,
    });
    notifyRendererTaskRefresh?.(project.id);
    writeOpenProjectSignal(appDataRoot, project);
  }

  return {
    success: true,
    project,
    isNew,
  };
}
