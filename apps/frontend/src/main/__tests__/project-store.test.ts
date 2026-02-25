/**
 * Unit tests for Project Store
 * Tests project CRUD operations and task reading from filesystem
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Test directories - will be set in beforeEach with unique temp dir
let TEST_DIR: string;
let USER_DATA_PATH: string;
let TEST_PROJECT_PATH: string;

// Mock Electron before importing the store
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return USER_DATA_PATH;
      return TEST_DIR;
    })
  }
}));

// Setup test directories with unique secure temp dir
function setupTestDirs(): void {
  // Create a unique, secure temporary directory
  TEST_DIR = mkdtempSync(path.join(tmpdir(), 'project-store-test-'));
  USER_DATA_PATH = path.join(TEST_DIR, 'userData');
  TEST_PROJECT_PATH = path.join(TEST_DIR, 'test-project');

  mkdirSync(USER_DATA_PATH, { recursive: true });
  mkdirSync(path.join(USER_DATA_PATH, 'store'), { recursive: true });
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });
}

// Cleanup test directories
function cleanupTestDirs(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('ProjectStore', () => {
  beforeEach(async () => {
    cleanupTestDirs();
    setupTestDirs();
    vi.resetModules();
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
  });

  describe('addProject', () => {
    it('should create a new project with correct structure', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);

      expect(project).toHaveProperty('id');
      expect(project.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(project.path).toBe(TEST_PROJECT_PATH);
      expect(project.name).toBe('test-project'); // Derived from path
      expect(project.settings).toBeDefined();
      expect(project.createdAt).toBeInstanceOf(Date);
      expect(project.updatedAt).toBeInstanceOf(Date);
    });

    it('should use provided name if given', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH, 'Custom Name');

      expect(project.name).toBe('Custom Name');
    });

    it('should return existing project if already added', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project1 = store.addProject(TEST_PROJECT_PATH);
      const project2 = store.addProject(TEST_PROJECT_PATH);

      expect(project1.id).toBe(project2.id);
    });

    it('should detect auto-claude directory if present', async () => {
      // Create .auto-claude directory (the data directory, not source code)
      mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-claude'), { recursive: true });

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);

      expect(project.autoBuildPath).toBe('.auto-claude');
    });

    it('should set empty autoBuildPath if not present', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);

      expect(project.autoBuildPath).toBe('');
    });

    it('should persist project to disk', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      store.addProject(TEST_PROJECT_PATH);

      // Check file exists
      const storePath = path.join(USER_DATA_PATH, 'store', 'projects.json');
      expect(existsSync(storePath)).toBe(true);

      // Check content
      const content = JSON.parse(readFileSync(storePath, 'utf-8'));
      expect(content.projects).toHaveLength(1);
      expect(content.projects[0].path).toBe(TEST_PROJECT_PATH);
    });
  });

  describe('removeProject', () => {
    it('should return false for non-existent project', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const result = store.removeProject('nonexistent-id');

      expect(result).toBe(false);
    });

    it('should remove existing project and return true', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const result = store.removeProject(project.id);

      expect(result).toBe(true);
      expect(store.getProjects()).toHaveLength(0);
    });

    it('should persist removal to disk', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      store.removeProject(project.id);

      // Check file content
      const storePath = path.join(USER_DATA_PATH, 'store', 'projects.json');
      const content = JSON.parse(readFileSync(storePath, 'utf-8'));
      expect(content.projects).toHaveLength(0);
    });
  });

  describe('getProjects', () => {
    it('should return empty array when no projects', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const projects = store.getProjects();

      expect(projects).toEqual([]);
    });

    it('should return all projects', async () => {
      const project2Path = path.join(TEST_DIR, 'test-project-2');
      mkdirSync(project2Path, { recursive: true });

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      store.addProject(TEST_PROJECT_PATH);
      store.addProject(project2Path);

      const projects = store.getProjects();

      expect(projects).toHaveLength(2);
    });
  });

  describe('getProject', () => {
    it('should return undefined for non-existent project', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.getProject('nonexistent-id');

      expect(project).toBeUndefined();
    });

    it('should return project by ID', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const added = store.addProject(TEST_PROJECT_PATH);
      const retrieved = store.getProject(added.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(added.id);
    });
  });

  describe('updateProjectSettings', () => {
    it('should return undefined for non-existent project', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const result = store.updateProjectSettings('nonexistent-id', { model: 'sonnet' });

      expect(result).toBeUndefined();
    });

    it('should update settings and return updated project', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const updated = store.updateProjectSettings(project.id, {
        model: 'sonnet',
        linearSync: true
      });

      expect(updated).toBeDefined();
      expect(updated?.settings.model).toBe('sonnet');
      expect(updated?.settings.linearSync).toBe(true);
    });

    it('should update updatedAt timestamp', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const originalUpdatedAt = project.updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = store.updateProjectSettings(project.id, { model: 'haiku' });

      expect(updated?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    it('should persist settings changes', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      store.updateProjectSettings(project.id, { model: 'sonnet' });

      // Read directly from file
      const storePath = path.join(USER_DATA_PATH, 'store', 'projects.json');
      const content = JSON.parse(readFileSync(storePath, 'utf-8'));
      expect(content.projects[0].settings.model).toBe('sonnet');
    });
  });

  describe('getTasks', () => {
    it('should return empty array for non-existent project', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const tasks = store.getTasks('nonexistent-id');

      expect(tasks).toEqual([]);
    });

    it('should return empty array if specs directory does not exist', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      expect(tasks).toEqual([]);
    });

    it('should read tasks from filesystem correctly', async () => {
      // Create spec directory structure in .auto-claude (the data directory)
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '001-test-feature');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Test Feature',
        workflow_type: 'feature',
        services_involved: [],
        status: 'in_progress',
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'First subtask', status: 'completed' },
              { id: 'subtask-2', description: 'Second subtask', status: 'pending' }
            ]
          }
        ],
        final_acceptance: ['Test passes'],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        spec_file: 'spec.md'
      };

      writeFileSync(
        path.join(specsDir, 'implementation_plan.json'),
        JSON.stringify(plan)
      );

      const specContent = `# Test Feature\n\n## Overview\n\nThis is a test feature description.\n`;
      writeFileSync(path.join(specsDir, 'spec.md'), specContent);

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Test Feature');
      expect(tasks[0].specId).toBe('001-test-feature');
      expect(tasks[0].subtasks).toHaveLength(2);
      expect(tasks[0].status).toBe('in_progress'); // Some completed, some pending
    });

    it('should determine status as backlog when no subtasks completed', async () => {
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '002-pending');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Pending Feature',
        workflow_type: 'feature',
        services_involved: [],
        status: 'backlog',
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'pending' },
              { id: 'subtask-2', description: 'Subtask 2', status: 'pending' }
            ]
          }
        ],
        final_acceptance: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };

      writeFileSync(
        path.join(specsDir, 'implementation_plan.json'),
        JSON.stringify(plan)
      );

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      expect(tasks[0].status).toBe('backlog');
    });

    it('should determine status as ai_review when all subtasks completed', async () => {
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '003-complete');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Complete Feature',
        workflow_type: 'feature',
        services_involved: [],
        status: 'ai_review',
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'completed' },
              { id: 'subtask-2', description: 'Subtask 2', status: 'completed' }
            ]
          }
        ],
        final_acceptance: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };

      writeFileSync(
        path.join(specsDir, 'implementation_plan.json'),
        JSON.stringify(plan)
      );

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      expect(tasks[0].status).toBe('ai_review');
    });

    it('should determine status as human_review when plan status is human_review', async () => {
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '004-rejected');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Rejected Feature',
        workflow_type: 'feature',
        services_involved: [],
        status: 'human_review',
        reviewReason: 'qa_rejected',
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'completed' }
            ]
          }
        ],
        final_acceptance: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };

      writeFileSync(
        path.join(specsDir, 'implementation_plan.json'),
        JSON.stringify(plan)
      );

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      expect(tasks[0].status).toBe('human_review');
    });

    it('should determine reviewReason from plan when status is human_review', async () => {
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '005-approved');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Approved Feature',
        workflow_type: 'feature',
        services_involved: [],
        status: 'human_review',
        reviewReason: 'completed',
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'completed' }
            ]
          }
        ],
        final_acceptance: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };

      writeFileSync(
        path.join(specsDir, 'implementation_plan.json'),
        JSON.stringify(plan)
      );

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      expect(tasks[0].status).toBe('human_review');
      expect(tasks[0].reviewReason).toBe('completed');
    });

    it('should determine status as done when plan status is explicitly done', async () => {
      // User explicitly marking task as done via drag-and-drop sets status to done
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '006-done');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Done Feature',
        workflow_type: 'feature',
        services_involved: [],
        status: 'done', // Explicitly set by user
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'completed' }
            ]
          }
        ],
        final_acceptance: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };

      writeFileSync(
        path.join(specsDir, 'implementation_plan.json'),
        JSON.stringify(plan)
      );

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      expect(tasks[0].status).toBe('done');
    });
  });

  describe('persistence', () => {
    it('should load existing data on construction', async () => {
      // Create store file manually
      const storePath = path.join(USER_DATA_PATH, 'store', 'projects.json');
      writeFileSync(storePath, JSON.stringify({
        projects: [
          {
            id: 'test-id-123',
            name: 'Preexisting Project',
            path: '/test/path',
            autoBuildPath: '',
            settings: {
              model: 'sonnet',
              memoryBackend: 'file',
              linearSync: false,
              notifications: {
                onTaskComplete: true,
                onTaskFailed: true,
                onReviewNeeded: true,
                sound: false
              },
              graphitiMcpEnabled: true,
              graphitiMcpUrl: 'http://localhost:8000/mcp/'
            },
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z'
          }
        ],
        settings: {}
      }));

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const projects = store.getProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('test-id-123');
      expect(projects[0].createdAt).toBeInstanceOf(Date);
    });

    it('should handle corrupted store file gracefully', async () => {
      // Create corrupted store file
      const storePath = path.join(USER_DATA_PATH, 'store', 'projects.json');
      writeFileSync(storePath, 'not valid json {{{');

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const projects = store.getProjects();

      expect(projects).toEqual([]);
    });
  });

  describe('archiveTasks - multi-location handling', () => {
    it('should archive task from main specs directory only', async () => {
      // Create spec directory in main location only
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '001-test-task');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Test Feature',
        workflow_type: 'feature',
        services_involved: [],
        phases: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };
      writeFileSync(path.join(specsDir, 'implementation_plan.json'), JSON.stringify(plan));

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const result = store.archiveTasks(project.id, ['001-test-task'], '1.0.0');

      expect(result).toBe(true);

      // Verify metadata was created with archive info
      const metadataPath = path.join(specsDir, 'task_metadata.json');
      expect(existsSync(metadataPath)).toBe(true);

      const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      expect(metadata.archivedAt).toBeDefined();
      expect(metadata.archivedInVersion).toBe('1.0.0');
    });

    it('should archive task from BOTH main and worktree locations', async () => {
      // Create spec directory in main location
      const mainSpecsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '002-multi-location');
      mkdirSync(mainSpecsDir, { recursive: true });

      // Create spec directory in worktree location
      // Worktree path: .auto-claude/worktrees/tasks/<worktreeName>/.auto-claude/specs/<taskId>
      const worktreeDir = path.join(
        TEST_PROJECT_PATH,
        '.auto-claude',
        'worktrees',
        'tasks',
        'my-worktree',
        '.auto-claude',
        'specs',
        '002-multi-location'
      );
      mkdirSync(worktreeDir, { recursive: true });

      const plan = {
        feature: 'Multi-Location Feature',
        workflow_type: 'feature',
        services_involved: [],
        phases: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };

      writeFileSync(path.join(mainSpecsDir, 'implementation_plan.json'), JSON.stringify(plan));
      writeFileSync(path.join(worktreeDir, 'implementation_plan.json'), JSON.stringify(plan));

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const result = store.archiveTasks(project.id, ['002-multi-location'], '2.0.0');

      expect(result).toBe(true);

      // Verify metadata was created in BOTH locations
      const mainMetadataPath = path.join(mainSpecsDir, 'task_metadata.json');
      const worktreeMetadataPath = path.join(worktreeDir, 'task_metadata.json');

      expect(existsSync(mainMetadataPath)).toBe(true);
      expect(existsSync(worktreeMetadataPath)).toBe(true);

      const mainMetadata = JSON.parse(readFileSync(mainMetadataPath, 'utf-8'));
      const worktreeMetadata = JSON.parse(readFileSync(worktreeMetadataPath, 'utf-8'));

      expect(mainMetadata.archivedAt).toBeDefined();
      expect(mainMetadata.archivedInVersion).toBe('2.0.0');
      expect(worktreeMetadata.archivedAt).toBeDefined();
      expect(worktreeMetadata.archivedInVersion).toBe('2.0.0');
    });

    it('should handle task that exists only in worktree', async () => {
      // Create spec directory ONLY in worktree location (not in main)
      const worktreeDir = path.join(
        TEST_PROJECT_PATH,
        '.auto-claude',
        'worktrees',
        'tasks',
        'only-worktree',
        '.auto-claude',
        'specs',
        '003-worktree-only'
      );
      mkdirSync(worktreeDir, { recursive: true });

      const plan = {
        feature: 'Worktree Only Feature',
        workflow_type: 'feature',
        services_involved: [],
        phases: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };
      writeFileSync(path.join(worktreeDir, 'implementation_plan.json'), JSON.stringify(plan));

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const result = store.archiveTasks(project.id, ['003-worktree-only'], '1.0.0');

      expect(result).toBe(true);

      // Verify metadata was created in worktree
      const metadataPath = path.join(worktreeDir, 'task_metadata.json');
      expect(existsSync(metadataPath)).toBe(true);

      const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      expect(metadata.archivedAt).toBeDefined();
    });

    it('should skip non-existent task gracefully', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      // Create .auto-claude directory so project is recognized
      mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-claude'), { recursive: true });

      const project = store.addProject(TEST_PROJECT_PATH);
      // Task doesn't exist anywhere
      const result = store.archiveTasks(project.id, ['nonexistent-task']);

      // Should return true (no errors) since missing tasks are skipped
      expect(result).toBe(true);
    });

    it('should reject path traversal attempts in taskId', async () => {
      // Create a valid spec dir
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', 'valid-task');
      mkdirSync(specsDir, { recursive: true });

      const plan = { feature: 'Test', phases: [] };
      writeFileSync(path.join(specsDir, 'implementation_plan.json'), JSON.stringify(plan));

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);

      // Try various path traversal attacks
      const maliciousIds = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32',
        'task/../../../secret',
        '.',
        '..',
        'task\0.json'
      ];

      for (const maliciousId of maliciousIds) {
        // These should be rejected and not cause any file operations
        const result = store.archiveTasks(project.id, [maliciousId]);
        // Should return true since invalid IDs are skipped, not treated as errors
        expect(result).toBe(true);
      }
    });

    it('should return false for non-existent project', async () => {
      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const result = store.archiveTasks('nonexistent-project-id', ['some-task']);

      expect(result).toBe(false);
    });
  });

  describe('unarchiveTasks - multi-location handling', () => {
    it('should unarchive task from BOTH main and worktree locations', async () => {
      // Create archived task in both locations
      const mainSpecsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '004-unarchive-test');
      mkdirSync(mainSpecsDir, { recursive: true });

      const worktreeDir = path.join(
        TEST_PROJECT_PATH,
        '.auto-claude',
        'worktrees',
        'tasks',
        'unarchive-worktree',
        '.auto-claude',
        'specs',
        '004-unarchive-test'
      );
      mkdirSync(worktreeDir, { recursive: true });

      const plan = {
        feature: 'Unarchive Test',
        phases: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      const archivedMetadata = {
        archivedAt: '2024-06-01T00:00:00Z',
        archivedInVersion: '1.0.0'
      };

      // Create plan and archived metadata in both locations
      writeFileSync(path.join(mainSpecsDir, 'implementation_plan.json'), JSON.stringify(plan));
      writeFileSync(path.join(mainSpecsDir, 'task_metadata.json'), JSON.stringify(archivedMetadata));
      writeFileSync(path.join(worktreeDir, 'implementation_plan.json'), JSON.stringify(plan));
      writeFileSync(path.join(worktreeDir, 'task_metadata.json'), JSON.stringify(archivedMetadata));

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const result = store.unarchiveTasks(project.id, ['004-unarchive-test']);

      expect(result).toBe(true);

      // Verify archivedAt was removed from BOTH locations
      const mainMetadata = JSON.parse(readFileSync(path.join(mainSpecsDir, 'task_metadata.json'), 'utf-8'));
      const worktreeMetadata = JSON.parse(readFileSync(path.join(worktreeDir, 'task_metadata.json'), 'utf-8'));

      expect(mainMetadata.archivedAt).toBeUndefined();
      expect(mainMetadata.archivedInVersion).toBeUndefined();
      expect(worktreeMetadata.archivedAt).toBeUndefined();
      expect(worktreeMetadata.archivedInVersion).toBeUndefined();
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate cache after archiveTasks', async () => {
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '005-cache-test');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Cache Test Feature',
        workflow_type: 'feature',
        services_involved: [],
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [{ id: 'subtask-1', description: 'Test', status: 'pending' }]
          }
        ],
        final_acceptance: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };
      writeFileSync(path.join(specsDir, 'implementation_plan.json'), JSON.stringify(plan));

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);

      // First call should populate cache
      const tasksBefore = store.getTasks(project.id);
      expect(tasksBefore).toHaveLength(1);
      expect(tasksBefore[0].metadata?.archivedAt).toBeUndefined();

      // Archive the task
      store.archiveTasks(project.id, ['005-cache-test']);

      // After archiving, cache should be invalidated and getTasks should return updated data
      const tasksAfter = store.getTasks(project.id);
      expect(tasksAfter[0].metadata?.archivedAt).toBeDefined();
    });

    it('should return fresh data after invalidateTasksCache is called', async () => {
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '006-invalidate-test');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Initial Feature',
        workflow_type: 'feature',
        services_involved: [],
        phases: [],
        final_acceptance: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };
      writeFileSync(path.join(specsDir, 'implementation_plan.json'), JSON.stringify(plan));

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);

      // First call should populate cache
      const tasksBefore = store.getTasks(project.id);
      expect(tasksBefore[0].title).toBe('Initial Feature');

      // Modify the file directly (simulating external change)
      const updatedPlan = { ...plan, feature: 'Updated Feature' };
      writeFileSync(path.join(specsDir, 'implementation_plan.json'), JSON.stringify(updatedPlan));

      // Without invalidation, should still return cached data
      const tasksCached = store.getTasks(project.id);
      expect(tasksCached[0].title).toBe('Initial Feature');

      // Invalidate cache
      store.invalidateTasksCache(project.id);

      // Now should return fresh data
      const tasksAfterInvalidation = store.getTasks(project.id);
      expect(tasksAfterInvalidation[0].title).toBe('Updated Feature');
    });
  });

  describe('getTasks - worktree deduplication', () => {
    it('should not duplicate tasks that exist in both main and worktree', async () => {
      // Create same task in both main and worktree
      const mainSpecsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '007-dedupe-test');
      mkdirSync(mainSpecsDir, { recursive: true });

      const worktreeDir = path.join(
        TEST_PROJECT_PATH,
        '.auto-claude',
        'worktrees',
        'tasks',
        'dedupe-worktree',
        '.auto-claude',
        'specs',
        '007-dedupe-test'
      );
      mkdirSync(worktreeDir, { recursive: true });

      const plan = {
        feature: 'Dedupe Test Feature',
        workflow_type: 'feature',
        services_involved: [],
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [{ id: 'subtask-1', description: 'Test', status: 'pending' }]
          }
        ],
        final_acceptance: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        spec_file: 'spec.md'
      };

      writeFileSync(path.join(mainSpecsDir, 'implementation_plan.json'), JSON.stringify(plan));
      writeFileSync(path.join(worktreeDir, 'implementation_plan.json'), JSON.stringify(plan));

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      // Should only return ONE task, not two
      const matchingTasks = tasks.filter(t => t.specId === '007-dedupe-test');
      expect(matchingTasks).toHaveLength(1);
    });
  });
});
