/**
 * Subprocess runner utilities for GitHub Python runners
 *
 * Provides a consistent abstraction for spawning and managing Python subprocesses
 * with progress tracking, error handling, and result parsing.
 */

import { spawn, exec, execFile } from 'child_process';
import type { ChildProcess } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import type { Project } from '../../../../shared/types';
import type { AuthFailureInfo, BillingFailureInfo } from '../../../../shared/types/terminal';
import { parsePythonCommand } from '../../../python-detector';
import { detectAuthFailure, detectBillingFailure } from '../../../rate-limit-detector';
import { getClaudeProfileManager } from '../../../claude-profile-manager';
import { getOperationRegistry, type OperationType } from '../../../claude-profile/operation-registry';
import { isWindows, isMacOS } from '../../../platform';

const execAsync = promisify(exec);

/**
 * Create a fallback environment for Python subprocesses when no env is provided.
 * This is used for backwards compatibility when callers don't use getRunnerEnv().
 *
 * Includes:
 * - Platform-specific vars needed for shell commands and CLI tools
 * - CLAUDE_ and ANTHROPIC_ prefixed vars for authentication
 */
function createFallbackRunnerEnv(): Record<string, string> {
  // Include platform-specific vars needed for shell commands and CLI tools
  // Windows: SYSTEMROOT, COMSPEC, PATHEXT, WINDIR for shell; USERPROFILE, APPDATA, LOCALAPPDATA for gh CLI auth
  const safeEnvVars = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TMP', 'TEMP', 'DEBUG', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH'];
  const fallbackEnv: Record<string, string> = {};

  for (const key of safeEnvVars) {
    if (process.env[key]) {
      fallbackEnv[key] = process.env[key]!;
    }
  }

  // Also include any CLAUDE_ or ANTHROPIC_ prefixed vars needed for auth
  for (const [key, value] of Object.entries(process.env)) {
    if ((key.startsWith('CLAUDE_') || key.startsWith('ANTHROPIC_')) && value) {
      fallbackEnv[key] = value;
    }
  }

  return fallbackEnv;
}

/**
 * Options for running a Python subprocess
 */
export interface SubprocessOptions {
  pythonPath: string;
  args: string[];
  cwd: string;
  onProgress?: (percent: number, message: string, data?: unknown) => void;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  onComplete?: (stdout: string, stderr: string) => unknown;
  onError?: (error: string) => void;
  /** Callback when auth failure (401) is detected in output */
  onAuthFailure?: (authFailureInfo: AuthFailureInfo) => void;
  /** Callback when billing/credit exhaustion failure is detected in output */
  onBillingFailure?: (billingFailureInfo: BillingFailureInfo) => void;
  progressPattern?: RegExp;
  /** Additional environment variables to pass to the subprocess */
  env?: Record<string, string>;
  /**
   * Operation registration for proactive swap support.
   * If provided, the operation will be registered with the unified OperationRegistry.
   */
  operationRegistration?: {
    /** Unique operation ID */
    operationId: string;
    /** Operation type for categorization */
    operationType: OperationType;
    /** Optional metadata for the operation */
    metadata?: Record<string, unknown>;
    /**
     * Function to restart the operation with a new profile.
     * Should call the original function with refreshed environment.
     */
    restartFn?: (newProfileId: string) => boolean | Promise<boolean>;
  };
}

/**
 * Result from a subprocess execution
 */
export interface SubprocessResult<T = unknown> {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  data?: T;
  error?: string;
  process?: ChildProcess;
}

/**
 * Run a Python subprocess with progress tracking
 *
 * @param options - Subprocess configuration
 * @returns Object containing the child process and a promise resolving to the result
 */
