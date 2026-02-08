import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult, TerminalCreateOptions, ClaudeProfile, ClaudeProfileSettings, ClaudeUsageSnapshot } from '../../shared/types';
import { getClaudeProfileManager } from '../claude-profile-manager';
import { expandHomePath } from '../claude-profile/profile-utils';
import { getUsageMonitor } from '../claude-profile/usage-monitor';
import { TerminalManager } from '../terminal-manager';
import { projectStore } from '../project-store';
import { terminalNameGenerator } from '../terminal-name-generator';
import { escapeShellArg, escapeShellArgWindows } from '../../shared/utils/shell-escape';
import { getClaudeCliInvocationAsync } from '../claude-cli-utils';
import { readSettingsFileAsync } from '../settings-utils';


/**
 * Register all terminal-related IPC handlers
 */
export function registerTerminalHandlers(
  terminalManager: TerminalManager,
  getMainWindow: () => BrowserWindow | null
): void {

  // ============================================
  // Terminal Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_CREATE,
    async (_, options: TerminalCreateOptions): Promise<IPCResult> => {
      try {
        const result = await terminalManager.create(options);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create terminal (exception)'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_DESTROY,
    async (_, id: string): Promise<IPCResult> => {
      return terminalManager.destroy(id);
    }
  );

  ipcMain.on(
    IPC_CHANNELS.TERMINAL_INPUT,
    (_, id: string, data: string) => {
      terminalManager.write(id, data);
    }
  );

  ipcMain.on(
    IPC_CHANNELS.TERMINAL_RESIZE,
    (_, id: string, cols: number, rows: number) => {
      terminalManager.resize(id, cols, rows);
    }
  );

  ipcMain.on(
    IPC_CHANNELS.TERMINAL_INVOKE_CLAUDE,
    (_, id: string, cwd?: string) => {
      // Wrap in async IIFE to allow async settings read without blocking
      (async () => {
        // Read settings asynchronously to check for YOLO mode (dangerously skip permissions)
        const settings = await readSettingsFileAsync();
        const dangerouslySkipPermissions = settings?.dangerouslySkipPermissions === true;

        // Use async version to avoid blocking main process during CLI detection
        await terminalManager.invokeClaudeAsync(id, cwd, undefined, dangerouslySkipPermissions);
      })().catch((error) => {
        console.warn('[terminal-handlers] Failed to invoke Claude:', error);
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_GENERATE_NAME,
    async (_, command: string, cwd?: string): Promise<IPCResult<string>> => {
      try {
        const name = await terminalNameGenerator.generateName(command, cwd);
        if (name) {
          return { success: true, data: name };
        } else {
          return { success: false, error: 'Failed to generate terminal name' };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to generate terminal name'
        };
      }
    }
  );

  // Set terminal title (user renamed terminal in renderer)
  ipcMain.on(
    IPC_CHANNELS.TERMINAL_SET_TITLE,
    (_, id: string, title: string) => {
      terminalManager.setTitle(id, title);
    }
  );

  // Set terminal worktree config (user changed worktree association in renderer)
  ipcMain.on(
    IPC_CHANNELS.TERMINAL_SET_WORKTREE_CONFIG,
    (_, id: string, config: import('../../shared/types').TerminalWorktreeConfig | undefined) => {
      terminalManager.setWorktreeConfig(id, config);
    }
  );

  // Claude profile management (multi-account support)
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILES_GET,
    async (): Promise<IPCResult<ClaudeProfileSettings>> => {
      try {
        const profileManager = getClaudeProfileManager();
        const settings = profileManager.getSettings();
        return { success: true, data: settings };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get Claude profiles'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_SAVE,
    async (_, profile: ClaudeProfile): Promise<IPCResult<ClaudeProfile>> => {
      try {
        const profileManager = getClaudeProfileManager();

        // If this is a new profile without an ID, generate one
        if (!profile.id) {
          profile.id = profileManager.generateProfileId(profile.name);
        }

        // Ensure config directory exists for non-default profiles
        if (!profile.isDefault && profile.configDir) {
          const expandedDir = expandHomePath(profile.configDir);
          const { mkdirSync, existsSync } = await import('fs');
          if (!existsSync(expandedDir)) {
            mkdirSync(expandedDir, { recursive: true });
          }
        }

        const savedProfile = profileManager.saveProfile(profile);
        return { success: true, data: savedProfile };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save Claude profile'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_DELETE,
    async (_, profileId: string): Promise<IPCResult> => {
      try {
        const profileManager = getClaudeProfileManager();
        const success = profileManager.deleteProfile(profileId);
        if (!success) {
          return { success: false, error: 'Cannot delete the last remaining profile' };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete Claude profile'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_RENAME,
    async (_, profileId: string, newName: string): Promise<IPCResult> => {
      try {
        const profileManager = getClaudeProfileManager();
        const success = profileManager.renameProfile(profileId, newName);
        if (!success) {
          return { success: false, error: 'Profile not found or invalid name' };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to rename Claude profile'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_SET_ACTIVE,
    async (_, profileId: string): Promise<IPCResult> => {
      try {
        const profileManager = getClaudeProfileManager();
        const previousProfileId = profileManager.getActiveProfile().id;

        const success = profileManager.setActiveProfile(profileId);

        if (!success) {
          return { success: false, error: 'Profile not found' };
        }

        // If the profile actually changed, restart Claude in active terminals
        // This ensures existing Claude sessions use the new profile's OAuth token
        const profileChanged = previousProfileId !== profileId;

        if (profileChanged) {
          const activeTerminalIds = terminalManager.getActiveTerminalIds();
          const switchPromises: Promise<void>[] = [];

          for (const terminalId of activeTerminalIds) {
            if (terminalManager.isClaudeMode(terminalId)) {
              switchPromises.push(
                terminalManager.switchClaudeProfile(terminalId, profileId)
                  .then(() => undefined)
                  .catch(() => undefined)
              );
            }
          }

          // Wait for all switches to complete (but don't fail the main operation if some fail)
          if (switchPromises.length > 0) {
            await Promise.allSettled(switchPromises);
          }
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set active Claude profile'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_SWITCH,
    async (_, terminalId: string, profileId: string): Promise<IPCResult> => {
      try {
        const result = await terminalManager.switchClaudeProfile(terminalId, profileId);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to switch Claude profile'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_INITIALIZE,
    async (_, profileId: string): Promise<IPCResult> => {
      try {
        const profileManager = getClaudeProfileManager();

        const profile = profileManager.getProfile(profileId);
        if (!profile) {
          return { success: false, error: 'Profile not found' };
        }

        // Ensure the config directory exists for non-default profiles
        if (!profile.isDefault && profile.configDir) {
          const expandedDir = expandHomePath(profile.configDir);
          const { mkdirSync, existsSync } = await import('fs');
          if (!existsSync(expandedDir)) {
            mkdirSync(expandedDir, { recursive: true });
          }
        }

        // Create a terminal and run claude setup-token there
        // This is needed because claude setup-token requires TTY/raw mode
        const terminalId = `claude-login-${profileId}-${Date.now()}`;
        const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';

        // Create a new terminal for the login process
        const createResult = await terminalManager.create({ id: terminalId, cwd: homeDir });

        // If terminal creation failed, return the error
        if (!createResult.success) {
          return {
            success: false,
            error: createResult.error || 'Failed to create terminal for authentication'
          };
        }

        // Wait a moment for the terminal to initialize
        await new Promise(resolve => setTimeout(resolve, 500));

        // Build the login command with the profile's config dir
        // Use full path to claude CLI - no need to modify PATH since we have the absolute path
        let loginCommand: string;
        const { command: claudeCmd } = await getClaudeCliInvocationAsync();

        // Use the full path directly - escaping only needed for paths with spaces
        const shellClaudeCmd = process.platform === 'win32'
          ? `"${escapeShellArgWindows(claudeCmd)}"`
          : escapeShellArg(claudeCmd);

        if (!profile.isDefault && profile.configDir) {
          if (process.platform === 'win32') {
            // SECURITY: Use Windows-specific escaping for cmd.exe
            const escapedConfigDir = escapeShellArgWindows(profile.configDir);
            // Windows cmd.exe syntax: set "VAR=value" with %VAR% for expansion
            loginCommand = `set "CLAUDE_CONFIG_DIR=${escapedConfigDir}" && echo Config dir: %CLAUDE_CONFIG_DIR% && ${shellClaudeCmd} setup-token`;
          } else {
            // SECURITY: Use POSIX escaping for bash/zsh
            const escapedConfigDir = escapeShellArg(profile.configDir);
            // Unix/Mac bash/zsh syntax: export VAR=value with $VAR for expansion
            loginCommand = `export CLAUDE_CONFIG_DIR=${escapedConfigDir} && echo "Config dir: $CLAUDE_CONFIG_DIR" && ${shellClaudeCmd} setup-token`;
          }
        } else {
          // Simple command for default profile - just run setup-token
          loginCommand = `${shellClaudeCmd} setup-token`;
        }

        // Write the login command to the terminal
        terminalManager.write(terminalId, `${loginCommand}\r`);

        // Notify the renderer that an auth terminal was created
        // This allows the UI to display the terminal so users can see the OAuth flow
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.TERMINAL_AUTH_CREATED, {
            terminalId,
            profileId,
            profileName: profile.name
          });
        }

        return {
          success: true,
          data: {
            terminalId,
            message: `A terminal has been opened to authenticate "${profile.name}". Complete the OAuth flow in your browser, then copy the token shown in the terminal.`
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to initialize Claude profile'
        };
      }
    }
  );

  // Set OAuth token for a profile (used when capturing from terminal or manual input)
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_SET_TOKEN,
    async (_, profileId: string, token: string, email?: string): Promise<IPCResult> => {
      try {
        const profileManager = getClaudeProfileManager();
        const success = profileManager.setProfileToken(profileId, token, email);
        if (!success) {
          return { success: false, error: 'Profile not found' };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set OAuth token'
        };
      }
    }
  );

  // Clear OAuth token for a profile (force re-authentication)
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_CLEAR_TOKEN,
    async (_, profileId: string): Promise<IPCResult> => {
      try {
        const profileManager = getClaudeProfileManager();
        const success = profileManager.clearProfileToken(profileId);
        if (!success) {
          return { success: false, error: 'Profile not found' };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to clear OAuth token'
        };
      }
    }
  );

  // Get auto-switch settings
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_AUTO_SWITCH_SETTINGS,
    async (): Promise<IPCResult<import('../../shared/types').ClaudeAutoSwitchSettings>> => {
      try {
        const profileManager = getClaudeProfileManager();
        const settings = profileManager.getAutoSwitchSettings();
        return { success: true, data: settings };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get auto-switch settings'
        };
      }
    }
  );

  // Update auto-switch settings
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_UPDATE_AUTO_SWITCH,
    async (_, settings: Partial<import('../../shared/types').ClaudeAutoSwitchSettings>): Promise<IPCResult> => {
      try {
        const profileManager = getClaudeProfileManager();
        profileManager.updateAutoSwitchSettings(settings);

        // Restart usage monitor with new settings
        const monitor = getUsageMonitor();
        monitor.stop();
        monitor.start();

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update auto-switch settings'
        };
      }
    }
  );

  // Fetch usage by sending /usage command to terminal
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_FETCH_USAGE,
    async (_, terminalId: string): Promise<IPCResult> => {
      try {
        // Send /usage command to the terminal
        terminalManager.write(terminalId, '/usage\r');
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch usage'
        };
      }
    }
  );

  // Get best available profile
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_PROFILE_GET_BEST_PROFILE,
    async (_, excludeProfileId?: string): Promise<IPCResult<ClaudeProfile | null>> => {
      try {
        const profileManager = getClaudeProfileManager();
        const bestProfile = profileManager.getBestAvailableProfile(excludeProfileId);
        return { success: true, data: bestProfile };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get best profile'
        };
      }
    }
  );

  // Retry rate-limited operation with a different profile
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_RETRY_WITH_PROFILE,
    async (_, request: import('../../shared/types').RetryWithProfileRequest): Promise<IPCResult> => {
      try {
        const profileManager = getClaudeProfileManager();

        // Set the new active profile
        profileManager.setActiveProfile(request.profileId);

        // Get the project
        const project = projectStore.getProject(request.projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        // Retry based on the source
        switch (request.source) {
          case 'changelog':
            // The changelog UI will handle retrying by re-submitting the form
            // We just need to confirm the profile switch was successful
            return { success: true };

          case 'task':
            // For tasks, we would need to restart the task
            // This is complex and would need task state restoration
            return { success: true, data: { message: 'Please restart the task manually' } };

          case 'roadmap':
            // For roadmap, the UI can trigger a refresh
            return { success: true };

          case 'ideation':
            // For ideation, the UI can trigger a refresh
            return { success: true };

          default:
            return { success: true };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to retry with profile'
        };
      }
    }
  );

  // ============================================
  // Usage Monitoring (Proactive Account Switching)
  // ============================================

  // Request current usage snapshot
  ipcMain.handle(
    IPC_CHANNELS.USAGE_REQUEST,
    async (): Promise<IPCResult<import('../../shared/types').ClaudeUsageSnapshot | null>> => {
      try {
        const monitor = getUsageMonitor();
        const usage = monitor.getCurrentUsage();
        return { success: true, data: usage };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get current usage'
        };
      }
    }
  );


  // Terminal session management (persistence/restore)
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_GET_SESSIONS,
    async (_, projectPath: string): Promise<IPCResult<import('../../shared/types').TerminalSession[]>> => {
      try {
        const sessions = terminalManager.getSavedSessions(projectPath);
        return { success: true, data: sessions };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get terminal sessions'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_RESTORE_SESSION,
    async (_, session: import('../../shared/types').TerminalSession, cols?: number, rows?: number): Promise<IPCResult<import('../../shared/types').TerminalRestoreResult>> => {
      try {
        const result = await terminalManager.restore(session, cols, rows);
        return {
          success: result.success,
          data: {
            success: result.success,
            terminalId: session.id,
            outputBuffer: result.outputBuffer,
            error: result.error
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to restore terminal session'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_CLEAR_SESSIONS,
    async (_, projectPath: string): Promise<IPCResult> => {
      try {
        terminalManager.clearSavedSessions(projectPath);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to clear terminal sessions'
        };
      }
    }
  );

  ipcMain.on(
    IPC_CHANNELS.TERMINAL_RESUME_CLAUDE,
    (_, id: string, sessionId?: string) => {
      // Use async version to avoid blocking main process during CLI detection
      terminalManager.resumeClaudeAsync(id, sessionId).catch((error) => {
        console.warn('[terminal-handlers] Failed to resume Claude:', error);
      });
    }
  );

  // Activate deferred Claude resume when terminal becomes active
  // This is triggered by the renderer when a terminal with pendingClaudeResume becomes the active tab
  ipcMain.on(
    IPC_CHANNELS.TERMINAL_ACTIVATE_DEFERRED_RESUME,
    (_, id: string) => {
      terminalManager.activateDeferredResume(id).catch((error) => {
        console.warn('[terminal-handlers] Failed to activate deferred resume:', error);
      });
    }
  );

  // Get available session dates for a project
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_GET_SESSION_DATES,
    async (_, projectPath?: string) => {
      try {
        const dates = terminalManager.getAvailableSessionDates(projectPath);
        return { success: true, data: dates };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get session dates'
        };
      }
    }
  );

  // Get sessions for a specific date and project
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_GET_SESSIONS_FOR_DATE,
    async (_, date: string, projectPath: string) => {
      try {
        const sessions = terminalManager.getSessionsForDate(date, projectPath);
        return { success: true, data: sessions };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get sessions for date'
        };
      }
    }
  );

  // Restore all sessions from a specific date
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_RESTORE_FROM_DATE,
    async (_, date: string, projectPath: string, cols?: number, rows?: number) => {
      try {
        const result = await terminalManager.restoreSessionsFromDate(
          date,
          projectPath,
          cols || 80,
          rows || 24
        );
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to restore sessions from date'
        };
      }
    }
  );

  // Check if a terminal's PTY process is alive
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_CHECK_PTY_ALIVE,
    async (_, terminalId: string): Promise<IPCResult<{ alive: boolean }>> => {
      try {
        const alive = terminalManager.isTerminalAlive(terminalId);
        return { success: true, data: { alive } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check terminal status'
        };
      }
    }
  );

  // Update terminal display orders after drag-drop reorder
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_UPDATE_DISPLAY_ORDERS,
    async (
      _,
      projectPath: string,
      orders: Array<{ terminalId: string; displayOrder: number }>
    ): Promise<IPCResult> => {
      try {
        terminalManager.updateDisplayOrders(projectPath, orders);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update display orders'
        };
      }
    }
  );
}

/**
 * Initialize usage monitor event forwarding to renderer process
 * Call this after mainWindow is created
 */
export function initializeUsageMonitorForwarding(mainWindow: BrowserWindow): void {
  const monitor = getUsageMonitor();

  // Forward usage updates to renderer
  monitor.on('usage-updated', (usage: ClaudeUsageSnapshot) => {
    mainWindow.webContents.send(IPC_CHANNELS.USAGE_UPDATED, usage);
  });

  // Forward proactive swap notifications to renderer
  monitor.on('show-swap-notification', (notification: unknown) => {
    mainWindow.webContents.send(IPC_CHANNELS.PROACTIVE_SWAP_NOTIFICATION, notification);
  });
}
