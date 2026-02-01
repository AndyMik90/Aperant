/**
 * ToolUseCard - Display tool executions with collapsible output
 *
 * Shows tool name, input parameters, and expandable output similar to
 * VS Code Claude extension.
 */

import { useState } from 'react';
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
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ToolUseContent } from '../../lib/claude-output-parser';

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

export function ToolUseCard({ tool }: ToolUseCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const icon = TOOL_ICONS[tool.toolName] || <FileText className="h-3.5 w-3.5" />;
  const colorClass = TOOL_COLORS[tool.toolName] || 'text-gray-600 dark:text-gray-400 bg-gray-500/10';

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
      return <span className="font-mono text-xs">{tool.input.command as string}</span>;
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

    // Default: show first value or JSON
    const firstValue = Object.values(tool.input)[0];
    if (typeof firstValue === 'string') {
      return <span className="font-mono text-xs">{firstValue}</span>;
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
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {formatInput()}
          </div>
        </div>
      </div>

      {/* Expandable output */}
      {isExpanded && tool.output && (
        <div className="px-3 py-2 border-t border-border bg-muted/20">
          <div className="text-xs font-medium text-muted-foreground mb-1">Output:</div>
          <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap max-h-96 overflow-y-auto">
            {tool.output}
          </pre>
        </div>
      )}
    </div>
  );
}