export function runPythonSubprocess<T = unknown>(
  options: SubprocessOptions
): { process: ChildProcess; promise: Promise<SubprocessResult<T>> } {
  // Use the environment provided by the caller (from getRunnerEnv()).
  // getRunnerEnv() provides:
  // - pythonEnvManager.getPythonEnv() which includes PYTHONPATH for bundled packages (fixes #139)
  // - API profile environment (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN)
  // - OAuth mode clearing vars
  // - Claude OAuth token (CLAUDE_CODE_OAUTH_TOKEN)
  //
  // If no env is provided, fall back to filtered process.env for backwards compatibility.
  // Note: DEBUG is included for PR review debugging (shows LLM thinking blocks).
  let subprocessEnv: Record<string, string>;

  if (options.env) {
    // Caller provided a complete environment (from getRunnerEnv()), use it directly
    subprocessEnv = { ...options.env };
  } else {
    // Fallback: build a filtered environment for backwards compatibility
    subprocessEnv = createFallbackRunnerEnv();
  }

  // Parse Python command to handle paths with spaces (e.g., ~/Library/Application Support/...)
  const [pythonCommand, pythonBaseArgs] = parsePythonCommand(options.pythonPath);
  const child = spawn(pythonCommand, [...pythonBaseArgs, ...options.args], {
    cwd: options.cwd,
    env: subprocessEnv,
    // On Unix, detached: true creates a new process group so we can kill all children
    // On Windows, this is not needed (taskkill /T handles it)
    detached: !isWindows(),
  });

  // Register with OperationRegistry for proactive swap support
  if (options.operationRegistration) {
    const { operationId, operationType, metadata, restartFn } = options.operationRegistration;
    const profileManager = getClaudeProfileManager();
    const activeProfile = profileManager.getActiveProfile();

    if (activeProfile) {
      const operationRegistry = getOperationRegistry();

      // Create a stop function that kills the subprocess.
      // Note: This sends SIGTERM and returns immediately without waiting for process exit.
      //
      // Timing dependency for restarts:
      // - For subprocess-runner operations, restartFn returns false so no race condition
      //   (operations are non-resumable and won't be restarted, just stopped gracefully)
      // - For AgentManager operations, there's a 500ms setTimeout delay in restartTask
      //   (see agent-manager.ts line 528) that mitigates the race between kill and restart
      //
      // RestartFn implementations should handle potential overlap between process termination
      // and restart initialization if not using the setTimeout pattern.
      const stopFn = async () => {
        if (child.pid) {
          try {
            if (!isWindows()) {
              process.kill(-child.pid, 'SIGTERM');
            } else {
              execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
            }
          } catch {
            child.kill('SIGTERM');
          }
        }
      };

      // Register with OperationRegistry for tracking and proactive swap support.
      // For operations that provide a restartFn, UsageMonitor can restart them with a new profile.
      // For operations without restartFn (e.g., PR reviews which are non-resumable due to one-shot workflow),
      // we register with a no-op restartFn that returns false. This allows the swap to stop the operation
      // gracefully without attempting restart. The operation will be killed when the profile swaps,
      // which is the correct behavior for non-resumable operations.
      operationRegistry.registerOperation(
        operationId,
        operationType,
        activeProfile.id,
        activeProfile.name,
        restartFn || (() => false), // Use provided restartFn or a no-op for non-resumable operations
        {
          stopFn,
          metadata: { ...metadata, pythonPath: options.pythonPath, cwd: options.cwd }
        }
      );

      console.log('[SubprocessRunner] Operation registered with OperationRegistry:', {
        operationId,
        operationType,
        profileId: activeProfile.id,
        profileName: activeProfile.name
      });
    }
  }

  const promise = new Promise<SubprocessResult<T>>((resolve) => {

    let stdout = '';
    let stderr = '';
    let authFailureEmitted = false; // Track if we've already emitted an auth failure
    let killedDueToAuthFailure = false; // Track if subprocess was killed due to auth failure
    let billingFailureEmitted = false; // Track if we've already emitted a billing failure
    let killedDueToBillingFailure = false; // Track if subprocess was killed due to billing failure

    // Default progress pattern: [ 30%] message OR [30%] message
    const progressPattern = options.progressPattern ?? /\[\s*(\d+)%\]\s*(.+)/;

    // Helper to check for auth failures in output and emit once
    const checkAuthFailure = (line: string) => {
      if (authFailureEmitted || !options.onAuthFailure) return;

      const authResult = detectAuthFailure(line);
      if (authResult.isAuthFailure) {
        authFailureEmitted = true;
        console.log('[SubprocessRunner] Auth failure detected in real-time:', authResult);

        // Get profile info for display
        const profileManager = getClaudeProfileManager();
        const profile = authResult.profileId
          ? profileManager.getProfile(authResult.profileId)
          : profileManager.getActiveProfile();

        const authFailureInfo: AuthFailureInfo = {
          profileId: authResult.profileId || profile?.id || 'unknown',
          profileName: profile?.name,
          failureType: authResult.failureType || 'unknown',
          message: authResult.message || 'Authentication failed. Please re-authenticate.',
          originalError: authResult.originalError,
          detectedAt: new Date(),
        };

        try {
          options.onAuthFailure(authFailureInfo);
        } catch (e) {
          console.error('[SubprocessRunner] onAuthFailure callback threw:', e);
        }

        // Kill the subprocess to stop the auth failure spam
        killedDueToAuthFailure = true;
        // The process is stuck in a loop of 401 errors - no point continuing
        console.log('[SubprocessRunner] Killing subprocess due to auth failure, pid:', child.pid);

        // Use process.kill with negative PID to kill the entire process group on Unix
        // This ensures child processes (like the Claude SDK subprocess) are also killed
        if (child.pid) {
          try {
            // On Unix, negative PID kills the process group
            if (!isWindows()) {
              process.kill(-child.pid, 'SIGKILL');
            } else {
              // On Windows, use taskkill to kill the process tree
              execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], (err: Error | null) => {
                if (err) console.warn('[SubprocessRunner] taskkill error (process may have already exited):', err.message);
              });
            }
          } catch (err) {
            // Fallback to regular kill if process group kill fails
            console.log('[SubprocessRunner] Process group kill failed, using regular kill:', err);
            child.kill('SIGKILL');
          }
        } else {
          child.kill('SIGKILL');
        }
      }
    };

    // Helper to check for billing/credit failures in output and emit once
    const checkBillingFailure = (line: string) => {
      if (billingFailureEmitted || !options.onBillingFailure) return;

      const billingResult = detectBillingFailure(line);
      if (billingResult.isBillingFailure) {
        billingFailureEmitted = true;
        console.log('[SubprocessRunner] Billing failure detected in real-time:', billingResult);

        // Get profile info for display
        const profileManager = getClaudeProfileManager();
        const profile = billingResult.profileId
          ? profileManager.getProfile(billingResult.profileId)
          : profileManager.getActiveProfile();

        const billingFailureInfo: BillingFailureInfo = {
          profileId: billingResult.profileId || profile?.id || 'unknown',
          profileName: profile?.name,
          failureType: billingResult.failureType || 'unknown',
          message: billingResult.message || 'Billing or credit error. Please check your account.',
          originalError: billingResult.originalError,
          detectedAt: new Date(),
        };

        try {
          options.onBillingFailure(billingFailureInfo);
        } catch (e) {
          console.error('[SubprocessRunner] onBillingFailure callback threw:', e);
        }

        // Kill the subprocess to stop the billing failure spam
        killedDueToBillingFailure = true;
        // The process is stuck in billing errors - no point continuing
        console.log('[SubprocessRunner] Killing subprocess due to billing failure, pid:', child.pid);

        // Use process.kill with negative PID to kill the entire process group on Unix
        // This ensures child processes (like the Claude SDK subprocess) are also killed
        if (child.pid) {
          try {
            // On Unix, negative PID kills the process group
            if (!isWindows()) {
              process.kill(-child.pid, 'SIGKILL');
            } else {
              // On Windows, use taskkill to kill the process tree
              execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], (err: Error | null) => {
                if (err) console.warn('[SubprocessRunner] taskkill error (process may have already exited):', err.message);
              });
            }
          } catch (err) {
            // Fallback to regular kill if process group kill fails
            console.log('[SubprocessRunner] Process group kill failed, using regular kill:', err);
            child.kill('SIGKILL');
          }
        } else {
          child.kill('SIGKILL');
        }
      }
    };

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      stdout += text;

      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          // Call custom stdout handler
          options.onStdout?.(line);

          // Check for auth failures in real-time (only emit once)
          checkAuthFailure(line);

          // Check for billing/credit failures in real-time (only emit once)
          checkBillingFailure(line);

          // Parse progress updates
          const match = line.match(progressPattern);
          if (match && options.onProgress) {
            const percent = parseInt(match[1], 10);
            const message = match[2].trim();
            options.onProgress(percent, message);
          }
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      stderr += text;

      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          options.onStderr?.(line);

          // Also check stderr for auth failures
          checkAuthFailure(line);

          // Also check stderr for billing/credit failures
          checkBillingFailure(line);
        }
      }
    });

    child.on('close', (code: number | null) => {
      // Treat null exit code (killed with SIGKILL) as failure, not success
      const exitCode = code ?? -1;

      // Unregister from OperationRegistry when process exits
      if (options.operationRegistration) {
        getOperationRegistry().unregisterOperation(options.operationRegistration.operationId);
      }

      // Debug logging only in development mode
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] Process exited with code:', exitCode, '(raw:', code, ')');
        console.log('[DEBUG] Raw stdout length:', stdout.length);
        console.log('[DEBUG] Raw stdout (first 1000 chars):', stdout.substring(0, 1000));
        console.log('[DEBUG] Raw stderr (first 500 chars):', stderr.substring(0, 500));
      }

      // Note: Auth failure detection now happens in real-time during stdout/stderr processing
      // (see checkAuthFailure helper above). This ensures the modal appears immediately,
      // not just when the process exits.

      // Check if subprocess was killed due to auth failure
      if (killedDueToAuthFailure) {
        resolve({
          success: false,
          exitCode: exitCode,
          stdout,
          stderr,
          error: 'Authentication failed. Please re-authenticate.',
        });
        return;
      }

      // Check if subprocess was killed due to billing/credit failure
      if (killedDueToBillingFailure) {
        resolve({
          success: false,
          exitCode: exitCode,
          stdout,
          stderr,
          error: 'Billing or credit error. Please check your account.',
        });
        return;
      }

      if (exitCode === 0) {
        try {
          const data = options.onComplete?.(stdout, stderr);
          resolve({
            success: true,
            exitCode,
            stdout,
            stderr,
            data: data as T,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          options.onError?.(errorMessage);
          resolve({
            success: false,
            exitCode,
            stdout,
            stderr,
            error: errorMessage,
          });
        }
      } else {
        const errorMessage = stderr || `Process failed with code ${exitCode}`;
        options.onError?.(errorMessage);
        resolve({
          success: false,
          exitCode,
          stdout,
          stderr,
          error: errorMessage,
        });
      }
    });

    child.on('error', (err: Error) => {
      options.onError?.(err.message);
      resolve({
        success: false,
        exitCode: -1,
        stdout,
        stderr,
        error: err.message,
      });
    });
  });

  return { process: child, promise };
}

