/**
 * Task Log Writer
 * ===============
 *
 * Writes task_logs.json files during TypeScript agent session execution.
 * This replaces the Python backend's TaskLogger/LogStorage system.
 *
 * The writer maps AI SDK stream events to the TaskLogs JSON format
 * expected by the frontend log rendering system (TaskLogs component).
 *
 * Phase mapping (Phase → TaskLogPhase):
 *   spec     → planning
 *   planning → planning
 *   coding   → coding
 *   qa       → validation
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { TaskLogs, TaskLogPhase, TaskLogPhaseStatus, TaskLogEntry, TaskLogEntryType } from '../../../shared/types';
import type { StreamEvent } from '../session/types';
import type { Phase } from '../config/types';

// =============================================================================
// Phase Mapping
// =============================================================================

/** Map execution phase to log phase */
function toLogPhase(phase: Phase | undefined): TaskLogPhase {
  switch (phase) {
    case 'spec':
    case 'planning':
      return 'planning';
    case 'coding':
      return 'coding';
    case 'qa':
      return 'validation';
    default:
      return 'coding'; // Fallback for unknown phases
  }
}

// =============================================================================
// TaskLogWriter
// =============================================================================

/**
 * Writes task_logs.json to the spec directory during agent execution.
 *
 * Usage:
 * ```ts
 * const writer = new TaskLogWriter(specDir, specId);
 * writer.startPhase('planning');
 * writer.processEvent(streamEvent); // called for each stream event
 * writer.endPhase('planning', true);
 * ```
 */
export class TaskLogWriter {
  private readonly logFile: string;
  private data: TaskLogs;
  private currentPhase: TaskLogPhase = 'planning';
  private currentSubtask: string | undefined;
  private pendingText = '';
  private pendingTextPhase: TaskLogPhase | undefined;

