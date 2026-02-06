import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
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
  ArrowRight
} from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
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
import { loadTasks } from '../stores/task-store';
import { useInsightsTaskQueueStore } from '../stores/insights-task-queue-store';
import { ChatHistorySidebar } from './ChatHistorySidebar';
import { InsightsModelSelector } from './InsightsModelSelector';
import { TaskQueueSidebar } from './insights/TaskQueueSidebar';
import { ChatInput } from './insights/ChatInput';
import { ResizeHandle } from './insights/ResizeHandle';
import { useNavigation } from '../contexts/NavigationContext';
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

  // Auto-scroll to bottom when messages change (smooth animation)
  useEffect(() => {
    if (session?.messages?.length || streamingContent) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
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

  const handleSend = (message: string, attachments?: any[]) => {
    if (!message.trim() && (!attachments || attachments.length === 0)) return;
    if (status.phase === 'thinking' || status.phase === 'streaming') return;

    setInputValue('');
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

            {/* Streaming message */}
            {(streamingContent || currentTool) && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 text-sm font-medium text-foreground">
                    Jerry
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

            {/* Thinking indicator with animated dots */}
            {status.phase === 'thinking' && !streamingContent && !currentTool && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TypingIndicator />
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
  onSeeInKanban
}: MessageBubbleProps) {
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
          {isUser ? 'You' : 'Jerry'}
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Tool usage history for assistant messages */}
        {!isUser && message.toolsUsed && message.toolsUsed.length > 0 && (
          <ToolUsageHistory tools={message.toolsUsed} />
        )}

        {/* Task suggestion card */}
        {message.suggestedTask && (
          <Card className="mt-3 border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-primary">
                  Suggested Task
                </span>
              </div>
              <h4 className="mb-2 font-medium text-foreground">
                {message.suggestedTask.title}
              </h4>
              <p className="mb-3 text-sm text-muted-foreground">
                {message.suggestedTask.description}
              </p>
              {message.suggestedTask.metadata && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {message.suggestedTask.metadata.category && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs',
                        TASK_CATEGORY_COLORS[message.suggestedTask.metadata.category]
                      )}
                    >
                      {TASK_CATEGORY_LABELS[message.suggestedTask.metadata.category] ||
                        message.suggestedTask.metadata.category}
                    </Badge>
                  )}
                  {message.suggestedTask.metadata.complexity && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs',
                        TASK_COMPLEXITY_COLORS[message.suggestedTask.metadata.complexity]
                      )}
                    >
                      {TASK_COMPLEXITY_LABELS[message.suggestedTask.metadata.complexity] ||
                        message.suggestedTask.metadata.complexity}
                    </Badge>
                  )}
                </div>
              )}
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

/**
 * Animated thinking indicator with sparkle icon
 * VS Code Copilot-style indicator while agent is processing
 */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-primary/80">
      <Sparkles className="h-4 w-4 animate-pulse" />
      <span className="text-sm font-medium">Thinking</span>
      <span className="flex gap-0.5">
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: '300ms' }} />
      </span>
    </div>
  );
}
