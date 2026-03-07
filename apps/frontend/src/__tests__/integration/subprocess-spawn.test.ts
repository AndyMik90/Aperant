/**
 * Integration tests for subprocess spawning
 * Tests AgentManager spawning Python processes correctly
 *
 * NOTE: Some pre-existing test failures in the full test suite (e.g., @testing-library/react
 * v16 missing exports) are NOT related to changes in this file. This test file focuses on
 * subprocess spawning and AgentManager functionality only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { mkdirSync, rmSync, existsSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { findPythonCommand, parsePythonCommand } from '../../main/python-detector';
import { isWindows } from '../../main/platform';

// Test directories - use secure temp directory with random suffix
let TEST_DIR: string;
let TEST_PROJECT_PATH: string;

function initTestDirectories(): void {
  TEST_DIR = mkdtempSync(path.join(tmpdir(), 'subprocess-spawn-test-'));
  TEST_PROJECT_PATH = path.join(TEST_DIR, 'test-project');
}

// Detect the Python command that will actually be used
const DETECTED_PYTHON_CMD = findPythonCommand() || 'python';
const [EXPECTED_PYTHON_COMMAND, EXPECTED_PYTHON_BASE_ARGS] = parsePythonCommand(DETECTED_PYTHON_CMD);

// Mock child_process spawn
const mockStdout = new EventEmitter();
const mockStderr = new EventEmitter();
const mockProcess = Object.assign(new EventEmitter(), {
  stdout: mockStdout,
  stderr: mockStderr,
  pid: 12345,
  killed: false,
  kill: vi.fn(() => {
    mockProcess.killed = true;
    // Emit exit event synchronously to simulate process termination
    // (needed for killAllProcesses wait - using nextTick for more predictable timing)
    process.nextTick(() => mockProcess.emit('exit', 0, null));
    return true;
  })
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => mockProcess)
  };
});

// Mock claude-profile-manager to bypass auth checks in tests
// Profile shape must match ClaudeProfile interface (id, name, isDefault, etc.)
const mockProfile = {
  id: 'default',
  name: 'Default',
  isDefault: true,
  oauthToken: 'mock-encrypted-token'
};

const mockProfileManager = {
  hasValidAuth: () => true,
  getActiveProfile: () => mockProfile,
  getProfile: (_profileId: string) => mockProfile,
  // Token decryption methods - return mock token for tests
  getActiveProfileToken: () => 'mock-decrypted-token-for-testing',
  getProfileToken: (_profileId: string) => 'mock-decrypted-token-for-testing',
  // Environment methods for rate-limit-detector delegation
  getActiveProfileEnv: () => ({}),
  getProfileEnv: (_profileId: string) => ({})
};

vi.mock('../../main/claude-profile-manager', () => ({
  getClaudeProfileManager: () => mockProfileManager,
  initializeClaudeProfileManager: () => Promise.resolve(mockProfileManager)
}));

// Mock validatePythonPath to allow test paths (security validation is tested separately)
vi.mock('../../main/python-detector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../main/python-detector')>();
  return {
    ...actual,
    validatePythonPath: (path: string) => ({ valid: true, sanitizedPath: path })
  };
});

// Mock python-env-manager for ensurePythonEnvReady (ACS-254)
vi.mock('../../main/python-env-manager', () => ({
  pythonEnvManager: {
    isEnvReady: vi.fn(() => true),
    initialize: vi.fn(() => Promise.resolve({ ready: true })),
    getPythonEnv: vi.fn(() => ({}))
  },
  getConfiguredPythonPath: vi.fn(() => DETECTED_PYTHON_CMD)
}));

// Mock rate-limit-detector for getBestAvailableProfileEnv
vi.mock('../../main/rate-limit-detector', () => ({
  getBestAvailableProfileEnv: vi.fn(() => ({
    env: {},
    profileId: 'default',
    profileName: 'Default',
    wasSwapped: false
  })),
  getProfileEnv: vi.fn(() => ({})),
  detectRateLimit: vi.fn(() => ({ isRateLimited: false })),
  detectAuthFailure: vi.fn(() => ({ isAuthFailure: false }))
}));

// Auto-claude source path (for getAutoBuildSourcePath to find)
let AUTO_CLAUDE_SOURCE: string;

// Setup test directories
function setupTestDirs(): void {
  initTestDirectories();
  AUTO_CLAUDE_SOURCE = path.join(TEST_DIR, 'auto-claude-source');
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });

  // Create auto-claude source directory that getAutoBuildSourcePath looks for
  mkdirSync(AUTO_CLAUDE_SOURCE, { recursive: true });

  // Create runners subdirectory with spec_runner.py marker (used by getAutoBuildSourcePath)
  mkdirSync(path.join(AUTO_CLAUDE_SOURCE, 'runners'), { recursive: true });

  // Create mock spec_runner.py in runners/ subdirectory (used as backend marker)
  writeFileSync(
    path.join(AUTO_CLAUDE_SOURCE, 'runners', 'spec_runner.py'),
    '# Mock spec runner\nprint("Starting spec creation")'
  );
  // Create mock run.py
  writeFileSync(
    path.join(AUTO_CLAUDE_SOURCE, 'run.py'),
    '# Mock run.py\nprint("Starting task execution")'
  );
}

// Cleanup test directories
function cleanupTestDirs(): void {
  if (TEST_DIR && existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('Subprocess Spawn Integration', () => {
  beforeEach(async () => {
    cleanupTestDirs();
    setupTestDirs();
    vi.clearAllMocks();
    // Reset mock process state
    mockProcess.killed = false;
    mockProcess.removeAllListeners();
    mockStdout.removeAllListeners();
    mockStderr.removeAllListeners();
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
  });

  describe('AgentManager', () => {
    it('should spawn Python process for spec creation', async () => {
      const { spawn } = await import('child_process');
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);

      // Start the async operation
      const promise = manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test task description');

      // Wait for spawn to complete (ensures listeners are attached), then emit exit
      await new Promise(resolve => setImmediate(resolve));
      mockProcess.emit('exit', 0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        EXPECTED_PYTHON_COMMAND,
        expect.arrayContaining([
          ...EXPECTED_PYTHON_BASE_ARGS,
          expect.stringContaining('spec_runner.py'),
          '--task',
          'Test task description'
        ]),
        expect.objectContaining({
          cwd: TEST_PROJECT_PATH,  // Process runs from project directory to avoid cross-drive issues on Windows (#1661)
          env: expect.objectContaining({
            PYTHONUNBUFFERED: '1'
          })
        })
      );
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should spawn Python process for task execution', async () => {
      const { spawn } = await import('child_process');
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);

      // Start the async operation
      const promise = manager.startTaskExecution('task-1', TEST_PROJECT_PATH, 'spec-001');

      // Wait for spawn to complete (ensures listeners are attached), then emit exit
      await new Promise(resolve => setImmediate(resolve));
      mockProcess.emit('exit', 0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        EXPECTED_PYTHON_COMMAND,
        expect.arrayContaining([
          ...EXPECTED_PYTHON_BASE_ARGS,
          expect.stringContaining('run.py'),
          '--spec',
          'spec-001'
        ]),
        expect.objectContaining({
          cwd: TEST_PROJECT_PATH  // Process runs from project directory to avoid cross-drive issues on Windows (#1661)
        })
      );
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should spawn Python process for QA process', async () => {
      const { spawn } = await import('child_process');
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);

      // Start the async operation
      const promise = manager.startQAProcess('task-1', TEST_PROJECT_PATH, 'spec-001');

      // Wait for spawn to complete (ensures listeners are attached), then emit exit
      await new Promise(resolve => setImmediate(resolve));
      mockProcess.emit('exit', 0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        EXPECTED_PYTHON_COMMAND,
        expect.arrayContaining([
          ...EXPECTED_PYTHON_BASE_ARGS,
          expect.stringContaining('run.py'),
          '--spec',
          'spec-001',
          '--qa'
        ]),
        expect.objectContaining({
          cwd: TEST_PROJECT_PATH  // Process runs from project directory to avoid cross-drive issues on Windows (#1661)
        })
      );
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should accept parallel options without affecting spawn args', async () => {
      // Note: --parallel was removed from run.py CLI - parallel execution is handled internally by the agent
      const { spawn } = await import('child_process');
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);

      // Start the async operation
      const promise = manager.startTaskExecution('task-1', TEST_PROJECT_PATH, 'spec-001', {
        parallel: true,
        workers: 4
      });

      // Wait for spawn to complete (ensures listeners are attached), then emit exit
      await new Promise(resolve => setImmediate(resolve));
      mockProcess.emit('exit', 0);
      await promise;
      // Should spawn normally - parallel options don't affect CLI args anymore
      expect(spawn).toHaveBeenCalledWith(
        EXPECTED_PYTHON_COMMAND,
        expect.arrayContaining([
          ...EXPECTED_PYTHON_BASE_ARGS,
          expect.stringContaining('run.py'),
          '--spec',
          'spec-001'
        ]),
        expect.any(Object)
      );
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should emit log events from stdout', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);
      const logHandler = vi.fn();
      manager.on('log', logHandler);

      await manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test');

      // Simulate stdout data (must include newline for buffered output processing)
      mockStdout.emit('data', Buffer.from('Test log output\n'));

      expect(logHandler).toHaveBeenCalledWith('task-1', 'Test log output\n', undefined);
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should emit log events from stderr', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);
      const logHandler = vi.fn();
      manager.on('log', logHandler);

      await manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test');

      // Simulate stderr data (must include newline for buffered output processing)
      mockStderr.emit('data', Buffer.from('Progress: 50%\n'));

      expect(logHandler).toHaveBeenCalledWith('task-1', 'Progress: 50%\n', undefined);
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should emit exit event when process exits', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);
      const exitHandler = vi.fn();
      manager.on('exit', exitHandler);

      await manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test');

      // Simulate process exit
      mockProcess.emit('exit', 0);

      // Exit event includes taskId, exit code, process type, and optional projectId
      expect(exitHandler).toHaveBeenCalledWith('task-1', 0, expect.any(String), undefined);
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should emit error event when process errors', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);
      const errorHandler = vi.fn();
      manager.on('error', errorHandler);

      await manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test');

      // Simulate process error
      mockProcess.emit('error', new Error('Spawn failed'));

      expect(errorHandler).toHaveBeenCalledWith('task-1', 'Spawn failed', undefined);
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should kill task and remove from tracking', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);
      await manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test');

      expect(manager.isRunning('task-1')).toBe(true);

      const result = manager.killTask('task-1');

      expect(result).toBe(true);
      // On Windows, kill() is called without arguments; on Unix, kill('SIGTERM') is used
      if (isWindows()) {
        expect(mockProcess.kill).toHaveBeenCalled();
      } else {
        expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      }
      expect(manager.isRunning('task-1')).toBe(false);
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should return false when killing non-existent task', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      const result = manager.killTask('nonexistent');

      expect(result).toBe(false);
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should track running tasks', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);
      expect(manager.getRunningTasks()).toHaveLength(0);

      // Start tasks in parallel
      const promise1 = manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test 1');
      const promise2 = manager.startTaskExecution('task-2', TEST_PROJECT_PATH, 'spec-001');

      // Wait for both tasks to be tracked (spawn happens after async operations)
      await vi.waitFor(() => {
        expect(manager.getRunningTasks()).toHaveLength(2);
      }, { timeout: 5000 });

      // Wait for both spawn promises to fully resolve — this ensures the exit
      // handlers are attached to mockProcess. A single setImmediate is NOT enough
      // on Windows CI because spawnProcess has async operations (getAPIProfileEnv,
      // getRecoveryCoordinator) between addProcess and the .on('exit') listener.
      // Waiting for the promises guarantees spawnProcess has completed fully.
      await Promise.allSettled([promise1, promise2]);

      // Both tasks share the same mockProcess, so one emit fires both exit handlers
      mockProcess.emit('exit', 0);

      // Wait for tasks to be removed from tracking (cleanup may be async)
      await vi.waitFor(() => {
        expect(manager.getRunningTasks()).toHaveLength(0);
      }, { timeout: 5000 });
    }, 15000);

    it('should use configured Python path', async () => {
      const { spawn } = await import('child_process');
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure('/custom/python3', AUTO_CLAUDE_SOURCE);

      await manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test');

      expect(spawn).toHaveBeenCalledWith(
        '/custom/python3',
        expect.any(Array),
        expect.any(Object)
      );
    }, 30000);  // Increase timeout for Windows CI (dynamic imports are slow)

    it('should kill all running tasks', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);

      // Start two async operations
      const promise1 = manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test 1');
      const promise2 = manager.startTaskExecution('task-2', TEST_PROJECT_PATH, 'spec-001');

      // Wait for spawn to complete (ensures listeners are attached), then emit exit
      await new Promise(resolve => setImmediate(resolve));
      mockProcess.emit('exit', 0);
      await promise1;
      mockProcess.emit('exit', 0);
      await promise2;

      await manager.killAll();

      expect(manager.getRunningTasks()).toHaveLength(0);
    }, 10000);  // Increase timeout for Windows CI

    it('should allow sequential execution of same task', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      manager.configure(undefined, AUTO_CLAUDE_SOURCE);

      // Start first operation
      const promise1 = manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test 1');
      // Wait for spawn, then emit exit
      await new Promise(resolve => setImmediate(resolve));
      mockProcess.emit('exit', 0);
      await promise1;

      // Start another process for same task (first was already completed)
      const promise2 = manager.startSpecCreation('task-1', TEST_PROJECT_PATH, 'Test 2');
      // Wait for spawn, then emit exit
      await new Promise(resolve => setImmediate(resolve));
      mockProcess.emit('exit', 0);
      await promise2;

      // Both processes completed successfully
      // (the first process was already done before the second started)
    }, 10000);  // Increase timeout for Windows CI
  });
});
