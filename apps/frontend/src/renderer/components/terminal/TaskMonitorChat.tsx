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
 * - TERM-5: Syntax highlighting for code blocks
 * - TERM-6: Copy buttons for code content
 * - TERM-7: Search in history (Ctrl+F)
 * - TERM-8: Message timestamps
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback, createContext, useContext, useMemo } from 'react';
import { useTerminalStore } from '../../stores/terminal-store';
import { useTaskStore } from '../../stores/task-store';
import { Button } from '../ui/button';
import { ChevronUp, ChevronDown, Paperclip, Send, ArrowDown, Copy, Check, Search, X, List, AlignLeft } from 'lucide-react';
import type { Terminal as TerminalType } from '../../stores/terminal-store';
import type { ContentBlock, ToolUseContent } from '../../lib/claude-output-parser';
import { cn } from '../../lib/utils';
import { StructuredOutput } from './StructuredOutput';
import hljs from 'highlight.js/lib/core';
// Register common languages for syntax highlighting
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import 'highlight.js/styles/github-dark.css';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('sql', sql);

// TERM-5: Detect language from file extension
function detectLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const extMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'json': 'json',
    'sh': 'bash',
    'bash': 'bash',
    'css': 'css',
    'scss': 'css',
    'html': 'html',
    'xml': 'xml',
    'md': 'markdown',
    'yaml': 'yaml',
    'yml': 'yaml',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'sql': 'sql',
  };
  return ext ? extMap[ext] : undefined;
}

// TERM-5: Highlight code with language detection
function highlightCode(code: string, language?: string): string {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language }).value;
    } catch {
      // Fall back to auto-detection
    }
  }
  // Try auto-detection
  try {
    return hljs.highlightAuto(code).value;
  } catch {
    return code;
  }
}

// TERM-6: Copy button component with visual feedback
function CopyButton({ content, className = '' }: { content: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[CopyButton] Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "p-1 rounded hover:bg-muted/50 transition-colors",
        copied ? "text-green-500" : "text-muted-foreground hover:text-foreground",
        className
      )}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// TERM-8: Format timestamp for message groups
function formatMessageTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  // Same day - show time only
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Different day - show date and time
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
         date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Context for coordinating thinking blocks to expand/collapse together
const ThinkingExpandContext = createContext<{
  allExpanded: boolean;
  toggleAll: () => void;
}>({ allExpanded: false, toggleAll: () => {} });

// TERM-7: Search context for highlighting matches
const SearchContext = createContext<{
  searchQuery: string;
  currentMatchIndex: number;
  totalMatches: number;
}>({ searchQuery: '', currentMatchIndex: 0, totalMatches: 0 });

// TERM-7: Highlight search matches in text
function highlightSearchMatches(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-500/50 text-foreground rounded px-0.5">{part}</mark>
    ) : (
      part
    )
  );
}

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
const STATUS_COLORS: Record<string, string> = {
  success: 'border-l-green-500 bg-green-500/5',
  error: 'border-l-red-500 bg-red-500/5',
  running: 'border-l-blue-500 bg-blue-500/5',
  pending: 'border-l-muted-foreground bg-muted/5',
};

// TERM-2: Constants for expandable long outputs
const MAX_VISIBLE_LINES = 20;
const PREVIEW_LINES = 15;

/**
 * TruncatedOutput - Shows truncated content with expand option
 * TERM-2: Expandable long outputs feature
 * TERM-5: Now supports syntax highlighting
 * TERM-6: Now includes copy button
 */
