import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database,
  Info,
  Loader2,
  ExternalLink
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Separator } from '../ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { InfrastructureStatus } from '../project-settings/InfrastructureStatus';
import { PasswordInput } from '../project-settings/PasswordInput';
import { useSettingsStore } from '../../stores/settings-store';
import type { GraphitiEmbeddingProvider, AppSettings, InfrastructureStatus as InfrastructureStatusType } from '../../../shared/types';
import { OllamaModelSelector } from './OllamaModelSelector';

interface MemoryStepProps {
  onNext: () => void;
  onBack: () => void;
}

interface MemoryConfig {
  enabled: boolean;
  agentMemoryEnabled: boolean;
  mcpServerUrl: string;
  embeddingProvider: GraphitiEmbeddingProvider;
  // OpenAI
  openaiApiKey: string;
  // Azure OpenAI
  azureOpenaiApiKey: string;
  azureOpenaiBaseUrl: string;
  azureOpenaiEmbeddingDeployment: string;
  // Voyage
  voyageApiKey: string;
  voyageEmbeddingModel: string;
  // Google
  googleApiKey: string;
  // Ollama
  ollamaBaseUrl: string;
  ollamaEmbeddingModel: string;
  ollamaEmbeddingDim: number;
}



/**
 * Memory configuration step for the onboarding wizard.
 *
 * Matches the settings page MemoryBackendSection structure:
 * - Enable Memory toggle (enabled by default)
 * - Infrastructure Status
 * - Enable Agent Memory Access toggle
 * - Embedding Provider selection (Ollama default)
 * - Provider-specific configuration
 */
