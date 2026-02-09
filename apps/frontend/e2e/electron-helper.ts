/**
 * Helper utilities for Electron E2E tests
 * Provides utilities for launching and interacting with the Electron app
 */
import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

export interface ElectronTestContext {
  app: ElectronApplication;
  page: Page;
}

/**
 * Launch the Electron application for testing
 */
export async function launchElectronApp(): Promise<ElectronTestContext> {
  // Path to the built Electron app
  const appPath = path.join(__dirname, '..');

  const app = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // Use test-specific user data directory
      ELECTRON_USER_DATA_PATH: '/tmp/ac-jerry-ui-e2e'
    }
  });

  // Wait for the main window to open
  const page = await app.firstWindow();

  // Wait for the app to be ready
  await page.waitForLoadState('domcontentloaded');

  return { app, page };
}

/**
 * Close the Electron application
 */
export async function closeElectronApp(app: ElectronApplication): Promise<void> {
  await app.close();
}

/**
 * Wait for the app to be in a stable state
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for the main content to be visible
  await page.waitForSelector('[data-testid="app-container"]', {
    timeout: 30000,
    state: 'visible'
  }).catch(() => {
    // If no testid, wait for any substantial content
    return page.waitForSelector('body', { timeout: 30000 });
  });
}

/**
 * Take a screenshot for debugging
 */
export async function takeDebugScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `./e2e/screenshots/${name}-${Date.now()}.png`,
    fullPage: true
  });
}

/**
 * Mock IPC responses for testing
 */
export function createMockIpcHandler(app: ElectronApplication): {
  mockProjectAdd: (response: unknown) => Promise<void>;
  mockProjectList: (projects: unknown[]) => Promise<void>;
  mockTaskCreate: (response: unknown) => Promise<void>;
  mockTaskList: (tasks: unknown[]) => Promise<void>;
} {
  return {
    async mockProjectAdd(response: unknown) {
      await app.evaluate(
        ({ ipcMain }, response) => {
          ipcMain.handle('project:add', () => response);
        },
        response
      );
    },

    async mockProjectList(projects: unknown[]) {
      await app.evaluate(
        ({ ipcMain }, projects) => {
          ipcMain.handle('project:list', () => ({
            success: true,
            data: projects
          }));
        },
        projects
      );
    },

    async mockTaskCreate(response: unknown) {
      await app.evaluate(
        ({ ipcMain }, response) => {
          ipcMain.handle('task:create', () => response);
        },
        response
      );
    },

    async mockTaskList(tasks: unknown[]) {
      await app.evaluate(
        ({ ipcMain }, tasks) => {
          ipcMain.handle('task:list', () => ({
            success: true,
            data: tasks
          }));
        },
        tasks
      );
    }
  };
}
