/**
 * Vault IPC Handlers Module
 *
 * This module exports the main registration function for all vault-related IPC handlers.
 * A vault is an external directory (like an Obsidian vault) that contains markdown files
 * with learnings, context, and agent instructions.
 */

import { registerVaultIpcHandlers } from './vault-handlers';

/**
 * Register all vault IPC handlers
 */
export function registerVaultHandlers(): void {
  console.warn('[Vault] Registering vault handlers');
  registerVaultIpcHandlers();
  console.warn('[Vault] Vault handlers registered');
}

// Re-export types and utilities for external use
export type { VaultConfig, VaultFile, VaultSearchResult, VaultContext, VaultLearning } from './types';
export { getVaultConfig, isValidVaultPath, readVaultClaudeMd, listVaultLearnings } from './utils';
