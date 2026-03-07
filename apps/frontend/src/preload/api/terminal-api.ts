import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';

// Increase max listeners to accommodate 12 terminals with multiple event types
// Each terminal can have listeners for: output, exit, titleChange, claudeSession, etc.
// Default is 10, but with 12 terminals we need more headroom
ipcRenderer.setMaxListeners(50);

import type {
  IPCResult,
  TerminalCreateOptions,
  RateLimitInfo,
  ClaudeProfile,
  ClaudeProfileSettings,
  ClaudeUsageSnapshot,
  CreateTerminalWorktreeRequest,
  TerminalWorktreeConfig,
  TerminalWorktreeResult,
  OtherWorktreeInfo,
  TerminalProfileChangedEvent,
} from '../../shared/types';

/** Type for proactive swap notification events */
interface ProactiveSwapNotification {
  fromProfile: { id: string; name: string };
  toProfile: { id: string; name: string };
  reason: string;
  usageSnapshot: ClaudeUsageSnapshot;
}

export interface TerminalAPI {
  // Terminal Operations
  createTerminal: (options: TerminalCreateOptions) => Promise<IPCResult>;
  destroyTerminal: (id: string) => Promise<IPCResult>;
  sendTerminalInput: (id: string, data: string) => void;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<IPCResult<{ success: boolean }>>;
  invokeClaudeInTerminal: (id: string, cwd?: string) => void;
  generateTerminalName: (command: string, cwd?: string) => Promise<IPCResult<string>>;
  setTerminalTitle: (id: string, title: string) => void;
  setTerminalWorktreeConfig: (id: string, config: TerminalWorktreeConfig | undefined) => void;

  // Terminal Session Management
  getTerminalSessions: (projectPath: string) => Promise<IPCResult<import('../../shared/types').TerminalSession[]>>;
  restoreTerminalSession: (
    session: import('../../shared/types').TerminalSession,
    cols?: number,
    rows?: number
  ) => Promise<IPCResult<import('../../shared/types').TerminalRestoreResult>>;
  clearTerminalSessions: (projectPath: string) => Promise<IPCResult>;
  resumeClaudeInTerminal: (id: string, sessionId?: string, options?: { migratedSession?: boolean }) => void;
  activateDeferredClaudeResume: (id: string) => void;
  getTerminalSessionDates: (projectPath?: string) => Promise<IPCResult<import('../../shared/types').SessionDateInfo[]>>;
  getTerminalSessionsForDate: (
    date: string,
    projectPath: string
  ) => Promise<IPCResult<import('../../shared/types').TerminalSession[]>>;
  restoreTerminalSessionsFromDate: (
    date: string,
    projectPath: string,
    cols?: number,
    rows?: number
  ) => Promise<IPCResult<import('../../shared/types').SessionDateRestoreResult>>;
  checkTerminalPtyAlive: (terminalId: string) => Promise<IPCResult<{ alive: boolean }>>;
  updateTerminalDisplayOrders: (
    projectPath: string,
    orders: Array<{ terminalId: string; displayOrder: number }>
  ) => Promise<IPCResult>;

  // Terminal Worktree Operations (isolated development)
  createTerminalWorktree: (request: CreateTerminalWorktreeRequest) => Promise<TerminalWorktreeResult>;
  listTerminalWorktrees: (projectPath: string) => Promise<IPCResult<TerminalWorktreeConfig[]>>;
  removeTerminalWorktree: (projectPath: string, name: string, deleteBranch?: boolean) => Promise<IPCResult>;
  listOtherWorktrees: (projectPath: string) => Promise<IPCResult<OtherWorktreeInfo[]>>;

