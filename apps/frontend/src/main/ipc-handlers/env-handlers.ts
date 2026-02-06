import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS, DEFAULT_APP_SETTINGS } from '../../shared/constants';
import type { IPCResult, ProjectEnvConfig, ClaudeAuthResult, AppSettings } from '../../shared/types';
import path from 'path';
import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { projectStore } from '../project-store';
import { parseEnvFile } from './utils';
import { getClaudeCliInvocation, getClaudeCliInvocationAsync } from '../claude-cli-utils';
import { debugError } from '../../shared/utils/debug-logger';
import { getSpawnOptions, getSpawnCommand } from '../env-utils';

// GitLab environment variable keys
const GITLAB_ENV_KEYS = {
  ENABLED: 'GITLAB_ENABLED',
  TOKEN: 'GITLAB_TOKEN',
  INSTANCE_URL: 'GITLAB_INSTANCE_URL',
  PROJECT: 'GITLAB_PROJECT',
  AUTO_SYNC: 'GITLAB_AUTO_SYNC'
} as const;

/**
 * Helper to generate .env line (DRY)
 */
function envLine(vars: Record<string, string>, key: string, defaultVal: string = ''): string {
  return vars[key] ? `${key}=${vars[key]}` : `# ${key}=${defaultVal}`;
}

type ResolvedClaudeCliInvocation =
  | { command: string; env: Record<string, string> }
  | { error: string };

function _resolveClaudeCliInvocation(): ResolvedClaudeCliInvocation {
  try {
    const invocation = getClaudeCliInvocation();
    if (!invocation?.command) {
      throw new Error('Claude CLI path not resolved');
    }
    return { command: invocation.command, env: invocation.env };
  } catch (error) {
    debugError('[IPC] Failed to resolve Claude CLI path:', error);
    return {
      error: error instanceof Error ? error.message : 'Failed to resolve Claude CLI path',
    };
  }
}

/**
 * Async version of resolveClaudeCliInvocation - non-blocking for main process
 */
async function resolveClaudeCliInvocationAsync(): Promise<ResolvedClaudeCliInvocation> {
  try {
    const invocation = await getClaudeCliInvocationAsync();
    if (!invocation?.command) {
      throw new Error('Claude CLI path not resolved');
    }
    return { command: invocation.command, env: invocation.env };
  } catch (error) {
    debugError('[IPC] Failed to resolve Claude CLI path:', error);
    return {
      error: error instanceof Error ? error.message : 'Failed to resolve Claude CLI path',
    };
  }
}


/**
 * Register all env-related IPC handlers
 */
