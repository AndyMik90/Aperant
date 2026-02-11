/**
 * AgentProfileSelector - Reusable component for selecting agent profile in forms
 *
 * Provides a dropdown for quick profile selection (Auto, Complex, Balanced, Quick)
 * with an inline "Custom" option that reveals model and thinking level selects.
 * The "Auto" profile shows per-phase model configuration.
 *
 * Used in TaskCreationWizard and TaskEditDialog.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Scale, Zap, Sliders, Sparkles, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { Label } from './ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import {
  DEFAULT_AGENT_PROFILES,
  AVAILABLE_MODELS,
  THINKING_LEVELS,
  DEFAULT_PHASE_MODELS,
  DEFAULT_PHASE_THINKING,
  ADAPTIVE_THINKING_MODELS
} from '../../shared/constants';
import type { ModelType, ThinkingLevel } from '../../shared/types';
import type { PhaseModelConfig, PhaseThinkingConfig } from '../../shared/types/settings';
import { cn } from '../lib/utils';

interface AgentProfileSelectorProps {
  /** Currently selected profile ID ('auto', 'complex', 'balanced', 'quick', or 'custom') */
  profileId: string;
  /** Current model value (fallback for non-auto profiles) */
  model: ModelType | '';
  /** Current thinking level value (fallback for non-auto profiles) */
  thinkingLevel: ThinkingLevel | '';
  /** Phase model configuration (for auto profile) */
  phaseModels?: PhaseModelConfig;
  /** Phase thinking configuration (for auto profile) */
  phaseThinking?: PhaseThinkingConfig;
  /** Called when profile selection changes */
  onProfileChange: (profileId: string, model: ModelType, thinkingLevel: ThinkingLevel) => void;
  /** Called when model changes (in custom mode) */
  onModelChange: (model: ModelType) => void;
  /** Called when thinking level changes (in custom mode) */
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  /** Called when phase models change (in auto mode) */
  onPhaseModelsChange?: (phaseModels: PhaseModelConfig) => void;
  /** Called when phase thinking changes (in auto mode) */
  onPhaseThinkingChange?: (phaseThinking: PhaseThinkingConfig) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
}

const iconMap: Record<string, React.ElementType> = {
  Brain,
  Scale,
  Zap,
  Sparkles
};

// Phase label translation keys
const PHASE_LABEL_KEYS: Record<keyof PhaseModelConfig, { label: string; description: string }> = {
  spec: { label: 'agentProfile.phases.spec.label', description: 'agentProfile.phases.spec.description' },
  planning: { label: 'agentProfile.phases.planning.label', description: 'agentProfile.phases.planning.description' },
  coding: { label: 'agentProfile.phases.coding.label', description: 'agentProfile.phases.coding.description' },
  qa: { label: 'agentProfile.phases.qa.label', description: 'agentProfile.phases.qa.description' }
};

