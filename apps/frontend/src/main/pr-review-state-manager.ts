import { createActor } from 'xstate';
import type { ActorRefFrom } from 'xstate';
import type { BrowserWindow } from 'electron';
import { prReviewMachine, type PRReviewEvent, type PRReviewContext } from '../shared/state-machines';
import type { PRReviewProgress, PRReviewResult, PRReviewStatePayload } from '../preload/api/modules/github-api';
import { IPC_CHANNELS } from '../shared/constants';
import { safeSendToRenderer } from './ipc-handlers/utils';

type PRReviewActor = ActorRefFrom<typeof prReviewMachine>;

/**
 * Build a deduplication key from snapshot state + relevant context fields.
 * PR reviews need to emit even when state stays the same but context changes
 * (e.g., progress updates within 'reviewing' state).
 */
function buildContextKey(snapshot: { context: PRReviewContext }): string {
  const ctx = snapshot.context;
  const progressKey = ctx.progress
    ? `${ctx.progress.phase}:${ctx.progress.progress}:${ctx.progress.message}`
    : 'none';
  const resultKey = ctx.result ? ctx.result.overallStatus : 'none';
  const errorKey = ctx.error ?? 'none';
  return `${progressKey}|${resultKey}|${errorKey}`;
}

export class PRReviewStateManager {
  private actors = new Map<string, PRReviewActor>();
  private lastStateByPR = new Map<string, string>();
  private getMainWindow: () => BrowserWindow | null;

  constructor(getMainWindow: () => BrowserWindow | null) {
    this.getMainWindow = getMainWindow;
  }

  handleStartReview(projectId: string, prNumber: number): void {
    const actor = this.getOrCreateActor(projectId, prNumber);
    actor.send({ type: 'START_REVIEW', prNumber, projectId } satisfies PRReviewEvent);
  }

  handleStartFollowupReview(projectId: string, prNumber: number, previousResult?: PRReviewResult): void {
    const actor = this.getOrCreateActor(projectId, prNumber);
    if (previousResult) {
      actor.send({ type: 'START_FOLLOWUP_REVIEW', prNumber, projectId, previousResult } satisfies PRReviewEvent);
    } else {
      actor.send({ type: 'START_REVIEW', prNumber, projectId } satisfies PRReviewEvent);
    }
  }

  handleProgress(projectId: string, prNumber: number, progress: PRReviewProgress): void {
    const actor = this.getActor(projectId, prNumber);
    if (!actor) return;
    actor.send({ type: 'SET_PROGRESS', progress } satisfies PRReviewEvent);
  }

  handleComplete(projectId: string, prNumber: number, result: PRReviewResult): void {
    // Use getOrCreateActor so late-arriving results (e.g. after auth change or
    // app restart) still get processed instead of silently dropped.
    const actor = this.getOrCreateActor(projectId, prNumber);

    // If the actor is in idle state (freshly created for a late-arriving result),
    // transition to reviewing first so REVIEW_COMPLETE is accepted.
    const snapshot = actor.getSnapshot();
    if (String(snapshot.value) === 'idle') {
      actor.send({ type: 'START_REVIEW', prNumber, projectId } satisfies PRReviewEvent);
    }

    // Detect external review (result arrives with 'in_progress' status from outside)
    if (result.overallStatus === 'in_progress') {
      actor.send({ type: 'DETECT_EXTERNAL_REVIEW' } satisfies PRReviewEvent);
    } else {
      actor.send({ type: 'REVIEW_COMPLETE', result } satisfies PRReviewEvent);
    }
  }

  handleError(projectId: string, prNumber: number, error: string): void {
    const actor = this.getActor(projectId, prNumber);
    if (!actor) return;
    actor.send({ type: 'REVIEW_ERROR', error } satisfies PRReviewEvent);
  }

  handleCancel(projectId: string, prNumber: number): void {
    const actor = this.getActor(projectId, prNumber);
    if (!actor) return;
    actor.send({ type: 'CANCEL_REVIEW' } satisfies PRReviewEvent);
  }

