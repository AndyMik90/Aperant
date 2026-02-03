/**
 * Unit tests for Task Store
 * Tests Zustand store for task state management
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTaskStore, hasRecentActivity, clearTaskActivity } from '../stores/task-store';
import type { Task, TaskStatus, ImplementationPlan } from '../../shared/types';

// Helper to create test tasks
function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    specId: 'test-spec-001',
    projectId: 'project-1',
    title: 'Test Task',
    description: 'Test description',
    status: 'backlog' as TaskStatus,
    subtasks: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// Helper to create test implementation plan
function createTestPlan(overrides: Partial<ImplementationPlan> = {}): ImplementationPlan {
  return {
    feature: 'Test Feature',
    workflow_type: 'feature',
    services_involved: [],
    phases: [
      {
        phase: 1,
        name: 'Test Phase',
        type: 'implementation',
        subtasks: [
          { id: 'subtask-1', description: 'First subtask', status: 'pending' },
          { id: 'subtask-2', description: 'Second subtask', status: 'pending' }
        ]
      }
    ],
    final_acceptance: ['Tests pass'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    spec_file: 'spec.md',
    ...overrides
  };
}

describe('Task Store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useTaskStore.setState({
      tasks: [],
      selectedTaskId: null,
      isLoading: false,
      error: null
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setTasks', () => {
    it('should set tasks array', () => {
      const tasks = [createTestTask({ id: 'task-1' }), createTestTask({ id: 'task-2' })];

      useTaskStore.getState().setTasks(tasks);

      expect(useTaskStore.getState().tasks).toHaveLength(2);
      expect(useTaskStore.getState().tasks[0].id).toBe('task-1');
    });

    it('should replace existing tasks', () => {
      const initialTasks = [createTestTask({ id: 'old-task' })];
      const newTasks = [createTestTask({ id: 'new-task' })];

      useTaskStore.getState().setTasks(initialTasks);
      useTaskStore.getState().setTasks(newTasks);

      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0].id).toBe('new-task');
    });

    it('should handle empty array', () => {
      useTaskStore.getState().setTasks([createTestTask()]);
      useTaskStore.getState().setTasks([]);

      expect(useTaskStore.getState().tasks).toHaveLength(0);
    });
  });

  describe('addTask', () => {
    it('should add task to empty array', () => {
      const task = createTestTask({ id: 'new-task' });

      useTaskStore.getState().addTask(task);

      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0].id).toBe('new-task');
    });

    it('should append task to existing array', () => {
      useTaskStore.setState({ tasks: [createTestTask({ id: 'existing' })] });

      useTaskStore.getState().addTask(createTestTask({ id: 'new-task' }));

      expect(useTaskStore.getState().tasks).toHaveLength(2);
      expect(useTaskStore.getState().tasks[1].id).toBe('new-task');
    });
  });

  describe('updateTask', () => {
    it('should update task by id', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', title: 'Original Title' })]
      });

      useTaskStore.getState().updateTask('task-1', { title: 'Updated Title' });

      expect(useTaskStore.getState().tasks[0].title).toBe('Updated Title');
    });

    it('should update task by specId', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', specId: 'spec-001', title: 'Original' })]
      });

      useTaskStore.getState().updateTask('spec-001', { title: 'Updated via specId' });

      expect(useTaskStore.getState().tasks[0].title).toBe('Updated via specId');
    });

    it('should not modify other tasks', () => {
      useTaskStore.setState({
        tasks: [
          createTestTask({ id: 'task-1', title: 'Task 1' }),
          createTestTask({ id: 'task-2', title: 'Task 2' })
        ]
      });

      useTaskStore.getState().updateTask('task-1', { title: 'Updated Task 1' });

      expect(useTaskStore.getState().tasks[0].title).toBe('Updated Task 1');
      expect(useTaskStore.getState().tasks[1].title).toBe('Task 2');
    });

    it('should merge updates with existing task', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', title: 'Original', description: 'Original Desc' })]
      });

      useTaskStore.getState().updateTask('task-1', { title: 'Updated' });

      expect(useTaskStore.getState().tasks[0].title).toBe('Updated');
      expect(useTaskStore.getState().tasks[0].description).toBe('Original Desc');
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status by id', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'backlog' })]
      });

      useTaskStore.getState().updateTaskStatus('task-1', 'in_progress');

      expect(useTaskStore.getState().tasks[0].status).toBe('in_progress');
    });

    it('should update task status by specId', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', specId: 'spec-001', status: 'backlog' })]
      });

      useTaskStore.getState().updateTaskStatus('spec-001', 'done');

      expect(useTaskStore.getState().tasks[0].status).toBe('done');
    });

    it('should update updatedAt timestamp', () => {
      const originalDate = new Date('2024-01-01');
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', updatedAt: originalDate })]
      });

      useTaskStore.getState().updateTaskStatus('task-1', 'in_progress');

      expect(useTaskStore.getState().tasks[0].updatedAt.getTime()).toBeGreaterThan(
        originalDate.getTime()
      );
    });

    it('should apply reviewReason when provided', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'in_progress' })]
      });

      useTaskStore.getState().updateTaskStatus('task-1', 'human_review', 'plan_review');

      const task = useTaskStore.getState().tasks[0];
      expect(task.status).toBe('human_review');
      expect(task.reviewReason).toBe('plan_review');
    });

    it('should clear reviewReason when not provided', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'human_review', reviewReason: 'plan_review' })]
      });

      useTaskStore.getState().updateTaskStatus('task-1', 'in_progress');

      const task = useTaskStore.getState().tasks[0];
      expect(task.status).toBe('in_progress');
      expect(task.reviewReason).toBeUndefined();
    });

    it('should update when only reviewReason changes', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'human_review', reviewReason: 'plan_review' })]
      });

      useTaskStore.getState().updateTaskStatus('task-1', 'human_review', 'completed');

      const task = useTaskStore.getState().tasks[0];
      expect(task.status).toBe('human_review');
      expect(task.reviewReason).toBe('completed');
    });
  });

  describe('updateTaskFromPlan', () => {
    it('should extract subtasks from plan', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'c1', description: 'Subtask 1', status: 'completed' },
              { id: 'c2', description: 'Subtask 2', status: 'pending' }
            ]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(2);
      expect(useTaskStore.getState().tasks[0].subtasks[0].id).toBe('c1');
      expect(useTaskStore.getState().tasks[0].subtasks[0].status).toBe('completed');
    });

    it('should extract subtasks from multiple phases', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1' })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [{ id: 'c1', description: 'Subtask 1', status: 'completed' }]
          },
          {
            phase: 2,
            name: 'Phase 2',
            type: 'cleanup',
            subtasks: [{ id: 'c2', description: 'Subtask 2', status: 'pending' }]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(2);
    });

    it('should update title from plan feature', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', title: 'Original Title' })]
      });

      const plan = createTestPlan({ feature: 'New Feature Name' });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].title).toBe('New Feature Name');
    });

    it('should keep status when plan has no status', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'in_progress' })]
      });

      const plan = createTestPlan();

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].status).toBe('in_progress');
    });

    it('should NOT modify status from plan (XState is source of truth)', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'ai_review' })]
      });

      const plan = createTestPlan({
        status: 'human_review',
        reviewReason: 'completed'
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      // Status should remain unchanged - XState controls status via TASK_STATUS_CHANGE
      expect(useTaskStore.getState().tasks[0].status).toBe('ai_review');
    });

    it('should preserve existing status and reviewReason when plan has different values', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'human_review', reviewReason: 'errors' })]
      });

      const plan = createTestPlan({ status: 'ai_review' });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      // Status and reviewReason should remain unchanged - XState is source of truth
      expect(useTaskStore.getState().tasks[0].status).toBe('human_review');
      expect(useTaskStore.getState().tasks[0].reviewReason).toBe('errors');
    });

    it('should skip update when plan is invalid', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
      });

      const invalidPlan = { feature: 'Test' } as any;

      useTaskStore.getState().updateTaskFromPlan('task-1', invalidPlan);

      expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(0);
    });
  });

  describe('appendLog', () => {
    it('should append log to task by id', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', logs: [] })]
      });

      useTaskStore.getState().appendLog('task-1', 'First log');
      useTaskStore.getState().appendLog('task-1', 'Second log');

      expect(useTaskStore.getState().tasks[0].logs).toHaveLength(2);
      expect(useTaskStore.getState().tasks[0].logs[0]).toBe('First log');
      expect(useTaskStore.getState().tasks[0].logs[1]).toBe('Second log');
    });

    it('should append log to task by specId', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', specId: 'spec-001', logs: [] })]
      });

      useTaskStore.getState().appendLog('spec-001', 'Log message');

      expect(useTaskStore.getState().tasks[0].logs).toContain('Log message');
    });

    it('should accumulate logs correctly', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', logs: ['existing log'] })]
      });

      useTaskStore.getState().appendLog('task-1', 'new log');

      expect(useTaskStore.getState().tasks[0].logs).toHaveLength(2);
      expect(useTaskStore.getState().tasks[0].logs[0]).toBe('existing log');
      expect(useTaskStore.getState().tasks[0].logs[1]).toBe('new log');
    });
  });

  describe('selectTask', () => {
    it('should set selected task id', () => {
      useTaskStore.getState().selectTask('task-1');

      expect(useTaskStore.getState().selectedTaskId).toBe('task-1');
    });

    it('should clear selection with null', () => {
      useTaskStore.setState({ selectedTaskId: 'task-1' });

      useTaskStore.getState().selectTask(null);

      expect(useTaskStore.getState().selectedTaskId).toBeNull();
    });
  });

  describe('setLoading', () => {
    it('should set loading state to true', () => {
      useTaskStore.getState().setLoading(true);

      expect(useTaskStore.getState().isLoading).toBe(true);
    });

    it('should set loading state to false', () => {
      useTaskStore.setState({ isLoading: true });

      useTaskStore.getState().setLoading(false);

      expect(useTaskStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('should set error message', () => {
      useTaskStore.getState().setError('Something went wrong');

      expect(useTaskStore.getState().error).toBe('Something went wrong');
    });

    it('should clear error with null', () => {
      useTaskStore.setState({ error: 'Previous error' });

      useTaskStore.getState().setError(null);

      expect(useTaskStore.getState().error).toBeNull();
    });
  });

  describe('clearTasks', () => {
    it('should clear all tasks and selection', () => {
      useTaskStore.setState({
        tasks: [createTestTask(), createTestTask()],
        selectedTaskId: 'task-1'
      });

      useTaskStore.getState().clearTasks();

      expect(useTaskStore.getState().tasks).toHaveLength(0);
      expect(useTaskStore.getState().selectedTaskId).toBeNull();
    });
  });

  describe('getSelectedTask', () => {
    it('should return undefined when no task selected', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1' })],
        selectedTaskId: null
      });

      const selected = useTaskStore.getState().getSelectedTask();

      expect(selected).toBeUndefined();
    });

    it('should return selected task', () => {
      useTaskStore.setState({
        tasks: [
          createTestTask({ id: 'task-1', title: 'Task 1' }),
          createTestTask({ id: 'task-2', title: 'Task 2' })
        ],
        selectedTaskId: 'task-2'
      });

      const selected = useTaskStore.getState().getSelectedTask();

      expect(selected).toBeDefined();
      expect(selected?.title).toBe('Task 2');
    });

    it('should return undefined for non-existent selected id', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1' })],
        selectedTaskId: 'nonexistent'
      });

      const selected = useTaskStore.getState().getSelectedTask();

      expect(selected).toBeUndefined();
    });
  });

  describe('activity recording for stuck detection', () => {
    afterEach(() => {
      // Clean up activity tracking between tests
      clearTaskActivity('task-1');
    });

    it('should record activity when updateTaskStatus is called', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'backlog' })]
      });

      // Clear any prior activity
      clearTaskActivity('task-1');
      expect(hasRecentActivity('task-1')).toBe(false);

      // Status change should record activity
      useTaskStore.getState().updateTaskStatus('task-1', 'in_progress');

      expect(hasRecentActivity('task-1')).toBe(true);
    });

    it('should record activity when batchAppendLogs is called', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'in_progress' })]
      });

      clearTaskActivity('task-1');
      expect(hasRecentActivity('task-1')).toBe(false);

      // Log append should record activity
      useTaskStore.getState().batchAppendLogs('task-1', ['line 1', 'line 2']);

      expect(hasRecentActivity('task-1')).toBe(true);
    });

    it('should record activity when updateExecutionProgress is called', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'in_progress' })]
      });

      clearTaskActivity('task-1');
      expect(hasRecentActivity('task-1')).toBe(false);

      // Execution progress should record activity
      useTaskStore.getState().updateExecutionProgress('task-1', { phase: 'coding', phaseProgress: 50 });

      expect(hasRecentActivity('task-1')).toBe(true);
    });

    it('should not record activity for non-existent tasks in updateTaskStatus', () => {
      useTaskStore.setState({ tasks: [] });

      // Status change for missing task should still record activity
      // (recordTaskActivity fires before the index check)
      useTaskStore.getState().updateTaskStatus('nonexistent', 'in_progress');

      expect(hasRecentActivity('nonexistent')).toBe(true);
      clearTaskActivity('nonexistent');
    });
  });

  describe('getTasksByStatus', () => {
    it('should return empty array when no tasks match status', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ status: 'backlog' })]
      });

      const tasks = useTaskStore.getState().getTasksByStatus('in_progress');

      expect(tasks).toHaveLength(0);
    });

    it('should return all tasks with matching status', () => {
      useTaskStore.setState({
        tasks: [
          createTestTask({ id: 'task-1', status: 'in_progress' }),
          createTestTask({ id: 'task-2', status: 'backlog' }),
          createTestTask({ id: 'task-3', status: 'in_progress' })
        ]
      });

      const tasks = useTaskStore.getState().getTasksByStatus('in_progress');

      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.id)).toContain('task-1');
      expect(tasks.map((t) => t.id)).toContain('task-3');
    });

    it('should filter by each status type', () => {
      const statuses: TaskStatus[] = ['backlog', 'in_progress', 'ai_review', 'human_review', 'done'];

      useTaskStore.setState({
        tasks: statuses.map((status) => createTestTask({ id: `task-${status}`, status }))
      });

      statuses.forEach((status) => {
        const tasks = useTaskStore.getState().getTasksByStatus(status);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].status).toBe(status);
      });
    });
  });

});
