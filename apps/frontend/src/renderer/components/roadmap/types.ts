import type { RoadmapFeature, RoadmapPhase, Roadmap, CompetitorPainPoint, CompetitorAnalysis } from '../../../shared/types';

export interface RoadmapProps {
  projectId: string;
  onGoToTask?: (taskId: string) => void;
}

export interface PhaseCardProps {
  phase: RoadmapPhase;
  features: RoadmapFeature[];
  isFirst: boolean;
  onFeatureSelect: (feature: RoadmapFeature) => void;
  onConvertToSpec: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
}

export interface FeatureCardProps {
  feature: RoadmapFeature;
  onClick: () => void;
  onConvertToSpec: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
  hasCompetitorInsight?: boolean;
  onDependencyClick?: (featureId: string) => void;
  features: RoadmapFeature[];
}

export interface FeatureDetailPanelProps {
  feature: RoadmapFeature;
  features: RoadmapFeature[];
  onClose: () => void;
  onConvertToSpec: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
  onDelete?: (featureId: string) => void;
  competitorInsights?: CompetitorPainPoint[];
  onDependencyClick?: (featureId: string) => void;
}

export interface RoadmapHeaderProps {
  roadmap: Roadmap;
  competitorAnalysis: CompetitorAnalysis | null;
  onAddFeature: () => void;
  onRefresh: () => void;
  onViewCompetitorAnalysis?: () => void;
}

export interface RoadmapEmptyStateProps {
  onGenerate: () => void;
}

export interface RoadmapTabsProps {
  roadmap: Roadmap;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onFeatureSelect: (feature: RoadmapFeature) => void;
  onConvertToSpec: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
  onSave?: () => void;
  onDependencyClick?: (featureId: string) => void;
}
