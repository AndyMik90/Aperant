import { create } from 'zustand';
import i18next from 'i18next';
import type {
  GitHubInvestigationStatus,
  GitHubInvestigationResult,
  InvestigationProgress,
  InvestigationResult,
  InvestigationReport,
  InvestigationDismissReason,
  InvestigationSettings,
  InvestigationState,
  PersistedInvestigationState,
} from '@shared/types';
import { toast } from '../../hooks/use-toast';

// ============================================
// Per-Issue Investigation State
// ============================================

/**
 * Investigation state for a single issue.
 * Keyed by `${projectId}:${issueNumber}` in the store.
 */
export interface IssueInvestigationState {
  issueNumber: number;
  projectId: string;
  isInvestigating: boolean;
  /** Real-time progress during investigation */
  progress: InvestigationProgress | null;
  /** Final investigation report */
  report: InvestigationReport | null;
  /** Previous report (kept during re-investigation for continuity) */
  previousReport: InvestigationReport | null;
  /** Error message if investigation failed */
  error: string | null;
  /** Pre-allocated spec ID for task creation */
  specId: string | null;
  /** Dismiss reason if issue was dismissed */
  dismissReason: InvestigationDismissReason | null;
  /** GitHub comment ID if results were posted */
  githubCommentId: number | null;
  /** Timestamp when investigation started */
  startedAt: string | null;
  /** Timestamp when investigation completed */
  completedAt: string | null;
  /** Timestamp when results were posted to GitHub */
  postedAt: string | null;
  /** Linked task status (synced from task store for building/done states) */
  linkedTaskStatus: string | null;
  /** Activity log tracking key lifecycle events */
  activityLog: Array<{ event: string; timestamp: string }>;
  /** True if the issue no longer exists in the GitHub response (stale/deleted) */
  isStale?: boolean;
  /** True if the investigation was explicitly cancelled (prevents late completion overwrite) */
  isCancelled?: boolean;
  /** True if the investigation has saved session IDs that can be resumed */
  hasResumeSessions?: boolean;
}

// ============================================
// Store Interface
// ============================================

interface InvestigationStoreState {
  // Per-issue investigation state
  // Key: `${projectId}:${issueNumber}`
  investigations: Record<string, IssueInvestigationState>;

  // Settings (per project, keyed by projectId)
  settings: Record<string, InvestigationSettings>;

  // ---- Label Sync ----
  // Label sync callback state
  stateChangeCallback?: (projectId: string, issueNumber: number, newState: string) => void;

  // ---- Legacy state (backwards compat with useGitHubInvestigation hook) ----
  investigationStatus: GitHubInvestigationStatus;
  lastInvestigationResult: GitHubInvestigationResult | null;
  setInvestigationStatus: (status: GitHubInvestigationStatus) => void;
  setInvestigationResult: (result: GitHubInvestigationResult | null) => void;
  clearInvestigation: () => void;

  // ---- New system actions ----
  startInvestigation: (projectId: string, issueNumber: number) => void;
  setProgress: (projectId: string, progress: InvestigationProgress) => void;
  setResult: (projectId: string, result: InvestigationResult) => void;
  setError: (projectId: string, issueNumber: number, error: string, hasResumeSessions?: boolean) => void;
  dismiss: (projectId: string, issueNumber: number, reason: InvestigationDismissReason) => void;
  clearIssueInvestigation: (projectId: string, issueNumber: number) => void;
  setSettings: (projectId: string, settings: InvestigationSettings) => void;
  syncTaskState: (projectId: string, issueNumber: number, taskStatus: string) => void;
  clearLinkedTask: (projectId: string, issueNumber: number) => void;
  loadPersistedInvestigations: (projectId: string, states: PersistedInvestigationState[]) => void;
  setGithubCommentId: (projectId: string, issueNumber: number, commentId: number) => void;
  setSpecId: (projectId: string, issueNumber: number, specId: string) => void;
  cancelAllInvestigations: (projectId: string) => void;
  markStaleInvestigations: (projectId: string, activeIssueNumbers: Set<number>) => void;

  // ---- Selectors ----
  getInvestigationState: (projectId: string, issueNumber: number) => IssueInvestigationState | null;
  getDerivedState: (projectId: string, issueNumber: number) => InvestigationState;
  getActiveInvestigations: (projectId: string) => IssueInvestigationState[];
  getSettings: (projectId: string) => InvestigationSettings | null;
}

