/**
 * PTY Daemon Client
 *
 * Communicates with the PTY daemon process via Unix socket/named pipe.
 * Handles connection management, automatic reconnection, and message routing.
 */

import * as net from 'net';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';
import { isWindows, GRACEFUL_KILL_TIMEOUT_MS } from '../platform';
import { getIsShuttingDown } from './pty-manager';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOCKET_PATH = isWindows()
  ? `\\\\.\\pipe\\auto-claude-pty-${process.getuid?.() || 'default'}`
  : `/tmp/auto-claude-pty-${process.getuid?.() || 'default'}.sock`;

interface DaemonResponseData {
  exitCode?: number;
  signal?: number;
}

interface DaemonResponse {
  requestId?: string;
  type: string;
  id?: string;
  data?: string | DaemonResponseData;
  error?: string;
}

type ResponseHandler = (response: DaemonResponse) => void;

interface PtyConfig {
  shell: string;
  shellArgs: string[];
  cwd: string;
  env: Record<string, string>;
  rows: number;
  cols: number;
}

interface PtyInfo {
  id: string;
  config: PtyConfig;
  createdAt: number;
  lastDataAt: number;
  isDead: boolean;
  bufferSize: number;
}

class PtyDaemonClient {
  private socket: net.Socket | null = null;
  private daemonProcess: ChildProcess | null = null;
  private pendingRequests = new Map<string, ResponseHandler>();
  private dataHandlers = new Map<string, (data: string) => void>();
  private exitHandlers = new Map<string, (exitCode: number, signal?: number) => void>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isConnecting = false;
  private buffer = '';
  private isShuttingDown = false;

  /**
   * Connect to daemon, spawning if necessary
   */
  async connect(): Promise<void> {
    if (this.shuttingDown) {
      throw new Error('Client is shutting down');
    }

    if (this.socket || this.isConnecting) return;

    this.isConnecting = true;

    try {
      // Try to connect to existing daemon
      await this.tryConnect();
      console.warn('[PtyDaemonClient] Connected to existing daemon');
    } catch {
      // Spawn daemon and connect
      console.warn('[PtyDaemonClient] Spawning new daemon...');
      await this.spawnDaemon();
      await this.tryConnect();
      console.warn('[PtyDaemonClient] Connected to new daemon');
    } finally {
      this.isConnecting = false;
      this.reconnectAttempts = 0;
    }
  }

