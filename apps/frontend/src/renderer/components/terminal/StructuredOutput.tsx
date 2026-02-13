/**
 * StructuredOutput - Phase-centric timeline view of Claude agent activity
 *
 * TERM-3b: Displays parsed messages as a visual timeline with:
 * - Phase-based grouping (Planning, Coding, Validation)
 * - Sticky progress header with execution state
 * - Collapsible phase cards with step details
 * - Tool call grouping for density reduction
 * - Noise filtering and deduplication
 * - Density toggle (Compact/Standard/Verbose)
 * - Parallel agent separation with indentation
 */

import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
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
  ChevronRight,
  ChevronDown,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { useTaskStore } from '../../stores/task-store';
import type { ParsedMessage, ContentBlock, ToolUseContent } from '../../lib/claude-output-parser';
import { cn } from '../../lib/utils';

interface StructuredOutputProps {
  messages: ParsedMessage[];
  className?: string;
  autoScroll?: boolean;
  taskId?: string;
}

type DensityLevel = 'compact' | 'standard' | 'verbose';

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

// Phase colors (keyed by display name used in [Phase: X] markers)
const PHASE_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  'Planning': { bg: 'bg-amber-500', text: 'text-amber-400', icon: 'text-amber-400' },
  'Coding': { bg: 'bg-blue-500', text: 'text-blue-400', icon: 'text-blue-400' },
  'Validation': { bg: 'bg-purple-500', text: 'text-purple-400', icon: 'text-purple-400' },
  'Setup': { bg: 'bg-gray-500', text: 'text-gray-400', icon: 'text-gray-400' },
};

// Map display phase names to ExecutionProgress phase values (lowercase)
const PHASE_NAME_TO_EXECUTION: Record<string, string> = {
  'Planning': 'planning',
  'Coding': 'coding',
  'Validation': 'qa_review',
};

// Map ExecutionProgress phase values to display names
const EXECUTION_TO_PHASE_NAME: Record<string, string> = {
  'planning': 'Planning',
  'coding': 'Coding',
  'qa_review': 'Validation',
  'qa_fixing': 'Validation',
};

