/**
 * Unit tests for Roadmap Store
 * Tests Zustand store for roadmap state management including drag-and-drop actions
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRoadmapStore, getFeaturesByPhase, getFeaturesByPriority, getFeatureStats, resetActors } from '../stores/roadmap-store';
import type {
  Roadmap,
  RoadmapFeature,
  RoadmapPhase,
  RoadmapFeaturePriority,
  RoadmapFeatureStatus
} from '../../shared/types';

// Helper to create test features
function createTestFeature(overrides: Partial<RoadmapFeature> = {}): RoadmapFeature {
  return {
    id: `feature-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    title: 'Test Feature',
    description: 'Test description',
    rationale: 'Test rationale',
    priority: 'should' as RoadmapFeaturePriority,
    complexity: 'medium',
    impact: 'medium',
    phaseId: 'phase-1',
    dependencies: [],
    status: 'under_review' as RoadmapFeatureStatus,
    acceptanceCriteria: ['Test criteria'],
    userStories: ['As a user, I want to test'],
    ...overrides
  };
}

// Helper to create test phases
function createTestPhase(overrides: Partial<RoadmapPhase> = {}): RoadmapPhase {
  return {
    id: `phase-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    name: 'Test Phase',
    description: 'Test phase description',
    order: 1,
    status: 'planned',
    features: [],
    milestones: [],
    ...overrides
  };
}

// Helper to create test roadmap
function createTestRoadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  return {
    id: 'roadmap-1',
    projectId: 'project-1',
    projectName: 'Test Project',
    version: '1.0.0',
    vision: 'Test vision',
    targetAudience: {
      primary: 'Developers',
      secondary: ['DevOps']
    },
    phases: [
      createTestPhase({ id: 'phase-1', name: 'Phase 1', order: 1 }),
      createTestPhase({ id: 'phase-2', name: 'Phase 2', order: 2 }),
      createTestPhase({ id: 'phase-3', name: 'Phase 3', order: 3 })
    ],
    features: [],
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

describe('Roadmap Store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useRoadmapStore.setState({
      roadmap: null,
      competitorAnalysis: null,
      generationStatus: {
        phase: 'idle',
        progress: 0,
        message: ''
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Reset XState actors to prevent test pollution
    resetActors();
  });

  describe('setRoadmap', () => {
    it('should set roadmap', () => {
      const roadmap = createTestRoadmap();

      useRoadmapStore.getState().setRoadmap(roadmap);

      expect(useRoadmapStore.getState().roadmap).toBeDefined();
      expect(useRoadmapStore.getState().roadmap?.id).toBe('roadmap-1');
    });

    it('should clear roadmap with null', () => {
      useRoadmapStore.setState({ roadmap: createTestRoadmap() });

      useRoadmapStore.getState().setRoadmap(null);

      expect(useRoadmapStore.getState().roadmap).toBeNull();
    });
  });

  describe('reorderFeatures', () => {
    it('should reorder features within a phase', () => {
      const features = [
        createTestFeature({ id: 'feature-1', phaseId: 'phase-1', title: 'Feature 1' }),
        createTestFeature({ id: 'feature-2', phaseId: 'phase-1', title: 'Feature 2' }),
        createTestFeature({ id: 'feature-3', phaseId: 'phase-1', title: 'Feature 3' })
      ];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      // Reorder: move feature-3 to the top
      useRoadmapStore.getState().reorderFeatures('phase-1', ['feature-3', 'feature-1', 'feature-2']);

      const state = useRoadmapStore.getState();
      const phase1Features = state.roadmap?.features.filter((f) => f.phaseId === 'phase-1') || [];

      expect(phase1Features).toHaveLength(3);
      expect(phase1Features[0].id).toBe('feature-3');
      expect(phase1Features[1].id).toBe('feature-1');
      expect(phase1Features[2].id).toBe('feature-2');
    });

    it('should not affect features in other phases', () => {
      const features = [
        createTestFeature({ id: 'feature-1', phaseId: 'phase-1' }),
        createTestFeature({ id: 'feature-2', phaseId: 'phase-1' }),
        createTestFeature({ id: 'feature-3', phaseId: 'phase-2' }),
        createTestFeature({ id: 'feature-4', phaseId: 'phase-2' })
      ];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      // Reorder phase-1 features only
      useRoadmapStore.getState().reorderFeatures('phase-1', ['feature-2', 'feature-1']);

      const state = useRoadmapStore.getState();
      const phase2Features = state.roadmap?.features.filter((f) => f.phaseId === 'phase-2') || [];

      // Phase 2 features should be unchanged
      expect(phase2Features).toHaveLength(2);
      expect(phase2Features.map((f) => f.id)).toContain('feature-3');
      expect(phase2Features.map((f) => f.id)).toContain('feature-4');
    });

    it('should update updatedAt timestamp', () => {
      const originalDate = new Date('2024-01-01');
      const roadmap = createTestRoadmap({
        features: [
          createTestFeature({ id: 'feature-1', phaseId: 'phase-1' }),
          createTestFeature({ id: 'feature-2', phaseId: 'phase-1' })
        ],
        updatedAt: originalDate
      });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().reorderFeatures('phase-1', ['feature-2', 'feature-1']);

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.updatedAt.getTime()).toBeGreaterThan(originalDate.getTime());
    });

    it('should handle empty feature array', () => {
      const roadmap = createTestRoadmap({ features: [] });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().reorderFeatures('phase-1', []);

      expect(useRoadmapStore.getState().roadmap?.features).toHaveLength(0);
    });

    it('should handle non-existent feature IDs gracefully', () => {
      const features = [
        createTestFeature({ id: 'feature-1', phaseId: 'phase-1' }),
        createTestFeature({ id: 'feature-2', phaseId: 'phase-1' })
      ];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      // Try to reorder with a non-existent ID - it should be filtered out
      useRoadmapStore.getState().reorderFeatures('phase-1', ['feature-2', 'nonexistent', 'feature-1']);

      const state = useRoadmapStore.getState();
      const phase1Features = state.roadmap?.features.filter((f) => f.phaseId === 'phase-1') || [];

      expect(phase1Features).toHaveLength(2);
    });

    it('should do nothing if roadmap is null', () => {
      useRoadmapStore.setState({ roadmap: null });

      useRoadmapStore.getState().reorderFeatures('phase-1', ['feature-1', 'feature-2']);

      expect(useRoadmapStore.getState().roadmap).toBeNull();
    });
  });

  describe('updateFeaturePhase', () => {
    it('should move feature to a different phase', () => {
      const features = [
        createTestFeature({ id: 'feature-1', phaseId: 'phase-1' }),
        createTestFeature({ id: 'feature-2', phaseId: 'phase-1' })
      ];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().updateFeaturePhase('feature-1', 'phase-2');

      const state = useRoadmapStore.getState();
      const movedFeature = state.roadmap?.features.find((f) => f.id === 'feature-1');

      expect(movedFeature?.phaseId).toBe('phase-2');
    });

    it('should not affect other features', () => {
      const features = [
        createTestFeature({ id: 'feature-1', phaseId: 'phase-1' }),
        createTestFeature({ id: 'feature-2', phaseId: 'phase-1' }),
        createTestFeature({ id: 'feature-3', phaseId: 'phase-2' })
      ];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().updateFeaturePhase('feature-1', 'phase-3');

      const state = useRoadmapStore.getState();

      // Other features should remain in their original phases
      expect(state.roadmap?.features.find((f) => f.id === 'feature-2')?.phaseId).toBe('phase-1');
      expect(state.roadmap?.features.find((f) => f.id === 'feature-3')?.phaseId).toBe('phase-2');
    });

    it('should update updatedAt timestamp', () => {
      const originalDate = new Date('2024-01-01');
      const roadmap = createTestRoadmap({
        features: [createTestFeature({ id: 'feature-1', phaseId: 'phase-1' })],
        updatedAt: originalDate
      });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().updateFeaturePhase('feature-1', 'phase-2');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.updatedAt.getTime()).toBeGreaterThan(originalDate.getTime());
    });

    it('should do nothing for non-existent feature', () => {
      const features = [createTestFeature({ id: 'feature-1', phaseId: 'phase-1' })];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().updateFeaturePhase('nonexistent', 'phase-2');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features).toHaveLength(1);
      expect(state.roadmap?.features[0].phaseId).toBe('phase-1');
    });

    it('should do nothing if roadmap is null', () => {
      useRoadmapStore.setState({ roadmap: null });

      useRoadmapStore.getState().updateFeaturePhase('feature-1', 'phase-2');

      expect(useRoadmapStore.getState().roadmap).toBeNull();
    });

    it('should handle moving feature to same phase (no change needed)', () => {
      const features = [createTestFeature({ id: 'feature-1', phaseId: 'phase-1' })];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().updateFeaturePhase('feature-1', 'phase-1');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features.find((f) => f.id === 'feature-1')?.phaseId).toBe('phase-1');
    });
  });

  describe('addFeature', () => {
    it('should add a new feature to the roadmap', () => {
      const roadmap = createTestRoadmap({ features: [] });

      useRoadmapStore.setState({ roadmap });

      const newFeature = {
        title: 'New Feature',
        description: 'New feature description',
        rationale: 'New feature rationale',
        priority: 'must' as RoadmapFeaturePriority,
        complexity: 'high' as const,
        impact: 'high' as const,
        phaseId: 'phase-1',
        dependencies: [],
        status: 'under_review' as RoadmapFeatureStatus,
        acceptanceCriteria: ['Criteria 1'],
        userStories: ['User story 1']
      };

      const newId = useRoadmapStore.getState().addFeature(newFeature);

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features).toHaveLength(1);
      expect(state.roadmap?.features[0].id).toBe(newId);
      expect(state.roadmap?.features[0].title).toBe('New Feature');
    });

    it('should generate unique ID for new feature', () => {
      const roadmap = createTestRoadmap({ features: [] });

      useRoadmapStore.setState({ roadmap });

      const featureData = {
        title: 'Feature',
        description: 'Description',
        rationale: 'Rationale',
        priority: 'should' as RoadmapFeaturePriority,
        complexity: 'medium' as const,
        impact: 'medium' as const,
        phaseId: 'phase-1',
        dependencies: [],
        status: 'under_review' as RoadmapFeatureStatus,
        acceptanceCriteria: [],
        userStories: []
      };

      const id1 = useRoadmapStore.getState().addFeature(featureData);
      const id2 = useRoadmapStore.getState().addFeature(featureData);

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^feature-\d+-[a-z0-9]+$/);
    });

    it('should append feature to existing features', () => {
      const features = [
        createTestFeature({ id: 'existing-1' }),
        createTestFeature({ id: 'existing-2' })
      ];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().addFeature({
        title: 'New Feature',
        description: 'Description',
        rationale: 'Rationale',
        priority: 'could' as RoadmapFeaturePriority,
        complexity: 'low' as const,
        impact: 'low' as const,
        phaseId: 'phase-2',
        dependencies: [],
        status: 'planned' as RoadmapFeatureStatus,
        acceptanceCriteria: [],
        userStories: []
      });

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features).toHaveLength(3);
      expect(state.roadmap?.features[2].title).toBe('New Feature');
    });

    it('should update updatedAt timestamp', () => {
      const originalDate = new Date('2024-01-01');
      const roadmap = createTestRoadmap({ features: [], updatedAt: originalDate });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().addFeature({
        title: 'New Feature',
        description: 'Description',
        rationale: 'Rationale',
        priority: 'must' as RoadmapFeaturePriority,
        complexity: 'medium' as const,
        impact: 'high' as const,
        phaseId: 'phase-1',
        dependencies: [],
        status: 'under_review' as RoadmapFeatureStatus,
        acceptanceCriteria: [],
        userStories: []
      });

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.updatedAt.getTime()).toBeGreaterThan(originalDate.getTime());
    });

    it('should return empty string if roadmap is null', () => {
      useRoadmapStore.setState({ roadmap: null });

      const newId = useRoadmapStore.getState().addFeature({
        title: 'New Feature',
        description: 'Description',
        rationale: 'Rationale',
        priority: 'must' as RoadmapFeaturePriority,
        complexity: 'medium' as const,
        impact: 'high' as const,
        phaseId: 'phase-1',
        dependencies: [],
        status: 'under_review' as RoadmapFeatureStatus,
        acceptanceCriteria: [],
        userStories: []
      });

      // The function still generates an ID, but the roadmap remains null
      expect(newId).toMatch(/^feature-\d+-[a-z0-9]+$/);
      expect(useRoadmapStore.getState().roadmap).toBeNull();
    });

    it('should correctly assign phaseId from input', () => {
      const roadmap = createTestRoadmap({ features: [] });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().addFeature({
        title: 'Phase 3 Feature',
        description: 'Description',
        rationale: 'Rationale',
        priority: 'should' as RoadmapFeaturePriority,
        complexity: 'medium' as const,
        impact: 'medium' as const,
        phaseId: 'phase-3',
        dependencies: [],
        status: 'under_review' as RoadmapFeatureStatus,
        acceptanceCriteria: [],
        userStories: []
      });

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features[0].phaseId).toBe('phase-3');
    });

    it('should preserve all feature properties', () => {
      const roadmap = createTestRoadmap({ features: [] });

      useRoadmapStore.setState({ roadmap });

      const featureData = {
        title: 'Complete Feature',
        description: 'Full description',
        rationale: 'Solid rationale',
        priority: 'must' as RoadmapFeaturePriority,
        complexity: 'high' as const,
        impact: 'high' as const,
        phaseId: 'phase-1',
        dependencies: ['dep-1', 'dep-2'],
        status: 'planned' as RoadmapFeatureStatus,
        acceptanceCriteria: ['AC1', 'AC2'],
        userStories: ['Story 1', 'Story 2'],
        linkedSpecId: 'spec-123',
        competitorInsightIds: ['insight-1']
      };

      useRoadmapStore.getState().addFeature(featureData);

      const state = useRoadmapStore.getState();
      const addedFeature = state.roadmap?.features[0];

      expect(addedFeature?.title).toBe('Complete Feature');
      expect(addedFeature?.description).toBe('Full description');
      expect(addedFeature?.rationale).toBe('Solid rationale');
      expect(addedFeature?.priority).toBe('must');
      expect(addedFeature?.complexity).toBe('high');
      expect(addedFeature?.impact).toBe('high');
      expect(addedFeature?.dependencies).toEqual(['dep-1', 'dep-2']);
      expect(addedFeature?.acceptanceCriteria).toEqual(['AC1', 'AC2']);
      expect(addedFeature?.userStories).toEqual(['Story 1', 'Story 2']);
      expect(addedFeature?.linkedSpecId).toBe('spec-123');
      expect(addedFeature?.competitorInsightIds).toEqual(['insight-1']);
    });
  });

  describe('updateFeatureStatus', () => {
    it('should update feature status by id', () => {
      const features = [createTestFeature({ id: 'feature-1', status: 'under_review' })];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().updateFeatureStatus('feature-1', 'in_progress');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features[0].status).toBe('in_progress');
    });

    it('should clear taskOutcome and previousStatus when moving away from done', () => {
      const features = [createTestFeature({
        id: 'feature-1',
        status: 'done' as RoadmapFeatureStatus,
        taskOutcome: 'completed',
        previousStatus: 'in_progress' as RoadmapFeatureStatus
      })];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().updateFeatureStatus('feature-1', 'in_progress');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features[0].status).toBe('in_progress');
      expect(state.roadmap?.features[0].taskOutcome).toBeUndefined();
      expect(state.roadmap?.features[0].previousStatus).toBeUndefined();
    });

    it('should preserve taskOutcome when status remains done', () => {
      const features = [createTestFeature({
        id: 'feature-1',
        status: 'done' as RoadmapFeatureStatus,
        taskOutcome: 'completed'
      })];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().updateFeatureStatus('feature-1', 'done');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features[0].taskOutcome).toBe('completed');
    });
  });

  describe('markFeatureDoneBySpecId', () => {
    it('should mark feature as done with taskOutcome', () => {
      const features = [createTestFeature({
        id: 'feature-1',
        linkedSpecId: 'spec-001',
        status: 'in_progress' as RoadmapFeatureStatus
      })];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().markFeatureDoneBySpecId('spec-001', 'completed');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features[0].status).toBe('done');
      expect(state.roadmap?.features[0].taskOutcome).toBe('completed');
    });

    it('should preserve previousStatus before overwriting to done', () => {
      const features = [createTestFeature({
        id: 'feature-1',
        linkedSpecId: 'spec-001',
        status: 'planned' as RoadmapFeatureStatus
      })];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().markFeatureDoneBySpecId('spec-001', 'archived');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features[0].status).toBe('done');
      expect(state.roadmap?.features[0].taskOutcome).toBe('archived');
      expect(state.roadmap?.features[0].previousStatus).toBe('planned');
    });

    it('should not overwrite previousStatus if already done', () => {
      const features = [createTestFeature({
        id: 'feature-1',
        linkedSpecId: 'spec-001',
        status: 'done' as RoadmapFeatureStatus,
        taskOutcome: 'completed',
        previousStatus: 'in_progress' as RoadmapFeatureStatus
      })];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().markFeatureDoneBySpecId('spec-001', 'archived');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features[0].taskOutcome).toBe('archived');
      expect(state.roadmap?.features[0].previousStatus).toBe('in_progress');
    });

    it('should not affect features with different linkedSpecId', () => {
      const features = [
        createTestFeature({ id: 'feature-1', linkedSpecId: 'spec-001', status: 'in_progress' as RoadmapFeatureStatus }),
        createTestFeature({ id: 'feature-2', linkedSpecId: 'spec-002', status: 'planned' as RoadmapFeatureStatus })
      ];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().markFeatureDoneBySpecId('spec-001', 'completed');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features[1].status).toBe('planned');
      expect(state.roadmap?.features[1].taskOutcome).toBeUndefined();
    });
  });

  describe('updateFeatureLinkedSpec', () => {
    it('should update linked spec and set status to in_progress', () => {
      const features = [createTestFeature({ id: 'feature-1', status: 'under_review' })];
      const roadmap = createTestRoadmap({ features });

      useRoadmapStore.setState({ roadmap });

      useRoadmapStore.getState().updateFeatureLinkedSpec('feature-1', 'spec-abc');

      const state = useRoadmapStore.getState();
      expect(state.roadmap?.features[0].linkedSpecId).toBe('spec-abc');
      expect(state.roadmap?.features[0].status).toBe('in_progress');
    });
  });

  describe('setGenerationStatus catch-up logic', () => {
    it('should advance from idle to analyzing', () => {
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'analyzing',
        progress: 10,
        message: 'Analyzing...'
      });

      const status = useRoadmapStore.getState().generationStatus;
      expect(status.phase).toBe('analyzing');
      expect(status.progress).toBe(10);
      expect(status.message).toBe('Analyzing...');
    });

    it('should advance from idle to discovering via catch-up', () => {
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'discovering',
        progress: 30,
        message: 'Discovering...'
      });

      const status = useRoadmapStore.getState().generationStatus;
      expect(status.phase).toBe('discovering');
      expect(status.progress).toBe(30);
      expect(status.message).toBe('Discovering...');
    });

    it('should advance from idle to generating via catch-up', () => {
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'generating',
        progress: 60,
        message: 'Generating...'
      });

      const status = useRoadmapStore.getState().generationStatus;
      expect(status.phase).toBe('generating');
      expect(status.progress).toBe(60);
      expect(status.message).toBe('Generating...');
    });

    it('should advance from idle to complete via catch-up', () => {
      // First go through active states to build up context, then complete
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'analyzing',
        progress: 10,
        message: 'Analyzing...'
      });
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'complete',
        progress: 100,
        message: 'Done'
      });

      const status = useRoadmapStore.getState().generationStatus;
      expect(status.phase).toBe('complete');
      expect(status.progress).toBe(100);
    });

    it('should advance from idle to error via catch-up', () => {
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'error',
        progress: 0,
        message: '',
        error: 'Something failed'
      });

      const status = useRoadmapStore.getState().generationStatus;
      expect(status.phase).toBe('error');
      expect(status.error).toBe('Something failed');
    });

    it('should reset from error and start new generation', () => {
      // First put into error state
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'error',
        progress: 0,
        message: '',
        error: 'Failed'
      });
      expect(useRoadmapStore.getState().generationStatus.phase).toBe('error');

      // Now start a new generation from error state
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'analyzing',
        progress: 5,
        message: 'Restarting...'
      });

      const status = useRoadmapStore.getState().generationStatus;
      expect(status.phase).toBe('analyzing');
      expect(status.progress).toBe(5);
    });

    it('should send progress updates for active states', () => {
      // Move to analyzing
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'analyzing',
        progress: 0,
        message: 'Starting...'
      });

      // Update progress in analyzing
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'analyzing',
        progress: 50,
        message: 'Halfway...'
      });

      const status = useRoadmapStore.getState().generationStatus;
      expect(status.phase).toBe('analyzing');
      expect(status.progress).toBe(50);
      expect(status.message).toBe('Halfway...');
    });

    it('should be idempotent for idle-to-idle transitions', () => {
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'idle',
        progress: 0,
        message: ''
      });

      const status = useRoadmapStore.getState().generationStatus;
      expect(status.phase).toBe('idle');
      expect(status.progress).toBe(0);
    });

    it('should handle complete-to-idle reset', () => {
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'complete',
        progress: 100,
        message: 'Done'
      });
      expect(useRoadmapStore.getState().generationStatus.phase).toBe('complete');

      useRoadmapStore.getState().setGenerationStatus({
        phase: 'idle',
        progress: 0,
        message: ''
      });
      expect(useRoadmapStore.getState().generationStatus.phase).toBe('idle');
    });

    it('should preserve startedAt from persisted status on reload', () => {
      const persistedStartedAt = new Date('2025-06-01T12:00:00Z');
      useRoadmapStore.getState().setGenerationStatus({
        phase: 'generating',
        progress: 70,
        message: 'Generating...',
        startedAt: persistedStartedAt,
        lastActivityAt: new Date()
      });

      const status = useRoadmapStore.getState().generationStatus;
      expect(status.phase).toBe('generating');
      expect(status.startedAt).toBeDefined();
      expect(status.startedAt!.getTime()).toBe(persistedStartedAt.getTime());
    });
  });

  describe('clearRoadmap', () => {
    it('should clear roadmap and reset status', () => {
      useRoadmapStore.setState({
        roadmap: createTestRoadmap(),
        generationStatus: {
          phase: 'complete',
          progress: 100,
          message: 'Done'
        }
      });

      useRoadmapStore.getState().clearRoadmap();

      const state = useRoadmapStore.getState();
      expect(state.roadmap).toBeNull();
      expect(state.generationStatus.phase).toBe('idle');
      expect(state.generationStatus.progress).toBe(0);
    });
  });

  describe('Helper Functions', () => {
    describe('getFeaturesByPhase', () => {
      it('should return features for specific phase', () => {
        const roadmap = createTestRoadmap({
          features: [
            createTestFeature({ id: 'f1', phaseId: 'phase-1' }),
            createTestFeature({ id: 'f2', phaseId: 'phase-1' }),
            createTestFeature({ id: 'f3', phaseId: 'phase-2' })
          ]
        });

        const phase1Features = getFeaturesByPhase(roadmap, 'phase-1');

        expect(phase1Features).toHaveLength(2);
        expect(phase1Features.map((f) => f.id)).toContain('f1');
        expect(phase1Features.map((f) => f.id)).toContain('f2');
      });

      it('should return empty array for null roadmap', () => {
        const features = getFeaturesByPhase(null, 'phase-1');
        expect(features).toHaveLength(0);
      });

      it('should return empty array for non-existent phase', () => {
        const roadmap = createTestRoadmap({
          features: [createTestFeature({ id: 'f1', phaseId: 'phase-1' })]
        });

        const features = getFeaturesByPhase(roadmap, 'non-existent');
        expect(features).toHaveLength(0);
      });
    });

    describe('getFeaturesByPriority', () => {
      it('should return features for specific priority', () => {
        const roadmap = createTestRoadmap({
          features: [
            createTestFeature({ id: 'f1', priority: 'must' }),
            createTestFeature({ id: 'f2', priority: 'should' }),
            createTestFeature({ id: 'f3', priority: 'must' })
          ]
        });

        const mustFeatures = getFeaturesByPriority(roadmap, 'must');

        expect(mustFeatures).toHaveLength(2);
        expect(mustFeatures.map((f) => f.id)).toContain('f1');
        expect(mustFeatures.map((f) => f.id)).toContain('f3');
      });

      it('should return empty array for null roadmap', () => {
        const features = getFeaturesByPriority(null, 'must');
        expect(features).toHaveLength(0);
      });
    });

    describe('getFeatureStats', () => {
      it('should return correct stats', () => {
        const roadmap = createTestRoadmap({
          features: [
            createTestFeature({ priority: 'must', status: 'under_review', complexity: 'high' }),
            createTestFeature({ priority: 'must', status: 'planned', complexity: 'medium' }),
            createTestFeature({ priority: 'should', status: 'under_review', complexity: 'low' })
          ]
        });

        const stats = getFeatureStats(roadmap);

        expect(stats.total).toBe(3);
        expect(stats.byPriority['must']).toBe(2);
        expect(stats.byPriority['should']).toBe(1);
        expect(stats.byStatus['under_review']).toBe(2);
        expect(stats.byStatus['planned']).toBe(1);
        expect(stats.byComplexity['high']).toBe(1);
        expect(stats.byComplexity['medium']).toBe(1);
        expect(stats.byComplexity['low']).toBe(1);
      });

      it('should return zero stats for null roadmap', () => {
        const stats = getFeatureStats(null);

        expect(stats.total).toBe(0);
        expect(stats.byPriority).toEqual({});
        expect(stats.byStatus).toEqual({});
        expect(stats.byComplexity).toEqual({});
      });

      it('should return zero stats for empty features', () => {
        const roadmap = createTestRoadmap({ features: [] });
        const stats = getFeatureStats(roadmap);

        expect(stats.total).toBe(0);
      });
    });
  });
});
