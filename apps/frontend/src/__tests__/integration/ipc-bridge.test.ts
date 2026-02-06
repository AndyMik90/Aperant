/**
 * Integration tests for IPC bridge
 * Tests IPC messages flow between main and renderer
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

describe('IPC Bridge Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(exposedApis).forEach((key) => delete exposedApis[key]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Preload script API', () => {
    it('should expose electronAPI via contextBridge', async () => {
      // Import preload script (this runs the module)
      await import('../../preload/index');

      expect(mockContextBridge.exposeInMainWorld).toHaveBeenCalledWith(
        'electronAPI',
        expect.any(Object)
      );
    });

    describe('Project operations', () => {
      let electronAPI: Record<string, unknown>;

      beforeEach(async () => {
        await import('../../preload/index');
        electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;
      });

      it('should have addProject method that invokes IPC', async () => {
        mockIpcRenderer.invoke.mockResolvedValue({ success: true, data: { id: '1' } });

        const addProject = electronAPI['addProject'] as (path: string) => Promise<unknown>;
        await addProject('/test/path');

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('project:add', '/test/path');
      });

      it('should have removeProject method', async () => {
        const removeProject = electronAPI['removeProject'] as (id: string) => Promise<unknown>;
        await removeProject('project-id');

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('project:remove', 'project-id');
      });

      it('should have getProjects method', async () => {
        const getProjects = electronAPI['getProjects'] as () => Promise<unknown>;
        await getProjects();

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('project:list');
      });

      it('should have updateProjectSettings method', async () => {
        const updateProjectSettings = electronAPI['updateProjectSettings'] as (
          id: string,
          settings: object
        ) => Promise<unknown>;
        await updateProjectSettings('project-id', { model: 'sonnet' });

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
          'project:updateSettings',
          'project-id',
          { model: 'sonnet' }
        );
      });
    });

    describe('Task operations', () => {
      let electronAPI: Record<string, unknown>;

      beforeEach(async () => {
        vi.resetModules();
        await import('../../preload/index');
        electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;
      });

      it('should have getTasks method', async () => {
        const getTasks = electronAPI['getTasks'] as (projectId: string) => Promise<unknown>;
        await getTasks('project-id');

        // Second argument is optional options (undefined when not provided)
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('task:list', 'project-id', undefined);
      });

      it('should have createTask method', async () => {
        const createTask = electronAPI['createTask'] as (
          projectId: string,
          title: string,
          desc: string,
          metadata?: unknown
        ) => Promise<unknown>;
        await createTask('project-id', 'Task Title', 'Task description');

        // Fourth argument is optional metadata (undefined when not provided)
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
          'task:create',
          'project-id',
          'Task Title',
          'Task description',
          undefined
        );
      });

      it('should have startTask method using send', async () => {
        const startTask = electronAPI['startTask'] as (id: string, options?: object) => void;
        startTask('task-id', { parallel: true });

        expect(mockIpcRenderer.send).toHaveBeenCalledWith('task:start', 'task-id', { parallel: true });
      });

      it('should have stopTask method using send', async () => {
        const stopTask = electronAPI['stopTask'] as (id: string) => void;
        stopTask('task-id');

        expect(mockIpcRenderer.send).toHaveBeenCalledWith('task:stop', 'task-id');
      });

      it('should have submitReview method', async () => {
        const submitReview = electronAPI['submitReview'] as (
          id: string,
          approved: boolean,
          feedback?: string,
          images?: unknown[]
        ) => Promise<unknown>;
        await submitReview('task-id', false, 'Needs more work');

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
          'task:review',
          'task-id',
          false,
          'Needs more work',
          undefined
        );
      });
    });

    describe('Event listeners', () => {
      let electronAPI: Record<string, unknown>;

      beforeEach(async () => {
        vi.resetModules();
        await import('../../preload/index');
        electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;
      });

      it('should register onTaskProgress listener', () => {
        const callback = vi.fn();
        const onTaskProgress = electronAPI['onTaskProgress'] as (cb: Function) => Function;
        onTaskProgress(callback);

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
          'task:progress',
          expect.any(Function)
        );
      });

      it('should register onTaskError listener', () => {
        const callback = vi.fn();
        const onTaskError = electronAPI['onTaskError'] as (cb: Function) => Function;
        onTaskError(callback);

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
          'task:error',
          expect.any(Function)
        );
      });

      it('should register onTaskLog listener', () => {
        const callback = vi.fn();
        const onTaskLog = electronAPI['onTaskLog'] as (cb: Function) => Function;
        onTaskLog(callback);

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
          'task:log',
          expect.any(Function)
        );
      });

      it('should register onTaskStatusChange listener', () => {
        const callback = vi.fn();
        const onTaskStatusChange = electronAPI['onTaskStatusChange'] as (cb: Function) => Function;
        onTaskStatusChange(callback);

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
          'task:statusChange',
          expect.any(Function)
        );
      });

      it('should return cleanup function for listeners', () => {
        const callback = vi.fn();
        const onTaskProgress = electronAPI['onTaskProgress'] as (cb: Function) => Function;
        const cleanup = onTaskProgress(callback);

        expect(typeof cleanup).toBe('function');

        // Call cleanup
        cleanup();

        expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
          'task:progress',
          expect.any(Function)
        );
      });
    });

    describe('Settings operations', () => {
      let electronAPI: Record<string, unknown>;

      beforeEach(async () => {
        vi.resetModules();
        await import('../../preload/index');
        electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;
      });

      it('should have getSettings method', async () => {
        const getSettings = electronAPI['getSettings'] as () => Promise<unknown>;
        await getSettings();

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('settings:get');
      });

      it('should have saveSettings method', async () => {
        const saveSettings = electronAPI['saveSettings'] as (settings: object) => Promise<unknown>;
        await saveSettings({ theme: 'dark' });

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('settings:save', { theme: 'dark' });
      });
    });

    describe('Dialog operations', () => {
      let electronAPI: Record<string, unknown>;

      beforeEach(async () => {
        vi.resetModules();
        await import('../../preload/index');
        electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;
      });

      it('should have selectDirectory method', async () => {
        const selectDirectory = electronAPI['selectDirectory'] as () => Promise<unknown>;
        await selectDirectory();

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('dialog:selectDirectory');
      });
    });

    describe('App info', () => {
      let electronAPI: Record<string, unknown>;

      beforeEach(async () => {
        vi.resetModules();
        await import('../../preload/index');
        electronAPI = exposedApis['electronAPI'] as Record<string, unknown>;
      });

      it('should have getAppVersion method', async () => {
        const getAppVersion = electronAPI['getAppVersion'] as () => Promise<unknown>;
        await getAppVersion();

        // getAppVersion now uses the app-update channel (from AppUpdateAPI which is spread last)
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('app-update:get-version');
      });
    });
  });

  describe('IPC channel constants', () => {
    it('should use consistent channel names', async () => {
      const { IPC_CHANNELS } = await import('../../shared/constants');

      // Verify channel naming convention
      expect(IPC_CHANNELS.PROJECT_ADD).toBe('project:add');
      expect(IPC_CHANNELS.PROJECT_REMOVE).toBe('project:remove');
      expect(IPC_CHANNELS.PROJECT_LIST).toBe('project:list');
      expect(IPC_CHANNELS.PROJECT_UPDATE_SETTINGS).toBe('project:updateSettings');

      expect(IPC_CHANNELS.TASK_LIST).toBe('task:list');
      expect(IPC_CHANNELS.TASK_CREATE).toBe('task:create');
      expect(IPC_CHANNELS.TASK_START).toBe('task:start');
      expect(IPC_CHANNELS.TASK_STOP).toBe('task:stop');
      expect(IPC_CHANNELS.TASK_REVIEW).toBe('task:review');

      expect(IPC_CHANNELS.TASK_PROGRESS).toBe('task:progress');
      expect(IPC_CHANNELS.TASK_ERROR).toBe('task:error');
      expect(IPC_CHANNELS.TASK_LOG).toBe('task:log');
      expect(IPC_CHANNELS.TASK_STATUS_CHANGE).toBe('task:statusChange');

      expect(IPC_CHANNELS.SETTINGS_GET).toBe('settings:get');
      expect(IPC_CHANNELS.SETTINGS_SAVE).toBe('settings:save');

      expect(IPC_CHANNELS.DIALOG_SELECT_DIRECTORY).toBe('dialog:selectDirectory');
      expect(IPC_CHANNELS.APP_VERSION).toBe('app:version');
    });
  });
});
