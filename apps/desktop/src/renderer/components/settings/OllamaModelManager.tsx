import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Check, Loader2, RefreshCw, Package } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { useDownloadStore } from '../../stores/download-store';

interface InstalledModel {
  name: string;
  size_bytes: number;
  is_embedding: boolean;
}

interface RecommendedCodingModel {
  name: string;
  description: string;
  size: string;
  badge?: 'recommended' | 'fast' | 'quality';
}

const RECOMMENDED_CODING_MODELS: RecommendedCodingModel[] = [
  { name: 'qwen3:32b', description: 'Qwen3 32B - Excellent coding model', size: '20 GB', badge: 'recommended' as const },
  { name: 'qwen3:8b', description: 'Qwen3 8B - Fast and capable', size: '5.2 GB', badge: 'fast' as const },
  { name: 'deepseek-r1:32b', description: 'DeepSeek R1 32B - Strong reasoning', size: '20 GB' },
  { name: 'deepseek-r1:8b', description: 'DeepSeek R1 8B - Compact reasoner', size: '5.0 GB' },
  { name: 'codestral', description: 'Mistral Codestral - Code specialist', size: '13 GB' },
  { name: 'llama3.3:70b', description: 'Llama 3.3 70B - Large and powerful', size: '43 GB', badge: 'quality' as const },
  { name: 'llama3.3', description: 'Llama 3.3 - Good general purpose', size: '4.9 GB' },
];

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

/**
 * OllamaModelManager
 *
 * Shows installed Ollama LLM models and lets users download recommended coding models.
 * Filters out embedding models (is_embedding === true) from the installed list.
 * Uses the global download store for progress tracking.
 */
