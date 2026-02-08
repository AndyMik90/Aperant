import { create } from 'zustand';

/**
 * Task queue item for the Insights sidebar
 */
export interface InsightsQueuedTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  taskId?: string; // ID of actual task once created in task-store
  metadata?: {
    category?: string;
    complexity?: string;
    priority?: string;
    dependencies?: string[];
  };
}

interface InsightsTaskQueueState {
  tasks: InsightsQueuedTask[];
  isCollapsed: boolean;

  // Actions
  addTask: (task: Omit<InsightsQueuedTask, 'id' | 'createdAt' | 'status'>) => string;
  removeTask: (id: string) => void;
  updateTaskStatus: (id: string, status: InsightsQueuedTask['status'], taskId?: string) => void;
  setTaskStarted: (id: string) => void;
  setTaskCompleted: (id: string) => void;
  setTaskFailed: (id: string) => void;
  clearCompletedTasks: () => void;
  toggleCollapsed: () => void;
  loadFromStorage: () => void;
}

const STORAGE_KEY = 'insights-task-queue';

/**
 * Load tasks from localStorage
 */
function loadTasksFromStorage(): InsightsQueuedTask[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    // Convert date strings back to Date objects
    return parsed.map((task: any) => ({
      ...task,
      createdAt: new Date(task.createdAt),
      startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
      completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
    }));
  } catch (error) {
    console.error('[InsightsTaskQueue] Failed to load from localStorage:', error);
    return [];
  }
}

/**
 * Save tasks to localStorage
 */
function saveTasksToStorage(tasks: InsightsQueuedTask[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (error) {
    console.error('[InsightsTaskQueue] Failed to save to localStorage:', error);
  }
}

/**
 * Generate unique task ID
 */
function generateTaskId(): string {
  return `insights-task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const useInsightsTaskQueueStore = create<InsightsTaskQueueState>((set, get) => ({
  tasks: [],
  isCollapsed: false,

  addTask: (taskData) => {
    const id = generateTaskId();
    const newTask: InsightsQueuedTask = {
      ...taskData,
      id,
      status: 'pending',
      createdAt: new Date(),
    };

    set((state) => {
      const tasks = [...state.tasks, newTask];
      saveTasksToStorage(tasks); // Persist immediately
      return { tasks };
    });

    console.log('[InsightsTaskQueue] Task added:', id);
    return id;
  },

  removeTask: (id) => {
    set((state) => {
      const tasks = state.tasks.filter((t) => t.id !== id);
      saveTasksToStorage(tasks); // Persist immediately
      return { tasks };
    });
    console.log('[InsightsTaskQueue] Task removed:', id);
  },

  updateTaskStatus: (id, status, taskId) => {
    set((state) => {
      const tasks = state.tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              status,
              ...(taskId && { taskId }),
              ...(status === 'running' && !t.startedAt && { startedAt: new Date() }),
              ...(status === 'complete' && !t.completedAt && { completedAt: new Date() }),
              ...(status === 'failed' && !t.completedAt && { completedAt: new Date() }),
            }
          : t
      );
      saveTasksToStorage(tasks); // Persist immediately
      return { tasks };
    });
    console.log('[InsightsTaskQueue] Task status updated:', id, status);
  },

  setTaskStarted: (id) => {
    get().updateTaskStatus(id, 'running');
  },

  setTaskCompleted: (id) => {
    get().updateTaskStatus(id, 'complete');
  },

  setTaskFailed: (id) => {
    get().updateTaskStatus(id, 'failed');
  },

  clearCompletedTasks: () => {
    set((state) => {
      const tasks = state.tasks.filter((t) => t.status !== 'complete');
      saveTasksToStorage(tasks); // Persist immediately
      return { tasks };
    });
    console.log('[InsightsTaskQueue] Completed tasks cleared');
  },

  toggleCollapsed: () => {
    set((state) => ({ isCollapsed: !state.isCollapsed }));
  },

  loadFromStorage: () => {
    const tasks = loadTasksFromStorage();
    set({ tasks });
    console.log('[InsightsTaskQueue] Loaded from storage:', tasks.length, 'tasks');
  },
}));

// Auto-load from storage on module initialization
if (typeof window !== 'undefined') {
  useInsightsTaskQueueStore.getState().loadFromStorage();
}
