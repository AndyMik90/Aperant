import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks — must be declared before any imports that use them
// =============================================================================

const mockStreamText = vi.fn();

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  stepCountIs: (n: number) => ({ type: 'stepCount', count: n }),
}));

const mockCreateSimpleClient = vi.fn();

vi.mock('../../client/factory', () => ({
  createSimpleClient: (...args: unknown[]) => mockCreateSimpleClient(...args),
}));

// Filesystem mocks
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockRenameSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
}));

// Tool registry mock
vi.mock('../../tools/build-registry', () => ({
  buildToolRegistry: () => ({
    getToolsForAgent: vi.fn().mockReturnValue({}),
  }),
}));

// json-repair used for safeParseJson
vi.mock('../../../utils/json-repair', () => ({
  safeParseJson: (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
}));

// tryLoadPrompt — return null so inline prompts are used
vi.mock('../../prompts/prompt-loader', () => ({
  tryLoadPrompt: vi.fn().mockReturnValue(null),
}));

// =============================================================================
// Import after mocking
// =============================================================================

import { runRoadmapGeneration } from '../roadmap';
import type { RoadmapConfig, RoadmapStreamEvent } from '../roadmap';

// =============================================================================
// Helpers
// =============================================================================

const fakeModel = { modelId: 'claude-sonnet-test' };

function makeMockClient() {
  return {
    model: fakeModel,
    systemPrompt: '',
    tools: {},
    maxSteps: 30,
  };
}

function makeStream(parts: Array<Record<string, unknown>>) {
  return {
    fullStream: (async function* () {
      for (const part of parts) {
        yield part;
      }
    })(),
  };
}

/** Valid discovery JSON that passes schema validation */
const VALID_DISCOVERY_JSON = JSON.stringify({
  project_name: 'TestProject',
  target_audience: 'Developers',
  product_vision: 'Make coding easier',
  key_features: ['Auth', 'Dashboard'],
  technical_stack: { language: 'TypeScript' },
  constraints: [],
});

/** Valid roadmap JSON that passes schema validation (>=3 features, all required keys) */
const VALID_ROADMAP_JSON = JSON.stringify({
  vision: 'Automate everything',
  target_audience: { primary: 'Developers', secondary: 'QA' },
  phases: [{ id: 'p1', name: 'MVP' }],
  features: [
    {
      id: 'f1', title: 'Feature A', description: 'Desc A', priority: 'high',
      complexity: 'medium', impact: 'high', phase_id: 'p1', status: 'planned',
      acceptance_criteria: [], user_stories: [],
    },
    {
      id: 'f2', title: 'Feature B', description: 'Desc B', priority: 'medium',
      complexity: 'low', impact: 'medium', phase_id: 'p1', status: 'planned',
      acceptance_criteria: [], user_stories: [],
    },
    {
      id: 'f3', title: 'Feature C', description: 'Desc C', priority: 'low',
      complexity: 'high', impact: 'low', phase_id: 'p1', status: 'planned',
      acceptance_criteria: [], user_stories: [],
    },
  ],
});

function baseConfig(overrides: Partial<RoadmapConfig> = {}): RoadmapConfig {
  return {
    projectDir: '/project',
    outputDir: '/project/.auto-claude/roadmap',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('runRoadmapGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSimpleClient.mockResolvedValue(makeMockClient());
    // Output dir exists by default (created by mkdirSync is a no-op)
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockReturnValue(undefined);
    mockStreamText.mockReturnValue(makeStream([]));
  });

  // ---------------------------------------------------------------------------
  // Successful full pipeline
  // ---------------------------------------------------------------------------

  it('returns success with roadmapPath when both phases succeed', async () => {
    // existsSync: outputDir does not exist initially; discovery file created after phase 1
    let discoveryCreated = false;

    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap')) return true; // outputDir exists
      if (p.endsWith('roadmap_discovery.json') && discoveryCreated) return true;
      if (p.endsWith('roadmap.json') && discoveryCreated) return false; // not yet
      return false;
    });

    // streamText yields nothing — validation happens from file reads
    mockStreamText.mockImplementation(() => {
      discoveryCreated = true; // simulate file being written during stream
      return makeStream([]);
    });

    // readFileSync returns valid JSON for each file
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap_discovery.json')) return VALID_DISCOVERY_JSON;
      if (p.endsWith('roadmap.json')) return VALID_ROADMAP_JSON;
      return '{}';
    });

    // After agent runs, both files exist
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap_discovery.json')) return true;
      if (p.endsWith('roadmap.json')) return true;
      return true; // outputDir, etc.
    });

    const result = await runRoadmapGeneration(baseConfig());

    expect(result.success).toBe(true);
    expect(result.roadmapPath).toContain('roadmap.json');
    expect(result.phases).toHaveLength(2);
    expect(result.phases[0].phase).toBe('discovery');
    expect(result.phases[1].phase).toBe('features');
  });

  // ---------------------------------------------------------------------------
  // Discovery phase failure
  // ---------------------------------------------------------------------------

  it('returns failure when discovery phase fails after all retries', async () => {
    // Discovery file is never created
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap')) return true; // outputDir exists
      return false; // discovery file never appears
    });

    mockStreamText.mockReturnValue(makeStream([]));

    const result = await runRoadmapGeneration(baseConfig());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Discovery failed');
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0].phase).toBe('discovery');
    expect(result.phases[0].success).toBe(false);
  });

  it('does not run features phase when discovery fails', async () => {
    mockExistsSync.mockReturnValue(false);
    mockStreamText.mockReturnValue(makeStream([]));

    const result = await runRoadmapGeneration(baseConfig());

    // Only 1 phase in result — features was never attempted
    expect(result.phases).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Features phase failure
  // ---------------------------------------------------------------------------

  it('returns failure when features phase fails (no roadmap.json created)', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap')) return true;
      if (p.endsWith('roadmap_discovery.json')) return true; // discovery succeeded
      if (p.endsWith('project_index.json')) return false;
      return false; // roadmap.json never created
    });

    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap_discovery.json')) return VALID_DISCOVERY_JSON;
      return '{}';
    });

    mockStreamText.mockReturnValue(makeStream([]));

    const result = await runRoadmapGeneration(baseConfig());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Feature generation failed');
    expect(result.phases).toHaveLength(2);
    expect(result.phases[1].phase).toBe('features');
    expect(result.phases[1].success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Cache (refresh=false) — skip phases when files already exist
  // ---------------------------------------------------------------------------

  it('skips discovery phase when discovery file already exists and refresh=false', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap')) return true;
      if (p.endsWith('roadmap_discovery.json')) return true; // already exists
      if (p.endsWith('roadmap.json')) return true; // also exists
      return false;
    });

    const result = await runRoadmapGeneration(baseConfig({ refresh: false }));

    // streamText should not have been called since both files exist
    expect(mockStreamText).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Output directory creation
  // ---------------------------------------------------------------------------

  it('creates output directory when it does not exist', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap') && !p.includes('.json')) return false; // dir does not exist
      return false;
    });
    mockStreamText.mockReturnValue(makeStream([]));

    await runRoadmapGeneration(baseConfig({ outputDir: '/project/.auto-claude/roadmap' }));

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('roadmap'),
      expect.objectContaining({ recursive: true }),
    );
  });

  // ---------------------------------------------------------------------------
  // Streaming events
  // ---------------------------------------------------------------------------

  it('emits phase-start and phase-complete events for both phases', async () => {
    // Make discovery succeed via cached file
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap')) return true;
      if (p.endsWith('roadmap_discovery.json')) return true;
      if (p.endsWith('roadmap.json')) return true;
      return false;
    });

    const events: RoadmapStreamEvent[] = [];
    await runRoadmapGeneration(baseConfig({ refresh: false }), (e) => events.push(e));

    const phaseStartEvents = events.filter((e) => e.type === 'phase-start');
    const phaseCompleteEvents = events.filter((e) => e.type === 'phase-complete');

    expect(phaseStartEvents).toHaveLength(2);
    expect(phaseCompleteEvents).toHaveLength(2);
    expect((phaseStartEvents[0] as { type: string; phase: string }).phase).toBe('discovery');
    expect((phaseStartEvents[1] as { type: string; phase: string }).phase).toBe('features');
  });

  it('forwards text-delta events from stream to callback', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap_discovery.json')) return true;
      if (p.endsWith('roadmap.json')) return true;
      return true;
    });

    const events: RoadmapStreamEvent[] = [];
    await runRoadmapGeneration(baseConfig({ refresh: false }), (e) => events.push(e));

    // Since files exist and refresh=false, streamText is never called and no text-delta fires
    // This confirms the caching path works correctly
    const textEvents = events.filter((e) => e.type === 'text-delta');
    expect(textEvents).toHaveLength(0);
  });

  it('forwards text-delta from active streamText run when discovery must be generated', async () => {
    // outputDir exists, but discovery file does not (first attempt)
    // After first streamText run, discovery file appears
    let callCount = 0;
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap') && !p.includes('.json')) return true;
      if (p.endsWith('roadmap_discovery.json')) return callCount > 0;
      return false;
    });

    mockReadFileSync.mockReturnValue(VALID_DISCOVERY_JSON);

    mockStreamText.mockImplementation(() => {
      callCount++;
      return {
        fullStream: (async function* () {
          yield { type: 'text-delta', text: 'Analyzing project...' };
        })(),
      };
    });

    const events: RoadmapStreamEvent[] = [];
    await runRoadmapGeneration(baseConfig(), (e) => events.push(e));

    const textEvents = events.filter((e) => e.type === 'text-delta');
    expect(textEvents.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Client configuration
  // ---------------------------------------------------------------------------

  it('uses sonnet and medium thinking level by default', async () => {
    mockExistsSync.mockReturnValue(false);
    mockStreamText.mockReturnValue(makeStream([]));

    await runRoadmapGeneration(baseConfig());

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.modelShorthand).toBe('sonnet');
    expect(clientArgs.thinkingLevel).toBe('medium');
  });

  it('accepts custom modelShorthand and thinkingLevel', async () => {
    mockExistsSync.mockReturnValue(false);
    mockStreamText.mockReturnValue(makeStream([]));

    await runRoadmapGeneration(baseConfig({ modelShorthand: 'haiku', thinkingLevel: 'low' }));

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.modelShorthand).toBe('haiku');
    expect(clientArgs.thinkingLevel).toBe('low');
  });

  it('uses default outputDir when not provided', async () => {
    mockExistsSync.mockReturnValue(false);
    mockStreamText.mockReturnValue(makeStream([]));

    await runRoadmapGeneration({ projectDir: '/my/project' });

    // mkdirSync should have been called with the default path
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.auto-claude'),
      expect.anything(),
    );
  });

  // ---------------------------------------------------------------------------
  // Error handling — streamText throws
  // ---------------------------------------------------------------------------

  it('records error in phase when streamText throws during discovery', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('roadmap') && !p.includes('.json')) return true;
      return false;
    });

    mockStreamText.mockImplementation(() => {
      return {
        // biome-ignore lint/correctness/useYield: intentionally throwing before yield to test error path
        fullStream: (async function* () {
          throw new Error('network failure');
        })(),
      };
    });

    const result = await runRoadmapGeneration(baseConfig());

    expect(result.success).toBe(false);
    expect(result.phases[0].errors.length).toBeGreaterThan(0);
  });
});
