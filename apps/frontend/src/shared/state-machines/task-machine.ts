import { assign, createMachine } from 'xstate';
import type { ReviewReason } from '../types';

export interface TaskContext {
  reviewReason?: ReviewReason;
  error?: string;
}

export type TaskEvent =
  | { type: 'PLANNING_STARTED' }
  | {
      type: 'PLANNING_COMPLETE';
      hasSubtasks: boolean;
      subtaskCount: number;
      requireReviewBeforeCoding: boolean;
    }
  | { type: 'PLAN_APPROVED' }
  | { type: 'CODING_STARTED'; subtaskId: string; subtaskDescription: string }
  | { type: 'SUBTASK_COMPLETED'; subtaskId: string; completedCount: number; totalCount: number }
  | { type: 'ALL_SUBTASKS_DONE'; totalCount: number }
  | { type: 'QA_STARTED'; iteration: number; maxIterations: number }
  | { type: 'QA_PASSED'; iteration: number; testsRun: Record<string, unknown> }
  | { type: 'QA_FAILED'; iteration: number; issueCount: number; issues: string[] }
  | { type: 'QA_FIXING_STARTED'; iteration: number }
  | { type: 'QA_FIXING_COMPLETE'; iteration: number }
  | { type: 'PLANNING_FAILED'; error: string; recoverable: boolean }
  | { type: 'CODING_FAILED'; subtaskId: string; error: string; attemptCount: number }
  | { type: 'QA_MAX_ITERATIONS'; iteration: number; maxIterations: number }
  | { type: 'QA_AGENT_ERROR'; iteration: number; consecutiveErrors: number }
  | { type: 'PROCESS_EXITED'; exitCode: number; signal?: string; unexpected?: boolean }
  | { type: 'USER_STOPPED'; hasPlan?: boolean }
  | { type: 'USER_RESUMED' }
  | { type: 'MARK_DONE' }
  | { type: 'CREATE_PR' }
  | { type: 'PR_CREATED'; prUrl: string };

