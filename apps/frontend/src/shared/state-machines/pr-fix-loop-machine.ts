import { assign, createMachine } from 'xstate';
import type {
  PRFixLoopOptions,
  PRFixLoopProgress,
  PRFixLoopResult,
  PRFixLoopState
} from '../../preload/api/modules/github-api';

type ActivePRFixLoopState = Exclude<
  PRFixLoopState,
  'idle' | 'done' | 'failed' | 'cancelled' | 'handoff_required'
>;

export interface PRFixLoopContext {
  prNumber: number | null;
  projectId: string | null;
  options: PRFixLoopOptions | null;
  startedAt: string | null;
  updatedAt: string | null;
  iteration: number;
  maxIterations: number;
  progress: PRFixLoopProgress | null;
  result: PRFixLoopResult | null;
  error: string | null;
  lastCommitSha: string | null;
  lastParentSha: string | null;
  lastAttemptSignature: string | null;
}

export type PRFixLoopEvent =
  | { type: 'START_FIX_LOOP'; prNumber: number; projectId: string; options?: PRFixLoopOptions }
  | {
      type: 'SET_PHASE_PROGRESS';
      phase: ActivePRFixLoopState;
      progress: PRFixLoopProgress;
      iteration?: number;
      maxIterations?: number;
      lastCommitSha?: string | null;
      lastParentSha?: string | null;
      lastAttemptSignature?: string | null;
    }
  | { type: 'FIX_COMPLETE'; result: PRFixLoopResult }
  | { type: 'FIX_FAILED_RESULT'; result: PRFixLoopResult }
  | { type: 'FIX_ERROR'; error: string }
  | { type: 'FIX_CANCELLED'; result?: PRFixLoopResult }
  | { type: 'FIX_HANDOFF'; result: PRFixLoopResult }
  | { type: 'CLEAR_FIX_LOOP' };

const initialContext: PRFixLoopContext = {
  prNumber: null,
  projectId: null,
  options: null,
  startedAt: null,
  updatedAt: null,
  iteration: 0,
  maxIterations: 0,
  progress: null,
  result: null,
  error: null,
  lastCommitSha: null,
  lastParentSha: null,
  lastAttemptSignature: null
};

const activeStateTransitions = {
  SET_PHASE_PROGRESS: [
    {
      guard: ({ event }: { event: PRFixLoopEvent }) =>
        event.type === 'SET_PHASE_PROGRESS' && event.phase === 'validating',
      target: 'validating',
      actions: 'setPhaseProgress'
    },
    {
      guard: ({ event }: { event: PRFixLoopEvent }) =>
        event.type === 'SET_PHASE_PROGRESS' && event.phase === 'fixing',
      target: 'fixing',
      actions: 'setPhaseProgress'
    },
    {
      guard: ({ event }: { event: PRFixLoopEvent }) =>
        event.type === 'SET_PHASE_PROGRESS' && event.phase === 'pushing',
      target: 'pushing',
      actions: 'setPhaseProgress'
    },
    {
      guard: ({ event }: { event: PRFixLoopEvent }) =>
        event.type === 'SET_PHASE_PROGRESS' && event.phase === 'followup_reviewing',
      target: 'followup_reviewing',
      actions: 'setPhaseProgress'
    },
    {
      guard: ({ event }: { event: PRFixLoopEvent }) =>
        event.type === 'SET_PHASE_PROGRESS' && event.phase === 'judging',
      target: 'judging',
      actions: 'setPhaseProgress'
    }
  ],
  FIX_COMPLETE: {
    target: 'done',
    actions: 'setResult'
  },
  FIX_FAILED_RESULT: {
    target: 'failed',
    actions: 'setResult'
  },
  FIX_ERROR: {
    target: 'failed',
    actions: 'setError'
  },
  FIX_CANCELLED: {
    target: 'cancelled',
    actions: 'setCancelledResult'
  },
  FIX_HANDOFF: {
    target: 'handoff_required',
    actions: 'setResult'
  },
  CLEAR_FIX_LOOP: {
    target: 'idle',
    actions: 'clearContext'
  }
} as const;

