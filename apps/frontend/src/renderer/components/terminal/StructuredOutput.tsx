/**
 * StructuredOutput - Timeline view of Claude agent activity
 *
 * TERM-3b: Displays parsed messages as a visual timeline with:
 * - Step indicators showing tool type and status
 * - File paths and tool names for each operation
 * - Status icons (success/running/error)
 * - Collapsed view for quick scanning of agent progress
 */

import { useMemo } from 'react';
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
  FileCode
} from 'lucide-react';
import type { ParsedMessage, ContentBlock, ToolUseContent } from '../../lib/claude-output-parser';
import { cn } from '../../lib/utils';

interface StructuredOutputProps {
  messages: ParsedMessage[];
  className?: string;
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

// Color mapping for tool types (for the timeline line)
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
function getToolDisplayInfo(tool: ToolUseContent): { label: string; detail: string } {
  const input = tool.input || {};

  switch (tool.toolName) {
    case 'Read': {
      const filePath = input.file_path as string || '';
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      return { label: 'Read', detail: fileName };
    }
    case 'Write': {
      const filePath = input.file_path as string || '';
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      return { label: 'Write', detail: fileName };
    }
    case 'Edit': {
      const filePath = input.file_path as string || '';
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      return { label: 'Edit', detail: fileName };
    }
    case 'Bash': {
      const description = input.description as string || '';
      return { label: 'Bash', detail: description || 'Run command' };
    }
    case 'Grep': {
      const pattern = input.pattern as string || '';
      return { label: 'Grep', detail: pattern ? `"${pattern}"` : 'Search' };
    }
    case 'Glob': {
      const pattern = input.pattern as string || '';
      return { label: 'Glob', detail: pattern ? `"${pattern}"` : 'Find files' };
    }
    case 'WebFetch':
    case 'WebSearch': {
      const url = input.url as string || input.query as string || '';
      return { label: tool.toolName, detail: url };
    }
    case 'Task': {
      const description = input.description as string || '';
      return { label: 'Task', detail: description || 'Spawn agent' };
    }
    default:
      return { label: tool.toolName, detail: '' };
  }
}

// Timeline step component
function TimelineStep({
  block,
  isLast
}: {
  block: ContentBlock;
  isLast: boolean;
}) {
  // Skip empty text blocks
  if (block.type === 'text' && !block.text?.trim()) {
    return null;
  }

  // Get icon and color based on block type
  let Icon: React.ElementType = MessageSquare;
  let color = 'bg-muted-foreground';
  let label = '';
  let detail = '';
  let status: 'pending' | 'success' | 'error' | 'running' | undefined;

  if (block.type === 'tool_use') {
    Icon = TOOL_ICONS[block.toolName] ?? Code;
    color = TOOL_COLORS[block.toolName] || 'bg-gray-500';
    const info = getToolDisplayInfo(block);
    label = info.label;
    detail = info.detail;
    status = block.status;
  } else if (block.type === 'thinking') {
    Icon = Brain;
    color = TOOL_COLORS.thinking;
    label = 'Thinking';
    detail = block.text?.slice(0, 50) + (block.text && block.text.length > 50 ? '...' : '') || '';
  } else if (block.type === 'text') {
    Icon = MessageSquare;
    color = TOOL_COLORS.text;
    label = 'Output';
    // Check for phase markers
    if (block.text?.startsWith('[Phase:')) {
      label = 'Phase';
      detail = block.text.replace(/[\[\]]/g, '').replace('Phase:', '').trim();
    } else if (block.text?.startsWith('[Subphase:')) {
      label = 'Subphase';
      detail = block.text.replace(/[\[\]]/g, '').replace('Subphase:', '').trim();
    } else {
      detail = block.text?.slice(0, 60) + (block.text && block.text.length > 60 ? '...' : '') || '';
    }
  } else if (block.type === 'code_block') {
    Icon = FileCode;
    color = 'bg-purple-500';
    label = 'Code';
    detail = block.filename || block.language || '';
  }

  return (
    <div className="flex items-start gap-3 relative">
      {/* Timeline connector line */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 w-0.5 h-[calc(100%-8px)] bg-border" />
      )}

      {/* Step indicator dot */}
      <div className={cn(
        "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10",
        color
      )}>
        <Icon className="h-3 w-3 text-white" />
      </div>

      {/* Step content */}
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {status && <StatusIcon status={status} />}
        </div>
        {detail && (
          <p className="text-xs text-muted-foreground truncate mt-0.5" title={detail}>
            {detail}
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
 * - Tool type icons
 * - File names and descriptions
 * - Success/error/running status indicators
 */
export function StructuredOutput({ messages, className }: StructuredOutputProps) {
  // Flatten all content blocks from all messages into a timeline
  const timelineSteps = useMemo(() => {
    const steps: { block: ContentBlock; key: string }[] = [];

    messages.forEach((message, msgIdx) => {
      // Skip user messages in structured view - focus on agent activity
      if (message.role === 'user') return;

      message.content.forEach((block, blockIdx) => {
        // Skip empty text blocks
        if (block.type === 'text' && !block.text?.trim()) return;

        steps.push({
          block,
          key: `${msgIdx}-${blockIdx}`
        });
      });
    });

    return steps;
  }, [messages]);

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
      <div className="flex items-center gap-4 mb-4 pb-3 border-b border-border">
        <span className="text-xs text-muted-foreground">
          {timelineSteps.length} steps
        </span>
        <span className="text-xs text-muted-foreground">
          {timelineSteps.filter(s => s.block.type === 'tool_use').length} tool calls
        </span>
      </div>

      {/* Timeline */}
      <div className="space-y-0">
        {timelineSteps.map((step, idx) => (
          <TimelineStep
            key={step.key}
            block={step.block}
            isLast={idx === timelineSteps.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
