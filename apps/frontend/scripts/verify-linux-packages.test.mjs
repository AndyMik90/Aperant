/**
 * Tests for verify-linux-packages.cjs
 *
 * These tests cover the core logic by calling the actual exported functions.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);

// Get child_process and save original spawnSync
const childProcess = require('child_process');
const originalSpawnSync = childProcess.spawnSync;

// Helper to reload the verification module with a mocked spawnSync
function loadWithMockedSpawnSync(mockFn) {
  // Set the mock before requiring
  childProcess.spawnSync = mockFn;
  // Clear the module cache
  delete require.cache[require.resolve('./verify-linux-packages.cjs')];
  // Re-require the module
  return require('./verify-linux-packages.cjs');
}

function restoreSpawnSync() {
  childProcess.spawnSync = originalSpawnSync;
  delete require.cache[require.resolve('./verify-linux-packages.cjs')];
}

// Load the module normally for tests that don't need spawnSync mocking
const {
  CRITICAL_PACKAGES,
  findPackages,
  verifyFileList,
  verifyFlatpak,
} = require('./verify-linux-packages.cjs');

describe('verify-linux-packages', () => {
  describe('package finding logic', () => {
    it('should identify all three Linux package types', () => {
      // Test that findPackages correctly identifies .AppImage, .deb, and .flatpak files
      const mockFiles = [
        'Auto-Claude-2.7.5-linux-x86_64.AppImage',
        'auto-claude_2.7.5_amd64.deb',
        'com.autoclaude.ui_2.7.5_linux_x86_64.flatpak',
        'latest-mac.yml',
        'latest.yml',
      ];

      const distDir = '/test/dist';

      // Mock fs.existsSync to return true (directory exists)
      const existsSync = mock.method(fs, 'existsSync', mock.fn(() => true));
      // Mock fs.readdirSync to return our test files
      const readdirSync = mock.method(fs, 'readdirSync', mock.fn(() => mockFiles));

      try {
        const result = findPackages(distDir);

        // Verify the expected results
        assert.equal(result.appImage, '/test/dist/Auto-Claude-2.7.5-linux-x86_64.AppImage');
        assert.equal(result.deb, '/test/dist/auto-claude_2.7.5_amd64.deb');
        assert.equal(result.flatpak, '/test/dist/com.autoclaude.ui_2.7.5_linux_x86_64.flatpak');
      } finally {
        existsSync.mock.restore();
        readdirSync.mock.restore();
      }
    });

    it('should handle missing packages gracefully', () => {
      // Test behavior when packages are missing
      const mockFiles = ['latest-mac.yml', 'latest.yml'];
      const distDir = '/test/dist';

      const existsSync = mock.method(fs, 'existsSync', mock.fn(() => true));
      const readdirSync = mock.method(fs, 'readdirSync', mock.fn(() => mockFiles));

      try {
        const result = findPackages(distDir);

        assert.equal(result.appImage, null);
        assert.equal(result.deb, null);
        assert.equal(result.flatpak, null);
      } finally {
        existsSync.mock.restore();
        readdirSync.mock.restore();
      }
    });

    it('should handle missing dist directory', () => {
      // Test behavior when dist directory doesn't exist
      const distDir = '/test/dist';

      const existsSync = mock.method(fs, 'existsSync', mock.fn(() => false));

      try {
        const result = findPackages(distDir);

        // Should return empty packages object without error
        assert.equal(result.appImage, null);
        assert.equal(result.deb, null);
        assert.equal(result.flatpak, null);
      } finally {
        existsSync.mock.restore();
      }
    });

    it('should warn about duplicate packages', () => {
      // Test behavior when multiple packages of same type exist
      const mockFiles = [
        'Auto-Claude-2.7.5-linux-x86_64.AppImage',
        'Auto-Claude-2.7.5-linux-x86_64.AppImage', // Duplicate
        'auto-claude_2.7.5_amd64.deb',
        'auto-claude_2.7.5_amd64.deb', // Duplicate
        'com.autoclaude.ui_2.7.5_linux_x86_64.flatpak',
      ];
      const distDir = '/test/dist';

      const existsSync = mock.method(fs, 'existsSync', mock.fn(() => true));
      const readdirSync = mock.method(fs, 'readdirSync', mock.fn(() => mockFiles));

      try {
        const result = findPackages(distDir);

        // Should still find packages, using first occurrence
        assert.equal(result.appImage, '/test/dist/Auto-Claude-2.7.5-linux-x86_64.AppImage');
        assert.equal(result.deb, '/test/dist/auto-claude_2.7.5_amd64.deb');
        assert.equal(result.flatpak, '/test/dist/com.autoclaude.ui_2.7.5_linux_x86_64.flatpak');
      } finally {
        existsSync.mock.restore();
        readdirSync.mock.restore();
      }
    });
  });

  describe('critical packages list', () => {
    it('should contain all required Linux packages', () => {
      assert.ok(CRITICAL_PACKAGES.includes('secretstorage'), 'secretstorage must be present for Linux OAuth');
      assert.ok(CRITICAL_PACKAGES.includes('pydantic_core'), 'pydantic_core must be present');
      assert.ok(CRITICAL_PACKAGES.includes('claude_agent_sdk'), 'claude_agent_sdk must be present');
      assert.ok(CRITICAL_PACKAGES.includes('dotenv'), 'dotenv must be present');
    });
  });

  describe('file content verification logic', () => {
    it('should detect Python binary in file list', () => {
      // AppImage format uses './' prefix
      const mockFiles = [
        'usr/bin/auto-claude',
        './resources/python',
        './resources/backend/core/client.py',
        './resources/python-site-packages/secretstorage/__init__.py',
        './resources/python-site-packages/pydantic_core/__init__.py',
        './resources/python-site-packages/claude_agent_sdk/__init__.py',
        './resources/python-site-packages/dotenv/__init__.py',
      ];

      const result = verifyFileList(mockFiles, 'test-package');
      assert.ok(result.verified, 'Should detect Python binary directory');
      assert.equal(result.issues.length, 0);
    });

    it('should detect Python binary with trailing slashes', () => {
      // Archive tools like bsdtar/dpkg-deb commonly output directories with trailing slashes
      const mockFiles = [
        'usr/bin/auto-claude',
        './resources/python/',  // Trailing slash
        'resources/backend/',   // Trailing slash
        './resources/python-site-packages/secretstorage/__init__.py',
        './resources/python-site-packages/pydantic_core/__init__.py',
        './resources/python-site-packages/claude_agent_sdk/__init__.py',
        './resources/python-site-packages/dotenv/__init__.py',
      ];

      const result = verifyFileList(mockFiles, 'test-package');
      assert.ok(result.verified, 'Should detect Python binary directory with trailing slash');
      assert.equal(result.issues.length, 0);
    });

    it('should detect backend directory in file list', () => {
      const mockFiles = [
        'usr/bin/auto-claude',
        './resources/python',
        './resources/backend/core/client.py',
        './resources/python-site-packages/secretstorage/__init__.py',
        './resources/python-site-packages/pydantic_core/__init__.py',
        './resources/python-site-packages/claude_agent_sdk/__init__.py',
        './resources/python-site-packages/dotenv/__init__.py',
      ];

      const result = verifyFileList(mockFiles, 'test-package');
      assert.ok(result.verified, 'Should detect backend directory');
      assert.equal(result.issues.length, 0);
    });

    it('should detect critical Python packages', () => {
      const mockFiles = [
        'usr/bin/auto-claude',
        './resources/python',
        './resources/backend/core/client.py',
        './resources/python-site-packages/secretstorage/__init__.py',
        './resources/python-site-packages/pydantic_core/__init__.py',
        './resources/python-site-packages/claude_agent_sdk/__init__.py',
        './resources/python-site-packages/dotenv/__init__.py',
      ];

      const result = verifyFileList(mockFiles, 'test-package');
      assert.ok(result.verified, 'Should detect all critical packages');
      assert.equal(result.issues.length, 0);
    });

    it('should report missing packages', () => {
      const mockFiles = [
        'usr/bin/auto-claude',
        './resources/python',
        './resources/backend/core/client.py',
        './resources/python-site-packages/dotenv/__init__.py',
      ];

      const result = verifyFileList(mockFiles, 'test-package');

      assert.ok(!result.verified, 'Should fail verification');
      assert.ok(result.issues.includes('Python package not found: secretstorage'));
      assert.ok(result.issues.includes('Python package not found: pydantic_core'));
      assert.ok(result.issues.includes('Python package not found: claude_agent_sdk'));
      assert.ok(!result.issues.some((i) => i.includes('dotenv')));
    });

    it('should not match python-site-packages when looking for python binary', () => {
      const mockFiles = [
        'usr/bin/auto-claude',
        './resources/python-site-packages/secretstorage/__init__.py',
        './resources/python-site-packages/pydantic_core/__init__.py',
        './resources/python-site-packages/claude_agent_sdk/__init__.py',
        './resources/python-site-packages/dotenv/__init__.py',
        // Note: NO './resources/python' entry
      ];

      const result = verifyFileList(mockFiles, 'test-package');

      assert.ok(!result.verified, 'Should fail verification');
      assert.ok(result.issues.some((i) => i.includes('Python binary directory not found')));
    });

    it('should not match unrelated paths when looking for packages', () => {
      const mockFiles = [
        'usr/bin/auto-claude',
        './resources/python',
        './resources/backend/core/client.py',
        // These paths end with package names but are NOT under python-site-packages
        './some/other/path/secretstorage/file.txt',
        './unrelated/dotenv/config',
        './another/pydantic_core/standalone/__init__.py',
      ];

      const result = verifyFileList(mockFiles, 'test-package');

      assert.ok(!result.verified, 'Should fail verification');
      assert.ok(result.issues.some((i) => i.includes('Python package not found: secretstorage')));
    });
  });

  describe('Flatpak file validation', () => {
    it('should reject empty Flatpak files', () => {
      const flatpakPath = '/test/app.flatpak';
      const mockStat = { size: 0 };

      // Mock fs.existsSync to return true
      const existsSync = mock.method(fs, 'existsSync', mock.fn(() => true));
      // Mock fs.statSync to return empty file stats
      const statSync = mock.method(fs, 'statSync', mock.fn(() => mockStat));

      try {
        const result = verifyFlatpak(flatpakPath);

        assert.ok(!result.verified, 'Should reject empty Flatpak files');
        assert.ok(result.issues.includes('Flatpak file is empty'));
      } finally {
        existsSync.mock.restore();
        statSync.mock.restore();
      }
    });

    it('should warn about suspiciously small Flatpak files', () => {
      const flatpakPath = '/test/app.flatpak';
      const mockStat = { size: 10 * 1024 * 1024 }; // 10 MB

      const existsSync = mock.method(fs, 'existsSync', mock.fn(() => true));
      const statSync = mock.method(fs, 'statSync', mock.fn(() => mockStat));

      try {
        const result = verifyFlatpak(flatpakPath);

        assert.ok(!result.verified, 'Should fail verification for too-small files');
        assert.ok(result.issues.some((i) => i.includes('too small')));
      } finally {
        existsSync.mock.restore();
        statSync.mock.restore();
      }
    });

    it('should accept reasonable Flatpak file sizes', () => {
      const flatpakPath = '/test/app.flatpak';
      const mockStat = { size: 133 * 1024 * 1024 }; // 133 MB (typical size)

      const existsSync = mock.method(fs, 'existsSync', mock.fn(() => true));
      const statSync = mock.method(fs, 'statSync', mock.fn(() => mockStat));

      try {
        const result = verifyFlatpak(flatpakPath);

        assert.ok(result.verified, 'Should accept reasonable Flatpak file sizes');
        assert.equal(result.issues.length, 0);
      } finally {
        existsSync.mock.restore();
        statSync.mock.restore();
      }
    });

    it('should handle non-existent Flatpak files', () => {
      const flatpakPath = '/test/nonexistent.flatpak';

      const existsSync = mock.method(fs, 'existsSync', mock.fn(() => false));

      try {
        const result = verifyFlatpak(flatpakPath);

        assert.ok(!result.verified, 'Should reject non-existent Flatpak files');
        assert.ok(result.issues.includes('Flatpak file does not exist'));
      } finally {
        existsSync.mock.restore();
      }
    });
  });

  describe('AppImage verification', () => {
    const appImagePath = '/test/Auto-Claude-2.7.5-linux-x86_64.AppImage';

    it('should successfully verify valid AppImage', () => {
      const mockFiles = [
        './resources/python',
        './resources/backend/core/client.py',
        './resources/python-site-packages/secretstorage/__init__.py',
        './resources/python-site-packages/pydantic_core/__init__.py',
        './resources/python-site-packages/claude_agent_sdk/__init__.py',
        './resources/python-site-packages/dotenv/__init__.py',
      ];

      const mockFn = (cmd, args) => {
        if (cmd === 'which' && args[0] === 'bsdtar') {
          return { status: 0, stdout: '/usr/bin/bsdtar', stderr: '' };
        }
        if (cmd === 'bsdtar') {
          return { status: 0, stdout: mockFiles.join('\n'), stderr: '', error: undefined };
        }
        return { status: 1, stderr: 'Unknown command' };
      };

      const { verifyAppImage } = loadWithMockedSpawnSync(mockFn);
      const result = verifyAppImage(appImagePath);

      restoreSpawnSync();

      assert.ok(result.verified, 'Should verify valid AppImage');
      assert.equal(result.issues.length, 0);
      assert.equal(result.fileCount, mockFiles.length);
    });

    it('should handle spawn errors (OS-level failures)', () => {
      const spawnError = new Error('EACCES: permission denied');

      const mockFn = (cmd) => {
        if (cmd === 'which') {
          return { status: 0, stdout: '/usr/bin/bsdtar', stderr: '', error: undefined };
        }
        if (cmd === 'bsdtar') {
          return { status: null, stdout: '', stderr: '', error: spawnError };
        }
        return { status: 1, stderr: 'Unknown command' };
      };

      const { verifyAppImage } = loadWithMockedSpawnSync(mockFn);
      const result = verifyAppImage(appImagePath);

      restoreSpawnSync();

      assert.ok(!result.verified, 'Should fail on spawn error');
      assert.ok(result.reason.includes('Command execution failed'));
      assert.ok(result.reason.includes('permission denied'));
    });

    it('should handle non-zero exit status from bsdtar', () => {
      const mockFn = (cmd) => {
        if (cmd === 'which') {
          return { status: 0, stdout: '/usr/bin/bsdtar', stderr: '', error: undefined };
        }
        if (cmd === 'bsdtar') {
          return { status: 1, stdout: '', stderr: 'bsdtar: Error: Not an AppImage file', error: undefined };
        }
        return { status: 1, stderr: 'Unknown command' };
      };

      const { verifyAppImage } = loadWithMockedSpawnSync(mockFn);
      const result = verifyAppImage(appImagePath);

      restoreSpawnSync();

      assert.ok(!result.verified, 'Should fail on non-zero status');
      assert.equal(result.reason, 'Failed to extract file list');
    });

    it('should handle missing bsdtar tool', () => {
      const mockFn = (cmd) => {
        if (cmd === 'which') {
          return { status: 1, stdout: '', stderr: '', error: undefined };
        }
        return { status: 1, stderr: 'Unknown command' };
      };

      const { verifyAppImage } = loadWithMockedSpawnSync(mockFn);
      const result = verifyAppImage(appImagePath);

      restoreSpawnSync();

      assert.ok(!result.verified, 'Should fail when bsdtar is missing');
      assert.equal(result.reason, 'bsdtar not available');
      assert.ok(result.critical, 'Should be marked as critical');
    });
  });

  describe('deb package verification', () => {
    const debPath = '/test/auto-claude_2.7.5_amd64.deb';

    it('should successfully verify valid deb package', () => {
      const mockFiles = [
        'drwxr-xr-x root/root         0 2025-01-01 00:00 ./resources/python',
        '-rw-r--r-- root/root      1234 2025-01-01 00:00 ./resources/backend/core/client.py',
        '-rw-r--r-- root/root       567 2025-01-01 00:00 ./resources/python-site-packages/secretstorage/__init__.py',
        '-rw-r--r-- root/root       789 2025-01-01 00:00 ./resources/python-site-packages/pydantic_core/__init__.py',
        '-rw-r--r-- root/root       456 2025-01-01 00:00 ./resources/python-site-packages/claude_agent_sdk/__init__.py',
        '-rw-r--r-- root/root       321 2025-01-01 00:00 ./resources/python-site-packages/dotenv/__init__.py',
      ];

      const mockFn = (cmd, args) => {
        if (cmd === 'which' && args[0] === 'dpkg-deb') {
          return { status: 0, stdout: '/usr/bin/dpkg-deb', stderr: '', error: undefined };
        }
        if (cmd === 'dpkg-deb') {
          return { status: 0, stdout: mockFiles.join('\n'), stderr: '', error: undefined };
        }
        return { status: 1, stderr: 'Unknown command' };
      };

      const { verifyDeb } = loadWithMockedSpawnSync(mockFn);
      const result = verifyDeb(debPath);

      restoreSpawnSync();

      assert.ok(result.verified, 'Should verify valid deb package');
      assert.equal(result.issues.length, 0);
      assert.equal(result.fileCount, mockFiles.length);
    });

    it('should handle spawn errors (OS-level failures)', () => {
      const spawnError = new Error('ENOMEM: Cannot allocate memory');

      const mockFn = (cmd) => {
        if (cmd === 'which') {
          return { status: 0, stdout: '/usr/bin/dpkg-deb', stderr: '', error: undefined };
        }
        if (cmd === 'dpkg-deb') {
          return { status: null, stdout: '', stderr: '', error: spawnError };
        }
        return { status: 1, stderr: 'Unknown command' };
      };

      const { verifyDeb } = loadWithMockedSpawnSync(mockFn);
      const result = verifyDeb(debPath);

      restoreSpawnSync();

      assert.ok(!result.verified, 'Should fail on spawn error');
      assert.ok(result.reason.includes('Command execution failed'));
      assert.ok(result.reason.includes('Cannot allocate memory'));
    });

    it('should handle non-zero exit status from dpkg-deb', () => {
      const mockFn = (cmd) => {
        if (cmd === 'which') {
          return { status: 0, stdout: '/usr/bin/dpkg-deb', stderr: '', error: undefined };
        }
        if (cmd === 'dpkg-deb') {
          return { status: 2, stdout: '', stderr: 'dpkg-deb: error: cannot read archive', error: undefined };
        }
        return { status: 1, stderr: 'Unknown command' };
      };

      const { verifyDeb } = loadWithMockedSpawnSync(mockFn);
      const result = verifyDeb(debPath);

      restoreSpawnSync();

      assert.ok(!result.verified, 'Should fail on non-zero status');
      assert.equal(result.reason, 'Failed to extract file list');
    });

    it('should handle missing dpkg-deb tool', () => {
      const mockFn = (cmd) => {
        if (cmd === 'which') {
          return { status: 1, stdout: '', stderr: '', error: undefined };
        }
        return { status: 1, stderr: 'Unknown command' };
      };

      const { verifyDeb } = loadWithMockedSpawnSync(mockFn);
      const result = verifyDeb(debPath);

      restoreSpawnSync();

      assert.ok(!result.verified, 'Should fail when dpkg-deb is missing');
      assert.equal(result.reason, 'dpkg-deb not available');
      assert.ok(result.critical, 'Should be marked as critical');
    });
  });
});