  // Terminal Event Listeners
  onTerminalOutput: (callback: (id: string, data: string) => void) => () => void;
  onTerminalExit: (callback: (id: string, exitCode: number) => void) => () => void;
  onTerminalTitleChange: (callback: (id: string, title: string) => void) => () => void;
  onTerminalWorktreeConfigChange: (callback: (id: string, config: TerminalWorktreeConfig | undefined) => void) => () => void;
  onTerminalClaudeSession: (callback: (id: string, sessionId: string) => void) => () => void;
  onTerminalRateLimit: (callback: (info: RateLimitInfo) => void) => () => void;
  onTerminalOAuthToken: (
    callback: (info: { terminalId: string; profileId?: string; email?: string; success: boolean; message?: string; detectedAt: string; needsOnboarding?: boolean }) => void
  ) => () => void;
  onTerminalAuthCreated: (
    callback: (info: { terminalId: string; profileId: string; profileName: string }) => void
  ) => () => void;
  onTerminalOAuthCodeNeeded: (
    callback: (info: { terminalId: string; profileId: string; profileName: string }) => void
  ) => () => void;
  submitOAuthCode: (terminalId: string, code: string) => Promise<IPCResult>;
  onTerminalClaudeBusy: (callback: (id: string, isBusy: boolean) => void) => () => void;
  onTerminalClaudeExit: (callback: (id: string) => void) => () => void;
  onTerminalOnboardingComplete: (
    callback: (info: { terminalId: string; profileId?: string; detectedAt: string }) => void
  ) => () => void;
  onTerminalPendingResume: (callback: (id: string, sessionId?: string) => void) => () => void;
  onTerminalProfileChanged: (callback: (event: TerminalProfileChangedEvent) => void) => () => void;

  // Claude Profile Management
  getClaudeProfiles: () => Promise<IPCResult<ClaudeProfileSettings>>;
  saveClaudeProfile: (profile: ClaudeProfile) => Promise<IPCResult<ClaudeProfile>>;
  deleteClaudeProfile: (profileId: string) => Promise<IPCResult>;
  renameClaudeProfile: (profileId: string, newName: string) => Promise<IPCResult>;
  setActiveClaudeProfile: (profileId: string) => Promise<IPCResult>;
  switchClaudeProfile: (terminalId: string, profileId: string) => Promise<IPCResult>;
  initializeClaudeProfile: (profileId: string) => Promise<IPCResult>;
  setClaudeProfileToken: (profileId: string, token: string, email?: string) => Promise<IPCResult>;
  authenticateClaudeProfile: (profileId: string) => Promise<IPCResult<{ terminalId: string; configDir: string }>>;
  verifyClaudeProfileAuth: (profileId: string) => Promise<IPCResult<{ authenticated: boolean; email?: string }>>;
  getAutoSwitchSettings: () => Promise<IPCResult<import('../../shared/types').ClaudeAutoSwitchSettings>>;
  updateAutoSwitchSettings: (settings: Partial<import('../../shared/types').ClaudeAutoSwitchSettings>) => Promise<IPCResult>;
  getAccountPriorityOrder: () => Promise<IPCResult<string[]>>;
  setAccountPriorityOrder: (order: string[]) => Promise<IPCResult>;
  fetchClaudeUsage: (terminalId: string) => Promise<IPCResult>;
  getBestAvailableProfile: (excludeProfileId?: string) => Promise<IPCResult<import('../../shared/types').ClaudeProfile | null>>;
  onSDKRateLimit: (callback: (info: import('../../shared/types').SDKRateLimitInfo) => void) => () => void;
  onAuthFailure: (callback: (info: import('../../shared/types').AuthFailureInfo) => void) => () => void;
  retryWithProfile: (request: import('../../shared/types').RetryWithProfileRequest) => Promise<IPCResult>;

  // Usage Monitoring (Proactive Account Switching)
  requestUsageUpdate: () => Promise<IPCResult<import('../../shared/types').ClaudeUsageSnapshot | null>>;
  requestAllProfilesUsage: (forceRefresh?: boolean) => Promise<IPCResult<import('../../shared/types').AllProfilesUsage | null>>;
  onUsageUpdated: (callback: (usage: import('../../shared/types').ClaudeUsageSnapshot) => void) => () => void;
  onAllProfilesUsageUpdated: (callback: (allProfilesUsage: import('../../shared/types').AllProfilesUsage) => void) => () => void;
  onProactiveSwapNotification: (callback: (notification: ProactiveSwapNotification) => void) => () => void;
}

