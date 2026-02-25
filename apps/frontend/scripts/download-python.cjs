#!/usr/bin/env node
/**
 * Download Python from python-build-standalone for bundling with the Electron app.
 *
 * This script downloads a standalone Python distribution that can be bundled
 * with the packaged Electron app, eliminating the need for users to have
 * Python installed on their system.
 *
 * Usage:
 *   node scripts/download-python.cjs [--platform <platform>] [--arch <arch>]
 *
 * Platforms: darwin/mac, win32/win, linux
 * Architectures: x64, arm64
 *
 * If not specified, uses current platform/arch.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');
const nodeCrypto = require('crypto');
const { toNodePlatform } = require('../src/shared/platform.cjs');

// Python version to bundle (must be 3.10+ for claude-agent-sdk, 3.12+ for full Graphiti support)
const PYTHON_VERSION = '3.12.8';

// Patterns for files/directories to strip from site-packages to reduce size
// These are safe to remove - Python doesn't need them at runtime
const STRIP_PATTERNS = {
  // Directories to remove entirely
  dirs: [
    '__pycache__',
    'tests',
    'test',
    'testing',
    'docs',
    'doc',
    'examples',
    'example',
    'benchmarks',
    'benchmark',
    '.git',
    '.github',
    '.tox',
    '.pytest_cache',
    '.mypy_cache',
    '__pypackages__',
    // Windows-specific bloat
    'pythonwin',       // PyWin32 IDE - not needed (9MB)
  ],
  // File extensions to remove
  extensions: [
    '.pyc',
    '.pyo',
    '.pyi',      // Type stubs - IDE only, not needed at runtime
    '.c',        // C source files (compiled extensions don't need these)
    '.h',        // C headers
    '.cpp',
    '.hpp',
    '.md',
    '.rst',
    '.txt',      // Will preserve LICENSE.txt
    '.yml',
    '.yaml',
    '.toml',
    '.ini',
    '.cfg',
    '.coveragerc',
    '.gitignore',
    '.gitattributes',
    '.editorconfig',
    '.chm',      // Windows help files - not needed
  ],
  // Specific files to remove
  files: [
    'README',
    'README.md',
    'README.rst',
    'CHANGELOG',
    'CHANGELOG.md',
    'CHANGES',
    'CHANGES.md',
    'HISTORY',
    'HISTORY.md',
    'AUTHORS',
    'AUTHORS.md',
    'CONTRIBUTORS',
    'CONTRIBUTORS.md',
    'CONTRIBUTING',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'SECURITY.md',
    'Makefile',
    'setup.py',
    'setup.cfg',
    'pyproject.toml',
    'tox.ini',
    '.travis.yml',
    'conftest.py',
    'pytest.ini',
  ],
  // Specific paths within packages to remove (relative to package directory)
  // Format: 'package_name/subpath' - removes the entire subpath
  packagePaths: [
    'googleapiclient/discovery_cache/documents',  // Cached Google API discovery docs (92MB!)
    // NOTE: claude_agent_sdk/_bundled is NO LONGER excluded.
    // On Windows, the system-installed Claude CLI is claude.cmd (a batch script),
    // which cannot be executed by anyio.open_process() / asyncio.create_subprocess_exec().
    // The SDK's bundled claude.exe is a proper executable and works correctly.
  ],
  // Packages that should NEVER be bundled (too large, specialized)
  // If these appear in dependencies, warn and skip
  blockedPackages: [
    'torch',
    'torchvision',
    'torchaudio',
    'tensorflow',
    'tensorflow-gpu',
    'transformers',
    'jax',
    'jaxlib',
    'keras',
    'onnxruntime',
    'opencv-python',
    'opencv-contrib-python',
    'scipy',  // Often pulled in, but large - warn if present
  ],
};

// python-build-standalone release tag
const RELEASE_TAG = '20241219';

// Base URL for downloads
const BASE_URL = `https://github.com/indygreg/python-build-standalone/releases/download/${RELEASE_TAG}`;

// Output directory for downloaded Python (relative to frontend root)
const OUTPUT_DIR = 'python-runtime';

// SHA256 checksums for verification (from python-build-standalone release)
// These must be updated when changing PYTHON_VERSION or RELEASE_TAG
// Get checksums from: https://github.com/indygreg/python-build-standalone/releases/download/{RELEASE_TAG}/SHA256SUMS
const CHECKSUMS = {
  'darwin-arm64': 'abe1de2494bb8b243fd507944f4d50292848fa00685d5288c858a72623a16635',
  'darwin-x64': '867c1af10f204224b571f8f2593fc9eb580fe0c2376224d1096ebe855ad8c722',
  'win32-x64': '1a702b3463cf87ec0d2e33902a47e95456053b0178fe96bd673c1dbb554f5d15',
  'linux-x64': '698e53b264a9bcd35cfa15cd680c4d78b0878fa529838844b5ffd0cd661d6bc2',
  'linux-arm64': 'fb983ec85952513f5f013674fcbf4306b1a142c50fcfd914c2c3f00c61a874b0',
};

// Platform-specific critical packages that must be bundled
// pywin32 is platform-critical for Windows (ACS-306) - required by MCP library
// secretstorage is platform-critical for Linux (ACS-310) - required for OAuth token storage
// NOTE: python-env-manager.ts treats secretstorage as optional (falls back to .env)
// while this script validates it during build to ensure it's bundled
const PLATFORM_CRITICAL_PACKAGES = {
  'win32': ['pywintypes'],   // Check for 'pywintypes' instead of 'pywin32' (pywin32 installs top-level modules)
  'linux': ['secretstorage'] // Linux OAuth token storage via Freedesktop.org Secret Service
};

// Map Node.js platform names to electron-builder platform names
function toElectronBuilderPlatform(nodePlatform) {
  const map = {
    'darwin': 'mac',
    'win32': 'win',
    'linux': 'linux',
  };
  return map[nodePlatform] || nodePlatform;
}

/**
 * Get the download URL for a specific platform/arch combination.
 * python-build-standalone uses specific naming conventions.
 *
 * @param {string} platform - Node.js platform (darwin, win32, linux)
 * @param {string} arch - Architecture (x64, arm64)
 */
