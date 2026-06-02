import { useState, useEffect } from 'react';
import {
  Database,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Globe
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Separator } from '../ui/separator';
import { OllamaModelSelector } from '../onboarding/OllamaModelSelector';
import type { ProjectEnvConfig, ProjectSettings as ProjectSettingsType, MemoryEmbeddingProvider } from '../../../shared/types';

interface SecuritySettingsProps {
  envConfig: ProjectEnvConfig | null;
  settings: ProjectSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettingsType>>;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;

  // Password visibility
  showOpenAIKey: boolean;
  setShowOpenAIKey: React.Dispatch<React.SetStateAction<boolean>>;

  // Collapsible section
  expanded: boolean;
  onToggle: () => void;
}

export function SecuritySettings({
  envConfig,
  settings,
  setSettings,
  updateEnvConfig,
  showOpenAIKey,
  setShowOpenAIKey,
  expanded,
  onToggle
}: SecuritySettingsProps) {
  const { t } = useTranslation('settings');
  // Password visibility for multiple providers
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({
    openai: showOpenAIKey,
    voyage: false,
    google: false,
    azure: false
  });

  // Sync parent's showOpenAIKey prop to local state
  useEffect(() => {
    setShowApiKey(prev => ({ ...prev, openai: showOpenAIKey }));
  }, [showOpenAIKey]);

  const embeddingProvider = envConfig?.memoryProviderConfig?.embeddingProvider || 'ollama';

  // Toggle API key visibility
  const toggleShowApiKey = (key: string) => {
    const newValue = !showApiKey[key];
    setShowApiKey(prev => ({ ...prev, [key]: newValue }));
    // Sync with parent for OpenAI
    if (key === 'openai') {
      setShowOpenAIKey(newValue);
    }
  };

  // Handle Ollama model selection
  const handleOllamaModelSelect = (modelName: string, dim: number) => {
    updateEnvConfig({
      memoryProviderConfig: {
        ...envConfig?.memoryProviderConfig,
        embeddingProvider: 'ollama',
        ollamaEmbeddingModel: modelName,
        ollamaEmbeddingDim: dim,
      }
    });
  };

  if (!envConfig) return null;

  // Render provider-specific configuration fields
  const renderProviderFields = () => {
    // OpenAI
    if (embeddingProvider === 'openai') {
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-foreground">
              {t('integrations.memory.openaiKeyLabel')} {envConfig.openaiKeyIsGlobal ? t('integrations.common.override') : ''}
            </Label>
            {envConfig.openaiKeyIsGlobal && (
              <span className="flex items-center gap-1 text-xs text-info">
                <Globe className="h-3 w-3" />
                {t('integrations.common.usingGlobalKey')}
              </span>
            )}
          </div>
          {envConfig.openaiKeyIsGlobal ? (
            <p className="text-xs text-muted-foreground">
              {t('integrations.memory.usingGlobalKeyDescription')}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('integrations.memory.openaiKeyRequired')}
            </p>
          )}
          <div className="relative">
            <Input
              type={showApiKey['openai'] ? 'text' : 'password'}
              placeholder={envConfig.openaiKeyIsGlobal ? t('integrations.memory.openaiPlaceholderGlobal') : 'sk-xxxxxxxx'}
              value={envConfig.openaiKeyIsGlobal ? '' : (envConfig.openaiApiKey || '')}
              onChange={(e) => updateEnvConfig({ openaiApiKey: e.target.value || undefined })}
              className="pe-10"
            />
            <button
              type="button"
              onClick={() => toggleShowApiKey('openai')}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showApiKey['openai'] ? t('integrations.memory.hideOpenaiKey') : t('integrations.memory.showOpenaiKey')}
            >
              {showApiKey['openai'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('integrations.memory.getKeyFrom')}{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
              OpenAI
            </a>
          </p>
        </div>
      );
    }

    // Voyage AI
    if (embeddingProvider === 'voyage') {
      return (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">{t('integrations.memory.voyageKeyLabel')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('integrations.memory.voyageKeyRequired')}
          </p>
          <div className="relative">
            <Input
              type={showApiKey['voyage'] ? 'text' : 'password'}
              value={envConfig.memoryProviderConfig?.voyageApiKey || ''}
              onChange={(e) => updateEnvConfig({
                memoryProviderConfig: {
                  ...envConfig.memoryProviderConfig,
                  embeddingProvider: 'voyage',
                  voyageApiKey: e.target.value || undefined,
                }
              })}
              placeholder="pa-xxxxxxxx"
              className="pe-10"
            />
            <button
              type="button"
              onClick={() => toggleShowApiKey('voyage')}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showApiKey['voyage'] ? t('integrations.memory.hideVoyageKey') : t('integrations.memory.showVoyageKey')}
            >
              {showApiKey['voyage'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('integrations.memory.getKeyFrom')}{' '}
            <a href="https://dash.voyageai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
              Voyage AI
            </a>
          </p>
          <div className="space-y-1 mt-3">
            <Label className="text-xs text-muted-foreground">{t('integrations.memory.embeddingModelOptional')}</Label>
            <Input
              placeholder="voyage-3"
              value={envConfig.memoryProviderConfig?.voyageEmbeddingModel || ''}
              onChange={(e) => updateEnvConfig({
                memoryProviderConfig: {
                  ...envConfig.memoryProviderConfig,
                  embeddingProvider: 'voyage',
                  voyageEmbeddingModel: e.target.value || undefined,
                }
              })}
            />
          </div>
        </div>
      );
    }

    // Google AI
    if (embeddingProvider === 'google') {
      return (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">{t('integrations.memory.googleKeyLabel')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('integrations.memory.googleKeyRequired')}
          </p>
          <div className="relative">
            <Input
              type={showApiKey['google'] ? 'text' : 'password'}
              value={envConfig.memoryProviderConfig?.googleApiKey || ''}
              onChange={(e) => updateEnvConfig({
                memoryProviderConfig: {
                  ...envConfig.memoryProviderConfig,
                  embeddingProvider: 'google',
                  googleApiKey: e.target.value || undefined,
                }
              })}
              placeholder="AIzaSy..."
              className="pe-10"
            />
            <button
              type="button"
              onClick={() => toggleShowApiKey('google')}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showApiKey['google'] ? t('integrations.memory.hideGoogleKey') : t('integrations.memory.showGoogleKey')}
            >
              {showApiKey['google'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('integrations.memory.getKeyFrom')}{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
              Google AI Studio
            </a>
          </p>
        </div>
      );
    }

    // Azure OpenAI
    if (embeddingProvider === 'azure_openai') {
      return (
        <div className="space-y-3 p-3 rounded-md bg-muted/50">
          <Label className="text-sm font-medium text-foreground">{t('integrations.memory.azureConfiguration')}</Label>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{t('integrations.common.apiKey')}</Label>
            <div className="relative">
              <Input
                type={showApiKey['azure'] ? 'text' : 'password'}
                value={envConfig.memoryProviderConfig?.azureOpenaiApiKey || ''}
                onChange={(e) => updateEnvConfig({
                  memoryProviderConfig: {
                    ...envConfig.memoryProviderConfig,
                    embeddingProvider: 'azure_openai',
                    azureOpenaiApiKey: e.target.value || undefined,
                  }
                })}
                placeholder={t('integrations.memory.azureApiKeyPlaceholder')}
                className="pe-10"
              />
              <button
                type="button"
                onClick={() => toggleShowApiKey('azure')}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showApiKey['azure'] ? t('integrations.memory.hideAzureKey') : t('integrations.memory.showAzureKey')}
              >
                {showApiKey['azure'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('integrations.memory.baseUrl')}</Label>
            <Input
              placeholder="https://your-resource.openai.azure.com"
              value={envConfig.memoryProviderConfig?.azureOpenaiBaseUrl || ''}
              onChange={(e) => updateEnvConfig({
                memoryProviderConfig: {
                  ...envConfig.memoryProviderConfig,
                  embeddingProvider: 'azure_openai',
                  azureOpenaiBaseUrl: e.target.value || undefined,
                }
              })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('integrations.memory.embeddingDeploymentName')}</Label>
            <Input
              placeholder="text-embedding-ada-002"
              value={envConfig.memoryProviderConfig?.azureOpenaiEmbeddingDeployment || ''}
              onChange={(e) => updateEnvConfig({
                memoryProviderConfig: {
                  ...envConfig.memoryProviderConfig,
                  embeddingProvider: 'azure_openai',
                  azureOpenaiEmbeddingDeployment: e.target.value || undefined,
                }
              })}
            />
          </div>
        </div>
      );
    }

    // Ollama (Local) - uses OllamaModelSelector component
    if (embeddingProvider === 'ollama') {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{t('integrations.memory.baseUrl')}</Label>
            <Input
              placeholder="http://localhost:11434"
              value={envConfig.memoryProviderConfig?.ollamaBaseUrl || 'http://localhost:11434'}
              onChange={(e) => updateEnvConfig({
                memoryProviderConfig: {
                  ...envConfig.memoryProviderConfig,
                  embeddingProvider: 'ollama',
                  ollamaBaseUrl: e.target.value,
                }
              })}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{t('integrations.memory.selectEmbeddingModel')}</Label>
            <OllamaModelSelector
              selectedModel={envConfig.memoryProviderConfig?.ollamaEmbeddingModel || ''}
              baseUrl={envConfig.memoryProviderConfig?.ollamaBaseUrl}
              onModelSelect={handleOllamaModelSelect}
            />
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <section className="space-y-3">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-semibold text-foreground hover:text-foreground/80"
      >
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4" />
          {t('integrations.memory.title')}
          <span className={`px-2 py-0.5 text-xs rounded-full ${
            envConfig.memoryEnabled
              ? 'bg-success/10 text-success'
              : 'bg-muted text-muted-foreground'
          }`}>
            {envConfig.memoryEnabled ? t('integrations.common.enabled') : t('integrations.common.disabled')}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="space-y-4 ps-6 pt-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="font-normal text-foreground">{t('integrations.memory.enableMemory')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('integrations.memory.enableMemoryDescription')}
              </p>
            </div>
            <Switch
              checked={envConfig.memoryEnabled}
              onCheckedChange={(checked) => {
                updateEnvConfig({ memoryEnabled: checked });
                setSettings({ ...settings, memoryBackend: checked ? 'memory' : 'file' });
              }}
            />
          </div>

          {!envConfig.memoryEnabled && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                {t('integrations.memory.fileBasedNotice')}
              </p>
            </div>
          )}

          {envConfig.memoryEnabled && (
            <>
              {/* Embedding Provider Selection */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">{t('integrations.memory.embeddingProvider')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('integrations.memory.embeddingProviderDescription')}
                </p>
                <Select
                  value={embeddingProvider}
                  onValueChange={(value: MemoryEmbeddingProvider) => {
                    updateEnvConfig({
                      memoryProviderConfig: {
                        ...envConfig.memoryProviderConfig,
                        embeddingProvider: value,
                      }
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('integrations.memory.selectEmbeddingProvider')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ollama">{t('integrations.memory.providerOllama')}</SelectItem>
                    <SelectItem value="openai">{t('integrations.memory.providerOpenai')}</SelectItem>
                    <SelectItem value="voyage">{t('integrations.memory.providerVoyage')}</SelectItem>
                    <SelectItem value="google">{t('integrations.memory.providerGoogle')}</SelectItem>
                    <SelectItem value="azure_openai">{t('integrations.memory.providerAzure')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Provider-specific fields */}
              {renderProviderFields()}

              <Separator />

              {/* Database Settings */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">{t('integrations.memory.databaseName')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('integrations.memory.databaseNameDescription')}
                </p>
                <Input
                  placeholder="auto_claude_memory"
                  value={envConfig.memoryDatabase || ''}
                  onChange={(e) => updateEnvConfig({ memoryDatabase: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">{t('integrations.memory.databasePathOptional')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('integrations.memory.databasePathDescription')}
                </p>
                <Input
                  placeholder="~/.auto-claude/memories"
                  value={envConfig.memoryDbPath || ''}
                  onChange={(e) => updateEnvConfig({ memoryDbPath: e.target.value || undefined })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
