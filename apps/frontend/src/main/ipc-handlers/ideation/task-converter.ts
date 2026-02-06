/**
 * Convert ideation ideas to tasks
 */

import path from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import type { IpcMainInvokeEvent } from 'electron';
import { AUTO_BUILD_PATHS, getSpecsDir } from '../../../shared/constants';
import type {
  IPCResult,
  Task,
  ImplementationPlan,
  TaskMetadata,
  TaskCategory,
  TaskImpact,
  TaskComplexity,
  TaskPriority
} from '../../../shared/types';
import { projectStore } from '../../project-store';
import { readIdeationFile, writeIdeationFile, updateIdeationTimestamp } from './file-utils';
import type { RawIdea } from './types';
import { withSpecNumberLock } from '../../utils/spec-number-lock';

/**
 * Create a slugified version of a title for use in directory names
 */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Build task description from idea data
 */
function buildTaskDescription(idea: RawIdea): string {
  let description = `# ${idea.title}\n\n`;
  description += `${idea.description}\n\n`;
  description += `## Rationale\n${idea.rationale}\n\n`;

  if (idea.type === 'code_improvements') {
    const buildsUpon = idea.builds_upon || [];
    if (Array.isArray(buildsUpon) && buildsUpon.length > 0) {
      description += `## Builds Upon\n${buildsUpon.map((b: string) => `- ${b}`).join('\n')}\n\n`;
    }
    if (idea.implementation_approach) {
      description += `## Implementation Approach\n${idea.implementation_approach}\n\n`;
    }
    const affectedFiles = idea.affected_files || [];
    if (Array.isArray(affectedFiles) && affectedFiles.length > 0) {
      description += `## Affected Files\n${affectedFiles.map((f: string) => `- ${f}`).join('\n')}\n\n`;
    }
    const existingPatterns = idea.existing_patterns || [];
    if (Array.isArray(existingPatterns) && existingPatterns.length > 0) {
      description += `## Patterns to Follow\n${existingPatterns.map((p: string) => `- ${p}`).join('\n')}\n\n`;
    }
  } else if (idea.type === 'ui_ux_improvements') {
    description += `## Category\n${idea.category}\n\n`;
    description += `## Current State\n${idea.current_state}\n\n`;
    description += `## Proposed Change\n${idea.proposed_change}\n\n`;
    description += `## User Benefit\n${idea.user_benefit}\n\n`;
    if (idea.affected_components?.length) {
      description += `## Affected Components\n${idea.affected_components.map((c: string) => `- ${c}`).join('\n')}\n\n`;
    }
  }

  return description;
}

/**
 * Build task metadata from idea
 */
function buildTaskMetadata(idea: RawIdea): TaskMetadata {
  const metadata: TaskMetadata = {
    sourceType: 'ideation',
    ideationType: idea.type,
    ideaId: idea.id,
    rationale: idea.rationale
  };

  // Map idea type to task category
  const ideaTypeToCategory: Record<string, TaskCategory> = {
    'code_improvements': 'feature',
    'ui_ux_improvements': 'ui_ux',
    'documentation_gaps': 'documentation',
    'security_hardening': 'security',
    'performance_optimizations': 'performance',
    'code_quality': 'refactoring'
  };
  metadata.category = ideaTypeToCategory[idea.type] || 'feature';

  // Extract type-specific metadata with proper type casting
  if (idea.type === 'code_improvements') {
    const effort = idea.estimated_effort as TaskComplexity | undefined;
    metadata.estimatedEffort = effort;
    metadata.complexity = effort;
    metadata.affectedFiles = idea.affected_files;
  } else if (idea.type === 'ui_ux_improvements') {
    metadata.uiuxCategory = idea.category;
    metadata.affectedFiles = idea.affected_components;
    metadata.problemSolved = idea.current_state;
  } else if (idea.type === 'documentation_gaps') {
    metadata.estimatedEffort = idea.estimated_effort as TaskComplexity | undefined;
    metadata.priority = idea.priority as TaskPriority | undefined;
    metadata.targetAudience = idea.target_audience;
    metadata.affectedFiles = idea.affected_areas;
  } else if (idea.type === 'security_hardening') {
    const severity = idea.severity as 'low' | 'medium' | 'high' | 'critical' | undefined;
    metadata.securitySeverity = severity;
    metadata.impact = severity as TaskImpact | undefined;
    metadata.priority = severity === 'critical' ? 'urgent' : severity === 'high' ? 'high' : 'medium';
    metadata.affectedFiles = idea.affected_files;
  } else if (idea.type === 'performance_optimizations') {
    metadata.performanceCategory = idea.category;
    metadata.impact = idea.impact as TaskImpact | undefined;
    metadata.estimatedEffort = idea.estimated_effort as TaskComplexity | undefined;
    metadata.affectedFiles = idea.affected_areas;
  } else if (idea.type === 'code_quality') {
    const severity = idea.severity as 'suggestion' | 'minor' | 'major' | 'critical' | undefined;
    metadata.codeQualitySeverity = severity;
    metadata.estimatedEffort = idea.estimated_effort as TaskComplexity | undefined;
    metadata.affectedFiles = idea.affected_files;
    metadata.priority = severity === 'critical' ? 'urgent' : severity === 'major' ? 'high' : 'medium';
  }

  return metadata;
}

