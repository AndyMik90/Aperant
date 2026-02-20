import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { terminalMachine, type TerminalEvent, type TerminalContext } from '../terminal-machine';

/**
 * Helper to run a sequence of events and get the final snapshot.
 * Optionally starts from a restored state with given context.
 */
function runEvents(
  events: TerminalEvent[],
  initialState?: string,
  initialContext?: Partial<TerminalContext>
) {
  const actor = initialState
    ? createActor(terminalMachine, {
        snapshot: terminalMachine.resolveState({
          value: initialState,
          context: {
            claudeSessionId: undefined,
            profileId: undefined,
            swapTargetProfileId: undefined,
            swapPhase: undefined,
            isBusy: false,
            error: undefined,
            ...initialContext,
          },
        }),
      })
    : createActor(terminalMachine);
  actor.start();

  for (const event of events) {
    actor.send(event);
  }

  const snapshot = actor.getSnapshot();
  actor.stop();
  return snapshot;
}

describe('terminalMachine', () => {
  describe('initial state', () => {
    it('should start in idle state', () => {
      const actor = createActor(terminalMachine);
      actor.start();
      expect(actor.getSnapshot().value).toBe('idle');
      actor.stop();
    });

    it('should have default context initially', () => {
      const actor = createActor(terminalMachine);
      actor.start();
      const { context } = actor.getSnapshot();
      expect(context.claudeSessionId).toBeUndefined();
      expect(context.profileId).toBeUndefined();
      expect(context.swapTargetProfileId).toBeUndefined();
      expect(context.swapPhase).toBeUndefined();
      expect(context.isBusy).toBe(false);
      expect(context.error).toBeUndefined();
      actor.stop();
    });
  });

  describe('happy path: idle → shell_ready → claude_active → exited', () => {
    it('should transition from idle to shell_ready', () => {
      const snapshot = runEvents([{ type: 'SHELL_READY' }]);
      expect(snapshot.value).toBe('shell_ready');
    });

    it('should transition from shell_ready to claude_starting', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
      ]);
      expect(snapshot.value).toBe('claude_starting');
      expect(snapshot.context.profileId).toBe('profile-1');
    });

    it('should transition from shell_ready directly to claude_active on CLAUDE_ACTIVE', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-direct' },
      ]);
      expect(snapshot.value).toBe('claude_active');
      expect(snapshot.context.claudeSessionId).toBe('session-direct');
    });

    it('should transition from claude_starting to claude_active', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
      ]);
      expect(snapshot.value).toBe('claude_active');
      expect(snapshot.context.claudeSessionId).toBe('session-1');
    });

    it('should transition from claude_active to shell_ready on CLAUDE_EXITED', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
        { type: 'CLAUDE_EXITED' },
      ]);
      expect(snapshot.value).toBe('shell_ready');
      expect(snapshot.context.claudeSessionId).toBeUndefined();
      expect(snapshot.context.isBusy).toBe(false);
    });

    it('should transition to exited on SHELL_EXITED from claude_active', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
        { type: 'SHELL_EXITED', exitCode: 0 },
      ]);
      expect(snapshot.value).toBe('exited');
      expect(snapshot.context.claudeSessionId).toBeUndefined();
    });

    it('should complete full lifecycle: idle → shell_ready → claude_active → exited', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
        { type: 'SHELL_EXITED' },
      ]);
      expect(snapshot.value).toBe('exited');
    });
  });

  describe('swap flow: claude_active → swapping → claude_active', () => {
    const toClaudeActive: TerminalEvent[] = [
      { type: 'SHELL_READY' },
      { type: 'CLAUDE_START', profileId: 'profile-1' },
      { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
    ];

    it('should transition to swapping on SWAP_INITIATED with active session', () => {
      const snapshot = runEvents([
        ...toClaudeActive,
        { type: 'SWAP_INITIATED', targetProfileId: 'profile-2' },
      ]);
      expect(snapshot.value).toBe('swapping');
      expect(snapshot.context.swapTargetProfileId).toBe('profile-2');
      expect(snapshot.context.swapPhase).toBe('capturing');
    });

    it('should progress through swap phases', () => {
      const snapshot = runEvents([
        ...toClaudeActive,
        { type: 'SWAP_INITIATED', targetProfileId: 'profile-2' },
        { type: 'SWAP_SESSION_CAPTURED', claudeSessionId: 'captured-session' },
      ]);
      expect(snapshot.value).toBe('swapping');
      expect(snapshot.context.swapPhase).toBe('migrating');
      expect(snapshot.context.claudeSessionId).toBe('captured-session');
    });

    it('should progress to recreating phase', () => {
      const snapshot = runEvents([
        ...toClaudeActive,
        { type: 'SWAP_INITIATED', targetProfileId: 'profile-2' },
        { type: 'SWAP_SESSION_CAPTURED', claudeSessionId: 'captured-session' },
        { type: 'SWAP_MIGRATED' },
      ]);
      expect(snapshot.context.swapPhase).toBe('recreating');
    });

    it('should progress to resuming phase', () => {
      const snapshot = runEvents([
        ...toClaudeActive,
        { type: 'SWAP_INITIATED', targetProfileId: 'profile-2' },
        { type: 'SWAP_SESSION_CAPTURED', claudeSessionId: 'captured-session' },
        { type: 'SWAP_MIGRATED' },
        { type: 'SWAP_TERMINAL_RECREATED' },
      ]);
      expect(snapshot.context.swapPhase).toBe('resuming');
    });

    it('should return to claude_active after successful swap', () => {
      const snapshot = runEvents([
        ...toClaudeActive,
        { type: 'SWAP_INITIATED', targetProfileId: 'profile-2' },
        { type: 'SWAP_SESSION_CAPTURED', claudeSessionId: 'captured-session' },
        { type: 'SWAP_MIGRATED' },
        { type: 'SWAP_TERMINAL_RECREATED' },
        {
          type: 'SWAP_RESUME_COMPLETE',
          claudeSessionId: 'new-session',
          profileId: 'profile-2',
        },
      ]);
      expect(snapshot.value).toBe('claude_active');
      expect(snapshot.context.claudeSessionId).toBe('new-session');
      expect(snapshot.context.profileId).toBe('profile-2');
      expect(snapshot.context.swapTargetProfileId).toBeUndefined();
      expect(snapshot.context.swapPhase).toBeUndefined();
      expect(snapshot.context.isBusy).toBe(false);
      expect(snapshot.context.error).toBeUndefined();
    });
  });

  describe('failed swap: swapping → shell_ready with error', () => {
    const toSwapping: TerminalEvent[] = [
      { type: 'SHELL_READY' },
      { type: 'CLAUDE_START', profileId: 'profile-1' },
      { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
      { type: 'SWAP_INITIATED', targetProfileId: 'profile-2' },
    ];

    it('should transition to shell_ready on SWAP_FAILED', () => {
      const snapshot = runEvents([
        ...toSwapping,
        { type: 'SWAP_FAILED', error: 'Swap error' },
      ]);
      expect(snapshot.value).toBe('shell_ready');
      expect(snapshot.context.error).toBe('Swap error');
      expect(snapshot.context.swapTargetProfileId).toBeUndefined();
      expect(snapshot.context.swapPhase).toBeUndefined();
    });

    it('should transition to exited on SHELL_EXITED during swap', () => {
      const snapshot = runEvents([
        ...toSwapping,
        { type: 'SHELL_EXITED', exitCode: 1 },
      ]);
      expect(snapshot.value).toBe('exited');
      expect(snapshot.context.swapTargetProfileId).toBeUndefined();
      expect(snapshot.context.swapPhase).toBeUndefined();
      expect(snapshot.context.claudeSessionId).toBeUndefined();
    });
  });

  describe('deferred resume: pending_resume → claude_active', () => {
    it('should transition from shell_ready to pending_resume on RESUME_REQUESTED', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'RESUME_REQUESTED', claudeSessionId: 'session-1' },
      ]);
      expect(snapshot.value).toBe('pending_resume');
      expect(snapshot.context.claudeSessionId).toBe('session-1');
    });

    it('should transition from claude_active to pending_resume on RESUME_REQUESTED', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
        { type: 'RESUME_REQUESTED', claudeSessionId: 'session-2' },
      ]);
      expect(snapshot.value).toBe('pending_resume');
      expect(snapshot.context.claudeSessionId).toBe('session-2');
    });

    it('should transition to claude_active on RESUME_COMPLETE', () => {
      const snapshot = runEvents(
        [{ type: 'RESUME_COMPLETE', claudeSessionId: 'resumed-session' }],
        'pending_resume',
        { claudeSessionId: 'old-session', profileId: 'profile-1' }
      );
      expect(snapshot.value).toBe('claude_active');
      expect(snapshot.context.claudeSessionId).toBe('resumed-session');
    });

    it('should transition to shell_ready on RESUME_FAILED', () => {
      const snapshot = runEvents(
        [{ type: 'RESUME_FAILED', error: 'Resume failed' }],
        'pending_resume',
        { claudeSessionId: 'old-session', profileId: 'profile-1' }
      );
      expect(snapshot.value).toBe('shell_ready');
      expect(snapshot.context.error).toBe('Resume failed');
      expect(snapshot.context.claudeSessionId).toBeUndefined();
    });

    it('should transition to claude_active on CLAUDE_ACTIVE (race condition)', () => {
      const snapshot = runEvents(
        [{ type: 'CLAUDE_ACTIVE', claudeSessionId: 'race-session' }],
        'pending_resume',
        { claudeSessionId: 'old-session', profileId: 'profile-1' }
      );
      expect(snapshot.value).toBe('claude_active');
      expect(snapshot.context.claudeSessionId).toBe('race-session');
    });

    it('should transition to exited on SHELL_EXITED from pending_resume', () => {
      const snapshot = runEvents(
        [{ type: 'SHELL_EXITED' }],
        'pending_resume'
      );
      expect(snapshot.value).toBe('exited');
    });

    it('should reset from pending_resume', () => {
      const snapshot = runEvents(
        [{ type: 'RESET' }],
        'pending_resume',
        { claudeSessionId: 'session-1', profileId: 'profile-1' }
      );
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.claudeSessionId).toBeUndefined();
      expect(snapshot.context.profileId).toBeUndefined();
    });
  });

  describe('invalid transitions rejected', () => {
    it('should not allow SWAP_INITIATED from idle', () => {
      const snapshot = runEvents([
        { type: 'SWAP_INITIATED', targetProfileId: 'profile-2' },
      ]);
      expect(snapshot.value).toBe('idle');
    });

    it('should not allow SWAP_INITIATED from shell_ready', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'SWAP_INITIATED', targetProfileId: 'profile-2' },
      ]);
      expect(snapshot.value).toBe('shell_ready');
    });

    it('should not allow CLAUDE_START from idle', () => {
      const snapshot = runEvents([
        { type: 'CLAUDE_START', profileId: 'profile-1' },
      ]);
      expect(snapshot.value).toBe('idle');
    });

    it('should not allow CLAUDE_ACTIVE from idle', () => {
      const snapshot = runEvents([
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
      ]);
      expect(snapshot.value).toBe('idle');
    });

    it('should not allow SWAP_INITIATED from claude_starting', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'SWAP_INITIATED', targetProfileId: 'profile-2' },
      ]);
      expect(snapshot.value).toBe('claude_starting');
    });

    it('should not allow RESUME_COMPLETE from claude_active', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
        { type: 'RESUME_COMPLETE', claudeSessionId: 'session-2' },
      ]);
      expect(snapshot.value).toBe('claude_active');
      expect(snapshot.context.claudeSessionId).toBe('session-1');
    });
  });

  describe('CLAUDE_ACTIVE self-transition in claude_active', () => {
    it('should update claudeSessionId via self-transition', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_ACTIVE' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'late-session' },
      ]);
      expect(snapshot.value).toBe('claude_active');
      expect(snapshot.context.claudeSessionId).toBe('late-session');
    });
  });

  describe('context mutations', () => {
    it('should set profileId on CLAUDE_START', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'my-profile' },
      ]);
      expect(snapshot.context.profileId).toBe('my-profile');
    });

    it('should set claudeSessionId on CLAUDE_ACTIVE', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-abc' },
      ]);
      expect(snapshot.context.claudeSessionId).toBe('session-abc');
    });

    it('should set isBusy on CLAUDE_BUSY', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
        { type: 'CLAUDE_BUSY', isBusy: true },
      ]);
      expect(snapshot.context.isBusy).toBe(true);
    });

    it('should unset isBusy on CLAUDE_BUSY false', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
        { type: 'CLAUDE_BUSY', isBusy: true },
        { type: 'CLAUDE_BUSY', isBusy: false },
      ]);
      expect(snapshot.context.isBusy).toBe(false);
    });

    it('should clear error on CLAUDE_START', () => {
      const snapshot = runEvents(
        [{ type: 'CLAUDE_START', profileId: 'profile-1' }],
        'shell_ready',
        { error: 'previous error' }
      );
      expect(snapshot.context.error).toBeUndefined();
    });

    it('should set error on CLAUDE_EXITED with error', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_EXITED', error: 'crash' },
      ]);
      expect(snapshot.value).toBe('shell_ready');
      expect(snapshot.context.error).toBe('crash');
    });

    it('should clear session on CLAUDE_EXITED', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
        { type: 'CLAUDE_EXITED' },
      ]);
      expect(snapshot.context.claudeSessionId).toBeUndefined();
      expect(snapshot.context.isBusy).toBe(false);
    });

    it('should set error on CLAUDE_EXITED with error from claude_active', () => {
      const snapshot = runEvents([
        { type: 'SHELL_READY' },
        { type: 'CLAUDE_START', profileId: 'profile-1' },
        { type: 'CLAUDE_ACTIVE', claudeSessionId: 'session-1' },
        { type: 'CLAUDE_EXITED', error: 'crash while active' },
      ]);
      expect(snapshot.value).toBe('shell_ready');
      expect(snapshot.context.error).toBe('crash while active');
      expect(snapshot.context.claudeSessionId).toBeUndefined();
    });

    it('should clear error on SHELL_READY from exited', () => {
      const snapshot = runEvents(
        [{ type: 'SHELL_READY' }],
        'exited',
        { error: 'old error' }
      );
      expect(snapshot.value).toBe('shell_ready');
      expect(snapshot.context.error).toBeUndefined();
    });
  });

  describe('guard conditions', () => {
    it('should not allow SWAP_INITIATED without active session', () => {
      const snapshot = runEvents(
        [{ type: 'SWAP_INITIATED', targetProfileId: 'profile-2' }],
        'claude_active',
        { claudeSessionId: undefined }
      );
      expect(snapshot.value).toBe('claude_active');
    });

    it('should allow SWAP_INITIATED with active session', () => {
      const snapshot = runEvents(
        [{ type: 'SWAP_INITIATED', targetProfileId: 'profile-2' }],
        'claude_active',
        { claudeSessionId: 'session-1' }
      );
      expect(snapshot.value).toBe('swapping');
    });
  });

  describe('RESET from all states', () => {
    const states = [
      'idle',
      'shell_ready',
      'claude_starting',
      'claude_active',
      'swapping',
      'pending_resume',
      'exited',
    ];

    for (const state of states) {
      it(`should reset to idle from ${state}`, () => {
        const snapshot = runEvents(
          [{ type: 'RESET' }],
          state,
          {
            claudeSessionId: 'session-1',
            profileId: 'profile-1',
            isBusy: true,
            error: 'err',
            swapTargetProfileId: 'profile-2',
            swapPhase: 'migrating'
          }
        );
        expect(snapshot.value).toBe('idle');
        expect(snapshot.context.claudeSessionId).toBeUndefined();
        expect(snapshot.context.profileId).toBeUndefined();
        expect(snapshot.context.isBusy).toBe(false);
        expect(snapshot.context.error).toBeUndefined();
        expect(snapshot.context.swapTargetProfileId).toBeUndefined();
        expect(snapshot.context.swapPhase).toBeUndefined();
      });
    }
  });

  describe('state restoration from snapshot', () => {
    it('should restore claude_active state with context', () => {
      const actor = createActor(terminalMachine, {
        snapshot: terminalMachine.resolveState({
          value: 'claude_active',
          context: {
            claudeSessionId: 'restored-session',
            profileId: 'restored-profile',
            swapTargetProfileId: undefined,
            swapPhase: undefined,
            isBusy: true,
            error: undefined,
          },
        }),
      });
      actor.start();
      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('claude_active');
      expect(snapshot.context.claudeSessionId).toBe('restored-session');
      expect(snapshot.context.profileId).toBe('restored-profile');
      expect(snapshot.context.isBusy).toBe(true);
      actor.stop();
    });

    it('should restore swapping state and complete swap', () => {
      const snapshot = runEvents(
        [
          {
            type: 'SWAP_RESUME_COMPLETE',
            claudeSessionId: 'new-session',
            profileId: 'profile-2',
          },
        ],
        'swapping',
        {
          claudeSessionId: 'old-session',
          profileId: 'profile-1',
          swapTargetProfileId: 'profile-2',
          swapPhase: 'resuming',
        }
      );
      expect(snapshot.value).toBe('claude_active');
      expect(snapshot.context.profileId).toBe('profile-2');
      expect(snapshot.context.claudeSessionId).toBe('new-session');
    });

    it('should restore pending_resume and complete resume', () => {
      const snapshot = runEvents(
        [{ type: 'RESUME_COMPLETE', claudeSessionId: 'resumed-session' }],
        'pending_resume',
        { claudeSessionId: 'stale-session', profileId: 'profile-1' }
      );
      expect(snapshot.value).toBe('claude_active');
      expect(snapshot.context.claudeSessionId).toBe('resumed-session');
    });

    it('should restore exited state and restart', () => {
      const snapshot = runEvents(
        [{ type: 'SHELL_READY' }],
        'exited'
      );
      expect(snapshot.value).toBe('shell_ready');
    });
  });
});
