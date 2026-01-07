import type { GitHubIssue } from '../../../../shared/types';

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function filterIssuesBySearch(issues: GitHubIssue[], searchQuery: string): GitHubIssue[] {
  if (!searchQuery) {
    return issues;
  }

  const query = searchQuery.toLowerCase();
  return issues.filter(issue =>
    issue.title.toLowerCase().includes(query) ||
    issue.body?.toLowerCase().includes(query)
  );
}
