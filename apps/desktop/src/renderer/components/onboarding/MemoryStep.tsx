import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { useSettingsStore } from '../../stores/settings-store';
import type { AppSettings } from '../../../shared/types';
import { MemoryConfigPanel, type MemoryPanelConfig } from '../shared/MemoryConfigPanel';

interface MemoryStepProps {
  onNext: () => void;
  onBack: () => void;
}

/**
 * Memory configuration step for the onboarding wizard.
 *
 * Shows a simplified view: header, MemoryConfigPanel, and Back/Skip/Save buttons.
 */
export function MemoryStep({ onNext, onBack }: MemoryStepProps) {
  const { t } = useTranslation('onboarding');
  const { settings, updateSettings } = useSettingsStore();

  const [config, setConfig] = useState<MemoryPanelConfig>({
    enabled: true,
    embeddingProvider: 'ollama',
    openaiApiKey: settings.globalOpenAIApiKey || '',
    openaiEmbeddingModel: settings.memoryOpenaiEmbeddingModel || '',
    azureOpenaiApiKey: '',
    azureOpenaiBaseUrl: '',
    azureOpenaiEmbeddingDeployment: '',
    voyageApiKey: '',
    voyageEmbeddingModel: settings.memoryVoyageEmbeddingModel || '',
    googleApiKey: settings.globalGoogleApiKey || '',
    googleEmbeddingModel: settings.memoryGoogleEmbeddingModel || '',
    ollamaBaseUrl: settings.ollamaBaseUrl || 'http://localhost:11434',
    ollamaEmbeddingModel: settings.memoryOllamaEmbeddingModel || 'qwen3-embedding:4b',
    ollamaEmbeddingDim: settings.memoryOllamaEmbeddingDim ?? 2560,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConfigValid = (): boolean => {
    if (!config.enabled) return true;
    const { embeddingProvider } = config;
    if (embeddingProvider === 'ollama') return !!config.ollamaEmbeddingModel.trim();
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
      const settingsToSave: Record<string, string | number | boolean | undefined> = {
        memoryEnabled: config.enabled,
        memoryEmbeddingProvider: config.embeddingProvider,
        ollamaBaseUrl: config.ollamaBaseUrl || undefined,
        memoryOllamaEmbeddingModel: config.ollamaEmbeddingModel || undefined,
        memoryOllamaEmbeddingDim: config.ollamaEmbeddingDim || undefined,
        globalOpenAIApiKey: config.openaiApiKey.trim() || undefined,
        memoryOpenaiEmbeddingModel: config.openaiEmbeddingModel?.trim() || undefined,
        globalGoogleApiKey: config.googleApiKey.trim() || undefined,
        memoryGoogleEmbeddingModel: config.googleEmbeddingModel?.trim() || undefined,
        memoryVoyageApiKey: config.voyageApiKey.trim() || undefined,
        memoryVoyageEmbeddingModel: config.voyageEmbeddingModel.trim() || undefined,
        memoryAzureApiKey: config.azureOpenaiApiKey.trim() || undefined,
        memoryAzureBaseUrl: config.azureOpenaiBaseUrl.trim() || undefined,
        memoryAzureEmbeddingDeployment: config.azureOpenaiEmbeddingDeployment.trim() || undefined,
      };

      const result = await window.electronAPI.saveSettings(settingsToSave);

      if (result?.success) {
        const storeUpdate: Partial<AppSettings> = {
          memoryEnabled: config.enabled,
          memoryEmbeddingProvider: config.embeddingProvider,
          ollamaBaseUrl: config.ollamaBaseUrl || undefined,
          memoryOllamaEmbeddingModel: config.ollamaEmbeddingModel || undefined,
          memoryOllamaEmbeddingDim: config.ollamaEmbeddingDim || undefined,
          globalOpenAIApiKey: config.openaiApiKey.trim() || undefined,
          memoryOpenaiEmbeddingModel: config.openaiEmbeddingModel?.trim() || undefined,
          globalGoogleApiKey: config.googleApiKey.trim() || undefined,
          memoryGoogleEmbeddingModel: config.googleEmbeddingModel?.trim() || undefined,
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

        {/* Error banner */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 mb-6">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Shared memory config panel */}
        <MemoryConfigPanel
          config={config}
          onChange={(updates) => setConfig((prev) => ({ ...prev, ...updates }))}
          disabled={isSaving}
        />

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
              disabled={isSaving}
            >
              {t('memory.skip')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isConfigValid() || isSaving}
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
