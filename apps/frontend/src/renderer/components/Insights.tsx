import { useState, useEffect, useRef, useMemo, useLayoutEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Loader2,
  Plus,
  Sparkles,
  Bot,
  CheckCircle2,
  AlertCircle,
  PanelLeftClose,
  PanelLeft,
  Pencil
} from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import {
  useInsightsStore,
  loadInsightsSession,
  sendMessage,
  newSession,
  switchSession,
  deleteSession,
  renameSession,
  updateModelConfig,
  createTaskFromSuggestion,
  setupInsightsListeners,
  markTaskCreatedPersistent
} from '../stores/insights-store';
import { useInsightsTaskQueueStore } from '../stores/insights-task-queue-store';
import { ChatHistorySidebar } from './ChatHistorySidebar';
import { InsightsModelSelector } from './InsightsModelSelector';
import { TaskQueueSidebar } from './insights/TaskQueueSidebar';
import { ChatInput } from './insights/ChatInput';
import { ResizeHandle } from './insights/ResizeHandle';
import { useNavigation } from '../contexts/NavigationContext';
import { ToolBlock } from './chat';
import type { ToolData, PastedImage } from './chat';
import type { InsightsChatMessage, InsightsModelConfig } from '../../shared/types';
import {
  TASK_CATEGORY_LABELS,
  TASK_CATEGORY_COLORS,
  TASK_COMPLEXITY_LABELS,
  TASK_COMPLEXITY_COLORS
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
  const { setActiveView } = useNavigation();
  const session = useInsightsStore((state) => state.session);
  const sessions = useInsightsStore((state) => state.sessions);
  const status = useInsightsStore((state) => state.status);
  const streamingContent = useInsightsStore((state) => state.streamingContent);
  const currentTool = useInsightsStore((state) => state.currentTool);
  const isLoadingSessions = useInsightsStore((state) => state.isLoadingSessions);
  const responseDuration = useInsightsStore((state) => state.responseDuration);

  // Create markdown components with translated accessibility text
  const markdownComponents = useMemo(() => ({
    a: createSafeLink(t('accessibility.opensInNewWindow')),
  }), [t]);

  const [inputValue, setInputValue] = useState('');
  const [creatingTask, setCreatingTask] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(256); // Chat History width
  const [rightSidebarWidth, setRightSidebarWidth] = useState(280); // Task Queue width

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const leftSidebarStartWidth = useRef(256);
  const rightSidebarStartWidth = useRef(280);
  const lastScrollTime = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevMessageCount = useRef(0);

  // Load sidebar widths from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('insights-sidebar-widths');
      if (stored) {
        const widths = JSON.parse(stored);
        if (typeof widths.left === 'number') {
          const clampedLeft = Math.min(Math.max(widths.left, 200), Math.floor(window.innerWidth * 0.5));
          setLeftSidebarWidth(clampedLeft);
          leftSidebarStartWidth.current = clampedLeft;
        }
        if (typeof widths.right === 'number') {
          const clampedRight = Math.min(Math.max(widths.right, 48), Math.floor(window.innerWidth * 0.5));
          setRightSidebarWidth(clampedRight);
          rightSidebarStartWidth.current = clampedRight;
        }
      }
    } catch (error) {
      console.error('[Insights] Failed to load sidebar widths from localStorage:', error);
    }
  }, []);

  // Save sidebar widths to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('insights-sidebar-widths', JSON.stringify({
        left: leftSidebarWidth,
        right: rightSidebarWidth
      }));
    } catch (error) {
      console.error('[Insights] Failed to save sidebar widths to localStorage:', error);
    }
  }, [leftSidebarWidth, rightSidebarWidth]);

  // Load session and set up listeners on mount
  useEffect(() => {
    loadInsightsSession(projectId);
    const cleanup = setupInsightsListeners();
    return cleanup;
  }, [projectId]);

  // Auto-scroll to bottom — only for NEW messages or streaming, not message updates.
  // This prevents unwanted scrolling when clicking "Add to Queue" on older messages.
  useEffect(() => {
    const currentCount = session?.messages?.length || 0;
    const isNewMessage = currentCount > prevMessageCount.current;
    prevMessageCount.current = currentCount;

    // Only scroll when a new message arrives or streaming content is active
    if (isNewMessage || streamingContent) {
      const now = Date.now();
      const THROTTLE_MS = 100;

      if (now - lastScrollTime.current >= THROTTLE_MS) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
        lastScrollTime.current = now;
      } else {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
          lastScrollTime.current = Date.now();
        }, THROTTLE_MS);
      }
    }
    return () => clearTimeout(scrollTimeoutRef.current);
  }, [session?.messages, streamingContent]);

  // Scroll to bottom on mount - use useLayoutEffect to prevent visible scroll
  useLayoutEffect(() => {
    if (session?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [session?.id]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = (message: string, images?: PastedImage[]) => {
    if (!message.trim() && (!images || images.length === 0)) return;
    if (status.phase === 'thinking' || status.phase === 'streaming') return;

    setInputValue('');

    // Convert pasted images to attachment format for IPC transport
    const attachments = images?.map((img) => ({
      id: img.id,
      name: img.filename,
      path: '',  // Will be resolved by main process from base64 data
      type: 'image' as const,
      size: img.dataUrl.length,
      data: img.dataUrl,  // Base64 data URL for main process to save
    }));

    sendMessage(projectId, message, undefined, attachments);
  };

  const handleCancel = async () => {
    const cancelGeneration = useInsightsStore.getState().cancelGeneration;
    await cancelGeneration(projectId);
  };

  const handleNewSession = async () => {
    await newSession(projectId);
    textareaRef.current?.focus();
  };

  const handleSelectSession = async (sessionId: string) => {
    if (sessionId !== session?.id) {
      await switchSession(projectId, sessionId);
    }
  };

  const handleDeleteSession = async (sessionId: string): Promise<boolean> => {
    return await deleteSession(projectId, sessionId);
  };

  const handleRenameSession = async (sessionId: string, newTitle: string): Promise<boolean> => {
    return await renameSession(projectId, sessionId, newTitle);
  };

  const handleCreateTask = async (message: InsightsChatMessage) => {
    if (!message.suggestedTask || !session) return;

    setCreatingTask(message.id);
    try {
      // Add task to sidebar queue (doesn't create actual task yet)
      await createTaskFromSuggestion(
        projectId,
        message.suggestedTask.title,
        message.suggestedTask.description,
        message.suggestedTask.metadata
      );

      // Mark message as having queued the task (to disable button)
      await markTaskCreatedPersistent(projectId, session.id, message.id, 'queued');
    } finally {
      setCreatingTask(null);
    }
  };

  const handleModelConfigChange = async (config: InsightsModelConfig) => {
    // If we have a session, persist the config
    if (session?.id) {
      await updateModelConfig(projectId, session.id, config);
    }
  };

  const handleLeftSidebarResize = (delta: number) => {
    const newWidth = leftSidebarStartWidth.current + delta;
    const MIN_WIDTH = 200;
    // Cap at 50% of viewport width to prevent covering entire screen
    const MAX_WIDTH = Math.min(400, Math.floor(window.innerWidth * 0.5));

    if (newWidth < MIN_WIDTH) {
      // Collapse sidebar when dragged below minimum
      setShowSidebar(false);
    } else {
      const clampedWidth = Math.min(Math.max(newWidth, MIN_WIDTH), MAX_WIDTH);
      setLeftSidebarWidth(clampedWidth);
      leftSidebarStartWidth.current = clampedWidth;
    }
  };

  const handleRightSidebarResize = (delta: number) => {
    // Right sidebar resizes in opposite direction (dragging left makes it wider)
    const newWidth = rightSidebarStartWidth.current - delta;
    const MIN_WIDTH = 200;
    // Cap at 50% of viewport width to prevent covering entire screen
    const MAX_WIDTH = Math.min(450, Math.floor(window.innerWidth * 0.5));
    const COLLAPSED_WIDTH = 48;

    if (newWidth < MIN_WIDTH) {
      // Collapse to icon strip when dragged below minimum
      setRightSidebarWidth(COLLAPSED_WIDTH);
      rightSidebarStartWidth.current = COLLAPSED_WIDTH;
      // Trigger collapse in the TaskQueue store
      useInsightsTaskQueueStore.getState().toggleCollapsed();
    } else {
      const clampedWidth = Math.min(Math.max(newWidth, MIN_WIDTH), MAX_WIDTH);
      setRightSidebarWidth(clampedWidth);
      rightSidebarStartWidth.current = clampedWidth;
      // Ensure it's not collapsed
      const currentState = useInsightsTaskQueueStore.getState();
      if (currentState.isCollapsed) {
        currentState.toggleCollapsed();
      }
    }
  };

  // Split streaming content into committed (memoized) and active (live) portions
  // This prevents re-parsing the entire markdown on every streaming chunk
  const { committedContent, activeContent } = useMemo(() => {
    if (!streamingContent) return { committedContent: '', activeContent: '' };
    const lastBreak = streamingContent.lastIndexOf('\n\n');
    if (lastBreak <= 0) return { committedContent: '', activeContent: streamingContent };
    return {
      committedContent: streamingContent.substring(0, lastBreak + 2),
      activeContent: streamingContent.substring(lastBreak + 2),
    };
  }, [streamingContent]);

  const isLoading = status.phase === 'thinking' || status.phase === 'streaming';
  const messages = session?.messages || [];

  return (
    <div className="flex h-full">
      {/* Chat History Sidebar */}
      {showSidebar && (
        <>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId={session?.id || null}
            isLoading={isLoadingSessions}
            onNewSession={handleNewSession}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            width={leftSidebarWidth}
          />
          <ResizeHandle onResize={handleLeftSidebarResize} />
        </>
      )}

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="h-12 flex items-center justify-between border-b border-border px-3">
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
          <div className="flex items-center gap-2">
            <InsightsModelSelector
              currentConfig={session?.modelConfig}
              onConfigChange={handleModelConfigChange}
              disabled={isLoading}
            />
          </div>
        </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-6 py-4">
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
                onCreateTask={() => handleCreateTask(message)}
                isCreatingTask={creatingTask === message.id}
                taskCreated={!!message.taskCreatedId}
                onSeeInKanban={() => setActiveView('kanban')}
              />
            ))}

            {/* Streaming message — terminal-rich style */}
            {(streamingContent || currentTool) && (
              <div className="py-2 message-enter">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Bot className="h-3.5 w-3.5 text-primary/70" />
                  <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                    Jerry
                  </span>
                  {streamingContent && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground/60 writing-badge">
                      <Pencil className="h-3 w-3" />
                      <span>Writing...</span>
                    </span>
                  )}
                </div>
                <div className="pl-2">
                  {streamingContent && (
                    <div className="prose prose-sm dark:prose-invert max-w-none font-mono text-xs">
                      {committedContent && (
                        <CommittedMarkdown content={committedContent} components={markdownComponents} />
                      )}
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {activeContent}
                      </ReactMarkdown>
                      <span className="streaming-cursor" />
                    </div>
                  )}
                  {/* Live tool usage - shown as rich card */}
                  {currentTool && (
                    <ToolBlock
                      tool={{
                        toolName: currentTool.name,
                        input: currentTool.input ? { description: currentTool.input } : undefined,
                        status: 'running',
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Thinking indicator with skeleton loader + elapsed timer */}
            {status.phase === 'thinking' && !streamingContent && !currentTool && (
              <div className="py-2 message-enter">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Bot className="h-3.5 w-3.5 text-primary/70" />
                  <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                    Jerry
                  </span>
                </div>
                <div className="pl-2">
                  <ThinkingIndicator />
                </div>
              </div>
            )}

            {/* Completion indicator — shows response duration after streaming finishes */}
            {status.phase === 'complete' && responseDuration !== null && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1 completion-pop">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                <span className="elapsed-timer">
                  Completed in {(responseDuration / 1000).toFixed(1)}s
                </span>
              </div>
            )}

            {/* Error message */}
            {status.phase === 'error' && status.error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive message-enter">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {status.error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border p-4">
        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          onCancel={handleCancel}
          isLoading={isLoading}
          placeholder={isLoading ? "Waiting for response..." : "Ask about your codebase..."}
        />
      </div>
      </div>

      {/* Task Queue Sidebar (right side) */}
      <ResizeHandle onResize={handleRightSidebarResize} />
      <TaskQueueSidebar width={rightSidebarWidth} />
    </div>
  );
}

interface MessageBubbleProps {
  message: InsightsChatMessage;
  markdownComponents: Components;
  onCreateTask: () => void;
  isCreatingTask: boolean;
  taskCreated: boolean;
  onSeeInKanban: () => void;
}

function MessageBubble({
  message,
  markdownComponents,
  onCreateTask,
  isCreatingTask,
  taskCreated,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';

  // User messages: right-aligned bubble (matching TaskMonitorChat style)
  if (isUser) {
    return (
      <div className="flex justify-end py-2 message-enter">
        <div className="max-w-[80%] bg-primary text-primary-foreground px-4 py-2 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant messages: terminal-rich style with left-aligned bot indicator
  return (
    <div className="py-2 message-enter">
      {/* Role indicator */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <Bot className="h-3.5 w-3.5 text-primary/70" />
        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
          Jerry
        </span>
      </div>

      {/* Content */}
      <div className="pl-2">
        {/* Markdown text */}
        <div className="prose prose-sm dark:prose-invert max-w-none font-mono text-xs text-foreground/90">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Rich tool blocks (replaces old summary list) */}
        {message.toolsUsed && message.toolsUsed.length > 0 && (
          <div className="mt-2">
            {message.toolsUsed.map((tool, index) => {
              const toolData: ToolData = {
                toolName: tool.name,
                input: tool.input ? { description: tool.input } : undefined,
                status: 'success',
              };
              return <ToolBlock key={`${tool.name}-${index}`} tool={toolData} />;
            })}
          </div>
        )}

        {/* Task suggestion card */}
        {message.suggestedTask && (
          <TaskSuggestionCard
            task={message.suggestedTask}
            markdownComponents={markdownComponents}
            onCreateTask={onCreateTask}
            isCreatingTask={isCreatingTask}
            taskCreated={taskCreated}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Collapsible task suggestion card with markdown rendering.
 * Renders the description as formatted markdown instead of plain text,
 * and collapses long descriptions with a "Show more" toggle.
 */
interface TaskSuggestionCardProps {
  task: NonNullable<InsightsChatMessage['suggestedTask']>;
  markdownComponents: Components;
  onCreateTask: () => void;
  isCreatingTask: boolean;
  taskCreated: boolean;
}

function TaskSuggestionCard({
  task,
  markdownComponents,
  onCreateTask,
  isCreatingTask,
  taskCreated
}: TaskSuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const COLLAPSED_HEIGHT = 160;

  useEffect(() => {
    if (contentRef.current) {
      setNeedsCollapse(contentRef.current.scrollHeight > COLLAPSED_HEIGHT);
    }
  }, [task.description]);

  return (
    <Card className="mt-3 border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        {/* Header */}
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-primary">
            Suggested Task
          </span>
        </div>

        {/* Title */}
        <h4 className="mb-2 font-medium text-foreground">
          {task.title}
        </h4>

        {/* Description — rendered as markdown, collapsible */}
        <div className="mb-3">
          <div
            ref={contentRef}
            className={cn(
              'prose prose-sm dark:prose-invert max-w-none overflow-hidden',
              !expanded && needsCollapse && 'collapsed-fade'
            )}
            style={!expanded && needsCollapse ? { maxHeight: `${COLLAPSED_HEIGHT}px` } : undefined}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {task.description}
            </ReactMarkdown>
          </div>
          {needsCollapse && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1.5 text-xs font-medium text-primary/80 hover:text-primary transition-colors"
            >
              {expanded ? '▲ Show less' : '▼ Show more'}
            </button>
          )}
        </div>

        {/* Metadata badges */}
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

        {/* Action button */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={onCreateTask}
            disabled={isCreatingTask || taskCreated}
          >
            {isCreatingTask ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding to Queue...
              </>
            ) : taskCreated ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Added to Queue
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add to Queue
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ToolUsageHistory and ToolIndicator have been replaced by shared ToolBlock component

/**
 * Enhanced thinking indicator with skeleton loader and elapsed timer.
 * Shows animated skeleton content lines while the agent is processing,
 * with a live elapsed time counter.
 */
function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const timer = setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-primary/80">
        <Sparkles className="h-4 w-4 animate-pulse" />
        <span className="text-sm font-medium">Thinking</span>
        <span className="flex gap-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: '0ms' }} />
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: '150ms' }} />
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: '300ms' }} />
        </span>
        {elapsed > 0 && (
          <span className="text-xs text-muted-foreground elapsed-timer ml-1">
            {elapsed}s
          </span>
        )}
      </div>
      {/* Skeleton content lines */}
      <div className="space-y-2 max-w-[80%]">
        <div className="skeleton-line h-3 w-full" />
        <div className="skeleton-line h-3 w-[85%]" style={{ animationDelay: '0.1s' }} />
        <div className="skeleton-line h-3 w-[65%]" style={{ animationDelay: '0.2s' }} />
      </div>
    </div>
  );
}

/**
 * Memoized markdown renderer for committed (unchanging) content portions.
 * During streaming, only the active paragraph at the end changes — this
 * component prevents re-parsing the already-committed paragraphs above.
 */
const CommittedMarkdown = memo(function CommittedMarkdown({
  content,
  components
}: {
  content: string;
  components: Components;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
});
