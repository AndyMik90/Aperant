/**
 * Shared chat components used by both Insights and TaskMonitorChat.
 */

export { CopyButton } from './CopyButton';
export { DiffLine } from './DiffLine';
export { ToolBlock } from './ToolBlock';
export type { ToolData } from './ToolBlock';
export { ThinkingBlock, ThinkingExpandContext } from './ThinkingBlock';
export { ChatCodeBlock } from './ChatCodeBlock';
export { UserMessage } from './UserMessage';
export type { PastedImage } from './UserMessage';
export { detectLanguageFromPath, escapeHtml, highlightCode } from './highlight';
