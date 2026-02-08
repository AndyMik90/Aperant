/**
 * Memory Service
 *
 * Queries the LadybugDB graph database for memories stored by Graphiti.
 * Uses Python subprocess to communicate with the embedded database.
 *
 * LadybugDB stores data in Kuzu format at ~/.auto-claude/memories/<database>/
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import { app } from 'electron';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { findPythonCommand, parsePythonCommand } from './python-detector';
import { getConfiguredPythonPath, pythonEnvManager } from './python-env-manager';
import { getMemoriesDir } from './config-paths';
import { isWindows } from './platform';
import type { MemoryEpisode } from '../shared/types';

interface MemoryServiceConfig {
  dbPath: string;
  database: string;
}

// Embedder configuration for semantic search
export interface EmbedderConfig {
  provider: 'openai' | 'google' | 'ollama' | 'voyage' | 'azure_openai';
  // OpenAI
  openaiApiKey?: string;
  openaiEmbeddingModel?: string;
  // Google AI
  googleApiKey?: string;
  googleEmbeddingModel?: string;
  // Ollama
  ollamaBaseUrl?: string;
  ollamaEmbeddingModel?: string;
  ollamaEmbeddingDim?: number;
  // Voyage AI
  voyageApiKey?: string;
  voyageEmbeddingModel?: string;
  // Azure OpenAI
  azureOpenaiApiKey?: string;
  azureOpenaiBaseUrl?: string;
  azureOpenaiEmbeddingDeployment?: string;
}

interface SemanticSearchResult extends MemoryQueryResult {
  search_type: 'semantic' | 'keyword';
  embedder?: string;
}

interface QueryResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface MemoryQueryResult {
  memories: Array<{
    id: string;
    name: string;
    type: string;
    timestamp: string;
    content: string;
    description?: string;
    group_id?: string;
    session_number?: number;
    score?: number;
  }>;
  count: number;
  query?: string;
}

interface StatusResult {
  available: boolean;
  ladybugInstalled: boolean;
  databasePath: string;
  database: string;
  databaseExists: boolean;
  connected?: boolean;
  databases?: string[];
  error?: string | null;
}

/**
 * Get the default database path
 * Uses XDG-compliant paths on Linux for AppImage/Flatpak/Snap support
 */
export function getDefaultDbPath(): string {
  return getMemoriesDir();
}

/**
 * Get the path to the query_memory.py script
 */
function getQueryScriptPath(): string | null {
  // Look for the script in backend directory - validate using spec_runner.py marker
  const possiblePaths = [
    // Packaged app: backend is in extraResources (process.resourcesPath/backend)
    ...(app.isPackaged ? [path.join(process.resourcesPath, 'backend', 'query_memory.py')] : []),
    // Apps structure: from dist/main -> apps/backend
    path.resolve(__dirname, '..', '..', '..', 'backend', 'query_memory.py'),
    path.resolve(app.getAppPath(), '..', 'backend', 'query_memory.py'),
    path.resolve(process.cwd(), 'apps', 'backend', 'query_memory.py')
  ];

  for (const p of possiblePaths) {
    // Validate backend structure by checking for spec_runner.py marker
    const backendPath = path.dirname(p);
    const specRunnerPath = path.join(backendPath, 'runners', 'spec_runner.py');
    if (fs.existsSync(p) && fs.existsSync(specRunnerPath)) {
      return p;
    }
  }
  return null;
}

/**
 * Get the backend venv Python path.
 * The backend venv has real_ladybug installed (required for memory operations).
 * Falls back to getConfiguredPythonPath() for packaged apps.
 */
function getBackendPythonPath(): string {
  // For packaged apps, use the bundled Python which has real_ladybug in site-packages
  if (app.isPackaged) {
    const fallbackPython = getConfiguredPythonPath();
    console.log(`[MemoryService] Using bundled Python for packaged app: ${fallbackPython}`);
    return fallbackPython;
  }

  // Development mode: Find the backend venv which has real_ladybug installed
  const possibleBackendPaths = [
    path.resolve(__dirname, '..', '..', '..', 'backend'),
    path.resolve(app.getAppPath(), '..', 'backend'),
    path.resolve(process.cwd(), 'apps', 'backend')
  ];

  for (const backendPath of possibleBackendPaths) {
    // Check for backend venv Python (has real_ladybug installed)
    const venvPython = isWindows()
      ? path.join(backendPath, '.venv', 'Scripts', 'python.exe')
      : path.join(backendPath, '.venv', 'bin', 'python');

    if (fs.existsSync(venvPython)) {
      console.log(`[MemoryService] Using backend venv Python: ${venvPython}`);
      return venvPython;
    }
  }

  // Fall back to configured Python path
  const fallbackPython = getConfiguredPythonPath();
  console.log(`[MemoryService] Backend venv not found, falling back to: ${fallbackPython}`);
  return fallbackPython;
}

