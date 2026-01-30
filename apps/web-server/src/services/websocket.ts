/**
 * WebSocket Handlers
 *
 * Sets up Socket.IO event handlers for real-time communication.
 */

import type { Server as SocketIOServer } from 'socket.io';
import type { TerminalService } from './terminal-service.js';
import type { AgentService } from './agent-service.js';

export function setupWebSocketHandlers(
  io: SocketIOServer,
  terminalService: TerminalService,
  agentService: AgentService
): void {
  io.on('connection', (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    // Terminal events
    socket.on('terminal:subscribe', (terminalId: string) => {
      console.log(`[WebSocket] ${socket.id} subscribing to terminal ${terminalId}`);
      terminalService.subscribeToTerminal(socket, terminalId);
    });

    socket.on('terminal:unsubscribe', (terminalId: string) => {
      console.log(`[WebSocket] ${socket.id} unsubscribing from terminal ${terminalId}`);
      terminalService.unsubscribeFromTerminal(socket, terminalId);
    });

    socket.on('terminal:input', ({ id, data }: { id: string; data: string }) => {
      terminalService.write(id, data);
    });

    socket.on('terminal:resize', ({ id, cols, rows }: { id: string; cols: number; rows: number }) => {
      terminalService.resize(id, cols, rows);
    });

    // Agent subscription events
    socket.on('agent:subscribe', (projectId: string) => {
      socket.join(`project:${projectId}`);
      console.log(`[WebSocket] ${socket.id} subscribed to project ${projectId}`);
    });

    socket.on('agent:unsubscribe', (projectId: string) => {
      socket.leave(`project:${projectId}`);
      console.log(`[WebSocket] ${socket.id} unsubscribed from project ${projectId}`);
    });

    // Task-specific subscription
    socket.on('task:subscribe', (taskId: string) => {
      socket.join(`task:${taskId}`);
      console.log(`[WebSocket] ${socket.id} subscribed to task ${taskId}`);
    });

    socket.on('task:unsubscribe', (taskId: string) => {
      socket.leave(`task:${taskId}`);
      console.log(`[WebSocket] ${socket.id} unsubscribed from task ${taskId}`);
    });

    // Ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Clean up on disconnect
    socket.on('disconnect', (reason) => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}, reason: ${reason}`);
      terminalService.cleanupSocket(socket);
    });
  });

  console.log('[WebSocket] Handlers initialized');
}