  handleClearReview(projectId: string, prNumber: number): void {
    const key = this.getKey(projectId, prNumber);
    const actor = this.actors.get(key);
    if (actor) {
      // Capture snapshot before stopping so the emitted payload has real context.
      // Don't send CLEAR_REVIEW to the actor — that would trigger the subscription
      // and cause a duplicate IPC emission alongside emitClearedState below.
      const snapshot = actor.getSnapshot();
      actor.stop();
      this.actors.delete(key);
      this.emitClearedState(key, snapshot?.context ?? null);
    }
    this.lastStateByPR.delete(key);
  }

  handleAuthChange(): void {
    for (const [key, actor] of this.actors) {
      // Capture the last known snapshot before stopping so the emitted payload
      // contains the real projectId/prNumber instead of zeros.
      const snapshot = actor.getSnapshot();
      actor.stop();
      // Emit cleared (idle) state to renderer for each PR
      this.emitClearedState(key, snapshot?.context ?? null);
    }
    this.actors.clear();
    this.lastStateByPR.clear();
  }

  getState(projectId: string, prNumber: number): ReturnType<PRReviewActor['getSnapshot']> | null {
    const actor = this.getActor(projectId, prNumber);
    if (!actor) return null;
    return actor.getSnapshot();
  }

  clearAll(): void {
    for (const [, actor] of this.actors) {
      actor.stop();
    }
    this.actors.clear();
    this.lastStateByPR.clear();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private getOrCreateActor(projectId: string, prNumber: number): PRReviewActor {
    const key = this.getKey(projectId, prNumber);
    const existing = this.actors.get(key);
    if (existing) return existing;

    const actor = createActor(prReviewMachine);

    actor.subscribe((snapshot) => {
      const stateValue = String(snapshot.value);
      const contextKey = buildContextKey(snapshot);
      const currentKey = `${stateValue}:${contextKey}`;
      if (this.lastStateByPR.get(key) === currentKey) return;
      this.lastStateByPR.set(key, currentKey);
      this.emitStateToRenderer(key, snapshot);
    });

    actor.start();
    this.actors.set(key, actor);
    return actor;
  }

  private getActor(projectId: string, prNumber: number): PRReviewActor | null {
    return this.actors.get(this.getKey(projectId, prNumber)) ?? null;
  }

  private getKey(projectId: string, prNumber: number): string {
    return `${projectId}:${prNumber}`;
  }

  private emitStateToRenderer(
    key: string,
    snapshot: ReturnType<PRReviewActor['getSnapshot']> | null
  ): void {
    const stateValue = snapshot ? String(snapshot.value) : 'idle';
    const ctx = snapshot?.context ?? null;

    const payload: PRReviewStatePayload = {
      state: stateValue,
      prNumber: ctx?.prNumber ?? 0,
      projectId: ctx?.projectId ?? '',
      isReviewing: stateValue === 'reviewing' || stateValue === 'externalReview',
      startedAt: ctx?.startedAt ?? null,
      progress: ctx?.progress ?? null,
      result: ctx?.result ?? null,
      previousResult: ctx?.previousResult ?? null,
      error: ctx?.error ?? null,
      isExternalReview: ctx?.isExternalReview ?? false,
      isFollowup: ctx?.isFollowup ?? false,
    };

    safeSendToRenderer(
      this.getMainWindow,
      IPC_CHANNELS.GITHUB_PR_REVIEW_STATE_CHANGE,
      key,
      payload
    );
  }

  /**
   * Emit a cleared (idle) state using context from the last snapshot
   * so the payload contains the real projectId/prNumber.
   */
  private emitClearedState(key: string, ctx: PRReviewContext | null): void {
    const payload: PRReviewStatePayload = {
      state: 'idle',
      prNumber: ctx?.prNumber ?? 0,
      projectId: ctx?.projectId ?? '',
      isReviewing: false,
      startedAt: null,
      progress: null,
      result: null,
      previousResult: null,
      error: null,
      isExternalReview: false,
      isFollowup: false,
    };

    safeSendToRenderer(
      this.getMainWindow,
      IPC_CHANNELS.GITHUB_PR_REVIEW_STATE_CHANGE,
      key,
      payload
    );
  }
}
