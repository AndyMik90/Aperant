/**
 * Agent Configuration Registry
 * =============================
 *
 * See apps/desktop/src/main/ai/config/agent-configs.ts (originally from Python agents/tools_pkg/models)
 *
 * Single source of truth for agent type → tools → MCP servers mapping.
 * This enables phase-aware tool control and context window optimization.
 *
 * Tool lists are organized by category:
 * - Base tools: Core file operations (Read, Write, Edit, etc.)
 * - Web tools: Documentation and research (WebFetch, WebSearch)
 * - MCP tools: External integrations (Context7, Linear, Memory, etc.)
 * - Auto-Claude tools: Custom build management tools
 */

import type { ThinkingLevel } from './types';

// =============================================================================
// Base Tools (Built-in Claude Code tools)
// =============================================================================

/** Core file reading tools */
const BASE_READ_TOOLS = ['Read', 'Glob', 'Grep'] as const;

/** Core file writing tools */
const BASE_WRITE_TOOLS = ['Write', 'Edit', 'Bash'] as const;

/** Web tools for documentation lookup and research */
const WEB_TOOLS = ['WebFetch', 'WebSearch'] as const;

/** All builtin tools — given to most agents since security is enforced at the tool execution layer */
const ALL_BUILTIN_TOOLS = [...BASE_READ_TOOLS, ...BASE_WRITE_TOOLS, ...WEB_TOOLS] as const;

/** Spec pipeline tools — read codebase + write to spec dir + web research. No Edit, no Bash. */
const SPEC_TOOLS = [...BASE_READ_TOOLS, 'Write', ...WEB_TOOLS] as const;

// =============================================================================
// Auto-Claude MCP Tools (Custom build management)
// =============================================================================

const TOOL_UPDATE_SUBTASK_STATUS = 'mcp__auto-claude__update_subtask_status';
const TOOL_GET_BUILD_PROGRESS = 'mcp__auto-claude__get_build_progress';
const TOOL_RECORD_DISCOVERY = 'mcp__auto-claude__record_discovery';
const TOOL_RECORD_GOTCHA = 'mcp__auto-claude__record_gotcha';
const TOOL_GET_SESSION_CONTEXT = 'mcp__auto-claude__get_session_context';
const TOOL_UPDATE_QA_STATUS = 'mcp__auto-claude__update_qa_status';

// =============================================================================
// External MCP Tools
// =============================================================================

/** Context7 MCP tools for documentation lookup (always enabled) */
export const CONTEXT7_TOOLS = [
  'mcp__context7__resolve-library-id',
  'mcp__context7__query-docs',
] as const;

/** Linear MCP tools for project management (when LINEAR_API_KEY is set) */
export const LINEAR_TOOLS = [
  'mcp__linear-server__list_teams',
  'mcp__linear-server__get_team',
  'mcp__linear-server__list_projects',
  'mcp__linear-server__get_project',
  'mcp__linear-server__create_project',
  'mcp__linear-server__update_project',
  'mcp__linear-server__list_issues',
  'mcp__linear-server__get_issue',
  'mcp__linear-server__create_issue',
  'mcp__linear-server__update_issue',
  'mcp__linear-server__list_comments',
  'mcp__linear-server__create_comment',
  'mcp__linear-server__list_issue_statuses',
  'mcp__linear-server__list_issue_labels',
  'mcp__linear-server__list_users',
  'mcp__linear-server__get_user',
] as const;

/** Memory MCP tools for knowledge graph memory (when GRAPHITI_MCP_URL is set) */
export const MEMORY_MCP_TOOLS = [
  'mcp__graphiti-memory__search_nodes',
  'mcp__graphiti-memory__search_facts',
  'mcp__graphiti-memory__add_episode',
  'mcp__graphiti-memory__get_episodes',
  'mcp__graphiti-memory__get_entity_edge',
] as const;

/** @deprecated Use MEMORY_MCP_TOOLS instead */
export const GRAPHITI_MCP_TOOLS = MEMORY_MCP_TOOLS;

// =============================================================================
// Browser Automation MCP Tools (QA agents only)
// =============================================================================

