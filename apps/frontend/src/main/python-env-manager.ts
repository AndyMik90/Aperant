import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { app } from 'electron';
import { findPythonCommand, getBundledPythonPath } from './python-detector';
import { isLinux, isWindows, getPathDelimiter } from './platform';
import { getIsolatedGitEnv } from './utils/git-isolation';
import { normalizeEnvPathKey } from './agent/env-utils';

export interface PythonEnvStatus {
  ready: boolean;
  pythonPath: string | null;
  sitePackagesPath: string | null;
  venvExists: boolean;
  depsInstalled: boolean;
  usingBundledPackages: boolean;
  error?: string;
}

/**
 * Manages the Python environment for the auto-claude backend.
 *
 * For packaged apps:
 *   - Uses bundled Python binary (resources/python/)
 *   - Uses bundled site-packages (resources/python-site-packages/)
 *   - No venv creation or pip install needed - everything is pre-bundled
 *
 * For development mode:
 *   - Creates venv in the source directory
 *   - Installs dependencies via pip
 *
 * On packaged apps (especially Linux AppImages), the bundled source is read-only,
 * so for dev mode fallback we create the venv in userData instead.
 */
export class PythonEnvManager extends EventEmitter {
  private autoBuildSourcePath: string | null = null;
  private pythonPath: string | null = null;
  private sitePackagesPath: string | null = null;
  private usingBundledPackages = false;
  private isInitializing = false;
  private isReady = false;
  private initializationPromise: Promise<PythonEnvStatus> | null = null;
  private activeProcesses: Set<ChildProcess> = new Set();
  private static readonly VENV_CREATION_TIMEOUT_MS = 120000; // 2 minutes timeout for venv creation

  /**
   * Get the path where the venv should be created.
   * For packaged apps, this is in userData to avoid read-only filesystem issues.
   * For development, this is inside the source directory.
   */
  private getVenvBasePath(): string | null {
    if (!this.autoBuildSourcePath) return null;

    // For packaged apps, put venv in userData (writable location)
    // This fixes Linux AppImage where resources are read-only
    if (app.isPackaged) {
      return path.join(app.getPath('userData'), 'python-venv');
    }

    // Development mode - use source directory
    return path.join(this.autoBuildSourcePath, '.venv');
  }

  /**
   * Get the path to the venv Python executable
   */
  private getVenvPythonPath(): string | null {
    const venvPath = this.getVenvBasePath();
    if (!venvPath) return null;

    const venvPython =
      isWindows()
        ? path.join(venvPath, 'Scripts', 'python.exe')
        : path.join(venvPath, 'bin', 'python');

    return venvPython;
  }

  /**
   * Get the path to pip in the venv
   * Returns null - we use python -m pip instead for better compatibility
   * @deprecated Use getVenvPythonPath() with -m pip instead
   */
  private getVenvPipPath(): string | null {
    return null; // Not used - we use python -m pip
  }

  /**
   * Check if venv exists
   */
  private venvExists(): boolean {
    const venvPython = this.getVenvPythonPath();
    return venvPython ? existsSync(venvPython) : false;
  }

  /**
   * Get the path to bundled site-packages (for packaged apps).
   * These are pre-installed during the build process.
   */
  private getBundledSitePackagesPath(): string | null {
    if (!app.isPackaged) {
      return null;
    }

    const sitePackagesPath = path.join(process.resourcesPath, 'python-site-packages');

    if (existsSync(sitePackagesPath)) {
      console.log(`[PythonEnvManager] Found bundled site-packages at: ${sitePackagesPath}`);
      return sitePackagesPath;
    }

    console.log(`[PythonEnvManager] Bundled site-packages not found at: ${sitePackagesPath}`);
    return null;
  }

