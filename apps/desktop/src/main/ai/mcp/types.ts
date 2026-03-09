/**
 * MCP Client and Server Types
 * ============================
 *
 * Type definitions for MCP (Model Context Protocol) server configurations
 * used by the AI SDK integration layer.
 */

// =============================================================================
// Transport Types
// =============================================================================

/** Supported MCP transport types */
export type McpTransportType = 'stdio' | 'streamable-http';

/** Configuration for stdio-based MCP transport */
export interface StdioTransportConfig {
  type: 'stdio';
  /** Command to launch the MCP server process */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Environment variables for the process */
  env?: Record<string, string>;
  /** Working directory for the process */
  cwd?: string;
}

/** Configuration for StreamableHTTP-based MCP transport */
export interface StreamableHttpTransportConfig {
  type: 'streamable-http';
  /** URL of the MCP server */
  url: string;
  /** Optional headers for authentication */
  headers?: Record<string, string>;
}

/** Union of all transport configurations */
export type McpTransportConfig = StdioTransportConfig | StreamableHttpTransportConfig;

// =============================================================================
// Server Configuration
// =============================================================================

/** Internal MCP server identifier */
export type McpServerId =
  | 'context7'
  | 'linear'
  | 'memory'
  | 'electron'
  | 'puppeteer'
  | 'auto-claude';

/** Configuration for a single MCP server */
export interface McpServerConfig {
  /** Unique server identifier */
  id: McpServerId | string;
  /** Human-readable display name */
  name: string;
  /** Transport configuration */
  transport: McpTransportConfig;
  /** Whether this server is enabled by default */
  enabledByDefault: boolean;
  /** Description of what this server provides */
  description?: string;
}

// =============================================================================
// Client Types
// =============================================================================

/** Options for creating an MCP client */
export interface McpClientOptions {
  /** Server configuration to connect to */
  server: McpServerConfig;
  /** Timeout for operations in milliseconds */
  timeoutMs?: number;
  /** Callback for connection errors */
  onError?: (error: Error) => void;
}

/** Result of initializing MCP clients for an agent */
export interface McpClientResult {
  /** Server ID */
  serverId: string;
  /** Tools discovered from the MCP server */
  tools: Record<string, unknown>;
  /** Cleanup function to close the connection */
  close: () => Promise<void>;
}
