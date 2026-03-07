import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Download,
  Loader2,
  AlertCircle,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { useDownloadStore } from '../../stores/download-store';

type OllamaState = 'checking' | 'not-installed' | 'not-running' | 'available';

interface OllamaModel {
  name: string;
  description: string;
  size_estimate?: string;
  dim: number;
  installed: boolean;
  badge?: 'recommended' | 'quality' | 'fast';
}

interface OllamaModelSelectorProps {
  selectedModel: string;
  onModelSelect: (model: string, dim: number) => void;
  disabled?: boolean;
  className?: string;
  baseUrl?: string;
}

// Recommended embedding models for Auto Claude Memory
// qwen3-embedding:4b is first as the recommended default (balanced quality/speed)
const RECOMMENDED_MODELS: OllamaModel[] = [
  {
    name: 'qwen3-embedding:4b',
    description: 'Qwen3 4B - Balanced quality and speed',
    size_estimate: '3.1 GB',
    dim: 2560,
    installed: false,
    badge: 'recommended',
  },
  {
    name: 'qwen3-embedding:8b',
    description: 'Qwen3 8B - Best embedding quality',
    size_estimate: '6.0 GB',
    dim: 4096,
    installed: false,
    badge: 'quality',
  },
  {
    name: 'qwen3-embedding:0.6b',
    description: 'Qwen3 0.6B - Smallest and fastest',
    size_estimate: '494 MB',
    dim: 1024,
    installed: false,
    badge: 'fast',
  },
  {
    name: 'embeddinggemma',
    description: "Google's lightweight embedding model",
    size_estimate: '621 MB',
    dim: 768,
    installed: false,
  },
  {
    name: 'nomic-embed-text',
    description: 'Popular general-purpose embeddings',
    size_estimate: '274 MB',
    dim: 768,
    installed: false,
  },
];

/**
 * OllamaModelSelector Component
 *
 * Provides UI for selecting and downloading Ollama embedding models for semantic search.
 * Features:
 * - Displays list of recommended embedding models (embeddinggemma, nomic-embed-text, mxbai-embed-large)
 * - Shows installation status with checkmarks for installed models
 * - Download buttons with file size estimates for uninstalled models
 * - Real-time download progress tracking with speed and ETA
 * - Automatic list refresh after successful downloads
 * - Graceful handling when Ollama service is not running
 *
 * @component
 * @param {Object} props - Component props
 * @param {string} props.selectedModel - Currently selected model name
 * @param {Function} props.onModelSelect - Callback when a model is selected (model: string, dim: number) => void
 * @param {boolean} [props.disabled=false] - If true, disables selection and downloads
 * @param {string} [props.className] - Additional CSS classes to apply to root element
 *
 * @example
 * ```tsx
 * <OllamaModelSelector
 *   selectedModel="embeddinggemma"
 *   onModelSelect={(model, dim) => console.log(`Selected ${model} with ${dim} dimensions`)}
 *   disabled={false}
 * />
 * ```
 */