// ============================================
// Store Implementation
// ============================================

// TODO: Optimize with immer middleware to avoid spreading entire state object
// This requires updating all state setters to use draft pattern
// See: https://github.com/pmndrs/zustand#immer-middleware
export const useInvestigationStore = create<InvestigationStoreState>((set, get) => ({
  // Initial state
  investigations: {},
  settings: {},

  // Legacy state
  investigationStatus: { phase: 'idle', progress: 0, message: '' },
  lastInvestigationResult: null,

  // Legacy actions (backwards compat)
  setInvestigationStatus: (investigationStatus) => set({ investigationStatus }),
  setInvestigationResult: (lastInvestigationResult) => set({ lastInvestigationResult }),
  clearInvestigation: () => set({
    investigationStatus: { phase: 'idle', progress: 0, message: '' },
    lastInvestigationResult: null
  }),

  // ---- New system actions ----

  startInvestigation: (projectId: string, issueNumber: number) => set((state) => {
    const key = `${projectId}:${issueNumber}`;
    const existing = state.investigations[key];
    const now = new Date().toISOString();
    const event = existing?.report ? 're-investigation started' : 'investigation started';
    const log = [...(existing?.activityLog ?? []), { event, timestamp: now }].slice(-50);
    return {
      investigations: {
        ...state.investigations,
        [key]: {
          issueNumber,
          projectId,
          isInvestigating: true,
          progress: null,
          report: null,
          previousReport: existing?.report ?? null,
          error: null,
          specId: existing?.specId ?? null,
          dismissReason: null, // clear dismiss on re-investigation
          githubCommentId: existing?.githubCommentId ?? null,
          startedAt: now,
          completedAt: null,
          postedAt: existing?.postedAt ?? null,
          linkedTaskStatus: existing?.linkedTaskStatus ?? null,
          activityLog: log,
          isCancelled: false, // clear cancelled flag on new investigation
          hasResumeSessions: false, // new investigation starts fresh (old sessions were for previous run)
        }
      }
    };
  }),

  setProgress: (projectId: string, progress: InvestigationProgress) => set((state) => {
    const key = `${projectId}:${progress.issueNumber}`;
    const existing = state.investigations[key];
    // Don't create ghost entries for cancelled/unknown investigations
    if (!existing?.isInvestigating) return state;
    return {
      investigations: {
        ...state.investigations,
        [key]: {
          issueNumber: progress.issueNumber,
          projectId,
          isInvestigating: true,
          progress,
          report: existing?.report ?? null,
          previousReport: existing?.previousReport ?? null,
          error: null,
          specId: existing?.specId ?? null,
          dismissReason: existing?.dismissReason ?? null,
          githubCommentId: existing?.githubCommentId ?? null,
          startedAt: existing?.startedAt ?? null,
          completedAt: null,
          postedAt: existing?.postedAt ?? null,
          linkedTaskStatus: existing?.linkedTaskStatus ?? null,
          activityLog: existing?.activityLog ?? [],
          isCancelled: existing?.isCancelled ?? false,
          hasResumeSessions: existing?.hasResumeSessions ?? false,
        }
      }
    };
  }),

  setResult: (projectId: string, result: InvestigationResult) => set((state) => {
    const key = `${projectId}:${result.issueNumber}`;
    const existing = state.investigations[key];
    // Don't overwrite cancelled state with late completion
    if (existing?.isCancelled) return state;
    const log = [...(existing?.activityLog ?? []), { event: 'investigation completed', timestamp: result.completedAt }].slice(-50);
    // Schedule cleanup after setting result (deferred to avoid batching issues)
    setTimeout(cleanupOldInvestigations, 0);
    return {
      investigations: {
        ...state.investigations,
        [key]: {
          issueNumber: result.issueNumber,
          projectId,
          isInvestigating: false,
          progress: null,
          report: result.report,
          previousReport: existing?.previousReport ?? null,
          error: null,
          specId: result.specId ?? existing?.specId ?? null,
          dismissReason: existing?.dismissReason ?? null,
          githubCommentId: result.githubCommentId ?? existing?.githubCommentId ?? null,
          startedAt: existing?.startedAt ?? null,
          completedAt: result.completedAt,
          postedAt: existing?.postedAt ?? null,
          linkedTaskStatus: existing?.linkedTaskStatus ?? null,
          activityLog: log,
          isCancelled: false, // clear cancelled flag on successful completion
        }
      }
    };
  }),

  setError: (projectId: string, issueNumber: number, error: string, hasResumeSessions?: boolean) => set((state) => {
    const key = `${projectId}:${issueNumber}`;
    const existing = state.investigations[key];
    const log = [...(existing?.activityLog ?? []), { event: 'investigation failed', timestamp: new Date().toISOString() }].slice(-50);
    // Use the provided hasResumeSessions flag, or fall back to existing value, or default to false
    const hasResumeSessionsFlag = hasResumeSessions ?? existing?.hasResumeSessions ?? false;
    return {
      investigations: {
        ...state.investigations,
        [key]: {
          issueNumber,
          projectId,
          isInvestigating: false,
          progress: null,
          report: existing?.report ?? null,
          previousReport: existing?.previousReport ?? null,
          error,
          specId: existing?.specId ?? null,
          dismissReason: existing?.dismissReason ?? null,
          githubCommentId: existing?.githubCommentId ?? null,
          startedAt: existing?.startedAt ?? null,
          completedAt: null,
          postedAt: existing?.postedAt ?? null,
          linkedTaskStatus: existing?.linkedTaskStatus ?? null,
          activityLog: log,
          isCancelled: existing?.isCancelled ?? false,
          hasResumeSessions: hasResumeSessionsFlag,
        }
      }
    };
  }),

  dismiss: (projectId: string, issueNumber: number, reason: InvestigationDismissReason) => set((state) => {
    const key = `${projectId}:${issueNumber}`;
    const existing = state.investigations[key];
    if (!existing) return state;
    const log = [...(existing.activityLog ?? []), { event: `dismissed: ${reason}`, timestamp: new Date().toISOString() }].slice(-50);
    return {
      investigations: {
        ...state.investigations,
        [key]: {
          ...existing,
          dismissReason: reason,
          activityLog: log
        }
      }
    };
  }),

  clearIssueInvestigation: (projectId: string, issueNumber: number) => set((state) => {
    const key = `${projectId}:${issueNumber}`;
    const { [key]: _, ...rest } = state.investigations;
    return { investigations: rest };
  }),

  setSettings: (projectId: string, settings: InvestigationSettings) => set((state) => ({
    settings: {
      ...state.settings,
      [projectId]: settings
    }
  })),

  syncTaskState: (projectId: string, issueNumber: number, taskStatus: string) => set((state) => {
    const key = `${projectId}:${issueNumber}`;
    const existing = state.investigations[key];
    if (!existing) return state;

    // Only update if there's a linked task (specId set)
    if (!existing.specId) return state;

    // Define state ordering to prevent backward transitions
    const stateOrder: Record<string, number> = {
      'task_created': 0,
      'building': 1,
      'done': 2,
    };

    // Map task status to a linked task status value
    let newLinkedStatus: string | null = null;
    if (taskStatus === 'in_progress' || taskStatus === 'ai_review') {
      newLinkedStatus = 'building';
    } else if (taskStatus === 'done' || taskStatus === 'pr_created') {
      newLinkedStatus = 'done';
    } else if (taskStatus === 'error') {
      newLinkedStatus = 'failed';
    }

    if (!newLinkedStatus) return state;

    // Prevent backward transitions (don't go from "done" back to "building")
    const currentOrder = stateOrder[existing.linkedTaskStatus ?? 'task_created'] ?? -1;
    const newOrder = stateOrder[newLinkedStatus] ?? -1;
    if (newOrder <= currentOrder && newLinkedStatus !== 'failed') return state;

    return {
      investigations: {
        ...state.investigations,
        [key]: {
          ...existing,
          linkedTaskStatus: newLinkedStatus,
        }
      }
    };
  }),

  clearLinkedTask: (projectId: string, issueNumber: number) => set((state) => {
    const key = `${projectId}:${issueNumber}`;
    const existing = state.investigations[key];
    if (!existing) return state;
    const log = [...(existing.activityLog ?? []), { event: 'linked task deleted', timestamp: new Date().toISOString() }].slice(-50);
    return {
      investigations: {
        ...state.investigations,
        [key]: {
          ...existing,
          specId: null,
          linkedTaskStatus: null,
          activityLog: log
        }
      }
    };
  }),

  setGithubCommentId: (projectId: string, issueNumber: number, commentId: number) => set((state) => {
    const key = `${projectId}:${issueNumber}`;
    const existing = state.investigations[key];
    if (!existing) {
      console.warn(`[InvestigationStore] setGithubCommentId called for non-existent investigation ${key}`);
      return state;
    }
    const now = new Date().toISOString();
    const log = [...(existing.activityLog ?? []), { event: 'posted to GitHub', timestamp: now }].slice(-50);
    return {
      investigations: {
        ...state.investigations,
        [key]: {
          ...existing,
          githubCommentId: commentId,
          postedAt: now,
          activityLog: log,
        }
      }
    };
  }),

  setSpecId: (projectId: string, issueNumber: number, specId: string) => set((state) => {
    const key = `${projectId}:${issueNumber}`;
    const existing = state.investigations[key];
    if (!existing) {
      console.warn(`[InvestigationStore] setSpecId called for non-existent investigation ${key}`);
      return state;
    }
    const now = new Date().toISOString();
    const log = [...(existing.activityLog ?? []), { event: `task created: ${specId}`, timestamp: now }].slice(-50);
    return {
      investigations: {
        ...state.investigations,
        [key]: {
          ...existing,
          specId,
          linkedTaskStatus: 'task_created',
          activityLog: log,
        }
      }
    };
  }),

  loadPersistedInvestigations: (projectId: string, states: PersistedInvestigationState[]) => set((state) => {
    const newInvestigations = { ...state.investigations };

    for (const persisted of states) {
      const key = `${projectId}:${persisted.issueNumber}`;

      // Don't overwrite investigations that are already in-memory
      // (e.g., currently running or already loaded)
      // Prevents race condition where fresh data gets overwritten by stale disk data
      if (newInvestigations[key]?.isInvestigating) {
        continue;
      }

      const isInvestigating = persisted.status === 'investigating';
      const isError = !isInvestigating && (persisted.status === 'failed' || persisted.wasInterrupted);

      // Defensive: Never overwrite a valid githubCommentId with null
      // This prevents losing the "posted" state during race conditions
      const existingHasCommentId = newInvestigations[key]?.githubCommentId;
      const persistedHasCommentId = persisted.githubCommentId;

      if (existingHasCommentId && !persistedHasCommentId) {
        console.warn(`[InvestigationStore] Skipping overwrite of ${key} - would lose githubCommentId (${existingHasCommentId})`);
        continue;
      }

      newInvestigations[key] = {
        issueNumber: persisted.issueNumber,
        projectId,
        isInvestigating,
        progress: null,
        report: (persisted.report as InvestigationReport) ?? null,
        previousReport: null,
        error: isInvestigating
          ? null
          : isError
          ? (persisted.wasInterrupted ? 'investigation.interrupted' : null)
          : null,
        specId: persisted.specId ?? null,
        dismissReason: null,
        githubCommentId: persisted.githubCommentId ?? null,
        startedAt: isInvestigating ? (newInvestigations[key]?.startedAt ?? null) : null,
        completedAt: persisted.completedAt ?? null,
        postedAt: persisted.postedAt ?? null,
        linkedTaskStatus: null,
        activityLog: persisted.activityLog ?? [],
        hasResumeSessions: persisted.hasResumeSessions ?? false,
      };
    }

    return { investigations: newInvestigations };
  }),

  cancelAllInvestigations: (projectId: string) => set((state) => {
    const updated = { ...state.investigations };
    let changed = false;
    const now = new Date().toISOString();
    for (const [key, inv] of Object.entries(updated)) {
      if (inv.projectId !== projectId || !inv.isInvestigating) continue;
      const log = [...(inv.activityLog ?? []), { event: 'cancelled (cancel all)', timestamp: now }].slice(-50);
      updated[key] = {
        ...inv,
        isInvestigating: false,
        progress: null,
        error: 'Investigation cancelled',
        activityLog: log,
        isCancelled: true,
      };
      changed = true;
    }
    return changed ? { investigations: updated } : state;
  }),

  markStaleInvestigations: (projectId: string, activeIssueNumbers: Set<number>) => set((state) => {
    const updated = { ...state.investigations };
    let changed = false;
    for (const [key, inv] of Object.entries(updated)) {
      if (inv.projectId !== projectId) continue;
      const shouldBeStale = !activeIssueNumbers.has(inv.issueNumber);
      if (inv.isStale !== shouldBeStale) {
        updated[key] = { ...inv, isStale: shouldBeStale };
        changed = true;
      }
    }
    return changed ? { investigations: updated } : state;
  }),

  // ---- Selectors ----

  getInvestigationState: (projectId: string, issueNumber: number) => {
    const { investigations } = get();
    const key = `${projectId}:${issueNumber}`;
    return investigations[key] ?? null;
  },

  /**
   * Compute the derived investigation state for an issue.
   * This is the 8-state machine from the design doc, fully derived
   * from investigation data + linked task status (never manually set).
   */
  getDerivedState: (projectId: string, issueNumber: number): InvestigationState => {
    const { investigations } = get();
    const key = `${projectId}:${issueNumber}`;
    const inv = investigations[key];

    if (!inv) return 'new';
    if (inv.isInvestigating && inv.progress?.phase === 'queued') return 'queued';
    if (inv.isInvestigating) return 'investigating';
    if (inv.error === 'investigation.interrupted' && !inv.specId) return 'interrupted';
    if (inv.error && !inv.specId) return 'failed';
    if (inv.report?.likelyResolved && !inv.specId) return 'resolved';
    if (inv.report && !inv.specId) return 'findings_ready';
    if (inv.specId) {
      // Task has been created — check linked task status for advanced states
      if (inv.linkedTaskStatus === 'done') return 'done';
      if (inv.linkedTaskStatus === 'building') return 'building';
      return 'task_created';
    }
    return 'new';
  },

  getActiveInvestigations: (projectId: string) => {
    const { investigations } = get();
    return Object.values(investigations).filter(
      inv => inv.projectId === projectId && inv.isInvestigating
    );
  },

  getSettings: (projectId: string) => {
    const { settings } = get();
    return settings[projectId] ?? null;
  }
}));

