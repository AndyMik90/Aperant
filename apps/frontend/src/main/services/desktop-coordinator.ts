import type { BrowserWindow } from 'electron';
import { DEFAULT_APP_SETTINGS, IPC_CHANNELS } from '../../shared/constants';
import type {
  AppSettings,
  DesktopProjectActivation,
  DesktopProjectAssociation,
  DesktopStateSnapshot,
  VirtualDesktopInfo,
} from '../../shared/types';
import { projectStore } from '../project-store';
import { readSettingsFile, writeSettingsFile } from '../settings-utils';
import {
  getCurrentVirtualDesktop,
  getVirtualDesktopAvailability,
  isWindowPinnedToAllDesktops,
  moveWindowToVirtualDesktop,
  pinWindowToAllDesktops,
  unpinWindowFromAllDesktops,
} from '../platform/windows/virtual-desktop';
import { isWindows } from '../platform';

type PresentationMode = 'normal' | 'maximized' | 'fullscreen';
type AssociationSource = DesktopProjectAssociation['source'] | 'hotkey';
type ActivationReason = DesktopProjectActivation['reason'];

interface DesktopAssociationSignal {
  projectId: string;
  desktopId: string;
  activate?: boolean;
}

function loadDesktopSettings(): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    ...(readSettingsFile() ?? {}),
  } as AppSettings;
}

function saveDesktopSettings(updates: Partial<AppSettings>): AppSettings {
  const nextSettings = {
    ...loadDesktopSettings(),
    ...updates,
  } as AppSettings;
  writeSettingsFile(nextSettings as unknown as Record<string, unknown>);
  return nextSettings;
}

function sanitizeAssociations(
  associations: DesktopProjectAssociation[] | undefined
): DesktopProjectAssociation[] {
  const seenProjects = new Set<string>();
  const seenDesktops = new Set<string>();
  const nextAssociations: DesktopProjectAssociation[] = [];

  for (const association of associations ?? []) {
    if (!association.projectId || !association.desktopId) {
      continue;
    }

    if (seenProjects.has(association.projectId) || seenDesktops.has(association.desktopId)) {
      continue;
    }

    seenProjects.add(association.projectId);
    seenDesktops.add(association.desktopId);
    nextAssociations.push(association);
  }

  return nextAssociations;
}

class DesktopCoordinator {
  private getMainWindow: () => BrowserWindow | null = () => null;
  private desktopPollInterval: NodeJS.Timeout | null = null;
  private lastKnownDesktopId: string | null = null;
  private lastPresentationMode: PresentationMode = 'normal';

  setMainWindowGetter(getter: () => BrowserWindow | null): void {
    this.getMainWindow = getter;
  }

  attachToWindow(window: BrowserWindow): void {
    this.lastPresentationMode = this.resolveWindowPresentationMode(window);

    window.on('maximize', () => {
      this.lastPresentationMode = 'maximized';
    });

    window.on('unmaximize', () => {
      if (!window.isFullScreen()) {
        this.lastPresentationMode = 'normal';
      }
    });

    window.on('enter-full-screen', () => {
      this.lastPresentationMode = 'fullscreen';
    });

    window.on('leave-full-screen', () => {
      this.lastPresentationMode = window.isMaximized() ? 'maximized' : 'normal';
    });

    this.lastKnownDesktopId = getCurrentVirtualDesktop()?.id ?? null;
    this.applyPersistedPinState();
    this.emitStateChanged();
  }

  getStateSnapshot(error?: string): DesktopStateSnapshot {
    if (!isWindows()) {
      return {
        supported: false,
        available: false,
        error: error ?? 'Windows virtual desktop features are only available on Windows.',
        pinEnabled: false,
        associationHotkey: null,
        currentDesktop: null,
        projectAssociations: [],
      };
    }

    const settings = loadDesktopSettings();
    const availability = getVirtualDesktopAvailability();
    const currentDesktop = availability.available ? getCurrentVirtualDesktop() : null;

    if (currentDesktop?.id) {
      this.lastKnownDesktopId = currentDesktop.id;
    }

    return {
      supported: true,
      available: availability.available,
      error: error ?? availability.error,
      pinEnabled: Boolean(settings.desktopAgnosticPinEnabled),
      associationHotkey: 'Ctrl+Shift+AltGr',
      currentDesktop,
      projectAssociations: sanitizeAssociations(settings.desktopProjectAssociations),
    };
  }

