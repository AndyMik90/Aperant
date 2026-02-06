/**
 * Integration tests for task logs loading flow (IPC → service → state)
 *
 * Tests the complete flow from IPC handler through TaskLogService to ensure
 * logs are correctly loaded and forwarded to the renderer process.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import type { IPCResult, TaskLogs } from '../../../../shared/types';

// Mock modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  },
  BrowserWindow: vi.fn()
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  watchFile: vi.fn()
}));

vi.mock('../../../project-store', () => ({
  projectStore: {
    getProject: vi.fn()
  }
}));

vi.mock('../../../task-log-service', () => ({
  taskLogService: {
    loadLogs: vi.fn(),
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
    on: vi.fn()
  }
}));

vi.mock('../../../utils/spec-path-helpers', () => ({
  isValidTaskId: vi.fn((id: string) => {
    if (!id || typeof id !== 'string') return false;
    if (id.includes('/') || id.includes('\\')) return false;
    if (id === '.' || id === '..') return false;
    if (id.includes('\0')) return false;
    return true;
  })
}));

vi.mock('../../../../shared/utils/debug-logger', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn()
}));

vi.mock('../../../utils/path-helpers', () => ({
  ensureAbsolutePath: vi.fn((p: string) => {
    const pathMod = require('path');
    return pathMod.isAbsolute(p) ? p : pathMod.resolve(p);
  })
}));

describe('Task Logs Integration (IPC → Service → State)', () => {
  let ipcHandlers: Record<string, Function>;
  let mockMainWindow: Partial<BrowserWindow>;
  let getMainWindow: () => BrowserWindow | null;

  beforeEach(async () => {
    vi.clearAllMocks();
    ipcHandlers = {};

    // Capture IPC handlers
    (ipcMain.handle as Mock).mockImplementation((channel: string, handler: Function) => {
      ipcHandlers[channel] = handler;
    });

    // Mock main window
    mockMainWindow = {
      webContents: {
        send: vi.fn()
      } as any
    };
    getMainWindow = vi.fn(() => mockMainWindow as BrowserWindow);

    // Import and register handlers
    const { registerTaskLogsHandlers } = await import('../logs-handlers');
    registerTaskLogsHandlers(getMainWindow);
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('TASK_LOGS_GET handler', () => {
    it('should successfully load and return task logs', async () => {
      const { projectStore } = await import('../../../project-store');
      const { taskLogService } = await import('../../../task-log-service');
      const { existsSync } = await import('fs');

      const mockProject = {
        id: 'project-123',
        path: '/absolute/path/to/project',
        autoBuildPath: '.auto-claude'
      };

      const mockLogs: TaskLogs = {
        spec_id: '001-test-task',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T01:00:00Z',
        phases: {
          planning: {
            phase: 'planning',
            status: 'completed',
            started_at: '2024-01-01T00:00:00Z',
            completed_at: '2024-01-01T00:30:00Z',
            entries: [
              {
                type: 'text',
                content: 'Planning started',
                phase: 'planning',
                timestamp: '2024-01-01T00:00:00Z'
              }
            ]
          },
          coding: {
            phase: 'coding',
            status: 'active',
            started_at: '2024-01-01T00:30:00Z',
            completed_at: null,
            entries: [
              {
                type: 'text',
                content: 'Coding started',
                phase: 'coding',
                timestamp: '2024-01-01T00:30:00Z'
              }
            ]
          },
          validation: {
            phase: 'validation',
            status: 'pending',
            started_at: null,
            completed_at: null,
            entries: []
          }
        }
      };

      (projectStore.getProject as Mock).mockReturnValue(mockProject);
      (existsSync as Mock).mockReturnValue(true);
      (taskLogService.loadLogs as Mock).mockReturnValue(mockLogs);

      const handler = ipcHandlers['task:logsGet'];
      const result = await handler({}, 'project-123', '001-test-task') as IPCResult<TaskLogs>;

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockLogs);
      expect(projectStore.getProject).toHaveBeenCalledWith('project-123');
      expect(taskLogService.loadLogs).toHaveBeenCalledWith(
        path.join('/absolute/path/to/project', '.auto-claude/specs', '001-test-task'),
        '/absolute/path/to/project',
        '.auto-claude/specs',
        '001-test-task'
      );
    });

    it('should normalize relative project paths to absolute', async () => {
      const { projectStore } = await import('../../../project-store');
      const { taskLogService } = await import('../../../task-log-service');
      const { existsSync } = await import('fs');

      const mockProject = {
        id: 'project-123',
        path: './relative/path',
        autoBuildPath: '.auto-claude'
      };

      const mockLogs: TaskLogs = {
        spec_id: '001-test-task',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T01:00:00Z',
        phases: {
          planning: { phase: 'planning', status: 'pending', started_at: null, completed_at: null, entries: [] },
          coding: { phase: 'coding', status: 'pending', started_at: null, completed_at: null, entries: [] },
          validation: { phase: 'validation', status: 'pending', started_at: null, completed_at: null, entries: [] }
        }
      };

      (projectStore.getProject as Mock).mockReturnValue(mockProject);
      (existsSync as Mock).mockReturnValue(true);
      (taskLogService.loadLogs as Mock).mockReturnValue(mockLogs);

      const handler = ipcHandlers['task:logsGet'];
      const result = await handler({}, 'project-123', '001-test-task') as IPCResult<TaskLogs>;

      expect(result.success).toBe(true);

      // Verify that path.resolve was called implicitly (absolute path used)
      const loadLogsCall = (taskLogService.loadLogs as Mock).mock.calls[0];
      expect(path.isAbsolute(loadLogsCall[1])).toBe(true);
    });

    it('should reject invalid specId with path traversal characters', async () => {
      const handler = ipcHandlers['task:logsGet'];
      const result = await handler({}, 'project-123', '../../../etc/passwd') as IPCResult<TaskLogs>;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid spec ID');
    });

    it('should return error when project not found', async () => {
      const { projectStore } = await import('../../../project-store');

      (projectStore.getProject as Mock).mockReturnValue(null);

      const handler = ipcHandlers['task:logsGet'];
      const result = await handler({}, 'nonexistent-project', '001-test-task') as IPCResult<TaskLogs>;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Project not found');
    });

    it('should return error when spec directory not found', async () => {
      const { projectStore } = await import('../../../project-store');
      const { existsSync } = await import('fs');

      const mockProject = {
        id: 'project-123',
        path: '/absolute/path/to/project',
        autoBuildPath: '.auto-claude'
      };

      (projectStore.getProject as Mock).mockReturnValue(mockProject);
      (existsSync as Mock).mockReturnValue(false);

      const handler = ipcHandlers['task:logsGet'];
      const result = await handler({}, 'project-123', 'nonexistent-spec') as IPCResult<TaskLogs>;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Spec directory not found');
    });

    it('should handle taskLogService errors gracefully', async () => {
      const { projectStore } = await import('../../../project-store');
      const { taskLogService } = await import('../../../task-log-service');
      const { existsSync } = await import('fs');

      const mockProject = {
        id: 'project-123',
        path: '/absolute/path/to/project',
        autoBuildPath: '.auto-claude'
      };

      (projectStore.getProject as Mock).mockReturnValue(mockProject);
      (existsSync as Mock).mockReturnValue(true);
      (taskLogService.loadLogs as Mock).mockImplementation(() => {
        throw new Error('Failed to parse logs');
      });

      const handler = ipcHandlers['task:logsGet'];
      const result = await handler({}, 'project-123', '001-test-task') as IPCResult<TaskLogs>;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to parse logs');
    });

    it('should return null logs when file exists but has no content', async () => {
      const { projectStore } = await import('../../../project-store');
      const { taskLogService } = await import('../../../task-log-service');
      const { existsSync } = await import('fs');

      const mockProject = {
        id: 'project-123',
        path: '/absolute/path/to/project',
        autoBuildPath: '.auto-claude'
      };

      (projectStore.getProject as Mock).mockReturnValue(mockProject);
      (existsSync as Mock).mockReturnValue(true);
      (taskLogService.loadLogs as Mock).mockReturnValue(null);

      const handler = ipcHandlers['task:logsGet'];
      const result = await handler({}, 'project-123', '001-test-task') as IPCResult<TaskLogs | null>;

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('TASK_LOGS_WATCH handler', () => {
    it('should start watching spec directory for log changes', async () => {
      const { projectStore } = await import('../../../project-store');
      const { taskLogService } = await import('../../../task-log-service');
      const { existsSync } = await import('fs');

      const mockProject = {
        id: 'project-123',
        path: '/absolute/path/to/project',
        autoBuildPath: '.auto-claude'
      };

      (projectStore.getProject as Mock).mockReturnValue(mockProject);
      (existsSync as Mock).mockReturnValue(true);

      const handler = ipcHandlers['task:logsWatch'];
      const result = await handler({}, 'project-123', '001-test-task') as IPCResult;

      expect(result.success).toBe(true);
      expect(taskLogService.startWatching).toHaveBeenCalledWith(
        '001-test-task',
        path.join('/absolute/path/to/project', '.auto-claude/specs', '001-test-task'),
        '/absolute/path/to/project',
        '.auto-claude/specs'
      );
    });

    it('should reject invalid specId with path traversal characters', async () => {
      const handler = ipcHandlers['task:logsWatch'];
      const result = await handler({}, 'project-123', '../../../etc/passwd') as IPCResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid spec ID');
    });

    it('should return error when project not found', async () => {
      const { projectStore } = await import('../../../project-store');

      (projectStore.getProject as Mock).mockReturnValue(null);

      const handler = ipcHandlers['task:logsWatch'];
      const result = await handler({}, 'nonexistent-project', '001-test-task') as IPCResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Project not found');
    });

    it('should return error when spec directory not found', async () => {
      const { projectStore } = await import('../../../project-store');
      const { existsSync } = await import('fs');

      const mockProject = {
        id: 'project-123',
        path: '/absolute/path/to/project',
        autoBuildPath: '.auto-claude'
      };

      (projectStore.getProject as Mock).mockReturnValue(mockProject);
      (existsSync as Mock).mockReturnValue(false);

      const handler = ipcHandlers['task:logsWatch'];
      const result = await handler({}, 'project-123', 'nonexistent-spec') as IPCResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Spec directory not found');
    });

    it('should handle taskLogService watch errors gracefully', async () => {
      const { projectStore } = await import('../../../project-store');
      const { taskLogService } = await import('../../../task-log-service');
      const { existsSync } = await import('fs');

      const mockProject = {
        id: 'project-123',
        path: '/absolute/path/to/project',
        autoBuildPath: '.auto-claude'
      };

      (projectStore.getProject as Mock).mockReturnValue(mockProject);
      (existsSync as Mock).mockReturnValue(true);
      (taskLogService.startWatching as Mock).mockImplementation(() => {
        throw new Error('Watch failed');
      });

      const handler = ipcHandlers['task:logsWatch'];
      const result = await handler({}, 'project-123', '001-test-task') as IPCResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Watch failed');
    });
  });

  describe('TASK_LOGS_UNWATCH handler', () => {
    it('should stop watching spec directory', async () => {
      const { taskLogService } = await import('../../../task-log-service');

      const handler = ipcHandlers['task:logsUnwatch'];
      const result = await handler({}, '001-test-task') as IPCResult;

      expect(result.success).toBe(true);
      expect(taskLogService.stopWatching).toHaveBeenCalledWith('001-test-task');
    });

    it('should handle taskLogService unwatch errors gracefully', async () => {
      const { taskLogService } = await import('../../../task-log-service');

      (taskLogService.stopWatching as Mock).mockImplementation(() => {
        throw new Error('Unwatch failed');
      });

      const handler = ipcHandlers['task:logsUnwatch'];
      const result = await handler({}, '001-test-task') as IPCResult;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unwatch failed');
    });
  });

  describe('Path resolution consistency (regression test for issue #1657)', () => {
    it('should handle relative paths consistently across restarts', async () => {
      const { projectStore } = await import('../../../project-store');
      const { taskLogService } = await import('../../../task-log-service');
      const { existsSync } = await import('fs');

      // Simulate first load with relative path
      const mockProjectRelative = {
        id: 'project-123',
        path: './my-project',
        autoBuildPath: '.auto-claude'
      };

      (projectStore.getProject as Mock).mockReturnValue(mockProjectRelative);
      (existsSync as Mock).mockReturnValue(true);
      (taskLogService.loadLogs as Mock).mockReturnValue(null);

      const handler = ipcHandlers['task:logsGet'];
      const result1 = await handler({}, 'project-123', '001-test-task') as IPCResult<TaskLogs>;

      expect(result1.success).toBe(true);

      // Get the resolved absolute path from first call
      const firstCall = (taskLogService.loadLogs as Mock).mock.calls[0];
      const firstResolvedPath = firstCall[1];
      expect(path.isAbsolute(firstResolvedPath)).toBe(true);

      // Simulate second load after restart (should resolve to same absolute path)
      vi.clearAllMocks();
      (projectStore.getProject as Mock).mockReturnValue(mockProjectRelative);
      (existsSync as Mock).mockReturnValue(true);
      (taskLogService.loadLogs as Mock).mockReturnValue(null);

      const result2 = await handler({}, 'project-123', '001-test-task') as IPCResult<TaskLogs>;

      expect(result2.success).toBe(true);

      // Verify second call uses same absolute path
      const secondCall = (taskLogService.loadLogs as Mock).mock.calls[0];
      const secondResolvedPath = secondCall[1];
      expect(secondResolvedPath).toBe(firstResolvedPath);
    });

    it('should preserve absolute paths across multiple calls', async () => {
      const { projectStore } = await import('../../../project-store');
      const { taskLogService } = await import('../../../task-log-service');
      const { existsSync } = await import('fs');

      const mockProject = {
        id: 'project-123',
        path: '/absolute/path/to/project',
        autoBuildPath: '.auto-claude'
      };

      (projectStore.getProject as Mock).mockReturnValue(mockProject);
      (existsSync as Mock).mockReturnValue(true);
      (taskLogService.loadLogs as Mock).mockReturnValue(null);

      const handler = ipcHandlers['task:logsGet'];

      // Call multiple times
      await handler({}, 'project-123', '001-test-task');
      await handler({}, 'project-123', '001-test-task');
      await handler({}, 'project-123', '001-test-task');

      // Verify all calls used the same absolute path
      const calls = (taskLogService.loadLogs as Mock).mock.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0][1]).toBe('/absolute/path/to/project');
      expect(calls[1][1]).toBe('/absolute/path/to/project');
      expect(calls[2][1]).toBe('/absolute/path/to/project');
    });
  });

  describe('Event forwarding to renderer', () => {
    it('should forward logs-changed events to renderer', async () => {
      const { taskLogService } = await import('../../../task-log-service');

      const mockLogs: TaskLogs = {
        spec_id: '001-test-task',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T01:00:00Z',
        phases: {
          planning: { phase: 'planning', status: 'completed', started_at: null, completed_at: null, entries: [] },
          coding: { phase: 'coding', status: 'active', started_at: null, completed_at: null, entries: [] },
          validation: { phase: 'validation', status: 'pending', started_at: null, completed_at: null, entries: [] }
        }
      };

      // Get the registered event handler
      const onCall = (taskLogService.on as Mock).mock.calls.find(
        call => call[0] === 'logs-changed'
      );
      expect(onCall).toBeDefined();
      if (!onCall) throw new Error('logs-changed handler not registered');
      const eventHandler = onCall[1];

      // Trigger the event
      eventHandler('001-test-task', mockLogs);

      // Verify it was forwarded to renderer
      expect(mockMainWindow.webContents?.send).toHaveBeenCalledWith(
        'task:logsChanged',
        '001-test-task',
        mockLogs
      );
    });

    it('should forward stream-chunk events to renderer', async () => {
      const { taskLogService } = await import('../../../task-log-service');

      const mockChunk = {
        type: 'text' as const,
        content: 'Test log entry',
        phase: 'coding' as const,
        timestamp: '2024-01-01T01:00:00Z'
      };

      // Get the registered event handler
      const onCall = (taskLogService.on as Mock).mock.calls.find(
        call => call[0] === 'stream-chunk'
      );
      expect(onCall).toBeDefined();
      if (!onCall) throw new Error('stream-chunk handler not registered');
      const eventHandler = onCall[1];

      // Trigger the event
      eventHandler('001-test-task', mockChunk);

      // Verify it was forwarded to renderer
      expect(mockMainWindow.webContents?.send).toHaveBeenCalledWith(
        'task:logsStream',
        '001-test-task',
        mockChunk
      );
    });

    it('should not crash when main window is null', async () => {
      // Clear all mocks and re-setup with null window
      vi.clearAllMocks();
      vi.resetModules();

      // Re-mock modules
      vi.doMock('electron', () => ({
        ipcMain: {
          handle: vi.fn(),
          on: vi.fn()
        },
        BrowserWindow: vi.fn()
      }));

      vi.doMock('fs', () => ({
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
        watchFile: vi.fn()
      }));

      vi.doMock('../../../project-store', () => ({
        projectStore: {
          getProject: vi.fn()
        }
      }));

      const mockOn = vi.fn();
      vi.doMock('../../../task-log-service', () => ({
        taskLogService: {
          loadLogs: vi.fn(),
          startWatching: vi.fn(),
          stopWatching: vi.fn(),
          on: mockOn
        }
      }));

      // Create getMainWindow that returns null
      const nullGetMainWindow = vi.fn(() => null);

      // Import and register handlers with null window
      const { registerTaskLogsHandlers } = await import('../logs-handlers');
      registerTaskLogsHandlers(nullGetMainWindow);

      const mockLogs: TaskLogs = {
        spec_id: '001-test-task',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T01:00:00Z',
        phases: {
          planning: { phase: 'planning', status: 'pending', started_at: null, completed_at: null, entries: [] },
          coding: { phase: 'coding', status: 'pending', started_at: null, completed_at: null, entries: [] },
          validation: { phase: 'validation', status: 'pending', started_at: null, completed_at: null, entries: [] }
        }
      };

      // Get the registered event handler
      const onCall = mockOn.mock.calls.find(
        call => call[0] === 'logs-changed'
      );
      expect(onCall).toBeDefined();
      if (!onCall) throw new Error('logs-changed handler not registered');
      const eventHandler = onCall[1];

      // Should not throw
      expect(() => eventHandler('001-test-task', mockLogs)).not.toThrow();

      // Verify nullGetMainWindow was called
      expect(nullGetMainWindow).toHaveBeenCalled();
    });
  });

});
