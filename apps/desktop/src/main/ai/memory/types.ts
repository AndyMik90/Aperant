/**
 * Memory System — TypeScript Types
 *
 * All types for the libSQL-backed memory system.
 */

// ============================================================
// CORE UNION TYPES
// ============================================================

export type MemoryType =
  // Core
  | 'gotcha'
  | 'decision'
  | 'preference'
  | 'pattern'
  | 'requirement'
  | 'error_pattern'
  | 'module_insight'
  // Active loop
  | 'prefetch_pattern'
  | 'work_state'
  | 'causal_dependency'
  | 'task_calibration'
  // V3+
  | 'e2e_observation'
  | 'dead_end'
  | 'work_unit_outcome'
  | 'workflow_recipe'
  | 'context_cost';

export type MemorySource =
  | 'agent_explicit'
  | 'observer_inferred'
  | 'qa_auto'
  | 'mcp_auto'
  | 'commit_auto'
  | 'user_taught';

export type MemoryScope = 'global' | 'module' | 'work_unit' | 'session';

export type UniversalPhase =
  | 'define'
  | 'implement'
  | 'validate'
  | 'refine'
  | 'explore'
  | 'reflect';

export type SignalType =
  | 'file_access'
  | 'co_access'
  | 'error_retry'
  | 'backtrack'
  | 'read_abandon'
  | 'repeated_grep'
  | 'tool_sequence'
  | 'time_anomaly'
  | 'self_correction'
  | 'external_reference'
  | 'glob_ignore'
  | 'import_chase'
  | 'test_order'
  | 'config_touch'
  | 'step_overrun'
  | 'parallel_conflict'
  | 'context_token_spike';

export type SessionOutcome = 'success' | 'failure' | 'abandoned' | 'partial';

export type SessionType =
  | 'build'
  | 'insights'
  | 'roadmap'
  | 'terminal'
  | 'changelog'
  | 'spec_creation'
  | 'pr_review';

// ============================================================
// CORE INTERFACES
// ============================================================

export interface WorkUnitRef {
  methodology: string;
  hierarchy: string[];
  label: string;
}

export interface MemoryRelation {
  targetMemoryId?: string;
  targetFilePath?: string;
  relationType: 'required_with' | 'conflicts_with' | 'validates' | 'supersedes' | 'derived_from';
  confidence: number;
  autoExtracted: boolean;
}

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  confidence: number;
  tags: string[];
  relatedFiles: string[];
  relatedModules: string[];
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;

  workUnitRef?: WorkUnitRef;
  scope: MemoryScope;

  // Provenance
  source: MemorySource;
  sessionId: string;
  commitSha?: string;
  provenanceSessionIds: string[];

  // Knowledge graph link
  targetNodeId?: string;
  impactedNodeIds?: string[];

  // Relations
  relations?: MemoryRelation[];

  // Decay
  decayHalfLifeDays?: number;

  // Trust
  needsReview?: boolean;
  userVerified?: boolean;
  citationText?: string;
  pinned?: boolean;
  methodology?: string;

  // Chunking metadata for AST-chunked code memories
  chunkType?: 'function' | 'class' | 'module' | 'prose';
  chunkStartLine?: number;
  chunkEndLine?: number;
  contextPrefix?: string;
  embeddingModelId?: string;

  // DB fields
  projectId: string;
  trustLevelScope?: string;
  deprecated?: boolean;
  deprecatedAt?: string;
  staleAt?: string;
}

// ============================================================
// EXTENDED MEMORY TYPES
// ============================================================

export interface WorkflowRecipe extends Memory {
  type: 'workflow_recipe';
  taskPattern: string;
  steps: Array<{
    order: number;
    description: string;
    canonicalFile?: string;
    canonicalLine?: number;
  }>;
  lastValidatedAt: string;
  successCount: number;
  scope: 'global';
}

export interface DeadEndMemory extends Memory {
  type: 'dead_end';
  approachTried: string;
  whyItFailed: string;
  alternativeUsed: string;
  taskContext: string;
  decayHalfLifeDays: 90;
}

export interface PrefetchPattern extends Memory {
  type: 'prefetch_pattern';
  alwaysReadFiles: string[];
  frequentlyReadFiles: string[];
  moduleTrigger: string;
  sessionCount: number;
  scope: 'module';
}

