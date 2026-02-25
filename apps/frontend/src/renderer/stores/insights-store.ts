import { create } from 'zustand';
import type {
  InsightsSession,
  InsightsSessionSummary,
  InsightsChatMessage,
  InsightsChatStatus,
  InsightsStreamChunk,
  InsightsToolUsage,
  InsightsModelConfig,
  TaskMetadata,
  Task,
  ImageAttachment
} from '../../shared/types';

interface ToolUsage {
  name: string;
  input?: string;
}

interface InsightsState {
  // Data
  session: InsightsSession | null;
  sessions: InsightsSessionSummary[]; // List of all sessions
  status: InsightsChatStatus;
  pendingMessage: string;
  streamingContent: string; // Accumulates streaming response
  streamingTasks: NonNullable<InsightsChatMessage['suggestedTasks']>; // Accumulates task suggestions during streaming
  currentTool: ToolUsage | null; // Currently executing tool
  toolsUsed: InsightsToolUsage[]; // Tools used during current response
  isLoadingSessions: boolean;
  showArchived: boolean; // Whether to include archived sessions in listings
  pendingImages: ImageAttachment[]; // Images pending attachment to next message

  // Actions
  setSession: (session: InsightsSession | null) => void;
  setSessions: (sessions: InsightsSessionSummary[]) => void;
  setStatus: (status: InsightsChatStatus) => void;
  setPendingMessage: (message: string) => void;
  addMessage: (message: InsightsChatMessage) => void;
  updateLastAssistantMessage: (content: string) => void;
  appendStreamingContent: (content: string) => void;
  clearStreamingContent: () => void;
  setCurrentTool: (tool: ToolUsage | null) => void;
  addToolUsage: (tool: ToolUsage) => void;
  clearToolsUsed: () => void;
  addStreamingTasks: (tasks: NonNullable<InsightsChatMessage['suggestedTasks']>) => void;
  finalizeStreamingMessage: () => void;
  clearSession: () => void;
  setLoadingSessions: (loading: boolean) => void;
  setShowArchived: (showArchived: boolean) => void;
  setPendingImages: (images: ImageAttachment[]) => void;
}

const initialStatus: InsightsChatStatus = {
  phase: 'idle',
  message: ''
};

