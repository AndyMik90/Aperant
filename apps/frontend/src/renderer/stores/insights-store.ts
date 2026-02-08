import { create } from 'zustand';
import { useInsightsTaskQueueStore } from './insights-task-queue-store';
import type {
  InsightsSession,
  InsightsSessionSummary,
  InsightsChatMessage,
  InsightsChatStatus,
  InsightsStreamChunk,
  InsightsToolUsage,
  InsightsModelConfig,
  TaskMetadata,
  Task
} from '../../shared/types';

interface ToolUsage {
  name: string;
  input?: string;
}

// Counter for generating unique IDs within the same millisecond
let messageIdCounter = 0;

/**
 * Generate a unique message ID using timestamp and counter.
 * This ensures unique IDs even when multiple messages are created
 * in quick succession (e.g., multi-task creation from chat).
 */
function generateUniqueMessageId(): string {
  const timestamp = Date.now();
  const counter = messageIdCounter++;
  return `msg-${timestamp}-${counter}`;
}

/**
 * Generate a unique session ID
 */
function generateUniqueSessionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `session-${timestamp}-${random}`;
}

interface InsightsState {
  // Data
  session: InsightsSession | null;
  sessions: InsightsSessionSummary[]; // List of all sessions
  status: InsightsChatStatus;
  pendingMessage: string;
  streamingContent: string; // Accumulates streaming response
  currentTool: ToolUsage | null; // Currently executing tool
  toolsUsed: InsightsToolUsage[]; // Tools used during current response
  streamingStartTime: number | null; // When first streaming chunk arrived
  responseDuration: number | null; // Total response time in ms (set on completion)
  isLoadingSessions: boolean;

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
  finalizeStreamingMessage: (suggestedTask?: InsightsChatMessage['suggestedTask']) => void;
  clearSession: () => void;
  setLoadingSessions: (loading: boolean) => void;
  markTaskCreated: (messageId: string, taskId: string) => void;
  cancelGeneration: (projectId: string) => Promise<void>;
}

const initialStatus: InsightsChatStatus = {
  phase: 'idle',
  message: ''
};