export interface TaskCalibration extends Memory {
  type: 'task_calibration';
  module: string;
  methodology: string;
  averageActualSteps: number;
  averagePlannedSteps: number;
  ratio: number;
  sampleCount: number;
}

// ============================================================
// METHODOLOGY ABSTRACTION
// ============================================================

export interface MemoryTypeDefinition {
  id: string;
  displayName: string;
  decayHalfLifeDays?: number;
}

export interface RelayTransition {
  from: string;
  to: string;
  filter?: { types: MemoryType[] };
}

export interface ExecutionContext {
  specNumber?: string;
  subtaskId?: string;
  phase?: string;
  methodology?: string;
}

export interface WorkUnitResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface MemoryService {
  store(entry: MemoryRecordEntry): Promise<string>;
  search(filters: MemorySearchFilters): Promise<Memory[]>;
  searchByPattern(pattern: string): Promise<Memory | null>;
  insertUserTaught(content: string, projectId: string, tags: string[]): Promise<string>;
  searchWorkflowRecipe(taskDescription: string, opts?: { limit?: number }): Promise<Memory[]>;
  updateAccessCount(memoryId: string): Promise<void>;
  deprecateMemory(memoryId: string): Promise<void>;
  verifyMemory(memoryId: string): Promise<void>;
  pinMemory(memoryId: string, pinned: boolean): Promise<void>;
  deleteMemory(memoryId: string): Promise<void>;
}

export interface MemoryMethodologyPlugin {
  id: string;
  displayName: string;
  mapPhase(methodologyPhase: string): UniversalPhase;
  resolveWorkUnitRef(context: ExecutionContext): WorkUnitRef;
  getRelayTransitions(): RelayTransition[];
  formatRelayContext(memories: Memory[], toStage: string): string;
  extractWorkState(sessionOutput: string): Promise<Record<string, unknown>>;
  formatWorkStateContext(state: Record<string, unknown>): string;
  customMemoryTypes?: MemoryTypeDefinition[];
  onWorkUnitComplete?(ctx: ExecutionContext, result: WorkUnitResult, svc: MemoryService): Promise<void>;
}

export const nativePlugin: MemoryMethodologyPlugin = {
  id: 'native',
  displayName: 'Aperant (Subtasks)',
  mapPhase: (p: string): UniversalPhase => {
    const map: Record<string, UniversalPhase> = {
      planning: 'define',
      spec: 'define',
      coding: 'implement',
      qa_review: 'validate',
      qa_fix: 'refine',
      debugging: 'refine',
      insights: 'explore',
    };
    return map[p] ?? 'explore';
  },
  resolveWorkUnitRef: (ctx: ExecutionContext): WorkUnitRef => ({
    methodology: 'native',
    hierarchy: [ctx.specNumber, ctx.subtaskId].filter((x): x is string => Boolean(x)),
    label: ctx.subtaskId
      ? `Spec ${ctx.specNumber} / Subtask ${ctx.subtaskId}`
      : `Spec ${ctx.specNumber}`,
  }),
  getRelayTransitions: (): RelayTransition[] => [
    { from: 'planner', to: 'coder' },
    { from: 'coder', to: 'qa_reviewer' },
    { from: 'qa_reviewer', to: 'qa_fixer', filter: { types: ['error_pattern', 'requirement'] } },
  ],
  formatRelayContext: (_memories: Memory[], _toStage: string): string => '',
  extractWorkState: async (_sessionOutput: string): Promise<Record<string, unknown>> => ({}),
  formatWorkStateContext: (_state: Record<string, unknown>): string => '',
};

// ============================================================
// SEARCH + RECORD INTERFACES
// ============================================================

export interface MemorySearchFilters {
  query?: string;
  types?: MemoryType[];
  sources?: MemorySource[];
  scope?: MemoryScope;
  relatedFiles?: string[];
  relatedModules?: string[];
  projectId?: string;
  phase?: UniversalPhase;
  minConfidence?: number;
  limit?: number;
  sort?: 'relevance' | 'recency' | 'confidence';
  excludeDeprecated?: boolean;
  filter?: (memory: Memory) => boolean;
}

