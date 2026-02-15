import { describe, expect, it } from 'vitest';
import { isCompletedTask } from '../task-status';
import type { TaskStatus, ReviewReason } from '../../types';

describe('isCompletedTask', () => {
  describe('completed statuses', () => {
    it('should return true for "done" status', () => {
      expect(isCompletedTask('done')).toBe(true);
    });

    it('should return true for "pr_created" status', () => {
      expect(isCompletedTask('pr_created')).toBe(true);
    });

    it('should return true for "human_review" with reviewReason "completed"', () => {
      // Tasks that passed QA and are awaiting final merge approval are considered completed
      expect(isCompletedTask('human_review', 'completed')).toBe(true);
    });
  });

  describe('non-completed statuses', () => {
    it('should return false for "backlog" status', () => {
      expect(isCompletedTask('backlog')).toBe(false);
    });

    it('should return false for "queue" status', () => {
      expect(isCompletedTask('queue')).toBe(false);
    });

    it('should return false for "in_progress" status', () => {
      expect(isCompletedTask('in_progress')).toBe(false);
    });

    it('should return false for "ai_review" status', () => {
      expect(isCompletedTask('ai_review')).toBe(false);
    });

    it('should return false for "human_review" status', () => {
      expect(isCompletedTask('human_review')).toBe(false);
    });

    it('should return false for "error" status', () => {
      expect(isCompletedTask('error')).toBe(false);
    });
  });

  describe('human_review edge cases', () => {
    it('should return false for human_review without reviewReason', () => {
      // human_review without a specific reviewReason is not completed
      expect(isCompletedTask('human_review')).toBe(false);
    });

    it('should return true for human_review with reviewReason "completed"', () => {
      // human_review with ReviewReason 'completed' means QA passed and ready for merge
      expect(isCompletedTask('human_review', 'completed')).toBe(true);
    });

    it('should return false for human_review with reviewReason "errors"', () => {
      // human_review with ReviewReason 'errors' is not completed
      expect(isCompletedTask('human_review', 'errors')).toBe(false);
    });

    it('should return false for human_review with reviewReason "qa_rejected"', () => {
      // human_review with ReviewReason 'qa_rejected' is not completed
      expect(isCompletedTask('human_review', 'qa_rejected')).toBe(false);
    });

    it('should return false for human_review with reviewReason "plan_review"', () => {
      // human_review with ReviewReason 'plan_review' is not completed
      expect(isCompletedTask('human_review', 'plan_review')).toBe(false);
    });

    it('should return false for human_review with reviewReason "stopped"', () => {
      // human_review with ReviewReason 'stopped' is not completed
      expect(isCompletedTask('human_review', 'stopped')).toBe(false);
    });
  });

  describe('archived task considerations', () => {
    it('should return true for archived tasks with "done" status', () => {
      // Archived tasks with 'done' status are still considered completed
      // (archivedAt is metadata, not status)
      expect(isCompletedTask('done')).toBe(true);
    });

    it('should return true for archived tasks with "pr_created" status', () => {
      // Archived tasks with 'pr_created' status are still considered completed
      expect(isCompletedTask('pr_created')).toBe(true);
    });

    it('should return false for archived tasks with other statuses', () => {
      // Archived tasks that weren't completed before archiving
      expect(isCompletedTask('backlog')).toBe(false);
      expect(isCompletedTask('error')).toBe(false);
      expect(isCompletedTask('human_review')).toBe(false);
    });
  });

  describe('type safety', () => {
    it('should work with explicit TaskStatus type annotation', () => {
      const status: TaskStatus = 'done';
      expect(isCompletedTask(status)).toBe(true);
    });

    it('should correctly handle all valid TaskStatus values', () => {
      const allStatuses: TaskStatus[] = [
        'backlog',
        'queue',
        'in_progress',
        'ai_review',
        'human_review',
        'done',
        'pr_created',
        'error',
      ];

      const completedStatuses = allStatuses.filter((status) => isCompletedTask(status));
      expect(completedStatuses).toEqual(['done', 'pr_created']);
    });
  });

  describe('real-world scenarios', () => {
    it('should identify tasks ready for changelog inclusion', () => {
      // Tasks in 'done', 'pr_created', or 'human_review' with 'completed' reason are included in changelogs
      expect(isCompletedTask('done')).toBe(true);
      expect(isCompletedTask('pr_created')).toBe(true);
      expect(isCompletedTask('human_review', 'completed')).toBe(true);
    });

    it('should exclude tasks still in progress from completed count', () => {
      // Tasks not yet completed should not be counted
      expect(isCompletedTask('in_progress')).toBe(false);
      expect(isCompletedTask('ai_review')).toBe(false);
    });

    it('should exclude tasks waiting for human review (without completion)', () => {
      // Tasks in human_review with errors or other non-completed reasons are not completed
      expect(isCompletedTask('human_review')).toBe(false);
      expect(isCompletedTask('human_review', 'errors')).toBe(false);
      expect(isCompletedTask('human_review', 'qa_rejected')).toBe(false);
      expect(isCompletedTask('human_review', 'plan_review')).toBe(false);
    });

    it('should exclude tasks in error state', () => {
      // Tasks that encountered errors are not completed
      expect(isCompletedTask('error')).toBe(false);
    });

    it('should exclude tasks in backlog or queue', () => {
      // Tasks not yet started are not completed
      expect(isCompletedTask('backlog')).toBe(false);
      expect(isCompletedTask('queue')).toBe(false);
    });
  });

  describe('boundary conditions', () => {
    it('should handle status in conditional expressions', () => {
      const statuses: TaskStatus[] = ['done', 'in_progress', 'pr_created'];
      const completed = statuses.filter((s) => isCompletedTask(s));
      expect(completed).toHaveLength(2);
      expect(completed).toContain('done');
      expect(completed).toContain('pr_created');
      expect(completed).not.toContain('in_progress');
    });

    it('should work in array methods with task objects', () => {
      const tasks = [
        { id: '1', status: 'done' as TaskStatus },
        { id: '2', status: 'in_progress' as TaskStatus },
        { id: '3', status: 'pr_created' as TaskStatus },
        { id: '4', status: 'error' as TaskStatus },
        { id: '5', status: 'human_review' as TaskStatus, reviewReason: 'completed' as ReviewReason },
        { id: '6', status: 'human_review' as TaskStatus, reviewReason: 'errors' as ReviewReason },
      ];

      const completedTasks = tasks.filter((task) => isCompletedTask(task.status, task.reviewReason));
      expect(completedTasks).toHaveLength(3);
      expect(completedTasks.map((t) => t.id)).toEqual(['1', '3', '5']);
    });

    it('should be usable in reduce operations', () => {
      const tasks = [
        { status: 'done' as TaskStatus },
        { status: 'in_progress' as TaskStatus },
        { status: 'pr_created' as TaskStatus },
        { status: 'backlog' as TaskStatus },
        { status: 'done' as TaskStatus },
        { status: 'human_review' as TaskStatus, reviewReason: 'completed' as ReviewReason },
      ];

      const completedCount = tasks.reduce(
        (count, task) => (isCompletedTask(task.status, task.reviewReason) ? count + 1 : count),
        0,
      );

      expect(completedCount).toBe(4);
    });
  });
});
