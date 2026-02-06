import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// Mock fs module before importing the module under test
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// Mock electron's app module
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn().mockReturnValue('/mock/user/data'),
    getAppPath: vi.fn().mockReturnValue('/mock/app'),
    on: vi.fn(),
  },
}));

// Mock python-detector
vi.mock('../python-detector', () => ({
  findPythonCommand: vi.fn().mockReturnValue('python'),
  getBundledPythonPath: vi.fn().mockReturnValue(null),
}));

// Import after mocking
import { PythonEnvManager } from '../python-env-manager';

describe('PythonEnvManager', () => {
  let manager: PythonEnvManager;

  beforeEach(() => {
    manager = new PythonEnvManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPythonEnv', () => {
    it('should return basic Python environment variables', () => {
      const env = manager.getPythonEnv();

      expect(env.PYTHONDONTWRITEBYTECODE).toBe('1');
      expect(env.PYTHONIOENCODING).toBe('utf-8');
      expect(env.PYTHONNOUSERSITE).toBe('1');
    });

    it('should exclude PYTHONHOME from environment', () => {
      // Use vi.stubEnv for cleaner environment variable mocking
      vi.stubEnv('PYTHONHOME', '/some/python/home');

      const env = manager.getPythonEnv();
      expect(env.PYTHONHOME).toBeUndefined();

      vi.unstubAllEnvs();
    });

    it('should preserve external PYTHONSTARTUP values', () => {
      // We no longer strip PYTHONSTARTUP - it passes through from the environment.
      // Note: PYTHONSTARTUP only runs in interactive Python mode (python REPL),
      // not when running scripts, so it doesn't affect our Python invocations.
      vi.stubEnv('PYTHONSTARTUP', '/some/external/startup.py');

      try {
        const env = manager.getPythonEnv();
        // External PYTHONSTARTUP should pass through unchanged
        expect(env.PYTHONSTARTUP).toBe('/some/external/startup.py');
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('Windows pywin32 DLL loading fix', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should add pywin32_system32 to PATH on Windows when sitePackagesPath is set', () => {
      const sitePackagesPath = 'C:\\test\\site-packages';

      // Access private property for testing
      (manager as unknown as { sitePackagesPath: string }).sitePackagesPath = sitePackagesPath;

      const env = manager.getPythonEnv();

      // Should include pywin32_system32 in PATH
      const expectedPath = path.join(sitePackagesPath, 'pywin32_system32');
      expect(env.PATH).toContain(expectedPath);
    });

    it('should include win32 and win32/lib in PYTHONPATH on Windows', () => {
      const sitePackagesPath = 'C:\\test\\site-packages';

      // Access private property for testing
      (manager as unknown as { sitePackagesPath: string }).sitePackagesPath = sitePackagesPath;

      const env = manager.getPythonEnv();

      // PYTHONPATH should include site-packages, win32, and win32/lib
      expect(env.PYTHONPATH).toContain(sitePackagesPath);
      expect(env.PYTHONPATH).toContain(path.join(sitePackagesPath, 'win32'));
      expect(env.PYTHONPATH).toContain(
        path.join(sitePackagesPath, 'win32', 'lib')
      );
    });

    it('should not add Windows-specific PATH modification on non-Windows platforms', () => {
      // Restore non-Windows platform
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const sitePackagesPath = '/test/site-packages';

      // Access private property for testing
      (manager as unknown as { sitePackagesPath: string }).sitePackagesPath = sitePackagesPath;

      const env = manager.getPythonEnv();

      // PYTHONPATH should just be the site-packages (no win32 additions)
      expect(env.PYTHONPATH).toBe(sitePackagesPath);

      // PATH should not contain pywin32_system32
      expect(env.PATH || '').not.toContain('pywin32_system32');
    });

    it('should normalize PATH case sensitivity on Windows', () => {
      // On Windows, env vars are case-insensitive but Node.js preserves case.
      // If the environment has 'Path' (lowercase t), we should normalize to 'PATH'
      // to avoid issues with Node.js lexicographic sorting.
      // See: https://github.com/nodejs/node/issues/9157
      const sitePackagesPath = 'C:\\test\\site-packages';

      // Access private property for testing
      (manager as unknown as { sitePackagesPath: string }).sitePackagesPath = sitePackagesPath;

      // Save and clear existing PATH, then set lowercase 'Path'
      // This simulates a Windows environment where the system has 'Path' instead of 'PATH'
      const originalPath = process.env.PATH;
      delete process.env.PATH;
      process.env.Path = 'C:\\Windows\\System32';

      try {
        const env = manager.getPythonEnv();

        // Should have a PATH key (uppercase) containing both pywin32_system32 and original Path value
        expect(env.PATH).toBeDefined();
        expect(env.PATH).toContain('pywin32_system32');
        expect(env.PATH).toContain('C:\\Windows\\System32');

        // Should NOT have both 'PATH' and 'Path' keys (case normalization)
        // The lowercase 'Path' should be removed to avoid Node.js case-sensitivity issues
        const pathKeys = Object.keys(env).filter(k => k.toUpperCase() === 'PATH');
        expect(pathKeys.length).toBe(1);
        expect(pathKeys[0]).toBe('PATH');
      } finally {
        // Restore original PATH
        delete process.env.Path;
        if (originalPath !== undefined) {
          process.env.PATH = originalPath;
        }
      }
    });
  });
});
