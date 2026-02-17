import { useState, useEffect } from 'react';
import { useProjectStore, selectCurrentProject } from '@/stores/project-store';
import { useSettingsStore, loadSettings, loadProfiles } from '@/stores/settings-store';
import { loadClaudeProfiles } from '@/stores/claude-profile-store';
import { loadProjects } from '@/stores/project-store';
import { loadTasks, useTaskStore } from '@/stores/task-store';
import { restoreTerminalSessions } from '@/stores/terminal-store';
import { initializeGitHubListeners, cleanupGitHubListeners } from '@/stores/github';
import { initDownloadProgressListener } from '@/stores/download-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useDialogStore } from '@/stores/dialog-store';

/**
 * Handles initial app load, tab restore, project init detection, and task loading.
 * Returns settingsHaveLoaded for downstream hooks (onboarding, version warning).
 */
export function useAppInitialization(): { settingsHaveLoaded: boolean } {
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const openProjectIds = useProjectStore((state) => state.openProjectIds);
  const openProjectTab = useProjectStore((state) => state.openProjectTab);
  const setActiveProject = useProjectStore((state) => state.setActiveProject);
  const settingsLoading = useSettingsStore((state) => state.isLoading);

  const selectedProject = useProjectStore(selectCurrentProject);

  const isInitializing = useDialogStore((state) => state.isInitializing);
  const initSuccess = useDialogStore((state) => state.initSuccess);
  const skippedInitProjectId = useDialogStore((state) => state.skippedInitProjectId);

  // Track if settings have been loaded at least once
  const [settingsHaveLoaded, setSettingsHaveLoaded] = useState(false);

  // Initial load
  useEffect(() => {
    loadProjects();
    loadSettings();
    loadProfiles();
    loadClaudeProfiles();
    initializeGitHubListeners();
    const cleanupDownloadListener = initDownloadProgressListener();

    return () => {
      cleanupDownloadListener();
      cleanupGitHubListeners();
    };
  }, []);

  // Restore tab state and open tabs for loaded projects
  useEffect(() => {
    if (projects.length > 0) {
      if (openProjectIds.length === 0) {
        const projectToOpen = activeProjectId || selectedProjectId || projects[0].id;
        if (projects.some(p => p.id === projectToOpen)) {
          openProjectTab(projectToOpen);
          setActiveProject(projectToOpen);
        } else {
          openProjectTab(projects[0].id);
          setActiveProject(projects[0].id);
        }
        return;
      }
      if (activeProjectId && !openProjectIds.includes(activeProjectId)) {
        openProjectTab(activeProjectId);
      }
      else if (selectedProjectId && !activeProjectId) {
        setActiveProject(selectedProjectId);
        openProjectTab(selectedProjectId);
      }
    }
  }, [projects, activeProjectId, selectedProjectId, openProjectIds, openProjectTab, setActiveProject]);

  // Mark settings as loaded when loading completes
  useEffect(() => {
    if (!settingsLoading && !settingsHaveLoaded) {
      setSettingsHaveLoaded(true);
    }
  }, [settingsLoading, settingsHaveLoaded]);

  // Reset init success flag on mount
  useEffect(() => {
    useDialogStore.getState().resetInitState();
  }, []);

  // Check if selected project needs initialization
  useEffect(() => {
    if (isInitializing) return;
    if (initSuccess) return;

    if (selectedProject && !selectedProject.autoBuildPath && skippedInitProjectId !== selectedProject.id) {
      useDialogStore.getState().openInitDialog(selectedProject);
    }
  }, [selectedProject, skippedInitProjectId, isInitializing, initSuccess]);

  // Load tasks when project changes
  useEffect(() => {
    const currentProjectId = activeProjectId || selectedProjectId;
    if (currentProjectId) {
      loadTasks(currentProjectId);
      useNavigationStore.getState().clearSelectedTask();
    } else {
      useTaskStore.getState().clearTasks();
    }

    if (selectedProject?.path) {
      restoreTerminalSessions(selectedProject.path).catch((err) => {
        console.error('[App] Failed to restore sessions:', err);
      });
    }
  }, [activeProjectId, selectedProjectId, selectedProject?.path]);

  return { settingsHaveLoaded };
}