function getDownloadInfo(platform, arch) {
  // Normalize platform to Node.js naming for internal lookups
  const nodePlatform = toNodePlatform(platform);
  const version = PYTHON_VERSION;

  // Map platform/arch to python-build-standalone naming
  const configs = {
    'darwin-arm64': {
      filename: `cpython-${version}+${RELEASE_TAG}-aarch64-apple-darwin-install_only_stripped.tar.gz`,
      extractDir: 'python',
    },
    'darwin-x64': {
      filename: `cpython-${version}+${RELEASE_TAG}-x86_64-apple-darwin-install_only_stripped.tar.gz`,
      extractDir: 'python',
    },
    'win32-x64': {
      filename: `cpython-${version}+${RELEASE_TAG}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`,
      extractDir: 'python',
    },
    'linux-x64': {
      filename: `cpython-${version}+${RELEASE_TAG}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`,
      extractDir: 'python',
    },
    'linux-arm64': {
      filename: `cpython-${version}+${RELEASE_TAG}-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz`,
      extractDir: 'python',
    },
  };

  const key = `${nodePlatform}-${arch}`;
  const config = configs[key];

  if (!config) {
    throw new Error(`Unsupported platform/arch combination: ${key}. Supported: ${Object.keys(configs).join(', ')}`);
  }

  // Use electron-builder platform naming for output directory
  const ebPlatform = toElectronBuilderPlatform(nodePlatform);

  return {
    url: `${BASE_URL}/${config.filename}`,
    filename: config.filename,
    extractDir: config.extractDir,
    outputDir: `${ebPlatform}-${arch}`,  // e.g., "mac-arm64", "win-x64", "linux-x64"
    nodePlatform,  // For internal checks (darwin, win32, linux)
    checksum: CHECKSUMS[key],
  };
}

/**
 * Download a file from URL to destination path.
 * Includes timeout handling, redirect limits, and proper cleanup.
 */
function downloadFile(url, destPath) {
  const DOWNLOAD_TIMEOUT = 300000; // 5 minutes
  const MAX_REDIRECTS = 10;

  return new Promise((resolve, reject) => {
    console.log(`[download-python] Downloading from: ${url}`);

    let file = null;
    let redirectCount = 0;
    let currentRequest = null;

    const cleanup = () => {
      if (file) {
        file.close();
        file = null;
      }
      if (fs.existsSync(destPath)) {
        try {
          fs.unlinkSync(destPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    };

    const request = (urlString) => {
      if (++redirectCount > MAX_REDIRECTS) {
        cleanup();
        reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));
        return;
      }

      // Create file stream only on first request
      if (!file) {
        file = fs.createWriteStream(destPath);
      }

      currentRequest = https.get(urlString, { timeout: DOWNLOAD_TIMEOUT }, (response) => {
        // Handle redirects (GitHub uses them)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log(`[download-python] Following redirect...`);
          response.resume(); // Consume response to free up memory
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          cleanup();
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        let lastPercent = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const percent = Math.floor((downloadedSize / totalSize) * 100);
            if (percent >= lastPercent + 10) {
              console.log(`[download-python] Progress: ${percent}%`);
              lastPercent = percent;
            }
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          file = null;
          console.log(`[download-python] Download complete: ${destPath}`);
          resolve();
        });

        file.on('error', (err) => {
          cleanup();
          reject(err);
        });
      });

      currentRequest.on('error', (err) => {
        cleanup();
        reject(err);
      });

      currentRequest.on('timeout', () => {
        currentRequest.destroy();
        cleanup();
        reject(new Error(`Download timeout after ${DOWNLOAD_TIMEOUT / 1000} seconds`));
      });
    };

    request(url);
  });
}