export const taskMachine = createMachine(
  {
    id: 'task',
    initial: 'backlog',
    types: {} as {
      context: TaskContext;
      events: TaskEvent;
    },
    context: {
      reviewReason: undefined,
      error: undefined
    },
    states: {
      backlog: {
        on: {
          PLANNING_STARTED: 'planning',
          // Fallback: if coding starts from backlog (e.g., resumed task), go to coding
          CODING_STARTED: 'coding',
          USER_STOPPED: 'backlog'
        }
      },
      planning: {
        on: {
          PLANNING_COMPLETE: [
            {
              target: 'plan_review',
              guard: 'requiresReview',
              actions: 'setReviewReasonPlan'
            },
            { target: 'coding', actions: 'clearReviewReason' }
          ],
          // Fallback: if CODING_STARTED arrives while in planning, transition to coding
          CODING_STARTED: { target: 'coding', actions: 'clearReviewReason' },
          // Fallback: if ALL_SUBTASKS_DONE arrives while in planning, go directly to qa_review
          ALL_SUBTASKS_DONE: 'qa_review',
          // Fallback: if QA_STARTED arrives while in planning, go to qa_review
          QA_STARTED: 'qa_review',
          // Fallback: if QA_PASSED arrives while in planning (entire build completed), go to human_review
          QA_PASSED: { target: 'human_review', actions: 'setReviewReasonCompleted' },
          PLANNING_FAILED: { target: 'error', actions: ['setReviewReasonErrors', 'setError'] },
          USER_STOPPED: [
            { target: 'backlog', guard: 'noPlanYet', actions: 'clearReviewReason' },
            { target: 'human_review', actions: 'setReviewReasonStopped' }
          ],
          PROCESS_EXITED: { target: 'error', guard: 'unexpectedExit', actions: 'setReviewReasonErrors' }
        }
      },
      plan_review: {
        on: {
          PLAN_APPROVED: { target: 'coding', actions: 'clearReviewReason' },
          USER_STOPPED: { target: 'backlog', actions: 'clearReviewReason' },
          PROCESS_EXITED: { target: 'error', guard: 'unexpectedExit', actions: 'setReviewReasonErrors' }
        }
      },
      coding: {
        on: {
          QA_STARTED: 'qa_review',
          // ALL_SUBTASKS_DONE means coder finished but QA hasn't started yet
          // Transition to qa_review - QA will emit QA_PASSED or QA_FAILED
          ALL_SUBTASKS_DONE: 'qa_review',
          // Fallback: if QA_PASSED arrives while still in coding (missed QA_STARTED), go to human_review
          QA_PASSED: { target: 'human_review', actions: 'setReviewReasonCompleted' },
          CODING_FAILED: { target: 'error', actions: ['setReviewReasonErrors', 'setError'] },
          USER_STOPPED: { target: 'human_review', actions: 'setReviewReasonStopped' },
          PROCESS_EXITED: { target: 'error', guard: 'unexpectedExit', actions: 'setReviewReasonErrors' }
        }
      },
      qa_review: {
        on: {
          QA_FAILED: 'qa_fixing',
          QA_PASSED: { target: 'human_review', actions: 'setReviewReasonCompleted' },
          QA_MAX_ITERATIONS: { target: 'error', actions: 'setReviewReasonErrors' },
          QA_AGENT_ERROR: { target: 'error', actions: 'setReviewReasonErrors' },
          USER_STOPPED: { target: 'human_review', actions: 'setReviewReasonStopped' },
          PROCESS_EXITED: { target: 'error', guard: 'unexpectedExit', actions: 'setReviewReasonErrors' }
        }
      },
      qa_fixing: {
        on: {
          QA_FIXING_COMPLETE: 'qa_review',
          QA_FAILED: { target: 'human_review', actions: 'setReviewReasonQaRejected' },
          QA_PASSED: { target: 'human_review', actions: 'setReviewReasonCompleted' },
          QA_MAX_ITERATIONS: { target: 'error', actions: 'setReviewReasonErrors' },
          QA_AGENT_ERROR: { target: 'error', actions: 'setReviewReasonErrors' },
          USER_STOPPED: { target: 'human_review', actions: 'setReviewReasonStopped' },
          PROCESS_EXITED: { target: 'error', guard: 'unexpectedExit', actions: 'setReviewReasonErrors' }
        }
      },
      human_review: {
        on: {
          CREATE_PR: 'creating_pr',
          MARK_DONE: 'done',
          USER_RESUMED: { target: 'coding', actions: 'clearReviewReason' },
          // Allow restarting planning from human_review (e.g., incomplete task with no subtasks)
          PLANNING_STARTED: { target: 'planning', actions: 'clearReviewReason' }
        }
      },
      error: {
        on: {
          USER_RESUMED: { target: 'coding', actions: 'clearReviewReason' },
          // Allow restarting from error back to planning (e.g., spec creation crashed)
          PLANNING_STARTED: { target: 'planning', actions: 'clearReviewReason' },
          MARK_DONE: 'done'
        }
      },
      creating_pr: {
        on: {
          PR_CREATED: 'pr_created'
        }
      },
      pr_created: {
        on: {
          MARK_DONE: 'done'
        }
      },
      done: {
        type: 'final'
      }
    }
  },
  {
    guards: {
      requiresReview: ({ event }) =>
        event.type === 'PLANNING_COMPLETE' && event.requireReviewBeforeCoding === true,
      noPlanYet: ({ event }) => event.type === 'USER_STOPPED' && event.hasPlan === false,
      unexpectedExit: ({ event }) => event.type === 'PROCESS_EXITED' && event.unexpected === true
    },
    actions: {
      setReviewReasonPlan: assign({ reviewReason: () => 'plan_review' }),
      setReviewReasonCompleted: assign({ reviewReason: () => 'completed' }),
      setReviewReasonStopped: assign({ reviewReason: () => 'stopped' }),
      setReviewReasonQaRejected: assign({ reviewReason: () => 'qa_rejected' }),
      setReviewReasonErrors: assign({ reviewReason: () => 'errors' }),
      clearReviewReason: assign({ reviewReason: () => undefined, error: () => undefined }),
      setError: assign({
        error: ({ event }) => {
          if (event.type === 'PLANNING_FAILED') {
            return event.error;
          }
          if (event.type === 'CODING_FAILED') {
            return event.error;
          }
          return undefined;
        }
      })
    }
  }
);