export function MemoryStep({ onNext, onBack }: MemoryStepProps) {
  const { t } = useTranslation('onboarding');
  const { settings, updateSettings } = useSettingsStore();

  // Initialize config with memory enabled by default
  const [config, setConfig] = useState<MemoryConfig>({
    enabled: true, // Memory enabled by default
    agentMemoryEnabled: true, // Agent memory access enabled by default
    mcpServerUrl: 'http://localhost:8000/mcp/',
    embeddingProvider: 'ollama',
    openaiApiKey: settings.globalOpenAIApiKey || '',
    azureOpenaiApiKey: '',
    azureOpenaiBaseUrl: '',
    azureOpenaiEmbeddingDeployment: '',
    voyageApiKey: '',
    voyageEmbeddingModel: settings.memoryVoyageEmbeddingModel || '',
    googleApiKey: settings.globalGoogleApiKey || '',
    ollamaBaseUrl: settings.ollamaBaseUrl || 'http://localhost:11434',
    ollamaEmbeddingModel: settings.memoryOllamaEmbeddingModel || 'qwen3-embedding:4b',
    ollamaEmbeddingDim: settings.memoryOllamaEmbeddingDim ?? 2560,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infrastructureStatus, setInfrastructureStatus] = useState<InfrastructureStatusType | null>(null);
  const [isCheckingInfra, setIsCheckingInfra] = useState(true);



  // Check LadybugDB/Kuzu availability on mount
  useEffect(() => {
    const checkInfrastructure = async () => {
      setIsCheckingInfra(true);
      try {
        const result = await window.electronAPI.getMemoryInfrastructureStatus();
        if (result.success && result.data) {
          setInfrastructureStatus(result.data);
        }
      } catch (err) {
        console.error('Failed to check infrastructure:', err);
      } finally {
        setIsCheckingInfra(false);
      }
    };

    checkInfrastructure();
  }, []);



  // Check if we have valid configuration
  const isConfigValid = (): boolean => {
    // If memory is disabled, always valid
    if (!config.enabled) return true;

    const { embeddingProvider } = config;

    // Ollama just needs a model selected
    if (embeddingProvider === 'ollama') {
      return !!config.ollamaEmbeddingModel.trim();
    }

    // Other providers need API keys
    if (embeddingProvider === 'openai' && !config.openaiApiKey.trim()) return false;
    if (embeddingProvider === 'voyage' && !config.voyageApiKey.trim()) return false;
    if (embeddingProvider === 'google' && !config.googleApiKey.trim()) return false;
    if (embeddingProvider === 'azure_openai') {
      if (!config.azureOpenaiApiKey.trim()) return false;
      if (!config.azureOpenaiBaseUrl.trim()) return false;
      if (!config.azureOpenaiEmbeddingDeployment.trim()) return false;
    }

    return true;
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      // Save complete memory configuration to global settings
      const settingsToSave: Record<string, string | number | boolean | undefined> = {
        // Core memory settings
        memoryEnabled: config.enabled,
        memoryEmbeddingProvider: config.embeddingProvider,
        ollamaBaseUrl: config.ollamaBaseUrl || undefined,
        memoryOllamaEmbeddingModel: config.ollamaEmbeddingModel || undefined,
        memoryOllamaEmbeddingDim: config.ollamaEmbeddingDim || undefined,
        // Agent memory access (MCP)
        graphitiMcpEnabled: config.agentMemoryEnabled,
        graphitiMcpUrl: config.mcpServerUrl.trim() || undefined,
        // Global API keys (shared across features)
        globalOpenAIApiKey: config.openaiApiKey.trim() || undefined,
        globalGoogleApiKey: config.googleApiKey.trim() || undefined,
        // Provider-specific keys for memory
        memoryVoyageApiKey: config.voyageApiKey.trim() || undefined,
        memoryVoyageEmbeddingModel: config.voyageEmbeddingModel.trim() || undefined,
        memoryAzureApiKey: config.azureOpenaiApiKey.trim() || undefined,
        memoryAzureBaseUrl: config.azureOpenaiBaseUrl.trim() || undefined,
        memoryAzureEmbeddingDeployment: config.azureOpenaiEmbeddingDeployment.trim() || undefined,
      };

      const result = await window.electronAPI.saveSettings(settingsToSave);

      if (result?.success) {
        // Update local settings store
        const storeUpdate: Partial<AppSettings> = {
          memoryEnabled: config.enabled,
          memoryEmbeddingProvider: config.embeddingProvider,
          ollamaBaseUrl: config.ollamaBaseUrl || undefined,
          memoryOllamaEmbeddingModel: config.ollamaEmbeddingModel || undefined,
          memoryOllamaEmbeddingDim: config.ollamaEmbeddingDim || undefined,
          graphitiMcpEnabled: config.agentMemoryEnabled,
          graphitiMcpUrl: config.mcpServerUrl.trim() || undefined,
          globalOpenAIApiKey: config.openaiApiKey.trim() || undefined,
          globalGoogleApiKey: config.googleApiKey.trim() || undefined,
          memoryVoyageApiKey: config.voyageApiKey.trim() || undefined,
          memoryVoyageEmbeddingModel: config.voyageEmbeddingModel.trim() || undefined,
          memoryAzureApiKey: config.azureOpenaiApiKey.trim() || undefined,
          memoryAzureBaseUrl: config.azureOpenaiBaseUrl.trim() || undefined,
          memoryAzureEmbeddingDeployment: config.azureOpenaiEmbeddingDeployment.trim() || undefined,
        };
        updateSettings(storeUpdate);
        onNext();
      } else {
        setError(result?.error || 'Failed to save memory configuration');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Database className="h-7 w-7" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            {t('memory.title')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {t('memory.description')}
          </p>
        </div>

        {/* Loading state */}
        {isCheckingInfra && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Main content */}
        {!isCheckingInfra && (
          <div className="space-y-6">
            {/* Error banner */}
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Enable Memory Toggle */}
            <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card">
              <div className="flex items-center gap-3">
                <Database className="h-5 w-5 text-muted-foreground" />
                <div>
                  <Label className="font-medium text-foreground">{t('memory.enableMemory')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('memory.enableMemoryDescription')}
                  </p>
                </div>
              </div>
              <Switch
                checked={config.enabled}
                onCheckedChange={(checked) => setConfig(prev => ({ ...prev, enabled: checked }))}
                disabled={isSaving}
              />
            </div>

            {/* Memory Disabled Info */}
            {!config.enabled && (
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-sm text-muted-foreground">
                    {t('memory.memoryDisabledInfo')}
                  </p>
                </div>
              </div>
            )}

            {/* Memory Enabled Configuration */}
            {config.enabled && (
              <>
                {/* Infrastructure Status */}
                <InfrastructureStatus
                  infrastructureStatus={infrastructureStatus}
                  isCheckingInfrastructure={isCheckingInfra}
                />

                {/* Agent Memory Access Toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="font-normal text-foreground">{t('memory.enableAgentAccess')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t('memory.enableAgentAccessDescription')}
                    </p>
                  </div>
                  <Switch
                    checked={config.agentMemoryEnabled}
                    onCheckedChange={(checked) => setConfig(prev => ({ ...prev, agentMemoryEnabled: checked }))}
                    disabled={isSaving}
                  />
                </div>

                {/* MCP Server URL (shown when agent memory is enabled) */}
                {config.agentMemoryEnabled && (
                  <div className="space-y-2 ml-6">
                    <Label className="text-sm font-medium text-foreground">{t('memory.mcpServerUrl')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t('memory.mcpServerUrlDescription')}
                    </p>
                    <Input
                      placeholder="http://localhost:8000/mcp/"
                      value={config.mcpServerUrl}
                      onChange={(e) => setConfig(prev => ({ ...prev, mcpServerUrl: e.target.value }))}
                      className="font-mono text-sm"
                      disabled={isSaving}
                    />
                  </div>
                )}

                <Separator />

                {/* Embedding Provider Selection */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">{t('memory.embeddingProvider')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('memory.embeddingProviderDescription')}
                  </p>
                  <Select
                    value={config.embeddingProvider}
                    onValueChange={(value: GraphitiEmbeddingProvider) => {
                      setConfig(prev => ({ ...prev, embeddingProvider: value }));
                    }}
                    disabled={isSaving}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('memory.selectEmbeddingModel')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ollama">{t('memory.providers.ollama')}</SelectItem>
                      <SelectItem value="openai">{t('memory.providers.openai')}</SelectItem>
                      <SelectItem value="voyage">{t('memory.providers.voyage')}</SelectItem>
                      <SelectItem value="google">{t('memory.providers.google')}</SelectItem>
                      <SelectItem value="azure_openai">{t('memory.providers.azure')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Provider-specific fields */}
                {/* OpenAI */}
                {config.embeddingProvider === 'openai' && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">{t('memory.openaiApiKey')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t('memory.openaiApiKeyDescription')}
                    </p>
                    <PasswordInput
                      value={config.openaiApiKey}
                      onChange={(value) => setConfig(prev => ({ ...prev, openaiApiKey: value }))}
                      placeholder="sk-..."
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('memory.openaiGetKey')}{' '}
                      <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                        OpenAI
                      </a>
                    </p>
                  </div>
                )}

                {/* Voyage AI */}
                {config.embeddingProvider === 'voyage' && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">{t('memory.voyageApiKey')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t('memory.voyageApiKeyDescription')}
                    </p>
                    <PasswordInput
                      value={config.voyageApiKey}
                      onChange={(value) => setConfig(prev => ({ ...prev, voyageApiKey: value }))}
                      placeholder="pa-..."
                    />
                    <div className="space-y-1 mt-2">
                        <Label className="text-xs text-muted-foreground">{t('memory.embeddingModel')}</Label>
                        <Input
                          placeholder="voyage-3"
                          value={config.voyageEmbeddingModel}
                          onChange={(e) => setConfig(prev => ({ ...prev, voyageEmbeddingModel: e.target.value }))}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('memory.openaiGetKey')}{' '}
                      <a href="https://dash.voyageai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                        Voyage AI
                      </a>
                    </p>
                  </div>
                )}

                {/* Google AI */}
                {config.embeddingProvider === 'google' && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">{t('memory.googleApiKey')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t('memory.googleApiKeyDescription')}
                    </p>
                    <PasswordInput
                      value={config.googleApiKey}
                      onChange={(value) => setConfig(prev => ({ ...prev, googleApiKey: value }))}
                      placeholder="AIza..."
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('memory.openaiGetKey')}{' '}
                      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                        Google AI Studio
                      </a>
                    </p>
                  </div>
                )}

                {/* Azure OpenAI */}
                {config.embeddingProvider === 'azure_openai' && (
                  <div className="space-y-3">
                    <Label className="text-sm font-medium text-foreground">{t('memory.azureConfig')}</Label>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">{t('memory.azureApiKey')}</Label>
                      <PasswordInput
                        value={config.azureOpenaiApiKey}
                        onChange={(value) => setConfig(prev => ({ ...prev, azureOpenaiApiKey: value }))}
                        placeholder="Azure API Key"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{t('memory.azureBaseUrl')}</Label>
                      <Input
                        placeholder="https://your-resource.openai.azure.com"
                        value={config.azureOpenaiBaseUrl}
                        onChange={(e) => setConfig(prev => ({ ...prev, azureOpenaiBaseUrl: e.target.value }))}
                        className="font-mono text-sm"
                        disabled={isSaving}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{t('memory.azureEmbeddingDeployment')}</Label>
                      <Input
                        placeholder="text-embedding-ada-002"
                        value={config.azureOpenaiEmbeddingDeployment}
                        onChange={(e) => setConfig(prev => ({ ...prev, azureOpenaiEmbeddingDeployment: e.target.value }))}
                        className="font-mono text-sm"
                        disabled={isSaving}
                      />
                    </div>
                  </div>
                )}

                {/* Ollama (Local) */}
                {/* Ollama (Local) */}
                {config.embeddingProvider === 'ollama' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium text-foreground">{t('memory.ollamaConfig')}</Label>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">{t('memory.baseUrl')}</Label>
                      <Input
                        placeholder="http://localhost:11434"
                        value={config.ollamaBaseUrl}
                        onChange={(e) => setConfig(prev => ({ ...prev, ollamaBaseUrl: e.target.value }))}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">{t('memory.embeddingModel')}</Label>
                      <OllamaModelSelector
                         selectedModel={config.ollamaEmbeddingModel}
                         baseUrl={config.ollamaBaseUrl}
                         onModelSelect={(model, dim) => {
                           setConfig(prev => ({
                             ...prev,
                             ollamaEmbeddingModel: model,
                             ollamaEmbeddingDim: dim
                           }));
                         }}
                         disabled={isSaving}
                      />
                    </div>
                  </div>
                )}

                {/* Info about Learn More */}
                <div className="rounded-lg border border-info/30 bg-info/10 p-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">
                        {t('memory.memoryInfo')}
                      </p>
                      <a
                        href="https://docs.auto-claude.dev/memory"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 mt-2"
                      >
                        {t('memory.learnMore')}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between items-center mt-10 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
          >
            {t('memory.back')}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onNext}
              disabled={isCheckingInfra || isSaving}
            >
              {t('memory.skip')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={isCheckingInfra || !isConfigValid() || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t('memory.saving')}
                </>
              ) : (
                t('memory.saveAndContinue')
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
