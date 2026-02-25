/**
 * E2E Smoke Tests via Electron MCP
 *
 * Tests critical user journeys by simulating Electron MCP interactions:
 * - Project creation flow
 * - Task creation and execution flow
 * - Settings management flow
 *
 * These tests mock IPC communication to verify the expected call sequences
 * that would occur when using Electron MCP tools (navigate_to_hash, fill_input,
 * click_by_text, etc.) against a running Electron app.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Test directories - created securely with mkdtempSync to prevent TOCTOU attacks
let TEST_DIR: string;
let TEST_PROJECT_PATH: string;

// Mock ipcRenderer for renderer-side tests
const mockIpcRenderer = {
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
  setMaxListeners: vi.fn()
};

// Mock contextBridge
const exposedApis: Record<string, unknown> = {};
const mockContextBridge = {
  exposeInMainWorld: vi.fn((name: string, api: unknown) => {
    exposedApis[name] = api;
  })
};

vi.mock('electron', () => ({
  ipcRenderer: mockIpcRenderer,
  contextBridge: mockContextBridge
}));

// Test data interfaces - minimal shapes for mock data (not full production types)
interface TestProjectData {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  settings: {
    model: string;
    maxThinkingTokens: number;
  };
}

interface TestTaskData {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  // Optional extended properties used in some tests
  metadata?: Record<string, unknown>;
  plan?: Record<string, unknown>;
}

interface TestSettingsData {
  theme: string;
  telemetry: boolean;
  autoUpdate: boolean;
  defaultModel: string;
  // Optional extended properties used in some tests
  maxThinkingTokens?: number;
  parallelBuilds?: number;
  debugMode?: boolean;
}

// Sample project data
function createTestProject(overrides: Partial<TestProjectData> = {}): TestProjectData {
  return {
    id: 'project-001',
    name: 'Test Project',
    path: TEST_PROJECT_PATH,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      model: 'sonnet',
      maxThinkingTokens: 10000
    },
    ...overrides
  };
}

// Sample task data
function createTestTask(overrides: Partial<TestTaskData> = {}): TestTaskData {
  return {
    id: 'task-001',
    projectId: 'project-001',
    title: 'Implement user authentication',
    description: 'Add login and registration functionality',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

// Sample settings data
function createTestSettings(overrides: Partial<TestSettingsData> = {}): TestSettingsData {
  return {
    theme: 'system',
    telemetry: true,
    autoUpdate: true,
    defaultModel: 'sonnet',
    ...overrides
  };
}

// Setup test directories with secure temp directory
function setupTestDirs(): void {
  TEST_DIR = mkdtempSync(path.join(tmpdir(), 'e2e-smoke-test-'));
  TEST_PROJECT_PATH = path.join(TEST_DIR, 'test-project');
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });
  // Create a minimal project structure
  mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-claude'), { recursive: true });
}

// Cleanup test directories
function cleanupTestDirs(): void {
  if (TEST_DIR && existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('E2E Smoke Tests', () => {
  beforeEach(async () => {
    cleanupTestDirs();
    setupTestDirs();
    vi.clearAllMocks();
    vi.resetModules();
    Object.keys(exposedApis).forEach((key) => delete exposedApis[key]);
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
  });

  describe('Project Creation Flow', () => {
    it('should complete full project creation flow via IPC', async () => {
      // Import preload script to get electronAPI
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Step 1: Open directory picker (simulates click on "Add Project" button)
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: TEST_PROJECT_PATH
      });

      const selectDirectory = electronAPI['selectDirectory'] as () => Promise<unknown>;
      const dirResult = await selectDirectory();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('dialog:selectDirectory');
      expect(dirResult).toMatchObject({
        success: true,
        data: TEST_PROJECT_PATH
      });

      // Step 2: Add project with selected path
      const project = createTestProject();
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: project
      });

      const addProject = electronAPI['addProject'] as (path: string) => Promise<unknown>;
      const addResult = await addProject(TEST_PROJECT_PATH);

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('project:add', TEST_PROJECT_PATH);
      expect(addResult).toMatchObject({
        success: true,
        data: expect.objectContaining({
          id: 'project-001',
          name: 'Test Project',
          path: TEST_PROJECT_PATH
        })
      });

      // Step 3: Verify project appears in list
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: [project]
      });

      const getProjects = electronAPI['getProjects'] as () => Promise<unknown>;
      const listResult = await getProjects();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('project:list');
      expect(listResult).toMatchObject({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: 'project-001',
            name: 'Test Project'
          })
        ])
      });
    });

    it('should handle project creation with custom settings', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Add project first
      const project = createTestProject();
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: project
      });

      const addProject = electronAPI['addProject'] as (path: string) => Promise<unknown>;
      await addProject(TEST_PROJECT_PATH);

      // Update project settings (simulates filling settings form)
      const newSettings = { model: 'opus', maxThinkingTokens: 20000 };
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: { ...project, settings: newSettings }
      });

      const updateProjectSettings = electronAPI['updateProjectSettings'] as (
        id: string,
        settings: object
      ) => Promise<unknown>;
      const updateResult = await updateProjectSettings('project-001', newSettings);

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'project:updateSettings',
        'project-001',
        newSettings
      );
      expect(updateResult).toMatchObject({
        success: true,
        data: expect.objectContaining({
          settings: expect.objectContaining({
            model: 'opus',
            maxThinkingTokens: 20000
          })
        })
      });
    });

    it('should handle directory selection cancellation', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // User cancels directory picker
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: false,
        error: 'User cancelled'
      });

      const selectDirectory = electronAPI['selectDirectory'] as () => Promise<unknown>;
      const result = await selectDirectory();

      expect(result).toMatchObject({
        success: false,
        error: 'User cancelled'
      });
    });

    it('should handle project removal flow', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Remove project
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true
      });

      const removeProject = electronAPI['removeProject'] as (id: string) => Promise<unknown>;
      const removeResult = await removeProject('project-001');

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('project:remove', 'project-001');
      expect(removeResult).toMatchObject({ success: true });

      // Verify project no longer in list
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: []
      });

      const getProjects = electronAPI['getProjects'] as () => Promise<unknown>;
      const listResult = await getProjects();

      expect(listResult).toMatchObject({
        success: true,
        data: []
      });
    });
  });

  describe('Task Creation and Execution Flow', () => {
    it('should complete full task creation and execution flow', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Step 1: Create a new task (simulates filling task form and clicking Create)
      const task = createTestTask();
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: task
      });

      const createTask = electronAPI['createTask'] as (
        projectId: string,
        title: string,
        description: string,
        metadata?: unknown
      ) => Promise<unknown>;
      const createResult = await createTask(
        'project-001',
        'Implement user authentication',
        'Add login and registration functionality'
      );

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'task:create',
        'project-001',
        'Implement user authentication',
        'Add login and registration functionality',
        undefined
      );
      expect(createResult).toMatchObject({
        success: true,
        data: expect.objectContaining({
          id: 'task-001',
          title: 'Implement user authentication',
          status: 'pending'
        })
      });

      // Step 2: Start the task (simulates clicking "Run" button)
      const startTask = electronAPI['startTask'] as (id: string, options?: object) => void;
      startTask('task-001');

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('task:start', 'task-001', undefined);

      // Step 3: Register progress listener to track task execution
      const progressCallback = vi.fn();
      const onTaskProgress = electronAPI['onTaskProgress'] as (cb: Function) => Function;
      const cleanupProgress = onTaskProgress(progressCallback);

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('task:progress', expect.any(Function));

      // Simulate progress events from main process
      const progressHandler = mockIpcRenderer.on.mock.calls.find(
        (call) => call[0] === 'task:progress'
      )?.[1];

      if (progressHandler) {
        // Simulate spec creation progress
        progressHandler({}, 'task-001', {
          phase: 'spec_creation',
          progress: 50,
          message: 'Creating specification...'
        });
      }

      expect(progressCallback).toHaveBeenCalledWith(
        'task-001',
        expect.objectContaining({
          phase: 'spec_creation',
          progress: 50
        }),
        undefined
      );

      // Step 4: Register status change listener
      const statusCallback = vi.fn();
      const onTaskStatusChange = electronAPI['onTaskStatusChange'] as (cb: Function) => Function;
      const cleanupStatus = onTaskStatusChange(statusCallback);

      const statusHandler = mockIpcRenderer.on.mock.calls.find(
        (call) => call[0] === 'task:statusChange'
      )?.[1];

      if (statusHandler) {
        // Simulate status change to in_progress
        statusHandler({}, 'task-001', 'in_progress');
      }

      expect(statusCallback).toHaveBeenCalledWith('task-001', 'in_progress', undefined, undefined);

      // Cleanup listeners
      cleanupProgress();
      cleanupStatus();

      expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
        'task:progress',
        expect.any(Function)
      );
      expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
        'task:statusChange',
        expect.any(Function)
      );
    });

    it('should handle task with metadata (Linear integration)', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      const linearMetadata = {
        linearIssueId: 'LIN-123',
        linearIssueUrl: 'https://linear.app/team/issue/LIN-123'
      };

      const task = createTestTask({ metadata: linearMetadata });
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: task
      });

      const createTask = electronAPI['createTask'] as (
        projectId: string,
        title: string,
        description: string,
        metadata?: unknown
      ) => Promise<unknown>;
      await createTask(
        'project-001',
        'Fix authentication bug',
        'Users cannot login',
        linearMetadata
      );

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'task:create',
        'project-001',
        'Fix authentication bug',
        'Users cannot login',
        linearMetadata
      );
    });

    it('should handle task error events', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Register error listener
      const errorCallback = vi.fn();
      const onTaskError = electronAPI['onTaskError'] as (cb: Function) => Function;
      onTaskError(errorCallback);

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('task:error', expect.any(Function));

      // Simulate error event from main process
      const errorHandler = mockIpcRenderer.on.mock.calls.find(
        (call) => call[0] === 'task:error'
      )?.[1];

      if (errorHandler) {
        errorHandler({}, 'task-001', {
          message: 'Build failed: compilation error',
          code: 'BUILD_ERROR'
        });
      }

      expect(errorCallback).toHaveBeenCalledWith(
        'task-001',
        expect.objectContaining({
          message: 'Build failed: compilation error',
          code: 'BUILD_ERROR'
        }),
        undefined
      );
    });

    it('should handle task stop flow', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Start task first
      const startTask = electronAPI['startTask'] as (id: string) => void;
      startTask('task-001');

      // Stop task (simulates clicking "Stop" button)
      const stopTask = electronAPI['stopTask'] as (id: string) => void;
      stopTask('task-001');

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('task:stop', 'task-001');
    });

    it('should handle task resume flow', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Resume task with options
      const startTask = electronAPI['startTask'] as (id: string, options?: object) => void;
      startTask('task-001', { resume: true });

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('task:start', 'task-001', { resume: true });
    });

    it('should handle task list retrieval', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      const tasks = [
        createTestTask({ id: 'task-001', status: 'completed' }),
        createTestTask({ id: 'task-002', status: 'in_progress', title: 'Add API endpoints' }),
        createTestTask({ id: 'task-003', status: 'pending', title: 'Write tests' })
      ];

      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: tasks
      });

      const getTasks = electronAPI['getTasks'] as (projectId: string) => Promise<unknown>;
      const result = await getTasks('project-001');

      // getTasks passes options as third arg (undefined when not provided)
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('task:list', 'project-001', undefined);
      expect(result).toMatchObject({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ id: 'task-001', status: 'completed' }),
          expect.objectContaining({ id: 'task-002', status: 'in_progress' }),
          expect.objectContaining({ id: 'task-003', status: 'pending' })
        ])
      });
    });

    it('should handle task creation with implementation plan loading', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Create task that includes implementation plan with subtasks
      const taskWithPlan = createTestTask({
        status: 'spec_complete',
        plan: {
          feature: 'User Authentication',
          workflow_type: 'feature',
          services_involved: ['backend', 'frontend'],
          phases: [
            {
              id: 'phase-1',
              name: 'Implementation Phase',
              type: 'implementation',
              subtasks: [
                {
                  id: 'subtask-1-1',
                  description: 'Create login endpoint',
                  status: 'pending',
                  files_to_modify: ['auth.py'],
                  service: 'backend'
                },
                {
                  id: 'subtask-1-2',
                  description: 'Add login form component',
                  status: 'pending',
                  files_to_modify: ['LoginForm.tsx'],
                  service: 'frontend'
                }
              ]
            }
          ],
          status: 'in_progress',
          planStatus: 'in_progress'
        }
      });

      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: taskWithPlan
      });

      const createTask = electronAPI['createTask'] as (
        projectId: string,
        title: string,
        description: string
      ) => Promise<unknown>;
      const result = await createTask(
        'project-001',
        'Implement user authentication',
        'Add login and registration functionality'
      );

      expect(result).toMatchObject({
        success: true,
        data: expect.objectContaining({
          status: 'spec_complete',
          plan: expect.objectContaining({
            phases: expect.arrayContaining([
              expect.objectContaining({
                subtasks: expect.arrayContaining([
                  expect.objectContaining({
                    id: 'subtask-1-1',
                    description: 'Create login endpoint',
                    status: 'pending'
                  }),
                  expect.objectContaining({
                    id: 'subtask-1-2',
                    description: 'Add login form component',
                    status: 'pending'
                  })
                ])
              })
            ])
          })
        })
      });
    });

    it('should track task lifecycle status progression', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Register status change listener
      const statusCallback = vi.fn();
      const onTaskStatusChange = electronAPI['onTaskStatusChange'] as (cb: Function) => Function;
      const cleanupStatus = onTaskStatusChange(statusCallback);

      const statusHandler = mockIpcRenderer.on.mock.calls.find(
        (call) => call[0] === 'task:statusChange'
      )?.[1];

      // Simulate full task lifecycle progression
      const statusProgression = [
        'pending',
        'spec_creation',
        'planning',
        'spec_complete',
        'building',
        'qa_review',
        'completed'
      ];

      if (statusHandler) {
        for (const status of statusProgression) {
          statusHandler({}, 'task-001', status);
        }
      }

      // Verify all status changes were tracked
      expect(statusCallback).toHaveBeenCalledTimes(statusProgression.length);
      statusProgression.forEach((status, index) => {
        expect(statusCallback).toHaveBeenNthCalledWith(
          index + 1,
          'task-001',
          status,
          undefined,
          undefined
        );
      });

      cleanupStatus();
    });

    it('should handle task form validation with missing required fields', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Attempt to create task with empty title
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: false,
        error: 'Title is required'
      });

      const createTask = electronAPI['createTask'] as (
        projectId: string,
        title: string,
        description: string
      ) => Promise<unknown>;
      const result = await createTask('project-001', '', 'Some description');

      expect(result).toMatchObject({
        success: false,
        error: 'Title is required'
      });
    });

    it('should handle task completion with subtask progress tracking', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Register progress listener
      const progressCallback = vi.fn();
      const onTaskProgress = electronAPI['onTaskProgress'] as (cb: Function) => Function;
      const cleanupProgress = onTaskProgress(progressCallback);

      const progressHandler = mockIpcRenderer.on.mock.calls.find(
        (call) => call[0] === 'task:progress'
      )?.[1];

      if (progressHandler) {
        // Simulate subtask completion progress
        progressHandler({}, 'task-001', {
          phase: 'building',
          currentSubtask: {
            id: 'subtask-1-1',
            description: 'Create login endpoint',
            status: 'in_progress'
          },
          completedSubtasks: 0,
          totalSubtasks: 3,
          progress: 33
        });

        progressHandler({}, 'task-001', {
          phase: 'building',
          currentSubtask: {
            id: 'subtask-1-2',
            description: 'Add login form',
            status: 'in_progress'
          },
          completedSubtasks: 1,
          totalSubtasks: 3,
          progress: 66
        });

        progressHandler({}, 'task-001', {
          phase: 'building',
          currentSubtask: null,
          completedSubtasks: 3,
          totalSubtasks: 3,
          progress: 100
        });
      }

      expect(progressCallback).toHaveBeenCalledTimes(3);
      expect(progressCallback).toHaveBeenLastCalledWith(
        'task-001',
        expect.objectContaining({
          phase: 'building',
          completedSubtasks: 3,
          totalSubtasks: 3,
          progress: 100
        }),
        undefined
      );

      cleanupProgress();
    });

    it('should handle task update with partial data', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Update task with only title change
      const updatedTask = createTestTask({ title: 'Updated Task Title' });
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: updatedTask
      });

      const updateTask = electronAPI['updateTask'] as (
        id: string,
        updates: object
      ) => Promise<unknown>;
      const result = await updateTask('task-001', { title: 'Updated Task Title' });

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('task:update', 'task-001', {
        title: 'Updated Task Title'
      });
      expect(result).toMatchObject({
        success: true,
        data: expect.objectContaining({
          title: 'Updated Task Title'
        })
      });
    });

    it('should handle subtask status update during build', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Register progress listener for subtask updates
      const progressCallback = vi.fn();
      const onTaskProgress = electronAPI['onTaskProgress'] as (cb: Function) => Function;
      const cleanupProgress = onTaskProgress(progressCallback);

      const progressHandler = mockIpcRenderer.on.mock.calls.find(
        (call) => call[0] === 'task:progress'
      )?.[1];

      if (progressHandler) {
        // Simulate subtask status transitions
        progressHandler({}, 'task-001', {
          subtaskUpdate: {
            id: 'subtask-1-1',
            previousStatus: 'pending',
            newStatus: 'in_progress'
          }
        });

        progressHandler({}, 'task-001', {
          subtaskUpdate: {
            id: 'subtask-1-1',
            previousStatus: 'in_progress',
            newStatus: 'completed'
          }
        });
      }

      expect(progressCallback).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenNthCalledWith(
        1,
        'task-001',
        expect.objectContaining({
          subtaskUpdate: expect.objectContaining({
            id: 'subtask-1-1',
            newStatus: 'in_progress'
          })
        }),
        undefined
      );
      expect(progressCallback).toHaveBeenNthCalledWith(
        2,
        'task-001',
        expect.objectContaining({
          subtaskUpdate: expect.objectContaining({
            id: 'subtask-1-1',
            newStatus: 'completed'
          })
        }),
        undefined
      );

      cleanupProgress();
    });

    it('should handle task deletion flow', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Delete task
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true
      });

      const deleteTask = electronAPI['deleteTask'] as (id: string) => Promise<unknown>;
      const deleteResult = await deleteTask('task-001');

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('task:delete', 'task-001');
      expect(deleteResult).toMatchObject({ success: true });

      // Verify task no longer in list
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: []
      });

      const getTasks = electronAPI['getTasks'] as (projectId: string) => Promise<unknown>;
      const listResult = await getTasks('project-001');

      expect(listResult).toMatchObject({
        success: true,
        data: []
      });
    });
  });

  describe('Settings Management Flow', () => {
    it('should complete full settings modification flow', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Step 1: Get current settings (simulates navigating to Settings page)
      const currentSettings = createTestSettings();
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: currentSettings
      });

      const getSettings = electronAPI['getSettings'] as () => Promise<unknown>;
      const getResult = await getSettings();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('settings:get');
      expect(getResult).toMatchObject({
        success: true,
        data: expect.objectContaining({
          theme: 'system',
          telemetry: true
        })
      });

      // Step 2: Modify settings (simulates changing theme and saving)
      const newSettings = createTestSettings({ theme: 'dark', telemetry: false });
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: newSettings
      });

      const saveSettings = electronAPI['saveSettings'] as (settings: object) => Promise<unknown>;
      const saveResult = await saveSettings(newSettings);

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('settings:save', newSettings);
      expect(saveResult).toMatchObject({
        success: true,
        data: expect.objectContaining({
          theme: 'dark',
          telemetry: false
        })
      });

      // Step 3: Verify settings persistence (simulates page reload)
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: newSettings
      });

      const verifyResult = await getSettings();

      expect(verifyResult).toMatchObject({
        success: true,
        data: expect.objectContaining({
          theme: 'dark',
          telemetry: false
        })
      });
    });

    it('should handle settings with all configurable options', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      const fullSettings = createTestSettings({
        theme: 'light',
        telemetry: true,
        autoUpdate: false,
        defaultModel: 'opus',
        maxThinkingTokens: 16000,
        parallelBuilds: 2,
        debugMode: false
      });

      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: fullSettings
      });

      const saveSettings = electronAPI['saveSettings'] as (settings: object) => Promise<unknown>;
      await saveSettings(fullSettings);

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'settings:save',
        expect.objectContaining({
          theme: 'light',
          defaultModel: 'opus',
          maxThinkingTokens: 16000
        })
      );
    });

    it('should handle app version retrieval', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: '2.5.0'
      });

      const getAppVersion = electronAPI['getAppVersion'] as () => Promise<unknown>;
      const result = await getAppVersion();

      // getAppVersion uses the app-update channel
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('app-update:get-version');
      expect(result).toMatchObject({
        success: true,
        data: '2.5.0'
      });
    });

    it('should handle settings reset to defaults flow', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Step 1: Get current custom settings
      const customSettings = createTestSettings({
        theme: 'dark',
        telemetry: false,
        autoUpdate: false,
        defaultModel: 'opus'
      });
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: customSettings
      });

      const getSettings = electronAPI['getSettings'] as () => Promise<unknown>;
      await getSettings();

      // Step 2: Reset to defaults (simulates clicking "Reset to Defaults" button)
      const defaultSettings = createTestSettings(); // Uses defaults
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: defaultSettings
      });

      const saveSettings = electronAPI['saveSettings'] as (settings: object) => Promise<unknown>;
      const resetResult = await saveSettings(defaultSettings);

      expect(resetResult).toMatchObject({
        success: true,
        data: expect.objectContaining({
          theme: 'system',
          telemetry: true,
          autoUpdate: true,
          defaultModel: 'sonnet'
        })
      });
    });

    it('should handle settings validation with invalid values', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Attempt to save settings with invalid model
      const invalidSettings = createTestSettings({ defaultModel: 'invalid-model' });
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: false,
        error: 'Invalid model selection: invalid-model'
      });

      const saveSettings = electronAPI['saveSettings'] as (settings: object) => Promise<unknown>;
      const result = await saveSettings(invalidSettings);

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid model')
      });
    });

    it('should handle partial settings update', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Get current settings first
      const currentSettings = createTestSettings();
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: currentSettings
      });

      const getSettings = electronAPI['getSettings'] as () => Promise<unknown>;
      await getSettings();

      // Update only the theme (simulates toggling theme switch)
      const partialUpdate = { ...currentSettings, theme: 'dark' };
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: partialUpdate
      });

      const saveSettings = electronAPI['saveSettings'] as (settings: object) => Promise<unknown>;
      const result = await saveSettings(partialUpdate);

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'settings:save',
        expect.objectContaining({ theme: 'dark' })
      );
      expect(result).toMatchObject({
        success: true,
        data: expect.objectContaining({
          theme: 'dark',
          // Other settings should remain unchanged
          telemetry: true,
          autoUpdate: true
        })
      });
    });

    it('should handle settings migration from older version', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Simulate loading settings from older version (missing new fields)
      const legacySettings = {
        theme: 'light',
        telemetry: true
        // Missing: autoUpdate, defaultModel (added in newer version)
      };

      // Main process migrates settings and adds defaults for new fields
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: {
          ...legacySettings,
          autoUpdate: true, // Default added by migration
          defaultModel: 'sonnet' // Default added by migration
        }
      });

      const getSettings = electronAPI['getSettings'] as () => Promise<unknown>;
      const result = await getSettings();

      expect(result).toMatchObject({
        success: true,
        data: expect.objectContaining({
          theme: 'light',
          telemetry: true,
          autoUpdate: true,
          defaultModel: 'sonnet'
        })
      });
    });

    it('should handle settings save failure gracefully', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Simulate write failure (e.g., disk full, permissions)
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: false,
        error: 'Failed to save settings: Permission denied'
      });

      const saveSettings = electronAPI['saveSettings'] as (settings: object) => Promise<unknown>;
      const result = await saveSettings(createTestSettings({ theme: 'dark' }));

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Failed to save settings')
      });
    });

    it('should handle concurrent settings operations', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      const getSettings = electronAPI['getSettings'] as () => Promise<unknown>;
      const saveSettings = electronAPI['saveSettings'] as (settings: object) => Promise<unknown>;

      // Simulate multiple concurrent settings operations
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true, data: createTestSettings() })
        .mockResolvedValueOnce({
          success: true,
          data: createTestSettings({ theme: 'dark' })
        })
        .mockResolvedValueOnce({
          success: true,
          data: createTestSettings({ theme: 'dark' })
        });

      // Fire concurrent operations
      const [getResult, saveResult, verifyResult] = await Promise.all([
        getSettings(),
        saveSettings(createTestSettings({ theme: 'dark' })),
        getSettings()
      ]);

      expect(getResult).toMatchObject({ success: true });
      expect(saveResult).toMatchObject({
        success: true,
        data: expect.objectContaining({ theme: 'dark' })
      });
      expect(verifyResult).toMatchObject({ success: true });
    });

    it('should handle theme toggle cycle (system -> light -> dark -> system)', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      const saveSettings = electronAPI['saveSettings'] as (settings: object) => Promise<unknown>;

      // Start with system theme
      let currentTheme = 'system';
      const themeProgression = ['light', 'dark', 'system'];

      for (const nextTheme of themeProgression) {
        mockIpcRenderer.invoke.mockResolvedValueOnce({
          success: true,
          data: createTestSettings({ theme: nextTheme })
        });

        const result = await saveSettings(createTestSettings({ theme: nextTheme }));

        expect(result).toMatchObject({
          success: true,
          data: expect.objectContaining({ theme: nextTheme })
        });

        currentTheme = nextTheme;
      }

      // Verify we cycled back to system
      expect(currentTheme).toBe('system');
    });
  });

  describe('QA Review Flow', () => {
    it('should complete QA review approval flow', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Submit positive review (simulates QA approving the build)
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: { status: 'approved' }
      });

      const submitReview = electronAPI['submitReview'] as (
        id: string,
        approved: boolean,
        feedback?: string,
        images?: unknown[]
      ) => Promise<unknown>;
      const result = await submitReview('task-001', true, 'Looks good!');

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'task:review',
        'task-001',
        true,
        'Looks good!',
        undefined
      );
      expect(result).toMatchObject({
        success: true,
        data: expect.objectContaining({
          status: 'approved'
        })
      });
    });

    it('should complete QA review rejection flow with feedback', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Submit negative review with feedback
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: { status: 'rejected', feedback: 'Missing error handling' }
      });

      const submitReview = electronAPI['submitReview'] as (
        id: string,
        approved: boolean,
        feedback?: string,
        images?: unknown[]
      ) => Promise<unknown>;
      const result = await submitReview('task-001', false, 'Missing error handling');

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'task:review',
        'task-001',
        false,
        'Missing error handling',
        undefined
      );
      expect(result).toMatchObject({
        success: true,
        data: expect.objectContaining({
          status: 'rejected'
        })
      });
    });

    it('should handle QA review with screenshot attachments', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      const screenshots = [
        { path: '/tmp/screenshot1.png', type: 'image/png' },
        { path: '/tmp/screenshot2.png', type: 'image/png' }
      ];

      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: { status: 'rejected', feedback: 'UI issue', attachments: 2 }
      });

      const submitReview = electronAPI['submitReview'] as (
        id: string,
        approved: boolean,
        feedback?: string,
        images?: unknown[]
      ) => Promise<unknown>;
      await submitReview('task-001', false, 'UI issue shown in screenshots', screenshots);

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'task:review',
        'task-001',
        false,
        'UI issue shown in screenshots',
        screenshots
      );
    });
  });

  describe('Tab State Persistence Flow', () => {
    it('should persist and restore tab state', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Save tab state
      const tabState = {
        openProjectIds: ['project-001', 'project-002'],
        activeProjectId: 'project-001',
        tabOrder: ['project-002', 'project-001']
      };

      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true });

      const saveTabState = electronAPI['saveTabState'] as (state: object) => Promise<unknown>;
      await saveTabState(tabState);

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('tabState:save', tabState);

      // Restore tab state (simulates app restart)
      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: true,
        data: tabState
      });

      const getTabState = electronAPI['getTabState'] as () => Promise<unknown>;
      const result = await getTabState();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('tabState:get');
      expect(result).toMatchObject({
        success: true,
        data: expect.objectContaining({
          openProjectIds: ['project-001', 'project-002'],
          activeProjectId: 'project-001'
        })
      });
    });
  });

  describe('Task Log Streaming Flow', () => {
    it('should stream task logs during execution', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Register log listener
      const logCallback = vi.fn();
      const onTaskLog = electronAPI['onTaskLog'] as (cb: Function) => Function;
      const cleanupLog = onTaskLog(logCallback);

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('task:log', expect.any(Function));

      // Simulate log events from main process
      const logHandler = mockIpcRenderer.on.mock.calls.find(
        (call) => call[0] === 'task:log'
      )?.[1];

      if (logHandler) {
        // Simulate various log levels
        logHandler({}, 'task-001', { level: 'info', message: 'Starting spec creation...' });
        logHandler({}, 'task-001', { level: 'debug', message: 'Analyzing project structure' });
        logHandler({}, 'task-001', { level: 'warn', message: 'No tests found' });
        logHandler({}, 'task-001', { level: 'error', message: 'Build failed' });
      }

      expect(logCallback).toHaveBeenCalledTimes(4);
      expect(logCallback).toHaveBeenCalledWith(
        'task-001',
        expect.objectContaining({ level: 'info', message: 'Starting spec creation...' }),
        undefined
      );
      expect(logCallback).toHaveBeenCalledWith(
        'task-001',
        expect.objectContaining({ level: 'error', message: 'Build failed' }),
        undefined
      );

      // Cleanup
      cleanupLog();
      expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
        'task:log',
        expect.any(Function)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle IPC timeout gracefully', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      // Simulate IPC timeout
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('IPC timeout'));

      const getProjects = electronAPI['getProjects'] as () => Promise<unknown>;

      await expect(getProjects()).rejects.toThrow('IPC timeout');
    });

    it('should handle invalid project path', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: false,
        error: 'Invalid project path: directory does not exist'
      });

      const addProject = electronAPI['addProject'] as (path: string) => Promise<unknown>;
      const result = await addProject('/nonexistent/path');

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid project path')
      });
    });

    it('should handle task creation failure', async () => {
      await import('../../preload/index');
      const electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;

      mockIpcRenderer.invoke.mockResolvedValueOnce({
        success: false,
        error: 'Project not found'
      });

      const createTask = electronAPI['createTask'] as (
        projectId: string,
        title: string,
        description: string
      ) => Promise<unknown>;
      const result = await createTask('nonexistent-project', 'Test', 'Description');

      expect(result).toMatchObject({
        success: false,
        error: 'Project not found'
      });
    });
  });
});
