/**
 * Claude Agents Handlers
 *
 * IPC handlers for reading Claude Code custom agent definitions
 * from ~/.claude/agents/ directory structure.
 */

import { ipcMain } from 'electron';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import type { IPCResult } from '../../shared/types';
import type { ClaudeAgentsInfo, ClaudeAgentCategory, ClaudeCustomAgent } from '../../shared/types/integrations';
import { getUserConfigDir } from '../claude-code-settings/reader';
import { debugLog } from '../../shared/utils/debug-logger';

const LOG_PREFIX = '[ClaudeAgents]';

/**
 * Convert a category directory name to a human-readable name.
 * Removes the number prefix (e.g. "01-") and capitalizes words.
 */
function toCategoryName(dirName: string): string {
  // Remove number prefix (e.g. "01-" from "01-core-development")
  const withoutPrefix = dirName.replace(/^\d+-/, '');
  return withoutPrefix
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert an agent filename to a human-readable name.
 * Removes the .md extension, capitalizes words, replaces hyphens with spaces.
 */
function toAgentName(fileName: string): string {
  // Remove .md extension
  const withoutExt = fileName.replace(/\.md$/, '');
  return withoutExt
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get the agents directory path (~/.claude/agents/).
 * Respects CLAUDE_CONFIG_DIR environment variable.
 */
function getAgentsDir(): string {
  return path.join(getUserConfigDir(), 'agents');
}

/**
 * Register Claude Agents IPC handlers.
 */
export function registerClaudeAgentsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CLAUDE_AGENTS_GET, async (): Promise<IPCResult<ClaudeAgentsInfo>> => {
    try {
      const agentsDir = getAgentsDir();

      if (!existsSync(agentsDir)) {
        debugLog(`${LOG_PREFIX} Agents directory not found:`, agentsDir);
        return { success: true, data: { categories: [], totalAgents: 0 } };
      }

      const categories: ClaudeAgentCategory[] = [];
      let totalAgents = 0;

      const entries = readdirSync(agentsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const entryPath = path.join(agentsDir, entry.name);

        const agents: ClaudeCustomAgent[] = [];

        try {
          const files = readdirSync(entryPath);
          for (const file of files) {
            if (!file.endsWith('.md') || file.toLowerCase() === 'readme.md') continue;

            const agentId = file.replace(/\.md$/, '');

            // Use relative path (categoryDir/file) instead of absolute filePath
            // to avoid exposing full filesystem paths to the renderer process
            const relativePath = path.join(entry.name, file);

            agents.push({
              agentId,
              agentName: toAgentName(file),
              categoryDir: entry.name,
              categoryName: toCategoryName(entry.name),
              filePath: relativePath,
            });
          }
        } catch {
          debugLog(`${LOG_PREFIX} Failed to read category directory:`, entryPath);
          continue;
        }

        if (agents.length > 0) {
          // Sort agents by name within category
          agents.sort((a, b) => a.agentName.localeCompare(b.agentName));

          categories.push({
            categoryDir: entry.name,
            categoryName: toCategoryName(entry.name),
            agents,
          });
          totalAgents += agents.length;
        }
      }

      // Sort categories by directory name (already numbered)
      categories.sort((a, b) => a.categoryDir.localeCompare(b.categoryDir));

      debugLog(`${LOG_PREFIX} Found ${totalAgents} agent(s) in ${categories.length} categories`);
      return { success: true, data: { categories, totalAgents } };
    } catch (error) {
      debugLog(`${LOG_PREFIX} Error reading agents:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read custom agents',
      };
    }
  });
}
