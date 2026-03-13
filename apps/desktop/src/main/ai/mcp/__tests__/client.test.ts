/**
 * Tests for MCP Client
 *
 * Validates transport creation, client initialization, parallel agent setup,
 * tool merging, and cleanup behavior.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock @ai-sdk/mcp using inline factory to avoid vi.mock hoisting issues
vi.mock('@ai-sdk/mcp', () => ({
  createMCPClient: vi.fn(),
}));

// Mock StdioClientTransport constructor using a proper constructor function
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test mock constructor
  StdioClientTransport: vi.fn().mockImplementation(function (this: any) {
    Object.assign(this, { __kind: 'stdio-transport' });
  }),
}));

// Mock registry to control which servers get resolved
vi.mock('../registry', () => ({
  resolveMcpServers: vi.fn(),
}));

// Mock agent-configs to control required servers
vi.mock('../../config/agent-configs', () => ({
  getRequiredMcpServers: vi.fn().mockReturnValue([]),
}));

import { createMCPClient } from '@ai-sdk/mcp';
import type { MCPClient } from '@ai-sdk/mcp';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveMcpServers } from '../registry';
import { getRequiredMcpServers } from '../../config/agent-configs';
import type { McpServerResolveOptions } from '../../config/agent-configs';
import {
  createMcpClient,
  createMcpClientsForAgent,
  closeAllMcpClients,
  mergeMcpTools,
} from '../client';
import type { McpServerConfig } from '../types';

const mockCreateMCPClient = vi.mocked(createMCPClient);
const mockStdioClientTransport = vi.mocked(StdioClientTransport);
const mockResolveMcpServers = vi.mocked(resolveMcpServers);
const mockGetRequiredMcpServers = vi.mocked(getRequiredMcpServers);

// Sentinel: what StdioClientTransport instances look like after construction
const FAKE_STDIO_TRANSPORT_PROPS = { __kind: 'stdio-transport' };

// Helper: build a mock MCP client instance
function makeMockMcpInstance(tools = { tool_a: {}, tool_b: {} }) {
  return {
    tools: vi.fn().mockResolvedValue(tools),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// Helpers: server configs
const stdioConfig: McpServerConfig = {
  id: 'test-stdio',
  name: 'Test Stdio Server',
  description: 'A test stdio server',
  enabledByDefault: true,
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'some-mcp-server'],
    env: { MY_VAR: 'value' },
  },
};

const httpConfig: McpServerConfig = {
  id: 'test-http',
  name: 'Test HTTP Server',
  description: 'A test streamable-http server',
  enabledByDefault: true,
  transport: {
    type: 'streamable-http',
    url: 'https://mcp.example.com/sse',
    headers: { Authorization: 'Bearer token123' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: StdioClientTransport constructor sets __kind on instance
  // biome-ignore lint/suspicious/noExplicitAny: test mock constructor
  mockStdioClientTransport.mockImplementation(function (this: any) {
    Object.assign(this, FAKE_STDIO_TRANSPORT_PROPS);
  } as unknown as typeof StdioClientTransport);
  // Default: createMCPClient returns a standard mock instance
  mockCreateMCPClient.mockResolvedValue(makeMockMcpInstance() as unknown as MCPClient);
  mockGetRequiredMcpServers.mockReturnValue([]);
  mockResolveMcpServers.mockReturnValue([]);
});

// =============================================================================
// createMcpClient — transport creation
// =============================================================================

describe('createMcpClient', () => {
  it('creates a StdioClientTransport for stdio server config', async () => {
    await createMcpClient(stdioConfig);

    expect(mockStdioClientTransport).toHaveBeenCalledWith({
      command: 'npx',
      args: ['-y', 'some-mcp-server'],
      env: expect.objectContaining({ MY_VAR: 'value' }),
      cwd: undefined,
    });
    // The transport passed to createMCPClient is an instance of the mocked StdioClientTransport
    expect(mockCreateMCPClient).toHaveBeenCalledWith({
      transport: expect.objectContaining(FAKE_STDIO_TRANSPORT_PROPS),
    });
  });

  it('creates an SSE transport object for streamable-http config', async () => {
    await createMcpClient(httpConfig);

    expect(mockCreateMCPClient).toHaveBeenCalledWith({
      transport: {
        type: 'sse',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer token123' },
      },
    });
    // StdioClientTransport should NOT be called for HTTP config
    expect(mockStdioClientTransport).not.toHaveBeenCalled();
  });

  it('returns a result with serverId, tools, and close function', async () => {
    const result = await createMcpClient(stdioConfig);

    expect(result.serverId).toBe('test-stdio');
    expect(result.tools).toEqual({ tool_a: {}, tool_b: {} });
    expect(typeof result.close).toBe('function');
  });

  it('merges process.env with server env for stdio transport', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/usr/bin';

    await createMcpClient(stdioConfig);

    expect(mockStdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ PATH: '/usr/bin', MY_VAR: 'value' }),
      }),
    );

    process.env.PATH = originalPath;
  });

  it('passes undefined env to StdioClientTransport when no env in config', async () => {
    const noEnvConfig: McpServerConfig = {
      ...stdioConfig,
      transport: { type: 'stdio', command: 'node', args: ['server.js'] },
    };

    await createMcpClient(noEnvConfig);

    expect(mockStdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({ env: undefined }),
    );
  });

  it('close() delegates to the underlying MCP client close method', async () => {
    const mockInstance = makeMockMcpInstance();
    mockCreateMCPClient.mockResolvedValueOnce(mockInstance as unknown as MCPClient);

    const result = await createMcpClient(stdioConfig);
    await result.close();

    expect(mockInstance.close).toHaveBeenCalled();
  });
});

// =============================================================================
// createMcpClientsForAgent
// =============================================================================

describe('createMcpClientsForAgent', () => {
  it('returns empty array when agent requires no MCP servers', async () => {
    mockGetRequiredMcpServers.mockReturnValueOnce([]);
    mockResolveMcpServers.mockReturnValueOnce([]);

    const clients = await createMcpClientsForAgent('commit_message');

    expect(clients).toEqual([]);
  });

  it('creates clients for each resolved server config', async () => {
    mockGetRequiredMcpServers.mockReturnValueOnce(['context7', 'auto-claude']);
    mockResolveMcpServers.mockReturnValueOnce([
      { ...stdioConfig, id: 'context7' },
      { ...stdioConfig, id: 'auto-claude' },
    ]);
    // Two separate mock instances for the two servers
    mockCreateMCPClient
      .mockResolvedValueOnce(makeMockMcpInstance() as unknown as MCPClient)
      .mockResolvedValueOnce(makeMockMcpInstance() as unknown as MCPClient);

    const clients = await createMcpClientsForAgent('coder');

    expect(clients).toHaveLength(2);
    expect(clients[0].serverId).toBe('context7');
    expect(clients[1].serverId).toBe('auto-claude');
  });

  it('skips failed connections without throwing', async () => {
    mockGetRequiredMcpServers.mockReturnValueOnce(['context7', 'broken-server']);
    mockResolveMcpServers.mockReturnValueOnce([
      { ...stdioConfig, id: 'context7' },
      { ...stdioConfig, id: 'broken-server' },
    ]);

    // First call succeeds, second call fails
    mockCreateMCPClient
      .mockResolvedValueOnce(makeMockMcpInstance() as unknown as MCPClient)
      .mockRejectedValueOnce(new Error('connection refused'));

    const clients = await createMcpClientsForAgent('coder');

    // Only the successful client should be returned
    expect(clients).toHaveLength(1);
    expect(clients[0].serverId).toBe('context7');
  });

  it('passes resolveOptions to getRequiredMcpServers', async () => {
    mockGetRequiredMcpServers.mockReturnValueOnce([]);
    mockResolveMcpServers.mockReturnValueOnce([]);

    const resolveOptions = { electronMcpEnabled: true };
    await createMcpClientsForAgent('qa_reviewer', resolveOptions as unknown as McpServerResolveOptions);

    expect(mockGetRequiredMcpServers).toHaveBeenCalledWith('qa_reviewer', resolveOptions);
  });
});

// =============================================================================
// mergeMcpTools
// =============================================================================

describe('mergeMcpTools', () => {
  it('merges tools from multiple clients into a single object', () => {
    const clients = [
      { serverId: 'a', tools: { tool1: {}, tool2: {} }, close: vi.fn() },
      { serverId: 'b', tools: { tool3: {}, tool4: {} }, close: vi.fn() },
    ];

    const merged = mergeMcpTools(clients);

    expect(Object.keys(merged)).toHaveLength(4);
    expect(merged).toHaveProperty('tool1');
    expect(merged).toHaveProperty('tool3');
  });

  it('returns empty object for empty clients array', () => {
    expect(mergeMcpTools([])).toEqual({});
  });

  it('later client tools overwrite earlier ones on key collision', () => {
    const clients = [
      { serverId: 'a', tools: { shared_tool: { version: 1 } }, close: vi.fn() },
      { serverId: 'b', tools: { shared_tool: { version: 2 } }, close: vi.fn() },
    ];

    const merged = mergeMcpTools(clients);

    // biome-ignore lint/suspicious/noExplicitAny: test mock property access
    expect((merged.shared_tool as any).version).toBe(2);
  });
});

// =============================================================================
// closeAllMcpClients
// =============================================================================

describe('closeAllMcpClients', () => {
  it('calls close on all clients', async () => {
    const close1 = vi.fn().mockResolvedValue(undefined);
    const close2 = vi.fn().mockResolvedValue(undefined);
    const clients = [
      { serverId: 'a', tools: {}, close: close1 },
      { serverId: 'b', tools: {}, close: close2 },
    ];

    await closeAllMcpClients(clients);

    expect(close1).toHaveBeenCalled();
    expect(close2).toHaveBeenCalled();
  });

  it('resolves even when one client fails to close', async () => {
    const close1 = vi.fn().mockResolvedValue(undefined);
    const close2 = vi.fn().mockRejectedValue(new Error('close failed'));
    const clients = [
      { serverId: 'a', tools: {}, close: close1 },
      { serverId: 'b', tools: {}, close: close2 },
    ];

    // Should not throw
    await expect(closeAllMcpClients(clients)).resolves.toBeUndefined();
    expect(close1).toHaveBeenCalled();
    expect(close2).toHaveBeenCalled();
  });

  it('resolves immediately for empty clients array', async () => {
    await expect(closeAllMcpClients([])).resolves.toBeUndefined();
  });
});
