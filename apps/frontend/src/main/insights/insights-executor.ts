import { spawn, ChildProcess } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import type {
  InsightsChatMessage,
  InsightsChatStatus,
  InsightsStreamChunk,
  InsightsToolUsage,
  InsightsModelConfig
} from '../../shared/types';
import { MODEL_ID_MAP } from '../../shared/constants';
import { InsightsConfig } from './config';
import { detectRateLimit, createSDKRateLimitInfo } from '../rate-limit-detector';

/**
 * Message processor result
 */
interface ProcessorResult {
  fullResponse: string;
  suggestedTask?: InsightsChatMessage['suggestedTask'];
  suggestedTasks: Array<{ task: NonNullable<InsightsChatMessage['suggestedTask']>; textBefore: string }>;
  trailingText: string;
  toolsUsed: InsightsToolUsage[];
}

// Maximum total execution time (15 minutes — large tasks with 50 turns need time)
const MAX_EXECUTION_MS = 15 * 60 * 1000;
// Kill process if no stdout/stderr activity for this long (3 minutes — Claude thinking can take a while)
const ACTIVITY_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Kill a process and all its children by process group.
 * Spawning with detached=true puts the child in its own process group,
 * so we can kill the entire group (Python + Claude SDK binary) at once.
 */
function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) {
    proc.kill();
    return;
  }
  try {
    // Negative PID sends signal to entire process group
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    // Fallback: kill the process directly
    try { proc.kill('SIGKILL'); } catch { /* already dead */ }
  }
}

/**
 * Python process executor for insights
 * Handles spawning and managing the Python insights runner process
 */
export class InsightsExecutor extends EventEmitter {
  private config: InsightsConfig;
  private activeSessions: Map<string, ChildProcess> = new Map();
  private activeTimers: Map<string, { hard: ReturnType<typeof setTimeout>; activity: ReturnType<typeof setTimeout> }> = new Map();

  constructor(config: InsightsConfig) {
    super();
    this.config = config;
  }

  /**
   * Check if a session is currently active
   */
  isSessionActive(projectId: string): boolean {
    return this.activeSessions.has(projectId);
  }

  /**
   * Cancel an active session
   */
  cancelSession(projectId: string): boolean {
    const existingProcess = this.activeSessions.get(projectId);
    if (!existingProcess) return false;

    this.clearTimers(projectId);
    killProcessTree(existingProcess);
    this.activeSessions.delete(projectId);
    return true;
  }

  /**
   * Clear timeout timers for a session
   */
  private clearTimers(projectId: string): void {
    const timers = this.activeTimers.get(projectId);
    if (timers) {
      clearTimeout(timers.hard);
      clearTimeout(timers.activity);
      this.activeTimers.delete(projectId);
    }
  }

  /**
   * Reset the activity timer (called on any stdout/stderr output)
   */
  private resetActivityTimer(projectId: string, proc: ChildProcess): void {
    const timers = this.activeTimers.get(projectId);
    if (!timers) return;

    clearTimeout(timers.activity);
    timers.activity = setTimeout(() => {
      console.warn(`[Insights] Activity timeout for ${projectId} — no output for ${ACTIVITY_TIMEOUT_MS / 1000}s, killing process`);
      this.activeSessions.delete(projectId);
      this.activeTimers.delete(projectId);
      killProcessTree(proc);
    }, ACTIVITY_TIMEOUT_MS);
  }

