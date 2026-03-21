/**
 * Vault module types and interfaces
 *
 * A vault is an external directory (like an Obsidian vault) containing
 * markdown files with learnings, context, and agent instructions.
 */

export interface VaultConfig {
  path: string;           // Absolute path to vault directory
  enabled: boolean;       // Whether vault integration is active
  syncLearnings: boolean; // Whether to sync learnings to vault
  autoLoad: boolean;      // Whether to auto-load vault context
  writeEnabled: boolean;  // Whether write operations are allowed
}

export interface VaultFile {
  name: string;
  path: string;        // Relative path within vault
  size: number;
  modified: string;    // ISO date
  isDirectory: boolean;
}

export interface VaultSearchResult {
  files: VaultFile[];
  total: number;
  query: string;
}

export interface VaultContext {
  claudeMd: string | null;
  learnings: VaultLearning[];
}

export interface VaultLearning {
  name: string;
  path: string;    // Relative path within vault
  content: string;
}
