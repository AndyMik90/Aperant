import { create } from 'zustand';
import type {
  ChangelogTask,
  TaskSpecContent,
  ChangelogFormat,
  ChangelogAudience,
  ChangelogEmojiLevel,
  ChangelogGenerationProgress,
  ExistingChangelog,
  ChangelogSourceMode,
  GitBranchInfo,
  GitTagInfo,
  GitCommit,
  GitHistoryOptions,
  BranchDiffOptions,
  IPCResult
} from '../../shared/types';
import { useTaskStore } from './task-store';
import { useSettingsStore } from './settings-store';
import { saveSettings } from './settings-store';

interface ChangelogState {
  // Data
  doneTasks: ChangelogTask[];
  selectedTaskIds: string[];
  loadedSpecs: TaskSpecContent[];
  existingChangelog: ExistingChangelog | null;

  // Source mode selection
  sourceMode: ChangelogSourceMode;

  // Git data
  branches: GitBranchInfo[];
  tags: GitTagInfo[];
  currentBranch: string;
  defaultBranch: string;
  previewCommits: GitCommit[];
  isLoadingGitData: boolean;
  isLoadingCommits: boolean;

  // Git history options
  gitHistoryType: 'recent' | 'since-date' | 'tag-range' | 'since-version';
  gitHistoryCount: number;
  gitHistorySinceDate: string;
  gitHistoryFromTag: string;
  gitHistoryToTag: string;
  gitHistorySinceVersion: string;
  includeMergeCommits: boolean;

  // Branch diff options
  baseBranch: string;
  compareBranch: string;

  // Generation config
  version: string;
  date: string;
  format: ChangelogFormat;
  audience: ChangelogAudience;
  emojiLevel: ChangelogEmojiLevel;
  customInstructions: string;

  // Generation state
  generationProgress: ChangelogGenerationProgress | null;
  generatedChangelog: string;
  isGenerating: boolean;
  error: string | null;

  // Actions
  setDoneTasks: (tasks: ChangelogTask[]) => void;
  setSelectedTaskIds: (ids: string[]) => void;
  toggleTaskSelection: (taskId: string) => void;
  selectAllTasks: () => void;
  deselectAllTasks: () => void;
  setLoadedSpecs: (specs: TaskSpecContent[]) => void;
  setExistingChangelog: (changelog: ExistingChangelog | null) => void;

  // Source mode actions
  setSourceMode: (mode: ChangelogSourceMode) => void;

  // Git data actions
  setBranches: (branches: GitBranchInfo[]) => void;
  setTags: (tags: GitTagInfo[]) => void;
  setCurrentBranch: (branch: string) => void;
  setDefaultBranch: (branch: string) => void;
  setPreviewCommits: (commits: GitCommit[]) => void;
  setIsLoadingGitData: (loading: boolean) => void;
  setIsLoadingCommits: (loading: boolean) => void;

  // Git history options actions
  setGitHistoryType: (type: 'recent' | 'since-date' | 'tag-range' | 'since-version') => void;
  setGitHistoryCount: (count: number) => void;
  setGitHistorySinceDate: (date: string) => void;
  setGitHistoryFromTag: (tag: string) => void;
  setGitHistoryToTag: (tag: string) => void;
  setGitHistorySinceVersion: (version: string) => void;
  setIncludeMergeCommits: (include: boolean) => void;

  // Branch diff options actions
  setBaseBranch: (branch: string) => void;
  setCompareBranch: (branch: string) => void;

  // Config actions
  setVersion: (version: string) => void;
  setDate: (date: string) => void;
  setFormat: (format: ChangelogFormat) => void;
  setAudience: (audience: ChangelogAudience) => void;
  setEmojiLevel: (level: ChangelogEmojiLevel) => void;
  setCustomInstructions: (instructions: string) => void;
  initializeFromSettings: () => void;

  // Generation actions
  setGenerationProgress: (progress: ChangelogGenerationProgress | null) => void;
  setGeneratedChangelog: (changelog: string) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setError: (error: string | null) => void;

