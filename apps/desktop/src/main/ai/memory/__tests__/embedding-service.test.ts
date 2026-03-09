/**
 * embedding-service.test.ts — Tests for EmbeddingService with mocked providers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getInMemoryClient } from '../db';
import {
  EmbeddingService,
  buildContextualText,
  buildMemoryContextualText,
  type ASTChunk,
} from '../embedding-service';
import type { Memory } from '../types';
import type { Client } from '@libsql/client';

// ============================================================
// GLOBAL FETCH MOCK
// ============================================================

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ============================================================
// HELPERS
// ============================================================

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-001',
    type: 'gotcha',
    content: 'Always check path resolution in Electron packaged mode.',
    confidence: 0.9,
    tags: ['electron', 'path'],
    relatedFiles: ['src/main/index.ts'],
    relatedModules: ['main'],
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 1,
    scope: 'global',
    source: 'agent_explicit',
    sessionId: 'session-001',
    provenanceSessionIds: ['session-001'],
    projectId: 'test-project',
    ...overrides,
  };
}

function makeChunk(overrides: Partial<ASTChunk> = {}): ASTChunk {
  return {
    content: 'function verifyJwt(token: string) { return jwt.verify(token, SECRET); }',
    filePath: 'src/main/auth/tokens.ts',
    language: 'typescript',
    chunkType: 'function',
    startLine: 10,
    endLine: 12,
    name: 'verifyJwt',
    contextPrefix: 'File: src/main/auth/tokens.ts | function: verifyJwt | Lines: 10-12',
    ...overrides,
  };
}

// ============================================================
// UNIT TESTS — buildContextualText
// ============================================================

describe('buildContextualText', () => {
  it('builds contextual prefix for a function chunk', () => {
    const chunk = makeChunk();
    const text = buildContextualText(chunk);
    expect(text).toContain('File: src/main/auth/tokens.ts');
    expect(text).toContain('function: verifyJwt');
    expect(text).toContain('Lines: 10-12');
    expect(text).toContain('function verifyJwt');
  });

  it('omits chunkType prefix for module-level chunks', () => {
    const chunk = makeChunk({ chunkType: 'module', name: undefined });
    const text = buildContextualText(chunk);
    expect(text).not.toContain('module:');
    expect(text).toContain('File:');
  });

  it('uses unknown for unnamed chunks', () => {
    const chunk = makeChunk({ name: undefined, chunkType: 'function' });
    const text = buildContextualText(chunk);
    expect(text).toContain('function: unknown');
  });

  it('separates prefix and content with double newline', () => {
    const chunk = makeChunk();
    const text = buildContextualText(chunk);
    expect(text).toMatch(/\n\n/);
  });
});

// ============================================================
// UNIT TESTS — buildMemoryContextualText
// ============================================================

describe('buildMemoryContextualText', () => {
  it('builds contextual text for a memory with files and modules', () => {
    const memory = makeMemory();
    const text = buildMemoryContextualText(memory);
    expect(text).toContain('Files: src/main/index.ts');
    expect(text).toContain('Module: main');
    expect(text).toContain('Type: gotcha');
    expect(text).toContain(memory.content);
  });

  it('falls back to raw content when no files or modules', () => {
    const memory = makeMemory({ relatedFiles: [], relatedModules: [] });
    const text = buildMemoryContextualText(memory);
    expect(text).toContain('Type: gotcha');
    expect(text).toContain(memory.content);
  });

  it('handles memory with no context (only type)', () => {
    const memory = makeMemory({ relatedFiles: [], relatedModules: [] });
    const text = buildMemoryContextualText(memory);
    expect(text).toMatch(/Type: gotcha\n\n/);
  });
});

// ============================================================
// UNIT TESTS — EmbeddingService (none / offline mode)
// ============================================================

describe('EmbeddingService (none / degraded fallback)', () => {
  let client: Client;
  let service: EmbeddingService;

  beforeEach(async () => {
    // Ollama not available → forces degraded fallback
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    client = await getInMemoryClient();
    service = new EmbeddingService(client);
    await service.initialize();
  });

  afterEach(() => {
    client.close();
    vi.clearAllMocks();
  });

  it('selects none provider when Ollama is unavailable', () => {
    expect(service.getProvider()).toBe('none');
  });

  it('embed returns a number array matching the requested dimension', async () => {
    const embedding = await service.embed('test text');
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBe(1024); // default dims=1024
    expect(embedding.every((v) => typeof v === 'number')).toBe(true);

    const embedding256 = await service.embed('test text 256', 256);
    expect(embedding256.length).toBe(256);
  });

  it('embed produces normalized vectors', async () => {
    const embedding = await service.embed('test text');
    const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('embed is deterministic for the same input (modulo float32 cache rounding)', async () => {
    // First call: computes stub embedding and caches it (serialized as float32)
    // Second call: reads from cache (deserialized from float32 → may differ by ~1e-7)
    const a = await service.embed('same text deterministic');
    const b = await service.embed('same text deterministic');
    // Both should have the same length and approximate values
    expect(a.length).toBe(b.length);
    // Check first few values are approximately equal (float32 precision)
    for (let i = 0; i < Math.min(10, a.length); i++) {
      expect(a[i]).toBeCloseTo(b[i], 5);
    }
  });

  it('embed returns different vectors for different inputs', async () => {
    const a = await service.embed('text one');
    const b = await service.embed('text two');
    expect(a).not.toEqual(b);
  });

  it('embedBatch returns array of embeddings', async () => {
    const texts = ['hello world', 'foo bar', 'test embedding'];
    const embeddings = await service.embedBatch(texts);
    expect(embeddings).toHaveLength(3);
    for (const emb of embeddings) {
      expect(Array.isArray(emb)).toBe(true);
      expect(emb.length).toBe(1024);
    }
  });

  it('embedBatch handles empty array', async () => {
    const result = await service.embedBatch([]);
    expect(result).toEqual([]);
  });

  it('embedMemory embeds using contextual text', async () => {
    const memory = makeMemory();
    const embedding = await service.embedMemory(memory);
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);
  });
});

// ============================================================
// UNIT TESTS — Caching behavior
// ============================================================

describe('EmbeddingService caching', () => {
  let client: Client;
  let service: EmbeddingService;

  beforeEach(async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));


    client = await getInMemoryClient();
    service = new EmbeddingService(client);
    await service.initialize();
  });

  afterEach(() => {
    client.close();
    vi.clearAllMocks();
  });

  it('caches embeddings in embedding_cache table', async () => {
    await service.embed('cached text');

    const result = await client.execute({
      sql: 'SELECT COUNT(*) as cnt FROM embedding_cache',
      args: [],
    });
    const count = result.rows[0].cnt as number;
    expect(count).toBeGreaterThan(0);
  });

  it('returns same embedding on second call (from cache, modulo float32 precision)', async () => {
    // First call computes and caches; second call reads from cache
    // Cache serializes as float32 which has ~7 decimal digits precision
    const first = await service.embed('test caching unique text');
    const second = await service.embed('test caching unique text');
    expect(first.length).toBe(second.length);
    for (let i = 0; i < Math.min(5, first.length); i++) {
      expect(first[i]).toBeCloseTo(second[i], 5);
    }
  });

  it('cache entries have future expiry', async () => {
    await service.embed('expiry test');
    const now = Date.now();

    const result = await client.execute({
      sql: 'SELECT expires_at FROM embedding_cache LIMIT 1',
      args: [],
    });
    const expiresAt = result.rows[0].expires_at as number;
    expect(expiresAt).toBeGreaterThan(now);
  });
});

// ============================================================
// UNIT TESTS — Ollama provider
// ============================================================

describe('EmbeddingService (Ollama provider)', () => {
  let client: Client;
  let service: EmbeddingService;

  beforeEach(async () => {
    // Mock Ollama responses
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [{ name: 'qwen3-embedding:4b' }],
            }),
        });
      }
      if (url.includes('/api/embeddings')) {
        const embedding = Array.from({ length: 1024 }, (_, i) => (i % 10) / 10);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ embedding }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });


    client = await getInMemoryClient();
    service = new EmbeddingService(client);
    await service.initialize();
  });

  afterEach(() => {
    client.close();
    vi.clearAllMocks();
  });

  it('selects ollama-4b provider when qwen3-embedding:4b model is available', () => {
    expect(service.getProvider()).toBe('ollama-4b');
  });

  it('returns 1024-dim embedding from Ollama', async () => {
    const embedding = await service.embed('test text');
    expect(embedding.length).toBe(1024);
  });

  it('returns 256-dim embedding when dims=256 requested (MRL truncation)', async () => {
    const embedding = await service.embed('test text', 256);
    expect(embedding.length).toBe(256);
  });

  it('calls Ollama API with correct model and prompt', async () => {
    await service.embed('hello world');
    const embedCalls = mockFetch.mock.calls.filter((c) =>
      (c[0] as string).includes('/api/embeddings'),
    );
    expect(embedCalls.length).toBeGreaterThan(0);
    const body = JSON.parse((embedCalls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('qwen3-embedding:4b');
    expect(body.prompt).toBe('hello world');
  });
});

// ============================================================
// UNIT TESTS — Ollama 8b selection based on RAM
// ============================================================

describe('EmbeddingService (Ollama 8b with high RAM)', () => {
  let client: Client;
  let service: EmbeddingService;

  beforeEach(async () => {
    // Mock high RAM (>32GB)
    vi.mock('os', () => ({
      totalmem: () => 64 * 1024 * 1024 * 1024, // 64 GB
    }));

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [{ name: 'qwen3-embedding:8b' }, { name: 'qwen3-embedding:4b' }],
            }),
        });
      }
      if (url.includes('/api/embeddings')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ embedding: new Array(1024).fill(0.1) }),
        });
      }
      return Promise.reject(new Error('Unexpected'));
    });


    client = await getInMemoryClient();
    service = new EmbeddingService(client);
    await service.initialize();
  });

  afterEach(() => {
    client.close();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('initializes without error', () => {
    // Provider selection depends on mocked os.totalmem behavior
    expect(['ollama-8b', 'ollama-4b']).toContain(service.getProvider());
  });
});

// ============================================================
// UNIT TESTS — Ollama generic embedding model
// ============================================================

describe('EmbeddingService (Ollama generic embedding model)', () => {
  let client: Client;
  let service: EmbeddingService;

  beforeEach(async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [{ name: 'nomic-embed-text' }, { name: 'llama3.2' }],
            }),
        });
      }
      if (url.includes('/api/embeddings')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });


    client = await getInMemoryClient();
    service = new EmbeddingService(client);
    await service.initialize();
  });

  afterEach(() => {
    client.close();
    vi.clearAllMocks();
  });

  it('selects ollama-generic provider when a non-qwen3 embedding model is available', () => {
    expect(service.getProvider()).toBe('ollama-generic');
  });

  it('calls Ollama API with the detected generic model name', async () => {
    await service.embed('hello world');
    const embedCalls = mockFetch.mock.calls.filter((c) =>
      (c[0] as string).includes('/api/embeddings'),
    );
    expect(embedCalls.length).toBeGreaterThan(0);
    const body = JSON.parse((embedCalls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('nomic-embed-text');
  });

  it('returns embeddings from Ollama', async () => {
    const embedding = await service.embed('test text');
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);
  });
});

// ============================================================
// UNIT TESTS — initialize idempotence
// ============================================================

describe('EmbeddingService.initialize idempotence', () => {
  let client: Client;
  let service: EmbeddingService;

  beforeEach(async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    client = await getInMemoryClient();
    service = new EmbeddingService(client);
  });

  afterEach(() => {
    client.close();
    vi.clearAllMocks();
  });

  it('can be called multiple times without error', async () => {
    await service.initialize();
    await service.initialize();
    await service.initialize();
    expect(service.getProvider()).toBe('none');
  });
});