/**
 * Get the Python path for a project's backend
 * Cross-platform: uses Scripts/python.exe on Windows, bin/python on Unix
 */
export function getPythonPath(backendPath: string): string {
  return isWindows()
    ? path.join(backendPath, '.venv', 'Scripts', 'python.exe')
    : path.join(backendPath, '.venv', 'bin', 'python');
}

/**
 * Get the GitHub runner path for a project
 */
export function getRunnerPath(backendPath: string): string {
  return path.join(backendPath, 'runners', 'github', 'runner.py');
}

/**
 * Get the auto-claude backend path for a project
 *
 * Auto-detects the backend location using multiple strategies:
 * 1. Development repo structure (apps/backend)
 * 2. Electron app bundle location
 * 3. Current working directory
 */
export function getBackendPath(project: Project): string | null {
  // Import app module for production path detection
  let app: any;
  try {
    app = require('electron').app;
  } catch {
    // Electron not available in tests
  }

  // Check if this is a development repo (has apps/backend structure)
  const appsBackendPath = path.join(project.path, 'apps', 'backend');
  if (fs.existsSync(path.join(appsBackendPath, 'runners', 'github', 'runner.py'))) {
    return appsBackendPath;
  }

  // Auto-detect from app location (same logic as agent-process.ts)
  const possiblePaths = [
    // Dev mode: from dist/main -> ../../backend (apps/frontend/out/main -> apps/backend)
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'backend'),
    // Alternative: from app root -> apps/backend
    app ? path.resolve(app.getAppPath(), '..', 'backend') : null,
    // If running from repo root with apps structure
    path.resolve(process.cwd(), 'apps', 'backend'),
  ].filter((p): p is string => p !== null);

  for (const backendPath of possiblePaths) {
    // Check for runner.py as marker
    const runnerPath = path.join(backendPath, 'runners', 'github', 'runner.py');
    if (fs.existsSync(runnerPath)) {
      return backendPath;
    }
  }

  return null;
}

