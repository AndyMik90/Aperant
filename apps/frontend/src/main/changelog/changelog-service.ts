import { EventEmitter } from 'events';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { app } from 'electron';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { AUTO_BUILD_PATHS, DEFAULT_CHANGELOG_PATH } from '../../shared/constants';
import { getToolPath, getToolInfo } from '../cli-tool-manager';
import type {
  ChangelogTask,
  TaskSpecContent,
  ChangelogGenerationRequest,
  ChangelogSaveRequest,
  ChangelogSaveResult,
  ExistingChangelog,
  Task,
  ImplementationPlan,
  GitBranchInfo,
  GitTagInfo
} from '../../shared/types';
import { isCompletedTask } from '../../shared/utils/task-status';
import { ChangelogGenerator } from './generator';
import { VersionSuggester } from './version-suggester';
import { parseExistingChangelog } from './parser';
import {
  getBranches,
  getTags,
  getCurrentBranch,
  getDefaultBranch,
  getCommits,
  getBranchDiffCommits
} from './git-integration';
import { getValidatedPythonPath } from '../python-detector';
import { getConfiguredPythonPath } from '../python-env-manager';

/**
 * Main changelog service - orchestrates all changelog operations
 * Delegates to specialized modules for specific concerns
 */
export class ChangelogService extends EventEmitter {
  // Python path will be configured by pythonEnvManager after venv is ready
  private _pythonPath: string | null = null;
  private claudePath: string;
  private autoBuildSourcePath: string = '';
  private debugEnabled: boolean | null = null;
  private generator: ChangelogGenerator | null = null;
  private versionSuggester: VersionSuggester | null = null;

  constructor() {
    super();
    // Use centralized CLI tool manager for Claude detection
    this.claudePath = getToolPath('claude');
    this.debug('ChangelogService initialized with Claude CLI:', this.claudePath);
  }

  /**
   * Check if debug mode is enabled
   * Checks DEBUG from auto-claude/.env and DEBUG from process.env
   */
  private isDebugEnabled(): boolean {
    // Cache the result after first check
    if (this.debugEnabled !== null) {
      return this.debugEnabled;
    }

    // Check process.env first
    if (
      process.env.DEBUG === 'true' ||
      process.env.DEBUG === '1'
    ) {
      this.debugEnabled = true;
      return true;
    }

    // Check auto-claude .env file
    const env = this.loadAutoBuildEnv();
    this.debugEnabled = env.DEBUG === 'true' || env.DEBUG === '1';
    return this.debugEnabled;
  }

  /**
   * Debug logging - only logs when DEBUG=true in auto-claude/.env or DEBUG is set
   */
  private debug(...args: unknown[]): void {
    if (this.isDebugEnabled()) {
      console.warn('[ChangelogService]', ...args);
    }
  }

  configure(pythonPath?: string, autoBuildSourcePath?: string): void {
    if (pythonPath) {
      this._pythonPath = getValidatedPythonPath(pythonPath, 'ChangelogService');
    }
    if (autoBuildSourcePath) {
      this.autoBuildSourcePath = autoBuildSourcePath;
    }
  }

  /**
   * Get the configured Python path.
   * Returns explicitly configured path, or falls back to getConfiguredPythonPath()
   * which uses the venv Python if ready.
   */
  private get pythonPath(): string {
    if (this._pythonPath) {
      return this._pythonPath;
    }
    return getConfiguredPythonPath();
  }

  /**
   * Get the auto-claude source path (detects automatically if not configured)
   */
  private getAutoBuildSourcePath(): string | null {
    if (this.autoBuildSourcePath && existsSync(this.autoBuildSourcePath)) {
      return this.autoBuildSourcePath;
    }

    const possiblePaths = [
      // Apps structure: from out/main -> apps/backend
      path.resolve(__dirname, '..', '..', '..', 'backend'),
      path.resolve(app.getAppPath(), '..', 'backend'),
      path.resolve(process.cwd(), 'apps', 'backend')
    ];

    for (const p of possiblePaths) {
      if (existsSync(p) && existsSync(path.join(p, 'runners', 'spec_runner.py'))) {
        return p;
      }
    }
    return null;
  }

