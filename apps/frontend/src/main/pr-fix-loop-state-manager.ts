import { createActor } from 'xstate';
import type { ActorRefFrom } from 'xstate';
import type { BrowserWindow } from 'electron';
import {
  prFixLoopMachine,
  type PRFixLoopContext,
  type PRFixLoopEvent
} from '../shared/state-machines/pr-fix-loop-machine';
import type {
  PRFixLoopOptions,
  PRFixLoopProgress,
  PRFixLoopResult,
  PRFixLoopStatePayload
} from '../preload/api/modules/github-api';
import { IPC_CHANNELS } from '../shared/constants';
import { safeSendToRenderer } from './ipc-handlers/utils';

type PRFixLoopActor = ActorRefFrom<typeof prFixLoopMachine>;

function buildContextKey(snapshot: { context: PRFixLoopContext }): string {
  const ctx = snapshot.context;
  const progressKey = ctx.progress
    ? `${ctx.progress.phase}:${ctx.progress.iteration}:${ctx.progress.progress}:${ctx.progress.message}`
    : 'none';
  const resultKey = ctx.result ? `${ctx.result.state}:${ctx.result.iteration}:${ctx.result.reason ?? ''}` : 'none';
  const errorKey = ctx.error ?? 'none';
  return `${progressKey}|${resultKey}|${errorKey}|${ctx.lastCommitSha ?? 'none'}|${ctx.lastAttemptSignature ?? 'none'}`;
}

export class PRFixLoopStateManager {
  private actors = new Map<string, PRFixLoopActor>();
  private lastStateByPR = new Map<string, string>();
  private getMainWindow: () => BrowserWindow | null;

  constructor(getMainWindow: () => BrowserWindow | null) {
    this.getMainWindow = getMainWindow;
  }

  handleStartLoop(projectId: string, prNumber: number, options?: PRFixLoopOptions): void {
    const actor = this.getOrCreateActor(projectId, prNumber);
    actor.send({ type: 'START_FIX_LOOP', prNumber, projectId, options } satisfies PRFixLoopEvent);
  }

  handleProgress(
    projectId: string,
    prNumber: number,
    progress: PRFixLoopProgress,
    metadata?: {
      iteration?: number;
      maxIterations?: number;
      lastCommitSha?: string | null;
      lastParentSha?: string | null;
      lastAttemptSignature?: string | null;
    }
  ): void {
    const actor = this.getActor(projectId, prNumber);
    if (!actor) {
      return;
    }

    actor.send({
      type: 'SET_PHASE_PROGRESS',
      phase: progress.phase,
      progress,
      ...metadata
    } satisfies PRFixLoopEvent);

    safeSendToRenderer(this.getMainWindow, IPC_CHANNELS.GITHUB_PR_FIX_PROGRESS, projectId, progress);
  }

  handleComplete(projectId: string, prNumber: number, result: PRFixLoopResult): void {
    const actor = this.getOrCreateActor(projectId, prNumber);
    actor.send({ type: 'FIX_COMPLETE', result } satisfies PRFixLoopEvent);
    safeSendToRenderer(this.getMainWindow, IPC_CHANNELS.GITHUB_PR_FIX_COMPLETE, projectId, result);
  }

  handleFailureResult(projectId: string, prNumber: number, result: PRFixLoopResult): void {
    const actor = this.getOrCreateActor(projectId, prNumber);
    actor.send({ type: 'FIX_FAILED_RESULT', result } satisfies PRFixLoopEvent);
    safeSendToRenderer(this.getMainWindow, IPC_CHANNELS.GITHUB_PR_FIX_COMPLETE, projectId, result);
  }

  handleHandoff(projectId: string, prNumber: number, result: PRFixLoopResult): void {
    const actor = this.getOrCreateActor(projectId, prNumber);
    actor.send({ type: 'FIX_HANDOFF', result } satisfies PRFixLoopEvent);
    safeSendToRenderer(this.getMainWindow, IPC_CHANNELS.GITHUB_PR_FIX_COMPLETE, projectId, result);
  }

  handleError(projectId: string, prNumber: number, error: string): void {
    const actor = this.getActor(projectId, prNumber);
    if (!actor) {
      return;
    }
    actor.send({ type: 'FIX_ERROR', error } satisfies PRFixLoopEvent);
    safeSendToRenderer(this.getMainWindow, IPC_CHANNELS.GITHUB_PR_FIX_ERROR, projectId, {
      prNumber,
      error
    });
  }

