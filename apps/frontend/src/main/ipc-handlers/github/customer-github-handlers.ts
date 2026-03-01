/**
 * Multi-repo GitHub Issues handlers for Customer projects.
 *
 * A Customer project aggregates issues from multiple child repositories.
 * The GitHub token comes from the customer's own .env while each child
 * repository supplies its own GITHUB_REPO value.
 */

import { ipcMain } from 'electron';
import { existsSync, readFileSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

/** Cross-platform child path check using path.relative */
function isChildPath(parentPath: string, candidatePath: string): boolean {
  const rel = path.relative(parentPath, candidatePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, GitHubIssue, MultiRepoGitHubStatus, MultiRepoIssuesResult, MultiRepoPRsResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getGitHubConfig, githubFetch, normalizeRepoReference } from './utils';
import { getToolPath } from '../../cli-tool-manager';
import type { GitHubAPIIssue } from './types';
import { transformIssue } from './issue-handlers';
import { parseEnvFile } from '../utils';
import { debugLog } from '../../../shared/utils/debug-logger';

// ────────────────────────────────────────────────────────────────────────────
// Shared helper
// ────────────────────────────────────────────────────────────────────────────

interface CustomerRepo {
  projectId: string;
  repoFullName: string;
}

interface CustomerGitHubConfig {
  token: string;
  repos: CustomerRepo[];
}

/**
 * Resolve the GitHub token and child-repo list for a Customer project.
 *
 * Token resolution order:
 *   1. GITHUB_TOKEN from the customer's .env
 *   2. Fallback to `getGitHubConfig(customer)?.token` (which also tries `gh` CLI)
 *
 * Each child repo's GITHUB_REPO is read from its own .env via `getGitHubConfig`.
 */
async function getCustomerGitHubConfig(customerId: string): Promise<CustomerGitHubConfig | null> {
  const customer = projectStore.getProject(customerId);
  if (!customer) {
    debugLog('[Customer GitHub] Customer project not found:', customerId);
    return null;
  }

  if (customer.type !== 'customer') {
    debugLog('[Customer GitHub] Project is not a customer:', customerId);
    return null;
  }

  // 1. Resolve token from customer's .env
  let token: string | undefined;

  if (customer.autoBuildPath) {
    const envPath = path.join(customer.path, customer.autoBuildPath, '.env');
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf-8');
        const vars = parseEnvFile(content);
        token = vars['GITHUB_TOKEN'];
      } catch {
        // ignore read errors, fall through to fallback
      }
    }
  }

  // Fallback: try getGitHubConfig which also checks gh CLI
  if (!token) {
    const fallbackConfig = getGitHubConfig(customer);
    token = fallbackConfig?.token;
  }

  if (!token) {
    debugLog('[Customer GitHub] No GitHub token found for customer:', customerId);
    return null;
  }

  // 2. Discover child repos
  const allProjects = projectStore.getProjects();
  const childProjects = allProjects.filter(
    (p) => p.id !== customer.id && isChildPath(customer.path, p.path)
  );

  const repos: CustomerRepo[] = [];

  for (const child of childProjects) {
    // Try .env first (if child has autoBuildPath and GITHUB_REPO configured)
    const childConfig = getGitHubConfig(child);
    if (childConfig?.repo) {
      const normalized = normalizeRepoReference(childConfig.repo);
      if (normalized) {
        repos.push({ projectId: child.id, repoFullName: normalized });
        continue;
      }
    }

    // Fallback: detect from git remote origin (cloned repos have this)
    try {
      const { stdout } = await execFileAsync(getToolPath('git'), ['remote', 'get-url', 'origin'], {
        encoding: 'utf-8',
        cwd: child.path,
        timeout: 5000,
      });
      const remoteUrl = stdout.trim();

      const match = remoteUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
      if (match) {
        const repoFullName = match[1];
        debugLog('[Customer GitHub] Detected repo from git remote:', repoFullName, 'for', child.path);
        repos.push({ projectId: child.id, repoFullName });
      }
    } catch {
      debugLog('[Customer GitHub] Could not detect git remote for child:', child.path);
    }
  }

  debugLog('[Customer GitHub] Resolved config:', {
    customerId,
    hasToken: !!token,
    repoCount: repos.length,
  });

  return { token, repos };
}