// ============================================
// Global IPC Listeners
// ============================================

let investigationListenersInitialized = false;
let cleanupFunctions: (() => void)[] = [];

/**
 * Initialize global IPC listeners for investigation events.
 * Call this once at app startup to ensure events are captured
 * regardless of which component is mounted.
 */
export function initializeInvestigationListeners(): void {
  if (investigationListenersInitialized) return;

  // Check if the new investigation API is available
  if (!window.electronAPI?.github?.onInvestigationProgress) {
    console.warn('[InvestigationStore] Investigation API not available, skipping listener setup');
    return;
  }

  const store = useInvestigationStore.getState();

  // Listen for investigation progress events
  const cleanupProgress = window.electronAPI.github.onInvestigationProgress(
    (projectId: string, progress: InvestigationProgress) => {
      store.setProgress(projectId, progress);
    }
  );
  cleanupFunctions.push(cleanupProgress);

  // Listen for investigation completion events
  const cleanupComplete = window.electronAPI.github.onInvestigationComplete(
    (projectId: string, result: InvestigationResult) => {
      store.setResult(projectId, result);
      toast({
        title: i18next.t('common:investigation.toast.investigationComplete', { issueNumber: result.issueNumber }),
      });
    }
  );
  cleanupFunctions.push(cleanupComplete);

  // Listen for investigation error events
  const cleanupError = window.electronAPI.github.onInvestigationError(
    (projectId: string, errorPayload: string | { error: string; issueNumber?: number; hasResumeSessions?: boolean }) => {
      const errorMsg = typeof errorPayload === 'string' ? errorPayload : errorPayload.error;
      const issueNum = typeof errorPayload === 'object' ? errorPayload.issueNumber : undefined;
      const hasResumeSessions = typeof errorPayload === 'object' ? errorPayload.hasResumeSessions : undefined;

      if (issueNum) {
        // Target the specific investigation that failed
        store.setError(projectId, issueNum, errorMsg, hasResumeSessions);
        toast({
          title: i18next.t('common:investigation.toast.investigationFailed', { issueNumber: issueNum }),
          variant: 'destructive',
        });
      } else {
        // Legacy fallback: no issueNumber, mark all active (shouldn't happen with updated handlers)
        const active = store.getActiveInvestigations(projectId);
        for (const inv of active) {
          store.setError(projectId, inv.issueNumber, errorMsg);
          toast({
            title: i18next.t('common:investigation.toast.investigationFailed', { issueNumber: inv.issueNumber }),
            variant: 'destructive',
          });
        }
      }
    }
  );
  cleanupFunctions.push(cleanupError);

  // Listen for GitHub auth changes - clear all investigation state
  if (window.electronAPI.github.onGitHubAuthChanged) {
    const cleanupAuthChanged = window.electronAPI.github.onGitHubAuthChanged(
      () => {
        useInvestigationStore.setState({ investigations: {}, settings: {} });
      }
    );
    cleanupFunctions.push(cleanupAuthChanged);
  }

  investigationListenersInitialized = true;
}

