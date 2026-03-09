import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search, Check, Brain, Eye, Wrench, ExternalLink, Loader2 } from 'lucide-react';
import { ALL_AVAILABLE_MODELS, resolveModelEquivalent, type ModelOption } from '@shared/constants/models';
import { PROVIDER_REGISTRY } from '@shared/constants/providers';
import type { BuiltinProvider } from '@shared/types/provider-account';
import { useSettingsStore } from '@/stores/settings-store';
import { cn } from '../../lib/utils';
import { Input } from '../ui/input';

interface MultiProviderModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  filterProvider?: BuiltinProvider;  // When set, only show models for this provider
}

function formatContextWindow(size: number): string {
  if (size >= 1000000) return `${(size / 1000000).toFixed(0)}M`;
  return `${(size / 1000).toFixed(0)}K`;
}

export function MultiProviderModelSelect({ value, onChange, className, filterProvider }: MultiProviderModelSelectProps) {
  const { t } = useTranslation(['settings']);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [customInput, setCustomInput] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const settings = useSettingsStore(s => s.settings);
  const providerAccounts = settings.providerAccounts ?? [];

  // Dynamic Ollama model fetching
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);

  useEffect(() => {
    if (filterProvider && filterProvider !== 'ollama') return;
    // Only fetch if there's an Ollama account configured
    const hasOllamaAccount = providerAccounts.some(a => a.provider === 'ollama');
    if (!hasOllamaAccount) {
      setOllamaModels([]);
      return;
    }

    const controller = new AbortController();
    setOllamaLoading(true);

    (async () => {
      try {
        const result = await window.electronAPI.listOllamaModels();
        if (controller.signal.aborted) return;
        if (result?.success && result.data?.models) {
          const llmModels = result.data.models
            .filter((m: { is_embedding: boolean }) => !m.is_embedding)
            .map((m: { name: string; size_bytes: number; size_gb: number }): ModelOption => ({
              value: m.name,
              label: m.name,
              provider: 'ollama' as BuiltinProvider,
              description: m.size_gb >= 1 ? `${m.size_gb.toFixed(1)} GB` : `${Math.round(m.size_bytes / 1e6)} MB`,
            }));
          setOllamaModels(llmModels);
        }
      } catch {
        // Non-fatal — leave models empty
      } finally {
        if (!controller.signal.aborted) setOllamaLoading(false);
      }
    })();

    return () => controller.abort();
  }, [filterProvider, providerAccounts]);

  // Determine if all OpenAI accounts are OAuth-only (Codex subscription)
  const openaiIsOAuthOnly = useMemo(() => {
    const openaiAccounts = providerAccounts.filter(a => a.provider === 'openai');
    return openaiAccounts.length > 0 && openaiAccounts.every(a => a.authType === 'oauth');
  }, [providerAccounts]);

  // Check if user has mixed auth types for OpenAI (both OAuth and API key)
  const openaiHasMixedAuth = useMemo(() => {
    const openaiAccounts = providerAccounts.filter(a => a.provider === 'openai');
    const hasOAuth = openaiAccounts.some(a => a.authType === 'oauth');
    const hasApiKey = openaiAccounts.some(a => a.authType !== 'oauth');
    return hasOAuth && hasApiKey;
  }, [providerAccounts]);

  // Group models by provider, including custom models from openai-compatible accounts
  const groupedModels = useMemo(() => {
    const groups = new Map<BuiltinProvider, ModelOption[]>();
    for (const model of ALL_AVAILABLE_MODELS) {
      // When filterProvider is set, only include models for that provider
      if (filterProvider && model.provider !== filterProvider) continue;
      // Hide apiKeyOnly OpenAI models when all OpenAI accounts are OAuth (Codex subscription)
      if (model.apiKeyOnly && model.provider === 'openai' && openaiIsOAuthOnly) continue;
      if (!groups.has(model.provider)) groups.set(model.provider, []);
      groups.get(model.provider)!.push(model);
    }

    // Merge user-configured custom models from openai-compatible accounts
    if (!filterProvider || filterProvider === 'openai-compatible') {
      const customAccounts = providerAccounts.filter(
        a => a.provider === 'openai-compatible' && a.customModels?.length
      );
      for (const account of customAccounts) {
        for (const cm of account.customModels!) {
          // Avoid duplicates — skip if already present
          const existing = groups.get('openai-compatible');
          if (existing?.some(m => m.value === cm.id)) continue;
          if (!groups.has('openai-compatible')) groups.set('openai-compatible', []);
          groups.get('openai-compatible')!.push({
            value: cm.id,
            label: cm.label,
            provider: 'openai-compatible',
            description: account.name,
            capabilities: { thinking: false, tools: true, vision: false, contextWindow: 128000 },
          });
        }
      }
    }

    // Inject dynamically fetched Ollama LLM models
    if (ollamaModels.length > 0 && (!filterProvider || filterProvider === 'ollama')) {
      // Replace any static catalog entries with dynamic ones
      groups.set('ollama', ollamaModels);
    }

    return groups;
  }, [filterProvider, providerAccounts, ollamaModels, openaiIsOAuthOnly]);

  // Check if provider has credentials
  const hasCredentials = (provider: BuiltinProvider): boolean => {
    // Anthropic is always available (built-in OAuth support)
    if (provider === 'anthropic') return true;
    // Ollama doesn't need API keys — just an account entry means it's connected
    if (provider === 'ollama') return providerAccounts.some(a => a.provider === 'ollama');
    return providerAccounts.some(a => a.provider === provider && (a.apiKey || a.claudeProfileId || a.authType === 'oauth'));
  };

  // Filter models by search
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groupedModels;
    const lower = search.toLowerCase();
    const filtered = new Map<BuiltinProvider, ModelOption[]>();
    for (const [provider, models] of groupedModels) {
      const providerInfo = PROVIDER_REGISTRY.find(p => p.id === provider);
      const providerMatches = providerInfo?.name.toLowerCase().includes(lower);
      const matching = models.filter(m =>
        m.label.toLowerCase().includes(lower) ||
        m.value.toLowerCase().includes(lower) ||
        (m.description?.toLowerCase().includes(lower) ?? false)
      );
      if (matching.length > 0) {
        filtered.set(provider, matching);
      } else if (providerMatches) {
        filtered.set(provider, models);
      }
    }
    return filtered;
  }, [search, groupedModels]);

  // Resolve value to provider-equivalent when filterProvider is set
  // e.g., 'opus' → 'gpt-5.3' when filterProvider='openai'
  const resolvedValue = useMemo(() => {
    if (!filterProvider || !value) return value;
    // Ollama uses raw model names — skip equivalence resolution
    if (filterProvider === 'ollama') return value;
    // Check if the value already belongs to the target provider
    const directMatch = ALL_AVAILABLE_MODELS.find(m => m.value === value && m.provider === filterProvider);
    if (directMatch) return value;
    // Resolve via equivalence mapping
    const equiv = resolveModelEquivalent(value, filterProvider);
    if (equiv) {
      // Find the catalog entry for the resolved model ID
      const catalogEntry = ALL_AVAILABLE_MODELS.find(
        m => m.provider === filterProvider && m.value === equiv.modelId
      );
      if (catalogEntry) return catalogEntry.value;
    }
    return value;
  }, [value, filterProvider]);

  // Find current selection label (check grouped models which includes custom models)
  const selectedModel = useMemo(() => {
    const fromCatalog = ALL_AVAILABLE_MODELS.find(m => m.value === resolvedValue);
    if (fromCatalog) return fromCatalog;
    // Check custom models from grouped results
    for (const models of groupedModels.values()) {
      const found = models.find(m => m.value === resolvedValue);
      if (found) return found;
    }
    return undefined;
  }, [resolvedValue, groupedModels]);
  const displayLabel = selectedModel?.label ?? value;

  const handleOpen = () => {
    setOpen(true);
    setSearch('');
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleClose = () => {
    setOpen(false);
    setSearch('');
  };

  const handleSelect = (modelValue: string) => {
    onChange(modelValue);
    handleClose();
  };

  const handleCustomSubmit = () => {
    if (customInput.trim()) {
      onChange(customInput.trim());
      setCustomInput('');
      handleClose();
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={open ? handleClose : handleOpen}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm',
          'ring-offset-background',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'hover:bg-accent/50 transition-colors'
        )}
      >
        <span className={cn('truncate', !value && 'text-muted-foreground')}>
          {value ? displayLabel : t('settings:modelSelect.placeholder', { defaultValue: 'Select a model' })}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground shrink-0 ml-2 transition-transform', open && 'rotate-180')} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-50 min-w-full w-max max-w-[400px] mt-1 bg-popover border border-border rounded-md shadow-lg flex flex-col max-h-80">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('settings:modelSelect.searchPlaceholder', { defaultValue: 'Search models...' })}
                className="pl-8 h-8"
              />
            </div>
          </div>

          {/* Model groups */}
          <div className="flex-1 overflow-y-auto">
            {/* Ollama loading state */}
            {ollamaLoading && filterProvider === 'ollama' && (
              <div className="p-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('settings:modelSelect.ollamaLoading', { defaultValue: 'Loading Ollama models...' })}
              </div>
            )}
            {/* Ollama no models state */}
            {!ollamaLoading && filterProvider === 'ollama' && ollamaModels.length === 0 && providerAccounts.some(a => a.provider === 'ollama') && (
              <div className="p-3 text-center space-y-1">
                <p className="text-sm text-muted-foreground">
                  {t('settings:modelSelect.ollamaNoModels', { defaultValue: 'No Ollama models installed' })}
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  {t('settings:modelSelect.ollamaNoModelsHint', { defaultValue: 'Install models in Agent Settings → Ollama tab' })}
                </p>
              </div>
            )}
            {filteredGroups.size === 0 && !ollamaLoading ? (
              <div className="p-3 text-center text-sm text-muted-foreground">
                {t('settings:modelSelect.noResults', { defaultValue: 'No models match your search' })}
              </div>
            ) : (
              Array.from(filteredGroups.entries()).map(([provider, models]) => {
                const providerInfo = PROVIDER_REGISTRY.find(p => p.id === provider);
                const configured = hasCredentials(provider);

                return (
                  <div key={provider}>
                    {/* Provider header */}
                    <div className={cn(
                      'flex items-center justify-between px-3 py-1.5 bg-muted/50 sticky top-0',
                      !configured && 'opacity-60'
                    )}>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {providerInfo?.name ?? provider}
                      </span>
                      {!configured && providerInfo?.website && (
                        <a
                          href={providerInfo.website}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                          onClick={e => e.stopPropagation()}
                        >
                          {t('settings:modelSelect.configureProvider', { defaultValue: 'Configure' })}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>

                    {/* Models in this provider */}
                    {models.map(model => {
                      const isSelected = resolvedValue === model.value;
                      return (
                        <button
                          key={model.value}
                          type="button"
                          onClick={() => configured ? handleSelect(model.value) : undefined}
                          disabled={!configured}
                          className={cn(
                            'w-full px-3 py-2 text-left text-sm flex items-start gap-2',
                            'hover:bg-accent transition-colors',
                            isSelected && 'bg-accent',
                            !configured && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{model.label}</span>
                              {model.description && (
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {model.description}
                                </span>
                              )}
                              {model.apiKeyOnly && openaiHasMixedAuth && (
                                <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                                  {t('settings:modelSelect.apiKeyOnly', { defaultValue: 'API key' })}
                                </span>
                              )}
                            </div>
                            {model.capabilities && (
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-muted-foreground">
                                  {t('settings:modelSelect.contextWindow', {
                                    size: formatContextWindow(model.capabilities.contextWindow),
                                    defaultValue: `${formatContextWindow(model.capabilities.contextWindow)} context`
                                  })}
                                </span>
                                <div className="flex items-center gap-1">
                                  {model.capabilities.thinking && (
                                    <span title={t('settings:modelSelect.capabilities.thinking', { defaultValue: 'Thinking' })}>
                                      <Brain className="h-2.5 w-2.5 text-muted-foreground" />
                                    </span>
                                  )}
                                  {model.capabilities.tools && (
                                    <span title={t('settings:modelSelect.capabilities.tools', { defaultValue: 'Tools' })}>
                                      <Wrench className="h-2.5 w-2.5 text-muted-foreground" />
                                    </span>
                                  )}
                                  {model.capabilities.vision && (
                                    <span title={t('settings:modelSelect.capabilities.vision', { defaultValue: 'Vision' })}>
                                      <Eye className="h-2.5 w-2.5 text-muted-foreground" />
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          {isSelected && (
                            <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {/* Custom model ID input */}
          <div className="border-t border-border p-2 space-y-1">
            <p className="text-[10px] text-muted-foreground px-1">
              {t('settings:modelSelect.customModel', { defaultValue: 'Custom model ID' })}
            </p>
            <div className="flex gap-1.5">
              <Input
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
                placeholder={t('settings:modelSelect.customModelPlaceholder', { defaultValue: 'Enter model ID...' })}
                className="h-7 text-xs"
              />
              <button
                type="button"
                onClick={handleCustomSubmit}
                disabled={!customInput.trim()}
                className={cn(
                  'shrink-0 px-2 h-7 rounded-md text-xs font-medium transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {t('settings:modelSelect.useCustomModel', { defaultValue: 'Use' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
