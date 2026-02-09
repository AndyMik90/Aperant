#!/usr/bin/env node
/**
 * PTY Daemon Process
 *
 * Runs as a separate detached process that owns all PTY instances.
 * Survives main Electron process restarts, providing session continuity.
 *
 * Communication: Unix socket (Linux/macOS) or Named Pipe (Windows)
 */

import * as net from 'net';
import * as fs from 'fs';
import * as pty from '@lydell/node-pty';
import { isWindows, isUnix } from '../platform';

const SOCKET_PATH = isWindows()
  ? `\\\\.\\pipe\\auto-claude-pty-${process.getuid?.() || 'default'}`
  : `/tmp/auto-claude-pty-${process.getuid?.() || 'default'}.sock`;

// Maximum buffer size per PTY (100KB)
const MAX_BUFFER_SIZE = 100_000;

// Ring buffer to prevent memory growth
const RING_BUFFER_MAX_CHUNKS = 1000;

/**
 * Sanitize an ID for safe logging to prevent log injection attacks.
 * Uses JSON.stringify which CodeQL recognizes as a sanitizer, then
 * removes the surrounding quotes for cleaner log output.
 */
function sanitizeIdForLog(id: string): string {
  // JSON.stringify escapes control characters and is recognized by CodeQL
  // as a sanitizer for log injection. We slice off the quotes for cleaner output.
  const escaped = JSON.stringify(String(id).slice(0, 100));
  return escaped.slice(1, -1);
}

interface ManagedPty {
  id: string;
  process: pty.IPty;
  config: PtyConfig;
  buffer: string[];
  bufferSize: number;
  clients: Set<net.Socket>;
  createdAt: number;
  lastDataAt: number;
  isDead: boolean;
}

interface PtyConfig {
  shell: string;
  shellArgs: string[];
  cwd: string;
  env: Record<string, string>;
  rows: number;
  cols: number;
}

interface DaemonMessage {
  type:
    | 'create'
    | 'write'
    | 'resize'
    | 'kill'
    | 'list'
    | 'subscribe'
    | 'unsubscribe'
    | 'get-buffer'
    | 'ping';
  id?: string;
  data?: unknown;
  requestId?: string;
}

interface DaemonResponse {
  type: 'created' | 'list' | 'buffer' | 'data' | 'exit' | 'error' | 'pong';
  id?: string;
  data?: unknown;
  requestId?: string;
  error?: string;
}

class PtyDaemon {
  private ptys = new Map<string, ManagedPty>();
  private server: net.Server | null = null;
  private isShuttingDown = false;

  constructor() {
    console.error('[PTY Daemon] Starting...');
    this.cleanup();
    this.startServer();
    this.setupSignalHandlers();
  }

