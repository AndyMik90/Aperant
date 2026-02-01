/**
 * Claude Output Parser
 *
 * Converts streaming Claude agent output from terminal into structured message objects
 * for rendering in the rich UI (TaskMonitorChat).
 *
 * Pattern-based parser that detects:
 * - User/Assistant message boundaries
 * - Thinking blocks
 * - Tool use (Read, Write, Edit, Bash, etc.)
 * - Code blocks with syntax highlighting
 * - File diffs
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export type ContentBlockType =
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'code_block'
  | 'diff';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ThinkingContent {
  type: 'thinking';
  text: string;
  signature?: string;  // SDK thinking block signature
}

export interface ToolUseContent {
  type: 'tool_use';
  toolName: string;
  toolId?: string;     // SDK tool use ID for matching with results
  input: Record<string, unknown>;
  output?: string;
  status?: 'pending' | 'running' | 'success' | 'error';
}

export interface CodeBlockContent {
  type: 'code_block';
  language: string;
  code: string;
  filename?: string;
}

export interface DiffContent {
  type: 'diff';
  filename: string;
  oldContent: string;
  newContent: string;
}

export type ContentBlock =
  | TextContent
  | ThinkingContent
  | ToolUseContent
  | CodeBlockContent
  | DiffContent;

export interface ParsedMessage {
  role: MessageRole;
  content: ContentBlock[];
  timestamp: number;
}

/**
 * Patterns for detecting different content types in Claude's output
 */
const PATTERNS = {
  // Jerry internal log markers (should be filtered/parsed, not displayed raw)
  TASK_LOG_TEXT: /^__TASK_LOG_TEXT__:\s*(.+)$/,
  TASK_LOG_TOOL_START: /^__TASK_LOG_TOOL_START__:\s*(.+)$/,
  TASK_LOG_TOOL_END: /^__TASK_LOG_TOOL_END__:\s*(.+)$/,
  TASK_LOG_PHASE: /^__TASK_LOG_PHASE_START__:\s*(.+)$/,
  TASK_LOG_EXEC: /^__EXEC_PHASE__:\s*(.+)$/,

  // Jerry tool use patterns - matches [Tool: ToolName] format
  JERRY_TOOL_START: /^\[Tool:\s*(\w+)\]\s*$/,
  JERRY_TOOL_DONE: /^\s*\[Done\]\s*$/,
  JERRY_TOOL_ERROR: /^\s*\[Error\]\s*/,

  // Generic tool use patterns - matches tool invocations like "Reading file: path/to/file"
  TOOL_USE: /(?:Reading|Writing|Editing|Running|Executing|Using)\s+(?:file|command|tool):\s*(.+)/i,

  // Thinking blocks - matches <thinking>...</thinking> tags
  THINKING_START: /<thinking>/i,
  THINKING_END: /<\/thinking>/i,

  // Code blocks - matches ```language\ncode\n``` format
  CODE_BLOCK_START: /```(\w+)?\s*(?:\/\/\s*(.+))?\s*$/,
  CODE_BLOCK_END: /```\s*$/,

  // File diffs - matches diff-like output
  DIFF_START: /^diff --git|^---\s+\w+|^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/,

  // Message role indicators
  USER_MESSAGE: /^User:/i,
  ASSISTANT_MESSAGE: /^Assistant:/i,
  SYSTEM_MESSAGE: /^System:/i,

  // ANSI color codes (strip for parsing)
  ANSI_CODES: /\x1b\[[0-9;]*m/g,
};

/**
 * Known tool names from the agent
 */
const TOOL_NAMES = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'Task',
  'WebFetch',
  'WebSearch',
  'AskUserQuestion',
];

export class ClaudeOutputParser {
  private buffer = '';
  private messages: ParsedMessage[] = [];
  private currentMessage: ParsedMessage | null = null;
  private currentBlock: ContentBlock | null = null;

  // State tracking for multi-line blocks
  private inThinking = false;
  private inCodeBlock = false;
  private inDiff = false;
  private inJerryTool = false;
  private jerryToolName = '';
  private jerryToolOutput: string[] = [];
  private codeBlockLanguage = '';
  private codeBlockFilename = '';
  private codeBlockLines: string[] = [];
  private thinkingLines: string[] = [];
  private diffLines: string[] = [];