  /**
   * Load environment variables from auto-claude .env file
   */
  private loadAutoBuildEnv(): Record<string, string> {
    const autoBuildSource = this.getAutoBuildSourcePath();
    if (!autoBuildSource) return {};

    const envPath = path.join(autoBuildSource, '.env');
    if (!existsSync(envPath)) return {};

    try {
      const envContent = readFileSync(envPath, 'utf-8');
      const envVars: Record<string, string> = {};

      // Handle both Unix (\n) and Windows (\r\n) line endings
      for (const line of envContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();

          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          envVars[key] = value;
        }
      }

      return envVars;
    } catch {
      return {};
    }
  }

  /**
   * Ensure prerequisites are met for changelog generation
   * Validates auto-build source path and Claude CLI availability
   * Returns the resolved Claude CLI path to ensure we use the freshly validated path
   */
  private ensurePrerequisites(): { autoBuildSource: string; claudePath: string } {
    const autoBuildSource = this.getAutoBuildSourcePath();
    if (!autoBuildSource) {
      throw new Error('Auto-build source path not found');
    }

    const claudeInfo = getToolInfo('claude');
    if (!claudeInfo.found || !claudeInfo.path) {
      // Use claudeInfo.message directly to avoid redundant text
      throw new Error(claudeInfo.message || 'Claude CLI not found. Install from https://claude.ai/download');
    }

    // Update cached path with freshly resolved value
    this.claudePath = claudeInfo.path;
    return { autoBuildSource, claudePath: claudeInfo.path };
  }

  /**
   * Get or create the generator instance
   */
  private getGenerator(): ChangelogGenerator {
    if (!this.generator) {
      const { autoBuildSource, claudePath } = this.ensurePrerequisites();

      const autoBuildEnv = this.loadAutoBuildEnv();

      this.generator = new ChangelogGenerator(
        this.pythonPath,
        claudePath,
        autoBuildSource,
        autoBuildEnv,
        this.isDebugEnabled()
      );

      // Forward events from generator
      this.generator.on('generation-complete', (projectId, result) => {
        this.emit('generation-complete', projectId, result);
      });

      this.generator.on('generation-progress', (projectId, progress) => {
        this.emit('generation-progress', projectId, progress);
      });

      this.generator.on('generation-error', (projectId, error) => {
        this.emit('generation-error', projectId, error);
      });

      this.generator.on('rate-limit', (projectId, rateLimitInfo) => {
        this.emit('rate-limit', projectId, rateLimitInfo);
      });
    }

    return this.generator;
  }

  /**
   * Get or create the version suggester instance
   */
  private getVersionSuggester(): VersionSuggester {
    if (!this.versionSuggester) {
      const { autoBuildSource, claudePath } = this.ensurePrerequisites();

      this.versionSuggester = new VersionSuggester(
        this.pythonPath,
        claudePath,
        autoBuildSource,
        this.isDebugEnabled()
      );
    }

    return this.versionSuggester;
  }

  // ============================================
  // Task Management
  // ============================================

  /**
   * Get completed tasks from a project
   */
  getCompletedTasks(projectPath: string, tasks: Task[], specsBaseDir?: string): ChangelogTask[] {
    const specsDir = path.join(projectPath, specsBaseDir || AUTO_BUILD_PATHS.SPECS_DIR);

    return tasks
      .filter(task => isCompletedTask(task.status, task.reviewReason) && !task.metadata?.archivedAt)
      .map(task => {
        const specDir = path.join(specsDir, task.specId);
        const hasSpecs = existsSync(specDir) && existsSync(path.join(specDir, AUTO_BUILD_PATHS.SPEC_FILE));

        return {
          id: task.id,
          specId: task.specId,
          title: task.title,
          description: task.description,
          completedAt: task.updatedAt,
          hasSpecs
        };
      })
      .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  }

  /**
   * Load spec files for given tasks
   */
  async loadTaskSpecs(projectPath: string, taskIds: string[], tasks: Task[], specsBaseDir?: string): Promise<TaskSpecContent[]> {
    const specsDir = path.join(projectPath, specsBaseDir || AUTO_BUILD_PATHS.SPECS_DIR);
    this.debug('loadTaskSpecs called', { projectPath, specsDir, taskCount: taskIds.length });

    const results: TaskSpecContent[] = [];

    for (const taskId of taskIds) {
      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        this.debug('Task not found:', taskId);
        continue;
      }

      const specDir = path.join(specsDir, task.specId);
      this.debug('Loading spec for task', { taskId, specId: task.specId, specDir });

      const content: TaskSpecContent = {
        taskId,
        specId: task.specId
      };

      try {
        // Load spec.md
        const specPath = path.join(specDir, AUTO_BUILD_PATHS.SPEC_FILE);
        if (existsSync(specPath)) {
          content.spec = readFileSync(specPath, 'utf-8');
          this.debug('Loaded spec.md', { specId: task.specId, length: content.spec.length });
        }

        // Load requirements.json
        const requirementsPath = path.join(specDir, AUTO_BUILD_PATHS.REQUIREMENTS);
        if (existsSync(requirementsPath)) {
          content.requirements = JSON.parse(readFileSync(requirementsPath, 'utf-8'));
        }

        // Load qa_report.md
        const qaReportPath = path.join(specDir, AUTO_BUILD_PATHS.QA_REPORT);
        if (existsSync(qaReportPath)) {
          content.qaReport = readFileSync(qaReportPath, 'utf-8');
        }

        // Load implementation_plan.json
        const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
        if (existsSync(planPath)) {
          content.implementationPlan = JSON.parse(readFileSync(planPath, 'utf-8')) as ImplementationPlan;
        }
      } catch (error) {
        content.error = error instanceof Error ? error.message : 'Failed to load spec files';
        this.debug('Error loading spec', { specId: task.specId, error: content.error });
      }

      results.push(content);
    }

    this.debug('loadTaskSpecs complete', { loadedCount: results.length });
    return results;
  }

  // ============================================
  // Git Data Retrieval
  // ============================================

  getBranches(projectPath: string): GitBranchInfo[] {
    return getBranches(projectPath, this.isDebugEnabled());
  }

  getTags(projectPath: string): GitTagInfo[] {
    return getTags(projectPath, this.isDebugEnabled());
  }

  getCurrentBranch(projectPath: string): string {
    return getCurrentBranch(projectPath);
  }

  getDefaultBranch(projectPath: string): string {
    return getDefaultBranch(projectPath);
  }

  getCommits(projectPath: string, options: import('../../shared/types').GitHistoryOptions): import('../../shared/types').GitCommit[] {
    return getCommits(projectPath, options, this.isDebugEnabled());
  }

  getBranchDiffCommits(projectPath: string, options: import('../../shared/types').BranchDiffOptions): import('../../shared/types').GitCommit[] {
    return getBranchDiffCommits(projectPath, options, this.isDebugEnabled());
  }

  // ============================================
  // Changelog Generation
  // ============================================

  generateChangelog(
    projectId: string,
    projectPath: string,
    request: ChangelogGenerationRequest,
    specs?: TaskSpecContent[]
  ): void {
    try {
      const generator = this.getGenerator();
      generator.generate(projectId, projectPath, request, specs);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize generator';
      this.debug('ERROR:', errorMessage);
      this.emit('generation-error', projectId, errorMessage);
    }
  }

  cancelGeneration(projectId: string): boolean {
    if (this.generator) {
      return this.generator.cancel(projectId);
    }
    return false;
  }

  // ============================================
  // File Operations
  // ============================================

  /**
   * Save changelog to file
   */
  saveChangelog(
    projectPath: string,
    request: ChangelogSaveRequest
  ): ChangelogSaveResult {
    const filePath = request.filePath
      ? path.join(projectPath, request.filePath)
      : path.join(projectPath, DEFAULT_CHANGELOG_PATH);

    let finalContent = request.content;

    if (request.mode === 'prepend' && existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf-8');
      // Add separator between new and existing content
      finalContent = `${request.content}\n\n${existing}`;
    } else if (request.mode === 'append' && existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf-8');
      finalContent = `${existing}\n\n${request.content}`;
    }

    writeFileSync(filePath, finalContent, 'utf-8');

    return {
      filePath,
      bytesWritten: Buffer.byteLength(finalContent, 'utf-8')
    };
  }

  /**
   * Read existing changelog file
   */
  readExistingChangelog(projectPath: string): ExistingChangelog {
    const filePath = path.join(projectPath, DEFAULT_CHANGELOG_PATH);

    if (!existsSync(filePath)) {
      return { exists: false };
    }

    return parseExistingChangelog(filePath);
  }

  /**
   * Suggest next version based on task types (rule-based)
   */
  suggestVersion(specs: TaskSpecContent[], currentVersion?: string): string {
    // Default starting version
    if (!currentVersion) {
      return '1.0.0';
    }

    const parts = currentVersion.split('.').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
      return '1.0.0';
    }

    const [major, minor, patch] = parts;

    // Analyze specs for version increment decision
    let hasBreakingChanges = false;
    let hasNewFeatures = false;

    for (const spec of specs) {
      const content = (spec.spec || '').toLowerCase();

      if (content.includes('breaking change') || content.includes('breaking:')) {
        hasBreakingChanges = true;
      }

      if (spec.implementationPlan?.workflow_type === 'new_feature' ||
          content.includes('new feature') ||
          content.includes('## added')) {
        hasNewFeatures = true;
      }
    }

    if (hasBreakingChanges) {
      return `${major + 1}.0.0`;
    } else if (hasNewFeatures) {
      return `${major}.${minor + 1}.0`;
    } else {
      return `${major}.${minor}.${patch + 1}`;
    }
  }

  /**
   * Suggest version using AI analysis of git commits
   */
  async suggestVersionFromCommits(
    _projectPath: string,
    commits: import('../../shared/types').GitCommit[],
    currentVersion?: string
  ): Promise<{ version: string; reason: string }> {
    try {
      // Default starting version
      if (!currentVersion) {
        return { version: '1.0.0', reason: 'Initial version' };
      }

      const parts = currentVersion.split('.').map(Number);
      if (parts.length !== 3 || parts.some(Number.isNaN)) {
        return { version: '1.0.0', reason: 'Invalid current version, resetting to 1.0.0' };
      }

      // Use AI to analyze commits and suggest version bump
      const suggester = this.getVersionSuggester();
      const suggestion = await suggester.suggestVersionBump(commits, currentVersion);

      this.debug('AI version suggestion', suggestion);

      return {
        version: suggestion.version,
        reason: suggestion.reason
      };
    } catch (error) {
      this.debug('Error in AI version suggestion, falling back to patch bump', error);
      // Fallback to patch bump if AI fails
      const [major, minor, patch] = (currentVersion || '1.0.0').split('.').map(Number);
      return {
        version: `${major}.${minor}.${patch + 1}`,
        reason: 'Patch version bump (AI analysis failed)'
      };
    }
  }
}

// Export singleton instance
export const changelogService = new ChangelogService();