export function registerEnvHandlers(
  _getMainWindow: () => BrowserWindow | null
): void {
  // ============================================
  // Environment Configuration Operations
  // ============================================

  // Get settings file path
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  /**
   * Generate .env file content from config
   */
  const generateEnvContent = (
    config: Partial<ProjectEnvConfig>,
    existingContent?: string
  ): string => {
    // Parse existing content to preserve comments and structure
    const existingVars = existingContent ? parseEnvFile(existingContent) : {};

    // Update with new values
    if (config.claudeOAuthToken !== undefined) {
      existingVars['CLAUDE_CODE_OAUTH_TOKEN'] = config.claudeOAuthToken;
    }
    if (config.autoBuildModel !== undefined) {
      existingVars['AUTO_BUILD_MODEL'] = config.autoBuildModel;
    }
    if (config.linearApiKey !== undefined) {
      existingVars['LINEAR_API_KEY'] = config.linearApiKey;
    }
    if (config.linearTeamId !== undefined) {
      existingVars['LINEAR_TEAM_ID'] = config.linearTeamId;
    }
    if (config.linearProjectId !== undefined) {
      existingVars['LINEAR_PROJECT_ID'] = config.linearProjectId;
    }
    if (config.linearRealtimeSync !== undefined) {
      existingVars['LINEAR_REALTIME_SYNC'] = config.linearRealtimeSync ? 'true' : 'false';
    }
    // GitHub Integration
    if (config.githubToken !== undefined) {
      existingVars['GITHUB_TOKEN'] = config.githubToken;
    }
    if (config.githubRepo !== undefined) {
      existingVars['GITHUB_REPO'] = config.githubRepo;
    }
    if (config.githubAutoSync !== undefined) {
      existingVars['GITHUB_AUTO_SYNC'] = config.githubAutoSync ? 'true' : 'false';
    }
    // GitLab Integration
    if (config.gitlabEnabled !== undefined) {
      existingVars[GITLAB_ENV_KEYS.ENABLED] = config.gitlabEnabled ? 'true' : 'false';
    }
    if (config.gitlabToken !== undefined) {
      existingVars[GITLAB_ENV_KEYS.TOKEN] = config.gitlabToken;
    }
    if (config.gitlabInstanceUrl !== undefined) {
      existingVars[GITLAB_ENV_KEYS.INSTANCE_URL] = config.gitlabInstanceUrl;
    }
    if (config.gitlabProject !== undefined) {
      existingVars[GITLAB_ENV_KEYS.PROJECT] = config.gitlabProject;
    }
    if (config.gitlabAutoSync !== undefined) {
      existingVars[GITLAB_ENV_KEYS.AUTO_SYNC] = config.gitlabAutoSync ? 'true' : 'false';
    }
    // Git/Worktree Settings
    if (config.defaultBranch !== undefined) {
      existingVars['DEFAULT_BRANCH'] = config.defaultBranch;
    }
    if (config.graphitiEnabled !== undefined) {
      existingVars['GRAPHITI_ENABLED'] = config.graphitiEnabled ? 'true' : 'false';
    }
    // Memory Provider Configuration (embeddings only - LLM uses Claude SDK)
    if (config.graphitiProviderConfig) {
      const pc = config.graphitiProviderConfig;
      // Embedding provider only (LLM provider removed - Claude SDK handles RAG)
      if (pc.embeddingProvider) existingVars['GRAPHITI_EMBEDDER_PROVIDER'] = pc.embeddingProvider;
      // OpenAI Embeddings
      if (pc.openaiApiKey) existingVars['OPENAI_API_KEY'] = pc.openaiApiKey;
      if (pc.openaiEmbeddingModel) existingVars['OPENAI_EMBEDDING_MODEL'] = pc.openaiEmbeddingModel;
      // Azure OpenAI Embeddings
      if (pc.azureOpenaiApiKey) existingVars['AZURE_OPENAI_API_KEY'] = pc.azureOpenaiApiKey;
      if (pc.azureOpenaiBaseUrl) existingVars['AZURE_OPENAI_BASE_URL'] = pc.azureOpenaiBaseUrl;
      if (pc.azureOpenaiEmbeddingDeployment) existingVars['AZURE_OPENAI_EMBEDDING_DEPLOYMENT'] = pc.azureOpenaiEmbeddingDeployment;
      // Voyage Embeddings
      if (pc.voyageApiKey) existingVars['VOYAGE_API_KEY'] = pc.voyageApiKey;
      if (pc.voyageEmbeddingModel) existingVars['VOYAGE_EMBEDDING_MODEL'] = pc.voyageEmbeddingModel;
      // Google Embeddings
      if (pc.googleApiKey) existingVars['GOOGLE_API_KEY'] = pc.googleApiKey;
      if (pc.googleEmbeddingModel) existingVars['GOOGLE_EMBEDDING_MODEL'] = pc.googleEmbeddingModel;
      // Ollama Embeddings
      if (pc.ollamaBaseUrl) existingVars['OLLAMA_BASE_URL'] = pc.ollamaBaseUrl;
      if (pc.ollamaEmbeddingModel) existingVars['OLLAMA_EMBEDDING_MODEL'] = pc.ollamaEmbeddingModel;
      if (pc.ollamaEmbeddingDim) existingVars['OLLAMA_EMBEDDING_DIM'] = String(pc.ollamaEmbeddingDim);
      // LadybugDB (embedded database)
      if (pc.dbPath) existingVars['GRAPHITI_DB_PATH'] = pc.dbPath;
      if (pc.database) existingVars['GRAPHITI_DATABASE'] = pc.database;
    }
    // Legacy fields (still supported)
    if (config.openaiApiKey !== undefined) {
      existingVars['OPENAI_API_KEY'] = config.openaiApiKey;
    }
    if (config.graphitiDatabase !== undefined) {
      existingVars['GRAPHITI_DATABASE'] = config.graphitiDatabase;
    }
    if (config.graphitiDbPath !== undefined) {
      existingVars['GRAPHITI_DB_PATH'] = config.graphitiDbPath;
    }
    if (config.enableFancyUi !== undefined) {
      existingVars['ENABLE_FANCY_UI'] = config.enableFancyUi ? 'true' : 'false';
    }

    // MCP Server Configuration
    if (config.mcpServers) {
      if (config.mcpServers.context7Enabled !== undefined) {
        existingVars['CONTEXT7_ENABLED'] = config.mcpServers.context7Enabled ? 'true' : 'false';
      }
      if (config.mcpServers.linearMcpEnabled !== undefined) {
        existingVars['LINEAR_MCP_ENABLED'] = config.mcpServers.linearMcpEnabled ? 'true' : 'false';
      }
      if (config.mcpServers.electronEnabled !== undefined) {
        existingVars['ELECTRON_MCP_ENABLED'] = config.mcpServers.electronEnabled ? 'true' : 'false';
      }
      if (config.mcpServers.puppeteerEnabled !== undefined) {
        existingVars['PUPPETEER_MCP_ENABLED'] = config.mcpServers.puppeteerEnabled ? 'true' : 'false';
      }
      // Note: graphitiEnabled is already handled via GRAPHITI_ENABLED above
    }

    // Per-agent MCP overrides (add/remove MCPs from specific agents)
    if (config.agentMcpOverrides) {
      // First, clear any existing AGENT_MCP_* entries
      Object.keys(existingVars).forEach(key => {
        if (key.startsWith('AGENT_MCP_')) {
          delete existingVars[key];
        }
      });

      // Add new overrides
      Object.entries(config.agentMcpOverrides).forEach(([agentId, override]) => {
        if (override.add && override.add.length > 0) {
          existingVars[`AGENT_MCP_${agentId}_ADD`] = override.add.join(',');
        }
        if (override.remove && override.remove.length > 0) {
          existingVars[`AGENT_MCP_${agentId}_REMOVE`] = override.remove.join(',');
        }
      });
    }

    // Custom MCP servers (user-defined)
    if (config.customMcpServers !== undefined) {
      if (config.customMcpServers.length > 0) {
        existingVars['CUSTOM_MCP_SERVERS'] = JSON.stringify(config.customMcpServers);
      } else {
        delete existingVars['CUSTOM_MCP_SERVERS'];
      }
    }

    // Generate content with sections
    const content = `# Auto Claude Framework Environment Variables
# Managed by Auto Claude UI

# Claude Code OAuth Token (REQUIRED)
CLAUDE_CODE_OAUTH_TOKEN=${existingVars['CLAUDE_CODE_OAUTH_TOKEN'] || ''}

# Model override (OPTIONAL)
${existingVars['AUTO_BUILD_MODEL'] ? `AUTO_BUILD_MODEL=${existingVars['AUTO_BUILD_MODEL']}` : '# AUTO_BUILD_MODEL=claude-opus-4-5-20251101'}

# =============================================================================
# LINEAR INTEGRATION (OPTIONAL)
# =============================================================================
${existingVars['LINEAR_API_KEY'] ? `LINEAR_API_KEY=${existingVars['LINEAR_API_KEY']}` : '# LINEAR_API_KEY='}
${existingVars['LINEAR_TEAM_ID'] ? `LINEAR_TEAM_ID=${existingVars['LINEAR_TEAM_ID']}` : '# LINEAR_TEAM_ID='}
${existingVars['LINEAR_PROJECT_ID'] ? `LINEAR_PROJECT_ID=${existingVars['LINEAR_PROJECT_ID']}` : '# LINEAR_PROJECT_ID='}
${existingVars['LINEAR_REALTIME_SYNC'] !== undefined ? `LINEAR_REALTIME_SYNC=${existingVars['LINEAR_REALTIME_SYNC']}` : '# LINEAR_REALTIME_SYNC=false'}

# =============================================================================
# GITHUB INTEGRATION (OPTIONAL)
# =============================================================================
${existingVars['GITHUB_TOKEN'] ? `GITHUB_TOKEN=${existingVars['GITHUB_TOKEN']}` : '# GITHUB_TOKEN='}
${existingVars['GITHUB_REPO'] ? `GITHUB_REPO=${existingVars['GITHUB_REPO']}` : '# GITHUB_REPO=owner/repo'}
${existingVars['GITHUB_AUTO_SYNC'] !== undefined ? `GITHUB_AUTO_SYNC=${existingVars['GITHUB_AUTO_SYNC']}` : '# GITHUB_AUTO_SYNC=false'}

# =============================================================================
# GITLAB INTEGRATION (OPTIONAL)
# =============================================================================
${existingVars[GITLAB_ENV_KEYS.ENABLED] !== undefined ? `${GITLAB_ENV_KEYS.ENABLED}=${existingVars[GITLAB_ENV_KEYS.ENABLED]}` : `# ${GITLAB_ENV_KEYS.ENABLED}=true`}
${envLine(existingVars, GITLAB_ENV_KEYS.INSTANCE_URL, 'https://gitlab.com')}
${envLine(existingVars, GITLAB_ENV_KEYS.TOKEN)}
${envLine(existingVars, GITLAB_ENV_KEYS.PROJECT, 'group/project')}
${envLine(existingVars, GITLAB_ENV_KEYS.AUTO_SYNC, 'false')}

# =============================================================================
# GIT/WORKTREE SETTINGS (OPTIONAL)
# =============================================================================
# Default base branch for worktree creation
# If not set, Auto Claude will auto-detect main/master, or fall back to current branch
${existingVars['DEFAULT_BRANCH'] ? `DEFAULT_BRANCH=${existingVars['DEFAULT_BRANCH']}` : '# DEFAULT_BRANCH=main'}

# =============================================================================
# UI SETTINGS (OPTIONAL)
# =============================================================================
${existingVars['ENABLE_FANCY_UI'] !== undefined ? `ENABLE_FANCY_UI=${existingVars['ENABLE_FANCY_UI']}` : '# ENABLE_FANCY_UI=true'}

# =============================================================================
# MCP SERVER CONFIGURATION (per-project overrides)
# =============================================================================
# Context7 documentation lookup (default: enabled)
${existingVars['CONTEXT7_ENABLED'] !== undefined ? `CONTEXT7_ENABLED=${existingVars['CONTEXT7_ENABLED']}` : '# CONTEXT7_ENABLED=true'}
# Linear MCP integration (default: follows LINEAR_API_KEY)
${existingVars['LINEAR_MCP_ENABLED'] !== undefined ? `LINEAR_MCP_ENABLED=${existingVars['LINEAR_MCP_ENABLED']}` : '# LINEAR_MCP_ENABLED=true'}
# Electron desktop automation - QA agents only (default: disabled)
${existingVars['ELECTRON_MCP_ENABLED'] !== undefined ? `ELECTRON_MCP_ENABLED=${existingVars['ELECTRON_MCP_ENABLED']}` : '# ELECTRON_MCP_ENABLED=false'}
# Puppeteer browser automation - QA agents only (default: disabled)
${existingVars['PUPPETEER_MCP_ENABLED'] !== undefined ? `PUPPETEER_MCP_ENABLED=${existingVars['PUPPETEER_MCP_ENABLED']}` : '# PUPPETEER_MCP_ENABLED=false'}

# =============================================================================
# PER-AGENT MCP OVERRIDES
# Add or remove MCP servers for specific agents
# Format: AGENT_MCP_<agent_type>_ADD=server1,server2
# Format: AGENT_MCP_<agent_type>_REMOVE=server1,server2
# =============================================================================
${Object.entries(existingVars)
  .filter(([key]) => key.startsWith('AGENT_MCP_'))
  .map(([key, value]) => `${key}=${value}`)
  .join('\n') || '# No per-agent overrides configured'}

# =============================================================================
# CUSTOM MCP SERVERS
# User-defined MCP servers (command-based or HTTP-based)
# JSON format: [{"id":"...","name":"...","type":"command|http",...}]
# =============================================================================
${existingVars['CUSTOM_MCP_SERVERS'] ? `CUSTOM_MCP_SERVERS=${existingVars['CUSTOM_MCP_SERVERS']}` : '# CUSTOM_MCP_SERVERS=[]'}

# =============================================================================
# MEMORY INTEGRATION
# Embedding providers: OpenAI, Google AI, Azure OpenAI, Ollama, Voyage
# =============================================================================
${existingVars['GRAPHITI_ENABLED'] ? `GRAPHITI_ENABLED=${existingVars['GRAPHITI_ENABLED']}` : '# GRAPHITI_ENABLED=true'}

# Embedding Provider (for semantic search - optional, keyword search works without)
${existingVars['GRAPHITI_EMBEDDER_PROVIDER'] ? `GRAPHITI_EMBEDDER_PROVIDER=${existingVars['GRAPHITI_EMBEDDER_PROVIDER']}` : '# GRAPHITI_EMBEDDER_PROVIDER=ollama'}

# OpenAI Embeddings
${existingVars['OPENAI_API_KEY'] ? `OPENAI_API_KEY=${existingVars['OPENAI_API_KEY']}` : '# OPENAI_API_KEY='}
${existingVars['OPENAI_EMBEDDING_MODEL'] ? `OPENAI_EMBEDDING_MODEL=${existingVars['OPENAI_EMBEDDING_MODEL']}` : '# OPENAI_EMBEDDING_MODEL=text-embedding-3-small'}

# Azure OpenAI Embeddings
${existingVars['AZURE_OPENAI_API_KEY'] ? `AZURE_OPENAI_API_KEY=${existingVars['AZURE_OPENAI_API_KEY']}` : '# AZURE_OPENAI_API_KEY='}
${existingVars['AZURE_OPENAI_BASE_URL'] ? `AZURE_OPENAI_BASE_URL=${existingVars['AZURE_OPENAI_BASE_URL']}` : '# AZURE_OPENAI_BASE_URL='}
${existingVars['AZURE_OPENAI_EMBEDDING_DEPLOYMENT'] ? `AZURE_OPENAI_EMBEDDING_DEPLOYMENT=${existingVars['AZURE_OPENAI_EMBEDDING_DEPLOYMENT']}` : '# AZURE_OPENAI_EMBEDDING_DEPLOYMENT='}

# Voyage AI Embeddings
${existingVars['VOYAGE_API_KEY'] ? `VOYAGE_API_KEY=${existingVars['VOYAGE_API_KEY']}` : '# VOYAGE_API_KEY='}
${existingVars['VOYAGE_EMBEDDING_MODEL'] ? `VOYAGE_EMBEDDING_MODEL=${existingVars['VOYAGE_EMBEDDING_MODEL']}` : '# VOYAGE_EMBEDDING_MODEL=voyage-3'}

# Google AI Embeddings
${existingVars['GOOGLE_API_KEY'] ? `GOOGLE_API_KEY=${existingVars['GOOGLE_API_KEY']}` : '# GOOGLE_API_KEY='}
${existingVars['GOOGLE_EMBEDDING_MODEL'] ? `GOOGLE_EMBEDDING_MODEL=${existingVars['GOOGLE_EMBEDDING_MODEL']}` : '# GOOGLE_EMBEDDING_MODEL=text-embedding-004'}

# Ollama Embeddings (Local - free)
${existingVars['OLLAMA_BASE_URL'] ? `OLLAMA_BASE_URL=${existingVars['OLLAMA_BASE_URL']}` : '# OLLAMA_BASE_URL=http://localhost:11434'}
${existingVars['OLLAMA_EMBEDDING_MODEL'] ? `OLLAMA_EMBEDDING_MODEL=${existingVars['OLLAMA_EMBEDDING_MODEL']}` : '# OLLAMA_EMBEDDING_MODEL=embeddinggemma'}
${existingVars['OLLAMA_EMBEDDING_DIM'] ? `OLLAMA_EMBEDDING_DIM=${existingVars['OLLAMA_EMBEDDING_DIM']}` : '# OLLAMA_EMBEDDING_DIM=768'}

# LadybugDB Database (embedded - no Docker required)
${existingVars['GRAPHITI_DATABASE'] ? `GRAPHITI_DATABASE=${existingVars['GRAPHITI_DATABASE']}` : '# GRAPHITI_DATABASE=auto_claude_memory'}
${existingVars['GRAPHITI_DB_PATH'] ? `GRAPHITI_DB_PATH=${existingVars['GRAPHITI_DB_PATH']}` : '# GRAPHITI_DB_PATH=~/.auto-claude/memories'}
`;

    return content;
  };

  ipcMain.handle(
    IPC_CHANNELS.ENV_GET,
    async (_, projectId: string): Promise<IPCResult<ProjectEnvConfig>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      if (!project.autoBuildPath) {
        return { success: false, error: 'Project not initialized' };
      }

      const envPath = path.join(project.path, project.autoBuildPath, '.env');

      // Load global settings for fallbacks
      let globalSettings: AppSettings = { ...DEFAULT_APP_SETTINGS };
      if (existsSync(settingsPath)) {
        try {
          const content = readFileSync(settingsPath, 'utf-8');
          globalSettings = { ...globalSettings, ...JSON.parse(content) };
        } catch {
          // Use defaults
        }
      }

      // Default config
      const config: ProjectEnvConfig = {
        claudeAuthStatus: 'not_configured',
        linearEnabled: false,
        githubEnabled: false,
        gitlabEnabled: false,
        graphitiEnabled: false,
        enableFancyUi: true,
        claudeTokenIsGlobal: false,
        openaiKeyIsGlobal: false
      };

      // Parse project-specific .env if it exists
      let vars: Record<string, string> = {};
      if (existsSync(envPath)) {
        try {
          const content = readFileSync(envPath, 'utf-8');
          vars = parseEnvFile(content);
        } catch {
          // Continue with empty vars
        }
      }

      // Claude OAuth Token: project-specific takes precedence, then global
      if (vars['CLAUDE_CODE_OAUTH_TOKEN']) {
        config.claudeOAuthToken = vars['CLAUDE_CODE_OAUTH_TOKEN'];
        config.claudeAuthStatus = 'token_set';
        config.claudeTokenIsGlobal = false;
      } else if (globalSettings.globalClaudeOAuthToken) {
        config.claudeOAuthToken = globalSettings.globalClaudeOAuthToken;
        config.claudeAuthStatus = 'token_set';
        config.claudeTokenIsGlobal = true;
      }

      if (vars['AUTO_BUILD_MODEL']) {
        config.autoBuildModel = vars['AUTO_BUILD_MODEL'];
      }

      if (vars['LINEAR_API_KEY']) {
        config.linearEnabled = true;
        config.linearApiKey = vars['LINEAR_API_KEY'];
      }
      if (vars['LINEAR_TEAM_ID']) {
        config.linearTeamId = vars['LINEAR_TEAM_ID'];
      }
      if (vars['LINEAR_PROJECT_ID']) {
        config.linearProjectId = vars['LINEAR_PROJECT_ID'];
      }
      if (vars['LINEAR_REALTIME_SYNC']?.toLowerCase() === 'true') {
        config.linearRealtimeSync = true;
      }

      // GitHub config
      if (vars['GITHUB_TOKEN']) {
        config.githubEnabled = true;
        config.githubToken = vars['GITHUB_TOKEN'];
      }
      if (vars['GITHUB_REPO']) {
        config.githubRepo = vars['GITHUB_REPO'];
      }
      if (vars['GITHUB_AUTO_SYNC']?.toLowerCase() === 'true') {
        config.githubAutoSync = true;
      }

      // GitLab config
      if (vars[GITLAB_ENV_KEYS.TOKEN]) {
        config.gitlabToken = vars[GITLAB_ENV_KEYS.TOKEN];
        // Enable by default if token exists and GITLAB_ENABLED is not explicitly false
        config.gitlabEnabled = vars[GITLAB_ENV_KEYS.ENABLED]?.toLowerCase() !== 'false';
      }
      if (vars[GITLAB_ENV_KEYS.INSTANCE_URL]) {
        config.gitlabInstanceUrl = vars[GITLAB_ENV_KEYS.INSTANCE_URL];
      }
      if (vars[GITLAB_ENV_KEYS.PROJECT]) {
        config.gitlabProject = vars[GITLAB_ENV_KEYS.PROJECT];
      }
      if (vars[GITLAB_ENV_KEYS.AUTO_SYNC]?.toLowerCase() === 'true') {
        config.gitlabAutoSync = true;
      }

      // Git/Worktree config
      if (vars['DEFAULT_BRANCH']) {
        config.defaultBranch = vars['DEFAULT_BRANCH'];
      }

      if (vars['GRAPHITI_ENABLED']?.toLowerCase() === 'true') {
        config.graphitiEnabled = true;
      }

      // OpenAI API Key: project-specific takes precedence, then global
      if (vars['OPENAI_API_KEY']) {
        config.openaiApiKey = vars['OPENAI_API_KEY'];
        config.openaiKeyIsGlobal = false;
      } else if (globalSettings.globalOpenAIApiKey) {
        config.openaiApiKey = globalSettings.globalOpenAIApiKey;
        config.openaiKeyIsGlobal = true;
      }

      if (vars['GRAPHITI_DATABASE']) {
        config.graphitiDatabase = vars['GRAPHITI_DATABASE'];
      }
      if (vars['GRAPHITI_DB_PATH']) {
        config.graphitiDbPath = vars['GRAPHITI_DB_PATH'];
      }

      if (vars['ENABLE_FANCY_UI']?.toLowerCase() === 'false') {
        config.enableFancyUi = false;
      }

      // Populate graphitiProviderConfig from .env file (embeddings only - no LLM provider)
      const embeddingProvider = vars['GRAPHITI_EMBEDDER_PROVIDER'];
      if (embeddingProvider || vars['AZURE_OPENAI_API_KEY'] ||
          vars['VOYAGE_API_KEY'] || vars['GOOGLE_API_KEY'] || vars['OLLAMA_BASE_URL']) {
        config.graphitiProviderConfig = {
          embeddingProvider: (embeddingProvider as 'openai' | 'voyage' | 'azure_openai' | 'ollama' | 'google') || 'ollama',
          // OpenAI Embeddings
          openaiApiKey: vars['OPENAI_API_KEY'],
          openaiEmbeddingModel: vars['OPENAI_EMBEDDING_MODEL'],
          // Azure OpenAI Embeddings
          azureOpenaiApiKey: vars['AZURE_OPENAI_API_KEY'],
          azureOpenaiBaseUrl: vars['AZURE_OPENAI_BASE_URL'],
          azureOpenaiEmbeddingDeployment: vars['AZURE_OPENAI_EMBEDDING_DEPLOYMENT'],
          // Voyage Embeddings
          voyageApiKey: vars['VOYAGE_API_KEY'],
          voyageEmbeddingModel: vars['VOYAGE_EMBEDDING_MODEL'],
          // Google Embeddings
          googleApiKey: vars['GOOGLE_API_KEY'],
          googleEmbeddingModel: vars['GOOGLE_EMBEDDING_MODEL'],
          // Ollama Embeddings
          ollamaBaseUrl: vars['OLLAMA_BASE_URL'],
          ollamaEmbeddingModel: vars['OLLAMA_EMBEDDING_MODEL'],
          ollamaEmbeddingDim: vars['OLLAMA_EMBEDDING_DIM'] ? parseInt(vars['OLLAMA_EMBEDDING_DIM'], 10) : undefined,
          // LadybugDB
          database: vars['GRAPHITI_DATABASE'],
          dbPath: vars['GRAPHITI_DB_PATH'],
        };
      }

      // MCP Server Configuration (per-project overrides)
      // Default: context7=true, linear=true (if API key set), electron/puppeteer=false
      config.mcpServers = {
        context7Enabled: vars['CONTEXT7_ENABLED']?.toLowerCase() !== 'false', // default true
        graphitiEnabled: config.graphitiEnabled, // follows GRAPHITI_ENABLED
        linearMcpEnabled: vars['LINEAR_MCP_ENABLED']?.toLowerCase() !== 'false', // default true
        electronEnabled: vars['ELECTRON_MCP_ENABLED']?.toLowerCase() === 'true', // default false
        puppeteerEnabled: vars['PUPPETEER_MCP_ENABLED']?.toLowerCase() === 'true', // default false
      };

      // Parse per-agent MCP overrides (AGENT_MCP_<agent>_ADD/REMOVE)
      const agentMcpOverrides: Record<string, { add?: string[]; remove?: string[] }> = {};
      Object.entries(vars).forEach(([key, value]) => {
        if (key.startsWith('AGENT_MCP_') && key.endsWith('_ADD')) {
          const agentId = key.replace('AGENT_MCP_', '').replace('_ADD', '');
          if (!agentMcpOverrides[agentId]) agentMcpOverrides[agentId] = {};
          agentMcpOverrides[agentId].add = value.split(',').map(s => s.trim()).filter(Boolean);
        } else if (key.startsWith('AGENT_MCP_') && key.endsWith('_REMOVE')) {
          const agentId = key.replace('AGENT_MCP_', '').replace('_REMOVE', '');
          if (!agentMcpOverrides[agentId]) agentMcpOverrides[agentId] = {};
          agentMcpOverrides[agentId].remove = value.split(',').map(s => s.trim()).filter(Boolean);
        }
      });

      if (Object.keys(agentMcpOverrides).length > 0) {
        config.agentMcpOverrides = agentMcpOverrides;
      }

      // Parse custom MCP servers (user-defined)
      if (vars['CUSTOM_MCP_SERVERS']) {
        try {
          config.customMcpServers = JSON.parse(vars['CUSTOM_MCP_SERVERS']);
        } catch {
          // Invalid JSON, ignore
          config.customMcpServers = [];
        }
      }

      return { success: true, data: config };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ENV_UPDATE,
    async (_, projectId: string, config: Partial<ProjectEnvConfig>): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      if (!project.autoBuildPath) {
        return { success: false, error: 'Project not initialized' };
      }

      const envPath = path.join(project.path, project.autoBuildPath, '.env');

      try {
        // Read existing content if file exists (atomic read, no TOCTOU)
        let existingContent: string | undefined;
        try {
          existingContent = readFileSync(envPath, 'utf-8');
        } catch (readErr: unknown) {
          if ((readErr as NodeJS.ErrnoException).code !== 'ENOENT') throw readErr;
          // File doesn't exist yet - existingContent stays undefined
        }

        // Generate new content
        const newContent = generateEnvContent(config, existingContent);

        // Write to file
        writeFileSync(envPath, newContent, 'utf-8');

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update .env file'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ENV_CHECK_CLAUDE_AUTH,
    async (_, projectId: string): Promise<IPCResult<ClaudeAuthResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // Use async version to avoid blocking main process during CLI detection
      const resolved = await resolveClaudeCliInvocationAsync();
      if ('error' in resolved) {
        return { success: false, error: resolved.error };
      }
      const claudeCmd = resolved.command;
      const claudeEnv = resolved.env;

      try {
        // Check if Claude CLI is available and authenticated
        const result = await new Promise<ClaudeAuthResult>((resolve) => {
          const proc = spawn(getSpawnCommand(claudeCmd), ['--version'], getSpawnOptions(claudeCmd, {
            cwd: project.path,
            env: claudeEnv,
          }));

          let _stdout = '';
          let _stderr = '';

          proc.stdout?.on('data', (data: Buffer) => {
            _stdout += data.toString('utf-8');
          });

          proc.stderr?.on('data', (data: Buffer) => {
            _stderr += data.toString('utf-8');
          });

          proc.on('close', (code: number | null) => {
            if (code === 0) {
              // Claude CLI is available, check if authenticated
              // Run a simple command that requires auth
              const authCheck = spawn(getSpawnCommand(claudeCmd), ['api', '--help'], getSpawnOptions(claudeCmd, {
                cwd: project.path,
                env: claudeEnv,
              }));

              authCheck.on('close', (authCode: number | null) => {
                resolve({
                  success: true,
                  authenticated: authCode === 0
                });
              });

              authCheck.on('error', () => {
                resolve({
                  success: true,
                  authenticated: false,
                  error: 'Could not verify authentication'
                });
              });
            } else {
              resolve({
                success: false,
                authenticated: false,
                error: 'Claude CLI not found. Please install it first.'
              });
            }
          });

          proc.on('error', () => {
            resolve({
              success: false,
              authenticated: false,
              error: 'Claude CLI not found. Please install it first.'
            });
          });
        });

        if (!result.success) {
          return { success: false, error: result.error || 'Failed to check Claude auth' };
        }
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check Claude auth'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ENV_INVOKE_CLAUDE_SETUP,
    async (_, projectId: string): Promise<IPCResult<ClaudeAuthResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // Use async version to avoid blocking main process during CLI detection
      const resolved = await resolveClaudeCliInvocationAsync();
      if ('error' in resolved) {
        return { success: false, error: resolved.error };
      }
      const claudeCmd = resolved.command;
      const claudeEnv = resolved.env;

      try {
        // Run claude setup-token which will open browser for OAuth
        const result = await new Promise<ClaudeAuthResult>((resolve) => {
          const proc = spawn(getSpawnCommand(claudeCmd), ['setup-token'], getSpawnOptions(claudeCmd, {
            cwd: project.path,
            env: claudeEnv,
            stdio: 'inherit' // This allows the terminal to handle the interactive auth
          }));

          proc.on('close', (code: number | null) => {
            if (code === 0) {
              resolve({
                success: true,
                authenticated: true
              });
            } else {
              resolve({
                success: false,
                authenticated: false,
                error: 'Setup cancelled or failed'
              });
            }
          });

          proc.on('error', (err: Error) => {
            resolve({
              success: false,
              authenticated: false,
              error: err.message
            });
          });
        });

        if (!result.success) {
          return { success: false, error: result.error || 'Failed to invoke Claude setup' };
        }
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to invoke Claude setup'
        };
      }
    }
  );

}
