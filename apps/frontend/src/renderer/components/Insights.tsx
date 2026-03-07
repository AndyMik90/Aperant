import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Send,
  Loader2,
  Plus,
  Sparkles,
  User,
  Bot,
  CheckCircle2,
  AlertCircle,
  Search,
  FileText,
  FolderSearch,
  PanelLeftClose,
  PanelLeft,
  Camera,
  X
} from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { ScrollArea } from './ui/scroll-area';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { ScreenshotCapture } from './ScreenshotCapture';
import { cn } from '../lib/utils';
import {
  useInsightsStore,
  loadInsightsSession,
  sendMessage,
  newSession,
  switchSession,
  deleteSession,
  deleteSessions,
  renameSession,
  archiveSession,
  archiveSessions,
  unarchiveSession,
  updateModelConfig,
  createTaskFromSuggestion,
  setupInsightsListeners,
  loadInsightsSessions
} from '../stores/insights-store';
import { useImageUpload } from './task-form/useImageUpload';
import { createThumbnail, generateImageId } from './ImageUpload';
import { loadTasks } from '../stores/task-store';
import { ChatHistorySidebar } from './ChatHistorySidebar';
import { InsightsModelSelector } from './InsightsModelSelector';
import type { InsightsChatMessage, InsightsModelConfig, TaskMetadata, ImageAttachment } from '../../shared/types';
import {
  TASK_CATEGORY_LABELS,
  TASK_CATEGORY_COLORS,
  TASK_COMPLEXITY_LABELS,
  TASK_COMPLEXITY_COLORS,
  MAX_IMAGE_SIZE,
  MAX_IMAGES_PER_TASK
} from '../../shared/constants';

// createSafeLink - factory function that creates a SafeLink component with i18n support
const createSafeLink = (opensInNewWindowText: string) => {
  return function SafeLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    // Validate URL - only allow http, https, and relative links
    const isValidUrl = href && (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('/') ||
      href.startsWith('#')
    );

    if (!isValidUrl) {
      // For invalid or potentially malicious URLs, render as plain text
      return <span className="text-muted-foreground">{children}</span>;
    }

    // External links get security attributes and accessibility indicator
    const isExternal = href?.startsWith('http://') || href?.startsWith('https://');

    return (
      <a
        href={href}
        {...props}
        {...(isExternal && {
          target: '_blank',
          rel: 'noopener noreferrer',
        })}
        className="text-primary hover:underline"
      >
        {children}
        {isExternal && <span className="sr-only"> {opensInNewWindowText}</span>}
      </a>
    );
  };
};

interface InsightsProps {
  projectId: string;
}