  summonWindow(reason: ActivationReason = 'summon'): DesktopStateSnapshot {
    const snapshot = this.getStateSnapshot();
    const window = this.getMainWindow();

    if (!window || window.isDestroyed()) {
      return snapshot;
    }

    if (!snapshot.pinEnabled && snapshot.currentDesktop?.id) {
      moveWindowToVirtualDesktop(window.getNativeWindowHandle(), snapshot.currentDesktop.id);
    }

    if (window.isMinimized()) {
      window.restore();
    }

    if (this.lastPresentationMode === 'fullscreen') {
      if (!window.isFullScreen()) {
        window.setFullScreen(true);
      }
    } else {
      if (window.isFullScreen()) {
        window.setFullScreen(false);
      }

      if (this.lastPresentationMode === 'maximized') {
        if (!window.isMaximized()) {
          window.maximize();
        }
      } else if (window.isMaximized()) {
        window.unmaximize();
      }
    }

    window.show();
    window.focus();

    if (snapshot.currentDesktop?.id) {
      this.activateAssociatedProject(snapshot.currentDesktop.id, reason);
    }

    this.emitStateChanged();
    return this.getStateSnapshot();
  }

  setPinEnabled(enabled: boolean): DesktopStateSnapshot {
    if (!isWindows()) {
      return this.getStateSnapshot();
    }

    const availability = getVirtualDesktopAvailability();
    if (!availability.available) {
      return this.getStateSnapshot(availability.error);
    }

    const window = this.getMainWindow();
    if (window && !window.isDestroyed()) {
      const applied = enabled
        ? pinWindowToAllDesktops(window.getNativeWindowHandle())
        : unpinWindowFromAllDesktops(window.getNativeWindowHandle());

      if (!applied) {
        return this.getStateSnapshot(
          enabled
            ? 'Aperant could not be pinned to all desktops on this machine.'
            : 'Aperant could not be unpinned from all desktops on this machine.'
        );
      }
    }

    saveDesktopSettings({ desktopAgnosticPinEnabled: enabled });
    if (enabled) {
      this.startDesktopPolling();
      return this.summonWindow('pin-enable');
    }

    this.stopDesktopPolling();
    this.emitStateChanged();
    return this.getStateSnapshot();
  }

  togglePinEnabled(): DesktopStateSnapshot {
    const currentState = this.getStateSnapshot();
    return this.setPinEnabled(!currentState.pinEnabled);
  }

  associateProjectToCurrentDesktop(
    projectId: string,
    source: AssociationSource = 'ui',
    activate: boolean = false
  ): DesktopStateSnapshot {
    const currentDesktop = getCurrentVirtualDesktop();
    if (!currentDesktop?.id) {
      return this.getStateSnapshot('No current Windows desktop could be resolved.');
    }

    const settings = loadDesktopSettings();
    const nextAssociation: DesktopProjectAssociation = {
      desktopId: currentDesktop.id,
      desktopNumber: currentDesktop.number ?? null,
      desktopName: currentDesktop.name ?? null,
      projectId,
      updatedAt: new Date().toISOString(),
      source: source === 'hotkey' ? 'ui' : source,
    };

    const filteredAssociations = sanitizeAssociations(settings.desktopProjectAssociations).filter(
      (association) =>
        association.projectId !== projectId && association.desktopId !== currentDesktop.id
    );

    saveDesktopSettings({
      desktopProjectAssociations: [...filteredAssociations, nextAssociation],
    });

    if (activate) {
      this.activateProject(projectId, currentDesktop.id, source === 'mcp' ? 'mcp' : 'pin-enable');
    }

    this.emitStateChanged();
    return this.getStateSnapshot();
  }

  clearProjectAssociation(projectId: string): DesktopStateSnapshot {
    const settings = loadDesktopSettings();
    const nextAssociations = sanitizeAssociations(settings.desktopProjectAssociations).filter(
      (association) => association.projectId !== projectId
    );

    saveDesktopSettings({ desktopProjectAssociations: nextAssociations });
    this.emitStateChanged();
    return this.getStateSnapshot();
  }

