import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { createInterface, type Interface as ReadLineInterface } from 'readline';
import type { VirtualDesktopInfo } from '../../shared/types';
import { isWindows } from '../platform';
import {
  findWindowsPowerShellPath,
  getWindowsSafeTempDir,
  sanitizePowerShellOutput,
} from '../platform/windows/powershell-runner';
import {
  getCurrentVirtualDesktop,
  resolveVirtualDesktopNotificationInteropInfo,
  type VirtualDesktopNotificationBuildFamily,
  type VirtualDesktopNotificationInteropInfo,
} from '../platform/windows/virtual-desktop';

export type DesktopNotificationEventType =
  | 'ready'
  | 'current-desktop-changed'
  | 'desktop-created'
  | 'desktop-destroyed'
  | 'desktop-renamed'
  | 'error'
  | 'disconnected';

export interface DesktopNotificationEvent {
  type: DesktopNotificationEventType;
  currentDesktopId?: string | null;
  currentDesktop?: VirtualDesktopInfo | null;
  desktops?: VirtualDesktopInfo[];
  oldDesktopId?: string | null;
  newDesktopId?: string | null;
  desktopId?: string | null;
  fallbackDesktopId?: string | null;
  explorerPid?: number | null;
  buildNumber?: number | null;
  family?: VirtualDesktopNotificationBuildFamily;
  reason?: string;
  message?: string;
}

export interface DesktopNotificationBridgeState {
  supported: boolean;
  running: boolean;
  healthy: boolean;
  error?: string;
  buildNumber?: number | null;
  family?: VirtualDesktopNotificationBuildFamily | null;
}

type DesktopEventListener = (event: DesktopNotificationEvent) => void;
type DesktopStateListener = (state: DesktopNotificationBridgeState) => void;

function decodeBridgeField(value: string | undefined): string {
  if (!value) {
    return '';
  }

  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function createBridgeLaunchEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const safeTempDir = getWindowsSafeTempDir(baseEnv);
  return {
    ...baseEnv,
    TEMP: safeTempDir,
    TMP: safeTempDir,
    TMPDIR: safeTempDir,
  };
}

function createBridgeScriptPath(baseEnv: NodeJS.ProcessEnv = process.env): string {
  const safeTempDir = getWindowsSafeTempDir(baseEnv);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return join(safeTempDir, `aperant-desktop-bridge-${token}.ps1`);
}

function findDesktopBridgePowerShellPath(baseEnv: NodeJS.ProcessEnv = process.env): string | null {
  const systemWindowsPowerShellPath = join(
    baseEnv.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );

  if (existsSync(systemWindowsPowerShellPath)) {
    return systemWindowsPowerShellPath;
  }

  return findWindowsPowerShellPath(baseEnv);
}

function getNotificationInterfaceDefinition(
  info: VirtualDesktopNotificationInteropInfo
): string {
  if (info.family === 'build22621') {
    return `
[ComImport]
[Guid("${info.notificationGuid}")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IVirtualDesktopNotification
{
    void VirtualDesktopCreated(IVirtualDesktop pDesktop);
    void VirtualDesktopDestroyBegin(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback);
    void VirtualDesktopDestroyFailed(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback);
    void VirtualDesktopDestroyed(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback);
    void VirtualDesktopMoved(IVirtualDesktop pDesktop, long nIndexFrom, long nIndexTo);
    void VirtualDesktopNameChanged(IVirtualDesktop pDesktop, IntPtr chName);
    void ViewVirtualDesktopChanged(IApplicationView pView);
    void CurrentVirtualDesktopChanged(IVirtualDesktop pDesktopOld, IVirtualDesktop pDesktopNew);
    void VirtualDesktopWallpaperChanged(IVirtualDesktop pDesktop, IntPtr chPath);
    void VirtualDesktopSwitched(IVirtualDesktop pDesktop);
    void RemoteVirtualDesktopConnected(IVirtualDesktop pDesktop);
}
`;
  }

  if (info.family === 'build22000') {
    return `
[ComImport]
[Guid("${info.notificationGuid}")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IVirtualDesktopNotification
{
    void VirtualDesktopCreated(IObjectArray p0, IVirtualDesktop pDesktop);
    void VirtualDesktopDestroyBegin(IObjectArray p0, IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback);
    void VirtualDesktopDestroyFailed(IObjectArray p0, IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback);
    void VirtualDesktopDestroyed(IObjectArray p0, IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback);
    void Proc7(int p0);
    void VirtualDesktopMoved(IObjectArray p0, IVirtualDesktop pDesktop, int nIndexFrom, int nIndexTo);
    void VirtualDesktopRenamed(IVirtualDesktop pDesktop, IntPtr chName);
    void ViewVirtualDesktopChanged(IApplicationView pView);
    void CurrentVirtualDesktopChanged(IObjectArray p0, IVirtualDesktop pDesktopOld, IVirtualDesktop pDesktopNew);
    void VirtualDesktopWallpaperChanged(IVirtualDesktop pDesktop, IntPtr chPath);
}
`;
  }

  return `
[ComImport]
[Guid("${info.notificationGuid}")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IVirtualDesktopNotification
{
    void VirtualDesktopCreated(IVirtualDesktop pDesktop);
    void VirtualDesktopDestroyBegin(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback);
    void VirtualDesktopDestroyFailed(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback);
    void VirtualDesktopDestroyed(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback);
    void ViewVirtualDesktopChanged(IApplicationView pView);
    void CurrentVirtualDesktopChanged(IVirtualDesktop pDesktopOld, IVirtualDesktop pDesktopNew);
}
`;
}

