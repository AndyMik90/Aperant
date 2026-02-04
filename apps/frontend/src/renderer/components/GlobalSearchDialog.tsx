/**
 * GlobalSearchDialog - Search across tasks, ideas, and files
 *
 * SUG-8: Global Search
 * Opens with Cmd+P to search across all content types.
 * Results grouped by type with navigation to selected item.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, FileText, ListTodo, Lightbulb, ArrowRight, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
} from './ui/dialog';
import { useTaskStore } from '../stores/task-store';
import { useNavigation } from '../contexts/NavigationContext';
import { cn } from '../lib/utils';
import type { Task } from '../../shared/types';

interface SearchResult {
  id: string;
  type: 'task' | 'idea' | 'file';
  title: string;
  description?: string;
  status?: string;
}

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onTaskSelect?: (taskId: string) => void;
  onIdeaSelect?: (ideaId: string) => void;
}

export function GlobalSearchDialog({
  open,
  onOpenChange,
  projectId,
  onTaskSelect,
  onIdeaSelect
}: GlobalSearchDialogProps) {
  const { t } = useTranslation(['tasks', 'common', 'navigation']);
  const { setActiveView } = useNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  // Get tasks from store
  const tasks = useTaskStore((state) => state.tasks);

  // Filter and search results
  const results = useMemo(() => {
    if (!query.trim()) return [];

    const searchQuery = query.toLowerCase();
    const matchedResults: SearchResult[] = [];

    // Search tasks
    tasks.forEach((task) => {
      const titleMatch = task.title.toLowerCase().includes(searchQuery);
      const descMatch = task.description?.toLowerCase().includes(searchQuery);

      if (titleMatch || descMatch) {
        matchedResults.push({
          id: task.id,
          type: 'task',
          title: task.title,
          description: task.description?.slice(0, 100),
          status: task.status
        });
      }
    });

    // TODO: Add ideas search when ideation store is accessible
    // TODO: Add files search using project file index

    return matchedResults.slice(0, 10); // Limit results
  }, [query, tasks]);

  // Group results by type
  const groupedResults = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {
      task: [],
      idea: [],
      file: []
    };

    results.forEach((result) => {
      groups[result.type].push(result);
    });

    return groups;
  }, [results]);

  // Flatten for keyboard navigation
  const flatResults = useMemo(() => {
    return [...groupedResults.task, ...groupedResults.idea, ...groupedResults.file];
  }, [groupedResults]);

  // Focus input when dialog opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [open]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const handleSelect = useCallback((result: SearchResult) => {
    onOpenChange(false);

    switch (result.type) {
      case 'task':
        setActiveView('kanban');
        onTaskSelect?.(result.id);
        break;
      case 'idea':
        setActiveView('discovery');
        onIdeaSelect?.(result.id);
        break;
      case 'file':
        // Navigate to context view for file
        setActiveView('context');
        break;
    }
  }, [onOpenChange, setActiveView, onTaskSelect, onIdeaSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatResults[selectedIndex]) {
        handleSelect(flatResults[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    }
  }, [flatResults, selectedIndex, handleSelect, onOpenChange]);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'task':
        return <ListTodo className="h-4 w-4 text-primary" />;
      case 'idea':
        return <Lightbulb className="h-4 w-4 text-yellow-500" />;
      case 'file':
        return <FileText className="h-4 w-4 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'task':
        return t('globalSearch.typeLabels.tasks', { defaultValue: 'Tasks' });
      case 'idea':
        return t('globalSearch.typeLabels.ideas', { defaultValue: 'Ideas' });
      case 'file':
        return t('globalSearch.typeLabels.files', { defaultValue: 'Files' });
      default:
        return type;
    }
  };

  let flatIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden max-h-[80vh]">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className={cn(
              'flex-1 bg-transparent border-none outline-none text-sm',
              'placeholder:text-muted-foreground/60'
            )}
            placeholder={t('globalSearch.placeholder', { defaultValue: "Search tasks, ideas, files..." })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {isSearching && (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          )}
        </div>

        {/* Results */}
        <div className="overflow-y-auto max-h-[400px]">
          {query.trim() && flatResults.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              {t('globalSearch.noResults', { defaultValue: "No results found" })}
            </div>
          ) : (
            <>
              {/* Tasks */}
              {groupedResults.task.length > 0 && (
                <div className="py-2">
                  <div className="px-4 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {getTypeLabel('task')}
                  </div>
                  {groupedResults.task.map((result) => {
                    const currentIndex = flatIndex++;
                    return (
                      <button
                        key={result.id}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted/50 transition-colors',
                          currentIndex === selectedIndex && 'bg-muted'
                        )}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setSelectedIndex(currentIndex)}
                      >
                        {getTypeIcon(result.type)}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{result.title}</div>
                          {result.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {result.description}
                            </div>
                          )}
                        </div>
                        {result.status && (
                          <span className="text-xs text-muted-foreground capitalize px-2 py-0.5 bg-muted rounded">
                            {result.status}
                          </span>
                        )}
                        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Ideas */}
              {groupedResults.idea.length > 0 && (
                <div className="py-2 border-t border-border">
                  <div className="px-4 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {getTypeLabel('idea')}
                  </div>
                  {groupedResults.idea.map((result) => {
                    const currentIndex = flatIndex++;
                    return (
                      <button
                        key={result.id}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted/50 transition-colors',
                          currentIndex === selectedIndex && 'bg-muted'
                        )}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setSelectedIndex(currentIndex)}
                      >
                        {getTypeIcon(result.type)}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{result.title}</div>
                          {result.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {result.description}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Files */}
              {groupedResults.file.length > 0 && (
                <div className="py-2 border-t border-border">
                  <div className="px-4 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {getTypeLabel('file')}
                  </div>
                  {groupedResults.file.map((result) => {
                    const currentIndex = flatIndex++;
                    return (
                      <button
                        key={result.id}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted/50 transition-colors',
                          currentIndex === selectedIndex && 'bg-muted'
                        )}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setSelectedIndex(currentIndex)}
                      >
                        {getTypeIcon(result.type)}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{result.title}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 bg-muted/30 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border">↑</kbd>
              <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border">↓</kbd>
              {t('globalSearch.navigateHint', { defaultValue: "navigate" })}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border">↵</kbd>
              {t('globalSearch.selectHint', { defaultValue: "select" })}
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border">esc</kbd>
            {t('globalSearch.closeHint', { defaultValue: "close" })}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