/**
 * Comprehensive validation result for GitHub module
 */
export interface GitHubModuleValidation {
  valid: boolean;
  runnerAvailable: boolean;
  ghCliInstalled: boolean;
  ghAuthenticated: boolean;
  pythonEnvValid: boolean;
  error?: string;
  backendPath?: string;
}

/**
 * Validate that the GitHub runner exists (synchronous, legacy)
 * @deprecated Use validateGitHubModule() for comprehensive async validation
 */
export function validateRunner(backendPath: string | null): { valid: boolean; error?: string } {
  if (!backendPath) {
    return {
      valid: false,
      error: 'GitHub runner not found. Make sure the GitHub automation module is installed.',
    };
  }

  const runnerPath = getRunnerPath(backendPath);
  if (!fs.existsSync(runnerPath)) {
    return {
      valid: false,
      error: `GitHub runner not found at: ${runnerPath}`,
    };
  }

  return { valid: true };
}

/**
 * Comprehensive async validation of GitHub automation module
 *
 * Checks:
 * 1. runner.py exists (dev repo or production install)
 * 2. gh CLI is installed
 * 3. gh CLI is authenticated
 * 4. Python virtual environment is set up
 *
 * @param project - The project to validate
 * @returns Detailed validation result with specific error messages
 */
export async function validateGitHubModule(project: Project): Promise<GitHubModuleValidation> {
  const result: GitHubModuleValidation = {
    valid: false,
    runnerAvailable: false,
    ghCliInstalled: false,
    ghAuthenticated: false,
    pythonEnvValid: false,
  };

  // 1. Check runner.py location
  const backendPath = getBackendPath(project);
  if (!backendPath) {
    result.error = 'GitHub automation module not installed. This project does not have the GitHub runner configured.';
    return result;
  }

  result.backendPath = backendPath;

  const runnerPath = getRunnerPath(backendPath);
  result.runnerAvailable = fs.existsSync(runnerPath);

  if (!result.runnerAvailable) {
    result.error = `GitHub runner script not found at: ${runnerPath}`;
    return result;
  }

  // 2. Check gh CLI installation (cross-platform)
  try {
    const whichCommand = isWindows() ? 'where gh' : 'which gh';
    await execAsync(whichCommand);
    result.ghCliInstalled = true;
  } catch {
    result.ghCliInstalled = false;
    const installInstructions = isWindows()
      ? 'winget install --id GitHub.cli'
      : isMacOS()
        ? 'brew install gh'
        : 'See https://cli.github.com/';
    result.error = `GitHub CLI (gh) is not installed. Install it with:\n  ${installInstructions}`;
    return result;
  }

  // 3. Check gh authentication
  try {
    await execAsync('gh auth status 2>&1');
    result.ghAuthenticated = true;
  } catch (error: any) {
    // gh auth status returns non-zero when not authenticated
    // Check the output to determine if it's an auth issue
    const output = error.stdout || error.stderr || '';
    if (output.includes('not logged in') || output.includes('not authenticated')) {
      result.ghAuthenticated = false;
      result.error = 'GitHub CLI is not authenticated. Run:\n  gh auth login';
      return result;
    }
    // If it's some other error, still consider it authenticated (might be network issue)
    result.ghAuthenticated = true;
  }

  // 4. Check Python virtual environment (cross-platform)
  const venvPath = getPythonPath(backendPath);
  result.pythonEnvValid = fs.existsSync(venvPath);

  if (!result.pythonEnvValid) {
    result.error = `Python virtual environment not found. Run setup:\n  cd ${backendPath}\n  uv venv && uv pip install -r requirements.txt`;
    return result;
  }

  // All checks passed
  result.valid = true;
  return result;
}

