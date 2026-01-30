import type { Task, Project } from '../../../shared/types';
import { projectStore } from '../../project-store';

/**
 * Helper function to find task and project by taskId
 */
export const findTaskAndProject = (taskId: string): { task: Task | undefined; project: Project | undefined } => {
  const projects = projectStore.getProjects();
  let task: Task | undefined;
  let project: Project | undefined;

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