export function Insights({ projectId }: InsightsProps) {
  const { t } = useTranslation('common');
  const session = useInsightsStore((state) => state.session);
  const sessions = useInsightsStore((state) => state.sessions);
  const status = useInsightsStore((state) => state.status);
  const streamingContent = useInsightsStore((state) => state.streamingContent);
  const currentTool = useInsightsStore((state) => state.currentTool);
  const isLoadingSessions = useInsightsStore((state) => state.isLoadingSessions);

  // Create markdown components with translated accessibility text
  const markdownComponents = useMemo(() => ({
    a: createSafeLink(t('accessibility.opensInNewWindow')),
  }), [t]);

  const [inputValue, setInputValue] = useState('');
  const [creatingTask, setCreatingTask] = useState<Set<string>>(new Set());
  const [taskCreated, setTaskCreated] = useState<Set<string>>(new Set());
  const [showSidebar, setShowSidebar] = useState(true);
  const showArchived = useInsightsStore((state) => state.showArchived);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
  const [screenshotOpen, setScreenshotOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const pendingImages = useInsightsStore((state) => state.pendingImages);
  const setPendingImages = useInsightsStore((state) => state.setPendingImages);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isLoading = status.phase === 'thinking' || status.phase === 'streaming';

  // Image upload hook
  const {
    isDragOver,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeImage,
    canAddMore
  } = useImageUpload({
    images: pendingImages,
    onImagesChange: setPendingImages,
    disabled: isLoading,
    onError: setImageError,
    errorMessages: {
      maxImagesReached: t('insights.images.maxImagesReached'),
      invalidImageType: t('insights.images.invalidType'),
      processPasteFailed: t('insights.images.processFailed'),
      processDropFailed: t('insights.images.processFailed')
    }
  });

  // Scroll threshold in pixels - user is considered "at bottom" if within this distance
  const SCROLL_BOTTOM_THRESHOLD = 100;

  // Check if user is near the bottom of scroll area
  const checkIfAtBottom = useCallback((viewport: HTMLElement) => {
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    return scrollHeight - scrollTop - clientHeight <= SCROLL_BOTTOM_THRESHOLD;
  }, []);

  // Handle scroll events to track user position
  const handleScroll = useCallback(() => {
    if (viewportEl) {
      setIsUserAtBottom(checkIfAtBottom(viewportEl));
    }
  }, [viewportEl, checkIfAtBottom]);

  // Set up scroll listener and check initial position when viewport becomes available
  useEffect(() => {
    if (viewportEl) {
      // Check initial scroll position
      setIsUserAtBottom(checkIfAtBottom(viewportEl));
      viewportEl.addEventListener('scroll', handleScroll, { passive: true });
      return () => viewportEl.removeEventListener('scroll', handleScroll);
    }
  }, [viewportEl, handleScroll, checkIfAtBottom]);

  // Load session and set up listeners on mount
  useEffect(() => {
    loadInsightsSession(projectId, showArchived);
    const cleanup = setupInsightsListeners();
    return cleanup;
  // biome-ignore lint/correctness/useExhaustiveDependencies: showArchived is handled by the dedicated effect below; including it here would cause duplicate loads
  }, [projectId]);

  // Reload sessions when showArchived changes (skip first run to avoid duplicate load with mount effect)
  const isFirstRun = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: projectId changes are handled by the mount effect above; this effect only reacts to showArchived toggles
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    loadInsightsSessions(projectId, showArchived);
  }, [showArchived]);

  // Smart auto-scroll: only scroll if user is already at bottom
  // This allows users to scroll up to read previous messages without being
  // yanked back down during streaming responses
  useEffect(() => {
    if (isUserAtBottom && viewportEl) {
      viewportEl.scrollTop = viewportEl.scrollHeight;
    }
  }, [isUserAtBottom, viewportEl]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Reset task creation state when switching sessions
  // biome-ignore lint/correctness/useExhaustiveDependencies: session?.id is intentionally used as a trigger
  useEffect(() => {
    setTaskCreated(new Set());
    setCreatingTask(new Set());
  }, [session?.id]);

  const handleSend = () => {
    const message = inputValue.trim();
    const hasImages = pendingImages.length > 0;
    if ((!message && !hasImages) || isLoading) return;

    setInputValue('');
    sendMessage(projectId, message, session?.modelConfig, hasImages ? pendingImages : undefined);
    setPendingImages([]);
    setImageError(null);
    setIsUserAtBottom(true); // Resume auto-scroll when user sends a message
  };

  const handleScreenshotCapture = useCallback(async (imageData: string) => {
    // Check image count limit before processing
    if (pendingImages.length >= MAX_IMAGES_PER_TASK) {
      setImageError(t('insights.images.maxImagesReached'));
      return;
    }

    // imageData is base64 PNG from ScreenshotCapture
    const approximateSize = Math.ceil(imageData.length * 0.75); // approximate base64 size

    // Validate size - match the validation used for regular image uploads
    if (approximateSize > MAX_IMAGE_SIZE) {
      setImageError(t('insights.images.screenshotTooLarge', { size: Math.round(approximateSize / 1024 / 1024), max: Math.round(MAX_IMAGE_SIZE / 1024 / 1024) }));
      return;
    }

    const dataUrl = `data:image/png;base64,${imageData}`;
    const thumbnail = await createThumbnail(dataUrl);
    const newImage: ImageAttachment = {
      id: generateImageId(),
      filename: `screenshot-${Date.now()}.png`,
      mimeType: 'image/png',
      size: approximateSize,
      data: imageData,
      thumbnail
    };
    setPendingImages([...pendingImages, newImage]);
    setImageError(null);
  }, [pendingImages, setPendingImages, setImageError, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewSession = async () => {
    await newSession(projectId);
    setTaskCreated(new Set());
    textareaRef.current?.focus();
  };

  const handleSelectSession = async (sessionId: string) => {
    if (sessionId !== session?.id) {
      await switchSession(projectId, sessionId);
    }
  };

  const handleDeleteSession = async (sessionId: string): Promise<boolean> => {
    return await deleteSession(projectId, sessionId, showArchived);
  };

  const handleRenameSession = async (sessionId: string, newTitle: string): Promise<boolean> => {
    return await renameSession(projectId, sessionId, newTitle);
  };

  const handleArchiveSession = async (sessionId: string) => {
    try {
      await archiveSession(projectId, sessionId);
      await loadInsightsSessions(projectId, showArchived);
      // Reload current session in case backend switched to a different one
      await loadInsightsSession(projectId, showArchived);
    } catch (error) {
      console.error(`Failed to archive session ${sessionId}:`, error);
    }
  };

  const handleUnarchiveSession = async (sessionId: string) => {
    try {
      await unarchiveSession(projectId, sessionId);
      await loadInsightsSessions(projectId, showArchived);
      // Reload current session in case backend switched to a different one
      await loadInsightsSession(projectId, showArchived);
    } catch (error) {
      console.error(`Failed to unarchive session ${sessionId}:`, error);
    }
  };

  const handleDeleteSessions = async (sessionIds: string[]) => {
    try {
      const result = await deleteSessions(projectId, sessionIds);
      await loadInsightsSessions(projectId, showArchived);
      // Reload current session in case backend switched to a different one
      await loadInsightsSession(projectId, showArchived);

      // Log partial failures for debugging
      if (result.failedIds && result.failedIds.length > 0) {
        console.warn(`Failed to delete ${result.failedIds.length} session(s):`, result.failedIds);
      }
    } catch (error) {
      console.error(`Failed to delete sessions ${sessionIds.join(', ')}:`, error);
    }
  };

  const handleArchiveSessions = async (sessionIds: string[]) => {
    try {
      const result = await archiveSessions(projectId, sessionIds);
      await loadInsightsSessions(projectId, showArchived);
      // Reload current session in case backend switched to a different one
      await loadInsightsSession(projectId, showArchived);

      // Log partial failures for debugging
      if (result.failedIds && result.failedIds.length > 0) {
        console.warn(`Failed to archive ${result.failedIds.length} session(s):`, result.failedIds);
      }
    } catch (error) {
      console.error(`Failed to archive sessions ${sessionIds.join(', ')}:`, error);
    }
  };

  const handleToggleShowArchived = () => {
    useInsightsStore.getState().setShowArchived(!showArchived);
  };

  const handleCreateTask = async (
    messageId: string,
    taskIndex: number,
    taskData: { title: string; description: string; metadata?: TaskMetadata }
  ) => {
    const taskKey = `${messageId}-${taskIndex}`;
    setCreatingTask(prev => new Set(prev).add(taskKey));
    try {
      const task = await createTaskFromSuggestion(
        projectId,
        taskData.title,
        taskData.description,
        taskData.metadata
      );

      if (task) {
        setTaskCreated(prev => new Set(prev).add(taskKey));
        // Reload tasks to show the new task in the kanban
        loadTasks(projectId);
      }
    } finally {
      setCreatingTask(prev => {
        const next = new Set(prev);
        next.delete(taskKey);
        return next;
      });
    }
  };

  const handleModelConfigChange = async (config: InsightsModelConfig) => {
    // If we have a session, persist the config
    if (session?.id) {
      await updateModelConfig(projectId, session.id, config);
    }
  };

  const messages = session?.messages || [];

  return (
    <div className="flex h-full">
      {/* Chat History Sidebar */}
      {showSidebar && (
        <ChatHistorySidebar
          sessions={sessions}
          currentSessionId={session?.id || null}
          isLoading={isLoadingSessions}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onArchiveSession={handleArchiveSession}
          onUnarchiveSession={handleUnarchiveSession}
          onDeleteSessions={handleDeleteSessions}
          onArchiveSessions={handleArchiveSessions}
          showArchived={showArchived}
          onToggleShowArchived={handleToggleShowArchived}
        />
      )}

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowSidebar(!showSidebar)}
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            >
              {showSidebar ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Insights</h2>
              <p className="text-sm text-muted-foreground">
                Ask questions about your codebase
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <InsightsModelSelector
              currentConfig={session?.modelConfig}
              onConfigChange={handleModelConfigChange}
              disabled={isLoading}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewSession}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Chat
            </Button>
          </div>
        </div>

      {/* Messages */}
      <ScrollArea
        className="flex-1 px-6 py-4"
        onViewportRef={setViewportEl}
      >
        {messages.length === 0 && !streamingContent ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-foreground">
              Start a Conversation
            </h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Ask questions about your codebase, get suggestions for improvements,
              or discuss features you'd like to implement.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                'What is the architecture of this project?',
                'Suggest improvements for code quality',
                'What features could I add next?',
                'Are there any security concerns?'
              ].map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setInputValue(suggestion);
                    textareaRef.current?.focus();
                  }}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                markdownComponents={markdownComponents}
                onCreateTask={handleCreateTask}
                creatingTask={creatingTask}
                taskCreated={taskCreated}
              />
            ))}

            {/* Streaming message */}
            {(streamingContent || currentTool) && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 text-sm font-medium text-foreground">
                    Assistant
                  </div>
                  {streamingContent && (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {streamingContent}
                      </ReactMarkdown>
                    </div>
                  )}
                  {/* Tool usage indicator */}
                  {currentTool && (
                    <ToolIndicator name={currentTool.name} input={currentTool.input} />
                  )}
                </div>
              </div>
            )}

            {/* Thinking indicator */}
            {status.phase === 'thinking' && !streamingContent && !currentTool && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking...
                </div>
              </div>
            )}

            {/* Error message */}
            {status.phase === 'error' && status.error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {status.error}
              </div>
            )}

          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border p-4">
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              placeholder="Ask about your codebase..."
              className={cn(
                'min-h-[80px] resize-none',
                isDragOver && 'border-primary ring-2 ring-primary/20'
              )}
              disabled={isLoading}
            />
            {/* Drag-over overlay */}
            {isDragOver && (
              <div className="absolute inset-0 flex items-center justify-center rounded-md bg-primary/5 border-2 border-dashed border-primary pointer-events-none">
                <span className="text-sm font-medium text-primary">
                  {t('insights.images.dragOver')}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1 self-end">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setScreenshotOpen(true)}
              disabled={isLoading || !canAddMore}
              title={t('insights.images.screenshotButton')}
            >
              <Camera className="h-4 w-4" />
            </Button>
            <Button
              onClick={handleSend}
              disabled={(!inputValue.trim() && pendingImages.length === 0) || isLoading}
              className="h-9 w-9"
              size="icon"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Image analysis warning */}
        {pendingImages.length > 0 && (
          <div className="mt-1 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-500">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span>{t('insights.images.analysisUnsupported')}</span>
          </div>
        )}

        {/* Image error */}
        {imageError && (
          <p className="mt-1 text-xs text-destructive">{imageError}</p>
        )}

        {/* Image preview strip */}
        {pendingImages.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {pendingImages.map((image) => (
              <div
                key={image.id}
                className="group relative h-16 w-16 rounded-md border border-border overflow-hidden"
              >
                <img
                  src={image.thumbnail || `data:${image.mimeType};base64,${image.data}`}
                  alt={image.filename}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(image.id)}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  title={t('insights.images.removeImage')}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <span className="text-xs text-muted-foreground">
              {t('insights.images.imageCount', { count: pendingImages.length })}
            </span>
          </div>
        )}

        <p className="mt-2 text-xs text-muted-foreground">
          {t('insights.images.pasteHint')} · Press Enter to send, Shift+Enter for new line
        </p>
      </div>

      {/* Screenshot capture dialog */}
      <ScreenshotCapture
        open={screenshotOpen}
        onOpenChange={setScreenshotOpen}
        onCapture={handleScreenshotCapture}
      />
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: InsightsChatMessage;
  markdownComponents: Components;
  onCreateTask: (messageId: string, taskIndex: number, taskData: { title: string; description: string; metadata?: TaskMetadata }) => void;
  creatingTask: Set<string>;
  taskCreated: Set<string>;
}

function MessageBubble({
  message,
  markdownComponents,
  onCreateTask,
  creatingTask,
  taskCreated
}: MessageBubbleProps) {
  const { t } = useTranslation('common');
  const isUser = message.role === 'user';

  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-muted' : 'bg-primary/10'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className="flex-1 space-y-2">
        <div className="text-sm font-medium text-foreground">
          {isUser ? 'You' : 'Assistant'}
        </div>
        {message.content && (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Image attachments for user messages */}
        {isUser && message.images && message.images.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-2">
              {message.images
                .filter(img => img.thumbnail || img.data)
                .map((image) => (
                  <img
                    key={image.id}
                    src={image.thumbnail || `data:${image.mimeType};base64,${image.data}`}
                    alt={image.filename}
                    className="max-w-[200px] max-h-[200px] rounded-md border border-border object-contain"
                  />
                ))}
            </div>
            <p className="text-xs text-muted-foreground italic">{t('insights.images.notAnalyzed')}</p>
          </div>
        )}

        {/* Tool usage history for assistant messages */}
        {!isUser && message.toolsUsed && message.toolsUsed.length > 0 && (
          <ToolUsageHistory tools={message.toolsUsed} />
        )}

        {/* Task suggestion cards */}
        {message.suggestedTasks && message.suggestedTasks.length > 0 && (
          <div className="mt-3 space-y-3">
            {message.suggestedTasks.map((task, index) => {
              const taskKey = `${message.id}-${index}`;
              const isCreating = creatingTask.has(taskKey);
              const isCreated = taskCreated.has(taskKey);

              return (
                <Card key={taskKey} className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium text-primary">
                        {t('insights.suggestedTask')}
                      </span>
                    </div>
                    <h4 className="mb-2 font-medium text-foreground">
                      {task.title}
                    </h4>
                    <p className="mb-3 text-sm text-muted-foreground">
                      {task.description}
                    </p>
                    {task.metadata && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {task.metadata.category && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-xs',
                              TASK_CATEGORY_COLORS[task.metadata.category]
                            )}
                          >
                            {TASK_CATEGORY_LABELS[task.metadata.category] ||
                              task.metadata.category}
                          </Badge>
                        )}
                        {task.metadata.complexity && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-xs',
                              TASK_COMPLEXITY_COLORS[task.metadata.complexity]
                            )}
                          >
                            {TASK_COMPLEXITY_LABELS[task.metadata.complexity] ||
                              task.metadata.complexity}
                          </Badge>
                        )}
                      </div>
                    )}
                    <Button
                      size="sm"
                      onClick={() => onCreateTask(message.id, index, task)}
                      disabled={isCreating || isCreated}
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('insights.creating')}
                        </>
                      ) : isCreated ? (
                        <>
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          {t('insights.taskCreated')}
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          {t('insights.createTask')}
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Tool usage history component for showing tools used in completed messages
interface ToolUsageHistoryProps {
  tools: Array<{
    name: string;
    input?: string;
    timestamp: Date;
  }>;
}

function ToolUsageHistory({ tools }: ToolUsageHistoryProps) {
  const [expanded, setExpanded] = useState(false);

  if (tools.length === 0) return null;

  // Group tools by name for summary
  const toolCounts = tools.reduce((acc, tool) => {
    acc[tool.name] = (acc[tool.name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'Read':
        return FileText;
      case 'Glob':
        return FolderSearch;
      case 'Grep':
        return Search;
      default:
        return FileText;
    }
  };

  const getToolColor = (toolName: string) => {
    switch (toolName) {
      case 'Read':
        return 'text-blue-500';
      case 'Glob':
        return 'text-amber-500';
      case 'Grep':
        return 'text-green-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1">
          {Object.entries(toolCounts).map(([name, count]) => {
            const Icon = getToolIcon(name);
            return (
              <span key={name} className={cn('flex items-center gap-0.5', getToolColor(name))}>
                <Icon className="h-3 w-3" />
                <span>{count}</span>
              </span>
            );
          })}
        </span>
        <span>{tools.length} tool{tools.length !== 1 ? 's' : ''} used</span>
        <span className="text-[10px]">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1 rounded-md border border-border bg-muted/30 p-2">
          {tools.map((tool, index) => {
            const Icon = getToolIcon(tool.name);
            return (
              <div
                key={`${tool.name}-${index}`}
                className="flex items-center gap-2 text-xs"
              >
                <Icon className={cn('h-3 w-3 shrink-0', getToolColor(tool.name))} />
                <span className="font-medium">{tool.name}</span>
                {tool.input && (
                  <span className="text-muted-foreground truncate max-w-[250px]">
                    {tool.input}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Tool indicator component for showing what the AI is currently doing
interface ToolIndicatorProps {
  name: string;
  input?: string;
}

function ToolIndicator({ name, input }: ToolIndicatorProps) {
  // Get friendly name and icon for each tool
  const getToolInfo = (toolName: string) => {
    switch (toolName) {
      case 'Read':
        return {
          icon: FileText,
          label: 'Reading file',
          color: 'text-blue-500 bg-blue-500/10'
        };
      case 'Glob':
        return {
          icon: FolderSearch,
          label: 'Searching files',
          color: 'text-amber-500 bg-amber-500/10'
        };
      case 'Grep':
        return {
          icon: Search,
          label: 'Searching code',
          color: 'text-green-500 bg-green-500/10'
        };
      default:
        return {
          icon: Loader2,
          label: toolName,
          color: 'text-primary bg-primary/10'
        };
    }
  };

  const { icon: Icon, label, color } = getToolInfo(name);

  return (
    <div className={cn(
      'mt-2 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
      color
    )}>
      <Icon className="h-4 w-4 animate-pulse" />
      <span className="font-medium">{label}</span>
      {input && (
        <span className="text-muted-foreground truncate max-w-[300px]">
          {input}
        </span>
      )}
    </div>
  );
}
