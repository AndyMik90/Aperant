/**
 * Insights and ideation types
 */

import type { TaskMetadata, ImageAttachment } from './task';

// ============================================
// Ideation Types
// ============================================

// Note: high_value_features removed - strategic features belong to Roadmap
// low_hanging_fruit renamed to code_improvements to cover all code-revealed opportunities
export type IdeationType =
  | 'code_improvements'
  | 'ui_ux_improvements'
  | 'documentation_gaps'
  | 'security_hardening'
  | 'performance_optimizations'
  | 'code_quality';
export type IdeationStatus = 'draft' | 'selected' | 'converted' | 'dismissed' | 'archived';
export type IdeationGenerationPhase = 'idle' | 'analyzing' | 'discovering' | 'generating' | 'finalizing' | 'complete' | 'error';

export interface IdeationConfig {
  enabledTypes: IdeationType[];
  includeRoadmapContext: boolean;
  includeKanbanContext: boolean;
  maxIdeasPerType: number;
  append?: boolean; // If true, append to existing ideas instead of replacing
  model?: string;          // Model shorthand (opus, sonnet, haiku)
  thinkingLevel?: string;  // Thinking level (low, medium, high)
}

export interface IdeaBase {
  id: string;
  title: string;
  description: string;
  rationale: string;
  status: IdeationStatus;
  createdAt: Date;
  taskId?: string; // ID of the created task when status is 'converted'
}

export interface CodeImprovementIdea extends IdeaBase {
  type: 'code_improvements';
  buildsUpon: string[];  // Features/patterns it extends
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large' | 'complex';  // Full effort spectrum
  affectedFiles: string[];
  existingPatterns: string[];  // Patterns to follow
  implementationApproach?: string;  // How to implement using existing code
}

export interface UIUXImprovementIdea extends IdeaBase {
  type: 'ui_ux_improvements';
  category: 'usability' | 'accessibility' | 'performance' | 'visual' | 'interaction';
  affectedComponents: string[];
  screenshots?: string[];  // Paths to screenshots taken by Puppeteer
  currentState: string;
  proposedChange: string;
  userBenefit: string;
}

export interface DocumentationGapIdea extends IdeaBase {
  type: 'documentation_gaps';
  category: 'readme' | 'api_docs' | 'inline_comments' | 'examples' | 'architecture' | 'troubleshooting';
  targetAudience: 'developers' | 'users' | 'contributors' | 'maintainers';
  affectedAreas: string[];  // Files, modules, or features needing docs
  currentDocumentation?: string;  // What exists now (if any)
  proposedContent: string;  // What should be documented
  priority: 'low' | 'medium' | 'high';
  estimatedEffort: 'trivial' | 'small' | 'medium';
}

export interface SecurityHardeningIdea extends IdeaBase {
  type: 'security_hardening';
  category: 'authentication' | 'authorization' | 'input_validation' | 'data_protection' | 'dependencies' | 'configuration' | 'secrets_management';
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedFiles: string[];
  vulnerability?: string;  // CVE or known vulnerability type
  currentRisk: string;  // Description of current exposure
  remediation: string;  // How to fix
  references?: string[];  // OWASP, CWE, or other security references
  compliance?: string[];  // SOC2, GDPR, etc. if applicable
}

export interface PerformanceOptimizationIdea extends IdeaBase {
  type: 'performance_optimizations';
  category: 'bundle_size' | 'runtime' | 'memory' | 'database' | 'network' | 'rendering' | 'caching';
  impact: 'low' | 'medium' | 'high';
  affectedAreas: string[];  // Files, components, or endpoints
  currentMetric?: string;  // Current performance measurement if known
  expectedImprovement: string;  // Expected gain
  implementation: string;  // How to implement the optimization
  tradeoffs?: string;  // Any downsides or considerations
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large';
}

