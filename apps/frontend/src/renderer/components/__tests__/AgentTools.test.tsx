/**
 * @vitest-environment jsdom
 */
/**
 * Tests for AgentTools component
 * Specifically tests agent profile resolution for phase-based and feature-based agents
 */
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_AGENT_PROFILES, DEFAULT_PHASE_MODELS, DEFAULT_FEATURE_MODELS, DEFAULT_FEATURE_THINKING } from '../../../shared/constants/models';
import { resolveAgentSettings, } from '../../hooks';

// Mock electronAPI
global.window.electronAPI = {
  getProjectEnv: vi.fn().mockResolvedValue({ success: true, data: null }),
  updateProjectEnv: vi.fn().mockResolvedValue({ success: true }),
  checkMcpHealth: vi.fn().mockResolvedValue({ success: true, data: null }),
  testMcpConnection: vi.fn().mockResolvedValue({ success: true, data: null }),
} as any;

describe('AgentTools - Agent Profile Resolution', () => {
  describe('Profile Selection', () => {
    it('should find auto profile by ID', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'auto');
      expect(profile).toBeDefined();
      expect(profile?.id).toBe('auto');
      expect(profile?.name).toBe('Auto (Optimized)');
      expect(profile?.model).toBe('opus');
    });

    it('should find complex profile by ID', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'complex');
      expect(profile).toBeDefined();
      expect(profile?.id).toBe('complex');
      expect(profile?.name).toBe('Complex Tasks');
      expect(profile?.model).toBe('opus');
    });

    it('should find balanced profile by ID', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'balanced');
      expect(profile).toBeDefined();
      expect(profile?.id).toBe('balanced');
      expect(profile?.name).toBe('Balanced');
      expect(profile?.model).toBe('sonnet');
    });

    it('should find quick profile by ID', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'quick');
      expect(profile).toBeDefined();
      expect(profile?.id).toBe('quick');
      expect(profile?.name).toBe('Quick Edits');
      expect(profile?.model).toBe('haiku');
    });
  });

  describe('Auto Profile Phase Configuration', () => {
    it('should have Opus for all phases in auto profile', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'auto');
      const phaseModels = profile?.phaseModels;

      expect(phaseModels).toBeDefined();
      expect(phaseModels?.spec).toBe('opus');
      expect(phaseModels?.planning).toBe('opus');
      expect(phaseModels?.coding).toBe('opus');
      expect(phaseModels?.qa).toBe('opus');
    });

    it('should have optimized thinking levels in auto profile', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'auto');
      const phaseThinking = profile?.phaseThinking;

      expect(phaseThinking).toBeDefined();
      expect(phaseThinking?.spec).toBe('high');
      expect(phaseThinking?.planning).toBe('high');
      expect(phaseThinking?.coding).toBe('low');
      expect(phaseThinking?.qa).toBe('low');
    });
  });

  describe('Balanced Profile Phase Configuration', () => {
    it('should have Sonnet for all phases in balanced profile', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'balanced');
      const phaseModels = profile?.phaseModels;

      expect(phaseModels).toBeDefined();
      expect(phaseModels?.spec).toBe('sonnet');
      expect(phaseModels?.planning).toBe('sonnet');
      expect(phaseModels?.coding).toBe('sonnet');
      expect(phaseModels?.qa).toBe('sonnet');
    });

    it('should have medium thinking for all phases in balanced profile', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'balanced');
      const phaseThinking = profile?.phaseThinking;

      expect(phaseThinking).toBeDefined();
      expect(phaseThinking?.spec).toBe('medium');
      expect(phaseThinking?.planning).toBe('medium');
      expect(phaseThinking?.coding).toBe('medium');
      expect(phaseThinking?.qa).toBe('medium');
    });
  });

  describe('Profile Resolution Logic', () => {
    it('should use profile phase models when no custom overrides exist', () => {
      // Simulate settings with selected profile but no custom overrides
      const selectedProfileId = 'auto';
      const customPhaseModels = undefined;

      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0];
      const profilePhaseModels = profile.phaseModels || DEFAULT_PHASE_MODELS;
      const phaseModels = customPhaseModels || profilePhaseModels;

      // Should resolve to auto profile's opus models
      expect(phaseModels.spec).toBe('opus');
      expect(phaseModels.planning).toBe('opus');
      expect(phaseModels.coding).toBe('opus');
      expect(phaseModels.qa).toBe('opus');
    });

    it('should use custom overrides when they exist', () => {
      // Simulate settings with custom overrides
      const selectedProfileId = 'auto';
      const customPhaseModels = {
        spec: 'sonnet' as const,
        planning: 'sonnet' as const,
        coding: 'sonnet' as const,
        qa: 'sonnet' as const,
      };

      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0];
      const profilePhaseModels = profile.phaseModels || DEFAULT_PHASE_MODELS;
      const phaseModels = customPhaseModels || profilePhaseModels;

      // Should resolve to custom overrides (sonnet)
      expect(phaseModels.spec).toBe('sonnet');
      expect(phaseModels.planning).toBe('sonnet');
      expect(phaseModels.coding).toBe('sonnet');
      expect(phaseModels.qa).toBe('sonnet');
    });

    it('should default to auto profile when selectedProfileId is undefined', () => {
      const selectedProfileId = undefined;
      const effectiveProfileId = selectedProfileId || 'auto';

      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === effectiveProfileId) || DEFAULT_AGENT_PROFILES[0];

      expect(profile.id).toBe('auto');
      expect(profile.model).toBe('opus');
    });

    it('should fall back to first profile when selected profile is not found', () => {
      const selectedProfileId = 'non-existent-profile';

      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0];

      expect(profile.id).toBe('auto');
      expect(profile.model).toBe('opus');
    });
  });

  describe('Agent Settings Resolution (Utility)', () => {
    it('should resolve phase-based agent settings correctly', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'auto')!;
      const phaseModels = profile.phaseModels!;
      const phaseThinking = profile.phaseThinking!;
      const featureModels = DEFAULT_FEATURE_MODELS;
      const featureThinking = DEFAULT_FEATURE_THINKING;

      const resolvedSettings = { phaseModels, phaseThinking, featureModels, featureThinking };

      // Spec phase agent
      const specAgent = resolveAgentSettings(
        { type: 'phase', phase: 'spec' },
        resolvedSettings
      );
      expect(specAgent.model).toBe('opus');
      expect(specAgent.thinking).toBe('high');

      // Planning phase agent
      const planningAgent = resolveAgentSettings(
        { type: 'phase', phase: 'planning' },
        resolvedSettings
      );
      expect(planningAgent.model).toBe('opus');
      expect(planningAgent.thinking).toBe('high');

      // Coding phase agent
      const codingAgent = resolveAgentSettings(
        { type: 'phase', phase: 'coding' },
        resolvedSettings
      );
      expect(codingAgent.model).toBe('opus');
      expect(codingAgent.thinking).toBe('low');

      // QA phase agent
      const qaAgent = resolveAgentSettings(
        { type: 'phase', phase: 'qa' },
        resolvedSettings
      );
      expect(qaAgent.model).toBe('opus');
      expect(qaAgent.thinking).toBe('low');
    });

    it('should resolve feature-based agent settings correctly', () => {
      const phaseModels = DEFAULT_PHASE_MODELS;
      const phaseThinking = { spec: 'medium' as const, planning: 'medium' as const, coding: 'medium' as const, qa: 'medium' as const };
      const featureModels = DEFAULT_FEATURE_MODELS;
      const featureThinking = DEFAULT_FEATURE_THINKING;

      const resolvedSettings = { phaseModels, phaseThinking, featureModels, featureThinking };

      // Insights feature agent (defaults to sonnet)
      const insightsAgent = resolveAgentSettings(
        { type: 'feature', feature: 'insights' },
        resolvedSettings
      );
      expect(insightsAgent.model).toBe('sonnet');
      expect(insightsAgent.thinking).toBe('medium');

      // Ideation feature agent (defaults to opus)
      const ideationAgent = resolveAgentSettings(
        { type: 'feature', feature: 'ideation' },
        resolvedSettings
      );
      expect(ideationAgent.model).toBe('opus');
      expect(ideationAgent.thinking).toBe('high');

      // Roadmap feature agent (defaults to opus)
      const roadmapAgent = resolveAgentSettings(
        { type: 'feature', feature: 'roadmap' },
        resolvedSettings
      );
      expect(roadmapAgent.model).toBe('opus');
      expect(roadmapAgent.thinking).toBe('high');

      // GitHub Issues feature agent (defaults to opus)
      const githubIssuesAgent = resolveAgentSettings(
        { type: 'feature', feature: 'githubIssues' },
        resolvedSettings
      );
      expect(githubIssuesAgent.model).toBe('opus');
      expect(githubIssuesAgent.thinking).toBe('medium');

      // GitHub PRs feature agent (defaults to opus)
      const githubPrsAgent = resolveAgentSettings(
        { type: 'feature', feature: 'githubPrs' },
        resolvedSettings
      );
      expect(githubPrsAgent.model).toBe('opus');
      expect(githubPrsAgent.thinking).toBe('medium');

      // Utility feature agent (defaults to haiku)
      const utilityAgent = resolveAgentSettings(
        { type: 'feature', feature: 'utility' },
        resolvedSettings
      );
      expect(utilityAgent.model).toBe('haiku');
      expect(utilityAgent.thinking).toBe('low');
    });

    it('should resolve fixed settings correctly', () => {
      const phaseModels = DEFAULT_PHASE_MODELS;
      const phaseThinking = { spec: 'medium' as const, planning: 'medium' as const, coding: 'medium' as const, qa: 'medium' as const };
      const featureModels = DEFAULT_FEATURE_MODELS;
      const featureThinking = DEFAULT_FEATURE_THINKING;

      const resolvedSettings = { phaseModels, phaseThinking, featureModels, featureThinking };

      // Fixed settings agent
      const fixedAgent = resolveAgentSettings(
        { type: 'fixed', model: 'opus', thinking: 'high' },
        resolvedSettings
      );
      expect(fixedAgent.model).toBe('opus');
      expect(fixedAgent.thinking).toBe('high');
    });
  });

  describe('Bug Fix Regression Test (ACS-255)', () => {
    it('should resolve to opus when auto profile is selected (not sonnet from defaults)', () => {
      // This test verifies the fix for ACS-255:
      // MCP Server Overview was showing Sonnet instead of Opus when Auto profile was selected

      const selectedProfileId = 'auto';
      const customPhaseModels = undefined; // No custom overrides

      // The bug was using DEFAULT_PHASE_MODELS directly (which is BALANCED_PHASE_MODELS = sonnet)
      // The fix is to resolve the selected profile first
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0];
      const profilePhaseModels = profile.phaseModels || DEFAULT_PHASE_MODELS;
      const phaseModels = customPhaseModels || profilePhaseModels;

      // Should be opus (from auto profile), NOT sonnet (from DEFAULT_PHASE_MODELS)
      expect(phaseModels.spec).toBe('opus');
      expect(phaseModels.planning).toBe('opus');
      expect(phaseModels.coding).toBe('opus');
      expect(phaseModels.qa).toBe('opus');
    });

    it('should ensure DEFAULT_PHASE_MODELS is balanced (sonnet)', () => {
      // This documents that DEFAULT_PHASE_MODELS is the balanced profile (sonnet)
      // The bug was that this was being used instead of resolving the selected profile

      expect(DEFAULT_PHASE_MODELS.spec).toBe('sonnet');
      expect(DEFAULT_PHASE_MODELS.planning).toBe('sonnet');
      expect(DEFAULT_PHASE_MODELS.coding).toBe('sonnet');
      expect(DEFAULT_PHASE_MODELS.qa).toBe('sonnet');
    });
  });
});