/**
 * Cleanup investigation listeners.
 * Call this during app unmount or hot-reload.
 */
export function cleanupInvestigationListeners(): void {
  for (const cleanup of cleanupFunctions) {
    try {
      cleanup();
    } catch {
            // Ignore cleanup errors
    }
  }
  cleanupFunctions = [];
  investigationListenersInitialized = false;
}

// ============================================
// Action helpers (called from outside the store)
// ============================================

/**
 * Start investigating a GitHub issue via the new investigation system.
 */
export function startIssueInvestigation(
  projectId: string,
  issueNumber: number
): void {
  const store = useInvestigationStore.getState();

  // Don't start if already investigating (concurrency guard)
  const existing = store.getInvestigationState(projectId, issueNumber);
  if (existing?.isInvestigating) return;

  store.startInvestigation(projectId, issueNumber);
  window.electronAPI.github.startInvestigation(projectId, issueNumber);
}

/**
 * Cancel a running investigation.
 */
export function cancelIssueInvestigation(
  projectId: string,
  issueNumber: number
): void {
  const store = useInvestigationStore.getState();
  const key = `${projectId}:${issueNumber}`;
  const existing = store.getInvestigationState(projectId, issueNumber);

  // Mark as cancelled before the IPC call to prevent late completion from overwriting
  if (existing) {
    useInvestigationStore.setState((state) => ({
      investigations: {
        ...state.investigations,
        [key]: {
          ...state.investigations[key],
          isCancelled: true,
        },
      },
    }));
  }

  // Mark as not investigating immediately, but don't set hasResumeSessions yet
  // The backend will send an error response with hasResumeSessions if sessions exist
  store.setError(projectId, issueNumber, 'Investigation cancelled');
  window.electronAPI.github.cancelInvestigation(projectId, issueNumber);
}

