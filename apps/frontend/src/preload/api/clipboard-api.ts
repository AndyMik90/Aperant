/**
 * Clipboard API for accessing clipboard functionality
 */
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type { ClipboardContent } from '../../shared/types/screenshot';

export interface ClipboardAPI {
  readClipboardWithImages: () => Promise<IPCResult<ClipboardContent>>;
}

export const createClipboardAPI = (): ClipboardAPI => ({
  readClipboardWithImages: (): Promise<IPCResult<ClipboardContent>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_READ_WITH_IMAGES),
});
