/**
 * Project Routes
 *
 * HTTP endpoints for project management.
 */

import type { Router } from 'express';
import type { ProjectService } from '../services/project-service.js';

export function setupProjectRoutes(router: Router, projectService: ProjectService): void {
  // List all projects
  router.get('/projects', async (_req, res) => {
    try {
      const projects = await projectService.getProjects();
      res.json({ success: true, data: projects });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Add a project
  router.post('/projects', async (req, res) => {
    try {
      const { path } = req.body;
      if (!path) {
        return res.status(400).json({ success: false, error: 'Path is required' });
      }

      const project = await projectService.addProject(path);
      res.json({ success: true, data: project });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get a project
  router.get('/projects/:id', async (req, res) => {
    try {
      const project = await projectService.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ success: false, error: 'Project not found' });
      }
      res.json({ success: true, data: project });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Remove a project
  router.delete('/projects/:id', async (req, res) => {
    try {
      await projectService.removeProject(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update project settings
  router.patch('/projects/:id/settings', async (req, res) => {
    try {
      await projectService.updateProjectSettings(req.params.id, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Initialize project
  router.post('/projects/:id/initialize', async (req, res) => {
    try {
      const result = await projectService.initializeProject(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  console.log('[Routes] Project routes initialized');
}
