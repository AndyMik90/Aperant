/**
 * Client Factory
 * ==============
 *
 * Factory functions for creating configured AI clients.
 * Ported from apps/desktop/src/main/ai/client/ (originally from Python core/client).
 *
 * - `createAgentClient()` — Full client with tools, MCP, and security.
 *   Used by planner, coder, QA, and other pipeline agents.
 *
 * - `createSimpleClient()` — Lightweight client for utility runners
 *   (commit messages, PR templates, analysis tasks).
 */

import type { Tool as AITool } from 'ai';

import { resolveAuth, resolveAuthFromQueue, buildDefaultQueueConfig } from '../auth/resolver';
import {
  getDefaultThinkingLevel,
  getRequiredMcpServers,
} from '../config/agent-configs';
import type { McpServerResolveOptions } from '../config/agent-configs';
import { resolveModelId } from '../config/phase-config';
import type { ThinkingLevel } from '../config/types';
import { resolveReasoningParams } from '../config/types';
import { createMcpClientsForAgent, closeAllMcpClients, mergeMcpTools } from '../mcp/client';
import type { McpClientResult } from '../mcp/types';
import { createProvider, detectProviderFromModel } from '../providers/factory';
import { buildToolRegistry } from '../tools/build-registry';
import type { QueueResolvedAuth } from '../auth/types';
import type {
  AgentClientConfig,
  AgentClientResult,
  SimpleClientConfig,
  SimpleClientResult,
} from './types';

// =============================================================================
// Default Constants
// =============================================================================

/** Default max steps for agent sessions */
const DEFAULT_MAX_STEPS = 200;

/** Default max steps for simple/utility clients */
const DEFAULT_SIMPLE_MAX_STEPS = 1;

// =============================================================================
// createAgentClient
// =============================================================================

/**
 * Create a fully configured agent client with tools, MCP servers, and security.
 *
 * This is the primary entry point for creating agent sessions.
 * It resolves credentials, initializes MCP connections, binds tools to context,
 * and returns everything needed for `runAgentSession()`.
 *
 * @example
 * ```ts
 * const client = await createAgentClient({
 *   agentType: 'coder',
 *   systemPrompt: coderPrompt,
 *   toolContext: { cwd, projectDir, specDir, securityProfile },
 *   phase: 'coding',
 * });
 *
 * try {
 *   const result = await runAgentSession({ ...client });
 * } finally {
 *   await client.cleanup();
 * }
 * ```
 */
export async function createAgentClient(
  config: AgentClientConfig,
): Promise<AgentClientResult> {
  const {
    agentType,
    systemPrompt,
    toolContext,
    phase,
    modelShorthand,
    thinkingLevel,
    maxSteps = DEFAULT_MAX_STEPS,
    profileId,
    additionalMcpServers,
    queueConfig,
  } = config;

  // 1 & 2. Resolve model + auth credentials
  let model;
  let resolvedThinkingLevel: ThinkingLevel;
  let queueAuth: QueueResolvedAuth | null = null;

  if (queueConfig) {
    // Queue-based resolution: use global priority queue
    queueAuth = await resolveAuthFromQueue(
      queueConfig.requestedModel,
      queueConfig.queue,
      {
        excludeAccountIds: queueConfig.excludeAccountIds,
        userModelOverrides: queueConfig.userModelOverrides as any,
      }
    );

    if (!queueAuth) {
      throw new Error('No available account in priority queue for model: ' + queueConfig.requestedModel);
    }

    // Use createProvider() with the queue-resolved provider to avoid re-detecting
    // from model ID prefix. This is critical for providers like Ollama whose models
    // (e.g., 'llama3.1:8b') don't follow predictable prefix conventions.
    model = createProvider({
      config: {
        provider: queueAuth.resolvedProvider,
        apiKey: queueAuth.apiKey,
        baseURL: queueAuth.baseURL,
        headers: queueAuth.headers,
        oauthTokenFilePath: queueAuth.oauthTokenFilePath,
      },
      modelId: queueAuth.resolvedModelId,
    });

    // Derive thinking level from reasoning config
    resolveReasoningParams(queueAuth.reasoningConfig);
    resolvedThinkingLevel = (queueAuth.reasoningConfig.level as ThinkingLevel) ??
      thinkingLevel ?? getDefaultThinkingLevel(agentType);
  } else {
    // Legacy per-provider resolution
    const modelId = resolveModelId(modelShorthand ?? phase);
    const detectedProvider = detectProviderFromModel(modelId) ?? 'anthropic';
    const auth = await resolveAuth({
      provider: detectedProvider,
      profileId,
    });

    model = createProvider({
      config: {
        provider: detectedProvider,
        apiKey: auth?.apiKey,
        baseURL: auth?.baseURL,
        headers: auth?.headers,
        oauthTokenFilePath: auth?.oauthTokenFilePath,
      },
      modelId,
    });

    resolvedThinkingLevel = thinkingLevel ?? getDefaultThinkingLevel(agentType);
  }

  // 3. (Thinking level resolved above)

  // 4. Bind builtin tools via ToolRegistry
  const registry = buildToolRegistry();
  const tools: Record<string, AITool> = registry.getToolsForAgent(
    agentType,
    toolContext,
  );

  // 5. Initialize MCP servers and merge tools
  const mcpResolveOptions: McpServerResolveOptions = {};
  let mcpClients: McpClientResult[] = [];

  const mcpServerIds = getRequiredMcpServers(agentType, mcpResolveOptions);
  if (additionalMcpServers) {
    mcpServerIds.push(...additionalMcpServers);
  }

  if (mcpServerIds.length > 0) {
    mcpClients = await createMcpClientsForAgent(agentType, mcpResolveOptions);

    // Merge MCP tools into the tool map
    const mcpTools = mergeMcpTools(mcpClients);
    Object.assign(tools, mcpTools);
  }

  // 6. Build cleanup function
  const cleanup = async (): Promise<void> => {
    await closeAllMcpClients(mcpClients);
  };

  return {
    model,
    tools,
    mcpClients,
    systemPrompt,
    maxSteps,
    thinkingLevel: resolvedThinkingLevel,
    cleanup,
    ...(queueAuth ? { queueAuth } : {}),
  };
}