export interface MemoryRecordEntry {
  type: MemoryType;
  content: string;
  confidence?: number;
  tags?: string[];
  relatedFiles?: string[];
  relatedModules?: string[];
  scope?: MemoryScope;
  source?: MemorySource;
  sessionId?: string;
  projectId: string;
  workUnitRef?: WorkUnitRef;
  methodology?: string;
  decayHalfLifeDays?: number;
  needsReview?: boolean;
  pinned?: boolean;
  citationText?: string;
  chunkType?: 'function' | 'class' | 'module' | 'prose';
  chunkStartLine?: number;
  chunkEndLine?: number;
  contextPrefix?: string;
  trustLevelScope?: string;
}

// ============================================================
// CANDIDATE TYPES (for Observer/Promotion pipeline)
// ============================================================

export interface MemoryCandidate {
  signalType: SignalType;
  proposedType: MemoryType;
  content: string;
  relatedFiles: string[];
  relatedModules: string[];
  confidence: number;
  priority: number;
  originatingStep: number;
  needsReview?: boolean;
  trustFlags?: {
    contaminated: boolean;
    contaminationSource: string;
  };
}

export interface AcuteCandidate {
  signalType: SignalType;
  rawData: unknown;
  priority: number;
  capturedAt: number;
  stepNumber: number;
}

// ============================================================
// IPC MESSAGE TYPES
// ============================================================

export type MemoryIpcRequest =
  | {
      type: 'memory:tool-call';
      toolName: string;
      args: Record<string, unknown>;
      stepNumber: number;
    }
  | {
      type: 'memory:tool-result';
      toolName: string;
      result: unknown;
      stepNumber: number;
    }
  | {
      type: 'memory:reasoning';
      text: string;
      stepNumber: number;
    }
  | {
      type: 'memory:step-complete';
      stepNumber: number;
    };

export type MemoryIpcResponse =
  | {
      type: 'memory:search-result';
      requestId: string;
      memories: Memory[];
    }
  | {
      type: 'memory:stored';
      requestId: string;
      id: string;
    }
  | {
      type: 'memory:error';
      requestId: string;
      error: string;
    };

// ============================================================
// KNOWLEDGE GRAPH TYPES
// ============================================================

export type GraphNodeType =
  | 'file'
  | 'function'
  | 'class'
  | 'interface'
  | 'type_alias'
  | 'variable'
  | 'enum'
  | 'module';

export type GraphEdgeType =
  | 'imports'
  | 'imports_symbol'
  | 'calls'
  | 'extends'
  | 'implements'
  | 'exports'
  | 'defined_in';

export type GraphNodeSource = 'ast' | 'scip' | 'llm' | 'agent';
export type GraphNodeConfidence = 'confirmed' | 'inferred' | 'speculative';

export interface GraphNode {
  id: string;
  projectId: string;
  type: GraphNodeType;
  label: string;
  filePath?: string;
  language?: string;
  startLine?: number;
  endLine?: number;
  layer: number;
  source: GraphNodeSource;
  confidence: GraphNodeConfidence;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  staleAt?: number;
  associatedMemoryIds: string[];
}

export interface GraphEdge {
  id: string;
  projectId: string;
  fromId: string;
  toId: string;
  type: GraphEdgeType;
  layer: number;
  weight: number;
  source: GraphNodeSource;
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  staleAt?: number;
}

export interface ClosureEntry {
  ancestorId: string;
  descendantId: string;
  depth: number;
  path: string[];
  edgeTypes: GraphEdgeType[];
  totalWeight: number;
}

export interface GraphIndexState {
  projectId: string;
  lastIndexedAt: number;
  lastCommitSha?: string;
  nodeCount: number;
  edgeCount: number;
  staleEdgeCount: number;
  indexVersion: number;
}

export interface ImpactResult {
  target: {
    nodeId: string;
    label: string;
    filePath: string;
  };
  directDependents: Array<{
    nodeId: string;
    label: string;
    filePath: string;
    edgeType: string;
  }>;
  transitiveDependents: Array<{
    nodeId: string;
    label: string;
    filePath: string;
    depth: number;
  }>;
  affectedTests: Array<{
    filePath: string;
    testName?: string;
  }>;
  affectedMemories: Array<{
    memoryId: string;
    type: string;
    content: string;
  }>;
}
