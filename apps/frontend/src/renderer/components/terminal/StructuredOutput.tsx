/**
 * StructuredOutput - Timeline view of Claude agent activity
 *
 * TERM-3b: Displays parsed messages as a visual timeline with:
 * - Step indicators showing tool type and status
 * - File paths and tool names for each operation
 * - Status icons (success/running/error)
 * - Collapsed view for quick scanning of agent progress
 * - Timestamps for each action
 * - Action + target format (e.g., "Read → config.ts")
 */

import { useMemo, useEffect, useRef } from 'react';
import {
  FileText,
  PenLine,
  Terminal,
  Search,
  FolderSearch,
  Globe,
  Brain,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Loader2,
  GitBranch,
  Code,
  FileCode,
  Clock,
  ChevronRight
} from 'lucide-react';
import type { ParsedMessage, ContentBlock, ToolUseContent } from '../../lib/claude-output-parser';
import { cn } from '../../lib/utils';

interface StructuredOutputProps {
  messages: ParsedMessage[];
  className?: string;
  autoScroll?: boolean;
}

// Icon mapping for different tool types
const TOOL_ICONS: Record<string, React.ElementType> = {
  Read: FileText,
  Write: PenLine,
  Edit: PenLine,
  Bash: Terminal,
  Grep: Search,
  Glob: FolderSearch,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: GitBranch,
  thinking: Brain,
  text: MessageSquare,
};

// Color mapping for tool types (for the timeline dot)
const TOOL_COLORS: Record<string, string> = {
  Read: 'bg-blue-500',
  Write: 'bg-green-500',
  Edit: 'bg-green-500',
  Bash: 'bg-purple-500',
  Grep: 'bg-orange-500',
  Glob: 'bg-pink-500',
  WebFetch: 'bg-cyan-500',
  WebSearch: 'bg-cyan-500',
  Task: 'bg-indigo-500',
  thinking: 'bg-amber-500',
  text: 'bg-muted-foreground',
};

// Text color mapping for tool types
const TOOL_TEXT_COLORS: Record<string, string> = {
  Read: 'text-blue-400',
  Write: 'text-green-400',
  Edit: 'text-green-400',
  Bash: 'text-purple-400',
  Grep: 'text-orange-400',
  Glob: 'text-pink-400',
  WebFetch: 'text-cyan-400',
  WebSearch: 'text-cyan-400',
  Task: 'text-indigo-400',
  thinking: 'text-amber-400',
  text: 'text-muted-foreground',
};

// Format relative timestamp
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

// Format elapsed time in seconds
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// Status icon component
function StatusIcon({ status }: { status?: 'pending' | 'success' | 'error' | 'running' }) {
  if (status === 'success') {
    return <CheckCircle2 className="h-3 w-3 text-green-500" />;
  }
  if (status === 'error') {
    return <XCircle className="h-3 w-3 text-red-500" />;
  }
  if (status === 'running') {
    return <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />;
  }
  if (status === 'pending') {
    return <Loader2 className="h-3 w-3 text-muted-foreground" />;
  }
  return null;
}

// Extract displayable info from a tool block
function getToolDisplayInfo(tool: ToolUseContent): { action: string; target: string; fullPath?: string } {
  const input = tool.input || {};

  switch (tool.toolName) {
    case 'Read': {
      const filePath = input.file_path as string || '';
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      return { action: 'Read', target: fileName, fullPath: filePath };
    }
    case 'Write': {
      const filePath = input.file_path as string || '';
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      const content = input.content as string || '';
      const lineCount = content ? content.split('\n').length : 0;
      return { action: 'Write', target: `${fileName} (+${lineCount} lines)`, fullPath: filePath };
    }
    case 'Edit': {
      const filePath = input.file_path as string || '';
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      return { action: 'Edit', target: fileName, fullPath: filePath };
    }
    case 'Bash': {
      const description = input.description as string || '';
      const command = input.command as string || '';
      // Show description if available, otherwise truncated command
      const target = description || (command.length > 40 ? command.slice(0, 40) + '...' : command) || 'run command';
      return { action: 'Bash', target };
    }
    case 'Grep': {
      const pattern = input.pattern as string || '';
      const path = input.path as string || '';
      const pathName = path ? path.split(/[/\\]/).pop() : '';
      return { action: 'Search', target: `"${pattern}"${pathName ? ` in ${pathName}` : ''}` };
    }
    case 'Glob': {
      const pattern = input.pattern as string || '';
      return { action: 'Find', target: `"${pattern}"` };
    }
    case 'WebFetch': {
      const url = input.url as string || '';
      try {
        const hostname = new URL(url).hostname;
        return { action: 'Fetch', target: hostname };
      } catch {
        return { action: 'Fetch', target: url.slice(0, 30) };
      }
    }
    case 'WebSearch': {
      const query = input.query as string || '';
      return { action: 'Search web', target: `"${query}"` };
    }
    case 'Task': {
      const description = input.description as string || '';
      return { action: 'Spawn', target: description || 'subagent' };
    }
    default:
      return { action: tool.toolName, target: '' };
  }
}

