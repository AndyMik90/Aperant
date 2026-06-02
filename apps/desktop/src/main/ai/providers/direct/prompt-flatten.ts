/**
 * Prompt Flattening
 * =================
 *
 * The DeepSeek / ChatGPT web protocols exposed by `ai-providers-direct` accept
 * a single free-form `prompt` string — they have no concept of a `messages`
 * array, a `system` role, or tool-call / tool-result turns.
 *
 * The Vercel AI SDK, however, always hands a provider a fully structured
 * `LanguageModelV2Prompt` (an array of system/user/assistant/tool messages,
 * each with typed content parts). To bridge the two we deterministically
 * serialize that structured prompt back into one readable transcript string.
 *
 * The serialization is intentionally human-legible: the underlying model is a
 * chat model trained on natural dialogue, so a `Role:\n...` transcript is the
 * representation it handles best. Tool calls and tool results are rendered as
 * explicit, parseable blocks so a multi-step agent loop reads as a coherent
 * conversation across turns.
 */

import type { LanguageModelV2Prompt } from '@ai-sdk/provider';

/** Result of flattening a structured prompt. */
export interface FlattenedPrompt {
  /** Concatenated content of all `system` messages (empty string if none). */
  system: string;
  /** The user/assistant/tool transcript, excluding system messages. */
  transcript: string;
}

/** Render a single tool-result output (the discriminated union) as text. */
function renderToolOutput(output: { type: string; value?: unknown }): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return String(output.value ?? '');
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value ?? null);
    case 'content': {
      // Array of text/media parts — keep text, mark media placeholders.
      const parts = Array.isArray(output.value) ? output.value : [];
      return parts
        .map((p: { type: string; text?: string; mediaType?: string }) =>
          p.type === 'text' ? (p.text ?? '') : `[media: ${p.mediaType ?? 'unknown'}]`,
        )
        .join('\n');
    }
    default:
      return JSON.stringify(output.value ?? null);
  }
}

/**
 * Flatten a structured AI SDK prompt into a single transcript string plus the
 * combined system text. Callers decide how to recombine them (the direct
 * transports prepend `system` to the transcript since they lack a system role).
 */
export function flattenPrompt(prompt: LanguageModelV2Prompt): FlattenedPrompt {
  const systemParts: string[] = [];
  const lines: string[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case 'system':
        systemParts.push(message.content);
        break;

      case 'user': {
        const text = message.content
          .map((part) =>
            part.type === 'text'
              ? part.text
              : `[attachment: ${part.mediaType}${part.filename ? ` "${part.filename}"` : ''}]`,
          )
          .join('');
        lines.push(`User:\n${text}`);
        break;
      }

      case 'assistant': {
        const segments: string[] = [];
        for (const part of message.content) {
          if (part.type === 'text') {
            segments.push(part.text);
          } else if (part.type === 'tool-call') {
            // Echo the assistant's prior tool call so the model sees the loop it
            // is already in. Mirrors the ReAct block the parser emits/expects.
            segments.push(
              `<tool_call>\n${JSON.stringify({ name: part.toolName, arguments: part.input })}\n</tool_call>`,
            );
          }
          // reasoning / file parts are dropped from the assistant echo.
        }
        if (segments.length > 0) {
          lines.push(`Assistant:\n${segments.join('\n')}`);
        }
        break;
      }

      case 'tool': {
        for (const part of message.content) {
          lines.push(
            `Tool result (tool="${part.toolName}", id="${part.toolCallId}"):\n${renderToolOutput(part.output)}`,
          );
        }
        break;
      }
    }
  }

  return {
    system: systemParts.join('\n\n'),
    transcript: lines.join('\n\n'),
  };
}