export const useInsightsStore = create<InsightsState>((set, get) => ({
  // Initial state
  session: null,
  sessions: [],
  status: initialStatus,
  pendingMessage: '',
  streamingContent: '',
  currentTool: null,
  toolsUsed: [],
  streamingStartTime: null,
  responseDuration: null,
  isLoadingSessions: false,

  // Actions
  setSession: (session) => set({ session }),

  setSessions: (sessions) => set({ sessions }),

  setStatus: (status) => set({ status }),

  setLoadingSessions: (loading) => set({ isLoadingSessions: loading }),

  setPendingMessage: (message) => set({ pendingMessage: message }),

  addMessage: (message) =>
    set((state) => {
      // Ensure message has a unique ID
      const messageWithId = message.id ? message : { ...message, id: generateUniqueMessageId() };

      if (!state.session) {
        // Create new session if none exists
        return {
          session: {
            id: generateUniqueSessionId(),
            projectId: '',
            messages: [messageWithId],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }

      // Append to existing messages (never replace)
      return {
        session: {
          ...state.session,
          messages: [...state.session.messages, messageWithId],
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
      streamingContent: state.streamingContent + content,
      streamingStartTime: state.streamingStartTime ?? Date.now(),
    })),

  clearStreamingContent: () => set({ streamingContent: '', streamingStartTime: null }),

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

  finalizeStreamingMessage: (suggestedTask) =>
    set((state) => {
      const content = state.streamingContent;
      const toolsUsed = state.toolsUsed.length > 0 ? [...state.toolsUsed] : undefined;
      const duration = state.streamingStartTime ? Date.now() - state.streamingStartTime : null;

      if (!content && !suggestedTask && !toolsUsed) {
        return { streamingContent: '', toolsUsed: [], streamingStartTime: null, responseDuration: duration };
      }

      // Generate unique ID for each message to prevent duplicates
      const newMessage: InsightsChatMessage = {
        id: generateUniqueMessageId(),
        role: 'assistant',
        content,
        timestamp: new Date(),
        suggestedTask,
        toolsUsed
      };

      if (!state.session) {
        return {
          streamingContent: '',
          toolsUsed: [],
          streamingStartTime: null,
          responseDuration: duration,
          session: {
            id: generateUniqueSessionId(),
            projectId: '',
            messages: [newMessage],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }

      // Always append messages, never replace existing ones
      return {
        streamingContent: '',
        toolsUsed: [],
        streamingStartTime: null,
        responseDuration: duration,
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
      currentTool: null,
      toolsUsed: []
    }),

  markTaskCreated: (messageId, taskId) =>
    set((state) => {
      if (!state.session) return state;

      const messages = state.session.messages.map(msg =>
        msg.id === messageId ? { ...msg, taskCreatedId: taskId } : msg
      );

      return {
        session: {
          ...state.session,
          messages,
          updatedAt: new Date()
        }
      };
    }),

  cancelGeneration: async (projectId: string) => {
    try {
      // Save whatever Jerry has said so far before clearing
      const state = get();
      if (state.streamingContent.trim()) {
        state.finalizeStreamingMessage();
      }

      // Reset UI state synchronously BEFORE the async IPC call.
      // This prevents a race when the user sends a new message immediately
      // after cancel — sendMessage sets status='thinking', and we don't want
      // a late-arriving set({ status: 'idle' }) to overwrite it.
      set({
        status: { phase: 'idle', message: '' },
        currentTool: null,
        streamingStartTime: null,
        responseDuration: null
      });

      // Kill the backend process
      await window.electronAPI.cancelInsights(projectId);
    } catch (error) {
      console.error('[Insights] Failed to cancel generation:', error);
    }
  }
}));

/**
 * Mark a message's task as created (persists to disk)
 */
export async function markTaskCreatedPersistent(
  projectId: string,
  sessionId: string,
  messageId: string,
  taskId: string
): Promise<boolean> {
  // Update local store immediately for UI responsiveness
  useInsightsStore.getState().markTaskCreated(messageId, taskId);

  // Persist to disk via IPC
  const result = await window.electronAPI.markInsightsTaskCreated(
    projectId,
    sessionId,
    messageId,
    taskId
  );

  return result.success;
}

// Helper functions

export async function loadInsightsSessions(projectId: string): Promise<void> {
  const store = useInsightsStore.getState();
  store.setLoadingSessions(true);

  try {
    const result = await window.electronAPI.listInsightsSessions(projectId);
    if (result.success && result.data) {
      store.setSessions(result.data);
    } else {
      store.setSessions([]);
    }
  } finally {
    store.setLoadingSessions(false);
  }
}

export async function loadInsightsSession(projectId: string): Promise<void> {
  const result = await window.electronAPI.getInsightsSession(projectId);
  if (result.success && result.data) {
    // Cross-reference messages with queue store to restore "Added to Queue" state
    // This handles cases where backend persist failed (e.g., message ID mismatch)
    const queueTasks = useInsightsTaskQueueStore.getState().tasks;
    if (queueTasks.length > 0) {
      const queueTitles = new Set(queueTasks.map(t => t.title));
      for (const msg of result.data.messages) {
        if (msg.suggestedTask && !msg.taskCreatedId && queueTitles.has(msg.suggestedTask.title)) {
          msg.taskCreatedId = 'queued';
        }
      }
    }
    useInsightsStore.getState().setSession(result.data);
  } else {
    useInsightsStore.getState().setSession(null);
  }
  // Also load the sessions list
  await loadInsightsSessions(projectId);
}

export function sendMessage(
  projectId: string,
  message: string,
  modelConfig?: InsightsModelConfig,
  attachments?: Array<{ id: string; name: string; path: string; type: 'image' | 'text'; size: number; data?: string }>
): void {
  const store = useInsightsStore.getState();
  const session = store.session;

  // Add user message to session with unique ID
  const userMessage: InsightsChatMessage = {
    id: generateUniqueMessageId(),
    role: 'user',
    content: message,
    timestamp: new Date()
  };
  store.addMessage(userMessage);

  // Clear pending and set status
  store.setPendingMessage('');
  store.clearStreamingContent();
  store.clearToolsUsed(); // Clear tools from previous response
  store.setStatus({
    phase: 'thinking',
    message: 'Processing your message...'
  });

  // Use provided modelConfig, or fall back to session's config
  const configToUse = modelConfig || session?.modelConfig;

  // Send to main process (with attachments support for future backend implementation)
  window.electronAPI.sendInsightsMessage(projectId, message, configToUse, attachments);
}

export async function clearSession(projectId: string): Promise<void> {
  const result = await window.electronAPI.clearInsightsSession(projectId);
  if (result.success) {
    useInsightsStore.getState().clearSession();
    // Reload sessions list and current session
    await loadInsightsSession(projectId);
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

export async function deleteSession(projectId: string, sessionId: string): Promise<boolean> {
  const result = await window.electronAPI.deleteInsightsSession(projectId, sessionId);
  if (result.success) {
    const currentSession = useInsightsStore.getState().session;
    if (currentSession?.id === sessionId) {
      // Deleted the active session — reload current session (backend picks the next one)
      await loadInsightsSession(projectId);
    } else {
      // Deleted a different session — only refresh the sidebar list, don't touch
      // the active session (which may have in-progress streaming content)
      await loadInsightsSessions(projectId);
    }
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
  // Instead of creating task immediately, add it to the sidebar queue
  const queuedTaskId = useInsightsTaskQueueStore.getState().addTask({
    title,
    description,
    metadata: {
      category: metadata?.category,
      complexity: metadata?.complexity,
      priority: metadata?.priority,
      dependencies: metadata?.dependencies,
    },
  });

  console.log('[Insights] Task added to sidebar queue:', queuedTaskId);

  // Return null since task isn't created yet (it's queued)
  // The sidebar will handle actual task creation when user clicks Start
  return null;
}

// IPC listener setup - call this once when the app initializes
export function setupInsightsListeners(): () => void {
  const store = useInsightsStore.getState;

  // Listen for streaming chunks
  const unsubStreamChunk = window.electronAPI.onInsightsStreamChunk(
    (projectId, chunk: InsightsStreamChunk) => {
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
          // Finalize the message with task suggestion
          store().setCurrentTool(null);
          store().finalizeStreamingMessage(chunk.suggestedTask);
          break;
        case 'done':
          // Finalize any remaining content
          store().setCurrentTool(null);
          store().finalizeStreamingMessage();
          store().setStatus({
            phase: 'complete',
            message: ''
          });
          // Refresh sessions list so Chat History sidebar updates
          loadInsightsSessions(projectId);
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

  // Return cleanup function
  return () => {
    unsubStreamChunk();
    unsubStatus();
    unsubError();
  };
}
