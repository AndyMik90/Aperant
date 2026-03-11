/**
 * Roadmap Runner
 * ==============
 *
 * AI-powered roadmap generation using Vercel AI SDK.
 * See apps/desktop/src/main/ai/runners/roadmap.ts for the TypeScript implementation.
 *
 * Multi-step process: project discovery → feature generation → roadmap synthesis.
 * Uses `createSimpleClient()` with read-only tools and streaming.
 */

import { streamText, stepCountIs } from 'ai';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import { createSimpleClient } from '../client/factory';
import type { SimpleClientResult } from '../client/types';
import { buildToolRegistry } from '../tools/build-registry';
import type { ToolContext } from '../tools/types';
import type { ModelShorthand, ThinkingLevel } from '../config/types';
import type { SecurityProfile } from '../security/bash-validator';
import { safeParseJson } from '../../utils/json-repair';
import { tryLoadPrompt } from '../prompts/prompt-loader';

// =============================================================================
// Constants
// =============================================================================

const MAX_RETRIES = 3;

/** Maximum agentic steps per phase */
const MAX_STEPS_PER_PHASE = 30;

// =============================================================================
// Types
// =============================================================================

/** Configuration for roadmap generation */
export interface RoadmapConfig {
  /** Project directory path */
  projectDir: string;
  /** Output directory for roadmap files (defaults to .auto-claude/roadmap/) */
  outputDir?: string;
  /** Model shorthand (defaults to 'sonnet') */
  modelShorthand?: ModelShorthand;
  /** Thinking level (defaults to 'medium') */
  thinkingLevel?: ThinkingLevel;
  /** Whether to refresh existing data */
  refresh?: boolean;
  /** Whether to enable competitor analysis */
  enableCompetitorAnalysis?: boolean;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/** Result of a roadmap phase */
export interface RoadmapPhaseResult {
  /** Phase name */
  phase: string;
  /** Whether the phase succeeded */
  success: boolean;
  /** Output files created */
  outputs: string[];
  /** Errors encountered */
  errors: string[];
}

/** Result of the full roadmap generation */
export interface RoadmapResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Phase results */
  phases: RoadmapPhaseResult[];
  /** Path to the generated roadmap file */
  roadmapPath?: string;
  /** Error message if failed */
  error?: string;
}

/** Callback for streaming events from the roadmap runner */
export type RoadmapStreamCallback = (event: RoadmapStreamEvent) => void;

/** Events emitted during roadmap generation */
export type RoadmapStreamEvent =
  | { type: 'phase-start'; phase: string }
  | { type: 'phase-complete'; phase: string; success: boolean }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-use'; name: string }
  | { type: 'error'; error: string };

// =============================================================================
// Discovery Phase
// =============================================================================

/**
 * Run the discovery phase — analyze project and determine audience/vision.
 * Mirrors Python's `DiscoveryPhase.execute()`.
 */
