/**
 * File Routes
 *
 * HTTP endpoints for file operations.
 */

import type { Router } from 'express';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function setupFileRoutes(router: Router): void {
  // Read a file
  router.get('/files/read', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        return res.status(400).json({ success: false, error: 'Path is required' });
      }

      if (!existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }

      const content = readFileSync(filePath, 'utf-8');
      res.json({ success: true, data: content });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // List directory contents
  router.get('/files/list', async (req, res) => {
    try {
      const dirPath = req.query.path as string;
      if (!dirPath) {
        return res.status(400).json({ success: false, error: 'Path is required' });
      }

      if (!existsSync(dirPath)) {
        return res.status(404).json({ success: false, error: 'Directory not found' });
      }

      const entries = readdirSync(dirPath).map(name => {
        const fullPath = join(dirPath, name);
        const stats = statSync(fullPath);
        return {
          name,
          path: fullPath,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString()
        };
      });

      res.json({ success: true, data: entries });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Check if path exists
  router.get('/files/exists', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        return res.status(400).json({ success: false, error: 'Path is required' });
      }

      const exists = existsSync(filePath);
      res.json({ success: true, data: exists });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  console.log('[Routes] File routes initialized');
}
