#!/usr/bin/env node
/**
 * Post-install script for AC Jerry UI
 *
 * On Windows:
 *   1. Try to download prebuilt node-pty binaries from GitHub releases
 *   2. Fall back to electron-rebuild if prebuilds aren't available
 *   3. Show helpful error message if compilation fails
 *
 * On macOS/Linux:
 *   1. Run electron-rebuild (compilers are typically available)
 */

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const isWindows = os.platform() === 'win32';

const WINDOWS_BUILD_TOOLS_HELP = `
================================================================================
  VISUAL STUDIO BUILD TOOLS REQUIRED
================================================================================

Prebuilt binaries weren't available for your Electron version, and compilation
requires Visual Studio Build Tools.

To install:

  1. Download Visual Studio Build Tools 2022:
     https://visualstudio.microsoft.com/visual-cpp-build-tools/

  2. Run installer and select:
     - "Desktop development with C++" workload

  3. In "Individual Components", also select:
     - "MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs"

  4. Restart your terminal and run: npm install

================================================================================
`;

/**
 * Get electron version from package.json
 */
function getElectronVersion() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const electronVersion = pkg.devDependencies?.electron || pkg.dependencies?.electron;
  if (!electronVersion) {
    return null;
  }
  // Strip leading ^ or ~ from version
  return electronVersion.replace(/^[\^~]/, '');
}

/**
 * Run electron-rebuild
 */
function runElectronRebuild() {
  return new Promise((resolve, reject) => {
    const npx = isWindows ? 'npx.cmd' : 'npx';
    const electronVersion = getElectronVersion();
    const args = ['electron-rebuild'];

    // Explicitly pass electron version if detected
    if (electronVersion) {
      args.push('-v', electronVersion);
      console.log(`[postinstall] Using Electron version: ${electronVersion}`);
    }

    const child = spawn(npx, args, {
      stdio: 'inherit',
      shell: isWindows,
      cwd: path.join(__dirname, '..'),
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        reject(new Error(`electron-rebuild exited with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Check if node-pty is already built
 */
function isNodePtyBuilt() {
  // Check traditional node-pty build location (local node_modules)
  const localBuildDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'build', 'Release');
  if (fs.existsSync(localBuildDir)) {
    const files = fs.readdirSync(localBuildDir);
    if (files.some((f) => f.endsWith('.node'))) return true;
  }

  // Check root node_modules (for npm workspaces)
  const rootBuildDir = path.join(__dirname, '..', '..', '..', 'node_modules', 'node-pty', 'build', 'Release');
  if (fs.existsSync(rootBuildDir)) {
    const files = fs.readdirSync(rootBuildDir);
    if (files.some((f) => f.endsWith('.node'))) return true;
  }

  // Check for @lydell/node-pty with platform-specific prebuilts
  const arch = os.arch();
  const platform = os.platform();
  const platformPkg = `@lydell/node-pty-${platform}-${arch}`;

  // Check local node_modules
  const localLydellDir = path.join(__dirname, '..', 'node_modules', platformPkg);
  if (fs.existsSync(localLydellDir)) {
    const files = fs.readdirSync(localLydellDir);
    if (files.some((f) => f.endsWith('.node'))) return true;
  }

  // Check root node_modules (for npm workspaces)
  const rootLydellDir = path.join(__dirname, '..', '..', '..', 'node_modules', platformPkg);
  if (fs.existsSync(rootLydellDir)) {
    const files = fs.readdirSync(rootLydellDir);
    if (files.some((f) => f.endsWith('.node'))) return true;
  }

  return false;
}

/**
 * Main postinstall logic
 */
async function main() {
  console.log('[postinstall] Setting up native modules for Electron...\n');

  // If node-pty is already built (e.g., from a previous successful install), skip
  if (isNodePtyBuilt()) {
    console.log('[postinstall] Native modules already built, skipping rebuild.');
    return;
  }

  if (isWindows) {
    // On Windows, try prebuilds first
    console.log('[postinstall] Windows detected - checking for prebuilt binaries...\n');

    try {
      // Dynamic import to handle case where the script doesn't exist yet
      const { downloadPrebuilds } = require('./download-prebuilds.cjs');
      const result = await downloadPrebuilds();

      if (result.success) {
        console.log('\n[postinstall] Successfully installed prebuilt binaries!');
        console.log('[postinstall] No Visual Studio Build Tools required.\n');
        return;
      }

      console.log(`\n[postinstall] Prebuilds not available (${result.reason})`);
      console.log('[postinstall] Falling back to electron-rebuild...\n');
    } catch (err) {
      console.log('[postinstall] Could not check for prebuilds:', err.message);
      console.log('[postinstall] Falling back to electron-rebuild...\n');
    }
  }

  // Run electron-rebuild
  try {
    console.log('[postinstall] Running electron-rebuild...\n');
    await runElectronRebuild();
    console.log('\n[postinstall] Native modules built successfully!');
  } catch (error) {
    console.error('\n[postinstall] Failed to build native modules.\n');

    if (isWindows) {
      console.error(WINDOWS_BUILD_TOOLS_HELP);
    } else {
      console.error('Error:', error.message);
      console.error('\nYou may need to install build tools for your platform:');
      console.error('  macOS: xcode-select --install');
      console.error('  Linux: sudo apt-get install build-essential\n');
    }

    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[postinstall] Unexpected error:', err);
  process.exit(1);
});
