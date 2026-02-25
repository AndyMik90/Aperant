/**
 * IPC Utils Tests
 * ==================
 * Tests for safeSendToRenderer helper function that prevents
 * "Render frame was disposed" errors when sending IPC messages
 * from main process to renderer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { BrowserWindow } from "electron";

describe("safeSendToRenderer", () => {
  let mockWindow: BrowserWindow | null;
  let getMainWindow: () => BrowserWindow | null;
  let mockSend: ReturnType<typeof vi.fn>;
  let safeSendToRenderer: typeof import("../ipc-handlers/utils").safeSendToRenderer;

  beforeEach(async () => {
    mockSend = vi.fn();

    // Clear module-level state before each test to ensure clean state
    // This is especially important for the warnTimestamps Map which is shared across tests
    const { _clearWarnTimestampsForTest } = await import("../ipc-handlers/utils");
    _clearWarnTimestampsForTest();

    // Create a mock window with valid webContents
    mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: mockSend,
      },
    } as unknown as BrowserWindow;

    getMainWindow = () => mockWindow;

    // Dynamic import to get fresh module state for each test
    const utilsModule = await import("../ipc-handlers/utils");
    safeSendToRenderer = utilsModule.safeSendToRenderer;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when mainWindow is null", () => {
    it("returns false and does not send", () => {
      getMainWindow = () => null;

      const result = safeSendToRenderer(getMainWindow, "test-channel", "arg1", "arg2");

      expect(result).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("when window is destroyed", () => {
    it("returns false and does not send", () => {
      mockWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: {
          isDestroyed: vi.fn(() => false),
          send: mockSend,
        },
      } as unknown as BrowserWindow;
      getMainWindow = () => mockWindow;

      const result = safeSendToRenderer(getMainWindow, "test-channel", "data");

      expect(result).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("when webContents is destroyed", () => {
    it("returns false and does not send", () => {
      mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: {
          isDestroyed: vi.fn(() => true),
          send: mockSend,
        },
      } as unknown as BrowserWindow;
      getMainWindow = () => mockWindow;

      const result = safeSendToRenderer(getMainWindow, "test-channel", "data");

      expect(result).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("when webContents is null", () => {
    it("returns false and does not send", () => {
      mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: null,
      } as unknown as BrowserWindow;
      getMainWindow = () => mockWindow;

      const result = safeSendToRenderer(getMainWindow, "test-channel", "data");

      expect(result).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("when window and webContents are valid", () => {
    it("returns true and sends message with correct arguments", () => {
      const result = safeSendToRenderer(
        getMainWindow,
        "test-channel",
        "arg1",
        { key: "value" },
        42
      );

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith("test-channel", "arg1", { key: "value" }, 42);
    });

    it("sends message with no arguments", () => {
      const result = safeSendToRenderer(getMainWindow, "test-channel");

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith("test-channel");
    });

    it("sends multiple messages successfully", () => {
      const result1 = safeSendToRenderer(getMainWindow, "channel-1", "data1");
      const result2 = safeSendToRenderer(getMainWindow, "channel-2", "data2");

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenNthCalledWith(1, "channel-1", "data1");
      expect(mockSend).toHaveBeenNthCalledWith(2, "channel-2", "data2");
    });
  });

  describe("error handling - disposal errors", () => {
    it("catches disposal errors and returns false", () => {
      // Mock send to throw a disposal error
      mockSend.mockImplementation(() => {
        throw new Error("Render frame was disposed before WebFrameMain could be accessed");
      });

      const result = safeSendToRenderer(getMainWindow, "test-channel", "data");

      expect(result).toBe(false);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('catches generic "disposed" errors and returns false', () => {
      mockSend.mockImplementation(() => {
        throw new Error("Object has been destroyed");
      });

      const result = safeSendToRenderer(getMainWindow, "test-channel", "data");

      expect(result).toBe(false);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('catches "destroyed" errors and returns false', () => {
      mockSend.mockImplementation(() => {
        throw new Error("WebContents was destroyed");
      });

      const result = safeSendToRenderer(getMainWindow, "test-channel", "data");

      expect(result).toBe(false);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling - non-disposal errors", () => {
    it("catches other errors and returns false", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {
        /* intentionally empty - suppress console output during tests */
      });

      mockSend.mockImplementation(() => {
        throw new Error("Some other IPC error");
      });

      const result = safeSendToRenderer(getMainWindow, "test-channel", "data");

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("warning cooldown behavior", () => {
    it("returns false for multiple consecutive calls to destroyed windows", () => {
      mockWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: {
          isDestroyed: vi.fn(() => false),
          send: mockSend,
        },
      } as unknown as BrowserWindow;
      getMainWindow = () => mockWindow;

      // Multiple calls should all return false without throwing
      const result1 = safeSendToRenderer(getMainWindow, "test-channel", "data1");
      const result2 = safeSendToRenderer(getMainWindow, "test-channel", "data2");
      const result3 = safeSendToRenderer(getMainWindow, "test-channel", "data3");

      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("logs console.warn only once for multiple consecutive calls to same channel", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
        /* intentionally empty - suppress console output during tests */
      });

      mockWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: {
          isDestroyed: vi.fn(() => false),
          send: mockSend,
        },
      } as unknown as BrowserWindow;
      getMainWindow = () => mockWindow;

      // Multiple calls to same channel - should warn only once
      safeSendToRenderer(getMainWindow, "test-channel", "data1");
      safeSendToRenderer(getMainWindow, "test-channel", "data2");
      safeSendToRenderer(getMainWindow, "test-channel", "data3");

      // console.warn should be called exactly once
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Skipping send to destroyed window: test-channel")
      );

      consoleWarnSpy.mockRestore();
    });

    it("logs console.warn separately for different channels", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
        /* intentionally empty - suppress console output during tests */
      });

      mockWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: {
          isDestroyed: vi.fn(() => false),
          send: mockSend,
        },
      } as unknown as BrowserWindow;
      getMainWindow = () => mockWindow;

      // Different channels - each should warn once
      safeSendToRenderer(getMainWindow, "channel-a", "data");
      safeSendToRenderer(getMainWindow, "channel-b", "data");
      safeSendToRenderer(getMainWindow, "channel-c", "data");

      // console.warn should be called once per channel (3 times total)
      expect(consoleWarnSpy).toHaveBeenCalledTimes(3);

      consoleWarnSpy.mockRestore();
    });

    it("handles different channels independently", () => {
      mockWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: {
          isDestroyed: vi.fn(() => false),
          send: mockSend,
        },
      } as unknown as BrowserWindow;
      getMainWindow = () => mockWindow;

      // Different channels should all return false
      const result1 = safeSendToRenderer(getMainWindow, "channel-a", "data");
      const result2 = safeSendToRenderer(getMainWindow, "channel-b", "data");
      const result3 = safeSendToRenderer(getMainWindow, "channel-c", "data");

      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });
  });

  describe("race condition - frame disposal between check and send", () => {
    it("handles disposal that occurs after validation but before send", () => {
      // First call succeeds
      let callCount = 0;
      mockSend.mockImplementation(() => {
        callCount++;
        if (callCount > 1) {
          throw new Error("Render frame was disposed");
        }
      });

      const result1 = safeSendToRenderer(getMainWindow, "test-channel", "data1");
      expect(result1).toBe(true);

      // Second call throws disposal error but is caught
      const result2 = safeSendToRenderer(getMainWindow, "test-channel", "data2");
      expect(result2).toBe(false);
    });
  });

  describe("warning pruning logic - 100-entry hard cap", () => {
    it("enforces 100-entry cap by removing oldest entries when exceeded", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
        /* intentionally empty - suppress console output during tests */
      });

      mockWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: {
          isDestroyed: vi.fn(() => false),
          send: mockSend,
        },
      } as unknown as BrowserWindow;
      getMainWindow = () => mockWindow;

      // Add 105 unique channels - this triggers pruning
      for (let i = 0; i < 105; i++) {
        safeSendToRenderer(getMainWindow, `channel-${i}`, `data-${i}`);
      }

      // Should have warned for all 105 unique channels
      expect(consoleWarnSpy).toHaveBeenCalledTimes(105);

      // Verify that calling the same channel multiple times within cooldown period
      // only warns once (test the cooldown mechanism)
      consoleWarnSpy.mockClear();
      safeSendToRenderer(getMainWindow, "channel-0", "data-again");
      safeSendToRenderer(getMainWindow, "channel-0", "data-again");
      safeSendToRenderer(getMainWindow, "channel-0", "data-again");

      // Should only warn once due to cooldown
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

      consoleWarnSpy.mockRestore();
    });

    it("handles many unique channels without throwing errors", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
        /* intentionally empty - suppress console output during tests */
      });

      mockWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: {
          isDestroyed: vi.fn(() => false),
          send: mockSend,
        },
      } as unknown as BrowserWindow;
      getMainWindow = () => mockWindow;

      // Add 200 unique channels - should trigger pruning multiple times
      // This tests that the pruning logic doesn't throw errors
      expect(() => {
        for (let i = 0; i < 200; i++) {
          safeSendToRenderer(getMainWindow, `channel-${i}`, `data-${i}`);
        }
      }).not.toThrow();

      // Should have warned for all 200 unique channels
      expect(consoleWarnSpy).toHaveBeenCalledTimes(200);

      consoleWarnSpy.mockRestore();
    });
  });

  describe("parseEnvFile", () => {
    it("parses Unix line endings (LF)", async () => {
      const { parseEnvFile } = await import("../ipc-handlers/utils");
      const content = "KEY1=value1\nKEY2=value2\nKEY3=value3";
      const result = parseEnvFile(content);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
        KEY3: "value3",
      });
    });

    it("parses Windows line endings (CRLF)", async () => {
      const { parseEnvFile } = await import("../ipc-handlers/utils");
      const content = "KEY1=value1\r\nKEY2=value2\r\nKEY3=value3";
      const result = parseEnvFile(content);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
        KEY3: "value3",
      });
    });

    it("parses mixed line endings", async () => {
      const { parseEnvFile } = await import("../ipc-handlers/utils");
      const content = "KEY1=value1\nKEY2=value2\r\nKEY3=value3\nKEY4=value4";
      const result = parseEnvFile(content);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
        KEY3: "value3",
        KEY4: "value4",
      });
    });

    it("handles empty lines", async () => {
      const { parseEnvFile } = await import("../ipc-handlers/utils");
      const content = "KEY1=value1\n\nKEY2=value2\r\n\r\nKEY3=value3";
      const result = parseEnvFile(content);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
        KEY3: "value3",
      });
    });

    it("handles comments", async () => {
      const { parseEnvFile } = await import("../ipc-handlers/utils");
      const content = "# This is a comment\nKEY1=value1\n# Another comment\nKEY2=value2";
      const result = parseEnvFile(content);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
      });
    });

    it("handles quoted values", async () => {
      const { parseEnvFile } = await import("../ipc-handlers/utils");
      const content = "KEY1=\"value with spaces\"\nKEY2='single quotes'\nKEY3=unquoted";
      const result = parseEnvFile(content);

      expect(result).toEqual({
        KEY1: "value with spaces",
        KEY2: "single quotes",
        KEY3: "unquoted",
      });
    });

    it("handles values with equals signs", async () => {
      const { parseEnvFile } = await import("../ipc-handlers/utils");
      const content = "KEY1=value=with=equals\nKEY2=simple";
      const result = parseEnvFile(content);

      expect(result).toEqual({
        KEY1: "value=with=equals",
        KEY2: "simple",
      });
    });

    it("handles empty input", async () => {
      const { parseEnvFile } = await import("../ipc-handlers/utils");
      const result = parseEnvFile("");

      expect(result).toEqual({});
    });

    it("handles only comments and empty lines", async () => {
      const { parseEnvFile } = await import("../ipc-handlers/utils");
      const content = "# Comment 1\n# Comment 2\n\n\n";
      const result = parseEnvFile(content);

      expect(result).toEqual({});
    });

    it("trims whitespace from keys and values", async () => {
      const { parseEnvFile } = await import("../ipc-handlers/utils");
      const content = "  KEY1  =  value1  \nKEY2=value2";
      const result = parseEnvFile(content);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
      });
    });
  });
});