// Timeline step component with improved formatting
function TimelineStep({
  block,
  isLast,
  timestamp,
  duration
}: {
  block: ContentBlock;
  isLast: boolean;
  timestamp?: number;
  duration?: number;
}) {
  // Skip empty text blocks
  if (block.type === 'text' && !block.text?.trim()) {
    return null;
  }

  // Get icon and color based on block type
  let Icon: React.ElementType = MessageSquare;
  let color = 'bg-muted-foreground';
  let textColor = 'text-muted-foreground';
  let action = '';
  let target = '';
  let fullPath: string | undefined;
  let status: 'pending' | 'success' | 'error' | 'running' | undefined;
  let isPhase = false;

  if (block.type === 'tool_use') {
    Icon = TOOL_ICONS[block.toolName] ?? Code;
    color = TOOL_COLORS[block.toolName] || 'bg-gray-500';
    textColor = TOOL_TEXT_COLORS[block.toolName] || 'text-muted-foreground';
    const info = getToolDisplayInfo(block);
    action = info.action;
    target = info.target;
    fullPath = info.fullPath;
    status = block.status;
  } else if (block.type === 'thinking') {
    Icon = Brain;
    color = TOOL_COLORS.thinking;
    textColor = TOOL_TEXT_COLORS.thinking;
    action = 'Thinking';
    target = block.text?.slice(0, 50) + (block.text && block.text.length > 50 ? '...' : '') || '';
  } else if (block.type === 'text') {
    Icon = MessageSquare;
    color = TOOL_COLORS.text;
    textColor = TOOL_TEXT_COLORS.text;
    // Check for phase markers
    if (block.text?.startsWith('[Phase:')) {
      action = 'Phase';
      target = block.text.replace(/[\[\]]/g, '').replace('Phase:', '').trim();
      isPhase = true;
      color = 'bg-cyan-500';
      textColor = 'text-cyan-400';
    } else if (block.text?.startsWith('[Subphase:')) {
      action = 'Subphase';
      target = block.text.replace(/[\[\]]/g, '').replace('Subphase:', '').trim();
      isPhase = true;
      color = 'bg-cyan-400';
      textColor = 'text-cyan-300';
    } else {
      action = 'Output';
      target = block.text?.slice(0, 60) + (block.text && block.text.length > 60 ? '...' : '') || '';
    }
  } else if (block.type === 'code_block') {
    Icon = FileCode;
    color = 'bg-purple-500';
    textColor = 'text-purple-400';
    action = 'Code';
    target = block.filename || block.language || '';
  }

  // Phase markers get special styling
  if (isPhase) {
    return (
      <div className="flex items-center gap-3 relative py-2 my-2">
        {/* Timeline connector line */}
        {!isLast && (
          <div className="absolute left-[11px] top-full w-0.5 h-4 bg-border" />
        )}

        {/* Phase indicator */}
        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10",
          color
        )}>
          <Icon className="h-3 w-3 text-white" />
        </div>

        {/* Phase content */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className={cn("text-sm font-semibold", textColor)}>{action}:</span>
          <span className="text-sm font-medium text-foreground">{target}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 relative group">
      {/* Timeline connector line */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 w-0.5 h-[calc(100%-8px)] bg-border" />
      )}

      {/* Step indicator dot */}
      <div className={cn(
        "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10 transition-transform group-hover:scale-110",
        color
      )}>
        <Icon className="h-3 w-3 text-white" />
      </div>

      {/* Step content */}
      <div className="flex-1 min-w-0 pb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Action label */}
          <span className={cn("text-sm font-medium", textColor)}>{action}</span>

          {/* Arrow separator */}
          {target && (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
              {/* Target */}
              <span className="text-sm text-foreground truncate max-w-[250px]" title={fullPath || target}>
                {target}
              </span>
            </>
          )}

          {/* Status indicator */}
          {status && <StatusIcon status={status} />}

          {/* Timestamp - show on hover */}
          {timestamp && (
            <span className="text-[10px] text-muted-foreground/50 ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {formatRelativeTime(timestamp)}
              {duration && duration > 100 && (
                <span className="text-muted-foreground/40">({formatDuration(duration)})</span>
              )}
            </span>
          )}
        </div>

        {/* Full path on second line for file operations */}
        {fullPath && fullPath !== target && (
          <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5 pl-0" title={fullPath}>
            {fullPath}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * StructuredOutput - Timeline view component
 *
 * Displays agent activity as a vertical timeline with:
 * - Tool type icons with action → target format
 * - File names and descriptions
 * - Success/error/running status indicators
 * - Timestamps on hover
 * - Auto-scroll to bottom on new content
 */
export function StructuredOutput({ messages, className, autoScroll = true }: StructuredOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Flatten all content blocks from all messages into a timeline with timestamps
  const timelineSteps = useMemo(() => {
    const steps: { block: ContentBlock; key: string; timestamp: number; duration?: number }[] = [];
    let lastTimestamp = 0;

    messages.forEach((message, msgIdx) => {
      // Skip user messages in structured view - focus on agent activity
      if (message.role === 'user') return;

      const messageTimestamp = message.timestamp || Date.now();

      message.content.forEach((block, blockIdx) => {
        // Skip empty text blocks
        if (block.type === 'text' && !block.text?.trim()) return;

        // Estimate duration based on time between steps
        const duration = lastTimestamp > 0 ? messageTimestamp - lastTimestamp : undefined;

        steps.push({
          block,
          key: `${msgIdx}-${blockIdx}`,
          timestamp: messageTimestamp,
          duration
        });

        lastTimestamp = messageTimestamp;
      });
    });

    return steps;
  }, [messages]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const toolCalls = timelineSteps.filter(s => s.block.type === 'tool_use').length;
    const filesModified = new Set<string>();
    let reads = 0;
    let edits = 0;
    let bashes = 0;

    timelineSteps.forEach(step => {
      if (step.block.type === 'tool_use') {
        const tool = step.block as ToolUseContent;
        if (tool.toolName === 'Read') reads++;
        else if (tool.toolName === 'Edit' || tool.toolName === 'Write') {
          edits++;
          const filePath = tool.input?.file_path as string;
          if (filePath) filesModified.add(filePath);
        }
        else if (tool.toolName === 'Bash') bashes++;
      }
    });

    return { toolCalls, filesModified: filesModified.size, reads, edits, bashes };
  }, [timelineSteps]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [timelineSteps, autoScroll]);

  if (timelineSteps.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
        <div className="w-8 h-8 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin mb-4" />
        <div className="text-muted-foreground text-sm">
          Waiting for agent activity...
        </div>
      </div>
    );
  }

  return (
    <div className={cn("p-4", className)}>
      {/* Timeline header with summary stats */}
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">
          {timelineSteps.length} steps
        </span>
        <span className="text-xs text-muted-foreground">•</span>
        <span className="text-xs text-muted-foreground">
          <span className="text-blue-400">{stats.reads}</span> reads
        </span>
        <span className="text-xs text-muted-foreground">
          <span className="text-green-400">{stats.edits}</span> edits
        </span>
        <span className="text-xs text-muted-foreground">
          <span className="text-purple-400">{stats.bashes}</span> commands
        </span>
        {stats.filesModified > 0 && (
          <>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs text-muted-foreground">
              <span className="text-foreground">{stats.filesModified}</span> files modified
            </span>
          </>
        )}
      </div>

      {/* Timeline */}
      <div className="space-y-0">
        {timelineSteps.map((step, idx) => (
          <TimelineStep
            key={step.key}
            block={step.block}
            isLast={idx === timelineSteps.length - 1}
            timestamp={step.timestamp}
            duration={step.duration}
          />
        ))}
      </div>

      {/* Auto-scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
