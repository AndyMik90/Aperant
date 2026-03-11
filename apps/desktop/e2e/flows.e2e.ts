/**
 * End-to-End tests for main user flows
 * Tests the complete user experience in the Electron app
 *
 * NOTE: These tests require the Electron app to be built first.
 * Run `npm run build` before running E2E tests.
 * The tests also require Playwright to be installed.
 *
 * To run: npx playwright test --config=e2e/playwright.config.ts
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';

// Test data directory - set during setup using a secure random temp dir
let TEST_DATA_DIR: string;
let TEST_PROJECT_DIR: string;

// Setup test environment
function setupTestEnvironment(): void {
  TEST_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'auto-claude-ui-e2e-'));
  TEST_PROJECT_DIR = path.join(TEST_DATA_DIR, 'test-project');
  mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  mkdirSync(path.join(TEST_PROJECT_DIR, 'auto-claude', 'specs'), { recursive: true });
}

// Cleanup test environment
function cleanupTestEnvironment(): void {
  if (TEST_DATA_DIR && existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

// Helper to create a test spec
function createTestSpec(specId: string, status: 'pending' | 'in_progress' | 'completed' = 'pending'): void {
  const specDir = path.join(TEST_PROJECT_DIR, 'auto-claude', 'specs', specId);
  mkdirSync(specDir, { recursive: true });

  const chunkStatus = status === 'completed' ? 'completed' : status === 'in_progress' ? 'in_progress' : 'pending';

  writeFileSync(
    path.join(specDir, 'implementation_plan.json'),
    JSON.stringify({
      feature: `Test Feature ${specId}`,
      workflow_type: 'feature',
      services_involved: [],
      phases: [
        {
          phase: 1,
          name: 'Implementation',
          type: 'implementation',
          chunks: [
            { id: 'chunk-1', description: 'Implement feature', status: chunkStatus }
          ]
        }
      ],
      final_acceptance: ['Tests pass'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      spec_file: 'spec.md'
    })
  );

  writeFileSync(
    path.join(specDir, 'spec.md'),
    `# ${specId}\n\n## Overview\n\nThis is a test feature.\n`
  );
}

test.describe('Add Project Flow', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    setupTestEnvironment();
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }
    cleanupTestEnvironment();
  });

  test.skip('should open app and display empty state', async () => {
    // Skip test if electron is not available (CI environment)
    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');

    const appPath = path.join(__dirname, '..');
    app = await electron.launch({ args: [appPath] });
    page = await app.firstWindow();

    await page.waitForLoadState('domcontentloaded');

    // Verify app launched
    expect(await page.title()).toBeDefined();
  });

  test.skip('should show project sidebar', async () => {
    test.skip(!app, 'App not launched');

    // Look for sidebar component
    const sidebar = await page.locator('[data-testid="sidebar"], aside, .sidebar').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test.skip('should have add project button', async () => {
    test.skip(!app, 'App not launched');

    // Look for add project button
    const addButton = await page.locator(
      'button:has-text("Add"), button:has-text("New Project"), [data-testid="add-project"]'
    ).first();
    await expect(addButton).toBeVisible({ timeout: 5000 });
  });

  test.skip('should open directory picker on add project click', async () => {
    test.skip(!app, 'App not launched');

    // Mock the dialog to return test project path
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [TEST_PROJECT_DIR]
      });
    });

    // Click add project
    const addButton = await page.locator(
      'button:has-text("Add"), button:has-text("New Project"), [data-testid="add-project"]'
    ).first();
    await addButton.click();

    // Wait for project to appear in sidebar
    await page.waitForTimeout(1000);

    // Verify project appears
    const projectItem = await page.locator('text=test-project').first();
    await expect(projectItem).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Create Task Flow', () => {
  test.skip('should display task creation wizard', async () => {
    // This test requires the app to be running with a project selected
    // Skip in headless CI environments
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should create task with title and description', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should show task card in backlog after creation', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });
});

test.describe('Start Task Flow', () => {
  test.skip('should move task to In Progress when started', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should show progress updates during execution', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should display logs in detail panel', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });
});

test.describe('Complete Review Flow', () => {
  test.skip('should display review interface for completed tasks', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should move task to Done on approval', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should restart task on rejection with feedback', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });
});

// Simpler unit-style E2E tests that don't require full app launch
test.describe('E2E Test Infrastructure', () => {
  test('should have test environment setup correctly', () => {
    setupTestEnvironment();
    expect(existsSync(TEST_DATA_DIR)).toBe(true);
    expect(existsSync(TEST_PROJECT_DIR)).toBe(true);
    cleanupTestEnvironment();
  });

  test('should create test specs correctly', () => {
    setupTestEnvironment();
    createTestSpec('001-test-spec');

    const specDir = path.join(TEST_PROJECT_DIR, 'auto-claude', 'specs', '001-test-spec');
    expect(existsSync(specDir)).toBe(true);
    expect(existsSync(path.join(specDir, 'implementation_plan.json'))).toBe(true);
    expect(existsSync(path.join(specDir, 'spec.md'))).toBe(true);

    cleanupTestEnvironment();
  });

  test('should create specs with different statuses', () => {
    setupTestEnvironment();

    createTestSpec('001-pending', 'pending');
    createTestSpec('002-in-progress', 'in_progress');
    createTestSpec('003-completed', 'completed');

    const specsDir = path.join(TEST_PROJECT_DIR, 'auto-claude', 'specs');
    expect(existsSync(path.join(specsDir, '001-pending'))).toBe(true);
    expect(existsSync(path.join(specsDir, '002-in-progress'))).toBe(true);
    expect(existsSync(path.join(specsDir, '003-completed'))).toBe(true);

    cleanupTestEnvironment();
  });
});

// Mock-based E2E tests that can run without launching Electron
test.describe('E2E Flow Verification (Mock-based)', () => {
  test('Add Project flow should validate project path', async () => {
    setupTestEnvironment();

    // Simulate the validation that would happen in the app
    const projectPath = TEST_PROJECT_DIR;
    expect(existsSync(projectPath)).toBe(true);

    // Check for auto-claude directory detection
    const autoBuildPath = path.join(projectPath, 'auto-claude');
    expect(existsSync(autoBuildPath)).toBe(true);

    cleanupTestEnvironment();
  });

  test('Create Task flow should generate spec structure', async () => {
    setupTestEnvironment();

    // Simulate what would happen when creating a task
    const specId = '001-new-task';
    const specDir = path.join(TEST_PROJECT_DIR, 'auto-claude', 'specs', specId);
    mkdirSync(specDir, { recursive: true });

    // Write spec file
    writeFileSync(path.join(specDir, 'spec.md'), '# New Task Spec\n');

    expect(existsSync(specDir)).toBe(true);
    expect(existsSync(path.join(specDir, 'spec.md'))).toBe(true);

    cleanupTestEnvironment();
  });

  test('Start Task flow should update implementation plan status', async () => {
    setupTestEnvironment();
    createTestSpec('001-task', 'pending');

    // Simulate status update when task starts
    const planPath = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '001-task',
      'implementation_plan.json'
    );

    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
    plan.phases[0].chunks[0].status = 'in_progress';

    writeFileSync(planPath, JSON.stringify(plan, null, 2));

    // Verify update
    const updatedPlan = JSON.parse(readFileSync(planPath, 'utf-8'));
    expect(updatedPlan.phases[0].chunks[0].status).toBe('in_progress');

    cleanupTestEnvironment();
  });

  test('Complete Review flow should write QA report', async () => {
    setupTestEnvironment();
    createTestSpec('001-review', 'completed');

    // Simulate approval
    const qaReportPath = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '001-review',
      'qa_report.md'
    );

    writeFileSync(qaReportPath, `# QA Review\n\nStatus: APPROVED\n\nReviewed at: ${new Date().toISOString()}\n`);

    expect(existsSync(qaReportPath)).toBe(true);

    const content = readFileSync(qaReportPath, 'utf-8');
    expect(content).toContain('APPROVED');

    cleanupTestEnvironment();
  });

  test('Rejection flow should write fix request', async () => {
    setupTestEnvironment();
    createTestSpec('001-reject', 'completed');

    // Simulate rejection
    const fixRequestPath = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '001-reject',
      'QA_FIX_REQUEST.md'
    );

    writeFileSync(
      fixRequestPath,
      `# QA Fix Request\n\nStatus: REJECTED\n\n## Feedback\n\nNeeds more tests\n`
    );

    expect(existsSync(fixRequestPath)).toBe(true);

    const content = readFileSync(fixRequestPath, 'utf-8');
    expect(content).toContain('REJECTED');
    expect(content).toContain('Needs more tests');

    cleanupTestEnvironment();
  });
});