// Format elapsed time from task start (MM:SS format)
function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `+${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Format duration in human readable form
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
  taskStartTime,
  isSubagent = false,
  density = 'standard',
}: {
  block: ContentBlock;
  isLast: boolean;
  timestamp?: number;
  taskStartTime?: number;
  isSubagent?: boolean;
  density?: DensityLevel;
}) {
  // Skip empty text blocks
  if (block.type === 'text' && !block.text?.trim()) {
    return null;
  }

  // Skip thinking blocks in compact mode
  if (density === 'compact' && block.type === 'thinking') {
    return null;
  }

  // Truncate thinking in standard mode, show full in verbose
  let thinkingText = '';
  if (block.type === 'thinking') {
    thinkingText = block.text || '';
    if (density === 'standard' && thinkingText.length > 200) {
      thinkingText = thinkingText.slice(0, 200) + '...';
    }
  }

  // Truncate long output text in standard mode, show full in verbose
  let outputText = '';
  if (block.type === 'text') {
    outputText = block.text || '';
    if (density === 'standard' && outputText.length > 300) {
      outputText = outputText.slice(0, 300) + '...';
    }
  }

  // Get icon and color based on block type
  let Icon: React.ElementType = MessageSquare;
  let color = 'bg-muted-foreground';
  let textColor = 'text-muted-foreground';
  let action = '';
  let target = '';
  let fullPath: string | undefined;
  let status: 'pending' | 'success' | 'error' | 'running' | undefined;

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
    target = thinkingText;
  } else if (block.type === 'text') {
    Icon = MessageSquare;
    color = TOOL_COLORS.text;
    textColor = TOOL_TEXT_COLORS.text;
    action = 'Output';
    target = outputText || block.text || '';
  } else if (block.type === 'code_block') {
    Icon = FileCode;
    color = 'bg-purple-500';
    textColor = 'text-purple-400';
    action = 'Code';
    target = block.filename || block.language || '';
  }

  const elapsedTime = timestamp && taskStartTime ? timestamp - taskStartTime : undefined;
  const showElapsed = elapsedTime !== undefined && elapsedTime >= 0;

  return (
    <div className={cn(
      "flex items-start gap-3 relative group",
      isSubagent && "ml-6 pl-4 border-l-2 border-indigo-500/50"
    )}>
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
              <span className="text-sm text-foreground break-words" title={fullPath || undefined}>
                {target}
              </span>
            </>
          )}

          {/* Status indicator */}
          {status && <StatusIcon status={status} />}

          {/* Timestamp - show on hover */}
          {showElapsed && (
            <span className="text-[10px] text-muted-foreground/50 ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {formatElapsedTime(elapsedTime!)}
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

// Tool call group component
function ToolCallGroup({
  toolName,
  count,
  files,
  expanded,
  onToggleExpanded,
  taskStartTime,
}: {
  toolName: string;
  count: number;
  files: string[];
  expanded: boolean;
  onToggleExpanded: () => void;
  taskStartTime?: number;
}) {
  const Icon = TOOL_ICONS[toolName] ?? Code;
  const color = TOOL_COLORS[toolName] || 'bg-gray-500';
  const textColor = TOOL_TEXT_COLORS[toolName] || 'text-muted-foreground';

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={onToggleExpanded}
        className="flex items-center gap-3 group hover:bg-muted/50 rounded p-2 transition-colors"
      >
        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10",
          color
        )}>
          <Icon className="h-3 w-3 text-white" />
        </div>
        <div className="flex items-center gap-2 flex-1">
          <span className={cn("text-sm font-medium", textColor)}>{toolName}</span>
          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
            {count}x
          </span>
          {!expanded && files.length > 0 && (
            <span className="text-xs text-muted-foreground truncate">
              {files.slice(0, 2).join(', ')}{files.length > 2 ? '...' : ''}
            </span>
          )}
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground transition-transform",
          !expanded && "-rotate-90"
        )} />
      </button>

      {expanded && files.length > 0 && (
        <div className="ml-9 flex flex-col gap-1 border-l border-muted pl-3">
          {files.map((file, idx) => (
            <div key={idx} className="text-xs text-muted-foreground truncate" title={file}>
              {file}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Grouped step: either a single step or a group of same-type tool calls
type GroupedStep =
  | { type: 'single'; step: { block: ContentBlock; timestamp?: number }; index: number }
  | { type: 'group'; toolName: string; steps: { block: ContentBlock; timestamp?: number }[]; files: string[]; startIndex: number };

// Group consecutive same-type tool calls within a phase
function groupSteps(steps: { block: ContentBlock; timestamp?: number }[]): GroupedStep[] {
  const result: GroupedStep[] = [];
  let i = 0;

  while (i < steps.length) {
    const current = steps[i];

    // Check if this is a tool_use block that might be grouped
    if (current.block.type === 'tool_use') {
      const toolName = current.block.toolName;
      let j = i + 1;

      // Count consecutive same-type tool calls
      while (j < steps.length && steps[j].block.type === 'tool_use' && (steps[j].block as ToolUseContent).toolName === toolName) {
        j++;
      }

      const count = j - i;
      if (count >= 3) {
        // Group them
        const groupStepsSlice = steps.slice(i, j);
        const files = groupStepsSlice.map(s => {
          if (s.block.type === 'tool_use') {
            const info = getToolDisplayInfo(s.block as ToolUseContent);
            return info.fullPath || info.target;
          }
          return '';
        }).filter(Boolean);

        result.push({ type: 'group', toolName, steps: groupStepsSlice, files, startIndex: i });
        i = j;
        continue;
      }
    }

    result.push({ type: 'single', step: current, index: i });
    i++;
  }

  return result;
}

// Phase content renderer with tool call grouping
function PhaseContent({
  phaseName,
  steps,
  taskStartTime,
  density,
}: {
  phaseName: string;
  steps: { block: ContentBlock; timestamp?: number }[];
  taskStartTime?: number;
  density?: DensityLevel;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});

  // In compact mode, show only a summary
  if (density === 'compact') {
    // Count tool calls by type
    const toolCounts: Record<string, number> = {};
    let errorCount = 0;
    steps.forEach(s => {
      if (s.block.type === 'tool_use') {
        const name = s.block.toolName;
        toolCounts[name] = (toolCounts[name] || 0) + 1;
        if (s.block.status === 'error') errorCount++;
      }
    });

    const summaryParts = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ${count}x`)
      .join(', ');

    return (
      <div className="px-4 py-2 border-t border-muted bg-muted/5 text-xs text-muted-foreground">
        {summaryParts || 'No tool calls'}
        {errorCount > 0 && <span className="text-red-400 ml-2">({errorCount} errors)</span>}
      </div>
    );
  }

  // Standard mode: group consecutive same-type tool calls for a compact view
  // Verbose mode: show every step individually with full content
  const grouped = density === 'standard' ? groupSteps(steps) : steps.map((step, idx): GroupedStep => ({ type: 'single', step, index: idx }));

  const toggleGroup = (idx: number) => {
    setExpandedGroups(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="px-4 py-3 border-t border-muted bg-muted/5">
      <div className="space-y-0">
        {grouped.map((item, gIdx) => {
          if (item.type === 'group') {
            return (
              <ToolCallGroup
                key={`group-${item.startIndex}`}
                toolName={item.toolName}
                count={item.steps.length}
                files={item.files}
                expanded={expandedGroups[item.startIndex] ?? false}
                onToggleExpanded={() => toggleGroup(item.startIndex)}
                taskStartTime={taskStartTime}
              />
            );
          }
          return (
            <TimelineStep
              key={`${phaseName}-${item.index}`}
              block={item.step.block}
              isLast={gIdx === grouped.length - 1}
              timestamp={item.step.timestamp}
              taskStartTime={taskStartTime}
              density={density}
            />
          );
        })}
      </div>
    </div>
  );
}