/**
 * Get the Python environment variables for memory queries.
 * This ensures real_ladybug can be found in both dev and packaged modes.
 */
function getMemoryPythonEnv(): Record<string, string> {
  // Start with the standard Python environment from the manager
  const baseEnv = pythonEnvManager.getPythonEnv();

  // For packaged apps, ensure PYTHONPATH includes bundled site-packages
  // even if the manager hasn't been fully initialized
  if (app.isPackaged) {
    const bundledSitePackages = path.join(process.resourcesPath, 'python-site-packages');
    if (fs.existsSync(bundledSitePackages)) {
      // Merge paths: bundled site-packages takes precedence
      const existingPath = baseEnv.PYTHONPATH || '';
      baseEnv.PYTHONPATH = existingPath
        ? `${bundledSitePackages}${path.delimiter}${existingPath}`
        : bundledSitePackages;
    }
  }

  return baseEnv;
}

/**
 * Execute a Python memory query command
 */
async function executeQuery(
  command: string,
  args: string[],
  timeout: number = 10000
): Promise<QueryResult> {
  // Use getBackendPythonPath() to find the correct Python:
  // - In dev mode: uses backend venv with real_ladybug installed
  // - In packaged app: falls back to bundled Python
  const pythonCmd = getBackendPythonPath();

  const scriptPath = getQueryScriptPath();
  if (!scriptPath) {
    return { success: false, error: 'query_memory.py script not found' };
  }

  const [pythonExe, baseArgs] = parsePythonCommand(pythonCmd);

  return new Promise((resolve) => {
    // Promise guard flag to prevent double resolution
    let resolved = false;

    const fullArgs = [...baseArgs, scriptPath, command, ...args];

    // Get Python environment (includes PYTHONPATH for bundled/venv packages)
    // This is critical for finding real_ladybug (LadybugDB)
    const pythonEnv = getMemoryPythonEnv();

    const proc = spawn(pythonExe, fullArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      // Use pythonEnv which combines sanitized env + site-packages for real_ladybug
      env: pythonEnv,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString('utf-8');
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString('utf-8');
    });

    // Single timeout mechanism to avoid race condition
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve({ success: false, error: 'Query timed out' });
      }
    }, timeout);

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);

      // The Python script outputs JSON to stdout (even for errors)
      // Always try to parse stdout first to get the actual error message
      if (stdout) {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
          return;
        } catch {
          // JSON parsing failed
          if (code !== 0) {
            const errorMsg = stderr || stdout || `Process exited with code ${code}`;
            console.error('[MemoryService] Python error:', errorMsg);
            resolve({ success: false, error: errorMsg });
            return;
          }
          resolve({ success: false, error: `Invalid JSON response: ${stdout}` });
          return;
        }
      }
      // No stdout - use stderr or generic error
      const errorMsg = stderr || `Process exited with code ${code}`;
      console.error('[MemoryService] Python error (no stdout):', errorMsg);
      resolve({ success: false, error: errorMsg });
    });

    proc.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Execute semantic search with embedder configuration passed via environment
 */
