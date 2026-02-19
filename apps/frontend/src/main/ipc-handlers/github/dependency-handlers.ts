/**
 * Dependency IPC handlers for Phase 4.
 * Fetches issue dependency data via GitHub GraphQL API (read-only).
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { withProject } from './utils/project-middleware';
import { createContextLogger } from './utils/logger';
import { IPC_CHANNELS } from '../../../shared/constants/ipc';
import type { IssueDependency, IssueDependencies } from '../../../shared/types/dependencies';
import { getGitHubConfig, githubFetch, normalizeRepoReference } from './utils';

const logger = createContextLogger('Dependencies');

const DEPS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      trackedIssues(first: 20) {
        nodes {
          number
          title
          state
          repository { nameWithOwner }
        }
      }
      trackedInIssues(first: 20) {
        nodes {
          number
          title
          state
          repository { nameWithOwner }
        }
      }
    }
  }
}`;

interface GraphQLIssueNode {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  repository?: { nameWithOwner: string };
}

function mapNode(node: GraphQLIssueNode, ownerRepo: string): IssueDependency {
  const dep: IssueDependency = {
    issueNumber: node.number,
    title: node.title,
    state: node.state === 'OPEN' ? 'open' : 'closed',
  };
  if (node.repository && node.repository.nameWithOwner !== ownerRepo) {
    dep.repo = node.repository.nameWithOwner;
  }
  return dep;
}

export function registerDependencyHandlers(
  _getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_DEPS_FETCH,
    async (_, projectId: string, issueNumber: number) => {
      if (!issueNumber || issueNumber < 1) {
        return { error: 'Invalid issue number', tracks: [], trackedBy: [] };
      }

      return withProject(projectId, async (project) => {
        try {
          const config = getGitHubConfig(project);
          if (!config) {
            return { error: 'GitHub token/repository not configured', tracks: [], trackedBy: [] };
          }

          const normalizedRepo = normalizeRepoReference(config.repo);
          const [owner, repo] = normalizedRepo.split('/');
          if (!owner || !repo) {
            return { error: 'Invalid repository format. Use owner/repo or GitHub URL.', tracks: [], trackedBy: [] };
          }

          const parsed = await githubFetch(
            config.token,
            'https://api.github.com/graphql',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: DEPS_QUERY,
                variables: {
                  owner,
                  repo,
                  number: issueNumber,
                },
              }),
            },
          ) as {
            data: {
              repository: {
                issue: {
                  trackedIssues: { nodes: GraphQLIssueNode[] };
                  trackedInIssues: { nodes: GraphQLIssueNode[] };
                } | null;
              } | null;
            };
            errors?: Array<{ message?: string }>;
          };

          if (parsed.errors?.length) {
            const message = parsed.errors.map((e) => e.message).filter(Boolean).join('; ');
            if (message.includes('does not exist') || message.includes('not found')) {
              return { error: message || 'GraphQL query failed', unavailable: true, tracks: [], trackedBy: [] };
            }
            return { error: message || 'GraphQL query failed', tracks: [], trackedBy: [] };
          }

          const issue = parsed.data.repository?.issue;
          if (!issue) {
            return { error: 'Issue not found in repository', tracks: [], trackedBy: [] };
          }

          const ownerRepo = `${owner}/${repo}`;

          const deps: IssueDependencies = {
            tracks: issue.trackedIssues.nodes.map((n) => mapNode(n, ownerRepo)),
            trackedBy: issue.trackedInIssues.nodes.map((n) => mapNode(n, ownerRepo)),
          };

          logger.debug('Fetched dependencies', { issueNumber, tracks: deps.tracks.length, trackedBy: deps.trackedBy.length });
          return deps;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';

          // Detect GraphQL field unavailability
          if (message.includes('does not exist') || message.includes('not found')) {
            return { error: message, unavailable: true, tracks: [], trackedBy: [] };
          }

          return { error: message, tracks: [], trackedBy: [] };
        }
      });
    },
  );
}
