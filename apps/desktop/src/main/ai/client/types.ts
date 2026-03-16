/**
 * Client Types
 * ============
 *
 * Type definitions for the AI client factory layer.
 * Mirrors the configuration surface of apps/desktop/src/main/ai/client/factory.ts.
 */

import type { LanguageModel } from 'ai';
import type { Tool as AITool } from 'ai';

import type { AgentType } from '../config/agent-configs';
import type { ModelShorthand, Phase, ThinkingLevel } from '../config/types';
import type { McpClientResult } from '../mcp/types';
import type { ToolContext } from '../tools/types';
import type { QueueResolvedAuth } from '../auth/types';
import type { ProviderAccount } from '../../../shared/types/provider-account';
import type { ProviderModelSpec } from '../../../shared/constants/models';

// =============================================================================
// Client Configuration
// =============================================================================

/**
 * Configuration for creating a full agent client.
 * Includes tool resolution, MCP server setup, and model configuration.
 */
export interface AgentClientConfig {
  /** Agent type — determines tool set and MCP servers */
  agentType: AgentType;
  /** System prompt for the agent */
  systemPrompt: string;
  /** Tool context for filesystem and security */
  toolContext: ToolContext;
  /** Pipeline phase for model/thinking resolution */
  phase: Phase;
  /** Model shorthand override (defaults to phase config) */
  modelShorthand?: ModelShorthand;
  /** Thinking level override (defaults to agent config) */
  thinkingLevel?: ThinkingLevel;
  /** Maximum agentic steps */
  maxSteps?: number;
  /** Profile ID for credential resolution */
  profileId?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Additional custom MCP server IDs to enable */
  additionalMcpServers?: string[];
  /** Optional queue-based resolution config (if provided, uses global priority queue instead of per-provider auth) */
  queueConfig?: {
    queue: ProviderAccount[];
    requestedModel: string;
    excludeAccountIds?: string[];
    userModelOverrides?: Record<string, Partial<Record<string, ProviderModelSpec>>>;
  };
}

/**
 * Configuration for creating a simple (utility) client.
 * Minimal setup — no tool registry, no MCP servers.
 * Used for utility runners (commit message, PR template, etc.).
 */
export interface SimpleClientConfig {
  /** System prompt for the utility call */
  systemPrompt: string;
  /** Model shorthand or full model ID (defaults to 'haiku').
   *  Accepts Anthropic shorthands ('haiku', 'sonnet', 'opus') or
   *  full provider model IDs (e.g., 'gpt-5.2-codex', 'gemini-2.5-flash-lite'). */
  modelShorthand?: ModelShorthand | string;
  /** Thinking level (defaults to 'low') */
  thinkingLevel?: ThinkingLevel;
  /** Profile ID for credential resolution */
  profileId?: string;
  /** Abort signal for cancellation during auth/model resolution */
  abortSignal?: AbortSignal;
  /** Maximum agentic steps (defaults to 1 for single-turn) */
  maxSteps?: number;
  /** Specific tools to include (if any) */
  tools?: Record<string, AITool>;
  /** Optional queue-based resolution config (if provided, uses global priority queue instead of per-provider auth) */
  queueConfig?: {
    queue: ProviderAccount[];
    requestedModel: string;
    excludeAccountIds?: string[];
    userModelOverrides?: Record<string, Partial<Record<string, ProviderModelSpec>>>;
  };
}

// =============================================================================
// Client Result
// =============================================================================

/**
 * Fully configured client ready for use with `runAgentSession()`.
 * Bundles the resolved model, tools, MCP clients, and configuration.
 */
export interface AgentClientResult {
  /** Resolved language model instance */
  model: LanguageModel;
  /** Merged tool map (builtin + MCP tools) */
  tools: Record<string, AITool>;
  /** Active MCP client connections (must be closed after session) */
  mcpClients: McpClientResult[];
  /** Resolved system prompt */
  systemPrompt: string;
  /** Maximum agentic steps */
  maxSteps: number;
  /** Resolved thinking level */
  thinkingLevel: ThinkingLevel;
  /** Cleanup function — closes all MCP connections */
  cleanup: () => Promise<void>;
  /** Queue-resolved auth (present when queueConfig was used) */
  queueAuth?: QueueResolvedAuth;
}

/**
 * Simple client result for utility runners.
 * No MCP clients, minimal tool set.
 */
export interface SimpleClientResult {
  /** Resolved language model instance */
  model: LanguageModel;
  /** Resolved model ID string (e.g. 'claude-opus-4-6', 'gpt-5.3-codex') — use for provider detection */
  resolvedModelId: string;
  /** Tools (may be empty for pure text generation) */
  tools: Record<string, AITool>;
  /** System prompt */
  systemPrompt: string;
  /** Maximum agentic steps */
  maxSteps: number;
  /** Resolved thinking level */
  thinkingLevel: ThinkingLevel;
  /** Queue-resolved auth (present when queueConfig was used) */
  queueAuth?: QueueResolvedAuth;
}