async function executeSemanticQuery(
  args: string[],
  embedderConfig: EmbedderConfig,
  timeout: number = 30000 // Longer timeout for embedding operations
): Promise<QueryResult> {
  // Use getBackendPythonPath() to find the correct Python:
  // - In dev mode: uses backend venv with real_ladybug installed
  // - In packaged app: falls back to bundled Python
  const pythonCmd = getBackendPythonPath();

  const scriptPath = getQueryScriptPath();
  if (!scriptPath) {
    return { success: false, error: 'query_memory.py script not found' };
  }

  const [pythonExe, baseArgs] = parsePythonCommand(pythonCmd);

  // Get Python environment (includes PYTHONPATH for bundled/venv packages)
  // This is critical for finding real_ladybug (LadybugDB)
  const pythonEnv = getMemoryPythonEnv();

  // Build environment with embedder configuration
  // Use pythonEnv which combines sanitized env + site-packages for real_ladybug
  const env: Record<string, string | undefined> = { ...pythonEnv };

  // Set the embedder provider
  env.GRAPHITI_EMBEDDER_PROVIDER = embedderConfig.provider;

  // Provider-specific configuration
  switch (embedderConfig.provider) {
    case 'openai':
      if (embedderConfig.openaiApiKey) {
        env.OPENAI_API_KEY = embedderConfig.openaiApiKey;
      }
      if (embedderConfig.openaiEmbeddingModel) {
        env.OPENAI_EMBEDDING_MODEL = embedderConfig.openaiEmbeddingModel;
      }
      break;

    case 'google':
      if (embedderConfig.googleApiKey) {
        env.GOOGLE_API_KEY = embedderConfig.googleApiKey;
      }
      if (embedderConfig.googleEmbeddingModel) {
        env.GOOGLE_EMBEDDING_MODEL = embedderConfig.googleEmbeddingModel;
      }
      break;

    case 'ollama':
      if (embedderConfig.ollamaBaseUrl) {
        env.OLLAMA_BASE_URL = embedderConfig.ollamaBaseUrl;
      }
      if (embedderConfig.ollamaEmbeddingModel) {
        env.OLLAMA_EMBEDDING_MODEL = embedderConfig.ollamaEmbeddingModel;
      }
      if (embedderConfig.ollamaEmbeddingDim) {
        env.OLLAMA_EMBEDDING_DIM = String(embedderConfig.ollamaEmbeddingDim);
      }
      break;

    case 'voyage':
      if (embedderConfig.voyageApiKey) {
        env.VOYAGE_API_KEY = embedderConfig.voyageApiKey;
      }
      if (embedderConfig.voyageEmbeddingModel) {
        env.VOYAGE_EMBEDDING_MODEL = embedderConfig.voyageEmbeddingModel;
      }
      break;

    case 'azure_openai':
      if (embedderConfig.azureOpenaiApiKey) {
        env.AZURE_OPENAI_API_KEY = embedderConfig.azureOpenaiApiKey;
      }
      if (embedderConfig.azureOpenaiBaseUrl) {
        env.AZURE_OPENAI_BASE_URL = embedderConfig.azureOpenaiBaseUrl;
      }
      if (embedderConfig.azureOpenaiEmbeddingDeployment) {
        env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = embedderConfig.azureOpenaiEmbeddingDeployment;
      }
      break;
  }

  return new Promise((resolve) => {
    // Promise guard flag to prevent double resolution
    let resolved = false;

    const fullArgs = [...baseArgs, scriptPath, 'semantic-search', ...args];
    const proc = spawn(pythonExe, fullArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      timeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString('utf-8');
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString('utf-8');
    });

    // Single timeout mechanism to avoid race condition
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve({ success: false, error: 'Semantic search timed out' });
      }
    }, timeout);

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);

      // The Python script outputs JSON to stdout (even for errors)
      if (stdout) {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
          return;
        } catch {
          if (code !== 0) {
            const errorMsg = stderr || stdout || `Process exited with code ${code}`;
            console.error('[MemoryService] Semantic search error:', errorMsg);
            resolve({ success: false, error: errorMsg });
            return;
          }
          resolve({ success: false, error: `Invalid JSON response: ${stdout}` });
          return;
        }
      }
      const errorMsg = stderr || `Process exited with code ${code}`;
      console.error('[MemoryService] Semantic search error (no stdout):', errorMsg);
      resolve({ success: false, error: errorMsg });
    });

    proc.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Memory Service for querying graph memories from LadybugDB
 */
export class MemoryService {
  private config: MemoryServiceConfig;

  constructor(config: MemoryServiceConfig) {
    this.config = config;
  }

  /**
   * Get the full path to the database
   */
  private getDbFullPath(): string {
    return path.join(this.config.dbPath, this.config.database);
  }

  /**
   * Check if the database exists
   */
  databaseExists(): boolean {
    const dbPath = this.getDbFullPath();
    return fs.existsSync(dbPath);
  }