/**
 * Verify file checksum.
 */
function verifyChecksum(filePath, expectedChecksum) {
  if (!expectedChecksum) {
    console.log(`[download-python] Warning: No checksum available for verification`);
    return true;
  }

  console.log(`[download-python] Verifying checksum...`);
  const fileBuffer = fs.readFileSync(filePath);
  const hash = nodeCrypto.createHash('sha256').update(fileBuffer).digest('hex');

  if (hash !== expectedChecksum) {
    throw new Error(`Checksum mismatch! Expected: ${expectedChecksum}, Got: ${hash}`);
  }

  console.log(`[download-python] Checksum verified: ${hash.substring(0, 16)}...`);
  return true;
}

/**
 * Extract a tar.gz file using spawnSync for safety.
 */
function extractTarGz(archivePath, destDir) {
  console.log(`[download-python] Extracting to: ${destDir}`);

  // Ensure destination exists
  fs.mkdirSync(destDir, { recursive: true });

  const isWindows = os.platform() === 'win32';

  // On Windows, use Windows' built-in bsdtar (not Git Bash tar which has path issues)
  // Git Bash's /usr/bin/tar interprets D: as a remote host, causing extraction to fail
  // Windows Server 2019+ and Windows 10+ have bsdtar at %SystemRoot%\System32\tar.exe
  if (isWindows) {
    // Use explicit path to Windows tar to avoid Git Bash's /usr/bin/tar
    // Use SystemRoot environment variable to handle non-standard Windows installations
    const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const windowsTar = path.join(systemRoot, 'System32', 'tar.exe');

    const result = spawnSync(windowsTar, ['-xzf', archivePath, '-C', destDir], {
      stdio: 'inherit',
    });

    if (result.error) {
      throw new Error(`Failed to extract archive: ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(`Failed to extract archive: Windows tar exited with code ${result.status}`);
    }
  } else {
    // Unix: use tar directly
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], {
      stdio: 'inherit',
    });

    if (result.error) {
      throw new Error(`Failed to extract archive: ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(`Failed to extract archive: tar exited with code ${result.status}`);
    }
  }

  console.log(`[download-python] Extraction complete`);
}

/**
 * Verify Python binary works by checking its version.
 */
function verifyPythonBinary(pythonBin) {
  const result = spawnSync(pythonBin, ['--version'], { encoding: 'utf-8' });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Python verification failed with exit code ${result.status}`);
  }

  // Version output may be on stdout or stderr depending on Python version
  const version = (result.stdout || result.stderr || '').trim();
  return version;
}

/**
 * Get the size of a directory in bytes.
 */
function getDirectorySize(dirPath) {
  let totalSize = 0;

  function walkDir(currentPath) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const stats = fs.statSync(fullPath);
            totalSize += stats.size;
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  walkDir(dirPath);
  return totalSize;
}

/**
 * Format bytes to human readable string.
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hasPackage(sitePackagesDir, pkg) {
  const pkgPath = path.join(sitePackagesDir, pkg);
  const initPath = path.join(pkgPath, '__init__.py');
  const moduleFile = path.join(sitePackagesDir, pkg + '.py');
  return (fs.existsSync(pkgPath) && fs.existsSync(initPath)) || fs.existsSync(moduleFile);
}

function hasPydanticCoreBinary(sitePackagesDir) {
  const pkgDir = path.join(sitePackagesDir, 'pydantic_core');
  if (!fs.existsSync(pkgDir)) return false;

  let entries;
  try {
    entries = fs.readdirSync(pkgDir);
  } catch {
    return false;
  }
  return entries.some((name) => {
    if (!name.startsWith('_pydantic_core')) return false;
    const lower = name.toLowerCase();
    return lower.endsWith('.so') || lower.endsWith('.pyd') || lower.endsWith('.dylib');
  });
}

function getPinnedPydanticCoreVersion(sitePackagesDir) {
  let entries;
  try {
    entries = fs.readdirSync(sitePackagesDir);
  } catch {
    return null;
  }

  const distInfo = entries.find((entry) => {
    return entry.startsWith('pydantic-')
      && !entry.startsWith('pydantic_core-')
      && entry.endsWith('.dist-info');
  });
  if (!distInfo) return null;

  const metadataPath = path.join(sitePackagesDir, distInfo, 'METADATA');
  if (!fs.existsSync(metadataPath)) return null;

  let metadata;
  try {
    metadata = fs.readFileSync(metadataPath, 'utf-8');
  } catch {
    return null;
  }

  for (const line of metadata.split(/\r?\n/)) {
    if (!line.startsWith('Requires-Dist: pydantic-core')) continue;
    const match = line.match(/pydantic-core==([0-9A-Za-z.+-]+)/);
    if (match) return match[1];
  }

  return null;
}

function isCriticalPackageMissing(sitePackagesDir, pkg) {
  if (pkg === 'pydantic_core') {
    return !hasPackage(sitePackagesDir, pkg) || !hasPydanticCoreBinary(sitePackagesDir);
  }
  return !hasPackage(sitePackagesDir, pkg);
}

/**
 * Strip unnecessary files from site-packages to reduce bundle size.
 * This removes tests, docs, cache files, and other non-essential content.
 */
function stripSitePackages(sitePackagesDir) {
  console.log(`[download-python] Stripping unnecessary files from site-packages...`);

  const sizeBefore = getDirectorySize(sitePackagesDir);
  let removedCount = 0;

  // First, remove specific package paths (e.g., googleapiclient/discovery_cache/documents)
  // Use try/catch instead of existsSync to avoid TOCTOU race conditions
  if (STRIP_PATTERNS.packagePaths) {
    for (const pkgPath of STRIP_PATTERNS.packagePaths) {
      const fullPath = path.join(sitePackagesDir, pkgPath);
      try {
        // Get size first (may throw ENOENT if path doesn't exist)
        let pathSize = 0;
        try {
          pathSize = getDirectorySize(fullPath);
        } catch {
          // Path doesn't exist or can't get size - skip
          continue;
        }
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`[download-python] Removed ${pkgPath} (${formatBytes(pathSize)})`);
        removedCount++;
      } catch (err) {
        // ENOENT means file was already gone - not an error
        if (err.code !== 'ENOENT') {
          console.warn(`[download-python] Failed to remove ${pkgPath}: ${err.message}`);
        }
      }
    }
  }

  function shouldRemoveDir(name) {
    return STRIP_PATTERNS.dirs.includes(name.toLowerCase());
  }

  function shouldRemoveFile(name) {
    const lowerName = name.toLowerCase();

    // Check exact file matches
    if (STRIP_PATTERNS.files.includes(name) || STRIP_PATTERNS.files.includes(lowerName)) {
      return true;
    }

    // Check extensions
    for (const ext of STRIP_PATTERNS.extensions) {
      if (lowerName.endsWith(ext)) {
        // Preserve LICENSE files
        if (lowerName.includes('license')) {
          return false;
        }
        return true;
      }
    }

    return false;
  }

  function walkAndStrip(currentPath) {
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (shouldRemoveDir(entry.name)) {
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            removedCount++;
          } catch {
            // Ignore removal errors
          }
        } else {
          walkAndStrip(fullPath);
        }
      } else if (entry.isFile()) {
        if (shouldRemoveFile(entry.name)) {
          try {
            fs.unlinkSync(fullPath);
            removedCount++;
          } catch {
            // Ignore removal errors
          }
        }
      }
    }
  }

  walkAndStrip(sitePackagesDir);

  const sizeAfter = getDirectorySize(sitePackagesDir);
  const savedPercent = ((sizeBefore - sizeAfter) / sizeBefore * 100).toFixed(1);

  console.log(`[download-python] Stripped ${removedCount} files/dirs`);
  console.log(`[download-python] Size reduced: ${formatBytes(sizeBefore)} → ${formatBytes(sizeAfter)} (saved ${savedPercent}%)`);
}

/**
 * Check for blocked packages in requirements and warn.
 */
function checkForBlockedPackages(requirementsPath) {
  const content = fs.readFileSync(requirementsPath, 'utf-8');
  const lines = content.split('\n');
  const blocked = [];

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Extract package name (before any version specifier)
    const pkgName = trimmed.split(/[<>=!@[]/)[0].trim();

    for (const blockedPkg of STRIP_PATTERNS.blockedPackages) {
      if (pkgName === blockedPkg || pkgName.startsWith(`${blockedPkg}-`)) {
        blocked.push(pkgName);
      }
    }
  }

  if (blocked.length > 0) {
    console.warn(`\n[download-python] ⚠️  WARNING: Large packages detected in requirements:`);
    for (const pkg of blocked) {
      console.warn(`[download-python]    - ${pkg} (consider making this an on-demand install)`);
    }
    console.warn(`[download-python] These packages may significantly increase app size.\n`);
  }

  return blocked;
}

/**
 * Fix pywin32 installation for bundled packages.
 *
 * When pip installs pywin32 with --target, the post-install script doesn't run,
 * and the .pth file isn't processed (since PYTHONPATH doesn't process .pth files).
 *
 * This means:
 * 1. `import pywintypes` fails because pywintypes.py is in win32/lib/, not at root
 * 2. `import _win32sysloader` fails because it's in win32/, not at root
 * 3. pywin32_system32 needs an __init__.py to be importable as a package
 *
 * The fix copies the necessary files to site-packages root so they're directly importable.
 */
function fixPywin32(sitePackagesDir) {
  const pywin32System32 = path.join(sitePackagesDir, 'pywin32_system32');
  const win32Dir = path.join(sitePackagesDir, 'win32');
  const win32LibDir = path.join(win32Dir, 'lib');

  if (!fs.existsSync(pywin32System32)) {
    // pywin32 not installed or not on Windows - nothing to fix
    return;
  }

  console.log(`[download-python] Fixing pywin32 for bundled packages...`);

  // 1. Copy pywintypes.py and pythoncom.py from win32/lib/ to root
  // These are the Python modules that load the DLLs
  const pyModules = ['pywintypes.py', 'pythoncom.py'];
  for (const pyModule of pyModules) {
    const srcPath = path.join(win32LibDir, pyModule);
    const destPath = path.join(sitePackagesDir, pyModule);

    if (fs.existsSync(srcPath)) {
      try {
        fs.copyFileSync(srcPath, destPath);
        console.log(`[download-python] Copied ${pyModule} to site-packages root`);
      } catch (err) {
        console.warn(`[download-python] Failed to copy ${pyModule}: ${err.message}`);
      }
    }
  }

  // 2. Copy _win32sysloader.pyd from win32/ to root
  // This is required by pywintypes.py to locate and load the DLLs
  // Filter for .pyd extension to avoid matching unrelated files
  if (!fs.existsSync(win32Dir)) {
    console.warn(`[download-python] win32 directory not found: ${win32Dir}`);
    return;
  }
  const sysloaderFiles = fs.readdirSync(win32Dir).filter(f => f.startsWith('_win32sysloader') && f.endsWith('.pyd'));
  for (const sysloader of sysloaderFiles) {
    const srcPath = path.join(win32Dir, sysloader);
    const destPath = path.join(sitePackagesDir, sysloader);

    try {
      fs.copyFileSync(srcPath, destPath);
      console.log(`[download-python] Copied ${sysloader} to site-packages root`);
    } catch (err) {
      console.warn(`[download-python] Failed to copy ${sysloader}: ${err.message}`);
    }
  }

  // 3. Create __init__.py in pywin32_system32/ to make it importable as a package
  // pywintypes.py does `import pywin32_system32` and then uses pywin32_system32.__path__
  const initPath = path.join(pywin32System32, '__init__.py');
  try {
    // The __init__.py sets up __path__ so pywintypes.py can find the DLLs
    const initContent = `# Auto-generated for bundled pywin32
import os
__path__ = [os.path.dirname(__file__)]
`;
    // Use 'wx' flag for atomic exclusive write - fails if file exists (EEXIST)
    // This avoids TOCTOU race condition where existsSync + writeFileSync could
    // allow another process to create/modify the file between check and write.
    // See: https://nodejs.org/api/fs.html#file-system-flags
    fs.writeFileSync(initPath, initContent, { flag: 'wx' });
    console.log(`[download-python] Created pywin32_system32/__init__.py`);
  } catch (err) {
    // EEXIST means file already exists - that's fine, we wanted to avoid overwriting
    if (err.code !== 'EEXIST') {
      console.warn(`[download-python] Failed to create __init__.py: ${err.message}`);
    }
  }

  // 4. Copy DLLs to multiple locations for maximum compatibility
  //
  // Why we copy DLLs to pywin32_system32/, win32/, AND site-packages root:
  // - pywin32_system32/: Primary location, used by os.add_dll_directory() in bootstrap
  // - win32/: Fallback for pywintypes.py's __file__-relative search
  // - site-packages root: Fallback when other search mechanisms fail
  //
  // Trade-off: This duplicates DLLs ~3x (~2MB extra), but ensures pywin32 works
  // regardless of which DLL search mechanism succeeds. The alternative (single
  // location) caused intermittent failures depending on Python version and how
  // the process was spawned. Bundle size trade-off is acceptable for reliability.
  //
  // See: https://github.com/AndyMik90/Auto-Claude/issues/810
  const dllFiles = fs.readdirSync(pywin32System32).filter(f => f.endsWith('.dll'));
  for (const dll of dllFiles) {
    const srcPath = path.join(pywin32System32, dll);
    const destPath = path.join(win32Dir, dll);

    try {
      fs.copyFileSync(srcPath, destPath);
      console.log(`[download-python] Copied ${dll} to win32/`);
    } catch (err) {
      console.warn(`[download-python] Failed to copy ${dll} to win32/: ${err.message}`);
    }
  }

  // 5. Also copy DLLs to site-packages root for maximum compatibility
  for (const dll of dllFiles) {
    const srcPath = path.join(pywin32System32, dll);
    const destPath = path.join(sitePackagesDir, dll);

    try {
      fs.copyFileSync(srcPath, destPath);
      console.log(`[download-python] Copied ${dll} to site-packages root`);
    } catch (err) {
      console.warn(`[download-python] Failed to copy ${dll}: ${err.message}`);
    }
  }

  // Note: We intentionally do NOT create a PYTHONSTARTUP bootstrap script.
  // PYTHONSTARTUP only runs in interactive Python mode (python REPL), NOT when
  // running scripts (python script.py). Since all our Python invocations pass
  // scripts as arguments, PYTHONSTARTUP would never execute.
  //
  // The DLL copying above (steps 4 and 5) is what actually makes pywin32 work -
  // it places DLLs in locations where Python's default DLL search finds them.
  // The PATH modification in python-env-manager.ts provides an additional fallback.
  //
  // See: https://docs.python.org/3/using/cmdline.html (PYTHONSTARTUP documentation)

  console.log(`[download-python] pywin32 fix complete`);
}

/**
 * Install Python packages into a site-packages directory.
 * Uses pip with optimizations for smaller output.
 */
function installPackages(pythonBin, requirementsPath, targetSitePackages) {
  console.log(`[download-python] Installing packages from: ${requirementsPath}`);
  console.log(`[download-python] Target: ${targetSitePackages}`);

  // Check for blocked packages first
  checkForBlockedPackages(requirementsPath);

  // Ensure target directory exists
  fs.mkdirSync(targetSitePackages, { recursive: true });

  // Install packages directly to target directory
  // --no-compile: Don't create .pyc files (saves space, Python will work without them)
  // --target: Install to specific directory
  // --only-binary: Force binary wheels for pydantic (prevents silent source build failures)
  // Note: We intentionally DO use pip's cache to preserve built wheels for packages
  // like real_ladybug that must be compiled from source on Intel Mac (no PyPI wheel)
  const pipArgs = [
    '-m', 'pip', 'install',
    '--no-compile',
    '--only-binary', 'pydantic,pydantic-core',
    '--target', targetSitePackages,
    '-r', requirementsPath,
  ];

  console.log(`[download-python] Running: ${pythonBin} ${pipArgs.join(' ')}`);

  const result = spawnSync(pythonBin, pipArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Disable bytecode writing
      PYTHONDONTWRITEBYTECODE: '1',
      // Use UTF-8 encoding
      PYTHONIOENCODING: 'utf-8',
    },
  });

  if (result.error) {
    throw new Error(`Failed to run pip: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`pip install failed with exit code ${result.status}`);
  }

  console.log(`[download-python] Packages installed successfully`);

  // Fix pywin32 for Windows builds (must be done BEFORE stripping)
  fixPywin32(targetSitePackages);

  // Strip unnecessary files
  stripSitePackages(targetSitePackages);

  if (!hasPydanticCoreBinary(targetSitePackages)) {
    console.warn('[download-python] pydantic_core binary missing after strip; reinstalling pydantic-core...');
    const pinnedVersion = getPinnedPydanticCoreVersion(targetSitePackages);
    const coreSpec = pinnedVersion ? `pydantic-core==${pinnedVersion}` : 'pydantic-core';
    if (pinnedVersion) {
      console.log(`[download-python] Reinstalling pydantic-core ${pinnedVersion} to match pydantic metadata`);
    } else {
      console.warn('[download-python] Unable to determine pydantic-core pin; reinstalling latest');
    }
    const pipArgs = [
      '-m', 'pip', 'install',
      '--no-compile',
      '--only-binary', 'pydantic-core',
      '--no-deps',
      '--target', targetSitePackages,
      coreSpec,
    ];
    const result = spawnSync(pythonBin, pipArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    if (result.error) {
      throw new Error(`Failed to reinstall pydantic-core: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`pydantic-core reinstall failed with exit code ${result.status}`);
    }

    if (!hasPydanticCoreBinary(targetSitePackages)) {
      throw new Error('pydantic_core binary missing after reinstall');
    }
  }

  // Remove bin/Scripts directory (we don't need console scripts)
  const binDir = path.join(targetSitePackages, 'bin');
  const scriptsDir = path.join(targetSitePackages, 'Scripts');
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true, force: true });
    console.log(`[download-python] Removed bin/ directory`);
  }
  if (fs.existsSync(scriptsDir)) {
    fs.rmSync(scriptsDir, { recursive: true, force: true });
    console.log(`[download-python] Removed Scripts/ directory`);
  }

  const finalSize = getDirectorySize(targetSitePackages);
  console.log(`[download-python] Final site-packages size: ${formatBytes(finalSize)}`);
}

/**
 * Main function to download and set up Python.
 * Downloads Python binary and installs all dependencies into site-packages.
 *
 * @param {string} targetPlatform - Target platform (darwin, win32, linux)
 * @param {string} targetArch - Target architecture (x64, arm64)
 * @param {Object} options - Additional options
 * @param {boolean} options.skipPackages - Skip package installation (just download Python)
 * @param {string} options.requirementsPath - Custom path to requirements.txt
 */
async function downloadPython(targetPlatform, targetArch, options = {}) {
  const platform = targetPlatform || os.platform();
  const arch = targetArch || os.arch();
  const { skipPackages = false, requirementsPath: customRequirementsPath } = options;

  const info = getDownloadInfo(platform, arch);
  console.log(`[download-python] Setting up Python ${PYTHON_VERSION} for ${info.outputDir}`);

  const frontendDir = path.join(__dirname, '..');
  const runtimeDir = path.join(frontendDir, OUTPUT_DIR);
  const platformDir = path.join(runtimeDir, info.outputDir);

  // Paths for Python binary and site-packages
  const pythonBin = info.nodePlatform === 'win32'
    ? path.join(platformDir, 'python', 'python.exe')
    : path.join(platformDir, 'python', 'bin', 'python3');

  const sitePackagesDir = path.join(platformDir, 'site-packages');

  // Path to requirements.txt (in backend directory)
  const requirementsPath = customRequirementsPath || path.join(frontendDir, '..', 'backend', 'requirements.txt');

  // Check if already fully set up (Python + packages)
  const packagesMarker = path.join(sitePackagesDir, '.bundled');
  if (fs.existsSync(pythonBin) && fs.existsSync(packagesMarker)) {
    console.log(`[download-python] Python and packages already bundled at ${platformDir}`);

    // Verify Python works
    try {
      const version = verifyPythonBinary(pythonBin);
      console.log(`[download-python] Verified: ${version}`);

      // Verify critical packages exist (fixes GitHub issue #416)
      // Without this check, corrupted caches with missing packages would be accepted
      // This validation assumes traditional Python packages with __init__.py (not PEP 420 namespace packages)
      // NOTE: python-env-manager.ts treats secretstorage as optional (falls back to .env)
      // while this script validates it during build to ensure it's bundled
      const criticalPackages = ['claude_agent_sdk', 'dotenv', 'pydantic_core']
        .concat(PLATFORM_CRITICAL_PACKAGES[info.nodePlatform] || []);
      const missingPackages = criticalPackages.filter(pkg => isCriticalPackageMissing(sitePackagesDir, pkg));

      if (missingPackages.length > 0) {
        console.log(`[download-python] Critical packages missing or incomplete: ${missingPackages.join(', ')}`);
        console.log(`[download-python] Reinstalling packages...`);
        // Remove site-packages to force reinstall, keep Python binary
        // Flow continues below to re-install packages (skipPackages check at line 794)
        fs.rmSync(sitePackagesDir, { recursive: true, force: true });
      } else {
        console.log(`[download-python] All critical packages verified`);
        return { success: true, pythonPath: pythonBin, sitePackagesPath: sitePackagesDir };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(`[download-python] Existing installation is broken: ${errorMsg}`);
      fs.rmSync(platformDir, { recursive: true, force: true });
    }
  }

  // Check if just Python exists (need to install packages)
  let needsPythonDownload = !fs.existsSync(pythonBin);

  if (fs.existsSync(pythonBin)) {
    // Verify existing Python
    try {
      const version = verifyPythonBinary(pythonBin);
      console.log(`[download-python] Found existing Python: ${version}`);
      needsPythonDownload = false;
    } catch {
      console.log(`[download-python] Existing Python is broken, re-downloading...`);
      fs.rmSync(platformDir, { recursive: true, force: true });
      needsPythonDownload = true;
    }
  }

  if (needsPythonDownload) {
    // Create directories
    fs.mkdirSync(platformDir, { recursive: true });

    // Download
    const archivePath = path.join(runtimeDir, info.filename);
    let needsDownload = true;

    if (fs.existsSync(archivePath)) {
      console.log(`[download-python] Found cached archive: ${archivePath}`);
      // Verify cached archive checksum
      try {
        verifyChecksum(archivePath, info.checksum);
        needsDownload = false;
      } catch (err) {
        console.log(`[download-python] Cached archive failed verification: ${err.message}`);
        fs.unlinkSync(archivePath);
      }
    }

    if (needsDownload) {
      await downloadFile(info.url, archivePath);
      // Verify downloaded file
      verifyChecksum(archivePath, info.checksum);
    }

    // Extract
    extractTarGz(archivePath, platformDir);

    // Verify binary exists
    if (!fs.existsSync(pythonBin)) {
      throw new Error(`Python binary not found after extraction: ${pythonBin}`);
    }

    // Make executable on Unix
    if (info.nodePlatform !== 'win32') {
      fs.chmodSync(pythonBin, 0o755);
    }

    // Verify it works
    const version = verifyPythonBinary(pythonBin);
    console.log(`[download-python] Installed Python: ${version}`);
  }

  // Install packages unless skipped
  if (!skipPackages) {
    if (!fs.existsSync(requirementsPath)) {
      console.warn(`[download-python] Warning: requirements.txt not found at ${requirementsPath}`);
      console.warn(`[download-python] Skipping package installation`);
    } else {
      // Remove existing site-packages to ensure clean install
      if (fs.existsSync(sitePackagesDir)) {
        console.log(`[download-python] Removing existing site-packages...`);
        fs.rmSync(sitePackagesDir, { recursive: true, force: true });
      }

      // Install packages
      installPackages(pythonBin, requirementsPath, sitePackagesDir);

      // Verify critical packages were installed before creating marker (fixes #416)
      // This validation assumes traditional Python packages with __init__.py (not PEP 420 namespace packages)
      // NOTE: python-env-manager.ts treats secretstorage as optional (falls back to .env)
      // while this script validates it during build to ensure it's bundled
      const criticalPackages = ['claude_agent_sdk', 'dotenv', 'pydantic_core']
        .concat(PLATFORM_CRITICAL_PACKAGES[info.nodePlatform] || []);
      const postInstallMissing = criticalPackages.filter(pkg => isCriticalPackageMissing(sitePackagesDir, pkg));

      if (postInstallMissing.length > 0) {
        throw new Error(`Package installation failed - missing critical packages: ${postInstallMissing.join(', ')}`);
      }

      console.log(`[download-python] All critical packages verified after installation`);

      // Create marker file to indicate successful bundling
      fs.writeFileSync(packagesMarker, JSON.stringify({
        bundledAt: new Date().toISOString(),
        pythonVersion: PYTHON_VERSION,
        platform: info.nodePlatform,
        arch: arch,
      }, null, 2));

      console.log(`[download-python] Created bundle marker: ${packagesMarker}`);
    }
  }

  return { success: true, pythonPath: pythonBin, sitePackagesPath: sitePackagesDir };
}

/**
 * Download Python for all platforms (for CI/CD builds).
 */
async function downloadAllPlatforms() {
  const platforms = [
    { platform: 'darwin', arch: 'arm64' },
    { platform: 'darwin', arch: 'x64' },
    { platform: 'win32', arch: 'x64' },
    { platform: 'linux', arch: 'x64' },
    { platform: 'linux', arch: 'arm64' },
  ];

  console.log(`[download-python] Downloading Python for all platforms...`);

  for (const { platform, arch } of platforms) {
    try {
      await downloadPython(platform, arch);
    } catch (error) {
      console.error(`[download-python] Failed for ${platform}-${arch}: ${error.message}`);
      throw error;
    }
  }

  console.log(`[download-python] All platforms downloaded successfully!`);
}

// Valid platforms and architectures (for input validation)
const VALID_PLATFORMS = ['darwin', 'mac', 'win32', 'win', 'linux'];
const VALID_ARCHS = ['x64', 'arm64'];

/**
 * Validate and sanitize CLI input to prevent log injection.
 */
function validateInput(value, validValues, name) {
  if (value === null) return null;

  // Remove any control characters or newlines (ASCII 0-31 and 127)
  // eslint-disable-next-line no-control-regex
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional - sanitizing input by removing control characters
  const sanitized = String(value).replace(/[\x00-\x1f\x7f]/g, '');

  if (!validValues.includes(sanitized)) {
    throw new Error(`Invalid ${name}: "${sanitized}". Valid values: ${validValues.join(', ')}`);
  }

  return sanitized;
}

// CLI handling
async function main() {
  const args = process.argv.slice(2);

  let platform = null;
  let arch = null;
  let allPlatforms = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) {
      platform = args[++i];
    } else if (args[i] === '--arch' && args[i + 1]) {
      arch = args[++i];
    } else if (args[i] === '--all') {
      allPlatforms = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: node download-python.cjs [options]

Options:
  --platform <platform>  Target platform (darwin/mac, win32/win, linux)
  --arch <arch>          Target architecture (x64, arm64)
  --all                  Download for all supported platforms
  --help, -h             Show this help message

If no options specified, downloads for the current platform/arch.

Examples:
  node download-python.cjs                           # Current platform
  node download-python.cjs --platform darwin --arch arm64
  node download-python.cjs --platform mac --arch arm64  # Electron-builder style
  node download-python.cjs --all                     # All platforms (for CI)
`);
      process.exit(0);
    }
  }

  try {
    // Validate inputs before use
    platform = validateInput(platform, VALID_PLATFORMS, 'platform');
    arch = validateInput(arch, VALID_ARCHS, 'arch');

    if (allPlatforms) {
      await downloadAllPlatforms();
    } else {
      await downloadPython(platform, arch);
    }
    console.log('[download-python] Done!');
  } catch (error) {
    console.error(`[download-python] Error: ${error.message}`);
    process.exit(1);
  }
}

// Export for use in other scripts
module.exports = { downloadPython, downloadAllPlatforms, getDownloadInfo };

// Run if called directly
if (require.main === module) {
  main();
}
