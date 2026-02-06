/**
 * SDK Output Parser
 *
 * Parses __SDK_MSG__ markers from Python backend into typed blocks
 * for the rich task monitor UI. This provides 1:1 mapping with
 * Claude SDK message types.
 *
 * See docs/TASK_MONITOR_ARCHITECTURE.md for details.
 */

import type {
  StructuredBlock,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  PhaseStartBlock,
  PhaseEndBlock,
  ErrorBlock,
  ToolStartBlock,
  ToolEndBlock,
} from '../../../shared/types/structured-output';

// Re-export for convenience
export type { StructuredBlock };

// Regex to detect SDK message markers
const SDK_MSG_PATTERN = /^__SDK_MSG__:(.+)$/;

// Also support legacy patterns for backwards compatibility
const LEGACY_PATTERNS = {
  TASK_LOG_TEXT: /^__TASK_LOG_TEXT__:(.+)$/,
  TASK_LOG_TOOL_START: /^__TASK_LOG_TOOL_START__:(.+)$/,
  TASK_LOG_TOOL_END: /^__TASK_LOG_TOOL_END__:(.+)$/,
  TASK_LOG_PHASE_START: /^__TASK_LOG_PHASE_START__:(.+)$/,
  TASK_LOG_PHASE_END: /^__TASK_LOG_PHASE_END__:(.+)$/,
};

// ANSI codes to strip
const ANSI_CODES = /\x1b\[[0-9;]*m/g;

/**
 * Safe JSON parse with fallback and error logging
 */
function safeJsonParse(jsonStr: string): Record<string, unknown> | null {
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Log parsing errors for debugging (truncate long strings)
    const preview = jsonStr.length > 200 ? jsonStr.slice(0, 200) + '...' : jsonStr;
    console.warn('[SDKOutputParser] JSON parse error:', e, 'Input:', preview);
    return null;
  }
}

/**
 * Strip ANSI color codes and trailing carriage return from a line
 */
function stripAnsi(line: string): string {
  return line.replace(ANSI_CODES, '').replace(/\r$/, '');
}

/**
 * Parse a single line of output into a StructuredBlock.
 * Returns null if the line doesn't match any known pattern.
 */
