/**
 * Agent Settings Resolution Hook
 *
 * Provides centralized logic for resolving agent model and thinking settings
 * based on the selected agent profile, custom overrides, and defaults.
 *
 * Resolution order for phase settings:
 * 1. Custom phase overrides (if user has customized)
 * 2. Selected profile's phaseModels/phaseThinking
 * 3. DEFAULT_PHASE_MODELS/DEFAULT_PHASE_THINKING (fallback)
 *
 * Feature settings are not tied to profiles and use:
 * 1. Custom feature overrides (if user has customized)
 * 2. DEFAULT_FEATURE_MODELS/DEFAULT_FEATURE_THINKING (fallback)
 */

import { useMemo } from 'react';
import {
  DEFAULT_AGENT_PROFILES,
  DEFAULT_PHASE_MODELS,
  DEFAULT_PHASE_THINKING,
  DEFAULT_FEATURE_MODELS,
  DEFAULT_FEATURE_THINKING,
} from '../../shared/constants/models';
import type {
  AppSettings,
  PhaseModelConfig,
  PhaseThinkingConfig,
  FeatureModelConfig,
  FeatureThinkingConfig,
  ModelTypeShort,
  ThinkingLevel,
} from '../../shared/types/settings';

/**
 * Resolved agent settings configuration
 * Contains all the resolved model and thinking settings for agents
 */
export interface ResolvedAgentSettings {
  /** Phase model settings (spec, planning, coding, qa) */
  phaseModels: PhaseModelConfig;
  /** Phase thinking level settings */
  phaseThinking: PhaseThinkingConfig;
  /** Feature model settings (insights, ideation, roadmap, githubIssues, githubPrs, utility) */
  featureModels: FeatureModelConfig;
  /** Feature thinking level settings */
  featureThinking: FeatureThinkingConfig;
}

/**
 * Agent settings source configuration
 * Determines where an agent's model and thinking settings come from
 */
export type AgentSettingsSource =
  | { type: 'phase'; phase: 'spec' | 'planning' | 'coding' | 'qa' }
  | { type: 'feature'; feature: 'insights' | 'ideation' | 'roadmap' | 'githubIssues' | 'githubPrs' | 'utility' }
  | { type: 'fixed'; model: ModelTypeShort; thinking: ThinkingLevel };

/**
 * Resolved model and thinking for an agent
 */
export interface AgentModelConfig {
  model: ModelTypeShort;
  thinking: ThinkingLevel;
}

/**
 * Hook to resolve agent settings based on the selected profile and custom overrides
 *
 * @param settings - The application settings containing selected profile and custom overrides
 * @returns Resolved agent settings with proper profile resolution
 *
 * @example
 * ```tsx
 * const { phaseModels, phaseThinking, featureModels, featureThinking } = useResolvedAgentSettings(settings);
 * ```
 */
export function useResolvedAgentSettings(settings: AppSettings): ResolvedAgentSettings {
  return useMemo(() => {
    // Get selected profile ID, default to 'auto'
    const selectedProfileId = settings.selectedAgentProfile || 'auto';

    // Find the selected profile
    const selectedProfile = DEFAULT_AGENT_PROFILES.find((p) => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0];

    // Profile defaults (used when no custom overrides exist)
    const profilePhaseModels = selectedProfile.phaseModels || DEFAULT_PHASE_MODELS;
    const profilePhaseThinking = selectedProfile.phaseThinking || DEFAULT_PHASE_THINKING;

    // Effective phase config: custom overrides take priority over profile defaults
    const phaseModels = settings.customPhaseModels || profilePhaseModels;
    const phaseThinking = settings.customPhaseThinking || profilePhaseThinking;

    // Feature settings (not tied to profiles, use custom or defaults)
    const featureModels = settings.featureModels || DEFAULT_FEATURE_MODELS;
    const featureThinking = settings.featureThinking || DEFAULT_FEATURE_THINKING;

    return {
      phaseModels,
      phaseThinking,
      featureModels,
      featureThinking,
    };
  }, [
    settings.selectedAgentProfile,
    settings.customPhaseModels,
    settings.customPhaseThinking,
    settings.featureModels,
    settings.featureThinking,
  ]);
}

/**
 * Resolves model and thinking settings for a specific agent based on its settings source
 *
 * @param settingsSource - The agent's settings source (phase, feature, or fixed)
 * @param resolvedSettings - The resolved agent settings from useResolvedAgentSettings
 * @returns Model and thinking configuration for the agent
 *
 * @example
 * ```tsx
 * const resolvedSettings = useResolvedAgentSettings(settings);
 * const { model, thinking } = resolveAgentSettings(agentConfig.settingsSource, resolvedSettings);
 * ```
 */
export function resolveAgentSettings(
  settingsSource: AgentSettingsSource,
  resolvedSettings: ResolvedAgentSettings
): AgentModelConfig {
  if (settingsSource.type === 'phase') {
    return {
      model: resolvedSettings.phaseModels[settingsSource.phase],
      thinking: resolvedSettings.phaseThinking[settingsSource.phase],
    };
  } else if (settingsSource.type === 'feature') {
    return {
      model: resolvedSettings.featureModels[settingsSource.feature],
      thinking: resolvedSettings.featureThinking[settingsSource.feature],
    };
  } else {
    // Fixed settings
    return {
      model: settingsSource.model,
      thinking: settingsSource.thinking,
    };
  }
}
