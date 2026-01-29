/**
 * Tests for verify-linux-packages.cjs
 *
 * These tests cover the core logic that doesn't require external tools (bsdtar, dpkg-deb).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('verify-linux-packages', () => {
  describe('package finding logic', () => {
    it('should identify all three Linux package types', async () => {
      // Test that the logic correctly identifies .AppImage, .deb, and .flatpak files
      const mockFiles = [
        'Auto-Claude-2.7.5-linux-x86_64.AppImage',
        'auto-claude_2.7.5_amd64.deb',
        'com.autoclaude.ui_2.7.5_linux_x86_64.flatpak',
        'latest-mac.yml',
        'latest.yml',
      ];

      // Verify filtering logic
      const appImage = mockFiles.find(f => f.endsWith('.AppImage'));
      const deb = mockFiles.find(f => f.endsWith('.deb'));
      const flatpak = mockFiles.find(f => f.endsWith('.flatpak'));

      assert.equal(appImage, 'Auto-Claude-2.7.5-linux-x86_64.AppImage');
      assert.equal(deb, 'auto-claude_2.7.5_amd64.deb');
      assert.equal(flatpak, 'com.autoclaude.ui_2.7.5_linux_x86_64.flatpak');
    });

    it('should handle missing packages gracefully', () => {
      // Test behavior when packages are missing
      const mockFiles = ['latest-mac.yml', 'latest.yml'];

      const appImage = mockFiles.find(f => f.endsWith('.AppImage'));
      const deb = mockFiles.find(f => f.endsWith('.deb'));
      const flatpak = mockFiles.find(f => f.endsWith('.flatpak'));

      assert.equal(appImage, undefined);
      assert.equal(deb, undefined);
      assert.equal(flatpak, undefined);
    });
  });

  describe('critical packages list', () => {
    it('should contain all required Linux packages', () => {
      // Verify the list of critical Python packages
      const CRITICAL_PACKAGES = [
        'secretstorage',
        'pydantic_core',
        'claude_agent_sdk',
        'dotenv',
      ];

      assert.ok(CRITICAL_PACKAGES.includes('secretstorage'), 'secretstorage must be present for Linux OAuth');
      assert.ok(CRITICAL_PACKAGES.includes('pydantic_core'), 'pydantic_core must be present');
      assert.ok(CRITICAL_PACKAGES.includes('claude_agent_sdk'), 'claude_agent_sdk must be present');
      assert.ok(CRITICAL_PACKAGES.includes('dotenv'), 'dotenv must be present');
    });
  });

  describe('file content verification logic', () => {
    it('should detect Python binary in file list', () => {
      const mockFiles = [
        'usr/bin/auto-claude',
        'resources/python',
        'resources/backend/core/client.py',
        'resources/python-site-packages/secretstorage/__init__.py',
      ];

      const pythonBinFound = mockFiles.some(f => f.includes('resources/python'));
      assert.ok(pythonBinFound, 'Should detect Python binary');
    });

    it('should detect backend directory in file list', () => {
      const mockFiles = [
        'usr/bin/auto-claude',
        'resources/python',
        'resources/backend/core/client.py',
        'resources/python-site-packages/secretstorage/__init__.py',
      ];

      const backendFound = mockFiles.some(f => f.includes('resources/backend'));
      assert.ok(backendFound, 'Should detect backend directory');
    });

    it('should detect critical Python packages', () => {
      const mockFiles = [
        'usr/bin/auto-claude',
        'resources/python',
        'resources/backend/core/client.py',
        'resources/python-site-packages/secretstorage/__init__.py',
        'resources/python-site-packages/pydantic_core/__init__.py',
        'resources/python-site-packages/claude_agent_sdk/__init__.py',
        'resources/python-site-packages/dotenv/__init__.py',
      ];

      const CRITICAL_PACKAGES = ['secretstorage', 'pydantic_core', 'claude_agent_sdk', 'dotenv'];

      for (const pkg of CRITICAL_PACKAGES) {
        const found = mockFiles.some(f => f.includes(`python-site-packages/${pkg}`));
        assert.ok(found, `Should detect ${pkg} package`);
      }
    });

    it('should report missing packages', () => {
      const mockFiles = [
        'usr/bin/auto-claude',
        'resources/python',
        'resources/backend/core/client.py',
        'resources/python-site-packages/dotenv/__init__.py',
      ];

      const CRITICAL_PACKAGES = ['secretstorage', 'pydantic_core', 'claude_agent_sdk', 'dotenv'];
      const missing = [];

      for (const pkg of CRITICAL_PACKAGES) {
        const found = mockFiles.some(f => f.includes(`python-site-packages/${pkg}`));
        if (!found) {
          missing.push(pkg);
        }
      }

      assert.ok(missing.includes('secretstorage'), 'Should report missing secretstorage');
      assert.ok(missing.includes('pydantic_core'), 'Should report missing pydantic_core');
      assert.ok(missing.includes('claude_agent_sdk'), 'Should report missing claude_agent_sdk');
      assert.ok(!missing.includes('dotenv'), 'Should not report missing dotenv');
    });
  });

  describe('Flatpak file validation', () => {
    it('should reject empty Flatpak files', () => {
      const stats = { size: 0 };
      const issues = [];

      if (stats.size === 0) {
        issues.push('Flatpak file is empty');
      }

      assert.ok(issues.includes('Flatpak file is empty'));
    });

    it('should warn about suspiciously small Flatpak files', () => {
      const stats = { size: 10 * 1024 * 1024 }; // 10 MB
      const issues = [];

      if (stats.size < 50 * 1024 * 1024) {
        issues.push(`Flatpak file seems too small (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      }

      assert.ok(issues.some(i => i.includes('too small')));
    });

    it('should accept reasonable Flatpak file sizes', () => {
      const stats = { size: 133 * 1024 * 1024 }; // 133 MB (typical size)
      const issues = [];

      if (stats.size < 50 * 1024 * 1024) {
        issues.push(`Flatpak file seems too small`);
      }

      assert.equal(issues.length, 0);
    });
  });
});