function TruncatedOutput({
  content,
  className = '',
  showLineNumbers = false,
  language,
  showCopyButton = false
}: {
  content: string;
  className?: string;
  showLineNumbers?: boolean;
  language?: string;
  showCopyButton?: boolean;
}) {
  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const { searchQuery } = useContext(SearchContext);
  const lines = content.split('\n');
  const totalLines = lines.length;
  const shouldTruncate = totalLines > MAX_VISIBLE_LINES;
  const hiddenCount = totalLines - PREVIEW_LINES;

  const displayLines = shouldTruncate && !isFullyExpanded
    ? lines.slice(0, PREVIEW_LINES)
    : lines;

  const lineNumWidth = totalLines.toString().length;

  // TERM-5: Apply syntax highlighting if language is specified
  const highlightedContent = useMemo(() => {
    if (!language) return null;
    return highlightCode(displayLines.join('\n'), language);
  }, [displayLines, language]);

  return (
    <div className={cn("relative group", className)}>
      {/* TERM-6: Copy button */}
      {showCopyButton && (
        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <CopyButton content={content} />
        </div>
      )}
      {highlightedContent ? (
        // TERM-5: Syntax highlighted output
        <pre
          className="font-mono text-xs whitespace-pre-wrap hljs"
          dangerouslySetInnerHTML={{ __html: highlightedContent }}
        />
      ) : (
        // Plain text output with optional line numbers and search highlighting
        <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap">
          {displayLines.map((line, i) => (
            <div key={i} className="flex">
              {showLineNumbers && (
                <span className="select-none text-gray-500 mr-3" style={{ minWidth: `${lineNumWidth}ch` }}>
                  {(i + 1).toString().padStart(lineNumWidth, ' ')}
                </span>
              )}
              <span className="select-none opacity-50 mr-2">|</span>
              <span className="flex-1">{searchQuery ? highlightSearchMatches(line || ' ', searchQuery) : (line || ' ')}</span>
            </div>
          ))}
        </pre>
      )}
      {shouldTruncate && !isFullyExpanded && (
        <button
          onClick={() => setIsFullyExpanded(true)}
          className="mt-1 text-xs text-blue-500 hover:text-blue-400 hover:underline"
        >
          ... +{hiddenCount} lines (click to expand)
        </button>
      )}
      {shouldTruncate && isFullyExpanded && (
        <button
          onClick={() => setIsFullyExpanded(false)}
          className="mt-1 text-xs text-blue-500 hover:text-blue-400 hover:underline"
        >
          (click to collapse)
        </button>
      )}
    </div>
  );
}

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
 * Tool block - Raw Claude Code terminal style
 * Simple text output with minimal styling
 */