// Phase card component
function PhaseCard({
  phaseName,
  steps,
  isActive,
  isCompleted,
  expanded,
  onToggleExpanded,
  taskStartTime,
  density,
}: {
  phaseName: string;
  steps: { block: ContentBlock; timestamp?: number }[];
  isActive: boolean;
  isCompleted: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  taskStartTime?: number;
  density?: DensityLevel;
}) {
  const phaseColors = PHASE_COLORS[phaseName] || { bg: 'bg-gray-500', text: 'text-gray-400', icon: 'text-gray-400' };

  // Calculate phase duration
  const timestamps = steps
    .map(s => s.timestamp)
    .filter((t): t is number => t !== undefined);
  const startTime = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
  const endTime = timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  const duration = startTime && endTime ? endTime - startTime : undefined;

  // Determine status
  let statusLabel = 'Pending';
  let statusIcon = <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />;
  if (isActive) {
    statusLabel = 'Running';
    statusIcon = <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
  } else if (isCompleted) {
    statusLabel = 'Done';
    statusIcon = <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  }

  return (
    <div className="border border-muted rounded-lg overflow-hidden mb-3">
      {/* Phase header */}
      <button
        onClick={onToggleExpanded}
        className={cn(
          "w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors",
          isActive ? 'bg-muted/30' : 'bg-muted/10'
        )}
      >
        {/* Phase indicator dot */}
        <div className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
          phaseColors.bg
        )}>
          <Zap className="h-2.5 w-2.5 text-white" />
        </div>

        {/* Phase name and details */}
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{phaseName}</span>
            {duration && duration > 100 && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(duration)}
              </span>
            )}
          </div>
        </div>

        {/* Step count */}
        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
          {steps.length} steps
        </span>

        {/* Status badge and icon */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
          {statusIcon}
        </div>

        {/* Expand/collapse chevron */}
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground transition-transform flex-shrink-0",
          !expanded && "-rotate-90"
        )} />
      </button>

      {/* Phase content */}
      {expanded && (
        <PhaseContent
          phaseName={phaseName}
          steps={steps}
          taskStartTime={taskStartTime}
          density={density}
        />
      )}
    </div>
  );
}