export const prFixLoopMachine = createMachine(
  {
    id: 'prFixLoop',
    initial: 'idle',
    types: {} as {
      context: PRFixLoopContext;
      events: PRFixLoopEvent;
    },
    context: { ...initialContext },
    states: {
      idle: {
        on: {
          START_FIX_LOOP: {
            target: 'validating',
            actions: 'setLoopStart'
          }
        }
      },
      validating: {
        on: activeStateTransitions
      },
      fixing: {
        on: activeStateTransitions
      },
      pushing: {
        on: activeStateTransitions
      },
      followup_reviewing: {
        on: activeStateTransitions
      },
      judging: {
        on: activeStateTransitions
      },
      done: {
        on: {
          START_FIX_LOOP: {
            target: 'validating',
            actions: 'setLoopStart'
          },
          CLEAR_FIX_LOOP: {
            target: 'idle',
            actions: 'clearContext'
          }
        }
      },
      failed: {
        on: {
          START_FIX_LOOP: {
            target: 'validating',
            actions: 'setLoopStart'
          },
          CLEAR_FIX_LOOP: {
            target: 'idle',
            actions: 'clearContext'
          }
        }
      },
      cancelled: {
        on: {
          START_FIX_LOOP: {
            target: 'validating',
            actions: 'setLoopStart'
          },
          CLEAR_FIX_LOOP: {
            target: 'idle',
            actions: 'clearContext'
          }
        }
      },
      handoff_required: {
        on: {
          START_FIX_LOOP: {
            target: 'validating',
            actions: 'setLoopStart'
          },
          CLEAR_FIX_LOOP: {
            target: 'idle',
            actions: 'clearContext'
          }
        }
      }
    }
  },
  {
    actions: {
      setLoopStart: assign({
        prNumber: ({ event }) => (event as Extract<PRFixLoopEvent, { type: 'START_FIX_LOOP' }>).prNumber,
        projectId: ({ event }) => (event as Extract<PRFixLoopEvent, { type: 'START_FIX_LOOP' }>).projectId,
        options: ({ event }) => (event as Extract<PRFixLoopEvent, { type: 'START_FIX_LOOP' }>).options ?? null,
        startedAt: () => new Date().toISOString(),
        updatedAt: () => new Date().toISOString(),
        iteration: () => 1,
        maxIterations: ({ event }) =>
          (event as Extract<PRFixLoopEvent, { type: 'START_FIX_LOOP' }>).options?.maxIterations ?? 3,
        progress: () => null,
        result: () => null,
        error: () => null,
        lastCommitSha: () => null,
        lastParentSha: () => null,
        lastAttemptSignature: () => null
      }),
      setPhaseProgress: assign({
        progress: ({ event }) => (event as Extract<PRFixLoopEvent, { type: 'SET_PHASE_PROGRESS' }>).progress,
        updatedAt: () => new Date().toISOString(),
        iteration: ({ context, event }) =>
          (event as Extract<PRFixLoopEvent, { type: 'SET_PHASE_PROGRESS' }>).iteration ?? context.iteration,
        maxIterations: ({ context, event }) =>
          (event as Extract<PRFixLoopEvent, { type: 'SET_PHASE_PROGRESS' }>).maxIterations ?? context.maxIterations,
        lastCommitSha: ({ context, event }) =>
          (event as Extract<PRFixLoopEvent, { type: 'SET_PHASE_PROGRESS' }>).lastCommitSha ?? context.lastCommitSha,
        lastParentSha: ({ context, event }) =>
          (event as Extract<PRFixLoopEvent, { type: 'SET_PHASE_PROGRESS' }>).lastParentSha ?? context.lastParentSha,
        lastAttemptSignature: ({ context, event }) =>
          (event as Extract<PRFixLoopEvent, { type: 'SET_PHASE_PROGRESS' }>).lastAttemptSignature ?? context.lastAttemptSignature
      }),
      setResult: assign({
        result: ({ event }) => {
          const resultEvent = event as Extract<
            PRFixLoopEvent,
            { type: 'FIX_COMPLETE' | 'FIX_FAILED_RESULT' | 'FIX_HANDOFF' }
          >;
          return resultEvent.result;
        },
        updatedAt: () => new Date().toISOString(),
        progress: () => null,
        error: ({ event }) => ('error' in event && event.error ? event.error : null),
        iteration: ({ context, event }) => {
          const resultEvent = event as Extract<
            PRFixLoopEvent,
            { type: 'FIX_COMPLETE' | 'FIX_FAILED_RESULT' | 'FIX_HANDOFF' }
          >;
          return resultEvent.result.iteration ?? context.iteration;
        },
        maxIterations: ({ context, event }) => {
          const resultEvent = event as Extract<
            PRFixLoopEvent,
            { type: 'FIX_COMPLETE' | 'FIX_FAILED_RESULT' | 'FIX_HANDOFF' }
          >;
          return resultEvent.result.maxIterations ?? context.maxIterations;
        },
        lastCommitSha: ({ context, event }) => {
          const resultEvent = event as Extract<
            PRFixLoopEvent,
            { type: 'FIX_COMPLETE' | 'FIX_FAILED_RESULT' | 'FIX_HANDOFF' }
          >;
          return resultEvent.result.lastCommitSha ?? context.lastCommitSha;
        },
        lastParentSha: ({ context, event }) => {
          const resultEvent = event as Extract<
            PRFixLoopEvent,
            { type: 'FIX_COMPLETE' | 'FIX_FAILED_RESULT' | 'FIX_HANDOFF' }
          >;
          return resultEvent.result.lastParentSha ?? context.lastParentSha;
        },
        lastAttemptSignature: ({ context, event }) => {
          const resultEvent = event as Extract<
            PRFixLoopEvent,
            { type: 'FIX_COMPLETE' | 'FIX_FAILED_RESULT' | 'FIX_HANDOFF' }
          >;
          return resultEvent.result.lastAttemptSignature ?? context.lastAttemptSignature;
        }
      }),
      setError: assign({
        error: ({ event }) => (event as Extract<PRFixLoopEvent, { type: 'FIX_ERROR' }>).error,
        updatedAt: () => new Date().toISOString(),
        progress: () => null,
        result: () => null
      }),
      setCancelledResult: assign({
        updatedAt: () => new Date().toISOString(),
        progress: () => null,
        error: () => 'Fix loop cancelled by user',
        result: ({ context, event }) =>
          (event as Extract<PRFixLoopEvent, { type: 'FIX_CANCELLED' }>).result ?? context.result
      }),
      clearContext: assign(() => ({ ...initialContext }))
    }
  }
);
