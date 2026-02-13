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

import { useEffect, useLayoutEffect, useRef, useState, useCallback, createContext, useContext, useMemo, memo } from 'react';
import { useTerminalStore } from '../../stores/terminal-store';
import { useTaskStore } from '../../stores/task-store';
import { Button } from '../ui/button';
import { ChevronUp, ChevronDown, Send, ArrowDown, Copy, Check, Search, X, Bot } from 'lucide-react';
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

// Escape HTML entities to prevent XSS when hljs fallback returns raw text
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
    // hljs escapes HTML internally, but fallback must escape manually
    return escapeHtml(code);
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
  /** View mode controlled by parent (BottomPanelTerminal header) */
  viewMode?: 'raw' | 'structured';
}

/**
 * Collapsible thinking block matching Claude Code style
 * Uses context to toggle all thinking blocks together
 * TERMINAL_OUTPUT_POLISH: Collapsed by default with pulsing indicator, purple border when expanded
 */
function ThinkingBlock({ content }: { content: string }) {
  const { allExpanded, toggleAll } = useContext(ThinkingExpandContext);

  return (
    <div className="py-1.5 font-mono text-xs">
      <div className={cn(
        "rounded-lg border overflow-hidden transition-all",
        allExpanded ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card"
      )}>
        {/* Header */}
        <button
          onClick={toggleAll}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors"
        >
          {/* Animated pulsing dot when collapsed */}
          {!allExpanded && (
            <span className="w-2 h-2 rounded-full bg-primary/60 animate-pulse flex-shrink-0" />
          )}
          <span className="text-muted-foreground italic flex-1 text-left">
            {allExpanded ? 'Thinking...' : 'Thinking...'}
          </span>
          {allExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        {/* Content - muted and italic when expanded */}
        {allExpanded && (
          <div className="px-3 py-2 border-t border-primary/20 bg-primary/5">
            <div className="text-[11px] text-muted-foreground/80 italic whitespace-pre-wrap leading-relaxed">
              {content}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * DiffLine - Renders a single diff line with proper background colors
 * Matches Claude Code terminal style
 * TERMINAL_OUTPUT_POLISH: Enhanced green/red visibility
 */
function DiffLine({ line, type, lineNumber }: { line: string; type: 'add' | 'remove' | 'context'; lineNumber?: number }) {
  const bgClass = type === 'add'
    ? 'bg-green-500/25 border-l-2 border-green-500/50'
    : type === 'remove'
      ? 'bg-red-500/25 border-l-2 border-red-500/50'
      : '';
  const textClass = type === 'add'
    ? 'text-green-300'
    : type === 'remove'
      ? 'text-red-300'
      : 'text-muted-foreground';
  const prefix = type === 'add' ? '+' : type === 'remove' ? '-' : ' ';

  return (
    <div className={cn("flex", bgClass)}>
      {lineNumber !== undefined && (
        <span className="text-muted-foreground/50 w-8 text-right pr-2 select-none flex-shrink-0">
          {lineNumber}
        </span>
      )}
      <span className={cn("flex-1", textClass)}>
        <span className="select-none">{prefix} </span>
        {line || ' '}
      </span>
    </div>
  );
}

/**
 * Tool block — Claude Code terminal style
 * Compact one-liner by default, clean indented expansion on click.
 * No emojis, no colored card backgrounds — just clean monospace text.
 */
function ToolBlock({ tool }: { tool: ToolUseContent }) {
  const [showExpanded, setShowExpanded] = useState(false);
  const [showFullOutput, setShowFullOutput] = useState(false);
  const { searchQuery } = useContext(SearchContext);

  // Tool name → color class (no emojis)
  const TOOL_COLORS: Record<string, string> = {
    Read: 'text-cyan-400',
    Write: 'text-green-400',
    Edit: 'text-yellow-400',
    Bash: 'text-purple-400',
    Glob: 'text-blue-400',
    Grep: 'text-pink-400',
    Task: 'text-indigo-400',
    WebFetch: 'text-teal-400',
    WebSearch: 'text-teal-400',
    AskUserQuestion: 'text-amber-400',
  };

  const colorClass = TOOL_COLORS[tool.toolName] || 'text-cyan-400';

  // Extract display target for one-liner
  const getTarget = (): string => {
    // Runtime: input can be a string (from SDK parser) or an object (from claude-output-parser).
    // The TS type says Record<string, unknown> but the SDK parser passes raw display strings.
    const raw: unknown = tool.input;

    // Main process SDK parser sends input as a raw display string (e.g. "/path/to/file")
    if (typeof raw === 'string' && raw) {
      return raw.length > 80 ? raw.slice(0, 77) + '…' : raw;
    }

    // Structured object input (from claude-output-parser or SDK tool_use blocks)
    const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    if (tool.toolName === 'Read' || tool.toolName === 'Write' || tool.toolName === 'Edit') {
      return (obj.file_path as string) || '';
    }
    if (tool.toolName === 'Bash') {
      const cmd = (obj.command as string) || (obj.description as string) || '';
      return cmd.length > 80 ? cmd.slice(0, 77) + '…' : cmd;
    }
    if (tool.toolName === 'Grep') return obj.pattern ? `"${obj.pattern}"` : '';
    if (tool.toolName === 'Glob') return obj.pattern ? `"${obj.pattern}"` : '';
    if (tool.toolName === 'Task') return (obj.description as string) || '';
    // Generic fallback
    const values = Object.values(obj);
    return values.find((v): v is string => typeof v === 'string' && v.length < 80) || '';
  };

  const target = getTarget();
  const statusIcon = tool.status === 'success' ? '✓' : tool.status === 'error' ? '✗' : tool.status === 'running' ? '●' : '';
  const statusColor = tool.status === 'success' ? 'text-green-500' : tool.status === 'error' ? 'text-red-500' : tool.status === 'running' ? 'text-blue-400 animate-pulse' : 'text-muted-foreground/30';

  // ═══ COMPACT ONE-LINER (default) ═══
  if (!showExpanded) {
    return (
      <div
        className="flex items-center gap-2 py-0.5 font-mono text-xs cursor-pointer hover:bg-muted/20 rounded transition-colors"
        onClick={() => setShowExpanded(true)}
      >
        <span className={cn("font-medium min-w-[36px] flex-shrink-0", colorClass)}>{tool.toolName}</span>
        <span className="text-muted-foreground/50 truncate flex-1">{target}</span>
        {statusIcon && <span className={cn("text-[10px] flex-shrink-0", statusColor)}>{statusIcon}</span>}
      </div>
    );
  }

  // ═══ EXPANDED VIEW — clean indented content ═══
  const hasOutput = Boolean(tool.output);
  const outputLines = tool.output ? tool.output.split('\n').length : 0;
  const isLongOutput = outputLines > 20;
  // Handle string input (from SDK parser) vs object input (from claude-output-parser)
  const rawInput: unknown = tool.input;
  const inputIsString = typeof rawInput === 'string';
  const inputObj = (inputIsString ? {} : rawInput) as Record<string, unknown> || {};
  const filePath: string = inputIsString
    ? (['Read', 'Write', 'Edit'].includes(tool.toolName) ? String(rawInput) : '')
    : String(inputObj.file_path ?? '');
  const command: string = inputIsString
    ? (tool.toolName === 'Bash' ? String(rawInput) : '')
    : String(inputObj.command ?? '');
  const oldString: string = inputIsString ? '' : String(inputObj.old_string ?? '');
  const newString: string = inputIsString ? '' : String(inputObj.new_string ?? '');
  const hasDiff = tool.toolName === 'Edit' && (oldString || newString);

  return (
    <div className="font-mono text-xs">
      {/* Header line — click to collapse */}
      <div
        className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-muted/20 rounded transition-colors"
        onClick={() => setShowExpanded(false)}
      >
        <span className={cn("font-medium min-w-[36px] flex-shrink-0", colorClass)}>{tool.toolName}</span>
        <span className="text-muted-foreground/50 truncate flex-1">{target}</span>
        {statusIcon && <span className={cn("text-[10px] flex-shrink-0", statusColor)}>{statusIcon}</span>}
        <ChevronUp className="h-3 w-3 text-muted-foreground/30 flex-shrink-0" />
      </div>

      {/* Indented content below */}
      <div className="ml-9 mt-0.5 mb-2 pl-3 border-l border-border/30">
        {/* File path (for file-based tools) */}
        {filePath && (
          <div className="text-[10px] text-muted-foreground/40 truncate mb-1" title={filePath}>{filePath}</div>
        )}

        {/* Command preview (for Bash) */}
        {command.length > 0 && tool.toolName === 'Bash' && (
          <div className="text-[10px] text-muted-foreground/50 mb-1 truncate" title={command}>$ {command}</div>
        )}

        {/* Diff view (for Edit) */}
        {hasDiff && (
          <div className="mb-1 max-h-60 overflow-y-auto">
            {oldString && oldString.split('\n').map((line, i) => (
              <DiffLine key={`old-${i}`} line={line} type="remove" lineNumber={i + 1} />
            ))}
            {oldString && newString && <div className="h-px bg-border/30 my-1" />}
            {newString && newString.split('\n').map((line, i) => (
              <DiffLine key={`new-${i}`} line={line} type="add" lineNumber={i + 1} />
            ))}
          </div>
        )}

        {/* Write content (for Write) */}
        {tool.toolName === 'Write' && typeof tool.input?.content === 'string' && (
          <div className="mb-1 max-h-60 overflow-y-auto">
            {tool.input.content.split('\n').map((line: string, i: number) => (
              <DiffLine key={i} line={line} type="add" lineNumber={i + 1} />
            ))}
          </div>
        )}

        {/* Output (for everything else) */}
        {hasOutput && !hasDiff && (
          <div className="max-h-48 overflow-y-auto">
            <pre className={cn(
              "text-[11px] whitespace-pre-wrap",
              tool.status === 'error' ? 'text-red-400/70' : 'text-muted-foreground/60'
            )}>
              {isLongOutput && !showFullOutput
                ? (tool.output!.split('\n').slice(0, 15).join('\n') + '\n…')
                : (searchQuery ? highlightSearchMatches(tool.output!, searchQuery) : tool.output)
              }
            </pre>
            {isLongOutput && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowFullOutput(!showFullOutput); }}
                className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground mt-1"
              >
                {showFullOutput ? 'show less' : `show all ${outputLines} lines`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Track seen security settings blocks for deduplication in raw view
const seenSecurityBlocksRef = { current: new Set<string>() };

/**
 * Text block — Claude Code-style rendering
 * Detects line types (phase headers, subphases, status lines, system boxes)
 * and renders each with appropriate styling for a clean terminal experience.
 * TERM-7: Search highlighting support
 * NOISE-FILTER: Hides __TASK_LOG__ / __SDK_MSG__ markers, security settings, duplicate lines
 */
function TextBlock({ content }: { content: string }) {
  const { searchQuery } = useContext(SearchContext);

  // Skip empty content
  if (!content.trim()) return null;

  // Filter __TASK_LOG__ markers — entire block is a marker
  if (content.match(/^__TASK_LOG_\w+__:/)) return null;

  // Strip inline markers appended to regular text
  let displayContent = content;
  if (displayContent.includes('__TASK_LOG_')) {
    displayContent = displayContent.replace(/__TASK_LOG_\w+__:\s*\{[\s\S]*$/, '').trim();
    if (!displayContent) return null;
  }
  if (displayContent.includes('__SDK_MSG__:')) {
    displayContent = displayContent.replace(/__SDK_MSG__:\s*\{[\s\S]*$/, '').trim();
    if (!displayContent) return null;
  }

  // Hide security settings blocks entirely (noise in raw view)
  if (
    displayContent.includes('IMPORTANT: Tool permissions') ||
    displayContent.includes('Allowed tools:') ||
    displayContent.includes('security_settings') ||
    displayContent.includes('allowed_tools')
  ) {
    const blockHash = displayContent.slice(0, 100);
    if (seenSecurityBlocksRef.current.has(blockHash)) return null;
    seenSecurityBlocksRef.current.add(blockHash);
  }

  // ═══ LINE-BY-LINE STYLED RENDERING ═══
  const lines = displayContent.split('\n');

  // Deduplicate consecutive identical lines (parser artifact)
  const dedupedLines: string[] = [];
  for (const line of lines) {
    if (dedupedLines.length === 0 || dedupedLines[dedupedLines.length - 1] !== line) {
      dedupedLines.push(line);
    }
  }

  const rendered: React.ReactNode[] = [];
  let systemBoxLines: string[] = [];

  // Flush accumulated system/orchestrator box lines into a single styled block
  const flushSystemBox = () => {
    if (systemBoxLines.length > 0) {
      rendered.push(
        <div key={`sys-${rendered.length}`} className="my-1 px-3 py-2 rounded-md bg-muted/10 border border-border/20 font-mono text-[11px] text-muted-foreground/40 whitespace-pre-wrap leading-relaxed">
          {systemBoxLines.join('\n')}
        </div>
      );
      systemBoxLines = [];
    }
  };

  for (let i = 0; i < dedupedLines.length; i++) {
    const line = dedupedLines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Strip [Tool: XXX] prefix from text lines (Jerry marker that didn't match tool pattern)
    // Handles MCP tool names with hyphens/dots like mcp__context7__resolve-library-id
    let cleanLine = trimmed;
    const toolPrefixMatch = cleanLine.match(/^\[Tool:\s*[\w.:/-]+\]\s*(.*)/);
    if (toolPrefixMatch) {
      cleanLine = toolPrefixMatch[1].trim();
      if (!cleanLine) continue; // Skip bare [Tool: XXX] lines
    }

    // Security/config lines — hide entirely
    if (
      cleanLine.startsWith('Security settings:') ||
      cleanLine.startsWith('- Sandbox enabled') ||
      cleanLine.startsWith('- Filesystem restricted') ||
      cleanLine.startsWith('- Bash commands restricted') ||
      cleanLine.startsWith('- Extended thinking') ||
      cleanLine.startsWith('- MCP servers:') ||
      cleanLine.startsWith('- CLAUDE.md:') ||
      cleanLine.startsWith('- Claude CLI:') ||
      cleanLine.match(/^Using cached security profile/)
    ) {
      continue;
    }

    // System/orchestrator boxes (╔║╗╚╝│─═ box-drawing characters)
    if (/^[╔╗╚╝║│┌┐└┘├┤─═┃┏┓┗┛]/.test(cleanLine)) {
      systemBoxLines.push(cleanLine);
      continue;
    }

    // Flush system box before other content
    flushSystemBox();

    // ── Phase headers ── colored left border with phase label
    if (cleanLine.startsWith('[Phase:') || cleanLine.match(/^═+\s*Phase:/)) {
      const phaseText = cleanLine
        .replace(/[\[\]]/g, '')
        .replace(/^═+\s*/, '')
        .replace(/\s*═+$/, '')
        .trim();

      const lowerPhase = phaseText.toLowerCase();
      const isPlanning = lowerPhase.includes('planning');
      const isCoding = lowerPhase.includes('coding') || lowerPhase.includes('implementation');
      const isValidation = lowerPhase.includes('validation') || lowerPhase.includes('testing') || lowerPhase.includes('review');

      const borderColor = isPlanning ? 'border-amber-500' : isCoding ? 'border-blue-500' : isValidation ? 'border-purple-500' : 'border-cyan-500';
      const textColor = isPlanning ? 'text-amber-400' : isCoding ? 'text-blue-400' : isValidation ? 'text-purple-400' : 'text-cyan-400';

      rendered.push(
        <div key={`phase-${i}`} className={cn("mt-4 mb-2 pl-3 border-l-[3px]", borderColor)}>
          <span className={cn("font-mono text-[13px] font-semibold tracking-wide", textColor)}>
            {searchQuery ? highlightSearchMatches(phaseText, searchQuery) : phaseText}
          </span>
        </div>
      );
      continue;
    }

    // ── Subphase headers ── centered label with horizontal rules
    if (
      cleanLine.startsWith('[Subphase:') ||
      cleanLine.match(/^│?\s*[📁📄🔧⚡🧪📋]\s*PHASE\s+\d+/i) ||
      cleanLine.match(/^│?\s*PHASE\s+\d+:/i)
    ) {
      const subphaseText = cleanLine
        .replace(/[\[\]│]/g, '')
        .replace(/^Subphase:\s*/, '')
        .trim();

      rendered.push(
        <div key={`subphase-${i}`} className="flex items-center gap-2 py-2 mt-1">
          <div className="flex-1 h-px bg-border/40" />
          <span className="text-[10px] text-muted-foreground/35 uppercase tracking-widest font-medium">
            {searchQuery ? highlightSearchMatches(subphaseText, searchQuery) : subphaseText}
          </span>
          <div className="flex-1 h-px bg-border/40" />
        </div>
      );
      continue;
    }

    // ── Status lines ── icon + colored text
    const statusMatch = cleanLine.match(/^(✓|✅|ℹ|ℹ️|◐|⏳|✗|❌)\s*(.+)/);
    if (statusMatch) {
      const [, icon, text] = statusMatch;
      const isSuccess = icon === '✓' || icon === '✅';
      const isInfo = icon === 'ℹ' || icon === 'ℹ️';
      const isPending = icon === '◐' || icon === '⏳';
      const iconColor = isSuccess ? 'text-green-400' : isInfo ? 'text-blue-400' : isPending ? 'text-yellow-400' : 'text-red-400';

      rendered.push(
        <div key={`status-${i}`} className="flex items-center gap-2 py-0.5 font-mono text-xs">
          <span className={cn("w-4 text-center flex-shrink-0", iconColor)}>{icon}</span>
          <span className="text-foreground/70">
            {searchQuery ? highlightSearchMatches(text, searchQuery) : text}
          </span>
        </div>
      );
      continue;
    }

    // ── Completion / success banners ──
    if (
      (cleanLine.toLowerCase().includes('complete') || cleanLine.toLowerCase().includes('finished')) &&
      (cleanLine.includes('✓') || cleanLine.toLowerCase().startsWith('spec creation') || cleanLine.toLowerCase().startsWith('planning complete'))
    ) {
      rendered.push(
        <div key={`complete-${i}`} className="my-2 px-3 py-2 rounded-md bg-green-500/8 border border-green-500/20 font-mono text-xs text-green-400 font-medium">
          ✓ {searchQuery ? highlightSearchMatches(cleanLine.replace(/^✓\s*/, ''), searchQuery) : cleanLine.replace(/^✓\s*/, '')}
        </div>
      );
      continue;
    }

    // ── "Starting phase" lines — dimmed (informational, not actionable)
    if (cleanLine.match(/^Starting phase \d+:/i)) {
      rendered.push(
        <div key={`starting-${i}`} className="py-0.5 font-mono text-xs text-muted-foreground/35">
          {searchQuery ? highlightSearchMatches(cleanLine, searchQuery) : cleanLine}
        </div>
      );
      continue;
    }

    // ── Regular text ──
    rendered.push(
      <div key={`text-${i}`} className="py-0.5 font-mono text-xs text-foreground/85 whitespace-pre-wrap leading-relaxed">
        {searchQuery ? highlightSearchMatches(cleanLine, searchQuery) : cleanLine}
      </div>
    );
  }

  // Flush any remaining system box
  flushSystemBox();

  if (rendered.length === 0) return null;

  return <>{rendered}</>;
}

/**
 * Render a content block based on its type
 * Memoized to prevent re-rendering unchanged blocks during rapid message updates
 */
const ContentBlockRenderer = memo(function ContentBlockRenderer({ block }: { block: ContentBlock }) {
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
        <div className="py-1.5 font-mono text-xs">
          <div className="rounded-lg border border-border bg-muted/90 overflow-hidden relative group">
            {/* Header with filename and language label */}
            <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border/50">
              {block.filename ? (
                <span className="text-[11px] text-muted-foreground truncate">{block.filename}</span>
              ) : (
                <span className="text-[11px] text-muted-foreground/60 italic">code</span>
              )}
              <div className="flex items-center gap-2">
                {/* Language label */}
                {codeLanguage && (
                  <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted/50">
                    {codeLanguage}
                  </span>
                )}
                {/* Copy button */}
                {block.code && (
                  <CopyButton content={block.code} className="opacity-60 group-hover:opacity-100 transition-opacity" />
                )}
              </div>
            </div>
            {/* Code content with dark background */}
            <div className="bg-[#0d1117]">
              <pre
                className="p-3 font-mono text-[11px] overflow-x-auto max-h-96 overflow-y-auto hljs"
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
});

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

/**
 * Status bar showing current execution state
 * TERMINAL_OUTPUT_POLISH Task 5: Sticky status indicator
 */
function StatusBar({
  isRunning,
  currentTool,
  startTime
}: {
  isRunning: boolean;
  currentTool?: string;
  startTime?: number;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Update elapsed time every second when running
  useEffect(() => {
    if (!isRunning || !startTime) {
      setElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [isRunning, startTime]);

  // Format elapsed time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isRunning && !currentTool) {
    return null; // Don't show if nothing to display
  }

  return (
    <div className="sticky top-0 z-10 px-4 py-2 bg-muted/80 backdrop-blur-sm border-b border-border">
      <div className="flex items-center gap-3 text-xs font-mono">
        {isRunning ? (
          <>
            {/* Pulsing indicator */}
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
            {/* Tool name */}
            {currentTool && (
              <span className="text-foreground/90 font-medium">{currentTool}</span>
            )}
            {/* Elapsed time */}
            <span className="text-muted-foreground">{formatTime(elapsedSeconds)}</span>
          </>
        ) : (
          <>
            {/* Completed indicator */}
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            <span className="text-muted-foreground">Completed</span>
            {startTime && elapsedSeconds > 0 && (
              <span className="text-muted-foreground/70">({formatTime(elapsedSeconds)})</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function TaskMonitorChat({
  terminal,
  terminalRef,
  isActive = false,
  isMinimized = false,
  viewMode: externalViewMode
}: TaskMonitorChatProps) {
  const { messages = [] } = terminal;
  const initializeParser = useTerminalStore((state) => state.initializeParser);
  const addUserMessage = useTerminalStore((state) => state.addUserMessage);
  // Check if companion or supervisor is active for this task
  const hasCompanion = useTaskStore((state) => state.hasCompanion(terminal.taskId || ''));
  const hasSupervisor = useTaskStore((state) => state.hasSupervisor(terminal.taskId || ''));

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [pendingImages, setPendingImages] = useState<Array<{ id: string; dataUrl: string; filename: string }>>([]);

  // State for toggling all thinking blocks together
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const toggleThinking = useCallback(() => {
    setThinkingExpanded(prev => !prev);
  }, []);

  // TERM-3b: View mode - use external prop if provided, otherwise internal state
  const [internalViewMode] = useState<'raw' | 'structured'>('raw');
  const viewMode = externalViewMode ?? internalViewMode;

  // TERM-7: Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Task 5: Status bar state - track current running tool
  const [currentRunningTool, setCurrentRunningTool] = useState<string | undefined>(undefined);
  const [executionStartTime, setExecutionStartTime] = useState<number | undefined>(undefined);

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

  // TERM-4: File changes tracking is now computed via useMemo below (after messages are defined)

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

      // Route message: supervisor > companion > task agent
      if (hasSupervisor) {
        // During active builds, route to supervisor agent
        const result = await window.electronAPI.sendMessageToSupervisor(taskId, message);
        if (!result.success) {
          console.error('[TaskMonitorChat] Failed to send message to supervisor:', result.error);
        }
      } else if (hasCompanion) {
        // Companion agent is running (e.g. after planning completes) - route via companion IPC channel
        // This uses the companion-specific channel which checks isCompanionRunning() instead of isRunning(),
        // so it works even when the main task process (coder) hasn't started yet.
        const result = await window.electronAPI.invoke<{ success: boolean; error?: string }>(
          'task:send-companion-message', taskId, message
        );
        if (!result.success) {
          console.error('[TaskMonitorChat] Failed to send message to companion:', result.error);
        }
      } else if (isTaskRunning) {
        // Send to the running task agent
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
  }, [inputValue, taskId, isSending, isTaskRunning, hasCompanion, hasSupervisor, terminal.id, addUserMessage, task?.status]);

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

  // Handle clipboard paste for images
  let pasteCounter = 0;
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const id = `paste-${Date.now()}-${++pasteCounter}`;
          const filename = `paste-${Date.now()}.png`;
          setPendingImages((prev) => [...prev, { id, dataUrl, filename }]);
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  }, []);

  const removeImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // Initialize parser on mount
  useEffect(() => {
    if (!terminal.parser) {
      initializeParser(terminal.id);
    }
  }, [terminal.id, terminal.parser, initializeParser]);

  // Cleanup scroll debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

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

  // TERM-4: Track file changes from Edit/Write tool results
  // Optimized: Use useMemo to avoid re-scanning all messages on every render
  // and only recalculate when messages array reference changes
  const fileChanges = useMemo(() => {
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

    return { filesModified, linesAdded, linesRemoved };
  }, [messages]);

  // Task 5: Detect currently running tool from messages
  useEffect(() => {
    if (messages.length === 0) {
      setCurrentRunningTool(undefined);
      setExecutionStartTime(undefined);
      return;
    }

    // Find the last message with tool blocks
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') {
      setCurrentRunningTool(undefined);
      return;
    }

    // Find the last tool use block
    let lastToolBlock: ToolUseContent | undefined;
    for (let i = lastMessage.content.length - 1; i >= 0; i--) {
      const block = lastMessage.content[i];
      if (block.type === 'tool_use') {
        lastToolBlock = block;
        break;
      }
    }

    if (lastToolBlock) {
      // Check if this tool is still running (no output yet, or status is 'running')
      if (!lastToolBlock.output || lastToolBlock.status === 'running') {
        setCurrentRunningTool(lastToolBlock.toolName);
        // Set start time to message timestamp if not already set
        if (!executionStartTime) {
          setExecutionStartTime(lastMessage.timestamp);
        }
      } else {
        // Tool completed
        setCurrentRunningTool(undefined);
        // Keep execution start time to show total duration
      }
    } else if (!isTaskRunning) {
      // No tools found and task not running - clear everything
      setCurrentRunningTool(undefined);
      setExecutionStartTime(undefined);
    }
  }, [messages, isTaskRunning, executionStartTime]);

  // Handle scroll to detect if user scrolled up
  // Debounced to prevent excessive state updates during rapid scrolling
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Debounce scroll handling by 50ms
    scrollTimeoutRef.current = setTimeout(() => {
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
    }, 50);
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
          {/* TERM-3b: View mode toggle moved to BottomPanelTerminal header */}

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

          {/* Task 5: Status bar showing current execution state */}
          {messages.length > 0 && (
            <StatusBar
              isRunning={isTaskRunning && !!currentRunningTool}
              currentTool={currentRunningTool}
              startTime={executionStartTime}
            />
          )}

          {/* Message list - scrollable container */}
          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-2"
            onScroll={handleScroll}
          >
            {/* TERM-3b: Conditional rendering based on view mode */}
            {viewMode === 'structured' ? (
              /* Structured timeline view with auto-scroll */
              <StructuredOutput messages={messages} autoScroll={autoScroll} taskId={terminal.taskId} />
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
                            // Render assistant messages with visual separation and role indicator
                            <div className={cn(
                              "py-2",
                              index > 0 && "border-t border-border/30 mt-3 pt-3",
                              (hasCompanion || hasSupervisor) && "border-l-2 border-green-500/30 bg-green-500/5 rounded-md px-2"
                            )}>
                              {/* Assistant/Companion/Supervisor role indicator */}
                              <div className="flex items-center gap-2 mb-2 px-1">
                                <Bot className={cn(
                                  "h-3.5 w-3.5",
                                  (hasCompanion || hasSupervisor) ? "text-green-400/70" : "text-primary/70"
                                )} />
                                <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                                  {hasSupervisor ? 'Supervisor' : hasCompanion ? 'Companion' : 'Assistant'}
                                </span>
                              </div>
                              {/* Assistant message content with slight left padding for nesting */}
                              <div className="pl-2">
                                {message.content.map((block, blockIndex) => (
                                  <ContentBlockRenderer key={blockIndex} block={block} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* Agent ready indicator - shown when companion or supervisor is active */}
                  {(hasCompanion || hasSupervisor) && (
                    <div className="px-4 mt-4 mb-4">
                      <div className="border-t-2 border-green-500/30 mb-3" />
                      <div className="flex items-center gap-3 py-2 px-3 rounded-md bg-green-500/5">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <div className="flex-1">
                          <div className="text-green-400 font-medium text-sm">
                            {hasSupervisor ? 'Supervisor Active' : 'Agent Ready'}
                          </div>
                          <div className="text-muted-foreground text-xs mt-0.5">
                            {hasSupervisor ? 'Ask about build progress' : 'Ask questions about this task'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
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
            {/* Pasted image previews */}
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {pendingImages.map((img) => (
                  <div key={img.id} className="relative group">
                    <img
                      src={img.dataUrl}
                      alt={img.filename}
                      className="h-16 max-w-24 rounded-md border border-border object-cover"
                    />
                    <button
                      onClick={() => removeImage(img.id)}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove image"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
                  onPaste={handlePaste}
                />
              </div>
              <Button
                size="icon"
                className={cn(
                  "h-10 w-10 text-white",
                  inputValue.trim() || pendingImages.length > 0
                    ? "bg-orange-500 hover:bg-orange-600"
                    : "bg-orange-500/50 cursor-not-allowed"
                )}
                onClick={handleSendMessage}
                disabled={!inputValue.trim() && pendingImages.length === 0}
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