/**
 * StructuredOutput - Phase-centric timeline view component
 *
 * Displays agent activity as a phase-based timeline with:
 * - Sticky progress header showing phase states
 * - Collapsible phase cards grouping steps
 * - Tool call grouping for reduced noise
 * - Density toggle for different verbosity levels
 * - Parallel agent detection and indentation
 * - Auto-scroll to bottom on new content
 */
export function StructuredOutput({
  messages,
  className,
  autoScroll = true,
  taskId,
}: StructuredOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  // Always call hook unconditionally (React rules of hooks)
  const task = useTaskStore(state => taskId ? state.tasks.find(t => t.id === taskId) : undefined);
  // Use the first message timestamp as fallback for task start time
  const firstMessageTimestamp = messages.length > 0 ? messages[0].timestamp : undefined;
  const taskStartTime = (task?.executionProgress?.startedAt
    ? new Date(task.executionProgress.startedAt).getTime()
    : firstMessageTimestamp) || undefined;

  const [density, setDensity] = useState<DensityLevel>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('timeline-density') as DensityLevel) || 'standard';
    }
    return 'standard';
  });

  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>({
    'Planning': true,
    'Coding': true,
    'Validation': false,
  });

  // Persist density preference
  const handleDensityChange = useCallback((newDensity: DensityLevel) => {
    setDensity(newDensity);
    if (typeof window !== 'undefined') {
      localStorage.setItem('timeline-density', newDensity);
    }
  }, []);

  // Flatten and filter all content blocks
  const timelineSteps = useMemo(() => {
    const steps: { block: ContentBlock; key: string; timestamp: number }[] = [];
    const seenSecuritySettings = new Set<string>();

    messages.forEach((message, msgIdx) => {
      // Skip user messages
      if (message.role === 'user') return;

      const messageTimestamp = message.timestamp || Date.now();

      message.content.forEach((block, blockIdx) => {
        // Skip empty text blocks
        if (block.type === 'text' && !block.text?.trim()) return;

        // Filter __TASK_LOG__ markers
        if (block.type === 'text' && block.text?.match(/^__TASK_LOG_\w+__:/)) return;

        // Deduplicate security settings blocks
        if (block.type === 'text') {
          const text = block.text || '';
          if (
            text.includes('IMPORTANT: Tool permissions') ||
            text.includes('Allowed tools:') ||
            text.includes('security_settings') ||
            text.includes('allowed_tools')
          ) {
            const blockHash = text.slice(0, 100);
            if (seenSecuritySettings.has(blockHash)) return;
            seenSecuritySettings.add(blockHash);
          }
        }

        steps.push({
          block,
          key: `${msgIdx}-${blockIdx}`,
          timestamp: messageTimestamp,
        });
      });
    });

    return steps;
  }, [messages]);

  // Group steps by phase
  const phaseGroups = useMemo(() => {
    const groups: Record<string, { block: ContentBlock; timestamp?: number }[]> = {
      'Setup': [],
      'Planning': [],
      'Coding': [],
      'Validation': [],
    };

    let currentPhase = 'Setup';

    timelineSteps.forEach(step => {
      // Detect phase transitions
      if (step.block.type === 'text' && step.block.text?.startsWith('[Phase:')) {
        const match = step.block.text.match(/\[Phase:\s*(.+?)\]/);
        if (match) {
          const newPhase = match[1].trim();
          if (newPhase in groups) {
            currentPhase = newPhase;
          }
        }
        // Don't include the phase marker itself
        return;
      }

      if (!groups[currentPhase]) {
        groups[currentPhase] = [];
      }
      groups[currentPhase].push({
        block: step.block,
        timestamp: step.timestamp,
      });
    });

    // Remove empty Setup phase
    if (groups['Setup'].length === 0) {
      delete groups['Setup'];
    }

    return groups;
  }, [timelineSteps]);

  // Get active and completed phases from task store, mapped to display names
  const rawCompletedPhases = task?.executionProgress?.completedPhases || [];
  const completedPhaseNames = rawCompletedPhases.map(p => EXECUTION_TO_PHASE_NAME[p]).filter(Boolean);
  const rawCurrentPhase = task?.executionProgress?.phase || 'coding';
  const currentPhaseName = EXECUTION_TO_PHASE_NAME[rawCurrentPhase] || 'Coding';

  // Toggle phase expansion
  const togglePhaseExpanded = useCallback((phaseName: string) => {
    setExpandedPhases(prev => ({
      ...prev,
      [phaseName]: !prev[phaseName],
    }));
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [timelineSteps, autoScroll]);

  // Filter phases for display based on density
  const visiblePhases = useMemo(() => {
    // In compact mode, still show all phases but PhaseCard will render summary counts only
    // Only hide phases with zero steps
    return Object.entries(phaseGroups).filter(([, steps]) => steps.length > 0);
  }, [phaseGroups]);

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

  // Build progress header data
  const progressPhases = ['Planning', 'Coding', 'Validation'] as const;
  const progressItems = progressPhases.map(phaseName => {
    const isCompleted = completedPhaseNames.includes(phaseName);
    const isActive = currentPhaseName === phaseName;
    const status = isCompleted ? 'Done' : isActive ? 'Running' : 'Pending';
    const steps = phaseGroups[phaseName];

    const phaseColors = PHASE_COLORS[phaseName];
    const timestamps = steps ? steps.map(s => s.timestamp).filter((t): t is number => t !== undefined) : [];
    const duration = timestamps.length > 1 ? formatDuration(Math.max(...timestamps) - Math.min(...timestamps)) : '';

    return { phaseName, isCompleted, isActive, status, duration, phaseColors, stepCount: steps?.length || 0 };
  });

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Sticky progress header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-3 space-y-2.5">
        {/* Phase pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {progressItems.map(({ phaseName, isCompleted, isActive, status, duration, phaseColors }) => (
            <div
              key={phaseName}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                isActive && "border-blue-500/50 bg-blue-500/10",
                isCompleted && "border-green-500/30 bg-green-500/5",
                !isActive && !isCompleted && "border-border bg-muted/30"
              )}
            >
              {/* Status indicator */}
              {isCompleted ? (
                <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
              ) : isActive ? (
                <Loader2 className="h-3 w-3 text-blue-500 animate-spin flex-shrink-0" />
              ) : (
                <div className="w-3 h-3 rounded-full border border-muted-foreground/40 flex-shrink-0" />
              )}
              <span className={cn(
                isCompleted ? "text-green-400" : isActive ? phaseColors.text : "text-muted-foreground"
              )}>
                {phaseName}
              </span>
              {/* Duration for completed/active phases */}
              {duration && (
                <span className="text-muted-foreground/60">{duration}</span>
              )}
            </div>
          ))}
        </div>

        {/* Density toggle + step count */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {timelineSteps.length} steps
          </span>
          <div className="flex items-center gap-1">
            {(['compact', 'standard', 'verbose'] as const).map(level => (
              <button
                key={level}
                onClick={() => handleDensityChange(level)}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded transition-colors capitalize",
                  density === level
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {visiblePhases.map(([phaseName, steps]) => (
            <PhaseCard
              key={phaseName}
              phaseName={phaseName}
              steps={steps}
              isActive={currentPhaseName === phaseName}
              isCompleted={completedPhaseNames.includes(phaseName)}
              expanded={expandedPhases[phaseName] ?? (currentPhaseName === phaseName)}
              onToggleExpanded={() => togglePhaseExpanded(phaseName)}
              taskStartTime={taskStartTime}
              density={density}
            />
          ))}
        </div>

        {/* Auto-scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
