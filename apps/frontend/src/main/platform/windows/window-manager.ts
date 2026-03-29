/**
 * Windows Window Manager
 *
 * Provides VS Code window enumeration and message sending functionality.
 * Uses inline PowerShell that mirrors ClaudeAutoResponse logic.
 *
 * Only works on Windows - functions return empty results on other platforms.
 */

import { execSync, exec } from 'child_process';
import { isWindows } from '../index';
import { stripControlChars } from '../../ipc-handlers/shared/sanitize';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Represents a VS Code window
 */
export interface VSCodeWindow {
  handle: number;
  title: string;
  processId: number;
}

/**
 * Result of sending a message to a window
 */
export interface SendMessageResult {
  success: boolean;
  error?: string;
}

/**
 * Encode a PowerShell script to Base64 for use with -EncodedCommand
 * This avoids all escaping issues with quotes, special characters, etc.
 */
function encodePS(script: string): string {
  // PowerShell -EncodedCommand expects UTF-16LE Base64
  const buffer = Buffer.from(script, 'utf16le');
  return buffer.toString('base64');
}

/**
 * Get all VS Code windows currently open
 *
 * Uses PowerShell to enumerate windows via Win32 APIs.
 * Same logic as ClaudeAutoResponse MainViewModel.
 *
 * @returns Array of VS Code windows, empty array if none found or not on Windows
 */
export function getVSCodeWindows(): VSCodeWindow[] {
  if (!isWindows()) {
    console.warn('[WindowManager] getVSCodeWindows only works on Windows');
    return [];
  }

  try {
    // Simple PowerShell script to enumerate VS Code windows
    // Added $ProgressPreference to suppress CLIXML progress output
    // Use EnumWindows + GetWindowThreadProcessId to find ALL VS Code windows
    // across ALL virtual desktops. Process.MainWindowHandle only returns one.
    const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class WinEnum {
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    public static List<long[]> handles = new List<long[]>();
    public static List<string> titles = new List<string>();
    public static void Find() {
        handles.Clear(); titles.Clear();
        EnumWindows((hWnd, p) => {
            if (!IsWindowVisible(hWnd)) return true;
            int len = GetWindowTextLength(hWnd);
            if (len == 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            string title = sb.ToString();
            if (title.Contains("Visual Studio Code")) {
                uint pid; GetWindowThreadProcessId(hWnd, out pid);
                handles.Add(new long[] { hWnd.ToInt64(), pid });
                titles.Add(title);
            }
            return true;
        }, IntPtr.Zero);
    }
}
"@
[WinEnum]::Find()
$windows = @()
for ($i = 0; $i -lt [WinEnum]::handles.Count; $i++) {
    $h = [WinEnum]::handles[$i]
    $t = [WinEnum]::titles[$i] -replace '[\x00-\x1f\x7f]', ''
    $windows += @{ handle = $h[0]; title = $t; processId = [int]$h[1] }
}
if ($windows.Count -eq 0) { Write-Output "[]" }
else { $windows | ConvertTo-Json -Compress }
`;

    const encoded = encodePS(script);
    const result = execSync(
      `powershell -ExecutionPolicy Bypass -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true
      }
    );

    // Extract only the JSON part (filter out CLIXML and other noise)
    const lines = result.split('\n').map(l => l.trim()).filter(l => l);
    const jsonLine = lines.find(l => l.startsWith('[') || l.startsWith('{'));

    if (!jsonLine || jsonLine === '[]') {
      console.log('[WindowManager] No VS Code windows found');
      return [];
    }

    // Sanitize control characters that PowerShell's ConvertTo-Json doesn't escape
    const sanitized = stripControlChars(jsonLine, false);
    const windows = JSON.parse(sanitized);
    console.log('[WindowManager] Found windows:', windows);
    return Array.isArray(windows) ? windows : [windows];
  } catch (error) {
    console.error('[WindowManager] Failed to get VS Code windows:', error);
    return [];
  }
}

/**
 * Send a message to a VS Code window
 *
 * Uses PowerShell to:
 * 1. Re-enumerate windows to get fresh handle (eliminates race condition)
 * 2. Find window by title pattern
 * 3. Copy message to clipboard
 * 4. Focus the target window
 * 5. Send Ctrl+V to paste
 * 6. Send Enter to submit
 * 7. Restore original foreground window
 *
 * Same logic as ClaudeAutoResponse PermissionMonitorService.SendMessageToClaudeCode.
 *
 * @param identifier - Process ID (number) for stable matching, or title pattern (string) for fuzzy matching
 * @param message - Message to send
 * @returns Promise resolving to success/error result
 */
