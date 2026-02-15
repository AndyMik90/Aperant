import { useState, useEffect } from 'react';
import { useProjectStore, selectCurrentProject } from '@/stores/project-store';
import { useSettingsStore, loadSettings, loadProfiles } from '@/stores/settings-store';
import { loadClaudeProfiles } from '@/stores/claude-profile-store';
import { loadProjects } from '@/stores/project-store';
import { loadTasks, useTaskStore } from '@/stores/task-store';
import { restoreTerminalSessions } from '@/stores/terminal-store';
import { initializeGitHubListeners } from '@/stores/github';
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
  const getProjectTabs = useProjectStore((state) => state.getProjectTabs);
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
    };
  }, []);

  // Restore tab state and open tabs for loaded projects
  const projectTabs = getProjectTabs();
  useEffect(() => {
    console.warn('[App] Tab restore useEffect triggered:', {
      projectsCount: projects.length,
      openProjectIds,
      activeProjectId,
      selectedProjectId,
      projectTabsCount: projectTabs.length,
      projectTabIds: projectTabs.map(p => p.id)
    });

    if (projects.length > 0) {
      if (openProjectIds.length === 0) {
        const projectToOpen = activeProjectId || selectedProjectId || projects[0].id;
        console.warn('[App] No tabs persisted, opening project:', projectToOpen);
        if (projects.some(p => p.id === projectToOpen)) {
          openProjectTab(projectToOpen);
          setActiveProject(projectToOpen);
        } else {
          console.warn('[App] Project not found, falling back to first project:', projects[0].id);
          openProjectTab(projects[0].id);
          setActiveProject(projects[0].id);
        }
        return;
      }
      console.warn('[App] Tabs already persisted, checking active project');
      if (activeProjectId && !openProjectIds.includes(activeProjectId)) {
        console.warn('[App] Active project has no tab, opening:', activeProjectId);
        openProjectTab(activeProjectId);
      }
      else if (selectedProjectId && !activeProjectId) {
        console.warn('[App] No active project, using selected:', selectedProjectId);
        setActiveProject(selectedProjectId);
        openProjectTab(selectedProjectId);
      } else {
        console.warn('[App] Tab state is valid, no action needed');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- projectTabs is intentionally omitted to avoid infinite re-render (computed array creates new reference each render); projectTabs.length is sufficient
  }, [projects, activeProjectId, selectedProjectId, openProjectIds, openProjectTab, setActiveProject, projectTabs.length]);

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