/**
 * Create spec directory structure and files
 */
function createSpecFiles(
  specDir: string,
  idea: RawIdea,
  _taskDescription: string
): void {
  // Create the spec directory
  mkdirSync(specDir, { recursive: true });

  // Create initial implementation_plan.json
  const initialPlan: ImplementationPlan = {
    feature: idea.title,
    description: idea.description,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: 'backlog',
    planStatus: 'pending',
    phases: [],
    workflow_type: 'development',
    services_involved: [],
    final_acceptance: [],
    spec_file: 'spec.md'
  };
  writeFileSync(
    path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN),
    JSON.stringify(initialPlan, null, 2),
    'utf-8'
  );

  // Create initial spec.md
  const specContent = `# ${idea.title}

## Overview

${idea.description}

## Rationale

${idea.rationale}

---
*This spec was created from ideation and is pending detailed specification.*
`;
  writeFileSync(path.join(specDir, AUTO_BUILD_PATHS.SPEC_FILE), specContent, 'utf-8');
}

/**
 * Convert an idea to a task
 */
export async function convertIdeaToTask(
  _event: IpcMainInvokeEvent,
  projectId: string,
  ideaId: string
): Promise<IPCResult<Task>> {
  const project = projectStore.getProject(projectId);
  if (!project) {
    return { success: false, error: 'Project not found' };
  }

  const ideationPath = path.join(
    project.path,
    AUTO_BUILD_PATHS.IDEATION_DIR,
    AUTO_BUILD_PATHS.IDEATION_FILE
  );

  // Quick check that ideation file exists (actual read happens inside lock)
  if (!existsSync(ideationPath)) {
    return { success: false, error: 'Ideation not found' };
  }

  // Get specs directory path
  const specsBaseDir = getSpecsDir(project.autoBuildPath);
  const specsDir = path.join(project.path, specsBaseDir);

  // Ensure specs directory exists
  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
  }

  try {
    // Use coordinated spec numbering with lock to prevent collisions
    // CRITICAL: All state checks must happen INSIDE the lock to prevent TOCTOU race conditions
    return await withSpecNumberLock(project.path, async (lock) => {
      // Re-read ideation file INSIDE the lock to get fresh state
      const ideation = readIdeationFile(ideationPath);
      if (!ideation) {
        return { success: false, error: 'Ideation not found' };
      }

      // Find the idea (inside lock for fresh state)
      const idea = ideation.ideas?.find((i) => i.id === ideaId);
      if (!idea) {
        return { success: false, error: 'Idea not found' };
      }

      // Idempotency check INSIDE lock - prevents TOCTOU race condition
      // Two concurrent requests can both pass an outside check, but only one
      // can hold the lock at a time, so this check is authoritative
      if (idea.linked_task_id) {
        return {
          success: false,
          error: `Idea has already been converted to task: ${idea.linked_task_id}`
        };
      }

      // Get next spec number from global scan (main + all worktrees)
      const nextNum = lock.getNextSpecNumber(project.autoBuildPath);
      const slugifiedTitle = slugifyTitle(idea.title);
      const specId = `${String(nextNum).padStart(3, '0')}-${slugifiedTitle}`;
      const specDir = path.join(specsDir, specId);

      // Build task description and metadata
      const taskDescription = buildTaskDescription(idea);
      const metadata = buildTaskMetadata(idea);

      // Create spec files (inside lock to ensure atomicity)
      createSpecFiles(specDir, idea, taskDescription);

      // Save metadata
      const metadataPath = path.join(specDir, 'task_metadata.json');
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

      // Update idea status to archived (converted ideas are archived)
      idea.status = 'archived';
      idea.linked_task_id = specId;
      updateIdeationTimestamp(ideation);
      writeIdeationFile(ideationPath, ideation);

      // Create task object to return
      const task: Task = {
        id: specId,
        specId: specId,
        projectId,
        title: idea.title,
        description: taskDescription,
        status: 'backlog',
        subtasks: [],
        logs: [],
        metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      return { success: true, data: task };
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to convert idea to task'
    };
  }
}