export function OllamaModelManager() {
  const { t } = useTranslation('settings');

  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ollamaAvailable, setOllamaAvailable] = useState(false);

  const downloads = useDownloadStore((state) => state.downloads);
  const startDownload = useDownloadStore((state) => state.startDownload);
  const completeDownload = useDownloadStore((state) => state.completeDownload);
  const failDownload = useDownloadStore((state) => state.failDownload);

  const fetchModels = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.listOllamaModels();
      if (signal?.aborted) return;

      if (result?.success && Array.isArray(result?.data?.models)) {
        const llmModels = (result.data.models as InstalledModel[]).filter(
          (m) => m.is_embedding === false
        );
        setInstalledModels(llmModels);
        setOllamaAvailable(true);
      } else {
        setOllamaAvailable(false);
        setInstalledModels([]);
      }
    } catch {
      if (!signal?.aborted) {
        setOllamaAvailable(false);
        setInstalledModels([]);
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchModels(controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchModels]);

  // Build sets for fast installed-model lookup
  const installedNames = new Set<string>();
  const installedBaseNames = new Set<string>();
  installedModels.forEach((m) => {
    installedNames.add(m.name);
    if (m.name.endsWith(':latest')) {
      installedBaseNames.add(m.name.replace(':latest', ''));
    } else if (!m.name.includes(':')) {
      installedBaseNames.add(m.name);
    }
  });

  const isInstalled = (name: string): boolean =>
    installedNames.has(name) || installedBaseNames.has(name);

  const handleDownload = async (modelName: string) => {
    startDownload(modelName);

    try {
      const result = await window.electronAPI.pullOllamaModel(modelName);
      if (result?.success) {
        completeDownload(modelName);
        // Refresh installed list after successful download
        await fetchModels();
      } else {
        const errorMsg = result?.error || `Failed to download ${modelName}`;
        failDownload(modelName, errorMsg);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Download failed';
      failDownload(modelName, errorMsg);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('agentProfile.ollamaModels.loading', { defaultValue: 'Loading models...' })}</span>
      </div>
    );
  }

  if (!ollamaAvailable) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          {t('agentProfile.ollamaModels.ollamaNotAvailable', {
            defaultValue: 'Connect Ollama in Account Settings to manage models',
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section heading */}
      <div>
        <h4 className="text-base font-semibold text-foreground mb-1">
          {t('agentProfile.ollamaModels.title', { defaultValue: 'Ollama Models' })}
        </h4>
        <p className="text-sm text-muted-foreground">
          {t('agentProfile.ollamaModels.description', {
            defaultValue: 'Manage locally installed models for AI agent tasks',
          })}
        </p>
      </div>

      {/* Installed Models */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-medium text-foreground">
            {t('agentProfile.ollamaModels.installed', { defaultValue: 'Installed Models' })}
            <span className="ms-2 text-xs text-muted-foreground font-normal">
              {t('agentProfile.ollamaModels.installedCount', {
                count: installedModels.length,
                defaultValue: '{{count}} model(s)',
              })}
            </span>
          </h5>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchModels()}
            className="h-7 px-2 text-muted-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5 me-1" />
            {t('agentProfile.ollamaModels.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>

        {installedModels.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            <Package className="h-4 w-4 shrink-0" />
            {t('agentProfile.ollamaModels.noModels', { defaultValue: 'No LLM models installed' })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {installedModels.map((model) => (
              <div
                key={model.name}
                className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-success shrink-0" />
                  <span className="text-sm font-medium text-foreground">{model.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatSize(model.size_bytes)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recommended for Coding */}
      <div className="space-y-3">
        <div>
          <h5 className="text-sm font-medium text-foreground">
            {t('agentProfile.ollamaModels.recommended', { defaultValue: 'Recommended for Coding' })}
          </h5>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('agentProfile.ollamaModels.recommendedDescription', {
              defaultValue: 'Popular models optimized for code generation and reasoning',
            })}
          </p>
        </div>

        <div className="space-y-2">
          {RECOMMENDED_CODING_MODELS.map((model) => {
            const installed = isInstalled(model.name);
            const download = downloads[model.name];
            const isCurrentlyDownloading =
              download?.status === 'starting' || download?.status === 'downloading';

            return (
              <div
                key={model.name}
                className={cn(
                  'rounded-lg border transition-colors',
                  installed ? 'border-success/30 bg-success/5' : 'border-border bg-muted/20'
                )}
              >
                <div className="flex items-center justify-between p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{model.name}</span>

                      {/* Model quality/speed badge */}
                      {model.badge === 'recommended' && (
                        <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                          Recommended
                        </span>
                      )}
                      {model.badge === 'fast' && (
                        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                          Fast
                        </span>
                      )}
                      {model.badge === 'quality' && (
                        <span className="inline-flex items-center rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400">
                          Quality
                        </span>
                      )}

                      {/* Installed indicator */}
                      {installed && (
                        <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                          Installed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
                  </div>

                  {/* Download button for non-installed models */}
                  {!installed && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(model.name)}
                      disabled={isCurrentlyDownloading}
                      className="shrink-0 ms-3"
                    >
                      {isCurrentlyDownloading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin me-1.5" />
                          {t('agentProfile.ollamaModels.downloading', {
                            defaultValue: 'Downloading...',
                          })}
                        </>
                      ) : (
                        <>
                          <Download className="h-3.5 w-3.5 me-1.5" />
                          {t('agentProfile.ollamaModels.download', { defaultValue: 'Download' })}
                          <span className="ms-1 text-muted-foreground">({model.size})</span>
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {/* Progress bar for downloading models */}
                {isCurrentlyDownloading && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {/* Progress bar */}
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      {download && download.percentage > 0 ? (
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary via-primary to-primary/80 transition-all duration-300"
                          style={{
                            width: `${Math.max(0, Math.min(100, download.percentage))}%`,
                          }}
                        />
                      ) : (
                        /* Indeterminate sliding state while waiting for progress events */
                        <div className="h-full w-1/4 rounded-full bg-gradient-to-r from-primary via-primary to-primary/80 animate-indeterminate" />
                      )}
                    </div>
                    {/* Progress info: percentage, speed, time remaining */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {download && download.percentage > 0
                          ? `${Math.round(download.percentage)}%`
                          : 'Starting download...'}
                      </span>
                      <div className="flex items-center gap-2">
                        {download?.speed && <span>{download.speed}</span>}
                        {download?.timeRemaining && (
                          <span className="text-primary">{download.timeRemaining}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
