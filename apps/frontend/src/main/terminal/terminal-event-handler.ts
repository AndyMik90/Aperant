/**
 * Terminal Event Handler
 * Manages terminal data output events and processing
 */

import * as OutputParser from './output-parser';
import * as ClaudeIntegration from './claude-integration-handler';
import type { TerminalProcess, WindowGetter } from './types';
import { IPC_CHANNELS } from '../../shared/constants';
import { safeSendToRenderer } from '../ipc-handlers/utils';

/**
 * Event handler callbacks
 */
export interface EventHandlerCallbacks {
  onClaudeSessionId: (terminal: TerminalProcess, sessionId: string) => void;
  onRateLimit: (terminal: TerminalProcess, data: string) => void;
  onOAuthToken: (terminal: TerminalProcess, data: string) => void;
  onOnboardingComplete: (terminal: TerminalProcess, data: string) => void;
  onClaudeBusyChange: (terminal: TerminalProcess, isBusy: boolean) => void;
  onClaudeExit: (terminal: TerminalProcess) => void;
}

// Track the last known busy state per terminal to avoid duplicate events
const lastBusyState = new Map<string, boolean>();

/**
 * Handle terminal data output
 */
export function handleTerminalData(
  terminal: TerminalProcess,
  data: string,
  callbacks: EventHandlerCallbacks
): void {
  // Try to extract Claude session ID
  if (terminal.isClaudeMode && !terminal.claudeSessionId) {
    const sessionId = OutputParser.extractClaudeSessionId(data);
    if (sessionId) {
      callbacks.onClaudeSessionId(terminal, sessionId);
    }
  }

  // Check for rate limit messages
  if (terminal.isClaudeMode) {
    callbacks.onRateLimit(terminal, data);
  }

  // Check for OAuth token
  callbacks.onOAuthToken(terminal, data);

  // Check for onboarding complete (after login, Claude shows ready state)
  callbacks.onOnboardingComplete(terminal, data);

  // Detect Claude busy state changes (only when in Claude mode)
  if (terminal.isClaudeMode) {
    const busyState = OutputParser.detectClaudeBusyState(data);
    if (busyState !== null) {
      const isBusy = busyState === 'busy';
      const lastState = lastBusyState.get(terminal.id);

      // Only emit if state actually changed
      if (lastState !== isBusy) {
        lastBusyState.set(terminal.id, isBusy);
        callbacks.onClaudeBusyChange(terminal, isBusy);
      }
    }

    // Detect Claude exit (returned to shell prompt)
    // Only check if not busy - busy output takes precedence
    if (busyState !== 'busy' && OutputParser.detectClaudeExit(data)) {
      callbacks.onClaudeExit(terminal);
      // Clear busy state tracking since Claude has exited
      lastBusyState.delete(terminal.id);
    }
  }
}

/**
 * Clear busy state tracking for a terminal (call on terminal destruction)
 */
export function clearBusyState(terminalId: string): void {
  lastBusyState.delete(terminalId);
}

/**
 * Create event handler callbacks from TerminalManager context
 */
export function createEventCallbacks(
  getWindow: WindowGetter,
  lastNotifiedRateLimitReset: Map<string, string>,
  switchProfileCallback: (terminalId: string, profileId: string) => Promise<void>
): EventHandlerCallbacks {
  return {
    onClaudeSessionId: (terminal, sessionId) => {
      ClaudeIntegration.handleClaudeSessionId(terminal, sessionId, getWindow);
    },
    onRateLimit: (terminal, data) => {
      ClaudeIntegration.handleRateLimit(
        terminal,
        data,
        lastNotifiedRateLimitReset,
        getWindow,
        switchProfileCallback
      );
    },
    onOAuthToken: (terminal, data) => {
      ClaudeIntegration.handleOAuthToken(terminal, data, getWindow);
    },
    onOnboardingComplete: (terminal, data) => {
      ClaudeIntegration.handleOnboardingComplete(terminal, data, getWindow);
    },
    onClaudeBusyChange: (terminal, isBusy) => {
      safeSendToRenderer(getWindow, IPC_CHANNELS.TERMINAL_CLAUDE_BUSY, terminal.id, isBusy);
    },
    onClaudeExit: (terminal) => {
      ClaudeIntegration.handleClaudeExit(terminal, getWindow);
    }
  };
}
