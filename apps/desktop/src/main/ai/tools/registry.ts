/**
 * Tool Registry
 * =============
 *
 * See apps/desktop/src/main/ai/tools/registry.ts for the TypeScript implementation.
 *
 * Single source of truth for tool name constants, agent-to-tool mappings,
 * and the ToolRegistry class that resolves tools for a given agent type.
 */

import type { Tool as AITool } from 'ai';

import {
  type AgentConfig,
  type AgentType,
  AGENT_CONFIGS,
  CONTEXT7_TOOLS,
  ELECTRON_TOOLS,
  MEMORY_MCP_TOOLS,
  GRAPHITI_MCP_TOOLS,
  LINEAR_TOOLS,
  PUPPETEER_TOOLS,
  getAgentConfig,
  getDefaultThinkingLevel,
  mapMcpServerName,
} from '../config/agent-configs';
import type { DefinedTool } from './define';
import type { ToolContext } from './types';

export {
  type AgentConfig,
  type AgentType,
  AGENT_CONFIGS,
  CONTEXT7_TOOLS,
  ELECTRON_TOOLS,
  MEMORY_MCP_TOOLS,
  GRAPHITI_MCP_TOOLS,
  LINEAR_TOOLS,
  PUPPETEER_TOOLS,
  getAgentConfig,
  getDefaultThinkingLevel,
};

// Re-export tool name constants that were previously defined here
export const BASE_READ_TOOLS = ['Read', 'Glob', 'Grep'] as const;
export const BASE_WRITE_TOOLS = ['Write', 'Edit', 'Bash'] as const;
export const WEB_TOOLS = ['WebFetch', 'WebSearch'] as const;
export const TOOL_UPDATE_SUBTASK_STATUS = 'mcp__auto-claude__update_subtask_status';
export const TOOL_GET_BUILD_PROGRESS = 'mcp__auto-claude__get_build_progress';
export const TOOL_RECORD_DISCOVERY = 'mcp__auto-claude__record_discovery';
export const TOOL_RECORD_GOTCHA = 'mcp__auto-claude__record_gotcha';
export const TOOL_GET_SESSION_CONTEXT = 'mcp__auto-claude__get_session_context';
export const TOOL_UPDATE_QA_STATUS = 'mcp__auto-claude__update_qa_status';

// =============================================================================
// MCP Config for dynamic server resolution
// =============================================================================

export interface McpConfig {
  CONTEXT7_ENABLED?: string;
  LINEAR_MCP_ENABLED?: string;
  ELECTRON_MCP_ENABLED?: string;
  PUPPETEER_MCP_ENABLED?: string;
  CUSTOM_MCP_SERVERS?: Array<{ id: string }>;
  [key: string]: unknown;
}

export interface ProjectCapabilities {
  is_electron?: boolean;
  is_web_frontend?: boolean;
}

// =============================================================================
// ToolRegistry
// =============================================================================

/**
 * Registry for AI tools.
 *
 * Manages tool registration and provides agent-type-aware tool resolution
 * using the AGENT_CONFIGS mapping ported from Python.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, DefinedTool>();

  /**
   * Register a tool by name.
   */
  registerTool(name: string, definedTool: DefinedTool): void {
    this.tools.set(name, definedTool);
  }

  /**
   * Get a registered tool by name, or undefined if not found.
   */
  getTool(name: string): DefinedTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tool names.
   */
  getRegisteredNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get the AI SDK tool map for a given agent type, bound to the provided context.
   *
   * Filters registered tools to only those allowed by AGENT_CONFIGS for the
   * specified agent type. Returns a Record<string, AITool> suitable for passing
   * to the Vercel AI SDK `generateText` / `streamText` calls.
   */
  getToolsForAgent(
    agentType: AgentType,
    context: ToolContext,
  ): Record<string, AITool> {
    const config = getAgentConfig(agentType);
    const allowedNames = new Set(config.tools);
    const result: Record<string, AITool> = {};

    for (const [name, definedTool] of Array.from(this.tools.entries())) {
      if (allowedNames.has(name)) {
        result[name] = definedTool.bind(context);
      }
    }

    return result;
  }
}

