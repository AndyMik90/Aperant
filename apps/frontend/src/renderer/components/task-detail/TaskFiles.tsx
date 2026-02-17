import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  FileJson,
  FileCode,
  Loader2,
  AlertCircle,
  FolderOpen,
  RefreshCw,
  ChevronRight,
  ExternalLink,
  Plus,
  Minus,
  Code
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { useSettingsStore } from '../../stores/settings-store';
import type { Task, WorktreeDiff, WorktreeStatus, WorktreeDiffFile } from '../../../shared/types';
import type { FileNode } from '../../../shared/types/project';

type ViewMode = 'changes' | 'specs';

interface TaskFilesProps {
  task: Task;
  worktreeDiff: WorktreeDiff | null;
  worktreeStatus: WorktreeStatus | null;
  isLoadingWorktree: boolean;
}

// File extensions to display in spec view
const ALLOWED_EXTENSIONS = ['.md', '.json'];

// Get icon for spec file type
function getSpecFileIcon(filename: string) {
  if (filename.endsWith('.json')) {
    return <FileJson className="h-4 w-4 text-amber-500" />;
  }
  return <FileText className="h-4 w-4 text-blue-500" />;
}

// Get status color classes for changed files (pattern from DiffViewDialog.tsx)
function getStatusColor(status: WorktreeDiffFile['status']) {
  switch (status) {
    case 'added': return 'text-success';
    case 'deleted': return 'text-destructive';
    case 'modified': return 'text-info';
    case 'renamed': return 'text-warning';
    default: return 'text-muted-foreground';
  }
}

function getStatusBadgeClasses(status: WorktreeDiffFile['status']) {
  switch (status) {
    case 'added': return 'bg-success/10 text-success';
    case 'deleted': return 'bg-destructive/10 text-destructive';
    case 'modified': return 'bg-info/10 text-info';
    case 'renamed': return 'bg-warning/10 text-warning';
    default: return '';
  }
}

// Get a short status letter for compact display
function getStatusLetter(status: WorktreeDiffFile['status']) {
  switch (status) {
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'modified': return 'M';
    case 'renamed': return 'R';
    default: return '?';
  }
}