/**
 * Cancel all running investigations for a project.
 */
export function cancelAllIssueInvestigations(projectId: string): void {
  const store = useInvestigationStore.getState();
  store.cancelAllInvestigations(projectId);
  window.electronAPI.github.cancelAllInvestigations(projectId);
}

/**
 * Load persisted investigation state from disk.
 * Call this when the GitHub Issues view mounts with a selected project
 * to restore completed/failed investigations from a previous session.
 */
export async function loadPersistedInvestigations(projectId: string): Promise<void> {
  if (!window.electronAPI?.github?.loadPersistedInvestigations) {
    return;
  }

  try {
    const result = await window.electronAPI.github.loadPersistedInvestigations(projectId);
    if (result.success && result.data && result.data.length > 0) {
      const store = useInvestigationStore.getState();
      store.loadPersistedInvestigations(projectId, result.data);
    }
  } catch (error) {
    console.warn('[InvestigationStore] Failed to load persisted investigations:', error);
  }
}

/**
 * Start investigating a GitHub issue (legacy function, kept for backwards compat).
 * Uses the old investigateGitHubIssue IPC channel.
 */
export function investigateGitHubIssue(
  projectId: string,
  issueNumber: number,
  selectedCommentIds?: number[]
): void {
  const store = useInvestigationStore.getState();
  store.setInvestigationStatus({
    phase: 'fetching',
    issueNumber,
    progress: 0,
    message: 'Starting investigation...'
  });
  store.setInvestigationResult(null);

  window.electronAPI.investigateGitHubIssue(projectId, issueNumber, selectedCommentIds);
}

