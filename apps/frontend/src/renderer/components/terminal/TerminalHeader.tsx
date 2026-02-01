import { X, Sparkles, TerminalSquare, FolderGit, ExternalLink, GripVertical, Maximize2, Minimize2, Square, ChevronDown, ChevronUp, MessageSquare, Code2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import type { Task, TerminalWorktreeConfig } from '../../../shared/types';
import type { TerminalStatus } from '../../stores/terminal-store';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { STATUS_COLORS } from './types';
import { TerminalTitle } from './TerminalTitle';
import { TaskSelector } from './TaskSelector';
import { WorktreeSelector } from './WorktreeSelector';

interface TerminalHeaderProps {
  terminalId: string;
  title: string;
  status: TerminalStatus;
  isClaudeMode: boolean;
  tasks: Task[];
  associatedTask?: Task;
  onClose: () => void;
  onInvokeClaude: () => void;
  onTitleChange: (newTitle: string) => void;
  onTaskSelect: (taskId: string) => void;
  onClearTask: () => void;
  onNewTaskClick?: () => void;
  terminalCount?: number;
  /** Worktree configuration if terminal is associated with a worktree */
  worktreeConfig?: TerminalWorktreeConfig;
  /** Project path for worktree operations */
  projectPath?: string;
  /** Callback to open worktree creation dialog */
  onCreateWorktree?: () => void;
  /** Callback when an existing worktree is selected */
  onSelectWorktree?: (config: TerminalWorktreeConfig) => void;
  /** Callback to open worktree in IDE */
  onOpenInIDE?: () => void;
  /** Drag handle listeners for terminal reordering */
  dragHandleListeners?: SyntheticListenerMap;
  /** Whether the terminal is expanded to full view */
  isExpanded?: boolean;
  /** Callback to toggle expanded state */
  onToggleExpand?: () => void;
  /** Whether this is a task monitor terminal */
  isTaskMonitor?: boolean;
  /** Task ID for task monitors */
  taskId?: string;
  /** Task status for task monitors */
  taskStatus?: 'running' | 'completed' | 'failed';
  /** Whether the terminal is minimized to just the title bar */
  isMinimized?: boolean;
  /** Callback to toggle minimized state */
  onToggleMinimize?: () => void;
  /** View mode for task monitors (rich chat UI vs raw terminal) */
  viewMode?: 'rich' | 'raw';
  /** Callback to toggle view mode */
  onToggleViewMode?: () => void;
}

export function TerminalHeader({
  terminalId,
  title,
  status,
  isClaudeMode,
  tasks,
  associatedTask,
  onClose,
  onInvokeClaude,
  onTitleChange,
  onTaskSelect,
  onClearTask,
  onNewTaskClick,
  terminalCount = 1,
  worktreeConfig,
  projectPath,
  onCreateWorktree,
  onSelectWorktree,
  onOpenInIDE,
  dragHandleListeners,
  isExpanded,
  onToggleExpand,
  isTaskMonitor,
  taskId,
  taskStatus,
  isMinimized,
  onToggleMinimize,
  viewMode,
  onToggleViewMode,
}: TerminalHeaderProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const backlogTasks = tasks.filter((t) => t.status === 'planning');

  return (
    <div className="electron-no-drag group/header flex h-9 items-center justify-between border-b border-border/50 bg-card/30 px-2">
      <div className="flex items-center gap-2">
        {/* Drag handle - visible on hover */}
        {dragHandleListeners && (
          <div
            {...dragHandleListeners}
            className={cn(
              'flex items-center justify-center',
              'w-4 h-6 -ml-1',
              'opacity-0 group-hover/header:opacity-60',
              'hover:opacity-100 transition-opacity',
              'cursor-grab active:cursor-grabbing',
              'text-muted-foreground hover:text-foreground'
            )}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </div>
        )}
        <div className={cn('h-2 w-2 rounded-full', STATUS_COLORS[status])} />
        <div className="flex items-center gap-1.5">
          <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <TerminalTitle
            title={title}
            associatedTask={associatedTask}
            onTitleChange={onTitleChange}
            terminalCount={terminalCount}
            isTaskMonitor={isTaskMonitor}
          />
        </div>
        {isClaudeMode && (
          <span
            className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded"
            title="Claude"
          >
            <Sparkles className="h-2.5 w-2.5" />
            {terminalCount < 4 && <span>Claude</span>}
          </span>
        )}
        {isClaudeMode && (
          <TaskSelector
            terminalId={terminalId}
            backlogTasks={backlogTasks}
            associatedTask={associatedTask}
            onTaskSelect={onTaskSelect}
            onClearTask={onClearTask}
            onNewTaskClick={onNewTaskClick}
          />
        )}
        {/* Worktree selector or badge - placed next to task selector (hidden for task monitors) */}
        {!isTaskMonitor && (
          worktreeConfig ? (
            <span
              className={cn(
                'flex items-center gap-1 text-[10px] font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded',
                terminalCount >= 6 ? 'max-w-20' : terminalCount >= 4 ? 'max-w-28' : 'max-w-40'
              )}
              title={worktreeConfig.name}
            >
              <FolderGit className="h-2.5 w-2.5 flex-shrink-0" />
              <span className="truncate">{worktreeConfig.name}</span>
            </span>
          ) : (
            projectPath && onCreateWorktree && onSelectWorktree && (
              <WorktreeSelector
                terminalId={terminalId}
                projectPath={projectPath}
                currentWorktree={worktreeConfig}
                onCreateWorktree={onCreateWorktree}
                onSelectWorktree={onSelectWorktree}
              />
            )
          )
        )}
      </div>
      <div className="flex items-center gap-1">
        {/* Open in IDE button when worktree exists */}
        {worktreeConfig && onOpenInIDE && (
          <Button
            variant="ghost"
            size={terminalCount >= 4 ? 'icon' : 'sm'}
            className={cn(
              'h-6 hover:bg-muted',
              terminalCount >= 4 ? 'w-6' : 'px-2 text-xs gap-1'
            )}
            onClick={(e) => {
              e.stopPropagation();
              onOpenInIDE();
            }}
            title={t('terminal:worktree.openInIDE')}
          >
            <ExternalLink className="h-3 w-3" />
            {terminalCount < 4 && t('terminal:worktree.openInIDE')}
          </Button>
        )}
        {/* Stop button for running task monitors */}
        {isTaskMonitor && taskStatus === 'running' && taskId && (
          <Button
            variant="ghost"
            size={terminalCount >= 4 ? 'icon' : 'sm'}
            className={cn(
              'h-6 hover:bg-destructive/10 hover:text-destructive',
              terminalCount >= 4 ? 'w-6' : 'px-2 text-xs gap-1'
            )}
            onClick={(e) => {
              e.stopPropagation();
              window.electronAPI.stopTask(taskId);
            }}
            title="Stop Task"
          >
            <Square className="h-3 w-3" />
            {terminalCount < 4 && <span>Stop</span>}
          </Button>
        )}
        {!isClaudeMode && !isTaskMonitor && status !== 'exited' && (
          <Button
            variant="ghost"
            size={terminalCount >= 4 ? 'icon' : 'sm'}
            className={cn(
              'h-6 hover:bg-primary/10 hover:text-primary',
              terminalCount >= 4 ? 'w-6' : 'px-2 text-xs gap-1'
            )}
            onClick={(e) => {
              e.stopPropagation();
              onInvokeClaude();
            }}
            title="Claude"
          >
            <Sparkles className="h-3 w-3" />
            {terminalCount < 4 && <span>Claude</span>}
          </Button>
        )}
        {/* View mode toggle for task monitors (rich chat vs raw terminal) */}
        {isTaskMonitor && onToggleViewMode && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onToggleViewMode();
            }}
            title={viewMode === 'rich' ? 'Switch to raw terminal view' : 'Switch to rich chat view'}
          >
            {viewMode === 'rich' ? (
              <Code2 className="h-3.5 w-3.5" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        {/* Minimize to title bar button (for task monitors) */}
        {onToggleMinimize && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMinimize();
            }}
            title={isMinimized ? 'Expand content' : 'Minimize to title bar'}
          >
            {isMinimized ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        {/* Expand/collapse button */}
        {onToggleExpand && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            title={`${isExpanded ? t('terminal:expand.collapse') : t('terminal:expand.expand')} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Shift+E)`}
          >
            {isExpanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title={`${t('common:close')} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+W)`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
