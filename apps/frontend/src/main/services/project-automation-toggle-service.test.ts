import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let TEST_DIR: string;
let USER_DATA_PATH: string;
let APP_DATA_PATH: string;
let TEST_PROJECT_PATH: string;

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return USER_DATA_PATH;
      return TEST_DIR;
    })
  }
}));

function setupTestDirs(): void {
  TEST_DIR = mkdtempSync(path.join(tmpdir(), 'project-automation-toggle-test-'));
  USER_DATA_PATH = path.join(TEST_DIR, 'userData');
  APP_DATA_PATH = path.join(TEST_DIR, 'appData');
  TEST_PROJECT_PATH = path.join(TEST_DIR, 'test-project');

  mkdirSync(path.join(USER_DATA_PATH, 'store'), { recursive: true });
  mkdirSync(APP_DATA_PATH, { recursive: true });
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });
}

function cleanupTestDirs(): void {
  if (TEST_DIR && existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('project automation toggle service', () => {
  beforeEach(() => {
    cleanupTestDirs();
    setupTestDirs();
    vi.resetModules();
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
  });

  it('updates auto-resume settings for an existing project', async () => {
    const { projectStore } = await import('../project-store');
    const { applyProjectAutomationToggle } = await import('./project-automation-toggle-service');

    const project = projectStore.addProject(TEST_PROJECT_PATH);
    const result = applyProjectAutomationToggle({
      projectId: project.id,
      settings: { autoResumeAfterRateLimit: true },
      source: 'ui',
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.event.projectId).toBe(project.id);
    expect(result.event.settings.autoResumeAfterRateLimit).toBe(true);
    expect(result.event.settings.rdrEnabled).toBe(false);
    expect(result.event.changedKeys).toEqual(['autoResumeAfterRateLimit']);
    expect(projectStore.getProject(project.id)?.settings.autoResumeAfterRateLimit).toBe(true);
  });

  it('resolves a project by path fallback when the project ID is stale', async () => {
    const { projectStore } = await import('../project-store');
    const { applyProjectAutomationToggle } = await import('./project-automation-toggle-service');

    const project = projectStore.addProject(TEST_PROJECT_PATH);
    const result = applyProjectAutomationToggle({
      projectId: 'stale-project-id',
      projectPath: TEST_PROJECT_PATH,
      settings: { rdrEnabled: true },
      source: 'mcp',
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.event.projectId).toBe(project.id);
    expect(result.event.settings.rdrEnabled).toBe(true);
    expect(result.event.changedKeys).toEqual(['rdrEnabled']);
    expect(projectStore.getProject(project.id)?.settings.rdrEnabled).toBe(true);
  });

  it('appends multiple automation signals to a shared signal file', async () => {
    const {
      appendProjectAutomationSignal,
      getProjectAutomationSignalPath,
      parseProjectAutomationSignals,
    } = await import('./project-automation-toggle-service');

    appendProjectAutomationSignal({
      projectId: 'project-1',
      projectPath: 'C:/demo/project-1',
      settings: { autoResumeAfterRateLimit: true },
      source: 'mcp',
      timestamp: 1,
    }, APP_DATA_PATH);

    appendProjectAutomationSignal({
      projectId: 'project-1',
      projectPath: 'C:/demo/project-1',
      settings: { rdrEnabled: true },
      source: 'mcp',
      timestamp: 2,
    }, APP_DATA_PATH);

    const signalPath = getProjectAutomationSignalPath(APP_DATA_PATH);
    const raw = readFileSync(signalPath, 'utf-8');
    const signals = parseProjectAutomationSignals(raw);

    expect(signals).toHaveLength(2);
    expect(signals[0]?.settings.autoResumeAfterRateLimit).toBe(true);
    expect(signals[1]?.settings.rdrEnabled).toBe(true);
  });
});
