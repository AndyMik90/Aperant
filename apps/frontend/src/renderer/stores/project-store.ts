import { create } from 'zustand';
import type { Project, ProjectSettings, AutoBuildVersionInfo, InitializationResult } from '../../shared/types';

// localStorage keys for persisting project state (legacy - now using IPC)
const LAST_SELECTED_PROJECT_KEY = 'lastSelectedProjectId';

// Debounce timer for saving tab state
let saveTabStateTimeout: ReturnType<typeof setTimeout> | null = null;

interface ProjectState {
  projects: Project[];
  selectedProjectId: string | null;
  isLoading: boolean;
  error: string | null;

  // Tab state
  openProjectIds: string[]; // Array of open project IDs
  activeProjectId: string | null; // Currently active tab
  tabOrder: string[]; // Order of tabs for drag and drop

  // Actions
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (projectId: string) => void;
  updateProject: (projectId: string, updates: Partial<Project>) => void;
  selectProject: (projectId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Tab management actions
  openProjectTab: (projectId: string) => void;
  closeProjectTab: (projectId: string) => void;
  setActiveProject: (projectId: string | null) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  restoreTabState: () => void;

  // Selectors
  getSelectedProject: () => Project | undefined;
  getOpenProjects: () => Project[];
  getActiveProject: () => Project | undefined;
  getProjectTabs: () => Project[];
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  isLoading: false,
  error: null,

  // Tab state - initialized empty, loaded via IPC from main process for reliability
  openProjectIds: [],
  activeProjectId: null,
  tabOrder: [],

  setProjects: (projects) => set({ projects }),

  addProject: (project) =>
    set((state) => ({
      projects: [...state.projects, project]
    })),

  removeProject: (projectId) =>
    set((state) => {
      const isSelectedProject = state.selectedProjectId === projectId;
      // Clear localStorage if we're removing the currently selected project
      if (isSelectedProject) {
        localStorage.removeItem(LAST_SELECTED_PROJECT_KEY);
      }
      return {
        projects: state.projects.filter((p) => p.id !== projectId),
        selectedProjectId: isSelectedProject ? null : state.selectedProjectId
      };
    }),

  updateProject: (projectId, updates) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, ...updates } : p
      )
    })),

  selectProject: (projectId) => {
    // Persist to localStorage for restoration on app reload
    if (projectId) {
      localStorage.setItem(LAST_SELECTED_PROJECT_KEY, projectId);
    } else {
      localStorage.removeItem(LAST_SELECTED_PROJECT_KEY);
    }
    set({ selectedProjectId: projectId });
  },

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  // Tab management actions
  openProjectTab: (projectId) => {
    const state = get();
    console.log('[ProjectStore] openProjectTab called:', {
      projectId,
      currentOpenProjectIds: state.openProjectIds,
      currentTabOrder: state.tabOrder
    });
    if (!state.openProjectIds.includes(projectId)) {
      const newOpenProjectIds = [...state.openProjectIds, projectId];
      const newTabOrder = state.tabOrder.includes(projectId)
        ? state.tabOrder
        : [...state.tabOrder, projectId];

      console.log('[ProjectStore] Adding new tab:', {
        newOpenProjectIds,
        newTabOrder
      });

      set({
        openProjectIds: newOpenProjectIds,
        tabOrder: newTabOrder,
        activeProjectId: projectId
      });

      // Save to main process (debounced)
      saveTabStateToMain();
    } else {
      console.log('[ProjectStore] Project already open, just activating');
      // Project already open, just make it active
      get().setActiveProject(projectId);
    }
  },

  closeProjectTab: (projectId) => {
    const state = get();
    const newOpenProjectIds = state.openProjectIds.filter(id => id !== projectId);
    const newTabOrder = state.tabOrder.filter(id => id !== projectId);

    // If closing the active project, select another one or null
    let newActiveProjectId = state.activeProjectId;
    if (state.activeProjectId === projectId) {
      const remainingTabs = newTabOrder.length > 0 ? newTabOrder : [];
      newActiveProjectId = remainingTabs.length > 0 ? remainingTabs[0] : null;
    }

    set({
      openProjectIds: newOpenProjectIds,
      tabOrder: newTabOrder,
      activeProjectId: newActiveProjectId
    });

    // Save to main process (debounced)
    saveTabStateToMain();
  },

  setActiveProject: (projectId) => {
    set({ activeProjectId: projectId });
    // Also update selectedProjectId for backward compatibility
    get().selectProject(projectId);
    // Save to main process (debounced)
    saveTabStateToMain();
  },

  reorderTabs: (fromIndex, toIndex) => {
    const state = get();
    const newTabOrder = [...state.tabOrder];
    const [movedTab] = newTabOrder.splice(fromIndex, 1);
    newTabOrder.splice(toIndex, 0, movedTab);

    set({ tabOrder: newTabOrder });
    // Save to main process (debounced)
    saveTabStateToMain();
  },

  restoreTabState: () => {
    // This is now handled by loadTabStateFromMain() called during loadProjects()
    console.log('[ProjectStore] restoreTabState called - now handled by IPC');
  },


  // Original selectors
  getSelectedProject: () => {
    const state = get();
    return state.projects.find((p) => p.id === state.selectedProjectId);
  },

  // New selectors for tab functionality
  getOpenProjects: () => {
    const state = get();
    return state.projects.filter((p) => state.openProjectIds.includes(p.id));
  },

  getActiveProject: () => {
    const state = get();
    return state.projects.find((p) => p.id === state.activeProjectId);
  },

  getProjectTabs: () => {
    const state = get();
    const orderedProjects = state.tabOrder
      .map(id => state.projects.find(p => p.id === id))
      .filter(Boolean) as Project[];

    // Add any open projects not in tabOrder to the end
    const remainingProjects = state.projects
      .filter(p => state.openProjectIds.includes(p.id) && !state.tabOrder.includes(p.id));

    return [...orderedProjects, ...remainingProjects];
  }
}));

