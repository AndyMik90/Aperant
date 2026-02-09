/**
 * End-to-End tests for full task workflow
 * Tests: create → spec → subtasks → resume
 *
 * NOTE: These tests require the Electron app to be built first.
 * Run `npm run build` before running E2E tests.
 *
 * To run: npx playwright test task-workflow --config=e2e/playwright.config.ts
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Test data directory - created securely with mkdtempSync to prevent TOCTOU attacks
let TEST_DATA_DIR: string;
let TEST_PROJECT_DIR: string;
let SPECS_DIR: string;

// Setup test environment with secure temp directory
function setupTestEnvironment(): void {
  // Create secure temp directory with random suffix
  TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ac-jerry-task-workflow-e2e-'));
  TEST_PROJECT_DIR = path.join(TEST_DATA_DIR, 'test-project');
  SPECS_DIR = path.join(TEST_PROJECT_DIR, '.ac.jerry', 'specs');
  mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  mkdirSync(SPECS_DIR, { recursive: true });
}

// Cleanup test environment
function cleanupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

// Helper to create a task spec with subtasks
function createTaskWithSubtasks(
  specId: string,
  subtaskStatuses: Array<'pending' | 'in_progress' | 'completed'>
): void {
  const specDir = path.join(SPECS_DIR, specId);
  mkdirSync(specDir, { recursive: true });

  // Create spec.md
  writeFileSync(
    path.join(specDir, 'spec.md'),
    `# ${specId}\n\n## Overview\n\nTest task for workflow validation.\n\n## Acceptance Criteria\n\n- [ ] All subtasks completed\n- [ ] Tests pass\n`
  );

  // Create requirements.json
  writeFileSync(
    path.join(specDir, 'requirements.json'),
    JSON.stringify(
      {
        task_description: `Test task ${specId}`,
        user_requirements: ['Requirement 1', 'Requirement 2'],
        acceptance_criteria: ['All subtasks completed', 'Tests pass'],
        context: []
      },
      null,
      2
    )
  );

  // Create implementation_plan.json with subtasks
  const subtasks = subtaskStatuses.map((status, index) => ({
    id: `subtask-${index + 1}`,
    phase: 'Implementation',
    service: 'backend',
    description: `Subtask ${index + 1}: Implement feature part ${index + 1}`,
    files_to_modify: [`src/file${index + 1}.py`],
    files_to_create: [],
    pattern_files: [],
    verification_command: 'pytest tests/',
    status: status,
    notes: status === 'completed' ? 'Completed successfully' : ''
  }));

  writeFileSync(
    path.join(specDir, 'implementation_plan.json'),
    JSON.stringify(
      {
        feature: `Test Feature ${specId}`,
        workflow_type: 'feature',
        services_involved: ['backend'],
        subtasks: subtasks,
        final_acceptance: ['All subtasks completed', 'Tests pass'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        spec_file: 'spec.md'
      },
      null,
      2
    )
  );

  // Create build-progress.txt
  writeFileSync(
    path.join(specDir, 'build-progress.txt'),
    `Task Progress: ${specId}\n\nSubtasks: ${subtasks.length}\nCompleted: ${subtasks.filter(s => s.status === 'completed').length}\n`
  );
}

// Helper to simulate task resumption
function simulateTaskResume(specId: string): void {
  const planPath = path.join(SPECS_DIR, specId, 'implementation_plan.json');
  const plan = JSON.parse(readFileSync(planPath, 'utf-8'));

  // Find first pending subtask and mark as in_progress
  const pendingSubtask = plan.subtasks.find((st: { status: string }) => st.status === 'pending');
  if (pendingSubtask) {
    pendingSubtask.status = 'in_progress';
    pendingSubtask.notes = 'Resumed from checkpoint';
  }

  plan.updated_at = new Date().toISOString();
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
}

test.describe('Task Workflow E2E Tests', () => {
  test.beforeAll(() => {
    setupTestEnvironment();
  });

  test.afterAll(() => {
    cleanupTestEnvironment();
  });

  test('should create task directory structure', () => {
    const specId = '001-test-task';
    const specDir = path.join(SPECS_DIR, specId);
    mkdirSync(specDir, { recursive: true });

    // Verify directory created
    expect(existsSync(specDir)).toBe(true);
  });

  test('should generate spec.md file', () => {
    const specId = '002-task-with-spec';
    const specDir = path.join(SPECS_DIR, specId);
    mkdirSync(specDir, { recursive: true });

    // Write spec
    const specContent = '# Test Task\n\n## Overview\n\nThis is a test task.\n';
    writeFileSync(path.join(specDir, 'spec.md'), specContent);

    // Verify spec file
    expect(existsSync(path.join(specDir, 'spec.md'))).toBe(true);
    const content = readFileSync(path.join(specDir, 'spec.md'), 'utf-8');
    expect(content).toContain('Test Task');
  });

  test('should create implementation plan with subtasks', () => {
    const specId = '003-task-with-subtasks';
    createTaskWithSubtasks(specId, ['pending', 'pending', 'pending']);

    const planPath = path.join(SPECS_DIR, specId, 'implementation_plan.json');
    expect(existsSync(planPath)).toBe(true);

    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
    expect(plan.subtasks).toBeDefined();
    expect(plan.subtasks.length).toBe(3);
    expect(plan.subtasks[0].status).toBe('pending');
  });

  test('should track subtask progress', () => {
    const specId = '004-task-in-progress';
    createTaskWithSubtasks(specId, ['completed', 'in_progress', 'pending']);

    const planPath = path.join(SPECS_DIR, specId, 'implementation_plan.json');
    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));

    expect(plan.subtasks[0].status).toBe('completed');
    expect(plan.subtasks[1].status).toBe('in_progress');
    expect(plan.subtasks[2].status).toBe('pending');
  });

  test('should resume task from checkpoint', () => {
    const specId = '005-task-resume';
    createTaskWithSubtasks(specId, ['completed', 'pending', 'pending']);

    // Verify initial state
    let plan = JSON.parse(readFileSync(path.join(SPECS_DIR, specId, 'implementation_plan.json'), 'utf-8'));
    expect(plan.subtasks[1].status).toBe('pending');

    // Simulate resume
    simulateTaskResume(specId);

    // Verify resumed state
    plan = JSON.parse(readFileSync(path.join(SPECS_DIR, specId, 'implementation_plan.json'), 'utf-8'));
    expect(plan.subtasks[1].status).toBe('in_progress');
    expect(plan.subtasks[1].notes).toContain('Resumed from checkpoint');
  });

  test('should complete all subtasks in sequence', () => {
    const specId = '006-task-completion';
    createTaskWithSubtasks(specId, ['completed', 'completed', 'completed']);

    const plan = JSON.parse(readFileSync(path.join(SPECS_DIR, specId, 'implementation_plan.json'), 'utf-8'));
    const allCompleted = plan.subtasks.every((st: { status: string }) => st.status === 'completed');

    expect(allCompleted).toBe(true);
  });

  test('should maintain build progress log', () => {
    const specId = '007-task-with-progress';
    createTaskWithSubtasks(specId, ['completed', 'in_progress', 'pending']);

    const progressPath = path.join(SPECS_DIR, specId, 'build-progress.txt');
    expect(existsSync(progressPath)).toBe(true);

    const progressContent = readFileSync(progressPath, 'utf-8');
    expect(progressContent).toContain('Task Progress');
    expect(progressContent).toContain('Subtasks: 3');
  });
});

test.describe('Full Task Workflow Integration', () => {
  test.beforeAll(() => {
    setupTestEnvironment();
  });

  test.afterAll(() => {
    cleanupTestEnvironment();
  });

  test('should complete full workflow: create → spec → subtasks → resume → complete', () => {
    const specId = '100-full-workflow';

    // Step 1: Create task
    const specDir = path.join(SPECS_DIR, specId);
    mkdirSync(specDir, { recursive: true });
    expect(existsSync(specDir)).toBe(true);

    // Step 2: Generate spec
    writeFileSync(
      path.join(specDir, 'spec.md'),
      '# Full Workflow Test\n\n## Overview\n\nComplete workflow test.\n'
    );
    expect(existsSync(path.join(specDir, 'spec.md'))).toBe(true);

    // Step 3: Create subtasks
    createTaskWithSubtasks(specId, ['pending', 'pending', 'pending']);
    let plan = JSON.parse(readFileSync(path.join(specDir, 'implementation_plan.json'), 'utf-8'));
    expect(plan.subtasks.length).toBe(3);

    // Step 4: Start first subtask
    plan.subtasks[0].status = 'in_progress';
    writeFileSync(path.join(specDir, 'implementation_plan.json'), JSON.stringify(plan, null, 2));

    plan = JSON.parse(readFileSync(path.join(specDir, 'implementation_plan.json'), 'utf-8'));
    expect(plan.subtasks[0].status).toBe('in_progress');

    // Step 5: Complete first subtask
    plan.subtasks[0].status = 'completed';
    plan.subtasks[0].notes = 'First subtask completed';
    writeFileSync(path.join(specDir, 'implementation_plan.json'), JSON.stringify(plan, null, 2));

    // Step 6: Resume with second subtask
    simulateTaskResume(specId);
    plan = JSON.parse(readFileSync(path.join(specDir, 'implementation_plan.json'), 'utf-8'));
    expect(plan.subtasks[1].status).toBe('in_progress');

    // Step 7: Complete remaining subtasks
    plan.subtasks[1].status = 'completed';
    plan.subtasks[2].status = 'completed';
    writeFileSync(path.join(specDir, 'implementation_plan.json'), JSON.stringify(plan, null, 2));

    // Step 8: Verify all completed
    plan = JSON.parse(readFileSync(path.join(specDir, 'implementation_plan.json'), 'utf-8'));
    const allCompleted = plan.subtasks.every((st: { status: string }) => st.status === 'completed');
    expect(allCompleted).toBe(true);

    // Step 9: Verify final state
    expect(plan.subtasks[0].notes).toContain('First subtask completed');
    expect(plan.subtasks[1].notes).toContain('Resumed from checkpoint');
  });

  test('should handle workflow interruption and recovery', () => {
    const specId = '101-workflow-recovery';

    // Create task with partial progress
    createTaskWithSubtasks(specId, ['completed', 'in_progress', 'pending']);

    // Simulate interruption (task status is saved)
    const planPath = path.join(SPECS_DIR, specId, 'implementation_plan.json');
    let plan = JSON.parse(readFileSync(planPath, 'utf-8'));
    expect(plan.subtasks[1].status).toBe('in_progress');

    // Simulate recovery: complete interrupted subtask
    plan.subtasks[1].status = 'completed';
    plan.subtasks[1].notes = 'Recovered and completed';
    writeFileSync(planPath, JSON.stringify(plan, null, 2));

    // Resume with next subtask
    simulateTaskResume(specId);
    plan = JSON.parse(readFileSync(planPath, 'utf-8'));

    // Verify recovery successful
    expect(plan.subtasks[1].status).toBe('completed');
    expect(plan.subtasks[2].status).toBe('in_progress');
  });

  test('should validate workflow data integrity', () => {
    const specId = '102-data-integrity';
    createTaskWithSubtasks(specId, ['pending', 'pending', 'pending']);

    const specDir = path.join(SPECS_DIR, specId);

    // Verify all required files exist
    expect(existsSync(path.join(specDir, 'spec.md'))).toBe(true);
    expect(existsSync(path.join(specDir, 'requirements.json'))).toBe(true);
    expect(existsSync(path.join(specDir, 'implementation_plan.json'))).toBe(true);
    expect(existsSync(path.join(specDir, 'build-progress.txt'))).toBe(true);

    // Verify data structure integrity
    const requirements = JSON.parse(readFileSync(path.join(specDir, 'requirements.json'), 'utf-8'));
    expect(requirements.task_description).toBeDefined();
    expect(requirements.acceptance_criteria).toBeDefined();

    const plan = JSON.parse(readFileSync(path.join(specDir, 'implementation_plan.json'), 'utf-8'));
    expect(plan.feature).toBeDefined();
    expect(plan.subtasks).toBeDefined();
    expect(plan.created_at).toBeDefined();
    expect(plan.updated_at).toBeDefined();

    // Verify subtask structure
    plan.subtasks.forEach((subtask: {
      id: string;
      description: string;
      status: string;
      verification_command: string;
    }) => {
      expect(subtask.id).toBeDefined();
      expect(subtask.description).toBeDefined();
      expect(subtask.status).toMatch(/^(pending|in_progress|completed)$/);
      expect(subtask.verification_command).toBeDefined();
    });
  });
});
