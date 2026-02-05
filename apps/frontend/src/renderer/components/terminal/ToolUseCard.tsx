/**
 * ToolUseCard - Display tool executions with collapsible output
 *
 * Shows tool name, input parameters, and expandable output similar to
 * VS Code Claude extension.
 *
 * Features:
 * - Expandable content with preview
 * - Syntax highlighting for code output
 * - Copy button for output content
 * - Status indicators (success/error/running)
 */

import { useState, useMemo } from 'react';
import {
  FileText,
  Edit3,
  Terminal,
  Search,
  Globe,
  FileSearch,
  Play,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ToolUseContent } from '../../lib/claude-output-parser';

// Simple syntax highlighting for common patterns
function highlightOutput(output: string, toolName: string): string {
  // For Bash commands, highlight special characters
  if (toolName === 'Bash') {
    return output
      .replace(/(\$\w+)/g, '<span class="text-cyan-400">$1</span>')
      .replace(/(Error|error|ERROR|FAILED|Failed)/g, '<span class="text-red-400 font-semibold">$1</span>')
      .replace(/(Success|success|SUCCESS|PASSED|Passed|✓)/g, '<span class="text-green-400 font-semibold">$1</span>');
  }
  // For file reads, try to detect JSON
  if (toolName === 'Read' && output.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(output);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Not valid JSON, return as is
    }
  }
  return output;
}

// Detect language from file path for potential highlighting
function detectLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const extMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'json': 'json',
    'md': 'markdown',
    'css': 'css',
    'html': 'html',
  };
  return ext ? extMap[ext] : undefined;
}

interface ToolUseCardProps {
  tool: ToolUseContent;
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  Read: <FileText className="h-3.5 w-3.5" />,
  Write: <Edit3 className="h-3.5 w-3.5" />,
  Edit: <Edit3 className="h-3.5 w-3.5" />,
  Bash: <Terminal className="h-3.5 w-3.5" />,
  Grep: <Search className="h-3.5 w-3.5" />,
  Glob: <FileSearch className="h-3.5 w-3.5" />,
  WebFetch: <Globe className="h-3.5 w-3.5" />,
  WebSearch: <Globe className="h-3.5 w-3.5" />,
  Task: <Play className="h-3.5 w-3.5" />,
};

const TOOL_COLORS: Record<string, string> = {
  Read: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
  Write: 'text-green-600 dark:text-green-400 bg-green-500/10',
  Edit: 'text-yellow-600 dark:text-yellow-400 bg-yellow-500/10',
  Bash: 'text-purple-600 dark:text-purple-400 bg-purple-500/10',
  Grep: 'text-orange-600 dark:text-orange-400 bg-orange-500/10',
  Glob: 'text-pink-600 dark:text-pink-400 bg-pink-500/10',
  WebFetch: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10',
  WebSearch: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10',
  Task: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10',
};

// Copy button with feedback
function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "p-1 rounded hover:bg-muted/50 transition-colors",
        copied ? "text-green-500" : "text-muted-foreground hover:text-foreground"
      )}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// Preview of output content (first few lines)
const MAX_PREVIEW_LINES = 3;
const MAX_PREVIEW_CHARS = 150;

function getOutputPreview(output: string): string {
  if (!output) return '';
  const lines = output.split('\n').filter(l => l.trim());
  const preview = lines.slice(0, MAX_PREVIEW_LINES).join('\n');
  if (preview.length > MAX_PREVIEW_CHARS) {
    return preview.substring(0, MAX_PREVIEW_CHARS) + '...';
  }
  if (lines.length > MAX_PREVIEW_LINES) {
    return preview + '\n...';
  }
  return preview;
}