export function AgentProfileSelector({
  profileId,
  model,
  thinkingLevel,
  phaseModels,
  phaseThinking,
  onProfileChange,
  onModelChange,
  onThinkingLevelChange,
  onPhaseModelsChange,
  onPhaseThinkingChange,
  disabled
}: AgentProfileSelectorProps) {
  const { t } = useTranslation('settings');
  const [showPhaseDetails, setShowPhaseDetails] = useState(false);

  const isCustom = profileId === 'custom';
  const _isAuto = profileId === 'auto';

  // Use provided phase configs or defaults
  const currentPhaseModels = phaseModels || DEFAULT_PHASE_MODELS;
  const currentPhaseThinking = phaseThinking || DEFAULT_PHASE_THINKING;

  const handleProfileSelect = (selectedId: string) => {
    if (selectedId === 'custom') {
      // Keep current model/thinking level, just mark as custom
      onProfileChange('custom', model as ModelType || 'sonnet', thinkingLevel as ThinkingLevel || 'medium');
    } else {
      // Select preset profile - all profiles now have phase configs
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === selectedId);
      if (profile) {
        onProfileChange(profile.id, profile.model, profile.thinkingLevel);
        // Initialize phase configs with profile defaults if callbacks provided
        if (onPhaseModelsChange && profile.phaseModels) {
          onPhaseModelsChange(profile.phaseModels);
        }
        if (onPhaseThinkingChange && profile.phaseThinking) {
          onPhaseThinkingChange(profile.phaseThinking);
        }
      }
    }
  };

  const handlePhaseModelChange = (phase: keyof PhaseModelConfig, value: ModelType) => {
    if (onPhaseModelsChange) {
      onPhaseModelsChange({
        ...currentPhaseModels,
        [phase]: value
      });
    }
  };

  const handlePhaseThinkingChange = (phase: keyof PhaseThinkingConfig, value: ThinkingLevel) => {
    if (onPhaseThinkingChange) {
      onPhaseThinkingChange({
        ...currentPhaseThinking,
        [phase]: value
      });
    }
  };

  // Get profile display info
  const getProfileDisplay = () => {
    if (isCustom) {
      return {
        icon: Sliders,
        label: t('agentProfile.customConfiguration'),
        description: t('agentProfile.customDescription')
      };
    }
    const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === profileId);
    if (profile) {
      return {
        icon: iconMap[profile.icon || 'Scale'] || Scale,
        label: profile.name,
        description: profile.description
      };
    }
    // Default to auto profile (the actual default)
    return {
      icon: Sparkles,
      label: 'Auto (Optimized)',
      description: 'Uses Opus across all phases with optimized thinking levels'
    };
  };

  const display = getProfileDisplay();

  return (
    <div className="space-y-4">
      {/* Agent Profile Selection */}
      <div className="space-y-2">
        <Label htmlFor="agent-profile" className="text-sm font-medium text-foreground">
          {t('agentProfile.label')}
        </Label>
        <Select
          value={profileId}
          onValueChange={handleProfileSelect}
          disabled={disabled}
        >
          <SelectTrigger id="agent-profile" className="h-10">
            <SelectValue>
              <div className="flex items-center gap-2">
                <display.icon className="h-4 w-4" />
                <span>{display.label}</span>
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DEFAULT_AGENT_PROFILES.map((profile) => {
              const ProfileIcon = iconMap[profile.icon || 'Scale'] || Scale;
              const modelLabel = AVAILABLE_MODELS.find(m => m.value === profile.model)?.label;
              return (
                <SelectItem key={profile.id} value={profile.id}>
                  <div className="flex items-center gap-2">
                    <ProfileIcon className="h-4 w-4 shrink-0" />
                    <div>
                      <span className="font-medium">{profile.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({modelLabel} + {profile.thinkingLevel})
                      </span>
                    </div>
                  </div>
                </SelectItem>
              );
            })}
            <SelectItem value="custom">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 shrink-0" />
                <div>
                  <span className="font-medium">{t('agentProfile.custom')}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({t('agentProfile.customDescription')})
                  </span>
                </div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {display.description}
        </p>
      </div>

      {/* Phase Configuration - shown for all preset profiles */}
      {!isCustom && (
        <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
          {/* Clickable Header */}
          <button
            type="button"
            onClick={() => setShowPhaseDetails(!showPhaseDetails)}
            className={cn(
              'flex w-full items-center justify-between p-4 text-left',
              'hover:bg-muted/50 transition-colors',
              !disabled && 'cursor-pointer'
            )}
            disabled={disabled}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-foreground">{t('agentProfile.phaseConfiguration')}</span>
              {!showPhaseDetails && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Pencil className="h-3 w-3" />
                  <span>{t('agentProfile.clickToCustomize')}</span>
                </span>
              )}
            </div>
            {showPhaseDetails ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {/* Compact summary when collapsed */}
          {!showPhaseDetails && (
            <div className="px-4 pb-4 -mt-1">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {(Object.keys(PHASE_LABEL_KEYS) as Array<keyof PhaseModelConfig>).map((phase) => {
                  const modelLabel = AVAILABLE_MODELS.find(m => m.value === currentPhaseModels[phase])?.label?.replace('Claude ', '') || currentPhaseModels[phase];
                  return (
                    <div key={phase} className="flex items-center justify-between rounded bg-background/50 px-2 py-1">
                      <span className="text-muted-foreground">{t(PHASE_LABEL_KEYS[phase].label)}:</span>
                      <span className="font-medium">{modelLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Detailed Phase Configuration */}
          {showPhaseDetails && (
            <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
              {(Object.keys(PHASE_LABEL_KEYS) as Array<keyof PhaseModelConfig>).map((phase) => (
                <div key={phase} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-foreground">
                      {t(PHASE_LABEL_KEYS[phase].label)}
                    </Label>
                    <span className="text-[10px] text-muted-foreground">
                      {t(PHASE_LABEL_KEYS[phase].description)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">{t('agentProfile.model')}</Label>
                      <Select
                        value={currentPhaseModels[phase]}
                        onValueChange={(value) => handlePhaseModelChange(phase, value as ModelType)}
                        disabled={disabled}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABLE_MODELS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-[10px] text-muted-foreground">{t('agentProfile.thinking')}</Label>
                        {ADAPTIVE_THINKING_MODELS.includes(currentPhaseModels[phase]) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary cursor-help">
                                {t('agentProfile.adaptiveThinking.badge')}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p className="text-xs">{t('agentProfile.adaptiveThinking.tooltip')}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <Select
                        value={currentPhaseThinking[phase]}
                        onValueChange={(value) => handlePhaseThinkingChange(phase, value as ThinkingLevel)}
                        disabled={disabled}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {THINKING_LEVELS.map((level) => (
                            <SelectItem key={level.value} value={level.value}>
                              {level.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Custom Configuration (shown only when custom is selected) */}
      {isCustom && (
        <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
          {/* Model Selection */}
          <div className="space-y-2">
            <Label htmlFor="custom-model" className="text-xs font-medium text-muted-foreground">
              {t('agentProfile.model')}
            </Label>
            <Select
              value={model}
              onValueChange={(value) => onModelChange(value as ModelType)}
              disabled={disabled}
            >
              <SelectTrigger id="custom-model" className="h-9">
                <SelectValue placeholder={t('agentProfile.selectModel')} />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Thinking Level Selection */}
          <div className="space-y-2">
            <Label htmlFor="custom-thinking" className="text-xs font-medium text-muted-foreground">
              {t('agentProfile.thinking')}
            </Label>
            <Select
              value={thinkingLevel}
              onValueChange={(value) => onThinkingLevelChange(value as ThinkingLevel)}
              disabled={disabled}
            >
              <SelectTrigger id="custom-thinking" className="h-9">
                <SelectValue placeholder={t('agentProfile.selectThinkingLevel')} />
              </SelectTrigger>
              <SelectContent>
                {THINKING_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    <div className="flex items-center gap-2">
                      <span>{level.label}</span>
                      <span className="text-xs text-muted-foreground">
                        - {level.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
