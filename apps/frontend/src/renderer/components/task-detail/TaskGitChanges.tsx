import { useState, useEffect, useCallback } from 'react';
import {
  FileCode,
  FilePlus,
  FileX,
  FilePen,
  Loader2,
  AlertCircle,
  RefreshCw,
  GitBranch,
  Plus,
  Minus
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import type { Task, IPCResult } from '../../../shared/types';
import { isWeb as isWebPlatform } from '../../../shared/platform';

interface TaskGitChangesProps {
  task: Task;
}

interface GitChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

interface GitChangesSummary {
  totalFiles: number;
  added: number;
  modified: number;
  deleted: number;
  totalAdditions: number;
  totalDeletions: number;
}

interface GitChangesData {
  files: GitChangedFile[];
  summary: GitChangesSummary;
  hasWorktree: boolean;
  baseBranch?: string;
}

// Get icon based on file status
function getStatusIcon(status: string) {
  switch (status) {
    case 'added':
      return <FilePlus className="h-4 w-4 text-green-500" />;
    case 'deleted':
      return <FileX className="h-4 w-4 text-red-500" />;
    case 'modified':
      return <FilePen className="h-4 w-4 text-blue-500" />;
    case 'renamed':
      return <FileCode className="h-4 w-4 text-yellow-500" />;
    default:
      return <FileCode className="h-4 w-4 text-muted-foreground" />;
  }
}

// Get status badge color
function getStatusBadgeClass(status: string) {
  switch (status) {
    case 'added':
      return 'bg-green-500/10 text-green-500 border-green-500/20';
    case 'deleted':
      return 'bg-red-500/10 text-red-500 border-red-500/20';
    case 'modified':
      return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    case 'renamed':
      return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

// Simple diff viewer component
function DiffViewer({ diff }: { diff: string }) {
  if (!diff) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No changes to display
      </div>
    );
  }

  const lines = diff.split('\n');

  return (
    <pre className="text-xs font-mono leading-relaxed">
      {lines.map((line, idx) => {
        let lineClass = 'px-2 py-0.5';

        if (line.startsWith('+++') || line.startsWith('---')) {
          lineClass += ' text-muted-foreground bg-muted/30';
        } else if (line.startsWith('@@')) {
          lineClass += ' text-purple-400 bg-purple-500/10';
        } else if (line.startsWith('+')) {
          lineClass += ' text-green-400 bg-green-500/10';
        } else if (line.startsWith('-')) {
          lineClass += ' text-red-400 bg-red-500/10';
        } else if (line.startsWith('diff --git')) {
          lineClass += ' text-muted-foreground font-medium border-t border-border mt-2 pt-2';
        }

        return (
          <div key={idx} className={lineClass}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}

export function TaskGitChanges({ task }: TaskGitChangesProps) {
  const isWeb =
    isWebPlatform() ||
    (typeof window !== 'undefined' &&
      (window.location?.protocol?.startsWith('http') ||
        (window as any).electronAPI?.platform === 'web' ||
        (window as any).electronAPI?.isElectron === false));

  // Debug logging
  console.log('[TaskGitChanges] Rendering with task:', {
    id: task.id,
    specId: task.specId,
    projectId: task.projectId,
    specsPath: task.specsPath
  });

  // State for git changes
  const [gitChanges, setGitChanges] = useState<GitChangesData | null>(null);
  const [isLoadingChanges, setIsLoadingChanges] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);

  // State for diff content
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Web API: Get git changes
  const getTaskGitChangesWeb = async (projectId: string, specId: string): Promise<IPCResult<any>> => {
    const response = await fetch(`/api/projects/${projectId}/tasks/${specId}/git-changes`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return response.json();
  };

  // Web API: Get file diff
  const getTaskFileDiffWeb = async (projectId: string, specId: string, filePath: string): Promise<IPCResult<any>> => {
    const response = await fetch(
      `/api/projects/${projectId}/tasks/${specId}/git-diff?file_path=${encodeURIComponent(filePath)}`,
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return response.json();
  };

  // Load git changes
  const loadGitChanges = useCallback(async () => {
    // Validate required fields - CRITICAL: Check before any API calls
    if (!task.projectId || !task.specId) {
      console.warn('[TaskGitChanges] Skipping API call - missing projectId or specId:', {
        projectId: task.projectId,
        specId: task.specId
      });
      // Don't set error state, just silently skip
      return;
    }

    setIsLoadingChanges(true);
    setChangesError(null);

    try {
      let result;
      if (isWeb) {
        result = await getTaskGitChangesWeb(task.projectId, task.specId);
      } else if (window.electronAPI && 'getTaskGitChanges' in window.electronAPI) {
        result = await (window.electronAPI as any).getTaskGitChanges(task.projectId, task.specId);
      }

      if (!result || !result.success || !result.data) {
        throw new Error(result?.error || 'Failed to load git changes');
      }
      setGitChanges(result.data as GitChangesData);
    } catch (err) {
      setChangesError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoadingChanges(false);
    }
  }, [task.projectId, task.specId, isWeb]);

  // Load file diff
  const loadFileDiff = useCallback(async (filePath: string) => {
    // Validate required fields - CRITICAL: Check before any API calls
    if (!task.projectId || !task.specId) {
      console.warn('[TaskGitChanges] Skipping diff API call - missing projectId or specId');
      return;
    }

    setSelectedFile(filePath);
    setIsLoadingDiff(true);
    setDiffError(null);
    setDiffContent(null);

    try {
      let result;
      if (isWeb) {
        result = await getTaskFileDiffWeb(task.projectId, task.specId, filePath);
      } else if (window.electronAPI && 'getTaskFileDiff' in window.electronAPI) {
        result = await (window.electronAPI as any).getTaskFileDiff(task.projectId, task.specId, filePath);
      }

      if (!result || !result.success || !result.data) {
        throw new Error(result?.error || 'Failed to load diff');
      }
      setDiffContent((result.data as { diff: string }).diff);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoadingDiff(false);
    }
  }, [task.projectId, task.specId, isWeb]);

  // Load git changes on mount
  useEffect(() => {
    // Only load if we have the required IDs
    if (task.projectId && task.specId) {
      loadGitChanges();
    }
  }, [loadGitChanges, task.projectId, task.specId]);

  // Auto-select first file when changes are loaded
  useEffect(() => {
    if (gitChanges?.files && gitChanges.files.length > 0 && selectedFile === null) {
      loadFileDiff(gitChanges.files[0].path);
    }
  }, [gitChanges, selectedFile, loadFileDiff]);

  // Show message when required IDs are missing
  if (!task.projectId || !task.specId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center py-12">
          <AlertCircle className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground mb-1">
            Unable to load changes
          </p>
          <p className="text-xs text-muted-foreground/70">
            Task information is incomplete
          </p>
        </div>
      </div>
    );
  }

  // Handle no worktree
  if (gitChanges && !gitChanges.hasWorktree) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center py-12">
          <GitBranch className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground mb-1">
            No worktree found
          </p>
          <p className="text-xs text-muted-foreground/70">
            Git changes will appear when the task has a worktree
          </p>
        </div>
      </div>
    );
  }

  // Render diff content
  const renderDiffContent = () => {
    if (!selectedFile) {
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <FileCode className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Select a file to view changes</p>
          </div>
        </div>
      );
    }

    if (isLoadingDiff) {
      return (
        <div className="h-full flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (diffError) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 text-destructive" />
            <p className="text-sm text-destructive mb-2">Failed to load diff</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadFileDiff(selectedFile)}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          </div>
        </div>
      );
    }

    return <DiffViewer diff={diffContent || ''} />;
  };

  // Get filename from path
  const getFileName = (path: string) => path.split('/').pop() || path;

  return (
    <div className="h-full flex">
      {/* File list sidebar */}
      <div className="w-64 border-r border-border flex flex-col">
        {/* Sidebar header */}
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Changes
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={loadGitChanges}
            disabled={isLoadingChanges}
          >
            <RefreshCw className={cn("h-3 w-3", isLoadingChanges && "animate-spin")} />
          </Button>
        </div>

        {/* Summary */}
        {gitChanges?.summary && (
          <div className="px-3 py-2 border-b border-border bg-muted/30">
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                {gitChanges.summary.totalFiles} files
              </span>
              <span className="flex items-center gap-0.5 text-green-500">
                <Plus className="h-3 w-3" />
                {gitChanges.summary.totalAdditions}
              </span>
              <span className="flex items-center gap-0.5 text-red-500">
                <Minus className="h-3 w-3" />
                {gitChanges.summary.totalDeletions}
              </span>
            </div>
            {gitChanges.baseBranch && (
              <div className="text-xs text-muted-foreground mt-1">
                vs {gitChanges.baseBranch}
              </div>
            )}
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {isLoadingChanges ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : changesError ? (
              <div className="text-center py-4">
                <AlertCircle className="h-5 w-5 mx-auto mb-2 text-destructive" />
                <p className="text-xs text-destructive mb-2">Failed to load changes</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadGitChanges}
                  className="text-xs"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Retry
                </Button>
              </div>
            ) : !gitChanges?.files || gitChanges.files.length === 0 ? (
              <div className="text-center py-8">
                <FileCode className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">No files changed</p>
              </div>
            ) : (
              gitChanges.files.map((file) => (
                <button
                  type="button"
                  key={file.path}
                  onClick={() => loadFileDiff(file.path)}
                  className={cn(
                    'w-full flex items-start gap-2 px-2 py-2 rounded-md text-left transition-colors',
                    'hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                    selectedFile === file.path && 'bg-secondary'
                  )}
                >
                  {getStatusIcon(file.status)}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {getFileName(file.path)}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {file.path}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <Badge variant="outline" className={cn("text-xs px-1 py-0", getStatusBadgeClass(file.status))}>
                      {file.status}
                    </Badge>
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-green-500">+{file.additions}</span>
                      <span className="text-red-500">-{file.deletions}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Diff content area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Content header */}
        {selectedFile && (
          <div className="px-4 py-2 border-b border-border flex items-center gap-2 shrink-0 bg-muted/30">
            {gitChanges?.files && getStatusIcon(gitChanges.files.find(f => f.path === selectedFile)?.status || '')}
            <span className="text-sm font-medium flex-1 truncate">{selectedFile}</span>
          </div>
        )}
        <ScrollArea className="flex-1">
          <div className="p-4">
            {renderDiffContent()}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
