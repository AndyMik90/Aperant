/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for task-store persistence
 * Tests log persistence, state hydration, and verification mode activation
 * Related to Issue #1657: Bug - Logs disappear after restart in dev mode
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Task, TaskStatus } from '../../../shared/types';

// Mock the electronAPI for IPC communication
const mockGetTasks = vi.fn();
const mockCreateTask = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    getTasks: mockGetTasks,
    createTask: mockCreateTask,
    startTask: vi.fn(),
    stopTask: vi.fn(),
    submitReview: vi.fn(),
    updateTaskStatus: vi.fn(),
    updateTask: vi.fn(),
    checkTaskRunning: vi.fn(),
    recoverStuckTask: vi.fn(),
    deleteTask: vi.fn(),
    archiveTasks: vi.fn()
  }
});

describe('task-store-persistence', () => {
  let useTaskStore: typeof import('../task-store').useTaskStore;
  let loadTasks: typeof import('../task-store').loadTasks;
  let createTask: typeof import('../task-store').createTask;


  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Import fresh module
    const storeModule = await import('../task-store');
    useTaskStore = storeModule.useTaskStore;
    loadTasks = storeModule.loadTasks;
    createTask = storeModule.createTask;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Log Persistence', () => {
    it('should persist logs when hydrating tasks from IPC', async () => {
      const mockTasks: Task[] = [
        {
          id: 'task-1',
          specId: '001-test-task',
          projectId: 'test-project',
          title: 'Test Task',
          description: 'Test description',
          status: 'in_progress' as TaskStatus,
          logs: ['Log line 1', 'Log line 2', 'Log line 3'],
          subtasks: [],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      mockGetTasks.mockResolvedValue({
        success: true,
        data: mockTasks
      });

      await loadTasks('test-project');

      const state = useTaskStore.getState();
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].logs).toHaveLength(3);
      expect(state.tasks[0].logs).toEqual(['Log line 1', 'Log line 2', 'Log line 3']);
    });

    it('should preserve logs across store recreation', () => {
      const store = useTaskStore.getState();

      // Set initial tasks with logs
      const tasksWithLogs: Task[] = [
        {
          id: 'task-1',
          specId: '001-test-task',
          projectId: 'test-project',
          title: 'Test Task',
          description: 'Test',
          status: 'in_progress' as TaskStatus,
          logs: ['Initial log'],
          subtasks: [],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      store.setTasks(tasksWithLogs);

      // Verify logs are present
      const state1 = useTaskStore.getState();
      expect(state1.tasks[0].logs).toEqual(['Initial log']);

      // Append more logs
      store.appendLog('task-1', 'Additional log');

      // Verify logs persisted
      const state2 = useTaskStore.getState();
      expect(state2.tasks[0].logs).toEqual(['Initial log', 'Additional log']);
    });

    it('should handle empty logs array correctly', async () => {
      const mockTasks: Task[] = [
        {
          id: 'task-1',
          specId: '001-test-task',
          projectId: 'test-project',
          title: 'Test Task',
          description: 'Test',
          status: 'backlog' as TaskStatus,
          logs: [],
          subtasks: [],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      mockGetTasks.mockResolvedValue({
        success: true,
        data: mockTasks
      });

      await loadTasks('test-project');

      const state = useTaskStore.getState();
      expect(state.tasks[0].logs).toEqual([]);
    });

    it('should handle missing logs property gracefully', async () => {
      const mockTasks: Task[] = [
        {
          id: 'task-1',
          specId: '001-test-task',
          projectId: 'test-project',
          title: 'Test Task',
          description: 'Test',
          status: 'backlog' as TaskStatus,
          logs: [],
          subtasks: [],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      mockGetTasks.mockResolvedValue({
        success: true,
        data: mockTasks
      });

      await loadTasks('test-project');

      const state = useTaskStore.getState();
      expect(state.tasks).toHaveLength(1);
      // Should not crash when logs property is missing
    });

    it('should batch append logs efficiently', () => {
      const store = useTaskStore.getState();

      const task: Task = {
        id: 'task-1',
        specId: '001-test-task',
        projectId: 'test-project',
        title: 'Test Task',
        description: 'Test',
        status: 'in_progress' as TaskStatus,
        logs: [],
        subtasks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      store.setTasks([task]);

      // Batch append multiple logs
      const newLogs = ['Log 1', 'Log 2', 'Log 3', 'Log 4', 'Log 5'];
      store.batchAppendLogs('task-1', newLogs);

      const state = useTaskStore.getState();
      expect(state.tasks[0].logs).toHaveLength(5);
      expect(state.tasks[0].logs).toEqual(newLogs);
    });

    it('should handle batch append with empty array', () => {
      const store = useTaskStore.getState();

      const task: Task = {
        id: 'task-1',
        specId: '001-test-task',
        projectId: 'test-project',
        title: 'Test Task',
        description: 'Test',
        status: 'in_progress' as TaskStatus,
        logs: ['Existing log'],
        subtasks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      store.setTasks([task]);

      // Batch append empty array
      store.batchAppendLogs('task-1', []);

      const state = useTaskStore.getState();
      expect(state.tasks[0].logs).toEqual(['Existing log']);
    });

    it('should append individual log correctly', () => {
      const store = useTaskStore.getState();

      const task: Task = {
        id: 'task-1',
        specId: '001-test-task',
        projectId: 'test-project',
        title: 'Test Task',
        description: 'Test',
        status: 'in_progress' as TaskStatus,
        logs: ['Log 1'],
        subtasks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      store.setTasks([task]);
      store.appendLog('task-1', 'Log 2');

      const state = useTaskStore.getState();
      expect(state.tasks[0].logs).toEqual(['Log 1', 'Log 2']);
    });

    it('should not append log to non-existent task', () => {
      const store = useTaskStore.getState();
      store.setTasks([]);

      // Attempt to append log to non-existent task
      store.appendLog('non-existent-task', 'Some log');

      const state = useTaskStore.getState();
      expect(state.tasks).toHaveLength(0);
    });
  });

  describe('State Hydration from IPC', () => {
    it('should hydrate multiple tasks with full state', async () => {
      const mockTasks: Task[] = [
        {
          id: 'task-1',
          specId: '001-test-task',
          projectId: 'test-project',
          title: 'Task 1',
          description: 'Description 1',
          status: 'backlog' as TaskStatus,
          logs: ['Log 1'],
          subtasks: [
            {
              id: 'sub-1',
              title: 'Subtask 1',
              description: 'Subtask description',
              status: 'pending',
              files: []
            }
          ],
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'task-2',
          specId: '002-test-task',
          projectId: 'test-project',
          title: 'Task 2',
          description: 'Description 2',
          status: 'in_progress' as TaskStatus,
          logs: ['Log 2'],
          subtasks: [],
          executionProgress: {
            phase: 'coding',
            phaseProgress: 50,
            overallProgress: 50
          },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      mockGetTasks.mockResolvedValue({
        success: true,
        data: mockTasks
      });

      await loadTasks('test-project');

      const state = useTaskStore.getState();
      expect(state.tasks).toHaveLength(2);
      expect(state.tasks[0].id).toBe('task-1');
      expect(state.tasks[0].subtasks).toHaveLength(1);
      expect(state.tasks[1].executionProgress?.phase).toBe('coding');
    });

    it('should handle IPC failure gracefully', async () => {
      mockGetTasks.mockResolvedValue({
        success: false,
        error: 'Failed to load tasks'
      });

      await loadTasks('test-project');

      const state = useTaskStore.getState();
      expect(state.error).toBe('Failed to load tasks');
      expect(state.tasks).toHaveLength(0);
    });

    it('should set loading state during IPC call', async () => {
      let resolveGetTasks: (value: any) => void;
      const getTasksPromise = new Promise((resolve) => {
        resolveGetTasks = resolve;
      });

      mockGetTasks.mockReturnValue(getTasksPromise);

      const loadPromise = loadTasks('test-project');

      // Check loading state is true during load
      const loadingState = useTaskStore.getState();
      expect(loadingState.isLoading).toBe(true);

      // Resolve the IPC call
      resolveGetTasks!({
        success: true,
        data: []
      });

      await loadPromise;

      // Check loading state is false after load
      const finalState = useTaskStore.getState();
      expect(finalState.isLoading).toBe(false);
    });

    it('should clear error on successful load', async () => {
      const store = useTaskStore.getState();

      // Set initial error
      store.setError('Previous error');
      expect(useTaskStore.getState().error).toBe('Previous error');

      // Successful load should clear error
      mockGetTasks.mockResolvedValue({
        success: true,
        data: []
      });

      await loadTasks('test-project');

      const state = useTaskStore.getState();
      expect(state.error).toBeNull();
    });

    it('should support force refresh option', async () => {
      mockGetTasks.mockResolvedValue({
        success: true,
        data: []
      });

      await loadTasks('test-project', { forceRefresh: true });

      expect(mockGetTasks).toHaveBeenCalledWith('test-project', { forceRefresh: true });
    });
  });

  describe('Verification Mode Activation', () => {
    it('should recognize task ready for verification (all subtasks completed)', () => {
      const store = useTaskStore.getState();

      const task: Task = {
        id: 'task-1',
        specId: '001-test-task',
        projectId: 'test-project',
        title: 'Test Task',
        description: 'Test',
        status: 'human_review' as TaskStatus,
        logs: ['Build complete'],
        subtasks: [
          {
            id: 'sub-1',
            title: 'Subtask 1',
            description: 'Sub 1',
            status: 'completed',
            files: []
          },
          {
            id: 'sub-2',
            title: 'Subtask 2',
            description: 'Sub 2',
            status: 'completed',
            files: []
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      store.setTasks([task]);

      const state = useTaskStore.getState();
      const loadedTask = state.tasks[0];

      // All subtasks completed
      expect(loadedTask.subtasks.every(s => s.status === 'completed')).toBe(true);
      // Task in human_review
      expect(loadedTask.status).toBe('human_review');
    });

    it('should handle incomplete subtasks correctly', () => {
      const store = useTaskStore.getState();

      const task: Task = {
        id: 'task-1',
        specId: '001-test-task',
        projectId: 'test-project',
        title: 'Test Task',
        description: 'Test',
        status: 'in_progress' as TaskStatus,
        logs: ['Working...'],
        subtasks: [
          {
            id: 'sub-1',
            title: 'Subtask 1',
            description: 'Sub 1',
            status: 'completed',
            files: []
          },
          {
            id: 'sub-2',
            title: 'Subtask 2',
            description: 'Sub 2',
            status: 'in_progress',
            files: []
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      store.setTasks([task]);

      const state = useTaskStore.getState();
      const loadedTask = state.tasks[0];

      // Not all subtasks completed
      expect(loadedTask.subtasks.every(s => s.status === 'completed')).toBe(false);
    });

    it('should handle tasks with no subtasks', () => {
      const store = useTaskStore.getState();

      const task: Task = {
        id: 'task-1',
        specId: '001-test-task',
        projectId: 'test-project',
        title: 'Test Task',
        description: 'Test',
        status: 'backlog' as TaskStatus,
        logs: [],
        subtasks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      store.setTasks([task]);

      const state = useTaskStore.getState();
      expect(state.tasks[0].subtasks).toHaveLength(0);
    });

    it('should update execution progress correctly', () => {
      const store = useTaskStore.getState();

      const task: Task = {
        id: 'task-1',
        specId: '001-test-task',
        projectId: 'test-project',
        title: 'Test Task',
        description: 'Test',
        status: 'in_progress' as TaskStatus,
        logs: [],
        subtasks: [],
        executionProgress: {
          phase: 'planning',
          phaseProgress: 0,
          overallProgress: 0
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      store.setTasks([task]);

      // Update execution progress to coding phase
      store.updateExecutionProgress('task-1', {
        phase: 'coding',
        phaseProgress: 50,
        overallProgress: 50
      });

      const state = useTaskStore.getState();
      expect(state.tasks[0].executionProgress?.phase).toBe('coding');
      expect(state.tasks[0].executionProgress?.phaseProgress).toBe(50);
      expect(state.tasks[0].executionProgress?.overallProgress).toBe(50);
    });

    it('should transition to idle phase when status changes to backlog', () => {
      const store = useTaskStore.getState();

      const task: Task = {
        id: 'task-1',
        specId: '001-test-task',
        projectId: 'test-project',
        title: 'Test Task',
        description: 'Test',
        status: 'in_progress' as TaskStatus,
        logs: [],
        subtasks: [],
        executionProgress: {
          phase: 'coding',
          phaseProgress: 50,
          overallProgress: 50
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      store.setTasks([task]);

      // Change status to backlog should reset execution progress
      store.updateTaskStatus('task-1', 'backlog');

      const state = useTaskStore.getState();
      expect(state.tasks[0].status).toBe('backlog');
      expect(state.tasks[0].executionProgress?.phase).toBe('idle');
      expect(state.tasks[0].executionProgress?.phaseProgress).toBe(0);
    });

    it('should initialize planning phase when status changes to in_progress without phase', () => {
      const store = useTaskStore.getState();

      const task: Task = {
        id: 'task-1',
        specId: '001-test-task',
        projectId: 'test-project',
        title: 'Test Task',
        description: 'Test',
        status: 'backlog' as TaskStatus,
        logs: [],
        subtasks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      store.setTasks([task]);

      // Change status to in_progress should initialize planning phase
      store.updateTaskStatus('task-1', 'in_progress');

      const state = useTaskStore.getState();
      expect(state.tasks[0].status).toBe('in_progress');
      expect(state.tasks[0].executionProgress?.phase).toBe('planning');
      expect(state.tasks[0].executionProgress?.phaseProgress).toBe(0);
    });
  });

  describe('Task Creation', () => {
    it('should create and add new task', async () => {
      const newTask: Task = {
        id: 'new-task',
        specId: '002-new-task',
        projectId: 'test-project',
        title: 'New Task',
        description: 'New description',
        status: 'backlog' as TaskStatus,
        logs: [],
        subtasks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockCreateTask.mockResolvedValue({
        success: true,
        data: newTask
      });

      const result = await createTask('test-project', 'New Task', 'New description');

      expect(result).toEqual(newTask);
      const state = useTaskStore.getState();
      expect(state.tasks).toContainEqual(newTask);
    });

    it('should handle task creation failure', async () => {
      mockCreateTask.mockResolvedValue({
        success: false,
        error: 'Creation failed'
      });

      const result = await createTask('test-project', 'New Task', 'New description');

      expect(result).toBeNull();
      const state = useTaskStore.getState();
      expect(state.error).toBe('Creation failed');
    });
  });

  describe('Store State Management', () => {
    it('should select task by id', () => {
      const store = useTaskStore.getState();

      const tasks: Task[] = [
        {
          id: 'task-1',
          specId: '001-test-task',
          projectId: 'test-project',
          title: 'Task 1',
          description: 'Test',
          status: 'backlog' as TaskStatus,
          logs: [],
          subtasks: [],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      store.setTasks(tasks);
      store.selectTask('task-1');

      const state = useTaskStore.getState();
      expect(state.selectedTaskId).toBe('task-1');
      expect(store.getSelectedTask()?.id).toBe('task-1');
    });

    it('should get tasks by status', () => {
      const store = useTaskStore.getState();

      const tasks: Task[] = [
        {
          id: 'task-1',
          specId: '001-test-task',
          projectId: 'test-project',
          title: 'Task 1',
          description: 'Test',
          status: 'backlog' as TaskStatus,
          logs: [],
          subtasks: [],
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'task-2',
          specId: '002-test-task',
          projectId: 'test-project',
          title: 'Task 2',
          description: 'Test',
          status: 'in_progress' as TaskStatus,
          logs: [],
          subtasks: [],
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'task-3',
          specId: '003-test-task',
          projectId: 'test-project',
          title: 'Task 3',
          description: 'Test',
          status: 'backlog' as TaskStatus,
          logs: [],
          subtasks: [],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      store.setTasks(tasks);

      const backlogTasks = store.getTasksByStatus('backlog');
      expect(backlogTasks).toHaveLength(2);
      expect(backlogTasks.every(t => t.status === 'backlog')).toBe(true);

      const inProgressTasks = store.getTasksByStatus('in_progress');
      expect(inProgressTasks).toHaveLength(1);
      expect(inProgressTasks[0].id).toBe('task-2');
    });

    it('should clear all tasks', () => {
      const store = useTaskStore.getState();

      const tasks: Task[] = [
        {
          id: 'task-1',
          specId: '001-test-task',
          projectId: 'test-project',
          title: 'Task 1',
          description: 'Test',
          status: 'backlog' as TaskStatus,
          logs: [],
          subtasks: [],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      store.setTasks(tasks);
      store.selectTask('task-1');

      expect(useTaskStore.getState().tasks).toHaveLength(1);

      store.clearTasks();

      const state = useTaskStore.getState();
      expect(state.tasks).toHaveLength(0);
      expect(state.selectedTaskId).toBeNull();
    });
  });
});
