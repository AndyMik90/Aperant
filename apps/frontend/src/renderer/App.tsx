import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { debugLog } from '../shared/utils/debug-logger';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy
} from '@dnd-kit/sortable';
import { TooltipProvider } from './components/ui/tooltip';
import { Button } from './components/ui/button';
import { Toaster } from './components/ui/toaster';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './components/ui/dialog';
import { RadioGroup, RadioGroupItem } from './components/ui/radio-group';
import { Label } from './components/ui/label';
import { Sidebar, type SidebarView } from './components/Sidebar';
import { KanbanBoard } from './components/KanbanBoard';
import { TasksHub } from './components/TasksHub';
import { TaskDetailModal } from './components/task-detail/TaskDetailModal';
import { TaskCreationWizard } from './components/TaskCreationWizard';
import { QuickTaskDialog } from './components/QuickTaskDialog';
import { GlobalSearchDialog } from './components/GlobalSearchDialog';
import type { AppSection } from './components/settings/AppSettings';
import type { ProjectSettingsSection } from './components/settings/ProjectSettingsContent';
import { TerminalGrid } from './components/TerminalGrid';
import { BottomPanelTerminal } from './components/terminal/BottomPanelTerminal';
import { GitHubHub } from './components/GitHubHub';
import { WelcomeScreen } from './components/WelcomeScreen';
import { RateLimitModal } from './components/RateLimitModal';
import { SDKRateLimitModal } from './components/SDKRateLimitModal';
import { AppUpdateNotification } from './components/AppUpdateNotification';
import { ProactiveSwapListener } from './components/ProactiveSwapListener';
import { GitHubSetupModal } from './components/GitHubSetupModal';

// Lazy-loaded components for code splitting (reduces initial bundle size)
const DiscoveryHub = lazy(() => import('./components/DiscoveryHub').then(m => ({ default: m.DiscoveryHub })));
const Context = lazy(() => import('./components/Context').then(m => ({ default: m.Context })));
const RepositoryHub = lazy(() => import('./components/RepositoryHub').then(m => ({ default: m.RepositoryHub })));
const Insights = lazy(() => import('./components/Insights').then(m => ({ default: m.Insights })));
const GitLabIssues = lazy(() => import('./components/GitLabIssues').then(m => ({ default: m.GitLabIssues })));
const GitLabMergeRequests = lazy(() => import('./components/gitlab-merge-requests').then(m => ({ default: m.GitLabMergeRequests })));
const Changelog = lazy(() => import('./components/Changelog').then(m => ({ default: m.Changelog })));
const Worktrees = lazy(() => import('./components/Worktrees').then(m => ({ default: m.Worktrees })));
const OnboardingWizard = lazy(() => import('./components/onboarding').then(m => ({ default: m.OnboardingWizard })));
const AppSettingsDialog = lazy(() => import('./components/settings/AppSettings').then(m => ({ default: m.AppSettingsDialog })));

// Loading fallback component for lazy-loaded views
function ViewLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
import { useProjectStore, loadProjects, addProject, initializeProject, removeProject } from './stores/project-store';
import { useTaskStore, loadTasks } from './stores/task-store';
import { useSettingsStore, loadSettings, loadProfiles } from './stores/settings-store';
import { useClaudeProfileStore } from './stores/claude-profile-store';
import { useTerminalStore, restoreTerminalSessions, recreateTaskMonitorTerminals } from './stores/terminal-store';
import { initializeGitHubListeners } from './stores/github';
import { initDownloadProgressListener } from './stores/download-store';
import { setupDriftListeners } from './stores/drift-store';
import { GlobalDownloadIndicator } from './components/GlobalDownloadIndicator';
import { useIpcListeners } from './hooks/useIpc';
import { useGlobalTerminalListeners } from './hooks/useGlobalTerminalListeners';
import { COLOR_THEMES, UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_DEFAULT } from '../shared/constants';
import type { Task, Project, ColorTheme } from '../shared/types';
import { ProjectTabBar } from './components/ProjectTabBar';
import { AddProjectModal } from './components/AddProjectModal';
import { ViewStateProvider } from './contexts/ViewStateContext';
import { NavigationProvider } from './contexts/NavigationContext';

// Wrapper component for ProjectTabBar
interface ProjectTabBarWithContextProps {
  projects: Project[];
  activeProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  onProjectClose: (projectId: string) => void;
  onAddProject: () => void;
  onSettingsClick: () => void;
}

function ProjectTabBarWithContext({
  projects,
  activeProjectId,
  onProjectSelect,
  onProjectClose,
  onAddProject,
  onSettingsClick
}: ProjectTabBarWithContextProps) {
  return (
    <ProjectTabBar
      projects={projects}
      activeProjectId={activeProjectId}
      onProjectSelect={onProjectSelect}
      onProjectClose={onProjectClose}
      onAddProject={onAddProject}
      onSettingsClick={onSettingsClick}
    />
  );
}