  // Compound actions
  reset: () => void;
  updateGeneratedChangelog: (changelog: string) => void;
}

const getDefaultDate = (): string => {
  return new Date().toISOString().split('T')[0];
};

const initialState = {
  doneTasks: [] as ChangelogTask[],
  selectedTaskIds: [] as string[],
  loadedSpecs: [] as TaskSpecContent[],
  existingChangelog: null as ExistingChangelog | null,

  // Source mode
  sourceMode: 'tasks' as ChangelogSourceMode,

  // Git data
  branches: [] as GitBranchInfo[],
  tags: [] as GitTagInfo[],
  currentBranch: '',
  defaultBranch: 'main',
  previewCommits: [] as GitCommit[],
  isLoadingGitData: false,
  isLoadingCommits: false,

  // Git history options
  gitHistoryType: 'recent' as 'recent' | 'since-date' | 'tag-range' | 'since-version',
  gitHistoryCount: 25,
  gitHistorySinceDate: '',
  gitHistoryFromTag: '',
  gitHistoryToTag: '',
  gitHistorySinceVersion: '',
  includeMergeCommits: false,

  // Branch diff options
  baseBranch: '',
  compareBranch: '',

  // Generation config
  version: '1.0.0',
  date: getDefaultDate(),
  format: 'keep-a-changelog' as ChangelogFormat,
  audience: 'user-facing' as ChangelogAudience,
  emojiLevel: 'none' as ChangelogEmojiLevel,
  customInstructions: '',

  generationProgress: null as ChangelogGenerationProgress | null,
  generatedChangelog: '',
  isGenerating: false,
  error: null as string | null
};

