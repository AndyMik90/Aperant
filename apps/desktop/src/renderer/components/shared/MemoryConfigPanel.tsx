import { useTranslation } from 'react-i18next';
import { Database, Info, ExternalLink } from 'lucide-react';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Separator } from '../ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Input } from '../ui/input';
import { PasswordInput } from '../project-settings/PasswordInput';
import { OllamaModelSelector } from '../onboarding/OllamaModelSelector';
import type { MemoryEmbeddingProvider } from '../../../shared/types';

export interface MemoryPanelConfig {
  enabled: boolean;
  embeddingProvider: MemoryEmbeddingProvider;
  // OpenAI
  openaiApiKey: string;
  openaiEmbeddingModel: string;
  // Azure OpenAI
  azureOpenaiApiKey: string;
  azureOpenaiBaseUrl: string;
  azureOpenaiEmbeddingDeployment: string;
  // Voyage
  voyageApiKey: string;
  voyageEmbeddingModel: string;
  // Google
  googleApiKey: string;
  googleEmbeddingModel: string;
  // Ollama
  ollamaBaseUrl: string;
  ollamaEmbeddingModel: string;
  ollamaEmbeddingDim: number;
}

interface MemoryConfigPanelProps {
  config: MemoryPanelConfig;
  onChange: (updates: Partial<MemoryPanelConfig>) => void;
  disabled?: boolean;
}

/**
 * Shared memory configuration panel used in both the onboarding wizard and project settings.
 *
 * Includes:
 * - Enable Memory toggle
 * - Memory disabled info card
 * - Embedding provider dropdown (when enabled)
 * - Provider-specific credential fields (when enabled)
 * - Info card about memory
 *
 * Does NOT include: InfrastructureStatus, Agent Memory Access toggle, MCP Server URL.
 */
export function MemoryConfigPanel({ config, onChange, disabled = false }: MemoryConfigPanelProps) {
  const { t } = useTranslation('onboarding');

  return (
    <div className="space-y-6">
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
          onCheckedChange={(checked) => onChange({ enabled: checked })}
          disabled={disabled}
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
          <Separator />

          {/* Embedding Provider Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{t('memory.embeddingProvider')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('memory.embeddingProviderDescription')}
            </p>
            <Select
              value={config.embeddingProvider}
              onValueChange={(value: MemoryEmbeddingProvider) => onChange({ embeddingProvider: value })}
              disabled={disabled}
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

          {/* OpenAI */}
          {config.embeddingProvider === 'openai' && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{t('memory.openaiApiKey')}</Label>
              <p className="text-xs text-muted-foreground">{t('memory.openaiApiKeyDescription')}</p>
              <PasswordInput
                value={config.openaiApiKey}
                onChange={(value) => onChange({ openaiApiKey: value })}
                placeholder="sk-..."
              />
              <div className="space-y-1 mt-2">
                <Label className="text-xs text-muted-foreground">{t('memory.embeddingModel')}</Label>
                <Select
                  value={config.openaiEmbeddingModel || 'text-embedding-3-small'}
                  onValueChange={(value) => onChange({ openaiEmbeddingModel: value })}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text-embedding-3-small">text-embedding-3-small (default, cheapest)</SelectItem>
                    <SelectItem value="text-embedding-3-large">text-embedding-3-large (higher quality)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('memory.openaiGetKey')}{' '}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80"
                >
                  OpenAI
                </a>
              </p>
            </div>
          )}

          {/* Voyage AI */}
          {config.embeddingProvider === 'voyage' && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{t('memory.voyageApiKey')}</Label>
              <p className="text-xs text-muted-foreground">{t('memory.voyageApiKeyDescription')}</p>
              <PasswordInput
                value={config.voyageApiKey}
                onChange={(value) => onChange({ voyageApiKey: value })}
                placeholder="pa-..."
              />
              <div className="space-y-1 mt-2">
                <Label className="text-xs text-muted-foreground">{t('memory.embeddingModel')}</Label>
                <Input
                  placeholder="voyage-3"
                  value={config.voyageEmbeddingModel}
                  onChange={(e) => onChange({ voyageEmbeddingModel: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t('memory.openaiGetKey')}{' '}
                <a
                  href="https://dash.voyageai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80"
                >
                  Voyage AI
                </a>
              </p>
            </div>
          )}

          {/* Google AI */}
          {config.embeddingProvider === 'google' && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{t('memory.googleApiKey')}</Label>
              <p className="text-xs text-muted-foreground">{t('memory.googleApiKeyDescription')}</p>
              <PasswordInput
                value={config.googleApiKey}
                onChange={(value) => onChange({ googleApiKey: value })}
                placeholder="AIza..."
              />
              <div className="space-y-1 mt-2">
                <Label className="text-xs text-muted-foreground">{t('memory.embeddingModel')}</Label>
                <Select
                  value={config.googleEmbeddingModel || 'gemini-embedding-001'}
                  onValueChange={(value) => onChange({ googleEmbeddingModel: value })}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini-embedding-001">gemini-embedding-001 (default)</SelectItem>
                    <SelectItem value="text-embedding-004">text-embedding-004</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('memory.openaiGetKey')}{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80"
                >
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
                  onChange={(value) => onChange({ azureOpenaiApiKey: value })}
                  placeholder="Azure API Key"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('memory.azureBaseUrl')}</Label>
                <Input
                  placeholder="https://your-resource.openai.azure.com"
                  value={config.azureOpenaiBaseUrl}
                  onChange={(e) => onChange({ azureOpenaiBaseUrl: e.target.value })}
                  className="font-mono text-sm"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('memory.azureEmbeddingDeployment')}</Label>
                <Input
                  placeholder="text-embedding-ada-002"
                  value={config.azureOpenaiEmbeddingDeployment}
                  onChange={(e) => onChange({ azureOpenaiEmbeddingDeployment: e.target.value })}
                  className="font-mono text-sm"
                  disabled={disabled}
                />
              </div>
            </div>
          )}

          {/* Ollama (Local) */}
          {config.embeddingProvider === 'ollama' && (
            <div className="space-y-4">
              <Label className="text-sm font-medium text-foreground">{t('memory.ollamaConfig')}</Label>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t('memory.baseUrl')}</Label>
                <Input
                  placeholder="http://localhost:11434"
                  value={config.ollamaBaseUrl}
                  onChange={(e) => onChange({ ollamaBaseUrl: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t('memory.embeddingModel')}</Label>
                <OllamaModelSelector
                  selectedModel={config.ollamaEmbeddingModel}
                  baseUrl={config.ollamaBaseUrl}
                  onModelSelect={(model, dim) => onChange({ ollamaEmbeddingModel: model, ollamaEmbeddingDim: dim })}
                  disabled={disabled}
                />
              </div>
            </div>
          )}

          {/* Info card */}
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
  );
}
