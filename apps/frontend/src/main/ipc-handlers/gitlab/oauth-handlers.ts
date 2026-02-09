/**
 * GitLab OAuth handlers using GitLab CLI (glab)
 * Provides OAuth flow similar to GitHub's gh CLI
 */

import { ipcMain, shell } from 'electron';
import { execFileSync, spawn } from 'child_process';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { getAugmentedEnv, findExecutable } from '../../env-utils';
import { getIsolatedGitEnv } from '../../utils/git-isolation';
import { openTerminalWithCommand } from '../claude-code-handlers';
import type { GitLabAuthStartResult } from './types';

const DEFAULT_GITLAB_URL = 'https://gitlab.com';

// Debug logging helper - requires BOTH development mode AND DEBUG flag for OAuth handlers
// This is intentionally more restrictive than other handlers to prevent accidental token logging
const DEBUG = process.env.NODE_ENV === 'development' && process.env.DEBUG === 'true';

/**
 * Redact sensitive information from data before logging
 */
function redactSensitiveData(data: unknown): unknown {
  if (typeof data === 'string') {
    // Redact anything that looks like a token (glpat-*, private token patterns)
    return data.replace(/glpat-[A-Za-z0-9_-]+/g, 'glpat-[REDACTED]')
               .replace(/private[_-]?token[=:]\s*["']?[A-Za-z0-9_-]+["']?/gi, 'private_token=[REDACTED]');
  }
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      return data.map(redactSensitiveData);
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      // Redact known sensitive keys
      if (/token|password|secret|credential|auth/i.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitiveData(value);
      }
    }
    return result;
  }
  return data;
}

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[GitLab OAuth] ${message}`, redactSensitiveData(data));
    } else {
      console.debug(`[GitLab OAuth] ${message}`);
    }
  }
}

// Regex pattern to validate GitLab project format (group/project or group/subgroup/project)
const GITLAB_PROJECT_PATTERN = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/;

/**
 * Validate that a project string matches the expected format
 */
function isValidGitLabProject(project: string): boolean {
  // Allow numeric IDs
  if (/^\d+$/.test(project)) return true;
  return GITLAB_PROJECT_PATTERN.test(project);
}

/**
 * Extract hostname from instance URL
 */
function getHostnameFromUrl(instanceUrl: string): string {
  try {
    return new URL(instanceUrl).hostname;
  } catch {
    return 'gitlab.com';
  }
}

/**
 * Check if glab CLI is installed
 */
export function registerCheckGlabCli(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_CHECK_CLI,
    async (): Promise<IPCResult<{ installed: boolean; version?: string }>> => {
      debugLog('checkGitLabCli handler called');
      try {
        const glabPath = findExecutable('glab');
        if (!glabPath) {
          debugLog('glab CLI not found in PATH or common locations');
          return {
            success: true,
            data: { installed: false }
          };
        }
        debugLog('glab CLI found at:', glabPath);

        const versionOutput = execFileSync('glab', ['--version'], {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: getAugmentedEnv()
        });
        const version = versionOutput.trim().split('\n')[0];
        debugLog('glab version:', version);

        return {
          success: true,
          data: { installed: true, version }
        };
      } catch (error) {
        debugLog('glab CLI not found or error:', error instanceof Error ? error.message : error);
        return {
          success: true,
          data: { installed: false }
        };
      }
    }
  );
}

/**
 * Install glab CLI by opening a terminal with the appropriate install command
 * Uses the user's preferred terminal from settings
 */
export function registerInstallGlabCli(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_INSTALL_CLI,
    async (): Promise<IPCResult<{ command: string }>> => {
      debugLog('installGitLabCli handler called');
      try {
        const platform = process.platform;
        let command: string;

        if (platform === 'darwin') {
          // macOS: Use Homebrew
          command = 'brew install glab';
        } else if (platform === 'win32') {
          // Windows: Use winget
          command = 'winget install --id GitLab.glab';
        } else {
          // Linux: Try snap first, then homebrew
          command = 'sudo snap install glab || brew install glab';
        }

        debugLog('Install command:', command);
        debugLog('Opening terminal...');
        await openTerminalWithCommand(command);
        debugLog('Terminal opened successfully');

        return {
          success: true,
          data: { command }
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        debugLog('Install failed:', errorMsg);
        return {
          success: false,
          error: `Failed to open terminal for installation: ${errorMsg}`
        };
      }
    }
  );
}

/**
 * Check if user is authenticated with glab CLI
 */
export function registerCheckGlabAuth(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_CHECK_AUTH,
    async (_event, instanceUrl?: string): Promise<IPCResult<{ authenticated: boolean; username?: string }>> => {
      debugLog('checkGitLabAuth handler called', { instanceUrl });
      const env = getAugmentedEnv();
      const hostname = instanceUrl ? getHostnameFromUrl(instanceUrl) : 'gitlab.com';

      try {
        // Check auth status for the specific host
        const args = ['auth', 'status'];
        if (hostname !== 'gitlab.com') {
          args.push('--hostname', hostname);
        }

        debugLog('Running: glab', args);
        execFileSync('glab', args, { encoding: 'utf-8', stdio: 'pipe', env });

        // Get username if authenticated
        try {
          const userArgs = ['api', 'user', '--jq', '.username'];
          if (hostname !== 'gitlab.com') {
            userArgs.push('--hostname', hostname);
          }
          const username = execFileSync('glab', userArgs, {
            encoding: 'utf-8',
            stdio: 'pipe',
            env
          }).trim();
          debugLog('Username:', username);

          return {
            success: true,
            data: { authenticated: true, username }
          };
        } catch {
          return {
            success: true,
            data: { authenticated: true }
          };
        }
      } catch (error) {
        debugLog('Auth check failed:', error instanceof Error ? error.message : error);
        return {
          success: true,
          data: { authenticated: false }
        };
      }
    }
  );
}

/**
 * Start GitLab OAuth flow using glab CLI
 */
export function registerStartGlabAuth(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_START_AUTH,
    async (_event, instanceUrl?: string): Promise<IPCResult<GitLabAuthStartResult>> => {
      debugLog('startGitLabAuth handler called', { instanceUrl });
      const hostname = instanceUrl ? getHostnameFromUrl(instanceUrl) : 'gitlab.com';
      const deviceUrl = instanceUrl
        ? `${instanceUrl.replace(/\/$/, '')}/-/profile/personal_access_tokens`
        : 'https://gitlab.com/-/profile/personal_access_tokens';

      return new Promise((resolve) => {
        try {
          // glab auth login with web flow
          const args = ['auth', 'login', '--web'];
          if (hostname !== 'gitlab.com') {
            args.push('--hostname', hostname);
          }

          debugLog('Spawning: glab', args);

          const glabProcess = spawn('glab', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: getAugmentedEnv()
          });

          let _output = '';
          let errorOutput = '';
          let browserOpened = false;

          glabProcess.stdout?.on('data', (data) => {
            const chunk = data.toString('utf-8');
            _output += chunk;
            debugLog('glab stdout:', chunk);

            // Try to open browser if URL detected
            const urlMatch = chunk.match(/https?:\/\/[^\s]+/);
            if (urlMatch && !browserOpened) {
              browserOpened = true;
              shell.openExternal(urlMatch[0]).catch((err) => {
                debugLog('Failed to open browser:', err);
              });
            }
          });

          glabProcess.stderr?.on('data', (data) => {
            const chunk = data.toString('utf-8');
            errorOutput += chunk;
            debugLog('glab stderr:', chunk);
          });

          glabProcess.on('close', (code) => {
            debugLog('glab process exited with code:', code);

            if (code === 0) {
              resolve({
                success: true,
                data: {
                  deviceCode: '',
                  verificationUrl: deviceUrl,
                  userCode: ''
                }
              });
            } else {
              resolve({
                success: false,
                error: errorOutput || `Authentication failed with exit code ${code}`,
                data: {
                  deviceCode: '',
                  verificationUrl: deviceUrl,
                  userCode: ''
                }
              });
            }
          });

          glabProcess.on('error', (error) => {
            debugLog('glab process error:', error.message);
            resolve({
              success: false,
              error: error.message,
              data: {
                deviceCode: '',
                verificationUrl: deviceUrl,
                userCode: ''
              }
            });
          });
        } catch (error) {
          debugLog('Exception in startGitLabAuth:', error instanceof Error ? error.message : error);
          resolve({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: {
              deviceCode: '',
              verificationUrl: deviceUrl,
              userCode: ''
            }
          });
        }
      });
    }
  );
}

/**
 * Get the current GitLab auth token from glab CLI
 */
export function registerGetGlabToken(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_GET_TOKEN,
    async (_event, instanceUrl?: string): Promise<IPCResult<{ token: string }>> => {
      debugLog('getGitLabToken handler called', { instanceUrl });
      const hostname = instanceUrl ? getHostnameFromUrl(instanceUrl) : 'gitlab.com';

      try {
        const args = ['auth', 'token'];
        if (hostname !== 'gitlab.com') {
          args.push('--hostname', hostname);
        }

        const token = execFileSync('glab', args, {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: getAugmentedEnv()
        }).trim();

        if (!token) {
          return {
            success: false,
            error: 'No token found. Please authenticate first.'
          };
        }

        return {
          success: true,
          data: { token }
        };
      } catch (error) {
        debugLog('Failed to get token:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get token'
        };
      }
    }
  );
}

/**
 * Get the authenticated GitLab user info
 */
export function registerGetGlabUser(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_GET_USER,
    async (_event, instanceUrl?: string): Promise<IPCResult<{ username: string; name?: string }>> => {
      debugLog('getGitLabUser handler called', { instanceUrl });
      const hostname = instanceUrl ? getHostnameFromUrl(instanceUrl) : 'gitlab.com';

      try {
        const args = ['api', 'user'];
        if (hostname !== 'gitlab.com') {
          args.push('--hostname', hostname);
        }

        const userJson = execFileSync('glab', args, {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: getAugmentedEnv()
        });

        const user = JSON.parse(userJson);
        debugLog('Parsed user:', { username: user.username, name: user.name });

        return {
          success: true,
          data: {
            username: user.username,
            name: user.name
          }
        };
      } catch (error) {
        debugLog('Failed to get user info:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get user info'
        };
      }
    }
  );
}

/**
 * List projects accessible to the authenticated user
 */
export function registerListUserProjects(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_LIST_USER_PROJECTS,
    async (_event, instanceUrl?: string): Promise<IPCResult<{ projects: Array<{ pathWithNamespace: string; description: string | null; visibility: string }> }>> => {
      debugLog('listUserProjects handler called', { instanceUrl });
      const hostname = instanceUrl ? getHostnameFromUrl(instanceUrl) : 'gitlab.com';

      try {
        const args = ['repo', 'list', '--mine', '-F', 'json'];
        if (hostname !== 'gitlab.com') {
          args.push('--hostname', hostname);
        }

        const output = execFileSync('glab', args, {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: getAugmentedEnv()
        });

        const projects = JSON.parse(output);
        debugLog('Found projects:', projects.length);

        const formattedProjects = projects.map((p: { path_with_namespace: string; description: string | null; visibility: string }) => ({
          pathWithNamespace: p.path_with_namespace,
          description: p.description,
          visibility: p.visibility
        }));

        return {
          success: true,
          data: { projects: formattedProjects }
        };
      } catch (error) {
        debugLog('Failed to list projects:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list projects'
        };
      }
    }
  );
}

/**
 * Detect GitLab project from git remote origin
 */
export function registerDetectGitLabProject(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_DETECT_PROJECT,
    async (_event, projectPath: string): Promise<IPCResult<{ project: string; instanceUrl: string }>> => {
      debugLog('detectGitLabProject handler called', { projectPath });
      try {
        const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
          encoding: 'utf-8',
          cwd: projectPath,
          stdio: 'pipe',
          env: getIsolatedGitEnv()
        }).trim();

        debugLog('Remote URL:', remoteUrl);

        // Parse GitLab project from URL
        // SSH: git@gitlab.example.com:group/project.git
        // HTTPS: https://gitlab.example.com/group/project.git
        let instanceUrl = DEFAULT_GITLAB_URL;
        let project = '';

        const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
        if (sshMatch) {
          instanceUrl = `https://${sshMatch[1]}`;
          project = sshMatch[2];
        }

        const httpsMatch = remoteUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
        if (httpsMatch) {
          instanceUrl = `https://${httpsMatch[1]}`;
          project = httpsMatch[2];
        }

        if (project) {
          debugLog('Detected project:', { project, instanceUrl });
          return {
            success: true,
            data: { project, instanceUrl }
          };
        }

        return {
          success: false,
          error: 'Could not parse GitLab project from remote URL'
        };
      } catch (error) {
        debugLog('Failed to detect project:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to detect GitLab project'
        };
      }
    }
  );
}