/**
 * Save tab state to main process (debounced to avoid excessive IPC calls)
 */
function saveTabStateToMain(): void {
  // Clear any pending save
  if (saveTabStateTimeout) {
    clearTimeout(saveTabStateTimeout);
  }

  // Debounce saves to avoid excessive IPC calls
  saveTabStateTimeout = setTimeout(async () => {
    const store = useProjectStore.getState();
    const tabState = {
      openProjectIds: store.openProjectIds,
      activeProjectId: store.activeProjectId,
      tabOrder: store.tabOrder
    };
    console.log('[ProjectStore] Saving tab state to main process:', tabState);
    try {
      await window.electronAPI.saveTabState(tabState);
    } catch (err) {
      console.error('[ProjectStore] Failed to save tab state:', err);
    }
  }, 100);
}

/**
 * Load projects from main process
 */
export async function loadProjects(): Promise<void> {
  const store = useProjectStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    // First, load tab state from main process (reliable persistence)
    const tabStateResult = await window.electronAPI.getTabState();
    console.log('[ProjectStore] Loaded tab state from main process:', tabStateResult.data);

    if (tabStateResult.success && tabStateResult.data) {
      useProjectStore.setState({
        openProjectIds: tabStateResult.data.openProjectIds || [],
        activeProjectId: tabStateResult.data.activeProjectId || null,
        tabOrder: tabStateResult.data.tabOrder || []
      });
    }

    // Then load projects
    const result = await window.electronAPI.getProjects();
    console.log('[ProjectStore] getProjects result:', {
      success: result.success,
      projectCount: result.data?.length,
      projectIds: result.data?.map(p => p.id)
    });

    if (result.success && result.data) {
      store.setProjects(result.data);

      // Get current tab state (may have been loaded from IPC)
      const currentState = useProjectStore.getState();

      // Clean up tab state - remove any project IDs that no longer exist
      const validOpenProjectIds = currentState.openProjectIds.filter(id =>
        result.data?.some((p) => p.id === id) ?? false
      );
      const validTabOrder = currentState.tabOrder.filter(id =>
        result.data?.some((p) => p.id === id) ?? false
      );
      const validActiveProjectId = currentState.activeProjectId &&
        result.data?.some((p) => p.id === currentState.activeProjectId)
        ? currentState.activeProjectId
        : null;

      console.log('[ProjectStore] Tab state cleanup:', {
        originalOpenProjectIds: currentState.openProjectIds,
        validOpenProjectIds,
        originalTabOrder: currentState.tabOrder,
        validTabOrder,
        originalActiveProjectId: currentState.activeProjectId,
        validActiveProjectId
      });

      // Update store with cleaned tab state if needed
      if (validOpenProjectIds.length !== currentState.openProjectIds.length ||
          validTabOrder.length !== currentState.tabOrder.length ||
          validActiveProjectId !== currentState.activeProjectId) {
        console.log('[ProjectStore] Updating cleaned tab state');
        useProjectStore.setState({
          openProjectIds: validOpenProjectIds,
          tabOrder: validTabOrder,
          activeProjectId: validActiveProjectId
        });
        // Save cleaned state back to main process
        saveTabStateToMain();
      } else {
        console.log('[ProjectStore] Tab state is valid, no cleanup needed');
      }

      // Restore last selected project from localStorage for backward compatibility,
      // or fall back to active project, or first project
      const updatedState = useProjectStore.getState();
      if (!updatedState.selectedProjectId && result.data.length > 0) {
        const lastSelectedId = localStorage.getItem(LAST_SELECTED_PROJECT_KEY);
        const projectExists = lastSelectedId && result.data.some((p) => p.id === lastSelectedId);

        if (projectExists) {
          store.selectProject(lastSelectedId);
        } else if (updatedState.activeProjectId) {
          store.selectProject(updatedState.activeProjectId);
        } else {
          store.selectProject(result.data[0].id);
        }
      }
    } else {
      store.setError(result.error || 'Failed to load projects');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Add a new project
 */
export async function addProject(projectPath: string): Promise<Project | null> {
  const store = useProjectStore.getState();

  try {
    const result = await window.electronAPI.addProject(projectPath);
    if (result.success && result.data) {
      store.addProject(result.data);
      store.selectProject(result.data.id);
      // Also open a tab for the new project
      store.openProjectTab(result.data.id);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to add project');
      return null;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Remove a project
 */
export async function removeProject(projectId: string): Promise<boolean> {
  const store = useProjectStore.getState();

  try {
    const result = await window.electronAPI.removeProject(projectId);
    if (result.success) {
      store.removeProject(projectId);
      // Also close the tab if it's open
      if (store.openProjectIds.includes(projectId)) {
        store.closeProjectTab(projectId);
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Update project settings
 */
export async function updateProjectSettings(
  projectId: string,
  settings: Partial<ProjectSettings>
): Promise<boolean> {
  const store = useProjectStore.getState();

  try {
    const result = await window.electronAPI.updateProjectSettings(
      projectId,
      settings
    );
    if (result.success) {
      const project = store.projects.find((p) => p.id === projectId);
      if (project) {
        // Merge settings properly, handling the case where project.settings might be undefined
        const currentSettings = project.settings || {};
        store.updateProject(projectId, {
          settings: { ...currentSettings, ...settings }
        });
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check auto-claude version status for a project
 */
export async function checkProjectVersion(
  projectId: string
): Promise<AutoBuildVersionInfo | null> {
  try {
    const result = await window.electronAPI.checkProjectVersion(projectId);
    if (result.success && result.data) {
      return result.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Initialize auto-claude in a project
 */
export async function initializeProject(
  projectId: string
): Promise<InitializationResult | null> {
  const store = useProjectStore.getState();

  try {
    console.log('[ProjectStore] initializeProject called for:', projectId);
    const result = await window.electronAPI.initializeProject(projectId);
    console.log('[ProjectStore] IPC result:', result);

    if (result.success && result.data) {
      console.log('[ProjectStore] IPC succeeded, result.data:', result.data);
      // Update the project's autoBuildPath in local state
      if (result.data.success) {
        console.log('[ProjectStore] Updating project autoBuildPath to .auto-claude');
        store.updateProject(projectId, { autoBuildPath: '.auto-claude' });
      } else {
        console.log('[ProjectStore] result.data.success is false, not updating project');
      }
      return result.data;
    }
    console.log('[ProjectStore] IPC failed or no data, setting error');
    store.setError(result.error || 'Failed to initialize project');
    return null;
  } catch (error) {
    console.error('[ProjectStore] Exception during initializeProject:', error);
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}