/**
 * Parse JSON from stdout (finds JSON block in output)
 */
export function parseJSONFromOutput<T>(stdout: string): T {
  // Look for JSON after the "JSON Output" marker to avoid debug output
  const jsonMarker = 'JSON Output';
  const markerIndex = stdout.lastIndexOf(jsonMarker);
  const searchStart = markerIndex >= 0 ? markerIndex : 0;

  // Try to find JSON array first, then object
  const arrayStart = stdout.indexOf('[', searchStart);
  const objectStart = stdout.indexOf('{', searchStart);

  let jsonStart = -1;
  let jsonEnd = -1;

  // Determine if it's an array or object (whichever comes first)
  if (arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)) {
    // It's an array
    jsonStart = arrayStart;
    jsonEnd = stdout.lastIndexOf(']');
  } else if (objectStart >= 0) {
    // It's an object
    jsonStart = objectStart;
    jsonEnd = stdout.lastIndexOf('}');
  }

  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    let jsonStr = stdout.substring(jsonStart, jsonEnd + 1);

    // Clean up debug output prefixes and markdown code blocks
    jsonStr = jsonStr
      .split('\n')
      .map(line => {
        // Remove common debug prefixes
        const debugPrefixes = [
          /^\[GitHub AutoFix\] STDOUT:\s*/,
          /^\[GitHub AutoFix\] STDERR:\s*/,
          /^\[[A-Za-z][^\]]*\]\s*/,  // Any other bracketed prefix (must start with letter to avoid matching JSON arrays)
        ];

        let cleaned = line;
        for (const prefix of debugPrefixes) {
          cleaned = cleaned.replace(prefix, '');
        }
        return cleaned;
      })
      .filter(line => {
        // Remove markdown code block markers
        const trimmed = line.trim();
        return trimmed !== '```json' && trimmed !== '```';
      })
      .join('\n');

    try {
      // Debug: log the exact string we're trying to parse
      console.log('[DEBUG] Attempting to parse JSON:', jsonStr.substring(0, 200) + '...');
      return JSON.parse(jsonStr);
    } catch (parseError) {
      // Provide a more helpful error message with details
      console.error('[DEBUG] JSON parse failed:', parseError);
      console.error('[DEBUG] JSON string (first 500 chars):', jsonStr.substring(0, 500));
      throw new Error('Failed to parse JSON response from backend. The analysis completed but the response format was invalid.');
    }
  }

  throw new Error('No JSON found in output');
}

/**
 * Build standard GitHub runner arguments
 */
export function buildRunnerArgs(
  runnerPath: string,
  projectPath: string,
  command: string,
  additionalArgs: string[] = [],
  options?: {
    model?: string;
    thinkingLevel?: string;
  }
): string[] {
  const args = [runnerPath, '--project', projectPath];

  if (options?.model) {
    args.push('--model', options.model);
  }

  if (options?.thinkingLevel) {
    args.push('--thinking-level', options.thinkingLevel);
  }

  args.push(command);
  args.push(...additionalArgs);

  return args;
}
