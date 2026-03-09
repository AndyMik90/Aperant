/**
 * Memory Infrastructure IPC Handlers
 *
 * Provides Ollama model discovery, download, and memory-related IPC handlers.
 */

import { ipcMain } from 'electron';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getOllamaExecutablePaths, getOllamaInstallCommand as getPlatformOllamaInstallCommand, getWhichCommand, getCurrentOS } from '../platform';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  IPCResult,
} from '../../shared/types';
import { openTerminalWithCommand } from './claude-code-handlers';

/**
 * Ollama Service Status
 * Contains information about Ollama service availability and configuration
 */
interface OllamaStatus {
  running: boolean;      // Whether Ollama service is currently running
  url: string;          // Base URL of the Ollama API
  version?: string;     // Ollama version (if available)
  message?: string;     // Additional status message
}

/**
 * Ollama Model Information
 * Metadata about a model available in Ollama
 */
interface OllamaModel {
  name: string;         // Model identifier (e.g., 'embeddinggemma', 'llama2')
  size_bytes: number;   // Model size in bytes
  size_gb: number;      // Model size in gigabytes (formatted)
  modified_at: string;  // Last modified timestamp
  is_embedding: boolean; // Whether this is an embedding model
  embedding_dim?: number | null; // Embedding dimension (only for embedding models)
  description?: string; // Model description
}

/**
 * Ollama Embedding Model Information
 * Specialized model info for semantic search models
 */
interface OllamaEmbeddingModel {
  name: string;             // Model name
  embedding_dim: number | null; // Embedding vector dimension
  description: string;      // Model description
  size_bytes: number;
  size_gb: number;
}

/**
 * Recommended Embedding Model Card
 * Pre-curated models suitable for Auto Claude memory system
 */
interface OllamaRecommendedModel {
  name: string;          // Model identifier
  description: string;   // Human-readable description
  size_estimate: string; // Estimated download size (e.g., '621 MB')
  dim: number;           // Embedding vector dimension
  installed: boolean;    // Whether model is currently installed
}

/**
 * Result of ollama pull command
 * Contains the final status after model download completes
 */
interface OllamaPullResult {
  model: string;                         // Model name that was pulled
  status: 'completed' | 'failed';        // Final status
  output: string[];                      // Log messages from pull operation
}

/**
 * Ollama Installation Status
 * Information about whether Ollama is installed on the system
 */
interface OllamaInstallStatus {
  installed: boolean;         // Whether Ollama binary is found on the system
  path?: string;             // Path to Ollama binary (if found)
  version?: string;          // Installed version (if available)
}

/**
 * Check if Ollama is installed on the system by looking for the binary.
 * Checks common installation paths and PATH environment variable.
 *
 * @returns {OllamaInstallStatus} Installation status with path if found
 */
function checkOllamaInstalled(): OllamaInstallStatus {
  // Get platform-specific paths from the platform module
  const pathsToCheck = getOllamaExecutablePaths();

  // Check each path
  // SECURITY NOTE: ollamaPath values come from the platform module's hardcoded paths,
  // not from user input or environment variables. These are known system installation paths.
  for (const ollamaPath of pathsToCheck) {
    if (fs.existsSync(ollamaPath)) {
      // Try to get version - use execFileSync to avoid shell injection
      let version: string | undefined;
      try {
        const versionOutput = execFileSync(ollamaPath, ['--version'], {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        }).toString().trim();
        // Parse version from output like "ollama version 0.1.23"
        const match = versionOutput.match(/(\d+\.\d+\.\d+)/);
        if (match) {
          version = match[1];
        }
      } catch {
        // Couldn't get version, but binary exists
      }

      return {
        installed: true,
        path: ollamaPath,
        version,
      };
    }
  }

  // Also check if ollama is in PATH using where/which command
  // Use execFileSync with explicit command to avoid shell injection
  try {
    const whichCmd = getWhichCommand();
    const ollamaPath = execFileSync(whichCmd, ['ollama'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    }).toString().trim().split('\n')[0]; // Get first result on Windows

    if (ollamaPath && fs.existsSync(ollamaPath)) {
      let version: string | undefined;
      try {
        // Use the discovered path directly with execFileSync
        const versionOutput = execFileSync(ollamaPath, ['--version'], {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        }).toString().trim();
        const match = versionOutput.match(/(\d+\.\d+\.\d+)/);
        if (match) {
          version = match[1];
        }
      } catch {
        // Couldn't get version
      }

      return {
        installed: true,
        path: ollamaPath,
        version,
      };
    }
  } catch {
    // Not in PATH
  }

  return { installed: false };
}

