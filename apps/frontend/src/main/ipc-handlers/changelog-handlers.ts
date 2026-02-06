import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { IPC_CHANNELS, getSpecsDir } from '../../shared/constants';
import type {
  IPCResult,
  Task,
  ChangelogTask,
  TaskSpecContent,
  ChangelogGenerationRequest,
  ChangelogSaveRequest,
  ChangelogSaveResult,
  ExistingChangelog,
  GitBranchInfo,
  GitTagInfo,
  GitCommit,
  GitHistoryOptions,
  BranchDiffOptions
} from '../../shared/types';
import { projectStore } from '../project-store';
import { changelogService } from '../changelog-service';

/**
 * Register all changelog-related IPC handlers
 */
export function registerChangelogHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  // ============================================
  // Changelog Event Handlers
  // ============================================

  changelogService.on('generation-progress', (projectId: string, progress: import('../../shared/types').ChangelogGenerationProgress) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.CHANGELOG_GENERATION_PROGRESS, projectId, progress);
    }
  });

  changelogService.on('generation-complete', (projectId: string, result: import('../../shared/types').ChangelogGenerationResult) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.CHANGELOG_GENERATION_COMPLETE, projectId, result);
    }
  });

  changelogService.on('generation-error', (projectId: string, error: string) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.CHANGELOG_GENERATION_ERROR, projectId, error);
    }
  });

  changelogService.on('rate-limit', (_projectId: string, rateLimitInfo: import('../../shared/types').SDKRateLimitInfo) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);
    }
  });

  // ============================================
  // Changelog Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_GET_DONE_TASKS,
    async (_, projectId: string, rendererTasks?: Task[]): Promise<IPCResult<ChangelogTask[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // Use renderer tasks if provided (they have the correct UI status),
      // otherwise fall back to reading from filesystem
      const tasks = rendererTasks || projectStore.getTasks(projectId);

      // Get specs directory path
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const doneTasks = changelogService.getCompletedTasks(project.path, tasks, specsBaseDir);

      return { success: true, data: doneTasks };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_LOAD_TASK_SPECS,
    async (_, projectId: string, taskIds: string[]): Promise<IPCResult<TaskSpecContent[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const tasks = projectStore.getTasks(projectId);

      // Get specs directory path
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const specs = await changelogService.loadTaskSpecs(project.path, taskIds, tasks, specsBaseDir);

      return { success: true, data: specs };
    }
  );

  ipcMain.on(
    IPC_CHANNELS.CHANGELOG_GENERATE,
    async (_, request: ChangelogGenerationRequest) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      const project = projectStore.getProject(request.projectId);
      if (!project) {
        mainWindow.webContents.send(
          IPC_CHANNELS.CHANGELOG_GENERATION_ERROR,
          request.projectId,
          'Project not found'
        );
        return;
      }

      // Load specs for selected tasks (only in tasks mode)
      let specs: TaskSpecContent[] = [];
      if (request.sourceMode === 'tasks' && request.taskIds && request.taskIds.length > 0) {
        const tasks = projectStore.getTasks(request.projectId);
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        specs = await changelogService.loadTaskSpecs(project.path, request.taskIds, tasks, specsBaseDir);
      }

      // Start generation
      changelogService.generateChangelog(request.projectId, project.path, request, specs);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_SAVE,
    async (_, request: ChangelogSaveRequest): Promise<IPCResult<ChangelogSaveResult>> => {
      const project = projectStore.getProject(request.projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const result = changelogService.saveChangelog(project.path, request);
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save changelog'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_READ_EXISTING,
    async (_, projectId: string): Promise<IPCResult<ExistingChangelog>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const result = changelogService.readExistingChangelog(project.path);
      return { success: true, data: result };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_SUGGEST_VERSION,
    async (_, projectId: string, taskIds: string[]): Promise<IPCResult<{ version: string; reason: string }>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        // Get current version from existing changelog
        const existing = changelogService.readExistingChangelog(project.path);
        const currentVersion = existing.lastVersion;

        // Load specs for selected tasks to analyze change types
        const tasks = projectStore.getTasks(projectId);
                const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const specs = await changelogService.loadTaskSpecs(project.path, taskIds, tasks, specsBaseDir);

        // Analyze specs and suggest version
        const suggestedVersion = changelogService.suggestVersion(specs, currentVersion);

        // Determine reason for the suggestion
        let reason = 'patch';
        if (currentVersion) {
          const [oldMajor, oldMinor] = currentVersion.split('.').map(Number);
          const [newMajor, newMinor] = suggestedVersion.split('.').map(Number);
          if (newMajor > oldMajor) {
            reason = 'breaking';
          } else if (newMinor > oldMinor) {
            reason = 'feature';
          }
        }

        return {
          success: true,
          data: { version: suggestedVersion, reason }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to suggest version'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_SUGGEST_VERSION_FROM_COMMITS,
    async (_, projectId: string, commits: GitCommit[]): Promise<IPCResult<{ version: string; reason: string }>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        // Get current version from existing changelog or git tags
        const existing = changelogService.readExistingChangelog(project.path);
        let currentVersion = existing.lastVersion;

        // If no version in changelog, try to get latest tag
        if (!currentVersion) {
          const tags = changelogService.getTags(project.path);
          if (tags.length > 0) {
            // Extract version from tag name (e.g., "v2.1.0" -> "2.1.0")
            currentVersion = tags[0].name.replace(/^v/, '');
          }
        }

        // Use AI to analyze commits and suggest version
        const result = await changelogService.suggestVersionFromCommits(
          project.path,
          commits,
          currentVersion
        );

        return {
          success: true,
          data: result
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to suggest version from commits'
        };
      }
    }
  );

  // ============================================
  // Changelog Git Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_GET_BRANCHES,
    async (_, projectId: string): Promise<IPCResult<GitBranchInfo[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const branches = changelogService.getBranches(project.path);
        return { success: true, data: branches };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get branches'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_GET_TAGS,
    async (_, projectId: string): Promise<IPCResult<GitTagInfo[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const tags = changelogService.getTags(project.path);
        return { success: true, data: tags };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get tags'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_GET_COMMITS_PREVIEW,
    async (
      _,
      projectId: string,
      options: GitHistoryOptions | BranchDiffOptions,
      mode: 'git-history' | 'branch-diff'
    ): Promise<IPCResult<GitCommit[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        let commits: GitCommit[];

        if (mode === 'git-history') {
          commits = changelogService.getCommits(
            project.path,
            options as GitHistoryOptions
          );
        } else {
          commits = changelogService.getBranchDiffCommits(
            project.path,
            options as BranchDiffOptions
          );
        }

        return { success: true, data: commits };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get commits preview'
        };
      }
    }
  );

  // ============================================
  // Changelog Image Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_SAVE_IMAGE,
    async (_, projectId: string, imageData: string, filename: string): Promise<IPCResult<{ relativePath: string; url: string }>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        // Create .github/assets directory if it doesn't exist
        const assetsDir = path.join(project.path, '.github', 'assets');
        if (!existsSync(assetsDir)) {
          mkdirSync(assetsDir, { recursive: true });
        }

        // Decode base64 image data
        const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
        const buffer = Buffer.from(base64Data, 'base64');

        // Save image file
        const imagePath = path.join(assetsDir, filename);
        writeFileSync(imagePath, buffer);

        // Return relative path for use in markdown
        const relativePath = `.github/assets/${filename}`;
        // For GitHub releases, we'll use the relative path which will work when the release is created
        const url = relativePath;

        return { success: true, data: { relativePath, url } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save image'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CHANGELOG_READ_LOCAL_IMAGE,
    async (_, projectPath: string, relativePath: string): Promise<IPCResult<string>> => {
      try {
        // Construct full path from project path and relative path
        const fullPath = path.join(projectPath, relativePath);

        // Verify the file exists
        if (!existsSync(fullPath)) {
          return { success: false, error: `Image not found: ${relativePath}` };
        }

        // Read the file and convert to base64
        const buffer = readFileSync(fullPath);
        const base64 = buffer.toString('base64');

        // Determine MIME type from extension
        const ext = path.extname(relativePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml'
        };
        const mimeType = mimeTypes[ext] || 'image/png';

        // Return as data URL
        const dataUrl = `data:${mimeType};base64,${base64}`;
        return { success: true, data: dataUrl };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to read image'
        };
      }
    }
  );

  // ============================================
  // Changelog Agent Events → Renderer
}
