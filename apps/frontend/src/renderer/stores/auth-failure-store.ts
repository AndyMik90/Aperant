import { create } from 'zustand';
import type { AuthFailureInfo } from '../../shared/types';

interface AuthFailureState {
  // Auth failure modal state
  isModalOpen: boolean;
  authFailureInfo: AuthFailureInfo | null;

  // TODO: Use hasPendingAuthFailure to show a badge/indicator in the sidebar
  // when there's an unresolved auth failure (e.g., red dot on Settings icon)
  hasPendingAuthFailure: boolean;

  // Actions
  showAuthFailureModal: (info: AuthFailureInfo) => void;
  hideAuthFailureModal: () => void;
  clearAuthFailure: () => void;
}

export const useAuthFailureStore = create<AuthFailureState>((set) => ({
  isModalOpen: false,
  authFailureInfo: null,
  hasPendingAuthFailure: false,

  showAuthFailureModal: (info: AuthFailureInfo) => {
    set({
      isModalOpen: true,
      authFailureInfo: info,
      hasPendingAuthFailure: true,
    });
  },

  hideAuthFailureModal: () => {
    // Keep the failure info when closing so user can see it again
    set({ isModalOpen: false });
  },

  clearAuthFailure: () => {
    set({
      isModalOpen: false,
      authFailureInfo: null,
      hasPendingAuthFailure: false,
    });
  },
}));
