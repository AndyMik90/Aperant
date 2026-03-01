/**
 * Claude MCP Handlers
 *
 * IPC handlers for reading Claude Code's global MCP configuration.
 * Resolves both inline mcpServers from settings.json and enabled plugins
 * from the marketplace plugin cache.
 */

import { ipcMain } from 'electron';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import type { IPCResult } from '../../shared/types';
import type { GlobalMcpInfo, GlobalMcpServerEntry } from '../../shared/types/integrations';
import { readUserGlobalSettings } from '../claude-code-settings/reader';
import { debugLog } from '../../shared/utils/debug-logger';

const LOG_PREFIX = '[ClaudeMCP]';

/**
 * Convert a serverId (e.g. "context7", "github-mcp") to a human-readable name.
 * Capitalizes words and replaces hyphens/underscores with spaces.
 */
function toServerName(serverId: string): string {
  return serverId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Find the most recently modified subdirectory within a directory.
 * Plugin caches store configs in hash-named subdirectories; we want the latest one.
 */
function findLatestSubdir(dirPath: string): string | undefined {
  if (!existsSync(dirPath)) {
    return undefined;
  }

  try {
    const entries = readdirSync(dirPath);
    let latestDir: string | undefined;
    let latestMtime = 0;

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry);
      try {
        const stat = statSync(entryPath);
        if (stat.isDirectory() && stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestDir = entryPath;
        }
      } catch {
        // Skip entries we can't stat
      }
    }

    return latestDir;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a single enabled plugin to its MCP server entries.
 * Reads the .mcp.json from the plugin cache directory.
 *
 * @param pluginKey - Plugin key in format "pluginId@marketplace"
 * @param claudeDir - Path to ~/.claude directory
 * @returns Array of resolved server entries (a plugin .mcp.json can define multiple servers)
 */
function resolvePluginServers(pluginKey: string, claudeDir: string): GlobalMcpServerEntry[] {
  const atIndex = pluginKey.lastIndexOf('@');
  if (atIndex <= 0) {
    debugLog(`${LOG_PREFIX} Invalid plugin key format (missing @):`, pluginKey);
    return [];
  }

  const pluginId = pluginKey.substring(0, atIndex);
  const marketplace = pluginKey.substring(atIndex + 1);

  // Plugin cache path: ~/.claude/plugins/cache/{marketplace}/{pluginId}/
  const pluginCacheDir = path.join(claudeDir, 'plugins', 'cache', marketplace, pluginId);

  if (!existsSync(pluginCacheDir)) {
    debugLog(`${LOG_PREFIX} Plugin cache directory not found:`, pluginCacheDir);
    return [];
  }

  // Find the most recently modified hash subdirectory
  const latestHashDir = findLatestSubdir(pluginCacheDir);
  if (!latestHashDir) {
    debugLog(`${LOG_PREFIX} No hash subdirectory found in plugin cache:`, pluginCacheDir);
    return [];
  }

  // Read .mcp.json from the hash directory
  const mcpJsonPath = path.join(latestHashDir, '.mcp.json');
  if (!existsSync(mcpJsonPath)) {
    debugLog(`${LOG_PREFIX} .mcp.json not found in plugin cache:`, mcpJsonPath);
    return [];
  }

  try {
    const content = readFileSync(mcpJsonPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      debugLog(`${LOG_PREFIX} Invalid .mcp.json structure:`, mcpJsonPath);
      return [];
    }

    const entries: GlobalMcpServerEntry[] = [];

    // Each key in the .mcp.json is a server ID with its config
    for (const [serverId, serverConfig] of Object.entries(parsed)) {
      if (typeof serverConfig !== 'object' || serverConfig === null) {
        debugLog(`${LOG_PREFIX} Skipping invalid server config in .mcp.json:`, { pluginKey, serverId });
        continue;
      }

      const config = serverConfig as Record<string, unknown>;
      const entry: GlobalMcpServerEntry = {
        pluginKey,
        serverId,
        serverName: toServerName(serverId),
        config: {
          ...(typeof config.type === 'string' && (config.type === 'http' || config.type === 'sse')
            ? { type: config.type as 'http' | 'sse' }
            : {}),
          ...(typeof config.command === 'string' ? { command: config.command } : {}),
          ...(Array.isArray(config.args) ? { args: config.args.filter((a): a is string => typeof a === 'string') } : {}),
          ...(typeof config.url === 'string' ? { url: config.url } : {}),
          ...(typeof config.headers === 'object' && config.headers !== null && !Array.isArray(config.headers)
            ? { headers: Object.fromEntries(
                Object.entries(config.headers as Record<string, unknown>)
                  .filter(([, v]) => typeof v === 'string')
              ) as Record<string, string> }
            : {}),
        },
        source: 'plugin',
      };

      entries.push(entry);
    }

    debugLog(`${LOG_PREFIX} Resolved ${entries.length} server(s) from plugin:`, pluginKey);
    return entries;
  } catch (error) {
    debugLog(`${LOG_PREFIX} Failed to parse .mcp.json:`, mcpJsonPath, error);
    return [];
  }
}

/**
 * Convert inline mcpServers config entries to GlobalMcpServerEntry array.
 * Performs runtime type validation since the input may come from untrusted JSON.
 *
 * @param mcpServers - MCP server configurations keyed by server ID (runtime-validated)
 * @param source - Where this config was sourced from ('settings' for settings.json, 'claude-json' for ~/.claude.json)
 */
function resolveInlineServers(
  mcpServers: Record<string, unknown>,
  source: 'settings' | 'claude-json' = 'settings'
): GlobalMcpServerEntry[] {
  const entries: GlobalMcpServerEntry[] = [];

  for (const [serverId, rawConfig] of Object.entries(mcpServers)) {
    if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig)) {
      debugLog(`${LOG_PREFIX} Skipping invalid mcpServers entry (not an object):`, serverId);
      continue;
    }

    const config = rawConfig as Record<string, unknown>;
    const entry: GlobalMcpServerEntry = {
      serverId,
      serverName: toServerName(serverId),
      config: {
        ...(typeof config.type === 'string' && (config.type === 'http' || config.type === 'sse')
          ? { type: config.type as 'http' | 'sse' }
          : {}),
        ...(typeof config.command === 'string' ? { command: config.command } : {}),
        ...(Array.isArray(config.args)
          ? { args: config.args.filter((a: unknown): a is string => typeof a === 'string') }
          : {}),
        ...(typeof config.url === 'string' ? { url: config.url } : {}),
        ...(typeof config.headers === 'object' && config.headers !== null && !Array.isArray(config.headers)
          ? { headers: config.headers as Record<string, string> }
          : {}),
      },
      source,
    };

    entries.push(entry);
  }

  return entries;
}