export function ToolUseCard({ tool }: ToolUseCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const icon = TOOL_ICONS[tool.toolName] || <FileText className="h-3.5 w-3.5" />;
  const colorClass = TOOL_COLORS[tool.toolName] || 'text-gray-600 dark:text-gray-400 bg-gray-500/10';

  // Memoize highlighted output for performance
  const highlightedOutput = useMemo(() => {
    if (!tool.output) return '';
    return highlightOutput(tool.output, tool.toolName);
  }, [tool.output, tool.toolName]);

  // Get output preview for collapsed state
  const outputPreview = useMemo(() => {
    return getOutputPreview(tool.output || '');
  }, [tool.output]);

  // Check if output is truncated
  const hasMoreContent = tool.output && (
    tool.output.split('\n').length > MAX_PREVIEW_LINES ||
    tool.output.length > MAX_PREVIEW_CHARS
  );

  // Format input for display
  const formatInput = () => {
    if (!tool.input || Object.keys(tool.input).length === 0) {
      return null;
    }

    // Special formatting for common patterns
    if (tool.input.file_path) {
      return <span className="font-mono text-xs">{tool.input.file_path as string}</span>;
    }
    if (tool.input.command) {
      const cmd = tool.input.command as string;
      // Truncate long commands
      const displayCmd = cmd.length > 80 ? cmd.substring(0, 80) + '...' : cmd;
      return <span className="font-mono text-xs">{displayCmd}</span>;
    }
    if (tool.input.pattern) {
      return <span className="font-mono text-xs">{tool.input.pattern as string}</span>;
    }
    if (tool.input.url) {
      return <span className="font-mono text-xs">{tool.input.url as string}</span>;
    }
    if (tool.input.target) {
      return <span className="font-mono text-xs">{tool.input.target as string}</span>;
    }
    if (tool.input.description) {
      return <span className="text-xs italic">{tool.input.description as string}</span>;
    }

    // Default: show first value or JSON
    const firstValue = Object.values(tool.input)[0];
    if (typeof firstValue === 'string') {
      const displayVal = firstValue.length > 60 ? firstValue.substring(0, 60) + '...' : firstValue;
      return <span className="font-mono text-xs">{displayVal}</span>;
    }

    return (
      <details className="text-xs">
        <summary className="cursor-pointer hover:underline">View parameters</summary>
        <pre className="mt-1 text-xs text-muted-foreground">
          {JSON.stringify(tool.input, null, 2)}
        </pre>
      </details>
    );
  };

  // Get line and character counts for display
  const outputStats = useMemo(() => {
    if (!tool.output) return null;
    const lines = tool.output.split('\n').length;
    const chars = tool.output.length;
    return { lines, chars };
  }, [tool.output]);

  return (
    <div className="mt-2 rounded-lg border border-border overflow-hidden bg-background">
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer select-none',
          colorClass
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
        )}
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{tool.toolName}</span>
            {tool.status && (
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded",
                tool.status === 'success' && 'bg-green-500/20 text-green-700 dark:text-green-300',
                tool.status === 'error' && 'bg-red-500/20 text-red-700 dark:text-red-300',
                tool.status === 'running' && 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
              )}>
                {tool.status}
              </span>
            )}
            {/* Output stats badge */}
            {outputStats && !isExpanded && (
              <span className="text-[10px] text-muted-foreground">
                {outputStats.lines > 1 ? `${outputStats.lines} lines` : `${outputStats.chars} chars`}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {formatInput()}
          </div>
        </div>
        {/* Copy button - visible in header */}
        {tool.output && (
          <div className="flex-shrink-0">
            <CopyButton content={tool.output} />
          </div>
        )}
      </div>

      {/* Preview when collapsed (show snippet of output) */}
      {!isExpanded && outputPreview && hasMoreContent && (
        <div className="px-3 py-1.5 border-t border-border bg-muted/10">
          <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap line-clamp-3">
            {outputPreview}
          </pre>
          <button
            onClick={() => setIsExpanded(true)}
            className="text-[10px] text-blue-500 hover:underline mt-1"
          >
            Show full output...
          </button>
        </div>
      )}

      {/* Expanded output with syntax highlighting */}
      {isExpanded && tool.output && (
        <div className="px-3 py-2 border-t border-border bg-muted/20">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-medium text-muted-foreground">
              Output ({outputStats?.lines} lines)
            </div>
          </div>
          <pre
            className="text-xs font-mono text-foreground/80 whitespace-pre-wrap max-h-96 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: highlightedOutput }}
          />
        </div>
      )}
    </div>
  );
}
