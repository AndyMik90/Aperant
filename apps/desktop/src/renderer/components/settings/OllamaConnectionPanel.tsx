import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, Loader2, AlertCircle, RefreshCw, ExternalLink, WifiOff } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { useSettingsStore } from '../../stores/settings-store';
import type { ProviderAccount } from '@shared/types/provider-account';

type OllamaConnectionState = 'checking' | 'not-installed' | 'not-running' | 'connected';

interface OllamaConnectionPanelProps {
  accounts: ProviderAccount[];
  onAccountCreated?: () => void;
}

export function OllamaConnectionPanel({ accounts, onAccountCreated }: OllamaConnectionPanelProps) {
  const { t } = useTranslation('settings');
  const addProviderAccount = useSettingsStore((state) => state.addProviderAccount);

  const [connectionState, setConnectionState] = useState<OllamaConnectionState>('checking');
  const [llmModelCount, setLlmModelCount] = useState<number | null>(null);
  const [customUrl, setCustomUrl] = useState('http://localhost:11434');
  const [showCustomUrl, setShowCustomUrl] = useState(false);
  const [autoConnected, setAutoConnected] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const hasOllamaAccount = accounts.length > 0;

  const checkConnection = useCallback(async (abortSignal?: AbortSignal) => {
    setConnectionState('checking');

    try {
      const installResult = await window.electronAPI.checkOllamaInstalled();
      if (abortSignal?.aborted) return;

      if (!installResult?.success || !installResult?.data?.installed) {
        setConnectionState('not-installed');
        return;
      }

      const statusResult = await window.electronAPI.checkOllamaStatus(customUrl !== 'http://localhost:11434' ? customUrl : undefined);
      if (abortSignal?.aborted) return;

      if (!statusResult?.success || !statusResult?.data?.running) {
        setConnectionState('not-running');
        return;
      }

      setConnectionState('connected');

      // Fetch model count (LLMs only, filter out embedding models)
      const modelsResult = await window.electronAPI.listOllamaModels(customUrl !== 'http://localhost:11434' ? customUrl : undefined);
      if (abortSignal?.aborted) return;

      if (modelsResult?.success && modelsResult?.data?.models) {
        const llmModels = modelsResult.data.models.filter((m) => !m.is_embedding);
        setLlmModelCount(llmModels.length);
      }

      // Auto-create account if none exists yet
      if (!hasOllamaAccount && !isCreatingAccount) {
        setIsCreatingAccount(true);
        try {
          await addProviderAccount({
            provider: 'ollama',
            name: 'Ollama (Local)',
            authType: 'api-key',
            billingModel: 'pay-per-use',
            baseUrl: customUrl,
          });
          setAutoConnected(true);
          onAccountCreated?.();
        } catch {
          // Auto-creation failed silently; user can add manually
        } finally {
          setIsCreatingAccount(false);
        }
      }
    } catch (err) {
      if (!abortSignal?.aborted) {
        setConnectionState('not-running');
      }
    }
  }, [customUrl, hasOllamaAccount, isCreatingAccount, addProviderAccount, onAccountCreated]);

  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    checkConnection(controller.signal);
    return () => {
      controller.abort();
    };
  }, [checkConnection]);

  if (connectionState === 'checking') {
    return (
      <div className="flex items-center gap-2 py-3 px-1">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground">
          {t('providers.ollama.connection.checking', { defaultValue: 'Checking Ollama connection...' })}
        </span>
      </div>
    );
  }

  if (connectionState === 'not-installed') {
    return (
      <div className="rounded-lg border border-info/30 bg-info/10 p-4">
        <div className="flex items-start gap-3">
          <Download className="h-5 w-5 text-info shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {t('providers.ollama.connection.notInstalled', { defaultValue: 'Ollama Not Installed' })}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t('providers.ollama.connection.notInstalledDescription', { defaultValue: 'Install Ollama to run open-source AI models locally' })}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <Button
                size="sm"
                onClick={() => window.electronAPI?.openExternal?.('https://ollama.com/download')}
              >
                <Download className="h-3.5 w-3.5 me-1.5" />
                {t('providers.ollama.connection.install', { defaultValue: 'Install Ollama' })}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => checkConnection()}
              >
                <RefreshCw className="h-3.5 w-3.5 me-1.5" />
                {t('providers.ollama.connection.retry', { defaultValue: 'Retry' })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.electronAPI?.openExternal?.('https://ollama.com')}
                className="text-muted-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5 me-1.5" />
                {t('providers.ollama.connection.learnMore', { defaultValue: 'Learn More' })}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (connectionState === 'not-running') {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
        <div className="flex items-start gap-3">
          <WifiOff className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-warning">
              {t('providers.ollama.connection.notRunning', { defaultValue: 'Ollama Not Running' })}
            </p>
            <p className="text-sm text-warning/80 mt-1">
              {t('providers.ollama.connection.notRunningDescription', { defaultValue: 'Start the Ollama service to connect' })}
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono">
              {t('providers.ollama.connection.startCommand', { defaultValue: "Run 'ollama serve' in your terminal" })}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => checkConnection()}
              className="mt-3"
            >
              <RefreshCw className="h-3.5 w-3.5 me-1.5" />
              {t('providers.ollama.connection.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Connected state
  return (
    <div className="space-y-3">
      {/* Status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-success/20 border border-success/40 shrink-0">
            <Check className="h-3 w-3 text-success" />
          </div>
          <span className="text-sm font-medium text-foreground">
            {t('providers.ollama.connection.connected', { defaultValue: 'Connected' })}
          </span>
        </div>
        {llmModelCount !== null && (
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              llmModelCount > 0
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {llmModelCount > 0
              ? t('providers.ollama.connection.modelsAvailable', { count: llmModelCount, defaultValue: '{{count}} LLM model(s) installed' })
              : t('providers.ollama.connection.noModels', { defaultValue: 'No LLM models installed yet' })}
          </span>
        )}
      </div>

      {/* Description + auto-connected badge */}
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {t('providers.ollama.connection.connectedDescription', { defaultValue: 'Ollama is running and ready to use' })}
        </p>
        {(autoConnected || hasOllamaAccount) && (
          <span className="text-[10px] bg-success/10 text-success px-1.5 py-0.5 rounded font-medium shrink-0">
            {t('providers.ollama.connection.autoConnected', { defaultValue: 'Auto-connected as local provider' })}
          </span>
        )}
      </div>

      {/* Custom URL (collapsed by default) */}
      <div>
        <button
          type="button"
          onClick={() => setShowCustomUrl((prev) => !prev)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <AlertCircle className="h-3 w-3" />
          {t('providers.ollama.connection.customUrl', { defaultValue: 'Custom URL' })}
        </button>
        {showCustomUrl && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder={t('providers.ollama.connection.customUrlPlaceholder', { defaultValue: 'http://localhost:11434' })}
              className="h-7 text-xs font-mono"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => checkConnection()}
              className="h-7 shrink-0"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
