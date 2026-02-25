/**
 * GitHub issue-related IPC handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, GitHubIssue, PaginatedIssuesResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getGitHubConfig, githubFetch, normalizeRepoReference } from './utils';
import type { GitHubAPIIssue, GitHubAPIComment } from './types';
import { debugLog } from '../../../shared/utils/debug-logger';

// Pagination constants
const ISSUES_PER_PAGE = 50;           // Target number of issues per page (after filtering PRs)
const GITHUB_API_PER_PAGE = 100;      // GitHub API's max items per request
const MAX_PAGES_PAGINATED = 5;        // Max API pages to fetch in paginated mode
const MAX_PAGES_FETCH_ALL = 30;       // Max API pages to fetch in fetchAll mode

/**
 * Transform GitHub API issue to application format
 */
function transformIssue(issue: GitHubAPIIssue, repoFullName: string): GitHubIssue {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: issue.labels,
    assignees: issue.assignees.map(a => ({
      login: a.login,
      avatarUrl: a.avatar_url
    })),
    author: {
      login: issue.user.login,
      avatarUrl: issue.user.avatar_url
    },
    milestone: issue.milestone,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    commentsCount: issue.comments,
    url: issue.url,
    htmlUrl: issue.html_url,
    repoFullName
  };
}

/**
 * Get list of issues from repository with pagination support
 *
 * When page > 0: Returns paginated results (for infinite scroll)
 * When page = 0 or fetchAll = true: Returns ALL issues (for search functionality)
 *
 * Note: GitHub's /issues endpoint returns both issues and PRs mixed together,
 * so we need to over-fetch and filter to get enough actual issues per page.
 */
export function registerGetIssues(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_GET_ISSUES,
    async (
      _,
      projectId: string,
      state: 'open' | 'closed' | 'all' = 'open',
      page: number = 1,
      fetchAll: boolean = false
    ): Promise<IPCResult<PaginatedIssuesResult>> => {
      debugLog('[GitHub Issues] getIssues handler called', { projectId, state, page, fetchAll });

      const project = projectStore.getProject(projectId);
      if (!project) {
        debugLog('[GitHub Issues] Project not found:', projectId);
        return { success: false, error: 'Project not found' };
      }

      const config = getGitHubConfig(project);
      if (!config) {
        debugLog('[GitHub Issues] No GitHub config found for project');
        return { success: false, error: 'No GitHub token or repository configured' };
      }

      try {
        const normalizedRepo = normalizeRepoReference(config.repo);
        if (!normalizedRepo) {
          return {
            success: false,
            error: 'Invalid repository format. Use owner/repo or GitHub URL.'
          };
        }

        debugLog('[GitHub Issues] Fetching issues from:', normalizedRepo, 'state:', state);

        const maxPagesPerRequest = fetchAll ? MAX_PAGES_FETCH_ALL : MAX_PAGES_PAGINATED;

        if (fetchAll) {
          // Fetch ALL issues (for search functionality)
          const allIssues: GitHubAPIIssue[] = [];
          let apiPage = 1;

          while (apiPage <= MAX_PAGES_FETCH_ALL) {
            debugLog('[GitHub Issues] Fetching page', apiPage, '(fetchAll mode)');

            const pageIssues = await githubFetch(
              config.token,
              `/repos/${normalizedRepo}/issues?state=${state}&per_page=${GITHUB_API_PER_PAGE}&sort=updated&page=${apiPage}`
            );

            if (!Array.isArray(pageIssues) || pageIssues.length === 0) {
              break;
            }

            allIssues.push(...pageIssues);

            if (pageIssues.length < GITHUB_API_PER_PAGE) {
              break;
            }

            apiPage++;
          }

          const issuesOnly = allIssues.filter((issue: GitHubAPIIssue) => !issue.pull_request);
          const result: GitHubIssue[] = issuesOnly.map((issue: GitHubAPIIssue) =>
            transformIssue(issue, normalizedRepo)
          );

          debugLog('[GitHub Issues] fetchAll complete:', result.length, 'issues');
          return { success: true, data: { issues: result, hasMore: false } };
        }

        // Paginated fetching - collect enough actual issues for the requested page
        // Since GitHub mixes PRs with issues, we need to fetch multiple API pages
        // to accumulate enough actual issues
        const targetStartIndex = (page - 1) * ISSUES_PER_PAGE;
        const targetEndIndex = page * ISSUES_PER_PAGE;

        const collectedIssues: GitHubAPIIssue[] = [];
        let apiPage = 1;
        let hasMoreFromAPI = true;

        // Keep fetching until we have enough issues or run out of API pages
        while (collectedIssues.length < targetEndIndex && apiPage <= maxPagesPerRequest && hasMoreFromAPI) {
          debugLog('[GitHub Issues] Fetching API page', apiPage, 'collected so far:', collectedIssues.length);

          const pageItems = await githubFetch(
            config.token,
            `/repos/${normalizedRepo}/issues?state=${state}&per_page=${GITHUB_API_PER_PAGE}&sort=updated&page=${apiPage}`
          );

          if (!Array.isArray(pageItems)) {
            debugLog('[GitHub Issues] Unexpected response format:', typeof pageItems);
            break;
          }

          if (pageItems.length === 0) {
            hasMoreFromAPI = false;
            break;
          }

          // Filter out PRs and add to collected issues
          const issuesFromPage = pageItems.filter((issue: GitHubAPIIssue) => !issue.pull_request);
          collectedIssues.push(...issuesFromPage);

          debugLog('[GitHub Issues] API page', apiPage, ':', pageItems.length, 'items,', issuesFromPage.length, 'actual issues');

          if (pageItems.length < GITHUB_API_PER_PAGE) {
            hasMoreFromAPI = false;
          }

          apiPage++;
        }

        // Extract the issues for the requested page
        const pageIssues = collectedIssues.slice(targetStartIndex, targetEndIndex);

        // Improved hasMore calculation:
        // - If we collected more than the target end index, there's definitely more
        // - If we haven't exhausted the API (hasMoreFromAPI=true), there might be more
        // - BUT if we returned 0 issues for this page (pageIssues.length === 0),
        //   we've likely hit a situation where the repo has mostly PRs and we can't
        //   find enough issues within the fetch limit - signal no more to avoid
        //   infinite "load more" attempts
        let hasMore = hasMoreFromAPI || collectedIssues.length > targetEndIndex;

        // Edge case: If we returned empty results, don't claim there's more
        // This prevents infinite loading when repo has mostly PRs
        if (pageIssues.length === 0) {
          hasMore = false;
        }

        const result: GitHubIssue[] = pageIssues.map((issue: GitHubAPIIssue) =>
          transformIssue(issue, normalizedRepo)
        );

        debugLog('[GitHub Issues] Returning page', page, ':', result.length, 'issues, hasMore:', hasMore);
        return { success: true, data: { issues: result, hasMore } };
      } catch (error) {
        debugLog('[GitHub Issues] Error fetching issues:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch issues'
        };
      }
    }
  );
}

