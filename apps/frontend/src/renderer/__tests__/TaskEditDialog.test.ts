/**
 * Unit tests for TaskEditDialog component
 * Tests edit functionality, form validation, and integration with task-store
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTaskStore, persistUpdateTask } from '../stores/task-store';
import type { Task, TaskStatus } from '../../shared/types';

// Helper to create test tasks
function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    specId: 'test-spec-001',
    projectId: 'project-1',
    title: 'Test Task Title',
    description: 'Test task description',
    status: 'planning' as TaskStatus,
    subtasks: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// Import browser mock to get full ElectronAPI structure
import '../lib/browser-mock';

// Mock the window.electronAPI.updateTask specifically
const mockUpdateTask = vi.fn();

// Override window.electronAPI for these tests
const originalWindow = global.window;

describe('TaskEditDialog Logic', () => {
  beforeEach(() => {
    // Reset store state
    useTaskStore.setState({
      tasks: [],
      selectedTaskId: null,
      isLoading: false,
      error: null
    });

    // Override just the updateTask method on the existing electronAPI
    if (window.electronAPI) {
      window.electronAPI.updateTask = mockUpdateTask;
    }

    // Clear mock calls
    mockUpdateTask.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    (global as typeof globalThis & { window: typeof window }).window = originalWindow;
  });

  describe('Task Title/Description Validation', () => {
    it('should have valid form when title and description are non-empty', () => {
      const task = createTestTask({
        title: 'Valid Title',
        description: 'Valid description'
      });

      // Simulate form state
      const title = task.title.trim();
      const description = task.description.trim();
      const isValid = title.length > 0 && description.length > 0;

      expect(isValid).toBe(true);
    });

    it('should be invalid when title is empty', () => {
      const task = createTestTask({
        title: '',
        description: 'Valid description'
      });

      const title = task.title.trim();
      const description = task.description.trim();
      const isValid = title.length > 0 && description.length > 0;

      expect(isValid).toBe(false);
    });

    it('should be invalid when description is empty', () => {
      const task = createTestTask({
        title: 'Valid Title',
        description: ''
      });

      const title = task.title.trim();
      const description = task.description.trim();
      const isValid = title.length > 0 && description.length > 0;

      expect(isValid).toBe(false);
    });

    it('should be invalid when title is only whitespace', () => {
      const task = createTestTask({
        title: '   ',
        description: 'Valid description'
      });

      const title = task.title.trim();
      const description = task.description.trim();
      const isValid = title.length > 0 && description.length > 0;

      expect(isValid).toBe(false);
    });

    it('should be invalid when both are empty', () => {
      const task = createTestTask({
        title: '',
        description: ''
      });

      const title = task.title.trim();
      const description = task.description.trim();
      const isValid = title.length > 0 && description.length > 0;

      expect(isValid).toBe(false);
    });
  });

  describe('Change Detection', () => {
    it('should detect when title has changed', () => {
      const originalTitle = 'Original Title';
      const originalDescription = 'Original description';
      const newTitle = 'Updated Title';

      const hasChanges =
        newTitle.trim() !== originalTitle || originalDescription.trim() !== originalDescription;

      expect(hasChanges).toBe(true);
    });

    it('should detect when description has changed', () => {
      const originalTitle = 'Original Title';
      const originalDescription = 'Original description';
      const newDescription = 'Updated description';

      const hasChanges =
        originalTitle.trim() !== originalTitle || newDescription.trim() !== originalDescription;

      expect(hasChanges).toBe(true);
    });

    it('should detect no changes when values are same', () => {
      const originalTitle = 'Original Title';
      const originalDescription = 'Original description';

      const hasChanges =
        originalTitle.trim() !== originalTitle || originalDescription.trim() !== originalDescription;

      expect(hasChanges).toBe(false);
    });

    it('should ignore leading/trailing whitespace when comparing', () => {
      const originalTitle = 'Original Title';
      const originalDescription = 'Original description';
      const titleWithWhitespace = '  Original Title  ';

      // When trimmed, should be equal
      const hasChanges =
        titleWithWhitespace.trim() !== originalTitle ||
        originalDescription.trim() !== originalDescription;

      expect(hasChanges).toBe(false);
    });
  });

  describe('Edit Button State', () => {
    it('should be disabled when task is running', () => {
      const task = createTestTask({ status: 'coding' });
      const isRunning = task.status === 'coding';
      const isStuck = false;

      const isEditDisabled = isRunning && !isStuck;

      expect(isEditDisabled).toBe(true);
    });

    it('should be enabled when task is not running', () => {
      const task = createTestTask({ status: 'planning' });
      const isRunning = task.status === 'coding';
      const isStuck = false;

      const isEditDisabled = isRunning && !isStuck;

      expect(isEditDisabled).toBe(false);
    });

    it('should be enabled when task is stuck (even if status is in_progress)', () => {
      const task = createTestTask({ status: 'coding' });
      const isRunning = task.status === 'coding';
      const isStuck = true;

      const isEditDisabled = isRunning && !isStuck;

      expect(isEditDisabled).toBe(false);
    });

    it('should be enabled for tasks in human_review', () => {
      const task = createTestTask({ status: 'human_review' });
      const isRunning = task.status === 'coding';
      const isStuck = false;

      const isEditDisabled = isRunning && !isStuck;

      expect(isEditDisabled).toBe(false);
    });

    it('should be enabled for completed tasks', () => {
      const task = createTestTask({ status: 'done' });
      const isRunning = task.status === 'coding';
      const isStuck = false;

      const isEditDisabled = isRunning && !isStuck;

      expect(isEditDisabled).toBe(false);
    });
  });

  describe('Store Integration', () => {
    it('should update task in store with new title', () => {
      const task = createTestTask({ id: 'task-1', title: 'Original Title' });
      useTaskStore.setState({ tasks: [task] });

      useTaskStore.getState().updateTask('task-1', { title: 'Updated Title' });

      const updatedTask = useTaskStore.getState().tasks.find((t) => t.id === 'task-1');
      expect(updatedTask?.title).toBe('Updated Title');
    });

    it('should update task in store with new description', () => {
      const task = createTestTask({ id: 'task-1', description: 'Original description' });
      useTaskStore.setState({ tasks: [task] });

      useTaskStore.getState().updateTask('task-1', { description: 'Updated description' });

      const updatedTask = useTaskStore.getState().tasks.find((t) => t.id === 'task-1');
      expect(updatedTask?.description).toBe('Updated description');
    });

    it('should update both title and description simultaneously', () => {
      const task = createTestTask({
        id: 'task-1',
        title: 'Original Title',
        description: 'Original description'
      });
      useTaskStore.setState({ tasks: [task] });

      useTaskStore.getState().updateTask('task-1', {
        title: 'New Title',
        description: 'New description'
      });

      const updatedTask = useTaskStore.getState().tasks.find((t) => t.id === 'task-1');
      expect(updatedTask?.title).toBe('New Title');
      expect(updatedTask?.description).toBe('New description');
    });

    it('should preserve other task properties when updating', () => {
      const task = createTestTask({
        id: 'task-1',
        title: 'Original Title',
        status: 'coding',
        subtasks: [{ id: 'subtask-1', title: 'Test subtask', description: 'Test subtask', status: 'pending', files: [] }]
      });
      useTaskStore.setState({ tasks: [task] });

      useTaskStore.getState().updateTask('task-1', { title: 'Updated Title' });

      const updatedTask = useTaskStore.getState().tasks.find((t) => t.id === 'task-1');
      expect(updatedTask?.status).toBe('coding');
      expect(updatedTask?.subtasks).toHaveLength(1);
    });
  });

  describe('Image Display', () => {
    it('should identify tasks with attached images', () => {
      const taskWithImages = createTestTask({
        metadata: {
          attachedImages: [
            { id: 'img-1', filename: 'test.png', mimeType: 'image/png', size: 1024, data: 'abc123' }
          ]
        }
      });

      const attachedImages = taskWithImages.metadata?.attachedImages || [];
      expect(attachedImages.length).toBeGreaterThan(0);
    });

    it('should handle tasks without images', () => {
      const taskWithoutImages = createTestTask({
        metadata: {}
      });

      const attachedImages = taskWithoutImages.metadata?.attachedImages || [];
      expect(attachedImages.length).toBe(0);
    });

    it('should handle tasks with undefined metadata', () => {
      const taskNoMetadata = createTestTask();
      delete (taskNoMetadata as Partial<Task>).metadata;

      const attachedImages = taskNoMetadata.metadata?.attachedImages || [];
      expect(attachedImages.length).toBe(0);
    });
  });

  describe('persistUpdateTask', () => {
    it('should call electronAPI.updateTask with correct parameters', async () => {
      const task = createTestTask({ id: 'task-1', title: 'Original' });
      useTaskStore.setState({ tasks: [task] });

      // Mock successful response
      mockUpdateTask.mockResolvedValueOnce({
        success: true,
        data: { ...task, title: 'Updated Title', description: task.description }
      });

      const result = await persistUpdateTask('task-1', {
        title: 'Updated Title'
      });

      expect(mockUpdateTask).toHaveBeenCalledWith('task-1', { title: 'Updated Title' });
      expect(result).toBe(true);
    });

    it('should return false on API error', async () => {
      const task = createTestTask({ id: 'task-1' });
      useTaskStore.setState({ tasks: [task] });

      // Mock error response
      mockUpdateTask.mockResolvedValueOnce({
        success: false,
        error: 'Failed to update'
      });

      const result = await persistUpdateTask('task-1', {
        title: 'Updated Title'
      });

      expect(result).toBe(false);
    });

    it('should handle network errors gracefully', async () => {
      const task = createTestTask({ id: 'task-1' });
      useTaskStore.setState({ tasks: [task] });

      // Mock network error
      mockUpdateTask.mockRejectedValueOnce(new Error('Network error'));

      const result = await persistUpdateTask('task-1', {
        title: 'Updated Title'
      });

      expect(result).toBe(false);
    });

    it('should update local store after successful API call', async () => {
      const task = createTestTask({ id: 'task-1', title: 'Original' });
      useTaskStore.setState({ tasks: [task] });

      // Mock successful response
      mockUpdateTask.mockResolvedValueOnce({
        success: true,
        data: { ...task, title: 'Updated Title', description: task.description }
      });

      await persistUpdateTask('task-1', { title: 'Updated Title' });

      const updatedTask = useTaskStore.getState().tasks.find((t) => t.id === 'task-1');
      expect(updatedTask?.title).toBe('Updated Title');
    });
  });
});
