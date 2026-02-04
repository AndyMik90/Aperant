/**
 * Learnings Store - SUG-23: Persistent Learning Memory
 *
 * Manages project learnings that are saved to LEARNINGS.md in the project root.
 * Learnings are captured from user feedback during human review phase.
 */

import { create } from 'zustand';

export interface Learning {
  id: string;
  date: string;  // ISO date string
  taskTitle: string;
  taskId: string;
  category: LearningCategory;
  learning: string;
  context?: string;
}

export type LearningCategory =
  | 'error_handling'
  | 'code_style'
  | 'architecture'
  | 'testing'
  | 'performance'
  | 'security'
  | 'ui_ux'
  | 'documentation'
  | 'general';

// Category display labels
export const LEARNING_CATEGORY_LABELS: Record<LearningCategory, string> = {
  error_handling: 'Error Handling',
  code_style: 'Code Style',
  architecture: 'Architecture',
  testing: 'Testing',
  performance: 'Performance',
  security: 'Security',
  ui_ux: 'UI/UX',
  documentation: 'Documentation',
  general: 'General'
};

interface LearningsState {
  learnings: Learning[];
  isLoading: boolean;
  error: string | null;
  projectPath: string | null;

  // Actions
  setLearnings: (learnings: Learning[]) => void;
  addLearning: (learning: Omit<Learning, 'id' | 'date'>) => Promise<boolean>;
  removeLearning: (learningId: string) => Promise<boolean>;
  loadLearnings: (projectPath: string) => Promise<void>;
  setError: (error: string | null) => void;
}

/**
 * Parse LEARNINGS.md content into structured learnings
 */
function parseLearningsMarkdown(content: string): Learning[] {
  const learnings: Learning[] = [];

  // Match learning entries in the format:
  // ## [2026-02-03] Task: Fix login bug
  // **Category:** Error Handling
  // **Learning:** Always check for null user before accessing properties
  // **Context:** The login flow crashed when user was undefined (optional)
  const entryRegex = /## \[(\d{4}-\d{2}-\d{2})\] Task: (.+?)\n\*\*Task ID:\*\* (.+?)\n\*\*Category:\*\* (.+?)\n\*\*Learning:\*\* (.+?)(?:\n\*\*Context:\*\* (.+?))?(?=\n## |\n---|\n*$)/gs;

  let match;
  while ((match = entryRegex.exec(content)) !== null) {
    const [, date, taskTitle, taskId, category, learning, context] = match;
    learnings.push({
      id: `${date}-${taskId}`.replace(/[^a-zA-Z0-9-]/g, '-'),
      date,
      taskTitle: taskTitle.trim(),
      taskId: taskId.trim(),
      category: mapCategoryFromLabel(category.trim()),
      learning: learning.trim(),
      context: context?.trim()
    });
  }

  return learnings;
}

/**
 * Map category label back to category key
 */
function mapCategoryFromLabel(label: string): LearningCategory {
  const reverseMap: Record<string, LearningCategory> = {};
  for (const [key, value] of Object.entries(LEARNING_CATEGORY_LABELS)) {
    reverseMap[value.toLowerCase()] = key as LearningCategory;
  }
  return reverseMap[label.toLowerCase()] || 'general';
}

/**
 * Generate LEARNINGS.md content from learnings array
 */
function generateLearningsMarkdown(learnings: Learning[]): string {
  if (learnings.length === 0) {
    return `# Project Learnings

This file contains learnings captured from task feedback to improve future AI-assisted development.

---

*No learnings recorded yet.*
`;
  }

  const entries = learnings.map((l) => {
    let entry = `## [${l.date}] Task: ${l.taskTitle}
**Task ID:** ${l.taskId}
**Category:** ${LEARNING_CATEGORY_LABELS[l.category] || l.category}
**Learning:** ${l.learning}`;

    if (l.context) {
      entry += `\n**Context:** ${l.context}`;
    }

    return entry;
  }).join('\n\n');

  return `# Project Learnings

This file contains learnings captured from task feedback to improve future AI-assisted development.
These learnings are automatically injected into planning and coding prompts.

---

${entries}
`;
}

