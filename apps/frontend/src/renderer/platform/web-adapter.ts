/**
 * Web adapter for AppAPI
 *
 * This adapter provides HTTP/WebSocket-based communication with the Python backend
 * for running Auto-Claude in a browser environment.
 *
 * Note: Many features are limited or unavailable in web mode (terminals, file dialogs, etc.)
 */

import type { AppAPI, PlatformCapabilities } from './types';
import { WEB_CAPABILITIES } from './types';
import type {
  IPCResult,
  TabState,
  TaskStatus,
  TaskMetadata,
  ProjectEnvConfig,
  CustomMcpServer,
} from '../../shared/types';

/**
 * Get the API base URL from runtime or build-time environment
 */
function getApiBaseUrl(): string {
  // Runtime config (Docker) takes precedence
  const runtimeUrl = (window as any).__ENV__?.VITE_API_URL;
  if (runtimeUrl && !runtimeUrl.startsWith('__')) {
    return runtimeUrl;
  }
  // Fallback to build-time env
  // @ts-expect-error - VITE_API_URL is defined in vite.config.ts env
  const envUrl = import.meta.env?.VITE_API_URL as string;
  // Use empty string for relative /api calls (nginx proxy)
  return envUrl || '';
}

/**
 * Helper for making HTTP requests to the backend
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<IPCResult<T>> {
  try {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}${endpoint}`;
    console.log(`[Web API] ${options.method || 'GET'} ${url}`);

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    console.log(`[Web API] Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Web API] Error: ${errorText}`);
      return { success: false, error: errorText || `HTTP ${response.status}` };
    }

    const data = await response.json();
    
    // If the backend already returns { success, data } format, pass it through
    if (data && typeof data === 'object' && 'success' in data) {
      return data as IPCResult<T>;
    }
    
    // Otherwise wrap it
    return { success: true, data };
  } catch (error) {
    console.error(`[Web API] Request failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create a stub function that returns an error for unsupported operations
 */
function unsupported<T>(operation: string): () => Promise<IPCResult<T>> {
  return async () => ({
    success: false,
    error: `${operation} is not supported in web mode`,
  });
}

/**
 * Create a stub function that returns void for unsupported event operations
 */
function unsupportedEvent(operation: string): (...args: unknown[]) => () => void {
  return () => {
    console.warn(`[Web Adapter] ${operation} is not supported in web mode`);
    return () => {};
  };
}

/**
 * Create a stub function for void operations
 */
function unsupportedVoid(operation: string): (...args: unknown[]) => void {
  return () => {
    console.warn(`[Web Adapter] ${operation} is not supported in web mode`);
  };
}

// Track poll timeouts for task logs (using setTimeout for "poll after completion" pattern)
// This prevents request piling when requests take longer than the poll interval
const taskLogPolls: Map<string, { timeoutId: ReturnType<typeof setTimeout> | null; cancelled: boolean }> = new Map();
const taskLogEventSources: Map<string, EventSource> = new Map();
const taskLogCallbacks: Set<(specId: string, logs: any) => void> = new Set();
const taskLogUpdatedAt: Map<string, string> = new Map();

// Track poll timeouts for task progress (subtasks)
const taskProgressPolls: Map<string, { timeoutId: ReturnType<typeof setTimeout> | null; cancelled: boolean }> = new Map();
const taskProgressCallbacks: Set<(taskId: string, plan: any, projectId?: string) => void> = new Set();

const roadmapPolls: Map<string, { timeoutId: ReturnType<typeof setTimeout> | null; cancelled: boolean }> = new Map();
const roadmapProgressCallbacks: Set<(projectId: string, status: any) => void> = new Set();
const roadmapCompleteCallbacks: Set<(projectId: string, roadmap: any) => void> = new Set();
const roadmapErrorCallbacks: Set<(projectId: string, error: string) => void> = new Set();
const roadmapStoppedCallbacks: Set<(projectId: string) => void> = new Set();

function stopRoadmapPolling(projectId: string) {
  const pollState = roadmapPolls.get(projectId);
  if (pollState) {
    pollState.cancelled = true;
    if (pollState.timeoutId) {
      clearTimeout(pollState.timeoutId);
    }
    roadmapPolls.delete(projectId);
  }
}

type RoadmapStatusPayload = {
  isRunning: boolean;
  phase?: string;
  progress?: number;
  message?: string;
  error?: string;
};

function startRoadmapPolling(projectId: string) {
  stopRoadmapPolling(projectId);

  const pollState = { timeoutId: null as ReturnType<typeof setTimeout> | null, cancelled: false };
  roadmapPolls.set(projectId, pollState);

  const poll = async () => {
    if (pollState.cancelled) return;

    try {
      const statusResult = await apiRequest<RoadmapStatusPayload>(
        `/api/projects/${projectId}/roadmap/status`
      );
      if (pollState.cancelled) return;

      if (statusResult.success && statusResult.data) {
        const statusData = statusResult.data as RoadmapStatusPayload;
        roadmapProgressCallbacks.forEach((callback) => {
          callback(projectId, statusData);
        });

        if (statusData.phase === 'complete') {
          const roadmapResult = await apiRequest(`/api/projects/${projectId}/roadmap`);
          if (roadmapResult.success && roadmapResult.data) {
            roadmapCompleteCallbacks.forEach((callback) => {
              callback(projectId, roadmapResult.data);
            });
          }
          stopRoadmapPolling(projectId);
          return;
        }

        if (statusData.phase === 'error') {
          roadmapErrorCallbacks.forEach((callback) => {
            callback(projectId, statusData.error || 'Roadmap generation failed');
          });
          stopRoadmapPolling(projectId);
          return;
        }

        if (!statusData.isRunning && statusData.phase === 'idle') {
          stopRoadmapPolling(projectId);
          return;
        }
      }
    } catch (error) {
      roadmapErrorCallbacks.forEach((callback) => {
        callback(projectId, error instanceof Error ? error.message : 'Roadmap polling failed');
      });
      stopRoadmapPolling(projectId);
      return;
    }

    if (!pollState.cancelled) {
      pollState.timeoutId = setTimeout(poll, 2000);
    }
  };

  poll();
}

/**
 * Create the Web API adapter
 *
 * This implements the AppAPI interface using HTTP/WebSocket calls
 * to the Python backend. Many operations are stubbed as they require
 * native capabilities not available in browsers.
 *
 * Note: We use a type assertion since the full ElectronAPI is very large
 * and many methods are stubbed for web mode. The core operations are
 * properly implemented, and unsupported operations return appropriate
 * error responses.
 */
