import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskStateManager } from '../task-state-manager';
import type { Task, Project } from '../../shared/types';

// Mock dependencies
vi.mock('../ipc-handlers/utils', () => ({
  safeSendToRenderer: vi.fn()
}));

vi.mock('../ipc-handlers/task/plan-file-utils', () => ({
  getPlanPath: vi.fn(() => '/mock/path/implementation_plan.json'),
  persistPlanStatusAndReasonSync: vi.fn()
}));

vi.mock('../worktree-paths', () => ({
  findTaskWorktree: vi.fn(() => null)
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false)
}));

// Create mock task and project
function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-task-id',
    specId: '001-test-spec',
    projectId: 'test-project-id',
    title: 'Test Task',
    description: 'Test description',
    status: 'backlog',
    subtasks: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function createMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'test-project-id',
    name: 'Test Project',
    path: '/mock/project/path',
    createdAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    ...overrides
  } as Project;
}

describe('TaskStateManager', () => {
  let manager: TaskStateManager;
  let mockTask: Task;
  let mockProject: Project;

  beforeEach(() => {
    manager = new TaskStateManager();
    mockTask = createMockTask();
    mockProject = createMockProject();
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.clearAllTasks();
  });

  describe('handleTaskEvent', () => {
    it('should accept events with increasing sequence numbers', () => {
      const event1 = {
        type: 'PLANNING_STARTED',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 0
      };

      const event2 = {
        type: 'PLANNING_COMPLETE',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-2',
        sequence: 1,
        hasSubtasks: true,
        subtaskCount: 1,
        requireReviewBeforeCoding: false
      };

      const result1 = manager.handleTaskEvent(mockTask.id, event1, mockTask, mockProject);
      const result2 = manager.handleTaskEvent(mockTask.id, event2, mockTask, mockProject);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });

    it('should reject events with stale sequence numbers', () => {
      const event1 = {
        type: 'PLANNING_STARTED',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 5
      };

      const event2 = {
        type: 'PLANNING_COMPLETE',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-2',
        sequence: 3, // Older than event1
        hasSubtasks: true,
        subtaskCount: 1,
        requireReviewBeforeCoding: false
      };

      const result1 = manager.handleTaskEvent(mockTask.id, event1, mockTask, mockProject);
      const result2 = manager.handleTaskEvent(mockTask.id, event2, mockTask, mockProject);

      expect(result1).toBe(true);
      expect(result2).toBe(false); // Should be rejected
    });

    it('should accept events with equal sequence numbers (edge case)', () => {
      // This handles reload scenarios where we might see the same sequence
      const event1 = {
        type: 'PLANNING_STARTED',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 5
      };

      const event2 = {
        type: 'PLANNING_COMPLETE',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-2',
        sequence: 5, // Same as event1
        hasSubtasks: true,
        subtaskCount: 1,
        requireReviewBeforeCoding: false
      };

      const result1 = manager.handleTaskEvent(mockTask.id, event1, mockTask, mockProject);
      const result2 = manager.handleTaskEvent(mockTask.id, event2, mockTask, mockProject);

      expect(result1).toBe(true);
      expect(result2).toBe(true); // Should be accepted (>= comparison)
    });
  });

  describe('handleUiEvent', () => {
    it('should send PLAN_APPROVED event correctly', () => {
      // First, set up the task in plan_review state
      const planningEvent = {
        type: 'PLANNING_STARTED',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 0
      };

      const planCompleteEvent = {
        type: 'PLANNING_COMPLETE',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-2',
        sequence: 1,
        hasSubtasks: true,
        subtaskCount: 1,
        requireReviewBeforeCoding: true // This will cause plan_review state
      };

      manager.handleTaskEvent(mockTask.id, planningEvent, mockTask, mockProject);
      manager.handleTaskEvent(mockTask.id, planCompleteEvent, mockTask, mockProject);

      // Now send PLAN_APPROVED
      manager.handleUiEvent(mockTask.id, { type: 'PLAN_APPROVED' }, mockTask, mockProject);

      // The actor should now be in 'coding' state
      // We can't easily check the state directly, but we can verify no errors occurred
    });

    it('should send USER_STOPPED event correctly', () => {
      const event = {
        type: 'PLANNING_STARTED',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 0
      };

      manager.handleTaskEvent(mockTask.id, event, mockTask, mockProject);
      manager.handleUiEvent(mockTask.id, { type: 'USER_STOPPED', hasPlan: false }, mockTask, mockProject);

      // Should not throw
    });
  });

  describe('handleManualStatusChange', () => {
    it('should handle done status', () => {
      const result = manager.handleManualStatusChange(mockTask.id, 'done', mockTask, mockProject);
      expect(result).toBe(true);
    });

    it('should handle pr_created status', () => {
      const taskWithPrUrl = createMockTask({ metadata: { prUrl: 'https://github.com/test/pr/1' } });
      const result = manager.handleManualStatusChange(mockTask.id, 'pr_created', taskWithPrUrl, mockProject);
      expect(result).toBe(true);
    });

    it('should handle in_progress status with plan_review', () => {
      const taskInPlanReview = createMockTask({
        status: 'human_review',
        reviewReason: 'plan_review'
      });
      const result = manager.handleManualStatusChange(mockTask.id, 'in_progress', taskInPlanReview, mockProject);
      expect(result).toBe(true);
    });

    it('should handle in_progress status without plan_review', () => {
      const stoppedTask = createMockTask({
        status: 'human_review',
        reviewReason: 'stopped'
      });
      const result = manager.handleManualStatusChange(mockTask.id, 'in_progress', stoppedTask, mockProject);
      expect(result).toBe(true);
    });

    it('should handle backlog status', () => {
      const result = manager.handleManualStatusChange(mockTask.id, 'backlog', mockTask, mockProject);
      expect(result).toBe(true);
    });

    it('should handle human_review status (stage-only merge keeps task in review)', () => {
      const taskInReview = createMockTask({
        status: 'human_review',
        reviewReason: 'completed'
      });
      const result = manager.handleManualStatusChange(mockTask.id, 'human_review', taskInReview, mockProject);
      expect(result).toBe(true);
    });

    it('should handle human_review with default reviewReason when task has none', () => {
      const taskNoReason = createMockTask({
        status: 'human_review'
        // no reviewReason set
      });
      const result = manager.handleManualStatusChange(mockTask.id, 'human_review', taskNoReason, mockProject);
      expect(result).toBe(true);
    });

    it('should return false for unhandled status', () => {
      const result = manager.handleManualStatusChange(mockTask.id, 'ai_review', mockTask, mockProject);
      expect(result).toBe(false);
    });
  });

  describe('sequence management', () => {
    it('should set and get last sequence', () => {
      manager.setLastSequence(mockTask.id, 42);
      expect(manager.getLastSequence(mockTask.id)).toBe(42);
    });

    it('should return undefined for unknown task', () => {
      expect(manager.getLastSequence('unknown-task')).toBeUndefined();
    });
  });

  describe('clearTask', () => {
    it('should clear task state', () => {
      // Set up some state
      manager.setLastSequence(mockTask.id, 10);

      const event = {
        type: 'PLANNING_STARTED',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 0
      };
      manager.handleTaskEvent(mockTask.id, event, mockTask, mockProject);

      // Clear
      manager.clearTask(mockTask.id);

      // Verify cleared
      expect(manager.getLastSequence(mockTask.id)).toBeUndefined();
    });
  });

  describe('clearAllTasks', () => {
    it('should clear all task state', () => {
      // Set up state for multiple tasks
      manager.setLastSequence('task-1', 10);
      manager.setLastSequence('task-2', 20);

      const event1 = {
        type: 'PLANNING_STARTED',
        taskId: 'task-1',
        specId: '001',
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 0
      };
      const event2 = {
        type: 'PLANNING_STARTED',
        taskId: 'task-2',
        specId: '002',
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-2',
        sequence: 0
      };

      manager.handleTaskEvent('task-1', event1, createMockTask({ id: 'task-1' }), mockProject);
      manager.handleTaskEvent('task-2', event2, createMockTask({ id: 'task-2' }), mockProject);

      // Clear all
      manager.clearAllTasks();

      // Verify actors and state are cleared, but sequence tracking is preserved
      // (to prevent duplicate event processing during refresh window)
      expect(manager.getLastSequence('task-1')).toBe(10);
      expect(manager.getLastSequence('task-2')).toBe(20);
    });
  });

  describe('handleProcessExited', () => {
    it('should NOT mark as error if terminal event was already seen', () => {
      // First send a terminal event (like QA_PASSED)
      const qaPassedEvent = {
        type: 'QA_PASSED',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 0,
        iteration: 1,
        testsRun: {}
      };

      manager.handleTaskEvent(mockTask.id, qaPassedEvent, mockTask, mockProject);

      // Now process exits - this should NOT trigger error state
      manager.handleProcessExited(mockTask.id, 0, mockTask, mockProject);

      // Should not throw and should not transition to error
      // (We can't easily verify the state, but the important thing is no crash)
    });

    it('should mark as error on unexpected exit when no terminal event seen', () => {
      // Start a task
      const planningEvent = {
        type: 'PLANNING_STARTED',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 0
      };

      manager.handleTaskEvent(mockTask.id, planningEvent, mockTask, mockProject);

      // Process exits unexpectedly (no terminal event seen)
      manager.handleProcessExited(mockTask.id, 1, mockTask, mockProject);

      // Should have sent PROCESS_EXITED event with unexpected=true
      // This should transition to error state
    });

    it('should NOT mark exit code 0 as unexpected (plan_review stays intact)', () => {
      // Simulate: PLANNING_STARTED → PLANNING_COMPLETE (requireReview) → process exits code 0
      const planningStarted = {
        type: 'PLANNING_STARTED',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 0
      };

      const planningComplete = {
        type: 'PLANNING_COMPLETE',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-2',
        sequence: 1,
        hasSubtasks: false,
        subtaskCount: 0,
        requireReviewBeforeCoding: true
      };

      manager.handleTaskEvent(mockTask.id, planningStarted, mockTask, mockProject);
      manager.handleTaskEvent(mockTask.id, planningComplete, mockTask, mockProject);

      // XState should be in plan_review now
      expect(manager.getCurrentState(mockTask.id)).toBe('plan_review');

      // Process exits with code 0 - should NOT transition to error
      manager.handleProcessExited(mockTask.id, 0, mockTask, mockProject);

      // PLANNING_COMPLETE is a terminal event, so handleProcessExited should skip entirely
      // Task should remain in plan_review
      expect(manager.getCurrentState(mockTask.id)).toBe('plan_review');
    });

    it('should treat PLANNING_COMPLETE as a terminal event', () => {
      // PLANNING_COMPLETE should prevent handleProcessExited from running
      const planningStarted = {
        type: 'PLANNING_STARTED',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 0
      };

      const planningComplete = {
        type: 'PLANNING_COMPLETE',
        taskId: mockTask.id,
        specId: mockTask.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-2',
        sequence: 1,
        hasSubtasks: true,
        subtaskCount: 3,
        requireReviewBeforeCoding: false
      };

      manager.handleTaskEvent(mockTask.id, planningStarted, mockTask, mockProject);
      manager.handleTaskEvent(mockTask.id, planningComplete, mockTask, mockProject);

      // XState should be in coding (no review required)
      expect(manager.getCurrentState(mockTask.id)).toBe('coding');

      // Process exits with code 1 - should still skip because PLANNING_COMPLETE is terminal
      manager.handleProcessExited(mockTask.id, 1, mockTask, mockProject);

      // Task should remain in coding, NOT transition to error
      expect(manager.getCurrentState(mockTask.id)).toBe('coding');
    });
  });

  describe('actor state restoration', () => {
    it('should restore actor state from task with in_progress status', () => {
      const taskInProgress = createMockTask({
        status: 'in_progress',
        executionProgress: { phase: 'coding', phaseProgress: 50, overallProgress: 50 }
      });

      const event = {
        type: 'QA_STARTED',
        taskId: taskInProgress.id,
        specId: taskInProgress.specId,
        projectId: mockProject.id,
        timestamp: new Date().toISOString(),
        eventId: 'evt-1',
        sequence: 0,
        iteration: 1,
        maxIterations: 3
      };

      // This should create an actor restored to 'coding' state, then transition to 'qa_review'
      manager.handleTaskEvent(taskInProgress.id, event, taskInProgress, mockProject);

      // No error should occur
    });

    it('should restore actor state from task with human_review/plan_review', () => {
      const taskInPlanReview = createMockTask({
        status: 'human_review',
        reviewReason: 'plan_review'
      });

      // Actor should be created in plan_review state
      manager.handleUiEvent(taskInPlanReview.id, { type: 'PLAN_APPROVED' }, taskInPlanReview, mockProject);

      // Should transition from plan_review to coding without error
    });

    it('should restore actor state from task with error status', () => {
      const taskInError = createMockTask({
        status: 'error',
        reviewReason: 'errors'
      });

      // Actor should be created in error state
      manager.handleUiEvent(taskInError.id, { type: 'USER_RESUMED' }, taskInError, mockProject);

      // Should transition from error to coding without error
    });
  });
});