  /**
   * Execute insights query
   */
  async execute(
    projectId: string,
    projectPath: string,
    message: string,
    conversationHistory: Array<{ role: string; content: string }>,
    modelConfig?: InsightsModelConfig,
    imagePaths?: string[]
  ): Promise<ProcessorResult> {
    // Cancel any existing session
    this.cancelSession(projectId);

    const autoBuildSource = this.config.getAutoBuildSourcePath();
    if (!autoBuildSource) {
      throw new Error('Auto Claude source not found');
    }

    const runnerPath = path.join(autoBuildSource, 'runners', 'insights_runner.py');
    if (!existsSync(runnerPath)) {
      throw new Error('insights_runner.py not found in auto-claude directory');
    }

    // Emit thinking status
    this.emit('status', projectId, {
      phase: 'thinking',
      message: 'Processing your message...'
    } as InsightsChatStatus);

    // Get process environment
    const processEnv = await this.config.getProcessEnv();

    // Write conversation history to temp file to avoid Windows command-line length limit
    const historyFile = path.join(
      os.tmpdir(),
      `insights-history-${projectId}-${Date.now()}.json`
    );

    let historyFileCreated = false;
    try {
      writeFileSync(historyFile, JSON.stringify(conversationHistory), 'utf-8');
      historyFileCreated = true;
    } catch (err) {
      console.error('[Insights] Failed to write history file:', err);
      throw new Error('Failed to write conversation history to temp file');
    }

    // Build command arguments
    const args = [
      runnerPath,
      '--project-dir', projectPath,
      '--message', message,
      '--history-file', historyFile
    ];

    // Add model config if provided
    if (modelConfig) {
      const modelId = MODEL_ID_MAP[modelConfig.model] || MODEL_ID_MAP['sonnet'];
      args.push('--model', modelId);
      args.push('--thinking-level', modelConfig.thinkingLevel);
    }

    // Add image attachments if provided
    if (imagePaths && imagePaths.length > 0) {
      args.push('--images', JSON.stringify(imagePaths));
    }

    // Spawn Python process in its own process group (detached) so we can
    // kill the entire tree (Python + Claude SDK binary) on timeout/cancel.
    // Do NOT unref() — we need stdio pipes to stay open while reading output.
    const proc = spawn(this.config.getPythonPath(), args, {
      cwd: autoBuildSource,
      env: processEnv,
      detached: true
    });

    this.activeSessions.set(projectId, proc);

    // Start timeout timers
    const hardTimer = setTimeout(() => {
      console.warn(`[Insights] Hard timeout for ${projectId} — exceeded ${MAX_EXECUTION_MS / 1000}s, killing process tree`);
      this.activeSessions.delete(projectId);
      this.activeTimers.delete(projectId);
      killProcessTree(proc);
    }, MAX_EXECUTION_MS);

    const activityTimer = setTimeout(() => {
      console.warn(`[Insights] Activity timeout for ${projectId} — no output for ${ACTIVITY_TIMEOUT_MS / 1000}s, killing process tree`);
      this.activeSessions.delete(projectId);
      this.activeTimers.delete(projectId);
      killProcessTree(proc);
    }, ACTIVITY_TIMEOUT_MS);

    this.activeTimers.set(projectId, { hard: hardTimer, activity: activityTimer });

    return new Promise((resolve, reject) => {
      let fullResponse = '';
      let suggestedTask: InsightsChatMessage['suggestedTask'] | undefined;
      const suggestedTasks: ProcessorResult['suggestedTasks'] = [];
      let textSinceLastSuggestion = '';
      const toolsUsed: InsightsToolUsage[] = [];
      let allInsightsOutput = '';
      let stderrOutput = '';

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        // Reset activity timer on any output
        this.resetActivityTimer(projectId, proc);
        // Collect output for rate limit detection (keep last 10KB)
        allInsightsOutput = (allInsightsOutput + text).slice(-10000);

        // Process output lines
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('__TASK_SUGGESTION__:')) {
            this.handleTaskSuggestion(projectId, line, (task) => {
              suggestedTask = task;
              if (task) {
                suggestedTasks.push({ task, textBefore: textSinceLastSuggestion.trim() });
                textSinceLastSuggestion = '';
              }
            });
          } else if (line.startsWith('__TOOL_START__:')) {
            this.handleToolStart(projectId, line, toolsUsed);
          } else if (line.startsWith('__TOOL_END__:')) {
            this.handleToolEnd(projectId, line);
          } else if (line.trim()) {
            fullResponse += line + '\n';
            textSinceLastSuggestion += line + '\n';
            this.emit('stream-chunk', projectId, {
              type: 'text',
              content: line + '\n'
            } as InsightsStreamChunk);
          }
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        // Reset activity timer on any output (stderr counts as activity)
        this.resetActivityTimer(projectId, proc);
        // Collect stderr for rate limit detection and error reporting
        allInsightsOutput = (allInsightsOutput + text).slice(-10000);
        stderrOutput = (stderrOutput + text).slice(-2000);
        console.error('[Insights]', text);
      });

