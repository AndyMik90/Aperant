import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveProvider } from '../../hooks/useActiveProvider';
import { getProviderModelLabel } from '../../../shared/utils/model-display';
import { Brain, Scale, Zap, Check, Sparkles, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  DEFAULT_AGENT_PROFILES,
  AVAILABLE_MODELS,
  THINKING_LEVELS,
  DEFAULT_PHASE_MODELS,
  DEFAULT_PHASE_THINKING,
  PHASE_KEYS,
  getProviderPreset
} from '../../../shared/constants';
import { useSettingsStore, saveSettings, saveProviderAgentConfig } from '../../stores/settings-store';
import { MultiProviderModelSelect } from './MultiProviderModelSelect';
import { ThinkingLevelSelect } from './ThinkingLevelSelect';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import type { AgentProfile, PhaseModelConfig, PhaseThinkingConfig, ThinkingLevel } from '../../../shared/types/settings';
import type { BuiltinProvider } from '../../../shared/types/provider-account';

/**
 * Icon mapping for agent profile icons
 */
const iconMap: Record<string, React.ElementType> = {
  Brain,
  Scale,
  Zap,
  Sparkles,
};

/**
 * Agent Profile Settings component
 * Displays preset agent profiles for quick model/thinking level configuration
 * All presets show phase configuration for full customization
 */
interface AgentProfileSettingsProps {
  provider?: BuiltinProvider;
}

