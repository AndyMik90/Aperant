/**
 * Structured Output Parser
 *
 * Parses __TASK_LOG_*__ markers from Python backend into typed blocks
 * for the rich UI. This runs in the Electron main process to provide
 * pre-parsed structured data to the renderer.
 *
 * Marker formats from backend:
 * - __TASK_LOG_TEXT__:{json}
 * - __TASK_LOG_TOOL_START__:{json}
 * - __TASK_LOG_TOOL_END__:{json}
 * - __TASK_LOG_PHASE_START__:{json}
 * - __TASK_LOG_PHASE_END__:{json}
 * - __TASK_LOG_SUBPHASE_START__:{json}
 *
 * Also handles legacy patterns:
 * - [Tool: ToolName]
 * - [Done] / [Error]
 */

// Block types that match Claude Code extension's structure
export type StructuredBlockType =
  | 'text'
  | 'thinking'
  | 'tool_start'
  | 'tool_end'
  | 'phase_start'
  | 'phase_end'
  | 'subphase_start';

export interface TextBlock {
  type: 'text';
  content: string;
  phase?: string;
  subtaskId?: string;
  timestamp?: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  content: string;
  timestamp?: string;
}

export interface ToolStartBlock {
  type: 'tool_start';
  toolName: string;
  input?: Record<string, unknown>;
  displayInput?: string;
  phase?: string;
}

export interface ToolEndBlock {
  type: 'tool_end';
  toolName: string;
  success: boolean;
  hasDetail?: boolean;
  result?: string;
  phase?: string;
}

export interface PhaseStartBlock {
  type: 'phase_start';
  phase: string;
  timestamp?: string;
}

export interface PhaseEndBlock {
  type: 'phase_end';
  phase: string;
  success: boolean;
  timestamp?: string;
}

export interface SubphaseStartBlock {
  type: 'subphase_start';
  subphase: string;
  phase?: string;
  timestamp?: string;
}

export type StructuredBlock =
  | TextBlock
  | ThinkingBlock
  | ToolStartBlock
  | ToolEndBlock
  | PhaseStartBlock
  | PhaseEndBlock
  | SubphaseStartBlock;

