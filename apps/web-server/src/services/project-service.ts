/**
 * Project Service
 *
 * Manages project state and operations.
 * Data is stored in JSON files in the data directory.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'node:child_process';

export interface Project {
  id: string;
  name: string;
  path: string;
  autoBuildPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  mainBranch?: string;
  excludePatterns?: string[];
  [key: string]: unknown;
}

export interface Task {
  id: string;
  specId: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  subtasks?: unknown[];
  executionProgress?: unknown;
  qaReport?: unknown;
  logs?: unknown[];
}

export class ProjectService {
  private dataDir: string;
  private projectsFile: string;
  private projects: Map<string, Project> = new Map();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.projectsFile = join(dataDir, 'projects.json');

    // Ensure data directory exists
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Load existing projects
    this.loadProjects();
  }

  private loadProjects(): void {
    if (existsSync(this.projectsFile)) {
      try {
        const data = JSON.parse(readFileSync(this.projectsFile, 'utf-8'));
        for (const project of data.projects || []) {
          this.projects.set(project.id, project);
        }
      } catch (error) {
        console.error('[ProjectService] Failed to load projects:', error);
      }
    }
  }

  private saveProjects(): void {
    const data = {
      projects: Array.from(this.projects.values())
    };
    writeFileSync(this.projectsFile, JSON.stringify(data, null, 2));
  }

  async getProjects(): Promise<Project[]> {
    return Array.from(this.projects.values());
  }

  async addProject(projectPath: string): Promise<Project> {
    // Check if project already exists
    for (const project of this.projects.values()) {
      if (project.path === projectPath) {
        return project;
      }
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: uuidv4(),
      name: basename(projectPath),
      path: projectPath,
      createdAt: now,
      updatedAt: now
    };

    // Check if .auto-claude folder exists
    const autoBuildPath = join(projectPath, '.auto-claude');
    if (existsSync(autoBuildPath)) {
      project.autoBuildPath = autoBuildPath;
    }

    this.projects.set(project.id, project);
    this.saveProjects();

    return project;
  }

  async removeProject(projectId: string): Promise<void> {
    this.projects.delete(projectId);
    this.saveProjects();
  }

  async getProject(projectId: string): Promise<Project | null> {
    return this.projects.get(projectId) || null;
  }

  async updateProjectSettings(projectId: string, settings: Partial<ProjectSettings>): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Save settings to project's .auto-claude/settings.json
    const settingsPath = join(project.path, '.auto-claude', 'settings.json');
    let existingSettings: ProjectSettings = {};

    if (existsSync(settingsPath)) {
      try {
        existingSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch (error) {
        console.error('[ProjectService] Failed to load project settings:', error);
      }
    }

    const updatedSettings = { ...existingSettings, ...settings };
    writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2));
  }

  async initializeProject(projectId: string): Promise<{ success: boolean; error?: string }> {
    const project = this.projects.get(projectId);
    if (!project) {
      return { success: false, error: `Project not found: ${projectId}` };
    }

    const autoBuildPath = join(project.path, '.auto-claude');

    try {
      // Create .auto-claude directory
      if (!existsSync(autoBuildPath)) {
        mkdirSync(autoBuildPath, { recursive: true });
      }

      // Create specs directory
      const specsDir = join(autoBuildPath, 'specs');
      if (!existsSync(specsDir)) {
        mkdirSync(specsDir, { recursive: true });
      }

      // Create default settings.json
      const settingsPath = join(autoBuildPath, 'settings.json');
      if (!existsSync(settingsPath)) {
        writeFileSync(settingsPath, JSON.stringify({
          version: '2.7.5',
          createdAt: new Date().toISOString()
        }, null, 2));
      }

      // Update project with autoBuildPath
      project.autoBuildPath = autoBuildPath;
      project.updatedAt = new Date().toISOString();
      this.saveProjects();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getTasks(projectId: string): Promise<Task[]> {
    const project = this.projects.get(projectId);
    if (!project || !project.autoBuildPath) {
      return [];
    }

    const specsDir = join(project.autoBuildPath, 'specs');
    if (!existsSync(specsDir)) {
      return [];
    }

    const tasks: Task[] = [];

    try {
      const specDirs = readdirSync(specsDir).filter(dir => {
        const specPath = join(specsDir, dir);
        return statSync(specPath).isDirectory();
      });

      for (const specId of specDirs) {
        const specPath = join(specsDir, specId);
        const specFile = join(specPath, 'spec.md');
        const requirementsFile = join(specPath, 'requirements.json');

        if (existsSync(specFile) || existsSync(requirementsFile)) {
          let title = specId;
          let description = '';
          let status = 'pending';
          let metadata: Record<string, unknown> = {};

          // Try to read requirements.json for more details
          if (existsSync(requirementsFile)) {
            try {
              const requirements = JSON.parse(readFileSync(requirementsFile, 'utf-8'));
              title = requirements.title || specId;
              description = requirements.description || '';
              status = requirements.status || 'pending';
              metadata = requirements.metadata || {};
            } catch (error) {
              // Ignore parse errors
            }
          }

          tasks.push({
            id: specId,
            specId,
            projectId,
            title,
            description,
            status,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata
          });
        }
      }
    } catch (error) {
      console.error('[ProjectService] Failed to read tasks:', error);
    }

    return tasks;
  }

  async createTask(
    projectId: string,
    title: string,
    description: string,
    metadata?: Record<string, unknown>
  ): Promise<Task> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Initialize project if needed
    if (!project.autoBuildPath) {
      const result = await this.initializeProject(projectId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to initialize project');
      }
    }

    // Generate spec ID (format: XXX-title-slug)
    const existingTasks = await this.getTasks(projectId);
    const nextNum = existingTasks.length + 1;
    const titleSlug = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
    const specId = `${String(nextNum).padStart(3, '0')}-${titleSlug}`;

    const specsDir = join(project.autoBuildPath!, 'specs');
    const specPath = join(specsDir, specId);

    // Create spec directory
    mkdirSync(specPath, { recursive: true });

    // Create requirements.json
    const now = new Date().toISOString();
    const requirements = {
      title,
      description,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      metadata: metadata || {}
    };
    writeFileSync(join(specPath, 'requirements.json'), JSON.stringify(requirements, null, 2));

    // Create spec.md
    const specContent = `# ${title}\n\n${description}\n`;
    writeFileSync(join(specPath, 'spec.md'), specContent);

    return {
      id: specId,
      specId,
      projectId,
      title,
      description,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      metadata: metadata || {}
    };
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project || !project.autoBuildPath) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const specPath = join(project.autoBuildPath, 'specs', taskId);
    if (existsSync(specPath)) {
      // Remove spec directory recursively
      execSync(`rm -rf "${specPath}"`);
    }
  }

  getProjectPath(projectId: string): string | null {
    const project = this.projects.get(projectId);
    return project?.path || null;
  }

  getAutoBuildPath(projectId: string): string | null {
    const project = this.projects.get(projectId);
    return project?.autoBuildPath || null;
  }
}
