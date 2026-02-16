import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetAppPath, mockGetPath, mockIsPackaged } = vi.hoisted(() => ({
  mockGetAppPath: vi.fn(),
  mockGetPath: vi.fn(),
  mockIsPackaged: { value: false },
}));

// Mock fs module before importing the module under test
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Mock electron's app module
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackaged.value;
    },
    getPath: mockGetPath,
    getAppPath: mockGetAppPath,
  },
}));

// Import after mocking
import { existsSync } from 'fs';
import { getBundledSourcePath } from '../updater/path-resolver';

// Normalize path separators to forward slashes for cross-platform assertions
const normalize = (p: string) => p.replace(/\\/g, '/');

describe('path-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPackaged.value = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getBundledSourcePath - worktree detection', () => {
    it('should detect worktree backend from Unix path', () => {
      mockGetAppPath.mockReturnValue(
        '/home/user/project/.auto-claude/worktrees/tasks/my-feature/apps/frontend'
      );
      vi.mocked(existsSync).mockImplementation((p) => {
        const normalized = String(p).replace(/\\/g, '/');
        if (normalized.includes('runners/spec_runner.py')) return true;
        return false;
      });

      const result = normalize(getBundledSourcePath());
      expect(result).toContain('.auto-claude/worktrees/tasks/my-feature');
      expect(result).toContain('apps/backend');
    });

    it('should detect worktree backend from Windows-style path', () => {
      mockGetAppPath.mockReturnValue(
        'C:\\Users\\dev\\project\\.auto-claude\\worktrees\\tasks\\my-feature\\apps\\frontend'
      );
      vi.mocked(existsSync).mockImplementation((p) => {
        const normalized = String(p).replace(/\\/g, '/');
        if (normalized.includes('runners/spec_runner.py')) return true;
        return false;
      });

      const result = normalize(getBundledSourcePath());
      expect(result).toContain('.auto-claude/worktrees/tasks/my-feature');
      expect(result).toContain('apps/backend');
    });

    it('should NOT match paths without the exact .auto-claude directory', () => {
      // "xauto-claude" should not match due to escaped dot in regex
      const consoleSpy = vi.spyOn(console, 'log');
      mockGetAppPath.mockReturnValue(
        '/home/user/project/xauto-claude/worktrees/tasks/my-feature/apps/frontend'
      );
      vi.mocked(existsSync).mockReturnValue(false);

      getBundledSourcePath();
      // Worktree detection log should NOT have fired
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[path-resolver] Using worktree backend:'),
        expect.anything()
      );
    });

    it('should fall through when worktree marker file does not exist', () => {
      mockGetAppPath.mockReturnValue(
        '/home/user/project/.auto-claude/worktrees/tasks/my-feature/apps/frontend'
      );
      // Marker file does not exist
      vi.mocked(existsSync).mockReturnValue(false);

      const result = getBundledSourcePath();
      // Should fall through to fallback path
      expect(result).toContain('backend');
    });

    it('should use joinPaths for packaged resource path', () => {
      mockIsPackaged.value = true;
      Object.defineProperty(process, 'resourcesPath', {
        value: '/app/resources',
        writable: true,
        configurable: true,
      });

      const result = normalize(getBundledSourcePath());
      expect(result).toContain('resources');
      expect(result).toContain('backend');
    });
  });
});
