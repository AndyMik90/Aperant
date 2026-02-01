/**
 * Platform abstraction types
 */

export type Platform = 'electron' | 'web';

export type {
  AppAPI,
  PlatformCapabilities,
  ElectronAPI,
} from '../../shared/api/app-api';

export {
  ELECTRON_CAPABILITIES,
  WEB_CAPABILITIES,
} from '../../shared/api/app-api';
