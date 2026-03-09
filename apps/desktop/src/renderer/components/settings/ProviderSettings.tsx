import { useTranslation } from 'react-i18next';
import { useState, useCallback } from 'react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SettingsSection } from './SettingsSection';
import { useSettingsStore } from '../../stores/settings-store';
import { toast } from '../../hooks/use-toast';
import type { AppSettings, PhaseModelConfig } from '../../../shared/types';

/**
 * Supported AI providers for the Vercel AI SDK integration
 */
const PROVIDERS = [
  { value: 'anthropic', labelKey: 'provider.selection.anthropic' },
  { value: 'openai', labelKey: 'provider.selection.openai' },
  { value: 'ollama', labelKey: 'provider.selection.ollama' },
  { value: 'openrouter', labelKey: 'provider.selection.openrouter' },
] as const;

type ProviderValue = (typeof PROVIDERS)[number]['value'];

/**
 * Maps provider to the corresponding AppSettings API key field
 */
const PROVIDER_API_KEY_MAP: Record<string, keyof AppSettings> = {
  anthropic: 'globalAnthropicApiKey',
  openai: 'globalOpenAIApiKey',
  openrouter: 'globalOpenRouterApiKey',
};

/**
 * Maps provider to the API key placeholder translation key
 */
const PROVIDER_PLACEHOLDER_MAP: Record<string, string> = {
  anthropic: 'provider.apiKey.anthropicPlaceholder',
  openai: 'provider.apiKey.openaiPlaceholder',
  openrouter: 'provider.apiKey.openrouterPlaceholder',
};

/**
 * Phase model configuration phases
 */
const PHASES: Array<{ key: keyof PhaseModelConfig; labelKey: string; descKey: string }> = [
  { key: 'spec', labelKey: 'provider.phaseModels.spec.label', descKey: 'provider.phaseModels.spec.description' },
  { key: 'planning', labelKey: 'provider.phaseModels.planning.label', descKey: 'provider.phaseModels.planning.description' },
  { key: 'coding', labelKey: 'provider.phaseModels.coding.label', descKey: 'provider.phaseModels.coding.description' },
  { key: 'qa', labelKey: 'provider.phaseModels.qa.label', descKey: 'provider.phaseModels.qa.description' },
];

/**
 * Available models for per-phase selection
 */
