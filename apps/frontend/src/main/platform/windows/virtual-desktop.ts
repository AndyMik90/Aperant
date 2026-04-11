import type { VirtualDesktopInfo } from '../../../shared/types';
import { isWindows } from '../index';
import { runWindowsPowerShellSync } from './powershell-runner';

type HwndLike = Buffer | number;

interface RegistryDesktopState {
  currentDesktopId: string | null;
  desktops: VirtualDesktopInfo[];
}

interface VirtualDesktopAvailability {
  available: boolean;
  error?: string;
}

const ALL_DESKTOP_IDS = new Set<string>([
  'bb64d5b7-4de3-4ab2-a87c-db7601aea7dc',
  'c2ddea68-66f2-4cf9-8264-1bfd00fbbbac',
]);

const PINNING_INTEROP = `
using System;
using System.Runtime.InteropServices;

namespace AperantDesktopInterop
{
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("372E1D3B-38D3-42E4-A15B-8AB2B178F513")]
    internal interface IApplicationView
    {
        int SetFocus();
        int SwitchTo();
        int TryInvokeBack(IntPtr callback);
        int GetThumbnailWindow(out IntPtr hwnd);
        int GetMonitor(out IntPtr immersiveMonitor);
        int GetVisibility(out int visibility);
        int SetCloak(int cloakType, int unknown);
        int GetPosition(ref Guid guid, out IntPtr position);
        int SetPosition(ref IntPtr position);
        int InsertAfterWindow(IntPtr hwnd);
        int GetExtendedFramePosition(out RECT rect);
        int GetAppUserModelId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int SetAppUserModelId(string id);
        int IsEqualByAppUserModelId(string id, out int result);
        int GetViewState(out uint state);
        int SetViewState(uint state);
        int GetNeediness(out int neediness);
        int GetLastActivationTimestamp(out ulong timestamp);
        int SetLastActivationTimestamp(ulong timestamp);
        int GetVirtualDesktopId(out Guid guid);
        int SetVirtualDesktopId(ref Guid guid);
        int GetShowInSwitchers(out int flag);
        int SetShowInSwitchers(int flag);
        int GetScaleFactor(out int factor);
        int CanReceiveInput(out bool canReceiveInput);
        int GetCompatibilityPolicyType(out int flags);
        int SetCompatibilityPolicyType(int flags);
        int GetSizeConstraints(IntPtr monitor, out SIZE size1, out SIZE size2);
        int GetSizeConstraintsForDpi(uint uint1, out SIZE size1, out SIZE size2);
        int SetSizeConstraintsForDpi(ref uint uint1, ref SIZE size1, ref SIZE size2);
        int OnMinSizePreferencesUpdated(IntPtr hwnd);
        int ApplyOperation(IntPtr operation);
        int IsTray(out bool isTray);
        int IsInHighZOrderBand(out bool isInHighZOrderBand);
        int IsSplashScreenPresented(out bool isSplashScreenPresented);
        int Flash();
        int GetRootSwitchableOwner(out IApplicationView rootSwitchableOwner);
        int EnumerateOwnershipTree(out IObjectArray ownershipTree);
        int GetEnterpriseId([MarshalAs(UnmanagedType.LPWStr)] out string enterpriseId);
        int IsMirrored(out bool isMirrored);
        int Unknown1(out int unknown);
        int Unknown2(out int unknown);
        int Unknown3(out int unknown);
        int Unknown4(out int unknown);
        int Unknown5(out int unknown);
        int Unknown6(int unknown);
        int Unknown7();
        int Unknown8(out int unknown);
        int Unknown9(int unknown);
        int Unknown10(int unknownX, int unknownY);
        int Unknown11(int unknown);
        int Unknown12(out SIZE size1);
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct SIZE
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("1841C6D7-4F9D-42C0-AF41-8747538F10E5")]
    internal interface IApplicationViewCollection
    {
        int GetViews(out IObjectArray array);
        int GetViewsByZOrder(out IObjectArray array);
        int GetViewsByAppUserModelId(string id, out IObjectArray array);
        int GetViewForHwnd(IntPtr hwnd, out IApplicationView view);
        int GetViewForApplication(object application, out IApplicationView view);
        int GetViewForAppUserModelId(string id, out IApplicationView view);
        int GetViewInFocus(out IntPtr view);
        int Unknown1(out IntPtr view);
        void RefreshCollection();
        int RegisterForApplicationViewChanges(object listener, out int cookie);
        int UnregisterForApplicationViewChanges(int cookie);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B")]
    internal interface IVirtualDesktopManager
    {
        bool IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow);
        Guid GetWindowDesktopId(IntPtr topLevelWindow);
        void MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("4CE81583-1E4C-4632-A621-07A53543148F")]
    internal interface IVirtualDesktopPinnedApps
    {
        bool IsAppIdPinned(string appId);
        void PinAppID(string appId);
        void UnpinAppID(string appId);
        bool IsViewPinned(IApplicationView applicationView);
        void PinView(IApplicationView applicationView);
        void UnpinView(IApplicationView applicationView);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("6D5140C1-7436-11CE-8034-00AA006009FA")]
    internal interface IServiceProvider10
    {
        [return: MarshalAs(UnmanagedType.IUnknown)]
        object QueryService(ref Guid service, ref Guid riid);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("92CA9DCD-5622-4BBA-A805-5E9F541BD8C9")]
    internal interface IObjectArray
    {
        void GetCount(out int count);
        void GetAt(int index, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object obj);
    }

    public static class DesktopInterop
    {
        private static Guid CLSID_ImmersiveShell = new Guid("C2F03A33-21F5-47FA-B4BB-156362A2F239");
        private static Guid CLSID_VirtualDesktopManager = new Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A");
        private static Guid CLSID_VirtualDesktopPinnedApps = new Guid("B5A399E7-1C87-46B8-88E9-FC5747B171BD");

        private static IVirtualDesktopManager _desktopManager;
        private static IApplicationViewCollection _applicationViews;
        private static IVirtualDesktopPinnedApps _pinnedApps;

        private static bool EnsureDesktopManager()
        {
            if (_desktopManager != null)
            {
                return true;
            }

            try
            {
                _desktopManager = (IVirtualDesktopManager)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_VirtualDesktopManager));
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool EnsurePinningServices()
        {
            if (_applicationViews != null && _pinnedApps != null)
            {
                return true;
            }

            try
            {
                var shell = (IServiceProvider10)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_ImmersiveShell));
                var applicationViewGuid = typeof(IApplicationViewCollection).GUID;
                var pinnedAppsGuid = typeof(IVirtualDesktopPinnedApps).GUID;
                _applicationViews = (IApplicationViewCollection)shell.QueryService(ref applicationViewGuid, ref applicationViewGuid);
                _pinnedApps = (IVirtualDesktopPinnedApps)shell.QueryService(ref CLSID_VirtualDesktopPinnedApps, ref pinnedAppsGuid);
                return _applicationViews != null && _pinnedApps != null;
            }
            catch
            {
                return false;
            }
        }

        private static IApplicationView GetView(long hwnd)
        {
            if (!EnsurePinningServices())
            {
                return null;
            }

            IApplicationView view;
            _applicationViews.GetViewForHwnd((IntPtr)hwnd, out view);
            return view;
        }

        public static string GetWindowDesktopId(long hwnd)
        {
            if (!EnsureDesktopManager())
            {
                return string.Empty;
            }

            try
            {
                return _desktopManager.GetWindowDesktopId((IntPtr)hwnd).ToString().ToLowerInvariant();
            }
            catch
            {
                return string.Empty;
            }
        }

        public static bool MoveWindowToDesktop(long hwnd, string desktopId)
        {
            if (!EnsureDesktopManager())
            {
                return false;
            }

            try
            {
                var guid = new Guid(desktopId);
                _desktopManager.MoveWindowToDesktop((IntPtr)hwnd, ref guid);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static bool IsWindowPinned(long hwnd)
        {
            try
            {
                var view = GetView(hwnd);
                return view != null && _pinnedApps.IsViewPinned(view);
            }
            catch
            {
                return false;
            }
        }

        public static bool PinWindow(long hwnd)
        {
            try
            {
                var view = GetView(hwnd);
                if (view == null)
                {
                    return false;
                }

                if (!_pinnedApps.IsViewPinned(view))
                {
                    _pinnedApps.PinView(view);
                }

                return true;
            }
            catch
            {
                return false;
            }
        }

        public static bool UnpinWindow(long hwnd)
        {
            try
            {
                var view = GetView(hwnd);
                if (view == null)
                {
                    return false;
                }

                if (_pinnedApps.IsViewPinned(view))
                {
                    _pinnedApps.UnpinView(view);
                }

                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
`;

