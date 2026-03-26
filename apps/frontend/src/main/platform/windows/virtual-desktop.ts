/**
 * Windows 11 Virtual Desktop persistence helpers
 *
 * Uses PowerShell COM interop to call IVirtualDesktopManager for:
 * - Getting which virtual desktop a window is on (GUID)
 * - Moving a window to a specific virtual desktop
 *
 * This enables the watchdog to reopen Electron on the same virtual desktop
 * after a crash/freeze restart.
 */

import { execSync } from 'child_process';
import { isWindows } from '../index';

/**
 * Encode a PowerShell script to Base64 for use with -EncodedCommand
 */
function encodePS(script: string): string {
  const buffer = Buffer.from(script, 'utf16le');
  return buffer.toString('base64');
}

/**
 * COM type definition for IVirtualDesktopManager (shared by both functions)
 */
const VIRTUAL_DESKTOP_COM_TYPES = `
[ComImport, Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IVirtualDesktopManager {
    int IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow, out int onCurrentDesktop);
    int GetWindowDesktopId(IntPtr topLevelWindow, out Guid desktopId);
    int MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
}

[ComImport, Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")]
public class CVirtualDesktopManager {}
`;

/**
 * Convert Electron's native window handle Buffer to an integer for PowerShell
 */
function hwndToInt(hwnd: Buffer): number {
  // Electron returns HWND as a Buffer — read as pointer-sized integer
  if (hwnd.length === 8) {
    return Number(hwnd.readBigUInt64LE());
  }
  return hwnd.readUInt32LE();
}

/**
 * Get the virtual desktop GUID for a window
 *
 * @param hwnd - Native window handle from BrowserWindow.getNativeWindowHandle()
 * @returns GUID string or null on failure
 */
export function getWindowVirtualDesktopId(hwnd: Buffer): string | null {
  if (!isWindows()) return null;

  try {
    const hwndInt = hwndToInt(hwnd);
    const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
${VIRTUAL_DESKTOP_COM_TYPES}
"@
try {
  $vdm = New-Object CVirtualDesktopManager
  $mgr = [IVirtualDesktopManager]$vdm
  $desktopId = [Guid]::Empty
  $hwnd = [IntPtr]${hwndInt}
  $hr = $mgr.GetWindowDesktopId($hwnd, [ref]$desktopId)
  if ($hr -eq 0 -and $desktopId -ne [Guid]::Empty) {
    Write-Output $desktopId.ToString()
  }
} catch {}
`;

    const result = execSync(
      `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodePS(script)}`,
      { windowsHide: true, timeout: 5000, encoding: 'utf8' }
    ).trim();

    if (result && result.length > 0) {
      console.log('[VirtualDesktop] Got desktop ID:', result);
      return result;
    }
    return null;
  } catch (error) {
    console.warn('[VirtualDesktop] Failed to get desktop ID:', error);
    return null;
  }
}

/**
 * Move a window to a specific virtual desktop
 *
 * @param hwnd - Native window handle from BrowserWindow.getNativeWindowHandle()
 * @param desktopGuid - GUID of the target virtual desktop
 * @returns true on success, false on failure
 */
export function moveWindowToVirtualDesktop(hwnd: Buffer, desktopGuid: string): boolean {
  if (!isWindows()) return false;

  try {
    const hwndInt = hwndToInt(hwnd);
    const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
${VIRTUAL_DESKTOP_COM_TYPES}
"@
try {
  $vdm = New-Object CVirtualDesktopManager
  $mgr = [IVirtualDesktopManager]$vdm
  $desktopId = [Guid]"${desktopGuid}"
  $hwnd = [IntPtr]${hwndInt}
  $hr = $mgr.MoveWindowToDesktop($hwnd, [ref]$desktopId)
  if ($hr -eq 0) { Write-Output "OK" }
} catch {}
`;

    const result = execSync(
      `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodePS(script)}`,
      { windowsHide: true, timeout: 5000, encoding: 'utf8' }
    ).trim();

    if (result === 'OK') {
      console.log('[VirtualDesktop] Moved window to desktop:', desktopGuid);
      return true;
    }
    return false;
  } catch (error) {
    console.warn('[VirtualDesktop] Failed to move window:', error);
    return false;
  }
}
