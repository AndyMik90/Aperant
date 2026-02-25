/**
 * GitHub release creation IPC handlers
 */

import { ipcMain } from 'electron';
import { execSync, execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, GitCommit, VersionSuggestion } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { changelogService } from '../../changelog-service';
import type { ReleaseOptions } from './types';
import { getToolPath } from '../../cli-tool-manager';
import { getWhichCommand } from '../../platform';

/**
 * Check if gh CLI is installed
 */
function checkGhCli(): { installed: boolean; error?: string } {
  try {
    execFileSync(getWhichCommand(), ['gh'], { encoding: 'utf-8', stdio: 'pipe' });
    return { installed: true };
  } catch {
    return {
      installed: false,
      error: 'GitHub CLI (gh) not found. Please install it: https://cli.github.com/'
    };
  }
}

/**
 * Check if user is authenticated with gh CLI
 */
function checkGhAuth(projectPath: string): { authenticated: boolean; error?: string } {
  try {
    execFileSync(getToolPath('gh'), ['auth', 'status'], { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
    return { authenticated: true };
  } catch {
    return {
      authenticated: false,
      error: 'Not authenticated with GitHub. Run "gh auth login" in terminal first.'
    };
  }
}

/**
 * Build gh release command arguments
 */
function buildReleaseArgs(version: string, releaseNotes: string, options?: ReleaseOptions): string[] {
  const tag = version.startsWith('v') ? version : `v${version}`;
  const args = ['release', 'create', tag, '--title', tag, '--notes', releaseNotes];

  if (options?.draft) {
    args.push('--draft');
  }
  if (options?.prerelease) {
    args.push('--prerelease');
  }

  return args;
}

/**
 * Create a GitHub release using gh CLI
 */
export function registerCreateRelease(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_CREATE_RELEASE,
    async (
      _,
      projectId: string,
      version: string,
      releaseNotes: string,
      options?: ReleaseOptions
    ): Promise<IPCResult<{ url: string }>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // Check if gh CLI is available
      const cliCheck = checkGhCli();
      if (!cliCheck.installed) {
        return { success: false, error: cliCheck.error };
      }

      // Check if user is authenticated
      const authCheck = checkGhAuth(project.path);
      if (!authCheck.authenticated) {
        return { success: false, error: authCheck.error };
      }

      try {
        // Build and execute release command
        const args = buildReleaseArgs(version, releaseNotes, options);
        const command = `gh ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`;

        const output = execSync(command, {
          cwd: project.path,
          encoding: 'utf-8',
          stdio: 'pipe'
        }).trim();

        // Output is typically the release URL
        const tag = version.startsWith('v') ? version : `v${version}`;
        const releaseUrl = output || `https://github.com/releases/tag/${tag}`;

        return {
          success: true,
          data: { url: releaseUrl }
        };
      } catch (error) {
        // Extract error message from stderr if available
        const errorMsg = error instanceof Error ? error.message : 'Failed to create release';
        if (error && typeof error === 'object' && 'stderr' in error) {
          return { success: false, error: String(error.stderr) || errorMsg };
        }
        return { success: false, error: errorMsg };
      }
    }
  );
}

/**
 * Get the latest git tag in the repository
 */
function getLatestTag(projectPath: string): string | null {
  try {
    const tag = execFileSync(getToolPath('git'), ['describe', '--tags', '--abbrev=0'], {
      cwd: projectPath,
      encoding: 'utf-8'
    }).trim();
    return tag || null;
  } catch {
    return null;
  }
}

/**
 * Get commits since a specific tag (or all commits if no tag)
 */
function getCommitsSinceTag(projectPath: string, tag: string | null): GitCommit[] {
  try {
    const range = tag ? `${tag}..HEAD` : 'HEAD';
    const format = '%H|%s|%an|%ae|%aI';
    const output = execFileSync(getToolPath('git'), ['log', range, `--pretty=format:${format}`], {
      cwd: projectPath,
      encoding: 'utf-8'
    }).trim();

    if (!output) return [];

    return output.split('\n').map(line => {
      const [fullHash, subject, authorName, authorEmail, date] = line.split('|');
      return {
        hash: fullHash.substring(0, 7),
        fullHash,
        subject,
        author: authorName,
        authorEmail,
        date
      };
    });
  } catch {
    return [];
  }
}

/**
 * Get current version from package.json
 */
function getCurrentVersion(projectPath: string): string {
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    if (!existsSync(pkgPath)) {
      return '0.0.0';
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Suggest version for release using AI analysis of commits
 */
export function registerSuggestVersion(): void {
  ipcMain.handle(
    IPC_CHANNELS.RELEASE_SUGGEST_VERSION,
    async (_, projectId: string): Promise<IPCResult<VersionSuggestion>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        // Get current version from package.json
        const currentVersion = getCurrentVersion(project.path);

        // Get latest tag
        const latestTag = getLatestTag(project.path);

        // Get commits since last tag
        const commits = getCommitsSinceTag(project.path, latestTag);

        if (commits.length === 0) {
          // No commits since last release, suggest patch bump
          const [major, minor, patch] = currentVersion.split('.').map(Number);
          return {
            success: true,
            data: {
              suggestedVersion: `${major}.${minor}.${patch + 1}`,
              currentVersion,
              bumpType: 'patch',
              reason: 'No new commits since last release',
              commitCount: 0
            }
          };
        }

        // Use AI to analyze commits and suggest version
        const suggestion = await changelogService.suggestVersionFromCommits(
          project.path,
          commits,
          currentVersion
        );

        return {
          success: true,
          data: {
            suggestedVersion: suggestion.version,
            currentVersion,
            bumpType: suggestion.reason.includes('breaking') ? 'major' :
                      suggestion.reason.includes('feature') || suggestion.reason.includes('minor') ? 'minor' : 'patch',
            reason: suggestion.reason,
            commitCount: commits.length
          }
        };
      } catch (_error) {
        // Fallback to patch bump on error
        const currentVersion = getCurrentVersion(project.path);
        const [major, minor, patch] = currentVersion.split('.').map(Number);

        return {
          success: true,
          data: {
            suggestedVersion: `${major}.${minor}.${patch + 1}`,
            currentVersion,
            bumpType: 'patch',
            reason: 'Fallback suggestion (AI analysis unavailable)',
            commitCount: 0
          }
        };
      }
    }
  );
}

/**
 * Register all release-related handlers
 */
export function registerReleaseHandlers(): void {
  registerCreateRelease();
  registerSuggestVersion();
}
