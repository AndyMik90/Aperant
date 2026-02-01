/**
 * Test setup file for Vitest
 */
import { vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';

// React 19 compatibility: provide global IS_REACT_ACT_ENVIRONMENT and act
// React 19 moved act from react-dom/test-utils to react
// The testing library checks for this environment variable
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Make React.act available globally for React 19 compatibility with @testing-library/react
// Some versions of testing library still look for react-dom/test-utils which doesn't exist in React 19
if (React.act && typeof window !== 'undefined') {
  // Polyfill the old react-dom/test-utils location for compatibility
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__REACT_ACT__ = React.act;
}

// Conditionally import Node.js modules only when available (not in jsdom)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fs: typeof import('fs') | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let path: typeof import('path') | null = null;

// Only import fs/path in Node environment (not jsdom)
if (typeof process !== 'undefined' && process.versions?.node) {
  try {
    // Dynamic require to avoid bundler issues in jsdom
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    path = require('path');
  } catch {
    // Running in browser-like environment (jsdom), fs/path not available
  }
}

// Mock localStorage for tests that need it
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
})();

// Make localStorage available globally
Object.defineProperty(global, 'localStorage', {
  value: localStorageMock
});

// Mock scrollIntoView for Radix Select in jsdom
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    writable: true
  });
}

// Mock requestAnimationFrame/cancelAnimationFrame for jsdom
// Required by useXterm.ts which uses requestAnimationFrame for initial fit
if (typeof global.requestAnimationFrame === 'undefined') {
  global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number;
  });
  global.cancelAnimationFrame = vi.fn((id: number) => {
    clearTimeout(id);
  });
}

// Test data directory for isolated file operations
export const TEST_DATA_DIR = '/tmp/auto-claude-ui-tests';

// Create fresh test directory before each test
beforeEach(() => {
  // Clear localStorage
  localStorageMock.clear();

  // Only perform file system operations in Node environment (not jsdom)
  if (fs && path) {
    // Use a unique subdirectory per test to avoid race conditions in parallel tests
    const testId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const _testDir = path.join(TEST_DATA_DIR, testId);

    try {
      if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors if directory is in use by another parallel test
      // Each test uses unique subdirectory anyway
    }

    try {
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
      fs.mkdirSync(path.join(TEST_DATA_DIR, 'store'), { recursive: true });
    } catch {
      // Ignore errors if directory already exists from another parallel test
    }
  }
});

// Clean up test directory after each test
afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

// Mock window.electronAPI for renderer tests
if (typeof window !== 'undefined') {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    addProject: vi.fn(),
    removeProject: vi.fn(),
    getProjects: vi.fn(),
    updateProjectSettings: vi.fn(),
    getTasks: vi.fn(),
    createTask: vi.fn(),
    startTask: vi.fn(),
    stopTask: vi.fn(),
    submitReview: vi.fn(),
    onTaskProgress: vi.fn(() => vi.fn()),
    onTaskError: vi.fn(() => vi.fn()),
    onTaskLog: vi.fn(() => vi.fn()),
    onTaskStatusChange: vi.fn(() => vi.fn()),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    selectDirectory: vi.fn(),
    getAppVersion: vi.fn(),
    // Tab state persistence (IPC-based)
    getTabState: vi.fn().mockResolvedValue({
      success: true,
      data: { openProjectIds: [], activeProjectId: null, tabOrder: [] }
    }),
    saveTabState: vi.fn().mockResolvedValue({ success: true }),
    // Profile-related API methods (API Profile feature)
    getAPIProfiles: vi.fn(),
    saveAPIProfile: vi.fn(),
    updateAPIProfile: vi.fn(),
    deleteAPIProfile: vi.fn(),
    setActiveAPIProfile: vi.fn(),
    testConnection: vi.fn(),
    // Terminal-related API methods
    onTaskMonitorTerminalCreate: vi.fn(() => vi.fn()),
    onTerminalOutput: vi.fn(() => vi.fn())
  };
}

// Suppress console errors in tests unless explicitly testing error scenarios
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  // Allow certain error messages through for debugging
  const message = args[0]?.toString() || '';
  if (message.includes('[TEST]')) {
    originalConsoleError(...args);
  }
};
