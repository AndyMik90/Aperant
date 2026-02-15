import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore, saveSettings } from "@/stores/settings-store";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitStatus } from "@shared/types";
import { clearProjectEnvConfig, loadProjectEnvConfig, useProjectEnvStore } from "@/stores/project-env-store";
import { baseNavItems, githubNavItems, gitlabNavItems, SidebarProps, SidebarView } from "../constants/types";

const useSidebar = ({onViewChange}: SidebarProps) => {
    const { t } = useTranslation(['navigation', 'dialogs', 'common']);
    const projects = useProjectStore((state) => state.projects);
    const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
    const isCollapsed = useSettingsStore((state) => state.settings.sidebarCollapsed) ?? false;

    // Sidebar collapse state — owned here now (no longer from shadcn SidebarProvider)
    const toggleSidebar = useCallback(() => {
      saveSettings({ sidebarCollapsed: !isCollapsed });
    }, [isCollapsed]);

    // Git setup state (Sidebar-owned — not part of dialog-store since it's Sidebar-specific)
    const [showGitSetupModal, setShowGitSetupModal] = useState(false);
    const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);

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
            // Defense-in-depth: check if this effect was cancelled while loading.
            // Works in concert with the store's requestId pattern to prevent
            // stale async results from overwriting current state.
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

        // Cmd/Ctrl+B: Toggle sidebar collapse
        if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
          e.preventDefault();
          toggleSidebar();
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
    }, [selectedProjectId, onViewChange, visibleNavItems, toggleSidebar]);

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
    }, [selectedProject?.id, selectedProject?.path]);

    const handleGitInitialized = useCallback(async () => {
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
    }, [selectedProject]);

    const handleNavClick = useCallback((view: SidebarView) => {
      onViewChange?.(view);
    }, [onViewChange]);
    return {
        showGitSetupModal,
        setShowGitSetupModal,
        gitStatus,
        selectedProject,
        visibleNavItems,
        handleNavClick,
        handleGitInitialized,
        t,
        selectedProjectId,
        isCollapsed,
        toggleSidebar,
    }
}

export default useSidebar;
