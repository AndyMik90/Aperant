import { create } from 'zustand';
import type { Project } from '@shared/types';
import type { AppSection } from '@/components/settings/AppSettings';
import type { ProjectSettingsSection } from '@/components/settings/ProjectSettingsContent';

interface DialogState {
  // Task creation
  isNewTaskDialogOpen: boolean;
  openNewTaskDialog: () => void;
  closeNewTaskDialog: () => void;

  // Settings
  isSettingsDialogOpen: boolean;
  settingsInitialSection: AppSection | undefined;
  settingsInitialProjectSection: ProjectSettingsSection | undefined;
  openSettings: (section?: AppSection, projectSection?: ProjectSettingsSection) => void;
  closeSettings: () => void;

  // Project init (unified — consumed by both App.tsx and Sidebar)
  showInitDialog: boolean;
  pendingProject: Project | null;
  isInitializing: boolean;
  initSuccess: boolean;
  initError: string | null;
  skippedInitProjectId: string | null;
  openInitDialog: (project: Project) => void;
  closeInitDialog: () => void;
  skipInit: () => void;
  resetInitState: () => void;
  setInitializing: (v: boolean) => void;
  setInitSuccess: (v: boolean) => void;
  setInitError: (v: string | null) => void;

  // GitHub setup (sequential after init)
  showGitHubSetup: boolean;
  gitHubSetupProject: Project | null;
  openGitHubSetup: (project: Project) => void;
  closeGitHubSetup: () => void;

  // Project removal
  showRemoveProjectDialog: boolean;
  removeProjectError: string | null;
  projectToRemove: Project | null;
  openRemoveProjectDialog: (project: Project) => void;
  setRemoveProjectError: (error: string | null) => void;
  closeRemoveProjectDialog: () => void;

  // Add project
  showAddProjectModal: boolean;
  openAddProjectModal: () => void;
  closeAddProjectModal: () => void;

  // Onboarding
  isOnboardingWizardOpen: boolean;
  openOnboarding: () => void;
  closeOnboarding: () => void;

  // Version warning
  isVersionWarningModalOpen: boolean;
  openVersionWarning: () => void;
  closeVersionWarning: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  // Task creation
  isNewTaskDialogOpen: false,
  openNewTaskDialog: () => set({ isNewTaskDialogOpen: true }),
  closeNewTaskDialog: () => set({ isNewTaskDialogOpen: false }),

  // Settings
  isSettingsDialogOpen: false,
  settingsInitialSection: undefined,
  settingsInitialProjectSection: undefined,
  openSettings: (section, projectSection) =>
    set({
      isSettingsDialogOpen: true,
      settingsInitialSection: section,
      settingsInitialProjectSection: projectSection,
    }),
  closeSettings: () =>
    set({
      isSettingsDialogOpen: false,
      settingsInitialSection: undefined,
      settingsInitialProjectSection: undefined,
    }),

  // Project init
  showInitDialog: false,
  pendingProject: null,
  isInitializing: false,
  initSuccess: false,
  initError: null,
  skippedInitProjectId: null,
  openInitDialog: (project) =>
    set({
      showInitDialog: true,
      pendingProject: project,
      initError: null,
      initSuccess: false,
    }),
  closeInitDialog: () =>
    set({
      showInitDialog: false,
      pendingProject: null,
    }),
  skipInit: () =>
    set((state) => ({
      showInitDialog: false,
      skippedInitProjectId: state.pendingProject?.id ?? state.skippedInitProjectId,
      pendingProject: null,
      initError: null,
      initSuccess: false,
    })),
  resetInitState: () =>
    set({
      initSuccess: false,
      initError: null,
    }),
  setInitializing: (v) => set({ isInitializing: v }),
  setInitSuccess: (v) => set({ initSuccess: v }),
  setInitError: (v) => set({ initError: v }),

  // GitHub setup
  showGitHubSetup: false,
  gitHubSetupProject: null,
  openGitHubSetup: (project) =>
    set({ showGitHubSetup: true, gitHubSetupProject: project }),
  closeGitHubSetup: () =>
    set({ showGitHubSetup: false, gitHubSetupProject: null }),

  // Project removal
  showRemoveProjectDialog: false,
  removeProjectError: null,
  projectToRemove: null,
  openRemoveProjectDialog: (project) =>
    set({ showRemoveProjectDialog: true, projectToRemove: project, removeProjectError: null }),
  setRemoveProjectError: (error) => set({ removeProjectError: error }),
  closeRemoveProjectDialog: () =>
    set({ showRemoveProjectDialog: false, projectToRemove: null, removeProjectError: null }),

  // Add project
  showAddProjectModal: false,
  openAddProjectModal: () => set({ showAddProjectModal: true }),
  closeAddProjectModal: () => set({ showAddProjectModal: false }),

  // Onboarding
  isOnboardingWizardOpen: false,
  openOnboarding: () => set({ isOnboardingWizardOpen: true }),
  closeOnboarding: () => set({ isOnboardingWizardOpen: false }),

  // Version warning
  isVersionWarningModalOpen: false,
  openVersionWarning: () => set({ isVersionWarningModalOpen: true }),
  closeVersionWarning: () => set({ isVersionWarningModalOpen: false }),
}));
