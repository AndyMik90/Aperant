import type { Task, Project } from '../../../shared/types';
import { projectStore } from '../../project-store';

/**
 * Helper function to find task and project by taskId.
 *
 * When projectId is provided, the search is scoped to that project only,
 * preventing cross-project contamination when multiple projects have tasks
 * with the same specId (e.g., "016-write-wtf-to-text-file").
 *
 * Falls back to searching all projects when projectId is not provided
 * (backward compatibility for callers that don't have projectId).
 */
export const findTaskAndProject = (taskId: string, projectId?: string): { task: Task | undefined; project: Project | undefined } => {
  const projects = projectStore.getProjects();
  let task: Task | undefined;
  let project: Project | undefined;

  // If projectId provided, search only that project (eliminates cross-project contamination)
  if (projectId) {
    const targetProject = projects.find((p) => p.id === projectId);
    if (targetProject) {
      const tasks = projectStore.getTasks(targetProject.id);
      task = tasks.find((t) => t.id === taskId || t.specId === taskId);
      if (task) {
        return { task, project: targetProject };
      }
    }
  }

  // Fallback: search all projects (backward compatibility)
  for (const p of projects) {
    const tasks = projectStore.getTasks(p.id);
    task = tasks.find((t) => t.id === taskId || t.specId === taskId);
    if (task) {
      project = p;
      break;
    }
  }

  return { task, project };
};