  constructor(specDir: string, specId: string) {
    this.logFile = join(specDir, 'task_logs.json');
    this.data = this.loadOrCreate(specDir, specId);
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Mark a phase as started. Flushes any pending text from the previous phase.
   */
  startPhase(phase: Phase, message?: string): void {
    this.flushPendingText();
    const logPhase = toLogPhase(phase);
    this.currentPhase = logPhase;

    // Auto-close any other active phases (handles resume/restart scenarios)
    for (const [key, phaseData] of Object.entries(this.data.phases)) {
      if (key !== logPhase && phaseData.status === 'active') {
        this.data.phases[key as TaskLogPhase].status = 'completed';
        this.data.phases[key as TaskLogPhase].completed_at = this.timestamp();
      }
    }

    this.data.phases[logPhase].status = 'active';
    this.data.phases[logPhase].started_at = this.timestamp();

    const content = message ?? `Starting ${logPhase} phase`;
    this.addEntry(logPhase, 'phase_start', content);
    this.save();
  }

  /**
   * Mark a phase as completed or failed.
   */
  endPhase(phase: Phase, success: boolean, message?: string): void {
    this.flushPendingText();
    const logPhase = toLogPhase(phase);
    const status: TaskLogPhaseStatus = success ? 'completed' : 'failed';
    this.data.phases[logPhase].status = status;
    this.data.phases[logPhase].completed_at = this.timestamp();

    const content = message ?? `${success ? 'Completed' : 'Failed'} ${logPhase} phase`;
    this.addEntry(logPhase, 'phase_end', content);
    this.save();
  }

  /**
   * Set the current subtask ID for subsequent log entries.
   */
  setSubtask(subtaskId: string | undefined): void {
    this.currentSubtask = subtaskId;
  }

  /**
   * Process a stream event from the AI SDK session.
   * Routes to the appropriate log entry writer.
   */
  processEvent(event: StreamEvent, phase?: Phase): void {
    const logPhase = phase ? toLogPhase(phase) : this.currentPhase;

    switch (event.type) {
      case 'text-delta':
        this.accumulateText(event.text, logPhase);
        break;

      case 'tool-call':
        // Flush pending text before the tool call entry
        this.flushPendingText();
        this.writeToolStart(logPhase, event.toolName, this.extractToolInput(event.toolName, event.args));
        break;

      case 'tool-result':
        this.writeToolEnd(logPhase, event.toolName, event.isError, event.result);
        break;

      case 'step-finish':
        // Flush accumulated text on step finish
        this.flushPendingText();
        break;

      case 'error': {
        this.flushPendingText();
        // Extract meaningful error message - AI SDK sometimes just sends 'error' as the message
        const err = event.error;
        let errorContent = 'Unknown error';
        if (err) {
          const msg = err.message || '';
          const code = err.code || '';
          const cause = err.cause;
          // If message is just 'error' (unhelpful), try to extract from cause or code
          if (msg && msg !== 'error') {
            errorContent = msg;
          } else if (cause instanceof Error) {
            errorContent = cause.message || String(cause);
          } else if (cause && typeof cause === 'object') {
            errorContent = JSON.stringify(cause).slice(0, 500);
          } else if (cause) {
            errorContent = String(cause);
          } else if (code && code !== 'error') {
            errorContent = `Error code: ${code}`;
          } else {
            errorContent = `Error: ${JSON.stringify(err).slice(0, 500)}`;
          }
        }
        this.addEntry(logPhase, 'error', errorContent);
        this.save();
        break;
      }

      default:
        // Ignore thinking-delta, usage-update
        break;
    }
  }

  /**
   * Write a plain text log message to the current phase.
   */
  logText(content: string, phase?: Phase, entryType: TaskLogEntryType = 'text'): void {
    const logPhase = phase ? toLogPhase(phase) : this.currentPhase;
    this.addEntry(logPhase, entryType, content);
    this.save();
  }

  /**
   * Flush any accumulated text and save.
   */
  flush(): void {
    this.flushPendingText();
    this.save();
  }

  /**
   * Get the current log data.
   */
  getData(): TaskLogs {
    return this.data;
  }

  // ===========================================================================
  // Private: Core Writing
  // ===========================================================================

  private addEntry(
    phase: TaskLogPhase,
    type: TaskLogEntryType,
    content: string,
    extra?: Partial<TaskLogEntry>
  ): void {
    const entry: TaskLogEntry = {
      timestamp: this.timestamp(),
      type,
      content: content.slice(0, 2000), // Reasonable cap to prevent huge entries
      phase,
      ...(this.currentSubtask ? { subtask_id: this.currentSubtask } : {}),
      ...extra,
    };

    // Ensure phase exists and is initialized
    if (!this.data.phases[phase]) {
      this.data.phases[phase] = {
        phase,
        status: 'pending',
        started_at: null,
        completed_at: null,
        entries: [],
      };
    }

    this.data.phases[phase].entries.push(entry);
  }

  private writeToolStart(phase: TaskLogPhase, toolName: string, toolInput?: string): void {
    const content = `[${toolName}] ${toolInput || ''}`.trim();
    this.addEntry(phase, 'tool_start', content, {
      tool_name: toolName,
      tool_input: toolInput,
    });
    this.save();
  }

  private writeToolEnd(
    phase: TaskLogPhase,
    toolName: string,
    isError: boolean,
    result: unknown
  ): void {
    const status = isError ? 'Error' : 'Done';
    const content = `[${toolName}] ${status}`;

    // Serialize result as detail (expandable in UI)
    let detail: string | undefined;
    if (result !== null && result !== undefined) {
      const raw = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      // Cap at 10KB to match Python behavior
      detail = raw.length > 10240 ? `${raw.slice(0, 10240)}\n\n... [truncated]` : raw;
    }

    this.addEntry(phase, 'tool_end', content, {
      tool_name: toolName,
      ...(detail ? { detail, collapsed: true } : {}),
    });
    this.save();
  }

  // ===========================================================================
  // Private: Text Accumulation
  // ===========================================================================

  /**
   * Accumulate text deltas instead of writing one entry per delta.
   * Flushes happen on step-finish, tool-call, or phase changes.
   */
  private accumulateText(text: string, phase: TaskLogPhase): void {
    if (this.pendingTextPhase && this.pendingTextPhase !== phase) {
      // Phase changed mid-accumulation — flush what we have
      this.flushPendingText();
    }
    this.pendingText += text;
    this.pendingTextPhase = phase;
  }

  private flushPendingText(): void {
    if (!this.pendingText.trim()) {
      this.pendingText = '';
      this.pendingTextPhase = undefined;
      return;
    }

    const phase = this.pendingTextPhase ?? this.currentPhase;
    const content = this.pendingText.trim();

    // Write as a text entry
    this.addEntry(phase, 'text', content.slice(0, 4000));
    this.save();

    this.pendingText = '';
    this.pendingTextPhase = undefined;
  }

  // ===========================================================================
  // Private: Tool Input Extraction
  // ===========================================================================

  /**
   * Extract a brief display string from tool arguments.
   * Shows the primary input (file path, command, pattern, etc.)
   */
  private extractToolInput(toolName: string, args: Record<string, unknown>): string | undefined {
    const truncate = (s: string, max = 200): string =>
      s.length > max ? `${s.slice(0, max - 3)}...` : s;

    switch (toolName) {
      case 'Read':
        return typeof args.file_path === 'string' ? truncate(args.file_path) : undefined;
      case 'Write':
        return typeof args.file_path === 'string' ? truncate(args.file_path) : undefined;
      case 'Edit':
        return typeof args.file_path === 'string' ? truncate(args.file_path) : undefined;
      case 'Bash':
        return typeof args.command === 'string' ? truncate(args.command) : undefined;
      case 'Glob':
        return typeof args.pattern === 'string' ? truncate(args.pattern) : undefined;
      case 'Grep':
        return typeof args.pattern === 'string' ? truncate(args.pattern) : undefined;
      case 'WebFetch':
        return typeof args.url === 'string' ? truncate(args.url) : undefined;
      case 'WebSearch':
        return typeof args.query === 'string' ? truncate(args.query) : undefined;
      default: {
        // Generic: try common field names
        const value = args.file_path ?? args.path ?? args.command ?? args.query ?? args.pattern;
        return typeof value === 'string' ? truncate(value) : undefined;
      }
    }
  }

  // ===========================================================================
  // Private: Storage
  // ===========================================================================

  private loadOrCreate(_specDir: string, specId: string): TaskLogs {
    if (existsSync(this.logFile)) {
      try {
        const content = readFileSync(this.logFile, 'utf-8');
        return JSON.parse(content) as TaskLogs;
      } catch {
        // Corrupted file — start fresh
      }
    }

    const now = this.timestamp();
    return {
      spec_id: specId,
      created_at: now,
      updated_at: now,
      phases: {
        planning: { phase: 'planning', status: 'pending', started_at: null, completed_at: null, entries: [] },
        coding: { phase: 'coding', status: 'pending', started_at: null, completed_at: null, entries: [] },
        validation: { phase: 'validation', status: 'pending', started_at: null, completed_at: null, entries: [] },
      },
    };
  }

  private save(): void {
    this.data.updated_at = this.timestamp();
    try {
      // Ensure directory exists
      const dir = dirname(this.logFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Atomic-like write: write to temp file then rename
      const tmpFile = `${this.logFile}.tmp`;
      writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), 'utf-8');
      // renameSync is atomic on same filesystem (POSIX)
      renameSync(tmpFile, this.logFile);
    } catch {
      // Non-fatal: log write failures don't break execution
      // (The UI will just show an empty log section)
    }
  }

  private timestamp(): string {
    return new Date().toISOString();
  }
}
