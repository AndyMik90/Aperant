import { ipcMain, BrowserWindow, screen } from 'electron';
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
      const safeBounds = {
        x: bounds.x,
        y: bounds.y,
        width: Math.max(bounds.width, minW),
        height: Math.max(bounds.height, minH),
      };

      // Validate that the window position is on a visible display.
      // If the requested position is off-screen (e.g., a disconnected monitor),
      // adjust to the nearest visible display.
      const targetDisplay = screen.getDisplayMatching(safeBounds);
      const { x: dX, y: dY, width: dW, height: dH } = targetDisplay.workArea;
      const isOnScreen =
        safeBounds.x + safeBounds.width > dX &&
        safeBounds.x < dX + dW &&
        safeBounds.y + safeBounds.height > dY &&
        safeBounds.y < dY + dH;

      if (!isOnScreen) {
        // Center the window on the nearest display
        safeBounds.x = dX + Math.round((dW - safeBounds.width) / 2);
        safeBounds.y = dY + Math.round((dH - safeBounds.height) / 2);
      }

      win.setBounds(safeBounds);
    }
  });

  console.warn('[IPC] Window control handlers registered');
}
