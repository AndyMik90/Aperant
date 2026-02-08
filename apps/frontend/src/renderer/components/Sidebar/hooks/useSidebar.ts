import { removeProject } from "@/stores/project-store";
import { Project } from "@shared/types";
import { initializeProject } from "src/main/project-initializer";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "src/renderer/stores/project-store";
import { useSettingsStore } from "src/renderer/stores/settings-store";
import { useEffect, useMemo, useRef, useState } from "react";
import { GitStatus } from "@shared/types";
import { clearProjectEnvConfig, loadProjectEnvConfig, useProjectEnvStore } from "@/stores/project-env-store";
import { baseNavItems, githubNavItems, gitlabNavItems, SidebarProps, SidebarView } from "../constants/types";

const useSidebar = ({onViewChange}: SidebarProps) => {
    const { t } = useTranslation(['navigation', 'dialogs', 'common']);
    const projects = useProjectStore((state) => state.projects);
    const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
    const settings = useSettingsStore((state) => state.settings);

    const [showAddProjectModal, setShowAddProjectModal] = useState(false);
    const [showInitDialog, setShowInitDialog] = useState(false);
    const [showGitSetupModal, setShowGitSetupModal] = useState(false);
    const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
    const [pendingProject, setPendingProject] = useState<Project | null>(null);
    const [isInitializing, setIsInitializing] = useState(false);

    const selectedProject = projects.find((p) => p.id === selectedProjectId);

    // Subscribe to project-env-store for reactive GitHub/GitLab tab visibility
    const githubEnabled = useProjectEnvStore((state) => state.envConfig?.githubEnabled ?? false);
    const gitlabEnabled = useProjectEnvStore((state) => state.envConfig?.gitlabEnabled ?? false);

    // Track the last loaded project ID to avoid redundant loads
    const lastLoadedProjectIdRef = useRef<string | null>(null);

    // Compute visible nav items based on GitHub/GitLab enabled state from store
    const visibleNavItems = useMemo(() => {
      const items = [...baseNavItems];

      if (githubEnabled) {
        items.push(...githubNavItems);
      }

      if (gitlabEnabled) {
        items.push(...gitlabNavItems);
      }

      return items;
    }, [githubEnabled, gitlabEnabled]);

    // Load envConfig when project changes to ensure store is populated
    useEffect(() => {
      // Track whether this effect is still current (for race condition handling)
      let isCurrent = true;

      const initializeEnvConfig = async () => {
        if (selectedProject?.id && selectedProject?.autoBuildPath) {
          // Only reload if the project ID differs from what we last loaded
          if (selectedProject.id !== lastLoadedProjectIdRef.current) {
            lastLoadedProjectIdRef.current = selectedProject.id;
            await loadProjectEnvConfig(selectedProject.id);
            // Check if this effect was cancelled while loading
            if (!isCurrent) return;
          }
        } else {
          // Clear the store if no project is selected or has no autoBuildPath
          lastLoadedProjectIdRef.current = null;
          clearProjectEnvConfig();
        }
      };
      initializeEnvConfig();

      // Cleanup function to mark this effect as stale
      return () => {
        isCurrent = false;
      };
    }, [selectedProject?.id, selectedProject?.autoBuildPath]);

    // Keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Don't trigger shortcuts when typing in inputs
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement ||
          (e.target as HTMLElement)?.isContentEditable
        ) {
          return;
        }

        // Only handle shortcuts when a project is selected
        if (!selectedProjectId) return;

        // Check for modifier keys - we want plain key presses only
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        const key = e.key.toUpperCase();

        // Find matching nav item from visible items only
        const matchedItem = visibleNavItems.find((item) => item.shortcut === key);

        if (matchedItem) {
          e.preventDefault();
          onViewChange?.(matchedItem.id);
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedProjectId, onViewChange, visibleNavItems]);

    // Check git status when project changes
    useEffect(() => {
      const checkGit = async () => {
        if (selectedProject) {
          try {
            const result = await window.electronAPI.checkGitStatus(selectedProject.path);
            if (result.success && result.data) {
              setGitStatus(result.data);
              // Show git setup modal if project is not a git repo or has no commits
              if (!result.data.isGitRepo || !result.data.hasCommits) {
                setShowGitSetupModal(true);
              }
            }
          } catch (error) {
            console.error('Failed to check git status:', error);
          }
        } else {
          setGitStatus(null);
        }
      };
      checkGit();
    }, [selectedProject]);

    const handleProjectAdded = (project: Project, needsInit: boolean) => {
      if (needsInit) {
        setPendingProject(project);
        setShowInitDialog(true);
      }
    };

    const handleInitialize = async () => {
      if (!pendingProject) return;

      const projectId = pendingProject.id;
      setIsInitializing(true);
      try {
        const result = await initializeProject(projectId);
        if (result?.success) {
          // Clear pendingProject FIRST before closing dialog
          // This prevents onOpenChange from triggering skip logic
          setPendingProject(null);
          setShowInitDialog(false);
        }
      } finally {
        setIsInitializing(false);
      }
    };

    const handleSkipInit = () => {
      setShowInitDialog(false);
      setPendingProject(null);
    };

    const handleGitInitialized = async () => {
      // Refresh git status after initialization
      if (selectedProject) {
        try {
          const result = await window.electronAPI.checkGitStatus(selectedProject.path);
          if (result.success && result.data) {
            setGitStatus(result.data);
          }
        } catch (error) {
          console.error('Failed to refresh git status:', error);
        }
      }
    };

    const _handleRemoveProject = async (projectId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      await removeProject(projectId);
    };

    const handleNavClick = (view: SidebarView) => {
      onViewChange?.(view);
    };
    return {
        showAddProjectModal,
        setShowAddProjectModal,
        showInitDialog,
        setShowInitDialog,
        showGitSetupModal,
        setShowGitSetupModal,
        gitStatus,
        setGitStatus,
        pendingProject,
        setPendingProject,
        isInitializing,
        setIsInitializing,
        selectedProject,
        visibleNavItems,
        handleProjectAdded,
        handleInitialize,
        handleSkipInit,
        handleGitInitialized,
        _handleRemoveProject,
        handleNavClick,
        githubEnabled,
        gitlabEnabled,
        lastLoadedProjectIdRef,
        t,
        projects,
        selectedProjectId,
        settings,
    }
}

export default useSidebar;
