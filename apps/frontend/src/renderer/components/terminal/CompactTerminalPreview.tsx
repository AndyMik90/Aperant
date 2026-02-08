/**
 * FIX-29a: Compact terminal preview component
 *
 * Displays the last 3-4 lines of terminal output inline in the task card.
 * Auto-scrolls to show the most recent output.
 */

import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useTerminalStore, type Terminal } from '../../stores/terminal-store';
import type { ParsedMessage, ContentBlock, ToolUseContent, TextContent } from '../../lib/claude-output-parser';
import { cn } from '../../lib/utils';

const PREVIEW_LINES = 4;

interface CompactTerminalPreviewProps {
  taskId: string;
  className?: string;
}

/**
 * Extract a short text summary from a content block
 */
function getContentSummary(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return (block as TextContent).text.slice(0, 100);
    case 'tool_use': {
      const toolBlock = block as ToolUseContent;
      return `[Tool: ${toolBlock.toolName}]`;
    }
    case 'thinking':
      return '[Thinking...]';
    case 'code_block':
      return '[Code]';
    case 'diff':
      return '[Diff]';
    default:
      return '';
  }
}

/**
 * Extract the last N lines from parsed messages
 */
function getLastLines(messages: ParsedMessage[] | undefined, count: number): string[] {
  if (!messages || messages.length === 0) {
    return [];
  }

  const lines: string[] = [];

  // Process messages from newest to oldest until we have enough lines
  for (let i = messages.length - 1; i >= 0 && lines.length < count; i--) {
    const message = messages[i];

    // Extract text from content blocks
    for (let j = message.content.length - 1; j >= 0 && lines.length < count; j--) {
      const block = message.content[j];
      const summary = getContentSummary(block);
      if (summary) {
        // Split by newlines and take the last lines
        const blockLines = summary.split('\n').filter(Boolean);
        for (let k = blockLines.length - 1; k >= 0 && lines.length < count; k--) {
          lines.unshift(blockLines[k]);
        }
      }
    }
  }

  return lines.slice(-count);
}

export function CompactTerminalPreview({ taskId, className }: CompactTerminalPreviewProps) {
  const taskTerminalId = `task-${taskId}`;
  const terminals = useTerminalStore((state) => state.terminals);
  const terminal = terminals.find((t) => t.id === taskTerminalId);

  // Extract last lines from messages
  const previewLines = useMemo(() => {
    return getLastLines(terminal?.messages, PREVIEW_LINES);
  }, [terminal?.messages]);

  const isStreaming = terminal?.isStreaming ?? false;

  if (!terminal) {
    return null;
  }

  return (
    <div
      className={cn(
        'mt-2 p-2 rounded bg-muted/30 font-mono text-[10px] leading-tight overflow-hidden max-w-full',
        className
      )}
    >
      {/* Status indicator */}
      <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
        {isStreaming && (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
        )}
        <span className={cn(
          'w-1.5 h-1.5 rounded-full',
          isStreaming ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
        )} />
        <span className="text-[9px] uppercase tracking-wider">
          {isStreaming ? 'Running' : 'Idle'}
        </span>
      </div>

      {/* Preview lines */}
      <div className="space-y-0.5 max-h-16 overflow-hidden">
        {previewLines.length > 0 ? (
          previewLines.map((line, i) => (
            <div
              key={i}
              className="text-muted-foreground truncate"
              title={line}
            >
              {line}
            </div>
          ))
        ) : (
          <div className="text-muted-foreground/50 italic">
            No output yet...
          </div>
        )}
      </div>
    </div>
  );
}
