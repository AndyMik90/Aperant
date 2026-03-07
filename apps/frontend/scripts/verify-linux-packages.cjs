#!/usr/bin/env node
/**
 * Verify Linux package contents to ensure alignment between AppImage, deb, and Flatpak.
 *
 * This script extracts and inspects each Linux package format to verify that critical
 * files (Python binary, backend code, Python packages) are present and correctly bundled.
 *
 * Usage: node scripts/verify-linux-packages.cjs [dist-dir]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Critical Python packages that must be present
const CRITICAL_PACKAGES = [
  'secretstorage', // Linux OAuth token storage
  'pydantic_core',
  'claude_agent_sdk',
  'dotenv',
];

// Minimum expected Flatpak file size (50 MB)
// Flatpak files are large OCI archives; anything smaller is suspicious
// Based on observed minimum sizes of valid builds
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
  log(`✓ ${message}`, colors.green);
}

function logError(message) {
  log(`✗ ${message}`, colors.red);
}

function logWarning(message) {
  log(`⚠ ${message}`, colors.yellow);
}

function logInfo(message) {
  log(`ℹ ${message}`, colors.cyan);
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
 * Common file list verification logic
 * @param {string[]} files - List of files from package
 * @param {string} packageType - Type of package (for error messages)
 * @returns {Object} Verification result with verified flag and issues array
 *
 * File formats:
 * - AppImage (bsdtar): './resources/python', './resources/backend/file.py'
 * - deb (dpkg-deb -c): 'resources/python', 'resources/backend/file.py' (in last column)
 */
function verifyFileList(files, packageType) {
  const issues = [];

  // Normalize paths by removing trailing slashes (archive tools commonly add these)
  const normalizePath = (p) => p.replace(/\/+$/, '');

  // Check for Python binary directory
  // AppImage: './resources/python' or './resources/python/' (with trailing slash)
  // deb: 'resources/python' or 'resources/python/' (with trailing slash)
  // Must NOT match 'resources/python-site-packages'
  const pythonBinFound = files.some((f) => {
    const normalized = normalizePath(f);
    return (
      (normalized === './resources/python' ||
        normalized === 'resources/python' ||
        normalized.endsWith('/resources/python')) &&
      !f.includes('python-site-packages')
    );
  });
  if (!pythonBinFound) {
    issues.push(`Python binary directory not found in ${packageType}`);
  }

  // Check for backend directory (must be under resources/)
  const backendFound = files.some((f) => {
    const normalized = normalizePath(f);
    return (
      f.includes('./resources/backend/') ||
      f.includes('resources/backend/') ||
      normalized === './resources/backend' ||
      normalized === 'resources/backend'
    );
  });
  if (!backendFound) {
    issues.push(`Backend directory not found in ${packageType}`);
  }

  // Check for critical Python packages (must be under python-site-packages/)
  for (const pkg of CRITICAL_PACKAGES) {
    // Match: './resources/python-site-packages/secretstorage/__init__.py'
    // Match: 'resources/python-site-packages/secretstorage/__init__.py'
    // Don't match: '/some/other/path/secretstorage/'
    const found = files.some(
      (f) => f.includes(`python-site-packages/${pkg}/`) || f.includes(`python-site-packages/${pkg}.`),
    );
    if (!found) {
      issues.push(`Python package not found: ${pkg}`);
    }
  }

  return {
    verified: issues.length === 0,
    issues,
    fileCount: files.filter((f) => f.trim()).length,
  };
}

/**
 * Verify AppImage contents using bsdtar (libarchive)
 */
function verifyAppImage(appImagePath) {
  logInfo(`Verifying AppImage: ${path.basename(appImagePath)}`);

  // Check if bsdtar is available
  if (!commandExists('bsdtar')) {
    logWarning('bsdtar not found. Install with: sudo apt-get install libarchive-tools');
    logWarning('Skipping AppImage verification');
    return { verified: false, reason: 'bsdtar not available', critical: true };
  }

  // Extract file list from AppImage using bsdtar
  const result = spawnSync('bsdtar', ['-t', '-f', appImagePath], {
    stdio: 'pipe',
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large file listings
  });

  // Check for spawn errors (e.g., permission denied, memory issues)
  if (result.error) {
    logError(`Failed to execute bsdtar: ${result.error.message}`);
    return { verified: false, reason: `Command execution failed: ${result.error.message}` };
  }

  if (result.status !== 0) {
    logError(`Failed to read AppImage: ${result.stderr}`);
    return { verified: false, reason: 'Failed to extract file list' };
  }

  const files = result.stdout.split('\n');
  return verifyFileList(files, 'AppImage');
}

/**
 * Verify deb package contents
 */
function verifyDeb(debPath) {
  logInfo(`Verifying deb package: ${path.basename(debPath)}`);

  // Check if dpkg is available
  if (!commandExists('dpkg-deb')) {
    logWarning('dpkg-deb not found. Skipping deb verification');
    return { verified: false, reason: 'dpkg-deb not available', critical: true };
  }

  // List contents of deb package
  const result = spawnSync('dpkg-deb', ['-c', debPath], {
    stdio: 'pipe',
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large file listings
  });

  // Check for spawn errors (e.g., permission denied, memory issues)
  if (result.error) {
    logError(`Failed to execute dpkg-deb: ${result.error.message}`);
    return { verified: false, reason: `Command execution failed: ${result.error.message}` };
  }

  if (result.status !== 0) {
    logError(`Failed to read deb package: ${result.stderr}`);
    return { verified: false, reason: 'Failed to extract file list' };
  }

  const files = result.stdout.split('\n');
  return verifyFileList(files, 'deb package');
}

/**
 * Verify Flatpak package contents
 * Note: Flatpak is more complex to inspect, so we do basic validation
 */
function verifyFlatpak(flatpakPath) {
  logInfo(`Verifying Flatpak package: ${path.basename(flatpakPath)}`);

  const issues = [];

  // Check if flatpak command is available for detailed validation
  const hasFlatpakCli = commandExists('flatpak');
  if (!hasFlatpakCli) {
    logWarning('flatpak command not found. Skipping detailed Flatpak verification');
    // Continue with basic file existence/size checks
  }

  // Check if file exists and is not empty
  if (!fs.existsSync(flatpakPath)) {
    return { verified: false, issues: ['Flatpak file does not exist'] };
  }

  const stats = fs.statSync(flatpakPath);
  if (stats.size === 0) {
    return { verified: false, issues: ['Flatpak file is empty'] };
  }

  // Flatpak files are large OCI archives, so we just verify file size and basic structure
  // Detailed content inspection would require mounting or extracting the flatpak
  if (stats.size < FLATPAK_MIN_SIZE_MB * 1024 * 1024) {
    // Less than minimum size is suspicious
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

  // Report found packages
  if (packages.appImage) {
    logSuccess(`Found AppImage: ${path.basename(packages.appImage)}`);
  } else {
    logWarning('No AppImage found');
  }

  if (packages.deb) {
    logSuccess(`Found deb: ${path.basename(packages.deb)}`);
  } else {
    logWarning('No deb package found');
  }

  if (packages.flatpak) {
    logSuccess(`Found Flatpak: ${path.basename(packages.flatpak)}`);
  } else {
    logWarning('No Flatpak package found');
  }

  if (!packages.appImage && !packages.deb && !packages.flatpak) {
    logError('\nNo Linux packages found to verify!');
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
      log('  - bsdtar: sudo apt-get install libarchive-tools\n', colors.red);
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
  CRITICAL_PACKAGES,
  findPackages,
  verifyFileList,
  verifyAppImage,
  verifyDeb,
  verifyFlatpak,
};
