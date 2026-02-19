/**
 * Hook for filtering and sorting GitHub issues in the left panel list.
 * Mirrors usePRFiltering from the PRs panel.
 */

import { useMemo, useState, useCallback } from 'react';
import type { GitHubIssue } from '@shared/types';
import type { IssueFilterState, IssueStatusFilter, IssueSortOption } from '../types';

const DEFAULT_FILTERS: IssueFilterState = {
  searchQuery: '',
  reporters: [],
  statuses: ['open'],
  sortBy: 'newest',
};

interface IndexedIssue {
  issue: GitHubIssue;
  createdAtMs: number;
  titleLower: string;
  bodyLower: string;
  issueNumberString: string;
  authorLogin: string;
}

export function useIssueListFiltering(issues: GitHubIssue[]) {
  const [filters, setFiltersState] = useState<IssueFilterState>(DEFAULT_FILTERS);

  // Precompute expensive per-issue values once per issues update.
  const indexedIssues = useMemo<IndexedIssue[]>(() => {
    return issues.map((issue) => ({
      issue,
      createdAtMs: Date.parse(issue.createdAt),
      titleLower: issue.title.toLowerCase(),
      bodyLower: issue.body?.toLowerCase() ?? '',
      issueNumberString: issue.number.toString(),
      authorLogin: issue.author?.login ?? '',
    }));
  }, [issues]);

  // Derive unique reporters (authors) from issue data
  const reporters = useMemo(() => {
    const authorSet = new Set<string>();
    for (const indexed of indexedIssues) {
      if (indexed.authorLogin) {
        authorSet.add(indexed.authorLogin);
      }
    }
    return Array.from(authorSet).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [indexedIssues]);

  // Filter and sort issues - memoized to avoid recomputation
  const filteredIssues = useMemo(() => {
    // Apply status filter first (this is the most common filter)
    const statusFiltered = indexedIssues.filter(({ issue }) => {
      if (filters.statuses.length === 0) return true;
      return filters.statuses.includes(issue.state as IssueStatusFilter);
    });

    // Early return if no other filters active
    if (
      !filters.searchQuery &&
      filters.reporters.length === 0 &&
      filters.sortBy === 'newest'
    ) {
      // Just apply sorting
      return statusFiltered
        .slice()
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .map((indexed) => indexed.issue);
    }

    const filtered = statusFiltered.filter((indexed) => {
      // Search filter - matches title, body, and issue number
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const matchesTitle = indexed.titleLower.includes(query);
        const matchesBody = indexed.bodyLower.includes(query);
        const matchesNumber = indexed.issueNumberString.includes(query);
        if (!matchesTitle && !matchesBody && !matchesNumber) {
          return false;
        }
      }

      // Reporter filter (multi-select)
      if (filters.reporters.length > 0) {
        const authorLogin = indexed.authorLogin;
        if (!authorLogin || !filters.reporters.includes(authorLogin)) {
          return false;
        }
      }

      return true;
    });

    // Sort with stable timestamp cache
    return filtered
      .sort((a, b) => {
        switch (filters.sortBy) {
          case 'newest':
            return b.createdAtMs - a.createdAtMs;
          case 'oldest':
            return a.createdAtMs - b.createdAtMs;
          case 'most_commented': {
            const diff = (b.issue.commentsCount || 0) - (a.issue.commentsCount || 0);
            if (diff !== 0) return diff;
            return b.createdAtMs - a.createdAtMs;
          }
          default:
            return 0;
        }
      })
      .map((indexed) => indexed.issue);
  }, [indexedIssues, filters]);

  const setSearchQuery = useCallback((query: string) => {
    setFiltersState((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  const setReporters = useCallback((reporters: string[]) => {
    setFiltersState((prev) => ({ ...prev, reporters }));
  }, []);

  const setStatuses = useCallback((statuses: IssueStatusFilter[]) => {
    setFiltersState((prev) => ({ ...prev, statuses }));
  }, []);

  const setSortBy = useCallback((sortBy: IssueSortOption) => {
    setFiltersState((prev) => ({ ...prev, sortBy }));
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState((prev) => ({
      ...DEFAULT_FILTERS,
      sortBy: prev.sortBy,
    }));
  }, []);

  const hasActiveFilters = useMemo(() => {
    // Compare against defaults - status 'open' is the default, not an active filter
    const statusChanged =
      filters.statuses.length !== DEFAULT_FILTERS.statuses.length ||
      filters.statuses.some((s, i) => s !== DEFAULT_FILTERS.statuses[i]);
    return (
      filters.searchQuery !== '' ||
      filters.reporters.length > 0 ||
      statusChanged
    );
  }, [filters]);

  return {
    filteredIssues,
    reporters,
    filters,
    setSearchQuery,
    setReporters,
    setStatuses,
    setSortBy,
    clearFilters,
    hasActiveFilters,
  };
}