/**
 * Get the platform-specific install command for Ollama
 * Uses the official Ollama installation methods from the platform module.
 *
 * Windows: Uses winget (Windows Package Manager)
 * macOS: Uses Homebrew
 * Linux: Uses official install script from https://ollama.com/download
 *
 * @returns {string} The install command to run in terminal
 */
function getOllamaInstallCommand(): string {
  return getPlatformOllamaInstallCommand();
}

// ============================================
// Native Ollama HTTP API client (replaces Python subprocess)
// ============================================

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';
const OLLAMA_TIMEOUT_MS = 10000;

// Known embedding model name patterns
const EMBEDDING_MODEL_PATTERNS = [
  'embed', 'embedding', 'bge-', 'gte-', 'e5-', 'nomic-embed',
  'mxbai-embed', 'snowflake-arctic-embed', 'all-minilm',
];

function isEmbeddingModel(name: string): boolean {
  const lower = name.toLowerCase();
  return EMBEDDING_MODEL_PATTERNS.some(p => lower.includes(p));
}

// Deduplication cache to prevent rapid-fire HTTP requests (e.g., from React re-render loops)
const ollamaApiCache = new Map<string, { promise: Promise<{ success: boolean; data?: unknown; error?: string }>; timestamp: number }>();
const OLLAMA_CACHE_TTL_MS = 2000;