  handleCancel(projectId: string, prNumber: number, result?: PRFixLoopResult): void {
    const actor = this.getActor(projectId, prNumber);
    if (!actor) {
      return;
    }
    actor.send({ type: 'FIX_CANCELLED', result } satisfies PRFixLoopEvent);
  }

  getState(projectId: string, prNumber: number): ReturnType<PRFixLoopActor['getSnapshot']> | null {
    const actor = this.getActor(projectId, prNumber);
    if (!actor) {
      return null;
    }
    return actor.getSnapshot();
  }

  handleClearLoop(projectId: string, prNumber: number): void {
    const key = this.getKey(projectId, prNumber);
    const actor = this.actors.get(key);
    if (actor) {
      const snapshot = actor.getSnapshot();
      actor.stop();
      this.actors.delete(key);
      this.emitClearedState(key, snapshot?.context ?? null);
    }
    this.lastStateByPR.delete(key);
  }

  handleAuthChange(): void {
    for (const [key, actor] of this.actors) {
      const snapshot = actor.getSnapshot();
      actor.stop();
      this.emitClearedState(key, snapshot?.context ?? null);
    }
    this.actors.clear();
    this.lastStateByPR.clear();
  }

  clearAll(): void {
    for (const [, actor] of this.actors) {
      actor.stop();
    }
    this.actors.clear();
    this.lastStateByPR.clear();
  }

  private getOrCreateActor(projectId: string, prNumber: number): PRFixLoopActor {
    const key = this.getKey(projectId, prNumber);
    const existing = this.actors.get(key);
    if (existing) {
      return existing;
    }

    const actor = createActor(prFixLoopMachine);

    actor.subscribe((snapshot) => {
      const stateValue = String(snapshot.value);
      const currentKey = `${stateValue}:${buildContextKey(snapshot)}`;
      if (this.lastStateByPR.get(key) === currentKey) {
        return;
      }
      this.lastStateByPR.set(key, currentKey);
      this.emitStateToRenderer(key, snapshot);
    });

    actor.start();
    this.actors.set(key, actor);
    return actor;
  }

  private getActor(projectId: string, prNumber: number): PRFixLoopActor | null {
    return this.actors.get(this.getKey(projectId, prNumber)) ?? null;
  }

  private getKey(projectId: string, prNumber: number): string {
    return `${projectId}:${prNumber}`;
  }

  private emitStateToRenderer(
    key: string,
    snapshot: ReturnType<PRFixLoopActor['getSnapshot']> | null
  ): void {
    const stateValue = (snapshot ? String(snapshot.value) : 'idle') as PRFixLoopStatePayload['state'];
    const ctx = snapshot?.context ?? null;

    const payload: PRFixLoopStatePayload = {
      state: stateValue,
      prNumber: ctx?.prNumber ?? 0,
      projectId: ctx?.projectId ?? '',
      isRunning: !['idle', 'done', 'failed', 'cancelled', 'handoff_required'].includes(stateValue),
      startedAt: ctx?.startedAt ?? null,
      updatedAt: ctx?.updatedAt ?? null,
      iteration: ctx?.iteration ?? 0,
      maxIterations: ctx?.maxIterations ?? 0,
      progress: ctx?.progress ?? null,
      result: ctx?.result ?? null,
      error: ctx?.error ?? null,
      lastCommitSha: ctx?.lastCommitSha ?? null,
      lastParentSha: ctx?.lastParentSha ?? null,
      lastAttemptSignature: ctx?.lastAttemptSignature ?? null
    };

    safeSendToRenderer(this.getMainWindow, IPC_CHANNELS.GITHUB_PR_FIX_STATE_CHANGE, key, payload);
  }

  private emitClearedState(key: string, ctx: PRFixLoopContext | null): void {
    const payload: PRFixLoopStatePayload = {
      state: 'idle',
      prNumber: ctx?.prNumber ?? 0,
      projectId: ctx?.projectId ?? '',
      isRunning: false,
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

    safeSendToRenderer(this.getMainWindow, IPC_CHANNELS.GITHUB_PR_FIX_STATE_CHANGE, key, payload);
  }
}
