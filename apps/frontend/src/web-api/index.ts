/**
 * Web API Client
 *
 * This module provides a web-compatible implementation of the ElectronAPI interface.
 * It uses HTTP fetch and WebSocket (Socket.IO) to communicate with the web server.
 *
 * When running in web mode, this replaces window.electronAPI.
 */

import { io, Socket } from 'socket.io-client';
import type { ElectronAPI } from '../preload/api';

// Server URL - can be configured via environment variable
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Socket.IO client instance
let socket: Socket | null = null;

// Event listeners map for cleanup
const eventListeners = new Map<string, Set<(...args: unknown[]) => void>>();

/**
 * Initialize Socket.IO connection
 */
function getSocket(): Socket {
  if (!socket) {
    const wsUrl = API_BASE_URL || window.location.origin;
    socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    socket.on('connect', () => {
      console.log('[WebAPI] Socket connected');
    });

    socket.on('disconnect', (reason) => {
      console.log('[WebAPI] Socket disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
      console.error('[WebAPI] Socket connection error:', error);
    });
  }
  return socket;
}

/**
 * Helper to make API requests
 */
async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const url = `${API_BASE_URL}/api${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const result = await response.json();

    return result;
  } catch (error) {
    console.error(`[WebAPI] Request failed: ${method} ${path}`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Helper to subscribe to socket events
 */
function subscribeToEvent<T extends (...args: unknown[]) => void>(
  eventName: string,
  callback: T
): () => void {
  const socket = getSocket();

  // Track listener for cleanup
  if (!eventListeners.has(eventName)) {
    eventListeners.set(eventName, new Set());
  }
  eventListeners.get(eventName)!.add(callback as (...args: unknown[]) => void);

  socket.on(eventName, callback);

  return () => {
    socket.off(eventName, callback);
    eventListeners.get(eventName)?.delete(callback as (...args: unknown[]) => void);
  };
}

/**
 * Create the Web API client
 */
export function createWebAPI(): ElectronAPI {
  return {
    // Project API
    addProject: async (projectPath: string) => {
      return apiRequest('POST', '/projects', { path: projectPath });
    },

    removeProject: async (projectId: string) => {
      return apiRequest('DELETE', `/projects/${projectId}`);
    },

    getProjects: async () => {
      return apiRequest('GET', '/projects');
    },

    updateProjectSettings: async (projectId: string, settings: unknown) => {
      return apiRequest('PATCH', `/projects/${projectId}/settings`, settings);
    },

    initializeProject: async (projectId: string) => {
      return apiRequest('POST', `/projects/${projectId}/initialize`);
    },

    checkProjectVersion: async (_projectId: string) => {
      // Not implemented in web version
      return { success: true, data: { version: '2.7.5', needsUpdate: false } };
    },

    getTabState: async () => {
      // Tab state is managed client-side in web version
      return {
        success: true,
        data: {
          openProjectIds: [],
          activeProjectId: null,
          tabOrder: []
        }
      };
    },

    saveTabState: async (_tabState: unknown) => {
      // Tab state is managed client-side in web version
      return { success: true };
    },

    getKanbanPreferences: async (_projectId: string) => {
      return { success: true, data: null };
    },

    saveKanbanPreferences: async (_projectId: string, _preferences: unknown) => {
      return { success: true };
    },

    getProjectContext: async (_projectId: string) => {
      return { success: true, data: null };
    },

    refreshProjectIndex: async (_projectId: string) => {
      return { success: true, data: null };
    },

    getMemoryStatus: async (_projectId: string) => {
      return { success: true, data: null };
    },

    searchMemories: async (_projectId: string, _query: string) => {
      return { success: true, data: [] };
    },

    getRecentMemories: async (_projectId: string, _limit?: number) => {
      return { success: true, data: [] };
    },

    getProjectEnv: async (_projectId: string) => {
      return { success: true, data: {} };
    },

    updateProjectEnv: async (_projectId: string, _config: unknown) => {
      return { success: true };
    },

    checkClaudeAuth: async (_projectId: string) => {
      return { success: true, data: { authenticated: true } };
    },

    invokeClaudeSetup: async (_projectId: string) => {
      return { success: true, data: { authenticated: true } };
    },

    selectDirectory: async () => {
      // Not available in web - would need file input
      return null;
    },

    createProjectFolder: async (_location: string, _name: string, _initGit: boolean) => {
      return { success: false, error: 'Not available in web mode' };
    },

    getDefaultProjectLocation: async () => {
      return null;
    },

    getMemoryInfrastructureStatus: async (_dbPath?: string) => {
      return { success: true, data: { ready: false } };
    },

    listMemoryDatabases: async (_dbPath?: string) => {
      return { success: true, data: [] };
    },

    testMemoryConnection: async (_dbPath?: string, _database?: string) => {
      return { success: true, data: { valid: false } };
    },

    validateLLMApiKey: async (_provider: string, _apiKey: string) => {
      return { success: true, data: { valid: true } };
    },

    testGraphitiConnection: async (_config: unknown) => {
      return { success: true, data: { connected: false } };
    },

    scanOllamaModels: async (_baseUrl: string) => {
      return { success: true, data: { models: [] } };
    },

    downloadOllamaModel: async (_baseUrl: string, _modelName: string) => {
      return { success: true, data: { message: 'Not implemented' } };
    },

    onDownloadProgress: (_callback: (data: unknown) => void) => {
      return () => {};
    },

    getGitBranches: async (_projectPath: string) => {
      return { success: true, data: [] };
    },

    getCurrentGitBranch: async (_projectPath: string) => {
      return { success: true, data: null };
    },

    detectMainBranch: async (_projectPath: string) => {
      return { success: true, data: 'main' };
    },

    checkGitStatus: async (_projectPath: string) => {
      return { success: true, data: { isGitRepo: false } };
    },

    initializeGit: async (_projectPath: string) => {
      return { success: true, data: { success: true } };
    },

    checkOllamaStatus: async (_baseUrl?: string) => {
      return { success: true, data: { running: false, url: '' } };
    },

    checkOllamaInstalled: async () => {
      return { success: true, data: { installed: false } };
    },

    installOllama: async () => {
      return { success: true, data: { command: '' } };
    },

    listOllamaModels: async (_baseUrl?: string) => {
      return { success: true, data: { models: [], count: 0 } };
    },

    listOllamaEmbeddingModels: async (_baseUrl?: string) => {
      return { success: true, data: { embedding_models: [], count: 0 } };
    },

    pullOllamaModel: async (_modelName: string, _baseUrl?: string) => {
      return { success: true, data: { model: '', status: 'failed', output: [] } };
    },

    // Task API
    getTasks: async (projectId: string, _options?: unknown) => {
      return apiRequest('GET', `/projects/${projectId}/tasks`);
    },

    createTask: async (projectId: string, title: string, description: string, metadata?: unknown) => {
      return apiRequest('POST', `/projects/${projectId}/tasks`, { title, description, metadata });
    },

    deleteTask: async (taskId: string) => {
      // Need projectId from task
      return apiRequest('DELETE', `/tasks/${taskId}`);
    },

    updateTask: async (taskId: string, updates: unknown) => {
      return apiRequest('PATCH', `/tasks/${taskId}`, updates);
    },

    startTask: (taskId: string, options?: unknown) => {
      apiRequest('POST', `/tasks/${taskId}/start`, options);
    },

    stopTask: (taskId: string) => {
      apiRequest('POST', `/tasks/${taskId}/stop`);
    },

    submitReview: async (_taskId: string, _approved: boolean, _feedback?: string, _images?: unknown) => {
      return { success: true };
    },

    updateTaskStatus: async (_taskId: string, _status: unknown, _options?: unknown) => {
      return { success: true };
    },

    recoverStuckTask: async (_taskId: string, _options?: unknown) => {
      return { success: true, data: { recovered: false } };
    },

    checkTaskRunning: async (taskId: string) => {
      return apiRequest('GET', `/tasks/${taskId}/running`);
    },

    loadImageThumbnail: async (_projectPath: string, _specId: string, _imagePath: string) => {
      return { success: true, data: '' };
    },

    getWorktreeStatus: async (_taskId: string) => {
      return { success: true, data: {} };
    },

    getWorktreeDiff: async (_taskId: string) => {
      return { success: true, data: {} };
    },

    mergeWorktree: async (_taskId: string, _options?: unknown) => {
      return { success: true, data: {} };
    },

    mergeWorktreePreview: async (_taskId: string) => {
      return { success: true, data: {} };
    },

    discardWorktree: async (_taskId: string, _skipStatusChange?: boolean) => {
      return { success: true, data: {} };
    },

    clearStagedState: async (_taskId: string) => {
      return { success: true, data: { cleared: true } };
    },

    listWorktrees: async (_projectId: string, _options?: unknown) => {
      return { success: true, data: { worktrees: [] } };
    },

    worktreeOpenInIDE: async (_worktreePath: string, _ide: unknown, _customPath?: string) => {
      return { success: true, data: { opened: false } };
    },

    worktreeOpenInTerminal: async (_worktreePath: string, _terminal: unknown, _customPath?: string) => {
      return { success: true, data: { opened: false } };
    },

    worktreeDetectTools: async () => {
      return { success: true, data: { ides: [], terminals: [] } };
    },

    archiveTasks: async (_projectId: string, _taskIds: string[], _version?: string) => {
      return { success: true, data: true };
    },

    unarchiveTasks: async (_projectId: string, _taskIds: string[]) => {
      return { success: true, data: true };
    },

    createWorktreePR: async (_taskId: string, _options?: unknown) => {
      return { success: true, data: {} };
    },

    // Task event listeners
    onTaskProgress: (callback: (taskId: string, plan: unknown, projectId?: string) => void) => {
      return subscribeToEvent('task:progress', (taskId: string, plan: unknown, projectId?: string) => {
        callback(taskId, plan, projectId);
      });
    },

    onTaskError: (callback: (taskId: string, error: string, projectId?: string) => void) => {
      return subscribeToEvent('task:error', (taskId: string, error: string, projectId?: string) => {
        callback(taskId, error, projectId);
      });
    },

    onTaskLog: (callback: (taskId: string, log: string, projectId?: string) => void) => {
      return subscribeToEvent('task:log', (taskId: string, log: string, projectId?: string) => {
        callback(taskId, log, projectId);
      });
    },

    onTaskStatusChange: (callback: (taskId: string, status: unknown, projectId?: string) => void) => {
      return subscribeToEvent('task:statusChange', (taskId: string, status: unknown, projectId?: string) => {
        callback(taskId, status, projectId);
      });
    },

    onTaskExecutionProgress: (callback: (taskId: string, progress: unknown, projectId?: string) => void) => {
      return subscribeToEvent('task:executionProgress', (taskId: string, progress: unknown, projectId?: string) => {
        callback(taskId, progress, projectId);
      });
    },

    getTaskLogs: async (_projectId: string, _specId: string) => {
      return { success: true, data: null };
    },

    watchTaskLogs: async (_projectId: string, _specId: string) => {
      return { success: true };
    },

    unwatchTaskLogs: async (_specId: string) => {
      return { success: true };
    },

    onTaskLogsChanged: (_callback: (specId: string, logs: unknown) => void) => {
      return () => {};
    },

    onTaskLogsStream: (_callback: (specId: string, chunk: unknown) => void) => {
      return () => {};
    },

    // Terminal API
    createTerminal: async (cwd: string, projectPath?: string) => {
      return apiRequest('POST', '/terminals', { cwd, projectPath });
    },

    sendTerminalInput: (terminalId: string, data: string) => {
      const socket = getSocket();
      socket.emit('terminal:input', { id: terminalId, data });
    },

    resizeTerminal: (terminalId: string, cols: number, rows: number) => {
      const socket = getSocket();
      socket.emit('terminal:resize', { id: terminalId, cols, rows });
    },

    closeTerminal: async (terminalId: string) => {
      return apiRequest('DELETE', `/terminals/${terminalId}`);
    },

    onTerminalOutput: (callback: (terminalId: string, data: string) => void) => {
      return subscribeToEvent('terminal:output', (event: { id: string; data: string }) => {
        callback(event.id, event.data);
      });
    },

    onTerminalExit: (callback: (terminalId: string, exitCode: number) => void) => {
      return subscribeToEvent('terminal:exit', (event: { id: string; exitCode: number }) => {
        callback(event.id, event.exitCode);
      });
    },

    listTerminals: async (projectPath?: string) => {
      const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
      return apiRequest('GET', `/terminals${query}`);
    },

    subscribeToTerminal: (terminalId: string) => {
      const socket = getSocket();
      socket.emit('terminal:subscribe', terminalId);
    },

    unsubscribeFromTerminal: (terminalId: string) => {
      const socket = getSocket();
      socket.emit('terminal:unsubscribe', terminalId);
    },

    getTerminalSessions: async (_projectPath?: string) => {
      return { success: true, data: [] };
    },

    // Settings API
    getSettings: async () => {
      return apiRequest('GET', '/settings');
    },

    saveSettings: async (settings: unknown) => {
      return apiRequest('PATCH', '/settings', settings);
    },

    getAppVersion: async () => {
      const result = await apiRequest<string>('GET', '/version');
      return result.data || '2.7.5';
    },

    openExternal: async (url: string) => {
      window.open(url, '_blank');
    },

    getProfiles: async () => {
      return apiRequest('GET', '/profiles');
    },

    addProfile: async (profile: unknown) => {
      return apiRequest('POST', '/profiles', profile);
    },

    updateProfile: async (profileId: string, updates: unknown) => {
      return apiRequest('PATCH', `/profiles/${profileId}`, updates);
    },

    deleteProfile: async (profileId: string) => {
      return apiRequest('DELETE', `/profiles/${profileId}`);
    },

    setDefaultProfile: async (profileId: string) => {
      return apiRequest('PATCH', `/profiles/${profileId}`, { isDefault: true });
    },

    // File API
    readFile: async (filePath: string) => {
      return apiRequest('GET', `/files/read?path=${encodeURIComponent(filePath)}`);
    },

    listDirectory: async (dirPath: string) => {
      return apiRequest('GET', `/files/list?path=${encodeURIComponent(dirPath)}`);
    },

    // App update API (not available in web)
    checkForUpdates: async () => {
      return { updateAvailable: false };
    },

    downloadUpdate: async () => {
      // Not available in web
    },

    installUpdate: async () => {
      // Not available in web
    },

    onUpdateAvailable: (_callback: (info: unknown) => void) => {
      return () => {};
    },

    onUpdateDownloaded: (_callback: () => void) => {
      return () => {};
    },

    onAppUpdateDownloaded: (_callback: () => void) => {
      return () => {};
    },

    onDownloadProgress: (_callback: (progress: unknown) => void) => {
      return () => {};
    },

    // GitHub API (basic stubs)
    github: {
      startOAuth: async () => {
        return { success: false, error: 'OAuth not available in web mode' };
      },
      checkAuth: async () => {
        return { success: true, data: { authenticated: false } };
      },
      getUser: async () => {
        return { success: true, data: null };
      },
      listRepos: async () => {
        return { success: true, data: [] };
      },
      listIssues: async (_projectId: string, _options?: unknown) => {
        return { success: true, data: [] };
      },
      getIssue: async (_projectId: string, _issueNumber: number) => {
        return { success: true, data: null };
      },
      listPRs: async (_projectId: string, _options?: unknown) => {
        return { success: true, data: [] };
      },
      getPR: async (_projectId: string, _prNumber: number) => {
        return { success: true, data: null };
      },
      onOAuthComplete: (_callback: (result: unknown) => void) => {
        return () => {};
      }
    } as unknown as ElectronAPI['github'],

    // Queue API
    queue: {
      getStatus: async () => {
        return { success: true, data: { queued: 0, running: 0 } };
      },
      getItems: async () => {
        return { success: true, data: [] };
      },
      cancelItem: async (_itemId: string) => {
        return { success: true };
      },
      onQueueUpdate: (_callback: (queue: unknown) => void) => {
        return () => {};
      }
    } as unknown as ElectronAPI['queue'],

    // Other stubs for remaining APIs
    // These can be implemented as needed

    // Roadmap API
    startRoadmap: async (projectId: string, projectPath: string) => {
      return apiRequest('POST', `/projects/${projectId}/roadmap`, { projectPath });
    },

    stopRoadmap: async (_projectId: string) => {
      return { success: true };
    },

    onRoadmapProgress: (callback: (data: unknown) => void) => {
      return subscribeToEvent('agent:message', (data: { type: string }) => {
        if (data.type === 'roadmap') {
          callback(data);
        }
      });
    },

    onRoadmapComplete: (callback: (data: unknown) => void) => {
      return subscribeToEvent('agent:exit', (data: { type: string }) => {
        if (data.type === 'roadmap') {
          callback(data);
        }
      });
    },

    // Insights API
    startInsights: async (projectId: string, projectPath: string, query: string) => {
      return apiRequest('POST', `/projects/${projectId}/insights`, { projectPath, query });
    },

    stopInsights: async (_projectId: string) => {
      return { success: true };
    },

    onInsightsProgress: (callback: (data: unknown) => void) => {
      return subscribeToEvent('agent:message', (data: { type: string }) => {
        if (data.type === 'insights') {
          callback(data);
        }
      });
    },

    onInsightsComplete: (callback: (data: unknown) => void) => {
      return subscribeToEvent('agent:exit', (data: { type: string }) => {
        if (data.type === 'insights') {
          callback(data);
        }
      });
    },

    // Ideation API
    startIdeation: async (projectId: string, projectPath: string, category: string) => {
      return apiRequest('POST', `/projects/${projectId}/ideation`, { projectPath, category });
    },

    stopIdeation: async (_projectId: string) => {
      return { success: true };
    },

    onIdeationProgress: (callback: (data: unknown) => void) => {
      return subscribeToEvent('agent:message', (data: { type: string }) => {
        if (data.type === 'ideation') {
          callback(data);
        }
      });
    },

    onIdeationComplete: (callback: (data: unknown) => void) => {
      return subscribeToEvent('agent:exit', (data: { type: string }) => {
        if (data.type === 'ideation') {
          callback(data);
        }
      });
    },

    // Debug API
    getDebugInfo: async () => {
      return { success: true, data: { mode: 'web' } };
    },

    // Claude Code API
    invokeClaudeCode: async (_terminalId: string, _prompt: string) => {
      return { success: true };
    },

    cancelClaudeCode: async (_terminalId: string) => {
      return { success: true };
    },

    // MCP API
    listMcpServers: async () => {
      return { success: true, data: [] };
    },

    addMcpServer: async (_server: unknown) => {
      return { success: true };
    },

    removeMcpServer: async (_serverId: string) => {
      return { success: true };
    },

    // Profile API
    getClaudeProfiles: async () => {
      return { success: true, data: [] };
    },

    addClaudeProfile: async (_profile: unknown) => {
      return { success: true };
    },

    removeClaudeProfile: async (_profileId: string) => {
      return { success: true };
    },

    setActiveClaudeProfile: async (_profileId: string) => {
      return { success: true };
    },

    onProfileChange: (_callback: (profileId: string) => void) => {
      return () => {};
    },

    onSDKRateLimit: (_callback: (info: unknown) => void) => {
      return () => {};
    },

    onSDKAuthFailure: (_callback: (error: unknown) => void) => {
      return () => {};
    },

    // Screenshot API
    takeScreenshot: async () => {
      return { success: false, error: 'Not available in web mode' };
    },

    captureScreen: async () => {
      return { success: false, error: 'Not available in web mode' };
    }
  } as unknown as ElectronAPI;
}

// Export a singleton instance
export const webAPI = createWebAPI();

// Export socket for direct access if needed
export { getSocket };