  /**
   * Check if bundled packages are available and valid.
   * For packaged apps, we check if the bundled site-packages directory exists
   * and contains the marker file indicating successful bundling.
   */
  private hasBundledPackages(): boolean {
    const sitePackagesPath = this.getBundledSitePackagesPath();
    if (!sitePackagesPath) {
      return false;
    }

    // Critical packages that must exist for proper functionality
    // This fixes GitHub issue #416 where marker exists but packages are missing
    // Note: Same list exists in download-python.cjs - keep them in sync
    // This validation assumes traditional Python packages with __init__.py (not PEP 420 namespace packages)
    // pywin32 is platform-critical for Windows (ACS-306) - required by MCP library
    const platformCriticalPackages: Record<string, string[]> = {
      win32: ['pywintypes'] // Check for 'pywintypes' instead of 'pywin32' (pywin32 installs top-level modules)
    };
    // secretstorage is optional for Linux (ACS-310) - nice to have for keyring integration
    // but app falls back to .env file storage if missing, so don't block bundled packages
    const platformOptionalPackages: Record<string, string[]> = {
      linux: ['secretstorage'] // Linux OAuth token storage via Freedesktop.org Secret Service
    };

    const criticalPackages = [
      'claude_agent_sdk',
      'dotenv',
      'pydantic_core',
      ...(isWindows() ? platformCriticalPackages.win32 : [])
    ];
    const optionalPackages = isLinux() ? platformOptionalPackages.linux : [];

    // Check each package exists with valid structure (directory + __init__.py or single-file module)
    const packageExists = (pkg: string): boolean => {
      const pkgPath = path.join(sitePackagesPath, pkg);
      const initPath = path.join(pkgPath, '__init__.py');
      // For single-file modules (like pywintypes.py), check for the file directly
      const moduleFile = path.join(sitePackagesPath, `${pkg}.py`);
      // Package is valid if directory+__init__.py exists OR single-file module exists
      return (existsSync(pkgPath) && existsSync(initPath)) || existsSync(moduleFile);
    };

    const missingPackages = criticalPackages.filter((pkg) => !packageExists(pkg));
    const missingOptional = optionalPackages.filter((pkg) => !packageExists(pkg));

    // Log missing packages for debugging
    for (const pkg of missingPackages) {
      console.log(
        `[PythonEnvManager] Missing critical package: ${pkg} at ${path.join(sitePackagesPath, pkg)}`
      );
    }
    // Log warnings for missing optional packages (non-blocking)
    for (const pkg of missingOptional) {
      console.warn(
        `[PythonEnvManager] Optional package missing: ${pkg} at ${path.join(sitePackagesPath, pkg)}`
      );
    }

    // All critical packages must exist - don't rely solely on marker file
    if (missingPackages.length === 0) {
      // Also check marker for logging purposes
      const markerPath = path.join(sitePackagesPath, '.bundled');
      if (existsSync(markerPath)) {
        console.log(`[PythonEnvManager] Found bundle marker and all critical packages`);
      } else {
        console.log(`[PythonEnvManager] Found critical packages (marker missing)`);
      }
      return true;
    }

    return false;
  }