export const createTerminalAPI = (): TerminalAPI => ({
  // Terminal Operations
  createTerminal: (options: TerminalCreateOptions): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CREATE, options),

  destroyTerminal: (id: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_DESTROY, id),

  sendTerminalInput: (id: string, data: string): void =>
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_INPUT, id, data),

  resizeTerminal: (id: string, cols: number, rows: number): Promise<IPCResult<{ success: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESIZE, id, cols, rows),

  invokeClaudeInTerminal: (id: string, cwd?: string): void =>
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_INVOKE_CLAUDE, id, cwd),

  generateTerminalName: (command: string, cwd?: string): Promise<IPCResult<string>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_GENERATE_NAME, command, cwd),

  setTerminalTitle: (id: string, title: string): void =>
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_SET_TITLE, id, title),

  setTerminalWorktreeConfig: (id: string, config: TerminalWorktreeConfig | undefined): void =>
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_SET_WORKTREE_CONFIG, id, config),

  // Terminal Session Management
  getTerminalSessions: (projectPath: string): Promise<IPCResult<import('../../shared/types').TerminalSession[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_GET_SESSIONS, projectPath),

  restoreTerminalSession: (
    session: import('../../shared/types').TerminalSession,
    cols?: number,
    rows?: number
  ): Promise<IPCResult<import('../../shared/types').TerminalRestoreResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESTORE_SESSION, session, cols, rows),

  clearTerminalSessions: (projectPath: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CLEAR_SESSIONS, projectPath),

  resumeClaudeInTerminal: (id: string, sessionId?: string, options?: { migratedSession?: boolean }): void =>
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_RESUME_CLAUDE, id, sessionId, options),

  activateDeferredClaudeResume: (id: string): void =>
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_ACTIVATE_DEFERRED_RESUME, id),

  getTerminalSessionDates: (projectPath?: string): Promise<IPCResult<import('../../shared/types').SessionDateInfo[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_GET_SESSION_DATES, projectPath),

  getTerminalSessionsForDate: (
    date: string,
    projectPath: string
  ): Promise<IPCResult<import('../../shared/types').TerminalSession[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_GET_SESSIONS_FOR_DATE, date, projectPath),

  restoreTerminalSessionsFromDate: (
    date: string,
    projectPath: string,
    cols?: number,
    rows?: number
  ): Promise<IPCResult<import('../../shared/types').SessionDateRestoreResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESTORE_FROM_DATE, date, projectPath, cols, rows),

  checkTerminalPtyAlive: (terminalId: string): Promise<IPCResult<{ alive: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CHECK_PTY_ALIVE, terminalId),

  updateTerminalDisplayOrders: (
    projectPath: string,
    orders: Array<{ terminalId: string; displayOrder: number }>
  ): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_UPDATE_DISPLAY_ORDERS, projectPath, orders),

  // Terminal Worktree Operations (isolated development)
  createTerminalWorktree: (request: CreateTerminalWorktreeRequest): Promise<TerminalWorktreeResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WORKTREE_CREATE, request),

  listTerminalWorktrees: (projectPath: string): Promise<IPCResult<TerminalWorktreeConfig[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WORKTREE_LIST, projectPath),

  removeTerminalWorktree: (projectPath: string, name: string, deleteBranch: boolean = false): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WORKTREE_REMOVE, projectPath, name, deleteBranch),

  listOtherWorktrees: (projectPath: string): Promise<IPCResult<OtherWorktreeInfo[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WORKTREE_LIST_OTHER, projectPath),

  // Terminal Event Listeners
  onTerminalOutput: (
    callback: (id: string, data: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string,
      data: string
    ): void => {
      callback(id, data);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_OUTPUT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_OUTPUT, handler);
    };
  },

  onTerminalExit: (
    callback: (id: string, exitCode: number) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string,
      exitCode: number
    ): void => {
      callback(id, exitCode);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_EXIT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_EXIT, handler);
    };
  },

  onTerminalTitleChange: (
    callback: (id: string, title: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string,
      title: string
    ): void => {
      callback(id, title);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_TITLE_CHANGE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_TITLE_CHANGE, handler);
    };
  },

  onTerminalWorktreeConfigChange: (
    callback: (id: string, config: TerminalWorktreeConfig | undefined) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string,
      config: TerminalWorktreeConfig | undefined
    ): void => {
      callback(id, config);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_WORKTREE_CONFIG_CHANGE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_WORKTREE_CONFIG_CHANGE, handler);
    };
  },

  onTerminalClaudeSession: (
    callback: (id: string, sessionId: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string,
      sessionId: string
    ): void => {
      callback(id, sessionId);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_CLAUDE_SESSION, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_CLAUDE_SESSION, handler);
    };
  },

  onTerminalRateLimit: (
    callback: (info: RateLimitInfo) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: RateLimitInfo
    ): void => {
      callback(info);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_RATE_LIMIT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_RATE_LIMIT, handler);
    };
  },

  onTerminalOAuthToken: (
    callback: (info: { terminalId: string; profileId?: string; email?: string; success: boolean; message?: string; detectedAt: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: { terminalId: string; profileId?: string; email?: string; success: boolean; message?: string; detectedAt: string }
    ): void => {
      callback(info);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_OAUTH_TOKEN, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_OAUTH_TOKEN, handler);
    };
  },

  onTerminalAuthCreated: (
    callback: (info: { terminalId: string; profileId: string; profileName: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: { terminalId: string; profileId: string; profileName: string }
    ): void => {
      callback(info);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_AUTH_CREATED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_AUTH_CREATED, handler);
    };
  },

  onTerminalOAuthCodeNeeded: (
    callback: (info: { terminalId: string; profileId: string; profileName: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: { terminalId: string; profileId: string; profileName: string }
    ): void => {
      callback(info);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_OAUTH_CODE_NEEDED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_OAUTH_CODE_NEEDED, handler);
    };
  },

  submitOAuthCode: (terminalId: string, code: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_OAUTH_CODE_SUBMIT, terminalId, code),

  onTerminalClaudeBusy: (
    callback: (id: string, isBusy: boolean) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string,
      isBusy: boolean
    ): void => {
      callback(id, isBusy);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_CLAUDE_BUSY, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_CLAUDE_BUSY, handler);
    };
  },

  onTerminalClaudeExit: (
    callback: (id: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string
    ): void => {
      callback(id);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_CLAUDE_EXIT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_CLAUDE_EXIT, handler);
    };
  },

  onTerminalOnboardingComplete: (
    callback: (info: { terminalId: string; profileId?: string; detectedAt: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: { terminalId: string; profileId?: string; detectedAt: string }
    ): void => {
      callback(info);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_ONBOARDING_COMPLETE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_ONBOARDING_COMPLETE, handler);
    };
  },

  onTerminalPendingResume: (
    callback: (id: string, sessionId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string,
      sessionId?: string
    ): void => {
      callback(id, sessionId);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_PENDING_RESUME, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_PENDING_RESUME, handler);
    };
  },

  onTerminalProfileChanged: (
    callback: (event: TerminalProfileChangedEvent) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: TerminalProfileChangedEvent
    ): void => {
      callback(data);
    };
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_PROFILE_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_PROFILE_CHANGED, handler);
    };
  },

  // Claude Profile Management
  getClaudeProfiles: (): Promise<IPCResult<ClaudeProfileSettings>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILES_GET),

  saveClaudeProfile: (profile: ClaudeProfile): Promise<IPCResult<ClaudeProfile>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_SAVE, profile),

  deleteClaudeProfile: (profileId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_DELETE, profileId),

  renameClaudeProfile: (profileId: string, newName: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_RENAME, profileId, newName),

  setActiveClaudeProfile: (profileId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_SET_ACTIVE, profileId),

  switchClaudeProfile: (terminalId: string, profileId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_SWITCH, terminalId, profileId),

  initializeClaudeProfile: (profileId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_INITIALIZE, profileId),

  setClaudeProfileToken: (profileId: string, token: string, email?: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_SET_TOKEN, profileId, token, email),

  authenticateClaudeProfile: (profileId: string): Promise<IPCResult<{ terminalId: string; configDir: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_AUTHENTICATE, profileId),

  verifyClaudeProfileAuth: (profileId: string): Promise<IPCResult<{ authenticated: boolean; email?: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_VERIFY_AUTH, profileId),

  getAutoSwitchSettings: (): Promise<IPCResult<import('../../shared/types').ClaudeAutoSwitchSettings>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_AUTO_SWITCH_SETTINGS),

  updateAutoSwitchSettings: (settings: Partial<import('../../shared/types').ClaudeAutoSwitchSettings>): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_UPDATE_AUTO_SWITCH, settings),

  getAccountPriorityOrder: (): Promise<IPCResult<string[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_PRIORITY_GET),

  setAccountPriorityOrder: (order: string[]): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_PRIORITY_SET, order),

  fetchClaudeUsage: (terminalId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_FETCH_USAGE, terminalId),

  getBestAvailableProfile: (excludeProfileId?: string): Promise<IPCResult<import('../../shared/types').ClaudeProfile | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PROFILE_GET_BEST_PROFILE, excludeProfileId),

  onSDKRateLimit: (
    callback: (info: import('../../shared/types').SDKRateLimitInfo) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: import('../../shared/types').SDKRateLimitInfo
    ): void => {
      callback(info);
    };
    ipcRenderer.on(IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, handler);
    };
  },

  onAuthFailure: (
    callback: (info: import('../../shared/types').AuthFailureInfo) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: import('../../shared/types').AuthFailureInfo
    ): void => {
      callback(info);
    };
    ipcRenderer.on(IPC_CHANNELS.CLAUDE_AUTH_FAILURE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_AUTH_FAILURE, handler);
    };
  },

  retryWithProfile: (request: import('../../shared/types').RetryWithProfileRequest): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_RETRY_WITH_PROFILE, request),

  // Usage Monitoring (Proactive Account Switching)
  requestUsageUpdate: (): Promise<IPCResult<import('../../shared/types').ClaudeUsageSnapshot | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.USAGE_REQUEST),

  requestAllProfilesUsage: (forceRefresh?: boolean): Promise<IPCResult<import('../../shared/types').AllProfilesUsage | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.ALL_PROFILES_USAGE_REQUEST, forceRefresh ?? false),

  onUsageUpdated: (
    callback: (usage: import('../../shared/types').ClaudeUsageSnapshot) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      usage: import('../../shared/types').ClaudeUsageSnapshot
    ): void => {
      callback(usage);
    };
    ipcRenderer.on(IPC_CHANNELS.USAGE_UPDATED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.USAGE_UPDATED, handler);
    };
  },

  onAllProfilesUsageUpdated: (
    callback: (allProfilesUsage: import('../../shared/types').AllProfilesUsage) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      allProfilesUsage: import('../../shared/types').AllProfilesUsage
    ): void => {
      callback(allProfilesUsage);
    };
    ipcRenderer.on(IPC_CHANNELS.ALL_PROFILES_USAGE_UPDATED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ALL_PROFILES_USAGE_UPDATED, handler);
    };
  },

  onProactiveSwapNotification: (
    callback: (notification: ProactiveSwapNotification) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, notification: ProactiveSwapNotification): void => {
      callback(notification);
    };
    ipcRenderer.on(IPC_CHANNELS.PROACTIVE_SWAP_NOTIFICATION, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.PROACTIVE_SWAP_NOTIFICATION, handler);
    };
  }
});
