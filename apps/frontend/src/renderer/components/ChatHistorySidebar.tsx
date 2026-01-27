import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  MessageSquare,
  Trash2,
  Pencil,
  Check,
  X,
  MoreVertical,
  Loader2
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
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
}

export function ChatHistorySidebar({
  sessions,
  currentSessionId,
  isLoading,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onRenameSession
}: ChatHistorySidebarProps) {
  const { t } = useTranslation(['common', 'insights']);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);

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

  const formatDate = (date: Date) => {
    const now = new Date();
    const d = new Date(date);
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return t('insights:chatHistory.today');
    } else if (diffDays === 1) {
      return t('insights:chatHistory.yesterday');
    } else if (diffDays < 7) {
      return t('insights:chatHistory.daysAgo', { count: diffDays });
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

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <h3 className="text-sm font-medium text-foreground">{t('insights:chatHistory.title')}</h3>
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

      {/* Session list */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {t('insights:chatHistory.noConversations')}
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
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteSessionId} onOpenChange={() => setDeleteSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('insights:chatHistory.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('insights:chatHistory.deleteDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('insights:chatHistory.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t('insights:chatHistory.deleteDialog.confirm')}</AlertDialogAction>
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
  onDelete
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
      className={cn(
        'group relative cursor-pointer px-2 py-2 transition-colors hover:bg-muted',
        isActive && 'bg-primary/10 hover:bg-primary/15'
      )}
      onClick={onSelect}
    >
      {/* Content with reserved space for the menu button */}
      <div className="flex items-center gap-1.5 pr-7">
        <MessageSquare
          className={cn(
            'h-4 w-4 shrink-0',
            isActive ? 'text-primary' : 'text-muted-foreground'
          )}
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'line-clamp-2 text-sm leading-tight break-words',
              isActive ? 'font-medium text-foreground' : 'text-foreground/80'
            )}
          >
            {session.title}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t('insights:chatHistory.message', { count: session.messageCount })}
          </p>
        </div>
      </div>

      {/* Absolutely positioned menu button - always visible */}
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
            {t('insights:chatHistory.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            {t('insights:chatHistory.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
