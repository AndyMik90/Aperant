import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  MessageSquare,
  Trash2,
  Pencil,
  Check,
  X,
  MoreVertical,
  Loader2,
  CheckSquare,
  Archive,
  ArchiveRestore
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Checkbox } from './ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './ui/alert-dialog';
import { cn } from '../lib/utils';
import type { InsightsSessionSummary } from '../../shared/types';

interface ChatHistorySidebarProps {
  sessions: InsightsSessionSummary[];
  currentSessionId: string | null;
  isLoading: boolean;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => Promise<boolean>;
  onRenameSession: (sessionId: string, newTitle: string) => Promise<boolean>;
  onArchiveSession?: (sessionId: string) => Promise<void>;
  onUnarchiveSession?: (sessionId: string) => Promise<void>;
  onDeleteSessions?: (sessionIds: string[]) => Promise<void>;
  onArchiveSessions?: (sessionIds: string[]) => Promise<void>;
  showArchived?: boolean;
  onToggleShowArchived?: () => void;
}

export function ChatHistorySidebar({
  sessions,
  currentSessionId,
  isLoading,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onArchiveSession,
  onUnarchiveSession,
  onDeleteSessions,
  onArchiveSessions,
  showArchived = false,
  onToggleShowArchived
}: ChatHistorySidebarProps) {
  const { t } = useTranslation('common');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  // Clear selection when exiting selection mode
  const handleToggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      if (prev) {
        setSelectedIds(new Set());
      }
      return !prev;
    });
  }, []);

  // Prune selectedIds when sessions change - removes IDs for sessions no longer displayed
  // Also resets when showArchived toggles
  // biome-ignore lint/correctness/useExhaustiveDependencies: showArchived is intentionally a dependency to reset selection on filter change
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(sessions.map((s) => s.id));
      const pruned = new Set([...prev].filter((id) => validIds.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [sessions, showArchived]);

  const handleToggleSelect = useCallback((sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(sessions.map((s) => s.id)));
  }, [sessions]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleStartEdit = (session: InsightsSessionSummary) => {
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const handleSaveEdit = async () => {
    if (editingId && editTitle.trim()) {
      await onRenameSession(editingId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const handleDelete = async () => {
    if (deleteSessionId) {
      await onDeleteSession(deleteSessionId);
      setDeleteSessionId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size > 0 && onDeleteSessions) {
      try {
        await onDeleteSessions(Array.from(selectedIds));
        setSelectedIds(new Set());
      } catch (error) {
        console.error('Failed to delete sessions:', error);
      } finally {
        setBulkDeleteOpen(false);
      }
    }
  };

  const handleBulkArchive = () => {
    if (selectedIds.size > 0 && onArchiveSessions) {
      setBulkArchiveOpen(true);
    }
  };

  const handleBulkArchiveConfirmed = async () => {
    if (selectedIds.size > 0 && onArchiveSessions) {
      try {
        await onArchiveSessions(Array.from(selectedIds));
        setSelectedIds(new Set());
      } catch (error) {
        console.error('Failed to archive sessions:', error);
      } finally {
        setBulkArchiveOpen(false);
      }
    }
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const d = new Date(date);
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return t('insights.today');
    } else if (diffDays === 1) {
      return t('insights.yesterday');
    } else if (diffDays < 7) {
      return t('insights.daysAgo', { count: diffDays });
    } else {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
  };

  // Group sessions by date
  const groupedSessions = sessions.reduce((groups, session) => {
    const dateLabel = formatDate(session.updatedAt);
    if (!groups[dateLabel]) {
      groups[dateLabel] = [];
    }
    groups[dateLabel].push(session);
    return groups;
  }, {} as Record<string, InsightsSessionSummary[]>);

  // Sessions selected for bulk delete preview
  const sessionsToDelete = sessions.filter((s) => selectedIds.has(s.id));

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <h3 className="text-sm font-medium text-foreground">{t('insights.chatHistory')}</h3>
        <div className="flex items-center gap-1">
          {/* Selection mode toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isSelectionMode ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={handleToggleSelectionMode}
                aria-label={isSelectionMode ? t('insights.exitSelectMode') : t('insights.selectMode')}
              >
                <CheckSquare className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isSelectionMode ? t('insights.exitSelectMode') : t('insights.selectMode')}
            </TooltipContent>
          </Tooltip>

          {/* Show archived toggle */}
          {onToggleShowArchived && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showArchived ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={onToggleShowArchived}
                  aria-label={showArchived ? t('insights.hideArchived') : t('insights.showArchived')}
                >
                  <Archive className={cn('h-4 w-4', showArchived && 'text-primary')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showArchived ? t('insights.hideArchived') : t('insights.showArchived')}
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onNewSession}
                aria-label={t('accessibility.newConversationAriaLabel')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('accessibility.newConversationAriaLabel')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Select All / Clear links */}
      {isSelectionMode && sessions.length > 0 && (
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={handleSelectAll}
          >
            {t('accessibility.selectAllAriaLabel')}
          </button>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={handleClearSelection}
          >
            {t('accessibility.clearSelectionAriaLabel')}
          </button>
        </div>
      )}

      {/* Session list */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {t('insights.noConversations')}
          </div>
        ) : (
          <div className="py-2">
            {Object.entries(groupedSessions).map(([dateLabel, dateSessions]) => (
              <div key={dateLabel} className="mb-2">
                <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {dateLabel}
                </div>
                {dateSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={session.id === currentSessionId}
                    isEditing={editingId === session.id}
                    editTitle={editTitle}
                    onSelect={() => onSelectSession(session.id)}
                    onStartEdit={() => handleStartEdit(session)}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={handleCancelEdit}
                    onEditTitleChange={setEditTitle}
                    onDelete={() => setDeleteSessionId(session.id)}
                    onArchive={onArchiveSession ? () => onArchiveSession(session.id) : undefined}
                    onUnarchive={
                      onUnarchiveSession ? () => onUnarchiveSession(session.id) : undefined
                    }
                    isArchived={!!session.archivedAt}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedIds.has(session.id)}
                    onToggleSelect={() => handleToggleSelect(session.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Bulk action toolbar */}
      {isSelectionMode && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <Button
            variant="destructive"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {t('selection.deleteSelected')} ({selectedIds.size})
          </Button>
          {onArchiveSessions && (
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 text-xs"
              onClick={handleBulkArchive}
            >
              <Archive className="mr-1.5 h-3.5 w-3.5" />
              {t('insights.archiveSelected')} ({selectedIds.size})
            </Button>
          )}
        </div>
      )}

      {/* Single delete confirmation dialog */}
      <AlertDialog open={!!deleteSessionId} onOpenChange={() => setDeleteSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('insights.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('insights.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('buttons.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t('actions.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('insights.bulkDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('insights.bulkDeleteDescription', { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {sessionsToDelete.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded border border-border p-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {t('insights.conversationsToDelete')}:
              </p>
              <ul className="space-y-0.5">
                {sessionsToDelete.map((s) => (
                  <li key={s.id} className="truncate text-xs text-foreground/80">
                    {s.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('buttons.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete}>
              {t('insights.bulkDeleteConfirm', { count: selectedIds.size })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk archive confirmation dialog */}
      <AlertDialog open={bulkArchiveOpen} onOpenChange={setBulkArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('insights.archiveConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('insights.archiveConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('buttons.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkArchiveConfirmed}>
              {t('insights.archiveConfirmButton', { count: selectedIds.size })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface SessionItemProps {
  session: InsightsSessionSummary;
  isActive: boolean;
  isEditing: boolean;
  editTitle: string;
  onSelect: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditTitleChange: (title: string) => void;
  onDelete: () => void;
  onArchive?: () => Promise<void>;
  onUnarchive?: () => Promise<void>;
  isArchived: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
}

function SessionItem({
  session,
  isActive,
  isEditing,
  editTitle,
  onSelect,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditTitleChange,
  onDelete,
  onArchive,
  onUnarchive,
  isArchived,
  isSelectionMode,
  isSelected,
  onToggleSelect
}: SessionItemProps) {
  const { t } = useTranslation('common');
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSaveEdit();
    } else if (e.key === 'Escape') {
      onCancelEdit();
    }
  };

  if (isEditing) {
    return (
      <div className="group flex items-center gap-1 px-2 py-1">
        <Input
          value={editTitle}
          onChange={(e) => onEditTitleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-7 text-sm"
          autoFocus
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onSaveEdit}
          aria-label={t('accessibility.saveEditAriaLabel')}
        >
          <Check className="h-3.5 w-3.5 text-success" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onCancelEdit}
          aria-label={t('accessibility.cancelEditAriaLabel')}
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  return (
    <div
      role={isSelectionMode ? 'checkbox' : 'button'}
      aria-checked={isSelectionMode ? isSelected : undefined}
      tabIndex={0}
      className={cn(
        'group relative cursor-pointer px-2 py-2 transition-colors hover:bg-muted',
        isActive && 'bg-primary/10 hover:bg-primary/15',
        isArchived && 'opacity-50'
      )}
      onClick={isSelectionMode ? onToggleSelect : onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          isSelectionMode ? onToggleSelect() : onSelect();
        }
      }}
    >
      {/* Content with reserved space for the menu button */}
      <div className="flex items-center gap-1.5 pr-7">
        {isSelectionMode ? (
          <div className="shrink-0">
            <Checkbox
              checked={isSelected}
              className="h-4 w-4"
              aria-hidden
              tabIndex={-1}
            />
          </div>
        ) : (
          <MessageSquare
            className={cn(
              'h-4 w-4 shrink-0',
              isActive ? 'text-primary' : 'text-muted-foreground'
            )}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p
              className={cn(
                'line-clamp-2 text-sm leading-tight break-words',
                isActive ? 'font-medium text-foreground' : 'text-foreground/80'
              )}
            >
              {session.title}
            </p>
            {isArchived && (
              <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
                <Archive className="h-2.5 w-2.5" />
                {t('insights.archived')}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t('insights.messageCount', { count: session.messageCount })}
          </p>
        </div>
      </div>

      {/* Absolutely positioned menu button - hidden in selection mode */}
      {!isSelectionMode && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 hover:bg-muted-foreground/20 transition-opacity"
              aria-label={t('accessibility.moreOptionsAriaLabel')}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={5} className="w-36 z-[100]">
            <DropdownMenuItem onSelect={onStartEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              {t('accessibility.renameAriaLabel')}
            </DropdownMenuItem>
            {isArchived ? (
              onUnarchive && (
                <DropdownMenuItem onSelect={onUnarchive}>
                  <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                  {t('insights.unarchive')}
                </DropdownMenuItem>
              )
            ) : (
              onArchive && (
                <DropdownMenuItem onSelect={onArchive}>
                  <Archive className="mr-2 h-3.5 w-3.5" />
                  {t('insights.archive')}
                </DropdownMenuItem>
              )
            )}
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {t('accessibility.deleteAriaLabel')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
