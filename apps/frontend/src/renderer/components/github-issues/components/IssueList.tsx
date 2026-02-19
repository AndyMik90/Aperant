import { useRef, useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, AlertCircle } from 'lucide-react';
import { ScrollArea } from '../../ui/scroll-area';
import { IssueListItem } from './IssueListItem';
import { EmptyState } from './EmptyStates';
import { GitHubErrorDisplay } from './GitHubErrorDisplay';
import type { IssueListProps } from '../types';
import { useTranslation } from 'react-i18next';

const ITEM_GAP = 4;
const ITEM_HEIGHT_NORMAL = 56 + ITEM_GAP;
const ITEM_HEIGHT_COMPACT = 56 + ITEM_GAP;

export function IssueList({
  issues,
  selectedIssueNumber,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  onSelectIssue,
  onInvestigate,
  onLoadMore,
  onRetry,
  onOpenSettings,
  selectedIssueNumbers,
  onToggleSelect,
  compact,
  investigationStates,
  onViewTask,
}: IssueListProps) {
  const { t } = useTranslation('common');
  const loadingMoreRef = useRef(false);
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);

  const itemHeight = compact ? ITEM_HEIGHT_COMPACT : ITEM_HEIGHT_NORMAL;

  const virtualizer = useVirtualizer({
    count: issues.length,
    getScrollElement: () => viewportElement,
    estimateSize: () => itemHeight,
    overscan: 5,
  });

  // Trigger load-more when the user scrolls near the bottom of the virtual list
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore || isLoading || loadingMoreRef.current) return;
    if (virtualItems.length === 0) return;

    const lastVirtualItem = virtualItems[virtualItems.length - 1];
    if (lastVirtualItem && lastVirtualItem.index >= issues.length - 5) {
      loadingMoreRef.current = true;
      onLoadMore();
    }
  }, [virtualItems, onLoadMore, hasMore, isLoadingMore, isLoading, issues.length]);

  // Reset the ref guard when isLoadingMore goes back to false
  useEffect(() => { if (!isLoadingMore) loadingMoreRef.current = false; }, [isLoadingMore]);

  // Only show blocking error view when no issues are loaded
  // Load-more errors are shown inline near the load-more trigger
  if (error && issues.length === 0) {
    return (
      <GitHubErrorDisplay
        error={error}
        onRetry={onRetry}
        onOpenSettings={onOpenSettings}
        className="flex-1"
      />
    );
  }

  if (isLoading && issues.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (issues.length === 0) {
    return <EmptyState message={t('issues.noIssues', 'No issues found')} />;
  }

  return (
    <ScrollArea className="flex-1" onViewportRef={setViewportElement}>
      <div
        role="listbox"
        aria-label={t('issues.listLabel')}
        className="p-2"
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualItems.map((virtualRow) => {
          const issue = issues[virtualRow.index];
          const invState = investigationStates?.[String(issue.number)];
          return (
            <div
              key={issue.id}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: `${ITEM_GAP}px`,
              }}
            >
              <IssueListItem
                issue={issue}
                isSelected={selectedIssueNumber === issue.number}
                onClick={() => onSelectIssue(issue.number)}
                onInvestigate={() => onInvestigate(issue)}
                isSelectable={!!onToggleSelect}
                isChecked={selectedIssueNumbers?.has(issue.number) ?? false}
                onToggleSelect={onToggleSelect ? () => onToggleSelect(issue.number) : undefined}
                compact={compact}
                investigationState={invState?.state}
                investigationProgress={invState?.progress}
                linkedTaskId={invState?.linkedTaskId}
                onViewTask={onViewTask}
                isStale={invState?.isStale}
              />
            </div>
          );
        })}
      </div>

      {/* Inline error for load-more failures */}
      {error && issues.length > 0 && (
        <div className="p-3 mx-2 bg-destructive/10 rounded-md">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        </div>
      )}
      {onLoadMore && (
        <div className="py-4 flex flex-col items-center gap-2">
          {isLoadingMore ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{t('issues.loadingMore', 'Loading more...')}</span>
            </div>
          ) : hasMore ? (
            <span className="text-xs text-muted-foreground opacity-50">
              {t('issues.scrollForMore', 'Scroll for more')}
            </span>
          ) : issues.length > 0 ? (
            <span className="text-xs text-muted-foreground opacity-50">
              {t('issues.allLoaded', 'All issues loaded')}
            </span>
          ) : null}
        </div>
      )}
    </ScrollArea>
  );
}
