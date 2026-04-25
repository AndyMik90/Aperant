import { useState, useEffect, useRef } from 'react';
import type { ComboboxOption } from '../components/ui/combobox';

type FetchState = 'idle' | 'loading' | 'done' | 'error';

let cachedOptions: ComboboxOption[] | null = null;
let cacheState: FetchState = 'idle';
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach(fn => fn());
}

async function fetchModels() {
  if (cacheState === 'loading' || cacheState === 'done') return;
  cacheState = 'loading';
  notify();

  try {
    const result = await window.electronAPI.listOpenRouterModels();
    if (!result.success || !result.data) throw new Error(result.error ?? 'Failed');

    cachedOptions = result.data.models
      .sort((a: { id: string; name: string }, b: { id: string; name: string }) =>
        a.id.localeCompare(b.id)
      )
      .map((m: { id: string; name: string }) => {
        const slashIdx = m.id.indexOf('/');
        const providerSlug = slashIdx !== -1 ? m.id.slice(0, slashIdx) : m.id;
        const group =
          providerSlug.charAt(0).toUpperCase() + providerSlug.slice(1).replace(/-/g, ' ');
        return { value: m.id, label: m.name || m.id, description: m.id, group };
      });

    cacheState = 'done';
  } catch {
    cacheState = 'error';
  }

  notify();
}

/** Call this as soon as OpenRouter is detected as active provider to warm the cache. */
export function preloadOpenRouterModels() {
  fetchModels();
}

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

  return {
    options: cachedOptions ?? [],
    isLoading: cacheState === 'loading',
    isError: cacheState === 'error',
  };
}