// Regex patterns for marker detection
const PATTERNS = {
  // Task log markers from Python backend
  TASK_LOG_TEXT: /^__TASK_LOG_TEXT__:(.+)$/,
  TASK_LOG_TOOL_START: /^__TASK_LOG_TOOL_START__:(.+)$/,
  TASK_LOG_TOOL_END: /^__TASK_LOG_TOOL_END__:(.+)$/,
  TASK_LOG_PHASE_START: /^__TASK_LOG_PHASE_START__:(.+)$/,
  TASK_LOG_PHASE_END: /^__TASK_LOG_PHASE_END__:(.+)$/,
  TASK_LOG_SUBPHASE_START: /^__TASK_LOG_SUBPHASE_START__:(.+)$/,

  // Legacy tool patterns from insights_runner.py
  LEGACY_TOOL_START: /^__TOOL_START__:(.+)$/,
  LEGACY_TOOL_END: /^__TOOL_END__:(.+)$/,

  // Jerry tool format (fallback)
  JERRY_TOOL_START: /^\[Tool:\s*(\w+)\]\s*$/,
  JERRY_TOOL_DONE: /^\s*\[Done\]\s*$/,
  JERRY_TOOL_ERROR: /^\s*\[Error\](.*)$/,

  // ANSI codes to strip
  ANSI_CODES: /\x1b\[[0-9;]*m/g,
};

/**
 * Safe JSON parse with fallback
 */
function safeJsonParse(jsonStr: string): Record<string, unknown> | null {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Strip ANSI color codes and trailing carriage return from a line
 */
function stripAnsi(line: string): string {
  return line.replace(PATTERNS.ANSI_CODES, '').replace(/\r$/, '');
}

/**
 * Parse a single line of output into a structured block.
 * Returns null if the line doesn't match any known pattern.
 */
export function parseStructuredOutput(rawLine: string): StructuredBlock | null {
  const line = stripAnsi(rawLine).trim();
  if (!line) return null;

  // Try __TASK_LOG_TEXT__
  let match = line.match(PATTERNS.TASK_LOG_TEXT);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.content === 'string') {
      return {
        type: 'text',
        content: data.content,
        phase: data.phase as string | undefined,
        subtaskId: data.subtask_id as string | undefined,
        timestamp: data.timestamp as string | undefined,
      };
    }
  }

  // Try __TASK_LOG_TOOL_START__
  match = line.match(PATTERNS.TASK_LOG_TOOL_START);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.name === 'string') {
      return {
        type: 'tool_start',
        toolName: data.name,
        input: data.input as Record<string, unknown> | undefined,
        displayInput: data.input as string | undefined,
        phase: data.phase as string | undefined,
      };
    }
  }

  // Try __TASK_LOG_TOOL_END__
  match = line.match(PATTERNS.TASK_LOG_TOOL_END);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.name === 'string') {
      return {
        type: 'tool_end',
        toolName: data.name,
        success: data.success !== false,
        hasDetail: data.has_detail as boolean | undefined,
        phase: data.phase as string | undefined,
      };
    }
  }

  // Try __TASK_LOG_PHASE_START__
  match = line.match(PATTERNS.TASK_LOG_PHASE_START);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.phase === 'string') {
      return {
        type: 'phase_start',
        phase: data.phase,
        timestamp: data.timestamp as string | undefined,
      };
    }
  }

  // Try __TASK_LOG_PHASE_END__
  match = line.match(PATTERNS.TASK_LOG_PHASE_END);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.phase === 'string') {
      return {
        type: 'phase_end',
        phase: data.phase,
        success: data.success !== false,
        timestamp: data.timestamp as string | undefined,
      };
    }
  }

  // Try __TASK_LOG_SUBPHASE_START__
  match = line.match(PATTERNS.TASK_LOG_SUBPHASE_START);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.subphase === 'string') {
      return {
        type: 'subphase_start',
        subphase: data.subphase,
        phase: data.phase as string | undefined,
        timestamp: data.timestamp as string | undefined,
      };
    }
  }

  // Try legacy __TOOL_START__ (from insights_runner)
  match = line.match(PATTERNS.LEGACY_TOOL_START);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.name === 'string') {
      return {
        type: 'tool_start',
        toolName: data.name,
        input: data.input as Record<string, unknown> | undefined,
      };
    }
  }

  // Try legacy __TOOL_END__
  match = line.match(PATTERNS.LEGACY_TOOL_END);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.name === 'string') {
      return {
        type: 'tool_end',
        toolName: data.name,
        success: true,
      };
    }
  }

  // Try Jerry [Tool: X] format
  match = line.match(PATTERNS.JERRY_TOOL_START);
  if (match) {
    return {
      type: 'tool_start',
      toolName: match[1],
    };
  }

  // Try Jerry [Done]
  if (PATTERNS.JERRY_TOOL_DONE.test(line)) {
    // We don't know the tool name here, caller needs to track state
    return {
      type: 'tool_end',
      toolName: '', // Will be filled by caller from state
      success: true,
    };
  }

  // Try Jerry [Error]
  match = line.match(PATTERNS.JERRY_TOOL_ERROR);
  if (match) {
    return {
      type: 'tool_end',
      toolName: '', // Will be filled by caller from state
      success: false,
      result: match[1]?.trim(),
    };
  }

  // No pattern matched - this is regular text output
  // Only return as text block if it has meaningful content
  // and doesn't look like internal logging
  if (line.length > 0 && !line.startsWith('__') && !line.includes('DEBUG')) {
    return {
      type: 'text',
      content: line,
    };
  }

  return null;
}

/**
 * Stateful parser that tracks tool context across lines.
 * Use this when you need to correlate tool starts with tool ends.
 */
export class StructuredOutputParser {
  private currentTool: string | null = null;
  private toolStack: string[] = [];

  /**
   * Parse a line and return structured block with tool context filled in
   */
  parse(rawLine: string): StructuredBlock | null {
    const block = parseStructuredOutput(rawLine);
    if (!block) return null;

    // Track tool state
    if (block.type === 'tool_start') {
      this.currentTool = block.toolName;
      this.toolStack.push(block.toolName);
    } else if (block.type === 'tool_end') {
      // Fill in tool name if missing (from Jerry format)
      if (!block.toolName && this.currentTool) {
        block.toolName = this.currentTool;
      }
      this.toolStack.pop();
      this.currentTool = this.toolStack[this.toolStack.length - 1] || null;
    }

    return block;
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.currentTool = null;
    this.toolStack = [];
  }

  /**
   * Get current tool being executed (if any)
   */
  getCurrentTool(): string | null {
    return this.currentTool;
  }
}
