/**
 * Hook for filtering and searching GitHub PRs
 */

import { useMemo, useState, useCallback } from 'react';
import type { PRData, PRReviewResult } from '../../../../preload/api/modules/github-api';
import type { NewCommitsCheck } from '../../../../preload/api/modules/github-api';

export type PRStatusFilter =
  | 'all'
  | 'reviewing'
  | 'not_reviewed'
  | 'reviewed'
  | 'posted'
  | 'changes_requested'
  | 'ready_to_merge'
  | 'ready_for_followup';

export type PRSortOption = 'newest' | 'oldest' | 'largest';

export interface PRFilterState {
  searchQuery: string;
  contributors: string[];
  statuses: PRStatusFilter[];
  sortBy: PRSortOption;
}

interface PRReviewInfo {
  isReviewing: boolean;
  result: PRReviewResult | null;
  newCommitsCheck?: NewCommitsCheck | null;
}

const DEFAULT_FILTERS: PRFilterState = {
  searchQuery: '',
  contributors: [],
  statuses: [],
  sortBy: 'newest',
};

/**
 * Determine the computed status of a PR based on its review state
 */
function getPRComputedStatus(
  reviewInfo: PRReviewInfo | null
): PRStatusFilter {
  // Check if currently reviewing (highest priority)
  if (reviewInfo?.isReviewing) {
    return 'reviewing';
  }

  if (!reviewInfo?.result) {
    return 'not_reviewed';
  }

  const result = reviewInfo.result;
  const hasPosted = Boolean(result.reviewId) || Boolean(result.hasPostedFindings);
  // Use overallStatus from review result as source of truth, fallback to severity check
  const hasBlockingFindings =
    result.overallStatus === 'request_changes' ||
    result.findings?.some(f => f.severity === 'critical' || f.severity === 'high');
  const hasNewCommits = reviewInfo.newCommitsCheck?.hasNewCommits;
  // Only count commits that happened AFTER findings were posted for follow-up status
  const hasCommitsAfterPosting = reviewInfo.newCommitsCheck?.hasCommitsAfterPosting;

  // Check for ready for follow-up first (highest priority after posting)
  // Must have new commits that happened AFTER findings were posted
  if (hasPosted && hasNewCommits && hasCommitsAfterPosting) {
    return 'ready_for_followup';
  }

  // Posted with blocking findings
  if (hasPosted && hasBlockingFindings) {
    return 'changes_requested';
  }

  // Posted without blocking findings
  if (hasPosted) {
    return 'ready_to_merge';
  }

  // Has review result but not posted yet
  return 'reviewed';
}

export function usePRFiltering(
  prs: PRData[],
  getReviewStateForPR: (prNumber: number) => PRReviewInfo | null
) {
  const [filters, setFiltersState] = useState<PRFilterState>(DEFAULT_FILTERS);

  // Derive unique contributors from PRs
  const contributors = useMemo(() => {
    const authorSet = new Set<string>();
    prs.forEach(pr => {
      if (pr.author?.login) {
        authorSet.add(pr.author.login);
      }
    });
    return Array.from(authorSet).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [prs]);

  // Filter and sort PRs based on current filters
  const filteredPRs = useMemo(() => {
    const filtered = prs.filter(pr => {
      // Search filter - matches title or body
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const matchesTitle = pr.title.toLowerCase().includes(query);
        const matchesBody = pr.body?.toLowerCase().includes(query);
        const matchesNumber = pr.number.toString().includes(query);
        if (!matchesTitle && !matchesBody && !matchesNumber) {
          return false;
        }
      }

      // Contributors filter (multi-select)
      if (filters.contributors.length > 0) {
        const authorLogin = pr.author?.login;
        if (!authorLogin || !filters.contributors.includes(authorLogin)) {
          return false;
        }
      }

      // Status filter (multi-select)
      if (filters.statuses.length > 0) {
        const reviewInfo = getReviewStateForPR(pr.number);
        const computedStatus = getPRComputedStatus(reviewInfo);

        // Check if PR matches any of the selected statuses
        const matchesStatus = filters.statuses.some(status => {
          // Special handling: 'posted' should match any posted state
          if (status === 'posted') {
            const hasPosted = reviewInfo?.result?.reviewId || reviewInfo?.result?.hasPostedFindings;
            return hasPosted;
          }
          return computedStatus === status;
        });

        if (!matchesStatus) {
          return false;
        }
      }

      return true;
    });

    // Pre-compute timestamps to avoid creating Date objects on every comparison
    const timestamps = new Map(
      filtered.map((pr) => [pr.number, new Date(pr.createdAt).getTime()])
    );

    // Sort the filtered results
    return filtered.sort((a, b) => {
      const aTime = timestamps.get(a.number)!;
      const bTime = timestamps.get(b.number)!;

      switch (filters.sortBy) {
        case 'newest':
          // Sort by createdAt descending (most recent first)
          return bTime - aTime;
        case 'oldest':
          // Sort by createdAt ascending (oldest first)
          return aTime - bTime;
        case 'largest': {
          // Sort by total changes (additions + deletions) descending
          const aChanges = (a.additions || 0) + (a.deletions || 0);
          const bChanges = (b.additions || 0) + (b.deletions || 0);
          if (bChanges !== aChanges) return bChanges - aChanges;
          // Secondary sort by createdAt (newest first) for stable ordering
          return bTime - aTime;
        }
        default:
          return 0;
      }
    });
  }, [prs, filters, getReviewStateForPR]);

  // Filter setters
  const setSearchQuery = useCallback((query: string) => {
    setFiltersState(prev => ({ ...prev, searchQuery: query }));
  }, []);

  const setContributors = useCallback((contributors: string[]) => {
    setFiltersState(prev => ({ ...prev, contributors }));
  }, []);

  const setStatuses = useCallback((statuses: PRStatusFilter[]) => {
    setFiltersState(prev => ({ ...prev, statuses }));
  }, []);

  const setSortBy = useCallback((sortBy: PRSortOption) => {
    setFiltersState(prev => ({ ...prev, sortBy }));
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState((prev) => ({
      ...DEFAULT_FILTERS,
      sortBy: prev.sortBy, // Preserve sort preference when clearing filters
    }));
  }, []);

  const hasActiveFilters = useMemo(() => {
    return (
      filters.searchQuery !== '' ||
      filters.contributors.length > 0 ||
      filters.statuses.length > 0
    );
  }, [filters]);

  return {
    filteredPRs,
    contributors,
    filters,
    setSearchQuery,
    setContributors,
    setStatuses,
    setSortBy,
    clearFilters,
    hasActiveFilters,
  };
}
