import { useState, useMemo, useCallback, useEffect } from 'react';
import type { LinearIssue } from '../../../../shared/types';

interface UseIssueFilteringOptions {
  onSearchStart?: () => void;
  onSearchClear?: () => void;
}

function filterIssuesBySearch(issues: LinearIssue[], query: string): LinearIssue[] {
  if (!query.trim()) return issues;

  const lowerQuery = query.toLowerCase().trim();
  return issues.filter(issue => {
    const matchesTitle = issue.title.toLowerCase().includes(lowerQuery);
    const matchesIdentifier = issue.identifier.toLowerCase().includes(lowerQuery);
    const matchesDescription = issue.description?.toLowerCase().includes(lowerQuery) ?? false;
    return matchesTitle || matchesIdentifier || matchesDescription;
  });
}

export function useIssueFiltering(
  issues: LinearIssue[],
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
    isSearchActive,
  };
}
