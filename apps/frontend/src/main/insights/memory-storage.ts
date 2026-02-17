import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { InsightsPaths } from './paths';

const MEMORY_FILENAME = 'JERRY_MEMORY.md';
const MAX_MEMORY_CHARS = 4000;

const MEMORY_TEMPLATE = `# Jerry's Memory

Notes and insights accumulated across conversations.

## Key Decisions

## Project Insights

## User Preferences

## Important Context
`;

/**
 * Manages Jerry's persistent memory across chat sessions.
 * Stores a markdown file per project at .ac.jerry/insights/JERRY_MEMORY.md
 */
export class MemoryStorage {
  private paths: InsightsPaths;

  constructor(paths: InsightsPaths) {
    this.paths = paths;
  }

  getMemoryPath(projectPath: string): string {
    return path.join(this.paths.getInsightsDir(projectPath), MEMORY_FILENAME);
  }

  loadMemory(projectPath: string, maxChars: number = MAX_MEMORY_CHARS): string | null {
    const memoryPath = this.getMemoryPath(projectPath);
    if (!existsSync(memoryPath)) return null;
    try {
      let content = readFileSync(memoryPath, 'utf-8');
      if (!content.trim()) return null;
      if (content.length > maxChars) {
        content = content.substring(0, maxChars) + '\n\n[...truncated]';
      }
      return content;
    } catch {
      return null;
    }
  }

  appendMemory(projectPath: string, section: string, content: string, source: string): boolean {
    const memoryPath = this.getMemoryPath(projectPath);
    const insightsDir = this.paths.getInsightsDir(projectPath);

    if (!existsSync(insightsDir)) {
      mkdirSync(insightsDir, { recursive: true });
    }
    if (!existsSync(memoryPath)) {
      writeFileSync(memoryPath, MEMORY_TEMPLATE);
    }

    try {
      let existing = readFileSync(memoryPath, 'utf-8');
      // Deduplicate
      if (existing.includes(content)) return false;
      // Find section header and append after it
      const sectionHeader = `## ${section}`;
      const headerPos = existing.indexOf(sectionHeader);
      if (headerPos === -1) {
        // Section doesn't exist, append at end
        existing += `\n${sectionHeader}\n\n- ${content} _(${source})_\n`;
      } else {
        const headerEnd = existing.indexOf('\n', headerPos) + 1;
        const entry = `\n- ${content} _(${source})_\n`;
        existing = existing.slice(0, headerEnd) + entry + existing.slice(headerEnd);
      }
      writeFileSync(memoryPath, existing);
      return true;
    } catch {
      return false;
    }
  }

  clearMemory(projectPath: string): void {
    const memoryPath = this.getMemoryPath(projectPath);
    if (existsSync(memoryPath)) {
      writeFileSync(memoryPath, MEMORY_TEMPLATE);
    }
  }
}