  /**
   * Try to connect to existing daemon
   */
  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(SOCKET_PATH);

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      }, 3000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        this.socket = socket;
        this.setupSocketHandlers();
        resolve();
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Spawn a new daemon process
   */
  private async spawnDaemon(): Promise<void> {
    // In production, the daemon file is in the same directory
    const daemonPath = path.join(__dirname, 'pty-daemon.js');

    try {
      // Spawn detached process that survives parent
      this.daemonProcess = spawn(process.execPath, [daemonPath], {
        detached: true,
        stdio: 'ignore', // Don't pipe stdout/stderr
        env: { ...process.env },
      });

      // Unref so parent can exit independently
      this.daemonProcess.unref();

      console.warn(`[PtyDaemonClient] Spawned daemon process (PID: ${this.daemonProcess.pid})`);

      // Wait for daemon to start listening
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('[PtyDaemonClient] Failed to spawn daemon:', error);
      throw error;
    }
  }

  /**
   * Setup socket event handlers
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf-8');

      // Handle newline-delimited JSON
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          this.handleResponse(response);
        } catch (e) {
          console.error('[PtyDaemonClient] Invalid response:', e);
        }
      }
    });

    this.socket.on('close', () => {
      console.warn('[PtyDaemonClient] Disconnected from daemon');
      this.socket = null;
      if (!this.shuttingDown) {
        this.attemptReconnect();
      }
    });

    this.socket.on('error', (err) => {
      console.error('[PtyDaemonClient] Socket error:', err);
    });
  }

  /**
   * Handle response from daemon
   */
  private handleResponse(response: DaemonResponse): void {
    // Handle request-response pattern
    if (response.requestId) {
      const handler = this.pendingRequests.get(response.requestId);
      if (handler) {
        this.pendingRequests.delete(response.requestId);
        handler(response);
      }
      return;
    }

    // Handle streaming data
    if (response.type === 'data' && response.id) {
      const handler = this.dataHandlers.get(response.id);
      if (handler && typeof response.data === 'string') {
        handler(response.data);
      }
      return;
    }

    // Handle exit events
    if (response.type === 'exit' && response.id) {
      const handler = this.exitHandlers.get(response.id);
      if (handler && typeof response.data === 'object' && response.data !== null) {
        const exitData = response.data as DaemonResponseData;
        handler(exitData.exitCode ?? 0, exitData.signal);
      }
      return;
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.shuttingDown) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[PtyDaemonClient] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);

    console.warn(
      `[PtyDaemonClient] Reconnect attempt ${this.reconnectAttempts} in ${delay}ms...`
    );

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[PtyDaemonClient] Reconnect failed:', error);
      });
    }, delay);
  }

  /**
   * Send a request and wait for response
   */
  private async request<T>(msg: Record<string, unknown>): Promise<T> {
    await this.connect();

    if (!this.socket) {
      throw new Error('Not connected to daemon');
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 10000);

      this.pendingRequests.set(requestId, (response) => {
        clearTimeout(timeout);
        if (response.type === 'error') {
          reject(new Error(response.error || 'Unknown error'));
        } else {
          resolve(response as T);
        }
      });

      this.socket?.write(JSON.stringify({ ...msg, requestId }) + '\n');
    });
  }

  /**
   * Send a message without expecting a response
   */
  private send(msg: Record<string, unknown>): void {
    if (!this.socket) {
      console.warn('[PtyDaemonClient] Cannot send - not connected');
      return;
    }
    this.socket.write(JSON.stringify(msg) + '\n');
  }

  // ===== Public API =====

  /**
   * Check if shutdown is in progress (either locally or globally via pty-manager)
   */
  private get shuttingDown(): boolean {
    return this.isShuttingDown || getIsShuttingDown();
  }

  /**
   * Create a new PTY in the daemon
   */
  async createPty(config: PtyConfig): Promise<string> {
    // Guard against spawning new PTY processes after shutdown
    if (this.shuttingDown) {
      throw new Error('Cannot create PTY: client is shutting down');
    }

    const response = await this.request<{ type: 'created'; id: string }>({
      type: 'create',
      data: config,
    });
    return response.id;
  }

  /**
   * Write data to a PTY
   */
  write(id: string, data: string): void {
    if (this.shuttingDown) return;
    try {
      this.send({ type: 'write', id, data });
    } catch {
      // Socket may be closed during teardown
    }
  }

  /**
   * Resize a PTY
   */
  resize(id: string, cols: number, rows: number): void {
    if (this.shuttingDown) return;
    try {
      this.send({ type: 'resize', id, data: { cols, rows } });
    } catch {
      // Socket may be closed during teardown
    }
  }

  /**
   * Kill a PTY
   */
  kill(id: string): void {
    this.send({ type: 'kill', id });
    this.dataHandlers.delete(id);
    this.exitHandlers.delete(id);
  }

  /**
   * List all PTYs in the daemon
   */
  async list(): Promise<PtyInfo[]> {
    const response = await this.request<{ type: 'list'; data: PtyInfo[] }>({
      type: 'list',
    });
    return response.data;
  }

  /**
   * Subscribe to PTY output and exit events
   */
  subscribe(
    id: string,
    onData: (data: string) => void,
    onExit: (code: number, signal?: number) => void
  ): void {
    this.dataHandlers.set(id, onData);
    this.exitHandlers.set(id, onExit);
    this.send({ type: 'subscribe', id });
  }

  /**
   * Unsubscribe from PTY events
   */
  unsubscribe(id: string): void {
    this.dataHandlers.delete(id);
    this.exitHandlers.delete(id);
    this.send({ type: 'unsubscribe', id });
  }

  /**
   * Get buffered output from a PTY
   */
  async getBuffer(id: string): Promise<{ buffer: string; isDead: boolean }> {
    const response = await this.request<{
      type: 'buffer';
      data: { buffer: string; isDead: boolean };
    }>({
      type: 'get-buffer',
      id,
    });
    return response.data;
  }

  /**
   * Check if daemon is alive
   */
  async ping(): Promise<boolean> {
    try {
      await this.request<{ type: 'pong' }>({ type: 'ping' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket !== null;
  }

  /**
   * Disconnect from daemon (does not kill daemon)
   */
  disconnect(): void {
    if (this.socket) {
      this.isShuttingDown = true;
      this.socket.end();
      this.socket = null;
    }
  }

  /**
   * Cleanup on app shutdown
   */
  shutdown(): void {
    this.isShuttingDown = true;

    // Kill the daemon process if we spawned it
    if (this.daemonProcess?.pid) {
      try {
        if (isWindows()) {
          // Windows: use taskkill to force kill process tree
          spawn('taskkill', ['/pid', this.daemonProcess.pid.toString(), '/f', '/t'], {
            stdio: 'ignore',
            detached: true
          }).unref();
        } else {
          // Unix: SIGTERM then SIGKILL
          this.daemonProcess.kill('SIGTERM');
          const daemonProc = this.daemonProcess;
          setTimeout(() => {
            try {
              if (daemonProc) {
                daemonProc.kill('SIGKILL');
              }
            } catch {
              // Process may already be dead
            }
          }, GRACEFUL_KILL_TIMEOUT_MS);
        }
      } catch {
        // Process may already be dead
      }
      this.daemonProcess = null;
    }

    this.disconnect();
    this.pendingRequests.clear();
    this.dataHandlers.clear();
    this.exitHandlers.clear();
  }
}

// Singleton instance
export const ptyDaemonClient = new PtyDaemonClient();