/**
 * Get MCP servers required for an agent type.
 *
 * Handles dynamic server selection:
 * - "browser" → electron (if is_electron) or puppeteer (if is_web_frontend)
 * - "linear" → only if in mcpServersOptional AND linearEnabled is true
 * - "memory" → only if memoryEnabled is true
 * - Applies per-agent ADD/REMOVE overrides from mcpConfig
 */
export function getRequiredMcpServers(
  agentType: AgentType,
  options: {
    projectCapabilities?: ProjectCapabilities;
    linearEnabled?: boolean;
    memoryEnabled?: boolean;
    /** @deprecated Use memoryEnabled instead */
    graphitiEnabled?: boolean;
    mcpConfig?: McpConfig;
  } = {},
): string[] {
  const {
    projectCapabilities,
    linearEnabled = false,
    memoryEnabled = options.graphitiEnabled ?? false,
    mcpConfig = {},
  } = options;

  const config = getAgentConfig(agentType);
  let servers = [...config.mcpServers];

  // Filter context7 if explicitly disabled
  if (servers.includes('context7')) {
    const enabled = mcpConfig.CONTEXT7_ENABLED ?? 'true';
    if (String(enabled).toLowerCase() === 'false') {
      servers = servers.filter((s) => s !== 'context7');
    }
  }

  // Handle optional servers (e.g., Linear)
  const optional = config.mcpServersOptional ?? [];
  if (optional.includes('linear') && linearEnabled) {
    const linearMcpEnabled = mcpConfig.LINEAR_MCP_ENABLED ?? 'true';
    if (String(linearMcpEnabled).toLowerCase() !== 'false') {
      servers.push('linear');
    }
  }

  // Handle dynamic "browser" → electron/puppeteer
  if (servers.includes('browser')) {
    servers = servers.filter((s) => s !== 'browser');
    if (projectCapabilities) {
      const { is_electron, is_web_frontend } = projectCapabilities;
      const electronEnabled = mcpConfig.ELECTRON_MCP_ENABLED ?? 'false';
      const puppeteerEnabled = mcpConfig.PUPPETEER_MCP_ENABLED ?? 'false';

      if (is_electron && String(electronEnabled).toLowerCase() === 'true') {
        servers.push('electron');
      } else if (is_web_frontend && !is_electron) {
        if (String(puppeteerEnabled).toLowerCase() === 'true') {
          servers.push('puppeteer');
        }
      }
    }
  }

  // Filter memory if not enabled
  if (servers.includes('memory') && !memoryEnabled) {
    servers = servers.filter((s) => s !== 'memory');
  }

  // Per-agent MCP overrides: AGENT_MCP_<agent>_ADD / AGENT_MCP_<agent>_REMOVE
  const customServerIds =
    mcpConfig.CUSTOM_MCP_SERVERS?.map((s) => s.id).filter(Boolean) ?? [];

  const addKey = `AGENT_MCP_${agentType}_ADD`;
  const addValue = mcpConfig[addKey];
  if (typeof addValue === 'string') {
    const additions = addValue.split(',').map((s) => s.trim()).filter(Boolean);
    for (const server of additions) {
      const mapped = mapMcpServerName(server, customServerIds);
      if (mapped && !servers.includes(mapped)) {
        servers.push(mapped);
      }
    }
  }

  const removeKey = `AGENT_MCP_${agentType}_REMOVE`;
  const removeValue = mcpConfig[removeKey];
  if (typeof removeValue === 'string') {
    const removals = removeValue.split(',').map((s) => s.trim()).filter(Boolean);
    for (const server of removals) {
      const mapped = mapMcpServerName(server, customServerIds);
      if (mapped && mapped !== 'auto-claude') {
        servers = servers.filter((s) => s !== mapped);
      }
    }
  }

  return servers;
}