function cachedOllamaRequest(
  key: string,
  fn: () => Promise<{ success: boolean; data?: unknown; error?: string }>
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const cached = ollamaApiCache.get(key);
  if (cached && Date.now() - cached.timestamp < OLLAMA_CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = fn();
  ollamaApiCache.set(key, { promise, timestamp: Date.now() });
  promise.finally(() => {
    setTimeout(() => {
      const entry = ollamaApiCache.get(key);
      if (entry && entry.promise === promise) {
        ollamaApiCache.delete(key);
      }
    }, OLLAMA_CACHE_TTL_MS);
  });
  return promise;
}

/**
 * Make an HTTP request to the Ollama API.
 */
async function ollamaFetch(
  urlPath: string,
  baseUrl?: string,
  options?: { method?: string; body?: string; timeout?: number }
): Promise<Response> {
  const base = (baseUrl || OLLAMA_DEFAULT_URL).replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = options?.timeout ?? OLLAMA_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(`${base}${urlPath}`, {
      method: options?.method ?? 'GET',
      body: options?.body,
      headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if Ollama service is running via its API.
 */
async function checkOllamaRunning(baseUrl?: string): Promise<OllamaStatus> {
  const url = (baseUrl || OLLAMA_DEFAULT_URL).replace(/\/+$/, '');
  try {
    const res = await ollamaFetch('/api/version', baseUrl);
    if (res.ok) {
      const data = await res.json();
      return { running: true, url, version: data.version };
    }
    return { running: false, url, message: `HTTP ${res.status}` };
  } catch {
    return { running: false, url, message: 'Cannot connect to Ollama' };
  }
}

/**
 * List all models from Ollama API and classify as embedding or LLM.
 */
async function listOllamaModelsNative(baseUrl?: string): Promise<OllamaModel[]> {
  const res = await ollamaFetch('/api/tags', baseUrl);
  if (!res.ok) throw new Error(`Ollama API returned ${res.status}`);
  const data = await res.json();
  const models: OllamaModel[] = (data.models ?? []).map((m: {
    name: string;
    size: number;
    modified_at: string;
    details?: { family?: string };
  }) => {
    const sizeBytes = m.size ?? 0;
    return {
      name: m.name,
      size_bytes: sizeBytes,
      size_gb: Number((sizeBytes / 1e9).toFixed(2)),
      modified_at: m.modified_at ?? '',
      is_embedding: isEmbeddingModel(m.name),
      embedding_dim: null,
      description: m.details?.family ?? '',
    };
  });
  return models;
}

/**
 * Register all memory-related IPC handlers.
 * Sets up handlers for:
 * - Memory infrastructure status and management
 * - Ollama model discovery and downloads with real-time progress tracking
 *
 * These handlers allow the renderer process to:
 * 1. Check memory system status (Kuzu database, LadybugDB)
 * 2. Discover, list, and download Ollama models
 * 3. Subscribe to real-time download progress events
 *
 * @returns {void}
 */
export function registerMemoryHandlers(): void {
  // ============================================
  // Ollama Model Detection Handlers
  // ============================================

  // Check if Ollama is running (native HTTP)
  ipcMain.handle(
    IPC_CHANNELS.OLLAMA_CHECK_STATUS,
    async (_, baseUrl?: string): Promise<IPCResult<OllamaStatus>> => {
      try {
        const status = await cachedOllamaRequest(
          `check-status:${baseUrl || 'default'}`,
          async () => {
            const s = await checkOllamaRunning(baseUrl);
            return { success: true, data: s };
          }
        );
        const data = status.data as OllamaStatus;
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check Ollama status',
        };
      }
    }
  );

  // Check if Ollama is installed (binary exists on system)
  ipcMain.handle(
    IPC_CHANNELS.OLLAMA_CHECK_INSTALLED,
    async (): Promise<IPCResult<OllamaInstallStatus>> => {
      try {
        const installStatus = checkOllamaInstalled();
        return {
          success: true,
          data: installStatus,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check Ollama installation',
        };
      }
    }
  );

  // Install Ollama (opens terminal with official install command)
  ipcMain.handle(
    IPC_CHANNELS.OLLAMA_INSTALL,
    async (): Promise<IPCResult<{ command: string }>> => {
      try {
        const command = getOllamaInstallCommand();

        await openTerminalWithCommand(command);

        return {
          success: true,
          data: { command },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: `Failed to open terminal for installation: ${errorMsg}`,
        };
      }
    }
  );

    // ============================================
    // Ollama Model Discovery & Management
    // ============================================

    /**
    * List all available Ollama models (LLMs and embeddings).
    * Queries Ollama API to get model names, sizes, and metadata.
    *
    * @async
    * @param {string} [baseUrl] - Optional custom Ollama base URL
    * @returns {Promise<IPCResult<{ models, count }>>} Array of models with metadata
    */
   ipcMain.handle(
     IPC_CHANNELS.OLLAMA_LIST_MODELS,
     async (_, baseUrl?: string): Promise<IPCResult<{ models: OllamaModel[]; count: number }>> => {
      try {
        const result = await cachedOllamaRequest(
          `list-models:${baseUrl || 'default'}`,
          async () => {
            const models = await listOllamaModelsNative(baseUrl);
            return { success: true, data: { models, count: models.length } };
          }
        );
        if (!result.success) {
          return { success: false, error: result.error || 'Failed to list Ollama models' };
        }
        const data = result.data as { models: OllamaModel[]; count: number };
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list Ollama models',
        };
      }
    }
  );

   /**
    * List only embedding models from Ollama.
    * Filters the model list to show only models suitable for semantic search.
    * Includes dimension info for model compatibility verification.
    *
    * @async
    * @param {string} [baseUrl] - Optional custom Ollama base URL
    * @returns {Promise<IPCResult<{ embedding_models, count }>>} Filtered embedding models
    */
   ipcMain.handle(
     IPC_CHANNELS.OLLAMA_LIST_EMBEDDING_MODELS,
     async (
       _,
       baseUrl?: string
     ): Promise<IPCResult<{ embedding_models: OllamaEmbeddingModel[]; count: number }>> => {
      try {
        const result = await cachedOllamaRequest(
          `list-embedding-models:${baseUrl || 'default'}`,
          async () => {
            const allModels = await listOllamaModelsNative(baseUrl);
            const embeddingModels: OllamaEmbeddingModel[] = allModels
              .filter(m => m.is_embedding)
              .map(m => ({
                name: m.name,
                embedding_dim: m.embedding_dim ?? null,
                description: m.description ?? '',
                size_bytes: m.size_bytes,
                size_gb: m.size_gb,
              }));
            return { success: true, data: { embedding_models: embeddingModels, count: embeddingModels.length } };
          }
        );
        if (!result.success) {
          return { success: false, error: result.error || 'Failed to list embedding models' };
        }
        const data = result.data as { embedding_models: OllamaEmbeddingModel[]; count: number };
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list embedding models',
        };
      }
    }
  );

   /**
    * Download (pull) an Ollama model from the Ollama registry.
    * Spawns a Python subprocess to execute ollama pull command with real-time progress tracking.
    * Emits OLLAMA_PULL_PROGRESS events to renderer with percentage, speed, and ETA.
    *
    * Progress events include:
    * - modelName: The model being downloaded
    * - status: Current status (downloading, extracting, etc.)
    * - completed: Bytes downloaded so far
    * - total: Total bytes to download
    * - percentage: Completion percentage (0-100)
    *
    * @async
    * @param {Electron.IpcMainInvokeEvent} event - IPC event object for sending progress updates
    * @param {string} modelName - Name of the model to download (e.g., 'embeddinggemma')
    * @param {string} [baseUrl] - Optional custom Ollama base URL
    * @returns {Promise<IPCResult<OllamaPullResult>>} Result with status and output messages
    */
   ipcMain.handle(
     IPC_CHANNELS.OLLAMA_PULL_MODEL,
     async (
       event,
       modelName: string,
       baseUrl?: string
     ): Promise<IPCResult<OllamaPullResult>> => {
      try {
        const base = (baseUrl || OLLAMA_DEFAULT_URL).replace(/\/+$/, '');
        const res = await fetch(`${base}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName, stream: true }),
        });

        if (!res.ok) {
          return { success: false, error: `Ollama API returned ${res.status}` };
        }

        const reader = res.body?.getReader();
        if (!reader) {
          return { success: false, error: 'No response body from Ollama' };
        }

        const decoder = new TextDecoder();
        let buffer = '';
        const output: string[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const progress = JSON.parse(line);
              output.push(progress.status || '');

              if (progress.completed !== undefined && progress.total !== undefined) {
                const percentage = progress.total > 0
                  ? Math.round((progress.completed / progress.total) * 100)
                  : 0;
                event.sender.send(IPC_CHANNELS.OLLAMA_PULL_PROGRESS, {
                  modelName,
                  status: progress.status || 'downloading',
                  completed: progress.completed,
                  total: progress.total,
                  percentage,
                });
              }
            } catch {
              // Skip non-JSON lines
            }
          }
        }

        return {
          success: true,
          data: { model: modelName, status: 'completed', output },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to pull model',
        };
      }
    }
  );

  // ============================================
  // Memory System (libSQL-backed) Handlers
  // ============================================

  // Search memories
  ipcMain.handle(
    'memory:search',
    async (_event, query: string, filters: Record<string, unknown>) => {
      try {
        const { getMemoryService } = await import('./context/memory-service-factory');
        const service = await getMemoryService();

        const memories = await service.search({
          query: query || undefined,
          ...(filters as object),
        });

        return { success: true, data: memories };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to search memories',
        };
      }
    },
  );

  // Insert a user-taught memory (from /remember command or Teach panel)
  ipcMain.handle(
    'memory:insert-user-taught',
    async (_event, content: string, projectId: string, tags: string[]) => {
      try {
        const { getMemoryService } = await import('./context/memory-service-factory');
        const service = await getMemoryService();

        const id = await service.insertUserTaught(content, projectId, tags);
        return { success: true, id };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to insert memory',
        };
      }
    },
  );
}
