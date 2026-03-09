import { app } from 'electron';
import path from 'path';
import { existsSync, readFileSync } from 'fs';

export interface EnvironmentVars {
  [key: string]: string;
}

export interface GlobalSettings {
  autoBuildPath?: string;
  globalOpenAIApiKey?: string;
}

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

/**
 * Get the auto-build source path from settings
 */
export function getAutoBuildSourcePath(): string | null {
  if (existsSync(settingsPath)) {
    try {
      const content = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content);
      if (settings.autoBuildPath && existsSync(settings.autoBuildPath)) {
        return settings.autoBuildPath;
      }
    } catch {
      // Fall through to null
    }
  }
  return null;
}

/**
 * Parse .env file content into key-value pairs
 * Handles both Unix and Windows line endings
 */
export function parseEnvFile(envContent: string): EnvironmentVars {
  const vars: EnvironmentVars = {};

  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      let value = trimmed.substring(eqIndex + 1).trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      vars[key] = value;
    }
  }

  return vars;
}

/**
 * Load environment variables from project .env file
 */
export function loadProjectEnvVars(projectPath: string, autoBuildPath?: string): EnvironmentVars {
  if (!autoBuildPath) {
    return {};
  }

  const projectEnvPath = path.join(projectPath, autoBuildPath, '.env');
  if (!existsSync(projectEnvPath)) {
    return {};
  }

  try {
    const envContent = readFileSync(projectEnvPath, 'utf-8');
    return parseEnvFile(envContent);
  } catch {
    return {};
  }
}

/**
 * Load global settings from user data directory
 */
export function loadGlobalSettings(): GlobalSettings {
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const settingsContent = readFileSync(settingsPath, 'utf-8');
    return JSON.parse(settingsContent);
  } catch {
    return {};
  }
}

/**
 * Check if memory is enabled in project or global environment
 */
export function isMemoryEnabled(projectEnvVars: EnvironmentVars): boolean {
  return (
    projectEnvVars['GRAPHITI_ENABLED']?.toLowerCase() === 'true' ||
    process.env.GRAPHITI_ENABLED?.toLowerCase() === 'true'
  );
}

/** @deprecated Use isMemoryEnabled instead */
export const isGraphitiEnabled = isMemoryEnabled;

/**
 * Check if OpenAI API key is available
 * Priority: project .env > global settings > process.env
 */
export function hasOpenAIKey(projectEnvVars: EnvironmentVars, globalSettings: GlobalSettings): boolean {
  return !!(
    projectEnvVars['OPENAI_API_KEY'] ||
    globalSettings.globalOpenAIApiKey ||
    process.env.OPENAI_API_KEY
  );
}

/**
 * Embedding configuration validation result
 */
export interface EmbeddingValidationResult {
  valid: boolean;
  provider: string;
  reason?: string;
}

/**
 * Validate embedding configuration based on the configured provider
 * Supports: openai, ollama, google, voyage, azure_openai
 *
 * @returns validation result with provider info and reason if invalid
 */
export function validateEmbeddingConfiguration(
  projectEnvVars: EnvironmentVars,
  globalSettings: GlobalSettings
): EmbeddingValidationResult {
  // Get the configured embedding provider (default to openai for backwards compatibility)
  const provider = (
    projectEnvVars['GRAPHITI_EMBEDDER_PROVIDER'] ||
    process.env.GRAPHITI_EMBEDDER_PROVIDER ||
    'openai'
  ).toLowerCase();

  switch (provider) {
    case 'openai': {
      if (hasOpenAIKey(projectEnvVars, globalSettings)) {
        return { valid: true, provider: 'openai' };
      }
      return {
        valid: false,
        provider: 'openai',
        reason: 'OPENAI_API_KEY not set (required for OpenAI embeddings)'
      };
    }

    case 'ollama': {
      // Ollama is local, no API key needed - works with default localhost
      return { valid: true, provider: 'ollama' };
    }

    case 'google': {
      const googleKey = projectEnvVars['GOOGLE_API_KEY'] || process.env.GOOGLE_API_KEY;
      if (googleKey) {
        return { valid: true, provider: 'google' };
      }
      return {
        valid: false,
        provider: 'google',
        reason: 'GOOGLE_API_KEY not set (required for Google AI embeddings)'
      };
    }

    case 'voyage': {
      const voyageKey = projectEnvVars['VOYAGE_API_KEY'] || process.env.VOYAGE_API_KEY;
      if (voyageKey) {
        return { valid: true, provider: 'voyage' };
      }
      return {
        valid: false,
        provider: 'voyage',
        reason: 'VOYAGE_API_KEY not set (required for Voyage AI embeddings)'
      };
    }

    case 'azure_openai': {
      const azureKey = projectEnvVars['AZURE_OPENAI_API_KEY'] || process.env.AZURE_OPENAI_API_KEY;
      if (azureKey) {
        return { valid: true, provider: 'azure_openai' };
      }
      return {
        valid: false,
        provider: 'azure_openai',
        reason: 'AZURE_OPENAI_API_KEY not set (required for Azure OpenAI embeddings)'
      };
    }

    default:
      // Unknown provider - assume it might work
      return { valid: true, provider };
  }
}

/**
 * Get memory database details (LadybugDB - embedded database)
 */
export interface MemoryDatabaseDetails {
  dbPath: string;
  database: string;
}

export function getMemoryDatabaseDetails(projectEnvVars: EnvironmentVars): MemoryDatabaseDetails {
  const dbPath = projectEnvVars['GRAPHITI_DB_PATH'] ||
                 process.env.GRAPHITI_DB_PATH ||
                 require('path').join(require('os').homedir(), '.auto-claude', 'memories');

  const database = projectEnvVars['GRAPHITI_DATABASE'] ||
                   process.env.GRAPHITI_DATABASE ||
                   'auto_claude_memory';

  return { dbPath, database };
}