function getVirtualDesktopInterfaceDefinition(
  info: VirtualDesktopNotificationInteropInfo
): string {
  const extraMembers =
    info.family === 'build22000'
      ? `
    IntPtr Proc5();
    IntPtr GetName();
    IntPtr GetWallpaperPath();
`
      : '';

  return `
[ComImport]
[Guid("${info.virtualDesktopGuid}")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IVirtualDesktop
{
    bool IsViewVisible(IApplicationView view);
    Guid GetID();
${extraMembers}}
`;
}

function getNotificationListenerImplementation(
  info: VirtualDesktopNotificationInteropInfo
): string {
  if (info.family === 'build22621') {
    return `
public class NotificationListener : IVirtualDesktopNotification
{
    public void VirtualDesktopCreated(IVirtualDesktop pDesktop)
    {
        Runtime.EmitDesktopCreated(Runtime.GetDesktopId(pDesktop));
    }

    public void VirtualDesktopDestroyBegin(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback)
    {
    }

    public void VirtualDesktopDestroyFailed(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback)
    {
    }

    public void VirtualDesktopDestroyed(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback)
    {
        Runtime.EmitDesktopDestroyed(Runtime.GetDesktopId(pDesktopDestroyed), Runtime.GetDesktopId(pDesktopFallback));
    }

    public void VirtualDesktopMoved(IVirtualDesktop pDesktop, long nIndexFrom, long nIndexTo)
    {
    }

    public void VirtualDesktopNameChanged(IVirtualDesktop pDesktop, IntPtr chName)
    {
        Runtime.EmitDesktopRenamed(Runtime.GetDesktopId(pDesktop));
    }

    public void ViewVirtualDesktopChanged(IApplicationView pView)
    {
    }

    public void CurrentVirtualDesktopChanged(IVirtualDesktop pDesktopOld, IVirtualDesktop pDesktopNew)
    {
        Runtime.EmitCurrentDesktopChanged(Runtime.GetDesktopId(pDesktopOld), Runtime.GetDesktopId(pDesktopNew));
    }

    public void VirtualDesktopWallpaperChanged(IVirtualDesktop pDesktop, IntPtr chPath)
    {
    }

    public void VirtualDesktopSwitched(IVirtualDesktop pDesktop)
    {
    }

    public void RemoteVirtualDesktopConnected(IVirtualDesktop pDesktop)
    {
    }
}
`;
  }

  if (info.family === 'build22000') {
    return `
public class NotificationListener : IVirtualDesktopNotification
{
    public void VirtualDesktopCreated(IObjectArray p0, IVirtualDesktop pDesktop)
    {
        Runtime.EmitDesktopCreated(Runtime.GetDesktopId(pDesktop));
    }

    public void VirtualDesktopDestroyBegin(IObjectArray p0, IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback)
    {
    }

    public void VirtualDesktopDestroyFailed(IObjectArray p0, IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback)
    {
    }

    public void VirtualDesktopDestroyed(IObjectArray p0, IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback)
    {
        Runtime.EmitDesktopDestroyed(Runtime.GetDesktopId(pDesktopDestroyed), Runtime.GetDesktopId(pDesktopFallback));
    }

    public void Proc7(int p0)
    {
    }

    public void VirtualDesktopMoved(IObjectArray p0, IVirtualDesktop pDesktop, int nIndexFrom, int nIndexTo)
    {
    }

    public void VirtualDesktopRenamed(IVirtualDesktop pDesktop, IntPtr chName)
    {
        Runtime.EmitDesktopRenamed(Runtime.GetDesktopId(pDesktop));
    }

    public void ViewVirtualDesktopChanged(IApplicationView pView)
    {
    }

    public void CurrentVirtualDesktopChanged(IObjectArray p0, IVirtualDesktop pDesktopOld, IVirtualDesktop pDesktopNew)
    {
        Runtime.EmitCurrentDesktopChanged(Runtime.GetDesktopId(pDesktopOld), Runtime.GetDesktopId(pDesktopNew));
    }

    public void VirtualDesktopWallpaperChanged(IVirtualDesktop pDesktop, IntPtr chPath)
    {
    }
}
`;
  }

  return `
public class NotificationListener : IVirtualDesktopNotification
{
    public void VirtualDesktopCreated(IVirtualDesktop pDesktop)
    {
        Runtime.EmitDesktopCreated(Runtime.GetDesktopId(pDesktop));
    }

    public void VirtualDesktopDestroyBegin(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback)
    {
    }

    public void VirtualDesktopDestroyFailed(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback)
    {
    }

    public void VirtualDesktopDestroyed(IVirtualDesktop pDesktopDestroyed, IVirtualDesktop pDesktopFallback)
    {
        Runtime.EmitDesktopDestroyed(Runtime.GetDesktopId(pDesktopDestroyed), Runtime.GetDesktopId(pDesktopFallback));
    }

    public void ViewVirtualDesktopChanged(IApplicationView pView)
    {
    }

    public void CurrentVirtualDesktopChanged(IVirtualDesktop pDesktopOld, IVirtualDesktop pDesktopNew)
    {
        Runtime.EmitCurrentDesktopChanged(Runtime.GetDesktopId(pDesktopOld), Runtime.GetDesktopId(pDesktopNew));
    }
}
`;
}

