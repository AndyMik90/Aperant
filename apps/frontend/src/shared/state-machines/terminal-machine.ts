import { assign, createMachine } from 'xstate';

/**
 * Terminal lifecycle state machine context.
 *
 * Tracks Claude Code session state, profile swap progress,
 * and error information for a single terminal instance.
 */
export interface TerminalContext {
  claudeSessionId?: string;
  profileId?: string;
  swapTargetProfileId?: string;
  swapPhase?: 'capturing' | 'migrating' | 'recreating' | 'resuming';
  isBusy: boolean;
  error?: string;
}

/**
 * Discriminated union of all terminal lifecycle events.
 */
export type TerminalEvent =
  | { type: 'SHELL_READY' }
  | { type: 'CLAUDE_START'; profileId: string }
  | { type: 'CLAUDE_ACTIVE'; claudeSessionId?: string }
  | { type: 'CLAUDE_BUSY'; isBusy: boolean }
  | { type: 'CLAUDE_EXITED'; exitCode?: number; error?: string }
  | { type: 'SWAP_INITIATED'; targetProfileId: string }
  | { type: 'SWAP_SESSION_CAPTURED'; claudeSessionId: string }
  | { type: 'SWAP_MIGRATED' }
  | { type: 'SWAP_TERMINAL_RECREATED' }
  | { type: 'SWAP_RESUME_COMPLETE'; claudeSessionId?: string; profileId: string }
  | { type: 'SWAP_FAILED'; error: string }
  | { type: 'RESUME_REQUESTED'; claudeSessionId: string }
  | { type: 'RESUME_COMPLETE'; claudeSessionId?: string }
  | { type: 'RESUME_FAILED'; error: string }
  | { type: 'SHELL_EXITED'; exitCode?: number; signal?: string }
  | { type: 'RESET' };