      proc.on('close', (code) => {
        this.clearTimers(projectId);
        this.activeSessions.delete(projectId);

        // Cleanup temp file
        if (historyFileCreated && existsSync(historyFile)) {
          try {
            unlinkSync(historyFile);
          } catch (cleanupErr) {
            console.error('[Insights] Failed to cleanup history file:', cleanupErr);
          }
        }

        // Check for rate limit if process failed
        if (code !== 0) {
          this.handleRateLimit(projectId, allInsightsOutput);
        }

        // code === 0: normal exit
        // code === null: killed by signal (timeout/cancel) — still resolve if we got content
        const wasKilled = code === null;
        const hasContent = fullResponse.trim().length > 0;

        if (code === 0 || (wasKilled && hasContent)) {
          this.emit('stream-chunk', projectId, {
            type: 'done'
          } as InsightsStreamChunk);

          this.emit('status', projectId, {
            phase: 'complete'
          } as InsightsChatStatus);

          resolve({
            fullResponse: fullResponse.trim(),
            suggestedTask,
            suggestedTasks,
            trailingText: textSinceLastSuggestion.trim(),
            toolsUsed
          });
        } else {
          // Include stderr output in error message for debugging
          const stderrSummary = stderrOutput.trim()
            ? `\n\nError output:\n${stderrOutput.slice(-500)}`
            : '';
          const reason = wasKilled ? 'Process was stopped (timeout or cancelled)' : `Process exited with code ${code}`;
          const error = `${reason}${stderrSummary}`;
          this.emit('stream-chunk', projectId, {
            type: 'error',
            error
          } as InsightsStreamChunk);

          this.emit('error', projectId, error);
          reject(new Error(error));
        }
      });

      proc.on('error', (err) => {
        this.clearTimers(projectId);
        this.activeSessions.delete(projectId);

        // Cleanup temp file
        if (historyFileCreated && existsSync(historyFile)) {
          try {
            unlinkSync(historyFile);
          } catch (cleanupErr) {
            console.error('[Insights] Failed to cleanup history file:', cleanupErr);
          }
        }

        this.emit('error', projectId, err.message);
        reject(err);
      });
    });
  }

  /**
   * Handle task suggestion from output
   */
  private handleTaskSuggestion(
    projectId: string,
    line: string,
    onTaskFound: (task: InsightsChatMessage['suggestedTask']) => void
  ): void {
    try {
      const taskJson = line.substring('__TASK_SUGGESTION__:'.length);
      const suggestedTask = JSON.parse(taskJson);
      onTaskFound(suggestedTask);
      this.emit('stream-chunk', projectId, {
        type: 'task_suggestion',
        suggestedTask
      } as InsightsStreamChunk);
    } catch {
      // Not valid JSON, treat as normal text (should not emit here as it's already handled)
    }
  }

  /**
   * Handle tool start marker
   */
  private handleToolStart(
    projectId: string,
    line: string,
    toolsUsed: InsightsToolUsage[]
  ): void {
    try {
      const toolJson = line.substring('__TOOL_START__:'.length);
      const toolData = JSON.parse(toolJson);
      // Accumulate tool usage for persistence
      toolsUsed.push({
        name: toolData.name,
        input: toolData.input,
        timestamp: new Date()
      });
      this.emit('stream-chunk', projectId, {
        type: 'tool_start',
        tool: {
          name: toolData.name,
          input: toolData.input
        }
      } as InsightsStreamChunk);
    } catch {
      // Ignore parse errors for tool markers
    }
  }

  /**
   * Handle tool end marker
   */
  private handleToolEnd(projectId: string, line: string): void {
    try {
      const toolJson = line.substring('__TOOL_END__:'.length);
      const toolData = JSON.parse(toolJson);
      this.emit('stream-chunk', projectId, {
        type: 'tool_end',
        tool: {
          name: toolData.name
        }
      } as InsightsStreamChunk);
    } catch {
      // Ignore parse errors for tool markers
    }
  }

  /**
   * Handle rate limit detection
   */
  private handleRateLimit(projectId: string, output: string): void {
    const rateLimitDetection = detectRateLimit(output);
    if (rateLimitDetection.isRateLimited) {
      console.warn('[Insights] Rate limit detected:', {
        projectId,
        resetTime: rateLimitDetection.resetTime,
        limitType: rateLimitDetection.limitType,
        suggestedProfile: rateLimitDetection.suggestedProfile?.name
      });

      const rateLimitInfo = createSDKRateLimitInfo('other', rateLimitDetection, {
        projectId
      });
      this.emit('sdk-rate-limit', rateLimitInfo);
    }
  }
}
