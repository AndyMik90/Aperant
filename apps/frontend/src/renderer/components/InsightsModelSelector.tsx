import { useState } from 'react';
import { Brain, Scale, Zap, Sparkles, Sliders, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel
} from './ui/dropdown-menu';
import { DEFAULT_AGENT_PROFILES, AVAILABLE_MODELS } from '../../shared/constants';
import type { InsightsModelConfig } from '../../shared/types';
import { CustomModelModal } from './CustomModelModal';

interface InsightsModelSelectorProps {
  currentConfig?: InsightsModelConfig;
  onConfigChange: (config: InsightsModelConfig) => void;
  disabled?: boolean;
}

const iconMap: Record<string, React.ElementType> = {
  Brain,
  Scale,
  Zap,
  Sparkles
};

export function InsightsModelSelector({
  currentConfig,
  onConfigChange,
  disabled
}: InsightsModelSelectorProps) {
  const { t } = useTranslation(['common']);
  const [showCustomModal, setShowCustomModal] = useState(false);

  // Default to 'balanced' if no config, or if 'auto' profile was selected (not applicable for insights)
  const rawProfileId = currentConfig?.profileId || 'balanced';
  const selectedProfileId = rawProfileId === 'auto' ? 'balanced' : rawProfileId;
  const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId);

  // Get the appropriate icon
  const Icon = selectedProfileId === 'custom'
    ? Sliders
    : (profile?.icon ? iconMap[profile.icon] : Scale);

  const handleSelectProfile = (profileId: string) => {
    if (profileId === 'custom') {
      setShowCustomModal(true);
      return;
    }

    const selected = DEFAULT_AGENT_PROFILES.find(p => p.id === profileId);
    if (selected) {
      onConfigChange({
        profileId: selected.id,
        model: selected.model,
        thinkingLevel: selected.thinkingLevel
      });
    }
  };

  const handleCustomSave = (config: InsightsModelConfig) => {
    onConfigChange(config);
    setShowCustomModal(false);
  };

  // Build display text for current selection
  const getDisplayText = () => {
    if (selectedProfileId === 'custom' && currentConfig) {
      const modelLabel = AVAILABLE_MODELS.find(m => m.value === currentConfig.model)?.label || currentConfig.model;
      return `${modelLabel} + ${currentConfig.thinkingLevel}`;
    }
    return profile?.name || 'Balanced';
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 px-2"
            disabled={disabled}
            title={t('common:insightsModelSelector.modelTitle', { model: getDisplayText() })}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {getDisplayText()}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{t('common:insightsModelSelector.agentProfile')}</DropdownMenuLabel>
          {DEFAULT_AGENT_PROFILES.filter(p => !p.isAutoProfile).map((p) => {
            const ProfileIcon = iconMap[p.icon || 'Brain'];
            const isSelected = selectedProfileId === p.id;
            const modelLabel = AVAILABLE_MODELS.find(m => m.value === p.model)?.label;
            return (
              <DropdownMenuItem
                key={p.id}
                onClick={() => handleSelectProfile(p.id)}
                className="flex cursor-pointer items-center gap-2"
              >
                <ProfileIcon className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {modelLabel} + {p.thinkingLevel}
                  </div>
                </div>
                {isSelected && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => handleSelectProfile('custom')}
            className="flex cursor-pointer items-center gap-2"
          >
            <Sliders className="h-4 w-4 shrink-0" />
            <div className="flex-1">
              <div className="font-medium">{t('common:insightsModelSelector.custom')}</div>
              <div className="text-xs text-muted-foreground">
                {t('common:insightsModelSelector.chooseModel')}
              </div>
            </div>
            {selectedProfileId === 'custom' && (
              <Check className="h-4 w-4 shrink-0 text-primary" />
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CustomModelModal
        open={showCustomModal}
        currentConfig={currentConfig}
        onSave={handleCustomSave}
        onClose={() => setShowCustomModal(false)}
      />
    </>
  );
}