/**
 * Get the Claude home directory (~/.claude).
 * Uses the same logic as the settings reader for consistency.
 */
function getClaudeHomeDir(): string {
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR;
  if (envConfigDir) {
    return envConfigDir;
  }
  return path.join(homedir(), '.claude');
}

/**
 * Read MCP servers from ~/.claude.json (the main Claude Code configuration file).
 * This file contains a top-level `mcpServers` key with the same structure as
 * ClaudeCodeMcpServerConfig entries.
 *
 * @returns Array of GlobalMcpServerEntry with source 'claude-json', or empty array on failure.
 */
function readClaudeJsonMcpServers(): GlobalMcpServerEntry[] {
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const candidates = claudeConfigDir
    ? [path.join(claudeConfigDir, '.claude.json'), path.join(homedir(), '.claude.json')]
    : [path.join(homedir(), '.claude.json')];

  const claudeJsonPath = candidates.find(existsSync);
  if (!claudeJsonPath) {
    debugLog(`${LOG_PREFIX} .claude.json not found in expected locations`);
    return [];
  }

  try {
    const content = readFileSync(claudeJsonPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      debugLog(`${LOG_PREFIX} Invalid ~/.claude.json structure (expected object)`);
      return [];
    }

    const mcpServers = parsed.mcpServers;
    if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
      debugLog(`${LOG_PREFIX} No valid mcpServers found in ~/.claude.json`);
      return [];
    }

    const entries = resolveInlineServers(
      mcpServers as Record<string, unknown>,
      'claude-json'
    );

    debugLog(`${LOG_PREFIX} Resolved ${entries.length} server(s) from ~/.claude.json`);
    return entries;
  } catch (error) {
    debugLog(`${LOG_PREFIX} Failed to read/parse ~/.claude.json:`, claudeJsonPath, error);
    return [];
  }
}

/**
 * Register Claude MCP IPC handlers.
 */
export function registerClaudeMcpHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CLAUDE_MCP_GET_GLOBAL, async (): Promise<IPCResult<GlobalMcpInfo>> => {
    try {
      debugLog(`${LOG_PREFIX} Reading global MCP configuration`);

      const settings = readUserGlobalSettings();
      const claudeDir = getClaudeHomeDir();

      const result: GlobalMcpInfo = {
        pluginServers: [],
        inlineServers: [],
        claudeJsonServers: [],
      };

      // Resolve enabled plugins
      if (settings?.enabledPlugins) {
        for (const [pluginKey, enabled] of Object.entries(settings.enabledPlugins)) {
          if (!enabled) {
            continue;
          }

          const servers = resolvePluginServers(pluginKey, claudeDir);
          result.pluginServers.push(...servers);
        }
      }

      // Resolve inline mcpServers from settings.json
      if (settings?.mcpServers) {
        result.inlineServers = resolveInlineServers(settings.mcpServers);
      }

      // Read ~/.claude.json mcpServers
      result.claudeJsonServers = readClaudeJsonMcpServers();

      debugLog(
        `${LOG_PREFIX} Resolved global MCPs:`,
        `${result.pluginServers.length} plugin server(s),`,
        `${result.inlineServers.length} inline server(s),`,
        `${result.claudeJsonServers.length} claude.json server(s)`
      );

      return { success: true, data: result };
    } catch (error) {
      debugLog(`${LOG_PREFIX} Error reading global MCP configuration:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read global MCP configuration',
      };
    }
  });
}
