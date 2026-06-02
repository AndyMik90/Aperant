/**
 * ReAct Tool-Call Protocol
 * ========================
 *
 * The direct web protocols (DeepSeek / ChatGPT) do not support native function
 * calling. To let the Vercel AI SDK agent loop (planner / coder / QA, which all
 * rely on Read/Write/Edit/Bash tools) work at all, we emulate tool calling in
 * plain text:
 *
 *   1. `buildToolInstructions()` renders the available tools' JSON schemas into
 *      a system-prompt section that teaches the model to emit a tool call as a
 *      delimited `<tool_call>{...}</tool_call>` JSON block.
 *   2. `parseToolCalls()` scans the model's raw text reply, extracts those
 *      blocks, and strips them from the user-visible text.
 *
 * This is intentionally a best-effort shim: a chat model following text
 * instructions is materially less reliable than native function calling. The
 * format is kept dead-simple (one JSON object per block) to maximize the odds
 * the model produces something parseable.
 */

import type { LanguageModelV2FunctionTool } from '@ai-sdk/provider';

/** A tool call recovered from the model's text output. */
export interface ParsedToolCall {
  /** Tool name as emitted by the model. */
  toolName: string;
  /** Raw arguments object (already JSON-parsed). */
  args: unknown;
}

/** Result of scanning a model reply for tool-call blocks. */
export interface ParsedReply {
  /** The reply text with all tool-call blocks removed and trimmed. */
  text: string;
  /** Tool calls extracted, in document order. */
  toolCalls: ParsedToolCall[];
}

// Matches a <tool_call> ... </tool_call> block (case-insensitive, multiline).
// Also tolerates a ```tool_call fenced variant some models prefer.
const TAG_BLOCK = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const FENCE_BLOCK = /```(?:tool_call|tool)\s*\n([\s\S]*?)```/gi;

/**
 * Build the instruction block appended to the system prompt. Only emitted when
 * the call actually exposes tools; otherwise the model is left to answer in
 * plain prose.
 */
export function buildToolInstructions(
  tools: ReadonlyArray<LanguageModelV2FunctionTool>,
): string {
  if (tools.length === 0) return '';

  const rendered = tools
    .map((tool) => {
      const schema = JSON.stringify(tool.inputSchema ?? {});
      const desc = tool.description ? ` — ${tool.description}` : '';
      return `- ${tool.name}${desc}\n  input schema: ${schema}`;
    })
    .join('\n');

  return [
    '# Tool use',
    '',
    'You can call tools to take actions or read data. The available tools are:',
    '',
    rendered,
    '',
    'To call a tool, output a block in EXACTLY this format and nothing else around it:',
    '',
    '<tool_call>',
    '{"name": "<tool name>", "arguments": { <arguments matching the input schema> }}',
    '</tool_call>',
    '',
    'Rules:',
    '- Emit one `<tool_call>` block per tool you want to call. You may emit several.',
    "- `arguments` MUST be a valid JSON object that satisfies that tool's input schema.",
    '- Do not wrap the block in markdown code fences.',
    '- After you have all the information you need, stop calling tools and write your final answer as plain text with no `<tool_call>` block.',
  ].join('\n');
}

/** Try to JSON-parse a captured block body into a {name, arguments} call. */
function tryParseBlock(body: string): ParsedToolCall | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as { name?: unknown; arguments?: unknown };
    if (!obj || typeof obj.name !== 'string' || obj.name.length === 0) return null;
    // `arguments` may be omitted for zero-arg tools; default to {}.
    return { toolName: obj.name, args: obj.arguments ?? {} };
  } catch {
    return null;
  }
}

/**
 * Extract tool calls from a model reply and return the cleaned prose plus the
 * parsed calls. Blocks that fail to parse are left in the text untouched (so a
 * malformed attempt is at least visible rather than silently swallowed).
 */
export function parseToolCalls(reply: string): ParsedReply {
  const toolCalls: ParsedToolCall[] = [];

  const collect = (match: string, body: string): string => {
    const parsed = tryParseBlock(body);
    if (parsed) {
      toolCalls.push(parsed);
      return ''; // strip recognized blocks from the visible text
    }
    return match; // keep unparseable blocks verbatim
  };

  let text = reply.replace(TAG_BLOCK, (m, body: string) => collect(m, body));
  text = text.replace(FENCE_BLOCK, (m, body: string) => collect(m, body));

  return { text: text.trim(), toolCalls };
}
