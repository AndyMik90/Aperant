#!/usr/bin/env node
/**
 * Download prebuilt native modules for Windows
 *
 * This script downloads pre-compiled node-pty binaries from GitHub releases,
 * eliminating the need for Visual Studio Build Tools on Windows.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GITHUB_REPO = 'AndyMik90/Auto-Claude';

/**
 * Get the Electron ABI version for the installed Electron
 */
function getElectronAbi() {
  try {
    // Try to get from electron-abi package
    const result = execSync('npx electron-abi', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result;
  } catch {
    // Fallback: read from electron package
    try {
      const electronPkg = require('electron/package.json');
      const version = electronPkg.version;
      // Electron 39.x = ABI 140
      const majorVersion = parseInt(version.split('.')[0], 10);
      // This is a rough mapping, electron-abi is more accurate
      const abiMap = {
        39: 140,
        38: 139,
        37: 136,
        36: 135,
        35: 134,
        34: 132,
        33: 131,
        32: 130,
        31: 129,
        30: 128,
      };
      return abiMap[majorVersion] || null;
    } catch {
      return null;
    }
  }
}

/**
 * Get the latest release from GitHub
 */
function getLatestRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      headers: {
        'User-Agent': 'Auto-Claude-Installer',
        Accept: 'application/vnd.github.v3+json',
      },
    };

    https
      .get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else if (res.statusCode === 404) {
            resolve(null); // No releases yet
          } else {
            reject(new Error(`GitHub API returned ${res.statusCode}`));
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Find prebuild asset in release
 */
function findPrebuildAsset(release, arch, electronAbi) {
  if (!release || !release.assets) return null;

  const assetName = `node-pty-win32-${arch}-electron-${electronAbi}.zip`;
  return release.assets.find((asset) => asset.name === assetName);
}

/**
 * Download a file from URL
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const request = (url) => {
      https
        .get(url, { headers: { 'User-Agent': 'Auto-Claude-Installer' } }, (res) => {
          if (res.statusCode === 302 || res.statusCode === 301) {
            // Follow redirect
            request(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Download failed with status ${res.statusCode}`));
            return;
          }

          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        })
        .on('error', (err) => {
          fs.unlink(destPath, () => {
            // Intentionally ignoring unlink errors for partial file cleanup
          });
          reject(err);
        });
    };

    request(url);
  });
}

/**
 * Extract zip file (using built-in tools)
 */
function extractZip(zipPath, destDir) {
  const { execFileSync } = require('child_process');

  // Use PowerShell on Windows without going through a shell
  execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Expand-Archive',
    '-Path', zipPath,
    '-DestinationPath', destDir,
    '-Force',
  ], {
    stdio: 'inherit',
  });
}

/**
 * Main function to download and install prebuilds
 */
async function downloadPrebuilds() {
  const arch = process.arch; // x64 or arm64
  const electronAbi = getElectronAbi();

  if (!electronAbi) {
    console.log('[prebuilds] Could not determine Electron ABI version');
    return { success: false, reason: 'unknown-abi' };
  }

  console.log(`[prebuilds] Looking for prebuilds: win32-${arch}, Electron ABI ${electronAbi}`);

  // Check for prebuilds in GitHub releases
  let release;
  try {
    release = await getLatestRelease();
  } catch (err) {
    console.log(`[prebuilds] Could not fetch releases: ${err.message}`);
    return { success: false, reason: 'fetch-failed' };
  }

  if (!release) {
    console.log('[prebuilds] No releases found');
    return { success: false, reason: 'no-releases' };
  }

  const asset = findPrebuildAsset(release, arch, electronAbi);
  if (!asset) {
    console.log(`[prebuilds] No prebuild found for win32-${arch}-electron-${electronAbi}`);
    console.log('[prebuilds] Available assets:', release.assets?.map((a) => a.name).join(', ') || 'none');
    return { success: false, reason: 'no-matching-prebuild' };
  }

  console.log(`[prebuilds] Found prebuild: ${asset.name}`);

  // Download the prebuild
  const tempDir = path.join(__dirname, '..', '.prebuild-temp');
  const zipPath = path.join(tempDir, asset.name);
  const nodePtyDir = path.join(__dirname, '..', 'node_modules', 'node-pty');
  const buildDir = path.join(nodePtyDir, 'build', 'Release');

  try {
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });

    console.log(`[prebuilds] Downloading ${asset.name}...`);
    await downloadFile(asset.browser_download_url, zipPath);

    console.log('[prebuilds] Extracting...');
    extractZip(zipPath, tempDir);

    // Find the extracted prebuild directory
    const extractedDir = path.join(tempDir, 'prebuilds', `win32-${arch}-electron-${electronAbi}`);

    if (!fs.existsSync(extractedDir)) {
      throw new Error(`Extracted directory not found: ${extractedDir}`);
    }

    // Ensure build/Release directory exists
    fs.mkdirSync(buildDir, { recursive: true });

    // Copy files to node_modules/node-pty/build/Release
    const files = fs.readdirSync(extractedDir);
    for (const file of files) {
      const src = path.join(extractedDir, file);
      const dest = path.join(buildDir, file);
      fs.copyFileSync(src, dest);
      console.log(`[prebuilds] Installed: ${file}`);
    }

    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log('[prebuilds] Successfully installed prebuilt binaries!');
    return { success: true };
  } catch (err) {
    // Cleanup on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    console.log(`[prebuilds] Download/extract failed: ${err.message}`);
    return { success: false, reason: 'install-failed', error: err.message };
  }
}

// Export for use by postinstall
module.exports = { downloadPrebuilds, getElectronAbi };

// Run if called directly
if (require.main === module) {
  downloadPrebuilds()
    .then((result) => {
      if (!result.success) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('[prebuilds] Error:', err);
      process.exit(1);
    });
}