const PHASE_MODEL_OPTIONS = [
  { value: '', labelKey: 'provider.phaseModels.useDefault' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
];

interface ProviderSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

/**
 * Provider Settings UI component for configuring AI provider, API keys,
 * Ollama endpoint, and per-phase model preferences.
 */
export function ProviderSettings({ settings, onSettingsChange }: ProviderSettingsProps) {
  const { t } = useTranslation('settings');
  const { isTestingConnection } = useSettingsStore();

  const [selectedProvider, setSelectedProvider] = useState<ProviderValue>('anthropic');

  const getApiKeyForProvider = (provider: ProviderValue): string => {
    const field = PROVIDER_API_KEY_MAP[provider];
    if (!field) return '';
    return (settings[field] as string) || '';
  };

  const handleProviderChange = useCallback(
    (value: string) => {
      const provider = value as ProviderValue;
      setSelectedProvider(provider);
    },
    []
  );

  const handleApiKeyChange = useCallback(
    (value: string) => {
      const field = PROVIDER_API_KEY_MAP[selectedProvider];
      if (field) {
        onSettingsChange({ ...settings, [field]: value });
      }
    },
    [settings, onSettingsChange, selectedProvider]
  );

  const handleOllamaUrlChange = useCallback(
    (value: string) => {
      onSettingsChange({ ...settings, ollamaBaseUrl: value });
    },
    [settings, onSettingsChange]
  );

  const handlePhaseModelChange = useCallback(
    (phase: keyof PhaseModelConfig, value: string) => {
      const currentPhaseModels = settings.customPhaseModels || {
        spec: 'sonnet',
        planning: 'sonnet',
        coding: 'sonnet',
        qa: 'sonnet',
      };
      const newPhaseModels: PhaseModelConfig = {
        ...currentPhaseModels,
        [phase]: value || 'sonnet',
      };
      onSettingsChange({ ...settings, customPhaseModels: newPhaseModels });
    },
    [settings, onSettingsChange]
  );

  const handleTestConnection = useCallback(async () => {
    const apiKey = getApiKeyForProvider(selectedProvider);
    let baseUrl: string;

    if (selectedProvider === 'ollama') {
      baseUrl = settings.ollamaBaseUrl || 'http://localhost:11434';
    } else if (selectedProvider === 'openai') {
      baseUrl = 'https://api.openai.com';
    } else if (selectedProvider === 'openrouter') {
      baseUrl = 'https://openrouter.ai/api';
    } else {
      baseUrl = 'https://api.anthropic.com';
    }

    const store = useSettingsStore.getState();
    const result = await store.testConnection(baseUrl, apiKey);

    if (result?.success) {
      toast({
        title: t('provider.toast.saved.title'),
        description: t('provider.toast.saved.description'),
      });
    }
  }, [selectedProvider, settings.ollamaBaseUrl, t]);

  const needsApiKey = selectedProvider !== 'ollama';
  const placeholderKey = PROVIDER_PLACEHOLDER_MAP[selectedProvider] || 'provider.apiKey.placeholder';

  return (
    <SettingsSection
      title={t('provider.title')}
      description={t('provider.description')}
    >
      <div className="space-y-6">
        {/* Provider Selection */}
        <div className="space-y-3">
          <Label htmlFor="aiProvider" className="text-sm font-medium text-foreground">
            {t('provider.selection.label')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('provider.selection.description')}
          </p>
          <Select value={selectedProvider} onValueChange={handleProviderChange}>
            <SelectTrigger id="aiProvider" className="w-full max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((provider) => (
                <SelectItem key={provider.value} value={provider.value}>
                  {t(provider.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* API Key Input (not shown for Ollama) */}
        {needsApiKey && (
          <div className="space-y-3">
            <Label htmlFor="providerApiKey" className="text-sm font-medium text-foreground">
              {t('provider.apiKey.label')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('provider.apiKey.description')}
            </p>
            <Input
              id="providerApiKey"
              type="password"
              placeholder={t(placeholderKey)}
              className="w-full max-w-lg"
              value={getApiKeyForProvider(selectedProvider)}
              onChange={(e) => handleApiKeyChange(e.target.value)}
            />
          </div>
        )}

        {/* Ollama Endpoint URL */}
        {selectedProvider === 'ollama' && (
          <div className="space-y-3">
            <Label htmlFor="ollamaEndpoint" className="text-sm font-medium text-foreground">
              {t('provider.ollama.endpointUrl')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('provider.ollama.endpointDescription')}
            </p>
            <Input
              id="ollamaEndpoint"
              placeholder={t('provider.ollama.endpointPlaceholder')}
              className="w-full max-w-lg"
              value={settings.ollamaBaseUrl || ''}
              onChange={(e) => handleOllamaUrlChange(e.target.value)}
            />
          </div>
        )}

        {/* Test Connection */}
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={isTestingConnection || (needsApiKey && !getApiKeyForProvider(selectedProvider))}
            onClick={handleTestConnection}
          >
            {isTestingConnection
              ? t('provider.testConnection.testing')
              : t('provider.testConnection.label')}
          </Button>
        </div>

        {/* Per-Phase Model Preferences */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="space-y-1">
            <Label className="text-sm font-medium text-foreground">
              {t('provider.phaseModels.title')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('provider.phaseModels.description')}
            </p>
          </div>

          {PHASES.map((phase) => {
            const phaseModels = settings.customPhaseModels || {
              spec: 'sonnet',
              planning: 'sonnet',
              coding: 'sonnet',
              qa: 'sonnet',
            };

            return (
              <div key={phase.key} className="space-y-2">
                <div className="flex items-center justify-between max-w-md">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium text-foreground">
                      {t(phase.labelKey)}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t(phase.descKey)}
                    </p>
                  </div>
                </div>
                <Select
                  value={phaseModels[phase.key]}
                  onValueChange={(value) => handlePhaseModelChange(phase.key, value)}
                >
                  <SelectTrigger className="w-full max-w-md h-9">
                    <SelectValue placeholder={t('provider.phaseModels.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {PHASE_MODEL_OPTIONS.map((option) => (
                      <SelectItem key={option.value || 'default'} value={option.value || 'sonnet'}>
                        {option.labelKey ? t(option.labelKey) : option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </div>
    </SettingsSection>
  );
}
