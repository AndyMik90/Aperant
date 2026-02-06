import { useState, useEffect } from 'react';
import { FolderGit, Plus, ChevronDown, Loader2, Trash2, ListTodo, GitFork } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TerminalWorktreeConfig, WorktreeListItem, OtherWorktreeInfo } from '../../../shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { cn } from '../../lib/utils';
import { useProjectStore } from '../../stores/project-store';

interface WorktreeSelectorProps {
  terminalId: string;
  projectPath: string;
  /** Currently attached worktree config, if any */
  currentWorktree?: TerminalWorktreeConfig;
  /** Callback to create a new worktree */
  onCreateWorktree: () => void;
  /** Callback when an existing worktree is selected */
  onSelectWorktree: (config: TerminalWorktreeConfig) => void;
}

export function WorktreeSelector({
  terminalId,
  projectPath,
  currentWorktree,
  onCreateWorktree,
  onSelectWorktree,
}: WorktreeSelectorProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [worktrees, setWorktrees] = useState<TerminalWorktreeConfig[]>([]);
  const [taskWorktrees, setTaskWorktrees] = useState<WorktreeListItem[]>([]);
  const [otherWorktrees, setOtherWorktrees] = useState<OtherWorktreeInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [deleteWorktree, setDeleteWorktree] = useState<TerminalWorktreeConfig | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Get project ID from projectPath for task worktrees API
  const project = useProjectStore((state) =>
    state.projects.find((p) => p.path === projectPath)
  );

  // Fetch worktrees when dropdown opens
  const fetchWorktrees = async () => {
    if (!projectPath) return;
    setIsLoading(true);
    try {
      // Fetch terminal worktrees, task worktrees, and other worktrees in parallel
      const [terminalResult, taskResult, otherResult] = await Promise.all([
        window.electronAPI.listTerminalWorktrees(projectPath),
        project?.id ? window.electronAPI.listWorktrees(project.id, { includeStats: false }) : Promise.resolve(null),
        window.electronAPI.listOtherWorktrees(projectPath),
      ]);

      // Process terminal worktrees
      if (terminalResult.success && terminalResult.data) {
        // Filter out the current worktree from the list using path for consistency
        const available = currentWorktree
          ? terminalResult.data.filter((wt) => wt.worktreePath !== currentWorktree.worktreePath)
          : terminalResult.data;
        setWorktrees(available);
      }

      // Process task worktrees
      if (taskResult?.success && taskResult.data?.worktrees) {
        // Filter out current worktree if it matches a task worktree
        const availableTaskWorktrees = currentWorktree
          ? taskResult.data.worktrees.filter((wt) => wt.path !== currentWorktree.worktreePath)
          : taskResult.data.worktrees;
        setTaskWorktrees(availableTaskWorktrees);
      } else {
        // Clear task worktrees when project is null or fetch failed
        setTaskWorktrees([]);
      }

      // Process other worktrees
      if (otherResult?.success && otherResult.data) {
        // Filter out current worktree if it matches
        const availableOtherWorktrees = currentWorktree
          ? otherResult.data.filter((wt) => wt.path !== currentWorktree.worktreePath)
          : otherResult.data;
        setOtherWorktrees(availableOtherWorktrees);
      } else {
        setOtherWorktrees([]);
      }
    } catch (err) {
      console.error('Failed to fetch worktrees:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Convert task worktree to terminal worktree config for selection
  const selectTaskWorktree = (taskWt: WorktreeListItem) => {
    const config: TerminalWorktreeConfig = {
      name: taskWt.specName,
      worktreePath: taskWt.path,
      branchName: taskWt.branch,
      baseBranch: taskWt.baseBranch,
      hasGitBranch: true,
      // Note: This represents when the worktree was attached to this terminal, not when it was originally created
      createdAt: new Date().toISOString(),
      terminalId,
    };
    onSelectWorktree(config);
  };

  // Convert other worktree to terminal worktree config for selection
  const selectOtherWorktree = (otherWt: OtherWorktreeInfo) => {
    const config: TerminalWorktreeConfig = {
      name: otherWt.displayName,
      worktreePath: otherWt.path,
      branchName: otherWt.branch ?? '',
      baseBranch: '', // Unknown for external worktrees
      hasGitBranch: otherWt.branch !== null,
      createdAt: new Date().toISOString(),
      terminalId,
    };
    onSelectWorktree(config);
  };

  useEffect(() => {
    if (isOpen && projectPath) {
      fetchWorktrees();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchWorktrees is intentionally excluded to prevent infinite loop
  }, [isOpen, projectPath]);

  // Handle delete worktree
  const handleDeleteWorktree = async () => {
    if (!deleteWorktree || !projectPath) return;
    setIsDeleting(true);
    try {
      const result = await window.electronAPI.removeTerminalWorktree(
        projectPath,
        deleteWorktree.name,
        deleteWorktree.hasGitBranch // Delete the branch too if it was created
      );
      if (result.success) {
        // Refresh the list
        await fetchWorktrees();
      } else {
        console.error('Failed to delete worktree:', result.error);
      }
    } catch (err) {
      console.error('Failed to delete worktree:', err);
    } finally {
      setIsDeleting(false);
      setDeleteWorktree(null);
    }
  };

  // If terminal already has a worktree, show worktree badge (handled in TerminalHeader)
  // This component only shows when there's no worktree attached

  return (
    <>
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 h-6 px-2 rounded text-xs font-medium transition-colors',
            'hover:bg-amber-500/10 hover:text-amber-500 text-muted-foreground'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <FolderGit className="h-3 w-3" />
          <span>{t('terminal:worktree.create')}</span>
          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {/* New Worktree - always at top */}
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(false);
            onCreateWorktree();
          }}
          className="text-xs text-amber-500"
        >
          <Plus className="h-3 w-3 mr-2" />
          {t('terminal:worktree.createNew')}
        </DropdownMenuItem>

        {/* Fixed separator between "Create New" and scrollable content */}
        <DropdownMenuSeparator />

        {/* Scrollable content with native browser scrolling */}
        <div className="max-h-[300px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Terminal Worktrees Section */}
              {worktrees.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t('terminal:worktree.existing')}
                  </div>
                  {worktrees.map((wt) => (
                    <DropdownMenuItem
                      key={wt.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(false);
                        onSelectWorktree(wt);
                      }}
                      className="text-xs group"
                    >
                      <FolderGit className="h-3 w-3 mr-2 text-amber-500/70 shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate font-medium">{wt.name}</span>
                        {wt.branchName && (
                          <span className="text-[10px] text-muted-foreground truncate">
                            {wt.branchName}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setDeleteWorktree(wt);
                        }}
                        className="ml-2 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title={t('common:delete')}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {/* Task Worktrees Section */}
              {taskWorktrees.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t('terminal:worktree.taskWorktrees')}
                  </div>
                  {taskWorktrees.map((wt) => (
                    <DropdownMenuItem
                      key={wt.specName}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(false);
                        selectTaskWorktree(wt);
                      }}
                      className="text-xs group"
                    >
                      <ListTodo className="h-3 w-3 mr-2 text-cyan-500/70 shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate font-medium">{wt.specName}</span>
                        {wt.branch && (
                          <span className="text-[10px] text-muted-foreground truncate">
                            {wt.branch}
                          </span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {/* Other Worktrees Section */}
              {otherWorktrees.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t('terminal:worktree.otherWorktrees')}
                  </div>
                  {otherWorktrees.map((wt) => (
                    <DropdownMenuItem
                      key={wt.path}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(false);
                        selectOtherWorktree(wt);
                      }}
                      className="text-xs group"
                    >
                      <GitFork className="h-3 w-3 mr-2 text-purple-500/70 shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate font-medium">{wt.displayName}</span>
                        <span className="text-[10px] text-muted-foreground truncate">
                          {wt.branch !== null ? wt.branch : `${wt.commitSha} ${t('terminal:worktree.detached')}`}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>

    {/* Delete Confirmation Dialog */}
    <AlertDialog open={!!deleteWorktree} onOpenChange={(open) => !open && setDeleteWorktree(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('terminal:worktree.deleteTitle', 'Delete Worktree?')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('terminal:worktree.deleteDescription', 'This will permanently delete the worktree and its branch. Any uncommitted changes will be lost.')}
            {deleteWorktree && (
              <span className="block mt-2 font-mono text-sm">
                {deleteWorktree.name}
                {deleteWorktree.branchName && (
                  <span className="text-muted-foreground"> ({deleteWorktree.branchName})</span>
                )}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{t('common:cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteWorktree}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('common:deleting', 'Deleting...')}
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                {t('common:delete')}
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
