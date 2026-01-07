import type { GitLabIssue } from '../../../../shared/types';

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function filterIssuesBySearch(issues: GitLabIssue[], searchQuery: string): GitLabIssue[] {
  if (!searchQuery) {
    return issues;
  }

  const query = searchQuery.toLowerCase();
  return issues.filter(issue =>
    issue.title.toLowerCase().includes(query) ||
    issue.description?.toLowerCase().includes(query)
  );
}