export const useChangelogStore = create<ChangelogState>((set, get) => ({
  ...initialState,

  // Data actions
  setDoneTasks: (tasks) => set({ doneTasks: tasks }),

  setSelectedTaskIds: (ids) => set({ selectedTaskIds: ids }),

  toggleTaskSelection: (taskId) =>
    set((state) => ({
      selectedTaskIds: state.selectedTaskIds.includes(taskId)
        ? state.selectedTaskIds.filter((id) => id !== taskId)
        : [...state.selectedTaskIds, taskId]
    })),

  selectAllTasks: () =>
    set((state) => ({
      selectedTaskIds: state.doneTasks.map((task) => task.id)
    })),

  deselectAllTasks: () => set({ selectedTaskIds: [] }),

  setLoadedSpecs: (specs) => set({ loadedSpecs: specs }),

  setExistingChangelog: (changelog) => {
    set({ existingChangelog: changelog });
    // Auto-suggest next version if we found a previous version
    if (changelog?.lastVersion) {
      const parts = changelog.lastVersion.split('.').map(Number);
      if (parts.length === 3 && !parts.some(Number.isNaN)) {
        const [major, minor, patch] = parts;
        set({ version: `${major}.${minor}.${patch + 1}` });
      }
    }
  },

  // Source mode actions
  setSourceMode: (mode) => {
    set({ sourceMode: mode, previewCommits: [], error: null });
  },

  // Git data actions
  setBranches: (branches) => set({ branches }),
  setTags: (tags) => set({ tags }),
  setCurrentBranch: (branch) => set({ currentBranch: branch }),
  setDefaultBranch: (branch) => {
    set({ defaultBranch: branch });
    // Auto-set base branch if not already set
    const state = get();
    if (!state.baseBranch) {
      set({ baseBranch: branch });
    }
  },
  setPreviewCommits: (commits) => set({ previewCommits: commits }),
  setIsLoadingGitData: (loading) => set({ isLoadingGitData: loading }),
  setIsLoadingCommits: (loading) => set({ isLoadingCommits: loading }),

  // Git history options actions
  setGitHistoryType: (type) => set({ gitHistoryType: type, previewCommits: [] }),
  setGitHistoryCount: (count) => set({ gitHistoryCount: count }),
  setGitHistorySinceDate: (date) => set({ gitHistorySinceDate: date }),
  setGitHistoryFromTag: (tag) => set({ gitHistoryFromTag: tag }),
  setGitHistoryToTag: (tag) => set({ gitHistoryToTag: tag }),
  setGitHistorySinceVersion: (version) => set({ gitHistorySinceVersion: version }),
  setIncludeMergeCommits: (include) => set({ includeMergeCommits: include }),

  // Branch diff options actions
  setBaseBranch: (branch) => set({ baseBranch: branch, previewCommits: [] }),
  setCompareBranch: (branch) => set({ compareBranch: branch, previewCommits: [] }),

  // Config actions
  setVersion: (version) => set({ version }),
  setDate: (date) => set({ date }),
  setFormat: (format) => {
    set({ format });
    saveSettings({ changelogFormat: format });
  },
  setAudience: (audience) => {
    set({ audience });
    saveSettings({ changelogAudience: audience });
  },
  setEmojiLevel: (level) => {
    set({ emojiLevel: level });
    saveSettings({ changelogEmojiLevel: level });
  },
  setCustomInstructions: (instructions) => set({ customInstructions: instructions }),
  initializeFromSettings: () => {
    const settings = useSettingsStore.getState().settings;
    set({
      format: settings.changelogFormat || 'keep-a-changelog',
      audience: settings.changelogAudience || 'user-facing',
      emojiLevel: settings.changelogEmojiLevel || 'none'
    });
  },

  // Generation actions
  setGenerationProgress: (progress) => set({ generationProgress: progress }),
  setGeneratedChangelog: (changelog) => set({ generatedChangelog: changelog }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setError: (error) => set({ error }),

  // Compound actions
  reset: () => set({ ...initialState, date: getDefaultDate() }),

  updateGeneratedChangelog: (changelog) => set({ generatedChangelog: changelog })
}));

// Helper functions for loading data
export async function loadChangelogData(projectId: string): Promise<void> {
  const store = useChangelogStore.getState();

  try {
    // Get tasks from the task store (which has the correct UI status)
    // This is necessary because the Kanban board updates task status in the Zustand store,
    // but the backend reads from the filesystem which doesn't reflect UI-only changes
    const taskStore = useTaskStore.getState();
    const tasks = taskStore.tasks;

    // Load done tasks - pass the renderer's task list to get correct status
    const tasksResult = await window.electronAPI.getChangelogDoneTasks(projectId, tasks);
    if (tasksResult.success && tasksResult.data) {
      store.setDoneTasks(tasksResult.data);
    }

    // Load existing changelog
    const changelogResult = await window.electronAPI.readExistingChangelog(projectId);
    if (changelogResult.success && changelogResult.data) {
      store.setExistingChangelog(changelogResult.data);
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to load changelog data');
  }
}

export async function loadTaskSpecs(projectId: string, taskIds: string[]): Promise<void> {
  const store = useChangelogStore.getState();

  try {
    const result = await window.electronAPI.loadTaskSpecs(projectId, taskIds);
    if (result.success && result.data) {
      store.setLoadedSpecs(result.data);
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to load task specs');
  }
}

export async function loadGitData(projectId: string): Promise<void> {
  const store = useChangelogStore.getState();

  store.setIsLoadingGitData(true);
  store.setError(null);

  try {
    // Load branches and tags in parallel
    const [branchesResult, tagsResult] = await Promise.all([
      window.electronAPI.getChangelogBranches(projectId),
      window.electronAPI.getChangelogTags(projectId)
    ]);

    if (branchesResult.success && branchesResult.data) {
      store.setBranches(branchesResult.data);

      // Find and set current branch
      const currentBranch = branchesResult.data.find((b) => b.isCurrent);
      if (currentBranch) {
        store.setCurrentBranch(currentBranch.name);
        // Default compare branch to current branch for branch-diff mode
        if (!store.compareBranch) {
          store.setCompareBranch(currentBranch.name);
        }
      }

      // Try to determine default branch (main or master)
      const defaultBranch = branchesResult.data.find(
        (b) => b.name === 'main' || b.name === 'master'
      );
      if (defaultBranch) {
        store.setDefaultBranch(defaultBranch.name);
      }
    }

    if (tagsResult.success && tagsResult.data) {
      store.setTags(tagsResult.data);

      // Auto-set tag range if tags exist
      if (tagsResult.data.length > 0 && !store.gitHistoryFromTag) {
        store.setGitHistoryFromTag(tagsResult.data[0].name);
      }
      if (tagsResult.data.length > 1 && !store.gitHistoryToTag) {
        store.setGitHistoryToTag(tagsResult.data[1].name);
      }

      // Auto-set since-version to newest tag if not already set
      if (tagsResult.data.length > 0 && !store.gitHistorySinceVersion) {
        store.setGitHistorySinceVersion(tagsResult.data[0].name);
      }
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to load git data');
  } finally {
    store.setIsLoadingGitData(false);
  }
}

export async function loadCommitsPreview(projectId: string): Promise<void> {
  const store = useChangelogStore.getState();

  store.setIsLoadingCommits(true);
  store.setError(null);

  try {
    let options: GitHistoryOptions | BranchDiffOptions;
    let mode: 'git-history' | 'branch-diff';

    if (store.sourceMode === 'git-history') {
      mode = 'git-history';
      options = {
        type: store.gitHistoryType,
        count: store.gitHistoryCount,
        sinceDate: store.gitHistorySinceDate || undefined,
        // For since-version, use gitHistorySinceVersion as fromTag
        fromTag: store.gitHistoryType === 'since-version'
          ? (store.gitHistorySinceVersion || undefined)
          : (store.gitHistoryFromTag || undefined),
        toTag: store.gitHistoryToTag || undefined,
        includeMergeCommits: store.includeMergeCommits
      };
    } else if (store.sourceMode === 'branch-diff') {
      mode = 'branch-diff';
      options = {
        baseBranch: store.baseBranch,
        compareBranch: store.compareBranch
      };
    } else {
      // Tasks mode doesn't need commit preview
      store.setPreviewCommits([]);
      store.setIsLoadingCommits(false);
      return;
    }

    const result = await window.electronAPI.getChangelogCommitsPreview(projectId, options, mode);

    if (result.success && result.data) {
      store.setPreviewCommits(result.data);
    } else {
      store.setError(result.error || 'Failed to load commits');
      store.setPreviewCommits([]);
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to load commits preview');
    store.setPreviewCommits([]);
  } finally {
    store.setIsLoadingCommits(false);
  }
}

function handleGenerationError(store: ReturnType<typeof useChangelogStore.getState>, errorMessage: string): void {
  store.setIsGenerating(false);
  store.setError(errorMessage);
  store.setGenerationProgress({
    stage: 'error',
    progress: 0,
    message: errorMessage,
    error: errorMessage
  });
}

export async function generateChangelog(projectId: string): Promise<void> {
  const store = useChangelogStore.getState();

  // Validate based on source mode
  if (store.sourceMode === 'tasks') {
    if (store.selectedTaskIds.length === 0) {
      store.setError('Please select at least one task to include in the changelog');
      return;
    }
  } else if (store.sourceMode === 'git-history') {
    if (store.previewCommits.length === 0) {
      store.setError('No commits found for the selected options. Please adjust your filters.');
      return;
    }
  } else if (store.sourceMode === 'branch-diff') {
    if (!store.baseBranch || !store.compareBranch) {
      store.setError('Please select both base and compare branches');
      return;
    }
    if (store.baseBranch === store.compareBranch) {
      store.setError('Base and compare branches must be different');
      return;
    }
    if (store.previewCommits.length === 0) {
      store.setError('No commits found between the selected branches');
      return;
    }
  }

  store.setIsGenerating(true);
  store.setError(null);
  store.setGenerationProgress({
    stage: 'loading_specs',
    progress: 0,
    message:
      store.sourceMode === 'tasks'
        ? 'Loading task specifications...'
        : 'Preparing commit data...'
  });

  // Build the generation request based on source mode
  const baseRequest = {
    projectId,
    sourceMode: store.sourceMode,
    version: store.version,
    date: store.date,
    format: store.format,
    audience: store.audience,
    emojiLevel: store.emojiLevel !== 'none' ? store.emojiLevel : undefined,
    customInstructions: store.customInstructions || undefined
  };

  try {
    let result: IPCResult<void>;
    if (store.sourceMode === 'tasks') {
      result = await window.electronAPI.generateChangelog({
        ...baseRequest,
        taskIds: store.selectedTaskIds
      });
    } else if (store.sourceMode === 'git-history') {
      result = await window.electronAPI.generateChangelog({
        ...baseRequest,
        gitHistory: {
          type: store.gitHistoryType,
          count: store.gitHistoryCount,
          sinceDate: store.gitHistorySinceDate || undefined,
          // For since-version, use gitHistorySinceVersion as fromTag
          fromTag: store.gitHistoryType === 'since-version'
            ? (store.gitHistorySinceVersion || undefined)
            : (store.gitHistoryFromTag || undefined),
          toTag: store.gitHistoryToTag || undefined,
          includeMergeCommits: store.includeMergeCommits
        }
      });
    } else if (store.sourceMode === 'branch-diff') {
      result = await window.electronAPI.generateChangelog({
        ...baseRequest,
        branchDiff: {
          baseBranch: store.baseBranch,
          compareBranch: store.compareBranch
        }
      });
    } else {
      // This should never happen due to validation, but handle it for TypeScript
      throw new Error(`Invalid source mode: ${store.sourceMode}`);
    }

    // Check if generation started successfully
    if (!result.success) {
      handleGenerationError(store, result.error || 'Failed to start changelog generation');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to start changelog generation';
    handleGenerationError(store, errorMessage);
  }
}

export async function saveChangelog(
  projectId: string,
  mode: 'prepend' | 'overwrite' | 'append' = 'prepend'
): Promise<boolean> {
  const store = useChangelogStore.getState();

  if (!store.generatedChangelog) {
    store.setError('No changelog to save');
    return false;
  }

  try {
    const result = await window.electronAPI.saveChangelog({
      projectId,
      content: store.generatedChangelog,
      mode
    });

    if (result.success) {
      return true;
    } else {
      store.setError(result.error || 'Failed to save changelog');
      return false;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to save changelog');
    return false;
  }
}

export function copyChangelogToClipboard(): boolean {
  const store = useChangelogStore.getState();

  if (!store.generatedChangelog) {
    store.setError('No changelog to copy');
    return false;
  }

  try {
    navigator.clipboard.writeText(store.generatedChangelog);
    return true;
  } catch (_error) {
    store.setError('Failed to copy to clipboard');
    return false;
  }
}

// Selectors
export function getSelectedTasks(): ChangelogTask[] {
  const store = useChangelogStore.getState();
  return store.doneTasks.filter((task) => store.selectedTaskIds.includes(task.id));
}

export function getTasksWithSpecs(): ChangelogTask[] {
  const store = useChangelogStore.getState();
  return store.doneTasks.filter((task) => task.hasSpecs);
}

export function canGenerate(): boolean {
  const store = useChangelogStore.getState();

  if (store.isGenerating) return false;

  switch (store.sourceMode) {
    case 'tasks':
      return store.selectedTaskIds.length > 0;
    case 'git-history':
      return store.previewCommits.length > 0;
    case 'branch-diff':
      return (
        store.baseBranch !== '' &&
        store.compareBranch !== '' &&
        store.baseBranch !== store.compareBranch &&
        store.previewCommits.length > 0
      );
    default:
      return false;
  }
}

export function canSave(): boolean {
  const store = useChangelogStore.getState();
  return store.generatedChangelog.length > 0 && !store.isGenerating;
}