  /**
   * List all available databases
   */
  listDatabases(): string[] {
    try {
      const basePath = this.config.dbPath;
      if (!fs.existsSync(basePath)) {
        return [];
      }

      return fs.readdirSync(basePath).filter((name) => {
        if (name.startsWith('.')) return false;
        return true; // Include both files and directories
      });
    } catch (error) {
      console.error('Failed to list databases:', error);
      return [];
    }
  }

  /**
   * Query episodic memories from the database
   */
  async getEpisodicMemories(limit: number = 20): Promise<MemoryEpisode[]> {
    const result = await executeQuery('get-memories', [
      this.config.dbPath,
      this.config.database,
      '--limit',
      String(limit),
    ]);

    if (!result.success || !result.data) {
      console.error('Failed to get memories:', result.error);
      return [];
    }

    const data = result.data as MemoryQueryResult;
    return data.memories.map((m) => ({
      id: m.id,
      type: this.mapMemoryType(m.type),
      timestamp: m.timestamp,
      content: m.content,
      session_number: m.session_number,
    }));
  }

  /**
   * Query entity memories (patterns, gotchas, etc.) from the database
   */
  async getEntityMemories(limit: number = 20): Promise<MemoryEpisode[]> {
    const result = await executeQuery('get-entities', [
      this.config.dbPath,
      this.config.database,
      '--limit',
      String(limit),
    ]);

    if (!result.success || !result.data) {
      console.error('Failed to get entities:', result.error);
      return [];
    }

    const data = result.data as { entities: MemoryQueryResult['memories']; count: number };
    return data.entities.map((e) => ({
      id: e.id,
      type: this.mapMemoryType(e.type),
      timestamp: e.timestamp,
      content: e.content,
    }));
  }

  /**
   * Get all memories from the database
   */
  async getAllMemories(limit: number = 20): Promise<MemoryEpisode[]> {
    const [episodic, entities] = await Promise.all([
      this.getEpisodicMemories(limit),
      this.getEntityMemories(limit),
    ]);

    const memories = [...episodic, ...entities];

    // Sort by timestamp descending
    memories.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return memories.slice(0, limit);
  }

  /**
   * Search memories in the database (keyword search)
   */
  async searchMemories(searchQuery: string, limit: number = 20): Promise<MemoryEpisode[]> {
    const result = await executeQuery('search', [
      this.config.dbPath,
      this.config.database,
      searchQuery,
      '--limit',
      String(limit),
    ]);

    if (!result.success || !result.data) {
      console.error('Failed to search memories:', result.error);
      return [];
    }

    const data = result.data as MemoryQueryResult;
    return data.memories.map((m) => ({
      id: m.id,
      type: this.mapMemoryType(m.type),
      timestamp: m.timestamp,
      content: m.content,
      session_number: m.session_number,
      score: m.score,
    }));
  }

  /**
   * Semantic search using embeddings
   *
   * Uses the configured embedder to create vector embeddings and perform
   * similarity search. Falls back to keyword search if embedder fails.
   *
   * @param searchQuery The search query
   * @param embedderConfig Configuration for the embedding provider
   * @param limit Maximum number of results
   * @returns Memories with relevance scores
   */
  async searchMemoriesSemantic(
    searchQuery: string,
    embedderConfig: EmbedderConfig,
    limit: number = 20
  ): Promise<{ memories: MemoryEpisode[]; searchType: 'semantic' | 'keyword' }> {
    const result = await executeSemanticQuery(
      [this.config.dbPath, this.config.database, searchQuery, '--limit', String(limit)],
      embedderConfig
    );

    if (!result.success || !result.data) {
      console.error('Semantic search failed, falling back to keyword:', result.error);
      // Fall back to keyword search
      const memories = await this.searchMemories(searchQuery, limit);
      return { memories, searchType: 'keyword' };
    }

    const data = result.data as SemanticSearchResult;
    const memories = data.memories.map((m) => ({
      id: m.id,
      type: this.mapMemoryType(m.type),
      timestamp: m.timestamp,
      content: m.content,
      session_number: m.session_number,
      score: m.score,
    }));

    return {
      memories,
      searchType: data.search_type || 'semantic',
    };
  }