  constructor(initialMessages: ParsedMessage[] = []) {
    this.messages = initialMessages;
  }

  /**
   * Append a chunk of text and return ALL messages (including current in-progress one)
   *
   * For streaming, we want to show partial messages as they arrive, not wait for completion.
   */
  append(chunk: string): ParsedMessage[] {
    this.buffer += chunk;

    // Ensure we have a message to add content to
    this.ensureCurrentMessage();

    // Process line by line - handle both \n and \r\n line endings
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      // Strip ANSI codes and trailing \r (from \r\n line endings)
      const cleanLine = this.stripAnsiCodes(line).replace(/\r$/, '');
      this.processLine(cleanLine);
    }

    // Return ALL messages including the current in-progress one
    // This allows streaming updates in the UI
    const allMessages = [...this.messages];
    if (this.currentMessage && this.currentMessage.content.length > 0) {
      allMessages.push(this.currentMessage);
    }

    return allMessages;
  }

  /**
   * Flush any remaining buffered content and return final messages
   */
  flush(): ParsedMessage[] {
    const newMessages: ParsedMessage[] = [];

    if (this.buffer.trim()) {
      const cleanLine = this.stripAnsiCodes(this.buffer);
      const processedMessage = this.processLine(cleanLine);

      if (processedMessage) {
        newMessages.push(processedMessage);
      }

      this.buffer = '';
    }

    // Close any open blocks
    if (this.inThinking) {
      this.finishThinkingBlock();
    }
    if (this.inCodeBlock) {
      this.finishCodeBlock();
    }
    if (this.inDiff) {
      this.finishDiffBlock();
    }

    // Add current message if it exists
    if (this.currentMessage && this.currentMessage.content.length > 0) {
      newMessages.push(this.currentMessage);
      this.messages.push(this.currentMessage);
      this.currentMessage = null;
    }

    return newMessages;
  }

  /**
   * Force flush all content as a single assistant message
   * Used to ensure content is displayed even if patterns don't match
   */
  forceFlush(): ParsedMessage[] {
    // Ensure we have a current message
    this.ensureCurrentMessage();

    // Add any buffered content
    if (this.buffer.trim()) {
      this.addTextContent(this.stripAnsiCodes(this.buffer));
      this.buffer = '';
    }

    return this.flush();
  }

  /**
   * Get all parsed messages
   */
  getMessages(): ParsedMessage[] {
    return this.messages;
  }

  /**
   * Clear all messages and reset parser state
   */
  clear(): void {
    this.messages = [];
    this.currentMessage = null;
    this.currentBlock = null;
    this.buffer = '';
    this.resetBlockState();
  }

  // Private helper methods

  private processLine(line: string): ParsedMessage | null {
    // Parse Jerry's internal log format and extract clean content
    const taskLogTextMatch = line.match(PATTERNS.TASK_LOG_TEXT);
    if (taskLogTextMatch) {
      try {
        const logData = JSON.parse(taskLogTextMatch[1]);
        if (logData.content) {
          this.addTextContent(logData.content);
        }
      } catch (e) {
        // If JSON parse fails, treat as regular text
        this.addTextContent(line);
      }
      return null;
    }

    const taskLogToolStartMatch = line.match(PATTERNS.TASK_LOG_TOOL_START);
    if (taskLogToolStartMatch) {
      try {
        const logData = JSON.parse(taskLogToolStartMatch[1]);
        if (logData.name) {
          this.inJerryTool = true;
          this.jerryToolName = logData.name;
          this.jerryToolOutput = logData.input ? [JSON.stringify(logData.input, null, 2)] : [];
        }
      } catch (e) {
        // Ignore malformed log entries
      }
      return null;
    }

    const taskLogToolEndMatch = line.match(PATTERNS.TASK_LOG_TOOL_END);
    if (taskLogToolEndMatch) {
      try {
        const logData = JSON.parse(taskLogToolEndMatch[1]);
        if (this.inJerryTool) {
          this.finishJerryToolBlock(logData.success ? '[Done]' : '[Error]');
        }
      } catch (e) {
        // Ignore malformed log entries
      }
      return null;
    }

    // Skip other internal log markers
    if (PATTERNS.TASK_LOG_PHASE.test(line) || PATTERNS.TASK_LOG_EXEC.test(line)) {
      return null;
    }

    // Check for role changes
    if (PATTERNS.USER_MESSAGE.test(line)) {
      return this.startNewMessage('user', line.replace(PATTERNS.USER_MESSAGE, '').trim());
    }
    if (PATTERNS.ASSISTANT_MESSAGE.test(line)) {
      return this.startNewMessage('assistant', line.replace(PATTERNS.ASSISTANT_MESSAGE, '').trim());
    }
    if (PATTERNS.SYSTEM_MESSAGE.test(line)) {
      return this.startNewMessage('system', line.replace(PATTERNS.SYSTEM_MESSAGE, '').trim());
    }

    // Process multi-line blocks
    // Handle Jerry tool blocks
    if (this.inJerryTool) {
      if (PATTERNS.JERRY_TOOL_DONE.test(line) || PATTERNS.JERRY_TOOL_ERROR.test(line)) {
        this.finishJerryToolBlock(line);
      } else {
        this.jerryToolOutput.push(line);
      }
      return null;
    }

    if (this.inThinking) {
      if (PATTERNS.THINKING_END.test(line)) {
        this.finishThinkingBlock();
      } else {
        this.thinkingLines.push(line);
      }
      return null;
    }

    if (this.inCodeBlock) {
      if (PATTERNS.CODE_BLOCK_END.test(line)) {
        this.finishCodeBlock();
      } else {
        this.codeBlockLines.push(line);
      }
      return null;
    }

    if (this.inDiff) {
      // Simple heuristic: diff ends when we see a non-diff line
      if (!line.startsWith('+') && !line.startsWith('-') && !line.startsWith('@') && !PATTERNS.DIFF_START.test(line)) {
        this.finishDiffBlock();
        // Process this line as regular content
        this.addTextContent(line);
      } else {
        this.diffLines.push(line);
      }
      return null;
    }

    // Check for block starts
    // Jerry tool start
    const jerryToolMatch = line.match(PATTERNS.JERRY_TOOL_START);
    if (jerryToolMatch) {
      this.inJerryTool = true;
      this.jerryToolName = jerryToolMatch[1];
      this.jerryToolOutput = [];
      return null;
    }

    if (PATTERNS.THINKING_START.test(line)) {
      this.inThinking = true;
      this.thinkingLines = [];
      return null;
    }

    const codeBlockMatch = line.match(PATTERNS.CODE_BLOCK_START);
    if (codeBlockMatch) {
      this.inCodeBlock = true;
      this.codeBlockLanguage = codeBlockMatch[1] || '';
      this.codeBlockFilename = codeBlockMatch[2] || '';
      this.codeBlockLines = [];
      return null;
    }

    if (PATTERNS.DIFF_START.test(line)) {
      this.inDiff = true;
      this.diffLines = [line];
      return null;
    }

    // Check for tool use
    const toolMatch = this.detectToolUse(line);
    if (toolMatch) {
      this.addToolUseContent(toolMatch);
      return null;
    }

    // Regular text content
    this.addTextContent(line);
    return null;
  }

  private startNewMessage(role: MessageRole, initialText: string): ParsedMessage | null {
    // Finish current message
    let completedMessage: ParsedMessage | null = null;

    if (this.currentMessage && this.currentMessage.content.length > 0) {
      completedMessage = this.currentMessage;
      this.messages.push(this.currentMessage);
    }

    // Start new message
    this.currentMessage = {
      role,
      content: initialText ? [{ type: 'text', text: initialText }] : [],
      timestamp: Date.now(),
    };

    return completedMessage;
  }

  private addTextContent(text: string): void {
    if (!text.trim()) return;

    this.ensureCurrentMessage();

    // Try to merge with previous text block
    const lastBlock = this.currentMessage!.content[this.currentMessage!.content.length - 1];

    if (lastBlock && lastBlock.type === 'text') {
      lastBlock.text += '\n' + text;
    } else {
      this.currentMessage!.content.push({ type: 'text', text });
    }
  }

  private addToolUseContent(tool: { toolName: string; input: Record<string, unknown> }): void {
    this.ensureCurrentMessage();

    this.currentMessage!.content.push({
      type: 'tool_use',
      toolName: tool.toolName,
      input: tool.input,
      status: 'running',
    });
  }

  private finishThinkingBlock(): void {
    if (this.thinkingLines.length > 0) {
      this.ensureCurrentMessage();

      this.currentMessage!.content.push({
        type: 'thinking',
        text: this.thinkingLines.join('\n'),
      });
    }

    this.inThinking = false;
    this.thinkingLines = [];
  }

  private finishJerryToolBlock(statusLine: string): void {
    this.ensureCurrentMessage();

    const status = PATTERNS.JERRY_TOOL_ERROR.test(statusLine) ? 'error' : 'success';
    const output = this.jerryToolOutput.join('\n').trim();

    this.currentMessage!.content.push({
      type: 'tool_use',
      toolName: this.jerryToolName,
      input: {},
      output: output || undefined,
      status,
    });

    this.inJerryTool = false;
    this.jerryToolName = '';
    this.jerryToolOutput = [];
  }

  private finishCodeBlock(): void {
    if (this.codeBlockLines.length > 0) {
      this.ensureCurrentMessage();

      this.currentMessage!.content.push({
        type: 'code_block',
        language: this.codeBlockLanguage,
        code: this.codeBlockLines.join('\n'),
        filename: this.codeBlockFilename || undefined,
      });
    }

    this.inCodeBlock = false;
    this.codeBlockLanguage = '';
    this.codeBlockFilename = '';
    this.codeBlockLines = [];
  }

  private finishDiffBlock(): void {
    if (this.diffLines.length > 0) {
      this.ensureCurrentMessage();

      // Parse diff to extract filename and content
      const filename = this.extractDiffFilename(this.diffLines);

      this.currentMessage!.content.push({
        type: 'diff',
        filename,
        oldContent: '',
        newContent: this.diffLines.join('\n'),
      });
    }

    this.inDiff = false;
    this.diffLines = [];
  }

  private detectToolUse(line: string): { toolName: string; input: Record<string, unknown> } | null {
    // Check for explicit tool patterns
    const toolMatch = line.match(PATTERNS.TOOL_USE);
    if (toolMatch) {
      const [, input] = toolMatch;

      // Try to detect specific tool name
      for (const toolName of TOOL_NAMES) {
        if (line.toLowerCase().includes(toolName.toLowerCase())) {
          return {
            toolName,
            input: { target: input },
          };
        }
      }

      return {
        toolName: 'Unknown',
        input: { target: input },
      };
    }

    return null;
  }

  private extractDiffFilename(diffLines: string[]): string {
    for (const line of diffLines) {
      if (line.startsWith('---')) {
        return line.replace(/^---\s+[ab]\//, '').trim();
      }
      if (line.startsWith('+++')) {
        return line.replace(/^\+\+\+\s+[ab]\//, '').trim();
      }
    }
    return 'Unknown file';
  }

  private ensureCurrentMessage(): void {
    if (!this.currentMessage) {
      this.currentMessage = {
        role: 'assistant',
        content: [],
        timestamp: Date.now(),
      };
    }
  }

  private resetBlockState(): void {
    this.inThinking = false;
    this.inCodeBlock = false;
    this.inDiff = false;
    this.inJerryTool = false;
    this.jerryToolName = '';
    this.jerryToolOutput = [];
    this.codeBlockLanguage = '';
    this.codeBlockFilename = '';
    this.codeBlockLines = [];
    this.thinkingLines = [];
    this.diffLines = [];
  }

  private stripAnsiCodes(text: string): string {
    return text.replace(PATTERNS.ANSI_CODES, '');
  }
}
