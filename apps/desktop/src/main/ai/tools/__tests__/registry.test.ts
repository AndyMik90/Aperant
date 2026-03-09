import { describe, it, expect, vi } from 'vitest';

import {
  ToolRegistry,
  AGENT_CONFIGS,
  getAgentConfig,
  getDefaultThinkingLevel,
  getRequiredMcpServers,
  BASE_READ_TOOLS,
  BASE_WRITE_TOOLS,
  WEB_TOOLS,
  CONTEXT7_TOOLS,
  LINEAR_TOOLS,
  MEMORY_MCP_TOOLS, GRAPHITI_MCP_TOOLS,
  PUPPETEER_TOOLS,
  ELECTRON_TOOLS,
  type AgentType,
} from '../registry';
import type { DefinedTool } from '../define';
import type { ToolContext } from '../types';

// =============================================================================
// Helpers
// =============================================================================

function createMockDefinedTool(name: string): DefinedTool {
  return {
    metadata: {
      name,
      description: `Mock ${name} tool`,
      permission: 'auto' as const,
    },
    bind: vi.fn().mockReturnValue({ type: 'function' }),
  } as unknown as DefinedTool;
}

function createMockContext(): ToolContext {
  return {
    cwd: '/test',
    projectDir: '/test/project',
    specDir: '/test/spec',
    securityProfile: null,
    abortSignal: new AbortController().signal,
  } as unknown as ToolContext;
}

// =============================================================================
// Tool Constants
// =============================================================================

