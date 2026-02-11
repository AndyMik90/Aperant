/**
 * MCP Server API
 *
 * Exposes MCP health check and connection test functionality to the renderer.
 */

import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants/ipc';
import type { IPCResult } from '@auto-claude/types';
import type { CustomMcpServer, McpHealthCheckResult, McpTestConnectionResult } from '../../../shared/types/project';

export interface McpAPI {
  /** Quick health check for a custom MCP server */
  checkMcpHealth: (server: CustomMcpServer) => Promise<IPCResult<McpHealthCheckResult>>;
  /** Full MCP connection test */
  testMcpConnection: (server: CustomMcpServer) => Promise<IPCResult<McpTestConnectionResult>>;
}

export function createMcpAPI(): McpAPI {
  return {
    checkMcpHealth: (server: CustomMcpServer) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_CHECK_HEALTH, server),

    testMcpConnection: (server: CustomMcpServer) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_TEST_CONNECTION, server),
  };
}
