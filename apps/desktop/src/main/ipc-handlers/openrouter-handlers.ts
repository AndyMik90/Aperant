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

/**
 * Registers the OPENROUTER_LIST_MODELS IPC handler.
 * Fetches the public model list from openrouter.ai and returns a normalized array.
 */
export function registerOpenRouterHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.OPENROUTER_LIST_MODELS,
    async (): Promise<IPCResult<{ models: Array<{ id: string; name: string }> }>> => {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { data: OpenRouterModel[] };
        const models = (json.data ?? []).map((m) => ({ id: m.id, name: m.name || m.id }));
        return { success: true, data: { models } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch OpenRouter models',
        };
      }
    },
  );
}
