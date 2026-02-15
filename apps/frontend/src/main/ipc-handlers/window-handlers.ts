import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc';

export function registerWindowHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const win = getMainWindow();
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    getMainWindow()?.close();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => {
    return getMainWindow()?.isMaximized() ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_GET_BOUNDS, () => {
    return getMainWindow()?.getBounds() ?? null;
  });

  // Uses ipcMain.on (fire-and-forget) instead of handle/invoke to avoid
  // round-trip overhead during rapid resize/move events.
  ipcMain.on(IPC_CHANNELS.WINDOW_SET_BOUNDS, (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    const win = getMainWindow();
    if (win) {
      const [minW, minH] = win.getMinimumSize();
      win.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: Math.max(bounds.width, minW),
        height: Math.max(bounds.height, minH),
      });
    }
  });

  console.warn('[IPC] Window control handlers registered');
}