  toggleActiveProjectAssociation(): DesktopStateSnapshot {
    const tabState = projectStore.getTabState();
    const activeProjectId = tabState.activeProjectId;
    if (!activeProjectId) {
      return this.getStateSnapshot('Open a project tab before associating it to a desktop.');
    }

    const snapshot = this.getStateSnapshot();
    const currentDesktopId = snapshot.currentDesktop?.id;
    if (!currentDesktopId) {
      return this.getStateSnapshot('No current Windows desktop could be resolved.');
    }

    const currentAssociation = snapshot.projectAssociations.find(
      (association) => association.projectId === activeProjectId
    );

    if (currentAssociation?.desktopId === currentDesktopId) {
      return this.clearProjectAssociation(activeProjectId);
    }

    return this.associateProjectToCurrentDesktop(activeProjectId, 'ui');
  }

  handleExternalAssociationSignal(signal: DesktopAssociationSignal): void {
    this.emitStateChanged();
    if (signal.activate) {
      this.activateProject(signal.projectId, signal.desktopId, 'mcp');
    }
  }

  shouldPersistVirtualDesktopState(): boolean {
    if (!isWindows()) {
      return false;
    }

    const settings = loadDesktopSettings();
    return !settings.desktopAgnosticPinEnabled;
  }

  isWindowPinned(): boolean {
    const window = this.getMainWindow();
    if (!window || window.isDestroyed()) {
      return false;
    }

    return isWindowPinnedToAllDesktops(window.getNativeWindowHandle());
  }

  private applyPersistedPinState(): void {
    if (!isWindows()) {
      return;
    }

    const settings = loadDesktopSettings();
    if (!settings.desktopAgnosticPinEnabled) {
      this.stopDesktopPolling();
      return;
    }

    const window = this.getMainWindow();
    if (!window || window.isDestroyed()) {
      return;
    }

    pinWindowToAllDesktops(window.getNativeWindowHandle());
    this.startDesktopPolling();
  }

  private startDesktopPolling(): void {
    if (this.desktopPollInterval || !isWindows()) {
      return;
    }

    this.desktopPollInterval = setInterval(() => {
      const settings = loadDesktopSettings();
      if (!settings.desktopAgnosticPinEnabled) {
        this.stopDesktopPolling();
        return;
      }

      const currentDesktop = getCurrentVirtualDesktop();
      if (!currentDesktop?.id) {
        return;
      }

      if (this.lastKnownDesktopId !== currentDesktop.id) {
        this.lastKnownDesktopId = currentDesktop.id;
        this.emitStateChanged();
        this.activateAssociatedProject(currentDesktop.id, 'desktop-change');
      }
    }, 1000);

    this.desktopPollInterval.unref?.();
  }

  private stopDesktopPolling(): void {
    if (this.desktopPollInterval) {
      clearInterval(this.desktopPollInterval);
      this.desktopPollInterval = null;
    }
  }

  private activateAssociatedProject(desktopId: string, reason: ActivationReason): void {
    const settings = loadDesktopSettings();
    const association = sanitizeAssociations(settings.desktopProjectAssociations).find(
      (item) => item.desktopId === desktopId
    );

    if (!association) {
      return;
    }

    this.activateProject(association.projectId, desktopId, reason);
  }

  private activateProject(projectId: string, desktopId: string, reason: ActivationReason): void {
    const window = this.getMainWindow();
    if (!window || window.isDestroyed()) {
      return;
    }

    if (!projectStore.getProject(projectId)) {
      return;
    }

    window.webContents.send(IPC_CHANNELS.DESKTOP_PROJECT_ACTIVATE, {
      projectId,
      desktopId,
      reason,
    } satisfies DesktopProjectActivation);
  }

  private emitStateChanged(): void {
    const window = this.getMainWindow();
    if (!window || window.isDestroyed()) {
      return;
    }

    window.webContents.send(IPC_CHANNELS.DESKTOP_STATE_CHANGED, this.getStateSnapshot());
  }

  private resolveWindowPresentationMode(window: BrowserWindow): PresentationMode {
    if (window.isFullScreen()) {
      return 'fullscreen';
    }

    if (window.isMaximized()) {
      return 'maximized';
    }

    return 'normal';
  }
}

export const desktopCoordinator = new DesktopCoordinator();