export const terminalMachine = createMachine(
  {
    id: 'terminal',
    initial: 'idle',
    types: {} as {
      context: TerminalContext;
      events: TerminalEvent;
    },
    context: {
      claudeSessionId: undefined,
      profileId: undefined,
      swapTargetProfileId: undefined,
      swapPhase: undefined,
      isBusy: false,
      error: undefined,
    },
    states: {
      idle: {
        on: {
          SHELL_READY: 'shell_ready',
          RESET: { target: 'idle', actions: 'resetContext' },
        },
      },
      shell_ready: {
        on: {
          CLAUDE_START: { target: 'claude_starting', actions: 'setProfileId' },
          CLAUDE_ACTIVE: { target: 'claude_active', actions: 'setClaudeSessionId' },
          RESUME_REQUESTED: { target: 'pending_resume', actions: 'setClaudeSessionId' },
          SHELL_EXITED: { target: 'exited', actions: 'clearSession' },
          RESET: { target: 'idle', actions: 'resetContext' },
        },
      },
      claude_starting: {
        on: {
          CLAUDE_ACTIVE: { target: 'claude_active', actions: 'setClaudeSessionId' },
          CLAUDE_BUSY: { actions: 'setBusy' },
          CLAUDE_EXITED: { target: 'shell_ready', actions: ['setError', 'clearSession'] },
          SHELL_EXITED: { target: 'exited', actions: 'clearSession' },
          RESET: { target: 'idle', actions: 'resetContext' },
        },
      },
      claude_active: {
        on: {
          CLAUDE_ACTIVE: { actions: 'updateClaudeSessionId' },
          CLAUDE_BUSY: { actions: 'setBusy' },
          CLAUDE_EXITED: { target: 'shell_ready', actions: ['setError', 'clearSession'] },
          SWAP_INITIATED: {
            target: 'swapping',
            guard: 'hasActiveSession',
            actions: 'setSwapTarget',
          },
          RESUME_REQUESTED: { target: 'pending_resume', actions: 'setClaudeSessionId' },
          SHELL_EXITED: { target: 'exited', actions: 'clearSession' },
          RESET: { target: 'idle', actions: 'resetContext' },
        },
      },
      swapping: {
        on: {
          SWAP_SESSION_CAPTURED: {
            guard: 'isCapturingPhase',
            actions: ['setCapturedSession', 'setSwapPhaseMigrating'],
          },
          SWAP_MIGRATED: {
            guard: 'isMigratingPhase',
            actions: 'setSwapPhaseRecreating',
          },
          SWAP_TERMINAL_RECREATED: {
            guard: 'isRecreatingPhase',
            actions: 'setSwapPhaseResuming',
          },
          SWAP_RESUME_COMPLETE: {
            target: 'claude_active',
            guard: 'isResumingPhase',
            actions: 'applySwapComplete',
          },
          SWAP_FAILED: {
            target: 'shell_ready',
            actions: ['setError', 'clearSwapState'],
          },
          SHELL_EXITED: { target: 'exited', actions: ['clearSession', 'clearSwapState'] },
          RESET: { target: 'idle', actions: 'resetContext' },
        },
      },
      pending_resume: {
        on: {
          CLAUDE_ACTIVE: { target: 'claude_active', actions: 'setClaudeSessionId' },
          CLAUDE_BUSY: { actions: 'setBusy' },
          RESUME_COMPLETE: { target: 'claude_active', actions: 'setClaudeSessionId' },
          RESUME_FAILED: { target: 'shell_ready', actions: ['setError', 'clearSession'] },
          SHELL_EXITED: { target: 'exited', actions: 'clearSession' },
          RESET: { target: 'idle', actions: 'resetContext' },
        },
      },
      exited: {
        on: {
          SHELL_READY: { target: 'shell_ready', actions: 'clearError' },
          RESET: { target: 'idle', actions: 'resetContext' },
        },
      },
    },
  },
  {
    guards: {
      hasActiveSession: ({ context }) => context.claudeSessionId !== undefined,
      isCapturingPhase: ({ context }) => context.swapPhase === 'capturing',
      isMigratingPhase: ({ context }) => context.swapPhase === 'migrating',
      isRecreatingPhase: ({ context }) => context.swapPhase === 'recreating',
      isResumingPhase: ({ context }) => context.swapPhase === 'resuming',
    },
    actions: {
      setProfileId: assign({
        profileId: ({ event }) =>
          event.type === 'CLAUDE_START' ? event.profileId : undefined,
        error: () => undefined,
      }),
      setClaudeSessionId: assign({
        claudeSessionId: ({ event }) => {
          if (event.type === 'CLAUDE_ACTIVE') return event.claudeSessionId;
          if (event.type === 'RESUME_COMPLETE') return event.claudeSessionId;
          if (event.type === 'RESUME_REQUESTED') return event.claudeSessionId;
          return undefined;
        },
        // Clear isBusy when entering claude_active from another state
        isBusy: () => false,
        error: () => undefined,
      }),
      // Self-transition action for CLAUDE_ACTIVE within claude_active state:
      // Updates sessionId but preserves isBusy (avoids resetting busy indicator
      // when the session ID is refreshed without a state change)
      updateClaudeSessionId: assign({
        claudeSessionId: ({ event }) =>
          event.type === 'CLAUDE_ACTIVE' ? event.claudeSessionId : undefined,
        error: () => undefined,
      }),
      setBusy: assign({
        isBusy: ({ event }) =>
          event.type === 'CLAUDE_BUSY' ? event.isBusy : false,
      }),
      setError: assign({
        error: ({ event }) => {
          if (event.type === 'CLAUDE_EXITED') return event.error;
          if (event.type === 'SWAP_FAILED') return event.error;
          if (event.type === 'RESUME_FAILED') return event.error;
          return undefined;
        },
      }),
      clearError: assign({ error: () => undefined }),
      clearSession: assign({
        claudeSessionId: () => undefined,
        isBusy: () => false,
      }),
      setSwapTarget: assign({
        swapTargetProfileId: ({ event }) =>
          event.type === 'SWAP_INITIATED' ? event.targetProfileId : undefined,
        swapPhase: () => 'capturing' as const,
        error: () => undefined,
      }),
      setCapturedSession: assign({
        claudeSessionId: ({ event }) =>
          event.type === 'SWAP_SESSION_CAPTURED' ? event.claudeSessionId : undefined,
      }),
      setSwapPhaseMigrating: assign({ swapPhase: () => 'migrating' as const }),
      setSwapPhaseRecreating: assign({ swapPhase: () => 'recreating' as const }),
      setSwapPhaseResuming: assign({ swapPhase: () => 'resuming' as const }),
      applySwapComplete: assign({
        claudeSessionId: ({ event }) =>
          event.type === 'SWAP_RESUME_COMPLETE' ? event.claudeSessionId : undefined,
        profileId: ({ event }) =>
          event.type === 'SWAP_RESUME_COMPLETE' ? event.profileId : undefined,
        swapTargetProfileId: () => undefined,
        swapPhase: () => undefined,
        isBusy: () => false,
        error: () => undefined,
      }),
      clearSwapState: assign({
        swapTargetProfileId: () => undefined,
        swapPhase: () => undefined,
      }),
      resetContext: assign({
        claudeSessionId: () => undefined,
        profileId: () => undefined,
        swapTargetProfileId: () => undefined,
        swapPhase: () => undefined,
        isBusy: () => false,
        error: () => undefined,
      }),
    },
  }
);