/**
 * Get a single issue by number
 */
export function registerGetIssue(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_GET_ISSUE,
    async (_, projectId: string, issueNumber: number): Promise<IPCResult<GitHubIssue>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = getGitHubConfig(project);
      if (!config) {
        return { success: false, error: 'No GitHub token or repository configured' };
      }

      try {
        const normalizedRepo = normalizeRepoReference(config.repo);
        if (!normalizedRepo) {
          return {
            success: false,
            error: 'Invalid repository format. Use owner/repo or GitHub URL.'
          };
        }

        const issue = await githubFetch(
          config.token,
          `/repos/${normalizedRepo}/issues/${issueNumber}`
        ) as GitHubAPIIssue;

        const result = transformIssue(issue, normalizedRepo);

        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch issue'
        };
      }
    }
  );
}

/**
 * Get comments for a specific issue
 */
export function registerGetIssueComments(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_GET_ISSUE_COMMENTS,
    async (_, projectId: string, issueNumber: number): Promise<IPCResult<GitHubAPIComment[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = getGitHubConfig(project);
      if (!config) {
        return { success: false, error: 'No GitHub token or repository configured' };
      }

      try {
        const normalizedRepo = normalizeRepoReference(config.repo);
        if (!normalizedRepo) {
          return {
            success: false,
            error: 'Invalid repository format. Use owner/repo or GitHub URL.'
          };
        }

        const comments = await githubFetch(
          config.token,
          `/repos/${normalizedRepo}/issues/${issueNumber}/comments`
        ) as GitHubAPIComment[];

        return { success: true, data: comments };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch issue comments'
        };
      }
    }
  );
}

/**
 * Register all issue-related handlers
 */
export function registerIssueHandlers(): void {
  registerGetIssues();
  registerGetIssue();
  registerGetIssueComments();
}
