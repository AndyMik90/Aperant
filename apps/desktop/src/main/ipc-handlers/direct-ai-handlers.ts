import { ipcMain } from 'electron';
import { captureDeepSeekToken } from '../ai/providers/direct/capture-token';

/**
 * IPC handlers for the free Direct AI Connection (DeepSeek / ChatGPT).
 *
 * `direct-ai-capture-token` runs the bundled Playwright extractor to obtain a
 * DeepSeek web token in-app, so the user does not have to run the CLI script and
 * paste the token manually.
 */
export function registerDirectAiHandlers(): void {
  ipcMain.handle('direct-ai-capture-token', async () => {
    try {
      const result = await captureDeepSeekToken();
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'HANDLER_ERROR',
      };
    }
  });
}