export const useInsightsStore = create<InsightsState>((set, _get) => ({
  // Initial state
  session: null,
  sessions: [],
  status: initialStatus,
  pendingMessage: '',
  streamingContent: '',
  streamingTasks: [],
  currentTool: null,
  toolsUsed: [],
  isLoadingSessions: false,
  showArchived: false,
  pendingImages: [],

  // Actions
  setSession: (session) => set({ session }),

  setSessions: (sessions) => set({ sessions }),

  setStatus: (status) => set({ status }),

  setLoadingSessions: (loading) => set({ isLoadingSessions: loading }),

  setShowArchived: (showArchived) => set({ showArchived }),

  setPendingMessage: (message) => set({ pendingMessage: message }),

  addMessage: (message) =>
    set((state) => {
      if (!state.session) {
        // Create new session if none exists
        return {
          session: {
            id: `session-${Date.now()}`,
            projectId: '',
            messages: [message],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }

      return {
        session: {
          ...state.session,
          messages: [...state.session.messages, message],
          updatedAt: new Date()
        }
      };
    }),

  updateLastAssistantMessage: (content) =>
    set((state) => {
      if (!state.session || state.session.messages.length === 0) return state;

      const messages = [...state.session.messages];
      const lastIndex = messages.length - 1;
      const lastMessage = messages[lastIndex];

      if (lastMessage.role === 'assistant') {
        messages[lastIndex] = { ...lastMessage, content };
      }

      return {
        session: {
          ...state.session,
          messages,
          updatedAt: new Date()
        }
      };
    }),

  appendStreamingContent: (content) =>
    set((state) => ({
      streamingContent: state.streamingContent + content
    })),

  clearStreamingContent: () => set({ streamingContent: '', streamingTasks: [] }),

  setCurrentTool: (tool) => set({ currentTool: tool }),

  addToolUsage: (tool) =>
    set((state) => ({
      toolsUsed: [
        ...state.toolsUsed,
        {
          name: tool.name,
          input: tool.input,
          timestamp: new Date()
        }
      ]
    })),

  clearToolsUsed: () => set({ toolsUsed: [] }),

  addStreamingTasks: (tasks) =>
    set((state) => ({
      streamingTasks: [...state.streamingTasks, ...tasks]
    })),

  finalizeStreamingMessage: () =>
    set((state) => {
      const content = state.streamingContent;
      const toolsUsed = state.toolsUsed.length > 0 ? [...state.toolsUsed] : undefined;
      const suggestedTasks = state.streamingTasks.length > 0 ? [...state.streamingTasks] : undefined;

      if (!content && !suggestedTasks && !toolsUsed) {
        return { streamingContent: '', streamingTasks: [], toolsUsed: [] };
      }

      const newMessage: InsightsChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: new Date(),
        suggestedTasks,
        toolsUsed
      };

      if (!state.session) {
        return {
          streamingContent: '',
          streamingTasks: [],
          toolsUsed: [],
          session: {
            id: `session-${Date.now()}`,
            projectId: '',
            messages: [newMessage],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }

      return {
        streamingContent: '',
        streamingTasks: [],
        toolsUsed: [],
        session: {
          ...state.session,
          messages: [...state.session.messages, newMessage],
          updatedAt: new Date()
        }
      };
    }),

  clearSession: () =>
    set({
      session: null,
      status: initialStatus,
      pendingMessage: '',
      streamingContent: '',
      streamingTasks: [],
      currentTool: null,
      toolsUsed: [],
      pendingImages: []
    }),

  setPendingImages: (images) => set({ pendingImages: images })
}));

// Helper functions

export async function loadInsightsSessions(projectId: string, includeArchived?: boolean): Promise<void> {
  const store = useInsightsStore.getState();
  store.setLoadingSessions(true);

  // Use explicit parameter if provided, otherwise read from store
  const archived = includeArchived ?? store.showArchived;

  try {
    const result = await window.electronAPI.listInsightsSessions(projectId, archived);
    if (result.success && result.data) {
      store.setSessions(result.data);
    } else {
      store.setSessions([]);
    }
  } finally {
    store.setLoadingSessions(false);
  }
}

export async function loadInsightsSession(projectId: string, includeArchived?: boolean): Promise<void> {
  const result = await window.electronAPI.getInsightsSession(projectId);
  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);
  } else {
    useInsightsStore.getState().setSession(null);
  }
  // Also load the sessions list
  await loadInsightsSessions(projectId, includeArchived);
}

export function sendMessage(projectId: string, message: string, modelConfig?: InsightsModelConfig, images?: ImageAttachment[]): void {
  const store = useInsightsStore.getState();
  const session = store.session;

  // Add user message to session (strip data to keep memory usage low)
  const displayImages = images?.map(img => ({
    ...img,
    data: undefined // Strip base64 data, keep thumbnails for display
  }));
  const userMessage: InsightsChatMessage = {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: message,
    timestamp: new Date(),
    ...(displayImages && displayImages.length > 0 ? { images: displayImages } : {})
  };
  store.addMessage(userMessage);

  // Clear pending and set status
  store.setPendingMessage('');
  store.setPendingImages([]);
  store.clearStreamingContent();
  store.clearToolsUsed(); // Clear tools from previous response
  store.setStatus({
    phase: 'thinking',
    message: 'Processing your message...'
  });

  // Use provided modelConfig, or fall back to session's config
  const configToUse = modelConfig || session?.modelConfig;

  // Send to main process
  window.electronAPI.sendInsightsMessage(projectId, message, configToUse, images);
}

export async function clearSession(projectId: string, includeArchived?: boolean): Promise<void> {
  const result = await window.electronAPI.clearInsightsSession(projectId);
  if (result.success) {
    useInsightsStore.getState().clearSession();
    // Reload sessions list and current session
    await loadInsightsSession(projectId, includeArchived);
  }
}

export async function newSession(projectId: string): Promise<void> {
  const result = await window.electronAPI.newInsightsSession(projectId);
  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);
    // Reload sessions list
    await loadInsightsSessions(projectId);
  }
}

export async function switchSession(projectId: string, sessionId: string): Promise<void> {
  const result = await window.electronAPI.switchInsightsSession(projectId, sessionId);
  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);
    // Reset streaming state when switching sessions
    useInsightsStore.getState().clearStreamingContent();
    useInsightsStore.getState().clearToolsUsed();
    useInsightsStore.getState().setCurrentTool(null);
    useInsightsStore.getState().setStatus({ phase: 'idle', message: '' });
  }
}

export async function deleteSession(projectId: string, sessionId: string, includeArchived?: boolean): Promise<boolean> {
  const result = await window.electronAPI.deleteInsightsSession(projectId, sessionId);
  if (result.success) {
    // Reload sessions list and current session
    await loadInsightsSession(projectId, includeArchived);
    return true;
  }
  return false;
}

export async function renameSession(projectId: string, sessionId: string, newTitle: string): Promise<boolean> {
  const result = await window.electronAPI.renameInsightsSession(projectId, sessionId, newTitle);
  if (result.success) {
    // Reload sessions list to reflect the change
    await loadInsightsSessions(projectId);
    return true;
  }
  return false;
}