/** Puppeteer MCP tools for web browser automation */
export const PUPPETEER_TOOLS = [
  'mcp__puppeteer__puppeteer_connect_active_tab',
  'mcp__puppeteer__puppeteer_navigate',
  'mcp__puppeteer__puppeteer_screenshot',
  'mcp__puppeteer__puppeteer_click',
  'mcp__puppeteer__puppeteer_fill',
  'mcp__puppeteer__puppeteer_select',
  'mcp__puppeteer__puppeteer_hover',
  'mcp__puppeteer__puppeteer_evaluate',
] as const;

/** Electron MCP tools for desktop app automation (when ELECTRON_MCP_ENABLED is set) */
export const ELECTRON_TOOLS = [
  'mcp__electron__get_electron_window_info',
  'mcp__electron__take_screenshot',
  'mcp__electron__send_command_to_electron',
  'mcp__electron__read_electron_logs',
] as const;

// =============================================================================
// Agent Type
// =============================================================================

/** All known agent types */
export type AgentType =
  | 'spec_gatherer'
  | 'spec_researcher'
  | 'spec_writer'
  | 'spec_critic'
  | 'spec_discovery'
  | 'spec_context'
  | 'spec_validation'
  | 'spec_compaction'
  | 'spec_orchestrator'
  | 'build_orchestrator'
  | 'planner'
  | 'coder'
  | 'qa_reviewer'
  | 'qa_fixer'
  | 'insights'
  | 'merge_resolver'
  | 'commit_message'
  | 'pr_template_filler'
  | 'pr_reviewer'
  | 'pr_orchestrator_parallel'
  | 'pr_followup_parallel'
  | 'pr_followup_extraction'
  | 'pr_finding_validator'
  | 'pr_security_specialist'
  | 'pr_quality_specialist'
  | 'pr_logic_specialist'
  | 'pr_codebase_fit_specialist'
  | 'analysis'
  | 'batch_analysis'
  | 'batch_validation'
  | 'roadmap_discovery'
  | 'competitor_analysis'
  | 'ideation';

/** Configuration for a single agent type */
export interface AgentConfig {
  /** Tools available to this agent */
  tools: readonly string[];
  /** MCP servers to start for this agent */
  mcpServers: readonly string[];
  /** Optional MCP servers (conditionally enabled) */
  mcpServersOptional?: readonly string[];
  /** Auto-Claude MCP tools this agent can use */
  autoClaudeTools: readonly string[];
  /** Default thinking level for this agent */
  thinkingDefault: ThinkingLevel;
}

// =============================================================================
// Agent Configuration Registry
// =============================================================================

/**
 * Single source of truth for agent type → tools → MCP servers mapping.
 * See apps/desktop/src/main/ai/config/agent-configs.ts for the full TypeScript implementation.
 */
