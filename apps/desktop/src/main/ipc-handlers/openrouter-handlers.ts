/**
 * OpenRouter IPC Handlers
 *
 * Handles model discovery from the OpenRouter public API.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';

/** Shape of a model entry returned by the OpenRouter /models endpoint. */
interface OpenRouterModel {
  id: string;
  name: string;
}

/** Timeout for the OpenRouter model list request (10 seconds). */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Registers the OPENROUTER_LIST_MODELS IPC handler.
 * Fetches the public model list from openrouter.ai and returns a normalized array.
 * Aborts the request after FETCH_TIMEOUT_MS to avoid hanging indefinitely.
 */
export function registerOpenRouterHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.OPENROUTER_LIST_MODELS,
    async (): Promise<IPCResult<{ models: Array<{ id: string; name: string }> }>> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { data?: unknown };
        if (!Array.isArray(json.data)) {
          throw new Error('Unexpected OpenRouter response shape');
        }
        const models = (json.data as Array<Partial<OpenRouterModel>>)
          .filter((m) => typeof m?.id === 'string')
          .map((m) => ({ id: m.id!, name: m.name || m.id! }));
        return { success: true, data: { models } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch OpenRouter models',
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  );
}