export interface CodeQualityIdea extends IdeaBase {
  type: 'code_quality';
  category: 'large_files' | 'code_smells' | 'complexity' | 'duplication' | 'naming' | 'structure' | 'linting' | 'testing' | 'types' | 'dependencies' | 'dead_code' | 'git_hygiene';
  severity: 'suggestion' | 'minor' | 'major' | 'critical';
  affectedFiles: string[];  // Files that need refactoring
  currentState: string;  // Description of the current problematic state
  proposedChange: string;  // What should be done
  codeExample?: string;  // Example of problematic code (if applicable)
  bestPractice?: string;  // Reference to best practice being violated
  metrics?: {
    lineCount?: number;  // For large files
    complexity?: number;  // Cyclomatic complexity if applicable
    duplicateLines?: number;  // For duplication issues
    testCoverage?: number;  // Current test coverage percentage
  };
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large';
  breakingChange: boolean;  // Whether this refactoring could break existing code
  prerequisites?: string[];  // Things that should be done first
}

export type Idea =
  | CodeImprovementIdea
  | UIUXImprovementIdea
  | DocumentationGapIdea
  | SecurityHardeningIdea
  | PerformanceOptimizationIdea
  | CodeQualityIdea;

export interface IdeationSession {
  id: string;
  projectId: string;
  config: IdeationConfig;
  ideas: Idea[];
  projectContext: {
    existingFeatures: string[];
    techStack: string[];
    targetAudience?: string;
    plannedFeatures: string[];  // From roadmap/kanban
  };
  generatedAt: Date;
  updatedAt: Date;
}

export interface IdeationGenerationStatus {
  phase: IdeationGenerationPhase;
  currentType?: IdeationType;
  progress: number;
  message: string;
  error?: string;
}

export interface IdeationSummary {
  totalIdeas: number;
  byType: Record<IdeationType, number>;
  byStatus: Record<IdeationStatus, number>;
  lastGenerated?: Date;
}

// ============================================
// Insights Chat Types
// ============================================

import type { ThinkingLevel } from './settings';
import type { ModelType } from './task';

// Model configuration for insights sessions
export interface InsightsModelConfig {
  profileId: string;           // 'complex' | 'balanced' | 'quick' | 'custom'
  model: ModelType;            // 'haiku' | 'sonnet' | 'opus'
  thinkingLevel: ThinkingLevel;
}

export type InsightsChatRole = 'user' | 'assistant';

// Tool usage record for showing what tools the AI used
export interface InsightsToolUsage {
  name: string;
  input?: string;
  timestamp: Date;
}

export interface InsightsChatMessage {
  id: string;
  role: InsightsChatRole;
  content: string;
  timestamp: Date;
  // For assistant messages that suggest task creation
  suggestedTasks?: Array<{
    title: string;
    description: string;
    metadata?: TaskMetadata;
  }>;
  // Image attachments (screenshots, pasted images)
  images?: ImageAttachment[];
  // Tools used during this response (assistant messages only)
  toolsUsed?: InsightsToolUsage[];
}

export interface InsightsSession {
  id: string;
  projectId: string;
  title?: string; // Auto-generated from first message or user-set
  messages: InsightsChatMessage[];
  modelConfig?: InsightsModelConfig; // Per-session model configuration
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

// Summary of a session for the history list (without full messages)
export interface InsightsSessionSummary {
  id: string;
  projectId: string;
  title: string;
  messageCount: number;
  modelConfig?: InsightsModelConfig; // For displaying model indicator in sidebar
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

export interface InsightsChatStatus {
  phase: 'idle' | 'thinking' | 'streaming' | 'complete' | 'error';
  message?: string;
  error?: string;
}

export interface InsightsStreamChunk {
  type: 'text' | 'task_suggestion' | 'tool_start' | 'tool_end' | 'done' | 'error';
  content?: string;
  suggestedTasks?: Array<{
    title: string;
    description: string;
    metadata?: TaskMetadata;
  }>;
  tool?: {
    name: string;
    input?: string;  // Brief description of what's being searched/read
  };
  error?: string;
}
