/**
 * Tests for Queue Routing IPC Handlers
 *
 * Tests the IPC communication for rate limit recovery queue routing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain, BrowserWindow } from 'electron';
import { registerQueueRoutingHandlers } from './queue-routing-handlers';
import { IPC_CHANNELS } from '../../shared/constants';
import type { AgentManager } from '../agent/agent-manager';
import type { ProfileAssignmentReason } from '../../shared/types';

// Mock Electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  },
  BrowserWindow: vi.fn()
}));

describe('registerQueueRoutingHandlers', () => {
  let mockAgentManager: Partial<AgentManager>;
  let mockWindow: Partial<BrowserWindow>;
  let getMainWindow: () => BrowserWindow | null;
  let registeredHandlers: Map<string, Function>;
  let registeredEventListeners: Map<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers = new Map();
    registeredEventListeners = new Map();

    // Capture registered handlers
    (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation(
      (channel: string, handler: Function) => {
        registeredHandlers.set(channel, handler);
      }
    );

    // Setup mock agent manager - use unknown intermediate cast to avoid partial type issues
    const onMock = vi.fn((event: string, handler: Function) => {
      registeredEventListeners.set(event, handler);
      return mockAgentManager as AgentManager;
    });

    mockAgentManager = {
      getRunningTasksByProfile: vi.fn(() => ({
        byProfile: { 'profile-1': ['task-1', 'task-2'] },
        totalRunning: 2
      })),
      assignProfileToTask: vi.fn(),
      getTaskProfileAssignment: vi.fn(() => ({
        profileId: 'profile-1',
        profileName: 'Profile 1',
        reason: 'proactive' as ProfileAssignmentReason
      })),
      updateTaskSession: vi.fn(),
      getTaskSessionId: vi.fn(() => 'session-123'),
      on: onMock as unknown as AgentManager['on']
    };

    // Setup mock window
    mockWindow = {
      webContents: {
        send: vi.fn()
      } as unknown as Electron.WebContents
    };

    getMainWindow = () => mockWindow as BrowserWindow;
  });

  afterEach(() => {
    registeredHandlers.clear();
    registeredEventListeners.clear();
  });

  it('should register all IPC handlers', () => {
    registerQueueRoutingHandlers(
      mockAgentManager as AgentManager,
      getMainWindow
    );

    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.QUEUE_GET_RUNNING_TASKS_BY_PROFILE,
      expect.any(Function)
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.QUEUE_GET_BEST_PROFILE_FOR_TASK,
      expect.any(Function)
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.QUEUE_ASSIGN_PROFILE_TO_TASK,
      expect.any(Function)
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.QUEUE_UPDATE_TASK_SESSION,
      expect.any(Function)
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.QUEUE_GET_TASK_SESSION,
      expect.any(Function)
    );
  });

  describe('getRunningTasksByProfile handler', () => {
    it('should return running tasks grouped by profile', async () => {
      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const handler = registeredHandlers.get(
        IPC_CHANNELS.QUEUE_GET_RUNNING_TASKS_BY_PROFILE
      );
      const result = await handler?.();

      expect(result).toEqual({
        success: true,
        data: {
          byProfile: { 'profile-1': ['task-1', 'task-2'] },
          totalRunning: 2
        }
      });
    });

    it('should return error on failure', async () => {
      mockAgentManager.getRunningTasksByProfile = vi.fn(() => {
        throw new Error('Test error');
      });

      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const handler = registeredHandlers.get(
        IPC_CHANNELS.QUEUE_GET_RUNNING_TASKS_BY_PROFILE
      );
      const result = await handler?.();

      expect(result).toEqual({
        success: false,
        error: 'Test error'
      });
    });
  });

  describe('getBestProfileForTask handler', () => {
    it('should return null when no preference', async () => {
      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const handler = registeredHandlers.get(
        IPC_CHANNELS.QUEUE_GET_BEST_PROFILE_FOR_TASK
      );
      const result = await handler?.({}, { excludeProfileId: 'profile-1' });

      expect(result).toEqual({
        success: true,
        data: null
      });
    });
  });

  describe('assignProfileToTask handler', () => {
    it('should assign profile to task', async () => {
      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const handler = registeredHandlers.get(
        IPC_CHANNELS.QUEUE_ASSIGN_PROFILE_TO_TASK
      );
      const result = await handler?.(
        {},
        'task-1',
        'profile-1',
        'Profile 1',
        'proactive'
      );

      expect(mockAgentManager.assignProfileToTask).toHaveBeenCalledWith(
        'task-1',
        'profile-1',
        'Profile 1',
        'proactive'
      );
      expect(result).toEqual({ success: true });
    });

    it('should return error on failure', async () => {
      mockAgentManager.assignProfileToTask = vi.fn(() => {
        throw new Error('Assignment failed');
      });

      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const handler = registeredHandlers.get(
        IPC_CHANNELS.QUEUE_ASSIGN_PROFILE_TO_TASK
      );
      const result = await handler?.(
        {},
        'task-1',
        'profile-1',
        'Profile 1',
        'proactive'
      );

      expect(result).toEqual({
        success: false,
        error: 'Assignment failed'
      });
    });
  });

  describe('updateTaskSession handler', () => {
    it('should update task session', async () => {
      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const handler = registeredHandlers.get(
        IPC_CHANNELS.QUEUE_UPDATE_TASK_SESSION
      );
      const result = await handler?.({}, 'task-1', 'session-abc');

      expect(mockAgentManager.updateTaskSession).toHaveBeenCalledWith(
        'task-1',
        'session-abc'
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('getTaskSession handler', () => {
    it('should return session ID', async () => {
      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const handler = registeredHandlers.get(
        IPC_CHANNELS.QUEUE_GET_TASK_SESSION
      );
      const result = await handler?.({}, 'task-1');

      expect(result).toEqual({
        success: true,
        data: 'session-123'
      });
    });

    it('should return null when no session', async () => {
      mockAgentManager.getTaskSessionId = vi.fn(() => undefined);

      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const handler = registeredHandlers.get(
        IPC_CHANNELS.QUEUE_GET_TASK_SESSION
      );
      const result = await handler?.({}, 'task-1');

      expect(result).toEqual({
        success: true,
        data: null
      });
    });
  });

  describe('event forwarding', () => {
    it('should register event listeners on agent manager', () => {
      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      expect(mockAgentManager.on).toHaveBeenCalledWith(
        'profile-swapped',
        expect.any(Function)
      );
      expect(mockAgentManager.on).toHaveBeenCalledWith(
        'session-captured',
        expect.any(Function)
      );
      expect(mockAgentManager.on).toHaveBeenCalledWith(
        'queue-blocked-no-profiles',
        expect.any(Function)
      );
    });

    it('should forward profile-swapped event to renderer', () => {
      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const swapHandler = registeredEventListeners.get('profile-swapped');
      const swapData = {
        fromProfileId: 'p1',
        toProfileId: 'p2',
        reason: 'rate_limit'
      };

      swapHandler?.('task-1', swapData);

      expect(mockWindow.webContents?.send).toHaveBeenCalledWith(
        IPC_CHANNELS.QUEUE_PROFILE_SWAPPED,
        { taskId: 'task-1', swap: swapData }
      );
    });

    it('should forward session-captured event to renderer', () => {
      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const sessionHandler = registeredEventListeners.get('session-captured');
      sessionHandler?.('task-1', 'session-abc');

      expect(mockWindow.webContents?.send).toHaveBeenCalledWith(
        IPC_CHANNELS.QUEUE_SESSION_CAPTURED,
        expect.objectContaining({
          taskId: 'task-1',
          sessionId: 'session-abc',
          capturedAt: expect.any(String)
        })
      );
    });

    it('should forward queue-blocked-no-profiles event to renderer', () => {
      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        getMainWindow
      );

      const blockedHandler = registeredEventListeners.get(
        'queue-blocked-no-profiles'
      );
      blockedHandler?.({ reason: 'all_rate_limited' });

      expect(mockWindow.webContents?.send).toHaveBeenCalledWith(
        IPC_CHANNELS.QUEUE_BLOCKED_NO_PROFILES,
        expect.objectContaining({
          reason: 'all_rate_limited',
          timestamp: expect.any(String)
        })
      );
    });

    it('should not send event when window is null', () => {
      const nullWindowGetter = () => null;

      registerQueueRoutingHandlers(
        mockAgentManager as AgentManager,
        nullWindowGetter
      );

      const swapHandler = registeredEventListeners.get('profile-swapped');
      swapHandler?.('task-1', {});

      expect(mockWindow.webContents?.send).not.toHaveBeenCalled();
    });
  });
});
