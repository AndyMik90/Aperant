/**
 * MCP Server API
 *
 * Exposes MCP health check, connection test, and global MCP configuration
 * functionality to the renderer.
 */

import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants/ipc';
import type { IPCResult } from '../../../shared/types/common';
import type { CustomMcpServer, McpHealthCheckResult, McpTestConnectionResult } from '../../../shared/types/project';
import type { GlobalMcpInfo, ClaudeAgentsInfo } from '../../../shared/types/integrations';

export interface McpAPI {
  /** Quick health check for a custom MCP server */
  checkMcpHealth: (server: CustomMcpServer) => Promise<IPCResult<McpHealthCheckResult>>;
  /** Full MCP connection test */
  testMcpConnection: (server: CustomMcpServer) => Promise<IPCResult<McpTestConnectionResult>>;
  /** Get all global MCP servers from Claude Code settings (plugins + inline) */
  getGlobalMcps: () => Promise<IPCResult<GlobalMcpInfo>>;
  /** Get all custom agents from ~/.claude/agents/ */
  getClaudeAgents: () => Promise<IPCResult<ClaudeAgentsInfo>>;
}

export function createMcpAPI(): McpAPI {
  return {
    checkMcpHealth: (server: CustomMcpServer) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_CHECK_HEALTH, server),

    testMcpConnection: (server: CustomMcpServer) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_TEST_CONNECTION, server),

    getGlobalMcps: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_MCP_GET_GLOBAL),

    getClaudeAgents: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_AGENTS_GET),
  };
}
