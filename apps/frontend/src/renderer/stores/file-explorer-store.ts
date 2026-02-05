import { create } from 'zustand';
import type { FileNode } from '../../shared/types';

interface FileExplorerState {
  isOpen: boolean;
  expandedFolders: Set<string>;
  files: Map<string, FileNode[]>;  // Cache: dirPath -> files
  isLoading: Map<string, boolean>; // Loading state per directory
  error: string | null;

  // Actions
  toggle: () => void;
  open: () => void;
  close: () => void;
  toggleFolder: (path: string) => void;
  expandFolder: (path: string) => void;
  collapseFolder: (path: string) => void;
  loadDirectory: (dirPath: string) => Promise<FileNode[]>;
  setError: (error: string | null) => void;
  clearCache: () => void;

  // Selectors
  isExpanded: (path: string) => boolean;
  getFiles: (dirPath: string) => FileNode[] | undefined;
  isLoadingDir: (dirPath: string) => boolean;
  getAllExpandedFiles: () => Set<string>;
  getVisibleFiles: (rootPath: string) => FileNode[];
  computeVisibleItems: (rootPath: string) => { nodes: FileNode[]; count: number };
}

export const useFileExplorerStore = create<FileExplorerState>((set, get) => ({
  isOpen: false,
  expandedFolders: new Set(),
  files: new Map(),
  isLoading: new Map(),
  error: null,

  toggle: () => {
    set((state) => ({ isOpen: !state.isOpen }));
  },

  open: () => {
    set({ isOpen: true });
  },

  close: () => {
    set({ isOpen: false });
  },

  toggleFolder: (path: string) => {
    set((state) => {
      const newExpanded = new Set(state.expandedFolders);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      return { expandedFolders: newExpanded };
    });
  },

  expandFolder: (path: string) => {
    set((state) => {
      const newExpanded = new Set(state.expandedFolders);
      newExpanded.add(path);
      return { expandedFolders: newExpanded };
    });
  },

  collapseFolder: (path: string) => {
    set((state) => {
      const newExpanded = new Set(state.expandedFolders);
      newExpanded.delete(path);
      return { expandedFolders: newExpanded };
    });
  },

  loadDirectory: async (dirPath: string): Promise<FileNode[]> => {
    const state = get();

    // Return cached if available
    const cached = state.files.get(dirPath);
    if (cached) {
      return cached;
    }

    // Set loading state
    set((state) => {
      const newLoading = new Map(state.isLoading);
      newLoading.set(dirPath, true);
      return { isLoading: newLoading, error: null };
    });

    try {
      const result = await window.electronAPI.listDirectory(dirPath);

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to load directory');
      }

      // Cache the result
      set((state) => {
        const newFiles = new Map(state.files);
        newFiles.set(dirPath, result.data!);
        const newLoading = new Map(state.isLoading);
        newLoading.set(dirPath, false);
        return { files: newFiles, isLoading: newLoading };
      });

      return result.data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set((state) => {
        const newLoading = new Map(state.isLoading);
        newLoading.set(dirPath, false);
        return { isLoading: newLoading, error: errorMessage };
      });
      return [];
    }
  },

  setError: (error: string | null) => {
    set({ error });
  },

  clearCache: () => {
    set({ files: new Map(), expandedFolders: new Set() });
  },

  isExpanded: (path: string) => {
    return get().expandedFolders.has(path);
  },

  getFiles: (dirPath: string) => {
    return get().files.get(dirPath);
  },

  isLoadingDir: (dirPath: string) => {
    return get().isLoading.get(dirPath) ?? false;
  },

  getAllExpandedFiles: () => {
    return new Set(get().expandedFolders);
  },

  getVisibleFiles: (rootPath: string) => {
    const state = get();
    const result: FileNode[] = [];

    // Use iterative approach with explicit stack tracking directory paths to process
    // Stack items: [dirPath, nextIndex] - process nodes starting at nextIndex
    const stack: Array<{ dirPath: string; index: number }> = [{ dirPath: rootPath, index: 0 }];

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const nodes = state.files.get(current.dirPath);

      if (!nodes || current.index >= nodes.length) {
        stack.pop();
        continue;
      }

      const node = nodes[current.index];
      current.index++;
      result.push(node);

      // If this is an expanded directory, push it to process its children next
      if (node.isDirectory && state.expandedFolders.has(node.path)) {
        stack.push({ dirPath: node.path, index: 0 });
      }
    }

    return result;
  },

  computeVisibleItems: (rootPath: string) => {
    const state = get();
    const nodes: FileNode[] = [];

    const collectVisibleNodes = (dirPath: string): void => {
      const dirNodes = state.files.get(dirPath);
      if (!dirNodes) return;

      for (const node of dirNodes) {
        nodes.push(node);
        // If this is an expanded directory, recursively collect its children
        if (node.isDirectory && state.expandedFolders.has(node.path)) {
          collectVisibleNodes(node.path);
        }
      }
    };

    collectVisibleNodes(rootPath);
    return { nodes, count: nodes.length };
  },
}));
