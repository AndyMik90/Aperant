import { useId, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FolderGit, Plus, ChevronDown, Loader2, Trash2, ListTodo, GitFork, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TerminalWorktreeConfig, WorktreeListItem, OtherWorktreeInfo } from '../../../shared/types';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
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

type NavigableItem =
  | { type: 'terminal'; data: TerminalWorktreeConfig }
  | { type: 'task'; data: WorktreeListItem }
  | { type: 'other'; data: OtherWorktreeInfo };

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

function getItemName(item: NavigableItem): string {
  switch (item.type) {
    case 'terminal':
      return item.data.name;
    case 'task':
      return item.data.specName;
    case 'other':
      return item.data.displayName;
  }
}

function getItemBranch(item: NavigableItem): string {
  switch (item.type) {
    case 'terminal':
      return item.data.branchName ?? '';
    case 'task':
      return item.data.branch ?? '';
    case 'other':
      return item.data.branch ?? '';
  }
}

const ITEM_ICONS = {
  terminal: <FolderGit className="h-3 w-3 mr-2 text-amber-500/70 shrink-0" />,
  task: <ListTodo className="h-3 w-3 mr-2 text-cyan-500/70 shrink-0" />,
  other: <GitFork className="h-3 w-3 mr-2 text-purple-500/70 shrink-0" />,
};

function getItemKey(item: NavigableItem): string {
  switch (item.type) {
    case 'terminal':
      return `terminal-${item.data.name}`;
    case 'task':
      return `task-${item.data.specName}`;
    case 'other':
      return `other-${item.data.path}`;
  }
}