function createDesktopBridgeScript(info: VirtualDesktopNotificationInteropInfo): string {
  const csharp = `
using System;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace AperantDesktopNotifications
{
    [ComImport]
    [Guid("6D5140C1-7436-11CE-8034-00AA006009FA")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IServiceProvider10
    {
        [return: MarshalAs(UnmanagedType.IUnknown)]
        object QueryService(ref Guid service, ref Guid riid);
    }

    [ComImport]
    [Guid("372E1D3B-38D3-42E4-A15B-8AB2B178F513")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IApplicationView
    {
    }

    [ComImport]
    [Guid("92CA9DCD-5622-4BBA-A805-5E9F541BD8C9")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IObjectArray
    {
    }

${getVirtualDesktopInterfaceDefinition(info)}

${getNotificationInterfaceDefinition(info)}

    [ComImport]
    [Guid("${info.notificationServiceGuid}")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IVirtualDesktopNotificationService
    {
        uint Register(IVirtualDesktopNotification notification);
        void Unregister(uint cookie);
    }

    public static class Runtime
    {
        private static readonly Guid CLSID_ImmersiveShell = new Guid("C2F03A33-21F5-47FA-B4BB-156362A2F239");
        private static readonly Guid CLSID_VirtualDesktopNotificationService = new Guid("A501FDEC-4A09-464C-AE4E-1B9C21B84918");

        private static IServiceProvider10 _shell;
        private static IVirtualDesktopNotificationService _notificationService;
        private static IVirtualDesktopNotification _listener;
        private static uint? _cookie;
        private static int _explorerPid;
        private static string _lastError = string.Empty;

        public static void Tick()
        {
            try
            {
                var explorerPid = GetExplorerPid();
                if (explorerPid == 0)
                {
                    if (_cookie.HasValue)
                    {
                        EmitDisconnected("explorer-unavailable");
                        CleanupRegistration();
                    }

                    return;
                }

                if (_cookie.HasValue && explorerPid != _explorerPid)
                {
                    EmitDisconnected("explorer-restarted");
                    CleanupRegistration();
                }

                if (_cookie.HasValue)
                {
                    return;
                }

                Register(explorerPid);
            }
            catch (Exception ex)
            {
                EmitError("tick-failed: " + ex.Message);
                CleanupRegistration();
            }
        }

        public static void Shutdown()
        {
            CleanupRegistration();
        }

        public static string GetDesktopId(IVirtualDesktop desktop)
        {
            if (desktop == null)
            {
                return null;
            }

            try
            {
                return desktop.GetID().ToString().ToLowerInvariant();
            }
            catch
            {
                return null;
            }
        }

        public static void EmitCurrentDesktopChanged(string oldDesktopId, string newDesktopId)
        {
            EmitLine("current-desktop-changed", oldDesktopId, newDesktopId);
        }

        public static void EmitDesktopCreated(string desktopId)
        {
            EmitLine("desktop-created", desktopId);
        }

        public static void EmitDesktopDestroyed(string desktopId, string fallbackDesktopId)
        {
            EmitLine("desktop-destroyed", desktopId, fallbackDesktopId);
        }

        public static void EmitDesktopRenamed(string desktopId)
        {
            EmitLine("desktop-renamed", desktopId);
        }

        private static void Register(int explorerPid)
        {
            CleanupRegistration();

            try
            {
                var shellType = Type.GetTypeFromCLSID(CLSID_ImmersiveShell, true);
                _shell = (IServiceProvider10)Activator.CreateInstance(shellType);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException("create-shell: " + ex.Message, ex);
            }

            try
            {
                var serviceGuid = CLSID_VirtualDesktopNotificationService;
                var serviceInterfaceGuid = typeof(IVirtualDesktopNotificationService).GUID;
                _notificationService = (IVirtualDesktopNotificationService)_shell.QueryService(ref serviceGuid, ref serviceInterfaceGuid);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException("query-service: " + ex.Message, ex);
            }

            if (_notificationService == null)
            {
                throw new InvalidOperationException("Virtual desktop notification service was unavailable.");
            }

            try
            {
                _listener = new NotificationListener();
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException("create-listener: " + ex.Message, ex);
            }

            try
            {
                _cookie = _notificationService.Register(_listener);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException("register-listener: " + ex.Message, ex);
            }

            _explorerPid = explorerPid;
            _lastError = string.Empty;
            EmitLine("ready", explorerPid.ToString());
        }

        private static void CleanupRegistration()
        {
            if (_notificationService != null && _cookie.HasValue)
            {
                try
                {
                    _notificationService.Unregister(_cookie.Value);
                }
                catch
                {
                }
            }

            _cookie = null;
            _listener = null;
            _notificationService = null;
            _shell = null;
            _explorerPid = 0;
        }

        private static void EmitDisconnected(string reason)
        {
            EmitLine("disconnected", reason);
        }

        private static void EmitError(string message)
        {
            if (String.Equals(_lastError, message, StringComparison.Ordinal))
            {
                return;
            }

            _lastError = message;
            EmitLine("error", message);
        }

        private static void EmitLine(string eventType, params string[] fields)
        {
            var encodedFields = fields
                .Select(field => Convert.ToBase64String(Encoding.UTF8.GetBytes(field ?? String.Empty)))
                .ToArray();
            Console.WriteLine(eventType + "|" + String.Join("|", encodedFields));
            Console.Out.Flush();
        }

        private static int GetExplorerPid()
        {
            try
            {
                return Process.GetProcessesByName("explorer")
                    .OrderBy(process => process.Id)
                    .Select(process => process.Id)
                    .FirstOrDefault();
            }
            catch
            {
                return 0;
            }
        }
    }

${getNotificationListenerImplementation(info)}
}
`;

  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -Language CSharp -TypeDefinition @"
${csharp}
"@

try {
  while ($true) {
    [AperantDesktopNotifications.Runtime]::Tick()
    Start-Sleep -Milliseconds 750
  }
}
finally {
  [AperantDesktopNotifications.Runtime]::Shutdown()
}
`;
}

export class DesktopNotificationBridge {
  private child: ChildProcess | null = null;
  private stdoutReader: ReadLineInterface | null = null;
  private scriptPath: string | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private shouldRun = false;
  private failureCount = 0;
  private state: DesktopNotificationBridgeState = {
    supported: isWindows(),
    running: false,
    healthy: false,
    family: null,
    buildNumber: null,
  };
  private readonly eventListeners = new Set<DesktopEventListener>();
  private readonly stateListeners = new Set<DesktopStateListener>();

  start(): DesktopNotificationBridgeState {
    this.shouldRun = true;

    if (!isWindows()) {
      this.updateState({
        supported: false,
        running: false,
        healthy: false,
        error: 'Desktop notifications are only supported on Windows.',
        family: null,
        buildNumber: null,
      });
      return this.getState();
    }

    if (this.child) {
      return this.getState();
    }

    this.spawnBridge();
    return this.getState();
  }

  stop(): void {
    this.shouldRun = false;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    this.disposeChild();
    this.failureCount = 0;
    this.updateState({
      running: false,
      healthy: false,
      error: undefined,
    });
  }

  getState(): DesktopNotificationBridgeState {
    return { ...this.state };
  }

  onEvent(listener: DesktopEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onStateChange(listener: DesktopStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private spawnBridge(): void {
    const interopInfo = resolveVirtualDesktopNotificationInteropInfo();
    if (!interopInfo) {
      this.updateState({
        supported: false,
        running: false,
        healthy: false,
        error: 'Virtual desktop notifications are unavailable on this Windows build.',
        family: null,
        buildNumber: null,
      });
      return;
    }

    const powerShellPath = findDesktopBridgePowerShellPath();
    if (!powerShellPath) {
      this.updateState({
        supported: false,
        running: false,
        healthy: false,
        error: 'PowerShell was not found for desktop notifications.',
        family: interopInfo.family,
        buildNumber: interopInfo.buildNumber,
      });
      return;
    }

    const scriptPath = createBridgeScriptPath();
    writeFileSync(scriptPath, `\uFEFF${createDesktopBridgeScript(interopInfo)}`, 'utf8');
    this.scriptPath = scriptPath;

    const launchEnv = createBridgeLaunchEnv();
    const powerShellArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
    if (basename(powerShellPath).toLowerCase() === 'powershell.exe') {
      powerShellArgs.push('-Sta');
    }
    powerShellArgs.push('-File', scriptPath);

    const child = spawn(
      powerShellPath,
      powerShellArgs,
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: launchEnv,
      }
    );

    this.child = child;
    this.stdoutReader = createInterface({ input: child.stdout });

    this.stdoutReader.on('line', (line) => {
      this.handleStdoutLine(line);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = sanitizePowerShellOutput(chunk.toString()) || chunk.toString().trim();
      if (!text) {
        return;
      }

      this.updateState({
        supported: true,
        running: Boolean(this.child),
        healthy: false,
        error: text,
        family: interopInfo.family,
        buildNumber: interopInfo.buildNumber,
      });
      this.emitEvent({ type: 'error', message: text });
    });

    child.on('exit', (code, signal) => {
      const restartMessage =
        code === 0 && !this.shouldRun
          ? undefined
          : `Desktop notification bridge exited (${code ?? 'null'}${signal ? `, ${signal}` : ''}).`;

      this.disposeChild();
      this.failureCount += 1;
      this.updateState({
        supported: true,
        running: false,
        healthy: false,
        error: restartMessage,
        family: interopInfo.family,
        buildNumber: interopInfo.buildNumber,
      });

      if (this.shouldRun) {
        this.scheduleRestart();
      }
    });

    child.on('error', (error) => {
      this.disposeChild();
      this.failureCount += 1;
      this.updateState({
        supported: true,
        running: false,
        healthy: false,
        error: error.message,
        family: interopInfo.family,
        buildNumber: interopInfo.buildNumber,
      });

      if (this.shouldRun) {
        this.scheduleRestart();
      }
    });

    this.updateState({
      supported: true,
      running: true,
      healthy: false,
      error: undefined,
      family: interopInfo.family,
      buildNumber: interopInfo.buildNumber,
    });
  }

  private scheduleRestart(): void {
    if (!this.shouldRun || this.restartTimer) {
      return;
    }

    const delayMs = Math.min(5000, Math.max(500, this.failureCount * 500));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.shouldRun && !this.child) {
        this.spawnBridge();
      }
    }, delayMs);
    this.restartTimer.unref?.();
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const [eventType, ...encodedFields] = trimmed.split('|');
    if (!eventType) {
      return;
    }

    let parsed: DesktopNotificationEvent;
    switch (eventType) {
      case 'ready': {
        const currentDesktop = getCurrentVirtualDesktop();
        parsed = {
          type: 'ready',
          explorerPid: Number(decodeBridgeField(encodedFields[0])) || null,
          buildNumber: this.state.buildNumber ?? null,
          family: this.state.family ?? undefined,
          currentDesktop: currentDesktop ?? null,
          currentDesktopId: currentDesktop?.id ?? null,
        };
        break;
      }
      case 'current-desktop-changed': {
        const newDesktopId = decodeBridgeField(encodedFields[1]) || null;
        parsed = {
          type: 'current-desktop-changed',
          oldDesktopId: decodeBridgeField(encodedFields[0]) || null,
          newDesktopId,
          currentDesktopId: newDesktopId,
          currentDesktop: newDesktopId
            ? {
              id: newDesktopId,
              number: null,
              name: null,
              visible: true,
            }
            : null,
        };
        break;
      }
      case 'desktop-created': {
        parsed = {
          type: 'desktop-created',
          desktopId: decodeBridgeField(encodedFields[0]) || null,
        };
        break;
      }
      case 'desktop-destroyed': {
        parsed = {
          type: 'desktop-destroyed',
          desktopId: decodeBridgeField(encodedFields[0]) || null,
          fallbackDesktopId: decodeBridgeField(encodedFields[1]) || null,
        };
        break;
      }
      case 'desktop-renamed': {
        parsed = {
          type: 'desktop-renamed',
          desktopId: decodeBridgeField(encodedFields[0]) || null,
        };
        break;
      }
      case 'disconnected': {
        parsed = {
          type: 'disconnected',
          reason: decodeBridgeField(encodedFields[0]) || undefined,
        };
        break;
      }
      case 'error': {
        parsed = {
          type: 'error',
          message: decodeBridgeField(encodedFields[0]) || undefined,
        };
        break;
      }
      default: {
        this.emitEvent({
          type: 'error',
          message: `Failed to parse desktop bridge output: unknown event "${eventType}"`,
        });
        return;
      }
    }

    if (parsed.type === 'ready') {
      this.failureCount = 0;
      this.updateState({
        supported: true,
        running: true,
        healthy: true,
        error: undefined,
        family: parsed.family ?? this.state.family ?? null,
        buildNumber: parsed.buildNumber ?? this.state.buildNumber ?? null,
      });
    } else if (parsed.type === 'error') {
      this.updateState({
        supported: true,
        running: Boolean(this.child),
        healthy: false,
        error: parsed.message,
      });
    } else if (parsed.type === 'disconnected') {
      this.updateState({
        supported: true,
        running: Boolean(this.child),
        healthy: false,
        error: parsed.reason ? `Desktop bridge disconnected: ${parsed.reason}` : 'Desktop bridge disconnected.',
      });
    } else {
      this.updateState({
        supported: true,
        running: Boolean(this.child),
        healthy: true,
        error: undefined,
      });
    }

    if (parsed.type === 'ready') {
      console.log(
        '[DesktopBridge] Ready',
        parsed.family ?? this.state.family ?? 'unknown',
        parsed.currentDesktopId ?? 'no-current-desktop'
      );
    } else if (parsed.type === 'current-desktop-changed') {
      console.log(
        '[DesktopBridge] Desktop changed',
        parsed.oldDesktopId ?? 'unknown',
        '->',
        parsed.newDesktopId ?? 'unknown'
      );
    } else if (parsed.type === 'disconnected') {
      console.warn('[DesktopBridge] Disconnected:', parsed.reason ?? 'unknown');
    } else if (parsed.type === 'error') {
      console.warn('[DesktopBridge] Error:', parsed.message ?? 'unknown');
    }

    this.emitEvent(parsed);
  }

  private emitEvent(event: DesktopNotificationEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private updateState(nextState: Partial<DesktopNotificationBridgeState>): void {
    this.state = {
      ...this.state,
      ...nextState,
    };
    for (const listener of this.stateListeners) {
      listener(this.getState());
    }
  }

  private disposeChild(): void {
    if (this.stdoutReader) {
      this.stdoutReader.close();
      this.stdoutReader = null;
    }

    if (this.child) {
      this.child.removeAllListeners();
      if (!this.child.killed) {
        this.child.kill();
      }
      this.child = null;
    }

    if (this.scriptPath && existsSync(this.scriptPath)) {
      try {
        unlinkSync(this.scriptPath);
      } catch {
        // Best effort cleanup only.
      }
    }

    this.scriptPath = null;
  }
}

export const desktopNotificationBridge = new DesktopNotificationBridge();
