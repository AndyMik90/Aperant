/**
 * Integration tests for ChangelogService task filtering
 * Tests task filtering with all completion states: done, pr_created, and human_review+completed
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Task } from '../../../shared/types';

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return path.join(tmpdir(), 'test-userdata');
      return tmpdir();
    }),
    getAppPath: vi.fn(() => tmpdir()),
    getVersion: vi.fn(() => '0.1.0'),
    isPackaged: false
  }
}));

vi.mock('../../cli-tool-manager', () => ({
  getToolPath: vi.fn((tool: string) => tool),
  getToolInfo: vi.fn(() => ({ found: true, path: '/usr/bin/claude', source: 'mock' }))
}));

vi.mock('../../python-detector', () => ({
  getValidatedPythonPath: vi.fn((p: string) => p)
}));

vi.mock('../../python-env-manager', () => ({
  getConfiguredPythonPath: vi.fn(() => '/usr/bin/python3')
}));

describe('ChangelogService - Task Filtering Integration', () => {
  let testDir: string;
  let projectPath: string;
  let specsDir: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = mkdtempSync(path.join(tmpdir(), 'changelog-test-'));
    projectPath = path.join(testDir, 'test-project');
    specsDir = path.join(projectPath, '.auto-claude', 'specs');

    // Create project structure
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(specsDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('getCompletedTasks', () => {
    it('should include tasks with "done" status', async () => {
      const { ChangelogService } = await import('../changelog-service');
      const service = new ChangelogService();

      const tasks: Task[] = [
        {
          id: 'task-1',
          specId: '001-test-feature',
          projectId: 'project-1',
          title: 'Test Feature',
          description: 'A test feature',
          status: 'done',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        }
      ];

      // Create spec directory
      const specDir = path.join(specsDir, '001-test-feature');
      mkdirSync(specDir, { recursive: true });
      writeFileSync(path.join(specDir, 'spec.md'), '# Test Feature');

      const completed = service.getCompletedTasks(projectPath, tasks);

      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe('task-1');
      expect(completed[0].title).toBe('Test Feature');
    });

    it('should include tasks with "pr_created" status', async () => {
      const { ChangelogService } = await import('../changelog-service');
      const service = new ChangelogService();

      const tasks: Task[] = [
        {
          id: 'task-2',
          specId: '002-pr-feature',
          projectId: 'project-1',
          title: 'PR Feature',
          description: 'A feature with PR created',
          status: 'pr_created',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        }
      ];

      // Create spec directory
      const specDir = path.join(specsDir, '002-pr-feature');
      mkdirSync(specDir, { recursive: true });
      writeFileSync(path.join(specDir, 'spec.md'), '# PR Feature');

      const completed = service.getCompletedTasks(projectPath, tasks);

      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe('task-2');
      expect(completed[0].title).toBe('PR Feature');
    });

    it('should include tasks with "human_review" status and reviewReason "completed"', async () => {
      const { ChangelogService } = await import('../changelog-service');
      const service = new ChangelogService();

      const tasks: Task[] = [
        {
          id: 'task-3',
          specId: '003-qa-passed',
          projectId: 'project-1',
          title: 'QA Passed Feature',
          description: 'A feature that passed QA',
          status: 'human_review',
          reviewReason: 'completed',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        }
      ];

      // Create spec directory
      const specDir = path.join(specsDir, '003-qa-passed');
      mkdirSync(specDir, { recursive: true });
      writeFileSync(path.join(specDir, 'spec.md'), '# QA Passed Feature');

      const completed = service.getCompletedTasks(projectPath, tasks);

      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe('task-3');
      expect(completed[0].title).toBe('QA Passed Feature');
    });

    it('should exclude tasks with "human_review" status and reviewReason "errors"', async () => {
      const { ChangelogService } = await import('../changelog-service');
      const service = new ChangelogService();

      const tasks: Task[] = [
        {
          id: 'task-4',
          specId: '004-failed-feature',
          projectId: 'project-1',
          title: 'Failed Feature',
          description: 'A feature with errors',
          status: 'human_review',
          reviewReason: 'errors',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        }
      ];

      // Create spec directory (still needed for consistency)
      const specDir = path.join(specsDir, '004-failed-feature');
      mkdirSync(specDir, { recursive: true });
      writeFileSync(path.join(specDir, 'spec.md'), '# Failed Feature');

      const completed = service.getCompletedTasks(projectPath, tasks);

      expect(completed).toHaveLength(0);
    });

    it('should exclude tasks with "human_review" status and reviewReason "qa_rejected"', async () => {
      const { ChangelogService } = await import('../changelog-service');
      const service = new ChangelogService();

      const tasks: Task[] = [
        {
          id: 'task-5',
          specId: '005-rejected-feature',
          projectId: 'project-1',
          title: 'QA Rejected Feature',
          description: 'A feature rejected by QA',
          status: 'human_review',
          reviewReason: 'qa_rejected',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        }
      ];

      const completed = service.getCompletedTasks(projectPath, tasks);

      expect(completed).toHaveLength(0);
    });

    it('should exclude tasks with "human_review" status and reviewReason "plan_review"', async () => {
      const { ChangelogService } = await import('../changelog-service');
      const service = new ChangelogService();

      const tasks: Task[] = [
        {
          id: 'task-6',
          specId: '006-plan-review',
          projectId: 'project-1',
          title: 'Plan Review Feature',
          description: 'A feature in plan review',
          status: 'human_review',
          reviewReason: 'plan_review',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        }
      ];

      const completed = service.getCompletedTasks(projectPath, tasks);

      expect(completed).toHaveLength(0);
    });

    it('should include all valid completion states in a single call', async () => {
      const { ChangelogService } = await import('../changelog-service');
      const service = new ChangelogService();

      const tasks: Task[] = [
        {
          id: 'task-done',
          specId: '001-done',
          projectId: 'project-1',
          title: 'Done Task',
          description: 'Task with done status',
          status: 'done',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        },
        {
          id: 'task-pr',
          specId: '002-pr',
          projectId: 'project-1',
          title: 'PR Task',
          description: 'Task with PR created',
          status: 'pr_created',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-03')
        },
        {
          id: 'task-qa',
          specId: '003-qa',
          projectId: 'project-1',
          title: 'QA Passed Task',
          description: 'Task that passed QA',
          status: 'human_review',
          reviewReason: 'completed',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-04')
        },
        {
          id: 'task-in-progress',
          specId: '004-wip',
          projectId: 'project-1',
          title: 'In Progress Task',
          description: 'Task still in progress',
          status: 'in_progress',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-05')
        },
        {
          id: 'task-errors',
          specId: '005-errors',
          projectId: 'project-1',
          title: 'Error Task',
          description: 'Task with errors',
          status: 'human_review',
          reviewReason: 'errors',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-06')
        }
      ];

      // Create spec directories for completed tasks
      for (const specId of ['001-done', '002-pr', '003-qa']) {
        const specDir = path.join(specsDir, specId);
        mkdirSync(specDir, { recursive: true });
        writeFileSync(path.join(specDir, 'spec.md'), `# ${specId}`);
      }

      const completed = service.getCompletedTasks(projectPath, tasks);

      // Should include: done, pr_created, and human_review+completed
      expect(completed).toHaveLength(3);

      const completedIds = completed.map(t => t.id);
      expect(completedIds).toContain('task-done');
      expect(completedIds).toContain('task-pr');
      expect(completedIds).toContain('task-qa');
      expect(completedIds).not.toContain('task-in-progress');
      expect(completedIds).not.toContain('task-errors');
    });

    it('should exclude archived tasks even if status is completed', async () => {
      const { ChangelogService } = await import('../changelog-service');
      const service = new ChangelogService();

      const tasks: Task[] = [
        {
          id: 'task-archived',
          specId: '001-archived',
          projectId: 'project-1',
          title: 'Archived Task',
          description: 'An archived task',
          status: 'done',
          subtasks: [],
          logs: [],
          metadata: {
            archivedAt: '2024-01-05T00:00:00.000Z'
          },
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        }
      ];

      const completed = service.getCompletedTasks(projectPath, tasks);

      expect(completed).toHaveLength(0);
    });

    it('should sort completed tasks by updatedAt descending', async () => {
      const { ChangelogService } = await import('../changelog-service');
      const service = new ChangelogService();

      const tasks: Task[] = [
        {
          id: 'task-1',
          specId: '001-first',
          projectId: 'project-1',
          title: 'First Task',
          description: 'Oldest update',
          status: 'done',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01')
        },
        {
          id: 'task-2',
          specId: '002-second',
          projectId: 'project-1',
          title: 'Second Task',
          description: 'Newest update',
          status: 'pr_created',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-03')
        },
        {
          id: 'task-3',
          specId: '003-third',
          projectId: 'project-1',
          title: 'Third Task',
          description: 'Middle update',
          status: 'human_review',
          reviewReason: 'completed',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        }
      ];

      // Create spec directories
      for (const specId of ['001-first', '002-second', '003-third']) {
        const specDir = path.join(specsDir, specId);
        mkdirSync(specDir, { recursive: true });
        writeFileSync(path.join(specDir, 'spec.md'), `# ${specId}`);
      }

      const completed = service.getCompletedTasks(projectPath, tasks);

      expect(completed).toHaveLength(3);
      // Should be sorted by updatedAt descending (newest first)
      expect(completed[0].id).toBe('task-2'); // 2024-01-03
      expect(completed[1].id).toBe('task-3'); // 2024-01-02
      expect(completed[2].id).toBe('task-1'); // 2024-01-01
    });

    it('should mark tasks as having specs when spec.md exists', async () => {
      const { ChangelogService } = await import('../changelog-service');
      const service = new ChangelogService();

      const tasks: Task[] = [
        {
          id: 'task-with-spec',
          specId: '001-with-spec',
          projectId: 'project-1',
          title: 'Task With Spec',
          description: 'Has spec file',
          status: 'done',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        },
        {
          id: 'task-no-spec',
          specId: '002-no-spec',
          projectId: 'project-1',
          title: 'Task Without Spec',
          description: 'No spec file',
          status: 'done',
          subtasks: [],
          logs: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02')
        }
      ];

      // Only create spec directory for first task
      const specDir = path.join(specsDir, '001-with-spec');
      mkdirSync(specDir, { recursive: true });
      writeFileSync(path.join(specDir, 'spec.md'), '# Task With Spec');

      const completed = service.getCompletedTasks(projectPath, tasks);

      expect(completed).toHaveLength(2);

      const withSpec = completed.find(t => t.id === 'task-with-spec');
      const noSpec = completed.find(t => t.id === 'task-no-spec');

      expect(withSpec?.hasSpecs).toBe(true);
      expect(noSpec?.hasSpecs).toBe(false);
    });
  });
});