  /**
   * Remove stale socket/pipe
   */
  private cleanup(): void {
    if (isUnix() && fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH);
        console.error('[PTY Daemon] Cleaned up stale socket');
      } catch (error) {
        console.error('[PTY Daemon] Failed to clean up socket:', error);
      }
    }
  }

  /**
   * Start the IPC server
   */
  private startServer(): void {
    this.server = net.createServer((socket) => {
      console.error('[PTY Daemon] Client connected');
      this.handleConnection(socket);
    });

    this.server.on('error', (err: NodeJS.ErrnoException) => {
      console.error('[PTY Daemon] Server error:', err);
      if (err.code === 'EADDRINUSE') {
        console.error('[PTY Daemon] Address in use - another daemon may be running');
        process.exit(1);
      }
    });

    this.server.listen(SOCKET_PATH, () => {
      console.error(`[PTY Daemon] Listening on ${SOCKET_PATH}`);
      // Set permissions on Unix
      if (isUnix()) {
        try {
          fs.chmodSync(SOCKET_PATH, 0o600);
        } catch (error) {
          console.error('[PTY Daemon] Failed to set socket permissions:', error);
        }
      }
    });
  }

  /**
   * Handle a client connection
   */
  private handleConnection(socket: net.Socket): void {
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');

      // Handle newline-delimited JSON messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg: DaemonMessage = JSON.parse(line);
          this.handleMessage(socket, msg);
        } catch (e) {
          console.error('[PTY Daemon] Invalid message:', e);
          this.sendError(socket, 'Invalid JSON message');
        }
      }
    });

    socket.on('close', () => {
      console.error('[PTY Daemon] Client disconnected');
      // Unsubscribe from all PTYs
      this.ptys.forEach((pty) => {
        pty.clients.delete(socket);
      });
    });

    socket.on('error', (err) => {
      console.error('[PTY Daemon] Socket error:', err);
    });
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(socket: net.Socket, msg: DaemonMessage): void {
    try {
      switch (msg.type) {
        case 'ping':
          this.send(socket, { type: 'pong', requestId: msg.requestId });
          break;

        case 'create': {
          const id = this.createPty(msg.data as PtyConfig);
          this.send(socket, { type: 'created', id, requestId: msg.requestId });
          break;
        }

        case 'write':
          if (!msg.id) throw new Error('Missing PTY id');
          this.writeToPty(msg.id, msg.data as string);
          break;

        case 'resize': {
          if (!msg.id) throw new Error('Missing PTY id');
          const resizeData = msg.data as { cols: number; rows: number };
          this.resizePty(msg.id, resizeData.cols, resizeData.rows);
          break;
        }

        case 'kill':
          if (!msg.id) throw new Error('Missing PTY id');
          this.killPty(msg.id);
          break;

        case 'list': {
          const list = this.listPtys();
          this.send(socket, { type: 'list', data: list, requestId: msg.requestId });
          break;
        }

        case 'subscribe':
          if (!msg.id) throw new Error('Missing PTY id');
          this.subscribeToPty(socket, msg.id);
          break;

        case 'unsubscribe':
          if (!msg.id) throw new Error('Missing PTY id');
          this.unsubscribeFromPty(socket, msg.id);
          break;

        case 'get-buffer': {
          if (!msg.id) throw new Error('Missing PTY id');
          const bufferData = this.getBuffer(msg.id);
          this.send(socket, {
            type: 'buffer',
            id: msg.id,
            data: bufferData,
            requestId: msg.requestId,
          });
          break;
        }

        default:
          throw new Error(`Unknown message type: ${(msg as DaemonMessage).type}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[PTY Daemon] Error handling message:', errorMsg);
      this.sendError(socket, errorMsg, msg.requestId);
    }
  }

  /**
   * Create a new PTY
   */
  private createPty(config: PtyConfig): string {
    // Guard against spawning new PTY processes after shutdown has begun
    if (this.isShuttingDown) {
      throw new Error('Cannot create PTY: daemon is shutting down');
    }

    const id = `pty-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      const ptyProcess = pty.spawn(config.shell, config.shellArgs, {
        name: 'xterm-256color',
        cols: config.cols,
        rows: config.rows,
        cwd: config.cwd,
        env: config.env,
      });

      const managed: ManagedPty = {
        id,
        process: ptyProcess,
        config,
        buffer: [],
        bufferSize: 0,
        clients: new Set(),
        createdAt: Date.now(),
        lastDataAt: Date.now(),
        isDead: false,
      };

      // Capture all output
      ptyProcess.onData((data) => {
        managed.lastDataAt = Date.now();

        // Add to ring buffer
        managed.buffer.push(data);
        managed.bufferSize += data.length;

        // Enforce buffer size limit
        while (managed.bufferSize > MAX_BUFFER_SIZE && managed.buffer.length > 1) {
          const removed = managed.buffer.shift();
          if (removed) {
            managed.bufferSize -= removed.length;
          }
        }

        // Also enforce chunk count limit (ring buffer behavior)
        while (managed.buffer.length > RING_BUFFER_MAX_CHUNKS) {
          const removed = managed.buffer.shift();
          if (removed) {
            managed.bufferSize -= removed.length;
          }
        }

        // Broadcast to all subscribers
        managed.clients.forEach((client) => {
          this.send(client, { type: 'data', id, data });
        });
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        console.error('[PTY Daemon] PTY exited:', { id: sanitizeIdForLog(id), exitCode, signal });
        managed.isDead = true;

        // Notify all subscribers
        managed.clients.forEach((client) => {
          this.send(client, { type: 'exit', id, data: { exitCode, signal } });
        });

        // Keep in map for buffer retrieval, will be cleaned up on explicit kill
      });

      this.ptys.set(id, managed);
      console.error('[PTY Daemon] Created PTY:', { id: sanitizeIdForLog(id), shell: config.shell });

      return id;
    } catch (error) {
      console.error('[PTY Daemon] Failed to create PTY:', error);
      throw error;
    }
  }

  /**
   * Write data to a PTY
   */
  private writeToPty(id: string, data: string): void {
    const managed = this.ptys.get(id);
    if (!managed) {
      throw new Error(`PTY ${id} not found`);
    }
    if (managed.isDead) {
      throw new Error(`PTY ${id} is dead`);
    }
    try {
      managed.process.write(data);
    } catch (error) {
      // PTY process may have been destroyed during teardown
      console.error('[PTY Daemon] Error writing to PTY:', sanitizeIdForLog(id), error);
      managed.isDead = true;
    }
  }

  /**
   * Resize a PTY
   */
  private resizePty(id: string, cols: number, rows: number): void {
    const managed = this.ptys.get(id);
    if (!managed) {
      throw new Error(`PTY ${id} not found`);
    }
    if (managed.isDead) {
      console.warn('[PTY Daemon] Cannot resize dead PTY:', sanitizeIdForLog(id));
      return;
    }
    try {
      managed.process.resize(cols, rows);
      managed.config.cols = cols;
      managed.config.rows = rows;
    } catch (error) {
      // PTY process may have been destroyed during teardown
      console.error('[PTY Daemon] Error resizing PTY:', sanitizeIdForLog(id), error);
      managed.isDead = true;
    }
  }

  /**
   * Kill a PTY and remove it
   */
  private killPty(id: string): void {
    const managed = this.ptys.get(id);
    if (!managed) {
      console.warn('[PTY Daemon] PTY not found for kill:', sanitizeIdForLog(id));
      return;
    }

    if (!managed.isDead) {
      try {
        managed.process.kill();
      } catch (error) {
        console.error('[PTY Daemon] Error killing PTY:', sanitizeIdForLog(id), error);
      }
    }

    this.ptys.delete(id);
    console.error('[PTY Daemon] Removed PTY:', sanitizeIdForLog(id));
  }

  /**
   * List all PTYs
   */
  private listPtys(): Array<{
    id: string;
    config: PtyConfig;
    createdAt: number;
    lastDataAt: number;
    isDead: boolean;
    bufferSize: number;
  }> {
    return Array.from(this.ptys.values()).map((m) => ({
      id: m.id,
      config: m.config,
      createdAt: m.createdAt,
      lastDataAt: m.lastDataAt,
      isDead: m.isDead,
      bufferSize: m.bufferSize,
    }));
  }

  /**
   * Subscribe a client to PTY output
   */
  private subscribeToPty(socket: net.Socket, id: string): void {
    const managed = this.ptys.get(id);
    if (!managed) {
      throw new Error(`PTY ${id} not found`);
    }
    managed.clients.add(socket);
    console.error('[PTY Daemon] Client subscribed to PTY:', sanitizeIdForLog(id));
  }

  /**
   * Unsubscribe a client from PTY output
   */
  private unsubscribeFromPty(socket: net.Socket, id: string): void {
    const managed = this.ptys.get(id);
    if (managed) {
      managed.clients.delete(socket);
      console.error('[PTY Daemon] Client unsubscribed from PTY:', sanitizeIdForLog(id));
    }
  }

  /**
   * Get the buffered output for a PTY
   */
  private getBuffer(id: string): { buffer: string; isDead: boolean } {
    const managed = this.ptys.get(id);
    if (!managed) {
      throw new Error(`PTY ${id} not found`);
    }
    return {
      buffer: managed.buffer.join(''),
      isDead: managed.isDead,
    };
  }

  /**
   * Send a response to a client
   */
  private send(socket: net.Socket, response: DaemonResponse): void {
    try {
      socket.write(JSON.stringify(response) + '\n');
    } catch {
      // Socket may be closed, ignore
      console.warn('[PTY Daemon] Failed to send response (socket closed?)');
    }
  }

  /**
   * Send an error response
   */
  private sendError(socket: net.Socket, error: string, requestId?: string): void {
    this.send(socket, { type: 'error', error, requestId });
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const shutdown = (signal: string) => {
      console.error(`[PTY Daemon] Received ${signal}, shutting down...`);

      // Set shutdown flag to prevent new PTY creation and guard operations
      this.isShuttingDown = true;

      // Kill all PTYs
      this.ptys.forEach((managed) => {
        if (!managed.isDead) {
          try {
            managed.process.kill();
          } catch (error) {
            console.error('[PTY Daemon] Error killing PTY:', sanitizeIdForLog(managed.id), error);
          }
        }
      });

      // Close server
      this.server?.close();

      // Remove socket
      this.cleanup();

      console.error('[PTY Daemon] Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('[PTY Daemon] Uncaught exception:', error);
      // Don't exit - daemon should be resilient
    });

    process.on('unhandledRejection', (reason) => {
      console.error('[PTY Daemon] Unhandled rejection:', reason);
      // Don't exit - daemon should be resilient
    });
  }
}

// Start daemon if this file is run directly
if (require.main === module) {
  try {
    new PtyDaemon();
    console.error('[PTY Daemon] Running - PID:', process.pid);
  } catch (error) {
    console.error('[PTY Daemon] Fatal error:', error);
    process.exit(1);
  }
}

export { PtyDaemon };
