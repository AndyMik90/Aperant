import { assign, createMachine } from 'xstate';
import type { PRReviewProgress, PRReviewResult } from '../../preload/api/modules/github-api';

export interface PRReviewContext {
  prNumber: number | null;
  projectId: string | null;
  startedAt: string | null;
  isFollowup: boolean;
  progress: PRReviewProgress | null;
  result: PRReviewResult | null;
  previousResult: PRReviewResult | null;
  error: string | null;
  isExternalReview: boolean;
}

export type PRReviewEvent =
  | { type: 'START_REVIEW'; prNumber: number; projectId: string }
  | { type: 'START_FOLLOWUP_REVIEW'; prNumber: number; projectId: string; previousResult: PRReviewResult }
  | { type: 'SET_PROGRESS'; progress: PRReviewProgress }
  | { type: 'REVIEW_COMPLETE'; result: PRReviewResult }
  | { type: 'REVIEW_ERROR'; error: string }
  | { type: 'CANCEL_REVIEW' }
  | { type: 'DETECT_EXTERNAL_REVIEW' }
  | { type: 'CLEAR_REVIEW' };

const initialContext: PRReviewContext = {
  prNumber: null,
  projectId: null,
  startedAt: null,
  isFollowup: false,
  progress: null,
  result: null,
  previousResult: null,
  error: null,
  isExternalReview: false,
};

export const prReviewMachine = createMachine(
  {
    id: 'prReview',
    initial: 'idle',
    types: {} as {
      context: PRReviewContext;
      events: PRReviewEvent;
    },
    context: { ...initialContext },
    states: {
      idle: {
        on: {
          START_REVIEW: {
            target: 'reviewing',
            actions: 'setReviewStart',
          },
          START_FOLLOWUP_REVIEW: {
            target: 'reviewing',
            actions: 'setFollowupReviewStart',
          },
        },
      },
      reviewing: {
        on: {
          SET_PROGRESS: {
            actions: 'setProgress',
          },
          REVIEW_COMPLETE: {
            target: 'completed',
            actions: 'setResult',
          },
          REVIEW_ERROR: {
            target: 'error',
            actions: 'setError',
          },
          CANCEL_REVIEW: {
            target: 'error',
            actions: 'setCancelledError',
          },
          CLEAR_REVIEW: {
            target: 'idle',
            actions: 'clearContext',
          },
          DETECT_EXTERNAL_REVIEW: {
            target: 'externalReview',
            actions: 'setExternalReview',
          },
        },
      },
      externalReview: {
        on: {
          REVIEW_COMPLETE: {
            target: 'completed',
            actions: 'setResult',
          },
          REVIEW_ERROR: {
            target: 'error',
            actions: 'setError',
          },
          CANCEL_REVIEW: {
            target: 'error',
            actions: 'setCancelledError',
          },
          CLEAR_REVIEW: {
            target: 'idle',
            actions: 'clearContext',
          },
        },
      },
      completed: {
        on: {
          START_REVIEW: {
            target: 'reviewing',
            actions: 'setReviewStart',
          },
          START_FOLLOWUP_REVIEW: {
            target: 'reviewing',
            actions: 'setFollowupReviewStart',
          },
          REVIEW_COMPLETE: {
            actions: 'setResult',
          },
          CLEAR_REVIEW: {
            target: 'idle',
            actions: 'clearContext',
          },
        },
      },
      error: {
        on: {
          START_REVIEW: {
            target: 'reviewing',
            actions: 'setReviewStart',
          },
          START_FOLLOWUP_REVIEW: {
            target: 'reviewing',
            actions: 'setFollowupReviewStart',
          },
          CLEAR_REVIEW: {
            target: 'idle',
            actions: 'clearContext',
          },
        },
      },
    },
  },
  {
    actions: {
      setReviewStart: assign({
        prNumber: ({ event }) => (event as { prNumber: number }).prNumber,
        projectId: ({ event }) => (event as { projectId: string }).projectId,
        startedAt: () => new Date().toISOString(),
        isFollowup: () => false,
        progress: () => null,
        result: () => null,
        previousResult: () => null,
        error: () => null,
        isExternalReview: () => false,
      }),
      setFollowupReviewStart: assign({
        prNumber: ({ event }) => (event as { prNumber: number }).prNumber,
        projectId: ({ event }) => (event as { projectId: string }).projectId,
        startedAt: () => new Date().toISOString(),
        isFollowup: () => true,
        progress: () => null,
        result: () => null,
        previousResult: ({ event }) => (event as { previousResult: PRReviewResult }).previousResult,
        error: () => null,
        isExternalReview: () => false,
      }),
      setProgress: assign({
        progress: ({ event }) => (event as { progress: PRReviewProgress }).progress,
      }),
      setResult: assign({
        result: ({ event }) => (event as { result: PRReviewResult }).result,
        progress: () => null,
      }),
      setError: assign({
        error: ({ event }) => (event as { error: string }).error,
        progress: () => null,
      }),
      setCancelledError: assign({
        error: () => 'Review cancelled by user',
        progress: () => null,
      }),
      setExternalReview: assign({
        isExternalReview: () => true,
        progress: () => null,
      }),
      clearContext: assign(() => ({ ...initialContext })),
    },
  }
);
