/**
 * Shared ToolBlock - Rich tool use rendering in Claude Code terminal style.
 *
 * Colored headers per tool type:
 *   Bash = purple, Edit = green, Write = green, Read = blue,
 *   Grep = orange, Glob = pink, Task = indigo, default = cyan
 *
 * Accepts a generic ToolData interface that both TaskMonitorChat's ContentBlock
 * and Insights' InsightsToolUsage can map to.
 */

import { useState } from 'react';
import { cn } from '../../lib/utils';
import { DiffLine } from './DiffLine';

/** Generic tool data interface used by both task chat and insights chat */
export interface ToolData {
  toolName: string;
  input?: Record<string, unknown>;
  output?: string;
  status?: 'running' | 'success' | 'error';
}

function StatusIndicator({ status }: { status?: string }) {
  if (status === 'success') return <span className="text-green-500 ml-1">&#10003;</span>;
  if (status === 'error') return <span className="text-red-500 ml-1">&#10007;</span>;
  if (status === 'running') return <span className="text-blue-400 ml-1 animate-pulse">&#9679;</span>;
  return null;
}

function shouldCollapseByDefault(output: string | undefined): boolean {
  if (!output) return false;
  return output.split('\n').length > 15;
}

interface ToolBlockProps {
  tool: ToolData;
  searchQuery?: string;
  highlightMatches?: (text: string, query: string) => React.ReactNode;
}