function ToolBlock({ tool }: { tool: ToolUseContent }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Render Bash tool - simple command/output format
  if (tool.toolName === 'Bash') {
    const command = tool.input?.command as string || '';
    const description = tool.input?.description as string || '';

    return (
      <div className="py-1 font-mono text-xs">
        <div className="text-muted-foreground">
          <span className="text-purple-400">❯ </span>
          <span className="text-foreground">{command || '(no command)'}</span>
          {description && <span className="text-muted-foreground/60 ml-2">// {description}</span>}
        </div>
        {tool.output && (
          <pre className={cn(
            "mt-1 pl-4 whitespace-pre-wrap break-all max-h-48 overflow-y-auto",
            tool.status === 'error' ? 'text-red-400' : 'text-muted-foreground'
          )}>
            {tool.output}
          </pre>
        )}
      </div>
    );
  }

  // Render Edit tool - simple diff format
  if (tool.toolName === 'Edit') {
    const filePath = tool.input?.file_path as string || '';
    const oldString = tool.input?.old_string as string || '';
    const newString = tool.input?.new_string as string || '';
    const hasDiff = oldString || newString;

    return (
      <div className="py-1 font-mono text-xs">
        <button
          onClick={() => hasDiff && setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 hover:underline cursor-pointer"
        >
          <span className="text-green-400">✎ Edit:</span>
          <span className="text-foreground">{filePath}</span>
          {hasDiff && <span className="text-muted-foreground/60">[{isExpanded ? '-' : '+'}]</span>}
        </button>
        {isExpanded && hasDiff && (
          <div className="mt-1 pl-4 max-h-64 overflow-y-auto">
            {oldString && oldString.split('\n').map((line, i) => (
              <div key={`old-${i}`} className="text-red-400">- {line || ' '}</div>
            ))}
            {newString && newString.split('\n').map((line, i) => (
              <div key={`new-${i}`} className="text-green-400">+ {line || ' '}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Render Read tool - simple file path with expandable content
  if (tool.toolName === 'Read') {
    const filePath = tool.input?.file_path as string || '';
    const lines = tool.input?.offset && tool.input?.limit
      ? ` (${tool.input.offset}-${(tool.input.offset as number) + (tool.input.limit as number)})`
      : '';

    return (
      <div className="py-1 font-mono text-xs">
        <button
          onClick={() => tool.output && setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 hover:underline cursor-pointer"
        >
          <span className="text-blue-400">📄 Read:</span>
          <span className="text-foreground">{filePath}{lines}</span>
          {tool.output && <span className="text-muted-foreground/60">[{isExpanded ? '-' : '+'}]</span>}
        </button>
        {isExpanded && tool.output && (
          <pre className="mt-1 pl-4 text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
            {tool.output}
          </pre>
        )}
      </div>
    );
  }

  // Render Grep tool - simple pattern with results
  if (tool.toolName === 'Grep') {
    const pattern = tool.input?.pattern as string || '';
    const outputLines = tool.output ? tool.output.split('\n').filter(l => l.trim()).length : 0;

    return (
      <div className="py-1 font-mono text-xs">
        <button
          onClick={() => tool.output && setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 hover:underline cursor-pointer"
        >
          <span className="text-orange-400">🔍 Grep:</span>
          <span className="text-foreground">"{pattern}"</span>
          {tool.output && (
            <span className="text-muted-foreground/60">
              ({outputLines} matches) [{isExpanded ? '-' : '+'}]
            </span>
          )}
        </button>
        {isExpanded && tool.output && (
          <pre className="mt-1 pl-4 text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
            {tool.output}
          </pre>
        )}
      </div>
    );
  }

  // Render Glob tool - simple pattern with file count
  if (tool.toolName === 'Glob') {
    const pattern = tool.input?.pattern as string || '';
    const outputLines = tool.output ? tool.output.split('\n').filter(l => l.trim()).length : 0;

    return (
      <div className="py-1 font-mono text-xs">
        <button
          onClick={() => tool.output && setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 hover:underline cursor-pointer"
        >
          <span className="text-pink-400">📁 Glob:</span>
          <span className="text-foreground">"{pattern}"</span>
          {tool.output && (
            <span className="text-muted-foreground/60">
              ({outputLines} files) [{isExpanded ? '-' : '+'}]
            </span>
          )}
        </button>
        {isExpanded && tool.output && (
          <pre className="mt-1 pl-4 text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
            {tool.output}
          </pre>
        )}
      </div>
    );
  }

  // Default tool rendering - simple format
  const input = tool.input || {};
  const firstValue = Object.values(input).find(v => typeof v === 'string' && v.length < 100);

  return (
    <div className="py-1 font-mono text-xs">
      <div className="text-muted-foreground">
        <span className="text-cyan-400">[{tool.toolName}]</span>
        {firstValue && <span className="text-foreground ml-1">{firstValue as string}</span>}
      </div>
      {tool.output && (
        <pre className="mt-1 pl-4 text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
          {tool.output}
        </pre>
      )}
    </div>
  );
}

/**
 * Text block with bullet point
 * FIX-5: Enhanced phase headers for better readability
 * TERM-7: Search highlighting support
 */
function TextBlock({ content }: { content: string }) {
  const { searchQuery } = useContext(SearchContext);

  // Skip empty content
  if (!content.trim()) return null;

  // Phase markers - simple terminal style
  if (content.startsWith('[Phase:') || content.startsWith('[Subphase:')) {
    const phaseText = content.replace(/[\[\]]/g, '');
    return (
      <div className="py-2 font-mono text-xs">
        <span className="text-cyan-400">═══ {phaseText} ═══</span>
      </div>
    );
  }

  // Regular text - simple terminal output
  return (
    <div className="py-0.5 font-mono text-xs text-foreground/90 whitespace-pre-wrap">
      {searchQuery ? highlightSearchMatches(content, searchQuery) : content}
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
      // TERM-5: Detect language from filename or use provided language
      const codeLanguage = block.filename ? detectLanguageFromPath(block.filename) : block.language;
      const highlightedCode = highlightCode(block.code || '', codeLanguage);
      return (
        <div className="flex gap-3 py-1">
          <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-purple-500" />
          <div className="flex-1 min-w-0">
            {block.filename && (
              <div className="text-xs font-mono text-muted-foreground mb-1">{block.filename}</div>
            )}
            <div className="rounded bg-muted/50 border border-border overflow-hidden relative group">
              {/* TERM-6: Copy button */}
              {block.code && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <CopyButton content={block.code} />
                </div>
              )}
              {/* TERM-5: Syntax highlighted code */}
              <pre
                className="p-3 font-mono text-xs overflow-x-auto max-h-96 overflow-y-auto hljs"
                dangerouslySetInnerHTML={{ __html: highlightedCode }}
              />
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);

  // State for toggling all thinking blocks together
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const toggleThinking = useCallback(() => {
    setThinkingExpanded(prev => !prev);
  }, []);

  // TERM-3b: State for raw/structured view toggle
  const [viewMode, setViewMode] = useState<'raw' | 'structured'>('raw');

  // TERM-7: Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // TERM-7: Count matches in messages
  const searchMatches = useMemo(() => {
    if (!searchQuery) return { total: 0, positions: [] };

    const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let total = 0;
    const positions: { messageIndex: number; blockIndex: number }[] = [];

    messages.forEach((message, messageIndex) => {
      message.content.forEach((block, blockIndex) => {
        let text = '';
        if (block.type === 'text' || block.type === 'thinking') {
          text = block.text || '';
        } else if (block.type === 'tool_use') {
          text = JSON.stringify(block.input || {}) + (block.output || '');
        } else if (block.type === 'code_block') {
          text = block.code || '';
        }

        const matches = text.match(regex);
        if (matches) {
          total += matches.length;
          positions.push({ messageIndex, blockIndex });
        }
      });
    });

    return { total, positions };
  }, [messages, searchQuery]);

  // TERM-7: Keyboard handler for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F to open search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      // Escape to close search
      if (e.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
        setSearchQuery('');
        setCurrentMatchIndex(0);
      }
      // Enter/Shift+Enter to navigate matches
      if (isSearchOpen && e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          // Previous match
          setCurrentMatchIndex(prev =>
            prev > 0 ? prev - 1 : searchMatches.total - 1
          );
        } else {
          // Next match
          setCurrentMatchIndex(prev =>
            prev < searchMatches.total - 1 ? prev + 1 : 0
          );
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, searchMatches.total]);

  // TERM-7: Navigate to next/previous match
  const navigateMatch = useCallback((direction: 'next' | 'prev') => {
    if (searchMatches.total === 0) return;
    if (direction === 'next') {
      setCurrentMatchIndex(prev =>
        prev < searchMatches.total - 1 ? prev + 1 : 0
      );
    } else {
      setCurrentMatchIndex(prev =>
        prev > 0 ? prev - 1 : searchMatches.total - 1
      );
    }
  }, [searchMatches.total]);

  // TERM-3: Time tracking state
  const [elapsedTime, setElapsedTime] = useState(0);
  const taskStartTimeRef = useRef<number | null>(null);

  // TERM-4: File changes tracking state
  const [fileChanges, setFileChanges] = useState<{
    filesModified: Set<string>;
    linesAdded: number;
    linesRemoved: number;
  }>({ filesModified: new Set(), linesAdded: 0, linesRemoved: 0 });

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

  // Scroll to bottom immediately on mount (before paint) - no visible scroll animation
  useLayoutEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  // TERM-3: Track elapsed time while task is running
  useEffect(() => {
    if (isTaskRunning) {
      // Set start time if not already set
      if (!taskStartTimeRef.current) {
        taskStartTimeRef.current = Date.now();
      }

      // Update elapsed time every second
      const interval = setInterval(() => {
        if (taskStartTimeRef.current) {
          setElapsedTime(Math.floor((Date.now() - taskStartTimeRef.current) / 1000));
        }
      }, 1000);

      return () => clearInterval(interval);
    } else {
      // Reset when task stops
      taskStartTimeRef.current = null;
    }
  }, [isTaskRunning]);

  // TERM-3: Format elapsed time as Xh Xm Xs, Xm Xs, or Xs
  const formatElapsedTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  // TERM-4: Track file changes from Edit/Write tool results
  useEffect(() => {
    const filesModified = new Set<string>();
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const message of messages) {
      for (const block of message.content) {
        if (block.type === 'tool_use' && (block.toolName === 'Edit' || block.toolName === 'Write')) {
          const filePath = block.input?.file_path as string;
          if (filePath) {
            filesModified.add(filePath);
          }

          // Calculate line changes for Edit tool
          if (block.toolName === 'Edit') {
            const oldString = (block.input?.old_string as string) || '';
            const newString = (block.input?.new_string as string) || '';
            const oldLines = oldString ? oldString.split('\n').length : 0;
            const newLines = newString ? newString.split('\n').length : 0;

            if (newLines > oldLines) {
              linesAdded += newLines - oldLines;
            } else if (oldLines > newLines) {
              linesRemoved += oldLines - newLines;
            }
            // Also count modifications as adds/removes for changed content
            const minLines = Math.min(oldLines, newLines);
            linesAdded += minLines;
            linesRemoved += minLines;
          }

          // For Write tool, count all lines as added
          if (block.toolName === 'Write') {
            const content = (block.input?.content as string) || '';
            linesAdded += content ? content.split('\n').length : 0;
          }
        }
      }
    }

    setFileChanges({ filesModified, linesAdded, linesRemoved });
  }, [messages]);

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

  // TERM-8: Group messages by time intervals (5 minutes) for timestamp display
  const messageGroups = useMemo(() => {
    const groups: { timestamp: number; messages: typeof messages }[] = [];
    const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    messages.forEach((message) => {
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || message.timestamp - lastGroup.timestamp > INTERVAL_MS) {
        groups.push({ timestamp: message.timestamp, messages: [message] });
      } else {
        lastGroup.messages.push(message);
      }
    });

    return groups;
  }, [messages]);

  return (
    <ThinkingExpandContext.Provider value={{ allExpanded: thinkingExpanded, toggleAll: toggleThinking }}>
      <SearchContext.Provider value={{ searchQuery, currentMatchIndex, totalMatches: searchMatches.total }}>
        <div className="flex flex-col h-full min-h-0 bg-background relative">
          {/* TERM-3b: View mode toggle button */}
          <div className="absolute top-2 left-2 z-20">
            <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <button
                onClick={() => setViewMode('raw')}
                className={cn(
                  "px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors",
                  viewMode === 'raw'
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-muted-foreground"
                )}
                title="Raw output view"
              >
                <AlignLeft className="h-3.5 w-3.5" />
                Raw
              </button>
              <button
                onClick={() => setViewMode('structured')}
                className={cn(
                  "px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors",
                  viewMode === 'structured'
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-muted-foreground"
                )}
                title="Structured timeline view"
              >
                <List className="h-3.5 w-3.5" />
                Timeline
              </button>
            </div>
          </div>

          {/* TERM-7: Search bar */}
          {isSearchOpen && (
            <div className="absolute top-2 right-2 z-20 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentMatchIndex(0);
                }}
                placeholder="Search..."
                className="bg-transparent border-none outline-none text-sm w-40"
                autoFocus
              />
              {searchQuery && searchMatches.total > 0 && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {currentMatchIndex + 1} / {searchMatches.total}
                </span>
              )}
              {searchQuery && searchMatches.total === 0 && (
                <span className="text-xs text-muted-foreground">No matches</span>
              )}
              <div className="flex items-center gap-1 border-l border-border pl-2 ml-1">
                <button
                  onClick={() => navigateMatch('prev')}
                  disabled={searchMatches.total === 0}
                  className="p-1 hover:bg-muted rounded disabled:opacity-50"
                  title="Previous match (Shift+Enter)"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => navigateMatch('next')}
                  disabled={searchMatches.total === 0}
                  className="p-1 hover:bg-muted rounded disabled:opacity-50"
                  title="Next match (Enter)"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSearchQuery('');
                    setCurrentMatchIndex(0);
                  }}
                  className="p-1 hover:bg-muted rounded"
                  title="Close (Escape)"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Message list - scrollable container */}
          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-12"
            onScroll={handleScroll}
          >
            {/* TERM-3b: Conditional rendering based on view mode */}
            {viewMode === 'structured' ? (
              /* Structured timeline view with auto-scroll */
              <StructuredOutput messages={messages} autoScroll={autoScroll} />
            ) : (
              /* Raw view - existing implementation */
              messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <div className="w-8 h-8 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin mb-4" />
                  <div className="text-muted-foreground text-sm">
                    Waiting for task output...
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5 px-4 pb-4">
                  {/* TERM-8: Render message groups with timestamps */}
                  {messageGroups.map((group, groupIndex) => (
                    <div key={`group-${groupIndex}`}>
                      {/* TERM-8: Timestamp header for message group */}
                      <div className="flex items-center gap-2 my-3">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                          {formatMessageTimestamp(group.timestamp)}
                        </span>
                        <div className="flex-1 h-px bg-border" />
                      </div>

                      {/* Messages in this group */}
                      {group.messages.map((message, index) => (
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
                  ))}
                </div>
              )
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

        {/* TERM-3: Time tracking display - shows when task is running */}
        {isTaskRunning && elapsedTime > 0 && (
          <div className="px-4 py-2 bg-muted/30 border-t border-border">
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span>Working... ({formatElapsedTime(elapsedTime)})</span>
            </div>
          </div>
        )}

        {/* TERM-4: Status bar with file changes - shows when there are modifications */}
        {fileChanges.filesModified.size > 0 && (
          <div className="px-4 py-1.5 bg-muted/50 border-t border-border">
            <div className="flex items-center justify-center gap-3 text-xs font-mono">
              <span className="text-muted-foreground">
                &gt;&gt; {fileChanges.filesModified.size} {fileChanges.filesModified.size === 1 ? 'file' : 'files'}
              </span>
              <span className="text-green-500">+{fileChanges.linesAdded}</span>
              <span className="text-red-500">-{fileChanges.linesRemoved}</span>
            </div>
          </div>
        )}

        {/* Bottom input area - only show when terminal is active */}
        {isActive && (
          <div className="border-t border-border p-3 bg-muted/20">
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
      </SearchContext.Provider>
    </ThinkingExpandContext.Provider>
  );
}