export function TaskFiles({ task, worktreeDiff, worktreeStatus, isLoadingWorktree }: TaskFilesProps) {
  const { t } = useTranslation(['tasks']);
  const { settings } = useSettingsStore();

  // Determine default view based on available data
  const hasChanges = (worktreeDiff?.files?.length ?? 0) > 0;
  const [viewMode, setViewMode] = useState<ViewMode>(hasChanges ? 'changes' : 'specs');
  const [selectedChangeIdx, setSelectedChangeIdx] = useState<number | null>(null);

  // Update default view when worktree data loads
  useEffect(() => {
    if (hasChanges && viewMode === 'specs') {
      setViewMode('changes');
    }
  // Only on initial data load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChanges]);

  // ---- Spec Files State (original implementation) ----
  const [files, setFiles] = useState<FileNode[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const fileListRef = useRef<HTMLDivElement>(null);

  // Load files from spec directory
  const loadFiles = useCallback(async () => {
    if (!task.specsPath) return;

    setIsLoadingFiles(true);
    setFilesError(null);

    try {
      const result = await window.electronAPI.listDirectory(task.specsPath);
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to load directory');
      }

      const filteredFiles = result.data.filter(
        (file) => !file.isDirectory && ALLOWED_EXTENSIONS.some(ext => file.name.endsWith(ext))
      );

      filteredFiles.sort((a, b) => {
        if (a.name === 'spec.md') return -1;
        if (b.name === 'spec.md') return 1;
        return a.name.localeCompare(b.name);
      });

      setFiles(filteredFiles);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoadingFiles(false);
    }
  }, [task.specsPath]);

  const loadFileContent = useCallback(async (filePath: string) => {
    setSelectedFile(filePath);
    setIsLoadingContent(true);
    setContentError(null);
    setFileContent(null);

    try {
      const result = await window.electronAPI.readFile(filePath);
      if (!result.success || result.data === undefined) {
        throw new Error(result.error || 'Failed to read file');
      }
      setFileContent(result.data);
    } catch (err) {
      setContentError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoadingContent(false);
    }
  }, []);

  useEffect(() => {
    setSelectedFile(null);
    setFileContent(null);
    setContentError(null);
  }, [task.specsPath]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (files.length > 0 && selectedFile === null) {
      loadFileContent(files[0].path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Open in IDE (for worktree or spec path)
  const handleOpenInIDE = useCallback(async () => {
    const targetPath = worktreeStatus?.worktreePath || task.specsPath;
    if (!settings.preferredIDE || !targetPath) return;

    try {
      await window.electronAPI.worktreeOpenInIDE(
        targetPath,
        settings.preferredIDE,
        settings.customIDEPath
      );
    } catch (err) {
      console.error('Failed to open in IDE:', err);
    }
  }, [settings.preferredIDE, settings.customIDEPath, worktreeStatus?.worktreePath, task.specsPath]);

  // Open folder in Explorer/Finder
  const handleOpenFolder = useCallback(async () => {
    const targetPath = worktreeStatus?.worktreePath || task.specsPath;
    if (!targetPath) return;

    try {
      await window.electronAPI.openFolder(targetPath);
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }, [worktreeStatus?.worktreePath, task.specsPath]);

  // Keyboard navigation for spec file list
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (files.length === 0) return;

    const currentIndex = selectedFile
      ? files.findIndex(f => f.path === selectedFile)
      : -1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (currentIndex < files.length - 1) {
          loadFileContent(files[currentIndex + 1].path);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (currentIndex > 0) {
          loadFileContent(files[currentIndex - 1].path);
        }
        break;
      case 'Home':
        e.preventDefault();
        loadFileContent(files[0].path);
        break;
      case 'End':
        e.preventDefault();
        loadFileContent(files[files.length - 1].path);
        break;
    }
  }, [files, selectedFile, loadFileContent]);

  // Compute changes summary
  const changesSummary = useMemo(() => {
    if (!worktreeDiff?.files) return null;
    const totalAdditions = worktreeDiff.files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = worktreeDiff.files.reduce((sum, f) => sum + f.deletions, 0);
    return {
      fileCount: worktreeDiff.files.length,
      additions: totalAdditions,
      deletions: totalDeletions
    };
  }, [worktreeDiff]);

  // Get filename from path (cross-platform)
  const getFileName = (filePath: string) => filePath.split(/[/\\]/).pop() || filePath;

  // ---- Render: Changes View ----
  const renderChangesView = () => {
    if (isLoadingWorktree) {
      return (
        <div className="h-full flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (!worktreeDiff || !worktreeDiff.files || worktreeDiff.files.length === 0) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center py-12">
            <FileCode className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground mb-1">
              {t('tasks:files.noChangedFiles', { defaultValue: 'No files changed' })}
            </p>
            <p className="text-xs text-muted-foreground/70 max-w-xs mx-auto">
              {t('tasks:files.noWorktreeHint', { defaultValue: 'Code changes appear here once the task starts modifying files.' })}
            </p>
          </div>
        </div>
      );
    }

    const selectedChange = selectedChangeIdx !== null ? worktreeDiff.files[selectedChangeIdx] : null;

    return (
      <div className="h-full flex">
        {/* Changed files sidebar */}
        <div className="w-64 border-r border-border flex flex-col">
          {/* Summary header */}
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <FileCode className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground">{changesSummary?.fileCount || 0}</span> files
              </span>
              <span className="flex items-center gap-1 text-success">
                <Plus className="h-3 w-3" />
                <span className="font-medium">{changesSummary?.additions || 0}</span>
              </span>
              <span className="flex items-center gap-1 text-destructive">
                <Minus className="h-3 w-3" />
                <span className="font-medium">{changesSummary?.deletions || 0}</span>
              </span>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {worktreeDiff.files.map((file, idx) => (
                <button
                  type="button"
                  key={`${file.path}-${idx}`}
                  onClick={() => setSelectedChangeIdx(idx)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors',
                    'hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                    selectedChangeIdx === idx && 'bg-secondary'
                  )}
                >
                  <span className={cn(
                    'text-[10px] font-bold w-4 text-center shrink-0',
                    getStatusColor(file.status)
                  )}>
                    {getStatusLetter(file.status)}
                  </span>
                  <span className="text-xs font-mono truncate flex-1" title={file.path}>
                    {getFileName(file.path)}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0 text-[10px]">
                    {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="text-destructive">-{file.deletions}</span>}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Detail pane */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedChange ? (
            <>
              <div className="px-4 py-2 border-b border-border flex items-center gap-2 shrink-0 bg-muted/30">
                <FileCode className={cn('h-4 w-4 shrink-0', getStatusColor(selectedChange.status))} />
                <span className="text-sm font-mono flex-1 truncate">{selectedChange.path}</span>
                <Badge
                  variant="secondary"
                  className={cn('text-xs', getStatusBadgeClasses(selectedChange.status))}
                >
                  {selectedChange.status}
                </Badge>
              </div>
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center p-8">
                  <div className="flex items-center justify-center gap-6 mb-4">
                    <div className="text-center">
                      <span className="text-2xl font-bold text-success">+{selectedChange.additions}</span>
                      <p className="text-xs text-muted-foreground mt-1">{t('tasks:files.additions', { defaultValue: 'additions' })}</p>
                    </div>
                    <div className="w-px h-10 bg-border" />
                    <div className="text-center">
                      <span className="text-2xl font-bold text-destructive">-{selectedChange.deletions}</span>
                      <p className="text-xs text-muted-foreground mt-1">{t('tasks:files.deletions', { defaultValue: 'deletions' })}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{selectedChange.path}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <FileCode className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t('tasks:files.selectFile', { defaultValue: 'Select a file to view details' })}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ---- Render: Spec Files View (original) ----
  const renderSpecContent = () => {
    if (!selectedFile) {
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('tasks:files.selectFile')}</p>
          </div>
        </div>
      );
    }

    if (isLoadingContent) {
      return (
        <div className="h-full flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (contentError) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 text-destructive" />
            <p className="text-sm text-destructive mb-2">{t('tasks:files.errorLoadingContent')}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadFileContent(selectedFile)}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              {t('tasks:files.retry')}
            </Button>
          </div>
        </div>
      );
    }

    if (fileContent === null) return null;

    if (selectedFile.endsWith('.json')) {
      try {
        const formatted = JSON.stringify(JSON.parse(fileContent), null, 2);
        return (
          <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words p-4">
            {formatted}
          </pre>
        );
      } catch {
        return (
          <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words p-4">
            {fileContent}
          </pre>
        );
      }
    }

    return (
      <div className="prose prose-sm dark:prose-invert max-w-none p-4">
        <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words bg-transparent border-0 p-0">
          {fileContent}
        </pre>
      </div>
    );
  };

  const renderSpecsView = () => {
    if (!task.specsPath) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center py-12">
            <FolderOpen className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground mb-1">
              {t('tasks:files.noSpecPath')}
            </p>
          </div>
        </div>
      );
    }

    const selectedFileName = selectedFile ? selectedFile.split(/[/\\]/).pop() : null;

    return (
      <div className="h-full flex">
        {/* File list sidebar */}
        <div className="w-52 border-r border-border flex flex-col">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('tasks:files.specFiles', { defaultValue: 'Spec Files' })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={loadFiles}
              disabled={isLoadingFiles}
            >
              <RefreshCw className={cn("h-3 w-3", isLoadingFiles && "animate-spin")} />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div
              ref={fileListRef}
              className="p-2 space-y-1"
              role="listbox"
              aria-label={t('tasks:files.title')}
              tabIndex={files.length > 0 ? 0 : -1}
              onKeyDown={handleKeyDown}
            >
              {isLoadingFiles ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filesError ? (
                <div className="text-center py-4">
                  <AlertCircle className="h-5 w-5 mx-auto mb-2 text-destructive" />
                  <p className="text-xs text-destructive mb-2">{t('tasks:files.errorLoading')}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadFiles}
                    className="text-xs"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {t('tasks:files.retry')}
                  </Button>
                </div>
              ) : files.length === 0 ? (
                <div className="text-center py-8">
                  <FolderOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">{t('tasks:files.noFiles')}</p>
                </div>
              ) : (
                files.map((file) => (
                  <button
                    type="button"
                    key={file.path}
                    role="option"
                    aria-selected={selectedFile === file.path}
                    onClick={() => loadFileContent(file.path)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors',
                      'hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                      selectedFile === file.path && 'bg-secondary'
                    )}
                  >
                    {getSpecFileIcon(file.name)}
                    <span className="text-xs font-medium truncate flex-1">
                      {file.name}
                    </span>
                    {selectedFile === file.path && (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* File content area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedFileName && (
            <div className="px-4 py-2 border-b border-border flex items-center gap-2 shrink-0 bg-muted/30">
              {getSpecFileIcon(selectedFileName)}
              <span className="text-sm font-medium flex-1">{selectedFileName}</span>
              {settings.preferredIDE && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleOpenInIDE}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('tasks:files.openInIDE')}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          <ScrollArea className="flex-1">
            {renderSpecContent()}
          </ScrollArea>
        </div>
      </div>
    );
  };

  // ---- Main Render ----
  return (
    <div className="h-full flex flex-col">
      {/* Header bar with view toggle and action buttons */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0 bg-muted/20">
        {/* View toggle */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('changes')}
            className={cn(
              'px-2.5 py-1 rounded text-xs font-medium transition-colors',
              viewMode === 'changes'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('tasks:files.codeChanges', { defaultValue: 'Code Changes' })}
            {hasChanges && (
              <span className="ml-1.5 text-[10px] opacity-70">({worktreeDiff?.files?.length})</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('specs')}
            className={cn(
              'px-2.5 py-1 rounded text-xs font-medium transition-colors',
              viewMode === 'specs'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('tasks:files.specFiles', { defaultValue: 'Spec Files' })}
            {files.length > 0 && (
              <span className="ml-1.5 text-[10px] opacity-70">({files.length})</span>
            )}
          </button>
        </div>

        <div className="flex-1" />

        {/* Action buttons */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleOpenFolder}
                disabled={!worktreeStatus?.worktreePath && !task.specsPath}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('tasks:files.openFolderTooltip', { defaultValue: 'Open in file manager' })}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {settings.preferredIDE && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleOpenInIDE}
                  disabled={!worktreeStatus?.worktreePath && !task.specsPath}
                >
                  <Code className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t('tasks:files.openInIDE')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0">
        {viewMode === 'changes' ? renderChangesView() : renderSpecsView()}
      </div>
    </div>
  );
}