export function ToolBlock({ tool, searchQuery, highlightMatches }: ToolBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const renderOutput = (text: string) => {
    if (searchQuery && highlightMatches) return highlightMatches(text, searchQuery);
    return text;
  };

  // Bash tool
  if (tool.toolName === 'Bash') {
    const command = tool.input?.command as string || '';
    const description = tool.input?.description as string || '';
    const hasOutput = Boolean(tool.output);
    const isCollapsible = shouldCollapseByDefault(tool.output);

    return (
      <div className="py-1.5 font-mono text-xs">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border-b border-border">
            <span className="text-purple-400 font-medium">Bash</span>
            <span className="text-muted-foreground/70 truncate flex-1">{command || 'command'}</span>
            <StatusIndicator status={tool.status} />
            {hasOutput && isCollapsible && (
              <button onClick={() => setIsExpanded(!isExpanded)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                {isExpanded ? 'collapse' : 'expand'}
              </button>
            )}
          </div>
          {description && (
            <div className="px-3 py-1 text-muted-foreground/60 text-[10px] bg-muted/20 border-b border-border/50">
              {description}
            </div>
          )}
          {tool.output && (isExpanded || !isCollapsible) && (
            <div className={cn("overflow-hidden", tool.status === 'error' ? 'bg-red-500/5' : 'bg-muted/30')}>
              <pre className={cn(
                "p-3 whitespace-pre-wrap break-all max-h-64 overflow-y-auto text-[11px]",
                tool.status === 'error' ? 'text-red-400' : 'text-muted-foreground'
              )}>
                {renderOutput(tool.output)}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Edit tool
  if (tool.toolName === 'Edit') {
    const filePath = tool.input?.file_path as string || '';
    const oldString = tool.input?.old_string as string || '';
    const newString = tool.input?.new_string as string || '';
    const hasDiff = oldString || newString;
    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    return (
      <div className="py-1.5 font-mono text-xs">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border-b border-border">
            <span className="text-green-400 font-medium">Edit</span>
            <span className="text-muted-foreground/70 truncate flex-1">{fileName}</span>
            <StatusIndicator status={tool.status} />
            {hasDiff && (
              <button onClick={() => setIsExpanded(!isExpanded)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                {isExpanded ? 'collapse' : 'expand'}
              </button>
            )}
          </div>
          <div className="px-3 py-1 text-muted-foreground/60 text-[10px] bg-muted/20 border-b border-border/50 truncate" title={filePath}>
            {filePath}
          </div>
          {isExpanded && hasDiff && (
            <div className="bg-muted/30 max-h-80 overflow-y-auto text-[11px]">
              {oldString && oldString.split('\n').map((line, i) => (
                <DiffLine key={`old-${i}`} line={line} type="remove" lineNumber={i + 1} />
              ))}
              {oldString && newString && <div className="border-t border-border/50 my-1" />}
              {newString && newString.split('\n').map((line, i) => (
                <DiffLine key={`new-${i}`} line={line} type="add" lineNumber={i + 1} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Write tool
  if (tool.toolName === 'Write') {
    const filePath = tool.input?.file_path as string || '';
    const content = tool.input?.content as string || '';
    const hasContent = Boolean(content);
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const lineCount = content ? content.split('\n').length : 0;

    return (
      <div className="py-1.5 font-mono text-xs">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border-b border-border">
            <span className="text-green-400 font-medium">Write</span>
            <span className="text-muted-foreground/70 truncate flex-1">{fileName}</span>
            <span className="text-muted-foreground/50 text-[10px]">+{lineCount} lines</span>
            <StatusIndicator status={tool.status} />
            {hasContent && (
              <button onClick={() => setIsExpanded(!isExpanded)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                {isExpanded ? 'collapse' : 'expand'}
              </button>
            )}
          </div>
          <div className="px-3 py-1 text-muted-foreground/60 text-[10px] bg-muted/20 border-b border-border/50 truncate" title={filePath}>
            {filePath}
          </div>
          {isExpanded && hasContent && (
            <div className="bg-green-500/5 max-h-80 overflow-y-auto text-[11px]">
              {content.split('\n').map((line, i) => (
                <DiffLine key={i} line={line} type="add" lineNumber={i + 1} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Read tool
  if (tool.toolName === 'Read') {
    const filePath = tool.input?.file_path as string || '';
    const offset = tool.input?.offset as number | undefined;
    const limit = tool.input?.limit as number | undefined;
    const lineRange = offset !== undefined && limit !== undefined ? ` lines ${offset}-${offset + limit}` : '';
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const hasOutput = Boolean(tool.output);
    const isCollapsible = shouldCollapseByDefault(tool.output);

    return (
      <div className="py-1.5 font-mono text-xs">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border-b border-border">
            <span className="text-blue-400 font-medium">Read</span>
            <span className="text-muted-foreground/70 truncate flex-1">{fileName}</span>
            {lineRange && <span className="text-muted-foreground/50 text-[10px]">{lineRange}</span>}
            <StatusIndicator status={tool.status} />
            {hasOutput && isCollapsible && (
              <button onClick={() => setIsExpanded(!isExpanded)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                {isExpanded ? 'collapse' : 'expand'}
              </button>
            )}
          </div>
          <div className="px-3 py-1 text-muted-foreground/60 text-[10px] bg-muted/20 border-b border-border/50 truncate" title={filePath}>
            {filePath}
          </div>
          {tool.output && (isExpanded || !isCollapsible) && (
            <div className="bg-muted/30">
              <pre className="p-3 whitespace-pre-wrap max-h-64 overflow-y-auto text-[11px] text-muted-foreground">
                {renderOutput(tool.output)}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Grep tool
  if (tool.toolName === 'Grep') {
    const pattern = tool.input?.pattern as string || '';
    const path = tool.input?.path as string || '';
    const hasOutput = Boolean(tool.output);
    const matchCount = tool.output ? tool.output.split('\n').filter(l => l.trim()).length : 0;
    const isCollapsible = shouldCollapseByDefault(tool.output);

    return (
      <div className="py-1.5 font-mono text-xs">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border-b border-border">
            <span className="text-orange-400 font-medium">Grep</span>
            <span className="text-yellow-300 truncate flex-1">"{pattern}"</span>
            {hasOutput && (
              <span className="text-muted-foreground/50 text-[10px]">
                {matchCount} {matchCount === 1 ? 'match' : 'matches'}
              </span>
            )}
            <StatusIndicator status={tool.status} />
            {hasOutput && isCollapsible && (
              <button onClick={() => setIsExpanded(!isExpanded)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                {isExpanded ? 'collapse' : 'expand'}
              </button>
            )}
          </div>
          {path && (
            <div className="px-3 py-1 text-muted-foreground/60 text-[10px] bg-muted/20 border-b border-border/50 truncate">
              in {path}
            </div>
          )}
          {tool.output && (isExpanded || !isCollapsible) && (
            <div className="bg-muted/30">
              <pre className="p-3 whitespace-pre-wrap max-h-64 overflow-y-auto text-[11px] text-muted-foreground">
                {renderOutput(tool.output)}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Glob tool
  if (tool.toolName === 'Glob') {
    const pattern = tool.input?.pattern as string || '';
    const path = tool.input?.path as string || '';
    const hasOutput = Boolean(tool.output);
    const fileCount = tool.output ? tool.output.split('\n').filter(l => l.trim()).length : 0;
    const isCollapsible = shouldCollapseByDefault(tool.output);

    return (
      <div className="py-1.5 font-mono text-xs">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-pink-500/10 border-b border-border">
            <span className="text-pink-400 font-medium">Glob</span>
            <span className="text-yellow-300 truncate flex-1">"{pattern}"</span>
            {hasOutput && (
              <span className="text-muted-foreground/50 text-[10px]">
                {fileCount} {fileCount === 1 ? 'file' : 'files'}
              </span>
            )}
            <StatusIndicator status={tool.status} />
            {hasOutput && isCollapsible && (
              <button onClick={() => setIsExpanded(!isExpanded)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                {isExpanded ? 'collapse' : 'expand'}
              </button>
            )}
          </div>
          {path && (
            <div className="px-3 py-1 text-muted-foreground/60 text-[10px] bg-muted/20 border-b border-border/50 truncate">
              in {path}
            </div>
          )}
          {tool.output && (isExpanded || !isCollapsible) && (
            <div className="bg-muted/30">
              <pre className="p-3 whitespace-pre-wrap max-h-64 overflow-y-auto text-[11px] text-muted-foreground">
                {renderOutput(tool.output)}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Task tool
  if (tool.toolName === 'Task') {
    const description = tool.input?.description as string || '';
    const prompt = tool.input?.prompt as string || '';
    const hasOutput = Boolean(tool.output);
    const isCollapsible = shouldCollapseByDefault(tool.output);

    return (
      <div className="py-1.5 font-mono text-xs">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-indigo-500/10 border-b border-border">
            <span className="text-indigo-400 font-medium">Task</span>
            <span className="text-muted-foreground/70 truncate flex-1">{description || 'subagent'}</span>
            <StatusIndicator status={tool.status} />
            {hasOutput && isCollapsible && (
              <button onClick={() => setIsExpanded(!isExpanded)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                {isExpanded ? 'collapse' : 'expand'}
              </button>
            )}
          </div>
          {prompt && (
            <div className="px-3 py-1 text-muted-foreground/60 text-[10px] bg-muted/20 border-b border-border/50 truncate" title={prompt}>
              {prompt.slice(0, 100)}{prompt.length > 100 ? '...' : ''}
            </div>
          )}
          {tool.output && (isExpanded || !isCollapsible) && (
            <div className="bg-muted/30">
              <pre className="p-3 whitespace-pre-wrap max-h-64 overflow-y-auto text-[11px] text-muted-foreground">
                {renderOutput(tool.output)}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default tool rendering
  const inputValues = Object.values(tool.input || {});
  const firstValue = inputValues.find((v): v is string => typeof v === 'string' && v.length < 100);
  const hasOutput = Boolean(tool.output);
  const isCollapsible = shouldCollapseByDefault(tool.output);

  return (
    <div className="py-1.5 font-mono text-xs">
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-cyan-500/10 border-b border-border">
          <span className="text-cyan-400 font-medium">{tool.toolName}</span>
          {firstValue && <span className="text-muted-foreground/70 truncate flex-1">{firstValue}</span>}
          <StatusIndicator status={tool.status} />
          {hasOutput && isCollapsible && (
            <button onClick={() => setIsExpanded(!isExpanded)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              {isExpanded ? 'collapse' : 'expand'}
            </button>
          )}
        </div>
        {tool.output && (isExpanded || !isCollapsible) && (
          <div className="bg-muted/30">
            <pre className="p-3 whitespace-pre-wrap max-h-64 overflow-y-auto text-[11px] text-muted-foreground">
              {renderOutput(tool.output)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
