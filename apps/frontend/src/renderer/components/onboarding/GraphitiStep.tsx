import { useState, useEffect } from 'react';
import {
  Brain,
  Database,
  Info,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Zap,
  XCircle
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent } from '../ui/card';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { useSettingsStore } from '../../stores/settings-store';
import type { GraphitiLLMProvider, GraphitiEmbeddingProvider, AppSettings } from '../../../shared/types';
import { useTranslation } from 'react-i18next';

interface GraphitiStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

// Provider configurations with descriptions - will be populated from translations
const LLM_PROVIDERS: Array<{
  id: GraphitiLLMProvider;
  nameKey: string;
  descriptionKey: string;
  requiresApiKey: boolean;
}> = [
  { id: 'openai', nameKey: 'providers.openai.name', descriptionKey: 'providers.openai.description', requiresApiKey: true },
  { id: 'anthropic', nameKey: 'providers.anthropic.name', descriptionKey: 'providers.anthropic.description', requiresApiKey: true },
  { id: 'google', nameKey: 'providers.google.name', descriptionKey: 'providers.google.description', requiresApiKey: true },
  { id: 'groq', nameKey: 'providers.groq.name', descriptionKey: 'providers.groq.description', requiresApiKey: true },
  { id: 'openrouter', nameKey: 'providers.openrouter.name', descriptionKey: 'providers.openrouter.description', requiresApiKey: true },
  { id: 'azure_openai', nameKey: 'providers.azure_openai.name', descriptionKey: 'providers.azure_openai.description', requiresApiKey: true },
  { id: 'ollama', nameKey: 'providers.ollama.name', descriptionKey: 'providers.ollama.description', requiresApiKey: false }
];

const EMBEDDING_PROVIDERS: Array<{
  id: GraphitiEmbeddingProvider;
  nameKey: string;
  descriptionKey: string;
  requiresApiKey: boolean;
}> = [
  { id: 'ollama', nameKey: 'providers.ollama.name', descriptionKey: 'providers.ollama.description', requiresApiKey: false },
  { id: 'openai', nameKey: 'providers.openai.name', descriptionKey: 'providers.openai.description', requiresApiKey: true },
  { id: 'voyage', nameKey: 'providers.voyage.name', descriptionKey: 'providers.voyage.description', requiresApiKey: true },
  { id: 'google', nameKey: 'providers.google.name', descriptionKey: 'providers.google.description', requiresApiKey: true },
  { id: 'openrouter', nameKey: 'providers.openrouter.name', descriptionKey: 'providers.openrouter.description', requiresApiKey: true },
  { id: 'azure_openai', nameKey: 'providers.azure_openai.name', descriptionKey: 'providers.azure_openai.description', requiresApiKey: true }
];

interface GraphitiConfig {
  enabled: boolean;
  database: string;
  dbPath: string;
  llmProvider: GraphitiLLMProvider;
  embeddingProvider: GraphitiEmbeddingProvider;
  // OpenAI
  openaiApiKey: string;
  // Anthropic
  anthropicApiKey: string;
  // Azure OpenAI
  azureOpenaiApiKey: string;
  azureOpenaiBaseUrl: string;
  azureOpenaiLlmDeployment: string;
  azureOpenaiEmbeddingDeployment: string;
  // Voyage
  voyageApiKey: string;
  // Google
  googleApiKey: string;
  // Groq
  groqApiKey: string;
  // OpenRouter
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  openrouterLlmModel: string;
  openrouterEmbeddingModel: string;
  // HuggingFace
  huggingfaceApiKey: string;
  // Ollama
  ollamaBaseUrl: string;
  ollamaLlmModel: string;
  ollamaEmbeddingModel: string;
  ollamaEmbeddingDim: string;
}

interface ValidationStatus {
  database: { tested: boolean; success: boolean; message: string } | null;
  provider: { tested: boolean; success: boolean; message: string } | null;
}

/**
 * Graphiti memory configuration step for the onboarding wizard.
 * Uses LadybugDB (embedded database) - no Docker required.
 * Allows users to configure Graphiti memory backend with multiple provider options.
 */
