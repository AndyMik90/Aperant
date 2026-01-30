/**
 * GitHub utility functions
 */

import { existsSync, readFileSync } from 'fs';
import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type { Project } from '../../../shared/types';
import { parseEnvFile } from '../utils';
import type { GitHubConfig } from './types';
import { getAugmentedEnv } from '../../env-utils';
import { getToolPath } from '../../cli-tool-manager';

const execFileAsync = promisify(execFile);

/**
 * Get GitHub token from gh CLI if available (async to avoid blocking main thread)
 * Uses augmented PATH to find gh CLI in common locations (e.g., Homebrew on macOS)
 */
async function getTokenFromGhCliAsync(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(getToolPath('gh'), ['auth', 'token'], {
      encoding: 'utf-8',
      env: getAugmentedEnv()
    });
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Get GitHub token from gh CLI if available (sync version for getGitHubConfig)
 * Uses augmented PATH to find gh CLI in common locations (e.g., Homebrew on macOS)
 */
function getTokenFromGhCliSync(): string | null {
  try {
    const token = execFileSync(getToolPath('gh'), ['auth', 'token'], {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: getAugmentedEnv()
    }).trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Get a fresh GitHub token for subprocess use (async to avoid blocking main thread)
 * Always fetches fresh from gh CLI - no caching to ensure account changes are reflected
 * @returns The current GitHub token or null if not authenticated
 */
export async function getGitHubTokenForSubprocess(): Promise<string | null> {
  return getTokenFromGhCliAsync();
}

/**
 * Get GitHub configuration from project environment file
 * Falls back to gh CLI token if GITHUB_TOKEN not in .env
 */
export function getGitHubConfig(project: Project): GitHubConfig | null {
  if (!project.autoBuildPath) return null;
  const envPath = path.join(project.path, project.autoBuildPath, '.env');
  if (!existsSync(envPath)) return null;

  try {
    const content = readFileSync(envPath, 'utf-8');
    const vars = parseEnvFile(content);
    let token: string | undefined = vars['GITHUB_TOKEN'];
    const repo = vars['GITHUB_REPO'];

    // If no token in .env, try to get it from gh CLI (sync version for sync function)
    if (!token) {
      const ghToken = getTokenFromGhCliSync();
      if (ghToken) {
        token = ghToken;
      }
    }

    if (!token || !repo) return null;
    return { token, repo };
  } catch {
    return null;
  }
}

/**
 * Normalize a GitHub repository reference to owner/repo format
 * Handles:
 * - owner/repo (already normalized)
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 */
export function normalizeRepoReference(repo: string): string {
  if (!repo) return '';

  // Remove trailing .git if present
  let normalized = repo.replace(/\.git$/, '');

  // Handle full GitHub URLs
  if (normalized.startsWith('https://github.com/')) {
    normalized = normalized.replace('https://github.com/', '');
  } else if (normalized.startsWith('http://github.com/')) {
    normalized = normalized.replace('http://github.com/', '');
  } else if (normalized.startsWith('git@github.com:')) {
    normalized = normalized.replace('git@github.com:', '');
  }

  return normalized.trim();
}

/**
 * Make a request to the GitHub API
 */
export async function githubFetch(
  token: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://api.github.com${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Auto-Claude-UI',
      ...options.headers
    }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  return response.json();
}