export function OllamaModelSelector({
  selectedModel,
  onModelSelect,
  disabled = false,
  className,
  baseUrl,
}: OllamaModelSelectorProps) {
  const { t } = useTranslation('onboarding');
  const [models, setModels] = useState<OllamaModel[]>(RECOMMENDED_MODELS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ollamaState, setOllamaState] = useState<OllamaState>('checking');
  const [isInstalling, setIsInstalling] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);

  // Track timeout for cleanup on unmount
  const installCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use global download store for tracking downloads
  const downloads = useDownloadStore((state) => state.downloads);
  const startDownload = useDownloadStore((state) => state.startDownload);
  const completeDownload = useDownloadStore((state) => state.completeDownload);
  const failDownload = useDownloadStore((state) => state.failDownload);

  /**
   * Checks if Ollama is installed, running, and fetches installed models.
   * Updates component state based on Ollama availability.
   *
   * @param {AbortSignal} [abortSignal] - Optional abort signal to cancel the request
   * @returns {Promise<void>}
   */
  const checkInstalledModels = useCallback(async (abortSignal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    setOllamaState('checking');

    try {
      // First check if Ollama is installed (binary exists)
      const installResult = await window.electronAPI.checkOllamaInstalled();
      if (abortSignal?.aborted) return;

      if (!installResult?.success || !installResult?.data?.installed) {
        setOllamaState('not-installed');
        setIsLoading(false);
        return;
      }

      // Ollama is installed, now check if it's running
      const statusResult = await window.electronAPI.checkOllamaStatus(baseUrl);
      if (abortSignal?.aborted) return;

      if (!statusResult?.success || !statusResult?.data?.running) {
        setOllamaState('not-running');
        setIsLoading(false);
        return;
      }

      setOllamaState('available');

      // Get list of installed embedding models
      const result = await window.electronAPI.listOllamaEmbeddingModels(baseUrl);
      if (abortSignal?.aborted) return;

      if (result?.success && result?.data?.embedding_models) {
        // Build a set of installed model names (full, base, and version-matched)
        const installedFullNames = new Set<string>();
        const installedBaseNames = new Set<string>();
        const installedVersionNames = new Set<string>();

        result.data.embedding_models.forEach((m: { name: string }) => {
          const name = m.name;
          installedFullNames.add(name);

          // Normalize :latest suffix
          if (name.endsWith(':latest')) {
            installedBaseNames.add(name.replace(':latest', ''));
          } else if (!name.includes(':')) {
            installedBaseNames.add(name);
          }

          // Handle quantization variants (e.g., qwen3-embedding:8b-q4_K_M)
          // Extract base:version without quantization suffix
          const quantMatch = name.match(/^([^:]+:[^-]+)/);
          if (quantMatch) {
            installedVersionNames.add(quantMatch[1]);
          }
        });

        // Update models with installation status
        setModels(
          RECOMMENDED_MODELS.map(model => {
            // Check multiple matching strategies:
            // 1. Exact match (e.g., "qwen3-embedding:8b" === "qwen3-embedding:8b")
            // 2. Base name match for :latest normalization (handles "embeddinggemma" matching "embeddinggemma:latest")
            // 3. Version match ignoring quantization suffix (e.g., "qwen3-embedding:8b" matches "qwen3-embedding:8b-q4_K_M")
            const isInstalled = installedFullNames.has(model.name) ||
              installedBaseNames.has(model.name) ||
              installedVersionNames.has(model.name);
            return {
              ...model,
              installed: isInstalled,
            };
          })
        );
      }
    } catch (err) {
      if (!abortSignal?.aborted) {
        console.error('Failed to check Ollama models:', err);
        setError('Failed to check Ollama models');
      }
    } finally {
      if (!abortSignal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [baseUrl]);

  /**
   * Install Ollama by opening terminal with the official install command.
   */
  const handleInstallOllama = async () => {
    setIsInstalling(true);
    setError(null);

    try {
      const result = await window.electronAPI.installOllama();
      if (result?.success) {
        setInstallSuccess(true);
        // Clear any existing timeout before setting a new one
        if (installCheckTimeoutRef.current) {
          clearTimeout(installCheckTimeoutRef.current);
        }
        // Re-check after a delay to give user time to complete installation
        installCheckTimeoutRef.current = setTimeout(() => {
          checkInstalledModels();
        }, 5000);
      } else {
        setError(result?.error || 'Failed to start Ollama installation');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install Ollama');
    } finally {
      setIsInstalling(false);
    }
  };

  // Fetch installed models on mount with cleanup
  useEffect(() => {
    const controller = new AbortController();
    checkInstalledModels(controller.signal);
    return () => {
      controller.abort();
      // Clean up the install check timeout to prevent setState on unmounted component
      if (installCheckTimeoutRef.current) {
        clearTimeout(installCheckTimeoutRef.current);
      }
    };
  }, [checkInstalledModels]);

  // Progress is now handled globally by the download store listener initialized in App.tsx

   /**
    * Initiates download of an Ollama embedding model.
    * Uses global download store for state tracking and refreshes model list after completion.
    *
    * @param {string} modelName - Name of the model to download (e.g., 'embeddinggemma')
    * @returns {Promise<void>}
    */
   const handleDownload = async (modelName: string) => {
     startDownload(modelName);
     setError(null);

     try {
       const result = await window.electronAPI.pullOllamaModel(modelName);
       if (result?.success) {
         completeDownload(modelName);
         // Refresh the model list
         await checkInstalledModels();
       } else {
         const errorMsg = result?.error || `Failed to download ${modelName}`;
         failDownload(modelName, errorMsg);
         setError(errorMsg);
       }
     } catch (err) {
       const errorMsg = err instanceof Error ? err.message : 'Download failed';
       failDownload(modelName, errorMsg);
       setError(errorMsg);
     }
   };

   /**
    * Handles model selection with toggle behavior.
    * Clicking an already-selected model will deselect it.
    * Only allows selection of installed models and when component is not disabled.
    *
    * @param {OllamaModel} model - The model to select or deselect
    * @returns {void}
    */
   const handleSelect = (model: OllamaModel) => {
     if (!model.installed || disabled) return;

     // Toggle behavior: if already selected, deselect by passing empty values
     if (selectedModel === model.name) {
       onModelSelect('', 0);
     } else {
       onModelSelect(model.name, model.dim);
     }
   };

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Checking Ollama models...</span>
      </div>
    );
  }

  // Ollama not installed - show install option
  if (ollamaState === 'not-installed') {
    return (
      <div className={cn('rounded-lg border border-info/30 bg-info/10 p-4', className)}>
        <div className="flex items-start gap-3">
          <Download className="h-5 w-5 text-info shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {t('ollama.notInstalled.title')}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t('ollama.notInstalled.description')}
            </p>

            {/* Install success message */}
            {installSuccess && (
              <div className="mt-3 p-2 rounded-md bg-success/10 border border-success/30">
                <p className="text-sm text-success">
                  {t('ollama.notInstalled.installSuccess')}
                </p>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="mt-3 p-2 rounded-md bg-destructive/10 border border-destructive/30">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex items-center gap-2 mt-3">
              <Button
                onClick={handleInstallOllama}
                disabled={isInstalling}
                size="sm"
              >
                {isInstalling ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    {t('ollama.notInstalled.installing')}
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    {t('ollama.notInstalled.installButton')}
                  </>
                )}
              </Button>
              {/* Note: isLoading is always false when this block renders because we only show
                  this block after setIsLoading(false) is called. However, clicking Retry calls
                  checkInstalledModels() which immediately sets isLoading=true, triggering a
                  re-render that shows the loading block instead. This React batching behavior
                  naturally prevents double-clicks without needing the disabled prop. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => checkInstalledModels()}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                {t('ollama.notInstalled.retry')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.electronAPI?.openExternal?.('https://ollama.com')}
                className="text-muted-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                {t('ollama.notInstalled.learnMore')}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              {t('ollama.notInstalled.fallbackNote')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Ollama installed but not running
  if (ollamaState === 'not-running') {
    return (
      <div className={cn('rounded-lg border border-warning/30 bg-warning/10 p-4', className)}>
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-warning">
              {t('ollama.notRunning.title')}
            </p>
            <p className="text-sm text-warning/80 mt-1">
              {t('ollama.notRunning.description')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => checkInstalledModels()}
              className="mt-3"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              {t('ollama.notRunning.retry')}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              {t('ollama.notRunning.fallbackNote')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

       <div className="space-y-2">
         {models.map(model => {
           const isSelected = selectedModel === model.name;
           const download = downloads[model.name];
           const isCurrentlyDownloading = download?.status === 'starting' || download?.status === 'downloading';
           const progress = download;

           return (
             <div
               key={model.name}
               className={cn(
                 'rounded-lg border transition-colors',
                 model.installed && !disabled
                   ? 'cursor-pointer hover:bg-accent/50'
                   : 'cursor-default',
                 isSelected && 'border-primary bg-primary/5',
                 !model.installed && 'bg-muted/30'
               )}
               onClick={() => handleSelect(model)}
             >
               <div className="flex items-center justify-between p-3">
                 <div className="flex items-center gap-3">
                   {/* Selection/Status indicator */}
                   <div
                     className={cn(
                       'flex h-5 w-5 items-center justify-center rounded-full border-2 shrink-0',
                       isSelected
                         ? 'border-primary bg-primary text-primary-foreground'
                         : model.installed
                           ? 'border-muted-foreground/30'
                           : 'border-muted-foreground/20 bg-muted/50'
                     )}
                   >
                     {isSelected && <Check className="h-3 w-3" />}
                   </div>

                   <div className="flex-1">
                     <div className="flex items-center gap-2">
                       <span className="text-sm font-medium">{model.name}</span>
                       <span className="text-xs text-muted-foreground">
                         ({model.dim} dim)
                       </span>
                       {model.badge === 'recommended' && (
                         <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                           Recommended
                         </span>
                       )}
                       {model.badge === 'quality' && (
                         <span className="inline-flex items-center rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400">
                           Highest Quality
                         </span>
                       )}
                       {model.badge === 'fast' && (
                         <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                           Fastest
                         </span>
                       )}
                       {model.installed && (
                         <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                           Installed
                         </span>
                       )}
                     </div>
                     <p className="text-xs text-muted-foreground">{model.description}</p>
                   </div>
                 </div>

                 {/* Download button for non-installed models */}
                 {!model.installed && (
                   <Button
                     variant="outline"
                     size="sm"
                     onClick={(e) => {
                       e.stopPropagation();
                       handleDownload(model.name);
                     }}
                     disabled={isCurrentlyDownloading || disabled}
                     className="shrink-0"
                   >
                     {isCurrentlyDownloading ? (
                       <>
                         <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                         Downloading...
                       </>
                     ) : (
                       <>
                         <Download className="h-3.5 w-3.5 mr-1.5" />
                         Download
                         {model.size_estimate && (
                           <span className="ml-1 text-muted-foreground">
                             ({model.size_estimate})
                           </span>
                         )}
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
                     {progress && progress.percentage > 0 ? (
                       <div
                         className="h-full rounded-full bg-gradient-to-r from-primary via-primary to-primary/80 transition-all duration-300"
                         style={{ width: `${Math.max(0, Math.min(100, progress.percentage))}%` }}
                       />
                     ) : (
                       /* Indeterminate/sliding state while waiting for progress events */
                       <div className="h-full w-1/4 rounded-full bg-gradient-to-r from-primary via-primary to-primary/80 animate-indeterminate" />
                     )}
                   </div>
                   {/* Progress info: percentage, speed, time remaining */}
                   <div className="flex items-center justify-between text-xs text-muted-foreground">
                     <span className="font-medium text-foreground">
                       {progress && progress.percentage > 0 ? `${Math.round(progress.percentage)}%` : 'Starting download...'}
                     </span>
                     <div className="flex items-center gap-2">
                       {progress?.speed && <span>{progress.speed}</span>}
                       {progress?.timeRemaining && <span className="text-primary">{progress.timeRemaining}</span>}
                     </div>
                   </div>
                 </div>
               )}
             </div>
           );
         })}
       </div>

      <p className="text-xs text-muted-foreground">
        Select an installed model for semantic search. Memory works with keyword search even without embeddings.
      </p>
    </div>
  );
}
