/**
 * Integration tests for ChangelogGenerator subprocess timeout mechanism
 * Tests that long-running processes are killed after 5 minutes with error event
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { ChangelogGenerationRequest, TaskSpecContent } from '../../../shared/types';

// Mock child_process module
const mockChildProcess = new EventEmitter() as any;
mockChildProcess.pid = 12345;
mockChildProcess.kill = vi.fn();
mockChildProcess.stdout = new EventEmitter();
mockChildProcess.stderr = new EventEmitter();

const mockSpawn = vi.fn(() => mockChildProcess);

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: mockSpawn
  };
});

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
    getAppPath: vi.fn(() => '/tmp'),
    getVersion: vi.fn(() => '0.1.0'),
    isPackaged: false
  }
}));

vi.mock('../../python-detector', () => ({
  parsePythonCommand: vi.fn((cmd: string) => [cmd, []])
}));

vi.mock('../../env-utils', () => ({
  getAugmentedEnv: vi.fn(() => ({ PATH: '/usr/bin' }))
}));

vi.mock('../../platform', () => ({
  isWindows: vi.fn(() => false)
}));

vi.mock('../../rate-limit-detector', () => ({
  detectRateLimit: vi.fn(() => ({ isRateLimited: false })),
  createSDKRateLimitInfo: vi.fn(),
  getBestAvailableProfileEnv: vi.fn(() => ({
    env: {},
    wasSwapped: false,
    profileName: 'default'
  }))
}));

describe('ChangelogGenerator - Subprocess Timeout', () => {
  let generator: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset mock child process
    mockChildProcess.removeAllListeners();
    mockChildProcess.stdout.removeAllListeners();
    mockChildProcess.stderr.removeAllListeners();
    mockChildProcess.killed = false;
    mockChildProcess.kill.mockImplementation(() => {
      mockChildProcess.killed = true;
      return true;
    });

    // Import generator after mocks are set up
    const { ChangelogGenerator } = await import('../generator');
    generator = new ChangelogGenerator(
      '/usr/bin/python3',
      '/usr/bin/claude',
      '/tmp/auto-build',
      {},
      false
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should kill subprocess after 5 minutes and emit timeout error', async () => {
    const projectId = 'test-project';
    const projectPath = '/tmp/test-project';

    const request: ChangelogGenerationRequest = {
      projectId,
      sourceMode: 'tasks',
      taskIds: ['task-1'],
      version: '1.0.0',
      date: new Date().toISOString(),
      format: 'keep-a-changelog',
      audience: 'technical'
    };

    const specs: TaskSpecContent[] = [
      {
        taskId: 'task-1',
        specId: '001-test-task',
        spec: '# Test Task\nA test task spec'
      }
    ];

    // Track emitted events
    const progressEvents: any[] = [];
    const errorEvents: string[] = [];

    generator.on('generation-progress', (_projectId: string, progress: any) => {
      progressEvents.push(progress);
    });

    generator.on('generation-error', (_projectId: string, error: string) => {
      errorEvents.push(error);
    });

    // Start generation (returns immediately, spawns async process)
    const generatePromise = generator.generate(projectId, projectPath, request, specs);

    // Wait for spawn to be called
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });

    // Verify process was spawned
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/python3',
      expect.arrayContaining(['-c', expect.any(String)]),
      expect.objectContaining({
        cwd: '/tmp/auto-build',
        env: expect.any(Object)
      })
    );

    // Verify initial progress event was emitted
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[0].stage).toBe('loading_specs');

    // Simulate process running but not completing (no exit event)
    // Just send some stdout data to show it's working
    mockChildProcess.stdout.emit('data', Buffer.from('Processing...'));

    // Advance time by 4 minutes - should NOT timeout yet
    vi.advanceTimersByTime(4 * 60 * 1000);

    // Process should still be alive
    expect(mockChildProcess.kill).not.toHaveBeenCalled();
    expect(errorEvents).toHaveLength(0);

    // Advance time by another 1 minute and 1 second - should timeout now
    vi.advanceTimersByTime(61 * 1000);

    // Process should be killed
    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');

    // Timeout error should be emitted
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toBe('Changelog generation timed out after 5 minutes');

    // Check that error progress event was emitted
    const errorProgress = progressEvents.find(p => p.stage === 'error');
    expect(errorProgress).toBeDefined();
    expect(errorProgress?.error).toBe('Changelog generation timed out after 5 minutes');

    await generatePromise;
  });

  it('should clear timeout on normal subprocess exit', async () => {
    const projectId = 'test-project-2';
    const projectPath = '/tmp/test-project-2';

    const request: ChangelogGenerationRequest = {
      projectId,
      sourceMode: 'tasks',
      taskIds: ['task-2'],
      version: '1.0.0',
      date: new Date().toISOString(),
      format: 'keep-a-changelog',
      audience: 'technical'
    };

    const specs: TaskSpecContent[] = [
      {
        taskId: 'task-2',
        specId: '002-test-task',
        spec: '# Test Task 2\nAnother test task'
      }
    ];

    // Track events
    const completeEvents: any[] = [];
    const errorEvents: string[] = [];

    generator.on('generation-complete', (_projectId: string, result: any) => {
      completeEvents.push(result);
    });

    generator.on('generation-error', (_projectId: string, error: string) => {
      errorEvents.push(error);
    });

    // Start generation
    const generatePromise = generator.generate(projectId, projectPath, request, specs);

    // Wait for spawn
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });

    // Simulate successful completion before timeout
    const changelogOutput = `
# Changelog

## [1.0.0] - ${new Date().toISOString().split('T')[0]}

### Added
- Test feature from task-2
`;

    mockChildProcess.stdout.emit('data', Buffer.from(changelogOutput));
    mockChildProcess.emit('exit', 0);

    // Process exit handler should have cleared the timeout
    // Advance time past timeout to verify it doesn't fire
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes

    // Should NOT have killed the process (already exited)
    expect(mockChildProcess.kill).not.toHaveBeenCalled();

    // Should NOT have timeout error
    expect(errorEvents).toHaveLength(0);

    // Should have successful completion
    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0].success).toBe(true);
    expect(completeEvents[0].changelog).toContain('Test feature from task-2');

    await generatePromise;
  });

  it('should clear timeout on subprocess error', async () => {
    const projectId = 'test-project-3';
    const projectPath = '/tmp/test-project-3';

    const request: ChangelogGenerationRequest = {
      projectId,
      sourceMode: 'tasks',
      taskIds: ['task-3'],
      version: '1.0.0',
      date: new Date().toISOString(),
      format: 'keep-a-changelog',
      audience: 'technical'
    };

    const specs: TaskSpecContent[] = [
      {
        taskId: 'task-3',
        specId: '003-test-task',
        spec: '# Test Task 3\nTask that will error'
      }
    ];

    // Track events
    const errorEvents: string[] = [];

    generator.on('generation-error', (_projectId: string, error: string) => {
      errorEvents.push(error);
    });

    // Start generation
    const generatePromise = generator.generate(projectId, projectPath, request, specs);

    // Wait for spawn
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });

    // Simulate subprocess error (e.g., Python not found)
    const processError = new Error('spawn ENOENT');
    mockChildProcess.emit('error', processError);

    // Error handler should have cleared the timeout
    // Advance time past timeout to verify it doesn't fire
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes

    // Should NOT have killed the process (error already occurred)
    expect(mockChildProcess.kill).not.toHaveBeenCalled();

    // Should have process error, NOT timeout error
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toBe('spawn ENOENT');
    expect(errorEvents[0]).not.toContain('timed out');

    await generatePromise;
  });

  it('should handle multiple concurrent generations with independent timeouts', async () => {
    const projectId1 = 'project-1';
    const projectId2 = 'project-2';
    const projectPath = '/tmp/test-project';

    const request: ChangelogGenerationRequest = {
      projectId: projectId1,
      sourceMode: 'tasks',
      taskIds: ['task-1'],
      version: '1.0.0',
      date: new Date().toISOString(),
      format: 'keep-a-changelog',
      audience: 'technical'
    };

    const specs: TaskSpecContent[] = [
      {
        taskId: 'task-1',
        specId: '001-test',
        spec: '# Test'
      }
    ];

    const errorEvents: Array<{ projectId: string; error: string }> = [];

    generator.on('generation-error', (projectId: string, error: string) => {
      errorEvents.push({ projectId, error });
    });

    // Start first generation
    const gen1Promise = generator.generate(projectId1, projectPath, request, specs);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1));

    // Advance time by 2 minutes
    vi.advanceTimersByTime(2 * 60 * 1000);

    // Clear mock and set up for second process
    mockSpawn.mockClear();
    const mockChildProcess2 = new EventEmitter() as any;
    mockChildProcess2.pid = 12346;
    mockChildProcess2.kill = vi.fn(() => true);
    mockChildProcess2.stdout = new EventEmitter();
    mockChildProcess2.stderr = new EventEmitter();
    mockSpawn.mockReturnValueOnce(mockChildProcess2);

    // Start second generation with different projectId (starts 2 minutes after first)
    const request2 = { ...request, projectId: projectId2 };
    const gen2Promise = generator.generate(projectId2, projectPath, request2, specs);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1));

    // Advance time by 3 minutes and 1 second - first process should timeout (2+3 = 5 total)
    vi.advanceTimersByTime(3 * 60 * 1000 + 1000);

    // First process should timeout
    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(errorEvents.some(e => e.projectId === projectId1 && e.error.includes('timed out'))).toBe(true);

    // Second process should NOT timeout yet (only 3 minutes have passed for it)
    expect(mockChildProcess2.kill).not.toHaveBeenCalled();

    // Advance another 2 minutes - now second process should timeout (3+2 = 5 total)
    vi.advanceTimersByTime(2 * 60 * 1000);

    // Now second process should also timeout
    expect(mockChildProcess2.kill).toHaveBeenCalledWith('SIGTERM');
    expect(errorEvents.some(e => e.projectId === projectId2 && e.error.includes('timed out'))).toBe(true);

    await gen1Promise;
    await gen2Promise;
  });

  it('should not fire timeout if process already killed', async () => {
    const projectId = 'test-project-4';
    const projectPath = '/tmp/test-project-4';

    const request: ChangelogGenerationRequest = {
      projectId,
      sourceMode: 'tasks',
      taskIds: ['task-4'],
      version: '1.0.0',
      date: new Date().toISOString(),
      format: 'keep-a-changelog',
      audience: 'technical'
    };

    const specs: TaskSpecContent[] = [
      {
        taskId: 'task-4',
        specId: '004-test',
        spec: '# Test'
      }
    ];

    const errorEvents: string[] = [];

    generator.on('generation-error', (_projectId: string, error: string) => {
      errorEvents.push(error);
    });

    // Start generation
    const generatePromise = generator.generate(projectId, projectPath, request, specs);

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    // Manually cancel the generation (simulates user clicking cancel)
    generator.cancel(projectId);

    // Verify process was killed and timeout cleared
    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
    mockChildProcess.kill.mockClear();

    // Advance time past timeout
    vi.advanceTimersByTime(6 * 60 * 1000);

    // Timeout should NOT fire again (already cleared)
    expect(mockChildProcess.kill).not.toHaveBeenCalled();

    // Should have no timeout error (cancel doesn't emit error)
    expect(errorEvents.some(e => e.includes('timed out'))).toBe(false);

    await generatePromise;
  });
});
