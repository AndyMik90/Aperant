import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import type {
  ChangelogGenerationRequest,
  ChangelogGenerationResult,
  ChangelogGenerationProgress,
  TaskSpecContent
} from '../../shared/types';
import { buildChangelogPrompt, buildGitPrompt, createGenerationScript } from './formatter';
import { extractChangelog } from './parser';
import { getCommits, getBranchDiffCommits } from './git-integration';
import { detectRateLimit, createSDKRateLimitInfo, getBestAvailableProfileEnv } from '../rate-limit-detector';
import { parsePythonCommand } from '../python-detector';
import { getAugmentedEnv } from '../env-utils';
import { isWindows } from '../platform';

/**
 * Core changelog generation logic
 * Handles AI generation via Claude CLI subprocess
 */
export class ChangelogGenerator extends EventEmitter {
  private generationProcesses: Map<string, ReturnType<typeof spawn>> = new Map();
  private generationTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private debugEnabled: boolean;

  constructor(
    private pythonPath: string,
    private claudePath: string,
    private autoBuildSourcePath: string,
    private autoBuildEnv: Record<string, string>,
    debugEnabled: boolean
  ) {
    super();
    this.debugEnabled = debugEnabled;
  }

  private debug(...args: unknown[]): void {
    if (this.debugEnabled) {
      console.warn('[ChangelogGenerator]', ...args);
    }
  }

  /**
   * Generate changelog using Claude AI
   * Supports multiple source modes: tasks (specs), git-history, or branch-diff
   */
  async generate(
    projectId: string,
    projectPath: string,
    request: ChangelogGenerationRequest,
    specs?: TaskSpecContent[]
  ): Promise<void> {
    const sourceMode = request.sourceMode || 'tasks';

    this.debug('generate called', {
      projectId,
      projectPath,
      sourceMode,
      taskCount: request.taskIds?.length || 0,
      version: request.version,
      format: request.format,
      audience: request.audience
    });

    // Kill existing process if any
    this.cancel(projectId);

    let prompt: string;
    let itemCount: number;

    // Handle different source modes
    if (sourceMode === 'git-history' && request.gitHistory) {
      // Git history mode
      this.emitProgress(projectId, {
        stage: 'loading_commits',
        progress: 10,
        message: 'Loading commits from git history...'
      });

      const commits = getCommits(projectPath, request.gitHistory, this.debugEnabled);
      if (commits.length === 0) {
        this.emitError(projectId, 'No commits found for the specified range');
        return;
      }

      prompt = buildGitPrompt(request, commits);
      itemCount = commits.length;

    } else if (sourceMode === 'branch-diff' && request.branchDiff) {
      // Branch diff mode
      this.emitProgress(projectId, {
        stage: 'loading_commits',
        progress: 10,
        message: `Loading commits between ${request.branchDiff.baseBranch} and ${request.branchDiff.compareBranch}...`
      });

      const commits = getBranchDiffCommits(projectPath, request.branchDiff, this.debugEnabled);
      if (commits.length === 0) {
        this.emitError(projectId, 'No commits found between the specified branches');
        return;
      }

      prompt = buildGitPrompt(request, commits);
      itemCount = commits.length;

    } else {
      // Tasks mode (original behavior)
      if (!specs || specs.length === 0) {
        this.emitError(projectId, 'No specs provided for changelog generation');
        return;
      }

      this.emitProgress(projectId, {
        stage: 'loading_specs',
        progress: 10,
        message: 'Preparing changelog generation...'
      });

      prompt = buildChangelogPrompt(request, specs);
      itemCount = specs.length;
    }

    this.debug('Prompt built', {
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 500) + '...'
    });

    // Create Python script
    const script = createGenerationScript(prompt, this.claudePath);
    this.debug('Python script created', { scriptLength: script.length });

    this.emitProgress(projectId, {
      stage: 'generating',
      progress: 30,
      message: 'Generating changelog with Claude AI...'
    });

    const startTime = Date.now();
    this.debug('Spawning Python process...');

    // Build environment with explicit critical variables
    const spawnEnv = this.buildSpawnEnvironment();

    // Parse Python command to handle space-separated commands like "py -3"
    const [pythonCommand, pythonBaseArgs] = parsePythonCommand(this.pythonPath);
    const childProcess = spawn(pythonCommand, [...pythonBaseArgs, '-c', script], {
      cwd: this.autoBuildSourcePath,
      env: spawnEnv
    });

    this.generationProcesses.set(projectId, childProcess);
    this.debug('Process spawned with PID:', childProcess.pid);

    // Set 5-minute timeout
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    const timeoutId = setTimeout(() => {
      this.debug('Process timed out after 5 minutes');
      this.generationTimeouts.delete(projectId);

      // Kill the process
      const proc = this.generationProcesses.get(projectId);
      if (proc) {
        proc.kill('SIGTERM');
        this.generationProcesses.delete(projectId);
      }

      // Emit timeout error
      this.emitError(projectId, 'Changelog generation timed out after 5 minutes');
    }, TIMEOUT_MS);

    this.generationTimeouts.set(projectId, timeoutId);

    let output = '';
    let errorOutput = '';

    childProcess.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString('utf-8');
      output += chunk;
      this.debug('stdout chunk received', { chunkLength: chunk.length, totalOutput: output.length });

