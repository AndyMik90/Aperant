import { EventEmitter } from 'events';
import path from 'path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { execFileSync, spawn } from 'child_process';
import type {
  ReleaseableVersion,
  ReleasePreflightStatus,
  ReleasePreflightCheck,
  UnmergedWorktreeInfo,
  CreateReleaseRequest,
  CreateReleaseResult,
  ReleaseProgress,
  Task,
  TaskStatus
} from '../shared/types';
import { DEFAULT_CHANGELOG_PATH } from '../shared/constants';
import { getToolPath } from './cli-tool-manager';
import { refreshGitIndex } from './utils/git-isolation';

/**
 * Service for creating GitHub releases with worktree-aware pre-flight checks.
 *
 * Key feature: Worktree checks are SCOPED to tasks in the release version.
 * If a worktree exists for a task NOT in this release, it won't block the release.
 */
export class ReleaseService extends EventEmitter {

  /**
   * Parse CHANGELOG.md to extract releaseable versions.
   * Matches Keep-a-Changelog format: ## [x.y.z] - YYYY-MM-DD
   */
  parseChangelogVersions(projectPath: string): ReleaseableVersion[] {
    const changelogPath = path.join(projectPath, DEFAULT_CHANGELOG_PATH);

    if (!existsSync(changelogPath)) {
      return [];
    }

    const content = readFileSync(changelogPath, 'utf-8');
    const versions: ReleaseableVersion[] = [];

    // Match version headers: ## [1.2.3] - 2025-12-13
    const versionRegex = /^## \[(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\](?: - (\d{4}-\d{2}-\d{2}))?/gm;
    const matches = [...content.matchAll(versionRegex)];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const version = match[1];
      const date = match[2] || '';
      const startIndex = match.index! + match[0].length;

      // Content is until next version header or end of file
      const endIndex = i < matches.length - 1 ? matches[i + 1].index! : content.length;
      const versionContent = content.slice(startIndex, endIndex).trim();

      versions.push({
        version,
        tagName: `v${version}`,
        date,
        content: versionContent,
        taskSpecIds: [], // Will be populated by correlating with tasks
        isReleased: false, // Will be checked against GitHub
        releaseUrl: undefined
      });
    }