/**
 * Get branches from GitLab project
 */
export function registerGetGitLabBranches(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_GET_BRANCHES,
    async (_event, project: string, instanceUrl: string): Promise<IPCResult<string[]>> => {
      debugLog('getGitLabBranches handler called', { project, instanceUrl });

      if (!isValidGitLabProject(project)) {
        return {
          success: false,
          error: 'Invalid project format'
        };
      }

      const hostname = getHostnameFromUrl(instanceUrl);
      const encodedProject = encodeURIComponent(project);

      try {
        const args = ['api', `projects/${encodedProject}/repository/branches`, '--paginate', '--jq', '.[].name'];
        if (hostname !== 'gitlab.com') {
          args.push('--hostname', hostname);
        }

        const output = execFileSync('glab', args, {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: getAugmentedEnv()
        });

        const branches = output.trim().split('\n').filter(b => b.length > 0);
        debugLog('Found branches:', branches.length);

        return {
          success: true,
          data: branches
        };
      } catch (error) {
        debugLog('Failed to get branches:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get branches'
        };
      }
    }
  );
}

/**
 * Create a new GitLab project
 */
export function registerCreateGitLabProject(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_CREATE_PROJECT,
    async (
      _event,
      projectName: string,
      options: { description?: string; visibility?: string; projectPath: string; namespace?: string; instanceUrl?: string }
    ): Promise<IPCResult<{ pathWithNamespace: string; webUrl: string }>> => {
      debugLog('createGitLabProject handler called', { projectName, options });

      if (!/^[A-Za-z0-9_.-]+$/.test(projectName)) {
        return {
          success: false,
          error: 'Invalid project name'
        };
      }

      const hostname = options.instanceUrl ? getHostnameFromUrl(options.instanceUrl) : 'gitlab.com';

      try {
        const args = ['repo', 'create', projectName, '--source', options.projectPath];

        if (options.visibility) {
          args.push('--visibility', options.visibility);
        } else {
          args.push('--visibility', 'private');
        }

        if (options.description) {
          args.push('--description', options.description);
        }

        if (options.namespace) {
          args.push('--group', options.namespace);
        }

        if (hostname !== 'gitlab.com') {
          args.push('--hostname', hostname);
        }

        debugLog('Running: glab', args);
        const output = execFileSync('glab', args, {
          encoding: 'utf-8',
          cwd: options.projectPath,
          stdio: 'pipe',
          env: getAugmentedEnv()
        });

        debugLog('glab repo create output:', output);

        // Parse output to get project info
        const urlMatch = output.match(/https?:\/\/[^\s]+/);
        const webUrl = urlMatch ? urlMatch[0] : `https://${hostname}/${options.namespace || ''}/${projectName}`;
        const pathWithNamespace = options.namespace ? `${options.namespace}/${projectName}` : projectName;

        return {
          success: true,
          data: { pathWithNamespace, webUrl }
        };
      } catch (error) {
        debugLog('Failed to create project:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create project'
        };
      }
    }
  );
}