  /**
   * Test connection to the database
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const result = await executeQuery('get-status', [this.config.dbPath, this.config.database]);

    if (!result.success) {
      return {
        success: false,
        message: result.error || 'Failed to check database status',
      };
    }

    const data = result.data as StatusResult;

    if (!data.available) {
      return {
        success: false,
        message: 'LadybugDB (real_ladybug) not installed. Requires Python 3.12+',
      };
    }

    if (!data.databaseExists) {
      return {
        success: false,
        message: `Database not found at ${data.databasePath}/${data.database}`,
      };
    }

    if (!data.connected) {
      return {
        success: false,
        message: data.error || 'Failed to connect to database',
      };
    }

    const dbCount = data.databases?.length || 0;
    return {
      success: true,
      message: `Connected to LadybugDB with ${dbCount} databases`,
    };
  }

  /**
   * Add an episode to the memory database
   *
   * This allows the Electron app to save memories (like PR review insights)
   * directly to LadybugDB without going through the full Graphiti system.
   *
   * @param name Episode name/title
   * @param content Episode content (will be JSON stringified if object)
   * @param episodeType Type of episode (session_insight, pattern, gotcha, task_outcome, pr_review)
   * @param groupId Optional group ID for namespacing
   * @returns Promise with the created episode info
   */
  async addEpisode(
    name: string,
    content: string | object,
    episodeType: string = 'session_insight',
    groupId?: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    // Stringify content if it's an object
    const contentStr = typeof content === 'object' ? JSON.stringify(content) : content;

    const args = [
      this.config.dbPath,
      this.config.database,
      '--name', name,
      '--content', contentStr,
      '--type', episodeType,
    ];

    if (groupId) {
      args.push('--group-id', groupId);
    }

    const result = await executeQuery('add-episode', args);

    if (!result.success) {
      console.error('Failed to add episode:', result.error);
      return { success: false, error: result.error };
    }

    const data = result.data as { id: string; name: string; type: string; timestamp: string };
    return { success: true, id: data.id };
  }

  /**
   * Close the database connection (no-op for subprocess model)
   */
  async close(): Promise<void> {
    // No persistent connection to close with subprocess model
  }

  /**
   * Map string type to MemoryEpisode type
   */
  private mapMemoryType(type: string): MemoryEpisode['type'] {
    switch (type) {
      case 'session_insight':
        return 'session_insight';
      case 'pattern':
        return 'pattern';
      case 'gotcha':
        return 'gotcha';
      case 'codebase_discovery':
        return 'codebase_discovery';
      case 'task_outcome':
        return 'task_outcome';
      default:
        return 'session_insight';
    }
  }
}

// Singleton instance for reuse
let serviceInstance: MemoryService | null = null;

/**
 * Get or create a Memory service instance
 */
export function getMemoryService(config: MemoryServiceConfig): MemoryService {
  if (
    !serviceInstance ||
    serviceInstance['config'].dbPath !== config.dbPath ||
    serviceInstance['config'].database !== config.database
  ) {
    serviceInstance = new MemoryService(config);
  }
  return serviceInstance;
}

/**
 * Close the singleton service instance
 */
export async function closeMemoryService(): Promise<void> {
  if (serviceInstance) {
    await serviceInstance.close();
    serviceInstance = null;
  }
}

/**
 * Check if Python with LadybugDB is available
 */
export function isKuzuAvailable(): boolean {
  // Check if Python is available (findPythonCommand can return null)
  const pythonCmd = findPythonCommand();
  if (!pythonCmd) {
    return false;
  }

  // Check if query script exists
  const scriptPath = getQueryScriptPath();
  return scriptPath !== null;
}

/**
 * Get memory service status
 */
export interface MemoryServiceStatus {
  kuzuInstalled: boolean;
  databasePath: string;
  databaseExists: boolean;
  databases: string[];
}

export function getMemoryServiceStatus(dbPath?: string): MemoryServiceStatus {
  const basePath = dbPath || getDefaultDbPath();

  const databases = fs.existsSync(basePath)
    ? fs.readdirSync(basePath).filter((name) => !name.startsWith('.'))
    : [];

  // Check if Python and script are available (findPythonCommand can return null)
  const pythonAvailable = findPythonCommand() !== null;
  const scriptAvailable = getQueryScriptPath() !== null;

  return {
    kuzuInstalled: pythonAvailable && scriptAvailable,
    databasePath: basePath,
    databaseExists: databases.length > 0,
    databases,
  };
}
