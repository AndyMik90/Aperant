/**
 * Auto Claude Web Server
 *
 * This server replaces the Electron main process for web deployment.
 * It provides:
 * - HTTP REST API (replaces ipcMain.handle)
 * - WebSocket events (replaces ipcMain.send/webContents.send)
 * - Static file serving for the React app
 * - PTY terminal management
 * - Python subprocess management for agent execution
 */

import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { setupProjectRoutes } from './routes/projects.js';
import { setupTaskRoutes } from './routes/tasks.js';
import { setupTerminalRoutes } from './routes/terminals.js';
import { setupSettingsRoutes } from './routes/settings.js';
import { setupFileRoutes } from './routes/files.js';
import { setupAgentRoutes } from './routes/agents.js';
import { setupWebSocketHandlers } from './services/websocket.js';
import { ProjectService } from './services/project-service.js';
import { TerminalService } from './services/terminal-service.js';
import { AgentService } from './services/agent-service.js';
import { SettingsService } from './services/settings-service.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const PORT = parseInt(process.env.PORT || '3456', 10);
const HOST = process.env.HOST || '0.0.0.0';
const STATIC_DIR = process.env.STATIC_DIR || join(__dirname, '../../frontend/dist');
const BACKEND_DIR = process.env.BACKEND_DIR || join(__dirname, '../../backend');
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '../data');

// Initialize Express app
const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version || '2.7.5',
    uptime: process.uptime()
  });
});

// Initialize services
const projectService = new ProjectService(DATA_DIR);
const settingsService = new SettingsService(DATA_DIR);
const terminalService = new TerminalService(io);
const agentService = new AgentService(BACKEND_DIR, io);

// Setup API routes
const apiRouter = express.Router();
setupProjectRoutes(apiRouter, projectService);
setupTaskRoutes(apiRouter, projectService, agentService);
setupTerminalRoutes(apiRouter, terminalService);
setupSettingsRoutes(apiRouter, settingsService);
setupFileRoutes(apiRouter);
setupAgentRoutes(apiRouter, agentService);

app.use('/api', apiRouter);

// Setup WebSocket handlers
setupWebSocketHandlers(io, terminalService, agentService);

// Serve static files (React app)
app.use(express.static(STATIC_DIR));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (_req, res) => {
  res.sendFile(join(STATIC_DIR, 'index.html'));
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// Start server
httpServer.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    Auto Claude Web Server                      ║
╠══════════════════════════════════════════════════════════════╣
║  Server running at: http://${HOST}:${PORT}
║  Static files: ${STATIC_DIR}
║  Backend dir: ${BACKEND_DIR}
║  Data dir: ${DATA_DIR}
╚══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
const shutdown = () => {
  console.log('\n[Server] Shutting down gracefully...');

  // Clean up terminals
  terminalService.cleanup();

  // Clean up agents
  agentService.cleanup();

  httpServer.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[Server] Could not close connections in time, forcing shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, io, httpServer };