export function GraphitiStep({ onNext, onBack, onSkip }: GraphitiStepProps) {
  const { t } = useTranslation(['onboarding', 'common']);
  const { settings, updateSettings } = useSettingsStore();
  const [config, setConfig] = useState<GraphitiConfig>({
    enabled: true,  // Enabled by default for better first-time experience
    database: 'auto_claude_memory',
    dbPath: '',
    llmProvider: 'openai',
    embeddingProvider: 'openai',
    openaiApiKey: settings.globalOpenAIApiKey || '',
    anthropicApiKey: settings.globalAnthropicApiKey || '',
    azureOpenaiApiKey: '',
    azureOpenaiBaseUrl: '',
    azureOpenaiLlmDeployment: '',
    azureOpenaiEmbeddingDeployment: '',
    voyageApiKey: '',
    googleApiKey: settings.globalGoogleApiKey || '',
    groqApiKey: settings.globalGroqApiKey || '',
    openrouterApiKey: settings.globalOpenRouterApiKey || '',
    openrouterBaseUrl: 'https://openrouter.ai/api/v1',
    openrouterLlmModel: 'anthropic/claude-sonnet-4',
    openrouterEmbeddingModel: 'openai/text-embedding-3-small',
    huggingfaceApiKey: '',
    ollamaBaseUrl: settings.ollamaBaseUrl || 'http://localhost:11434',
    ollamaLlmModel: '',
    ollamaEmbeddingModel: '',
    ollamaEmbeddingDim: '768'
  });
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isCheckingInfra, setIsCheckingInfra] = useState(true);
  const [kuzuAvailable, setKuzuAvailable] = useState<boolean | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>({
    database: null,
    provider: null
  });

  // Check LadybugDB/Kuzu availability on mount
  useEffect(() => {
    const checkInfrastructure = async () => {
      setIsCheckingInfra(true);
      try {
        const result = await window.electronAPI.getMemoryInfrastructureStatus();
        setKuzuAvailable(!!(result?.success && result?.data?.memory?.kuzuInstalled));
      } catch {
        setKuzuAvailable(false);
      } finally {
        setIsCheckingInfra(false);
      }
    };

    checkInfrastructure();
  }, []);

  const handleToggleEnabled = (checked: boolean) => {
    setConfig(prev => ({ ...prev, enabled: checked }));
    setError(null);
    setSuccess(false);
    setValidationStatus({ database: null, provider: null });
  };

  const toggleShowApiKey = (key: string) => {
    setShowApiKey(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Get the required API key for the current provider configuration
  const getRequiredApiKey = (): string | null => {
    const { llmProvider, embeddingProvider } = config;

    // Check LLM provider
    if (llmProvider === 'openai' || embeddingProvider === 'openai') {
      if (!config.openaiApiKey.trim()) return t('onboarding:graphiti.providers.openai.apiKey');
    }
    if (llmProvider === 'anthropic') {
      if (!config.anthropicApiKey.trim()) return t('onboarding:graphiti.providers.anthropic.apiKey');
    }
    if (llmProvider === 'azure_openai' || embeddingProvider === 'azure_openai') {
      if (!config.azureOpenaiApiKey.trim()) return t('onboarding:graphiti.providers.azure_openai.apiKey');
      if (!config.azureOpenaiBaseUrl.trim()) return t('onboarding:graphiti.providers.azure_openai.baseUrl');
      if (llmProvider === 'azure_openai' && !config.azureOpenaiLlmDeployment.trim()) {
        return t('onboarding:graphiti.providers.azure_openai.llmDeployment');
      }
      if (embeddingProvider === 'azure_openai' && !config.azureOpenaiEmbeddingDeployment.trim()) {
        return t('onboarding:graphiti.providers.azure_openai.embeddingDeployment');
      }
    }
    if (embeddingProvider === 'voyage') {
      if (!config.voyageApiKey.trim()) return t('onboarding:graphiti.voyage.apiKey');
    }
    if (llmProvider === 'google' || embeddingProvider === 'google') {
      if (!config.googleApiKey.trim()) return t('onboarding:graphiti.providers.google.apiKey');
    }
    if (llmProvider === 'groq') {
      if (!config.groqApiKey.trim()) return t('onboarding:graphiti.providers.groq.apiKey');
    }
    if (llmProvider === 'openrouter' || embeddingProvider === 'openrouter') {
      if (!config.openrouterApiKey.trim()) return t('onboarding:graphiti.providers.openrouter.apiKey');
    }
    if (llmProvider === 'ollama') {
      if (!config.ollamaLlmModel.trim()) return t('onboarding:graphiti.providers.ollama.llmModel');
    }
    if (embeddingProvider === 'ollama') {
      if (!config.ollamaEmbeddingModel.trim()) return t('onboarding:graphiti.providers.ollama.embeddingModel');
    }

    return null;
  };

  const handleTestConnection = async () => {
    const missingKey = getRequiredApiKey();
    if (missingKey) {
      setError(`Please enter ${missingKey} to test the connection`);
      return;
    }

    setIsValidating(true);
    setError(null);
    setValidationStatus({ database: null, provider: null });

    try {
      // Get the API key for the current LLM provider
      const apiKey = config.llmProvider === 'openai' ? config.openaiApiKey :
                     config.llmProvider === 'anthropic' ? config.anthropicApiKey :
                     config.llmProvider === 'google' ? config.googleApiKey :
                     config.llmProvider === 'groq' ? config.groqApiKey :
                     config.llmProvider === 'openrouter' ? config.openrouterApiKey :
                     config.llmProvider === 'azure_openai' ? config.azureOpenaiApiKey :
                     config.llmProvider === 'ollama' ? '' :  // Ollama doesn't need API key
                     config.embeddingProvider === 'openai' ? config.openaiApiKey :
                     config.embeddingProvider === 'openrouter' ? config.openrouterApiKey : '';

      const result = await window.electronAPI.testGraphitiConnection({
        dbPath: config.dbPath || undefined,
        database: config.database || 'auto_claude_memory',
        llmProvider: config.llmProvider,
        apiKey: apiKey.trim()
      });

      if (result?.success && result?.data) {
        setValidationStatus({
          database: {
            tested: true,
            success: result.data.database.success,
            message: result.data.database.message
          },
          provider: {
            tested: true,
            success: result.data.llmProvider.success,
            message: result.data.llmProvider.success
              ? `${config.llmProvider} / ${config.embeddingProvider} providers configured`
              : result.data.llmProvider.message
          }
        });

        if (!result.data.ready) {
          const errors: string[] = [];
          if (!result.data.database.success) {
            errors.push(`Database: ${result.data.database.message}`);
          }
          if (!result.data.llmProvider.success) {
            errors.push(`Provider: ${result.data.llmProvider.message}`);
          }
          if (errors.length > 0) {
            setError(errors.join('\n'));
          }
        }
      } else {
        setError(result?.error || 'Failed to test connection');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    if (!config.enabled) {
      onNext();
      return;
    }

    const missingKey = getRequiredApiKey();
    if (missingKey) {
      setError(`${missingKey} is required`);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Save the primary API keys to global settings based on providers
      const settingsToSave: Record<string, string> = {
        graphitiLlmProvider: config.llmProvider,
      };

      if (config.openaiApiKey.trim()) {
        settingsToSave.globalOpenAIApiKey = config.openaiApiKey.trim();
      }
      if (config.anthropicApiKey.trim()) {
        settingsToSave.globalAnthropicApiKey = config.anthropicApiKey.trim();
      }
      if (config.googleApiKey.trim()) {
        settingsToSave.globalGoogleApiKey = config.googleApiKey.trim();
      }
      if (config.groqApiKey.trim()) {
        settingsToSave.globalGroqApiKey = config.groqApiKey.trim();
      }
      if (config.openrouterApiKey.trim()) {
        settingsToSave.globalOpenRouterApiKey = config.openrouterApiKey.trim();
      }
      if (config.ollamaBaseUrl.trim()) {
        settingsToSave.ollamaBaseUrl = config.ollamaBaseUrl.trim();
      }

      const result = await window.electronAPI.saveSettings(settingsToSave);

      if (result?.success) {
        // Update local settings store with API key settings
        const storeUpdate: Partial<Pick<AppSettings, 'globalOpenAIApiKey' | 'globalAnthropicApiKey' | 'globalGoogleApiKey' | 'globalGroqApiKey' | 'globalOpenRouterApiKey' | 'ollamaBaseUrl'>> = {};
        if (config.openaiApiKey.trim()) storeUpdate.globalOpenAIApiKey = config.openaiApiKey.trim();
        if (config.anthropicApiKey.trim()) storeUpdate.globalAnthropicApiKey = config.anthropicApiKey.trim();
        if (config.googleApiKey.trim()) storeUpdate.globalGoogleApiKey = config.googleApiKey.trim();
        if (config.groqApiKey.trim()) storeUpdate.globalGroqApiKey = config.groqApiKey.trim();
        if (config.openrouterApiKey.trim()) storeUpdate.globalOpenRouterApiKey = config.openrouterApiKey.trim();
        if (config.ollamaBaseUrl.trim()) storeUpdate.ollamaBaseUrl = config.ollamaBaseUrl.trim();
        updateSettings(storeUpdate);
        onNext();
      } else {
        setError(result?.error || 'Failed to save Graphiti configuration');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  const handleContinue = () => {
    if (config.enabled && !success) {
      handleSave();
    } else {
      onNext();
    }
  };

  const handleOpenDocs = () => {
    window.open('https://github.com/getzep/graphiti', '_blank');
  };

  const handleReconfigure = () => {
    setSuccess(false);
    setError(null);
  };

  // Render provider-specific configuration fields
  const renderProviderFields = () => {
    const { llmProvider, embeddingProvider } = config;
    const needsOpenAI = llmProvider === 'openai' || embeddingProvider === 'openai';
    const needsAnthropic = llmProvider === 'anthropic';
    const needsAzure = llmProvider === 'azure_openai' || embeddingProvider === 'azure_openai';
    const needsVoyage = embeddingProvider === 'voyage';
    const needsGoogle = llmProvider === 'google' || embeddingProvider === 'google';
    const needsGroq = llmProvider === 'groq';
    const needsOpenRouter = llmProvider === 'openrouter' || embeddingProvider === 'openrouter';
    const needsOllama = llmProvider === 'ollama' || embeddingProvider === 'ollama';

    return (
      <div className="space-y-4">
        {/* OpenAI API Key */}
        {needsOpenAI && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="openai-key" className="text-sm font-medium text-foreground">
                {t('onboarding:graphiti.providers.openai.apiKey')}
              </Label>
              {validationStatus.provider?.tested && needsOpenAI && (
                <div className="flex items-center gap-1.5">
                  {validationStatus.provider.success ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                </div>
              )}
            </div>
            <div className="relative">
              <Input
                id="openai-key"
                type={showApiKey['openai'] ? 'text' : 'password'}
                value={config.openaiApiKey}
                onChange={(e) => {
                  setConfig(prev => ({ ...prev, openaiApiKey: e.target.value }));
                  setValidationStatus(prev => ({ ...prev, provider: null }));
                }}
                placeholder={t('onboarding:graphiti.placeholders.openai')}
                className="pr-10 font-mono text-sm"
                disabled={isSaving || isValidating}
              />
              <button
                type="button"
                onClick={() => toggleShowApiKey('openai')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey['openai'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('onboarding:graphiti.providers.openai.getYourKeyFrom')}{' '}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                {t('onboarding:graphiti.providers.openai.keyLink')}
              </a>
            </p>
          </div>
        )}

        {/* Anthropic API Key */}
        {needsAnthropic && (
          <div className="space-y-2">
            <Label htmlFor="anthropic-key" className="text-sm font-medium text-foreground">
              {t('onboarding:graphiti.providers.anthropic.apiKey')}
            </Label>
            <div className="relative">
              <Input
                id="anthropic-key"
                type={showApiKey['anthropic'] ? 'text' : 'password'}
                value={config.anthropicApiKey}
                onChange={(e) => setConfig(prev => ({ ...prev, anthropicApiKey: e.target.value }))}
                placeholder={t('onboarding:graphiti.placeholders.anthropic')}
                className="pr-10 font-mono text-sm"
                disabled={isSaving || isValidating}
              />
              <button
                type="button"
                onClick={() => toggleShowApiKey('anthropic')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey['anthropic'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('onboarding:graphiti.providers.anthropic.getYourKeyFrom')}{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                {t('onboarding:graphiti.providers.anthropic.keyLink')}
              </a>
            </p>
          </div>
        )}

        {/* Azure OpenAI Settings */}
        {needsAzure && (
          <div className="space-y-3 p-3 rounded-md bg-muted/50">
            <p className="text-sm font-medium text-foreground">{t('onboarding:graphiti.providers.azure_openai.name')}</p>
            <div className="space-y-2">
              <Label htmlFor="azure-key" className="text-xs text-muted-foreground">{t('onboarding:graphiti.providers.azure_openai.apiKey')}</Label>
              <div className="relative">
                <Input
                  id="azure-key"
                  type={showApiKey['azure'] ? 'text' : 'password'}
                  value={config.azureOpenaiApiKey}
                  onChange={(e) => setConfig(prev => ({ ...prev, azureOpenaiApiKey: e.target.value }))}
                  placeholder={t('onboarding:graphiti.placeholders.azureApiKey')}
                  className="pr-10 font-mono text-sm"
                  disabled={isSaving || isValidating}
                />
                <button
                  type="button"
                  onClick={() => toggleShowApiKey('azure')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey['azure'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="azure-url" className="text-xs text-muted-foreground">{t('onboarding:graphiti.providers.azure_openai.baseUrl')}</Label>
              <Input
                id="azure-url"
                type="text"
                value={config.azureOpenaiBaseUrl}
                onChange={(e) => setConfig(prev => ({ ...prev, azureOpenaiBaseUrl: e.target.value }))}
                placeholder={t('onboarding:graphiti.placeholders.azureBaseUrl')}
                className="font-mono text-sm"
                disabled={isSaving || isValidating}
              />
            </div>
            {llmProvider === 'azure_openai' && (
              <div className="space-y-2">
                <Label htmlFor="azure-llm-deployment" className="text-xs text-muted-foreground">{t('onboarding:graphiti.providers.azure_openai.llmDeployment')}</Label>
                <Input
                  id="azure-llm-deployment"
                  type="text"
                  value={config.azureOpenaiLlmDeployment}
                  onChange={(e) => setConfig(prev => ({ ...prev, azureOpenaiLlmDeployment: e.target.value }))}
                  placeholder={t('onboarding:graphiti.placeholders.azureLlmDeployment')}
                  className="font-mono text-sm"
                  disabled={isSaving || isValidating}
                />
              </div>
            )}
            {embeddingProvider === 'azure_openai' && (
              <div className="space-y-2">
                <Label htmlFor="azure-embedding-deployment" className="text-xs text-muted-foreground">{t('onboarding:graphiti.providers.azure_openai.embeddingDeployment')}</Label>
                <Input
                  id="azure-embedding-deployment"
                  type="text"
                  value={config.azureOpenaiEmbeddingDeployment}
                  onChange={(e) => setConfig(prev => ({ ...prev, azureOpenaiEmbeddingDeployment: e.target.value }))}
                  placeholder={t('onboarding:graphiti.placeholders.azureEmbeddingDeployment')}
                  className="font-mono text-sm"
                  disabled={isSaving || isValidating}
                />
              </div>
            )}
          </div>
        )}

        {/* Voyage API Key */}
        {needsVoyage && (
          <div className="space-y-2">
            <Label htmlFor="voyage-key" className="text-sm font-medium text-foreground">
              {t('onboarding:graphiti.voyage.apiKey')}
            </Label>
            <div className="relative">
              <Input
                id="voyage-key"
                type={showApiKey['voyage'] ? 'text' : 'password'}
                value={config.voyageApiKey}
                onChange={(e) => setConfig(prev => ({ ...prev, voyageApiKey: e.target.value }))}
                placeholder={t('onboarding:graphiti.placeholders.voyage')}
                className="pr-10 font-mono text-sm"
                disabled={isSaving || isValidating}
              />
              <button
                type="button"
                onClick={() => toggleShowApiKey('voyage')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey['voyage'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('onboarding:graphiti.voyage.getYourKeyFrom')}{' '}
              <a href="https://dash.voyageai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                {t('onboarding:graphiti.voyage.keyLink')}
              </a>
            </p>
          </div>
        )}

        {/* Google API Key */}
        {needsGoogle && (
          <div className="space-y-2">
            <Label htmlFor="google-key" className="text-sm font-medium text-foreground">
              {t('onboarding:graphiti.providers.google.apiKey')}
            </Label>
            <div className="relative">
              <Input
                id="google-key"
                type={showApiKey['google'] ? 'text' : 'password'}
                value={config.googleApiKey}
                onChange={(e) => setConfig(prev => ({ ...prev, googleApiKey: e.target.value }))}
                placeholder={t('onboarding:graphiti.placeholders.google')}
                className="pr-10 font-mono text-sm"
                disabled={isSaving || isValidating}
              />
              <button
                type="button"
                onClick={() => toggleShowApiKey('google')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey['google'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('onboarding:graphiti.providers.google.getYourKeyFrom')}{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                {t('onboarding:graphiti.providers.google.keyLink')}
              </a>
            </p>
          </div>
        )}

        {/* Groq API Key */}
        {needsGroq && (
          <div className="space-y-2">
            <Label htmlFor="groq-key" className="text-sm font-medium text-foreground">
              {t('onboarding:graphiti.providers.groq.apiKey')}
            </Label>
            <div className="relative">
              <Input
                id="groq-key"
                type={showApiKey['groq'] ? 'text' : 'password'}
                value={config.groqApiKey}
                onChange={(e) => setConfig(prev => ({ ...prev, groqApiKey: e.target.value }))}
                placeholder={t('onboarding:graphiti.placeholders.groq')}
                className="pr-10 font-mono text-sm"
                disabled={isSaving || isValidating}
              />
              <button
                type="button"
                onClick={() => toggleShowApiKey('groq')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey['groq'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('onboarding:graphiti.providers.groq.getYourKeyFrom')}{' '}
              <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                {t('onboarding:graphiti.providers.groq.keyLink')}
              </a>
            </p>
          </div>
        )}

        {/* OpenRouter API Key */}
        {needsOpenRouter && (
          <div className="space-y-2">
            <Label htmlFor="openrouter-key" className="text-sm font-medium text-foreground">
              {t('onboarding:graphiti.providers.openrouter.apiKey')}
            </Label>
            <div className="relative">
              <Input
                id="openrouter-key"
                type={showApiKey['openrouter'] ? 'text' : 'password'}
                value={config.openrouterApiKey}
                onChange={(e) => setConfig(prev => ({ ...prev, openrouterApiKey: e.target.value }))}
                placeholder={t('onboarding:graphiti.placeholders.openrouter')}
                className="pr-10 font-mono text-sm"
                disabled={isSaving || isValidating}
              />
              <button
                type="button"
                onClick={() => toggleShowApiKey('openrouter')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey['openrouter'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('onboarding:graphiti.providers.openrouter.getYourKeyFrom')}{' '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                {t('onboarding:graphiti.providers.openrouter.keyLink')}
              </a>
            </p>
          </div>
        )}

        {/* Ollama Settings */}
        {needsOllama && (
          <div className="space-y-3 p-3 rounded-md bg-muted/50">
            <p className="text-sm font-medium text-foreground">{t('onboarding:graphiti.providers.ollama.settings')}</p>
            <div className="space-y-2">
              <Label htmlFor="ollama-url" className="text-xs text-muted-foreground">{t('onboarding:graphiti.providers.ollama.baseUrl')}</Label>
              <Input
                id="ollama-url"
                type="text"
                value={config.ollamaBaseUrl}
                onChange={(e) => setConfig(prev => ({ ...prev, ollamaBaseUrl: e.target.value }))}
                placeholder={t('onboarding:graphiti.placeholders.ollamaBaseUrl')}
                className="font-mono text-sm"
                disabled={isSaving || isValidating}
              />
            </div>
            {llmProvider === 'ollama' && (
              <div className="space-y-2">
                <Label htmlFor="ollama-llm" className="text-xs text-muted-foreground">{t('onboarding:graphiti.providers.ollama.llmModel')}</Label>
                <Input
                  id="ollama-llm"
                  type="text"
                  value={config.ollamaLlmModel}
                  onChange={(e) => setConfig(prev => ({ ...prev, ollamaLlmModel: e.target.value }))}
                  placeholder={t('onboarding:graphiti.placeholders.ollamaLlmModel')}
                  className="font-mono text-sm"
                  disabled={isSaving || isValidating}
                />
              </div>
            )}
            {embeddingProvider === 'ollama' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ollama-embedding" className="text-xs text-muted-foreground">{t('onboarding:graphiti.providers.ollama.embeddingModel')}</Label>
                  <Input
                    id="ollama-embedding"
                    type="text"
                    value={config.ollamaEmbeddingModel}
                    onChange={(e) => setConfig(prev => ({ ...prev, ollamaEmbeddingModel: e.target.value }))}
                    placeholder={t('onboarding:graphiti.placeholders.ollamaEmbeddingModel')}
                    className="font-mono text-sm"
                    disabled={isSaving || isValidating}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ollama-dim" className="text-xs text-muted-foreground">{t('onboarding:graphiti.providers.ollama.embeddingDimension')}</Label>
                  <Input
                    id="ollama-dim"
                    type="number"
                    value={config.ollamaEmbeddingDim}
                    onChange={(e) => setConfig(prev => ({ ...prev, ollamaEmbeddingDim: e.target.value }))}
                    placeholder={t('onboarding:graphiti.placeholders.ollamaEmbeddingDim')}
                    className="font-mono text-sm"
                    disabled={isSaving || isValidating}
                  />
                </div>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              {t('onboarding:graphiti.providers.ollama.ensureRunning')}{' '}
              <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                {t('onboarding:graphiti.providers.ollama.link')}
              </a>
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Brain className="h-7 w-7" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            {t('onboarding:graphiti.title')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {t('onboarding:graphiti.description')}
          </p>
        </div>

        {/* Loading state for infrastructure check */}
        {isCheckingInfra && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Main content */}
        {!isCheckingInfra && (
          <div className="space-y-6">
            {/* Success state */}
            {success && (
              <Card className="border border-success/30 bg-success/10">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <CheckCircle2 className="h-6 w-6 text-success shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="text-lg font-medium text-success">
                        {t('onboarding:graphiti.configuredSuccessfully')}
                      </h3>
                      <p className="mt-1 text-sm text-success/80">
                        {t('onboarding:graphiti.configuredSuccessfullyDescription')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Reconfigure link after success */}
            {success && (
              <div className="text-center text-sm text-muted-foreground">
                <button
                  onClick={handleReconfigure}
                  className="text-primary hover:text-primary/80 underline-offset-4 hover:underline"
                >
                  {t('onboarding:graphiti.reconfigureSettings')}
                </button>
              </div>
            )}

            {/* Configuration form */}
            {!success && (
              <>
                {/* Error banner */}
                {error && (
                  <Card className="border border-destructive/30 bg-destructive/10">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                        <p className="text-sm text-destructive whitespace-pre-line">{error}</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Kuzu status notice */}
                {kuzuAvailable === false && (
                  <Card className="border border-info/30 bg-info/10">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-info">
                            {t('onboarding:graphiti.databaseAutoCreated')}
                          </p>
                          <p className="text-sm text-info/80 mt-1">
                            {t('onboarding:graphiti.databaseAutoCreatedDescription')}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Info card about Graphiti */}
                <Card className="border border-info/30 bg-info/10">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-3">
                        <p className="text-sm font-medium text-foreground">
                          {t('onboarding:graphiti.whatIsGraphiti')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('onboarding:graphiti.whatIsGraphitiDescription')}
                        </p>
                        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
                          <li>{t('onboarding:graphiti.benefits.persistentMemory')}</li>
                          <li>{t('onboarding:graphiti.benefits.betterUnderstanding')}</li>
                          <li>{t('onboarding:graphiti.benefits.reducesRepetition')}</li>
                          <li>{t('onboarding:graphiti.benefits.noDocker')}</li>
                        </ul>
                        <button
                          onClick={handleOpenDocs}
                          className="text-sm text-info hover:text-info/80 flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t('onboarding:graphiti.learnMoreAboutGraphiti')}
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Enable toggle */}
                <Card className="border border-border bg-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Database className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <Label htmlFor="enable-graphiti" className="text-sm font-medium text-foreground cursor-pointer">
                            {t('onboarding:graphiti.enableGraphitiMemory')}
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t('onboarding:graphiti.enableGraphitiDescription')}
                          </p>
                        </div>
                      </div>
                      <Switch
                        id="enable-graphiti"
                        checked={config.enabled}
                        onCheckedChange={handleToggleEnabled}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Configuration fields (shown when enabled) */}
                {config.enabled && (
                  <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
                    {/* Database Settings */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="database-name" className="text-sm font-medium text-foreground">
                            {t('onboarding:graphiti.databaseName')}
                          </Label>
                        </div>
                        {validationStatus.database && (
                          <div className="flex items-center gap-1.5">
                            {validationStatus.database.success ? (
                              <CheckCircle2 className="h-4 w-4 text-success" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                            <span className={`text-xs ${validationStatus.database.success ? 'text-success' : 'text-destructive'}`}>
                              {validationStatus.database.success ? t('onboarding:graphiti.ready') : t('onboarding:graphiti.issue')}
                            </span>
                          </div>
                        )}
                      </div>
                      <Input
                        id="database-name"
                        type="text"
                        value={config.database}
                        onChange={(e) => {
                          setConfig(prev => ({ ...prev, database: e.target.value }));
                          setValidationStatus(prev => ({ ...prev, database: null }));
                        }}
                        placeholder={t('onboarding:graphiti.placeholders.databaseName')}
                        className="font-mono text-sm"
                        disabled={isSaving || isValidating}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('onboarding:graphiti.databaseLocation')}
                      </p>
                    </div>

                    {/* Provider Selection */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* LLM Provider */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-foreground">
                          {t('onboarding:graphiti.llmProvider')}
                        </Label>
                        <Select
                          value={config.llmProvider}
                          onValueChange={(value: GraphitiLLMProvider) => {
                            setConfig(prev => ({ ...prev, llmProvider: value }));
                            setValidationStatus(prev => ({ ...prev, provider: null }));
                          }}
                          disabled={isSaving || isValidating}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LLM_PROVIDERS.map(p => (
                              <SelectItem key={p.id} value={p.id}>
                                <div className="flex flex-col">
                                  <span>{t(`onboarding:graphiti.${p.nameKey}`)}</span>
                                  <span className="text-xs text-muted-foreground">{t(`onboarding:graphiti.${p.descriptionKey}`)}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Embedding Provider */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-foreground">
                          {t('onboarding:graphiti.embeddingProvider')}
                        </Label>
                        <Select
                          value={config.embeddingProvider}
                          onValueChange={(value: GraphitiEmbeddingProvider) => {
                            setConfig(prev => ({ ...prev, embeddingProvider: value }));
                            setValidationStatus(prev => ({ ...prev, provider: null }));
                          }}
                          disabled={isSaving || isValidating}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EMBEDDING_PROVIDERS.map(p => (
                              <SelectItem key={p.id} value={p.id}>
                                <div className="flex flex-col">
                                  <span>{t(`onboarding:graphiti.${p.nameKey}`)}</span>
                                  <span className="text-xs text-muted-foreground">{t(`onboarding:graphiti.${p.descriptionKey}`)}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Provider-specific fields */}
                    {renderProviderFields()}

                    {/* Test Connection Button */}
                    <div className="pt-2">
                      <Button
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={!!getRequiredApiKey() || isValidating || isSaving}
                        className="w-full"
                      >
                        {isValidating ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            {t('onboarding:graphiti.testingConnection')}
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4 mr-2" />
                            {t('onboarding:graphiti.testConnection')}
                          </>
                        )}
                      </Button>
                      {validationStatus.database?.success && validationStatus.provider?.success && (
                        <p className="text-xs text-success text-center mt-2">
                          {t('onboarding:graphiti.allConnectionsValidated')}
                        </p>
                      )}
                      {config.llmProvider !== 'openai' && config.llmProvider !== 'ollama' && (
                        <p className="text-xs text-muted-foreground text-center mt-2">
                          {t('onboarding:graphiti.validationNote')}
                        </p>
                      )}
                      {config.llmProvider === 'ollama' && (
                        <p className="text-xs text-muted-foreground text-center mt-2">
                          {t('onboarding:graphiti.ollamaValidationNote')}
                        </p>
                      )}
                    </div>
                  </div>
                )}
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
            {t('onboarding:oauth.buttons.back')}
          </Button>
          <div className="flex gap-4">
            <Button
              variant="ghost"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('onboarding:oauth.buttons.skip')}
            </Button>
            <Button
              onClick={handleContinue}
              disabled={isCheckingInfra || (config.enabled && !!getRequiredApiKey() && !success) || isSaving || isValidating}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t('onboarding:memory.saving')}
                </>
              ) : config.enabled && !success ? (
                t('onboarding:memory.saveAndContinue')
              ) : (
                t('onboarding:oauth.buttons.continue')
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
