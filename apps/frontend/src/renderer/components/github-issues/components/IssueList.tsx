import { useRef, useEffect, useCallback, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { ScrollArea } from '../../ui/scroll-area';
import { IssueListItem } from './IssueListItem';
import { EmptyState } from './EmptyStates';
import type { IssueListProps } from '../types';
import { useTranslation } from 'react-i18next';

export function IssueList({
  issues,
  selectedIssueNumber,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  onSelectIssue,
  onInvestigate,
  onLoadMore
}: IssueListProps) {
  const { t } = useTranslation('common');
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);

  // Intersection Observer for infinite scroll
  const handleIntersection = useCallback((entries: IntersectionObserverEntry[]) => {
    const [entry] = entries;
    if (entry.isIntersecting && hasMore && !isLoadingMore && !isLoading && onLoadMore) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, isLoading, onLoadMore]);

  useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    if (!trigger || !onLoadMore || !viewportElement) return;

    const observer = new IntersectionObserver(handleIntersection, {
      root: viewportElement,
      rootMargin: '100px',
      threshold: 0
    });

    observer.observe(trigger);

    return () => {
      observer.disconnect();
    };
  }, [handleIntersection, onLoadMore, viewportElement]);

  // Only show blocking error view when no issues are loaded
  // Load-more errors are shown inline near the load-more trigger
  if (error && issues.length === 0) {
    return (
      <div className="p-4 bg-destructive/10 border-b border-destructive/30">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      </div>
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
    return <EmptyState message="No issues found" />;
  }

  return (
    <ScrollArea className="flex-1" onViewportRef={setViewportElement}>
      <div className="p-2 space-y-1">
        {issues.map((issue) => (
          <IssueListItem
            key={issue.id}
            issue={issue}
            isSelected={selectedIssueNumber === issue.number}
            onClick={() => onSelectIssue(issue.number)}
            onInvestigate={() => onInvestigate(issue)}
          />
        ))}

        {/* Load more trigger / Loading indicator */}
        {onLoadMore && (
          <div ref={loadMoreTriggerRef} className="py-4 flex flex-col items-center gap-2">
            {/* Inline error for load-more failures (when issues are already loaded) */}
            {error && issues.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
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
      </div>
    </ScrollArea>
  );
}