export function parseSDKOutput(rawLine: string): StructuredBlock | null {
  const line = stripAnsi(rawLine).trim();
  if (!line) return null;

  // Try new __SDK_MSG__ format first
  let match = line.match(SDK_MSG_PATTERN);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (!data || typeof data.type !== 'string') return null;

    switch (data.type) {
      case 'text':
        if (typeof data.content === 'string') {
          return {
            type: 'text',
            content: data.content,
          } satisfies TextBlock;
        }
        break;

      case 'thinking':
        if (typeof data.content === 'string') {
          return {
            type: 'thinking',
            content: data.content,
            signature: data.signature as string | undefined,
          } satisfies ThinkingBlock;
        }
        break;

      case 'tool_use':
        if (typeof data.name === 'string') {
          return {
            type: 'tool_use',
            id: (data.id as string) || '',
            name: data.name,
            input: (data.input as Record<string, unknown>) || {},
          } satisfies ToolUseBlock;
        }
        break;

      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: (data.tool_use_id as string) || '',
          name: (data.name as string) || '',
          content: (data.content as string) || '',
          is_error: Boolean(data.is_error),
        } satisfies ToolResultBlock;

      case 'phase_start':
        if (typeof data.phase === 'string') {
          return {
            type: 'phase_start',
            phase: data.phase,
            timestamp: data.timestamp as string | undefined,
          } satisfies PhaseStartBlock;
        }
        break;

      case 'phase_end':
        if (typeof data.phase === 'string') {
          return {
            type: 'phase_end',
            phase: data.phase,
            success: data.success !== false,
            timestamp: data.timestamp as string | undefined,
          } satisfies PhaseEndBlock;
        }
        break;

      case 'error':
        return {
          type: 'error',
          content: (data.content as string) || 'Unknown error',
          phase: data.phase as string | undefined,
        } satisfies ErrorBlock;
    }

    return null;
  }

  // Try legacy __TASK_LOG_TEXT__ format
  match = line.match(LEGACY_PATTERNS.TASK_LOG_TEXT);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.content === 'string') {
      return { type: 'text', content: data.content } satisfies TextBlock;
    }
  }

  // Try legacy __TASK_LOG_TOOL_START__ format
  match = line.match(LEGACY_PATTERNS.TASK_LOG_TOOL_START);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.name === 'string') {
      return {
        type: 'tool_start',
        toolName: data.name,
        input: (data.input as Record<string, unknown>) || {},
      } satisfies ToolStartBlock;
    }
  }

  // Try legacy __TASK_LOG_TOOL_END__ format
  match = line.match(LEGACY_PATTERNS.TASK_LOG_TOOL_END);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.name === 'string') {
      return {
        type: 'tool_end',
        toolName: data.name,
        success: data.success !== false,
      } satisfies ToolEndBlock;
    }
  }

  // Try legacy __TASK_LOG_PHASE_START__ format
  match = line.match(LEGACY_PATTERNS.TASK_LOG_PHASE_START);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.phase === 'string') {
      return {
        type: 'phase_start',
        phase: data.phase,
        timestamp: data.timestamp as string | undefined,
      } satisfies PhaseStartBlock;
    }
  }

  // Try legacy __TASK_LOG_PHASE_END__ format
  match = line.match(LEGACY_PATTERNS.TASK_LOG_PHASE_END);
  if (match) {
    const data = safeJsonParse(match[1]);
    if (data && typeof data.phase === 'string') {
      return {
        type: 'phase_end',
        phase: data.phase,
        success: data.success !== false,
        timestamp: data.timestamp as string | undefined,
      } satisfies PhaseEndBlock;
    }
  }

  // No SDK/legacy marker matched — emit as text block if line has meaningful content.
  // This captures spec runner output (phase text, analysis) that isn't marker-formatted,
  // so the timeline view works for planning/review phases too (not just coding).
  // Skip decorative lines (box drawing, pure symbols, very short noise).
  const stripped = line.replace(/[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬●◆◇■□▪▫★☆▶▷►▻✓✗✔✘→←↑↓⬆⬇⬅➡☐☑▸▹·•]/g, '').trim();
  if (stripped.length >= 5 && !line.startsWith('__')) {
    return { type: 'text', content: line } satisfies TextBlock;
  }

  return null;
}

/**
 * Stateful parser that tracks tool context across lines.
 */
export class SDKOutputParser {
  private toolStack: Array<{ id: string; name: string }> = [];

  /**
   * Parse a line and return StructuredBlock
   */
  parse(rawLine: string): StructuredBlock | null {
    const block = parseSDKOutput(rawLine);
    if (!block) return null;

    // Track tool state
    if (block.type === 'tool_use') {
      this.toolStack.push({ id: block.id, name: block.name });
    } else if (block.type === 'tool_start') {
      // Legacy format
      this.toolStack.push({ id: '', name: block.toolName });
    } else if (block.type === 'tool_result') {
      // Fill in tool name if missing
      if (!block.name && this.toolStack.length > 0) {
        const lastTool = this.toolStack[this.toolStack.length - 1];
        (block as ToolResultBlock).name = lastTool.name;
        (block as ToolResultBlock).tool_use_id = lastTool.id;
      }
      this.toolStack.pop();
    } else if (block.type === 'tool_end') {
      // Legacy format - fill in tool name if missing
      if (!block.toolName && this.toolStack.length > 0) {
        const lastTool = this.toolStack[this.toolStack.length - 1];
        (block as ToolEndBlock).toolName = lastTool.name;
      }
      this.toolStack.pop();
    }

    return block;
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.toolStack = [];
  }

  /**
   * Get current tool being executed (if any)
   */
  getCurrentTool(): { id: string; name: string } | null {
    return this.toolStack[this.toolStack.length - 1] || null;
  }
}