export function AgentProfileSettings({ provider }: AgentProfileSettingsProps) {
  const { t } = useTranslation('settings');
  const settings = useSettingsStore((state) => state.settings);
  const { provider: activeProvider } = useActiveProvider();
  // Read per-provider config with fallback to global
  const providerConfig = provider ? settings.providerAgentConfig?.[provider] : undefined;
  const selectedProfileId = providerConfig?.selectedAgentProfile ?? settings.selectedAgentProfile ?? 'auto';
  const [showPhaseConfig, setShowPhaseConfig] = useState(true);

  // Find the selected profile
  const selectedProfile = useMemo(() =>
    DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0],
    [selectedProfileId]
  );

  // Get profile's default phase config - provider-aware
  const providerPreset = provider
    ? getProviderPreset(provider, selectedProfileId)
    : null;
  const profilePhaseModels = providerPreset?.phaseModels ?? selectedProfile.phaseModels ?? DEFAULT_PHASE_MODELS;
  const profilePhaseThinking = providerPreset?.phaseThinking ?? selectedProfile.phaseThinking ?? DEFAULT_PHASE_THINKING;

  // Get current phase config from settings (custom) or fall back to profile defaults
  // When viewing a provider tab, skip global fallback — use provider-specific config or preset defaults
  const currentPhaseModels: PhaseModelConfig = provider
    ? (providerConfig?.customPhaseModels ?? profilePhaseModels)
    : (settings.customPhaseModels ?? profilePhaseModels);
  const currentPhaseThinking: PhaseThinkingConfig = provider
    ? (providerConfig?.customPhaseThinking ?? profilePhaseThinking)
    : (settings.customPhaseThinking ?? profilePhaseThinking);

  /**
   * Check if current config differs from the selected profile's defaults
   */
  const hasCustomConfig = useMemo((): boolean => {
    const customModels = provider ? providerConfig?.customPhaseModels : settings.customPhaseModels;
    const customThinking = provider ? providerConfig?.customPhaseThinking : settings.customPhaseThinking;
    if (!customModels && !customThinking) {
      return false; // No custom settings, using profile defaults
    }
    return PHASE_KEYS.some(
      phase =>
        currentPhaseModels[phase] !== profilePhaseModels[phase] ||
        currentPhaseThinking[phase] !== profilePhaseThinking[phase]
    );
  }, [provider, providerConfig, settings.customPhaseModels, settings.customPhaseThinking, currentPhaseModels, currentPhaseThinking, profilePhaseModels, profilePhaseThinking]);

  const handleSelectProfile = async (profileId: string) => {
    const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === profileId);
    if (!profile) return;

    if (provider) {
      // When selecting on a provider tab, deactivate cross-provider mode
      await saveProviderAgentConfig(provider, {
        selectedAgentProfile: profileId,
        customPhaseModels: undefined,
        customPhaseThinking: undefined,
      });
      // Deactivate cross-provider mode when a provider profile is selected
      if (settings.customMixedProfileActive) {
        await saveSettings({ customMixedProfileActive: false });
      }
    } else {
      await saveSettings({
        selectedAgentProfile: profileId,
        customMixedProfileActive: false,
        customPhaseModels: undefined,
        customPhaseThinking: undefined,
      });
    }
  };

  const handlePhaseModelChange = async (phase: keyof PhaseModelConfig, value: string) => {
    // Save as custom config (deviating from preset)
    const newPhaseModels = { ...currentPhaseModels, [phase]: value };
    if (provider) {
      await saveProviderAgentConfig(provider, { customPhaseModels: newPhaseModels });
    } else {
      await saveSettings({ customPhaseModels: newPhaseModels });
    }
  };

  const handlePhaseThinkingChange = async (phase: keyof PhaseThinkingConfig, value: ThinkingLevel) => {
    // Save as custom config (deviating from preset)
    const newPhaseThinking = { ...currentPhaseThinking, [phase]: value };
    if (provider) {
      await saveProviderAgentConfig(provider, { customPhaseThinking: newPhaseThinking });
    } else {
      await saveSettings({ customPhaseThinking: newPhaseThinking });
    }
  };

  const handleResetToProfileDefaults = async () => {
    // Reset to the selected profile's defaults
    if (provider) {
      await saveProviderAgentConfig(provider, {
        customPhaseModels: undefined,
        customPhaseThinking: undefined,
      });
    } else {
      await saveSettings({
        customPhaseModels: undefined,
        customPhaseThinking: undefined,
      });
    }
  };

  /**
   * Get human-readable model label
   */
  const getModelLabel = (modelValue: string): string => {
    const resolvedProvider = provider ?? activeProvider;
    if (resolvedProvider) {
      return getProviderModelLabel(modelValue, resolvedProvider);
    }
    const model = AVAILABLE_MODELS.find((m) => m.value === modelValue);
    return model?.label || modelValue;
  };

  /**
   * Get human-readable thinking level label
   */
  const getThinkingLabel = (thinkingValue: string): string => {
    const level = THINKING_LEVELS.find((l) => l.value === thinkingValue);
    return level?.label || thinkingValue;
  };

  /**
   * Render a single profile card
   */
  const renderProfileCard = (profile: AgentProfile) => {
    const isSelected = selectedProfileId === profile.id;
    const isCustomized = isSelected && hasCustomConfig;
    const Icon = iconMap[profile.icon || 'Brain'] || Brain;

    // Get provider-specific preset for badge display
    const cardProviderPreset = provider ? getProviderPreset(provider, profile.id) : null;
    const displayModel = cardProviderPreset?.primaryModel ?? profile.model;
    const displayThinking = cardProviderPreset?.primaryThinking ?? profile.thinkingLevel;

    return (
      <button
        key={profile.id}
        onClick={() => handleSelectProfile(profile.id)}
        className={cn(
          'relative w-full rounded-lg border p-4 text-start transition-all duration-200',
          'hover:border-primary/50 hover:shadow-sm',
          isSelected
            ? 'border-primary bg-primary/5'
            : 'border-border bg-card'
        )}
      >
        {/* Selected indicator */}
        {isSelected && (
          <div className="absolute end-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
            <Check className="h-3 w-3 text-primary-foreground" />
          </div>
        )}

        {/* Profile content */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg shrink-0',
              isSelected ? 'bg-primary/10' : 'bg-muted'
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5',
                isSelected ? 'text-primary' : 'text-muted-foreground'
              )}
            />
          </div>

          <div className="flex-1 min-w-0 pe-6">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm text-foreground">{profile.name}</h3>
              {isCustomized && (
                <span className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400">
                  {t('agentProfile.customized')}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
              {profile.description}
            </p>

            {/* Model and thinking level badges */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {displayModel === '' ? (
                <span className="inline-flex items-center rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  {(() => {
                    const customModels = providerConfig?.customPhaseModels;
                    if (customModels) {
                      const firstConfigured = PHASE_KEYS.find(k => customModels[k]);
                      if (firstConfigured) return customModels[firstConfigured];
                    }
                    return t('agentProfile.ollamaNotConfigured');
                  })()}
                </span>
              ) : (
                <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {getModelLabel(displayModel)}
                </span>
              )}
              <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {getThinkingLabel(displayThinking)} {t('agentProfile.thinking')}
              </span>
            </div>
          </div>
        </div>
      </button>
    );
  };

  return (
      <div className="space-y-4">
        {/* Description */}
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            {t('agentProfile.profilesInfo')}
          </p>
        </div>

        {/* Profile cards - 2 column grid on larger screens */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {DEFAULT_AGENT_PROFILES.map(renderProfileCard)}
        </div>

        {/* Phase Configuration - collapsible card, shared between all profiles */}
        <div className="mt-6 rounded-lg border border-border bg-card">
          {/* Header - Collapsible */}
          <button
            type="button"
            onClick={() => setShowPhaseConfig(!showPhaseConfig)}
            className="flex w-full items-center justify-between p-4 text-start hover:bg-muted/50 transition-colors rounded-t-lg"
          >
            <div>
              <h4 className="font-medium text-sm text-foreground">{t('agentProfile.phaseConfiguration')}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('agentProfile.phaseConfigurationDescription')}
              </p>
            </div>
            {showPhaseConfig ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {/* Phase Configuration Content */}
          {showPhaseConfig && (
            <div className="border-t border-border p-4 space-y-4">
              {/* Reset button - shown when customized */}
              {hasCustomConfig && (
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetToProfileDefaults}
                    className="text-xs h-7"
                  >
                    <RotateCcw className="h-3 w-3 me-1.5" />
                    {t('agentProfile.resetToProfileDefaults', { profile: selectedProfile.name })}
                  </Button>
                </div>
              )}

              {/* Standard per-provider phase config */}
              <div className="space-y-4">
                {PHASE_KEYS.map((phase) => (
                  <div key={phase} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium text-foreground">
                        {t(`agentProfile.phases.${phase}.label`)}
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {t(`agentProfile.phases.${phase}.description`)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Model Select */}
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{t('agentProfile.model')}</Label>
                        <MultiProviderModelSelect
                          value={currentPhaseModels[phase]}
                          onChange={(value) => handlePhaseModelChange(phase, value)}
                          filterProvider={provider}
                        />
                      </div>
                      {/* Thinking Level Select (provider-aware) */}
                      <ThinkingLevelSelect
                        value={currentPhaseThinking[phase]}
                        onChange={(value) => handlePhaseThinkingChange(phase, value as ThinkingLevel)}
                        modelValue={currentPhaseModels[phase]}
                        provider={provider ?? 'anthropic'}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Info note */}
              <p className="text-[10px] text-muted-foreground mt-4 pt-3 border-t border-border">
                {t('agentProfile.phaseConfigNote')}
              </p>
            </div>
          )}
        </div>

      </div>
  );
}
