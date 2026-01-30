/**
 * Terminal Routes
 *
 * HTTP endpoints for terminal management.
 */

import type { Router } from 'express';
import type { TerminalService } from '../services/terminal-service.js';

export function setupTerminalRoutes(router: Router, terminalService: TerminalService): void {
  // Create a terminal
  router.post('/terminals', async (req, res) => {
    try {
      const { cwd, projectPath, cols, rows } = req.body;
      if (!cwd) {
        return res.status(400).json({ success: false, error: 'cwd is required' });
      }

      const terminalId = terminalService.createTerminal(cwd, projectPath, cols, rows);
      const terminal = terminalService.getTerminal(terminalId);

      res.json({ success: true, data: terminal });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // List terminals
  router.get('/terminals', async (req, res) => {
    try {
      const projectPath = req.query.projectPath as string | undefined;
      const terminals = terminalService.listTerminals(projectPath);
      res.json({ success: true, data: terminals });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get terminal info
  router.get('/terminals/:id', async (req, res) => {
    try {
      const terminal = terminalService.getTerminal(req.params.id);
      if (!terminal) {
        return res.status(404).json({ success: false, error: 'Terminal not found' });
      }
      res.json({ success: true, data: terminal });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Close a terminal
  router.delete('/terminals/:id', async (req, res) => {
    try {
      const closed = terminalService.close(req.params.id);
      res.json({ success: true, data: { closed } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Resize a terminal
  router.post('/terminals/:id/resize', async (req, res) => {
    try {
      const { cols, rows } = req.body;
      if (!cols || !rows) {
        return res.status(400).json({ success: false, error: 'cols and rows are required' });
      }

      const resized = terminalService.resize(req.params.id, cols, rows);
      res.json({ success: true, data: { resized } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  console.log('[Routes] Terminal routes initialized');
}