// ============================================
// Cleanup Configuration
// ============================================

const MAX_STORED_INVESTIGATIONS = 100;
const CLEANUP_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Cleanup old completed investigations to prevent unbounded state accumulation.
 * Keeps:
 * - Active investigations (isInvestigating=true)
 * - Investigations with errors
 * - Recently completed investigations (within CLEANUP_AGE_MS)
 *
 * Removes:
 * - Old completed investigations beyond the age threshold
 * - Oldest entries if total count exceeds MAX_STORED_INVESTIGATIONS
 */
function cleanupOldInvestigations(): void {
  useInvestigationStore.setState((state) => {
    const entries = Object.entries(state.investigations);

    // If under the limit, no cleanup needed
    if (entries.length <= MAX_STORED_INVESTIGATIONS) {
      return state;
    }

    const now = Date.now();
    const newInvestigations: Record<string, IssueInvestigationState> = {};

    // First pass: keep active, errored, and recently completed investigations
    for (const [key, inv] of entries) {
      // Keep active investigations
      if (inv.isInvestigating) {
        newInvestigations[key] = inv;
        continue;
      }

      // Keep investigations with errors (they may need retry)
      if (inv.error) {
        newInvestigations[key] = inv;
        continue;
      }

      // Keep recently completed investigations
      if (inv.completedAt) {
        const completedTime = new Date(inv.completedAt).getTime();
        if (now - completedTime < CLEANUP_AGE_MS) {
          newInvestigations[key] = inv;
          continue;
        }
      }

      // Keep investigations with linked tasks (they may be in progress)
      if (inv.specId) {
        newInvestigations[key] = inv;
      }
    }

    // If still over the limit, remove the oldest completed investigations
    const remainingEntries = Object.entries(newInvestigations);
    if (remainingEntries.length > MAX_STORED_INVESTIGATIONS) {
      // Sort by completion time (oldest first), keeping active/error at the end
      const sorted = remainingEntries.sort(([_, a], [__, b]) => {
        // Active and error investigations should be kept (sort to end)
        if (a.isInvestigating || a.error) return 1;
        if (b.isInvestigating || b.error) return -1;

        // Sort by completedAt (nulls first - older/unknown)
        const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return aTime - bTime;
      });

      // Keep only the MAX_STORED_INVESTIGATIONS most recent
      const pruned = sorted.slice(-MAX_STORED_INVESTIGATIONS);
      return {
        investigations: Object.fromEntries(pruned),
      };
    }

    return { investigations: newInvestigations };
  });
}

