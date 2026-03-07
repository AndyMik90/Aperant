import type * as pty from '@lydell/node-pty';
import type { BrowserWindow } from 'electron';
import type { TerminalWorktreeConfig, WindowsShellType } from '../../shared/types';

// Re-export WindowsShellType for backwards compatibility
export type { WindowsShellType } from '../../shared/types';

/**
 * Terminal process tracking
 */
export interface TerminalProcess {
  id: string;
  pty: pty.IPty;
  isClaudeMode: boolean;
  projectPath?: string;
  cwd: string;
  claudeSessionId?: string;
  claudeProfileId?: string;
  outputBuffer: string;
  title: string;
  /** Associated worktree configuration (persisted across restarts) */
  worktreeConfig?: TerminalWorktreeConfig;
  /** Whether this terminal has a pending Claude resume that should be triggered on activation */
  pendingClaudeResume?: boolean;
  /** Whether Claude was invoked with --dangerously-skip-permissions (YOLO mode) */
  dangerouslySkipPermissions?: boolean;
  /** Shell type for Windows (affects command chaining syntax) */
  shellType?: WindowsShellType;
  /** Whether this terminal is waiting for Claude onboarding to complete (login flow) */
  awaitingOnboardingComplete?: boolean;
  /** Whether PTY has emitted exit; used to avoid writes/resizes on dead PTYs */
  hasExited?: boolean;
}

/**
 * Rate limit event data
 */
export interface RateLimitEvent {
  terminalId: string;
  resetTime: string;
  detectedAt: string;
  profileId: string;
  suggestedProfileId?: string;
  suggestedProfileName?: string;
  autoSwitchEnabled: boolean;
}

/**
 * OAuth token event data
 */
export interface OAuthTokenEvent {
  terminalId: string;
  profileId?: string;
  email?: string;
  success: boolean;
  message?: string;
  detectedAt: string;
  /** If true, user should complete onboarding in terminal before closing */
  needsOnboarding?: boolean;
}

/**
 * Onboarding complete event data
 * Sent when Claude Code shows its ready state after login/onboarding
 */
export interface OnboardingCompleteEvent {
  terminalId: string;
  profileId?: string;
  detectedAt: string;
}

/**
 * Session capture result
 */
export interface SessionCaptureResult {
  sessionId: string | null;
  captured: boolean;
}

/**
 * Terminal creation result
 */
export interface TerminalOperationResult {
  success: boolean;
  error?: string;
  outputBuffer?: string;
}

/**
 * Window getter function type
 */
export type WindowGetter = () => BrowserWindow | null;

/**
 * Terminal info for profile change operations
 */
export interface TerminalProfileChangeInfo {
  id: string;
  cwd: string;
  projectPath?: string;
  claudeSessionId?: string;
  claudeProfileId?: string;
  isClaudeMode: boolean;
  dangerouslySkipPermissions?: boolean;
}