export function createWebAdapter(): AppAPI {
  const api = {
    // ===================
    // Project Operations
    // ===================
    addProject: async (projectPath: string) => {
      // Derive project name from path (last folder name)
      const pathParts = projectPath.replace(/\/$/, '').split('/');
      const name = pathParts[pathParts.length - 1] || 'Untitled Project';
      return apiRequest('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, path: projectPath }),
      });
    },

    removeProject: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}`, { method: 'DELETE' }),

    getProjects: async () => apiRequest('/api/projects'),

    updateProjectSettings: async (projectId: string, settings: Record<string, unknown>) =>
      apiRequest(`/api/projects/${projectId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(settings),
      }),

    initializeProject: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/initialize`, { method: 'POST' }),

    checkProjectVersion: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/version`),

    // ===================
    // Tab State
    // ===================
    getTabState: async () => apiRequest('/api/tabs'),
    saveTabState: async (tabState: TabState) =>
      apiRequest('/api/tabs', {
        method: 'PUT',
        body: JSON.stringify(tabState),
      }),

    // ===================
    // Task Operations
    // ===================
    getTasks: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/tasks`),

    createTask: async (projectId: string, title: string, description: string, metadata?: TaskMetadata) =>
      apiRequest(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title, description, metadata }),
      }),

    deleteTask: async (taskId: string) =>
      apiRequest(`/api/tasks/${taskId}`, { method: 'DELETE' }),

    updateTask: async (taskId: string, updates: { title?: string; description?: string }) =>
      apiRequest(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }),

    startTask: async (taskId: string, options?: { autoContinue?: boolean; skipQa?: boolean; model?: string }) => {
      const result = await apiRequest<{ status: string; task_id: string; pid?: number; message?: string }>(`/api/tasks/${taskId}/start`, {
        method: 'POST',
        body: JSON.stringify({
          auto_continue: options?.autoContinue ?? true,
          skip_qa: options?.skipQa ?? false,
          model: options?.model,
        }),
      });
      if (result.success) {
        console.log(`[Web API] Task started in background: ${result.data?.message || 'Running'}`);
      }
      return result;
    },

    stopTask: async (taskId: string) => {
      return apiRequest(`/api/tasks/${taskId}/stop`, { method: 'POST' });
    },

    checkTaskRunning: async (taskId: string) => {
      const result = await apiRequest<{ is_running: boolean; pid?: number }>(`/api/tasks/${taskId}/status`);
      if (result.success) {
        return { success: true, data: result.data?.is_running ?? false };
      }
      return { success: false, error: result.error };
    },

    submitReview: async (taskId: string, approved: boolean, feedback?: string) =>
      apiRequest(`/api/tasks/${taskId}/review`, {
        method: 'POST',
        body: JSON.stringify({ approved, feedback }),
      }),

    updateTaskStatus: async (taskId: string, status: TaskStatus) =>
      apiRequest(`/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),

    recoverStuckTask: async (taskId: string) => {
      // For web mode, recovering a stuck task means restarting it
      return apiRequest(`/api/tasks/${taskId}/start`, {
        method: 'POST',
        body: JSON.stringify({ auto_continue: true }),
      });
    },

    // Watch for task progress updates (subtasks) - polls 2 seconds after each request completes
    watchTaskProgress: async (projectId: string, specId: string) => {
      const taskId = `${projectId}:${specId}`;
      
      // Cancel existing poll if any
      if (taskProgressPolls.has(taskId)) {
        const existing = taskProgressPolls.get(taskId);
        if (existing) {
          existing.cancelled = true;
          if (existing.timeoutId) {
            clearTimeout(existing.timeoutId);
          }
        }
        taskProgressPolls.delete(taskId);
      }
      
      // Create poll state
      const pollState = { timeoutId: null as ReturnType<typeof setTimeout> | null, cancelled: false };
      taskProgressPolls.set(taskId, pollState);
      
      // Poll function - waits for request to complete before scheduling next poll
      const poll = async () => {
        if (pollState.cancelled) return;
        
        try {
          const result = await apiRequest(`/api/projects/${projectId}/tasks/${specId}/plan`);
          if (pollState.cancelled) return;
          
          if (result.success && result.data) {
            taskProgressCallbacks.forEach(callback => {
              callback(taskId, result.data, projectId);
            });
          }
        } catch (e) {
          console.error('[TaskProgress Poll] Error:', e);
        }
        
        // Schedule next poll only after this one completes (prevents request piling)
        if (!pollState.cancelled) {
          pollState.timeoutId = setTimeout(poll, 2000);
        }
      };
      
      // Start first poll immediately
      poll();
      return { success: true };
    },

    unwatchTaskProgress: async (specId: string) => {
      // Find and cancel the poll for this spec
      for (const [taskId, pollState] of Array.from(taskProgressPolls.entries())) {
        if (taskId.endsWith(`:${specId}`)) {
          pollState.cancelled = true;
          if (pollState.timeoutId) {
            clearTimeout(pollState.timeoutId);
          }
          taskProgressPolls.delete(taskId);
          break;
        }
      }
      return { success: true };
    },

    // ===================
    // Workspace Management (Web mode - full support via backend API)
    // ===================
    getWorktreeStatus: async (projectId: string, specName: string) => {
      return apiRequest(`/api/projects/${projectId}/worktrees/${specName}`);
    },
    getWorktreeDiff: async (projectId: string, specName: string) => {
      return apiRequest(`/api/projects/${projectId}/worktrees/${specName}/diff`);
    },
    mergeWorktree: async (projectId: string, specName: string, options?: { deleteAfter?: boolean; noCommit?: boolean }) => {
      return apiRequest(`/api/projects/${projectId}/worktrees/${specName}/merge`, {
        method: 'POST',
        body: JSON.stringify({
          delete_after: options?.deleteAfter ?? false,
          no_commit: options?.noCommit ?? false,
        }),
      });
    },
    mergeWorktreePreview: async (projectId: string, specName: string) => {
      return apiRequest(`/api/projects/${projectId}/worktrees/${specName}/merge-preview`);
    },
    discardWorktree: async (projectId: string, specName: string, deleteBranch?: boolean) => {
      return apiRequest(`/api/projects/${projectId}/worktrees/${specName}?delete_branch=${deleteBranch ?? true}`, {
        method: 'DELETE',
      });
    },
    listWorktrees: async (projectId: string) => {
      return apiRequest(`/api/projects/${projectId}/worktrees`);
    },
    worktreeOpenInIDE: unsupported('worktreeOpenInIDE'),
    worktreeOpenInTerminal: unsupported('worktreeOpenInTerminal'),
    worktreeDetectTools: async (projectId: string, specName: string) => {
      return apiRequest(`/api/projects/${projectId}/worktrees/${specName}/tools`);
    },
    createWorktreePR: unsupported('createWorktreePR'),
    clearStagedState: unsupported('clearStagedState'),

    // ===================
    // Task Archive
    // ===================
    archiveTasks: unsupported('archiveTasks'),
    unarchiveTasks: unsupported('unarchiveTasks'),

    // ===================
    // Event Listeners (Web Mode - with polling for progress)
    // ===================
    onTaskProgress: (callback: (taskId: string, plan: any, projectId?: string) => void) => {
      taskProgressCallbacks.add(callback);
      return () => {
        taskProgressCallbacks.delete(callback);
      };
    },
    onTaskError: unsupportedEvent('onTaskError'),
    onTaskLog: unsupportedEvent('onTaskLog'),
    onTaskStatusChange: unsupportedEvent('onTaskStatusChange'),
    onTaskExecutionProgress: unsupportedEvent('onTaskExecutionProgress'),

    // ===================
    // Terminal Operations (Web Mode - WebSocket PTY)
    // ===================
    createTerminal: async (options?: { cwd?: string; name?: string; shell?: string; cols?: number; rows?: number; projectPath?: string }) => {
      const result = await apiRequest<{
        id: string;
        pid: number;
        name: string;
        cwd: string;
        shell: string;
        cols: number;
        rows: number;
        projectPath?: string;
      }>('/api/terminals', {
        method: 'POST',
        body: JSON.stringify({
          cwd: options?.cwd || '/home',
          name: options?.name || 'Terminal',
          shell: options?.shell,
          cols: options?.cols || 80,
          rows: options?.rows || 24,
          projectPath: options?.projectPath,
        }),
      });
      
      if (result.success && result.data) {
        // Store the terminal ID for WebSocket connection
        const terminalId = result.data.id;
        
        // Create WebSocket connection for this terminal
        const wsUrl = getApiBaseUrl().replace('http', 'ws') + `/api/terminals/${terminalId}/ws`;
        
        // Store connection info in a global map for the Terminal component to use
        (window as any).__webTerminals = (window as any).__webTerminals || {};
        (window as any).__webTerminals[terminalId] = {
          wsUrl,
          ...result.data,
        };
        
        return {
          success: true,
          data: terminalId,
        };
      }
      
      return result as any;
    },
    destroyTerminal: async (terminalId: string) => {
      // Clean up WebSocket connection tracking
      if ((window as any).__webTerminals?.[terminalId]) {
        delete (window as any).__webTerminals[terminalId];
      }
      
      return apiRequest(`/api/terminals/${terminalId}`, { method: 'DELETE' });
    },
    sendTerminalInput: (terminalId: string, data: string) => {
      // Get the WebSocket for this terminal
      const terminalInfo = (window as any).__webTerminals?.[terminalId];
      if (terminalInfo?.ws && terminalInfo.ws.readyState === WebSocket.OPEN) {
        terminalInfo.ws.send(data);
      }
    },
    resizeTerminal: (terminalId: string, cols: number, rows: number) => {
      // Send resize command via WebSocket
      const terminalInfo = (window as any).__webTerminals?.[terminalId];
      if (terminalInfo?.ws && terminalInfo.ws.readyState === WebSocket.OPEN) {
        terminalInfo.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      } else {
        // Fallback to HTTP
        apiRequest(`/api/terminals/${terminalId}/resize`, {
          method: 'POST',
          body: JSON.stringify({ cols, rows }),
        });
      }
    },
    invokeClaudeInTerminal: async (terminalId: string, taskId?: string) => {
      // In web mode, send a command to invoke Claude via the terminal WebSocket
      const terminalInfo = (window as any).__webTerminals?.[terminalId];
      if (terminalInfo?.ws && terminalInfo.ws.readyState === WebSocket.OPEN) {
        // Send the claude command through the terminal
        terminalInfo.ws.send('claude\r');
        return { success: true };
      }
      return { success: false, error: 'Terminal not connected' };
    },
    generateTerminalName: async () => ({
      success: true,
      data: `Terminal ${Date.now()}`,
    }),
    setTerminalTitle: unsupportedVoid('setTerminalTitle'),
    setTerminalWorktreeConfig: async (terminalId: string, config: any) => {
      // Store worktree config for this terminal
      if (!(window as any).__webTerminals) {
        (window as any).__webTerminals = {};
      }
      if (!(window as any).__webTerminals[terminalId]) {
        (window as any).__webTerminals[terminalId] = {};
      }
      (window as any).__webTerminals[terminalId].worktreeConfig = config;
      return { success: true };
    },

    // Terminal session management
    getTerminalSessions: async (projectPath?: string) => {
      // In web mode, filter terminals by project path
      const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
      const result = await apiRequest<Array<{
        id: string;
        name: string;
        cwd: string;
        shell: string;
        cols: number;
        rows: number;
        connected: boolean;
        projectPath?: string;
      }>>(`/api/terminals${query}`);

      if (result.success && result.data) {
        return {
          success: true,
          data: result.data.map(t => ({
            id: t.id,
            name: t.name,
            cwd: t.cwd,
            createdAt: new Date().toISOString(),
            projectPath: t.projectPath,
          })),
        };
      }
      return { success: true, data: [] };
    },
    restoreTerminalSession: async (sessionId: string) => {
      // In web mode, we can't restore PTY sessions, but we can create a new terminal
      // with the same working directory if the session info is available
      console.log('[Web Mode] Terminal session restore requested:', sessionId);
      
      // Return success with data.success format expected by the component
      return {
        success: true,
        data: {
          success: false,
          error: 'Terminal session restoration is not supported in web mode. Please create a new terminal.',
        },
      };
    },
    clearTerminalSessions: async () => {
      // Close all terminals
      const result = await apiRequest<Array<{ id: string }>>('/api/terminals');
      if (result.success && result.data) {
        for (const terminal of result.data) {
          await apiRequest(`/api/terminals/${terminal.id}`, { method: 'DELETE' });
        }
      }
      return { success: true };
    },
    resumeClaudeInTerminal: unsupportedVoid('resumeClaudeInTerminal'),
    activateDeferredClaudeResume: unsupportedVoid('activateDeferredClaudeResume'),
    getTerminalSessionDates: async () => ({ success: true, data: [] }),
    getTerminalSessionsForDate: async () => ({ success: true, data: [] }),
    restoreTerminalSessionsFromDate: unsupported('restoreTerminalSessionsFromDate'),
    saveTerminalBuffer: async () => {},
    checkTerminalPtyAlive: async (terminalId: string) => {
      const result = await apiRequest<Array<{ id: string }>>('/api/terminals');
      if (result.success && result.data) {
        const found = result.data.some(t => t.id === terminalId);
        return { success: true, data: { alive: found } };
      }
      return { success: true, data: { alive: false } };
    },
    updateTerminalDisplayOrders: unsupported('updateTerminalDisplayOrders'),
    listOtherWorktrees: unsupported('listOtherWorktrees'),

    // Terminal worktree
    createTerminalWorktree: async () => ({
      success: false,
      error: 'Not available in web mode',
    }),
    listTerminalWorktrees: unsupported('listTerminalWorktrees'),
    removeTerminalWorktree: unsupported('removeTerminalWorktree'),

    // Terminal events - these need custom WebSocket handling
    onTerminalOutput: (callback: (terminalId: string, data: string) => void) => {
      // This is handled by the Terminal component connecting directly to WebSocket
      // Store the callback for use by the Terminal component
      (window as any).__terminalOutputCallback = callback;
      return () => {
        delete (window as any).__terminalOutputCallback;
      };
    },
    onTerminalExit: (callback: (terminalId: string, exitCode: number) => void) => {
      (window as any).__terminalExitCallback = callback;
      return () => {
        delete (window as any).__terminalExitCallback;
      };
    },
    onTerminalTitleChange: unsupportedEvent('onTerminalTitleChange'),
    onTerminalClaudeSession: unsupportedEvent('onTerminalClaudeSession'),
    onTerminalClaudeExit: unsupportedEvent('onTerminalClaudeExit'),
    onTerminalRateLimit: unsupportedEvent('onTerminalRateLimit'),
    onTerminalOAuthToken: unsupportedEvent('onTerminalOAuthToken'),
    onTerminalAuthCreated: unsupportedEvent('onTerminalAuthCreated'),
    onTerminalClaudeBusy: unsupportedEvent('onTerminalClaudeBusy'),
    onTerminalPendingResume: unsupportedEvent('onTerminalPendingResume'),
    onTerminalWorktreeConfigChange: unsupportedEvent('onTerminalWorktreeConfigChange'),
    onTerminalOnboardingComplete: unsupportedEvent('onTerminalOnboardingComplete'),
    onTerminalProfileChanged: unsupportedEvent('onTerminalProfileChanged'),
    onTerminalOAuthCodeNeeded: unsupportedEvent('onTerminalOAuthCodeNeeded'),
    submitOAuthCode: unsupported('submitOAuthCode'),

    // ===================
    // Claude Profile Management (partial web support)
    // ===================
    getClaudeProfiles: async () =>
      apiRequest('/api/profiles'),

    saveClaudeProfile: async (profile: Record<string, unknown>) =>
      apiRequest('/api/profiles', {
        method: 'POST',
        body: JSON.stringify(profile),
      }),

    deleteClaudeProfile: async (profileId: string) =>
      apiRequest(`/api/profiles/${profileId}`, { method: 'DELETE' }),
    renameClaudeProfile: async (profileId: string, newName: string) =>
      apiRequest(`/api/profiles/${profileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: newName }),
      }),
    setActiveClaudeProfile: async (profileId: string) =>
      apiRequest('/api/profiles/active', {
        method: 'PUT',
        body: JSON.stringify({ profileId }),
      }),
    switchClaudeProfile: unsupported('switchClaudeProfile'),
    initializeClaudeProfile: unsupported('initializeClaudeProfile'),
    setClaudeProfileToken: unsupported('setClaudeProfileToken'),
    authenticateClaudeProfile: unsupported('authenticateClaudeProfile'),
    verifyClaudeProfileAuth: unsupported('verifyClaudeProfileAuth'),
    getAutoSwitchSettings: unsupported('getAutoSwitchSettings'),
    updateAutoSwitchSettings: unsupported('updateAutoSwitchSettings'),
    retryWithProfile: unsupported('retryWithProfile'),

    // ===================
    // Usage Tracking
    // ===================
    requestUsageUpdate: unsupported('requestUsageUpdate'),
    onUsageUpdated: unsupportedEvent('onUsageUpdated'),

    // ===================
    // Settings
    // ===================
    getSettings: async () => apiRequest('/api/settings'),
    saveSettings: async (settings: Record<string, unknown>) =>
      apiRequest('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
    getAppVersion: async () => '1.0.0-web',
    getSentryConfig: async () => ({
      dsn: '',
      tracesSampleRate: 0,
      profilesSampleRate: 0,
    }),
    notifySentryStateChanged: unsupportedVoid('notifySentryStateChanged'),

    // ===================
    // Context Operations
    // ===================
    getProjectContext: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/context`),
    refreshProjectIndex: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/context/refresh`, { method: 'POST' }),
    getMemoryStatus: async (projectId: string) => {
      const result = await apiRequest<{ memoryStatus: unknown }>(`/api/projects/${projectId}/context`);
      if (result.success && result.data) {
        return { success: true, data: (result.data as any).memoryStatus };
      }
      return result as any;
    },
    searchMemories: async (projectId: string, query: string) =>
      apiRequest(`/api/projects/${projectId}/context/memories/search`, {
        method: 'POST',
        body: JSON.stringify({ query }),
      }),
    getRecentMemories: async (projectId: string, limit?: number) =>
      apiRequest(`/api/projects/${projectId}/context/memories${limit ? `?limit=${limit}` : ''}`),

    // ===================
    // Environment Config
    // ===================
    getProjectEnv: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/env`),
    updateProjectEnv: async (projectId: string, config: Partial<ProjectEnvConfig>) =>
      apiRequest(`/api/projects/${projectId}/env`, {
        method: 'PATCH',
        body: JSON.stringify(config),
      }),
    checkClaudeAuth: unsupported('checkClaudeAuth'),
    invokeClaudeSetup: unsupported('invokeClaudeSetup'),

    // ===================
    // Dialog Operations (limited in web)
    // ===================
    selectDirectory: async (): Promise<string | null> => {
      try {
        // In web mode, fetch available projects from the server
        const availableResult = await apiRequest<Array<{ name: string; path: string }>>('/api/projects/available');
        
        let message = 'Enter the server-side project path:\n\n';
        
        if (availableResult.success && availableResult.data && availableResult.data.length > 0) {
          message += 'Available projects in /home/code:\n';
          availableResult.data.forEach((proj) => {
            message += `  - ${proj.name} (${proj.path})\n`;
          });
          message += '\nEnter the full path from above, or enter a custom path:';
        } else {
          message += 'No projects found in /home/code\n\n';
          message += 'Place your project in ./code/ on the host machine, then enter:\n';
          message += '/home/code/your-project-name';
        }
        
        const path = window.prompt(message, '/home/code/');
        
        if (!path) {
          return null;
        }
        
        // Validate the path format
        if (!path.startsWith('/')) {
          window.alert('Path must be an absolute path starting with /');
          return null;
        }
        
        return path.trim();
      } catch (error) {
        console.log('[Web Adapter] Directory selection cancelled or failed:', error);
        // Fallback to simple prompt if API call fails
        const path = window.prompt(
          'Enter the server-side project path:\n\n' +
          'Example: /home/code/your-project-name\n\n' +
          'Make sure the project exists in ./code/ on your host machine.',
          '/home/code/'
        );
        return path?.trim() || null;
      }
    },
        createProjectFolder: async (
      location: string,
      name: string,
      initGit: boolean
    ): Promise<IPCResult<import('../../shared/types').CreateProjectFolderResult>> => {
      const response = await apiRequest<{
        path: string;
        name: string;
        gitInitialized: boolean;
      }>('/api/projects/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location, name, initGit }),
      });
      
      if (!response.success || !response.data) {
        return { success: false, error: response.error || 'Failed to create project folder' };
      }
      
      return {
        success: true,
        data: {
          path: response.data.path,
          name: response.data.name,
          gitInitialized: response.data.gitInitialized,
        },
      };
    },
    getDefaultProjectLocation: async () => null,

    // ===================
    // Memory Infrastructure
    // ===================
    getMemoryInfrastructureStatus: async (projectId: string) => {
      const result = await apiRequest(`/api/projects/${projectId}/context`);
      if (result.success && result.data) {
        const memoryStatus = (result.data as any).memoryStatus || {};
        return {
          success: true,
          data: {
            ladybugAvailable: memoryStatus.available ?? false,
            graphitiReady: memoryStatus.available ?? false,
            llmProvider: memoryStatus.llmProvider || 'anthropic',
            embeddingProvider: memoryStatus.embeddingProvider || null,
            embeddingModel: memoryStatus.embeddingModel || null,
            missingConfig: memoryStatus.missingConfig || [],
          },
        };
      }
      return { success: false, error: result.error };
    },
    listMemoryDatabases: async (projectId: string) => {
      const result = await apiRequest(`/api/projects/${projectId}/context`);
      if (result.success && result.data) {
        const memoryStatus = (result.data as any).memoryStatus || {};
        const databases = memoryStatus.dbPath ? [{
          name: memoryStatus.database || 'default',
          path: memoryStatus.dbPath,
          size: 0,
        }] : [];
        return { success: true, data: databases };
      }
      return { success: true, data: [] };
    },
    testMemoryConnection: async (projectId: string) => {
      const result = await apiRequest(`/api/projects/${projectId}/context`);
      if (result.success && result.data) {
        const memoryStatus = (result.data as any).memoryStatus || {};
        return {
          success: true,
          data: {
            connected: memoryStatus.available ?? false,
            message: memoryStatus.available ? 'Memory system connected' : 'Memory system not available',
          },
        };
      }
      return { success: false, error: result.error };
    },
    validateLLMApiKey: async (provider: string, apiKey: string) => {
      // Use the existing test-connection endpoint
      const result = await apiRequest('/api/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          baseUrl: provider === 'openai' ? 'https://api.openai.com' : 'https://api.anthropic.com',
          apiKey,
        }),
      });
      return result;
    },
    testGraphitiConnection: async (projectId: string) => {
      const result = await apiRequest(`/api/projects/${projectId}/context`);
      if (result.success && result.data) {
        const memoryStatus = (result.data as any).memoryStatus || {};
        return {
          success: true,
          data: {
            connected: memoryStatus.available ?? false,
            version: '1.0.0',
            message: memoryStatus.available ? 'Graphiti connected' : 'Graphiti not configured',
          },
        };
      }
      return { success: false, error: result.error };
    },

    // ===================
    // Ollama
    // ===================
    onDownloadProgress: unsupportedEvent('onDownloadProgress'),
    checkOllamaStatus: async (baseUrl?: string) =>
      apiRequest(`/api/ollama/status${baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''}`),
    checkOllamaInstalled: async () =>
      apiRequest('/api/ollama/installed'),
    installOllama: async () =>
      apiRequest('/api/ollama/install', { method: 'POST' }),
    listOllamaModels: async (baseUrl?: string) =>
      apiRequest(`/api/ollama/models${baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''}`),
    listOllamaEmbeddingModels: async (baseUrl?: string) =>
      apiRequest(`/api/ollama/embedding-models${baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''}`),
    pullOllamaModel: async (modelName: string, baseUrl?: string) =>
      apiRequest('/api/ollama/pull', {
        method: 'POST',
        body: JSON.stringify({ modelName, baseUrl }),
      }),

    // ===================
    // Git Operations
    // ===================
    getGitBranches: async (projectPath: string) =>
      apiRequest(`/api/git/branches?path=${encodeURIComponent(projectPath)}`),
    getCurrentGitBranch: async (projectPath: string) =>
      apiRequest(`/api/git/current-branch?path=${encodeURIComponent(projectPath)}`),
    detectMainBranch: async (projectPath: string) =>
      apiRequest(`/api/git/detect-main-branch?path=${encodeURIComponent(projectPath)}`),
    checkGitStatus: async (projectPath: string) =>
      apiRequest(`/api/git/status?path=${encodeURIComponent(projectPath)}`),
    initializeGit: async (projectPath: string) =>
      apiRequest('/api/git/init', {
        method: 'POST',
        body: JSON.stringify({ path: projectPath }),
      }),

    // ===================
    // Linear Integration
    // ===================
    getLinearTeams: unsupported('getLinearTeams'),
    getLinearProjects: unsupported('getLinearProjects'),
    getLinearIssues: unsupported('getLinearIssues'),
    importLinearIssues: unsupported('importLinearIssues'),
    checkLinearConnection: unsupported('checkLinearConnection'),

    // ===================
    // Roadmap
    // ===================
    getRoadmap: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/roadmap`),
    getRoadmapStatus: async (projectId: string) => {
      const result = await apiRequest<RoadmapStatusPayload>(`/api/projects/${projectId}/roadmap/status`);
      if (result.success && result.data?.isRunning) {
        startRoadmapPolling(projectId);
      }
      return result;
    },
    saveRoadmap: async (projectId: string, roadmap: any) =>
      apiRequest(`/api/projects/${projectId}/roadmap`, {
        method: 'PATCH',
        body: JSON.stringify({ roadmap }),
      }),
    generateRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean) => {
      const payload = {
        enable_competitor_analysis: enableCompetitorAnalysis ?? false,
        refresh_competitor_analysis: refreshCompetitorAnalysis ?? false,
      };
      apiRequest(`/api/projects/${projectId}/roadmap/generate`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      startRoadmapPolling(projectId);
    },
    refreshRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean) => {
      const payload = {
        refresh: true,
        enable_competitor_analysis: enableCompetitorAnalysis ?? false,
        refresh_competitor_analysis: refreshCompetitorAnalysis ?? false,
      };
      apiRequest(`/api/projects/${projectId}/roadmap/refresh`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      startRoadmapPolling(projectId);
    },
    updateFeatureStatus: async (projectId: string, featureId: string, status: any) =>
      apiRequest(`/api/projects/${projectId}/roadmap/features/${featureId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    convertFeatureToSpec: async (projectId: string, featureId: string) =>
      apiRequest(`/api/projects/${projectId}/roadmap/convert-to-spec/${featureId}`, {
        method: 'POST',
      }),
    stopRoadmap: async (projectId: string) => {
      stopRoadmapPolling(projectId);
      const result = await apiRequest(`/api/projects/${projectId}/roadmap/stop`, { method: 'POST' });
      if (result.success) {
        roadmapStoppedCallbacks.forEach((callback) => {
          callback(projectId);
        });
      }
      return result;
    },
    onRoadmapProgress: (callback: (projectId: string, status: any) => void) => {
      roadmapProgressCallbacks.add(callback as any);
      return () => {
        roadmapProgressCallbacks.delete(callback as any);
      };
    },
    onRoadmapComplete: (callback: (projectId: string, roadmap: any) => void) => {
      roadmapCompleteCallbacks.add(callback as any);
      return () => {
        roadmapCompleteCallbacks.delete(callback as any);
      };
    },
    onRoadmapError: (callback: (projectId: string, error: string) => void) => {
      roadmapErrorCallbacks.add(callback as any);
      return () => {
        roadmapErrorCallbacks.delete(callback as any);
      };
    },
    onRoadmapStopped: (callback: (projectId: string) => void) => {
      roadmapStoppedCallbacks.add(callback as any);
      return () => {
        roadmapStoppedCallbacks.delete(callback as any);
      };
    },

    // ===================
    // Ideation
    // ===================
    getIdeation: unsupported('getIdeation'),
    generateIdeation: unsupportedVoid('generateIdeation'),
    refreshIdeation: unsupportedVoid('refreshIdeation'),
    stopIdeation: unsupported('stopIdeation'),
    updateIdeaStatus: unsupported('updateIdeaStatus'),
    convertIdeaToTask: unsupported('convertIdeaToTask'),
    dismissIdea: unsupported('dismissIdea'),
    dismissAllIdeas: unsupported('dismissAllIdeas'),
    archiveIdea: unsupported('archiveIdea'),
    deleteIdea: unsupported('deleteIdea'),
    deleteMultipleIdeas: unsupported('deleteMultipleIdeas'),
    onIdeationProgress: unsupportedEvent('onIdeationProgress'),
    onIdeationLog: unsupportedEvent('onIdeationLog'),
    onIdeationComplete: unsupportedEvent('onIdeationComplete'),
    onIdeationError: unsupportedEvent('onIdeationError'),
    onIdeationStopped: unsupportedEvent('onIdeationStopped'),
    onIdeationTypeComplete: unsupportedEvent('onIdeationTypeComplete'),
    onIdeationTypeFailed: unsupportedEvent('onIdeationTypeFailed'),

    // ===================
    // App Updates (not supported in web)
    // ===================
    checkAppUpdate: unsupported('checkAppUpdate'),
    downloadAppUpdate: unsupported('downloadAppUpdate'),
    downloadStableUpdate: unsupported('downloadStableUpdate'),
    installAppUpdate: unsupportedVoid('installAppUpdate'),
    getDownloadedAppUpdate: unsupported('getDownloadedAppUpdate'),
    onAppUpdateAvailable: unsupportedEvent('onAppUpdateAvailable'),
    onAppUpdateDownloaded: unsupportedEvent('onAppUpdateDownloaded'),
    onAppUpdateProgress: unsupportedEvent('onAppUpdateProgress'),
    onAppUpdateStableDowngrade: unsupportedEvent('onAppUpdateStableDowngrade'),

    // ===================
    // Shell Operations
    // ===================
    openExternal: async (url: string) => {
      window.open(url, '_blank');
    },
    openTerminal: unsupported('openTerminal'),

    // ===================
    // Source Environment
    // ===================
    getSourceEnv: async () =>
      apiRequest('/api/source-env'),
    updateSourceEnv: async (config: { claudeOAuthToken?: string }) =>
      apiRequest('/api/source-env', {
        method: 'PATCH',
        body: JSON.stringify(config),
      }),
    checkSourceToken: async () =>
      apiRequest('/api/source-env/check-token'),

    // ===================
    // Changelog
    // ===================
    getChangelogDoneTasks: unsupported('getChangelogDoneTasks'),
    loadTaskSpecs: unsupported('loadTaskSpecs'),
    generateChangelog: unsupportedVoid('generateChangelog'),
    saveChangelog: unsupported('saveChangelog'),
    readExistingChangelog: unsupported('readExistingChangelog'),
    suggestChangelogVersion: unsupported('suggestChangelogVersion'),
    suggestChangelogVersionFromCommits: unsupported('suggestChangelogVersionFromCommits'),
    getChangelogBranches: unsupported('getChangelogBranches'),
    getChangelogTags: unsupported('getChangelogTags'),
    getChangelogCommitsPreview: unsupported('getChangelogCommitsPreview'),
    saveChangelogImage: unsupported('saveChangelogImage'),
    readLocalImage: unsupported('readLocalImage'),
    onChangelogGenerationProgress: unsupportedEvent('onChangelogGenerationProgress'),
    onChangelogGenerationComplete: unsupportedEvent('onChangelogGenerationComplete'),
    onChangelogGenerationError: unsupportedEvent('onChangelogGenerationError'),

    // ===================
    // Insights
    // ===================
    getInsightsSession: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/insights/session`),
    sendInsightsMessage: async (projectId: string, message: string, modelConfig?: Record<string, unknown>) => {
      // Web mode: Use Server-Sent Events (SSE) for streaming response
      const insightsStoreModule = await import('../stores/insights-store');
      const store = insightsStoreModule.useInsightsStore.getState();
      
      try {
        const baseUrl = getApiBaseUrl();
        const url = `${baseUrl}/api/projects/${projectId}/insights/message`;
        
        console.log('[Web API] Sending insights message via SSE:', { projectId, message: message.substring(0, 50) + '...' });
        
        // Use fetch with streaming for SSE
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({ message, modelConfig }),
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Web API] Insights SSE error:', errorText);
          store.setStatus({ phase: 'error', error: errorText });
          return;
        }
        
        // Read the SSE stream
        const reader = response.body?.getReader();
        if (!reader) {
          store.setStatus({ phase: 'error', error: 'No response stream' });
          return;
        }
        
        const decoder = new TextDecoder();
        let buffer = '';
        
        store.setStatus({ phase: 'streaming', message: 'Receiving response...' });
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }
          
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete SSE messages (lines ending with \n\n)
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep incomplete message in buffer
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                switch (data.type) {
                  case 'text':
                    if (data.content) {
                      store.appendStreamingContent(data.content);
                    }
                    break;
                    
                  case 'tool_start':
                    if (data.tool) {
                      store.setCurrentTool({
                        name: data.tool.name,
                        input: data.tool.input
                      });
                      store.addToolUsage({
                        name: data.tool.name,
                        input: data.tool.input
                      });
                      store.setStatus({
                        phase: 'streaming',
                        message: `Using ${data.tool.name}...`
                      });
                    }
                    break;
                    
                  case 'tool_end':
                    store.setCurrentTool(null);
                    break;
                    
                  case 'task_suggestion':
                    store.setCurrentTool(null);
                    store.finalizeStreamingMessage(data.suggestedTask);
                    break;
                    
                  case 'done':
                    store.setCurrentTool(null);
                    store.finalizeStreamingMessage();
                    store.setStatus({ phase: 'complete', message: '' });
                    setTimeout(() => {
                      store.setStatus({ phase: 'idle', message: '' });
                    }, 100);
                    break;
                    
                  case 'error':
                    store.setCurrentTool(null);
                    store.setStatus({ phase: 'error', error: data.error });
                    break;
                    
                  case 'user_message':
                    // User message already added by store, skip
                    break;
                }
              } catch (parseError) {
                console.warn('[Web API] Failed to parse SSE data:', line);
              }
            }
          }
        }
        
        // Handle any remaining buffer content
        if (buffer.startsWith('data: ')) {
          try {
            const data = JSON.parse(buffer.slice(6));
            if (data.type === 'done') {
              store.finalizeStreamingMessage();
              store.setStatus({ phase: 'idle', message: '' });
            }
          } catch {
            // Ignore incomplete data
          }
        }
        
      } catch (error) {
        console.error('[Web API] sendInsightsMessage exception:', error);
        store.setStatus({ 
          phase: 'error', 
          error: error instanceof Error ? error.message : 'Unknown error occurred' 
        });
      }
    },
    clearInsightsSession: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/insights/session`, { method: 'DELETE' }),
    createTaskFromInsights: async (projectId: string, title: string, description: string, metadata?: TaskMetadata) =>
      apiRequest(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title, description, metadata }),
      }),
    listInsightsSessions: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/insights/sessions`),
    newInsightsSession: async (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/insights/session`, { method: 'POST' }),
    switchInsightsSession: async (projectId: string, sessionId: string) =>
      apiRequest(`/api/projects/${projectId}/insights/session/${sessionId}/switch`, { method: 'POST' }),
    deleteInsightsSession: async (projectId: string, sessionId: string) =>
      apiRequest(`/api/projects/${projectId}/insights/session/${sessionId}`, { method: 'DELETE' }),
    renameInsightsSession: async (projectId: string, sessionId: string, title: string) =>
      apiRequest(`/api/projects/${projectId}/insights/session/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    updateInsightsModelConfig: async (projectId: string, sessionId: string, modelConfig: Record<string, unknown>) =>
      apiRequest(`/api/projects/${projectId}/insights/session/${sessionId}/config`, {
        method: 'PATCH',
        body: JSON.stringify(modelConfig),
      }),
    onInsightsStreamChunk: unsupportedEvent('onInsightsStreamChunk'),
    onInsightsStatus: unsupportedEvent('onInsightsStatus'),
    onInsightsError: unsupportedEvent('onInsightsError'),

    // ===================
    // Task Logs (Web Mode)
    // ===================
    getTaskLogs: async (projectId: string, specId: string) => {
      return apiRequest(`/api/projects/${projectId}/tasks/${specId}/logs`);
    },
    watchTaskLogs: async (projectId: string, specId: string) => {
      // Web mode: Use polling instead of SSE for better compatibility
      // Uses "poll after completion" pattern to prevent request piling
      const taskId = `${projectId}:${specId}`;
      
      // Cancel existing poll if any
      if (taskLogPolls.has(taskId)) {
        const existing = taskLogPolls.get(taskId);
        if (existing) {
          existing.cancelled = true;
          if (existing.timeoutId) {
            clearTimeout(existing.timeoutId);
          }
        }
        taskLogPolls.delete(taskId);
      }
      
      // Create poll state
      const pollState = { timeoutId: null as ReturnType<typeof setTimeout> | null, cancelled: false };
      taskLogPolls.set(taskId, pollState);
      
      // Poll function - waits for request to complete before scheduling next poll
      const poll = async () => {
        if (pollState.cancelled) return;
        
        try {
          const lastUpdatedAt = taskLogUpdatedAt.get(taskId);
          const query = lastUpdatedAt ? `?since=${encodeURIComponent(lastUpdatedAt)}` : '';
          const result = await apiRequest(`/api/projects/${projectId}/tasks/${specId}/logs${query}`);
          if (pollState.cancelled) return;
          
          if (result.success) {
            if (result.data) {
              const logs = result.data as { updated_at?: string };
              if (logs.updated_at) {
                taskLogUpdatedAt.set(taskId, logs.updated_at);
              }
              taskLogCallbacks.forEach(callback => {
                callback(specId, result.data);
              });
            } else if (lastUpdatedAt === undefined) {
              taskLogUpdatedAt.set(taskId, '');
            }
          }
        } catch (e) {
          console.error('[TaskLog Poll] Error:', e);
        }
        
        // Schedule next poll only after this one completes (prevents request piling)
        if (!pollState.cancelled) {
          pollState.timeoutId = setTimeout(poll, 2000);
        }
      };
      
      // Start first poll immediately
      poll();
      return { success: true };
    },
    unwatchTaskLogs: async (specId: string) => {
      // Find and cancel the poll for this spec
      for (const [taskId, pollState] of Array.from(taskLogPolls.entries())) {
        if (taskId.endsWith(`:${specId}`)) {
          pollState.cancelled = true;
          if (pollState.timeoutId) {
            clearTimeout(pollState.timeoutId);
          }
          taskLogPolls.delete(taskId);
          taskLogUpdatedAt.delete(taskId);
          break;
        }
      }
      return { success: true };
    },
    onTaskLogsChanged: (callback: (specId: string, logs: any) => void) => {
      // Register callback for log updates
      taskLogCallbacks.add(callback);
      return () => {
        taskLogCallbacks.delete(callback);
      };
    },
    onTaskLogsStream: unsupportedEvent('onTaskLogsStream'),

    // ===================
    // File Operations
    // ===================
    listDirectory: async (dirPath: string) => {
      console.log('[Web Adapter] listDirectory called with:', dirPath);
      const pathParts = dirPath.replace(/\/$/, '').split('/');
      const specFolder = pathParts[pathParts.length - 1];
      const specsIndex = pathParts.indexOf('specs');
      const autoClaudeIndex = pathParts.indexOf('.auto-claude');
      
      console.log('[Web Adapter] listDirectory parsed:', { specFolder, specsIndex, autoClaudeIndex, pathParts });
      
      if (specsIndex === -1 || autoClaudeIndex === -1) {
        console.warn('[Web Adapter] listDirectory: Invalid path:', dirPath);
        return { success: false, error: 'Invalid specs path format' };
      }
      
      const projectPath = pathParts.slice(0, autoClaudeIndex).join('/');
      console.log('[Web Adapter] listDirectory projectPath:', projectPath);
      
      const projectsResult = await apiRequest<Array<{ id: string; path: string }>>('/api/projects');
      console.log('[Web Adapter] listDirectory projects:', projectsResult);
      
      if (!projectsResult.success || !projectsResult.data) {
        return { success: false, error: 'Failed to fetch projects' };
      }
      
      const project = projectsResult.data.find(p => p.path === projectPath);
      console.log('[Web Adapter] listDirectory found project:', project);
      
      if (!project) {
        console.warn('[Web Adapter] listDirectory: Project not found for path:', projectPath);
        return { success: false, error: 'Project not found' };
      }
      
      const endpoint = `/api/projects/${project.id}/tasks/${specFolder}/files`;
      console.log('[Web Adapter] listDirectory calling endpoint:', endpoint);
      return apiRequest(endpoint);
    },
    
    readFile: async (filePath: string) => {
      const pathParts = filePath.replace(/\/$/, '').split('/');
      const specsIndex = pathParts.indexOf('specs');
      const autoClaudeIndex = pathParts.indexOf('.auto-claude');
      
      if (specsIndex === -1 || autoClaudeIndex === -1) {
        return { success: false, error: 'Invalid file path format' };
      }
      
      const specFolder = pathParts[specsIndex + 1];
      const projectPath = pathParts.slice(0, autoClaudeIndex).join('/');
      
      const projectsResult = await apiRequest<Array<{ id: string; path: string }>>('/api/projects');
      if (!projectsResult.success || !projectsResult.data) {
        return { success: false, error: 'Failed to fetch projects' };
      }
      
      const project = projectsResult.data.find(p => p.path === projectPath);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      
      const encodedPath = encodeURIComponent(filePath);
      return apiRequest(`/api/projects/${project.id}/tasks/${specFolder}/files/content?file_path=${encodedPath}`);
    },

    // Get git changes for a task (list of modified files)
    getTaskGitChanges: async (projectId: string, specId: string) => {
      console.log('[Web Adapter] getTaskGitChanges:', { projectId, specId });
      return apiRequest(`/api/projects/${projectId}/tasks/${specId}/git-changes`);
    },

    // Get git diff for a specific file in a task
    getTaskFileDiff: async (projectId: string, specId: string, filePath: string) => {
      console.log('[Web Adapter] getTaskFileDiff:', { projectId, specId, filePath });
      const encodedPath = encodeURIComponent(filePath);
      return apiRequest(`/api/projects/${projectId}/tasks/${specId}/git-diff?file_path=${encodedPath}`);
    },

    // ===================
    // GitHub API
    // ===================
    github: {
      getGitHubRepositories: async () => ({ success: true, data: [] }),
      getGitHubIssues: async () => ({ success: true, data: [] }),
      getGitHubIssue: async () => ({ success: true, data: null as any }),
      getIssueComments: async () => ({ success: true, data: [] }),
      checkGitHubConnection: async () => ({
        success: true,
        data: { connected: false, repoFullName: undefined, error: undefined },
      }),
      investigateGitHubIssue: () => {},
      importGitHubIssues: async () => ({
        success: true,
        data: { success: true, imported: 0, failed: 0, issues: [] },
      }),
      createGitHubRelease: async () => ({ success: true, data: { url: '' } }),
      suggestReleaseVersion: async () => ({
        success: true,
        data: {
          suggestedVersion: '1.0.0',
          currentVersion: '0.0.0',
          bumpType: 'minor' as const,
          commitCount: 0,
          reason: 'Initial',
        },
      }),
      checkGitHubCli: async () => ({ success: true, data: { installed: false } }),
      checkGitHubAuth: async () => ({ success: true, data: { authenticated: false } }),
      startGitHubAuth: async () => ({ success: true, data: { success: false } }),
      getGitHubToken: async () => ({ success: true, data: { token: '' } }),
      getGitHubUser: async () => ({ success: true, data: { username: '' } }),
      listGitHubUserRepos: async () => ({ success: true, data: { repos: [] } }),
      detectGitHubRepo: async () => ({ success: true, data: '' }),
      getGitHubBranches: async () => ({ success: true, data: [] }),
      createGitHubRepo: async () => ({ success: true, data: { fullName: '', url: '' } }),
      addGitRemote: async () => ({ success: true, data: { remoteUrl: '' } }),
      listGitHubOrgs: async () => ({ success: true, data: { orgs: [] } }),
      onGitHubAuthDeviceCode: () => () => {},
      onGitHubInvestigationProgress: () => () => {},
      onGitHubInvestigationComplete: () => () => {},
      onGitHubInvestigationError: () => () => {},
      getAutoFixConfig: async () => null,
      saveAutoFixConfig: async () => true,
      getAutoFixQueue: async () => [],
      checkAutoFixLabels: async () => [],
      checkNewIssues: async () => [],
      startAutoFix: () => {},
      onAutoFixProgress: () => () => {},
      onAutoFixComplete: () => () => {},
      onAutoFixError: () => () => {},
      listPRs: async () => [],
      getPR: async () => null,
      runPRReview: () => {},
      cancelPRReview: async () => true,
      postPRReview: async () => true,
      postPRComment: async () => true,
      mergePR: async () => true,
      assignPR: async () => true,
      getPRReview: async () => null,
      getPRReviewsBatch: async () => ({}),
      deletePRReview: async () => true,
      checkNewCommits: async () => ({ hasNewCommits: false, newCommitCount: 0 }),
      checkMergeReadiness: async () => ({
        isDraft: false,
        mergeable: 'UNKNOWN' as const,
        ciStatus: 'none' as const,
        blockers: [],
      }),
      runFollowupReview: () => {},
      getPRLogs: async () => null,
      getWorkflowsAwaitingApproval: async () => ({
        awaiting_approval: 0,
        workflow_runs: [],
        can_approve: false,
      }),
      approveWorkflow: async () => true,
      markReviewPosted: async () => true,
      updatePRBranch: async () => ({ success: false, error: 'Not supported in web mode' }),
      onPRReviewProgress: () => () => {},
      onPRReviewComplete: () => () => {},
      onPRReviewError: () => () => {},
      batchAutoFix: () => {},
      getBatches: async () => [],
      onBatchProgress: () => () => {},
      onBatchComplete: () => () => {},
      onBatchError: () => () => {},
      analyzeIssuesPreview: () => {},
      approveBatches: async () => ({ success: true, batches: [] }),
      onAnalyzePreviewProgress: () => () => {},
      onAnalyzePreviewComplete: () => () => {},
      onAnalyzePreviewError: () => () => {},
      onGitHubAuthChanged: () => () => {},
    },

    // ===================
    // GitLab API (flat, not nested)
    // ===================
    getGitLabProjects: unsupported('getGitLabProjects'),
    checkGitLabConnection: unsupported('checkGitLabConnection'),
    getGitLabIssues: unsupported('getGitLabIssues'),
    getGitLabIssue: unsupported('getGitLabIssue'),
    getGitLabIssueNotes: unsupported('getGitLabIssueNotes'),
    investigateGitLabIssue: unsupportedVoid('investigateGitLabIssue'),
    importGitLabIssues: unsupported('importGitLabIssues'),
    createGitLabRelease: unsupported('createGitLabRelease'),
    getGitLabMergeRequests: unsupported('getGitLabMergeRequests'),
    getGitLabMergeRequest: unsupported('getGitLabMergeRequest'),
    createGitLabMergeRequest: unsupported('createGitLabMergeRequest'),
    updateGitLabMergeRequest: unsupported('updateGitLabMergeRequest'),
    getGitLabMRReview: async () => null,
    runGitLabMRReview: unsupportedVoid('runGitLabMRReview'),
    runGitLabMRFollowupReview: unsupportedVoid('runGitLabMRFollowupReview'),
    postGitLabMRReview: async () => false,
    postGitLabMRNote: async () => false,
    mergeGitLabMR: async () => false,
    assignGitLabMR: async () => false,
    approveGitLabMR: async () => false,
    cancelGitLabMRReview: async () => true,
    checkGitLabMRNewCommits: async () => ({ hasNewCommits: false, newCommitCount: 0 }),
    onGitLabMRReviewProgress: unsupportedEvent('onGitLabMRReviewProgress'),
    onGitLabMRReviewComplete: unsupportedEvent('onGitLabMRReviewComplete'),
    onGitLabMRReviewError: unsupportedEvent('onGitLabMRReviewError'),
    checkGitLabCli: unsupported('checkGitLabCli'),
    installGitLabCli: unsupported('installGitLabCli'),
    checkGitLabAuth: unsupported('checkGitLabAuth'),
    startGitLabAuth: unsupported('startGitLabAuth'),
    getGitLabToken: unsupported('getGitLabToken'),
    getGitLabUser: unsupported('getGitLabUser'),
    listGitLabUserProjects: unsupported('listGitLabUserProjects'),
    detectGitLabProject: unsupported('detectGitLabProject'),
    getGitLabBranches: unsupported('getGitLabBranches'),
    createGitLabProject: unsupported('createGitLabProject'),
    addGitLabRemote: unsupported('addGitLabRemote'),
    listGitLabGroups: unsupported('listGitLabGroups'),
    onGitLabInvestigationProgress: unsupportedEvent('onGitLabInvestigationProgress'),
    onGitLabInvestigationComplete: unsupportedEvent('onGitLabInvestigationComplete'),
    onGitLabInvestigationError: unsupportedEvent('onGitLabInvestigationError'),

    // ===================
    // Azure DevOps API
    // ===================
    azureDevOps: {
      getConfig: unsupported('azureDevOps.getConfig'),
      getIterations: async () => ({ success: false, error: 'Not supported in web mode' }),
      getCurrentIteration: unsupported('azureDevOps.getCurrentIteration'),
      getWorkItemsForIteration: async () => ({ success: false, error: 'Not supported in web mode' }),
      getWorkItem: unsupported('azureDevOps.getWorkItem'),
      getAreas: async () => ({ success: false, error: 'Not supported in web mode' }),
      checkConnection: unsupported('azureDevOps.checkConnection'),
    },

    // ===================
    // Queue API (Rate Limit Recovery)
    // ===================
    queue: {
      getRunningTasksByProfile: unsupported('queue.getRunningTasksByProfile'),
      getBestProfileForTask: unsupported('queue.getBestProfileForTask'),
      assignProfileToTask: unsupported('queue.assignProfileToTask'),
      updateTaskSession: unsupported('queue.updateTaskSession'),
      getTaskSession: unsupported('queue.getTaskSession'),
      onQueueProfileSwapped: () => () => {},
      onQueueSessionCaptured: () => () => {},
      onQueueBlockedNoProfiles: () => () => {},
    },

    // ===================
    // Claude Code CLI
    // ===================
    checkClaudeCodeVersion: async () => {
      // Check Claude CLI availability via backend
      const result = await apiRequest<{
        installed: string | null;
        latest: string;
        isOutdated: boolean;
        path: string | undefined;
        detectionResult: {
          found: boolean;
          path: string | undefined;
          version: string | undefined;
          source: 'system-path' | 'user-config' | 'homebrew' | 'nvm';
          message: string;
        };
      }>('/api/claude-cli/version');
      
      if (result.success && result.data) {
        return result;
      }
      
      // Fallback if backend call fails
      return {
        success: true,
        data: {
          installed: null,
          latest: '1.0.0',
          isOutdated: false,
          path: undefined,
          detectionResult: {
            found: false,
            path: undefined,
            version: undefined,
            source: 'system-path' as const,
            message: 'Claude Code CLI check failed - backend unavailable',
          },
        },
      };
    },
    installClaudeCode: async () => ({
      success: false,
      error: 'To install Claude Code CLI on the server, run: npm install -g @anthropic-ai/claude-code',
    }),

    // ===================
    // Debug
    // ===================
    getDebugInfo: async () => ({
      systemInfo: {
        appVersion: '0.0.0-web',
        platform: 'web',
        isPackaged: 'false',
      },
      recentErrors: [],
      logsPath: '/web/logs',
      debugReport: '[Web Mode] Debug report not available in browser',
    }),
    openLogsFolder: async () => ({
      success: false,
      error: 'Not available in web mode',
    }),
    copyDebugInfo: async () => ({
      success: false,
      error: 'Not available in web mode',
    }),
    getRecentErrors: async () => [],
    listLogFiles: async () => [],

    // ===================
    // MCP Health Check
    // ===================
    checkMcpHealth: async (server: CustomMcpServer) => ({
      success: true,
      data: {
        serverId: server.id,
        status: 'unknown' as const,
        message: 'Health check not available in web mode',
        checkedAt: new Date().toISOString(),
      },
    }),
    testMcpConnection: async (server: CustomMcpServer) => ({
      success: true,
      data: {
        serverId: server.id,
        success: false,
        message: 'Connection test not available in web mode',
      },
    }),

    // ===================
    // API Profiles
    // ===================
    getAPIProfiles: async () => apiRequest('/api/profiles'),

    saveAPIProfile: async (profile: Record<string, unknown>) =>
      apiRequest('/api/profiles', {
        method: 'POST',
        body: JSON.stringify(profile),
      }),

    updateAPIProfile: async (profile: Record<string, unknown>) =>
      apiRequest(`/api/profiles/${profile.id}`, {
        method: 'PUT',
        body: JSON.stringify(profile),
      }),

    deleteAPIProfile: async (profileId: string) =>
      apiRequest(`/api/profiles/${profileId}`, { method: 'DELETE' }),

    setActiveAPIProfile: async (profileId: string | null) =>
      apiRequest('/api/profiles/active', {
        method: 'PUT',
        body: JSON.stringify({ profileId }),
      }),

    testConnection: async (baseUrl: string, apiKey: string) =>
      apiRequest('/api/test-connection', {
        method: 'POST',
        body: JSON.stringify({ baseUrl, apiKey }),
      }),

    discoverModels: async (baseUrl: string, apiKey: string) => {
      // Try to discover models from the API endpoint
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'x-api-key': apiKey,
          },
        });
        if (response.ok) {
          const data = await response.json();
          const models = (data.data || []).map((m: any) => ({
            id: m.id,
            name: m.id,
            created: m.created,
          }));
          return { success: true, data: { models } };
        }
        return { success: false, error: `API returned ${response.status}` };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to discover models' };
      }
    },

    // Folder browsing for web mode
    browseFolders: async (path?: string) =>
      apiRequest(`/api/browse-folders${path ? `?path=${encodeURIComponent(path)}` : ''}`),

    // Stub remaining methods that may be missing
    // These are added to match ElectronAPI interface fully
    fetchClaudeUsage: unsupported('fetchClaudeUsage'),
    getBestAvailableProfile: unsupported('getBestAvailableProfile'),
    onSDKRateLimit: unsupportedEvent('onSDKRateLimit'),
    onAuthFailure: unsupportedEvent('onAuthFailure'),
    onProactiveSwapNotification: unsupportedEvent('onProactiveSwapNotification'),
    getReleaseableVersions: unsupported('getReleaseableVersions'),
    runReleasePreflightCheck: unsupported('runReleasePreflightCheck'),
    createRelease: unsupportedVoid('createRelease'),
    onReleaseProgress: unsupportedEvent('onReleaseProgress'),
    onReleaseComplete: unsupportedEvent('onReleaseComplete'),
    onReleaseError: unsupportedEvent('onReleaseError'),
    getGitHubRepositories: unsupported('getGitHubRepositories'),
    getGitHubIssues: unsupported('getGitHubIssues'),
    getGitHubIssue: unsupported('getGitHubIssue'),
    checkGitHubConnection: unsupported('checkGitHubConnection'),
    investigateGitHubIssue: unsupportedVoid('investigateGitHubIssue'),
    getIssueComments: unsupported('getIssueComments'),
    importGitHubIssues: unsupported('importGitHubIssues'),
    createGitHubRelease: unsupported('createGitHubRelease'),
    onGitHubInvestigationProgress: unsupportedEvent('onGitHubInvestigationProgress'),
    onGitHubInvestigationComplete: unsupportedEvent('onGitHubInvestigationComplete'),
    onGitHubInvestigationError: unsupportedEvent('onGitHubInvestigationError'),
    getClaudeCodeVersions: unsupported('getClaudeCodeVersions'),
    installClaudeCodeVersion: unsupported('installClaudeCodeVersion'),
    getClaudeCodeInstallations: unsupported('getClaudeCodeInstallations'),
    setClaudeCodeActivePath: unsupported('setClaudeCodeActivePath'),
    
    // Platform identification for web mode
    platform: 'web' as const,
    isElectron: false,
  } as unknown as AppAPI;

  return api;
}

/**
 * Get Web platform capabilities
 *
 * Web mode has limited capabilities compared to Electron.
 */
export function getWebCapabilities(): PlatformCapabilities {
  return WEB_CAPABILITIES;
}

/**
 * Check if running in web environment (not Electron)
 */
export function isWeb(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.electronAPI === undefined || typeof window.electronAPI !== 'object')
  );
}
