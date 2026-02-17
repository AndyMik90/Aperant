import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Cloud, Loader2, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { SettingsSection } from './SettingsSection';
import {
  DEFAULT_LOCAL_LLM_SETTINGS,
  LOCAL_LLM_RECOMMENDED_MODELS,
  LOCAL_LLM_TOOL_MODES,
} from '../../../shared/constants';
import type {
  AppSettings,
  LLMProvider,
  LocalLLMSettings as LocalLLMSettingsType,
  LocalLLMToolMode,
} from '../../../shared/types';

interface LocalLLMSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

/**
 * LLM Provider Settings component
 *
 * Provides:
 * 1. Provider toggle (Claude Cloud vs Local LLM)
 * 2. Local LLM server configuration (endpoint, model, API key)
 * 3. Per-phase local model overrides
 * 4. Connection test + model discovery
 * 5. Advanced settings (temperature, max tokens, timeout, tool mode)
 */
export function LocalLLMSettings({ settings, onSettingsChange }: LocalLLMSettingsProps) {
  const { t } = useTranslation(['settings', 'common']);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>('');
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);

  const provider = settings.llmProvider || 'claude';
  const localConfig = settings.localLLM || DEFAULT_LOCAL_LLM_SETTINGS;

  const setProvider = useCallback((newProvider: LLMProvider) => {
    onSettingsChange({ ...settings, llmProvider: newProvider });
  }, [settings, onSettingsChange]);

  const updateLocalConfig = useCallback((updates: Partial<LocalLLMSettingsType>) => {
    onSettingsChange({
      ...settings,
      localLLM: { ...localConfig, ...updates },
    });
  }, [settings, localConfig, onSettingsChange]);

  const updatePhaseModel = useCallback((phase: string, model: string) => {
    const current = localConfig.phaseModels || {};
    onSettingsChange({
      ...settings,
      localLLM: {
        ...localConfig,
        phaseModels: { ...current, [phase]: model || undefined },
      },
    });
  }, [settings, localConfig, onSettingsChange]);

  // Test connection to local LLM server
  const testConnection = useCallback(async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    setDiscoveredModels([]);

    try {
      // Try to list models via OpenAI-compatible /v1/models endpoint
      const baseUrl = localConfig.baseUrl.replace(/\/v1\/?$/, '');
      const response = await fetch(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localConfig.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const models = (data.data || []).map((m: { id: string }) => m.id).sort();
      setDiscoveredModels(models);
      setConnectionStatus('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConnectionError(message);
      setConnectionStatus('error');
    }
  }, [localConfig.baseUrl, localConfig.apiKey]);

  const phases = [
    { key: 'spec', label: t('settings:agentProfile.phases.spec.label'), desc: t('settings:agentProfile.phases.spec.description') },
    { key: 'planning', label: t('settings:agentProfile.phases.planning.label'), desc: t('settings:agentProfile.phases.planning.description') },
    { key: 'coding', label: t('settings:agentProfile.phases.coding.label'), desc: t('settings:agentProfile.phases.coding.description') },
    { key: 'qa', label: t('settings:agentProfile.phases.qa.label'), desc: t('settings:agentProfile.phases.qa.description') },
  ];

  return (
    <SettingsSection
      title={t('settings:localLLM.title')}
      description={t('settings:localLLM.description')}
    >
      <div className="space-y-6">
        {/* Provider Toggle */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground">
            {t('settings:localLLM.providerLabel')}
          </Label>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <button
              onClick={() => setProvider('claude')}
              className={cn(
                'flex items-center gap-3 p-4 rounded-lg border transition-all',
                provider === 'claude'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <Cloud className={cn('h-5 w-5', provider === 'claude' ? 'text-primary' : 'text-muted-foreground')} />
              <div className="text-left">
                <div className="font-medium text-sm">{t('settings:localLLM.providerClaude')}</div>
                <div className="text-xs text-muted-foreground">{t('settings:localLLM.providerClaudeDesc')}</div>
              </div>
            </button>
            <button
              onClick={() => setProvider('local')}
              className={cn(
                'flex items-center gap-3 p-4 rounded-lg border transition-all',
                provider === 'local'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <Monitor className={cn('h-5 w-5', provider === 'local' ? 'text-primary' : 'text-muted-foreground')} />
              <div className="text-left">
                <div className="font-medium text-sm">{t('settings:localLLM.providerLocal')}</div>
                <div className="text-xs text-muted-foreground">{t('settings:localLLM.providerLocalDesc')}</div>
              </div>
            </button>
          </div>
        </div>

        {/* Local LLM Configuration (shown when provider === 'local') */}
        {provider === 'local' && (
          <div className="space-y-6 rounded-lg border border-border p-4">
            {/* Server Configuration */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-foreground">{t('settings:localLLM.serverConfig')}</h4>

              {/* Base URL */}
              <div className="space-y-2">
                <Label htmlFor="localLlmBaseUrl" className="text-sm">{t('settings:localLLM.baseUrl')}</Label>
                <div className="flex gap-2 max-w-lg">
                  <Input
                    id="localLlmBaseUrl"
                    placeholder="http://localhost:11434/v1"
                    value={localConfig.baseUrl}
                    onChange={(e) => updateLocalConfig({ baseUrl: e.target.value })}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testConnection}
                    disabled={connectionStatus === 'testing'}
                    className="whitespace-nowrap"
                  >
                    {connectionStatus === 'testing' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : connectionStatus === 'success' ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : connectionStatus === 'error' ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : null}
                    <span className="ml-1">{t('settings:localLLM.testConnection')}</span>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('settings:localLLM.baseUrlHint')}</p>
                {connectionStatus === 'error' && connectionError && (
                  <p className="text-xs text-destructive">{connectionError}</p>
                )}
              </div>

              {/* Model Selection */}
              <div className="space-y-2">
                <Label htmlFor="localLlmModel" className="text-sm">{t('settings:localLLM.model')}</Label>
                {discoveredModels.length > 0 ? (
                  <Select
                    value={localConfig.model}
                    onValueChange={(value) => updateLocalConfig({ model: value })}
                  >
                    <SelectTrigger className="max-w-lg">
                      <SelectValue placeholder={t('settings:localLLM.modelPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {discoveredModels.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-2">
                    <Input
                      id="localLlmModel"
                      placeholder={t('settings:localLLM.modelPlaceholder')}
                      value={localConfig.model}
                      onChange={(e) => updateLocalConfig({ model: e.target.value })}
                      className="max-w-lg"
                      list="local-llm-models"
                    />
                    <datalist id="local-llm-models">
                      {LOCAL_LLM_RECOMMENDED_MODELS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label} - {m.description}</option>
                      ))}
                    </datalist>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{t('settings:localLLM.modelHint')}</p>
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <Label htmlFor="localLlmApiKey" className="text-sm">{t('settings:localLLM.apiKey')}</Label>
                <Input
                  id="localLlmApiKey"
                  placeholder="local"
                  value={localConfig.apiKey}
                  onChange={(e) => updateLocalConfig({ apiKey: e.target.value })}
                  className="max-w-lg"
                />
                <p className="text-xs text-muted-foreground">{t('settings:localLLM.apiKeyHint')}</p>
              </div>
            </div>

            {/* Per-Phase Model Overrides */}
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-foreground">{t('settings:localLLM.phaseModels')}</h4>
                <p className="text-xs text-muted-foreground">{t('settings:localLLM.phaseModelsDesc')}</p>
              </div>

              {phases.map((phase) => (
                <div key={phase.key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">{phase.label}</Label>
                    <span className="text-xs text-muted-foreground">{phase.desc}</span>
                  </div>
                  <Input
                    placeholder={localConfig.model || t('settings:localLLM.phaseModelPlaceholder')}
                    value={localConfig.phaseModels?.[phase.key as keyof typeof localConfig.phaseModels] || ''}
                    onChange={(e) => updatePhaseModel(phase.key, e.target.value)}
                    className="max-w-lg"
                  />
                </div>
              ))}
            </div>

            {/* Advanced Settings (collapsible) */}
            <div className="pt-4 border-t border-border">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {t('settings:localLLM.advanced')}
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4">
                  {/* Temperature */}
                  <div className="space-y-2">
                    <Label className="text-sm">{t('settings:localLLM.temperature')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={localConfig.temperature}
                      onChange={(e) => updateLocalConfig({ temperature: parseFloat(e.target.value) || 0 })}
                      className="max-w-32"
                    />
                    <p className="text-xs text-muted-foreground">{t('settings:localLLM.temperatureHint')}</p>
                  </div>

                  {/* Max Tokens */}
                  <div className="space-y-2">
                    <Label className="text-sm">{t('settings:localLLM.maxTokens')}</Label>
                    <Input
                      type="number"
                      min={1024}
                      max={131072}
                      step={1024}
                      value={localConfig.maxTokens}
                      onChange={(e) => updateLocalConfig({ maxTokens: parseInt(e.target.value) || 16384 })}
                      className="max-w-40"
                    />
                  </div>

                  {/* Timeout */}
                  <div className="space-y-2">
                    <Label className="text-sm">{t('settings:localLLM.timeout')}</Label>
                    <Input
                      type="number"
                      min={30}
                      max={3600}
                      step={30}
                      value={localConfig.timeout}
                      onChange={(e) => updateLocalConfig({ timeout: parseInt(e.target.value) || 300 })}
                      className="max-w-40"
                    />
                    <p className="text-xs text-muted-foreground">{t('settings:localLLM.timeoutHint')}</p>
                  </div>

                  {/* Tool Calling Mode */}
                  <div className="space-y-2">
                    <Label className="text-sm">{t('settings:localLLM.toolMode')}</Label>
                    <Select
                      value={localConfig.toolCallingMode}
                      onValueChange={(value) => updateLocalConfig({ toolCallingMode: value as LocalLLMToolMode })}
                    >
                      <SelectTrigger className="max-w-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LOCAL_LLM_TOOL_MODES.map((mode) => (
                          <SelectItem key={mode.value} value={mode.value}>
                            <div>
                              <span>{mode.label}</span>
                              <span className="text-xs text-muted-foreground ml-2">{mode.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            {/* Recommended Models Info */}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                {t('settings:localLLM.recommendedInfo')}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {LOCAL_LLM_RECOMMENDED_MODELS.slice(0, 4).map((m) => (
                  <div key={m.value} className="text-xs">
                    <span className="font-mono text-foreground">{m.value}</span>
                    <span className="text-muted-foreground ml-1">({m.vram})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
