/**
 * Windows 11 Virtual Desktop persistence helpers
 *
 * Uses PowerShell COM interop via CoCreateInstance to call IVirtualDesktopManager.
 * The New-Object + cast approach fails on Windows 11 — must use P/Invoke CoCreateInstance.
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
 * C# type definition that works on Windows 11 — uses CoCreateInstance P/Invoke
 */
const VD_CSHARP_TYPE = `
using System;
using System.Runtime.InteropServices;

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
public interface IVirtualDesktopManager
{
    [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow, out int onCurrentDesktop);
    [PreserveSig] int GetWindowDesktopId(IntPtr topLevelWindow, out Guid desktopId);
    [PreserveSig] int MoveWindowToDesktop(IntPtr topLevelWindow, [MarshalAs(UnmanagedType.LPStruct)] Guid desktopId);
}

public static class VDManager
{
    [DllImport("ole32.dll")]
    static extern int CoCreateInstance(
        [MarshalAs(UnmanagedType.LPStruct)] Guid rclsid,
        IntPtr pUnkOuter, uint dwClsContext,
        [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        out IVirtualDesktopManager ppv);

    public static string GetDesktopId(IntPtr hwnd)
    {
        IVirtualDesktopManager mgr;
        var hr = CoCreateInstance(
            new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a"),
            IntPtr.Zero, 1,
            new Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b"),
            out mgr);
        if (hr != 0) return "";
        Guid desktopId;
        hr = mgr.GetWindowDesktopId(hwnd, out desktopId);
        if (hr != 0) return "";
        return desktopId.ToString();
    }

    public static int MoveToDesktop(IntPtr hwnd, string guidStr)
    {
        IVirtualDesktopManager mgr;
        var hr = CoCreateInstance(
            new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a"),
            IntPtr.Zero, 1,
            new Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b"),
            out mgr);
        if (hr != 0) return hr;
        return mgr.MoveWindowToDesktop(hwnd, new Guid(guidStr));
    }
}
`;

/**
 * Convert Electron's native window handle Buffer to an integer for PowerShell
 */
function hwndToInt(hwnd: Buffer): number {
  if (hwnd.length === 8) {
    return Number(hwnd.readBigUInt64LE());
  }
  return hwnd.readUInt32LE();
}

/**
 * Get the virtual desktop GUID for a window
 */
export function getWindowVirtualDesktopId(hwnd: Buffer): string | null {
  if (!isWindows()) return null;

  try {
    const hwndInt = hwndToInt(hwnd);
    const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
${VD_CSHARP_TYPE}
"@
$result = [VDManager]::GetDesktopId([IntPtr]${hwndInt})
if ($result -and $result -ne "") { Write-Output $result }
`;

    const result = execSync(
      `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodePS(script)}`,
      { windowsHide: true, timeout: 8000, encoding: 'utf8' }
    ).trim();

    if (result && result.length > 10) {
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
 */
export function moveWindowToVirtualDesktop(hwnd: Buffer, desktopGuid: string): boolean {
  if (!isWindows()) return false;

  try {
    const hwndInt = hwndToInt(hwnd);
    const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
${VD_CSHARP_TYPE}
"@
$hr = [VDManager]::MoveToDesktop([IntPtr]${hwndInt}, "${desktopGuid}")
if ($hr -eq 0) { Write-Output "OK" } else { Write-Output "FAIL:$hr" }
`;

    const result = execSync(
      `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodePS(script)}`,
      { windowsHide: true, timeout: 8000, encoding: 'utf8' }
    ).trim();

    if (result === 'OK') {
      console.log('[VirtualDesktop] Moved window to desktop:', desktopGuid);
      return true;
    }
    console.warn('[VirtualDesktop] Move failed:', result);
    return false;
  } catch (error) {
    console.warn('[VirtualDesktop] Failed to move window:', error);
    return false;
  }
}
