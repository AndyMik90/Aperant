import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox } from './combobox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { useOpenRouterModels, preloadOpenRouterModels } from '../../hooks/useOpenRouterModels';
import { ALL_AVAILABLE_MODELS, AVAILABLE_MODELS } from '@shared/constants';
import type { BuiltinProvider } from '@shared/types/provider-account';

interface ProviderModelComboboxProps {
  provider: BuiltinProvider | undefined;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** 'sm' applies h-8 text-xs styling (phase selectors), 'default' applies h-9 */
  size?: 'sm' | 'default';
}

/**
 * Renders the right model picker for any provider:
 * - Known provider with static list → <Select>
 * - OpenRouter → <Combobox> with live-fetched model list + allowCustomValue
 * - Unknown provider → <Combobox> with allowCustomValue (freeform)
 */
export function ProviderModelCombobox({
  provider,
  value,
  onValueChange,
  disabled = false,
  className,
  id,
  size = 'default',
}: ProviderModelComboboxProps) {
  const { t } = useTranslation(['common']);

  const isOpenRouter = provider === 'openrouter';

  useEffect(() => {
    if (isOpenRouter) preloadOpenRouterModels();
  }, [isOpenRouter]);

  const { options: openRouterOptions, isLoading: openRouterLoading } = useOpenRouterModels();

  const staticOptions = useMemo(() => {
    if (!provider) return AVAILABLE_MODELS.map((m) => ({ value: m.value, label: m.label }));
    const providerModels = ALL_AVAILABLE_MODELS.filter((m) => m.provider === provider);
    if (providerModels.length > 0) {
      return providerModels.map((m) => ({ value: m.value, label: m.label }));
    }
    return null; // null = no static list → freeform
  }, [provider]);

  const sizeClass = size === 'sm' ? 'h-8 text-xs' : 'h-9';

  // Static list → <Select>
  if (staticOptions) {
    return (
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} className={`${sizeClass} ${className ?? ''}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {staticOptions.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // OpenRouter or unknown provider → <Combobox> with allowCustomValue
  return (
    <Combobox
      id={id}
      className={`${sizeClass} ${className ?? ''}`}
      placeholder={t('common:select.model', 'Select model…')}
      searchPlaceholder={t('common:search.models', 'Search models…')}
      emptyMessage={t('common:empty.models', 'No models found')}
      allowCustomValue
      isLoading={isOpenRouter ? openRouterLoading : false}
      value={value}
      onValueChange={onValueChange}
      options={isOpenRouter ? openRouterOptions : []}
      disabled={disabled}
    />
  );
}