async function runDiscoveryPhase(
  projectDir: string,
  outputDir: string,
  refresh: boolean,
  client: SimpleClientResult,
  abortSignal?: AbortSignal,
  onStream?: RoadmapStreamCallback,
): Promise<RoadmapPhaseResult> {
  const discoveryFile = join(outputDir, 'roadmap_discovery.json');
  const projectIndexFile = join(outputDir, 'project_index.json');

  if (existsSync(discoveryFile) && !refresh) {
    return { phase: 'discovery', success: true, outputs: [discoveryFile], errors: [] };
  }

  const errors: string[] = [];

  // Detect Codex models — they require instructions via providerOptions, not system
  const discoveryModelId = typeof client.model === 'string' ? client.model : client.model.modelId;
  const isCodexDiscovery = discoveryModelId?.includes('codex') ?? false;

  // Load the full prompt file with JSON schema; fall back to inline prompt
  const loadedDiscoveryPrompt = tryLoadPrompt('roadmap_discovery');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const contextBlock = `\n\n---\n\n## CONTEXT (injected by runner)\n\n**Project Directory**: ${projectDir}\n**Project Index**: ${projectIndexFile}\n**Output Directory**: ${outputDir}\n**Output File**: ${discoveryFile}\n\nUse the paths above when reading input files and writing output.`;

    const prompt = loadedDiscoveryPrompt
      ? loadedDiscoveryPrompt + contextBlock
      : `You are a project analyst. Analyze the project and create a discovery document.

**Project Index**: ${projectIndexFile}
**Output Directory**: ${outputDir}
**Output File**: ${discoveryFile}

IMPORTANT: This runs NON-INTERACTIVELY. Do NOT ask questions or wait for user input.

Your task:
1. Analyze the project (read README, code structure, key files)
2. Infer target audience, vision, and constraints from your analysis
3. IMMEDIATELY create ${discoveryFile} with your findings as valid JSON

The JSON must contain at minimum: project_name, target_audience, product_vision, key_features, technical_stack, and constraints.

Do NOT ask questions. Make educated inferences and create the file.`;

    const discoveryUserPrompt = 'Analyze the project and create the discovery document. Use the available tools to explore the codebase, then write your findings as JSON to the output file specified in the context above.';

    try {
      const result = streamText({
        model: client.model,
        system: isCodexDiscovery ? undefined : prompt,
        prompt: discoveryUserPrompt,
        tools: client.tools,
        stopWhen: stepCountIs(client.maxSteps),
        abortSignal,
        ...(isCodexDiscovery ? {
          providerOptions: {
            openai: {
              instructions: prompt,
              store: false,
            },
          },
        } : {}),
      });

      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            onStream?.({ type: 'text-delta', text: part.text });
            break;
          case 'tool-call':
            onStream?.({ type: 'tool-use', name: part.toolName });
            break;
          case 'error': {
            const errorMsg = part.error instanceof Error ? part.error.message : String(part.error);
            onStream?.({ type: 'error', error: errorMsg });
            break;
          }
        }
      }

      // Validate output
      if (existsSync(discoveryFile)) {
        const data = safeParseJson<Record<string, unknown>>(readFileSync(discoveryFile, 'utf-8'));
        if (data) {
          const required = ['project_name', 'target_audience', 'product_vision'];
          const missing = required.filter((k) => !(k in data));
          if (missing.length === 0) {
            return { phase: 'discovery', success: true, outputs: [discoveryFile], errors: [] };
          }
          errors.push(`Attempt ${attempt + 1}: Missing fields: ${missing.join(', ')}`);
        } else {
          errors.push(`Attempt ${attempt + 1}: Invalid JSON in discovery file`);
        }
      } else {
        errors.push(`Attempt ${attempt + 1}: Discovery file not created`);
      }
    } catch (error) {
      errors.push(`Attempt ${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { phase: 'discovery', success: false, outputs: [], errors };
}

// =============================================================================
// Features Phase
// =============================================================================

/**
 * Run the features phase — generate and prioritize roadmap features.
 * Mirrors Python's `FeaturesPhase.execute()`.
 */
async function runFeaturesPhase(
  projectDir: string,
  outputDir: string,
  refresh: boolean,
  client: SimpleClientResult,
  abortSignal?: AbortSignal,
  onStream?: RoadmapStreamCallback,
): Promise<RoadmapPhaseResult> {
  const roadmapFile = join(outputDir, 'roadmap.json');
  const discoveryFile = join(outputDir, 'roadmap_discovery.json');
  const projectIndexFile = join(outputDir, 'project_index.json');

  if (!existsSync(discoveryFile)) {
    return { phase: 'features', success: false, outputs: [], errors: ['Discovery file not found'] };
  }

  if (existsSync(roadmapFile) && !refresh) {
    return { phase: 'features', success: true, outputs: [roadmapFile], errors: [] };
  }

  // Load preserved features before agent potentially overwrites
  const preservedFeatures = loadPreservedFeatures(roadmapFile);

  const errors: string[] = [];

  // Detect Codex models — they require instructions via providerOptions, not system
  const featuresModelId = typeof client.model === 'string' ? client.model : client.model.modelId;
  const isCodexFeatures = featuresModelId?.includes('codex') ?? false;

  // Load the full prompt file with JSON schema; fall back to inline prompt
  const loadedFeaturesPrompt = tryLoadPrompt('roadmap_features');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let preservedSection = '';
    if (preservedFeatures.length > 0) {
      const preservedInfo = preservedFeatures
        .map((f) => `  - ${(f as Record<string, string>).id ?? 'unknown'}: ${(f as Record<string, string>).title ?? 'Untitled'}`)
        .join('\n');
      preservedSection = `\n**EXISTING FEATURES TO PRESERVE** (DO NOT regenerate these):
The following ${preservedFeatures.length} features already exist and will be preserved.
Generate NEW features that complement these, do not duplicate them:
${preservedInfo}\n`;
    }
    const featuresContextBlock = `\n\n---\n\n## CONTEXT (injected by runner)\n\n**Discovery File**: ${discoveryFile}\n**Project Index**: ${projectIndexFile}\n**Output File**: ${roadmapFile}\n${preservedSection}\nUse the paths above when reading input files and writing output. Write the complete roadmap JSON to the Output File path.`;

    const prompt = loadedFeaturesPrompt
      ? loadedFeaturesPrompt + featuresContextBlock
      : `You are a product strategist. Generate a roadmap with prioritized features.

**Discovery File**: ${discoveryFile}
**Project Index**: ${projectIndexFile}
**Output File**: ${roadmapFile}
${preservedSection}
Based on the discovery data:
1. Read the discovery file to understand the project
2. Generate features that address user pain points
3. Prioritize using MoSCoW framework
4. Organize into phases
5. Create milestones
6. Map dependencies

Output the complete roadmap as valid JSON to ${roadmapFile}.
The JSON must contain: vision, target_audience (object with "primary" key), phases (array), and features (array with at least 3 items each with id, title, description, priority, complexity, impact, phase_id, status, acceptance_criteria, and user_stories).`;

    const featuresUserPrompt = 'Read the discovery data and generate a complete roadmap with prioritized features. Write the roadmap JSON to the output file specified in the context above.';

    try {
      const result = streamText({
        model: client.model,
        system: isCodexFeatures ? undefined : prompt,
        prompt: featuresUserPrompt,
        tools: client.tools,
        stopWhen: stepCountIs(client.maxSteps),
        abortSignal,
        ...(isCodexFeatures ? {
          providerOptions: {
            openai: {
              instructions: prompt,
              store: false,
            },
          },
        } : {}),
      });

      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            onStream?.({ type: 'text-delta', text: part.text });
            break;
          case 'tool-call':
            onStream?.({ type: 'tool-use', name: part.toolName });
            break;
          case 'error': {
            const errorMsg = part.error instanceof Error ? part.error.message : String(part.error);
            onStream?.({ type: 'error', error: errorMsg });
            break;
          }
        }
      }

      // Validate and merge — read/write through fd to avoid TOCTOU
      let roadmapRaw: string | null = null;
      try {
        roadmapRaw = readFileSync(roadmapFile, 'utf-8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      if (roadmapRaw !== null) {
        const data = safeParseJson<Record<string, unknown>>(roadmapRaw);
        if (data) {
          const required = ['phases', 'features', 'vision', 'target_audience'];
          const missing = required.filter((k) => !(k in data));
          const featureCount = ((data.features as unknown[]) ?? []).length;

          const targetAudience = data.target_audience;
          if (typeof targetAudience !== 'object' || targetAudience === null || !(targetAudience as Record<string, unknown>).primary) {
            missing.push('target_audience.primary');
          }

          if (missing.length === 0 && featureCount >= 3) {
            // Merge preserved features — atomic write via temp file + rename
            if (preservedFeatures.length > 0) {
              data.features = mergeFeatures(data.features as Record<string, unknown>[], preservedFeatures);
              const merged = JSON.stringify(data, null, 2);
              const tmpFile = `${roadmapFile}.tmp.${process.pid}`;
              writeFileSync(tmpFile, merged, 'utf-8');
              renameSync(tmpFile, roadmapFile);
            }
            return { phase: 'features', success: true, outputs: [roadmapFile], errors: [] };
          }
          errors.push(`Attempt ${attempt + 1}: Missing fields or too few features (${featureCount})`);
        } else {
          errors.push(`Attempt ${attempt + 1}: Invalid JSON in roadmap file`);
        }
      } else {
        errors.push(`Attempt ${attempt + 1}: Roadmap file not created`);
      }
    } catch (error) {
      errors.push(`Attempt ${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { phase: 'features', success: false, outputs: [], errors };
}

// =============================================================================
// Feature Preservation Helpers
// =============================================================================

/**
 * Load features from existing roadmap that should be preserved.
 * Preserves features with status planned/in_progress/done, linked specs, or internal source.
 */
function loadPreservedFeatures(roadmapFile: string): Record<string, unknown>[] {
  if (!existsSync(roadmapFile)) return [];

  const data = safeParseJson<Record<string, unknown>>(readFileSync(roadmapFile, 'utf-8'));
  if (!data) return [];

  const features: Record<string, unknown>[] = (data.features as Record<string, unknown>[]) ?? [];

  return features.filter((feature) => {
    const status = feature.status as string | undefined;
    const hasLinkedSpec = Boolean(feature.linked_spec_id);
    const source = feature.source as Record<string, unknown> | undefined;
    const isInternal = typeof source === 'object' && source !== null && source.provider === 'internal';

    return (
      status === 'planned' || status === 'in_progress' || status === 'done' ||
      hasLinkedSpec || isInternal
    );
  });
}

/**
 * Merge new AI-generated features with preserved features.
 * Preserved features take priority; deduplicates by ID and title.
 */
function mergeFeatures(
  newFeatures: Record<string, unknown>[],
  preserved: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (preserved.length === 0) return newFeatures;

  const preservedIds = new Set(
    preserved.filter((f) => f.id).map((f) => f.id as string),
  );
  const preservedTitles = new Set(
    preserved
      .filter((f) => f.title)
      .map((f) => (f.title as string).trim().toLowerCase()),
  );

  const merged = [...preserved];
  for (const feature of newFeatures) {
    const id = feature.id as string | undefined;
    const title = ((feature.title as string) ?? '').trim().toLowerCase();

    if (id && preservedIds.has(id)) continue;
    if (title && preservedTitles.has(title)) continue;
    merged.push(feature);
  }

  return merged;
}

// =============================================================================
// Roadmap Runner (Main Entry Point)
// =============================================================================

/**
 * Run the complete roadmap generation process.
 *
 * Multi-phase pipeline:
 * 1. Discovery — analyze project, infer audience and vision
 * 2. Features — generate and prioritize roadmap features
 *
 * @param config - Roadmap generation configuration
 * @param onStream - Optional callback for streaming events
 * @returns Roadmap generation result
 */
export async function runRoadmapGeneration(
  config: RoadmapConfig,
  onStream?: RoadmapStreamCallback,
): Promise<RoadmapResult> {
  const {
    projectDir,
    modelShorthand = 'sonnet',
    thinkingLevel = 'medium',
    refresh = false,
    abortSignal,
  } = config;

  const outputDir = config.outputDir ?? join(projectDir, '.auto-claude', 'roadmap');

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Create tool context for read-only tools + Write
  const toolContext: ToolContext = {
    cwd: projectDir,
    projectDir,
    specDir: join(projectDir, '.auto-claude', 'specs'),
    securityProfile: null as unknown as SecurityProfile,
    abortSignal,
  };

  const registry = buildToolRegistry();
  const tools = registry.getToolsForAgent('roadmap_discovery', toolContext);

  const client = await createSimpleClient({
    systemPrompt: '',
    modelShorthand,
    thinkingLevel,
    maxSteps: MAX_STEPS_PER_PHASE,
    tools,
  });

  const phases: RoadmapPhaseResult[] = [];

  // Phase 1: Discovery
  onStream?.({ type: 'phase-start', phase: 'discovery' });
  const discoveryResult = await runDiscoveryPhase(
    projectDir, outputDir, refresh, client, abortSignal, onStream,
  );
  phases.push(discoveryResult);
  onStream?.({ type: 'phase-complete', phase: 'discovery', success: discoveryResult.success });

  if (!discoveryResult.success) {
    return {
      success: false,
      phases,
      error: `Discovery failed: ${discoveryResult.errors.join('; ')}`,
    };
  }

  // Phase 2: Feature Generation
  onStream?.({ type: 'phase-start', phase: 'features' });
  const featuresResult = await runFeaturesPhase(
    projectDir, outputDir, refresh, client, abortSignal, onStream,
  );
  phases.push(featuresResult);
  onStream?.({ type: 'phase-complete', phase: 'features', success: featuresResult.success });

  if (!featuresResult.success) {
    return {
      success: false,
      phases,
      error: `Feature generation failed: ${featuresResult.errors.join('; ')}`,
    };
  }

  const roadmapPath = join(outputDir, 'roadmap.json');
  return {
    success: true,
    phases,
    roadmapPath,
  };
}