// ────────────────────────────────────────────────────────────────────────────
// Handler 1: Check multi-repo connection
// ────────────────────────────────────────────────────────────────────────────

function registerCheckMultiRepoConnection(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_CHECK_MULTI_REPO_CONNECTION,
    async (_, customerId: string): Promise<IPCResult<MultiRepoGitHubStatus>> => {
      debugLog('[Customer GitHub] checkMultiRepoConnection called', { customerId });

      const config = await getCustomerGitHubConfig(customerId);
      if (!config) {
        return {
          success: true,
          data: {
            connected: false,
            repos: [],
            error: 'No GitHub token configured for this customer',
          },
        };
      }

      return {
        success: true,
        data: {
          connected: true,
          repos: config.repos,
        },
      };
    }
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Handler 2: Get issues across all child repos
// ────────────────────────────────────────────────────────────────────────────

function registerGetMultiRepoIssues(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_GET_MULTI_REPO_ISSUES,
    async (
      _,
      customerId: string,
      state: 'open' | 'closed' | 'all' = 'open',
      page: number = 1
    ): Promise<IPCResult<MultiRepoIssuesResult>> => {
      debugLog('[Customer GitHub] getMultiRepoIssues called', { customerId, state, page });

      const config = await getCustomerGitHubConfig(customerId);
      if (!config) {
        return { success: false, error: 'No GitHub configuration found for this customer' };
      }

      if (config.repos.length === 0) {
        return {
          success: true,
          data: { issues: [], repos: [], hasMore: false },
        };
      }

      try {
        const allRepoNames = config.repos.map((r) => r.repoFullName);

        // Fetch issues from all repos in parallel
        const settledResults = await Promise.allSettled(
          config.repos.map(async (repo) => {
            const endpoint = `/repos/${repo.repoFullName}/issues?state=${state}&per_page=50&sort=updated&page=${page}`;
            const data = await githubFetch(config.token, endpoint);
            return { repoFullName: repo.repoFullName, data };
          })
        );

        const allIssues: GitHubIssue[] = [];
        const perPage = 50;
        let anyRepoHasMore = false;

        for (const result of settledResults) {
          if (result.status === 'fulfilled') {
            const { repoFullName, data } = result.value;
            if (Array.isArray(data)) {
              if (data.length === perPage) {
                anyRepoHasMore = true;
              }
              const issuesOnly = (data as GitHubAPIIssue[]).filter(
                (item) => !item.pull_request
              );
              const transformed = issuesOnly.map((issue) =>
                transformIssue(issue, repoFullName)
              );
              allIssues.push(...transformed);
            }
          } else {
            debugLog('[Customer GitHub] Failed to fetch from repo:', result.reason);
          }
        }

        // Sort by updatedAt descending
        allIssues.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        debugLog('[Customer GitHub] Returning', allIssues.length, 'issues from', allRepoNames.length, 'repos');

        return {
          success: true,
          data: {
            issues: allIssues,
            repos: allRepoNames,
            hasMore: anyRepoHasMore,
          },
        };
      } catch (error) {
        debugLog('[Customer GitHub] Error fetching multi-repo issues:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch multi-repo issues',
        };
      }
    }
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Handler 3: Get single issue detail from a specific repo
// ────────────────────────────────────────────────────────────────────────────

function registerGetMultiRepoIssueDetail(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_GET_MULTI_REPO_ISSUE_DETAIL,
    async (
      _,
      customerId: string,
      repoFullName: string,
      issueNumber: number
    ): Promise<IPCResult<GitHubIssue>> => {
      debugLog('[Customer GitHub] getMultiRepoIssueDetail called', {
        customerId,
        repoFullName,
        issueNumber,
      });

      const config = await getCustomerGitHubConfig(customerId);
      if (!config) {
        return { success: false, error: 'No GitHub configuration found for this customer' };
      }

      // Validate that the requested repo belongs to this customer's configured repos
      const isValidRepo = config.repos.some(r => r.repoFullName === repoFullName);
      if (!isValidRepo) {
        return { success: false, error: `Repository ${repoFullName} is not configured for this customer` };
      }

      try {
        const issue = (await githubFetch(
          config.token,
          `/repos/${repoFullName}/issues/${issueNumber}`
        )) as GitHubAPIIssue;

        const result = transformIssue(issue, repoFullName);

        return { success: true, data: result };
      } catch (error) {
        debugLog('[Customer GitHub] Error fetching issue detail:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch issue detail',
        };
      }
    }
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Handler 4: Get PRs across all child repos
// ────────────────────────────────────────────────────────────────────────────

function registerGetMultiRepoPRs(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_GET_MULTI_REPO_PRS,
    async (_, customerId: string): Promise<IPCResult<MultiRepoPRsResult>> => {
      debugLog('[Customer GitHub] getMultiRepoPRs called', { customerId });

      const config = await getCustomerGitHubConfig(customerId);
      if (!config) {
        return { success: false, error: 'No GitHub configuration found for this customer' };
      }

      if (config.repos.length === 0) {
        return {
          success: true,
          data: { prs: [], repos: [] },
        };
      }

      try {
        const allRepoNames = config.repos.map((r) => r.repoFullName);

        // Fetch open PRs from all repos in parallel
        const settledResults = await Promise.allSettled(
          config.repos.map(async (repo) => {
            const endpoint = `/repos/${repo.repoFullName}/pulls?state=open&sort=updated&direction=desc&per_page=50`;
            const data = await githubFetch(config.token, endpoint);
            return { repoFullName: repo.repoFullName, data };
          })
        );

        const allPRs: MultiRepoPRsResult['prs'] = [];

        for (const result of settledResults) {
          if (result.status === 'fulfilled') {
            const { repoFullName, data } = result.value;
            if (Array.isArray(data)) {
              // TODO: Add a typed interface (e.g. GitHubAPIPullRequest) for the GitHub PR API response shape
              // biome-ignore lint/suspicious/noExplicitAny: GitHub REST API response shape
              const transformed = (data as any[]).map((pr) => ({
                number: pr.number,
                title: pr.title,
                body: pr.body || '',
                state: pr.state.toLowerCase(),
                author: { login: pr.user.login },
                headRefName: pr.head.ref,
                baseRefName: pr.base.ref,
                additions: pr.additions ?? 0,
                deletions: pr.deletions ?? 0,
                changedFiles: pr.changed_files ?? 0,
                // biome-ignore lint/suspicious/noExplicitAny: GitHub REST API assignee shape
                assignees: (pr.assignees || []).map((a: any) => ({ login: a.login })),
                createdAt: pr.created_at,
                updatedAt: pr.updated_at,
                htmlUrl: pr.html_url,
                repoFullName,
              }));
              allPRs.push(...transformed);
            }
          } else {
            debugLog('[Customer GitHub] Failed to fetch PRs from repo:', result.reason);
          }
        }

        // Sort by updatedAt descending
        allPRs.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        debugLog('[Customer GitHub] Returning', allPRs.length, 'PRs from', allRepoNames.length, 'repos');

        return {
          success: true,
          data: {
            prs: allPRs,
            repos: allRepoNames,
          },
        };
      } catch (error) {
        debugLog('[Customer GitHub] Error fetching multi-repo PRs:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch multi-repo PRs',
        };
      }
    }
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Public registration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Register all Customer multi-repo GitHub IPC handlers
 */
export function registerCustomerGitHubHandlers(): void {
  registerCheckMultiRepoConnection();
  registerGetMultiRepoIssues();
  registerGetMultiRepoIssueDetail();
  registerGetMultiRepoPRs();
}
