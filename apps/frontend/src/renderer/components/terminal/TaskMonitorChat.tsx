/**
 * TaskMonitorChat - Rich interactive chat interface for task monitor terminals
 *
 * Displays task output in a Claude Code extension-like UI with:
 * - Bullet point indicators for each block type
 * - Tool use blocks (Read, Edit, Bash) with proper formatting
 * - Collapsible thinking blocks
 * - Side-by-side diff views for edits
 * - IN/OUT format for Bash commands
 * - Auto-scrolling message list
 */

import { useEffect, useRef, useState, useCallback, createContext, useContext } from 'react';
import { useTerminalStore } from '../../stores/terminal-store';
import { useTaskStore } from '../../stores/task-store';
import { Button } from '../ui/button';
import { ChevronUp, ChevronDown, Paperclip, Send, ArrowDown } from 'lucide-react';
import type { Terminal as TerminalType } from '../../stores/terminal-store';
import type { ContentBlock, ToolUseContent } from '../../lib/claude-output-parser';
import { cn } from '../../lib/utils';

// Context for coordinating thinking blocks to expand/collapse together
const ThinkingExpandContext = createContext<{
  allExpanded: boolean;
  toggleAll: () => void;
}>({ allExpanded: false, toggleAll: () => {} });

interface TaskMonitorChatProps {
  terminal: TerminalType;
  terminalRef: React.RefObject<HTMLDivElement | null>;
  isActive?: boolean;
  isMinimized?: boolean;
}

// Bullet colors for different block types (matching Claude Code extension)
const BULLET_COLORS: Record<string, string> = {
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
  text: 'bg-foreground/50',
};

// Status colors for success/error indication
const STATUS_COLORS = {
  success: 'border-l-green-500 bg-green-500/5',
  error: 'border-l-red-500 bg-red-500/5',
  running: 'border-l-blue-500 bg-blue-500/5',
};

/**
 * Collapsible thinking block matching Claude Code style
 * Uses context to toggle all thinking blocks together
 */
