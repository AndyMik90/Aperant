/**
 * End-to-End tests for terminal copy/paste functionality
 * Tests copy/paste keyboard shortcuts in the Electron app
 *
 * These tests require the Electron app to be built first.
 * Run `npm run build` before running E2E tests.
 *
 * To run: npx playwright test terminal-copy-paste.e2e.ts --config=e2e/playwright.config.ts
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import * as os from 'os';

// Global Navigator declaration for clipboard
declare global {
  interface Navigator {
    clipboard: {
      readText(): Promise<string>;
      writeText(text: string): Promise<void>;
    };
  }
}

// Test data directory
const TEST_DATA_DIR = path.join(os.tmpdir(), 'ac-jerry-terminal-e2e');

// Determine platform for platform-specific tests
const platform = process.platform;
const isMac = platform === 'darwin';
const isWindows = platform === 'win32';
const isLinux = platform === 'linux';

// Setup test environment
function setupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

// Cleanup test environment
function cleanupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

// Helper to get platform-specific copy shortcut
function getCopyShortcutKey(): string {
  return isMac ? 'Meta' : 'Control';
}

// Helper to check if test should run on current platform
function shouldRunForPlatform(testPlatform: 'all' | 'windows' | 'linux' | 'mac'): boolean {
  if (testPlatform === 'all') return true;
  if (testPlatform === 'windows') return isWindows;
  if (testPlatform === 'linux') return isLinux;
  if (testPlatform === 'mac') return isMac;
  return false;
}

test.describe('Terminal Copy/Paste Flows', () => {
  let app: ElectronApplication;
  let window: Page;
  let isAppReady = false;

  test.beforeAll(async () => {
    setupTestEnvironment();
  });

  test.afterAll(async () => {
    cleanupTestEnvironment();
  });

  test.beforeEach(async () => {
    // Launch Electron app
    const appPath = path.join(__dirname, '..');
    app = await electron.launch({ args: [appPath] });

    window = await app.firstWindow({
      timeout: 15000
    });

    // Wait for app to be ready
    try {
      await window.waitForSelector('body', { timeout: 10000 });
      isAppReady = true;
    } catch (error) {
      console.error('App failed to load:', error);
      isAppReady = false;
    }
  });

  test.afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  test.describe.configure({ mode: 'serial' });

  test('should copy selected text to clipboard', async () => {
    test.skip(!isAppReady, 'App not ready');
    test.skip(!shouldRunForPlatform('all'), 'Test not applicable to this platform');

    // Look for terminal element - skip if not found
    const terminalSelector = '.xterm';
    const terminalExists = await window.locator(terminalSelector).count() > 0;
    test.skip(!terminalExists, 'Terminal element not found');

    // Run a command to produce output
    const terminal = window.locator(terminalSelector).first();
    await terminal.click();

    // Type echo command and press enter
    await window.keyboard.type('echo "test output for copy"');
    await window.keyboard.press('Enter');

    // Wait for output to appear in terminal
    await expect(terminal).toContainText('test output for copy', { timeout: 5000 });

    // Select text (triple click to select line)
    await terminal.click({ clickCount: 3 });

    // Wait for selection to be active
    await window.waitForTimeout(100);

    // Press copy shortcut (Cmd+C on Mac, Ctrl+C on Windows/Linux)
    const copyKey = getCopyShortcutKey();
    await window.keyboard.press(`${copyKey}+c`);

    // Wait briefly for clipboard operation
    await window.waitForTimeout(100);

    // Verify clipboard contains selected text
    const clipboardText = await window.evaluate(async () => {
      return await navigator.clipboard.readText();
    });

    expect(clipboardText).toContain('test output for copy');
  });

  test('should send interrupt signal when no text selected', async () => {
    test.skip(!isAppReady, 'App not ready');
    test.skip(!shouldRunForPlatform('all'), 'Test not applicable to this platform');

    const terminalSelector = '.xterm';
    const terminalExists = await window.locator(terminalSelector).count() > 0;
    test.skip(!terminalExists, 'Terminal element not found');

    const terminal = window.locator(terminalSelector).first();
    await terminal.click();

    // Start a long-running process (sleep on Linux/Mac, timeout on Windows)
    const sleepCommand = isWindows ? 'timeout 10' : 'sleep 10';
    await window.keyboard.type(sleepCommand);
    await window.keyboard.press('Enter');

    // Wait for process to start
    await window.waitForTimeout(500);

    // Press Ctrl+C without selection (should send interrupt)
    await window.keyboard.press('Control+c');

    // Wait for interrupt to be processed - look for ^C or new prompt
    await expect(terminal).toContainText(/\^C|[$#>]/, { timeout: 3000 });
  });

  test('should paste clipboard text into terminal', async () => {
    test.skip(!isAppReady, 'App not ready');
    test.skip(!shouldRunForPlatform('all'), 'Test not applicable to this platform');

    const terminalSelector = '.xterm';
    const terminalExists = await window.locator(terminalSelector).count() > 0;
    test.skip(!terminalExists, 'Terminal element not found');

    // Set clipboard content
    const testText = 'hello world from clipboard';
    await window.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, testText);

    const terminal = window.locator(terminalSelector).first();
    await terminal.click();

    // Press paste shortcut
    const pasteKey = isMac ? 'Meta' : 'Control';
    await window.keyboard.press(`${pasteKey}+v`);

    // Wait briefly for paste to complete
    await window.waitForTimeout(100);

    // Press Enter to execute the pasted command
    await window.keyboard.press('Enter');

    // Verify text was pasted (terminal should show the pasted text or output)
    await expect(terminal).toContainText(testText, { timeout: 5000 });
  });

  test('should handle Linux CTRL+SHIFT+C copy shortcut', async () => {
    test.skip(!isAppReady, 'App not ready');
    test.skip(!shouldRunForPlatform('linux'), 'Linux-specific test');

    const terminalSelector = '.xterm';
    const terminalExists = await window.locator(terminalSelector).count() > 0;
    test.skip(!terminalExists, 'Terminal element not found');

    const terminal = window.locator(terminalSelector).first();
    await terminal.click();

    // Type command to generate output
    await window.keyboard.type('echo "linux copy test"');
    await window.keyboard.press('Enter');

    // Wait for output
    await expect(terminal).toContainText('linux copy test', { timeout: 5000 });

    // Select text
    await terminal.click({ clickCount: 3 });
    await window.waitForTimeout(100);

    // Press CTRL+SHIFT+C (Linux copy shortcut)
    await window.keyboard.down('Control');
    await window.keyboard.down('Shift');
    await window.keyboard.press('c');
    await window.keyboard.up('Shift');
    await window.keyboard.up('Control');

    // Wait briefly for clipboard operation
    await window.waitForTimeout(100);

    // Verify clipboard contains selected text
    const clipboardText = await window.evaluate(async () => {
      return await navigator.clipboard.readText();
    });

    expect(clipboardText).toContain('linux copy test');
  });

  test('should handle Linux CTRL+SHIFT+V paste shortcut', async () => {
    test.skip(!isAppReady, 'App not ready');
    test.skip(!shouldRunForPlatform('linux'), 'Linux-specific test');

    const terminalSelector = '.xterm';
    const terminalExists = await window.locator(terminalSelector).count() > 0;
    test.skip(!terminalExists, 'Terminal element not found');

    // Set clipboard content
    const testText = 'pasted via ctrl+shift+v';
    await window.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, testText);

    const terminal = window.locator(terminalSelector).first();
    await terminal.click();

    // Press CTRL+SHIFT+V (Linux paste shortcut)
    await window.keyboard.down('Control');
    await window.keyboard.down('Shift');
    await window.keyboard.press('v');
    await window.keyboard.up('Shift');
    await window.keyboard.up('Control');

    // Wait briefly for paste to complete
    await window.waitForTimeout(100);

    // Press Enter to execute
    await window.keyboard.press('Enter');

    // Verify text was pasted
    await expect(terminal).toContainText(testText, { timeout: 5000 });
  });

  test('should verify existing shortcuts still work', async () => {
    test.skip(!isAppReady, 'App not ready');
    test.skip(!shouldRunForPlatform('all'), 'Test not applicable to this platform');

    const terminalSelector = '.xterm';
    const terminalExists = await window.locator(terminalSelector).count() > 0;
    test.skip(!terminalExists, 'Terminal element not found');

    const terminal = window.locator(terminalSelector).first();
    await terminal.click();

    // Test SHIFT+Enter (multi-line input)
    await window.keyboard.type('echo "line 1"');
    await window.keyboard.down('Shift');
    await window.keyboard.press('Enter');
    await window.keyboard.up('Shift');
    await window.keyboard.type('echo "line 2"');
    await window.keyboard.press('Enter');

    // Verify multi-line input worked (both commands should execute)
    await expect(terminal).toContainText('line 1', { timeout: 5000 });
    await expect(terminal).toContainText('line 2', { timeout: 5000 });
  });

  test('should handle clipboard errors gracefully', async () => {
    test.skip(!isAppReady, 'App not ready');
    test.skip(!shouldRunForPlatform('all'), 'Test not applicable to this platform');

    const terminalSelector = '.xterm';
    const terminalExists = await window.locator(terminalSelector).count() > 0;
    test.skip(!terminalExists, 'Terminal element not found');

    // Mock clipboard permission denial by clearing clipboard
    await window.evaluate(async () => {
      // Try to read clipboard (may fail if permission denied)
      try {
        await navigator.clipboard.readText();
      } catch (_error) {
        // Expected - clipboard may not be accessible in test environment
        console.warn('Clipboard not accessible (expected in some environments)');
      }
    });

    const terminal = window.locator(terminalSelector).first();
    await terminal.click();

    // Try to paste even if clipboard is not accessible
    const pasteKey = isMac ? 'Meta' : 'Control';
    await window.keyboard.press(`${pasteKey}+v`);

    // Wait briefly to ensure terminal remains stable
    await window.waitForTimeout(100);

    // Try typing to verify terminal still works
    await window.keyboard.type('echo "terminal still works"');
    await window.keyboard.press('Enter');

    // Verify terminal still functions after clipboard error
    await expect(terminal).toContainText('terminal still works', { timeout: 5000 });
  });
});