export function WorktreeSelector({
  terminalId,
  projectPath,
  currentWorktree,
  onCreateWorktree,
  onSelectWorktree,
}: WorktreeSelectorProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const listboxId = useId();
  const [worktrees, setWorktrees] = useState<TerminalWorktreeConfig[]>([]);
  const [taskWorktrees, setTaskWorktrees] = useState<WorktreeListItem[]>([]);
  const [otherWorktrees, setOtherWorktrees] = useState<OtherWorktreeInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [deleteWorktree, setDeleteWorktree] = useState<TerminalWorktreeConfig | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const getOptionId = (index: number) => `${listboxId}-option-${index}`;

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
        const available = currentWorktree
          ? terminalResult.data.filter((wt) => wt.worktreePath !== currentWorktree.worktreePath)
          : terminalResult.data;
        setWorktrees(available);
      }

      // Process task worktrees
      if (taskResult?.success && taskResult.data?.worktrees) {
        const availableTaskWorktrees = currentWorktree
          ? taskResult.data.worktrees.filter((wt) => wt.path !== currentWorktree.worktreePath)
          : taskResult.data.worktrees;
        setTaskWorktrees(availableTaskWorktrees);
      } else {
        setTaskWorktrees([]);
      }

      // Process other worktrees
      if (otherResult?.success && otherResult.data) {
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
  const selectTaskWorktree = useCallback((taskWt: WorktreeListItem) => {
    const config: TerminalWorktreeConfig = {
      name: taskWt.specName,
      worktreePath: taskWt.path,
      branchName: taskWt.branch,
      baseBranch: taskWt.baseBranch,
      hasGitBranch: true,
      createdAt: new Date().toISOString(),
      terminalId,
    };
    onSelectWorktree(config);
  }, [terminalId, onSelectWorktree]);

  // Convert other worktree to terminal worktree config for selection
  const selectOtherWorktree = useCallback((otherWt: OtherWorktreeInfo) => {
    const config: TerminalWorktreeConfig = {
      name: otherWt.displayName,
      worktreePath: otherWt.path,
      branchName: otherWt.branch ?? '',
      baseBranch: '',
      hasGitBranch: otherWt.branch !== null,
      createdAt: new Date().toISOString(),
      terminalId,
    };
    onSelectWorktree(config);
  }, [terminalId, onSelectWorktree]);

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    const matchesQuery = (item: NavigableItem) => {
      if (!query) return true;
      const name = getItemName(item).toLowerCase();
      const branch = getItemBranch(item).toLowerCase();
      return name.includes(query) || branch.includes(query);
    };

    const terminalItems: NavigableItem[] = worktrees
      .map((wt) => ({ type: 'terminal' as const, data: wt }))
      .filter(matchesQuery);
    const taskItems: NavigableItem[] = taskWorktrees
      .map((wt) => ({ type: 'task' as const, data: wt }))
      .filter(matchesQuery);
    const otherItems: NavigableItem[] = otherWorktrees
      .map((wt) => ({ type: 'other' as const, data: wt }))
      .filter(matchesQuery);

    return { terminalItems, taskItems, otherItems };
  }, [searchQuery, worktrees, taskWorktrees, otherWorktrees]);

  // Flatten all filtered items into a single navigable list
  const allItems = useMemo(() => {
    return [
      ...filteredItems.terminalItems,
      ...filteredItems.taskItems,
      ...filteredItems.otherItems,
    ];
  }, [filteredItems]);

  // Compute active descendant for aria
  const activeDescendant = allItems.length > 0 && focusedIndex < allItems.length
    ? getOptionId(focusedIndex)
    : undefined;

  // Select the focused item
  const selectItem = useCallback((item: NavigableItem) => {
    setIsOpen(false);
    switch (item.type) {
      case 'terminal':
        onSelectWorktree(item.data);
        break;
      case 'task':
        selectTaskWorktree(item.data);
        break;
      case 'other':
        selectOtherWorktree(item.data);
        break;
    }
  }, [onSelectWorktree, selectTaskWorktree, selectOtherWorktree]);

  // Keyboard handler for search input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % Math.max(allItems.length, 1));
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev <= 0 ? Math.max(allItems.length - 1, 0) : prev - 1
          );
          break;
        }
        case 'Home': {
          e.preventDefault();
          setFocusedIndex(0);
          break;
        }
        case 'End': {
          e.preventDefault();
          setFocusedIndex(Math.max(allItems.length - 1, 0));
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (allItems.length > 0 && focusedIndex < allItems.length) {
            selectItem(allItems[focusedIndex]);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          setIsOpen(false);
          break;
        }
      }
    },
    [allItems, focusedIndex, selectItem]
  );

  // Reset focused index when search query changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: we intentionally reset focus when searchQuery changes
  useEffect(() => {
    setFocusedIndex(0);
  }, [searchQuery]);

  // Scroll focused item into view
  useEffect(() => {
    const el = itemRefs.current.get(focusedIndex);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  // Handle open/close state changes
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchQuery('');
      setFocusedIndex(0);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetchWorktrees is intentionally excluded to prevent infinite loop
  useEffect(() => {
    if (isOpen && projectPath) {
      fetchWorktrees();
    }
  }, [isOpen, projectPath]);

  // Handle delete worktree
  const handleDeleteWorktree = async () => {
    if (!deleteWorktree || !projectPath) return;
    setIsDeleting(true);
    try {
      const result = await window.electronAPI.removeTerminalWorktree(
        projectPath,
        deleteWorktree.name,
        deleteWorktree.hasGitBranch
      );
      if (result.success) {
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

  const renderWorktreeItem = (item: NavigableItem, index: number) => {
    const isFocused = index === focusedIndex;
    const key = getItemKey(item);
    const name = getItemName(item);
    const branch = getItemBranch(item);

    const branchLabel =
      item.type === 'other' && item.data.branch === null
        ? `${item.data.commitSha} ${t('terminal:worktree.detached')}`
        : branch;

    return (
      <div
        key={key}
        id={getOptionId(index)}
        ref={(el) => {
          if (el) itemRefs.current.set(index, el);
          else itemRefs.current.delete(index);
        }}
        role="option"
        tabIndex={-1}
        aria-selected={isFocused}
        className={cn(
          'flex items-center text-xs px-2 py-1.5 rounded-sm cursor-pointer group',
          isFocused
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-accent/50'
        )}
        onClick={(e) => {
          e.stopPropagation();
          selectItem(item);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') selectItem(item);
        }}
        onMouseEnter={() => setFocusedIndex(index)}
      >
        {ITEM_ICONS[item.type]}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="truncate font-medium">{name}</span>
          {branchLabel && (
            <span className="text-[10px] text-muted-foreground truncate">
              {branchLabel}
            </span>
          )}
        </div>
        {item.type === 'terminal' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setDeleteWorktree(item.data);
            }}
            className="ml-2 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            aria-label={t('common:delete')}
            title={t('common:delete')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  };

  const { terminalItems, taskItems, otherItems } = filteredItems;
  const hasResults = allItems.length > 0;

  return (
    <>
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
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
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchInputRef.current?.focus();
        }}
      >
        {/* Pinned: Create new worktree */}
        <button
          type="button"
          className="flex items-center text-xs px-2 py-1.5 m-1 rounded-sm cursor-pointer text-amber-500 hover:bg-accent/50 w-[calc(100%-0.5rem)] text-left"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(false);
            onCreateWorktree();
          }}
        >
          <Plus className="h-3 w-3 mr-2" />
          {t('terminal:worktree.createNew')}
        </button>

        <div className="border-t border-border" />

        {/* Search input */}
        <div className="flex items-center px-2 py-1.5">
          <Search className="h-3 w-3 mr-2 text-muted-foreground shrink-0" />
          <input
            ref={searchInputRef}
            type="search"
            role="combobox"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-controls={listboxId}
            aria-activedescendant={activeDescendant}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('terminal:worktree.searchPlaceholder')}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="border-t border-border" />

        {/* Scrollable results */}
        <div className="max-h-[min(500px,60vh)] overflow-y-auto">
          <div id={listboxId} role="listbox" aria-label={t('terminal:worktree.searchPlaceholder')} className="p-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : !hasResults ? (
              <div className="py-2 text-center text-xs text-muted-foreground">
                {t('terminal:worktree.noResults')}
              </div>
            ) : (
              <>
                {/* Terminal Worktrees */}
                {terminalItems.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {t('terminal:worktree.existing')}
                    </div>
                    {terminalItems.map((item, i) => renderWorktreeItem(item, i))}
                  </>
                )}

                {/* Task Worktrees */}
                {taskItems.length > 0 && (
                  <>
                    {terminalItems.length > 0 && <div className="border-t border-border my-1" />}
                    <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {t('terminal:worktree.taskWorktrees')}
                    </div>
                    {taskItems.map((item, i) => renderWorktreeItem(item, terminalItems.length + i))}
                  </>
                )}

                {/* Other Worktrees */}
                {otherItems.length > 0 && (
                  <>
                    {(terminalItems.length > 0 || taskItems.length > 0) && (
                      <div className="border-t border-border my-1" />
                    )}
                    <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {t('terminal:worktree.otherWorktrees')}
                    </div>
                    {otherItems.map((item, i) => renderWorktreeItem(item, terminalItems.length + taskItems.length + i))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>

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
