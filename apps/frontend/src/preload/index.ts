import { contextBridge } from 'electron';
import { createElectronAPI } from './api';

// Create the unified API by combining all domain-specific APIs
const electronAPI = createElectronAPI();

// Expose to renderer via contextBridge
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Expose debug flag for debug logging
contextBridge.exposeInMainWorld('DEBUG', process.env.DEBUG === 'true');

// Expose platform information for platform-specific behavior (e.g., PTY resize timing)
contextBridge.exposeInMainWorld('platform', {
  isWindows: process.platform === 'win32',
  isMacOS: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isUnix: process.platform !== 'win32',
});
