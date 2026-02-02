import { ipcMain, BrowserWindow, shell, app } from 'electron';
import { IPC_CHANNELS, AUTO_BUILD_PATHS, DEFAULT_APP_SETTINGS, DEFAULT_FEATURE_MODELS, DEFAULT_FEATURE_THINKING, MODEL_ID_MAP, THINKING_BUDGET_MAP, getSpecsDir } from '../../../shared/constants';
import type { IPCResult, WorktreeStatus, WorktreeDiff, WorktreeDiffFile, WorktreeMergeResult, WorktreeDiscardResult, WorktreeListResult, WorktreeListItem, WorktreeCreatePROptions, WorktreeCreatePRResult, SupportedIDE, SupportedTerminal, AppSettings } from '../../../shared/types';
import path from 'path';
import { minimatch } from 'minimatch';
import { existsSync, readdirSync, statSync, readFileSync, promises as fsPromises } from 'fs';
import { execFileSync, spawn, spawnSync, exec, execFile } from 'child_process';
import { homedir } from 'os';
import { projectStore } from '../../project-store';
import { getConfiguredPythonPath, PythonEnvManager, pythonEnvManager as pythonEnvManagerSingleton } from '../../python-env-manager';
import { getEffectiveSourcePath } from '../../updater/path-resolver';
import { getBestAvailableProfileEnv } from '../../rate-limit-detector';
import { findTaskAndProject } from './shared';
import { parsePythonCommand } from '../../python-detector';
import { getToolPath } from '../../cli-tool-manager';
import { promisify } from 'util';
import {
  getTaskWorktreeDir,
  findTaskWorktree,
} from '../../worktree-paths';
import { persistPlanStatus, updateTaskMetadataPrUrl } from './plan-file-utils';
import { getIsolatedGitEnv, refreshGitIndex } from '../../utils/git-isolation';
import { cleanupWorktree } from '../../utils/worktree-cleanup';
import { killProcessGracefully } from '../../platform';
import { stripAnsiCodes } from '../../../shared/utils/ansi-sanitizer';
import { taskStateManager } from '../../task-state-manager';

// Regex pattern for validating git branch names
export const GIT_BRANCH_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

/**
 * Validates a detected branch name and returns the safe branch to delete.
 *
 * Why `auto-claude/` prefix is considered safe:
 * - All task worktrees use branches named `auto-claude/{specId}`
 * - This pattern is controlled by Auto-Claude, not user input
 * - If detected branch matches this pattern, it's a valid task branch
 * - If it doesn't match (e.g., `main`, `develop`, `feature/xxx`), it's likely
 *   the main project's branch being incorrectly detected from a corrupted worktree
 *
 * Issue #1479: When cleaning up a corrupted worktree, git rev-parse walks up
 * to the main project and returns its current branch instead of the worktree's branch.
 * This could cause deletion of the wrong branch.
 */
export function validateWorktreeBranch(
  detectedBranch: string | null,
  expectedBranch: string
): { branchToDelete: string; usedFallback: boolean; reason: string } {
  // If detection failed, use expected pattern
  if (detectedBranch === null) {
    return {
      branchToDelete: expectedBranch,
      usedFallback: true,
      reason: 'detection_failed',
    };
  }

  // Exact match - ideal case
  if (detectedBranch === expectedBranch) {
    return {
      branchToDelete: detectedBranch,
      usedFallback: false,
      reason: 'exact_match',
    };
  }

  // Matches auto-claude pattern with valid specId (not just "auto-claude/")
  // The specId must be non-empty for this to be a valid task branch
  if (detectedBranch.startsWith('auto-claude/') && detectedBranch.length > 'auto-claude/'.length) {
    return {
      branchToDelete: detectedBranch,
      usedFallback: false,
      reason: 'pattern_match',
    };
  }

  // Detected branch doesn't match expected pattern - use fallback
  // This is the critical security fix for issue #1479
  return {
    branchToDelete: expectedBranch,
    usedFallback: true,
    reason: 'invalid_pattern',
  };
}

// Maximum PR title length (GitHub's limit is 256 characters)
const MAX_PR_TITLE_LENGTH = 256;

// Regex for validating PR title contains only printable characters
const PRINTABLE_CHARS_REGEX = /^[\x20-\x7E\u00A0-\uFFFF]*$/;

// Timeout for PR creation operations (2 minutes for network operations)
const PR_CREATION_TIMEOUT_MS = 120000;

/**
 * Read utility feature settings (for commit message, merge resolver) from settings file
 */
function getUtilitySettings(): { model: string; modelId: string; thinkingLevel: string; thinkingBudget: number | null } {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  try {
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, 'utf-8');
      const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...JSON.parse(content) };

      // Get utility-specific settings
      const featureModels = settings.featureModels || DEFAULT_FEATURE_MODELS;
      const featureThinking = settings.featureThinking || DEFAULT_FEATURE_THINKING;

      const model = featureModels.utility || DEFAULT_FEATURE_MODELS.utility;
      const thinkingLevel = featureThinking.utility || DEFAULT_FEATURE_THINKING.utility;

      return {
        model,
        modelId: MODEL_ID_MAP[model] || MODEL_ID_MAP.haiku,
        thinkingLevel,
        thinkingBudget: thinkingLevel in THINKING_BUDGET_MAP ? THINKING_BUDGET_MAP[thinkingLevel] : THINKING_BUDGET_MAP.low
      };
    }
  } catch (error) {
    // Log parse errors to help diagnose corrupted settings
    console.warn('[getUtilitySettings] Failed to parse settings.json:', error);
  }

  // Return defaults if settings file doesn't exist or fails to parse
  return {
    model: DEFAULT_FEATURE_MODELS.utility,
    modelId: MODEL_ID_MAP[DEFAULT_FEATURE_MODELS.utility],
    thinkingLevel: DEFAULT_FEATURE_THINKING.utility,
    thinkingBudget: THINKING_BUDGET_MAP[DEFAULT_FEATURE_THINKING.utility]
  };
}

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Check if a repository is misconfigured as bare but has source files.
 * If so, automatically fix the configuration by unsetting core.bare.
 *
 * This can happen when git worktree operations incorrectly set bare=true,
 * or when users manually misconfigure the repository.
 *
 * @param projectPath - Path to check and potentially fix
 * @returns true if fixed, false if no fix needed or not fixable
 */
