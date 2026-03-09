/**
 * Integration tests for WorkerBridge-based agent spawning
 * Tests AgentManager spawning worker threads correctly via WorkerBridge
 *
 * The project has migrated from Python subprocess spawning to TypeScript
 * worker threads. This test file verifies the new WorkerBridge path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { AgentExecutorConfig } from '../../main/ai/agent/types';

// =============================================================================
// Mock WorkerBridge
// =============================================================================

class MockBridge extends EventEmitter {
  spawn = vi.fn();
  terminate = vi.fn().mockResolvedValue(undefined);
  isRunning = vi.fn().mockReturnValue(false);
  workerInstance = null as null | { terminate: () => Promise<void> };
  get isActive() {
    return this.workerInstance !== null;
  }
}

// Track created bridge instances so tests can interact with them
const createdBridges: MockBridge[] = [];

vi.mock('../../main/ai/agent/worker-bridge', () => {
  class MockWorkerBridgeClass extends MockBridge {
    constructor() {
      super();
      createdBridges.push(this);
    }
  }
  return {
    WorkerBridge: MockWorkerBridgeClass,
  };
});

// =============================================================================
// Mock electron
// =============================================================================

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/mock/app/path'),
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}));

// =============================================================================
// Mock auth / model / provider helpers
// =============================================================================

vi.mock('../../main/ai/auth/resolver', () => ({
  resolveAuth: vi.fn().mockResolvedValue({ apiKey: 'mock-api-key', baseURL: undefined }),
}));

vi.mock('../../main/ai/config/phase-config', () => ({
  resolveModelId: vi.fn((model: string) => `claude-${model}-20241022`),
}));

vi.mock('../../main/ai/providers/factory', () => ({
  detectProviderFromModel: vi.fn(() => 'anthropic'),
}));

// =============================================================================
// Mock worktree helpers
// =============================================================================

vi.mock('../../main/ai/worktree', () => ({
  createOrGetWorktree: vi.fn().mockResolvedValue({ worktreePath: null }),
}));

vi.mock('../../main/worktree-paths', () => ({
  findTaskWorktree: vi.fn().mockReturnValue(null),
}));

// =============================================================================
// Mock project store (no projects = fast path)
// =============================================================================

vi.mock('../../main/project-store', () => ({
  projectStore: {
    getProjects: vi.fn(() => []),
  },
}));

// =============================================================================
// Mock claude-profile-manager
// =============================================================================

const mockProfile = {
  id: 'default',
  name: 'Default',
  isDefault: true,
  oauthToken: 'mock-encrypted-token',
  configDir: undefined,
};

const mockProfileManager = {
  hasValidAuth: vi.fn(() => true),
  getActiveProfile: vi.fn(() => mockProfile),
  getProfile: vi.fn((_id: string) => mockProfile),
  getActiveProfileToken: vi.fn(() => 'mock-decrypted-token'),
  getProfileToken: vi.fn((_id: string) => 'mock-decrypted-token'),
  getActiveProfileEnv: vi.fn(() => ({})),
  getProfileEnv: vi.fn((_id: string) => ({})),
  setActiveProfile: vi.fn(),
  getAutoSwitchSettings: vi.fn(() => ({ enabled: false, autoSwitchOnRateLimit: false, proactiveSwapEnabled: false, autoSwitchOnAuthFailure: false })),
  getBestAvailableProfile: vi.fn(() => null),
};

vi.mock('../../main/claude-profile-manager', () => ({
  getClaudeProfileManager: vi.fn(() => mockProfileManager),
  initializeClaudeProfileManager: vi.fn(() => Promise.resolve(mockProfileManager)),
}));

// =============================================================================
// Mock OperationRegistry
// =============================================================================

vi.mock('../../main/claude-profile/operation-registry', () => ({
  getOperationRegistry: vi.fn(() => ({
    registerOperation: vi.fn(),
    unregisterOperation: vi.fn(),
  })),
}));

// =============================================================================
// Mock misc dependencies
// =============================================================================

vi.mock('../../main/ipc-handlers/task/plan-file-utils', () => ({
  resetStuckSubtasks: vi.fn().mockResolvedValue({ success: true, resetCount: 0 }),
}));

vi.mock('../../main/rate-limit-detector', () => ({
  getBestAvailableProfileEnv: vi.fn(() => ({ env: {}, profileId: 'default', profileName: 'Default', wasSwapped: false })),
  getProfileEnv: vi.fn(() => ({})),
  detectRateLimit: vi.fn(() => ({ isRateLimited: false })),
  detectAuthFailure: vi.fn(() => ({ isAuthFailure: false })),
}));

vi.mock('../../main/services/profile', () => ({
  getAPIProfileEnv: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../main/env-utils', () => ({
  getAugmentedEnv: vi.fn(() => ({})),
}));

vi.mock('../../main/platform', () => ({
  isWindows: vi.fn(() => false),
  isMacOS: vi.fn(() => false),
  isLinux: vi.fn(() => true),
  getPathDelimiter: vi.fn(() => ':'),
  killProcessGracefully: vi.fn(),
  findExecutable: vi.fn(() => null),
}));

vi.mock('../../main/cli-tool-manager', () => ({
  getToolInfo: vi.fn(() => ({ found: false, path: null, source: null })),
  getClaudeCliPathForSdk: vi.fn(() => null),
}));

vi.mock('../../main/settings-utils', () => ({
  readSettingsFile: vi.fn(() => ({})),
}));

vi.mock('../../main/agent/env-utils', () => ({
  getOAuthModeClearVars: vi.fn(() => ({})),
  normalizeEnvPathKey: vi.fn((k: string) => k),
  mergePythonEnvPath: vi.fn(),
}));

// =============================================================================
// Tests
// =============================================================================

describe('WorkerBridge Spawn Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear bridge tracking array
    createdBridges.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
    createdBridges.length = 0;
  });

  describe('AgentManager', () => {
    it('should create a WorkerBridge for spec creation', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();

      const promise = manager.startSpecCreation('task-1', '/project', 'Test task description');

      // Resolve the promise — bridge.spawn() is called synchronously inside spawnWorkerProcess
      await promise;

      expect(createdBridges).toHaveLength(1);
      const bridge = createdBridges[0];
      expect(bridge.spawn).toHaveBeenCalledTimes(1);

      // Verify the executor config passed to bridge.spawn
      const config: AgentExecutorConfig = bridge.spawn.mock.calls[0][0];
      expect(config.taskId).toBe('task-1');
      expect(config.processType).toBe('spec-creation');
      expect(config.session.agentType).toBe('spec_orchestrator');
    }, 15000);

    it('should create a WorkerBridge for task execution', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();

      await manager.startTaskExecution('task-1', '/project', 'spec-001');

      expect(createdBridges).toHaveLength(1);
      const bridge = createdBridges[0];
      expect(bridge.spawn).toHaveBeenCalledTimes(1);

      const config: AgentExecutorConfig = bridge.spawn.mock.calls[0][0];
      expect(config.taskId).toBe('task-1');
      expect(config.processType).toBe('task-execution');
      expect(config.session.agentType).toBe('build_orchestrator');
    }, 15000);

    it('should create a WorkerBridge for QA process', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();

      await manager.startQAProcess('task-1', '/project', 'spec-001');

      expect(createdBridges).toHaveLength(1);
      const bridge = createdBridges[0];
      expect(bridge.spawn).toHaveBeenCalledTimes(1);

      const config: AgentExecutorConfig = bridge.spawn.mock.calls[0][0];
      expect(config.taskId).toBe('task-1');
      expect(config.processType).toBe('qa-process');
      expect(config.session.agentType).toBe('qa_reviewer');
    }, 15000);

    it('should accept parallel options without affecting process type', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();

      await manager.startTaskExecution('task-1', '/project', 'spec-001', {
        parallel: true,
        workers: 4,
      });

      expect(createdBridges).toHaveLength(1);
      const bridge = createdBridges[0];
      const config: AgentExecutorConfig = bridge.spawn.mock.calls[0][0];
      expect(config.processType).toBe('task-execution');
    }, 15000);

    it('should emit log events forwarded from the bridge', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      const logHandler = vi.fn();
      manager.on('log', logHandler);

      await manager.startSpecCreation('task-1', '/project', 'Test');

      // Simulate bridge emitting a log event
      const bridge = createdBridges[0];
      bridge.emit('log', 'task-1', 'Test log output\n', undefined);

      expect(logHandler).toHaveBeenCalledWith('task-1', 'Test log output\n', undefined);
    }, 15000);

    it('should emit error events forwarded from the bridge', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      const errorHandler = vi.fn();
      manager.on('error', errorHandler);

      await manager.startSpecCreation('task-1', '/project', 'Test');

      const bridge = createdBridges[0];
      bridge.emit('error', 'task-1', 'Something went wrong', undefined);

      expect(errorHandler).toHaveBeenCalledWith('task-1', 'Something went wrong', undefined);
    }, 15000);

    it('should emit exit events forwarded from the bridge', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      const exitHandler = vi.fn();
      manager.on('exit', exitHandler);

      await manager.startSpecCreation('task-1', '/project', 'Test');

      const bridge = createdBridges[0];
      bridge.emit('exit', 'task-1', 0, 'spec-creation', undefined);

      expect(exitHandler).toHaveBeenCalledWith('task-1', 0, 'spec-creation', undefined);
    }, 15000);

    it('should report task as running after spawn', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      await manager.startSpecCreation('task-1', '/project', 'Test');

      expect(manager.isRunning('task-1')).toBe(true);
    }, 15000);

    it('should kill task and remove from tracking', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      await manager.startSpecCreation('task-1', '/project', 'Test');

      expect(manager.isRunning('task-1')).toBe(true);

      const result = manager.killTask('task-1');

      expect(result).toBe(true);
      expect(manager.isRunning('task-1')).toBe(false);
    }, 15000);

    it('should return false when killing non-existent task', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      const result = manager.killTask('nonexistent');

      expect(result).toBe(false);
    }, 15000);

    it('should track running tasks', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      expect(manager.getRunningTasks()).toHaveLength(0);

      await manager.startSpecCreation('task-1', '/project', 'Test 1');
      await manager.startTaskExecution('task-2', '/project', 'spec-001');

      expect(manager.getRunningTasks()).toHaveLength(2);
      expect(manager.getRunningTasks()).toContain('task-1');
      expect(manager.getRunningTasks()).toContain('task-2');
    }, 15000);

    it('should kill all running tasks', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      await manager.startSpecCreation('task-1', '/project', 'Test 1');
      await manager.startTaskExecution('task-2', '/project', 'spec-001');

      expect(manager.getRunningTasks()).toHaveLength(2);

      await manager.killAll();

      expect(manager.getRunningTasks()).toHaveLength(0);
    }, 15000);

    it('should allow sequential execution of same task', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();

      await manager.startSpecCreation('task-1', '/project', 'Test 1');
      expect(manager.isRunning('task-1')).toBe(true);

      // Kill the first run
      manager.killTask('task-1');
      expect(manager.isRunning('task-1')).toBe(false);

      // Start again
      await manager.startSpecCreation('task-1', '/project', 'Test 2');
      expect(manager.isRunning('task-1')).toBe(true);
    }, 15000);

    it('should include projectId in executor config when provided', async () => {
      const { AgentManager } = await import('../../main/agent');

      const manager = new AgentManager();
      await manager.startSpecCreation('task-1', '/project', 'Test task', undefined, undefined, undefined, 'project-42');

      const bridge = createdBridges[0];
      const config: AgentExecutorConfig = bridge.spawn.mock.calls[0][0];
      expect(config.projectId).toBe('project-42');
    }, 15000);
  });
});
