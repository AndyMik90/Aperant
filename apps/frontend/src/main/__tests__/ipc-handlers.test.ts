/**
 * Unit tests for IPC handlers
 * Tests all IPC communication patterns between main and renderer processes
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Test data directory
const TEST_DIR = mkdtempSync(path.join(tmpdir(), "ipc-handlers-test-"));
const TEST_PROJECT_PATH = path.join(TEST_DIR, "test-project");

// Mock electron-updater before importing
vi.mock("electron-updater", () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn(),
  },
}));

// Mock @electron-toolkit/utils before importing
vi.mock("@electron-toolkit/utils", () => ({
  is: {
    dev: true,
    windows: process.platform === "win32",
    macos: process.platform === "darwin",
    linux: process.platform === "linux",
  },
  electronApp: {
    setAppUserModelId: vi.fn(),
  },
  optimizer: {
    watchWindowShortcuts: vi.fn(),
  },
}));

// Mock version-manager to return a predictable version
vi.mock("../updater/version-manager", () => ({
  getEffectiveVersion: vi.fn(() => "0.1.0"),
  getBundledVersion: vi.fn(() => "0.1.0"),
  parseVersionFromTag: vi.fn((tag: string) => tag.replace("v", "")),
  compareVersions: vi.fn(() => 0),
}));

vi.mock("../notification-service", () => ({
  notificationService: {
    initialize: vi.fn(),
    notifyReviewNeeded: vi.fn(),
    notifyTaskFailed: vi.fn(),
  },
}));

// Mock electron-log to prevent Electron binary dependency
vi.mock("electron-log/main.js", () => ({
  default: {
    initialize: vi.fn(),
    transports: {
      file: {
        maxSize: 10 * 1024 * 1024,
        format: "",
        fileName: "main.log",
        level: "info",
        getFile: vi.fn(() => ({ path: "/tmp/test.log" })),
      },
      console: {
        level: "warn",
        format: "",
      },
    },
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock cli-tool-manager to avoid blocking tool detection on Windows
vi.mock("../cli-tool-manager", () => ({
  getToolInfo: vi.fn(() => ({ found: false, path: null, source: "mock" })),
  getToolPath: vi.fn((tool: string) => tool),
  deriveGitBashPath: vi.fn(() => null),
  clearCache: vi.fn(),
  clearToolCache: vi.fn(),
  configureTools: vi.fn(),
  preWarmToolCache: vi.fn(() => Promise.resolve()),
  getToolPathAsync: vi.fn((tool: string) => Promise.resolve(tool)),
}));

// Mock modules before importing
vi.mock("electron", () => {
  const mockIpcMain = new (class extends EventEmitter {
    private handlers: Map<string, Function> = new Map();

    handle(channel: string, handler: Function): void {
      this.handlers.set(channel, handler);
    }

    removeHandler(channel: string): void {
      this.handlers.delete(channel);
    }

    async invokeHandler(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
      const handler = this.handlers.get(channel);
      if (handler) {
        return handler(event, ...args);
      }
      throw new Error(`No handler for channel: ${channel}`);
    }

    getHandler(channel: string): Function | undefined {
      return this.handlers.get(channel);
    }
  })();

  return {
    app: {
      getPath: vi.fn((name: string) => {
        if (name === "userData") return path.join(TEST_DIR, "userData");
        return TEST_DIR;
      }),
      getAppPath: vi.fn(() => TEST_DIR),
      getVersion: vi.fn(() => "0.1.0"),
      isPackaged: false,
    },
    ipcMain: mockIpcMain,
    dialog: {
      showOpenDialog: vi.fn(() =>
        Promise.resolve({ canceled: false, filePaths: [TEST_PROJECT_PATH] })
      ),
    },
    BrowserWindow: class {
      webContents = { send: vi.fn() };
    },
  };
});

// Setup test project structure
function setupTestProject(): void {
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });
  mkdirSync(path.join(TEST_PROJECT_PATH, "auto-claude", "specs"), { recursive: true });
}

// Cleanup test directories
function cleanupTestDirs(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// Increase timeout for all tests in this file due to dynamic imports and setup overhead.
// Windows requires longer timeout due to slower file system operations and module loading.
describe("IPC Handlers", { timeout: 30000 }, () => {
  let ipcMain: EventEmitter & {
    handlers: Map<string, Function>;
    invokeHandler: (channel: string, event: unknown, ...args: unknown[]) => Promise<unknown>;
    getHandler: (channel: string) => Function | undefined;
  };
  let mockMainWindow: { webContents: { send: ReturnType<typeof vi.fn> } };
  let mockAgentManager: EventEmitter & {
    startSpecCreation: ReturnType<typeof vi.fn>;
    startTaskExecution: ReturnType<typeof vi.fn>;
    startQAProcess: ReturnType<typeof vi.fn>;
    killTask: ReturnType<typeof vi.fn>;
    configure: ReturnType<typeof vi.fn>;
  };
  let mockTerminalManager: {
    create: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    invokeClaude: ReturnType<typeof vi.fn>;
    killAll: ReturnType<typeof vi.fn>;
  };
  let mockPythonEnvManager: {
    on: ReturnType<typeof vi.fn>;
    initialize: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    cleanupTestDirs();
    setupTestProject();
    mkdirSync(path.join(TEST_DIR, "userData", "store"), { recursive: true });

    // Get mocked ipcMain
    const electron = await import("electron");
    ipcMain = electron.ipcMain as unknown as typeof ipcMain;

    // Create mock window with isDestroyed methods for safeSendToRenderer
    mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: vi.fn(),
        isDestroyed: vi.fn(() => false),
      },
    } as { webContents: { send: ReturnType<typeof vi.fn> }; isDestroyed: () => boolean };

    // Create mock agent manager
    mockAgentManager = Object.assign(new EventEmitter(), {
      startSpecCreation: vi.fn(),
      startTaskExecution: vi.fn(),
      startQAProcess: vi.fn(),
      killTask: vi.fn(),
      configure: vi.fn(),
    });

    // Create mock terminal manager
    mockTerminalManager = {
      create: vi.fn(() => Promise.resolve({ success: true })),
      destroy: vi.fn(() => Promise.resolve({ success: true })),
      write: vi.fn(),
      resize: vi.fn(),
      invokeClaude: vi.fn(),
      killAll: vi.fn(() => Promise.resolve()),
    };

    mockPythonEnvManager = {
      on: vi.fn(),
      initialize: vi.fn(() =>
        Promise.resolve({
          ready: true,
          pythonPath: "/usr/bin/python3",
          venvExists: true,
          depsInstalled: true,
        })
      ),
      getStatus: vi.fn(() =>
        Promise.resolve({
          ready: true,
          pythonPath: "/usr/bin/python3",
          venvExists: true,
          depsInstalled: true,
        })
      ),
    };

    // Need to reset modules to re-register handlers
    vi.resetModules();
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
  });

  describe("project:add handler", () => {
    it("should return error for non-existent path", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      const result = await ipcMain.invokeHandler("project:add", {}, "/nonexistent/path");

      expect(result).toEqual({
        success: false,
        error: "Directory does not exist",
      });
    });

    it("should successfully add an existing project", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      const result = await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("data");
      const data = (result as { data: { path: string; name: string } }).data;
      expect(data.path).toBe(TEST_PROJECT_PATH);
      expect(data.name).toBe("test-project");
    });

    it("should return existing project if already added", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      // Add project twice
      const result1 = await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);
      const result2 = await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);

      const data1 = (result1 as { data: { id: string } }).data;
      const data2 = (result2 as { data: { id: string } }).data;
      expect(data1.id).toBe(data2.id);
    });
  });

  describe("project:list handler", () => {
    it("should return empty array when no projects", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      const result = await ipcMain.invokeHandler("project:list", {});

      expect(result).toEqual({
        success: true,
        data: [],
      });
    });

    it("should return all added projects", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      // Add a project
      await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);

      const result = await ipcMain.invokeHandler("project:list", {});

      expect(result).toHaveProperty("success", true);
      const data = (result as { data: unknown[] }).data;
      expect(data).toHaveLength(1);
    });
  });

  describe("project:remove handler", () => {
    it("should return false for non-existent project", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      const result = await ipcMain.invokeHandler("project:remove", {}, "nonexistent-id");

      expect(result).toEqual({ success: false });
    });

    it("should successfully remove an existing project", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      // Add a project first
      const addResult = await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      // Remove it
      const removeResult = await ipcMain.invokeHandler("project:remove", {}, projectId);

      expect(removeResult).toEqual({ success: true });

      // Verify it's gone
      const listResult = await ipcMain.invokeHandler("project:list", {});
      const data = (listResult as { data: unknown[] }).data;
      expect(data).toHaveLength(0);
    });
  });

  describe("project:updateSettings handler", () => {
    it("should return error for non-existent project", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      const result = await ipcMain.invokeHandler("project:updateSettings", {}, "nonexistent-id", {
        model: "sonnet",
      });

      expect(result).toEqual({
        success: false,
        error: "Project not found",
      });
    });

    it("should successfully update project settings", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      // Add a project first
      const addResult = await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      // Update settings
      const result = await ipcMain.invokeHandler("project:updateSettings", {}, projectId, {
        model: "sonnet",
        linearSync: true,
      });

      expect(result).toEqual({ success: true });
    });
  });

  describe("task:list handler", () => {
    it("should return empty array for project with no specs", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      // Add a project first
      const addResult = await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      const result = await ipcMain.invokeHandler("task:list", {}, projectId);

      expect(result).toEqual({
        success: true,
        data: [],
      });
    });

    it("should return tasks when specs exist", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      // Create .auto-claude directory first (before adding project so it gets detected)
      mkdirSync(path.join(TEST_PROJECT_PATH, ".auto-claude", "specs"), { recursive: true });

      // Add a project - it will detect .auto-claude
      const addResult = await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      // Create a spec directory with implementation plan in .auto-claude/specs
      const specDir = path.join(TEST_PROJECT_PATH, ".auto-claude", "specs", "001-test-feature");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        path.join(specDir, "implementation_plan.json"),
        JSON.stringify({
          feature: "Test Feature",
          workflow_type: "feature",
          services_involved: [],
          phases: [
            {
              phase: 1,
              name: "Test Phase",
              type: "implementation",
              subtasks: [{ id: "subtask-1", description: "Test subtask", status: "pending" }],
            },
          ],
          final_acceptance: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          spec_file: "",
        })
      );

      const result = await ipcMain.invokeHandler("task:list", {}, projectId);

      expect(result).toHaveProperty("success", true);
      const data = (result as { data: unknown[] }).data;
      expect(data).toHaveLength(1);
    });
  });

  describe("task:create handler", () => {
    it("should return error for non-existent project", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      const result = await ipcMain.invokeHandler(
        "task:create",
        {},
        "nonexistent-id",
        "Test Task",
        "Test description"
      );

      expect(result).toEqual({
        success: false,
        error: "Project not found",
      });
    });

    it("should create task in backlog status", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      // Create .auto-claude directory first (before adding project so it gets detected)
      mkdirSync(path.join(TEST_PROJECT_PATH, ".auto-claude", "specs"), { recursive: true });

      // Add a project first
      const addResult = await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      const result = await ipcMain.invokeHandler(
        "task:create",
        {},
        projectId,
        "Test Task",
        "Test description"
      );

      expect(result).toHaveProperty("success", true);
      // Task is created in backlog status, spec creation starts when task:start is called
      const task = (result as { data: { status: string } }).data;
      expect(task.status).toBe("backlog");
    });
  });

  describe("settings:get handler", () => {
    it("should return default settings when no settings file exists", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      const result = await ipcMain.invokeHandler("settings:get", {});

      expect(result).toHaveProperty("success", true);
      const data = (result as { data: { theme: string } }).data;
      expect(data).toHaveProperty("theme", "dark");
    });
  });

  describe("settings:save handler", () => {
    it("should save settings successfully", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      const result = await ipcMain.invokeHandler(
        "settings:save",
        {},
        { theme: "dark", defaultModel: "opus" }
      );

      expect(result).toEqual({ success: true });

      // Verify settings were saved
      const getResult = await ipcMain.invokeHandler("settings:get", {});
      const data = (getResult as { data: { theme: string; defaultModel: string } }).data;
      expect(data.theme).toBe("dark");
      expect(data.defaultModel).toBe("opus");
    });

    it("should configure agent manager when paths change", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      await ipcMain.invokeHandler("settings:save", {}, { pythonPath: "/usr/bin/python3" });

      expect(mockAgentManager.configure).toHaveBeenCalledWith("/usr/bin/python3", undefined);
    });
  });

  describe("app:version handler", () => {
    it("should return app version", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      const result = await ipcMain.invokeHandler("app:version", {});

      expect(result).toBe("0.1.0");
    });
  });

  describe("Agent Manager event forwarding", () => {
    it("should forward log events to renderer", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      mockAgentManager.emit("log", "task-1", "Test log message");

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        "task:log",
        "task-1",
        "Test log message",
        undefined // projectId is undefined when task not found
      );
    });

    it("should forward error events to renderer", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      mockAgentManager.emit("error", "task-1", "Test error message");

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        "task:error",
        "task-1",
        "Test error message",
        undefined // projectId is undefined when task not found
      );
    });

    it("should forward exit events with status change on failure", async () => {
      const { setupIpcHandlers } = await import("../ipc-handlers");
      setupIpcHandlers(
        mockAgentManager as never,
        mockTerminalManager as never,
        () => mockMainWindow as never,
        mockPythonEnvManager as never
      );

      // Add project first
      await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);

      // Create a spec/task directory with implementation_plan.json
      const specDir = path.join(TEST_PROJECT_PATH, ".auto-claude", "specs", "task-1");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        path.join(specDir, "implementation_plan.json"),
        JSON.stringify({ feature: "Test Task", status: "in_progress" })
      );

      mockAgentManager.emit("exit", "task-1", 1, "task-execution");

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        "task:statusChange",
        "task-1",
        "human_review",
        expect.any(String), // projectId for multi-project filtering
        "errors"
      );
    });
  });
});