function hwndToInt(hwnd: HwndLike): number {
  if (typeof hwnd === 'number') {
    return hwnd;
  }

  if (hwnd.length === 8) {
    return Number(hwnd.readBigUInt64LE());
  }

  return hwnd.readUInt32LE();
}

function runPowerShell(script: string, timeoutMs: number = 8000): string {
  const result = runWindowsPowerShellSync({ script, timeoutMs, mode: 'encoded' });
  if (!result.ok) {
    throw new Error(result.stderr || 'PowerShell command failed');
  }

  return result.stdout.trim();
}

function runPowerShellJson<T>(script: string, timeoutMs: number = 8000): T | null {
  try {
    const output = runPowerShell(script, timeoutMs);
    if (!output) {
      return null;
    }

    return JSON.parse(output) as T;
  } catch (error) {
    console.warn('[VirtualDesktop] PowerShell JSON command failed:', error);
    return null;
  }
}

function runInteropAction(action: string, args: string[] = []): string | null {
  try {
    const literalArgs = args
      .map((arg) => (/^-?\d+$/.test(arg) ? arg : `'${arg.replace(/'/g, "''")}'`))
      .join(', ');
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @"
${PINNING_INTEROP}
"@
$result = [AperantDesktopInterop.DesktopInterop]::${action}(${literalArgs})
if ($null -ne $result) { Write-Output $result }
`;

    const output = (() => {
      const result = runWindowsPowerShellSync({ script, timeoutMs: 10000, mode: 'file' });
      if (!result.ok) {
        throw new Error(result.stderr || `Interop action "${action}" failed`);
      }
      return result.stdout.trim();
    })();
    return output.length > 0 ? output : null;
  } catch (error) {
    console.warn(`[VirtualDesktop] Interop action "${action}" failed:`, error);
    return null;
  }
}

function readRegistryDesktopState(): RegistryDesktopState | null {
  return runPowerShellJson<RegistryDesktopState>(`
$ErrorActionPreference = 'Stop'
$rootPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops'
$root = Get-ItemProperty -Path $rootPath -ErrorAction Stop
$currentDesktopId = $null
if ($root.PSObject.Properties.Name -contains 'CurrentVirtualDesktop' -and $root.CurrentVirtualDesktop) {
  $currentDesktopId = (New-Object Guid (,[byte[]]$root.CurrentVirtualDesktop)).Guid.ToString().ToLowerInvariant()
}

$desktops = @()
if ($root.PSObject.Properties.Name -contains 'VirtualDesktopIDs' -and $root.VirtualDesktopIDs) {
  $bytes = [byte[]]$root.VirtualDesktopIDs
  $desktopIndex = 1
  for ($i = 0; $i -le ($bytes.Length - 16); $i += 16) {
    $chunk = [byte[]]$bytes[$i..($i + 15)]
    $desktopId = (New-Object Guid (,$chunk)).Guid.ToString().ToLowerInvariant()
    $desktopKey = Join-Path $rootPath ("Desktops\\{" + $desktopId.ToUpperInvariant() + "}")
    $desktopName = $null
    if (Test-Path $desktopKey) {
      $desktopProps = Get-ItemProperty -Path $desktopKey
      if ($desktopProps.PSObject.Properties.Name -contains 'Name') {
        $desktopName = [string]$desktopProps.Name
      }
    }
    $desktops += [PSCustomObject]@{
      id = $desktopId
      number = $desktopIndex
      name = $desktopName
      visible = ($desktopId -eq $currentDesktopId)
    }
    $desktopIndex++
  }
}

[PSCustomObject]@{
  currentDesktopId = $currentDesktopId
  desktops = $desktops
} | ConvertTo-Json -Compress -Depth 4
`);
}

export function getVirtualDesktopAvailability(): VirtualDesktopAvailability {
  if (!isWindows()) {
    return { available: false, error: 'Windows virtual desktop features are only available on Windows.' };
  }

  const state = readRegistryDesktopState();
  if (!state?.currentDesktopId) {
    return {
      available: false,
      error: 'Virtual desktop registry state is unavailable on this machine.',
    };
  }

  return { available: true };
}

export function getCurrentVirtualDesktop(): VirtualDesktopInfo | null {
  if (!isWindows()) {
    return null;
  }

  const state = readRegistryDesktopState();
  if (!state?.currentDesktopId) {
    return null;
  }

  return state.desktops.find((desktop) => desktop.id === state.currentDesktopId)
    ?? {
      id: state.currentDesktopId,
      number: null,
      name: null,
      visible: true,
    };
}

export function getWindowVirtualDesktopId(hwnd: HwndLike): string | null {
  if (!isWindows()) {
    return null;
  }

  const result = runInteropAction('GetWindowDesktopId', [String(hwndToInt(hwnd))]);
  if (!result) {
    return null;
  }

  const desktopId = result.trim().toLowerCase();
  return desktopId.length > 0 ? desktopId : null;
}

export function getWindowVirtualDesktopInfo(hwnd: HwndLike): VirtualDesktopInfo | null {
  if (!isWindows()) {
    return null;
  }

  const desktopId = getWindowVirtualDesktopId(hwnd);
  if (!desktopId) {
    return null;
  }

  if (ALL_DESKTOP_IDS.has(desktopId)) {
    const currentDesktop = getCurrentVirtualDesktop();
    return currentDesktop
      ? { ...currentDesktop }
      : {
        id: desktopId,
        number: null,
        name: null,
        visible: true,
      };
  }

  const state = readRegistryDesktopState();
  if (!state) {
    return {
      id: desktopId,
      number: null,
      name: null,
      visible: null,
    };
  }

  return state.desktops.find((desktop) => desktop.id === desktopId)
    ?? {
      id: desktopId,
      number: null,
      name: null,
      visible: state.currentDesktopId === desktopId,
    };
}

export function moveWindowToVirtualDesktop(hwnd: HwndLike, desktopId: string): boolean {
  if (!isWindows() || !desktopId) {
    return false;
  }

  const result = runInteropAction('MoveWindowToDesktop', [String(hwndToInt(hwnd)), desktopId]);
  return result?.trim().toLowerCase() === 'true';
}

export function moveWindowToCurrentVirtualDesktop(hwnd: HwndLike): boolean {
  const currentDesktop = getCurrentVirtualDesktop();
  if (!currentDesktop?.id) {
    return false;
  }

  return moveWindowToVirtualDesktop(hwnd, currentDesktop.id);
}

export function isWindowPinnedToAllDesktops(hwnd: HwndLike): boolean {
  if (!isWindows()) {
    return false;
  }

  const result = runInteropAction('IsWindowPinned', [String(hwndToInt(hwnd))]);
  return result?.trim().toLowerCase() === 'true';
}

export function pinWindowToAllDesktops(hwnd: HwndLike): boolean {
  if (!isWindows()) {
    return false;
  }

  const result = runInteropAction('PinWindow', [String(hwndToInt(hwnd))]);
  return result?.trim().toLowerCase() === 'true';
}

export function unpinWindowFromAllDesktops(hwnd: HwndLike): boolean {
  if (!isWindows()) {
    return false;
  }

  const result = runInteropAction('UnpinWindow', [String(hwndToInt(hwnd))]);
  return result?.trim().toLowerCase() === 'true';
}
