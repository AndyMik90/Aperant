/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { ProviderModelCombobox } from '../ProviderModelCombobox';

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string, fallback?: string) => fallback ?? key })),
}));

vi.mock('../../../hooks/useOpenRouterModels', () => ({
  useOpenRouterModels: vi.fn(() => ({ options: [], isLoading: false, isError: false })),
  preloadOpenRouterModels: vi.fn(),
}));

const noop = (_value: string) => undefined;

describe('ProviderModelCombobox', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a <select> element for anthropic (static list)', () => {
    render(
      <ProviderModelCombobox provider="anthropic" value="sonnet" onValueChange={noop} />
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders a combobox button for openrouter (dynamic list)', () => {
    render(
      <ProviderModelCombobox provider="openrouter" value="" onValueChange={noop} />
    );
    // Combobox renders a <button role="combobox">
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders a combobox button for unknown provider (freeform)', () => {
    render(
      // @ts-expect-error intentional unknown provider
      <ProviderModelCombobox provider="unknown-provider" value="" onValueChange={noop} />
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders a combobox when provider is undefined (freeform)', () => {
    render(
      <ProviderModelCombobox provider={undefined} value="" onValueChange={noop} />
    );
    // undefined falls back to AVAILABLE_MODELS (anthropic list) → Select
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('preloads OpenRouter models when provider is openrouter', async () => {
    const { preloadOpenRouterModels } = await import('../../../hooks/useOpenRouterModels');
    render(
      <ProviderModelCombobox provider="openrouter" value="" onValueChange={noop} />
    );
    expect(preloadOpenRouterModels).toHaveBeenCalled();
  });

  it('does not call preload when provider is not openrouter', async () => {
    const { preloadOpenRouterModels } = await import('../../../hooks/useOpenRouterModels');
    render(
      <ProviderModelCombobox provider="anthropic" value="sonnet" onValueChange={noop} />
    );
    expect(preloadOpenRouterModels).not.toHaveBeenCalled();
  });

  it('renders a combobox for ollama (dynamic list)', () => {
    render(
      <ProviderModelCombobox provider="ollama" value="" onValueChange={noop} />
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls listOllamaModels when provider is ollama', async () => {
    const listOllamaModels = vi.fn().mockResolvedValue({
      success: true,
      data: {
        models: [
          { name: 'llama3', is_embedding: false },
          { name: 'embed-model', is_embedding: true },
        ],
      },
    });
    vi.stubGlobal('electronAPI', { listOllamaModels });
    Object.defineProperty(window, 'electronAPI', { value: { listOllamaModels }, writable: true });

    render(
      <ProviderModelCombobox provider="ollama" value="" onValueChange={noop} />
    );
    expect(listOllamaModels).toHaveBeenCalled();
  });

  it('does not call listOllamaModels when provider is not ollama', () => {
    const listOllamaModels = vi.fn();
    Object.defineProperty(window, 'electronAPI', { value: { listOllamaModels }, writable: true });

    render(
      <ProviderModelCombobox provider="anthropic" value="sonnet" onValueChange={noop} />
    );
    expect(listOllamaModels).not.toHaveBeenCalled();
  });
});