export async function deleteSessions(projectId: string, sessionIds: string[]): Promise<{ success: boolean; failedIds?: string[] }> {
  const result = await window.electronAPI.deleteInsightsSessions(projectId, sessionIds);
  if (result.success) {
    return { success: true, failedIds: result.data?.failedIds };
  }
  return { success: false, failedIds: result.data?.failedIds };
}

export async function archiveSession(projectId: string, sessionId: string): Promise<boolean> {
  const result = await window.electronAPI.archiveInsightsSession(projectId, sessionId);
  return result.success;
}

export async function archiveSessions(projectId: string, sessionIds: string[]): Promise<{ success: boolean; failedIds?: string[] }> {
  const result = await window.electronAPI.archiveInsightsSessions(projectId, sessionIds);
  if (result.success) {
    return { success: true, failedIds: result.data?.failedIds };
  }
  return { success: false, failedIds: result.data?.failedIds };
}

export async function unarchiveSession(projectId: string, sessionId: string): Promise<boolean> {
  const result = await window.electronAPI.unarchiveInsightsSession(projectId, sessionId);
  return result.success;
}

export async function updateModelConfig(projectId: string, sessionId: string, modelConfig: InsightsModelConfig): Promise<boolean> {
  const result = await window.electronAPI.updateInsightsModelConfig(projectId, sessionId, modelConfig);
  if (result.success) {
    // Update local session state
    const store = useInsightsStore.getState();
    if (store.session?.id === sessionId) {
      store.setSession({
        ...store.session,
        modelConfig,
        updatedAt: new Date()
      });
    }
    // Reload sessions list to reflect the change
    await loadInsightsSessions(projectId);
    return true;
  }
  return false;
}

export async function createTaskFromSuggestion(
  projectId: string,
  title: string,
  description: string,
  metadata?: TaskMetadata
): Promise<Task | null> {
  const result = await window.electronAPI.createTaskFromInsights(
    projectId,
    title,
    description,
    metadata
  );

  if (result.success && result.data) {
    return result.data;
  }
  return null;
}

// IPC listener setup - call this once when the app initializes
export function setupInsightsListeners(): () => void {
  const store = useInsightsStore.getState;

  // Listen for streaming chunks
  const unsubStreamChunk = window.electronAPI.onInsightsStreamChunk(
    (_projectId, chunk: InsightsStreamChunk) => {
      switch (chunk.type) {
        case 'text':
          if (chunk.content) {
            store().appendStreamingContent(chunk.content);
            store().setCurrentTool(null); // Clear tool when receiving text
            store().setStatus({
              phase: 'streaming',
              message: 'Receiving response...'
            });
          }
          break;
        case 'tool_start':
          if (chunk.tool) {
            store().setCurrentTool({
              name: chunk.tool.name,
              input: chunk.tool.input
            });
            // Record this tool usage for history
            store().addToolUsage({
              name: chunk.tool.name,
              input: chunk.tool.input
            });
            store().setStatus({
              phase: 'streaming',
              message: `Using ${chunk.tool.name}...`
            });
          }
          break;
        case 'tool_end':
          store().setCurrentTool(null);
          break;
        case 'task_suggestion':
          // Accumulate task suggestions — they'll be included when 'done' finalizes the message
          store().setCurrentTool(null);
          if (chunk.suggestedTasks) {
            store().addStreamingTasks(chunk.suggestedTasks);
          }
          break;
        case 'done':
          // Finalize any remaining content
          store().setCurrentTool(null);
          store().finalizeStreamingMessage();
          store().setStatus({
            phase: 'complete',
            message: ''
          });
          break;
        case 'error':
          store().setCurrentTool(null);
          store().setStatus({
            phase: 'error',
            error: chunk.error
          });
          break;
      }
    }
  );

  // Listen for status updates
  const unsubStatus = window.electronAPI.onInsightsStatus((_projectId, status) => {
    store().setStatus(status);
  });

  // Listen for errors
  const unsubError = window.electronAPI.onInsightsError((_projectId, error) => {
    store().setStatus({
      phase: 'error',
      error
    });
  });

  // Listen for session updates (e.g., after assistant message saved with auto-generated title)
  const unsubSessionUpdated = window.electronAPI.onInsightsSessionUpdated(
    (_projectId, session: InsightsSession) => {
      // Update current session if it matches
      const currentSession = store().session;
      if (currentSession?.id === session.id) {
        store().setSession(session);
      }
      // Also refresh sessions list for sidebar
      loadInsightsSessions(session.projectId).catch((err) => {
        console.error('Failed to refresh sessions list after update:', err);
      });
    }
  );

  // Return cleanup function
  return () => {
    unsubStreamChunk();
    unsubStatus();
    unsubError();
    unsubSessionUpdated();
  };
}
