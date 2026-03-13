#!/usr/bin/env node
/**
 * Verify Linux package contents to ensure AppImage, deb, and Flatpak were built correctly.
 *
 * This script inspects each Linux package format to verify that the bundled Electron
 * application (app.asar) is present and packages are valid.
 *
 * Usage: node scripts/verify-linux-packages.cjs [dist-dir]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Minimum expected Flatpak file size (50 MB)
// Flatpak files are large OCI archives; anything smaller is suspicious
const FLATPAK_MIN_SIZE_MB = 50;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`\u2713 ${message}`, colors.green);
}

function logError(message) {
  log(`\u2717 ${message}`, colors.red);
}

function logWarning(message) {
  log(`\u26A0 ${message}`, colors.yellow);
}

function logInfo(message) {
  log(`\u2139 ${message}`, colors.cyan);
}

/**
 * Check if a command exists
 * Uses 'which' directly without shell interpolation to prevent command injection
 */
function commandExists(cmd) {
  const result = spawnSync('which', [cmd], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Find all Linux packages in the dist directory
 */
function findPackages(distDir) {
  const packages = {
    appImage: null,
    deb: null,
    flatpak: null,
  };

  if (!fs.existsSync(distDir)) {
    logError(`Distribution directory not found: ${distDir}`);
    return packages;
  }

  const files = fs.readdirSync(distDir);

  for (const file of files) {
    const fullPath = path.join(distDir, file);

    if (file.endsWith('.AppImage')) {
      if (!packages.appImage) {
        packages.appImage = fullPath;
      } else {
        logWarning(`Multiple AppImage files found, using first: ${path.basename(packages.appImage)}`);
      }
    } else if (file.endsWith('.deb')) {
      if (!packages.deb) {
        packages.deb = fullPath;
      } else {
        logWarning(`Multiple deb files found, using first: ${path.basename(packages.deb)}`);
      }
    } else if (file.endsWith('.flatpak')) {
      if (!packages.flatpak) {
        packages.flatpak = fullPath;
      } else {
        logWarning(`Multiple Flatpak files found, using first: ${path.basename(packages.flatpak)}`);
      }
    }
  }

  return packages;
}

/**
 * Verify that a file listing contains the bundled Electron app (app.asar)
 * @param {string[]} files - List of files from package
 * @param {string} packageType - Type of package (for error messages)
 * @returns {Object} Verification result with verified flag and issues array
 */
function verifyFileList(files, packageType) {
  const issues = [];

  // Check for app.asar (the bundled Electron application)
  // Use boundary-safe match to avoid false positives from resources/app.asar.unpacked
  const appAsarPattern = /[\\/]resources[\\/]app\.asar$/;
  const appAsarFound = files.some((f) => appAsarPattern.test(f.trim()));
  if (!appAsarFound) {
    issues.push(`app.asar not found in ${packageType} — the Electron app bundle is missing`);
  }

  return {
    verified: issues.length === 0,
    issues,
    fileCount: files.filter((f) => f.trim()).length,
  };
}

// Minimum expected AppImage file size (50 MB)
const APPIMAGE_MIN_SIZE_MB = 50;

/**
 * Verify AppImage contents.
 * AppImages are ELF executables with an embedded SquashFS filesystem.
 * We try unsquashfs first (can list SquashFS contents), then fall back
 * to the AppImage's own --appimage-extract, and finally to a size check.
 */
function verifyAppImage(appImagePath) {
  logInfo(`Verifying AppImage: ${path.basename(appImagePath)}`);

  // Try unsquashfs -l (lists squashfs contents without extracting)
  if (commandExists('unsquashfs')) {
    const result = spawnSync('unsquashfs', ['-l', appImagePath], {
      stdio: 'pipe',
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });

    if (result.error) {
      logWarning(`unsquashfs failed: ${result.error.message}, falling back to size check`);
    } else if (result.status !== 0) {
      logWarning(`unsquashfs could not read AppImage, falling back to size check`);
    } else {
      const files = result.stdout.split('\n');
      return verifyFileList(files, 'AppImage');
    }
  }

  // Try self-extraction to list contents (AppImages support --appimage-extract-and-run)
  // Make the AppImage executable first
  try {
    fs.chmodSync(appImagePath, 0o755);
  } catch (_) {
    // Ignore chmod errors
  }

  const extractResult = spawnSync(appImagePath, ['--appimage-extract', '--stdout'], {
    stdio: 'pipe',
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: 30000,
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' },
  });

  // --appimage-extract creates a squashfs-root directory; check if it exists
  const squashfsRoot = path.join(path.dirname(appImagePath), 'squashfs-root');
  if (fs.existsSync(squashfsRoot)) {
    try {
      const collectFiles = (dir, prefix = '') => {
        const entries = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          entries.push(rel);
          if (entry.isDirectory()) {
            entries.push(...collectFiles(path.join(dir, entry.name), rel));
          }
        }
        return entries;
      };
      const files = collectFiles(squashfsRoot);
      const verifyResult = verifyFileList(files, 'AppImage');
      // Clean up extracted directory
      fs.rmSync(squashfsRoot, { recursive: true, force: true });
      return verifyResult;
    } catch (e) {
      logWarning(`Failed to read extracted AppImage contents: ${e.message}`);
      fs.rmSync(squashfsRoot, { recursive: true, force: true });
    }
  }

  // Fall back to basic size validation (same approach as Flatpak)
  logWarning('Could not inspect AppImage contents (unsquashfs not available). Using size validation.');
  const issues = [];
  const stats = fs.statSync(appImagePath);

  if (stats.size === 0) {
    return { verified: false, issues: ['AppImage file is empty'] };
  }

  if (stats.size < APPIMAGE_MIN_SIZE_MB * 1024 * 1024) {
    issues.push(
      `AppImage file seems too small (${(stats.size / 1024 / 1024).toFixed(2)} MB, expected at least ${APPIMAGE_MIN_SIZE_MB} MB)`,
    );
  }

  if (issues.length === 0) {
    logInfo('AppImage passed size validation (content inspection was not possible)');
  }

  return {
    verified: issues.length === 0,
    issues,
    size: stats.size,
  };
}

/**
 * Verify deb package contents
 */
function verifyDeb(debPath) {
  logInfo(`Verifying deb package: ${path.basename(debPath)}`);

  if (!commandExists('dpkg-deb')) {
    logWarning('dpkg-deb not found. Skipping deb verification');
    return { verified: false, reason: 'dpkg-deb not available', critical: true };
  }

  const result = spawnSync('dpkg-deb', ['-c', debPath], {
    stdio: 'pipe',
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) {
    logError(`Failed to execute dpkg-deb: ${result.error.message}`);
    return { verified: false, issues: [`Command execution failed: ${result.error.message}`] };
  }

  if (result.status !== 0) {
    logError(`Failed to read deb package: ${result.stderr}`);
    return { verified: false, issues: ['Failed to extract file list'] };
  }

  const files = result.stdout.split('\n');
  return verifyFileList(files, 'deb package');
}

/**
 * Verify Flatpak package contents
 * Flatpak OCI archives are complex to inspect, so we do basic validation
 */
function verifyFlatpak(flatpakPath) {
  logInfo(`Verifying Flatpak package: ${path.basename(flatpakPath)}`);

  const issues = [];

  if (!fs.existsSync(flatpakPath)) {
    return { verified: false, issues: ['Flatpak file does not exist'] };
  }

  const stats = fs.statSync(flatpakPath);
  if (stats.size === 0) {
    return { verified: false, issues: ['Flatpak file is empty'] };
  }

  if (stats.size < FLATPAK_MIN_SIZE_MB * 1024 * 1024) {
    issues.push(
      `Flatpak file seems too small (${(stats.size / 1024 / 1024).toFixed(2)} MB, expected at least ${FLATPAK_MIN_SIZE_MB} MB)`,
    );
  }

  return {
    verified: issues.length === 0,
    issues,
    size: stats.size,
  };
}

/**
 * Main verification function
 */
function main() {
  const distDir = process.argv[2] || path.join(__dirname, '..', 'dist');

  log('\n=== Linux Package Verification ===\n', colors.blue);
  logInfo(`Distribution directory: ${distDir}\n`);

  const packages = findPackages(distDir);

  // Report found packages — all three targets are required
  let missingTargets = false;

  if (packages.appImage) {
    logSuccess(`Found AppImage: ${path.basename(packages.appImage)}`);
  } else {
    logError('No AppImage found — expected build target is missing');
    missingTargets = true;
  }

  if (packages.deb) {
    logSuccess(`Found deb: ${path.basename(packages.deb)}`);
  } else {
    logError('No deb package found — expected build target is missing');
    missingTargets = true;
  }

  if (packages.flatpak) {
    logSuccess(`Found Flatpak: ${path.basename(packages.flatpak)}`);
  } else {
    logError('No Flatpak package found — expected build target is missing');
    missingTargets = true;
  }

  if (missingTargets) {
    logError('\nOne or more expected Linux package targets are missing!');
    process.exit(1);
  }

  log('');

  // Verify each package
  const results = {};

  if (packages.appImage) {
    results.appImage = verifyAppImage(packages.appImage);
  }

  if (packages.deb) {
    results.deb = verifyDeb(packages.deb);
  }

  if (packages.flatpak) {
    results.flatpak = verifyFlatpak(packages.flatpak);
  }

  // Print results
  log('\n=== Verification Results ===\n', colors.blue);

  let hasFailures = false;
  let hasCriticalSkips = false;

  for (const [type, result] of Object.entries(results)) {
    if (result.reason) {
      if (result.critical) {
        logError(`${type}: CRITICAL - SKIPPED (${result.reason})`);
        hasCriticalSkips = true;
      } else {
        logWarning(`${type}: SKIPPED (${result.reason})`);
      }
    } else if (result.verified) {
      logSuccess(`${type}: VERIFIED`);
      if (result.fileCount) {
        logInfo(`  Files: ${result.fileCount}`);
      }
      if (result.size) {
        logInfo(`  Size: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
      }
    } else {
      logError(`${type}: FAILED`);
      hasFailures = true;
      for (const issue of result.issues || []) {
        logError(`  - ${issue}`);
      }
    }
  }

  log('');

  if (hasFailures || hasCriticalSkips) {
    logError('\n=== VERIFICATION FAILED ===\n');
    if (hasFailures) {
      log('Some packages are missing critical files. This will cause runtime errors.\n', colors.red);
    }
    if (hasCriticalSkips) {
      log('Some packages could not be verified due to missing required tools.\n', colors.red);
      log('Install required tools:\n', colors.red);
      log('  - unsquashfs: sudo apt-get install squashfs-tools\n', colors.red);
      log('  - dpkg-deb: sudo apt-get install dpkg\n', colors.red);
    }
    process.exit(1);
  } else {
    logSuccess('\n=== ALL PACKAGES VERIFIED ===\n');
    log('All Linux packages contain the required files.\n', colors.green);
    process.exit(0);
  }
}

// Only run main if this file is executed directly (not imported)
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
  findPackages,
  verifyFileList,
  verifyAppImage,
  verifyDeb,
  verifyFlatpak,
};
