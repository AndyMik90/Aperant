import { create } from 'zustand';
import type {
  LinearInvestigationStatus,
  LinearInvestigationResult
} from '../../../shared/types';

interface LinearInvestigationState {
  // Investigation state
  investigationStatus: LinearInvestigationStatus;
  lastInvestigationResult: LinearInvestigationResult | null;

  // Actions
  setInvestigationStatus: (status: LinearInvestigationStatus) => void;
  setInvestigationResult: (result: LinearInvestigationResult | null) => void;
  clearInvestigation: () => void;
}

export const useLinearInvestigationStore = create<LinearInvestigationState>((set) => ({
  // Initial state
  investigationStatus: {
    phase: 'idle',
    progress: 0,
    message: ''
  },
  lastInvestigationResult: null,

  // Actions
  setInvestigationStatus: (investigationStatus) => set({ investigationStatus }),

  setInvestigationResult: (lastInvestigationResult) => set({ lastInvestigationResult }),

  clearInvestigation: () => set({
    investigationStatus: { phase: 'idle', progress: 0, message: '' },
    lastInvestigationResult: null
  })
}));

/**
 * Start investigating a Linear issue
 */
export function investigateLinearIssue(
  projectId: string,
  issueId: string,
  selectedCommentIds?: string[]
): void {
  const store = useLinearInvestigationStore.getState();
  store.setInvestigationStatus({
    phase: 'fetching',
    issueId,
    progress: 0,
    message: 'Starting investigation...'
  });
  store.setInvestigationResult(null);

  window.electronAPI.investigateLinearIssue(projectId, issueId, selectedCommentIds);
}
