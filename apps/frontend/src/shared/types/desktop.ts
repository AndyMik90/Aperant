export interface VirtualDesktopInfo {
  id: string;
  number?: number | null;
  name?: string | null;
  visible?: boolean | null;
}

export interface DesktopProjectAssociation {
  desktopId: string;
  desktopNumber?: number | null;
  desktopName?: string | null;
  projectId: string;
  updatedAt: string;
  source: 'ui' | 'hotkey' | 'mcp';
}

export interface DesktopStateSnapshot {
  supported: boolean;
  available: boolean;
  error?: string;
  pinEnabled: boolean;
  associationHotkey?: string | null;
  currentDesktop: VirtualDesktopInfo | null;
  projectAssociations: DesktopProjectAssociation[];
}

export interface DesktopProjectActivation {
  projectId: string;
  desktopId: string;
  reason: 'summon' | 'desktop-change' | 'pin-enable' | 'mcp';
}
