import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  readEnrichmentFile,
  writeEnrichmentFile,
  readTransitionsFile,
  appendTransition,
  getEnrichmentFilePath,
  getEnrichmentDir,
} from '../enrichment-persistence';
import type { EnrichmentFile, TransitionRecord } from '../../../../shared/types/enrichment';
import { ENRICHMENT_SCHEMA_VERSION } from '../../../../shared/constants/enrichment';
import { createDefaultEnrichment } from '../../../../shared/types/enrichment';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrichment-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readEnrichmentFile / writeEnrichmentFile', () => {
  it('round-trips enrichment data', async () => {
    const data: EnrichmentFile = {
      schemaVersion: ENRICHMENT_SCHEMA_VERSION,
      issues: {
        '42': createDefaultEnrichment(42),
      },
    };

    await writeEnrichmentFile(tmpDir, data);
    const result = await readEnrichmentFile(tmpDir);

    expect(result.schemaVersion).toBe(ENRICHMENT_SCHEMA_VERSION);
    expect(result.issues['42'].issueNumber).toBe(42);
    expect(result.issues['42'].triageState).toBe('new');
  });

  it('returns empty data for missing file', async () => {
    const result = await readEnrichmentFile(tmpDir);
    expect(result.schemaVersion).toBe(ENRICHMENT_SCHEMA_VERSION);
    expect(result.issues).toEqual({});
  });

  it('recovers from corrupt file', async () => {
    const dir = getEnrichmentDir(tmpDir);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = getEnrichmentFilePath(tmpDir);
    fs.writeFileSync(filePath, 'NOT VALID JSON{{{', 'utf-8');

    const result = await readEnrichmentFile(tmpDir);

    // Should return empty data
    expect(result.issues).toEqual({});
    // Original file should be renamed to .corrupted
    expect(fs.existsSync(`${filePath}.corrupted`)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('rethrows non-parse filesystem errors without marking file as corrupted', async () => {
    const filePath = getEnrichmentFilePath(tmpDir);
    fs.mkdirSync(filePath, { recursive: true }); // readFile on directory -> non-parse error (EISDIR)

    await expect(readEnrichmentFile(tmpDir)).rejects.toMatchObject({
      code: expect.any(String),
    });
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.corrupted`)).toBe(false);
  });

  it('loads file with different schema version with warning', async () => {
    const dir = getEnrichmentDir(tmpDir);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = getEnrichmentFilePath(tmpDir);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ schemaVersion: 99, issues: { '1': createDefaultEnrichment(1) } }),
      'utf-8',
    );

    const result = await readEnrichmentFile(tmpDir);
    expect(result.schemaVersion).toBe(99);
    expect(result.issues['1'].issueNumber).toBe(1);
  });

  it('preserves unknown fields in enrichment entries', async () => {
    const enrichment = createDefaultEnrichment(42);
    (enrichment as unknown as Record<string, unknown>).customField = 'preserved';

    const data: EnrichmentFile = {
      schemaVersion: ENRICHMENT_SCHEMA_VERSION,
      issues: { '42': enrichment },
    };

    await writeEnrichmentFile(tmpDir, data);
    const result = await readEnrichmentFile(tmpDir);

    expect((result.issues['42'] as unknown as Record<string, unknown>).customField).toBe('preserved');
  });

  it('creates parent directory if it does not exist', async () => {
    const deepPath = path.join(tmpDir, 'deep', 'nested', 'project');
    const data: EnrichmentFile = {
      schemaVersion: ENRICHMENT_SCHEMA_VERSION,
      issues: {},
    };

    await writeEnrichmentFile(deepPath, data);
    const result = await readEnrichmentFile(deepPath);
    expect(result.schemaVersion).toBe(ENRICHMENT_SCHEMA_VERSION);
  });

  it('serializes concurrent writes', async () => {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      const data: EnrichmentFile = {
        schemaVersion: ENRICHMENT_SCHEMA_VERSION,
        issues: { [String(i)]: createDefaultEnrichment(i) },
      };
      promises.push(writeEnrichmentFile(tmpDir, data));
    }

    await Promise.all(promises);

    // File should be valid JSON (no corruption)
    const filePath = getEnrichmentFilePath(tmpDir);
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe('readTransitionsFile / appendTransition', () => {
  it('returns empty transitions for missing file', async () => {
    const result = await readTransitionsFile(tmpDir);
    expect(result.transitions).toEqual([]);
  });

  it('appends a single transition', async () => {
    const record: TransitionRecord = {
      issueNumber: 42,
      from: 'new',
      to: 'triage',
      actor: 'user',
      timestamp: new Date().toISOString(),
    };

    await appendTransition(tmpDir, record);
    const result = await readTransitionsFile(tmpDir);

    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0].issueNumber).toBe(42);
    expect(result.transitions[0].from).toBe('new');
    expect(result.transitions[0].to).toBe('triage');
  });

  it('appends three transitions in order', async () => {
    for (let i = 0; i < 3; i++) {
      await appendTransition(tmpDir, {
        issueNumber: i + 1,
        from: 'new',
        to: 'triage',
        actor: 'user',
        timestamp: new Date().toISOString(),
      });
    }

    const result = await readTransitionsFile(tmpDir);
    expect(result.transitions).toHaveLength(3);
    expect(result.transitions[0].issueNumber).toBe(1);
    expect(result.transitions[1].issueNumber).toBe(2);
    expect(result.transitions[2].issueNumber).toBe(3);
  });
});

describe('load performance', () => {
  it('reads 1000 enrichment entries in under 50ms', async () => {
    const issues: Record<string, ReturnType<typeof createDefaultEnrichment>> = {};
    for (let i = 0; i < 1000; i++) {
      issues[String(i)] = createDefaultEnrichment(i);
    }

    const data: EnrichmentFile = {
      schemaVersion: ENRICHMENT_SCHEMA_VERSION,
      issues,
    };

    await writeEnrichmentFile(tmpDir, data);

    const start = performance.now();
    const result = await readEnrichmentFile(tmpDir);
    const elapsed = performance.now() - start;

    expect(Object.keys(result.issues)).toHaveLength(1000);
    expect(elapsed).toBeLessThan(50);
  });
});