/**
 * Add a remote origin to a local git repository
 */
export function registerAddGitLabRemote(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_ADD_REMOTE,
    async (
      _event,
      projectPath: string,
      projectFullPath: string,
      instanceUrl?: string
    ): Promise<IPCResult<{ remoteUrl: string }>> => {
      debugLog('addGitLabRemote handler called', { projectPath, projectFullPath, instanceUrl });

      if (!isValidGitLabProject(projectFullPath)) {
        return {
          success: false,
          error: 'Invalid project format'
        };
      }

      const baseUrl = (instanceUrl || DEFAULT_GITLAB_URL).replace(/\/$/, '');
      const remoteUrl = `${baseUrl}/${projectFullPath}.git`;

      try {
        // Check if origin exists
        try {
          execFileSync('git', ['remote', 'get-url', 'origin'], {
            cwd: projectPath,
            encoding: 'utf-8',
            stdio: 'pipe',
            env: getIsolatedGitEnv()
          });
          // Remove existing origin
          execFileSync('git', ['remote', 'remove', 'origin'], {
            cwd: projectPath,
            encoding: 'utf-8',
            stdio: 'pipe',
            env: getIsolatedGitEnv()
          });
        } catch {
          // No origin exists
        }

        execFileSync('git', ['remote', 'add', 'origin', remoteUrl], {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: 'pipe',
          env: getIsolatedGitEnv()
        });

        return {
          success: true,
          data: { remoteUrl }
        };
      } catch (error) {
        debugLog('Failed to add remote:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add remote'
        };
      }
    }
  );
}