      this.emitProgress(projectId, {
        stage: 'generating',
        progress: 50,
        message: 'Generating changelog content...'
      });
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString('utf-8');
      errorOutput += chunk;
      this.debug('stderr chunk received', { chunk: chunk.substring(0, 200) });
    });

    childProcess.on('exit', (code: number | null) => {
      const duration = Date.now() - startTime;
      this.debug('Process exited', {
        code,
        duration: `${duration}ms`,
        outputLength: output.length,
        errorLength: errorOutput.length
      });

      // Clear timeout
      const existingTimeout = this.generationTimeouts.get(projectId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.generationTimeouts.delete(projectId);
      }

      // Guard: if process was already removed (e.g. by timeout or cancel), skip
      if (!this.generationProcesses.delete(projectId)) {
        this.debug('Process already cleaned up (timeout or cancel), skipping exit handler');
        return;
      }

      if (code === 0 && output.trim()) {
        this.emitProgress(projectId, {
          stage: 'formatting',
          progress: 90,
          message: 'Formatting changelog...'
        });

        // Extract changelog from output
        const changelog = extractChangelog(output.trim());
        this.debug('Changelog extracted', { changelogLength: changelog.length });

        this.emitProgress(projectId, {
          stage: 'complete',
          progress: 100,
          message: 'Changelog generation complete'
        });

        const result: ChangelogGenerationResult = {
          success: true,
          changelog,
          version: request.version,
          tasksIncluded: itemCount
        };

        this.debug('Generation complete, emitting result');
        this.emit('generation-complete', projectId, result);
      } else {
        // Combine all output for error analysis
        const combinedOutput = `${output}\n${errorOutput}`;
        const error = errorOutput || `Generation failed with exit code ${code}`;

        // Check for rate limit
        const rateLimitDetection = detectRateLimit(combinedOutput);
        if (rateLimitDetection.isRateLimited) {
          this.debug('Rate limit detected in changelog generation', {
            resetTime: rateLimitDetection.resetTime,
            limitType: rateLimitDetection.limitType,
            suggestedProfile: rateLimitDetection.suggestedProfile?.name
          });

          // Emit rate limit event
          const rateLimitInfo = createSDKRateLimitInfo('changelog', rateLimitDetection, { projectId });
          this.emit('rate-limit', projectId, rateLimitInfo);
        }

        this.debug('Generation failed', { error: error.substring(0, 500), isRateLimited: rateLimitDetection.isRateLimited });
        this.emitError(projectId, error);
      }
    });

    childProcess.on('error', (err: Error) => {
      this.debug('Process error', { error: err.message });

      // Clear timeout
      const timeoutId = this.generationTimeouts.get(projectId);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.generationTimeouts.delete(projectId);
      }

      if (!this.generationProcesses.delete(projectId)) {
        this.debug('Process already cleaned up, skipping error handler');
        return;
      }
      this.emitError(projectId, err.message);
    });
  }

  /**
   * Build spawn environment with proper PATH and auth settings
   */
  private buildSpawnEnvironment(): Record<string, string> {
    const homeDir = os.homedir();

    // Use getAugmentedEnv() to ensure common tool paths are available
    // even when app is launched from Finder/Dock
    const augmentedEnv = getAugmentedEnv();

    // Get best available Claude profile environment (automatically handles rate limits)
    const profileResult = getBestAvailableProfileEnv();
    const profileEnv = profileResult.env;
    this.debug('Active profile environment', {
      hasOAuthToken: !!profileEnv.CLAUDE_CODE_OAUTH_TOKEN,
      hasConfigDir: !!profileEnv.CLAUDE_CONFIG_DIR,
      authMethod: profileEnv.CLAUDE_CODE_OAUTH_TOKEN ? 'oauth-token' : (profileEnv.CLAUDE_CONFIG_DIR ? 'config-dir' : 'default'),
      wasSwapped: profileResult.wasSwapped,
      selectedProfile: profileResult.profileName
    });

    const spawnEnv: Record<string, string> = {
      ...augmentedEnv,
      ...this.autoBuildEnv,
      ...profileEnv, // Include active Claude profile config
      // Ensure critical env vars are set for claude CLI
      // Use USERPROFILE on Windows, HOME on Unix
      ...(isWindows() ? { USERPROFILE: homeDir } : { HOME: homeDir }),
      USER: process.env.USER || process.env.USERNAME || 'user',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    };

    this.debug('Spawn environment', {
      HOME: spawnEnv.HOME,
      USER: spawnEnv.USER,
      pathDirs: spawnEnv.PATH?.split(path.delimiter).length,
      authMethod: spawnEnv.CLAUDE_CODE_OAUTH_TOKEN ? 'oauth-token' : (spawnEnv.CLAUDE_CONFIG_DIR ? `config-dir:${spawnEnv.CLAUDE_CONFIG_DIR}` : 'default')
    });

    return spawnEnv;
  }

  /**
   * Cancel ongoing generation
   */
  cancel(projectId: string): boolean {
    // Clear timeout
    const timeoutId = this.generationTimeouts.get(projectId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.generationTimeouts.delete(projectId);
    }

    const process = this.generationProcesses.get(projectId);
    if (process) {
      process.kill('SIGTERM');
      this.generationProcesses.delete(projectId);
      return true;
    }
    return false;
  }

  /**
   * Emit progress update
   */
  private emitProgress(projectId: string, progress: ChangelogGenerationProgress): void {
    this.emit('generation-progress', projectId, progress);
  }

  /**
   * Emit error
   */
  private emitError(projectId: string, error: string): void {
    this.emit('generation-progress', projectId, {
      stage: 'error',
      progress: 0,
      message: error,
      error
    });
    this.emit('generation-error', projectId, error);
  }
}