export function App() {
  // Load IPC listeners for real-time updates
  useIpcListeners();

  // Load global terminal output listeners to buffer output across project switches
  // This ensures terminal output is captured even when the terminal component is not rendered
  useGlobalTerminalListeners();

  // Stores
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const getProjectTabs = useProjectStore((state) => state.getProjectTabs);
  const openProjectIds = useProjectStore((state) => state.openProjectIds);
  const openProjectTab = useProjectStore((state) => state.openProjectTab);
  const setActiveProject = useProjectStore((state) => state.setActiveProject);
  const reorderTabs = useProjectStore((state) => state.reorderTabs);
  const tasks = useTaskStore((state) => state.tasks);
  const settings = useSettingsStore((state) => state.settings);
  const settingsLoading = useSettingsStore((state) => state.isLoading);

  // API Profile state
  const profiles = useSettingsStore((state) => state.profiles);
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);

  // Bottom panel terminal state (persists across navigation)
  const bottomPanel = useTerminalStore((state) => state.bottomPanel);
  const closeBottomPanel = useTerminalStore((state) => state.closeBottomPanel);
  const closeBottomPanelTab = useTerminalStore((state) => state.closeBottomPanelTab);
  const openBottomPanel = useTerminalStore((state) => state.openBottomPanel);
  const minimizeBottomPanel = useTerminalStore((state) => state.minimizeBottomPanel);
  const toggleSplitMode = useTerminalStore((state) => state.toggleSplitMode);
  const setSplitTask = useTerminalStore((state) => state.setSplitTask);

  // Claude Profile state (OAuth)
  const claudeProfiles = useClaudeProfileStore((state) => state.profiles);

  // UI State
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isNewTaskDialogOpen, setIsNewTaskDialogOpen] = useState(false);
  const [isQuickTaskDialogOpen, setIsQuickTaskDialogOpen] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<AppSection | undefined>(undefined);
  const [settingsInitialProjectSection, setSettingsInitialProjectSection] = useState<ProjectSettingsSection | undefined>(undefined);
  const [activeView, setActiveView] = useState<SidebarView>('kanban');
  const [isOnboardingWizardOpen, setIsOnboardingWizardOpen] = useState(false);
  const [isRefreshingTasks, setIsRefreshingTasks] = useState(false);

  // Initialize dialog state
  const [showInitDialog, setShowInitDialog] = useState(false);
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initSuccess, setInitSuccess] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [skippedInitProjectId, setSkippedInitProjectId] = useState<string | null>(null);
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);

  // GitHub setup state (shown after Jerry init)
  const [showGitHubSetup, setShowGitHubSetup] = useState(false);
  const [gitHubSetupProject, setGitHubSetupProject] = useState<Project | null>(null);

  // Remove project confirmation state
  const [showRemoveProjectDialog, setShowRemoveProjectDialog] = useState(false);
  const [removeProjectError, setRemoveProjectError] = useState<string | null>(null);
  const [deleteDataOption, setDeleteDataOption] = useState<'keep' | 'delete'>('keep');
  const [projectToRemove, setProjectToRemove] = useState<Project | null>(null);

  // Setup drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    })
  );

  // Track dragging state for overlay
  const [activeDragProject, setActiveDragProject] = useState<Project | null>(null);

  // Get tabs and selected project
  const projectTabs = getProjectTabs();
  const selectedProject = projects.find((p) => p.id === (activeProjectId || selectedProjectId));

  // Initial load
  useEffect(() => {
    loadProjects();
    loadSettings();
    loadProfiles();
    // Initialize global GitHub listeners (PR reviews, etc.) so they persist across navigation
    initializeGitHubListeners();
    // Initialize global download progress listener for Ollama model downloads
    const cleanupDownloadListener = initDownloadProgressListener();
    // Initialize drift monitoring listeners for real-time drift updates
    const cleanupDriftListeners = setupDriftListeners();

    return () => {
      cleanupDownloadListener();
      cleanupDriftListeners();
    };
  }, []);

  // Restore tab state and open tabs for loaded projects
  useEffect(() => {
    console.log('[App] Tab restore useEffect triggered:', {
      projectsCount: projects.length,
      openProjectIds,
      activeProjectId,
      selectedProjectId,
      projectTabsCount: projectTabs.length,
      projectTabIds: projectTabs.map(p => p.id)
    });

    if (projects.length > 0) {
      // Check openProjectIds (persisted state) instead of projectTabs (computed)
      // to avoid race condition where projectTabs is empty before projects load
      if (openProjectIds.length === 0) {
        // No tabs persisted at all, open the first available project
        const projectToOpen = activeProjectId || selectedProjectId || projects[0].id;
        console.log('[App] No tabs persisted, opening project:', projectToOpen);
        // Verify the project exists before opening
        if (projects.some(p => p.id === projectToOpen)) {
          openProjectTab(projectToOpen);
          setActiveProject(projectToOpen);
        } else {
          // Fallback to first project if stored IDs are invalid
          console.log('[App] Project not found, falling back to first project:', projects[0].id);
          openProjectTab(projects[0].id);
          setActiveProject(projects[0].id);
        }
        return;
      }
      console.log('[App] Tabs already persisted, checking active project');
      // If there's an active project but no tabs open for it, open a tab
      // Note: Use openProjectIds instead of projectTabs to avoid re-render loop
      // (projectTabs creates a new array on every render)
      if (activeProjectId && !openProjectIds.includes(activeProjectId)) {
        console.log('[App] Active project has no tab, opening:', activeProjectId);
        openProjectTab(activeProjectId);
      }
      // If there's a selected project but no active project, make it active
      else if (selectedProjectId && !activeProjectId) {
        console.log('[App] No active project, using selected:', selectedProjectId);
        setActiveProject(selectedProjectId);
        openProjectTab(selectedProjectId);
      } else {
        console.log('[App] Tab state is valid, no action needed');
      }
    }
  }, [projects, activeProjectId, selectedProjectId, openProjectIds, openProjectTab, setActiveProject]);

  // Track if settings have been loaded at least once
  const [settingsHaveLoaded, setSettingsHaveLoaded] = useState(false);

  // Mark settings as loaded when loading completes
  useEffect(() => {
    if (!settingsLoading && !settingsHaveLoaded) {
      setSettingsHaveLoaded(true);
    }
  }, [settingsLoading, settingsHaveLoaded]);

  // First-run detection - show onboarding wizard if not completed
  // Only check AFTER settings have been loaded from disk to avoid race condition
  useEffect(() => {
    // Check if either auth method is configured
    // API profiles: if profiles exist, auth is configured (user has gone through setup)
    const hasAPIProfileConfigured = profiles.length > 0;
    const hasOAuthConfigured = claudeProfiles.some(p =>
      p.oauthToken || (p.isDefault && p.configDir)
    );
    const hasAnyAuth = hasAPIProfileConfigured || hasOAuthConfigured;

    // Only show wizard if onboarding not completed AND no auth is configured
    if (settingsHaveLoaded &&
        settings.onboardingCompleted === false &&
        !hasAnyAuth) {
      setIsOnboardingWizardOpen(true);
    }
  }, [settingsHaveLoaded, settings.onboardingCompleted, profiles, claudeProfiles]);

  // Sync i18n language with settings
  const { t, i18n } = useTranslation('dialogs');
  useEffect(() => {
    if (settings.language && settings.language !== i18n.language) {
      i18n.changeLanguage(settings.language);
    }
  }, [settings.language, i18n]);

  // Listen for open-app-settings events (e.g., from project settings)
  useEffect(() => {
    const handleOpenAppSettings = (event: Event) => {
      const customEvent = event as CustomEvent<AppSection>;
      const section = customEvent.detail;
      if (section) {
        setSettingsInitialSection(section);
      }
      setIsSettingsDialogOpen(true);
    };

    window.addEventListener('open-app-settings', handleOpenAppSettings);
    return () => {
      window.removeEventListener('open-app-settings', handleOpenAppSettings);
    };
  }, []);

  // Listen for app updates - auto-open settings to 'updates' section when update is ready
  useEffect(() => {
    // When an update is downloaded and ready to install, open settings to updates section
    const cleanupDownloaded = window.electronAPI.onAppUpdateDownloaded(() => {
      console.warn('[App] Update downloaded, opening settings to updates section');
      setSettingsInitialSection('updates');
      setIsSettingsDialogOpen(true);
    });

    return () => {
      cleanupDownloaded();
    };
  }, []);

  // Reset init success flag when selected project changes
  // This allows the init dialog to show for new/different projects
  useEffect(() => {
    setInitSuccess(false);
    setInitError(null);
  }, [selectedProjectId]);

  // Check if selected project needs initialization (e.g., .auto-claude folder was deleted)
  useEffect(() => {
    // Don't show dialog while initialization is in progress
    if (isInitializing) return;

    // Don't reopen dialog after successful initialization
    // (project update with autoBuildPath may not have propagated yet)
    if (initSuccess) return;

    if (selectedProject && !selectedProject.autoBuildPath && skippedInitProjectId !== selectedProject.id) {
      // Project exists but isn't initialized - show init dialog
      setPendingProject(selectedProject);
      setInitError(null); // Clear any previous errors
      setInitSuccess(false); // Reset success flag
      setShowInitDialog(true);
    }
  }, [selectedProject, skippedInitProjectId, isInitializing, initSuccess]);

  // Global keyboard shortcut: Cmd/Ctrl+T to add project (when not on terminals view)
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Skip if in input fields
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Cmd/Ctrl+T: Add new project (only when not on terminals view)
      if ((e.ctrlKey || e.metaKey) && e.key === 't' && activeView !== 'terminals') {
        e.preventDefault();
        try {
          const path = await window.electronAPI.selectDirectory();
          if (path) {
            const project = await addProject(path);
            if (project) {
              openProjectTab(project.id);
              if (!project.autoBuildPath) {
                setPendingProject(project);
                setInitError(null);
                setInitSuccess(false);
                setShowInitDialog(true);
              }
            }
          }
        } catch (error) {
          console.error('Failed to add project:', error);
        }
      }

      // SUG-2: Cmd/Ctrl+K: Quick task creation
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const currentProjectId = activeProjectId || selectedProjectId;
        if (currentProjectId) {
          setIsQuickTaskDialogOpen(true);
        }
      }

      // SUG-8: Cmd/Ctrl+P: Global search
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        const currentProjectId = activeProjectId || selectedProjectId;
        if (currentProjectId) {
          setIsGlobalSearchOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView, openProjectTab, activeProjectId, selectedProjectId]);

  // Load tasks when project changes
  useEffect(() => {
    const currentProjectId = activeProjectId || selectedProjectId;
    if (currentProjectId) {
      loadTasks(currentProjectId);
      setSelectedTask(null); // Clear selection on project change
    } else {
      useTaskStore.getState().clearTasks();
    }

    // Handle terminals on project change - DON'T destroy, just restore if needed
    // Terminals are now filtered by projectPath in TerminalGrid, so each project
    // sees only its own terminals. PTY processes stay alive across project switches.
    if (selectedProject?.path) {
      console.log('[App] Restoring terminal sessions for project:', selectedProject.path);
      restoreTerminalSessions(selectedProject.path).catch((err) => {
        console.error('[App] Failed to restore sessions:', err);
      });
    }
  }, [activeProjectId, selectedProjectId, selectedProject?.path, selectedProject?.name]);

  // Recreate task monitor terminals after tasks are loaded.
  // Debounced: tasks.length changes rapidly as tasks are created (10→11→12→13→14),
  // and each call triggers redundant stuck-task restarts.
  const recreateTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!selectedProject?.path || tasks.length === 0) return;

    // Clear any pending call — only the last one within the debounce window fires
    if (recreateTimerRef.current) clearTimeout(recreateTimerRef.current);

    recreateTimerRef.current = setTimeout(() => {
      console.log('[App] Tasks loaded, recreating task monitor terminals with', tasks.length, 'tasks');
      const store = useTerminalStore.getState();
      const currentTasks = [...tasks];
      recreateTaskMonitorTerminals(selectedProject.path, store, currentTasks).then(() => {
        // Mark interrupted coding tasks so UI shows Resume button instead of Stop
        const taskStore = useTaskStore.getState();
        for (const task of currentTasks) {
          if (task.status === 'coding') {
            window.electronAPI.checkTaskRunning(task.id).then(result => {
              if (result.success && result.data === false) {
                taskStore.setAgentStopped(task.id, true);
              }
            }).catch(() => { /* ignore check errors */ });
          }
        }
      }).catch((err) => {
        console.error('[App] Failed to recreate task monitors:', err);
      });
    }, 2000); // 2s debounce — coalesces rapid tasks.length changes

    return () => {
      if (recreateTimerRef.current) clearTimeout(recreateTimerRef.current);
    };
    // Only depend on tasks.length and path, NOT the tasks array itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length, selectedProject?.path]);

  // Apply theme on load
  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = () => {
      // Apply light/dark mode
      if (settings.theme === 'dark') {
        root.classList.add('dark');
      } else if (settings.theme === 'light') {
        root.classList.remove('dark');
      } else {
        // System preference
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }
    };

    // Apply color theme via data-theme attribute
    // Validate colorTheme against known themes, fallback to 'default' if invalid
    const validThemeIds = COLOR_THEMES.map((t) => t.id);
    const rawColorTheme = settings.colorTheme ?? 'default';
    const colorTheme: ColorTheme = validThemeIds.includes(rawColorTheme as ColorTheme)
      ? (rawColorTheme as ColorTheme)
      : 'default';

    if (colorTheme === 'default') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', colorTheme);
    }

    applyTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (settings.theme === 'system') {
        applyTheme();
      }
    };
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [settings.theme, settings.colorTheme]);

  // Apply UI scale
  useEffect(() => {
    const root = document.documentElement;
    const scale = settings.uiScale ?? UI_SCALE_DEFAULT;
    const clampedScale = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, scale));
    root.setAttribute('data-ui-scale', clampedScale.toString());
  }, [settings.uiScale]);

  // Update selected task when tasks change (for real-time updates)
  useEffect(() => {
    if (!selectedTask) {
      debugLog('[App] No selected task to update');
      return;
    }

    const updatedTask = tasks.find(
      (t) => t.id === selectedTask.id || t.specId === selectedTask.specId
    );

    debugLog('[App] Task lookup result', {
      found: !!updatedTask,
      updatedTaskId: updatedTask?.id,
      selectedTaskId: selectedTask.id,
    });

    if (!updatedTask) {
      debugLog('[App] Updated task not found in tasks array');
      return;
    }

    // Compare all mutable fields that affect UI state
    const subtasksChanged =
      JSON.stringify(selectedTask.subtasks || []) !==
      JSON.stringify(updatedTask.subtasks || []);
    const statusChanged = selectedTask.status !== updatedTask.status;
    const titleChanged = selectedTask.title !== updatedTask.title;
    const descriptionChanged = selectedTask.description !== updatedTask.description;
    const metadataChanged =
      JSON.stringify(selectedTask.metadata || {}) !==
      JSON.stringify(updatedTask.metadata || {});
    const executionProgressChanged =
      JSON.stringify(selectedTask.executionProgress || {}) !==
      JSON.stringify(updatedTask.executionProgress || {});
    const qaReportChanged =
      JSON.stringify(selectedTask.qaReport || {}) !==
      JSON.stringify(updatedTask.qaReport || {});
    const reviewReasonChanged = selectedTask.reviewReason !== updatedTask.reviewReason;
    const logsChanged =
      JSON.stringify(selectedTask.logs || []) !==
      JSON.stringify(updatedTask.logs || []);

    const hasChanged =
      subtasksChanged || statusChanged || titleChanged || descriptionChanged ||
      metadataChanged || executionProgressChanged || qaReportChanged ||
      reviewReasonChanged || logsChanged;

    debugLog('[App] Task comparison', {
      hasChanged,
      changes: {
        subtasks: subtasksChanged,
        status: statusChanged,
        title: titleChanged,
        description: descriptionChanged,
        metadata: metadataChanged,
        executionProgress: executionProgressChanged,
        qaReport: qaReportChanged,
        reviewReason: reviewReasonChanged,
        logs: logsChanged,
      },
    });

    if (hasChanged) {
      const reasons = [];
      if (subtasksChanged) reasons.push('Subtasks');
      if (statusChanged) reasons.push('Status');
      if (titleChanged) reasons.push('Title');
      if (descriptionChanged) reasons.push('Description');
      if (metadataChanged) reasons.push('Metadata');
      if (executionProgressChanged) reasons.push('ExecutionProgress');
      if (qaReportChanged) reasons.push('QAReport');
      if (reviewReasonChanged) reasons.push('ReviewReason');
      if (logsChanged) reasons.push('Logs');

      debugLog('[App] Updating selectedTask', {
        taskId: updatedTask.id,
        reason: reasons.join(', '),
      });
      setSelectedTask(updatedTask);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally omit selectedTask object to prevent infinite re-render loop
  }, [tasks, selectedTask?.id, selectedTask?.specId]);

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
  };

  const handleRefreshTasks = async () => {
    const currentProjectId = activeProjectId || selectedProjectId;
    if (!currentProjectId) return;
    setIsRefreshingTasks(true);
    try {
      await loadTasks(currentProjectId);
    } finally {
      setIsRefreshingTasks(false);
    }
  };

  const handleCloseTaskDetail = () => {
    setSelectedTask(null);
  };

  const handleOpenInbuiltTerminal = (_id: string, cwd: string) => {
    // Note: _id parameter is intentionally unused - terminal ID is auto-generated by addTerminal()
    // Parameter kept for callback signature consistency with callers
    console.log('[App] Opening inbuilt terminal:', { cwd });

    // Switch to terminals view
    setActiveView('terminals');

    // Close modal
    setSelectedTask(null);

    // Add terminal to store - this will trigger Terminal component to mount
    // which will then create the backend PTY via usePtyProcess
    // Note: TerminalGrid is always mounted (just hidden), so no need to wait
    const terminal = useTerminalStore.getState().addTerminal(cwd, selectedProject?.path);

    if (!terminal) {
      console.error('[App] Failed to add terminal to store (max terminals reached?)');
    } else {
      console.log('[App] Terminal added to store:', terminal.id);
    }
  };

  const handleAddProject = () => {
    setShowAddProjectModal(true);
  };

  const handleProjectAdded = (project: Project, needsInit: boolean) => {
    openProjectTab(project.id);
    if (needsInit) {
      setPendingProject(project);
      setInitError(null);
      setInitSuccess(false);
      setShowInitDialog(true);
    }
  };

  const handleProjectTabSelect = (projectId: string) => {
    setActiveProject(projectId);
  };

  const handleProjectTabClose = (projectId: string) => {
    // Show confirmation dialog before removing the project
    const project = projects.find(p => p.id === projectId);
    if (project) {
      setProjectToRemove(project);
      setShowRemoveProjectDialog(true);
    }
  };

  const handleConfirmRemoveProject = async () => {
    if (projectToRemove) {
      try {
        // Clear any previous error
        setRemoveProjectError(null);
        // Remove the project with optional data deletion
        const deleteData = deleteDataOption === 'delete';
        await removeProject(projectToRemove.id, deleteData);
        // Only clear dialog state on success
        setShowRemoveProjectDialog(false);
        setProjectToRemove(null);
        setDeleteDataOption('keep'); // Reset for next use
      } catch (err) {
        // Log error and keep dialog open so user can retry or cancel
        console.error('[App] Failed to remove project:', err);
        // Show error in dialog
        setRemoveProjectError(
          err instanceof Error ? err.message : t('common:errors.unknownError')
        );
      }
    }
  };

  const handleCancelRemoveProject = () => {
    setShowRemoveProjectDialog(false);
    setProjectToRemove(null);
    setRemoveProjectError(null);
    setDeleteDataOption('keep'); // Reset for next use
  };

  // Handle drag start - set the active dragged project
  const handleDragStart = (event: any) => {
    const { active } = event;
    const draggedProject = projectTabs.find(p => p.id === active.id);
    if (draggedProject) {
      setActiveDragProject(draggedProject);
    }
  };

  // Handle drag end - reorder tabs if dropped over another tab
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragProject(null);

    if (!over) return;

    const oldIndex = projectTabs.findIndex(p => p.id === active.id);
    const newIndex = projectTabs.findIndex(p => p.id === over.id);

    if (oldIndex !== newIndex && oldIndex !== -1 && newIndex !== -1) {
      reorderTabs(oldIndex, newIndex);
    }
  };

  const handleInitialize = async () => {
    if (!pendingProject) return;

    const projectId = pendingProject.id;
    console.log('[InitDialog] Starting initialization for project:', projectId);
    setIsInitializing(true);
    setInitSuccess(false);
    setInitError(null); // Clear any previous errors
    try {
      const result = await initializeProject(projectId);
      console.log('[InitDialog] Initialization result:', result);

      if (result?.success) {
        console.log('[InitDialog] Initialization successful, closing dialog');
        // Get the updated project from store
        const updatedProject = useProjectStore.getState().projects.find(p => p.id === projectId);
        console.log('[InitDialog] Updated project:', updatedProject);

        // Mark as successful to prevent onOpenChange from treating this as a skip
        setInitSuccess(true);
        setIsInitializing(false);

        // Now close the dialog
        setShowInitDialog(false);
        setPendingProject(null);

        // Show GitHub setup modal
        if (updatedProject) {
          setGitHubSetupProject(updatedProject);
          setShowGitHubSetup(true);
        }
      } else {
        // Initialization failed - show error but keep dialog open
        console.log('[InitDialog] Initialization failed, showing error');
        const errorMessage = result?.error || 'Failed to initialize Jerry. Please try again.';
        setInitError(errorMessage);
        setIsInitializing(false);
      }
    } catch (error) {
      // Unexpected error occurred
      console.error('[InitDialog] Unexpected error during initialization:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      setInitError(errorMessage);
      setIsInitializing(false);
    }
  };

  const handleGitHubSetupComplete = async (settings: {
    githubToken: string;
    githubRepo: string;
    mainBranch: string;
    githubAuthMethod?: 'oauth' | 'pat';
  }) => {
    if (!gitHubSetupProject) return;

    try {
      // NOTE: settings.githubToken is a GitHub access token (from gh CLI),
      // NOT a Claude Code OAuth token. They are different things:
      // - GitHub token: for GitHub API access (repo operations)
      // - Claude token: for Claude AI access (run.py, roadmap, etc.)
      // The user needs to separately authenticate with Claude using 'claude setup-token'

      // Update project env config with GitHub settings
      await window.electronAPI.updateProjectEnv(gitHubSetupProject.id, {
        githubEnabled: true,
        githubToken: settings.githubToken, // GitHub token for repo access
        githubRepo: settings.githubRepo,
        githubAuthMethod: settings.githubAuthMethod // Track how user authenticated
      });

      // Update project settings with mainBranch
      await window.electronAPI.updateProjectSettings(gitHubSetupProject.id, {
        mainBranch: settings.mainBranch
      });

      // Refresh projects to get updated data
      await loadProjects();
    } catch (error) {
      console.error('Failed to save GitHub settings:', error);
    }

    setShowGitHubSetup(false);
    setGitHubSetupProject(null);
  };

  const handleGitHubSetupSkip = () => {
    setShowGitHubSetup(false);
    setGitHubSetupProject(null);
  };

  const handleSkipInit = () => {
    console.log('[InitDialog] User skipped initialization');
    if (pendingProject) {
      setSkippedInitProjectId(pendingProject.id);
    }
    setShowInitDialog(false);
    setPendingProject(null);
    setInitError(null); // Clear any error when skipping
    setInitSuccess(false); // Reset success flag
  };

  const handleGoToTask = (taskId: string) => {
    // Switch to kanban view
    setActiveView('kanban');
    // Find and select the task (match by id or specId)
    const task = tasks.find((t) => t.id === taskId || t.specId === taskId);
    if (task) {
      setSelectedTask(task);
    }
  };

  return (
    <NavigationProvider activeView={activeView} setActiveView={setActiveView}>
      <ViewStateProvider>
        <TooltipProvider>
          <ProactiveSwapListener />
        <div className="flex h-screen bg-background">
        {/* Sidebar */}
        <Sidebar
          onSettingsClick={() => setIsSettingsDialogOpen(true)}
          activeView={activeView}
          onViewChange={setActiveView}
        />

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* macOS draggable titlebar region — spans content area above tabs */}
          <div className="electron-drag h-8 w-full flex-shrink-0" />
          {/* Project Tabs */}
          {projectTabs.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={projectTabs.map(p => p.id)} strategy={horizontalListSortingStrategy}>
                <ProjectTabBarWithContext
                  projects={projectTabs}
                  activeProjectId={activeProjectId}
                  onProjectSelect={handleProjectTabSelect}
                  onProjectClose={handleProjectTabClose}
                  onAddProject={handleAddProject}
                  onSettingsClick={() => setIsSettingsDialogOpen(true)}
                />
              </SortableContext>

              {/* Drag overlay - shows what's being dragged */}
              <DragOverlay>
                {activeDragProject && (
                  <div className="flex items-center gap-2 bg-card border border-border rounded-md px-4 py-2.5 shadow-lg max-w-[200px]">
                    <div className="w-1 h-4 bg-muted-foreground rounded-full" />
                    <span className="truncate font-medium text-sm">
                      {activeDragProject.name}
                    </span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}

          {/* Main content area - shrinks automatically via flex when bottom panel opens */}
          <main className="flex-1 overflow-hidden min-h-0">
            {selectedProject ? (
              <>
                {activeView === 'kanban' && (
                  <TasksHub
                    tasks={tasks}
                    onTaskClick={handleTaskClick}
                    onNewTaskClick={() => setIsNewTaskDialogOpen(true)}
                    onRefresh={handleRefreshTasks}
                    isRefreshing={isRefreshingTasks}
                  />
                )}
                {/* TerminalGrid is always mounted but hidden when not active to preserve terminal state */}
                <div className={activeView === 'terminals' ? 'h-full' : 'hidden'}>
                  <TerminalGrid
                    projectPath={selectedProject?.path}
                    onNewTaskClick={() => setIsNewTaskDialogOpen(true)}
                    isActive={activeView === 'terminals'}
                  />
                </div>
                {activeView === 'discovery' && (activeProjectId || selectedProjectId) && (
                  <Suspense fallback={<ViewLoader />}>
                    <DiscoveryHub projectId={activeProjectId || selectedProjectId!} onGoToTask={handleGoToTask} />
                  </Suspense>
                )}
                {activeView === 'context' && (activeProjectId || selectedProjectId) && (
                  <Suspense fallback={<ViewLoader />}>
                    <Context projectId={activeProjectId || selectedProjectId!} />
                  </Suspense>
                )}
                {activeView === 'repository' && (activeProjectId || selectedProjectId) && (
                  <Suspense fallback={<ViewLoader />}>
                    <RepositoryHub projectId={activeProjectId || selectedProjectId!} />
                  </Suspense>
                )}
                {activeView === 'insights' && (activeProjectId || selectedProjectId) && (
                  <Suspense fallback={<ViewLoader />}>
                    <Insights projectId={activeProjectId || selectedProjectId!} />
                  </Suspense>
                )}
                {/* GitHubHub is always mounted but hidden when not active to preserve PR review state */}
                {(activeProjectId || selectedProjectId) && (
                  <div className={activeView === 'github' ? 'h-full' : 'hidden'}>
                    <GitHubHub
                      onOpenSettings={() => {
                        setSettingsInitialProjectSection('github');
                        setIsSettingsDialogOpen(true);
                      }}
                      onNavigateToTask={handleGoToTask}
                      isActive={activeView === 'github'}
                    />
                  </div>
                )}
                {activeView === 'gitlab-issues' && (activeProjectId || selectedProjectId) && (
                  <Suspense fallback={<ViewLoader />}>
                    <GitLabIssues
                      onOpenSettings={() => {
                        setSettingsInitialProjectSection('gitlab');
                        setIsSettingsDialogOpen(true);
                      }}
                      onNavigateToTask={handleGoToTask}
                    />
                  </Suspense>
                )}
                {activeView === 'gitlab-merge-requests' && (activeProjectId || selectedProjectId) && (
                  <Suspense fallback={<ViewLoader />}>
                    <GitLabMergeRequests
                      projectId={activeProjectId || selectedProjectId!}
                      onOpenSettings={() => {
                        setSettingsInitialProjectSection('gitlab');
                        setIsSettingsDialogOpen(true);
                      }}
                    />
                  </Suspense>
                )}
                {activeView === 'changelog' && (activeProjectId || selectedProjectId) && (
                  <Suspense fallback={<ViewLoader />}>
                    <Changelog />
                  </Suspense>
                )}
                {activeView === 'worktrees' && (activeProjectId || selectedProjectId) && (
                  <Suspense fallback={<ViewLoader />}>
                    <Worktrees projectId={activeProjectId || selectedProjectId!} />
                  </Suspense>
                )}
              </>
            ) : (
              <WelcomeScreen
                projects={projects}
                onNewProject={handleAddProject}
                onOpenProject={handleAddProject}
                onSelectProject={(projectId) => {
                  openProjectTab(projectId);
                }}
              />
            )}
          </main>

          {/* Bottom Panel Terminal - VS Code-style bottom panel that persists across navigation */}
          {/* Placed inside flex column so main content shrinks when panel opens */}
          <BottomPanelTerminal
            taskId={bottomPanel.taskId}
            taskTitle={bottomPanel.taskTitle}
            isOpen={bottomPanel.isOpen}
            openTabs={bottomPanel.openTabs}
            onClose={closeBottomPanel}
            onCloseTab={closeBottomPanelTab}
            onSwitchTab={openBottomPanel}
            onMinimize={minimizeBottomPanel}
            splitMode={bottomPanel.splitMode}
            splitTaskId={bottomPanel.splitTaskId}
            splitTaskTitle={bottomPanel.splitTaskTitle}
            onToggleSplit={toggleSplitMode}
            onSetSplitTask={setSplitTask}
          />
        </div>

        {/* Task detail modal */}
        <TaskDetailModal
          open={!!selectedTask}
          task={selectedTask}
          onOpenChange={(open) => !open && handleCloseTaskDetail()}
          onSwitchToTerminals={() => setActiveView('terminals')}
          onOpenInbuiltTerminal={handleOpenInbuiltTerminal}
        />

        {/* Dialogs */}
        {(activeProjectId || selectedProjectId) && (
          <>
            <TaskCreationWizard
              projectId={activeProjectId || selectedProjectId!}
              open={isNewTaskDialogOpen}
              onOpenChange={setIsNewTaskDialogOpen}
            />
            {/* SUG-2: Quick Task Dialog (Cmd+K) */}
            <QuickTaskDialog
              projectId={activeProjectId || selectedProjectId!}
              open={isQuickTaskDialogOpen}
              onOpenChange={setIsQuickTaskDialogOpen}
            />
            {/* SUG-8: Global Search Dialog (Cmd+P) */}
            <GlobalSearchDialog
              projectId={activeProjectId || selectedProjectId!}
              open={isGlobalSearchOpen}
              onOpenChange={setIsGlobalSearchOpen}
              onTaskSelect={(taskId) => {
                const task = tasks.find(t => t.id === taskId);
                if (task) setSelectedTask(task);
              }}
            />
          </>
        )}

        <Suspense fallback={null}>
          <AppSettingsDialog
            open={isSettingsDialogOpen}
            onOpenChange={(open) => {
              setIsSettingsDialogOpen(open);
              if (!open) {
                // Reset initial sections when dialog closes
                setSettingsInitialSection(undefined);
                setSettingsInitialProjectSection(undefined);
              }
            }}
            initialSection={settingsInitialSection}
            initialProjectSection={settingsInitialProjectSection}
            onRerunWizard={() => {
              // Reset onboarding state to trigger wizard
              useSettingsStore.getState().updateSettings({ onboardingCompleted: false });
              // Close settings dialog
              setIsSettingsDialogOpen(false);
              // Open onboarding wizard
              setIsOnboardingWizardOpen(true);
            }}
          />
        </Suspense>

        {/* Add Project Modal */}
        <AddProjectModal
          open={showAddProjectModal}
          onOpenChange={setShowAddProjectModal}
          onProjectAdded={handleProjectAdded}
        />

        {/* Initialize Jerry Dialog */}
        <Dialog open={showInitDialog} onOpenChange={(open) => {
          console.log('[InitDialog] onOpenChange called', { open, pendingProject: !!pendingProject, isInitializing, initSuccess });
          // Only trigger skip if user manually closed the dialog
          // Don't trigger if: successful init, no pending project, or currently initializing
          if (!open && pendingProject && !isInitializing && !initSuccess) {
            handleSkipInit();
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                {t('initialize.title')}
              </DialogTitle>
              <DialogDescription>
                {t('initialize.description')}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="rounded-lg bg-muted p-4 text-sm">
                <p className="font-medium mb-2">{t('initialize.willDo')}</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>{t('initialize.createFolder')}</li>
                  <li>{t('initialize.copyFramework')}</li>
                  <li>{t('initialize.setupSpecs')}</li>
                </ul>
              </div>
              {!settings.autoBuildPath && (
                <div className="mt-4 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-warning">{t('initialize.sourcePathNotConfigured')}</p>
                      <p className="text-muted-foreground mt-1">
                        {t('initialize.sourcePathNotConfiguredDescription')}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {initError && (
                <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-destructive">{t('initialize.initFailed')}</p>
                      <p className="text-muted-foreground mt-1">
                        {initError}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleSkipInit} disabled={isInitializing}>
                {t('common:buttons.skip', { ns: 'common' })}
              </Button>
              <Button
                onClick={handleInitialize}
                disabled={isInitializing || !settings.autoBuildPath}
              >
                {isInitializing ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    {t('common:labels.initializing', { ns: 'common' })}
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    {t('common:buttons.initialize', { ns: 'common' })}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* GitHub Setup Modal - shows after Jerry init to configure GitHub */}
        {gitHubSetupProject && (
          <GitHubSetupModal
            open={showGitHubSetup}
            onOpenChange={setShowGitHubSetup}
            project={gitHubSetupProject}
            onComplete={handleGitHubSetupComplete}
            onSkip={handleGitHubSetupSkip}
          />
        )}

        {/* Remove Project Confirmation Dialog */}
        <Dialog open={showRemoveProjectDialog} onOpenChange={(open) => {
          if (!open) handleCancelRemoveProject();
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('removeProject.title')}</DialogTitle>
              <DialogDescription>
                {t('removeProject.description', { projectName: projectToRemove?.name || '' })}
              </DialogDescription>
            </DialogHeader>

            <RadioGroup
              value={deleteDataOption}
              onValueChange={(value) => setDeleteDataOption(value as 'keep' | 'delete')}
              className="space-y-3 py-4"
            >
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="keep" id="remove-keep" />
                <div className="grid gap-1">
                  <Label htmlFor="remove-keep" className="font-medium">
                    {t('removeProject.keepOption', { defaultValue: 'Remove from app only' })}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('removeProject.keepDescription', { defaultValue: 'Keep the .auto-claude folder. You can re-add the project later.' })}
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="delete" id="remove-delete" />
                <div className="grid gap-1">
                  <Label htmlFor="remove-delete" className="font-medium text-destructive">
                    {t('removeProject.deleteOption', { defaultValue: 'Delete all project data' })}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('removeProject.deleteDescription', { defaultValue: 'Permanently delete the .auto-claude folder and all task data.' })}
                  </p>
                </div>
              </div>
            </RadioGroup>

            {removeProjectError && (
              <div className="flex items-center gap-2 p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{removeProjectError}</span>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelRemoveProject}>
                {t('removeProject.cancel')}
              </Button>
              <Button
                variant={deleteDataOption === 'delete' ? 'destructive' : 'default'}
                onClick={handleConfirmRemoveProject}
              >
                {t('removeProject.remove')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rate Limit Modal - shows when Claude Code hits usage limits (terminal) */}
        <RateLimitModal />

        {/* SDK Rate Limit Modal - shows when SDK/CLI operations hit limits (changelog, tasks, etc.) */}
        <SDKRateLimitModal />

        {/* Onboarding Wizard - shows on first launch when onboardingCompleted is false */}
        <Suspense fallback={null}>
          <OnboardingWizard
            open={isOnboardingWizardOpen}
            onOpenChange={setIsOnboardingWizardOpen}
            onOpenTaskCreator={() => {
              setIsOnboardingWizardOpen(false);
              setIsNewTaskDialogOpen(true);
            }}
            onOpenSettings={() => {
              setIsOnboardingWizardOpen(false);
              setIsSettingsDialogOpen(true);
            }}
          />
        </Suspense>

        {/* App Update Notification - shows when new app version is available */}
        <AppUpdateNotification />

        {/* Global Download Indicator - shows Ollama model download progress */}
        <GlobalDownloadIndicator />

        {/* Toast notifications */}
        <Toaster />
      </div>
      </TooltipProvider>
    </ViewStateProvider>
    </NavigationProvider>
  );
}
