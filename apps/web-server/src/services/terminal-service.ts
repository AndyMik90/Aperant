/**
 * Terminal Service
 *
 * Manages PTY (pseudo-terminal) sessions for web-based terminals.
 * Uses node-pty for terminal emulation and Socket.IO for real-time communication.
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import { spawn as ptySpawn, type IPty } from '@lydell/node-pty';
import { platform } from 'node:os';
import { v4 as uuidv4 } from 'uuid';

export interface TerminalSession {
  id: string;
  pty: IPty;
  cwd: string;
  projectPath?: string;
  cols: number;
  rows: number;
  createdAt: Date;
}

export class TerminalService {
  private io: SocketIOServer;
  private sessions: Map<string, TerminalSession> = new Map();
  private socketToTerminal: Map<string, Set<string>> = new Map();

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  /**
   * Create a new terminal session
   */
  createTerminal(
    cwd: string,
    projectPath?: string,
    cols: number = 80,
    rows: number = 24
  ): string {
    const id = uuidv4();
    const shell = platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');

    try {
      const pty = ptySpawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      });

      const session: TerminalSession = {
        id,
        pty,
        cwd,
        projectPath,
        cols,
        rows,
        createdAt: new Date()
      };

      this.sessions.set(id, session);

      // Forward PTY output to Socket.IO
      pty.onData((data: string) => {
        this.io.to(`terminal:${id}`).emit('terminal:output', { id, data });
      });

      pty.onExit(({ exitCode, signal }) => {
        console.log(`[TerminalService] Terminal ${id} exited with code ${exitCode}, signal ${signal}`);
        this.io.to(`terminal:${id}`).emit('terminal:exit', { id, exitCode, signal });
        this.sessions.delete(id);
      });

      console.log(`[TerminalService] Created terminal ${id} at ${cwd}`);
      return id;
    } catch (error) {
      console.error(`[TerminalService] Failed to create terminal:`, error);
      throw error;
    }
  }

  /**
   * Write input to a terminal
   */
  write(terminalId: string, data: string): boolean {
    const session = this.sessions.get(terminalId);
    if (!session) {
      console.warn(`[TerminalService] Terminal not found: ${terminalId}`);
      return false;
    }

    try {
      session.pty.write(data);
      return true;
    } catch (error) {
      console.error(`[TerminalService] Failed to write to terminal ${terminalId}:`, error);
      return false;
    }
  }

  /**
   * Resize a terminal
   */
  resize(terminalId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(terminalId);
    if (!session) {
      console.warn(`[TerminalService] Terminal not found: ${terminalId}`);
      return false;
    }

    try {
      session.pty.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
      return true;
    } catch (error) {
      console.error(`[TerminalService] Failed to resize terminal ${terminalId}:`, error);
      return false;
    }
  }

  /**
   * Close a terminal
   */
  close(terminalId: string): boolean {
    const session = this.sessions.get(terminalId);
    if (!session) {
      console.warn(`[TerminalService] Terminal not found: ${terminalId}`);
      return false;
    }

    try {
      session.pty.kill();
      this.sessions.delete(terminalId);
      console.log(`[TerminalService] Closed terminal ${terminalId}`);
      return true;
    } catch (error) {
      console.error(`[TerminalService] Failed to close terminal ${terminalId}:`, error);
      return false;
    }
  }

  /**
   * Get terminal info
   */
  getTerminal(terminalId: string): Omit<TerminalSession, 'pty'> | null {
    const session = this.sessions.get(terminalId);
    if (!session) {
      return null;
    }

    // Return session info without the PTY object
    return {
      id: session.id,
      cwd: session.cwd,
      projectPath: session.projectPath,
      cols: session.cols,
      rows: session.rows,
      createdAt: session.createdAt
    };
  }

  /**
   * List all terminals for a project
   */
  listTerminals(projectPath?: string): Array<Omit<TerminalSession, 'pty'>> {
    const terminals = Array.from(this.sessions.values())
      .filter(session => !projectPath || session.projectPath === projectPath)
      .map(({ pty: _pty, ...rest }) => rest);

    return terminals;
  }

  /**
   * Subscribe a socket to terminal output
   */
  subscribeToTerminal(socket: Socket, terminalId: string): void {
    socket.join(`terminal:${terminalId}`);

    // Track socket subscriptions
    if (!this.socketToTerminal.has(socket.id)) {
      this.socketToTerminal.set(socket.id, new Set());
    }
    this.socketToTerminal.get(socket.id)!.add(terminalId);
  }

  /**
   * Unsubscribe a socket from terminal output
   */
  unsubscribeFromTerminal(socket: Socket, terminalId: string): void {
    socket.leave(`terminal:${terminalId}`);

    const subscriptions = this.socketToTerminal.get(socket.id);
    if (subscriptions) {
      subscriptions.delete(terminalId);
    }
  }

  /**
   * Clean up all subscriptions for a socket
   */
  cleanupSocket(socket: Socket): void {
    const subscriptions = this.socketToTerminal.get(socket.id);
    if (subscriptions) {
      for (const terminalId of subscriptions) {
        socket.leave(`terminal:${terminalId}`);
      }
      this.socketToTerminal.delete(socket.id);
    }
  }

  /**
   * Clean up all terminals
   */
  cleanup(): void {
    console.log(`[TerminalService] Cleaning up ${this.sessions.size} terminals...`);
    for (const [id, session] of this.sessions) {
      try {
        session.pty.kill();
        console.log(`[TerminalService] Killed terminal ${id}`);
      } catch (error) {
        console.error(`[TerminalService] Failed to kill terminal ${id}:`, error);
      }
    }
    this.sessions.clear();
    this.socketToTerminal.clear();
  }
}
