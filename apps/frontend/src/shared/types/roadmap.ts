/**
 * Roadmap-related types
 */

// ============================================
// Competitor Analysis Types
// ============================================

export type CompetitorSource = 'manual' | 'ai';
export type CompetitorRelevance = 'high' | 'medium' | 'low';
export type PainPointSeverity = 'high' | 'medium' | 'low';
export type OpportunitySize = 'high' | 'medium' | 'low';

export interface CompetitorPainPoint {
  id: string;
  description: string;
  source: string;
  severity: PainPointSeverity;
  frequency: string;
  opportunity: string;
}

export interface Competitor {
  id: string;
  name: string;
  url: string;
  description: string;
  relevance: CompetitorRelevance;
  painPoints: CompetitorPainPoint[];
  strengths: string[];
  marketPosition: string;
  source?: CompetitorSource;
}

export interface ManualCompetitorInput {
  name: string;
  url: string;
  description: string;
  relevance: CompetitorRelevance;
}

export interface CompetitorMarketGap {
  id: string;
  description: string;
  affectedCompetitors: string[];
  opportunitySize: OpportunitySize;
  suggestedFeature: string;
}

export interface CompetitorInsightsSummary {
  topPainPoints: string[];
  differentiatorOpportunities: string[];
  marketTrends: string[];
}

export interface CompetitorResearchMetadata {
  searchQueriesUsed: string[];
  sourcesConsulted: string[];
  limitations: string[];
}

export interface CompetitorAnalysis {
  projectContext: {
    projectName: string;
    projectType: string;
    targetAudience: string;
  };
  competitors: Competitor[];
  marketGaps: CompetitorMarketGap[];
  insightsSummary: CompetitorInsightsSummary;
  researchMetadata: CompetitorResearchMetadata;
  createdAt: Date;
}

// ============================================
// Roadmap Types
// ============================================

export type RoadmapFeaturePriority = 'must' | 'should' | 'could' | 'wont';
export type RoadmapFeatureStatus = 'under_review' | 'planned' | 'in_progress' | 'done';
export type TaskOutcome = 'completed' | 'deleted' | 'archived';
export type RoadmapPhaseStatus = 'planned' | 'in_progress' | 'completed';
export type RoadmapStatus = 'draft' | 'active' | 'archived';

// Feature source tracking for external integrations (Canny, GitHub Issues, etc.)
export type FeatureSourceProvider = 'internal' | 'canny' | 'github_issue';

export interface FeatureSource {
  provider: FeatureSourceProvider;
  importedAt?: Date;
  lastSyncedAt?: Date;
}

export interface TargetAudience {
  primary: string;
  secondary: string[];
  painPoints?: string[];
  goals?: string[];
  usageContext?: string;
}

export interface RoadmapMilestone {
  id: string;
  title: string;
  description: string;
  features: string[];
  status: 'planned' | 'achieved';
  targetDate?: Date;
}

export interface RoadmapPhase {
  id: string;
  name: string;
  description: string;
  order: number;
  status: RoadmapPhaseStatus;
  features: string[];
  milestones: RoadmapMilestone[];
}

export interface RoadmapFeature {
  id: string;
  title: string;
  description: string;
  rationale: string;
  priority: RoadmapFeaturePriority;
  complexity: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  phaseId: string;
  dependencies: string[];
  status: RoadmapFeatureStatus;
  acceptanceCriteria: string[];
  userStories: string[];
  linkedSpecId?: string;
  taskOutcome?: TaskOutcome;
  previousStatus?: RoadmapFeatureStatus;
  competitorInsightIds?: string[];
  // External integration fields
  source?: FeatureSource;
  externalId?: string;    // ID from external system (e.g., Canny post ID)
  externalUrl?: string;   // Link back to external system
  votes?: number;         // Vote count from external system
}

export interface Roadmap {
  id: string;
  projectId: string;
  projectName: string;
  version: string;
  vision: string;
  targetAudience: TargetAudience;
  phases: RoadmapPhase[];
  features: RoadmapFeature[];
  status: RoadmapStatus;
  competitorAnalysis?: CompetitorAnalysis;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoadmapDiscovery {
  projectName: string;
  projectType: string;
  techStack: {
    primaryLanguage: string;
    frameworks: string[];
    keyDependencies: string[];
  };
  targetAudience: {
    primaryPersona: string;
    secondaryPersonas: string[];
    painPoints: string[];
    goals: string[];
    usageContext: string;
  };
  productVision: {
    oneLiner: string;
    problemStatement: string;
    valueProposition: string;
    successMetrics: string[];
  };
  currentState: {
    maturity: 'idea' | 'prototype' | 'mvp' | 'growth' | 'mature';
    existingFeatures: string[];
    knownGaps: string[];
    technicalDebt: string[];
  };
  createdAt: Date;
}

export interface RoadmapGenerationStatus {
  phase: 'idle' | 'analyzing' | 'discovering' | 'generating' | 'complete' | 'error';
  progress: number;
  message: string;
  error?: string;
  startedAt?: Date;
  lastActivityAt?: Date;
}

/**
 * Serialized version of RoadmapGenerationStatus for IPC transport.
 * Timestamps are ISO strings since Date objects serialize as strings in JSON.
 */
export interface PersistedRoadmapProgress {
  phase: RoadmapGenerationStatus['phase'];
  progress: number;
  message: string;
  startedAt?: string;
  lastActivityAt?: string;
}