// =============================================================================
// createSimpleClient
// =============================================================================

/**
 * Create a lightweight client for utility runners.
 * No MCP servers, minimal tool setup.
 *
 * @example
 * ```ts
 * const client = createSimpleClient({
 *   systemPrompt: 'Generate a commit message...',
 *   modelShorthand: 'haiku',
 * });
 * ```
 */
export async function createSimpleClient(
  config: SimpleClientConfig,
): Promise<SimpleClientResult> {
  const {
    systemPrompt,
    modelShorthand = 'haiku',
    thinkingLevel = 'low',
    profileId,
    maxSteps = DEFAULT_SIMPLE_MAX_STEPS,
    tools = {},
    queueConfig: explicitQueueConfig,
  } = config;

  // Auto-build queue config from settings if none was explicitly provided.
  const queueConfig = explicitQueueConfig ?? buildDefaultQueueConfig(resolveModelId(modelShorthand));

  // Resolve model + auth
  let model;
  let resolvedModelId: string;
  let resolvedThinkingLevel: ThinkingLevel = thinkingLevel;
  let queueAuth: QueueResolvedAuth | null = null;

  if (queueConfig) {
    // Queue-based resolution: use global priority queue
    const excludeAccountIds = (queueConfig as { excludeAccountIds?: string[] }).excludeAccountIds;
    const userModelOverrides = (queueConfig as { userModelOverrides?: Record<string, unknown> }).userModelOverrides;
    queueAuth = await resolveAuthFromQueue(
      queueConfig.requestedModel,
      queueConfig.queue,
      {
        excludeAccountIds,
        userModelOverrides: userModelOverrides as any,
      }
    );

    if (!queueAuth) {
      throw new Error('No available account in priority queue for model: ' + queueConfig.requestedModel);
    }

    resolvedModelId = queueAuth.resolvedModelId;
    // Use createProvider() with the queue-resolved provider to avoid re-detecting
    // from model ID prefix. This is critical for providers like Ollama whose models
    // (e.g., 'llama3.1:8b') don't follow predictable prefix conventions.
    model = createProvider({
      config: {
        provider: queueAuth.resolvedProvider,
        apiKey: queueAuth.apiKey,
        baseURL: queueAuth.baseURL,
        headers: queueAuth.headers,
        oauthTokenFilePath: queueAuth.oauthTokenFilePath,
      },
      modelId: resolvedModelId,
    });

    resolveReasoningParams(queueAuth.reasoningConfig);
    resolvedThinkingLevel = (queueAuth.reasoningConfig.level as ThinkingLevel) ?? thinkingLevel;
  } else {
    // Legacy per-provider resolution
    resolvedModelId = resolveModelId(modelShorthand);
    const detectedProvider = detectProviderFromModel(resolvedModelId) ?? 'anthropic';
    const auth = await resolveAuth({
      provider: detectedProvider,
      profileId,
    });

    model = createProvider({
      config: {
        provider: detectedProvider,
        apiKey: auth?.apiKey,
        baseURL: auth?.baseURL,
        headers: auth?.headers,
        oauthTokenFilePath: auth?.oauthTokenFilePath,
      },
      modelId: resolvedModelId,
    });
  }

  return {
    model,
    resolvedModelId,
    tools,
    systemPrompt,
    maxSteps,
    thinkingLevel: resolvedThinkingLevel,
    ...(queueAuth ? { queueAuth } : {}),
  };
}
