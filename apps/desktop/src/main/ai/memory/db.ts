/**
 * Database Client Factory
 *
 * Supports three deployment modes:
 * 1. Free/offline (Electron, no login) — local libSQL file
 * 2. Cloud user (Electron, logged in) — embedded replica with Turso sync
 * 3. Web app (Next.js SaaS) — pure cloud libSQL
 */

import type { Client, Config } from '@libsql/client/sqlite3';
import { createRequire } from 'module';
import { join } from 'path';
import { MEMORY_SCHEMA_SQL, MEMORY_PRAGMA_SQL } from './schema';

/**
 * Lazy-load @libsql/client via CJS require().
 *
 * @libsql/client depends on native platform-specific modules (@libsql/darwin-arm64,
 * @libsql/linux-x64-gnu, etc.). In packaged Electron apps these live in
 * Resources/node_modules/ (via extraResources). ESM import() can't resolve them
 * from within app.asar, but CJS require() works because Module.globalPaths is
 * patched at startup in index.ts to include Resources/node_modules/.
 *
 * Using a lazy getter avoids a static import that would crash at startup before
 * the globalPaths patch runs.
 */
let _createClient: ((config: Config) => Client) | null = null;

function loadCreateClient(): (config: Config) => Client {
  if (!_createClient) {
    // In Electron: globalThis.require is set up in index.ts with Module.globalPaths
    // patched to include Resources/node_modules/ for extraResources packages.
    // In tests/dev: fall back to createRequire (deps are in normal node_modules).
    const req = globalThis.require ?? createRequire(import.meta.url);
    let mod: Record<string, unknown>;
    try {
      mod = req('@libsql/client/sqlite3');
    } catch (err) {
      throw new Error(
        `Failed to load @libsql/client/sqlite3: ${(err as Error).message}. ` +
        `Ensure native modules are available in Resources/node_modules/`
      );
    }
    if (typeof mod.createClient !== 'function') {
      throw new Error(
        `@libsql/client/sqlite3 did not export createClient (got ${typeof mod.createClient}). ` +
        `Check that native modules are available in Resources/node_modules/`
      );
    }
    _createClient = mod.createClient as (config: Config) => Client;
  }
  return _createClient!;
}

let _client: Client | null = null;

/**
 * Get or create the Electron memory database client.
 * Uses local libSQL file by default; optionally syncs to Turso Cloud.
 *
 * @param tursoSyncUrl - Optional Turso Cloud sync URL for cloud users
 * @param authToken - Required when tursoSyncUrl is provided
 */
export async function getMemoryClient(
  tursoSyncUrl?: string,
  authToken?: string,
): Promise<Client> {
  if (_client) return _client;

  // Lazy import electron to avoid issues in test environments
  const { app } = await import('electron');
  const localPath = join(app.getPath('userData'), 'memory.db');

  _client = loadCreateClient()({
    url: `file:${localPath}`,
    ...(tursoSyncUrl && authToken
      ? { syncUrl: tursoSyncUrl, authToken, syncInterval: 60 }
      : {}),
  });

  // Apply WAL and other PRAGMAs first (must be separate execute calls)
  for (const pragma of MEMORY_PRAGMA_SQL.split('\n').filter(l => l.trim())) {
    try {
      await _client.execute(pragma);
    } catch {
      // Some PRAGMAs may not be supported in all libSQL modes — ignore
    }
  }

  // Initialize schema (idempotent — uses CREATE IF NOT EXISTS throughout)
  await _client.executeMultiple(MEMORY_SCHEMA_SQL);

  // libsql has native vector support (vector_distance_cos, F32_BLOB) —
  // no sqlite-vec extension needed for either local or cloud mode.

  return _client;
}

/**
 * Close and reset the singleton client.
 * Call this on app quit or when switching projects.
 */
export async function closeMemoryClient(): Promise<void> {
  if (_client) {
    _client.close();
    _client = null;
  }
}

/**
 * Get a web app (Next.js) memory client for pure cloud access.
 * Not a singleton — each call creates a new client.
 *
 * @param tursoUrl - Turso Cloud database URL
 * @param authToken - Auth token for the database
 */
export async function getWebMemoryClient(
  tursoUrl: string,
  authToken: string,
): Promise<Client> {
  const client = loadCreateClient()({ url: tursoUrl, authToken });

  // Apply PRAGMAs
  for (const pragma of MEMORY_PRAGMA_SQL.split('\n').filter(l => l.trim())) {
    try {
      await client.execute(pragma);
    } catch {
      // Ignore unsupported PRAGMAs in cloud mode
    }
  }

  await client.executeMultiple(MEMORY_SCHEMA_SQL);
  return client;
}

/**
 * Create an in-memory client (for tests — no Electron dependency).
 */
export async function getInMemoryClient(): Promise<Client> {
  const client = loadCreateClient()({ url: ':memory:' });
  await client.executeMultiple(MEMORY_SCHEMA_SQL);
  return client;
}