    return versions;
  }

  /**
   * Get tasks that were released in a specific version.
   * This allows us to scope worktree checks to only those tasks.
   */
  getTasksForVersion(
    _projectPath: string,
    version: string,
    tasks: Task[]
  ): { taskIds: string[]; specIds: string[] } {
    const taskIds: string[] = [];
    const specIds: string[] = [];

    for (const task of tasks) {
      if (task.releasedInVersion === version) {
        taskIds.push(task.id);
        specIds.push(task.specId);
      }
    }

    return { taskIds, specIds };
  }

  /**
   * Get releaseable versions with task information populated.
   */
  async getReleaseableVersions(
    projectPath: string,
    tasks: Task[]
  ): Promise<ReleaseableVersion[]> {
    const versions = this.parseChangelogVersions(projectPath);

    // Populate task spec IDs for each version
    for (const version of versions) {
      const { specIds } = this.getTasksForVersion(projectPath, version.version, tasks);
      version.taskSpecIds = specIds;

      // Check if already released on GitHub
      try {
        const tagExists = this.checkTagExists(projectPath, version.tagName);
        version.isReleased = tagExists;

        if (tagExists) {
          // Try to get release URL
          version.releaseUrl = this.getGitHubReleaseUrl(projectPath, version.tagName);
        }
      } catch {
        // If we can't check, assume not released
        version.isReleased = false;
      }
    }

    return versions;
  }

  /**
   * Check if a git tag exists (locally or remote).
   */
  private checkTagExists(projectPath: string, tagName: string): boolean {
    const git = getToolPath('git');
    try {
      // Check local tags
      const localTags = execFileSync(git, ['tag', '-l', tagName], {
        cwd: projectPath,
        encoding: 'utf-8'
      }).trim();

      if (localTags) return true;

      // Check remote tags
      try {
        const remoteTags = execFileSync(git, ['ls-remote', '--tags', 'origin', `refs/tags/${tagName}`], {
          cwd: projectPath,
          encoding: 'utf-8'
        }).trim();

        return !!remoteTags;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Get GitHub release URL for a tag (if release exists).
   */
  private getGitHubReleaseUrl(projectPath: string, tagName: string): string | undefined {
    const gh = getToolPath('gh');
    try {
      const result = execFileSync(gh, ['release', 'view', tagName, '--json', 'url', '-q', '.url'], {
        cwd: projectPath,
        encoding: 'utf-8'
      }).trim();

      return result || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Run pre-flight checks for a specific version.
   *
   * IMPORTANT: Worktree checks are scoped to tasks in this version only.
   * Worktrees for other tasks (future releases) won't block this release.
   */
  async runPreflightChecks(
    projectPath: string,
    version: string,
    tasks: Task[]
  ): Promise<ReleasePreflightStatus> {
    const tagName = `v${version}`;
    const { specIds } = this.getTasksForVersion(projectPath, version, tasks);

    const status: ReleasePreflightStatus = {
      canRelease: false,
      checks: {
        gitClean: { passed: false, message: '' },
        commitsPushed: { passed: false, message: '' },
        tagAvailable: { passed: false, message: '' },
        githubConnected: { passed: false, message: '' },
        worktreesMerged: { passed: false, message: '', unmergedWorktrees: [] }
      },
      blockers: []
    };

    // Check 1: Git working directory is clean
    try {
      refreshGitIndex(projectPath);

      const gitStatus = execFileSync(getToolPath('git'), ['status', '--porcelain'], {
        cwd: projectPath,
        encoding: 'utf-8'
      }).trim();

      if (!gitStatus) {
        status.checks.gitClean = {
          passed: true,
          message: 'Working directory is clean'
        };
      } else {
        const uncommittedFiles = gitStatus.split('\n').map(line => line.trim());
        status.checks.gitClean = {
          passed: false,
          message: `${uncommittedFiles.length} uncommitted change(s)`,
          uncommittedFiles
        };
        status.blockers.push(`Uncommitted changes: ${uncommittedFiles.length} file(s)`);
      }
    } catch {
      status.checks.gitClean = {
        passed: false,
        message: 'Failed to check git status'
      };
      status.blockers.push('Failed to check git status');
    }

    // Check 2: All commits are pushed
    try {
      let unpushed = '';
      try {
        unpushed = execFileSync(getToolPath('git'), ['log', '@{u}..HEAD', '--oneline'], {
          cwd: projectPath,
          encoding: 'utf-8'
        }).trim();
      } catch {
        // No upstream branch or other error - treat as empty
        unpushed = '';
      }

      if (!unpushed) {
        status.checks.commitsPushed = {
          passed: true,
          message: 'All commits pushed to remote'
        };
      } else {
        const unpushedCount = unpushed.split('\n').filter(Boolean).length;
        status.checks.commitsPushed = {
          passed: false,
          message: `${unpushedCount} unpushed commit(s)`,
          unpushedCount
        };
        status.blockers.push(`${unpushedCount} unpushed commit(s) - push before releasing`);
      }
    } catch {
      // No upstream branch - check if we have any commits at all
      status.checks.commitsPushed = {
        passed: false,
        message: 'No upstream branch configured'
      };
      status.blockers.push('No upstream branch - push to origin first');
    }

    // Check 3: Tag doesn't already exist
    const tagExists = this.checkTagExists(projectPath, tagName);
    if (!tagExists) {
      status.checks.tagAvailable = {
        passed: true,
        message: `Tag ${tagName} is available`
      };
    } else {
      status.checks.tagAvailable = {
        passed: false,
        message: `Tag ${tagName} already exists`
      };
      status.blockers.push(`Tag ${tagName} already exists - use a different version`);
    }

    // Check 4: GitHub CLI is available and authenticated
    try {
      execFileSync(getToolPath('gh'), ['auth', 'status'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      status.checks.githubConnected = {
        passed: true,
        message: 'GitHub CLI authenticated'
      };
    } catch {
      status.checks.githubConnected = {
        passed: false,
        message: 'GitHub CLI not authenticated'
      };
      status.blockers.push('GitHub CLI not authenticated - run `gh auth login`');
    }

    // Check 5: Worktrees for tasks IN THIS VERSION are merged
    // This is the key check that prevents releasing without code!
    const unmergedWorktrees = await this.checkWorktreesForVersion(
      projectPath,
      specIds,
      tasks
    );

    if (unmergedWorktrees.length === 0) {
      status.checks.worktreesMerged = {
        passed: true,
        message: specIds.length > 0
          ? `All ${specIds.length} feature(s) in this release are merged`
          : 'No features to check (version may have been manually added)',
        unmergedWorktrees: []
      };
    } else {
      status.checks.worktreesMerged = {
        passed: false,
        message: `${unmergedWorktrees.length} feature(s) have unmerged worktrees`,
        unmergedWorktrees
      };

      for (const wt of unmergedWorktrees) {
        status.blockers.push(
          `Feature "${wt.taskTitle}" (${wt.specId}) has unmerged changes in worktree`
        );
      }
    }

    // Determine if release can proceed
    status.canRelease = Object.values(status.checks).every((check: ReleasePreflightCheck) => check.passed);

    return status;
  }

  /**
   * Check worktrees ONLY for tasks that are part of this release version.
   *
   * This is the key function that scopes worktree checks to the release:
   * - If a task is in the release AND has an unmerged worktree → BLOCK
   * - If a task is NOT in the release but has a worktree → IGNORE (it's for a future release)
   */
  private async checkWorktreesForVersion(
    projectPath: string,
    releaseSpecIds: string[],
    tasks: Task[]
  ): Promise<UnmergedWorktreeInfo[]> {
    const unmerged: UnmergedWorktreeInfo[] = [];
    const worktreesDir = path.join(projectPath, '.auto-claude', 'worktrees', 'tasks');

    if (!existsSync(worktreesDir)) {
      return [];
    }

    let worktreeFolders: string[];
    try {
      worktreeFolders = readdirSync(worktreesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch {
      return [];
    }

    // Check each spec ID that's in this release
    for (const specId of releaseSpecIds) {
      // Find the worktree folder for this spec
      const matchingFolder = worktreeFolders.find(folder =>
        folder === specId || folder.startsWith(`${specId}-`)
      );

      if (!matchingFolder) {
        // No worktree for this spec - it's already merged/cleaned up
        continue;
      }

      const worktreePath = path.join(worktreesDir, matchingFolder);

      // Get the task info for better error messages
      const task = tasks.find(t => t.specId === specId);
      const taskTitle = task?.title || specId;
      const taskStatus = task?.status || 'done';

      // Check if this worktree's branch is merged to current branch
      const isMerged = await this.isWorktreeMerged(projectPath, worktreePath);

      if (!isMerged) {
        // Get branch name
        let branch = 'unknown';
        try {
          branch = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: worktreePath,
            encoding: 'utf-8'
          }).trim();
        } catch {
          // Use default
        }

        unmerged.push({
          specId,
          taskTitle,
          worktreePath,
          branch,
          taskStatus: taskStatus as TaskStatus
        });
      }
    }

    return unmerged;
  }

  /**
   * Check if a worktree's commits are merged to the main branch.
   */
  private async isWorktreeMerged(
    projectPath: string,
    worktreePath: string
  ): Promise<boolean> {
    try {
      // Get the current branch in the worktree
      const worktreeBranch = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: worktreePath,
        encoding: 'utf-8'
      }).trim();

      // Get the main branch
      let mainBranch: string;
      try {
        mainBranch = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'origin/HEAD'], {
          cwd: projectPath,
          encoding: 'utf-8'
        }).trim().replace('origin/', '');
      } catch {
        mainBranch = 'main';
      }

      // Check if worktree branch is fully merged into main
      // This returns empty if all commits are merged
      let unmergedCommits: string;
      try {
        unmergedCommits = execFileSync(getToolPath('git'), ['log', `${mainBranch}..${worktreeBranch}`, '--oneline'], {
          cwd: projectPath,
          encoding: 'utf-8'
        }).trim();
      } catch {
        unmergedCommits = 'error';
      }

      // If empty or error checking, assume merged for safety
      if (unmergedCommits === 'error') {
        refreshGitIndex(worktreePath);

        // Try alternative: check if worktree has any uncommitted changes
        const hasChanges = execFileSync(getToolPath('git'), ['status', '--porcelain'], {
          cwd: worktreePath,
          encoding: 'utf-8'
        }).trim();

        return !hasChanges;
      }

      return !unmergedCommits;
    } catch {
      // If we can't determine, assume NOT merged (safer)
      return false;
    }
  }

  /**
   * Bump version in package.json with safe git workflow.
   * Preserves user's current work by stashing, switching to main, then restoring.
   */
  async bumpVersion(
    projectPath: string,
    version: string,
    mainBranch: string,
    projectId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Save current state
    let originalBranch: string;
    let hadChanges = false;
    let stashCreated = false;

    try {
      originalBranch = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: projectPath,
        encoding: 'utf-8'
      }).trim();
    } catch {
      return { success: false, error: 'Failed to get current git branch' };
    }

    // Check for uncommitted changes
    refreshGitIndex(projectPath);

    const gitStatus = execFileSync(getToolPath('git'), ['status', '--porcelain'], {
      cwd: projectPath,
      encoding: 'utf-8'
    }).trim();
    hadChanges = !!gitStatus;

    try {
      // Stash any changes (staged or unstaged)
      if (hadChanges) {
        this.emitProgress(projectId, {
          stage: 'bumping_version',
          progress: 5,
          message: 'Stashing current changes...'
        });

        execFileSync(getToolPath('git'), ['stash', 'push', '-m', 'auto-claude-release-temp'], {
          cwd: projectPath,
          encoding: 'utf-8'
        });
        stashCreated = true;
      }

      // Checkout main branch
      this.emitProgress(projectId, {
        stage: 'bumping_version',
        progress: 10,
        message: `Switching to ${mainBranch}...`
      });

      if (originalBranch !== mainBranch) {
        execFileSync(getToolPath('git'), ['checkout', mainBranch], {
          cwd: projectPath,
          encoding: 'utf-8'
        });
      }

      // Pull latest from origin
      this.emitProgress(projectId, {
        stage: 'bumping_version',
        progress: 15,
        message: `Pulling latest from origin/${mainBranch}...`
      });

      try {
        execFileSync(getToolPath('git'), ['pull', 'origin', mainBranch], {
          cwd: projectPath,
          encoding: 'utf-8'
        });
      } catch {
        // Pull might fail if no upstream, continue anyway
      }

      // Update package.json
      this.emitProgress(projectId, {
        stage: 'bumping_version',
        progress: 20,
        message: `Updating package.json to ${version}...`
      });

      const pkgPath = path.join(projectPath, 'package.json');
      let pkgContent: string;
      try {
        pkgContent = readFileSync(pkgPath, 'utf-8');
      } catch (readErr: unknown) {
        if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('package.json not found in project root');
        }
        throw readErr;
      }
      const pkg = JSON.parse(pkgContent);
      pkg.version = version;

      // Preserve formatting (detect indent)
      const indent = pkgContent.match(/^(\s+)/m)?.[1] || '  ';
      writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + '\n', 'utf-8');

      // Stage and commit only package.json
      this.emitProgress(projectId, {
        stage: 'bumping_version',
        progress: 25,
        message: 'Committing version bump...'
      });

      execFileSync(getToolPath('git'), ['add', 'package.json'], {
        cwd: projectPath,
        encoding: 'utf-8'
      });

      execFileSync(getToolPath('git'), ['commit', '-m', `chore: release v${version}`], {
        cwd: projectPath,
        encoding: 'utf-8'
      });

      // Push to origin
      this.emitProgress(projectId, {
        stage: 'bumping_version',
        progress: 30,
        message: `Pushing to origin/${mainBranch}...`
      });

      execFileSync(getToolPath('git'), ['push', 'origin', mainBranch], {
        cwd: projectPath,
        encoding: 'utf-8'
      });

      return { success: true };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };

    } finally {
      // Always restore user's original state
      try {
        if (originalBranch !== mainBranch) {
          execFileSync(getToolPath('git'), ['checkout', originalBranch], {
            cwd: projectPath,
            encoding: 'utf-8'
          });
        }
      } catch {
        // Log but don't fail - user might need to manually switch back
        console.warn('[ReleaseService] Failed to restore original branch');
      }

      if (stashCreated) {
        try {
          execFileSync(getToolPath('git'), ['stash', 'pop'], {
            cwd: projectPath,
            encoding: 'utf-8'
          });
        } catch {
          // Stash conflict - warn user
          console.warn('[ReleaseService] Failed to pop stash - user may need to run "git stash pop" manually');
        }
      }
    }
  }

  /**
   * Create a GitHub release with optional version bump.
   */
  async createRelease(
    projectPath: string,
    request: CreateReleaseRequest
  ): Promise<CreateReleaseResult> {
    const tagName = `v${request.version}`;
    const title = request.title || tagName;
    const shouldBumpVersion = request.bumpVersion !== false; // Default to true

    try {
      // Stage 0: Bump version in package.json (if enabled)
      if (shouldBumpVersion && request.mainBranch) {
        const bumpResult = await this.bumpVersion(
          projectPath,
          request.version,
          request.mainBranch,
          request.projectId
        );

        if (!bumpResult.success) {
          this.emitProgress(request.projectId, {
            stage: 'error',
            progress: 0,
            message: `Version bump failed: ${bumpResult.error}`,
            error: bumpResult.error
          });
          return {
            success: false,
            error: `Version bump failed: ${bumpResult.error}`
          };
        }
      }

      // Stage 1: Create local tag
      this.emitProgress(request.projectId, {
        stage: 'tagging',
        progress: 40,
        message: `Creating tag ${tagName}...`
      });

      execFileSync(getToolPath('git'), ['tag', '-a', tagName, '-m', `Release ${tagName}`], {
        cwd: projectPath,
        encoding: 'utf-8'
      });

      // Stage 2: Push tag to remote
      this.emitProgress(request.projectId, {
        stage: 'pushing',
        progress: 60,
        message: `Pushing tag ${tagName} to origin...`
      });

      execFileSync(getToolPath('git'), ['push', 'origin', tagName], {
        cwd: projectPath,
        encoding: 'utf-8'
      });

      // Stage 3: Create GitHub release
      this.emitProgress(request.projectId, {
        stage: 'creating_release',
        progress: 80,
        message: 'Creating GitHub release...'
      });

      // Build gh release command
      const args = [
        'release', 'create', tagName,
        '--title', title,
        '--notes', request.body
      ];

      if (request.draft) {
        args.push('--draft');
      }
      if (request.prerelease) {
        args.push('--prerelease');
      }

      // Use spawn for better handling of the notes content
      const result = await new Promise<string>((resolve, reject) => {
        const child = spawn('gh', args, {
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString('utf-8');
        });

        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString('utf-8');
        });

        child.on('exit', (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(stderr || `gh exited with code ${code}`));
          }
        });

        child.on('error', reject);
      });

      // Get the release URL
      let releaseUrl = result;
      if (!releaseUrl.startsWith('http')) {
        // Try to fetch the URL
        try {
          releaseUrl = execFileSync(getToolPath('gh'), ['release', 'view', tagName, '--json', 'url', '-q', '.url'], {
            cwd: projectPath,
            encoding: 'utf-8'
          }).trim();
        } catch {
          releaseUrl = '';
        }
      }

      // Stage 4: Complete
      this.emitProgress(request.projectId, {
        stage: 'complete',
        progress: 100,
        message: `Release ${tagName} created successfully`
      });

      return {
        success: true,
        releaseUrl: releaseUrl || undefined,
        tagName
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Try to clean up the tag if it was created but release failed
      try {
        execFileSync(getToolPath('git'), ['tag', '-d', tagName], {
          cwd: projectPath,
          encoding: 'utf-8'
        });
      } catch {
        // Ignore cleanup errors
      }

      this.emitProgress(request.projectId, {
        stage: 'error',
        progress: 0,
        message: `Release failed: ${errorMessage}`,
        error: errorMessage
      });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Emit progress update.
   */
  private emitProgress(projectId: string, progress: ReleaseProgress): void {
    this.emit('release-progress', projectId, progress);
  }
}

// Export singleton instance
export const releaseService = new ReleaseService();
