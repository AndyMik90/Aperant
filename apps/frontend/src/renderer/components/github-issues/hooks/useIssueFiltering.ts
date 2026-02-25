import { useState, useMemo, useCallback, useEffect } from 'react';
import type { GitHubIssue } from '../../../../shared/types';
import { filterIssuesBySearch } from '../utils';

interface UseIssueFilteringOptions {
  onSearchStart?: () => void;
  onSearchClear?: () => void;
}

export function useIssueFiltering(
  issues: GitHubIssue[],
  options: UseIssueFilteringOptions = {}
) {
  const { onSearchStart, onSearchClear } = options;
  const [searchQuery, setSearchQuery] = useState('');

  const filteredIssues = useMemo(() => {
    return filterIssuesBySearch(issues, searchQuery);
  }, [issues, searchQuery]);

  // Notify when search becomes active or inactive
  useEffect(() => {
    if (searchQuery.length > 0) {
      onSearchStart?.();
    } else {
      onSearchClear?.();
    }
  }, [searchQuery, onSearchStart, onSearchClear]);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const isSearchActive = searchQuery.length > 0;

  return {
    searchQuery,
    setSearchQuery: handleSearchChange,
    filteredIssues,
    isSearchActive
  };
}
