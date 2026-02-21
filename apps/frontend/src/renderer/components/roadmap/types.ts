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
  onArchive?: (featureId: string) => void;
}

export interface FeatureCardProps {
  feature: RoadmapFeature;
  onClick: () => void;
  onConvertToSpec: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
  hasCompetitorInsight?: boolean;
  onArchive?: (featureId: string) => void;
}

export interface FeatureDetailPanelProps {
  feature: RoadmapFeature;
  onClose: () => void;
  onConvertToSpec: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
  onDelete?: (featureId: string) => void;
  onArchive?: (featureId: string) => void;
  competitorInsights?: CompetitorPainPoint[];
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
  onArchive?: (featureId: string) => void;
}
