import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Scale, Zap, Check, Sparkles, Settings2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DEFAULT_AGENT_PROFILES } from '../../../shared/constants';
import { useSettingsStore, saveSettings } from '../../stores/settings-store';
import { SettingsSection } from './SettingsSection';
import { ComplexityRoutingSettings } from './ComplexityRoutingSettings';
import type { AgentProfile } from '../../../shared/types/settings';

/**
 * Icon mapping for agent profile icons
 */
const iconMap: Record<string, React.ElementType> = {
  Brain,
  Scale,
  Zap,
  Sparkles,
  Settings2
};

/**
 * Agent Profile Settings component
 * Displays preset agent profiles for quick model/thinking level configuration
 */
export function AgentProfileSettings() {
  const { t } = useTranslation('settings');
  const settings = useSettingsStore((state) => state.settings);
  const selectedProfileId = settings.selectedAgentProfile || 'auto';

  // Find the selected profile
  const selectedProfile = useMemo(() =>
    DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0],
    [selectedProfileId]
  );

  const handleSelectProfile = async (profileId: string) => {
    const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === profileId);
    if (!profile) return;

    const success = await saveSettings({
      selectedAgentProfile: profileId
    });
    if (!success) {
      console.error('Failed to save agent profile selection');
      return;
    }
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
          'relative w-full rounded-lg border p-4 text-left transition-all duration-200',
          'hover:border-primary/50 hover:shadow-sm',
          isSelected
            ? 'border-primary bg-primary/5'
            : 'border-border bg-card'
        )}
      >
        {/* Selected indicator */}
        {isSelected && (
          <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
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

          <div className="flex-1 min-w-0 pr-6">
            <h3 className="font-medium text-sm text-foreground">{profile.name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
              {profile.description}
            </p>
          </div>
        </div>
      </button>
    );
  };

  return (
    <>
      <SettingsSection
        title={t('agentProfile.title')}
        description={t('agentProfile.sectionDescription')}
      >
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
        </div>
      </SettingsSection>

      {/* Complexity-Based Routing Settings */}
      <ComplexityRoutingSettings />
    </>
  );
}
