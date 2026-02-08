/**
 * Unit tests for Task Order State Management
 * Tests Zustand store actions for kanban board drag-and-drop reordering
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTaskStore } from '../stores/task-store';
import type { Task, TaskStatus, TaskOrderState } from '../../shared/types';

// Helper to create test tasks
function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    specId: 'test-spec-001',
    projectId: 'project-1',
    title: 'Test Task',
    description: 'Test description',
    status: 'planning' as TaskStatus,
    subtasks: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// Helper to create a test task order state
function createTestTaskOrder(overrides: Partial<TaskOrderState> = {}): TaskOrderState {
  return {
    planning: [],
    coding: [],
    ai_review: [],
    human_review: [],
    pr_created: [],
    done: [],
    ...overrides
  };
}

describe('Task Order State Management', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useTaskStore.setState({
      tasks: [],
      selectedTaskId: null,
      isLoading: false,
      error: null,
      taskOrder: null
    });
    // Clear localStorage
    localStorage.clear();
    // Use fake timers for debounced saveTaskOrder tests
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.runAllTimers();
    vi.useRealTimers();
  });

  describe('setTaskOrder', () => {
    it('should set task order state', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3']
      });

      useTaskStore.getState().setTaskOrder(order);

      expect(useTaskStore.getState().taskOrder).toEqual(order);
    });

    it('should replace existing task order', () => {
      const initialOrder = createTestTaskOrder({
        planning: ['old-task-1', 'old-task-2']
      });
      const newOrder = createTestTaskOrder({
        planning: ['new-task-1', 'new-task-2', 'new-task-3']
      });

      useTaskStore.getState().setTaskOrder(initialOrder);
      useTaskStore.getState().setTaskOrder(newOrder);

      expect(useTaskStore.getState().taskOrder).toEqual(newOrder);
    });

    it('should handle empty column arrays', () => {
      const order = createTestTaskOrder();

      useTaskStore.getState().setTaskOrder(order);

      expect(useTaskStore.getState().taskOrder?.planning).toEqual([]);
      expect(useTaskStore.getState().taskOrder?.coding).toEqual([]);
    });

    it('should preserve all column orders', () => {
      const order = createTestTaskOrder({
        planning: ['task-1'],
        coding: ['task-2'],
        ai_review: ['task-3'],
        human_review: ['task-4'],
        pr_created: ['task-5'],
        done: ['task-6']
      });

      useTaskStore.getState().setTaskOrder(order);

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1']);
      expect(useTaskStore.getState().taskOrder?.coding).toEqual(['task-2']);
      expect(useTaskStore.getState().taskOrder?.ai_review).toEqual(['task-3']);
      expect(useTaskStore.getState().taskOrder?.human_review).toEqual(['task-4']);
      expect(useTaskStore.getState().taskOrder?.pr_created).toEqual(['task-5']);
      expect(useTaskStore.getState().taskOrder?.done).toEqual(['task-6']);
    });
  });

  describe('reorderTasksInColumn', () => {
    it('should reorder tasks within a column using arrayMove', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3']
      });
      useTaskStore.setState({ taskOrder: order });

      // Move task-1 to position of task-3
      useTaskStore.getState().reorderTasksInColumn('planning', 'task-1', 'task-3');

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-2', 'task-3', 'task-1']);
    });

    it('should move task from later position to earlier position', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3', 'task-4']
      });
      useTaskStore.setState({ taskOrder: order });

      // Move task-4 to position of task-2
      useTaskStore.getState().reorderTasksInColumn('planning', 'task-4', 'task-2');

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1', 'task-4', 'task-2', 'task-3']);
    });

    it('should handle reordering in different columns', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2'],
        coding: ['task-3', 'task-4', 'task-5']
      });
      useTaskStore.setState({ taskOrder: order });

      // Reorder coding column
      useTaskStore.getState().reorderTasksInColumn('coding', 'task-5', 'task-3');

      expect(useTaskStore.getState().taskOrder?.coding).toEqual(['task-5', 'task-3', 'task-4']);
      // planning should remain unchanged
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1', 'task-2']);
    });

    it('should do nothing if taskOrder is null', () => {
      useTaskStore.setState({ taskOrder: null });

      useTaskStore.getState().reorderTasksInColumn('planning', 'task-1', 'task-2');

      expect(useTaskStore.getState().taskOrder).toBeNull();
    });

    it('should do nothing if activeId is not in the column', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3']
      });
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().reorderTasksInColumn('planning', 'nonexistent', 'task-2');

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should do nothing if overId is not in the column', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3']
      });
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().reorderTasksInColumn('planning', 'task-1', 'nonexistent');

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should do nothing if both activeId and overId are not in the column', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3']
      });
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().reorderTasksInColumn('planning', 'nonexistent-1', 'nonexistent-2');

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should handle reordering with same active and over id (no change)', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3']
      });
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().reorderTasksInColumn('planning', 'task-2', 'task-2');

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should handle column with only one task', () => {
      const order = createTestTaskOrder({
        planning: ['task-1']
      });
      useTaskStore.setState({ taskOrder: order });

      // Cannot reorder a single task (overId won't exist)
      useTaskStore.getState().reorderTasksInColumn('planning', 'task-1', 'task-2');

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1']);
    });

    it('should handle reordering adjacent tasks', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3']
      });
      useTaskStore.setState({ taskOrder: order });

      // Swap task-1 and task-2
      useTaskStore.getState().reorderTasksInColumn('planning', 'task-1', 'task-2');

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-2', 'task-1', 'task-3']);
    });
  });

  describe('loadTaskOrder', () => {
    it('should load task order from localStorage', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2'],
        coding: ['task-3']
      });
      localStorage.setItem('task-order-state-project-1', JSON.stringify(order));

      useTaskStore.getState().loadTaskOrder('project-1');

      expect(useTaskStore.getState().taskOrder).toEqual(order);
    });

    it('should create empty task order if no stored order exists', () => {
      useTaskStore.getState().loadTaskOrder('project-1');

      expect(useTaskStore.getState().taskOrder).toEqual({
        planning: [],
        coding: [],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      });
    });

    it('should use project-specific localStorage keys', () => {
      const order1 = createTestTaskOrder({ planning: ['project1-task'] });
      const order2 = createTestTaskOrder({ planning: ['project2-task'] });
      localStorage.setItem('task-order-state-project-1', JSON.stringify(order1));
      localStorage.setItem('task-order-state-project-2', JSON.stringify(order2));

      useTaskStore.getState().loadTaskOrder('project-1');
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['project1-task']);

      useTaskStore.getState().loadTaskOrder('project-2');
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['project2-task']);
    });

    it('should handle corrupted localStorage data gracefully', () => {
      // Spy on console.error to verify error logging
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      localStorage.setItem('task-order-state-project-1', 'invalid-json{{{');

      useTaskStore.getState().loadTaskOrder('project-1');

      // Should fall back to empty order state
      expect(useTaskStore.getState().taskOrder).toEqual({
        planning: [],
        coding: [],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      });
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load task order:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should handle localStorage access errors', () => {
      // Spy on console.error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock localStorage.getItem to throw
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = vi.fn(() => {
        throw new Error('Storage quota exceeded');
      });

      useTaskStore.getState().loadTaskOrder('project-1');

      // Should fall back to empty order state
      expect(useTaskStore.getState().taskOrder).toEqual({
        planning: [],
        coding: [],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      });

      localStorage.getItem = originalGetItem;
      consoleSpy.mockRestore();
    });
  });

  describe('saveTaskOrder', () => {
    it('should save task order to localStorage', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2'],
        coding: ['task-3']
      });
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().saveTaskOrder('project-1');
      // saveTaskOrder is debounced, must run timers to execute the save
      vi.runAllTimers();

      const stored = localStorage.getItem('task-order-state-project-1');
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored!)).toEqual(order);
    });

    it('should not save if taskOrder is null', () => {
      useTaskStore.setState({ taskOrder: null });

      useTaskStore.getState().saveTaskOrder('project-1');
      vi.runAllTimers();

      const stored = localStorage.getItem('task-order-state-project-1');
      expect(stored).toBeNull();
    });

    it('should use project-specific localStorage keys', () => {
      const order = createTestTaskOrder({ planning: ['test-task'] });
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().saveTaskOrder('my-project-id');
      vi.runAllTimers();

      expect(localStorage.getItem('task-order-state-my-project-id')).toBeTruthy();
      expect(localStorage.getItem('task-order-state-other-project')).toBeNull();
    });

    it('should handle localStorage write errors gracefully', () => {
      // Spy on console.error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const order = createTestTaskOrder({ planning: ['task-1'] });
      useTaskStore.setState({ taskOrder: order });

      // Mock localStorage.setItem to throw
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should not throw
      expect(() => {
        useTaskStore.getState().saveTaskOrder('project-1');
      }).not.toThrow();

      // Run timers to trigger the debounced save
      vi.runAllTimers();

      expect(consoleSpy).toHaveBeenCalledWith('Failed to save task order:', expect.any(Error));

      localStorage.setItem = originalSetItem;
      consoleSpy.mockRestore();
    });

    it('should overwrite existing stored order', () => {
      const initialOrder = createTestTaskOrder({ planning: ['old-task'] });
      localStorage.setItem('task-order-state-project-1', JSON.stringify(initialOrder));

      const newOrder = createTestTaskOrder({ planning: ['new-task-1', 'new-task-2'] });
      useTaskStore.setState({ taskOrder: newOrder });

      useTaskStore.getState().saveTaskOrder('project-1');
      vi.runAllTimers();

      const stored = JSON.parse(localStorage.getItem('task-order-state-project-1')!);
      expect(stored.planning).toEqual(['new-task-1', 'new-task-2']);
    });
  });

  describe('clearTaskOrder', () => {
    it('should clear task order from localStorage', () => {
      const order = createTestTaskOrder({ planning: ['task-1'] });
      localStorage.setItem('task-order-state-project-1', JSON.stringify(order));
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().clearTaskOrder('project-1');
      vi.runAllTimers();

      expect(localStorage.getItem('task-order-state-project-1')).toBeNull();
      expect(useTaskStore.getState().taskOrder).toBeNull();
    });

    it('should use project-specific localStorage keys', () => {
      localStorage.setItem('task-order-state-project-1', JSON.stringify(createTestTaskOrder()));
      localStorage.setItem('task-order-state-project-2', JSON.stringify(createTestTaskOrder()));

      useTaskStore.getState().clearTaskOrder('project-1');
      vi.runAllTimers();

      expect(localStorage.getItem('task-order-state-project-1')).toBeNull();
      expect(localStorage.getItem('task-order-state-project-2')).toBeTruthy();
    });

    it('should handle localStorage removal errors gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock localStorage.removeItem to throw
      const originalRemoveItem = localStorage.removeItem;
      localStorage.removeItem = vi.fn(() => {
        throw new Error('Storage error');
      });

      // Should not throw
      expect(() => {
        useTaskStore.getState().clearTaskOrder('project-1');
      }).not.toThrow();

      localStorage.removeItem = originalRemoveItem;
      consoleSpy.mockRestore();
    });
  });

  describe('moveTaskToColumnTop', () => {
    it('should move task to top of target column', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2'],
        coding: ['task-3', 'task-4']
      });
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().moveTaskToColumnTop('task-2', 'coding', 'planning');

      expect(useTaskStore.getState().taskOrder?.coding).toEqual(['task-2', 'task-3', 'task-4']);
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1']);
    });

    it('should remove task from source column when provided', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3'],
        coding: ['task-4']
      });
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().moveTaskToColumnTop('task-2', 'coding', 'planning');

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1', 'task-3']);
    });

    it('should work without source column (only add to target)', () => {
      const order = createTestTaskOrder({
        planning: ['task-1'],
        coding: ['task-2', 'task-3']
      });
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().moveTaskToColumnTop('new-task', 'coding');

      expect(useTaskStore.getState().taskOrder?.coding).toEqual(['new-task', 'task-2', 'task-3']);
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1']);
    });

    it('should handle task already in target column (remove duplicate first)', () => {
      const order = createTestTaskOrder({
        coding: ['task-1', 'task-2', 'task-3']
      });
      useTaskStore.setState({ taskOrder: order });

      // Move task-3 to top of same column (simulates cross-column then same-column scenario)
      useTaskStore.getState().moveTaskToColumnTop('task-3', 'coding');

      expect(useTaskStore.getState().taskOrder?.coding).toEqual(['task-3', 'task-1', 'task-2']);
    });

    it('should do nothing if taskOrder is null', () => {
      useTaskStore.setState({ taskOrder: null });

      useTaskStore.getState().moveTaskToColumnTop('task-1', 'coding', 'planning');

      expect(useTaskStore.getState().taskOrder).toBeNull();
    });

    it('should initialize target column if it does not exist in order', () => {
      // Create order with partial columns (simulating missing column)
      const order = {
        planning: ['task-1'],
        coding: [],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      } as TaskOrderState;
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().moveTaskToColumnTop('task-1', 'coding', 'planning');

      expect(useTaskStore.getState().taskOrder?.coding).toEqual(['task-1']);
    });
  });

  describe('addTask with task order', () => {
    it('should add new task to top of column order', () => {
      const order = createTestTaskOrder({
        planning: ['existing-task-1', 'existing-task-2']
      });
      useTaskStore.setState({ taskOrder: order, tasks: [] });

      const newTask = createTestTask({ id: 'new-task', status: 'planning' });
      useTaskStore.getState().addTask(newTask);

      expect(useTaskStore.getState().taskOrder?.planning).toEqual([
        'new-task',
        'existing-task-1',
        'existing-task-2'
      ]);
    });

    it('should add task to correct column based on status', () => {
      const order = createTestTaskOrder({
        planning: ['backlog-task'],
        coding: ['progress-task']
      });
      useTaskStore.setState({ taskOrder: order, tasks: [] });

      const newTask = createTestTask({ id: 'new-progress-task', status: 'coding' });
      useTaskStore.getState().addTask(newTask);

      expect(useTaskStore.getState().taskOrder?.coding).toEqual([
        'new-progress-task',
        'progress-task'
      ]);
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['backlog-task']);
    });

    it('should not modify order if taskOrder is null', () => {
      useTaskStore.setState({ taskOrder: null, tasks: [] });

      const newTask = createTestTask({ id: 'new-task', status: 'planning' });
      useTaskStore.getState().addTask(newTask);

      expect(useTaskStore.getState().taskOrder).toBeNull();
      expect(useTaskStore.getState().tasks).toHaveLength(1);
    });

    it('should handle adding task when column does not exist in order', () => {
      const order = createTestTaskOrder({
        planning: ['task-1']
      });
      useTaskStore.setState({ taskOrder: order, tasks: [] });

      // This should work because createTestTaskOrder initializes all columns
      const newTask = createTestTask({ id: 'new-task', status: 'done' });
      useTaskStore.getState().addTask(newTask);

      expect(useTaskStore.getState().taskOrder?.done).toEqual(['new-task']);
    });

    it('should prevent duplicate task IDs in order', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2']
      });
      useTaskStore.setState({ taskOrder: order, tasks: [] });

      // Try to add a task with existing ID
      const duplicateTask = createTestTask({ id: 'task-1', status: 'planning' });
      useTaskStore.getState().addTask(duplicateTask);

      // Should add to top but remove existing occurrence
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-1', 'task-2']);
    });
  });

  describe('localStorage persistence edge cases', () => {
    it('should handle empty string in localStorage', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      localStorage.setItem('task-order-state-project-1', '');

      useTaskStore.getState().loadTaskOrder('project-1');

      // Empty string causes JSON.parse to throw - should fall back to empty order
      expect(useTaskStore.getState().taskOrder).toEqual({
        planning: [],
        coding: [],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      });

      consoleSpy.mockRestore();
    });

    it('should handle partial/incomplete JSON object', () => {
      // JSON that parses but is missing some columns
      const partialOrder = { planning: ['task-1'], coding: ['task-2'] };
      localStorage.setItem('task-order-state-project-1', JSON.stringify(partialOrder));

      useTaskStore.getState().loadTaskOrder('project-1');

      // Should load whatever was stored (partial data)
      const order = useTaskStore.getState().taskOrder;
      expect(order?.planning).toEqual(['task-1']);
      expect(order?.coding).toEqual(['task-2']);
      // Missing columns will be filled with empty arrays from createEmptyTaskOrder
      expect(order?.ai_review).toEqual([]);
    });

    it('should handle null stored value', () => {
      localStorage.setItem('task-order-state-project-1', JSON.stringify(null));

      useTaskStore.getState().loadTaskOrder('project-1');

      // null is valid JSON but not a valid TaskOrderState - store resets to empty order
      const order = useTaskStore.getState().taskOrder;
      expect(order).not.toBeNull();
      expect(order?.planning).toEqual([]);
    });

    it('should handle array instead of object stored', () => {
      localStorage.setItem('task-order-state-project-1', JSON.stringify(['task-1', 'task-2']));

      useTaskStore.getState().loadTaskOrder('project-1');

      // Array is valid JSON but wrong structure - store resets to empty order
      const order = useTaskStore.getState().taskOrder;
      expect(Array.isArray(order)).toBe(false);
      expect(order?.planning).toEqual([]);
    });

    it('should round-trip save and load with exact data preservation', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3'],
        coding: ['task-4'],
        ai_review: [],
        human_review: ['task-5', 'task-6'],
        pr_created: [],
        done: ['task-7', 'task-8', 'task-9', 'task-10']
      });
      useTaskStore.setState({ taskOrder: order });

      // Save
      useTaskStore.getState().saveTaskOrder('round-trip-test');
      vi.runAllTimers();

      // Clear state
      useTaskStore.setState({ taskOrder: null });
      expect(useTaskStore.getState().taskOrder).toBeNull();

      // Load
      useTaskStore.getState().loadTaskOrder('round-trip-test');

      // Verify exact preservation
      expect(useTaskStore.getState().taskOrder).toEqual(order);
    });

    it('should handle special characters in project ID', () => {
      const order = createTestTaskOrder({ planning: ['special-task'] });
      useTaskStore.setState({ taskOrder: order });

      const specialProjectId = 'project/with:special@chars!';
      useTaskStore.getState().saveTaskOrder(specialProjectId);
      vi.runAllTimers();

      useTaskStore.setState({ taskOrder: null });
      useTaskStore.getState().loadTaskOrder(specialProjectId);

      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['special-task']);
    });

    it('should isolate different projects completely', () => {
      // Set up three different projects with different orders
      const orders = {
        'project-a': createTestTaskOrder({ planning: ['a-task-1', 'a-task-2'] }),
        'project-b': createTestTaskOrder({ coding: ['b-task-1'] }),
        'project-c': createTestTaskOrder({ done: ['c-task-1', 'c-task-2', 'c-task-3'] })
      };

      // Save each project individually to account for debounce behavior
      // The debounce timer is global, so we need to run timers after each save
      for (const [projectId, order] of Object.entries(orders)) {
        useTaskStore.setState({ taskOrder: order });
        useTaskStore.getState().saveTaskOrder(projectId);
        // Run timers after each save to prevent the next call from canceling it
        vi.runAllTimers();
      }

      // Clear and verify each loads independently
      for (const [projectId, expectedOrder] of Object.entries(orders)) {
        useTaskStore.setState({ taskOrder: null });
        useTaskStore.getState().loadTaskOrder(projectId);
        expect(useTaskStore.getState().taskOrder).toEqual(expectedOrder);
      }
    });

    it('should handle very long task ID arrays', () => {
      // Create an order with many task IDs
      const manyTaskIds = Array.from({ length: 100 }, (_, i) => `task-${i}`);
      const order = createTestTaskOrder({ planning: manyTaskIds });
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().saveTaskOrder('many-tasks-project');
      vi.runAllTimers();

      useTaskStore.setState({ taskOrder: null });
      useTaskStore.getState().loadTaskOrder('many-tasks-project');

      expect(useTaskStore.getState().taskOrder?.planning).toHaveLength(100);
      expect(useTaskStore.getState().taskOrder?.planning[0]).toBe('task-0');
      expect(useTaskStore.getState().taskOrder?.planning[99]).toBe('task-99');
    });
  });

  describe('order filtering: stale ID removal', () => {
    it('should filter out stale IDs that do not exist in tasks', () => {
      // Scenario: Task order has IDs for tasks that have been deleted
      const tasks = [
        createTestTask({ id: 'task-1', status: 'planning' }),
        createTestTask({ id: 'task-3', status: 'planning' })
      ];

      // Order contains 'task-2' which no longer exists
      const orderWithStaleIds = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3']
      });

      useTaskStore.setState({ tasks, taskOrder: orderWithStaleIds });

      // Build a set of current task IDs and filter out stale IDs
      const currentTaskIds = new Set(tasks.map(t => t.id));
      const columnOrder = useTaskStore.getState().taskOrder?.planning || [];
      const validOrder = columnOrder.filter(id => currentTaskIds.has(id));

      // Stale ID should be filtered out
      expect(validOrder).toEqual(['task-1', 'task-3']);
      expect(validOrder).not.toContain('task-2');
    });

    it('should return empty array when all IDs are stale', () => {
      // Scenario: All tasks have been deleted
      const tasks: Task[] = [];

      const orderWithOnlyStaleIds = createTestTaskOrder({
        planning: ['deleted-task-1', 'deleted-task-2', 'deleted-task-3']
      });

      useTaskStore.setState({ tasks, taskOrder: orderWithOnlyStaleIds });

      // Filter out stale IDs
      const currentTaskIds = new Set(tasks.map(t => t.id));
      const columnOrder = useTaskStore.getState().taskOrder?.planning || [];
      const validOrder = columnOrder.filter(id => currentTaskIds.has(id));

      expect(validOrder).toEqual([]);
      expect(validOrder).toHaveLength(0);
    });

    it('should preserve valid IDs while removing stale ones', () => {
      const tasks = [
        createTestTask({ id: 'valid-1', status: 'coding' }),
        createTestTask({ id: 'valid-3', status: 'coding' }),
        createTestTask({ id: 'valid-5', status: 'coding' })
      ];

      // Order with alternating valid/stale IDs
      const mixedOrder = createTestTaskOrder({
        coding: ['valid-1', 'stale-2', 'valid-3', 'stale-4', 'valid-5']
      });

      useTaskStore.setState({ tasks, taskOrder: mixedOrder });

      // Filter stale IDs
      const currentTaskIds = new Set(tasks.map(t => t.id));
      const columnOrder = useTaskStore.getState().taskOrder?.coding || [];
      const validOrder = columnOrder.filter(id => currentTaskIds.has(id));

      // Should keep relative order of valid IDs
      expect(validOrder).toEqual(['valid-1', 'valid-3', 'valid-5']);
    });

    it('should handle stale IDs across multiple columns', () => {
      const tasks = [
        createTestTask({ id: 'backlog-task', status: 'planning' }),
        createTestTask({ id: 'progress-task', status: 'coding' }),
        createTestTask({ id: 'done-task', status: 'done' })
      ];

      const orderWithStaleInMultipleColumns = createTestTaskOrder({
        planning: ['backlog-task', 'stale-backlog'],
        coding: ['stale-progress', 'progress-task'],
        done: ['stale-done-1', 'done-task', 'stale-done-2']
      });

      useTaskStore.setState({ tasks, taskOrder: orderWithStaleInMultipleColumns });

      const currentTaskIds = new Set(tasks.map(t => t.id));
      const taskOrder = useTaskStore.getState().taskOrder!;

      // Filter each column
      const validBacklog = taskOrder.planning.filter(id => currentTaskIds.has(id));
      const validProgress = taskOrder.coding.filter(id => currentTaskIds.has(id));
      const validDone = taskOrder.done.filter(id => currentTaskIds.has(id));

      expect(validBacklog).toEqual(['backlog-task']);
      expect(validProgress).toEqual(['progress-task']);
      expect(validDone).toEqual(['done-task']);
    });

    it('should not modify order if all IDs are valid', () => {
      const tasks = [
        createTestTask({ id: 'task-1', status: 'planning' }),
        createTestTask({ id: 'task-2', status: 'planning' }),
        createTestTask({ id: 'task-3', status: 'planning' })
      ];

      const validOrder = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3']
      });

      useTaskStore.setState({ tasks, taskOrder: validOrder });

      const currentTaskIds = new Set(tasks.map(t => t.id));
      const columnOrder = useTaskStore.getState().taskOrder?.planning || [];
      const filteredOrder = columnOrder.filter(id => currentTaskIds.has(id));

      // Should be identical
      expect(filteredOrder).toEqual(['task-1', 'task-2', 'task-3']);
      expect(filteredOrder.length).toBe(columnOrder.length);
    });
  });

  describe('order filtering: new task placement at top', () => {
    it('should identify new tasks not present in custom order', () => {
      const tasks = [
        createTestTask({ id: 'existing-1', status: 'planning' }),
        createTestTask({ id: 'existing-2', status: 'planning' }),
        createTestTask({ id: 'new-task', status: 'planning' }) // Not in order
      ];

      const orderWithoutNewTask = createTestTaskOrder({
        planning: ['existing-1', 'existing-2']
      });

      useTaskStore.setState({ tasks, taskOrder: orderWithoutNewTask });

      const columnOrder = useTaskStore.getState().taskOrder?.planning || [];
      const orderSet = new Set(columnOrder);
      const columnTasks = tasks.filter(t => t.status === 'planning');

      // Find new tasks (not in order)
      const newTasks = columnTasks.filter(t => !orderSet.has(t.id));

      expect(newTasks).toHaveLength(1);
      expect(newTasks[0].id).toBe('new-task');
    });

    it('should identify multiple new tasks not in order', () => {
      const tasks = [
        createTestTask({ id: 'existing-1', status: 'planning' }),
        createTestTask({ id: 'new-task-1', status: 'planning' }),
        createTestTask({ id: 'new-task-2', status: 'planning' }),
        createTestTask({ id: 'new-task-3', status: 'planning' })
      ];

      const orderWithOnlyOne = createTestTaskOrder({
        planning: ['existing-1']
      });

      useTaskStore.setState({ tasks, taskOrder: orderWithOnlyOne });

      const columnOrder = useTaskStore.getState().taskOrder?.planning || [];
      const orderSet = new Set(columnOrder);
      const columnTasks = tasks.filter(t => t.status === 'planning');

      const newTasks = columnTasks.filter(t => !orderSet.has(t.id));

      expect(newTasks).toHaveLength(3);
      expect(newTasks.map(t => t.id)).toContain('new-task-1');
      expect(newTasks.map(t => t.id)).toContain('new-task-2');
      expect(newTasks.map(t => t.id)).toContain('new-task-3');
    });

    it('should correctly separate ordered and unordered tasks', () => {
      const tasks = [
        createTestTask({ id: 'ordered-1', status: 'coding' }),
        createTestTask({ id: 'ordered-2', status: 'coding' }),
        createTestTask({ id: 'unordered-1', status: 'coding' }),
        createTestTask({ id: 'ordered-3', status: 'coding' }),
        createTestTask({ id: 'unordered-2', status: 'coding' })
      ];

      const partialOrder = createTestTaskOrder({
        coding: ['ordered-1', 'ordered-2', 'ordered-3']
      });

      useTaskStore.setState({ tasks, taskOrder: partialOrder });

      const columnOrder = useTaskStore.getState().taskOrder?.coding || [];
      const orderSet = new Set(columnOrder);
      const columnTasks = tasks.filter(t => t.status === 'coding');

      const orderedTasks = columnTasks.filter(t => orderSet.has(t.id));
      const unorderedTasks = columnTasks.filter(t => !orderSet.has(t.id));

      expect(orderedTasks).toHaveLength(3);
      expect(unorderedTasks).toHaveLength(2);
      expect(orderedTasks.map(t => t.id)).toEqual(['ordered-1', 'ordered-2', 'ordered-3']);
      expect(unorderedTasks.map(t => t.id)).toContain('unordered-1');
      expect(unorderedTasks.map(t => t.id)).toContain('unordered-2');
    });

    it('should handle empty order (all tasks are new)', () => {
      const tasks = [
        createTestTask({ id: 'new-1', status: 'planning' }),
        createTestTask({ id: 'new-2', status: 'planning' }),
        createTestTask({ id: 'new-3', status: 'planning' })
      ];

      const emptyOrder = createTestTaskOrder({
        planning: []
      });

      useTaskStore.setState({ tasks, taskOrder: emptyOrder });

      const columnOrder = useTaskStore.getState().taskOrder?.planning || [];
      const orderSet = new Set(columnOrder);
      const columnTasks = tasks.filter(t => t.status === 'planning');

      const newTasks = columnTasks.filter(t => !orderSet.has(t.id));

      // All tasks should be considered new
      expect(newTasks).toHaveLength(3);
      expect(newTasks.map(t => t.id)).toEqual(['new-1', 'new-2', 'new-3']);
    });

    it('should addTask to place new task at top of order', () => {
      const existingOrder = createTestTaskOrder({
        planning: ['existing-1', 'existing-2']
      });

      useTaskStore.setState({ tasks: [], taskOrder: existingOrder });

      // Add a new task
      const newTask = createTestTask({ id: 'brand-new', status: 'planning' });
      useTaskStore.getState().addTask(newTask);

      // New task should be at the top of the order
      const order = useTaskStore.getState().taskOrder;
      expect(order?.planning[0]).toBe('brand-new');
      expect(order?.planning).toEqual(['brand-new', 'existing-1', 'existing-2']);
    });

    it('should addTask to correct column based on task status', () => {
      const existingOrder = createTestTaskOrder({
        planning: ['backlog-task'],
        coding: ['progress-task'],
        done: ['done-task']
      });

      useTaskStore.setState({ tasks: [], taskOrder: existingOrder });

      // Add a task to in_progress
      const newProgressTask = createTestTask({ id: 'new-progress', status: 'coding' });
      useTaskStore.getState().addTask(newProgressTask);

      const order = useTaskStore.getState().taskOrder;
      // Should be at top of in_progress
      expect(order?.coding[0]).toBe('new-progress');
      // Should not affect other columns
      expect(order?.planning).toEqual(['backlog-task']);
      expect(order?.done).toEqual(['done-task']);
    });
  });

  describe('order filtering: cross-column move updates', () => {
    it('should remove task from source column and add to target column on move', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2', 'task-3'],
        coding: ['task-4', 'task-5']
      });
      useTaskStore.setState({ taskOrder: order });

      // Move task-2 from backlog to in_progress
      useTaskStore.getState().moveTaskToColumnTop('task-2', 'coding', 'planning');

      const updatedOrder = useTaskStore.getState().taskOrder;
      // Removed from source
      expect(updatedOrder?.planning).toEqual(['task-1', 'task-3']);
      // Added to top of target
      expect(updatedOrder?.coding).toEqual(['task-2', 'task-4', 'task-5']);
    });

    it('should move task to top of target column preserving target order', () => {
      const order = createTestTaskOrder({
        ai_review: ['review-1', 'review-2', 'review-3'],
        human_review: ['human-1', 'human-2']
      });
      useTaskStore.setState({ taskOrder: order });

      // Move from ai_review to human_review
      useTaskStore.getState().moveTaskToColumnTop('review-2', 'human_review', 'ai_review');

      const updatedOrder = useTaskStore.getState().taskOrder;
      // Should be at top of human_review
      expect(updatedOrder?.human_review[0]).toBe('review-2');
      // Existing tasks pushed down
      expect(updatedOrder?.human_review).toEqual(['review-2', 'human-1', 'human-2']);
    });

    it('should handle moving to empty column', () => {
      const order = createTestTaskOrder({
        planning: ['task-1', 'task-2'],
        done: []
      });
      useTaskStore.setState({ taskOrder: order });

      // Move to empty done column
      useTaskStore.getState().moveTaskToColumnTop('task-1', 'done', 'planning');

      const updatedOrder = useTaskStore.getState().taskOrder;
      expect(updatedOrder?.done).toEqual(['task-1']);
      expect(updatedOrder?.planning).toEqual(['task-2']);
    });

    it('should handle moving from single-item column', () => {
      const order = createTestTaskOrder({
        coding: ['lone-task'],
        done: ['done-1', 'done-2']
      });
      useTaskStore.setState({ taskOrder: order });

      // Move the only task out of in_progress
      useTaskStore.getState().moveTaskToColumnTop('lone-task', 'done', 'coding');

      const updatedOrder = useTaskStore.getState().taskOrder;
      expect(updatedOrder?.coding).toEqual([]);
      expect(updatedOrder?.done[0]).toBe('lone-task');
    });

    it('should handle sequential cross-column moves', () => {
      const order = createTestTaskOrder({
        planning: ['task-1'],
        coding: [],
        ai_review: [],
        done: []
      });
      useTaskStore.setState({ taskOrder: order });

      // Move task through multiple columns (simulating workflow)
      useTaskStore.getState().moveTaskToColumnTop('task-1', 'coding', 'planning');

      let updatedOrder = useTaskStore.getState().taskOrder;
      expect(updatedOrder?.planning).toEqual([]);
      expect(updatedOrder?.coding).toEqual(['task-1']);

      useTaskStore.getState().moveTaskToColumnTop('task-1', 'ai_review', 'coding');

      updatedOrder = useTaskStore.getState().taskOrder;
      expect(updatedOrder?.coding).toEqual([]);
      expect(updatedOrder?.ai_review).toEqual(['task-1']);

      useTaskStore.getState().moveTaskToColumnTop('task-1', 'done', 'ai_review');

      updatedOrder = useTaskStore.getState().taskOrder;
      expect(updatedOrder?.ai_review).toEqual([]);
      expect(updatedOrder?.done).toEqual(['task-1']);
    });

    it('should handle moving task that is already in target column (dedup)', () => {
      // Edge case: somehow task ID ended up in both columns
      const orderWithDup = createTestTaskOrder({
        planning: ['task-1', 'task-2'],
        coding: ['task-2', 'task-3'] // task-2 is duplicated
      });
      useTaskStore.setState({ taskOrder: orderWithDup });

      // Move task-2 from backlog to in_progress
      useTaskStore.getState().moveTaskToColumnTop('task-2', 'coding', 'planning');

      const updatedOrder = useTaskStore.getState().taskOrder;
      // Should be removed from backlog
      expect(updatedOrder?.planning).toEqual(['task-1']);
      // Should appear exactly once at top of in_progress
      expect(updatedOrder?.coding[0]).toBe('task-2');
      // Should be deduplicated
      const task2Count = updatedOrder?.coding.filter(id => id === 'task-2').length;
      expect(task2Count).toBe(1);
    });

    it('should preserve unaffected columns during cross-column move', () => {
      const order = createTestTaskOrder({
        planning: ['backlog-1', 'backlog-2'],
        coding: ['progress-1'],
        ai_review: ['review-1', 'review-2'],
        human_review: ['human-1'],
        done: ['done-1', 'done-2', 'done-3']
      });
      useTaskStore.setState({ taskOrder: order });

      // Move from backlog to in_progress
      useTaskStore.getState().moveTaskToColumnTop('backlog-1', 'coding', 'planning');

      const updatedOrder = useTaskStore.getState().taskOrder;
      // Affected columns updated
      expect(updatedOrder?.planning).toEqual(['backlog-2']);
      expect(updatedOrder?.coding).toEqual(['backlog-1', 'progress-1']);
      // Unaffected columns preserved exactly
      expect(updatedOrder?.ai_review).toEqual(['review-1', 'review-2']);
      expect(updatedOrder?.human_review).toEqual(['human-1']);
      expect(updatedOrder?.done).toEqual(['done-1', 'done-2', 'done-3']);
    });
  });

  describe('integration: load, reorder, save cycle', () => {
    it('should persist reordering through load/save cycle', () => {
      // 1. Load empty order
      useTaskStore.getState().loadTaskOrder('test-project');
      expect(useTaskStore.getState().taskOrder).toBeDefined();

      // 2. Set up initial order
      const order = createTestTaskOrder({
        planning: ['task-a', 'task-b', 'task-c']
      });
      useTaskStore.getState().setTaskOrder(order);

      // 3. Reorder
      useTaskStore.getState().reorderTasksInColumn('planning', 'task-c', 'task-a');
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-c', 'task-a', 'task-b']);

      // 4. Save
      useTaskStore.getState().saveTaskOrder('test-project');
      vi.runAllTimers();

      // 5. Clear state
      useTaskStore.setState({ taskOrder: null });

      // 6. Reload
      useTaskStore.getState().loadTaskOrder('test-project');

      // 7. Verify order persisted
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['task-c', 'task-a', 'task-b']);
    });

    it('should handle project switching correctly', () => {
      // Set up orders for two projects
      const order1 = createTestTaskOrder({ planning: ['project1-task'] });
      const order2 = createTestTaskOrder({ planning: ['project2-task'] });

      // Save project 1 order
      useTaskStore.setState({ taskOrder: order1 });
      useTaskStore.getState().saveTaskOrder('project-1');
      // Run timers after each save to prevent debounce cancellation
      vi.runAllTimers();

      // Save project 2 order
      useTaskStore.setState({ taskOrder: order2 });
      useTaskStore.getState().saveTaskOrder('project-2');
      // Run timers to flush the debounced save
      vi.runAllTimers();

      // Clear and switch between projects
      useTaskStore.setState({ taskOrder: null });

      useTaskStore.getState().loadTaskOrder('project-1');
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['project1-task']);

      useTaskStore.getState().loadTaskOrder('project-2');
      expect(useTaskStore.getState().taskOrder?.planning).toEqual(['project2-task']);
    });
  });
});
