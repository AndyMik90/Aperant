/**
 * Task Routes
 *
 * HTTP endpoints for task management.
 */

import type { Router } from 'express';
import type { ProjectService } from '../services/project-service.js';
import type { AgentService } from '../services/agent-service.js';

export function setupTaskRoutes(
  router: Router,
  projectService: ProjectService,
  agentService: AgentService
): void {
  // List tasks for a project
  router.get('/projects/:projectId/tasks', async (req, res) => {
    try {
      const tasks = await projectService.getTasks(req.params.projectId);
      res.json({ success: true, data: tasks });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Create a task
  router.post('/projects/:projectId/tasks', async (req, res) => {
    try {
      const { title, description, metadata } = req.body;
      if (!title) {
        return res.status(400).json({ success: false, error: 'Title is required' });
      }

      const task = await projectService.createTask(
        req.params.projectId,
        title,
        description || '',
        metadata
      );
      res.json({ success: true, data: task });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Delete a task
  router.delete('/projects/:projectId/tasks/:taskId', async (req, res) => {
    try {
      await projectService.deleteTask(req.params.projectId, req.params.taskId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Start a task
  router.post('/projects/:projectId/tasks/:taskId/start', async (req, res) => {
    try {
      const projectPath = projectService.getProjectPath(req.params.projectId);
      if (!projectPath) {
        return res.status(404).json({ success: false, error: 'Project not found' });
      }

      const processId = agentService.startTask(
        req.params.projectId,
        projectPath,
        req.params.taskId,
        req.body
      );

      res.json({ success: true, data: { processId } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Stop a task
  router.post('/projects/:projectId/tasks/:taskId/stop', async (req, res) => {
    try {
      const stopped = agentService.stopTask(req.params.taskId);
      res.json({ success: true, data: { stopped } });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Check if task is running
  router.get('/projects/:projectId/tasks/:taskId/running', async (req, res) => {
    try {
      const running = agentService.isTaskRunning(req.params.taskId);
      res.json({ success: true, data: running });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  console.log('[Routes] Task routes initialized');
}