  /**
   * Check if required dependencies are installed.
   * Verifies all packages that must be present for the backend to work.
   * This ensures users don't encounter broken functionality when using features.
   */
  private async checkDepsInstalled(): Promise<boolean> {
    const venvPython = this.getVenvPythonPath();
    if (!venvPython || !existsSync(venvPython)) return false;

    try {
      // Check all dependencies - if any fail, we need to reinstall
      // This prevents issues where partial installs leave some packages missing
      // See: https://github.com/AndyMik90/Auto-Claude/issues/359
      //
      // Dependencies checked:
      // - claude_agent_sdk: Core agent SDK (required)
      // - dotenv: Environment variable loading (required)
      // - google.generativeai: Google AI/Gemini support (required for full functionality)
      // - real_ladybug + graphiti_core: Graphiti memory system (Python 3.12+ only)
      const checkScript = `
import sys
import claude_agent_sdk
import dotenv
import google.generativeai
# Graphiti dependencies only available on Python 3.12+
if sys.version_info >= (3, 12):
    import real_ladybug
    import graphiti_core
`;
      execSync(`"${venvPython}" -c "${checkScript.replace(/\n/g, '; ').replace(/; ; /g, '; ')}"`, {
        stdio: 'pipe',
        timeout: 15000,
        encoding: 'utf-8'
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find Python 3.10+ (bundled or system).
   * Uses the shared python-detector logic which validates version requirements.
   * Priority: bundled Python (packaged apps) > system Python
   */
  private findSystemPython(): string | null {
    const pythonCmd = findPythonCommand();
    if (!pythonCmd) {
      return null;
    }

    // If this is the bundled Python path, use it directly
    const bundledPath = getBundledPythonPath();
    if (bundledPath && pythonCmd === bundledPath) {
      console.log(`[PythonEnvManager] Using bundled Python: ${bundledPath}`);
      return bundledPath;
    }

    try {
      // Get the actual executable path from the command
      // For commands like "py -3", we need to resolve to the actual executable
      const pythonPath = execSync(`${pythonCmd} -c "import sys; print(sys.executable)"`, {
        stdio: 'pipe',
        timeout: 5000,
        encoding: 'utf-8'
      }).trim();

      console.log(`[PythonEnvManager] Found Python at: ${pythonPath}`);
      return pythonPath;
    } catch (err) {
      console.error(`[PythonEnvManager] Failed to get Python path for ${pythonCmd}:`, err);
      return null;
    }
  }

  /**
   * Create the virtual environment
   */
  private async createVenv(): Promise<boolean> {
    if (!this.autoBuildSourcePath) return false;

    const systemPython = this.findSystemPython();
    if (!systemPython) {
      const isPackaged = app.isPackaged;
      const errorMsg = isPackaged
        ? 'Python not found. The bundled Python may be corrupted.\n\n' +
          'Please try reinstalling the application, or install Python 3.10+ manually:\n' +
          'https://www.python.org/downloads/'
        : 'Python 3.10+ not found. Please install Python 3.10 or higher.\n\n' +
          'This is required for development mode. Download from:\n' +
          'https://www.python.org/downloads/';
      this.emit('error', errorMsg);
      return false;
    }

    this.emit('status', 'Creating Python virtual environment...');
    const venvPath = this.getVenvBasePath()!;
    console.warn('[PythonEnvManager] Creating venv at:', venvPath, 'with:', systemPython);

    return new Promise((resolve) => {
      const proc = spawn(systemPython, ['-m', 'venv', venvPath], {
        cwd: this.autoBuildSourcePath!,
        stdio: 'pipe',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
      });

      // Track the process for cleanup on app exit
      this.activeProcesses.add(proc);

      let stderr = '';
      let resolved = false;

      // Set up timeout to kill hung venv creation
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.error('[PythonEnvManager] Venv creation timed out after', PythonEnvManager.VENV_CREATION_TIMEOUT_MS, 'ms');
          this.emit('error', 'Virtual environment creation timed out. This may indicate a system issue.');
          try {
            proc.kill();
          } catch {
            // Process may already be dead
          }
          this.activeProcesses.delete(proc);
          resolve(false);
        }
      }, PythonEnvManager.VENV_CREATION_TIMEOUT_MS);

      proc.stderr?.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      proc.on('close', (code) => {
        if (resolved) return; // Already handled by timeout
        resolved = true;
        clearTimeout(timeoutId);
        this.activeProcesses.delete(proc);

        if (code === 0) {
          console.warn('[PythonEnvManager] Venv created successfully');
          resolve(true);
        } else {
          console.error('[PythonEnvManager] Failed to create venv:', stderr);
          this.emit('error', `Failed to create virtual environment: ${stderr}`);
          resolve(false);
        }
      });

      proc.on('error', (err) => {
        if (resolved) return; // Already handled by timeout
        resolved = true;
        clearTimeout(timeoutId);
        this.activeProcesses.delete(proc);

        console.error('[PythonEnvManager] Error creating venv:', err);
        this.emit('error', `Failed to create virtual environment: ${err.message}`);
        resolve(false);
      });
    });
  }

  /**
   * Bootstrap pip in the venv using ensurepip
   */
  private async bootstrapPip(): Promise<boolean> {
    const venvPython = this.getVenvPythonPath();
    if (!venvPython || !existsSync(venvPython)) {
      return false;
    }

    console.warn('[PythonEnvManager] Bootstrapping pip...');
    return new Promise((resolve) => {
      const proc = spawn(venvPython, ['-m', 'ensurepip'], {
        cwd: this.autoBuildSourcePath!,
        stdio: 'pipe',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
      });

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.warn('[PythonEnvManager] Pip bootstrapped successfully');
          resolve(true);
        } else {
          console.error('[PythonEnvManager] Failed to bootstrap pip:', stderr);
          resolve(false);
        }
      });

      proc.on('error', (err) => {
        console.error('[PythonEnvManager] Error bootstrapping pip:', err);
        resolve(false);
      });
    });
  }

  /**
   * Install dependencies from requirements.txt using python -m pip
   */
  private async installDeps(): Promise<boolean> {
    if (!this.autoBuildSourcePath) return false;

    const venvPython = this.getVenvPythonPath();
    const requirementsPath = path.join(this.autoBuildSourcePath, 'requirements.txt');

    if (!venvPython || !existsSync(venvPython)) {
      this.emit('error', 'Python not found in virtual environment');
      return false;
    }

    if (!existsSync(requirementsPath)) {
      this.emit('error', 'requirements.txt not found');
      return false;
    }

    // Bootstrap pip first if needed
    await this.bootstrapPip();

    this.emit('status', 'Installing Python dependencies (this may take a minute)...');
    console.warn('[PythonEnvManager] Installing dependencies from:', requirementsPath);

    return new Promise((resolve) => {
      // Use python -m pip for better compatibility across Python versions
      const proc = spawn(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath], {
        cwd: this.autoBuildSourcePath!,
        stdio: 'pipe',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString('utf-8');
        // Emit progress updates for long-running installations
        const lines = data.toString('utf-8').split('\n');
        for (const line of lines) {
          if (line.includes('Installing') || line.includes('Successfully')) {
            this.emit('status', line.trim());
          }
        }
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.warn('[PythonEnvManager] Dependencies installed successfully');
          this.emit('status', 'Dependencies installed successfully');
          resolve(true);
        } else {
          console.error('[PythonEnvManager] Failed to install deps:', stderr || stdout);
          this.emit('error', `Failed to install dependencies: ${stderr || stdout}`);
          resolve(false);
        }
      });

      proc.on('error', (err) => {
        console.error('[PythonEnvManager] Error installing deps:', err);
        this.emit('error', `Failed to install dependencies: ${err.message}`);
        resolve(false);
      });
    });
  }

  /**
   * Initialize the Python environment.
   *
   * For packaged apps: Uses bundled Python + site-packages (no pip install needed)
   * For development: Creates venv and installs deps if needed.
   *
   * If initialization is already in progress, this will wait for and return
   * the existing initialization promise instead of starting a new one.
   */
  async initialize(autoBuildSourcePath: string): Promise<PythonEnvStatus> {
    // If there's already an initialization in progress, wait for it
    if (this.initializationPromise) {
      console.warn('[PythonEnvManager] Initialization already in progress, waiting...');
      return this.initializationPromise;
    }

    // If already ready and pointing to the same source, return cached status
    if (this.isReady && this.autoBuildSourcePath === autoBuildSourcePath) {
      return {
        ready: true,
        pythonPath: this.pythonPath,
        sitePackagesPath: this.sitePackagesPath,
        venvExists: true,
        depsInstalled: true,
        usingBundledPackages: this.usingBundledPackages
      };
    }

    // Start new initialization and store the promise
    this.initializationPromise = this._doInitialize(autoBuildSourcePath);

    try {
      return await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Internal initialization method that performs the actual setup.
   * This is separated from initialize() to support the promise queue pattern.
   */
  private async _doInitialize(autoBuildSourcePath: string): Promise<PythonEnvStatus> {
    this.isInitializing = true;
    this.autoBuildSourcePath = autoBuildSourcePath;

    console.warn('[PythonEnvManager] Initializing with path:', autoBuildSourcePath);

    try {
      // For packaged apps, try to use bundled packages first (no pip install needed!)
      if (app.isPackaged && this.hasBundledPackages()) {
        console.warn('[PythonEnvManager] Using bundled Python packages (no pip install needed)');

        const bundledPython = getBundledPythonPath();
        const bundledSitePackages = this.getBundledSitePackagesPath();

        if (bundledPython && bundledSitePackages) {
          this.pythonPath = bundledPython;
          this.sitePackagesPath = bundledSitePackages;
          this.usingBundledPackages = true;
          this.isReady = true;
          this.isInitializing = false;

          this.emit('ready', this.pythonPath);
          console.warn('[PythonEnvManager] Ready with bundled Python:', this.pythonPath);
          console.warn('[PythonEnvManager] Using bundled site-packages:', this.sitePackagesPath);

          return {
            ready: true,
            pythonPath: this.pythonPath,
            sitePackagesPath: this.sitePackagesPath,
            venvExists: false, // Not using venv
            depsInstalled: true,
            usingBundledPackages: true
          };
        }
      }

      // Fallback to venv-based setup (for development or if bundled packages missing)
      console.warn('[PythonEnvManager] Using venv-based setup (development mode or bundled packages missing)');
      this.usingBundledPackages = false;

      // Check if venv exists
      if (!this.venvExists()) {
        console.warn('[PythonEnvManager] Venv not found, creating...');
        const created = await this.createVenv();
        if (!created) {
          this.isInitializing = false;
          return {
            ready: false,
            pythonPath: null,
            sitePackagesPath: null,
            venvExists: false,
            depsInstalled: false,
            usingBundledPackages: false,
            error: 'Failed to create virtual environment'
          };
        }
      } else {
        console.warn('[PythonEnvManager] Venv already exists');
      }

      // Check if deps are installed
      const depsInstalled = await this.checkDepsInstalled();
      if (!depsInstalled) {
        console.warn('[PythonEnvManager] Dependencies not installed, installing...');
        const installed = await this.installDeps();
        if (!installed) {
          this.isInitializing = false;
          return {
            ready: false,
            pythonPath: this.getVenvPythonPath(),
            sitePackagesPath: null,
            venvExists: true,
            depsInstalled: false,
            usingBundledPackages: false,
            error: 'Failed to install dependencies'
          };
        }
      } else {
        console.warn('[PythonEnvManager] Dependencies already installed');
      }

      this.pythonPath = this.getVenvPythonPath();
      // For venv, site-packages is inside the venv
      const venvBase = this.getVenvBasePath();
      if (venvBase) {
        if (isWindows()) {
          // Windows venv structure: Lib/site-packages (no python version subfolder)
          this.sitePackagesPath = path.join(venvBase, 'Lib', 'site-packages');
        } else {
          // Unix venv structure: lib/python3.x/site-packages
          // Dynamically detect Python version from venv lib directory
          const libDir = path.join(venvBase, 'lib');
          let pythonVersion = 'python3.12'; // Fallback to bundled version

          if (existsSync(libDir)) {
            try {
              const entries = readdirSync(libDir);
              const pythonDir = entries.find(e => e.startsWith('python3.'));
              if (pythonDir) {
                pythonVersion = pythonDir;
              }
            } catch {
              // Use fallback version
            }
          }

          this.sitePackagesPath = path.join(venvBase, 'lib', pythonVersion, 'site-packages');
        }
      }

      this.isReady = true;
      this.isInitializing = false;

      this.emit('ready', this.pythonPath);
      console.warn('[PythonEnvManager] Ready with Python path:', this.pythonPath);

      return {
        ready: true,
        pythonPath: this.pythonPath,
        sitePackagesPath: this.sitePackagesPath,
        venvExists: true,
        depsInstalled: true,
        usingBundledPackages: false
      };
    } catch (error) {
      this.isInitializing = false;
      const message = error instanceof Error ? error.message : String(error);
      return {
        ready: false,
        pythonPath: null,
        sitePackagesPath: null,
        venvExists: this.venvExists(),
        depsInstalled: false,
        usingBundledPackages: false,
        error: message
      };
    }
  }

  /**
   * Get the Python path (only valid after initialization)
   */
  getPythonPath(): string | null {
    return this.pythonPath;
  }

  /**
   * Get the site-packages path (only valid after initialization)
   */
  getSitePackagesPath(): string | null {
    return this.sitePackagesPath;
  }

  /**
   * Check if using bundled packages (vs venv)
   */
  isUsingBundledPackages(): boolean {
    return this.usingBundledPackages;
  }

  /**
   * Check if the environment is ready
   */
  isEnvReady(): boolean {
    return this.isReady;
  }

  /**
   * Get environment variables that should be set when spawning Python processes.
   * This ensures Python finds the bundled packages or venv packages.
   *
   * IMPORTANT: This returns a COMPLETE environment (based on process.env) with
   * problematic Python variables removed. This fixes the "Could not find platform
   * independent libraries <prefix>" error on Windows when PYTHONHOME is set.
   *
   * For Windows with pywin32, this method handles several critical issues:
   * 1. PYTHONPATH must include win32 and win32/lib for module imports
   * 2. pywin32_system32 must be in PATH for DLL loading
   *
   * Note: The DLL copying performed by fixPywin32() in download-python.cjs is what
   * actually makes pywin32 work - it copies DLLs to locations where Python's default
   * DLL search finds them. Adding pywin32_system32 to PATH is an additional fallback.
   *
   * @see https://github.com/AndyMik90/Auto-Claude/issues/176
   * @see https://github.com/AndyMik90/Auto-Claude/issues/810
   * @see https://github.com/mhammond/pywin32/blob/main/win32/Lib/pywin32_bootstrap.py
   */
  getPythonEnv(): Record<string, string> {
    // Start with isolated git env to prevent git environment variable contamination.
    // When running Python scripts that call git (like merge resolver, PR creator),
    // we must not pass GIT_DIR, GIT_WORK_TREE, etc. or git operations will target
    // the wrong repository. getIsolatedGitEnv() removes these variables and sets HUSKY=0.
    //
    // Also remove PYTHONHOME - it causes "Could not find platform independent libraries"
    // when set to a different Python installation than the one we're spawning.
    const isolatedEnv = getIsolatedGitEnv();
    const baseEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(isolatedEnv)) {
      // Skip PYTHONHOME - it causes the "platform independent libraries" error
      // Use case-insensitive check for Windows compatibility (env vars are case-insensitive on Windows)
      // Skip undefined values (TypeScript type guard)
      const upperKey = key.toUpperCase();
      if (upperKey !== 'PYTHONHOME' && value !== undefined) {
        baseEnv[key] = value;
      }
    }

    // Build PYTHONPATH - for Windows with pywin32, we need to include win32 and win32/lib
    // since the .pth file that normally adds these isn't processed when using PYTHONPATH
    let pythonPath = this.sitePackagesPath || '';
    if (this.sitePackagesPath && isWindows()) {
      const pathSep = getPathDelimiter();  // Platform-appropriate path separator
      const win32Path = path.join(this.sitePackagesPath, 'win32');
      const win32LibPath = path.join(this.sitePackagesPath, 'win32', 'lib');
      pythonPath = [this.sitePackagesPath, win32Path, win32LibPath].join(pathSep);
    }

    // Windows-specific pywin32 DLL loading fix
    // On Windows with bundled packages, we need to ensure pywin32 DLLs can be found.
    // The DLL copying in fixPywin32() is the primary fix - this PATH addition is a fallback.
    const windowsEnv: Record<string, string> = {};
    if (this.sitePackagesPath && isWindows()) {
      const pywin32System32 = path.join(this.sitePackagesPath, 'pywin32_system32');

      // Add pywin32_system32 to PATH for DLL loading
      // Normalize to single 'PATH' key before reading/writing, using the shared utility.
      // This prevents duplicate 'Path'/'PATH' keys that cause DLL-load failures on Windows.
      normalizeEnvPathKey(baseEnv);
      const currentPath = baseEnv['PATH'] ?? '';

      if (currentPath && !currentPath.includes(pywin32System32)) {
        windowsEnv['PATH'] = `${pywin32System32};${currentPath}`;
      } else if (!currentPath) {
        windowsEnv['PATH'] = pywin32System32;
      } else {
        // pywin32System32 already in path, but still normalize to 'PATH'
        windowsEnv['PATH'] = currentPath;
      }
    }

    return {
      ...baseEnv,
      ...windowsEnv,
      // Don't write bytecode - not needed and avoids permission issues
      PYTHONDONTWRITEBYTECODE: '1',
      // Force unbuffered stdout/stderr so progress updates reach Electron immediately
      PYTHONUNBUFFERED: '1',
      // Use UTF-8 encoding
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      // Disable user site-packages to avoid conflicts
      PYTHONNOUSERSITE: '1',
      // Override PYTHONPATH if we have bundled packages
      ...(pythonPath ? { PYTHONPATH: pythonPath } : {}),
    };
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<PythonEnvStatus> {
    // If using bundled packages, we're always ready
    if (this.usingBundledPackages && this.pythonPath && this.sitePackagesPath) {
      return {
        ready: true,
        pythonPath: this.pythonPath,
        sitePackagesPath: this.sitePackagesPath,
        venvExists: false,
        depsInstalled: true,
        usingBundledPackages: true
      };
    }

    const venvExists = this.venvExists();
    const depsInstalled = venvExists ? await this.checkDepsInstalled() : false;

    return {
      ready: this.isReady,
      pythonPath: this.pythonPath,
      sitePackagesPath: this.sitePackagesPath,
      venvExists,
      depsInstalled,
      usingBundledPackages: this.usingBundledPackages
    };
  }

  /**
   * Clean up any active processes on app exit.
   * Should be called when the application is about to quit.
   */
  cleanup(): void {
    if (this.activeProcesses.size > 0) {
      console.warn('[PythonEnvManager] Cleaning up', this.activeProcesses.size, 'active process(es)');
      for (const proc of this.activeProcesses) {
        try {
          proc.kill();
        } catch {
          // Process may already be dead
        }
      }
      this.activeProcesses.clear();
    }
  }
}

// Singleton instance
export const pythonEnvManager = new PythonEnvManager();

// Register cleanup on app exit (guard for test environments where app.on may not exist)
if (typeof app?.on === 'function') {
  app.on('will-quit', () => {
    pythonEnvManager.cleanup();
  });
}

/**
 * Get the configured venv Python path if ready, otherwise fall back to system Python.
 * This should be used by ALL services that need to spawn Python processes.
 *
 * Priority:
 * 1. If venv is ready -> return venv Python (has all dependencies installed)
 * 2. Fall back to findPythonCommand() -> bundled or system Python
 *
 * Note: For scripts that require dependencies (dotenv, claude-agent-sdk, etc.),
 * the venv Python MUST be used. Only use this fallback for scripts that
 * don't have external dependencies (like ollama_model_detector.py).
 */
export function getConfiguredPythonPath(): string {
  // If venv is ready, always prefer it (has dependencies installed)
  if (pythonEnvManager.isEnvReady()) {
    const venvPath = pythonEnvManager.getPythonPath();
    if (venvPath) {
      return venvPath;
    }
  }

  // Fall back to system/bundled Python
  return findPythonCommand() || 'python';
}
