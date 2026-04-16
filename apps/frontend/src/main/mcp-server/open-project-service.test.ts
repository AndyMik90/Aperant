import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '../../shared/types';

const mockEnsureProjectReadyForAutomation = vi.fn();
const mockGetProjectByPath = vi.fn();
const mockAddProject = vi.fn();
const mockGetTabState = vi.fn();
const mockSaveTabState = vi.fn();

vi.mock('../project-initializer', () => ({
  ensureProjectReadyForAutomation: mockEnsureProjectReadyForAutomation,
}));

vi.mock('../project-store', () => ({
  projectStore: {
    getProjectByPath: mockGetProjectByPath,
    addProject: mockAddProject,
    getTabState: mockGetTabState,
    saveTabState: mockSaveTabState,
  },
}));

let TEST_DIR: string;
let APP_DATA_PATH: string;
let PROJECT_PATH: string;

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-123',
    name: 'Reprompty',
    path: PROJECT_PATH,
    autoBuildPath: '.auto-claude',
    settings: {
      model: 'sonnet',
      memoryBackend: 'file',
      linearSync: false,
      notifications: {
        onTaskComplete: true,
        onTaskFailed: true,
        onReviewNeeded: true,
        sound: false,
      },
      graphitiMcpEnabled: false,
      graphitiMcpUrl: '',
      autoResumeAfterRateLimit: false,
      rdrEnabled: false,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('openProjectForMcp', () => {
  beforeEach(() => {
    TEST_DIR = mkdtempSync(path.join(tmpdir(), 'open-project-service-test-'));
    APP_DATA_PATH = path.join(TEST_DIR, 'appData');
    PROJECT_PATH = path.join(TEST_DIR, 'reprompty');

    mkdirSync(APP_DATA_PATH, { recursive: true });
    mkdirSync(PROJECT_PATH, { recursive: true });

    mockEnsureProjectReadyForAutomation.mockReset();
    mockGetProjectByPath.mockReset();
    mockAddProject.mockReset();
    mockGetTabState.mockReset();
    mockSaveTabState.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    if (TEST_DIR && existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it('bootstraps and opens an uninitialized project with an active tab signal', async () => {
    const project = createProject();
    const notifyRendererTaskRefresh = vi.fn();

    mockEnsureProjectReadyForAutomation.mockReturnValue({ success: true });
    mockGetProjectByPath.mockReturnValue(undefined);
    mockAddProject.mockReturnValue(project);
    mockGetTabState.mockReturnValue({
      openProjectIds: [],
      activeProjectId: null,
      tabOrder: [],
    });

    const { openProjectForMcp } = await import('./open-project-service');
    const result = openProjectForMcp({
      projectPath: PROJECT_PATH,
      setActive: true,
      appDataRoot: APP_DATA_PATH,
      notifyRendererTaskRefresh,
    });

    expect(result).toEqual({
      success: true,
      project,
      isNew: true,
    });
    expect(mockEnsureProjectReadyForAutomation).toHaveBeenCalledWith(PROJECT_PATH);
    expect(mockAddProject).toHaveBeenCalledWith(PROJECT_PATH);
    expect(mockSaveTabState).toHaveBeenCalledWith({
      openProjectIds: [project.id],
      activeProjectId: project.id,
      tabOrder: [project.id],
    });
    expect(notifyRendererTaskRefresh).toHaveBeenCalledWith(project.id);

    const signalPath = path.join(APP_DATA_PATH, 'auto-claude-ui', 'open-project-signal.json');
    expect(existsSync(signalPath)).toBe(true);
    expect(JSON.parse(readFileSync(signalPath, 'utf-8'))).toMatchObject({
      projectId: project.id,
      projectPath: project.path,
    });
  });

  it('returns a bootstrap error and does not open the project or write a signal', async () => {
    mockEnsureProjectReadyForAutomation.mockReturnValue({
      success: false,
      error: 'Git bootstrap failed: Author identity unknown',
    });

    const { openProjectForMcp } = await import('./open-project-service');
    const result = openProjectForMcp({
      projectPath: PROJECT_PATH,
      setActive: true,
      appDataRoot: APP_DATA_PATH,
    });

    expect(result).toEqual({
      success: false,
      error: 'Git bootstrap failed: Author identity unknown',
    });
    expect(mockAddProject).not.toHaveBeenCalled();
    expect(mockSaveTabState).not.toHaveBeenCalled();
    expect(existsSync(path.join(APP_DATA_PATH, 'auto-claude-ui', 'open-project-signal.json'))).toBe(false);
  });

  it('opens an already initialized project without duplicating tab state when inactive', async () => {
    const existingProject = createProject({
      id: 'project-existing',
      name: 'Existing Project',
    });

    mockEnsureProjectReadyForAutomation.mockReturnValue({ success: true });
    mockGetProjectByPath.mockReturnValue(existingProject);
    mockAddProject.mockReturnValue(existingProject);

    const { openProjectForMcp } = await import('./open-project-service');
    const result = openProjectForMcp({
      projectPath: PROJECT_PATH,
      setActive: false,
      appDataRoot: APP_DATA_PATH,
    });

    expect(result).toEqual({
      success: true,
      project: existingProject,
      isNew: false,
    });
    expect(mockSaveTabState).not.toHaveBeenCalled();
    expect(existsSync(path.join(APP_DATA_PATH, 'auto-claude-ui', 'open-project-signal.json'))).toBe(false);
  });
});
