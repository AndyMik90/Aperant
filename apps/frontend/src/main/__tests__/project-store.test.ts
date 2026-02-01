/**
 * Unit tests for Project Store
 * Tests project CRUD operations and task reading from filesystem
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import path from 'path';

// Test directories
const TEST_DIR = '/tmp/project-store-test';
const USER_DATA_PATH = path.join(TEST_DIR, 'userData');
const TEST_PROJECT_PATH = path.join(TEST_DIR, 'test-project');

// Mock Electron before importing the store
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return USER_DATA_PATH;
      return TEST_DIR;
    })
  }
}));

// Setup test directories
function setupTestDirs(): void {
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
      expect(tasks[0].status).toBe('coding'); // Some completed, some pending
    });

    it('should determine status as backlog when no subtasks completed', async () => {
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '002-pending');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Pending Feature',
        workflow_type: 'feature',
        services_involved: [],
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

      expect(tasks[0].status).toBe('planning');
    });

    it('should determine status as ai_review when all subtasks completed', async () => {
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '003-complete');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Complete Feature',
        workflow_type: 'feature',
        services_involved: [],
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

    it('should determine status as human_review when QA report rejected', async () => {
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '004-rejected');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Rejected Feature',
        workflow_type: 'feature',
        services_involved: [],
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

      writeFileSync(
        path.join(specsDir, 'qa_report.md'),
        '# QA Report\n\nStatus: REJECTED\n'
      );

      const { ProjectStore } = await import('../project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      expect(tasks[0].status).toBe('human_review');
    });

    it('should determine status as human_review when QA report approved', async () => {
      // QA approval moves task to human_review (user needs to review before marking done)
      const specsDir = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '005-approved');
      mkdirSync(specsDir, { recursive: true });

      const plan = {
        feature: 'Approved Feature',
        workflow_type: 'feature',
        services_involved: [],
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

      writeFileSync(
        path.join(specsDir, 'qa_report.md'),
        '# QA Report\n\nStatus: APPROVED\n'
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
});
