import { Brain, Scale, Zap, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { DEFAULT_AGENT_PROFILES, AVAILABLE_MODELS, THINKING_LEVELS } from '../../shared/constants';
import { useSettingsStore, saveSettings } from '../stores/settings-store';
import type { AgentProfile } from '../../shared/types/settings';

/**
 * Icon mapping for agent profile icons
 */
const iconMap: Record<string, React.ElementType> = {
  Brain,
  Scale,
  Zap
};

/**
 * Agent Profiles view component
 * Displays preset agent profiles for quick model/thinking level configuration
 */
export function AgentProfiles() {
  const { t } = useTranslation('settings');
  const settings = useSettingsStore((state) => state.settings);
  const selectedProfileId = settings.selectedAgentProfile || 'auto';

  const handleSelectProfile = async (profileId: string) => {
    await saveSettings({ selectedAgentProfile: profileId });
  };

  /**
   * Get human-readable model label
   */
  const getModelLabel = (modelValue: string): string => {
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
    const Icon = iconMap[profile.icon || 'Brain'] || Brain;

    return (
      <button
        key={profile.id}
        onClick={() => handleSelectProfile(profile.id)}
        className={cn(
          'relative w-full rounded-xl border p-6 text-left transition-all duration-200',
          'hover:border-primary/50 hover:shadow-md',
          isSelected
            ? 'border-primary bg-primary/5 shadow-sm'
            : 'border-border bg-card'
        )}
      >
        {/* Selected indicator */}
        {isSelected && (
          <div className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-primary">
            <Check className="h-4 w-4 text-primary-foreground" />
          </div>
        )}

        {/* Profile content */}
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-lg',
              isSelected ? 'bg-primary/10' : 'bg-muted'
            )}
          >
            <Icon
              className={cn(
                'h-6 w-6',
                isSelected ? 'text-primary' : 'text-muted-foreground'
              )}
            />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground">{profile.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile.description}
            </p>

            {/* Model and thinking level badges */}
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {getModelLabel(profile.model)}
              </span>
              <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {getThinkingLabel(profile.thinkingLevel)} {t('agentProfile.thinkingSuffix')}
              </span>
            </div>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t('agentProfile.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('agentProfile.subtitle')}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Description */}
            <div className="rounded-lg bg-muted/50 p-4 mb-6">
              <p className="text-sm text-muted-foreground">
                {t('agentProfile.profilesInfo')}
              </p>
          </div>

          {/* Profile cards */}
          <div className="space-y-3">
            {DEFAULT_AGENT_PROFILES.map(renderProfileCard)}
          </div>
        </div>
      </div>
    </div>
  );
}
