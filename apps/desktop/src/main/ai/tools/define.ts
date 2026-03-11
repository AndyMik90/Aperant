/**
 * Tool.define() Wrapper
 * =====================
 *
 * Wraps the Vercel AI SDK v6 `tool()` function with:
 * - Zod v3 input schema validation
 * - Security hook integration (pre-execution)
 * - Tool context injection
 *
 * Usage:
 *   const readTool = Tool.define({
 *     metadata: { name: 'Read', description: '...', permission: 'read_only', executionOptions: DEFAULT_EXECUTION_OPTIONS },
 *     inputSchema: z.object({ file_path: z.string() }),
 *     execute: async (input, ctx) => { ... },
 *   });
 *
 *   // Later, bind context and get AI SDK tool:
 *   const aiTool = readTool.bind(toolContext);
 */

import { tool } from 'ai';
import type { Tool as AITool } from 'ai';
import { z } from 'zod/v3';

import { resolve } from 'node:path';

import { bashSecurityHook } from '../security/bash-validator';
import type {
  ToolContext,
  ToolDefinitionConfig,
  ToolMetadata,
} from './types';
import { ToolPermission } from './types';
import { truncateToolOutput, SAFETY_NET_MAX_BYTES } from './truncation';

// ---------------------------------------------------------------------------
// Defined Tool
// ---------------------------------------------------------------------------

/**
 * A defined tool that can be bound to a ToolContext to produce
 * an AI SDK v6 compatible tool object.
 */
export interface DefinedTool<
  TInput extends z.ZodType = z.ZodType,
  TOutput = unknown,
> {
  /** Tool metadata */
  metadata: ToolMetadata;
  /** Bind a ToolContext to produce an AI SDK tool */
  bind: (context: ToolContext) => AITool<z.infer<TInput>, TOutput>;
  /** Original config for inspection/testing */
  config: ToolDefinitionConfig<TInput, TOutput>;
}

// ---------------------------------------------------------------------------
// Security pre-execution hook
// ---------------------------------------------------------------------------

/**
 * Run security hooks before tool execution.
 * Currently validates Bash commands against the security profile.
 */
function runSecurityHooks(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): void {
  const result = bashSecurityHook(
    {
      toolName,
      toolInput: input,
      cwd: context.cwd,
    },
    context.securityProfile,
  );

  if ('hookSpecificOutput' in result) {
    const reason = result.hookSpecificOutput.permissionDecisionReason;
    throw new Error(`Security hook denied ${toolName}: ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// File Path Sanitization
// ---------------------------------------------------------------------------

/**
 * Pattern matching trailing JSON artifact characters that some models
 * (e.g., gpt-5.3-codex) leak into tool call string arguments.
 * Matches sequences like `'}},{`, `"}`, `'},` etc. at the end of a path.
 */
const TRAILING_JSON_ARTIFACT_RE = /['"}\],{]+$/;

/**
 * Sanitize file_path (and similar path-like) arguments in tool input.
 * Strips trailing JSON structural characters that models sometimes
 * include when generating tool call arguments with malformed JSON.
 *
 * Mutates the input object in place for efficiency.
 *
 * @internal Exported for unit testing only.
 */
export function sanitizeFilePathArg(input: Record<string, unknown>): void {
  const filePath = input.file_path;
  if (typeof filePath !== 'string') return;

  const cleaned = filePath.replace(TRAILING_JSON_ARTIFACT_RE, '');
  if (cleaned !== filePath) {
    input.file_path = cleaned;
  }
}

// ---------------------------------------------------------------------------
// Tool.define()
// ---------------------------------------------------------------------------

/**
 * Define a tool with metadata, Zod input schema, and execute function.
 * Returns a DefinedTool that can be bound to a ToolContext for use with AI SDK.
 */
function define<TInput extends z.ZodType, TOutput>(
  config: ToolDefinitionConfig<TInput, TOutput>,
): DefinedTool<TInput, TOutput> {
  const { metadata, inputSchema, execute } = config;

  return {
    metadata,
    config,
    bind(context: ToolContext): AITool<z.infer<TInput>, TOutput> {
      type Input = z.infer<TInput>;

      // Use type assertion because tool() overloads can't infer
      // from generic TInput/TOutput at the definition site.
      // Concrete types resolve correctly when Tool.define() is called
      // with a specific Zod schema.
      const executeWithHooks = async (input: Input): Promise<TOutput> => {
        // Sanitize file_path arguments: strip trailing JSON artifact characters
        // that some models (e.g., gpt-5.3-codex) leak into string tool arguments.
        // E.g., "spec.md'}},{" → "spec.md"
        sanitizeFilePathArg(input as Record<string, unknown>);

        if (metadata.permission !== ToolPermission.ReadOnly) {
          runSecurityHooks(
            metadata.name,
            input as Record<string, unknown>,
            context,
          );
        }

        // Write-path containment: reject writes outside allowed directories
        // Only applies to tools that can modify files (Write, Edit) — not read-only tools
        if (context.allowedWritePaths?.length && metadata.permission !== ToolPermission.ReadOnly) {
          const writePath = (input as Record<string, unknown>).file_path as string | undefined;
          if (writePath) {
            const resolved = resolve(writePath);
            const allowed = context.allowedWritePaths.some(dir => resolved.startsWith(resolve(dir)));
            if (!allowed) {
              throw new Error(
                `Write denied: ${metadata.name} cannot write to ${writePath}. ` +
                `Allowed directories: ${context.allowedWritePaths.join(', ')}`,
              );
            }
          }
        }

        const result = await (execute(input as z.infer<TInput>, context) as Promise<TOutput>);

        // Safety-net: apply disk-spillover truncation to string outputs
        // Uses a higher limit since individual tools should catch most cases first
        if (typeof result === 'string') {
          const truncated = truncateToolOutput(
            result,
            metadata.name,
            context.projectDir,
            SAFETY_NET_MAX_BYTES,
          );
          return truncated.content as TOutput;
        }
        return result;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic TInput can't satisfy tool() overloads at definition site
      return tool({
        description: metadata.description,
        inputSchema: inputSchema as any,
        execute: executeWithHooks as any,
      }) as AITool<Input, TOutput>;
    },
  };
}

/**
 * Tool namespace — entry point for defining tools.
 *
 * @example
 * ```ts
 * import { Tool } from './define';
 *
 * const myTool = Tool.define({
 *   metadata: { name: 'MyTool', ... },
 *   inputSchema: z.object({ ... }),
 *   execute: async (input, ctx) => { ... },
 * });
 * ```
 */
export const Tool = { define } as const;