function fixMisconfiguredBareRepo(projectPath: string): boolean {
  try {
    // Check if bare=true is set
    const bareConfig = execFileSync(
      getToolPath('git'),
      ['config', '--get', 'core.bare'],
      { cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim().toLowerCase();

    if (bareConfig !== 'true') {
      return false; // Not marked as bare, nothing to fix
    }

    // Check if there are source files (indicating misconfiguration)
    // A truly bare repo would only have git internals, not source code
    // This covers multiple ecosystems: JS/TS, Python, Rust, Go, Java, C#, etc.
    //
    // Markers are separated into exact matches and glob patterns for efficiency.
    // Exact matches use existsSync() directly, while glob patterns use minimatch
    // against a cached directory listing.
    const EXACT_MARKERS = [
      // JavaScript/TypeScript ecosystem
      'package.json', 'apps', 'src',
      // Python ecosystem
      'pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile',
      // Rust ecosystem
      'Cargo.toml',
      // Go ecosystem
      'go.mod', 'go.sum', 'cmd', 'main.go',
      // Java/JVM ecosystem
      'pom.xml', 'build.gradle', 'build.gradle.kts',
      // Ruby ecosystem
      'Gemfile', 'Rakefile',
      // PHP ecosystem
      'composer.json',
      // General project markers
      'Makefile', 'CMakeLists.txt', 'README.md', 'LICENSE'
    ];

    const GLOB_MARKERS = [
      // .NET/C# ecosystem - patterns that need glob matching
      '*.csproj', '*.sln', '*.fsproj'
    ];

    // Check exact matches first (fast path)
    const hasExactMatch = EXACT_MARKERS.some(marker =>
      existsSync(path.join(projectPath, marker))
    );

    if (hasExactMatch) {
      // Found a project marker, proceed to fix
    } else {
      // Check glob patterns - read directory once and cache for all patterns
      let directoryFiles: string[] | null = null;
      const MAX_FILES_TO_CHECK = 500; // Limit to avoid reading huge directories

      const hasGlobMatch = GLOB_MARKERS.some(pattern => {
        // Validate pattern - only support simple glob patterns for security
        if (pattern.includes('..') || pattern.includes('/')) {
          console.warn(`[GIT] Unsupported glob pattern ignored: ${pattern}`);
          return false;
        }

        // Lazy-load directory listing, cached across patterns
        if (directoryFiles === null) {
          try {
            const allFiles = readdirSync(projectPath);
            // Limit to first N entries to avoid performance issues
            directoryFiles = allFiles.slice(0, MAX_FILES_TO_CHECK);
            if (allFiles.length > MAX_FILES_TO_CHECK) {
              console.warn(`[GIT] Directory has ${allFiles.length} entries, checking only first ${MAX_FILES_TO_CHECK}`);
            }
          } catch (error) {
            // Log the error for debugging instead of silently swallowing
            console.warn(`[GIT] Failed to read directory ${projectPath}:`, error instanceof Error ? error.message : String(error));
            directoryFiles = [];
          }
        }

        // Use minimatch for proper glob pattern matching
        return directoryFiles.some(file => minimatch(file, pattern, { nocase: true }));
      });

      if (!hasGlobMatch) {
        return false; // Legitimately bare repo
      }
    }

    // Fix the misconfiguration
    console.warn('[GIT] Detected misconfigured bare repository with source files. Auto-fixing by unsetting core.bare...');
    execFileSync(
      getToolPath('git'),
      ['config', '--unset', 'core.bare'],
      { cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    console.warn('[GIT] Fixed: core.bare has been unset. Git operations should now work correctly.');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a valid git working tree (not a bare repository).
 * Returns true if the path is inside a git repository with a working tree.
 *
 * NOTE: This is a pure check with no side-effects. If you need to fix
 * misconfigured bare repos before an operation, call fixMisconfiguredBareRepo()
 * explicitly before calling this function.
 *
 * @param projectPath - Path to check
 * @returns true if it's a valid working tree, false if bare or not a git repo
 */
function isGitWorkTree(projectPath: string): boolean {
  try {
    // Use git rev-parse --is-inside-work-tree which returns "true" for working trees
    // and fails for bare repos or non-git directories
    const result = execFileSync(
      getToolPath('git'),
      ['rev-parse', '--is-inside-work-tree'],
      { cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.trim() === 'true';
  } catch {
    // Not a working tree (could be bare repo or not a git repo at all)
    return false;
  }
}

/**
 * IDE and Terminal detection and launching utilities
 */
interface DetectedTool {
  id: string;
  name: string;
  path: string;
  installed: boolean;
}

interface DetectedTools {
  ides: DetectedTool[];
  terminals: DetectedTool[];
}

// IDE detection paths (macOS, Windows, Linux)
// Comprehensive detection for 50+ IDEs and editors
const IDE_DETECTION: Partial<Record<SupportedIDE, { name: string; paths: Record<string, string[]>; commands: Record<string, string> }>> = {
  // Microsoft/VS Code Ecosystem
  vscode: {
    name: 'Visual Studio Code',
    paths: {
      darwin: ['/Applications/Visual Studio Code.app'],
      win32: [
        'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        'C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
      ],
      linux: ['/usr/share/code', '/snap/bin/code', '/usr/bin/code']
    },
    commands: { darwin: 'code', win32: 'code.cmd', linux: 'code' }
  },
  visualstudio: {
    name: 'Visual Studio',
    paths: {
      darwin: [],
      win32: [
        'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe',
        'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\devenv.exe',
        'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\IDE\\devenv.exe'
      ],
      linux: []
    },
    commands: { darwin: '', win32: 'devenv', linux: '' }
  },
  vscodium: {
    name: 'VSCodium',
    paths: {
      darwin: ['/Applications/VSCodium.app'],
      win32: ['C:\\Program Files\\VSCodium\\VSCodium.exe', 'C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\VSCodium\\VSCodium.exe'],
      linux: ['/usr/bin/codium', '/snap/bin/codium']
    },
    commands: { darwin: 'codium', win32: 'codium', linux: 'codium' }
  },
  // AI-Powered Editors
  cursor: {
    name: 'Cursor',
    paths: {
      darwin: ['/Applications/Cursor.app'],
      win32: ['C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\cursor\\Cursor.exe'],
      linux: ['/usr/bin/cursor', '/opt/Cursor/cursor']
    },
    commands: { darwin: 'cursor', win32: 'cursor.cmd', linux: 'cursor' }
  },
  windsurf: {
    name: 'Windsurf',
    paths: {
      darwin: ['/Applications/Windsurf.app'],
      win32: ['C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Windsurf\\Windsurf.exe'],
      linux: ['/usr/bin/windsurf', '/opt/Windsurf/windsurf']
    },
    commands: { darwin: 'windsurf', win32: 'windsurf.cmd', linux: 'windsurf' }
  },
  zed: {
    name: 'Zed',
    paths: {
      darwin: ['/Applications/Zed.app'],
      win32: [],
      linux: ['/usr/bin/zed', '~/.local/bin/zed']
    },
    commands: { darwin: 'zed', win32: '', linux: 'zed' }
  },
  void: {
    name: 'Void',
    paths: {
      darwin: ['/Applications/Void.app'],
      win32: ['C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Void\\Void.exe'],
      linux: ['/usr/bin/void']
    },
    commands: { darwin: 'void', win32: 'void', linux: 'void' }
  },
  // JetBrains IDEs
  intellij: {
    name: 'IntelliJ IDEA',
    paths: {
      darwin: ['/Applications/IntelliJ IDEA.app', '/Applications/IntelliJ IDEA CE.app'],
      win32: ['C:\\Program Files\\JetBrains\\IntelliJ IDEA*\\bin\\idea64.exe'],
      linux: ['/usr/bin/idea', '/snap/bin/intellij-idea-ultimate', '/snap/bin/intellij-idea-community']
    },
    commands: { darwin: 'idea', win32: 'idea64.exe', linux: 'idea' }
  },
  pycharm: {
    name: 'PyCharm',
    paths: {
      darwin: ['/Applications/PyCharm.app', '/Applications/PyCharm CE.app'],
      win32: ['C:\\Program Files\\JetBrains\\PyCharm*\\bin\\pycharm64.exe'],
      linux: ['/usr/bin/pycharm', '/snap/bin/pycharm-professional', '/snap/bin/pycharm-community']
    },
    commands: { darwin: 'pycharm', win32: 'pycharm64.exe', linux: 'pycharm' }
  },
  webstorm: {
    name: 'WebStorm',
    paths: {
      darwin: ['/Applications/WebStorm.app'],
      win32: ['C:\\Program Files\\JetBrains\\WebStorm*\\bin\\webstorm64.exe'],
      linux: ['/usr/bin/webstorm', '/snap/bin/webstorm']
    },
    commands: { darwin: 'webstorm', win32: 'webstorm64.exe', linux: 'webstorm' }
  },
  phpstorm: {
    name: 'PhpStorm',
    paths: {
      darwin: ['/Applications/PhpStorm.app'],
      win32: ['C:\\Program Files\\JetBrains\\PhpStorm*\\bin\\phpstorm64.exe'],
      linux: ['/usr/bin/phpstorm', '/snap/bin/phpstorm']
    },
    commands: { darwin: 'phpstorm', win32: 'phpstorm64.exe', linux: 'phpstorm' }
  },
  rubymine: {
    name: 'RubyMine',
    paths: {
      darwin: ['/Applications/RubyMine.app'],
      win32: ['C:\\Program Files\\JetBrains\\RubyMine*\\bin\\rubymine64.exe'],
      linux: ['/usr/bin/rubymine', '/snap/bin/rubymine']
    },
    commands: { darwin: 'rubymine', win32: 'rubymine64.exe', linux: 'rubymine' }
  },
  goland: {
    name: 'GoLand',
    paths: {
      darwin: ['/Applications/GoLand.app'],
      win32: ['C:\\Program Files\\JetBrains\\GoLand*\\bin\\goland64.exe'],
      linux: ['/usr/bin/goland', '/snap/bin/goland']
    },
    commands: { darwin: 'goland', win32: 'goland64.exe', linux: 'goland' }
  },
  clion: {
    name: 'CLion',
    paths: {
      darwin: ['/Applications/CLion.app'],
      win32: ['C:\\Program Files\\JetBrains\\CLion*\\bin\\clion64.exe'],
      linux: ['/usr/bin/clion', '/snap/bin/clion']
    },
    commands: { darwin: 'clion', win32: 'clion64.exe', linux: 'clion' }
  },
  rider: {
    name: 'Rider',
    paths: {
      darwin: ['/Applications/Rider.app'],
      win32: ['C:\\Program Files\\JetBrains\\Rider*\\bin\\rider64.exe'],
      linux: ['/usr/bin/rider', '/snap/bin/rider']
    },
    commands: { darwin: 'rider', win32: 'rider64.exe', linux: 'rider' }
  },
  datagrip: {
    name: 'DataGrip',
    paths: {
      darwin: ['/Applications/DataGrip.app'],
      win32: ['C:\\Program Files\\JetBrains\\DataGrip*\\bin\\datagrip64.exe'],
      linux: ['/usr/bin/datagrip', '/snap/bin/datagrip']
    },
    commands: { darwin: 'datagrip', win32: 'datagrip64.exe', linux: 'datagrip' }
  },
  fleet: {
    name: 'Fleet',
    paths: {
      darwin: ['/Applications/Fleet.app'],
      win32: ['C:\\Users\\%USERNAME%\\AppData\\Local\\JetBrains\\Toolbox\\apps\\Fleet\\ch-0\\*\\Fleet.exe'],
      linux: ['~/.local/share/JetBrains/Toolbox/apps/Fleet/ch-0/*/fleet']
    },
    commands: { darwin: 'fleet', win32: 'fleet', linux: 'fleet' }
  },
  androidstudio: {
    name: 'Android Studio',
    paths: {
      darwin: ['/Applications/Android Studio.app'],
      win32: ['C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe'],
      linux: ['/usr/bin/android-studio', '/snap/bin/android-studio', '/opt/android-studio/bin/studio.sh']
    },
    commands: { darwin: 'studio', win32: 'studio64.exe', linux: 'android-studio' }
  },
  rustrover: {
    name: 'RustRover',
    paths: {
      darwin: ['/Applications/RustRover.app'],
      win32: ['C:\\Program Files\\JetBrains\\RustRover*\\bin\\rustrover64.exe'],
      linux: ['/usr/bin/rustrover', '/snap/bin/rustrover']
    },
    commands: { darwin: 'rustrover', win32: 'rustrover64.exe', linux: 'rustrover' }
  },
  // Classic Text Editors
  sublime: {
    name: 'Sublime Text',
    paths: {
      darwin: ['/Applications/Sublime Text.app'],
      win32: ['C:\\Program Files\\Sublime Text\\subl.exe', 'C:\\Program Files\\Sublime Text 3\\subl.exe'],
      linux: ['/usr/bin/subl', '/snap/bin/subl']
    },
    commands: { darwin: 'subl', win32: 'subl.exe', linux: 'subl' }
  },
  vim: {
    name: 'Vim',
    paths: {
      darwin: ['/usr/bin/vim'],
      win32: ['C:\\Program Files\\Vim\\vim*\\vim.exe'],
      linux: ['/usr/bin/vim']
    },
    commands: { darwin: 'vim', win32: 'vim', linux: 'vim' }
  },
  neovim: {
    name: 'Neovim',
    paths: {
      darwin: ['/usr/local/bin/nvim', '/opt/homebrew/bin/nvim'],
      win32: ['C:\\Program Files\\Neovim\\bin\\nvim.exe'],
      linux: ['/usr/bin/nvim', '/snap/bin/nvim']
    },
    commands: { darwin: 'nvim', win32: 'nvim', linux: 'nvim' }
  },
  emacs: {
    name: 'Emacs',
    paths: {
      darwin: ['/Applications/Emacs.app', '/usr/local/bin/emacs', '/opt/homebrew/bin/emacs'],
      win32: ['C:\\Program Files\\Emacs\\bin\\emacs.exe'],
      linux: ['/usr/bin/emacs', '/snap/bin/emacs']
    },
    commands: { darwin: 'emacs', win32: 'emacs', linux: 'emacs' }
  },
  nano: {
    name: 'GNU Nano',
    paths: {
      darwin: ['/usr/bin/nano'],
      win32: [],
      linux: ['/usr/bin/nano']
    },
    commands: { darwin: 'nano', win32: '', linux: 'nano' }
  },
  helix: {
    name: 'Helix',
    paths: {
      darwin: ['/opt/homebrew/bin/hx', '/usr/local/bin/hx'],
      win32: ['C:\\Program Files\\Helix\\hx.exe'],
      linux: ['/usr/bin/hx', '~/.cargo/bin/hx']
    },
    commands: { darwin: 'hx', win32: 'hx', linux: 'hx' }
  },
  // Platform-Specific IDEs
  xcode: {
    name: 'Xcode',
    paths: {
      darwin: ['/Applications/Xcode.app'],
      win32: [],
      linux: []
    },
    commands: { darwin: 'xcode', win32: '', linux: '' }
  },
  eclipse: {
    name: 'Eclipse',
    paths: {
      darwin: ['/Applications/Eclipse.app'],
      win32: ['C:\\eclipse\\eclipse.exe', 'C:\\Program Files\\Eclipse\\eclipse.exe'],
      linux: ['/usr/bin/eclipse', '/snap/bin/eclipse']
    },
    commands: { darwin: 'eclipse', win32: 'eclipse', linux: 'eclipse' }
  },
  netbeans: {
    name: 'NetBeans',
    paths: {
      darwin: ['/Applications/NetBeans.app', '/Applications/Apache NetBeans.app'],
      win32: ['C:\\Program Files\\NetBeans*\\bin\\netbeans64.exe'],
      linux: ['/usr/bin/netbeans', '/snap/bin/netbeans']
    },
    commands: { darwin: 'netbeans', win32: 'netbeans64.exe', linux: 'netbeans' }
  },
  // macOS Editors
  nova: {
    name: 'Nova',
    paths: {
      darwin: ['/Applications/Nova.app'],
      win32: [],
      linux: []
    },
    commands: { darwin: 'nova', win32: '', linux: '' }
  },
  bbedit: {
    name: 'BBEdit',
    paths: {
      darwin: ['/Applications/BBEdit.app'],
      win32: [],
      linux: []
    },
    commands: { darwin: 'bbedit', win32: '', linux: '' }
  },
  textmate: {
    name: 'TextMate',
    paths: {
      darwin: ['/Applications/TextMate.app'],
      win32: [],
      linux: []
    },
    commands: { darwin: 'mate', win32: '', linux: '' }
  },
  // Windows Editors
  notepadpp: {
    name: 'Notepad++',
    paths: {
      darwin: [],
      win32: ['C:\\Program Files\\Notepad++\\notepad++.exe', 'C:\\Program Files (x86)\\Notepad++\\notepad++.exe'],
      linux: []
    },
    commands: { darwin: '', win32: 'notepad++', linux: '' }
  },
  // Linux Editors
  kate: {
    name: 'Kate',
    paths: {
      darwin: [],
      win32: [],
      linux: ['/usr/bin/kate', '/snap/bin/kate']
    },
    commands: { darwin: '', win32: '', linux: 'kate' }
  },
  gedit: {
    name: 'gedit',
    paths: {
      darwin: [],
      win32: [],
      linux: ['/usr/bin/gedit', '/snap/bin/gedit']
    },
    commands: { darwin: '', win32: '', linux: 'gedit' }
  },
  geany: {
    name: 'Geany',
    paths: {
      darwin: [],
      win32: [],
      linux: ['/usr/bin/geany']
    },
    commands: { darwin: '', win32: '', linux: 'geany' }
  },
  lapce: {
    name: 'Lapce',
    paths: {
      darwin: ['/Applications/Lapce.app'],
      win32: ['C:\\Users\\%USERNAME%\\AppData\\Local\\lapce\\Lapce.exe'],
      linux: ['/usr/bin/lapce', '~/.cargo/bin/lapce']
    },
    commands: { darwin: 'lapce', win32: 'lapce', linux: 'lapce' }
  },
  custom: {
    name: 'Custom IDE',
    paths: { darwin: [], win32: [], linux: [] },
    commands: { darwin: '', win32: '', linux: '' }
  }
};

// Terminal detection paths (macOS, Windows, Linux)
// Comprehensive detection for 30+ terminal emulators
const TERMINAL_DETECTION: Partial<Record<SupportedTerminal, { name: string; paths: Record<string, string[]>; commands: Record<string, string[]> }>> = {
  // System Defaults
  system: {
    name: 'System Terminal',
    paths: { darwin: ['/System/Applications/Utilities/Terminal.app'], win32: [], linux: [] },
    commands: {
      darwin: ['open', '-a', 'Terminal'],
      win32: ['cmd.exe', '/c', 'start', 'cmd.exe', '/K', 'cd', '/d'],
      linux: ['x-terminal-emulator', '-e', 'bash', '-c']
    }
  },
  // macOS Terminals
  terminal: {
    name: 'Terminal.app',
    paths: { darwin: ['/System/Applications/Utilities/Terminal.app'], win32: [], linux: [] },
    commands: { darwin: ['open', '-a', 'Terminal'], win32: [], linux: [] }
  },
  iterm2: {
    name: 'iTerm2',
    paths: { darwin: ['/Applications/iTerm.app'], win32: [], linux: [] },
    commands: { darwin: ['open', '-a', 'iTerm'], win32: [], linux: [] }
  },
  warp: {
    name: 'Warp',
    paths: { darwin: ['/Applications/Warp.app'], win32: [], linux: ['/usr/bin/warp-terminal'] },
    commands: { darwin: ['open', '-a', 'Warp'], win32: [], linux: ['warp-terminal'] }
  },
  ghostty: {
    name: 'Ghostty',
    paths: { darwin: ['/Applications/Ghostty.app'], win32: [], linux: ['/usr/bin/ghostty'] },
    commands: { darwin: ['open', '-a', 'Ghostty'], win32: [], linux: ['ghostty'] }
  },
  rio: {
    name: 'Rio',
    paths: { darwin: ['/Applications/Rio.app'], win32: [], linux: ['/usr/bin/rio'] },
    commands: { darwin: ['open', '-a', 'Rio'], win32: [], linux: ['rio'] }
  },
  // Windows Terminals
  windowsterminal: {
    name: 'Windows Terminal',
    paths: { darwin: [], win32: ['C:\\Users\\%USERNAME%\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'], linux: [] },
    commands: { darwin: [], win32: ['wt.exe', '-d'], linux: [] }
  },
  powershell: {
    name: 'PowerShell',
    paths: { darwin: [], win32: ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'], linux: [] },
    commands: { darwin: [], win32: ['powershell.exe', '-NoExit', '-Command', 'cd'], linux: [] }
  },
  cmd: {
    name: 'Command Prompt',
    paths: { darwin: [], win32: ['C:\\Windows\\System32\\cmd.exe'], linux: [] },
    commands: { darwin: [], win32: ['cmd.exe', '/K', 'cd', '/d'], linux: [] }
  },
  conemu: {
    name: 'ConEmu',
    paths: { darwin: [], win32: ['C:\\Program Files\\ConEmu\\ConEmu64.exe', 'C:\\Program Files (x86)\\ConEmu\\ConEmu.exe'], linux: [] },
    commands: { darwin: [], win32: ['ConEmu64.exe', '-Dir'], linux: [] }
  },
  cmder: {
    name: 'Cmder',
    paths: { darwin: [], win32: ['C:\\cmder\\Cmder.exe', 'C:\\tools\\cmder\\Cmder.exe'], linux: [] },
    commands: { darwin: [], win32: ['Cmder.exe', '/START'], linux: [] }
  },
  gitbash: {
    name: 'Git Bash',
    paths: { darwin: [], win32: ['C:\\Program Files\\Git\\git-bash.exe'], linux: [] },
    commands: { darwin: [], win32: ['git-bash.exe', '--cd='], linux: [] }
  },
  // Linux Desktop Environment Terminals
  gnometerminal: {
    name: 'GNOME Terminal',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/gnome-terminal'] },
    commands: { darwin: [], win32: [], linux: ['gnome-terminal', '--working-directory='] }
  },
  konsole: {
    name: 'Konsole',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/konsole'] },
    commands: { darwin: [], win32: [], linux: ['konsole', '--workdir'] }
  },
  xfce4terminal: {
    name: 'XFCE4 Terminal',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/xfce4-terminal'] },
    commands: { darwin: [], win32: [], linux: ['xfce4-terminal', '--working-directory='] }
  },
  'mate-terminal': {
    name: 'MATE Terminal',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/mate-terminal'] },
    commands: { darwin: [], win32: [], linux: ['mate-terminal', '--working-directory='] }
  },
  // Linux Feature-rich Terminals
  terminator: {
    name: 'Terminator',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/terminator'] },
    commands: { darwin: [], win32: [], linux: ['terminator', '--working-directory='] }
  },
  tilix: {
    name: 'Tilix',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/tilix'] },
    commands: { darwin: [], win32: [], linux: ['tilix', '--working-directory='] }
  },
  guake: {
    name: 'Guake',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/guake'] },
    commands: { darwin: [], win32: [], linux: ['guake', '--show', '-n', '--'] }
  },
  yakuake: {
    name: 'Yakuake',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/yakuake'] },
    commands: { darwin: [], win32: [], linux: ['yakuake'] }
  },
  tilda: {
    name: 'Tilda',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/tilda'] },
    commands: { darwin: [], win32: [], linux: ['tilda'] }
  },
  // GPU-Accelerated Cross-platform Terminals
  alacritty: {
    name: 'Alacritty',
    paths: {
      darwin: ['/Applications/Alacritty.app'],
      win32: ['C:\\Program Files\\Alacritty\\alacritty.exe', 'C:\\Users\\%USERNAME%\\scoop\\apps\\alacritty\\current\\alacritty.exe'],
      linux: ['/usr/bin/alacritty', '/snap/bin/alacritty']
    },
    commands: {
      darwin: ['open', '-a', 'Alacritty', '--args', '--working-directory'],
      win32: ['alacritty.exe', '--working-directory'],
      linux: ['alacritty', '--working-directory']
    }
  },
  kitty: {
    name: 'Kitty',
    paths: {
      darwin: ['/Applications/kitty.app'],
      win32: [],
      linux: ['/usr/bin/kitty']
    },
    commands: {
      darwin: ['open', '-a', 'kitty', '--args', '--directory'],
      win32: [],
      linux: ['kitty', '--directory']
    }
  },
  wezterm: {
    name: 'WezTerm',
    paths: {
      darwin: ['/Applications/WezTerm.app'],
      win32: ['C:\\Program Files\\WezTerm\\wezterm-gui.exe'],
      linux: ['/usr/bin/wezterm', '/usr/bin/wezterm-gui']
    },
    commands: {
      darwin: ['open', '-a', 'WezTerm', '--args', 'start', '--cwd'],
      win32: ['wezterm-gui.exe', 'start', '--cwd'],
      linux: ['wezterm', 'start', '--cwd']
    }
  },
  // Cross-Platform Terminals
  hyper: {
    name: 'Hyper',
    paths: {
      darwin: ['/Applications/Hyper.app'],
      win32: ['C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Hyper\\Hyper.exe'],
      linux: ['/usr/bin/hyper', '/opt/Hyper/hyper']
    },
    commands: {
      darwin: ['open', '-a', 'Hyper'],
      win32: ['hyper.exe'],
      linux: ['hyper']
    }
  },
  tabby: {
    name: 'Tabby',
    paths: {
      darwin: ['/Applications/Tabby.app'],
      win32: ['C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Tabby\\Tabby.exe'],
      linux: ['/usr/bin/tabby', '/opt/Tabby/tabby']
    },
    commands: {
      darwin: ['open', '-a', 'Tabby'],
      win32: ['Tabby.exe'],
      linux: ['tabby']
    }
  },
  contour: {
    name: 'Contour',
    paths: {
      darwin: ['/Applications/Contour.app'],
      win32: [],
      linux: ['/usr/bin/contour']
    },
    commands: {
      darwin: ['open', '-a', 'Contour'],
      win32: [],
      linux: ['contour']
    }
  },
  // Minimal/Suckless Terminals
  xterm: {
    name: 'xterm',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/xterm'] },
    commands: { darwin: [], win32: [], linux: ['xterm', '-e', 'cd'] }
  },
  urxvt: {
    name: 'rxvt-unicode',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/urxvt'] },
    commands: { darwin: [], win32: [], linux: ['urxvt', '-cd'] }
  },
  st: {
    name: 'st (suckless)',
    paths: { darwin: [], win32: [], linux: ['/usr/local/bin/st', '/usr/bin/st'] },
    commands: { darwin: [], win32: [], linux: ['st', '-d'] }
  },
  foot: {
    name: 'Foot',
    paths: { darwin: [], win32: [], linux: ['/usr/bin/foot'] },
    commands: { darwin: [], win32: [], linux: ['foot', '--working-directory='] }
  },
  // Specialty Terminals
  coolretroterm: {
    name: 'cool-retro-term',
    paths: { darwin: ['/Applications/cool-retro-term.app'], win32: [], linux: ['/usr/bin/cool-retro-term'] },
    commands: { darwin: ['open', '-a', 'cool-retro-term'], win32: [], linux: ['cool-retro-term'] }
  },
  // Multiplexers (commonly used as terminal environment)
  tmux: {
    name: 'tmux',
    paths: {
      darwin: ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux'],
      win32: [],
      linux: ['/usr/bin/tmux']
    },
    commands: { darwin: ['tmux'], win32: [], linux: ['tmux'] }
  },
  zellij: {
    name: 'Zellij',
    paths: {
      darwin: ['/opt/homebrew/bin/zellij', '/usr/local/bin/zellij'],
      win32: [],
      linux: ['/usr/bin/zellij', '~/.cargo/bin/zellij']
    },
    commands: { darwin: ['zellij'], win32: [], linux: ['zellij'] }
  },
  custom: {
    name: 'Custom Terminal',
    paths: { darwin: [], win32: [], linux: [] },
    commands: { darwin: [], win32: [], linux: [] }
  }
};

/**
 * Security helper functions for safe path handling
 */

/**
 * Escape single quotes in a path for safe use in single-quoted shell/script strings.
 * Works for both AppleScript and shell (bash/sh) contexts.
 * This prevents command injection via malicious directory names.
 */
function escapeSingleQuotedPath(dirPath: string): string {
  // Single quotes are escaped by ending the string, adding an escaped quote,
  // and starting a new string: ' -> '\''
  // This pattern works in both AppleScript and POSIX shells (bash, sh, zsh)
  return dirPath.replace(/'/g, "'\\''");
}

/**
 * Validate a path doesn't contain path traversal attempts after variable expansion
 */
function isPathSafe(expandedPath: string): boolean {
  // Normalize and check for path traversal
  const normalized = path.normalize(expandedPath);
  // Check for explicit traversal patterns
  if (normalized.includes('..')) {
    return false;
  }
  return true;
}

/**
 * Smart app detection using native OS APIs for faster, more comprehensive discovery
 */

// Cache for installed apps (refreshed on each detection call)
let installedAppsCache: Set<string> = new Set();

/**
 * macOS: Use Spotlight (mdfind) to quickly find all installed .app bundles
 */
async function detectMacApps(): Promise<Set<string>> {
  const apps = new Set<string>();
  try {
    // Use mdfind to query Spotlight for all applications - much faster than directory scanning
    // Timeout after 10 seconds to prevent hangs on systems with slow Spotlight indexing
    const { stdout } = await execAsync('mdfind -onlyin /Applications "kMDItemKind == Application" 2>/dev/null | head -500', { timeout: 10000 });
    const appPaths = stdout.trim().split('\n').filter(p => p);

    for (const appPath of appPaths) {
      // Extract app name from path (e.g., "/Applications/Visual Studio Code.app" -> "Visual Studio Code")
      const match = appPath.match(/\/([^/]+)\.app$/i);
      if (match) {
        apps.add(match[1].toLowerCase());
      }
    }
  } catch {
    // Fallback: scan /Applications directory
    try {
      const appDir = '/Applications';
      if (existsSync(appDir)) {
        const entries = readdirSync(appDir);
        for (const entry of entries) {
          if (entry.endsWith('.app')) {
            apps.add(entry.replace('.app', '').toLowerCase());
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }
  return apps;
}

/**
 * Windows: Check registry and common installation paths
 */
async function detectWindowsApps(): Promise<Set<string>> {
  const apps = new Set<string>();
  try {
    // Query registry for installed programs using PowerShell
    const { stdout } = await execAsync(
      `powershell -Command "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Select-Object DisplayName | ConvertTo-Json"`,
      { timeout: 10000 }
    );
    const programs = JSON.parse(stdout);
    if (Array.isArray(programs)) {
      for (const prog of programs) {
        if (prog.DisplayName) {
          apps.add(prog.DisplayName.toLowerCase());
        }
      }
    }
  } catch {
    // Fallback: check common paths
    const commonPaths = [
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      process.env.LOCALAPPDATA || ''
    ];
    for (const basePath of commonPaths) {
      if (basePath && existsSync(basePath)) {
        try {
          const entries = readdirSync(basePath);
          for (const entry of entries) {
            apps.add(entry.toLowerCase());
          }
        } catch {
          // Ignore errors
        }
      }
    }
  }
  return apps;
}

/**
 * Linux: Parse .desktop files from standard locations for fast app discovery
 */
async function detectLinuxApps(): Promise<Set<string>> {
  const apps = new Set<string>();
  const desktopDirs = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    `${homedir()}/.local/share/applications`,
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications'
  ];

  for (const dir of desktopDirs) {
    try {
      if (existsSync(dir)) {
        const files = readdirSync(dir);
        for (const file of files) {
          if (file.endsWith('.desktop')) {
            // Extract app name from .desktop filename
            const name = file.replace('.desktop', '').toLowerCase();
            apps.add(name);

            // Also try to read the Name= field from .desktop file for better matching
            try {
              const content = readFileSync(path.join(dir, file), 'utf-8');
              const nameMatch = content.match(/^Name=(.+)$/m);
              if (nameMatch) {
                apps.add(nameMatch[1].toLowerCase());
              }
            } catch {
              // Ignore read errors
            }
          }
        }
      }
    } catch {
      // Ignore directory errors
    }
  }

  // Also check common binary paths
  const binPaths = ['/usr/bin', '/usr/local/bin', '/snap/bin'];
  for (const binPath of binPaths) {
    try {
      if (existsSync(binPath)) {
        const bins = readdirSync(binPath);
        for (const bin of bins) {
          apps.add(bin.toLowerCase());
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return apps;
}

/**
 * Check if an app is installed using the cached app list + specific path checks
 */
function isAppInstalled(
  appNames: string[],
  specificPaths: string[],
  _platform: string
): { installed: boolean; foundPath: string } {
  // First, check the cached app list (fast)
  for (const name of appNames) {
    if (installedAppsCache.has(name.toLowerCase())) {
      return { installed: true, foundPath: '' };
    }
  }

  // Then check specific paths (for apps not in standard locations)
  for (const checkPath of specificPaths) {
    const expandedPath = checkPath
      .replace('%USERNAME%', process.env.USERNAME || process.env.USER || '')
      .replace('~', homedir());

    // Validate path doesn't contain traversal attempts after expansion
    if (!isPathSafe(expandedPath)) {
      console.warn('[detectTool] Skipping potentially unsafe path:', checkPath);
      continue;
    }

    // Handle glob patterns (e.g., JetBrains*) - just check if directory exists for base path
    const basePath = expandedPath.split('*')[0];
    if (existsSync(expandedPath) || (basePath !== expandedPath && existsSync(basePath))) {
      return { installed: true, foundPath: expandedPath };
    }
  }

  return { installed: false, foundPath: '' };
}

/**
 * Detect installed IDEs and terminals on the system
 * Uses smart platform-native detection for faster results
 */
async function detectInstalledTools(): Promise<DetectedTools> {
  const platform = process.platform as 'darwin' | 'win32' | 'linux';
  const ides: DetectedTool[] = [];
  const terminals: DetectedTool[] = [];

  // Build app cache using platform-native detection (fast!)
  console.log('[DevTools] Starting smart app detection...');
  const startTime = Date.now();

  if (platform === 'darwin') {
    installedAppsCache = await detectMacApps();
  } else if (platform === 'win32') {
    installedAppsCache = await detectWindowsApps();
  } else {
    installedAppsCache = await detectLinuxApps();
  }

  console.log(`[DevTools] Found ${installedAppsCache.size} apps in ${Date.now() - startTime}ms`);

  // Detect IDEs using cached app list + specific path checks
  for (const [id, config] of Object.entries(IDE_DETECTION)) {
    if (id === 'custom' || !config) continue;

    const paths = config.paths[platform] || [];
    // Generate search names from the config name and id
    const searchNames = [
      config.name.toLowerCase(),
      id.toLowerCase(),
      // Handle common variations
      config.name.replace(/\s+/g, '').toLowerCase(),
      config.name.replace(/\s+/g, '-').toLowerCase()
    ];

    const { installed, foundPath } = isAppInstalled(searchNames, paths, platform);

    // Also try command check if not found via app detection
    let finalInstalled = installed;
    if (!finalInstalled && config.commands[platform]) {
      try {
        if (platform === 'win32') {
          await execAsync(`where ${config.commands[platform]}`, { timeout: 2000 });
        } else {
          await execAsync(`which ${config.commands[platform]}`, { timeout: 2000 });
        }
        finalInstalled = true;
      } catch {
        // Command not found
      }
    }

    if (finalInstalled) {
      ides.push({
        id,
        name: config.name,
        path: foundPath,
        installed: true
      });
    }
  }

  // Detect Terminals using cached app list + specific path checks
  for (const [id, config] of Object.entries(TERMINAL_DETECTION)) {
    if (id === 'custom' || !config) continue;

    const paths = config.paths[platform] || [];
    const searchNames = [
      config.name.toLowerCase(),
      id.toLowerCase(),
      config.name.replace(/\s+/g, '').toLowerCase()
    ];

    const { installed, foundPath } = isAppInstalled(searchNames, paths, platform);

    if (installed) {
      terminals.push({
        id,
        name: config.name,
        path: foundPath,
        installed: true
      });
    }
  }

  // Always add system terminal as fallback
  if (!terminals.find(t => t.id === 'system')) {
    terminals.unshift({
      id: 'system',
      name: 'System Terminal',
      path: '',
      installed: true
    });
  }

  console.log(`[DevTools] Detection complete: ${ides.length} IDEs, ${terminals.length} terminals`);
  return { ides, terminals };
}

/**
 * Open a directory in the specified IDE
 */
async function openInIDE(dirPath: string, ide: SupportedIDE, customPath?: string): Promise<{ success: boolean; error?: string }> {
  const platform = process.platform as 'darwin' | 'win32' | 'linux';

  try {
    if (ide === 'custom' && customPath) {
      // Use custom IDE path with execFileAsync to prevent shell injection
      // Validate the custom path is a valid executable path
      if (!isPathSafe(customPath)) {
        return { success: false, error: 'Invalid custom IDE path' };
      }
      await execFileAsync(customPath, [dirPath]);
      return { success: true };
    }

    const config = IDE_DETECTION[ide];
    if (!config) {
      return { success: false, error: `Unknown IDE: ${ide}` };
    }

    const command = config.commands[platform];
    if (!command) {
      return { success: false, error: `IDE ${ide} is not supported on ${platform}` };
    }

    // Special handling for macOS .app bundles
    if (platform === 'darwin') {
      const appPath = config.paths.darwin?.[0];
      if (appPath && existsSync(appPath)) {
        // Use 'open' command with execFileAsync to prevent shell injection
        await execFileAsync('open', ['-a', path.basename(appPath, '.app'), dirPath]);
        return { success: true };
      }
    }

    // Special handling for Windows batch files (.cmd, .bat)
    // execFile doesn't search PATH, so we need shell: true for batch files
    if (platform === 'win32' && (command.endsWith('.cmd') || command.endsWith('.bat'))) {
      return new Promise((resolve) => {
        const child = spawn(command, [dirPath], {
          shell: true,
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        resolve({ success: true });
      });
    }

    // Use command line tool with execFileAsync
    await execFileAsync(command, [dirPath]);
    return { success: true };
  } catch (error) {
    console.error(`Failed to open in IDE ${ide}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to open IDE' };
  }
}

/**
 * Open a directory in the specified terminal
 */
async function openInTerminal(dirPath: string, terminal: SupportedTerminal, customPath?: string): Promise<{ success: boolean; error?: string }> {
  const platform = process.platform as 'darwin' | 'win32' | 'linux';

  try {
    if (terminal === 'custom' && customPath) {
      // Use custom terminal path with execFileAsync to prevent shell injection
      if (!isPathSafe(customPath)) {
        return { success: false, error: 'Invalid custom terminal path' };
      }
      await execFileAsync(customPath, [dirPath]);
      return { success: true };
    }

    const config = TERMINAL_DETECTION[terminal];
    if (!config) {
      return { success: false, error: `Unknown terminal: ${terminal}` };
    }

    const commands = config.commands[platform];
    if (!commands || commands.length === 0) {
      // Fall back to opening the folder in system file manager
      await shell.openPath(dirPath);
      return { success: true };
    }

    if (platform === 'darwin') {
      // macOS: Use open command with the directory
      // Escape single quotes in dirPath to prevent script injection
      const escapedPath = escapeSingleQuotedPath(dirPath);

      if (terminal === 'system') {
        // Use AppleScript to open Terminal.app at the directory
        const script = `tell application "Terminal" to do script "cd '${escapedPath}'"`;
        await execFileAsync('osascript', ['-e', script]);
      } else if (terminal === 'iterm2') {
        // Use AppleScript to open iTerm2 at the directory
        const script = `tell application "iTerm"
          create window with default profile
          tell current session of current window
            write text "cd '${escapedPath}'"
          end tell
        end tell`;
        await execFileAsync('osascript', ['-e', script]);
      } else if (terminal === 'warp') {
        // Warp can be opened with just the directory using execFileAsync
        await execFileAsync('open', ['-a', 'Warp', dirPath]);
      } else {
        // For other terminals, use execFileAsync with arguments array
        await execFileAsync(commands[0], [...commands.slice(1), dirPath]);
      }
    } else if (platform === 'win32') {
      // Windows: Start terminal at directory using spawn to avoid shell injection
      if (terminal === 'system') {
        // Use spawn with proper argument separation
        spawn('cmd.exe', ['/K', 'cd', '/d', dirPath], { detached: true, stdio: 'ignore' }).unref();
      } else if (commands.length > 0) {
        spawn(commands[0], [...commands.slice(1), dirPath], { detached: true, stdio: 'ignore' }).unref();
      }
    } else {
      // Linux: Use the configured terminal with execFileAsync
      if (terminal === 'system') {
        // Try common terminal emulators with proper argument arrays
        try {
          await execFileAsync('x-terminal-emulator', ['--working-directory', dirPath, '-e', 'bash']);
        } catch {
          try {
            await execFileAsync('gnome-terminal', ['--working-directory', dirPath]);
          } catch {
            // xterm doesn't have --working-directory, use -e with a script
            // Escape the path for shell use within the xterm command
            const escapedPath = escapeSingleQuotedPath(dirPath);
            await execFileAsync('xterm', ['-e', `cd '${escapedPath}' && bash`]);
          }
        }
      } else {
        // Use execFileAsync with arguments array
        await execFileAsync(commands[0], [...commands.slice(1), dirPath]);
      }
    }

    return { success: true };
  } catch (error) {
    console.error(`Failed to open in terminal ${terminal}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to open terminal' };
  }
}

/**
 * Read the stored base branch from task_metadata.json
 * This is the branch the task was created from (set by user during task creation)
 */
function getTaskBaseBranch(specDir: string): string | undefined {
  // Defensive check for undefined input
  if (!specDir || typeof specDir !== 'string') {
    console.error('[getTaskBaseBranch] specDir is undefined or not a string');
    return undefined;
  }

  try {
    const metadataPath = path.join(specDir, 'task_metadata.json');
    if (existsSync(metadataPath)) {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      // Return baseBranch if explicitly set (not the __project_default__ marker)
      // Also validate it's a valid branch name to prevent malformed git commands
      if (metadata.baseBranch &&
          metadata.baseBranch !== '__project_default__' &&
          GIT_BRANCH_REGEX.test(metadata.baseBranch)) {
        return metadata.baseBranch;
      }
    }
  } catch (e) {
    console.warn('[getTaskBaseBranch] Failed to read task metadata:', e);
  }
  return undefined;
}

/**
 * Get the effective base branch for a task with proper fallback chain.
 * Priority:
 * 1. Task metadata baseBranch (explicit task-level override from task_metadata.json)
 * 2. Project settings mainBranch (project-level default)
 * 3. Git default branch detection (main/master)
 * 4. Fallback to 'main'
 *
 * This should be used instead of getting the current HEAD branch,
 * as the user may be on a feature branch when viewing worktree status.
 */
function getEffectiveBaseBranch(projectPath: string, specId: string, projectMainBranch?: string): string {
  // Defensive check for undefined inputs
  if (!projectPath || typeof projectPath !== 'string') {
    console.error('[getEffectiveBaseBranch] projectPath is undefined or not a string');
    return 'main';
  }
  if (!specId || typeof specId !== 'string') {
    console.error('[getEffectiveBaseBranch] specId is undefined or not a string');
    return 'main';
  }

  // 1. Try task metadata baseBranch
  const specDir = path.join(projectPath, '.auto-claude', 'specs', specId);
  const taskBaseBranch = getTaskBaseBranch(specDir);
  if (taskBaseBranch) {
    return taskBaseBranch;
  }

  // 2. Try project settings mainBranch
  if (projectMainBranch && GIT_BRANCH_REGEX.test(projectMainBranch)) {
    return projectMainBranch;
  }

  // 3. Try to detect main/master branch
  for (const branch of ['main', 'master']) {
    try {
      execFileSync(getToolPath('git'), ['rev-parse', '--verify', branch], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return branch;
    } catch {
      // Branch doesn't exist, try next
    }
  }

  // 4. Fallback to 'main'
  return 'main';
}

// ============================================
// Helper functions for TASK_WORKTREE_CREATE_PR
// ============================================

/**
 * Result of parsing JSON output from the create-pr Python script
 */
interface ParsedPRResult {
  success: boolean;
  prUrl?: string;
  alreadyExists?: boolean;
  error?: string;
}

/**
 * Validate that a URL is a valid GitHub PR URL.
 * Supports both github.com and GitHub Enterprise instances (custom domains).
 * Only requires HTTPS protocol and non-empty hostname to allow any GH Enterprise URL.
 * @returns true if the URL is a valid HTTPS URL with a non-empty hostname
 */
function isValidGitHubUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only require HTTPS with non-empty hostname
    // This supports GH Enterprise instances with custom domains
    // The URL comes from gh CLI output which we trust to be valid
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Parse JSON output from the create-pr Python script
 * Handles both snake_case and camelCase field names
 * @returns ParsedPRResult if valid JSON found, null otherwise
 */
function parsePRJsonOutput(stdout: string): ParsedPRResult | null {
  // Find the last complete JSON object in stdout (non-greedy, handles multiple objects)
  const jsonMatches = stdout.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  const jsonMatch = jsonMatches && jsonMatches.length > 0 ? jsonMatches[jsonMatches.length - 1] : null;

  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch);

    // Validate parsed JSON has expected shape
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    // Extract and validate fields with proper type checking
    // Handle both snake_case (from Python) and camelCase field names
    // Default success to false to avoid masking failures when field is missing
    const rawPrUrl = typeof parsed.pr_url === 'string' ? parsed.pr_url :
                     typeof parsed.prUrl === 'string' ? parsed.prUrl : undefined;

    // Validate PR URL is a valid GitHub URL for robustness
    const validatedPrUrl = rawPrUrl && isValidGitHubUrl(rawPrUrl) ? rawPrUrl : undefined;

    return {
      success: typeof parsed.success === 'boolean' ? parsed.success : false,
      prUrl: validatedPrUrl,
      alreadyExists: typeof parsed.already_exists === 'boolean' ? parsed.already_exists :
                     typeof parsed.alreadyExists === 'boolean' ? parsed.alreadyExists : undefined,
      error: typeof parsed.error === 'string' ? parsed.error : undefined
    };
  } catch {
    return null;
  }
}

/**
 * Result of updating task status after PR creation
 */
interface TaskStatusUpdateResult {
  mainProjectStatus: boolean;
  mainProjectMetadata: boolean;
  worktreeStatus: boolean;
  worktreeMetadata: boolean;
}

/**
 * Update task status and metadata after PR creation
 * Updates both main project and worktree locations
 * @returns Result object indicating which updates succeeded/failed
 */
async function updateTaskStatusAfterPRCreation(
  specDir: string,
  worktreePath: string | null,
  prUrl: string,
  autoBuildPath: string | undefined,
  specId: string,
  debug: (...args: unknown[]) => void
): Promise<TaskStatusUpdateResult> {
  const result: TaskStatusUpdateResult = {
    mainProjectStatus: false,
    mainProjectMetadata: false,
    worktreeStatus: false,
    worktreeMetadata: false
  };

  const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
  const metadataPath = path.join(specDir, 'task_metadata.json');

  // Await status persistence to ensure completion before resolving
  try {
    const persisted = await persistPlanStatus(planPath, 'done');
    result.mainProjectStatus = persisted;
    debug('Main project status persisted to done:', persisted);
  } catch (err) {
    debug('Failed to persist main project status:', err);
  }

  // Update metadata with prUrl in main project
  result.mainProjectMetadata = updateTaskMetadataPrUrl(metadataPath, prUrl);
  debug('Main project metadata updated with prUrl:', result.mainProjectMetadata);

  // Also persist to WORKTREE location (worktree takes priority when loading tasks)
  // This ensures the status persists after refresh since getTasks() prefers worktree version
  if (worktreePath) {
    const specsBaseDir = getSpecsDir(autoBuildPath);
    const worktreePlanPath = path.join(worktreePath, specsBaseDir, specId, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
    const worktreeMetadataPath = path.join(worktreePath, specsBaseDir, specId, 'task_metadata.json');

    try {
      const persisted = await persistPlanStatus(worktreePlanPath, 'done');
      result.worktreeStatus = persisted;
      debug('Worktree status persisted to done:', persisted);
    } catch (err) {
      debug('Failed to persist worktree status:', err);
    }

    result.worktreeMetadata = updateTaskMetadataPrUrl(worktreeMetadataPath, prUrl);
    debug('Worktree metadata updated with prUrl:', result.worktreeMetadata);
  }

  return result;
}

/**
 * Build arguments for the create-pr Python script
 */
function buildCreatePRArgs(
  runScript: string,
  specId: string,
  projectPath: string,
  options: WorktreeCreatePROptions | undefined,
  taskBaseBranch: string | undefined
): { args: string[]; validationError?: string } {
  const args = [
    runScript,
    '--spec', specId,
    '--project-dir', projectPath,
    '--create-pr'
  ];

  // Add optional arguments with validation
  if (options?.targetBranch) {
    // Validate branch name to prevent malformed git commands
    if (!GIT_BRANCH_REGEX.test(options.targetBranch)) {
      return { args: [], validationError: 'Invalid target branch name' };
    }
    args.push('--pr-target', options.targetBranch);
  }
  if (options?.title) {
    // Validate title for printable characters and length limit
    if (options.title.length > MAX_PR_TITLE_LENGTH) {
      return { args: [], validationError: `PR title exceeds maximum length of ${MAX_PR_TITLE_LENGTH} characters` };
    }
    if (!PRINTABLE_CHARS_REGEX.test(options.title)) {
      return { args: [], validationError: 'PR title contains invalid characters' };
    }
    args.push('--pr-title', options.title);
  }
  if (options?.draft) {
    args.push('--pr-draft');
  }

  // Add --base-branch if task was created with a specific base branch
  if (taskBaseBranch) {
    args.push('--base-branch', taskBaseBranch);
  }

  return { args };
}

/**
 * Initialize Python environment for PR creation
 * @returns Error message if initialization fails, undefined on success
 */
async function initializePythonEnvForPR(
  pythonEnvManager: PythonEnvManager
): Promise<string | undefined> {
  if (pythonEnvManager.isEnvReady()) {
    return undefined;
  }

  const autoBuildSource = getEffectiveSourcePath();
  if (!autoBuildSource) {
    return 'Python environment not ready and Auto Claude source not found';
  }

  const status = await pythonEnvManager.initialize(autoBuildSource);
  if (!status.ready) {
    return `Python environment not ready: ${status.error || 'Unknown error'}`;
  }

  return undefined;
}

/**
 * Generic retry wrapper with exponential backoff
 * @param operation - Async function to execute with retry
 * @param options - Retry configuration options
 * @returns Result of the operation or throws after all retries
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, error: unknown) => void;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const { maxRetries: rawMaxRetries = 3, baseDelayMs = 100, onRetry, shouldRetry } = options;

  // Ensure at least one attempt is made (clamp to minimum of 1)
  const maxRetries = Math.max(1, rawMaxRetries);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;

      // Check if we should retry this error
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      if (isLastAttempt) {
        throw error;
      }

      // Notify about retry
      onRetry?.(attempt, error);

      // Wait before retry (exponential backoff)
      await new Promise(r => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new Error('Retry loop exited unexpectedly');
}

/**
 * Register worktree management handlers
 */
export function registerWorktreeHandlers(
  pythonEnvManager: PythonEnvManager,
  getMainWindow: () => BrowserWindow | null
): void {
  /**
   * Get the worktree status for a task
   * Per-spec architecture: Each spec has its own worktree at .auto-claude/worktrees/tasks/{spec-name}/
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_WORKTREE_STATUS,
    async (_, taskId: string): Promise<IPCResult<WorktreeStatus>> => {
      try {
        const { task, project } = findTaskAndProject(taskId);
        if (!task || !project) {
          return { success: false, error: 'Task not found' };
        }

        // Find worktree at .auto-claude/worktrees/tasks/{spec-name}/
        const worktreePath = findTaskWorktree(project.path, task.specId);

        if (!worktreePath) {
          return {
            success: true,
            data: { exists: false }
          };
        }

        // Get branch info from git
        try {
          // Get current branch in worktree
          const branch = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: worktreePath,
            encoding: 'utf-8'
          }).trim();

          // Get base branch using proper fallback chain:
          // 1. Task metadata baseBranch, 2. Project settings mainBranch, 3. main/master detection
          const baseBranch = getEffectiveBaseBranch(project.path, task.specId, project.settings?.mainBranch);

          // Get user's current branch in main project (this is where changes will merge INTO)
          let currentProjectBranch: string | undefined;
          try {
            currentProjectBranch = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
              cwd: project.path,
              encoding: 'utf-8'
            }).trim();
          } catch {
            // Ignore - might be in detached HEAD or git error
          }

          // Get commit count (cross-platform - no shell syntax)
          let commitCount = 0;
          try {
            const countOutput = execFileSync(getToolPath('git'), ['rev-list', '--count', `${baseBranch}..HEAD`], {
              cwd: worktreePath,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            commitCount = parseInt(countOutput, 10) || 0;
          } catch {
            commitCount = 0;
          }

          // Get diff stats
          let filesChanged = 0;
          let additions = 0;
          let deletions = 0;

          let diffStat = '';
          try {
            diffStat = execFileSync(getToolPath('git'), ['diff', '--stat', `${baseBranch}...HEAD`], {
              cwd: worktreePath,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe']
            }).trim();

            // Parse the summary line (e.g., "3 files changed, 50 insertions(+), 10 deletions(-)")
            const summaryMatch = diffStat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
            if (summaryMatch) {
              filesChanged = parseInt(summaryMatch[1], 10) || 0;
              additions = parseInt(summaryMatch[2], 10) || 0;
              deletions = parseInt(summaryMatch[3], 10) || 0;
            }
          } catch {
            // Ignore diff errors
          }

          return {
            success: true,
            data: {
              exists: true,
              worktreePath,
              branch,
              baseBranch,
              currentProjectBranch,
              commitCount,
              filesChanged,
              additions,
              deletions
            }
          };
        } catch (gitError) {
          console.error('Git error getting worktree status:', gitError);
          return {
            success: true,
            data: { exists: true, worktreePath }
          };
        }
      } catch (error) {
        console.error('Failed to get worktree status:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get worktree status'
        };
      }
    }
  );

  /**
   * Get the diff for a task's worktree
   * Per-spec architecture: Each spec has its own worktree at .auto-claude/worktrees/tasks/{spec-name}/
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_WORKTREE_DIFF,
    async (_, taskId: string): Promise<IPCResult<WorktreeDiff>> => {
      try {
        const { task, project } = findTaskAndProject(taskId);
        if (!task || !project) {
          return { success: false, error: 'Task not found' };
        }

        // Find worktree at .auto-claude/worktrees/tasks/{spec-name}/
        const worktreePath = findTaskWorktree(project.path, task.specId);

        if (!worktreePath) {
          return { success: false, error: 'No worktree found for this task' };
        }

        // Get base branch using proper fallback chain:
        // 1. Task metadata baseBranch, 2. Project settings mainBranch, 3. main/master detection
        // Note: We do NOT use current HEAD as that may be a feature branch
        const baseBranch = getEffectiveBaseBranch(project.path, task.specId, project.settings?.mainBranch);

        // Get the diff with file stats
        const files: WorktreeDiffFile[] = [];

        let numstat = '';
        let nameStatus = '';
        try {
          // Get numstat for additions/deletions per file (cross-platform)
          numstat = execFileSync(getToolPath('git'), ['diff', '--numstat', `${baseBranch}...HEAD`], {
            cwd: worktreePath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
          }).trim();

          // Get name-status for file status (cross-platform)
          nameStatus = execFileSync(getToolPath('git'), ['diff', '--name-status', `${baseBranch}...HEAD`], {
            cwd: worktreePath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
          }).trim();

          // Parse name-status to get file statuses
          const statusMap: Record<string, 'added' | 'modified' | 'deleted' | 'renamed'> = {};
          nameStatus.split('\n').filter(Boolean).forEach((line: string) => {
            const [status, ...pathParts] = line.split('\t');
            const filePath = pathParts.join('\t'); // Handle files with tabs in name
            switch (status[0]) {
              case 'A': statusMap[filePath] = 'added'; break;
              case 'M': statusMap[filePath] = 'modified'; break;
              case 'D': statusMap[filePath] = 'deleted'; break;
              case 'R': statusMap[pathParts[1] || filePath] = 'renamed'; break;
              default: statusMap[filePath] = 'modified';
            }
          });

          // Parse numstat for additions/deletions
          numstat.split('\n').filter(Boolean).forEach((line: string) => {
            const [adds, dels, filePath] = line.split('\t');
            files.push({
              path: filePath,
              status: statusMap[filePath] || 'modified',
              additions: parseInt(adds, 10) || 0,
              deletions: parseInt(dels, 10) || 0
            });
          });
        } catch (diffError) {
          console.error('Error getting diff:', diffError);
        }

        // Generate summary
        const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
        const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
        const summary = `${files.length} files changed, ${totalAdditions} insertions(+), ${totalDeletions} deletions(-)`;

        return {
          success: true,
          data: { files, summary }
        };
      } catch (error) {
        console.error('Failed to get worktree diff:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get worktree diff'
        };
      }
    }
  );

  /**
   * Merge the worktree changes into the main branch
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_WORKTREE_MERGE,
    async (_, taskId: string, options?: { noCommit?: boolean }): Promise<IPCResult<WorktreeMergeResult>> => {
      const isDebugMode = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
      const debug = (...args: unknown[]) => {
        if (isDebugMode) {
          console.warn('[MERGE DEBUG]', ...args);
        }
      };

      try {
        debug('Handler called with taskId:', taskId, 'options:', options);

        // Ensure Python environment is ready
        if (!pythonEnvManager.isEnvReady()) {
          const autoBuildSource = getEffectiveSourcePath();
          if (autoBuildSource) {
            const status = await pythonEnvManager.initialize(autoBuildSource);
            if (!status.ready) {
              return { success: false, error: `Python environment not ready: ${status.error || 'Unknown error'}` };
            }
          } else {
            return { success: false, error: 'Python environment not ready and Auto Claude source not found' };
          }
        }

        const { task, project } = findTaskAndProject(taskId);
        if (!task || !project) {
          debug('Task or project not found');
          return { success: false, error: 'Task not found' };
        }

        debug('Found task:', task.specId, 'project:', project.path);

        // Auto-fix any misconfigured bare repo before merge operation
        // This prevents issues where git operations fail due to incorrect bare=true config
        if (fixMisconfiguredBareRepo(project.path)) {
          debug('Fixed misconfigured bare repository at:', project.path);
        }

        // Use run.py --merge to handle the merge
        const sourcePath = getEffectiveSourcePath();
        if (!sourcePath) {
          return { success: false, error: 'Auto Claude source not found' };
        }

        const runScript = path.join(sourcePath, 'run.py');
        const specDir = path.join(project.path, project.autoBuildPath || '.auto-claude', 'specs', task.specId);

        if (!existsSync(specDir)) {
          debug('Spec directory not found:', specDir);
          return { success: false, error: 'Spec directory not found' };
        }

        // Check worktree exists before merge
        const worktreePath = findTaskWorktree(project.path, task.specId);
        debug('Worktree path:', worktreePath, 'exists:', !!worktreePath);

        // Check if changes are already staged (for stage-only mode)
        if (options?.noCommit) {
          const stagedResult = spawnSync(getToolPath('git'), ['diff', '--staged', '--name-only'], {
            cwd: project.path,
            encoding: 'utf-8',
            env: getIsolatedGitEnv()
          });

          if (stagedResult.status === 0 && stagedResult.stdout?.trim()) {
            const stagedFiles = stagedResult.stdout.trim().split('\n');
            debug('Changes already staged:', stagedFiles.length, 'files');
            // Return success - changes are already staged
            return {
              success: true,
              data: {
                success: true,
                merged: false,
                message: `Changes already staged (${stagedFiles.length} files). Review with git diff --staged.`,
                staged: true,
                alreadyStaged: true,
                projectPath: project.path
              }
            };
          }
        }

        // Get git status before merge (only if project is a working tree, not a bare repo)
        if (isGitWorkTree(project.path)) {
          try {
            const gitStatusBefore = execFileSync(getToolPath('git'), ['status', '--short'], { cwd: project.path, encoding: 'utf-8' });
            debug('Git status BEFORE merge in main project:\n', gitStatusBefore || '(clean)');
            const gitBranch = execFileSync(getToolPath('git'), ['branch', '--show-current'], { cwd: project.path, encoding: 'utf-8' }).trim();
            debug('Current branch:', gitBranch);
          } catch (e) {
            debug('Failed to get git status before:', e);
          }
        } else {
          debug('Project is a bare repository - skipping pre-merge git status check');
        }

        const args = [
          runScript,
          '--spec', task.specId,
          '--project-dir', project.path,
          '--merge'
        ];

        // Add --no-commit flag if requested (stage changes without committing)
        if (options?.noCommit) {
          args.push('--no-commit');
        }

        // Add --base-branch with proper priority:
        // 1. Task metadata baseBranch (explicit task-level override)
        // 2. Project settings mainBranch (project-level default)
        // This matches the logic in execution-handlers.ts
        const taskBaseBranch = getTaskBaseBranch(specDir);
        const projectMainBranch = project.settings?.mainBranch;
        const effectiveBaseBranch = taskBaseBranch || projectMainBranch;

        if (effectiveBaseBranch) {
          args.push('--base-branch', effectiveBaseBranch);
          debug('Using base branch:', effectiveBaseBranch,
            `(source: ${taskBaseBranch ? 'task metadata' : 'project settings'})`);
        }

        // Use configured Python path (venv if ready, otherwise bundled/system)
        const pythonPath = getConfiguredPythonPath();
        debug('Running command:', pythonPath, args.join(' '));
        debug('Working directory:', sourcePath);

        // Get profile environment with OAuth token for AI merge resolution
        const profileResult = getBestAvailableProfileEnv();
        const profileEnv = profileResult.env;
        debug('Profile env for merge:', {
          hasOAuthToken: !!profileEnv.CLAUDE_CODE_OAUTH_TOKEN,
          hasConfigDir: !!profileEnv.CLAUDE_CONFIG_DIR
        });

        return new Promise((resolve) => {
          const MERGE_TIMEOUT_MS = 600000; // 10 minutes timeout for AI merge operations with many files
          let timeoutId: NodeJS.Timeout | null = null;
          let resolved = false;

          // Get Python environment for bundled packages
          const pythonEnv = pythonEnvManagerSingleton.getPythonEnv();

          // Get utility settings for merge resolver
          const utilitySettings = getUtilitySettings();
          debug('Utility settings for merge:', utilitySettings);

          // Parse Python command to handle space-separated commands like "py -3"
          const [pythonCommand, pythonBaseArgs] = parsePythonCommand(pythonPath);
          const mergeProcess = spawn(pythonCommand, [...pythonBaseArgs, ...args], {
            cwd: sourcePath,
            env: {
              ...getIsolatedGitEnv(),
              ...pythonEnv,
              ...profileEnv,
              PYTHONUNBUFFERED: '1',
              PYTHONUTF8: '1',
              UTILITY_MODEL: utilitySettings.model,
              UTILITY_MODEL_ID: utilitySettings.modelId,
              UTILITY_THINKING_BUDGET: utilitySettings.thinkingBudget === null ? '' : (utilitySettings.thinkingBudget?.toString() || '')
            },
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let stdout = '';
          let stderr = '';

          // Set up timeout to kill hung processes
          timeoutId = setTimeout(() => {
            if (!resolved) {
              debug('TIMEOUT: Merge process exceeded', MERGE_TIMEOUT_MS, 'ms, killing...');
              resolved = true;

              // Send timeout error progress event to the renderer
              const mainWindow = getMainWindow();
              if (mainWindow) {
                mainWindow.webContents.send(IPC_CHANNELS.TASK_MERGE_PROGRESS, taskId, {
                  type: 'progress',
                  stage: 'error',
                  percent: 0,
                  message: 'Merge process timed out after 10 minutes',
                  details: {}
                });
              }

              // Platform-specific process termination with fallback
              killProcessGracefully(mergeProcess, {
                debugPrefix: '[MERGE]',
                debug: isDebugMode
              });

              // Check if merge might have succeeded before the hang
              // Look for success indicators in the output
              const mayHaveSucceeded = stdout.includes('staged') ||
                                       stdout.includes('Successfully merged') ||
                                       stdout.includes('Changes from');

              if (mayHaveSucceeded) {
                debug('TIMEOUT: Process hung but merge may have succeeded based on output');
                const isStageOnly = options?.noCommit === true;
                resolve({
                  success: true,
                  data: {
                    success: true,
                    message: 'Changes staged (process timed out but merge appeared successful)',
                    staged: isStageOnly,
                    projectPath: isStageOnly ? project.path : undefined
                  }
                });
              } else {
                resolve({
                  success: false,
                  error: 'Merge process timed out. Check git status to see if merge completed.'
                });
              }
            }
          }, MERGE_TIMEOUT_MS);

          let lineBuffer = ''; // Buffer for partial JSON lines spanning data chunks

          mergeProcess.stdout.on('data', (data: Buffer) => {
            const chunk = data.toString('utf-8');
            debug('STDOUT:', chunk);

            // Prepend any buffered partial line from previous chunk
            const combined = lineBuffer + chunk;
            const lines = combined.split('\n');

            // Last element may be a partial line - buffer it for next chunk
            lineBuffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              try {
                const parsed = JSON.parse(trimmed);
                // Validate parsed object has expected MergeProgress structure before forwarding
                if (
                  parsed &&
                  parsed.type === 'progress' &&
                  typeof parsed.stage === 'string' &&
                  typeof parsed.percent === 'number' &&
                  typeof parsed.message === 'string'
                ) {
                  const mainWindow = getMainWindow();
                  if (mainWindow) {
                    mainWindow.webContents.send(IPC_CHANNELS.TASK_MERGE_PROGRESS, taskId, parsed);
                  }
                  // Don't accumulate progress lines in stdout - they are not part of the final result
                  continue;
                }
              } catch {
                // Not valid JSON - treat as regular output
              }

              // Accumulate non-progress lines for final result parsing
              stdout += line + '\n';
            }
          });

          mergeProcess.stderr.on('data', (data: Buffer) => {
            const chunk = data.toString('utf-8');
            stderr += chunk;
            debug('STDERR:', chunk);
          });

          // Handler for when process exits
          const handleProcessExit = async (code: number | null, signal: string | null = null) => {
            if (resolved) return; // Prevent double-resolution
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);

            // Flush any remaining buffered line
            if (lineBuffer.trim()) {
              try {
                const parsed = JSON.parse(lineBuffer.trim());
                if (parsed && parsed.type === 'progress') {
                  const mainWindow = getMainWindow();
                  if (mainWindow) {
                    mainWindow.webContents.send(IPC_CHANNELS.TASK_MERGE_PROGRESS, taskId, parsed);
                  }
                } else {
                  stdout += lineBuffer;
                }
              } catch {
                stdout += lineBuffer;
              }
              lineBuffer = '';
            }

            debug('Process exited with code:', code, 'signal:', signal);
            debug('Full stdout:', stdout);
            debug('Full stderr:', stderr);

            // Get git status after merge (only if project is a working tree, not a bare repo)
            if (isGitWorkTree(project.path)) {
              try {
                const gitStatusAfter = execFileSync(getToolPath('git'), ['status', '--short'], { cwd: project.path, encoding: 'utf-8' });
                debug('Git status AFTER merge in main project:\n', gitStatusAfter || '(clean)');
                const gitDiffStaged = execFileSync(getToolPath('git'), ['diff', '--staged', '--stat'], { cwd: project.path, encoding: 'utf-8' });
                debug('Staged changes:\n', gitDiffStaged || '(none)');
              } catch (e) {
                debug('Failed to get git status after:', e);
              }
            } else {
              debug('Project is a bare repository - skipping git status check (this is normal for worktree-based projects)');
            }

            if (code === 0) {
              const isStageOnly = options?.noCommit === true;

              // Verify changes were actually staged when stage-only mode is requested
              // This prevents false positives when merge was already committed previously
              let hasActualStagedChanges = false;
              let mergeAlreadyCommitted = false;

              if (isStageOnly) {
                // Only check staged changes if project is a working tree (not bare repo)
                if (isGitWorkTree(project.path)) {
                  try {
                    const gitDiffStaged = execFileSync(getToolPath('git'), ['diff', '--staged', '--stat'], { cwd: project.path, encoding: 'utf-8' });
                    hasActualStagedChanges = gitDiffStaged.trim().length > 0;
                    debug('Stage-only verification: hasActualStagedChanges:', hasActualStagedChanges);

                    if (!hasActualStagedChanges) {
                      // Check if worktree branch was already merged (merge commit exists)
                      const specBranch = `auto-claude/${task.specId}`;
                      try {
                        // Check if current branch contains all commits from spec branch
                        // git merge-base --is-ancestor returns exit code 0 if true, 1 if false
                        execFileSync(
                          getToolPath('git'),
                          ['merge-base', '--is-ancestor', specBranch, 'HEAD'],
                          { cwd: project.path, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
                        );
                        // If we reach here, the command succeeded (exit code 0) - branch is merged
                        mergeAlreadyCommitted = true;
                        debug('Merge already committed check:', mergeAlreadyCommitted);
                      } catch {
                        // Exit code 1 means not merged, or branch may not exist
                        mergeAlreadyCommitted = false;
                        debug('Could not check merge status, assuming not merged');
                      }
                    }
                  } catch (e) {
                    debug('Failed to verify staged changes:', e);
                  }
                } else {
                  // For bare repos, skip staging verification - merge happens in worktree
                  debug('Project is a bare repository - skipping staged changes verification');
                }
              }

              // Determine actual status based on verification
              let newStatus: string;
              let planStatus: string;
              let message: string;
              let staged: boolean;

              if (isStageOnly && !hasActualStagedChanges && mergeAlreadyCommitted) {
                // Stage-only was requested but merge was already committed previously
                // Keep in human_review and let user explicitly mark as done (which will trigger cleanup confirmation)
                // This ensures user is in control of when the worktree is deleted
                newStatus = 'human_review';
                planStatus = 'review';
                message = 'Changes were already merged and committed. You can mark this task as complete when ready.';
                staged = false;
                debug('Stage-only requested but merge already committed. Keeping in human_review for user to confirm completion.');
                // NOTE: We intentionally do NOT auto-clean the worktree here.
                // User can drag the task to "Done" column which will show a confirmation dialog
                // asking if they want to delete the worktree and mark complete.
              } else if (isStageOnly && !hasActualStagedChanges) {
                // Stage-only was requested but no changes to stage (and not committed)
                // This could mean nothing to merge or an error - keep in human_review for investigation
                newStatus = 'human_review';
                planStatus = 'review';
                message = 'No changes to stage. The worktree may have no differences from the current branch.';
                staged = false;
                debug('Stage-only requested but no changes to stage.');
              } else if (isStageOnly) {
                // Stage-only with actual staged changes - expected success case
                newStatus = 'human_review';
                planStatus = 'review';
                message = 'Changes staged in main project. Review with git status and commit when ready.';
                staged = true;
              } else {
                // Full merge (not stage-only)
                newStatus = 'done';
                planStatus = 'completed';
                message = 'Changes merged successfully';
                staged = false;

                // Clean up worktree after successful full merge (fixes #243)
                // This allows drag-to-Done workflow since TASK_UPDATE_STATUS blocks 'done' when worktree exists
                // Uses shared cleanup utility for robust Windows support (fixes #1539)
                if (worktreePath && existsSync(worktreePath)) {
                  const cleanupResult = await cleanupWorktree({
                    worktreePath,
                    projectPath: project.path,
                    specId: task.specId,
                    commitMessage: 'Auto-save before merge cleanup',
                    logPrefix: '[TASK_WORKTREE_MERGE]',
                    deleteBranch: true
                  });

                  if (cleanupResult.success) {
                    debug('Worktree cleaned up after full merge:', worktreePath);
                    if (cleanupResult.branch) {
                      debug('Task branch deleted:', cleanupResult.branch);
                    }
                  } else {
                    debug('Worktree cleanup failed (non-fatal):', cleanupResult.warnings);
                    // Non-fatal - merge succeeded, cleanup can be done manually
                  }

                  // Log any warnings for debugging
                  if (cleanupResult.warnings.length > 0) {
                    debug('Cleanup warnings:', cleanupResult.warnings);
                  }
                }
              }

              debug('Merge result. isStageOnly:', isStageOnly, 'newStatus:', newStatus, 'staged:', staged);
              const reviewReason = newStatus === 'human_review' ? 'completed' : undefined;

              // Read suggested commit message if staging succeeded
              // OPTIMIZATION: Use async I/O to prevent blocking
              let suggestedCommitMessage: string | undefined;
              if (staged) {
                const commitMsgPath = path.join(specDir, 'suggested_commit_message.txt');
                try {
                  if (existsSync(commitMsgPath)) {
                    const { promises: fsPromises } = require('fs');
                    suggestedCommitMessage = (await fsPromises.readFile(commitMsgPath, 'utf-8')).trim();
                    debug('Read suggested commit message:', suggestedCommitMessage?.substring(0, 100));
                  }
                } catch (e) {
                  debug('Failed to read suggested commit message:', e);
                }
              }

              // Persist the status change to implementation_plan.json
              // Issue #243: We must update BOTH the main project's plan AND the worktree's plan (if it exists)
              // because ProjectStore prefers the worktree version when deduplicating tasks.
              // OPTIMIZATION: Use async I/O and parallel updates to prevent UI blocking
              // NOTE: The worktree has the same directory structure as main project
              const planPaths: { path: string; isMain: boolean }[] = [
                { path: path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN), isMain: true },
              ];
              // Add worktree plan path if worktree exists
              if (worktreePath) {
                const worktreeSpecDir = path.join(worktreePath, project.autoBuildPath || '.auto-claude', 'specs', task.specId);
                planPaths.push({ path: path.join(worktreeSpecDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN), isMain: false });
              }

              const { promises: fsPromises } = require('fs');

              // Update plan file with retry logic for transient failures
              // Uses EAFP pattern (try/catch) instead of LBYL (existsSync check) to avoid TOCTOU race conditions
              const updatePlanWithRetry = async (planPath: string, isMain: boolean): Promise<boolean> => {
                // Helper to check if error is ENOENT (file not found)
                const isFileNotFound = (err: unknown): boolean =>
                  !!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT');

                try {
                  await withRetry(
                    async () => {
                      const planContent = await fsPromises.readFile(planPath, 'utf-8');
                      const plan = JSON.parse(planContent);
                      plan.status = newStatus;
                      plan.planStatus = planStatus;
                      plan.reviewReason = reviewReason;
                      plan.updated_at = new Date().toISOString();
                      if (staged) {
                        plan.stagedAt = new Date().toISOString();
                        plan.stagedInMainProject = true;
                      }
                      await fsPromises.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');

                      // Verify the write succeeded by reading back
                      const verifyContent = await fsPromises.readFile(planPath, 'utf-8');
                      const verifyPlan = JSON.parse(verifyContent);
                      if (verifyPlan.status !== newStatus || verifyPlan.planStatus !== planStatus) {
                        throw new Error('Write verification failed - status mismatch');
                      }
                    },
                    {
                      maxRetries: 3,
                      baseDelayMs: 100,
                      shouldRetry: (err) => !isFileNotFound(err) // Don't retry if file doesn't exist
                    }
                  );
                  return true;
                } catch (err) {
                  // File doesn't exist - nothing to update (not an error)
                  if (isFileNotFound(err)) {
                    return true;
                  }
                  // Only log error if main plan fails; worktree plan might legitimately be missing or read-only
                  if (isMain) {
                    console.error('Failed to persist task status to main plan after retries:', err);
                  } else {
                    debug('Failed to persist task status to worktree plan (non-critical):', err);
                  }
                  return false;
                }
              };

              const updatePlans = async () => {
                const results = await Promise.all(
                  planPaths.map(({ path: planPath, isMain }) =>
                    updatePlanWithRetry(planPath, isMain)
                  )
                );
                // Log if main plan update failed (first element)
                if (!results[0]) {
                  console.warn('Background plan update: main plan write may not have persisted');
                }
              };

              // IMPORTANT: Wait for plan updates to complete before responding (fixes #243)
              // Previously this was "fire and forget" which caused a race condition:
              // resolve() would return before files were written, and UI refresh would read old status
              try {
                await updatePlans();
              } catch (err) {
                debug('Plan update failed:', err);
                // Non-fatal: UI will still update, but status may not persist across refresh
              }

              // Route status change through TaskStateManager (XState) to avoid dual emission
              taskStateManager.handleManualStatusChange(taskId, newStatus as any, task, project);

              resolve({
                success: true,
                data: {
                  success: true,
                  message,
                  staged,
                  projectPath: staged ? project.path : undefined,
                  suggestedCommitMessage
                }
              });
            } else {
              // Check if there were actual merge conflicts
              // More specific patterns to avoid false positives from debug output like "files_with_conflicts: 0"
              const conflictPatterns = [
                /CONFLICT \(/i,                         // Git merge conflict marker
                /merge conflict/i,                      // Explicit merge conflict message
                /\bconflict detected\b/i,               // Our own conflict detection message
                /\bconflicts? found\b/i,                // "conflicts found" or "conflict found"
                /Automatic merge failed/i,             // Git's automatic merge failure message
              ];
              const combinedOutput = stdout + stderr;
              const hasConflicts = conflictPatterns.some(pattern => pattern.test(combinedOutput));
              debug('Merge failed. hasConflicts:', hasConflicts);

              resolve({
                success: true,
                data: {
                  success: false,
                  message: hasConflicts
                    ? 'Merge conflicts detected'
                    : `Merge failed: ${stripAnsiCodes(stderr || stdout)}`,
                  conflictFiles: hasConflicts ? [] : undefined
                }
              });
            }
          };

          mergeProcess.on('close', (code: number | null, signal: string | null) => {
            handleProcessExit(code, signal);
          });

          // Also listen to 'exit' event in case 'close' doesn't fire
          mergeProcess.on('exit', (code: number | null, signal: string | null) => {
            // Give close event a chance to fire first with complete output
            setTimeout(() => handleProcessExit(code, signal), 100);
          });

          mergeProcess.on('error', (err: Error) => {
            if (resolved) return;
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);
            console.error('[MERGE] Process spawn error:', err);

            // Send error progress event to the renderer
            const mainWindow = getMainWindow();
            if (mainWindow) {
              mainWindow.webContents.send(IPC_CHANNELS.TASK_MERGE_PROGRESS, taskId, {
                type: 'progress',
                stage: 'error',
                percent: 0,
                message: `Merge process crashed: ${err.message}`,
                details: {}
              });
            }

            resolve({
              success: false,
              error: `Failed to run merge: ${err.message}`
            });
          });
        });
      } catch (error) {
        console.error('[MERGE] Exception in merge handler:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to merge worktree'
        };
      }
    }
  );

  /**
   * Preview merge conflicts before actually merging
   * Uses the smart merge system to analyze potential conflicts
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_WORKTREE_MERGE_PREVIEW,
    async (_, taskId: string): Promise<IPCResult<WorktreeMergeResult>> => {
      console.warn('[IPC] TASK_WORKTREE_MERGE_PREVIEW called with taskId:', taskId);
      try {
        // Ensure Python environment is ready
        if (!pythonEnvManager.isEnvReady()) {
          console.warn('[IPC] Python environment not ready, initializing...');
          const autoBuildSource = getEffectiveSourcePath();
          if (autoBuildSource) {
            const status = await pythonEnvManager.initialize(autoBuildSource);
            if (!status.ready) {
              console.error('[IPC] Python environment failed to initialize:', status.error);
              return { success: false, error: `Python environment not ready: ${status.error || 'Unknown error'}` };
            }
          } else {
            console.error('[IPC] Auto Claude source not found');
            return { success: false, error: 'Python environment not ready and Auto Claude source not found' };
          }
        }

        const { task, project } = findTaskAndProject(taskId);
        if (!task || !project) {
          console.error('[IPC] Task not found:', taskId);
          return { success: false, error: 'Task not found' };
        }
        console.warn('[IPC] Found task:', task.specId, 'project:', project.name);

        // Check for uncommitted changes in the main project (only if not a bare repo)
        let hasUncommittedChanges = false;
        let uncommittedFiles: string[] = [];
        if (isGitWorkTree(project.path)) {
          try {
            refreshGitIndex(project.path);

            const gitStatus = execFileSync(getToolPath('git'), ['status', '--porcelain'], {
              cwd: project.path,
              encoding: 'utf-8'
            });

            if (gitStatus?.trim()) {
              // Parse the status output to get file names
              // Format: XY filename (where X and Y are status chars, then space, then filename)
              uncommittedFiles = gitStatus
                .split('\n')
                .filter(line => line.trim())
                .map(line => line.substring(3).trim()) // Skip 2 status chars + 1 space, trim any trailing whitespace
                .filter(file => file); // Remove empty strings from short/malformed status lines

              hasUncommittedChanges = uncommittedFiles.length > 0;
            }
          } catch (e) {
            console.error('[IPC] Failed to check git status:', e);
          }
        } else {
          console.warn('[IPC] Project is a bare repository - skipping uncommitted changes check');
        }

        const sourcePath = getEffectiveSourcePath();
        if (!sourcePath) {
          console.error('[IPC] Auto Claude source not found');
          return { success: false, error: 'Auto Claude source not found' };
        }

        const runScript = path.join(sourcePath, 'run.py');
        const specDir = path.join(project.path, project.autoBuildPath || '.auto-claude', 'specs', task.specId);
        const args = [
          runScript,
          '--spec', task.specId,
          '--project-dir', project.path,
          '--merge-preview'
        ];

        // Add --base-branch with proper priority:
        // 1. Task metadata baseBranch (explicit task-level override)
        // 2. Project settings mainBranch (project-level default)
        // This matches the logic in execution-handlers.ts
        const taskBaseBranch = getTaskBaseBranch(specDir);
        const projectMainBranch = project.settings?.mainBranch;
        const effectiveBaseBranch = taskBaseBranch || projectMainBranch;

        if (effectiveBaseBranch) {
          args.push('--base-branch', effectiveBaseBranch);
          console.warn('[IPC] Using base branch for preview:', effectiveBaseBranch,
            `(source: ${taskBaseBranch ? 'task metadata' : 'project settings'})`);
        }

        // Use configured Python path (venv if ready, otherwise bundled/system)
        const pythonPath = getConfiguredPythonPath();
        console.warn('[IPC] Running merge preview:', pythonPath, args.join(' '));

        // Get profile environment for consistency
        const previewProfileResult = getBestAvailableProfileEnv();
        const previewProfileEnv = previewProfileResult.env;
        // Get Python environment for bundled packages
        const previewPythonEnv = pythonEnvManagerSingleton.getPythonEnv();

        return new Promise((resolve) => {
          // Parse Python command to handle space-separated commands like "py -3"
          const [pythonCommand, pythonBaseArgs] = parsePythonCommand(pythonPath);
          const previewProcess = spawn(pythonCommand, [...pythonBaseArgs, ...args], {
            cwd: sourcePath,
            env: { ...getIsolatedGitEnv(), ...previewPythonEnv, ...previewProfileEnv, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', DEBUG: 'true' }
          });

          let stdout = '';
          let stderr = '';

          previewProcess.stdout.on('data', (data: Buffer) => {
            const chunk = data.toString('utf-8');
            stdout += chunk;
            console.warn('[IPC] merge-preview stdout:', chunk);
          });

          previewProcess.stderr.on('data', (data: Buffer) => {
            const chunk = data.toString('utf-8');
            stderr += chunk;
            console.warn('[IPC] merge-preview stderr:', chunk);
          });

          previewProcess.on('close', (code: number) => {
            console.warn('[IPC] merge-preview process exited with code:', code);
            if (code === 0) {
              try {
                // Parse JSON output from Python
                const result = JSON.parse(stdout.trim());
                console.warn('[IPC] merge-preview result:', JSON.stringify(result, null, 2));
                resolve({
                  success: true,
                  data: {
                    success: result.success,
                    message: result.error || 'Preview completed',
                    preview: {
                      files: result.files || [],
                      conflicts: result.conflicts || [],
                      summary: result.summary || {
                        totalFiles: 0,
                        conflictFiles: 0,
                        totalConflicts: 0,
                        autoMergeable: 0,
                        hasGitConflicts: false
                      },
                      gitConflicts: result.gitConflicts || null,
                      // Include uncommitted changes info for the frontend
                      uncommittedChanges: hasUncommittedChanges ? {
                        hasChanges: true,
                        files: uncommittedFiles,
                        count: uncommittedFiles.length
                      } : null
                    }
                  }
                });
              } catch (parseError) {
                console.error('[IPC] Failed to parse preview result:', parseError);
                console.error('[IPC] stdout:', stdout);
                console.error('[IPC] stderr:', stderr);
                resolve({
                  success: false,
                  error: `Failed to parse preview result: ${stripAnsiCodes(stderr || stdout)}`
                });
              }
            } else {
              console.error('[IPC] Preview failed with exit code:', code);
              console.error('[IPC] stderr:', stderr);
              console.error('[IPC] stdout:', stdout);
              resolve({
                success: false,
                error: `Preview failed: ${stripAnsiCodes(stderr || stdout)}`
              });
            }
          });

          previewProcess.on('error', (err: Error) => {
            console.error('[IPC] merge-preview spawn error:', err);
            resolve({
              success: false,
              error: `Failed to run preview: ${err.message}`
            });
          });
        });
      } catch (error) {
        console.error('[IPC] TASK_WORKTREE_MERGE_PREVIEW error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to preview merge'
        };
      }
    }
  );

  /**
   * Discard the worktree changes
   * Per-spec architecture: Each spec has its own worktree at .auto-claude/worktrees/tasks/{spec-name}/
   *
   * Note: Uses the shared cleanupWorktree utility which handles Windows-specific issues
   * where `git worktree remove --force` fails when the directory contains untracked files.
   * See: https://github.com/AndyMik90/Auto-Claude/issues/1539
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_WORKTREE_DISCARD,
    async (_, taskId: string, skipStatusChange?: boolean): Promise<IPCResult<WorktreeDiscardResult>> => {
      try {
        const { task, project } = findTaskAndProject(taskId);
        if (!task || !project) {
          return { success: false, error: 'Task not found' };
        }

        // Find worktree at .auto-claude/worktrees/tasks/{spec-name}/
        const worktreePath = findTaskWorktree(project.path, task.specId);

        if (!worktreePath) {
          return {
            success: true,
            data: {
              success: true,
              message: 'No worktree to discard'
            }
          };
        }

        // Use the shared cleanup utility for robust, cross-platform worktree deletion
        const cleanupResult = await cleanupWorktree({
          worktreePath,
          projectPath: project.path,
          specId: task.specId,
          commitMessage: 'Auto-save before discard',
          logPrefix: '[TASK_WORKTREE_DISCARD]',
          deleteBranch: true
        });

        if (!cleanupResult.success) {
          console.error('[TASK_WORKTREE_DISCARD] Cleanup failed:', cleanupResult.warnings);
          return {
            success: false,
            error: `Failed to discard worktree: ${cleanupResult.warnings.join('; ')}`
          };
        }

        // Log any non-fatal warnings
        if (cleanupResult.warnings.length > 0) {
          console.warn('[TASK_WORKTREE_DISCARD] Cleanup warnings:', cleanupResult.warnings);
        }
        if (cleanupResult.autoCommitted) {
          console.warn('[TASK_WORKTREE_DISCARD] Auto-committed uncommitted work before discard');
        }


        // Only send status change to backlog if not skipped
        // (skip when caller will set a different status, e.g., 'done')
        if (!skipStatusChange) {
          // Route through TaskStateManager (XState) to avoid dual emission
          taskStateManager.handleManualStatusChange(taskId, 'backlog', task, project);
        }

        return {
          success: true,
          data: {
            success: true,
            message: 'Worktree discarded successfully'
          }
        };
      } catch (error) {
        console.error('Failed to discard worktree:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to discard worktree'
        };
      }
    }
  );

  // Promisified execFile for async git operations
  const execFileAsync = promisify(execFile);

  /**
   * Discard an orphaned worktree by spec name (no task association required)
   * Used when the worktree exists but the task is missing or git state is corrupted
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_WORKTREE_DISCARD_ORPHAN,
    async (_, projectId: string, specName: string): Promise<IPCResult<WorktreeDiscardResult>> => {
      try {
        // Validate inputs
        if (!projectId || typeof projectId !== 'string') {
          console.error('discardOrphanedWorktree: Invalid projectId:', projectId);
          return { success: false, error: 'Invalid projectId' };
        }
        if (!specName || typeof specName !== 'string') {
          console.error('discardOrphanedWorktree: Invalid specName:', specName);
          return { success: false, error: 'Invalid specName' };
        }

        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        // Validate project.path
        if (!project.path || typeof project.path !== 'string') {
          console.error('discardOrphanedWorktree: Project path is invalid:', project.path);
          return { success: false, error: 'Project path is invalid' };
        }

        // Find worktree at .auto-claude/worktrees/tasks/{spec-name}/
        const worktreePath = findTaskWorktree(project.path, specName);

        if (!worktreePath) {
          return {
            success: true,
            data: {
              success: true,
              message: 'No worktree to discard'
            }
          };
        }

        // Use cleanupWorktree which auto-commits any uncommitted changes before deletion
        // This preserves work in git history (recoverable via reflog for ~90 days)
        const cleanupResult = await cleanupWorktree({
          worktreePath,
          projectPath: project.path,
          specId: specName,
          commitMessage: 'Auto-save before orphaned worktree deletion',
          logPrefix: '[ORPHAN_CLEANUP]',
          deleteBranch: true
        });

        if (!cleanupResult.success) {
          return {
            success: false,
            error: cleanupResult.warnings.join(', ') || 'Failed to cleanup orphaned worktree'
          };
        }

        return {
          success: true,
          data: {
            success: true,
            message: cleanupResult.autoCommitted
              ? 'Orphaned worktree deleted (uncommitted changes were auto-saved)'
              : 'Orphaned worktree deleted successfully'
          }
        };
      } catch (error) {
        console.error('Failed to discard orphaned worktree:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to discard orphaned worktree'
        };
      }
    }
  );

  /**
   * List all spec worktrees for a project
   * Per-spec architecture: Each spec has its own worktree at .auto-claude/worktrees/tasks/{spec-name}/
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_LIST_WORKTREES,
    async (_, projectId: string): Promise<IPCResult<WorktreeListResult>> => {
      try {
        // Validate projectId
        if (!projectId || typeof projectId !== 'string') {
          console.error('listWorktrees: Invalid projectId:', projectId);
          return { success: false, error: 'Invalid projectId' };
        }

        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

// Validate project.path
        if (!project.path || typeof project.path !== 'string') {
          console.error('listWorktrees: Project path is invalid:', project.path);
          return { success: false, error: 'Project path is invalid' };
        }

        const worktreesDir = getTaskWorktreeDir(project.path);

        // Fetch tasks once before iterating (avoids repeated lookups per entry)
        // Used for orphan detection - worktrees without a matching task are orphaned
        const tasks = projectStore.getTasks(projectId);
        // Track if task lookup was successful (empty array with existing specs dir = lookup failed)
        const mainSpecsDir = path.join(project.path, '.auto-claude', 'specs');
        const taskLookupSuccessful = tasks.length > 0 || !existsSync(mainSpecsDir);

        // Helper to process a single worktree entry (async)
        const processWorktreeEntry = async (entry: string, entryPath: string): Promise<WorktreeListItem | null> => {
          try {
            // Get branch info (async)
            const branchResult = await execFileAsync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
              cwd: entryPath,
              encoding: 'utf-8'
            });
            const branch = (branchResult.stdout as string).trim();

            // Get base branch using proper fallback chain:
            // 1. Task metadata baseBranch, 2. Project settings mainBranch, 3. main/master detection
            // Note: We do NOT use current HEAD as that may be a feature branch
            const baseBranch = getEffectiveBaseBranch(project.path, entry, project.settings?.mainBranch);

// Get commit count (async, cross-platform - no shell syntax)
            let commitCount = 0;
            try {
              const countResult = await execFileAsync(getToolPath('git'), ['rev-list', '--count', `${baseBranch}..HEAD`], {
                cwd: entryPath,
                encoding: 'utf-8'
              });
              commitCount = parseInt((countResult.stdout as string).trim(), 10) || 0;
            } catch {
              commitCount = 0;
            }

            // Get diff stats (async, cross-platform - no shell syntax)
            let filesChanged = 0;
            let additions = 0;
            let deletions = 0;

            try {
              const diffResult = await execFileAsync(getToolPath('git'), ['diff', '--shortstat', `${baseBranch}...HEAD`], {
                cwd: entryPath,
                encoding: 'utf-8'
              });
              const diffStat = (diffResult.stdout as string).trim();

              const filesMatch = diffStat.match(/(\d+) files? changed/);
              const addMatch = diffStat.match(/(\d+) insertions?/);
              const delMatch = diffStat.match(/(\d+) deletions?/);

              if (filesMatch) filesChanged = parseInt(filesMatch[1], 10) || 0;
              if (addMatch) additions = parseInt(addMatch[1], 10) || 0;
              if (delMatch) deletions = parseInt(delMatch[1], 10) || 0;
            } catch {
              // Ignore diff errors
            }

            // Check if there's a task associated with this worktree
            // A worktree without a task is considered orphaned (can happen if task was deleted)
            // Only mark as orphaned if task lookup was successful (avoid false positives)
            const hasTask = tasks.some(t => t.specId === entry);

            return {
              specName: entry,
              path: entryPath,
              branch,
              baseBranch,
              commitCount,
              filesChanged,
              additions,
              deletions,
              isOrphaned: taskLookupSuccessful ? !hasTask : false
            };
          } catch (gitError) {
            // FIX: Don't skip worktree if git fails - it may be orphaned/corrupted
            // Include it so it can be managed (deleted if orphaned)
            const hasTask = tasks.some(t => t.specId === entry);
            console.warn(`[Worktree] Git commands failed for ${entry}, hasTask=${hasTask}:`, gitError);
            // Note: branch is empty - renderer should handle based on isOrphaned flag
            return {
              specName: entry,
              path: entryPath,
              branch: '',
              baseBranch: '',
              commitCount: 0,
              filesChanged: 0,
              additions: 0,
              deletions: 0,
              isOrphaned: taskLookupSuccessful ? !hasTask : false
            };
          }
        };

        // Scan worktrees directory (async)
        if (!existsSync(worktreesDir)) {
          return { success: true, data: { worktrees: [] } };
        }

        const entries = await fsPromises.readdir(worktreesDir);

        // Process all worktrees in parallel for better performance
        const worktreePromises = entries.map(async (entry) => {
          const entryPath = path.join(worktreesDir, entry);
          try {
            const stat = await fsPromises.stat(entryPath);
            if (stat.isDirectory()) {
              return processWorktreeEntry(entry, entryPath);
            }
          } catch {
            // Skip entries that can't be stat'd
          }
          return null;
        });

        const results = await Promise.all(worktreePromises);
        const worktrees = results.filter((w): w is WorktreeListItem => w !== null);

        return { success: true, data: { worktrees } };
      } catch (error) {
        console.error('Failed to list worktrees:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list worktrees'
        };
      }
    }
  );

  /**
   * Detect installed IDEs and terminals on the system
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_WORKTREE_DETECT_TOOLS,
    async (): Promise<IPCResult<DetectedTools>> => {
      try {
        const tools = await detectInstalledTools();
        return { success: true, data: tools };
      } catch (error) {
        console.error('Failed to detect tools:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to detect installed tools'
        };
      }
    }
  );

  /**
   * Open a worktree directory in the specified IDE
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_WORKTREE_OPEN_IN_IDE,
    async (_, worktreePath: string, ide: SupportedIDE, customPath?: string): Promise<IPCResult<{ opened: boolean }>> => {
      try {
        if (!existsSync(worktreePath)) {
          return { success: false, error: 'Worktree path does not exist' };
        }

        const result = await openInIDE(worktreePath, ide, customPath);
        if (!result.success) {
          return { success: false, error: result.error };
        }

        return { success: true, data: { opened: true } };
      } catch (error) {
        console.error('Failed to open in IDE:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to open in IDE'
        };
      }
    }
  );

  /**
   * Open a worktree directory in the specified terminal
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_WORKTREE_OPEN_IN_TERMINAL,
    async (_, worktreePath: string, terminal: SupportedTerminal, customPath?: string): Promise<IPCResult<{ opened: boolean }>> => {
      try {
        if (!existsSync(worktreePath)) {
          return { success: false, error: 'Worktree path does not exist' };
        }

        const result = await openInTerminal(worktreePath, terminal, customPath);
        if (!result.success) {
          return { success: false, error: result.error };
        }

        return { success: true, data: { opened: true } };
      } catch (error) {
        console.error('Failed to open in terminal:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to open in terminal'
        };
      }
    }
  );

  /**
   * Clear the staged state for a task
   * This allows the user to re-stage changes if needed
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_CLEAR_STAGED_STATE,
    async (_, taskId: string): Promise<IPCResult<{ cleared: boolean }>> => {
      try {
        const { task, project } = findTaskAndProject(taskId);
        if (!task || !project) {
          return { success: false, error: 'Task not found' };
        }

        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const specDir = path.join(project.path, specsBaseDir, task.specId);
        const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);

        // Use EAFP pattern (try/catch) instead of LBYL (existsSync check) to avoid TOCTOU race conditions
        const { promises: fsPromises } = require('fs');
        const isFileNotFound = (err: unknown): boolean =>
          !!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT');

        // Read, update, and write the plan file
        let planContent: string;
        try {
          planContent = await fsPromises.readFile(planPath, 'utf-8');
        } catch (readErr) {
          if (isFileNotFound(readErr)) {
            return { success: false, error: 'Implementation plan not found' };
          }
          throw readErr;
        }

        const plan = JSON.parse(planContent);

        // Clear the staged state flags
        delete plan.stagedInMainProject;
        delete plan.stagedAt;
        plan.updated_at = new Date().toISOString();

        await fsPromises.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');

        // Also update worktree plan if it exists
        const worktreePath = findTaskWorktree(project.path, task.specId);
        if (worktreePath) {
          const worktreePlanPath = path.join(worktreePath, specsBaseDir, task.specId, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
          try {
            const worktreePlanContent = await fsPromises.readFile(worktreePlanPath, 'utf-8');
            const worktreePlan = JSON.parse(worktreePlanContent);
            delete worktreePlan.stagedInMainProject;
            delete worktreePlan.stagedAt;
            worktreePlan.updated_at = new Date().toISOString();
            await fsPromises.writeFile(worktreePlanPath, JSON.stringify(worktreePlan, null, 2), 'utf-8');
          } catch (e) {
            // Non-fatal - worktree plan update is best-effort
            // ENOENT is expected when worktree has no plan file
            if (!isFileNotFound(e)) {
              console.warn('[CLEAR_STAGED_STATE] Failed to update worktree plan:', e);
            }
          }
        }

        // Invalidate tasks cache to force reload
        projectStore.invalidateTasksCache(project.id);

        return { success: true, data: { cleared: true } };
      } catch (error) {
        console.error('Failed to clear staged state:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to clear staged state'
        };
      }
    }
  );

  /**
   * Create a Pull Request from the worktree branch
   * Pushes the branch to origin and creates a GitHub PR using gh CLI
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_WORKTREE_CREATE_PR,
    async (_, taskId: string, options?: WorktreeCreatePROptions): Promise<IPCResult<WorktreeCreatePRResult>> => {
      const isDebugMode = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
      const debug = (...args: unknown[]) => {
        if (isDebugMode) {
          console.warn('[CREATE_PR DEBUG]', ...args);
        }
      };

      try {
        debug('Handler called with taskId:', taskId, 'options:', options);

        // Ensure Python environment is ready
        const pythonEnvError = await initializePythonEnvForPR(pythonEnvManager);
        if (pythonEnvError) {
          return { success: false, error: pythonEnvError };
        }

        const { task, project } = findTaskAndProject(taskId);
        if (!task || !project) {
          debug('Task or project not found');
          return { success: false, error: 'Task not found' };
        }

        debug('Found task:', task.specId, 'project:', project.path);

        // Use run.py --create-pr to handle the PR creation
        const sourcePath = getEffectiveSourcePath();
        if (!sourcePath) {
          return { success: false, error: 'Auto Claude source not found' };
        }

        const runScript = path.join(sourcePath, 'run.py');
        const specDir = path.join(project.path, project.autoBuildPath || '.auto-claude', 'specs', task.specId);

        // Use EAFP pattern - try to read specDir and catch ENOENT
        try {
          statSync(specDir);
        } catch (err) {
          if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
            debug('Spec directory not found:', specDir);
            return { success: false, error: 'Spec directory not found' };
          }
          throw err; // Re-throw unexpected errors
        }

        // Check worktree exists before creating PR
        const worktreePath = findTaskWorktree(project.path, task.specId);
        if (!worktreePath) {
          debug('No worktree found for spec:', task.specId);
          return { success: false, error: 'No worktree found for this task' };
        }
        debug('Worktree path:', worktreePath);

        // Build arguments using helper function
        const taskBaseBranch = getTaskBaseBranch(specDir);
        const { args, validationError } = buildCreatePRArgs(
          runScript,
          task.specId,
          project.path,
          options,
          taskBaseBranch
        );
        if (validationError) {
          return { success: false, error: validationError };
        }
        if (taskBaseBranch) {
          debug('Using stored base branch:', taskBaseBranch);
        }

        // Use configured Python path
        const pythonPath = getConfiguredPythonPath();
        debug('Running command:', pythonPath, args.join(' '));
        debug('Working directory:', sourcePath);

        // Get profile environment with OAuth token
        const profileResult = getBestAvailableProfileEnv();
        const profileEnv = profileResult.env;

        return new Promise((resolve) => {
          let timeoutId: NodeJS.Timeout | null = null;
          let resolved = false;

          // Get Python environment for bundled packages
          const pythonEnv = pythonEnvManagerSingleton.getPythonEnv();

          // Get gh CLI path to pass to Python backend
          const ghCliPath = getToolPath('gh');

          // Parse Python command to handle space-separated commands like "py -3"
          const [pythonCommand, pythonBaseArgs] = parsePythonCommand(pythonPath);
          const createPRProcess = spawn(pythonCommand, [...pythonBaseArgs, ...args], {
            cwd: sourcePath,
            env: {
              ...getIsolatedGitEnv(),
              ...pythonEnv,
              ...profileEnv,
              GITHUB_CLI_PATH: ghCliPath,
              PYTHONUNBUFFERED: '1',
              PYTHONUTF8: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let stdout = '';
          let stderr = '';

          // Set up timeout to kill hung processes
          timeoutId = setTimeout(() => {
            if (!resolved) {
              debug('TIMEOUT: Create PR process exceeded', PR_CREATION_TIMEOUT_MS, 'ms, killing...');
              resolved = true;

              // Platform-specific process termination with fallback
              killProcessGracefully(createPRProcess, {
                debugPrefix: '[PR_CREATION]',
                debug: isDebugMode
              });

              resolve({
                success: false,
                error: 'PR creation timed out. Check if the PR was created on GitHub.'
              });
            }
          }, PR_CREATION_TIMEOUT_MS);

          createPRProcess.stdout.on('data', (data: Buffer) => {
            const chunk = data.toString('utf-8');
            stdout += chunk;
            debug('STDOUT:', chunk);
          });

          createPRProcess.stderr.on('data', (data: Buffer) => {
            const chunk = data.toString('utf-8');
            stderr += chunk;
            debug('STDERR:', chunk);
          });

          /**
           * Handle process exit - shared logic for both 'close' and 'exit' events.
           * Parses JSON output, updates task status if PR was created, and resolves the promise.
           *
           * @param code - Process exit code (0 = success, non-zero = failure)
           * @param eventSource - Which event triggered this ('close' or 'exit') for debug logging
           */
          const handleCreatePRProcessExit = async (code: number | null, eventSource: 'close' | 'exit'): Promise<void> => {
            if (resolved) return;
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);

            debug(`Process exited via ${eventSource} event with code:`, code);
            debug('Full stdout:', stdout);
            debug('Full stderr:', stderr);

            if (code === 0) {
              // Parse JSON output using helper function
              const result = parsePRJsonOutput(stdout);
              if (result) {
                debug('Parsed result:', result);

                // Only update task status if a NEW PR was created (not if it already exists)
                if (result.success !== false && result.prUrl && !result.alreadyExists) {
                  await updateTaskStatusAfterPRCreation(
                    specDir,
                    worktreePath,
                    result.prUrl,
                    project.autoBuildPath,
                    task.specId,
                    debug
                  );
                } else if (result.alreadyExists) {
                  debug('PR already exists, not updating task status');
                }

                resolve({
                  success: true,
                  data: {
                    success: result.success,
                    prUrl: result.prUrl,
                    error: result.error,
                    alreadyExists: result.alreadyExists
                  }
                });
              } else {
                // No JSON found, but process succeeded
                debug('No JSON in output, assuming success');
                resolve({
                  success: true,
                  data: {
                    success: true,
                    prUrl: undefined
                  }
                });
              }
            } else {
              debug('Process failed with code:', code);

              // Try to parse JSON from stdout even on failure
              const result = parsePRJsonOutput(stdout);
              if (result) {
                debug('Parsed error result:', result);
                resolve({
                  success: false,
                  error: result.error || 'Failed to create PR'
                });
              } else {
                // Fallback to raw output if JSON parsing fails
                // Prefer stdout over stderr since stderr often contains debug messages
                resolve({
                  success: false,
                  error: stripAnsiCodes(stdout || stderr || 'Failed to create PR')
                });
              }
            }
          };

          createPRProcess.on('close', (code: number | null) => {
            handleCreatePRProcessExit(code, 'close');
          });

          // Also listen to 'exit' event in case 'close' doesn't fire
          createPRProcess.on('exit', (code: number | null) => {
            // Give close event a chance to fire first with complete output
            setTimeout(() => handleCreatePRProcessExit(code, 'exit'), 100);
          });

          createPRProcess.on('error', (err: Error) => {
            if (resolved) return;
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);
            debug('Process spawn error:', err);
            resolve({
              success: false,
              error: `Failed to run create-pr: ${err.message}`
            });
          });
        });
      } catch (error) {
        console.error('[CREATE_PR] Exception in handler:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create PR'
        };
      }
    }
  );
}