export const useLearningsStore = create<LearningsState>((set, get) => ({
  learnings: [],
  isLoading: false,
  error: null,
  projectPath: null,

  setLearnings: (learnings) => set({ learnings }),

  addLearning: async (learningData) => {
    const { projectPath, learnings } = get();
    if (!projectPath) {
      set({ error: 'No project path set' });
      return false;
    }

    const newLearning: Learning = {
      ...learningData,
      id: `${new Date().toISOString().split('T')[0]}-${learningData.taskId}-${Date.now()}`.replace(/[^a-zA-Z0-9-]/g, '-'),
      date: new Date().toISOString().split('T')[0]
    };

    const updatedLearnings = [...learnings, newLearning];
    const content = generateLearningsMarkdown(updatedLearnings);

    try {
      const result = await window.electronAPI.writeFile(
        `${projectPath}/LEARNINGS.md`,
        content
      );

      if (result.success) {
        set({ learnings: updatedLearnings, error: null });
        return true;
      } else {
        set({ error: result.error || 'Failed to save learning' });
        return false;
      }
    } catch (error) {
      console.error('[learnings-store] Failed to add learning:', error);
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  },

  removeLearning: async (learningId) => {
    const { projectPath, learnings } = get();
    if (!projectPath) {
      set({ error: 'No project path set' });
      return false;
    }

    const updatedLearnings = learnings.filter((l) => l.id !== learningId);
    const content = generateLearningsMarkdown(updatedLearnings);

    try {
      const result = await window.electronAPI.writeFile(
        `${projectPath}/LEARNINGS.md`,
        content
      );

      if (result.success) {
        set({ learnings: updatedLearnings, error: null });
        return true;
      } else {
        set({ error: result.error || 'Failed to remove learning' });
        return false;
      }
    } catch (error) {
      console.error('[learnings-store] Failed to remove learning:', error);
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  },

  loadLearnings: async (projectPath) => {
    set({ isLoading: true, error: null, projectPath });

    try {
      const result = await window.electronAPI.readFile(`${projectPath}/LEARNINGS.md`);

      if (result.success && result.data) {
        const learnings = parseLearningsMarkdown(result.data);
        set({ learnings, isLoading: false });
      } else if (result.error?.includes('ENOENT') || result.error?.includes('not found')) {
        // File doesn't exist yet, that's fine
        set({ learnings: [], isLoading: false });
      } else {
        set({ error: result.error || 'Failed to load learnings', isLoading: false });
      }
    } catch (error) {
      console.error('[learnings-store] Failed to load learnings:', error);
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false
      });
    }
  },

  setError: (error) => set({ error })
}));

/**
 * Helper to add a learning from task feedback
 */
export async function addLearningFromFeedback(
  projectPath: string,
  taskId: string,
  taskTitle: string,
  feedback: string,
  category: LearningCategory = 'general'
): Promise<boolean> {
  const store = useLearningsStore.getState();

  // Ensure learnings are loaded for this project
  if (store.projectPath !== projectPath) {
    await store.loadLearnings(projectPath);
  }

  return store.addLearning({
    taskId,
    taskTitle,
    category,
    learning: feedback
  });
}

/**
 * Get learnings for prompt injection
 * Returns formatted learnings suitable for inclusion in agent prompts
 */
export function getLearningsForPrompt(projectPath: string): string {
  const store = useLearningsStore.getState();

  // If learnings aren't loaded for this project, return empty
  if (store.projectPath !== projectPath || store.learnings.length === 0) {
    return '';
  }

  const formattedLearnings = store.learnings.map((l) => {
    return `- [${LEARNING_CATEGORY_LABELS[l.category]}] ${l.learning}${l.context ? ` (Context: ${l.context})` : ''}`;
  }).join('\n');

  return `## Project Learnings

The following learnings have been captured from previous task feedback. Apply these patterns and avoid these mistakes:

${formattedLearnings}
`;
}