export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  // ═══════════════════════════════════════════════════════════════════════
  // SPEC CREATION PHASES (Minimal tools, fast startup)
  // ═══════════════════════════════════════════════════════════════════════
  spec_gatherer: {
    tools: [...SPEC_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  spec_researcher: {
    tools: [...SPEC_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  spec_writer: {
    tools: [...SPEC_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  spec_critic: {
    tools: [...SPEC_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  spec_discovery: {
    tools: [...SPEC_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  spec_context: {
    tools: [...SPEC_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  spec_validation: {
    tools: [...SPEC_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  spec_compaction: {
    tools: [...SPEC_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },

  /**
   * Spec Orchestrator — entry point for the full spec creation pipeline.
   * Drives spec_gatherer → spec_researcher → spec_writer → spec_critic pipeline.
   * Needs full tool access to read/write spec files and research documentation.
   */
  spec_orchestrator: {
    tools: [...ALL_BUILTIN_TOOLS, 'SpawnSubagent'],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },

  /**
   * Build Orchestrator — entry point for the full build pipeline.
   * Drives planner → coder → qa_reviewer → qa_fixer pipeline.
   * Needs full tool access with MCP integrations.
   */
  build_orchestrator: {
    tools: [...ALL_BUILTIN_TOOLS, 'SpawnSubagent'],
    mcpServers: ['context7', 'memory', 'auto-claude'],
    mcpServersOptional: ['linear'],
    autoClaudeTools: [
      TOOL_GET_BUILD_PROGRESS,
      TOOL_GET_SESSION_CONTEXT,
      TOOL_RECORD_DISCOVERY,
      TOOL_UPDATE_SUBTASK_STATUS,
    ],
    thinkingDefault: 'high',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BUILD PHASES (Full tools + memory)
  // Note: "linear" is conditional on project setting "update_linear_with_tasks"
  // ═══════════════════════════════════════════════════════════════════════
  planner: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: ['context7', 'memory', 'auto-claude'],
    mcpServersOptional: ['linear'],
    autoClaudeTools: [
      TOOL_GET_BUILD_PROGRESS,
      TOOL_GET_SESSION_CONTEXT,
      TOOL_RECORD_DISCOVERY,
    ],
    thinkingDefault: 'high',
  },
  coder: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: ['context7', 'memory', 'auto-claude'],
    mcpServersOptional: ['linear'],
    autoClaudeTools: [
      TOOL_UPDATE_SUBTASK_STATUS,
      TOOL_GET_BUILD_PROGRESS,
      TOOL_RECORD_DISCOVERY,
      TOOL_RECORD_GOTCHA,
      TOOL_GET_SESSION_CONTEXT,
    ],
    thinkingDefault: 'low',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // QA PHASES (Read + test + browser + memory)
  // ═══════════════════════════════════════════════════════════════════════
  qa_reviewer: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: ['context7', 'memory', 'auto-claude', 'browser'],
    mcpServersOptional: ['linear'],
    autoClaudeTools: [
      TOOL_GET_BUILD_PROGRESS,
      TOOL_UPDATE_QA_STATUS,
      TOOL_GET_SESSION_CONTEXT,
    ],
    thinkingDefault: 'high',
  },
  qa_fixer: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: ['context7', 'memory', 'auto-claude', 'browser'],
    mcpServersOptional: ['linear'],
    autoClaudeTools: [
      TOOL_UPDATE_SUBTASK_STATUS,
      TOOL_GET_BUILD_PROGRESS,
      TOOL_UPDATE_QA_STATUS,
      TOOL_RECORD_GOTCHA,
    ],
    thinkingDefault: 'medium',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // UTILITY PHASES (Minimal, no MCP)
  // ═══════════════════════════════════════════════════════════════════════
  insights: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  merge_resolver: {
    tools: [],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  commit_message: {
    tools: [],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  pr_template_filler: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  pr_reviewer: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  pr_orchestrator_parallel: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  pr_followup_parallel: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  pr_followup_extraction: {
    tools: [],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  pr_finding_validator: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  pr_security_specialist: {
    tools: [...BASE_READ_TOOLS],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  pr_quality_specialist: {
    tools: [...BASE_READ_TOOLS],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  pr_logic_specialist: {
    tools: [...BASE_READ_TOOLS],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  pr_codebase_fit_specialist: {
    tools: [...BASE_READ_TOOLS],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ANALYSIS PHASES
  // ═══════════════════════════════════════════════════════════════════════
  analysis: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  batch_analysis: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  batch_validation: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ROADMAP & IDEATION
  // ═══════════════════════════════════════════════════════════════════════
  roadmap_discovery: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  competitor_analysis: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  ideation: {
    tools: [...ALL_BUILTIN_TOOLS],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
} as const;

// =============================================================================
// Agent Config Helper Functions
// =============================================================================

/**
 * Get full configuration for an agent type.
 *
 * @param agentType - The agent type identifier (e.g., 'coder', 'planner', 'qa_reviewer')
 * @returns Configuration for the agent type
 * @throws Error if agentType is not found in AGENT_CONFIGS
 */
export function getAgentConfig(agentType: AgentType): AgentConfig {
  const config = AGENT_CONFIGS[agentType];
  if (!config) {
    throw new Error(
      `Unknown agent type: '${agentType}'. Valid types: ${Object.keys(AGENT_CONFIGS).sort().join(', ')}`,
    );
  }
  return config;
}

/**
 * Get default thinking level for an agent type.
 *
 * @param agentType - The agent type identifier
 * @returns Thinking level string (low, medium, high)
 */
export function getDefaultThinkingLevel(agentType: AgentType): ThinkingLevel {
  return getAgentConfig(agentType).thinkingDefault;
}

/**
 * MCP server name mapping from user-friendly names to internal identifiers.
 */
const MCP_SERVER_NAME_MAP: Record<string, string> = {
  context7: 'context7',
  'graphiti-memory': 'memory',
  graphiti: 'memory',
  memory: 'memory',
  linear: 'linear',
  electron: 'electron',
  puppeteer: 'puppeteer',
  'auto-claude': 'auto-claude',
};

/**
 * Map a user-friendly MCP server name to its internal identifier.
 *
 * @param name - User-provided MCP server name
 * @param customServerIds - Optional list of custom server IDs to accept as-is
 * @returns Internal server identifier or null if not recognized
 */
export function mapMcpServerName(
  name: string,
  customServerIds?: string[],
): string | null {
  if (!name) return null;

  const mapped = MCP_SERVER_NAME_MAP[name.toLowerCase().trim()];
  if (mapped) return mapped;

  if (customServerIds?.includes(name)) return name;

  return null;
}

/** Options for resolving required MCP servers */
export interface McpServerResolveOptions {
  /** Project capabilities from detect_project_capabilities() */
  projectCapabilities?: {
    is_electron?: boolean;
    is_web_frontend?: boolean;
  };
  /** Whether Linear integration is enabled for this project */
  linearEnabled?: boolean;
  /** Whether memory MCP is available (GRAPHITI_MCP_URL is set) */
  memoryEnabled?: boolean;
  /** Whether Electron MCP is enabled */
  electronMcpEnabled?: boolean;
  /** Whether Puppeteer MCP is enabled */
  puppeteerMcpEnabled?: boolean;
  /** Whether Context7 is enabled (default: true) */
  context7Enabled?: boolean;
  /** Per-agent MCP additions (comma-separated server names) */
  agentMcpAdd?: string;
  /** Per-agent MCP removals (comma-separated server names) */
  agentMcpRemove?: string;
  /** Custom MCP server IDs to recognize */
  customServerIds?: string[];
}

/**
 * Get MCP servers required for an agent type.
 *
 * Handles dynamic server selection:
 * - "browser" → electron (if is_electron) or puppeteer (if is_web_frontend)
 * - "linear" → only if in mcpServersOptional AND linearEnabled is true
 * - "memory" → only if memoryEnabled is true
 * - Applies per-agent ADD/REMOVE overrides
 *
 * @param agentType - The agent type identifier
 * @param options - Resolution options
 * @returns List of MCP server names to start
 */
export function getRequiredMcpServers(
  agentType: AgentType,
  options: McpServerResolveOptions = {},
): string[] {
  const config = getAgentConfig(agentType);
  const servers = [...config.mcpServers];

  // Filter context7 if explicitly disabled
  if (options.context7Enabled === false) {
    const idx = servers.indexOf('context7');
    if (idx !== -1) servers.splice(idx, 1);
  }

  // Handle optional servers (e.g., Linear)
  const optional = config.mcpServersOptional ?? [];
  if (optional.includes('linear') && options.linearEnabled) {
    servers.push('linear');
  }

  // Handle dynamic "browser" → electron/puppeteer
  const browserIdx = servers.indexOf('browser');
  if (browserIdx !== -1) {
    servers.splice(browserIdx, 1);
    const caps = options.projectCapabilities;
    if (caps) {
      if (caps.is_electron && options.electronMcpEnabled) {
        servers.push('electron');
      } else if (caps.is_web_frontend && !caps.is_electron && options.puppeteerMcpEnabled) {
        servers.push('puppeteer');
      }
    }
  }

  // Filter memory if not enabled
  if (!options.memoryEnabled) {
    const idx = servers.indexOf('memory');
    if (idx !== -1) servers.splice(idx, 1);
  }

  // Apply per-agent MCP additions
  if (options.agentMcpAdd) {
    for (const name of options.agentMcpAdd.split(',')) {
      const mapped = mapMcpServerName(name.trim(), options.customServerIds);
      if (mapped && !servers.includes(mapped)) {
        servers.push(mapped);
      }
    }
  }

  // Apply per-agent MCP removals (never remove auto-claude)
  if (options.agentMcpRemove) {
    for (const name of options.agentMcpRemove.split(',')) {
      const mapped = mapMcpServerName(name.trim(), options.customServerIds);
      if (mapped && mapped !== 'auto-claude') {
        const idx = servers.indexOf(mapped);
        if (idx !== -1) servers.splice(idx, 1);
      }
    }
  }

  return servers;
}
