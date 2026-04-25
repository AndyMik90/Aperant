import { useState, useEffect, useRef } from 'react';
import type { ComboboxOption } from '../components/ui/combobox';

type FetchState = 'idle' | 'loading' | 'done' | 'error';
type OpenRouterModel = { id: string; name: string };

let cachedOptions: ComboboxOption[] | null = null;
let cacheState: FetchState = 'idle';
const subscribers = new Set<() => void>();

/** Notifies all registered subscribers that the shared fetch state has changed. */
function notify() {
  subscribers.forEach(fn => fn());
}

/**
 * Fetches the OpenRouter model list from the main process and populates the module-level cache.
 * No-ops if a fetch is already in progress or the cache is already populated.
 */
async function fetchModels() {
  if (cacheState === 'loading' || cacheState === 'done') return;
  cacheState = 'loading';
  notify();

  try {
    const result = await window.electronAPI.listOpenRouterModels();
    if (!result.success || !result.data) throw new Error(result.error ?? 'Failed');

    cachedOptions = result.data.models
      .sort((a: OpenRouterModel, b: OpenRouterModel) => a.id.localeCompare(b.id))
      .map((m: OpenRouterModel) => {
        const slashIdx = m.id.indexOf('/');
        const providerSlug = slashIdx !== -1 ? m.id.slice(0, slashIdx) : m.id;
        const group = providerSlug
          ? providerSlug.charAt(0).toUpperCase() + providerSlug.slice(1).replace(/-/g, ' ')
          : 'Other';
        return { value: m.id, label: m.name || m.id, description: m.id, group };
      });

    cacheState = 'done';
  } catch (err) {
    console.error('[useOpenRouterModels] Failed to fetch OpenRouter models:', err);
    cacheState = 'error';
  }

  notify();
}

/** Call this as soon as OpenRouter is detected as active provider to warm the cache. */
export function preloadOpenRouterModels() {
  fetchModels();
}

/**
 * React hook that subscribes to the module-level OpenRouter model cache.
 * Re-renders automatically when the fetch state changes (loading → done/error).
 *
 * @returns `options` for the combobox, `isLoading`, `isError` flags, and a `refresh()` function
 *   that clears the cache and retries the fetch (useful after a network error).
 */
export function useOpenRouterModels() {
  const [, forceUpdate] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const rerender = () => {
      if (mountedRef.current) forceUpdate(n => n + 1);
    };
    subscribers.add(rerender);
    // If already loading/done, forceUpdate once to sync current state
    if (cacheState !== 'idle') rerender();
    return () => { subscribers.delete(rerender); };
  }, []);

  const refresh = () => {
    cachedOptions = null;
    cacheState = 'idle';
    fetchModels();
  };

  return {
    options: cachedOptions ?? [],
    isLoading: cacheState === 'loading',
    isError: cacheState === 'error',
    refresh,
  };
}