export function sendMessageToWindow(
  identifier: number | string,
  message: string
): Promise<SendMessageResult> {
  return new Promise((resolve) => {
    if (!isWindows()) {
      resolve({ success: false, error: 'Only works on Windows' });
      return;
    }

    if (!identifier && identifier !== 0) {
      resolve({ success: false, error: 'Window identifier cannot be empty' });
      return;
    }

    if (!message) {
      resolve({ success: false, error: 'Message cannot be empty' });
      return;
    }

    // Re-enumerate windows to get fresh handle (prevents stale handle errors)
    const matchType = typeof identifier === 'number' ? 'PID' : 'title';
    console.log(`[WindowManager] Looking for window by ${matchType}: "${identifier}"`);
    const windows = getVSCodeWindows();

    if (windows.length === 0) {
      resolve({ success: false, error: 'No VS Code windows found' });
      return;
    }

    // Find window by process ID (stable) or title pattern (fuzzy)
    const targetWindow = findWindow(identifier);

    if (!targetWindow) {
      const availableTitles = windows.map(w => w.title).join(', ');
      resolve({
        success: false,
        error: `No window found matching "${identifier}". Available: ${availableTitles}`
      });
      return;
    }

    const handle = targetWindow.handle;
    console.log(`[WindowManager] Found window: "${targetWindow.title}" (handle: ${handle})`)

    // Use temp files to avoid command line length limit
    const tempFile = path.join(os.tmpdir(), `rdr-message-${Date.now()}.txt`);
    let scriptFile: string | null = null;

    try {
      // Write message to temp file with UTF-8 encoding
      fs.writeFileSync(tempFile, message, { encoding: 'utf-8' });

      // Build PowerShell script that reads from file
      // This avoids the ~8191 char command line limit
      const script = `
$ProgressPreference = 'SilentlyContinue'
$Handle = ${handle}
$MessageFile = '${tempFile.replace(/\\/g, '\\\\')}'

# Read message from file
if (-not (Test-Path $MessageFile)) {
    Write-Error "Message file not found: $MessageFile"
    exit 1
}
$Message = Get-Content -Path $MessageFile -Raw -Encoding UTF8

# Clean up temp file
Remove-Item -Path $MessageFile -Force -ErrorAction SilentlyContinue

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
}
"@

# Validate window handle
if (-not [Win32]::IsWindow([IntPtr]$Handle)) {
    Write-Error "Invalid window handle"
    exit 1
}

# Save original foreground window
$original = [Win32]::GetForegroundWindow()

# Copy message to clipboard
Set-Clipboard -Value $Message

# Focus target window
[Win32]::SetForegroundWindow([IntPtr]$Handle) | Out-Null
Start-Sleep -Milliseconds 150

# Verify focus succeeded
$current = [Win32]::GetForegroundWindow()
if ($current -ne [IntPtr]$Handle) {
    Write-Error "Failed to focus window"
    exit 1
}

# Send Ctrl+V (paste)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 100

# Send Enter (submit)
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 50

# Restore original window (optional, don't fail if it doesn't work)
if ($original -ne [IntPtr]::Zero -and $original -ne [IntPtr]$Handle) {
    Start-Sleep -Milliseconds 100
    [Win32]::SetForegroundWindow($original) | Out-Null
}

Write-Output "Message sent successfully"
`;

      // Write script to temp file
      scriptFile = path.join(os.tmpdir(), `rdr-script-${Date.now()}.ps1`);
      fs.writeFileSync(scriptFile, script, { encoding: 'utf-8' });

      // Execute PowerShell script from file (no command line length limit)
      const command = `powershell -ExecutionPolicy Bypass -NoProfile -NonInteractive -File "${scriptFile}"`;

      exec(
        command,
        {
          timeout: 10000,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          // Clean up script file
          if (scriptFile) {
            try {
              fs.unlinkSync(scriptFile);
            } catch (e) {
              // Ignore cleanup errors
            }
          }

          if (error) {
            console.error('[WindowManager] Failed to send message:', error.message);
            resolve({
              success: false,
              error: stderr || error.message
            });
          } else {
            console.log('[WindowManager] Message sent successfully');
            resolve({ success: true });
          }
        }
      );
    } catch (error) {
      // Clean up temp files on error
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        if (scriptFile && fs.existsSync(scriptFile)) fs.unlinkSync(scriptFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[WindowManager] Exception sending message:', errorMessage);
      resolve({ success: false, error: errorMessage });
    }
  });
}

/**
 * Check if Claude Code is currently busy (in a prompt loop)
 *
 * Detection strategy: Monitor VS Code window title for busy indicators
 *
 * @param identifier - Process ID (number) for stable matching, or title pattern (string) for fuzzy matching
 * @returns Promise resolving to true if Claude Code is busy, false if idle
 */
export async function isClaudeCodeBusy(identifier: number | string): Promise<boolean> {
  if (!isWindows()) {
    return false; // Assume idle on non-Windows
  }

  try {
    console.log('[WindowManager] 🔍 Checking if Claude Code is busy...');

    // Get current windows (fresh list)
    const windows = getVSCodeWindows();
    const targetWindow = findWindow(identifier);

    if (!targetWindow) {
      console.warn('[WindowManager] Window not found, assuming idle');
      return false;
    }

    // PRIMARY: Check window title for busy patterns
    const busyPatterns = [
      /thinking/i,             // "Claude is thinking..."
      /generating/i,           // "Generating response..."
      /processing/i,           // "Processing..."
      /claude.*working/i,      // "Claude is working..."
      /claude's plan/i,        // "Claude's Plan - ..." (plan mode active in VS Code)
    ];

    const titleIndicatesBusy = busyPatterns.some(pattern => pattern.test(targetWindow.title));

    if (titleIndicatesBusy) {
      console.log(`[WindowManager] BUSY: Window title indicates busy - "${targetWindow.title}"`);
      return true;
    }

    // SECONDARY: Check MCP connection (definitive when active)
    // MCP Monitor only tracks user's Claude Code -> Auto-Claude MCP server
    // Task agents do NOT connect to this MCP server
    try {
      const { mcpMonitor } = await import('../../mcp-server');
      if (mcpMonitor?.isBusy()) {
        console.log('[WindowManager] BUSY: MCP connection active (user Claude Code is calling tools)');
        return true;
      }
    } catch {
      // MCP monitor not available
    }

    // TERTIARY: Check OutputMonitor + ● combo
    // ● alone is unreliable (task agents cause unsaved files → always present)
    // But ● combined with non-IDLE OutputMonitor indicates active user session
    try {
      const { outputMonitor } = await import('../../claude-code/output-monitor');
      const state = outputMonitor?.getCurrentState();
      if (state === 'PROCESSING') {
        console.log('[WindowManager] BUSY: OutputMonitor reports PROCESSING');
        return true;
      }
      if (/●/.test(targetWindow.title) && state !== 'IDLE') {
        console.log(`[WindowManager] BUSY: Modified indicator (●) + OutputMonitor ${state}`);
        return true;
      }
    } catch {
      // OutputMonitor not available
    }

    console.log('[WindowManager] All checks passed - Claude Code is IDLE');
    return false;
  } catch (error) {
    console.error('[WindowManager] Error checking busy state:', error);
    return false; // Assume idle on error
  }
}

/**
 * Find a VS Code window by title pattern
 *
 * Useful for matching a window to a project name.
 *
 * @param pattern - Substring to search for in window titles (case-insensitive)
 * @returns Matching window or undefined
 */
export function findWindowByTitle(pattern: string): VSCodeWindow | undefined {
  const windows = getVSCodeWindows();
  const lowerPattern = pattern.toLowerCase();

  return windows.find((w) =>
    w.title.toLowerCase().includes(lowerPattern)
  );
}

/**
 * Find a VS Code window by process ID
 *
 * More stable than title matching since process ID doesn't change
 * when the user switches editor tabs.
 *
 * @param pid - Process ID of the VS Code instance
 * @returns Matching window or undefined
 */
export function findWindowByProcessId(pid: number): VSCodeWindow | undefined {
  const windows = getVSCodeWindows();
  return windows.find((w) => w.processId === pid);
}

/**
 * Find a VS Code window by identifier (process ID or title pattern)
 *
 * @param identifier - Process ID (number) for stable matching, or title pattern (string) for fuzzy matching
 * @returns Matching window or undefined
 */
export function findWindow(identifier: number | string): VSCodeWindow | undefined {
  if (typeof identifier === 'number') {
    return findWindowByProcessId(identifier);
  }
  return findWindowByTitle(identifier);
}

/**
 * Check if a window handle is still valid
 *
 * Window handles can become invalid if the window is closed.
 * This checks by trying to enumerate current windows.
 *
 * @param handle - Window handle to check
 * @returns true if window still exists
 */
export function isWindowValid(handle: number): boolean {
  const windows = getVSCodeWindows();
  return windows.some((w) => w.handle === handle);
}
