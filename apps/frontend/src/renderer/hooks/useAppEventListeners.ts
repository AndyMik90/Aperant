import { useEffect } from 'react';
import { useNavigationStore } from '../stores/navigation-store';
import { useDialogStore } from '../stores/dialog-store';
import { useProjectStore, addProject, initializeProject, loadProjects } from '../stores/project-store';
import type { AppSection } from '../components/settings/AppSettings';
import type { Project } from '../../shared/types';
import i18n from '../../shared/i18n';

/**
 * Handles custom events, keyboard shortcuts, update listeners, and
 * initialization/GitHub setup logic.
 */
export function useAppEventListeners() {
  // Listen for open-app-settings events (e.g., from project settings)
  useEffect(() => {
    const handleOpenAppSettings = (event: Event) => {
      const customEvent = event as CustomEvent<AppSection>;
      const section = customEvent.detail;
      useDialogStore.getState().openSettings(section || undefined);
    };

    window.addEventListener('open-app-settings', handleOpenAppSettings);
    return () => {
      window.removeEventListener('open-app-settings', handleOpenAppSettings);
    };
  }, []);

  // Listen for app updates - auto-open settings to 'updates' section when update is ready
  useEffect(() => {
    const cleanupDownloaded = window.electronAPI.onAppUpdateDownloaded(() => {
      console.warn('[App] Update downloaded, opening settings to updates section');
      useDialogStore.getState().openSettings('updates');
    });

    return () => {
      cleanupDownloaded();
    };
  }, []);

  // Global keyboard shortcut: Cmd/Ctrl+T to add project (when not on terminals view)
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      const activeView = useNavigationStore.getState().activeView;

      if ((e.ctrlKey || e.metaKey) && e.key === 't' && activeView !== 'terminals') {
        e.preventDefault();
        try {
          const path = await window.electronAPI.selectDirectory();
          if (path) {
            const project = await addProject(path);
            if (project) {
              handleProjectAdded(project, !project.autoBuildPath);
            }
          }
        } catch (error) {
          console.error('Failed to add project:', error);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

/**
 * Handle project initialization (used by AppDialogs).
 */
export async function handleInitialize() {
  const { pendingProject } = useDialogStore.getState();
  if (!pendingProject) return;

  const projectId = pendingProject.id;
  console.warn('[InitDialog] Starting initialization for project:', projectId);
  useDialogStore.getState().setInitializing(true);
  useDialogStore.getState().setInitSuccess(false);
  useDialogStore.getState().setInitError(null);

  try {
    const result = await initializeProject(projectId);
    console.warn('[InitDialog] Initialization result:', result);

    if (result?.success) {
      console.warn('[InitDialog] Initialization successful, closing dialog');
      const updatedProject = useProjectStore.getState().projects.find(p => p.id === projectId);
      console.warn('[InitDialog] Updated project:', updatedProject);

      useDialogStore.getState().setInitSuccess(true);
      useDialogStore.getState().setInitializing(false);

      // Close the init dialog via store action
      useDialogStore.getState().closeInitDialog();

      // Show GitHub setup modal
      if (updatedProject) {
        useDialogStore.getState().openGitHubSetup(updatedProject);
      }
    } else {
      console.warn('[InitDialog] Initialization failed, showing error');
      const errorMessage = result?.error || i18n.t('errors:initialize.failed');
      useDialogStore.getState().setInitError(errorMessage);
      useDialogStore.getState().setInitializing(false);
    }
  } catch (error) {
    console.error('[InitDialog] Unexpected error during initialization:', error);
    const errorMessage = error instanceof Error ? error.message : i18n.t('errors:initialize.unexpected');
    useDialogStore.getState().setInitError(errorMessage);
    useDialogStore.getState().setInitializing(false);
  }
}

/**
 * Handle GitHub setup completion (used by AppDialogs).
 */
export async function handleGitHubSetupComplete(settings: {
  githubToken: string;
  githubRepo: string;
  mainBranch: string;
  githubAuthMethod?: 'oauth' | 'pat';
}) {
  const { gitHubSetupProject } = useDialogStore.getState();
  if (!gitHubSetupProject) return;

  try {
    await window.electronAPI.updateProjectEnv(gitHubSetupProject.id, {
      githubEnabled: true,
      githubToken: settings.githubToken,
      githubRepo: settings.githubRepo,
      githubAuthMethod: settings.githubAuthMethod
    });

    await window.electronAPI.updateProjectSettings(gitHubSetupProject.id, {
      mainBranch: settings.mainBranch
    });

    await loadProjects();
  } catch (error) {
    console.error('Failed to save GitHub settings:', error);
  }

  useDialogStore.getState().closeGitHubSetup();
}

/**
 * Handle project added callback (used by AppDialogs).
 */
export function handleProjectAdded(project: Project, needsInit: boolean) {
  useProjectStore.getState().openProjectTab(project.id);
  if (needsInit) {
    useDialogStore.getState().openInitDialog(project);
  }
}

/**
 * Handle project tab close — opens remove confirmation (used by TopNavBar).
 */
export function handleProjectTabClose(projectId: string) {
  const project = useProjectStore.getState().projects.find(p => p.id === projectId);
  if (project) {
    useDialogStore.getState().openRemoveProjectDialog(project);
  }
}