describe('tool constants', () => {
  it('BASE_READ_TOOLS should contain Read, Glob, Grep', () => {
    expect(BASE_READ_TOOLS).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('BASE_WRITE_TOOLS should contain Write, Edit, Bash', () => {
    expect(BASE_WRITE_TOOLS).toEqual(['Write', 'Edit', 'Bash']);
  });

  it('WEB_TOOLS should contain WebFetch, WebSearch', () => {
    expect(WEB_TOOLS).toEqual(['WebFetch', 'WebSearch']);
  });

  it('should export MCP tool arrays matching agent-configs', () => {
    expect(CONTEXT7_TOOLS).toHaveLength(2);
    expect(LINEAR_TOOLS).toHaveLength(16);
    expect(MEMORY_MCP_TOOLS).toHaveLength(5);
    expect(PUPPETEER_TOOLS).toHaveLength(8);
    expect(ELECTRON_TOOLS).toHaveLength(4);
  });
});

// =============================================================================
// AGENT_CONFIGS (registry version)
// =============================================================================

describe('AGENT_CONFIGS (registry)', () => {
  it('should have all expected agent types', () => {
    expect(Object.keys(AGENT_CONFIGS).length).toBeGreaterThanOrEqual(26);
  });

  it('should match tool assignments between config and registry', () => {
    // Coder should have read + write + web tools
    const coderConfig = AGENT_CONFIGS.coder;
    for (const tool of [...BASE_READ_TOOLS, ...BASE_WRITE_TOOLS, ...WEB_TOOLS]) {
      expect(coderConfig.tools).toContain(tool);
    }
  });
});

// =============================================================================
// ToolRegistry
// =============================================================================

describe('ToolRegistry', () => {
  it('should register and retrieve tools', () => {
    const registry = new ToolRegistry();
    const mockTool = createMockDefinedTool('Read');
    registry.registerTool('Read', mockTool);
    expect(registry.getTool('Read')).toBe(mockTool);
  });

  it('should return undefined for unregistered tools', () => {
    const registry = new ToolRegistry();
    expect(registry.getTool('NonExistent')).toBeUndefined();
  });

  it('should list all registered tool names', () => {
    const registry = new ToolRegistry();
    registry.registerTool('Read', createMockDefinedTool('Read'));
    registry.registerTool('Write', createMockDefinedTool('Write'));
    const names = registry.getRegisteredNames();
    expect(names).toContain('Read');
    expect(names).toContain('Write');
    expect(names).toHaveLength(2);
  });

  it('should return only allowed tools for an agent type', () => {
    const registry = new ToolRegistry();
    // Register all base tools
    for (const name of [...BASE_READ_TOOLS, ...BASE_WRITE_TOOLS, ...WEB_TOOLS]) {
      registry.registerTool(name, createMockDefinedTool(name));
    }

    const context = createMockContext();

    // spec_critic gets SPEC_TOOLS (Read, Glob, Grep, Write, WebFetch, WebSearch) — no Edit or Bash
    const criticTools = registry.getToolsForAgent('spec_critic', context);
    expect(Object.keys(criticTools)).toEqual(
      expect.arrayContaining([
        ...BASE_READ_TOOLS,
        'Write',
        ...WEB_TOOLS,
      ]),
    );
    expect(Object.keys(criticTools)).not.toContain('Edit');
    expect(Object.keys(criticTools)).not.toContain('Bash');

    // coder gets everything
    const coderTools = registry.getToolsForAgent('coder', context);
    expect(Object.keys(coderTools)).toEqual(
      expect.arrayContaining([
        ...BASE_READ_TOOLS,
        ...BASE_WRITE_TOOLS,
        ...WEB_TOOLS,
      ]),
    );
  });

  it('should bind tools with the provided context', () => {
    const registry = new ToolRegistry();
    const mockTool = createMockDefinedTool('Read');
    registry.registerTool('Read', mockTool);

    const context = createMockContext();
    registry.getToolsForAgent('spec_critic', context);

    expect(mockTool.bind).toHaveBeenCalledWith(context);
  });

  it('should return empty record for agents with no tools', () => {
    const registry = new ToolRegistry();
    // Register tools but merge_resolver has no tools
    registry.registerTool('Read', createMockDefinedTool('Read'));

    const context = createMockContext();
    const tools = registry.getToolsForAgent('merge_resolver', context);
    expect(Object.keys(tools)).toHaveLength(0);
  });
});

// =============================================================================
// getAgentConfig (registry version)
// =============================================================================

describe('getAgentConfig (registry)', () => {
  it('should return valid config for all agent types', () => {
    const allTypes = Object.keys(AGENT_CONFIGS) as AgentType[];
    for (const agentType of allTypes) {
      const config = getAgentConfig(agentType);
      expect(config.tools).toBeDefined();
      expect(config.thinkingDefault).toBeDefined();
    }
  });

  it('should throw for unknown agent type', () => {
    expect(() => getAgentConfig('bogus' as AgentType)).toThrow(
      /Unknown agent type/,
    );
  });
});

// =============================================================================
// getDefaultThinkingLevel (registry version)
// =============================================================================

describe('getDefaultThinkingLevel (registry)', () => {
  it('should return correct defaults', () => {
    expect(getDefaultThinkingLevel('coder')).toBe('low');
    expect(getDefaultThinkingLevel('planner')).toBe('high');
    expect(getDefaultThinkingLevel('qa_fixer')).toBe('medium');
  });
});

// =============================================================================
// getRequiredMcpServers (registry version)
// =============================================================================

describe('getRequiredMcpServers (registry)', () => {
  it('should filter memory when not enabled', () => {
    const servers = getRequiredMcpServers('coder', { memoryEnabled: false });
    expect(servers).not.toContain('memory');
  });

  it('should include memory when enabled', () => {
    const servers = getRequiredMcpServers('coder', { memoryEnabled: true });
    expect(servers).toContain('memory');
  });

  it('should handle browser→electron resolution via mcpConfig', () => {
    const servers = getRequiredMcpServers('qa_reviewer', {
      memoryEnabled: true,
      projectCapabilities: { is_electron: true },
      mcpConfig: { ELECTRON_MCP_ENABLED: 'true' },
    });
    expect(servers).not.toContain('browser');
    expect(servers).toContain('electron');
  });

  it('should handle browser→puppeteer resolution via mcpConfig', () => {
    const servers = getRequiredMcpServers('qa_reviewer', {
      memoryEnabled: true,
      projectCapabilities: { is_web_frontend: true, is_electron: false },
      mcpConfig: { PUPPETEER_MCP_ENABLED: 'true' },
    });
    expect(servers).not.toContain('browser');
    expect(servers).toContain('puppeteer');
  });

  it('should respect CONTEXT7_ENABLED=false in mcpConfig', () => {
    const servers = getRequiredMcpServers('spec_researcher', {
      mcpConfig: { CONTEXT7_ENABLED: 'false' },
    });
    expect(servers).not.toContain('context7');
  });

  it('should support per-agent MCP ADD overrides', () => {
    const servers = getRequiredMcpServers('insights', {
      mcpConfig: { AGENT_MCP_insights_ADD: 'context7' },
    });
    expect(servers).toContain('context7');
  });

  it('should support per-agent MCP REMOVE overrides but protect auto-claude', () => {
    const servers = getRequiredMcpServers('coder', {
      memoryEnabled: true,
      mcpConfig: { AGENT_MCP_coder_REMOVE: 'auto-claude,memory' },
    });
    expect(servers).toContain('auto-claude');
    expect(servers).not.toContain('memory');
  });
});