function ThinkingBlock({ content }: { content: string }) {
  const { allExpanded, toggleAll } = useContext(ThinkingExpandContext);

  return (
    <div className="flex gap-3 py-1">
      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${BULLET_COLORS.thinking}`} />
      <div className="flex-1 min-w-0">
        <button
          onClick={toggleAll}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="italic">Thinking</span>
          {allExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        {allExpanded && (
          <div className="mt-2 text-sm text-muted-foreground/80 italic whitespace-pre-wrap">
            {content}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Tool block matching Claude Code style - Read, Edit, Bash, etc.
 * FIX-5: Enhanced with file paths, commands, and status colors
 */
function ToolBlock({ tool }: { tool: ToolUseContent }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const bulletColor = BULLET_COLORS[tool.toolName] || 'bg-gray-500';
  const statusColor = tool.status ? STATUS_COLORS[tool.status] || '' : '';

  // Format the tool header based on tool type
  const getToolHeader = () => {
    const input = tool.input || {};

    if (tool.toolName === 'Read') {
      const filePath = input.file_path as string || '';
      const lines = input.offset && input.limit
        ? ` (lines ${input.offset}-${(input.offset as number) + (input.limit as number)})`
        : '';
      return <span className="font-mono text-xs truncate">{filePath}{lines}</span>;
    }

    if (tool.toolName === 'Edit' || tool.toolName === 'Write') {
      const filePath = input.file_path as string || '';
      return <span className="font-mono text-xs truncate">{filePath}</span>;
    }

    if (tool.toolName === 'Bash') {
      const description = input.description as string || 'Run command';
      return <span className="text-xs text-muted-foreground truncate">{description}</span>;
    }

    if (tool.toolName === 'Grep' || tool.toolName === 'Glob') {
      const pattern = input.pattern as string || '';
      return <span className="font-mono text-xs truncate">{pattern}</span>;
    }

    // Default: show first meaningful input value
    const firstValue = Object.values(input).find(v => typeof v === 'string' && v.length < 100);
    return firstValue ? <span className="font-mono text-xs truncate">{firstValue as string}</span> : null;
  };

  // Render Bash tool with IN/OUT format - FIX-5: Enhanced command display
  if (tool.toolName === 'Bash') {
    const command = tool.input?.command as string || '';
    const description = tool.input?.description as string || '';

    return (
      <div className={cn("flex gap-3 py-1 pl-1 border-l-2", statusColor || 'border-l-transparent')}>
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${bulletColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-purple-500">Bash</span>
            {description && <span className="text-xs text-muted-foreground truncate">{description}</span>}
            {tool.status && (
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded ml-auto",
                tool.status === 'success' && 'bg-green-500/20 text-green-400',
                tool.status === 'error' && 'bg-red-500/20 text-red-400',
                tool.status === 'running' && 'bg-blue-500/20 text-blue-400'
              )}>
                {tool.status}
              </span>
            )}
          </div>

          {/* Command input - FIX-5: Always show command prominently */}
          <div className="mt-2 rounded bg-muted/50 border border-border overflow-hidden">
            <div className="flex">
              <div className={cn(
                "px-2 py-1.5 text-xs font-medium border-r border-border min-w-[36px] text-center",
                tool.status === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-muted/80 text-muted-foreground'
              )}>
                IN
              </div>
              <div className="px-3 py-1.5 font-mono text-xs flex-1 overflow-x-auto whitespace-pre-wrap break-all text-foreground">
                {command || '(no command)'}
              </div>
            </div>

            {/* Command output */}
            {tool.output && (
              <div className="flex border-t border-border">
                <div className={cn(
                  "px-2 py-1.5 text-xs font-medium border-r border-border min-w-[36px] text-center",
                  tool.status === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-muted/80 text-muted-foreground'
                )}>
                  OUT
                </div>
                <div className={cn(
                  "px-3 py-1.5 font-mono text-xs flex-1 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto",
                  tool.status === 'error' ? 'text-red-400' : 'text-muted-foreground'
                )}>
                  {tool.output}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render Edit tool with collapsible unified diff view - FIX-5: Show file path prominently
  if (tool.toolName === 'Edit') {
    const filePath = tool.input?.file_path as string || '';
    const oldString = tool.input?.old_string as string || '';
    const newString = tool.input?.new_string as string || '';
    const hasDiff = oldString || newString;
    const oldLinesArr = oldString ? oldString.split('\n') : [];
    const newLinesArr = newString ? newString.split('\n') : [];

    return (
      <div className={cn("flex gap-3 py-1 pl-1 border-l-2", statusColor || 'border-l-transparent')}>
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${bulletColor}`} />
        <div className="flex-1 min-w-0">
          <button
            onClick={() => hasDiff && setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity w-full text-left"
          >
            <span className="font-semibold text-green-500">Edit:</span>
            <span className="font-mono text-xs text-foreground truncate">{filePath || '(no path)'}</span>
            {tool.status && (
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded",
                tool.status === 'success' && 'bg-green-500/20 text-green-400',
                tool.status === 'error' && 'bg-red-500/20 text-red-400',
                tool.status === 'running' && 'bg-blue-500/20 text-blue-400'
              )}>
                {tool.status === 'success' ? 'Modified' : tool.status}
              </span>
            )}
            {hasDiff && (
              <span className="ml-auto flex-shrink-0">
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </span>
            )}
          </button>

          {/* Unified diff view - collapsible */}
          {isExpanded && hasDiff && (
            <div className="mt-2 rounded border border-border overflow-hidden">
              <div className="text-xs font-mono max-h-64 overflow-y-auto">
                {/* Removed lines (red) */}
                {oldLinesArr.map((line, i) => (
                  <div key={`old-${i}`} className="bg-red-500/10 text-red-400 px-2 py-0.5 border-l-2 border-red-500">
                    <span className="select-none opacity-60 mr-2">-</span>
                    <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
                  </div>
                ))}
                {/* Added lines (green) */}
                {newLinesArr.map((line, i) => (
                  <div key={`new-${i}`} className="bg-green-500/10 text-green-400 px-2 py-0.5 border-l-2 border-green-500">
                    <span className="select-none opacity-60 mr-2">+</span>
                    <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render Read tool with expandable content - FIX-5: Show file path prominently
  if (tool.toolName === 'Read') {
    const filePath = tool.input?.file_path as string || '';
    const lines = tool.input?.offset && tool.input?.limit
      ? ` (lines ${tool.input.offset}-${(tool.input.offset as number) + (tool.input.limit as number)})`
      : '';

    return (
      <div className={cn("flex gap-3 py-1 pl-1 border-l-2", statusColor || 'border-l-transparent')}>
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${bulletColor}`} />
        <div className="flex-1 min-w-0">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity w-full text-left"
          >
            <span className="font-semibold text-blue-500">Read:</span>
            <span className="font-mono text-xs text-foreground truncate">{filePath || '(no path)'}{lines}</span>
            {tool.status && (
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded",
                tool.status === 'success' && 'bg-green-500/20 text-green-400',
                tool.status === 'error' && 'bg-red-500/20 text-red-400',
                tool.status === 'running' && 'bg-blue-500/20 text-blue-400'
              )}>
                {tool.status}
              </span>
            )}
            {tool.output && (
              <span className="ml-auto flex-shrink-0">
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </span>
            )}
          </button>

          {isExpanded && tool.output && (
            <div className="mt-2 rounded bg-muted/30 border border-border p-2 overflow-x-auto">
              <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap max-h-96 overflow-y-auto">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render Grep tool with line count and expandable output
  if (tool.toolName === 'Grep') {
    const pattern = tool.input?.pattern as string || '';
    const outputLines = tool.output ? tool.output.split('\n').filter(l => l.trim()).length : 0;

    return (
      <div className="flex gap-3 py-1">
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${bulletColor}`} />
        <div className="flex-1 min-w-0">
          <button
            onClick={() => tool.output && setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity w-full text-left"
          >
            <span className="font-semibold text-orange-500">Grep</span>
            <span className="font-mono text-xs truncate">"{pattern}"</span>
            {tool.output && (
              <>
                <span className="text-xs text-muted-foreground ml-auto mr-2">
                  {outputLines} lines of output
                </span>
                <span className="flex-shrink-0">
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </span>
              </>
            )}
          </button>

          {isExpanded && tool.output && (
            <div className="mt-2 rounded bg-muted/30 border border-border overflow-hidden">
              <pre className="p-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap max-h-96 overflow-y-auto">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render Glob tool with file count and expandable output
  if (tool.toolName === 'Glob') {
    const pattern = tool.input?.pattern as string || '';
    const outputLines = tool.output ? tool.output.split('\n').filter(l => l.trim()).length : 0;

    return (
      <div className="flex gap-3 py-1">
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${bulletColor}`} />
        <div className="flex-1 min-w-0">
          <button
            onClick={() => tool.output && setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity w-full text-left"
          >
            <span className="font-semibold text-pink-500">Glob</span>
            <span className="font-mono text-xs truncate">"{pattern}"</span>
            {tool.output && (
              <>
                <span className="text-xs text-muted-foreground ml-auto mr-2">
                  {outputLines} {outputLines === 1 ? 'file' : 'files'} found
                </span>
                <span className="flex-shrink-0">
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </span>
              </>
            )}
          </button>

          {isExpanded && tool.output && (
            <div className="mt-2 rounded bg-muted/30 border border-border overflow-hidden">
              <pre className="p-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap max-h-96 overflow-y-auto">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default tool rendering
  return (
    <div className="flex gap-3 py-1">
      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${bulletColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{tool.toolName}</span>
          {getToolHeader()}
          {tool.status && (
            <span className={cn(
              "text-xs px-1.5 py-0.5 rounded",
              tool.status === 'success' && 'bg-green-500/20 text-green-400',
              tool.status === 'error' && 'bg-red-500/20 text-red-400',
              tool.status === 'running' && 'bg-blue-500/20 text-blue-400'
            )}>
              {tool.status}
            </span>
          )}
        </div>

        {tool.output && (
          <div className="mt-2 rounded bg-muted/30 border border-border p-2">
            <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
              {tool.output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Text block with bullet point
 * FIX-5: Enhanced phase headers for better readability
 */
function TextBlock({ content }: { content: string }) {
  // Skip empty content
  if (!content.trim()) return null;

  // Check if this is a phase marker - FIX-5: Enhanced phase headers
  if (content.startsWith('[Phase:') || content.startsWith('[Subphase:')) {
    const phaseText = content.replace(/[\[\]]/g, '');
    const isMainPhase = content.startsWith('[Phase:');

    return (
      <div className={cn(
        "my-3 py-2 px-3 rounded border-l-4",
        isMainPhase
          ? "border-l-cyan-500 bg-cyan-500/10"
          : "border-l-muted-foreground/50 bg-muted/30"
      )}>
        <span className={cn(
          "text-xs font-semibold uppercase tracking-wider",
          isMainPhase ? "text-cyan-400" : "text-muted-foreground"
        )}>
          {phaseText}
        </span>
      </div>
    );
  }

  return (
    <div className="flex gap-3 py-1">
      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${BULLET_COLORS.text}`} />
      <div className="flex-1 min-w-0 text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed break-words">
        {content}
      </div>
    </div>
  );
}

/**
 * Render a content block based on its type
 */
function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return <TextBlock content={block.text} />;

    case 'thinking':
      return <ThinkingBlock content={block.text} />;

    case 'tool_use':
      return <ToolBlock tool={block} />;

    case 'code_block':
      return (
        <div className="flex gap-3 py-1">
          <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-purple-500" />
          <div className="flex-1 min-w-0">
            {block.filename && (
              <div className="text-xs font-mono text-muted-foreground mb-1">{block.filename}</div>
            )}
            <div className="rounded bg-muted/50 border border-border overflow-hidden">
              <pre className="p-3 font-mono text-xs overflow-x-auto max-h-96 overflow-y-auto">
                {block.code}
              </pre>
            </div>
          </div>
        </div>
      );

    case 'diff':
      return (
        <div className="flex gap-3 py-1">
          <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-green-500" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium mb-1">{block.filename}</div>
            <div className="rounded border border-border overflow-hidden">
              <pre className="p-2 font-mono text-xs bg-muted/30 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
                {block.newContent}
              </pre>
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

/**
 * User message bubble component
 */
function UserMessageBlock({ content }: { content: string }) {
  return (
    <div className="flex justify-end py-2">
      <div className="max-w-[80%] bg-primary text-primary-foreground px-4 py-2 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

export function TaskMonitorChat({ terminal, terminalRef, isActive = false, isMinimized = false }: TaskMonitorChatProps) {
  const { messages = [] } = terminal;
  const initializeParser = useTerminalStore((state) => state.initializeParser);
  const addUserMessage = useTerminalStore((state) => state.addUserMessage);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);

  // State for toggling all thinking blocks together
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const toggleThinking = useCallback(() => {
    setThinkingExpanded(prev => !prev);
  }, []);

  // Get taskId from terminal (task monitors have taskId)
  const taskId = terminal.taskId;

  // Get the actual task from the task store to check its real status
  // Tasks with status 'in_progress' are running (both planning and coding phases)
  const task = useTaskStore((state) =>
    taskId ? state.tasks.find(t => t.id === taskId) : undefined
  );

  // A task is considered running if:
  // 1. Terminal says it's running, OR
  // 2. The task's actual status is 'coding' (covers planning phase too)
  const isTaskRunning = terminal.taskStatus === 'running' || task?.status === 'coding';

  // Handle sending a message to the task (works even when task isn't running)
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || !taskId || isSending) return;

    const message = inputValue.trim();
    setInputValue('');
    setIsSending(true);

    try {
      // Add user message to the chat UI immediately (stored in terminal state)
      addUserMessage(terminal.id, message);

      // Only attempt to send via IPC if the task is actually running
      // Messages stored locally will be available when task starts
      if (isTaskRunning) {
        const result = await window.electronAPI.sendMessageToTask(taskId, message);
        if (!result.success) {
          console.error('[TaskMonitorChat] Failed to send message:', result.error);
        }
      } else {
        console.log('[TaskMonitorChat] Task not running, message stored locally for when task starts');
      }
    } catch (error) {
      console.error('[TaskMonitorChat] Error sending message:', error);
    } finally {
      setIsSending(false);
    }
  }, [inputValue, taskId, isSending, isTaskRunning, terminal.id, addUserMessage]);

  // Handle key press in textarea
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // Auto-resize textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    // Auto-resize
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }, []);

  // Initialize parser on mount
  useEffect(() => {
    if (!terminal.parser) {
      initializeParser(terminal.id);
    }
  }, [terminal.id, terminal.parser, initializeParser]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;

    if (isNearBottom) {
      setAutoScroll(true);
      setUserScrolledUp(false);
    } else {
      setAutoScroll(false);
      setUserScrolledUp(true);
    }
  }, []);

  // Scroll to bottom handler
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      setAutoScroll(true);
      setUserScrolledUp(false);
    }
  }, []);

  // When minimized, render just the hidden xterm ref - no visible content
  if (isMinimized) {
    return <div ref={terminalRef} className="hidden" />;
  }

  return (
    <ThinkingExpandContext.Provider value={{ allExpanded: thinkingExpanded, toggleAll: toggleThinking }}>
      <div className="flex flex-col flex-1 min-h-0 bg-background relative">
        {/* Message list - scrollable container */}
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4"
          onScroll={handleScroll}
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-8 h-8 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin mb-4" />
              <div className="text-muted-foreground text-sm">
                Waiting for task output...
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {messages.map((message, index) => (
                <div key={`${message.timestamp}-${index}`}>
                  {message.role === 'user' ? (
                    // Render user messages as chat bubbles
                    message.content.map((block, blockIndex) => (
                      block.type === 'text' && (
                        <UserMessageBlock key={blockIndex} content={block.text} />
                      )
                    ))
                  ) : (
                    // Render assistant messages with tool blocks, thinking, etc.
                    message.content.map((block, blockIndex) => (
                      <ContentBlockRenderer key={blockIndex} block={block} />
                    ))
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scroll to bottom button - shows when user scrolled up */}
        {userScrolledUp && (
          <div className={cn(
            "absolute right-4 z-10",
            isActive ? "bottom-24" : "bottom-4"
          )}>
            <Button
              size="sm"
              onClick={scrollToBottom}
              className="shadow-lg rounded-full h-8 w-8 p-0"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Bottom input area - only show when terminal is active */}
        {isActive && (
          <div className="border-t border-border p-3 bg-muted/20">
            <div className="text-xs text-center text-muted-foreground/70 mb-2">
              {isTaskRunning
                ? "Send feedback to the running agent (processed at next iteration)"
                : "Add notes or instructions (will be sent when task starts)"}
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent min-h-[44px] max-h-[120px] placeholder:text-muted-foreground/60"
                  placeholder={isTaskRunning ? "Send a message to the agent..." : "Add notes for when task starts..."}
                  rows={1}
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  disabled={isSending}
                />
              </div>
              <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground" disabled title="Attachments coming soon">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                className={cn(
                  "h-10 w-10 text-white",
                  inputValue.trim()
                    ? "bg-orange-500 hover:bg-orange-600"
                    : "bg-orange-500/50 cursor-not-allowed"
                )}
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isSending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Hidden xterm container (required for raw terminal fallback) */}
        <div ref={terminalRef} className="hidden" />
      </div>
    </ThinkingExpandContext.Provider>
  );
}