// ============================================
// Investigation Watchdog
// ============================================

const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const INVESTIGATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the investigation watchdog timer.
 * Checks every 5 minutes for:
 * - Investigations running for more than 30 minutes (marks as timed out)
 * - Old completed investigations (runs cleanup)
 */
export function startInvestigationWatchdog(): void {
  if (watchdogTimer) return;

  watchdogTimer = setInterval(() => {
    const { investigations } = useInvestigationStore.getState();
    const now = Date.now();

    for (const [key, inv] of Object.entries(investigations)) {
      // Only check active investigations with a start time
      if (!inv.isInvestigating || !inv.startedAt) continue;

      const elapsed = now - new Date(inv.startedAt).getTime();
      if (elapsed > INVESTIGATION_TIMEOUT_MS) {
        console.warn(`[InvestigationWatchdog] Investigation ${key} timed out after ${Math.round(elapsed / 60000)} minutes`);
        useInvestigationStore.getState().setError(
          inv.projectId,
          inv.issueNumber,
          'Investigation timed out (exceeded 30 minutes)'
        );
      }
    }

    // Run cleanup periodically
    cleanupOldInvestigations();
  }, WATCHDOG_INTERVAL_MS);
}

/**
 * Stop the investigation watchdog timer.
 */
export function stopInvestigationWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

/**
 * Manually trigger investigation cleanup.
 * Can be called after bulk operations to free memory.
 */
export function triggerInvestigationCleanup(): void {
  cleanupOldInvestigations();
}
