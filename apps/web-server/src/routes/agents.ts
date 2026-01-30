/**
 * Agent Routes
 *
 * HTTP endpoints for agent operations (roadmap, insights, ideation).
 */

import type { Router } from 'express';
import type { AgentService } from '../services/agent-service.js';

export function setupAgentRoutes(router: Router, agentService: AgentService): void {
  // List running processes
  router.get('/agents', async (_req, res) => {
    try {
      const processes = agentService.listProcesses();
      res.json({ success: true, data: processes });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get process info
  router.get('/agents/:id', async (req, res) => {
    try {
      const process = agentService.getProcess(req.params.id);
      if (!process) {
        return res.status(404).json({ success: false, error: 'Process not found' });
      }
      res.json({ success: true, data: process });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Kill a process
  router.delete('/agents/:id', async (req, res) => {
    try {
      const killed = agentService.killProcess(req.params.id);
      res.json({ success: true, data: { killed } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Start roadmap generation
  router.post('/projects/:projectId/roadmap', async (req, res) => {
    try {
      const { projectPath } = req.body;
      if (!projectPath) {
        return res.status(400).json({ success: false, error: 'projectPath is required' });
      }

      const processId = agentService.startRoadmap(req.params.projectId, projectPath);
      res.json({ success: true, data: { processId } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Start insights query
  router.post('/projects/:projectId/insights', async (req, res) => {
    try {
      const { projectPath, query } = req.body;
      if (!projectPath || !query) {
        return res.status(400).json({ success: false, error: 'projectPath and query are required' });
      }

      const processId = agentService.startInsights(req.params.projectId, projectPath, query);
      res.json({ success: true, data: { processId } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Start ideation
  router.post('/projects/:projectId/ideation', async (req, res) => {
    try {
      const { projectPath, category } = req.body;
      if (!projectPath || !category) {
        return res.status(400).json({ success: false, error: 'projectPath and category are required' });
      }

      const processId = agentService.startIdeation(req.params.projectId, projectPath, category);
      res.json({ success: true, data: { processId } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  console.log('[Routes] Agent routes initialized');
}
