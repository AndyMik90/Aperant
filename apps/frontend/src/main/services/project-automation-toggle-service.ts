import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import type {
  Project,
  ProjectAutomationSettingsChangedEvent,
  ProjectSettings
} from '../../shared/types';
import { projectStore } from '../project-store';

export type ProjectAutomationChangeSource = 'ui' | 'mcp';
export type ProjectAutomationSettingKey = 'autoResumeAfterRateLimit' | 'rdrEnabled';

export interface ProjectAutomationSettingsPatch {
  autoResumeAfterRateLimit?: boolean;
  rdrEnabled?: boolean;
}

export interface ApplyProjectAutomationToggleInput {
  projectId: string;
  projectPath?: string;
  settings: ProjectAutomationSettingsPatch;
  source: ProjectAutomationChangeSource;
}

export interface ProjectAutomationSignal {
  projectId: string;
  projectPath?: string;
  settings: ProjectAutomationSettingsPatch;
  source: ProjectAutomationChangeSource;
  timestamp: number;
}

export type ApplyProjectAutomationToggleResult =
  | {
      success: true;
      event: ProjectAutomationSettingsChangedEvent;
      project: Project;
    }
  | {
      success: false;
      error: string;
    };

function normalizeAutomationSettings(
  project: Project
): Pick<ProjectSettings, 'autoResumeAfterRateLimit' | 'rdrEnabled'> {
  return {
    autoResumeAfterRateLimit: project.settings.autoResumeAfterRateLimit === true,
    rdrEnabled: project.settings.rdrEnabled === true,
  };
}

function getChangedKeys(
  settings: ProjectAutomationSettingsPatch
): ProjectAutomationSettingKey[] {
  const changedKeys: ProjectAutomationSettingKey[] = [];

  if (typeof settings.autoResumeAfterRateLimit === 'boolean') {
    changedKeys.push('autoResumeAfterRateLimit');
  }

  if (typeof settings.rdrEnabled === 'boolean') {
    changedKeys.push('rdrEnabled');
  }

  return changedKeys;
}

export function resolveProjectForAutomation(
  projectId: string,
  projectPath?: string
): Project | undefined {
  const existingProject = projectStore.getProject(projectId);
  if (existingProject) {
    return existingProject;
  }

  if (!projectPath) {
    return undefined;
  }

  const byPath = projectStore.getProjectByPath(projectPath);
  if (byPath) {
    return byPath;
  }

  if (!existsSync(projectPath)) {
    return undefined;
  }

  return projectStore.addProject(projectPath);
}

export function applyProjectAutomationToggle(
  input: ApplyProjectAutomationToggleInput
): ApplyProjectAutomationToggleResult {
  const changedKeys = getChangedKeys(input.settings);
  if (changedKeys.length === 0) {
    return { success: false, error: 'No project automation settings were provided.' };
  }

  const project = resolveProjectForAutomation(input.projectId, input.projectPath);
  if (!project) {
    return {
      success: false,
      error: `Project not found: ${input.projectId}${input.projectPath ? ` (path: ${input.projectPath})` : ''}`,
    };
  }

  const updatedProject = projectStore.updateProjectSettings(project.id, input.settings);
  if (!updatedProject) {
    return {
      success: false,
      error: `Failed to update project settings for ${project.id}.`,
    };
  }

  return {
    success: true,
    project: updatedProject,
    event: {
      projectId: updatedProject.id,
      projectPath: updatedProject.path,
      projectName: updatedProject.name,
      source: input.source,
      settings: normalizeAutomationSettings(updatedProject),
      changedKeys,
    },
  };
}

export function getProjectAutomationSignalPath(appDataRoot?: string): string {
  const resolvedAppDataRoot = appDataRoot || process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  return join(resolvedAppDataRoot, 'auto-claude-ui', 'project-automation-signal.json');
}

export function appendProjectAutomationSignal(
  signal: ProjectAutomationSignal,
  appDataRoot?: string
): string {
  const signalPath = getProjectAutomationSignalPath(appDataRoot);
  const signalDir = dirname(signalPath);

  if (!existsSync(signalDir)) {
    mkdirSync(signalDir, { recursive: true });
  }

  let signals: ProjectAutomationSignal[] = [];
  if (existsSync(signalPath)) {
    try {
      const parsed = JSON.parse(readFileSync(signalPath, 'utf-8'));
      if (Array.isArray(parsed?.signals)) {
        signals = parsed.signals;
      } else if (parsed?.projectId && parsed?.settings) {
        signals = [parsed as ProjectAutomationSignal];
      }
    } catch {
      signals = [];
    }
  }

  signals.push(signal);

  writeFileSync(
    signalPath,
    JSON.stringify(
      {
        signals,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf-8'
  );

  return signalPath;
}

export function parseProjectAutomationSignals(raw: string): ProjectAutomationSignal[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.signals)) {
      return parsed.signals as ProjectAutomationSignal[];
    }
    if (parsed?.projectId && parsed?.settings) {
      return [parsed as ProjectAutomationSignal];
    }
  } catch {
    return [];
  }

  return [];
}