/**
 * List user's GitLab groups
 */
export function registerListGitLabGroups(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_LIST_GROUPS,
    async (_event, instanceUrl?: string): Promise<IPCResult<{ groups: Array<{ id: number; name: string; path: string; fullPath: string }> }>> => {
      debugLog('listGitLabGroups handler called', { instanceUrl });
      const hostname = instanceUrl ? getHostnameFromUrl(instanceUrl) : 'gitlab.com';

      try {
        const args = ['api', 'groups', '--jq', '.[] | {id: .id, name: .name, path: .path, fullPath: .full_path}'];
        if (hostname !== 'gitlab.com') {
          args.push('--hostname', hostname);
        }

        const output = execFileSync('glab', args, {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: getAugmentedEnv()
        });

        const groups: Array<{ id: number; name: string; path: string; fullPath: string }> = [];
        const lines = output.trim().split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const group = JSON.parse(line);
            groups.push({
              id: group.id,
              name: group.name,
              path: group.path,
              fullPath: group.fullPath
            });
          } catch {
            // Skip invalid JSON
          }
        }

        return {
          success: true,
          data: { groups }
        };
      } catch (error) {
        debugLog('Failed to list groups:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list groups'
        };
      }
    }
  );
}

/**
 * Register all GitLab OAuth handlers
 */
export function registerGitlabOAuthHandlers(): void {
  debugLog('Registering GitLab OAuth handlers');
  registerCheckGlabCli();
  registerInstallGlabCli();
  registerCheckGlabAuth();
  registerStartGlabAuth();
  registerGetGlabToken();
  registerGetGlabUser();
  registerListUserProjects();
  registerDetectGitLabProject();
  registerGetGitLabBranches();
  registerCreateGitLabProject();
  registerAddGitLabRemote();
  registerListGitLabGroups();
  debugLog('GitLab OAuth handlers registered');
}
