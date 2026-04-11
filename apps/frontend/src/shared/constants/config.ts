/**
 * Application configuration constants
 * Default settings, file paths, and project structure
 */

// ============================================
// Terminal Timing Constants
// ============================================

/** Delay for DOM updates before terminal operations (refit, resize).
 * Must be long enough for dnd-kit CSS transitions to complete after drag-drop reorder.
 * 50ms was too short, causing xterm to fit into containers with zero/invalid dimensions. */
export const TERMINAL_DOM_UPDATE_DELAY_MS = 250;

/** Grace period before cleaning up error panel constraints after panel removal */
export const PANEL_CLEANUP_GRACE_PERIOD_MS = 150;

// ============================================
// UI Scale Constants
// ============================================

export const UI_SCALE_MIN = 75;
export const UI_SCALE_MAX = 200;
export const UI_SCALE_DEFAULT = 100;
export const UI_SCALE_STEP = 5;

// ============================================
// Default App Settings
// ============================================

export const DEFAULT_APP_SETTINGS = {
  theme: 'dark' as const,
  colorTheme: 'default' as const,
  defaultModel: 'opus',
  agentFramework: 'auto-claude',
  pythonPath: undefined as string | undefined,
  gitPath: undefined as string | undefined,
  githubCLIPath: undefined as string | undefined,
  gitlabCLIPath: undefined as string | undefined,
  autoBuildPath: undefined as string | undefined,
  autoUpdateAutoBuild: true,
  autoNameTerminals: true,
  onboardingCompleted: false,
  notifications: {
    onTaskComplete: true,
    onTaskFailed: true,
    onReviewNeeded: true,
    sound: false
  },
  // Global API keys (used as defaults for all projects)
  globalClaudeOAuthToken: undefined as string | undefined,
  globalOpenAIApiKey: undefined as string | undefined,
  // Selected agent profile - defaults to 'auto' for per-phase optimized model selection
  selectedAgentProfile: 'auto',
  // Changelog preferences (persisted between sessions)
  changelogFormat: 'keep-a-changelog' as const,
  changelogAudience: 'user-facing' as const,
  changelogEmojiLevel: 'none' as const,
  // UI Scale (default 100% - standard size)
  uiScale: UI_SCALE_DEFAULT,
  // Log order setting for task detail view (default chronological - oldest first)
  logOrder: 'chronological' as const,
  // Beta updates opt-in (receive pre-release versions)
  betaUpdates: false,
  // Language preference (default to English)
  language: 'en' as const,
  // Anonymous error reporting (Sentry) - enabled by default to help improve the app
  sentryEnabled: true,
  // Auto-name Claude terminals based on initial message (enabled by default)
  autoNameClaudeTerminals: true,
  // Auto-restart on prompt loop or crash (disabled by default for safety)
  autoRestartOnFailure: {
    enabled: false,
    buildCommand: 'npm run build',
    maxRestartsPerHour: 3,
    cooldownMinutes: 5
  },
  // Auto-refresh on task changes (enabled by default for better UX)
  autoRefreshOnTaskChanges: {
    enabled: true,
    debounceMs: 500,
    refreshDelayMs: 100
  },
  // Crash recovery via external watchdog (enabled by default for reliability)
  crashRecovery: {
    enabled: true,         // When enabled: auto-restart via watchdog; when disabled: do nothing
    autoRestart: true,     // Auto-restart after crash (if enabled is true)
    maxRestarts: 3,        // Maximum restarts within cooldown period
    restartCooldown: 60000, // Cooldown period in ms (1 minute)
    freezeDetection: true,              // Detect renderer hangs + main process freezes
    rendererFreezeGraceMs: 15000,       // 15s grace before killing unresponsive renderer
    heartbeatIntervalMs: 10000,         // Write heartbeat every 10s
    heartbeatStaleThresholdMs: 45000    // Stale after 45s = freeze detected
  },
  // Auto-shutdown when all tasks across ALL projects reach Human Review (disabled by default)
  autoShutdownEnabled: false,
  providerAccounts: [],
  globalPriorityOrder: [],
  disabledAutoSwitchAccountIds: [],
  _migratedProviderAccounts: false,
  desktopAgnosticPinEnabled: false,
  desktopProjectAssociations: []
};

// ============================================
// Default Project Settings
// ============================================

export const DEFAULT_PROJECT_SETTINGS = {
  model: 'opus',
  memoryBackend: 'file' as const,
  linearSync: false,
  notifications: {
    onTaskComplete: true,
    onTaskFailed: true,
    onReviewNeeded: true,
    sound: false
  },
  // Graphiti MCP server for agent-accessible knowledge graph (enabled by default)
  graphitiMcpEnabled: true,
  graphitiMcpUrl: 'http://localhost:8000/mcp/',
  // Include CLAUDE.md instructions in agent context (enabled by default)
  useClaudeMd: true,
  // LLM Manager control - allow Claude Code to trigger builds/restarts (disabled by default, experimental)
  llmManagerEnabled: false
};

// ============================================
// Default RDR Mechanisms
// ============================================

// Default RDR sending mechanisms (profiles)
// Users can create additional mechanisms in settings
export const DEFAULT_RDR_MECHANISMS = [
  {
    id: 'windows-claude-code-vscode',
    name: 'Windows Claude Code for VS Code',
    template: `$ProgressPreference = 'SilentlyContinue'
$Handle = {{identifier}}
$MessageFile = '{{messagePath}}'

# Read message from file
if (-not (Test-Path $MessageFile)) {
    Write-Error "Message file not found: $MessageFile"
    exit 1
}
$Message = Get-Content -Path $MessageFile -Raw -Encoding UTF8

# Clean up temp file
Remove-Item -Path $MessageFile -Force -ErrorAction SilentlyContinue

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
}
"@

# Validate window handle
if (-not [Win32]::IsWindow([IntPtr]$Handle)) {
    Write-Error "Invalid window handle"
    exit 1
}

# Save original foreground window
$original = [Win32]::GetForegroundWindow()

# Copy message to clipboard
Set-Clipboard -Value $Message

# Focus target window
[Win32]::SetForegroundWindow([IntPtr]$Handle) | Out-Null
Start-Sleep -Milliseconds 150

# Verify focus succeeded
$current = [Win32]::GetForegroundWindow()
if ($current -ne [IntPtr]$Handle) {
    Write-Error "Failed to focus window"
    exit 1
}

# Send Ctrl+V (paste)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 100

# Send Enter (submit)
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 50

# Restore original window (optional, don't fail if it doesn't work)
if ($original -ne [IntPtr]::Zero -and $original -ne [IntPtr]$Handle) {
    Start-Sleep -Milliseconds 100
    [Win32]::SetForegroundWindow($original) | Out-Null
}

Write-Output "Message sent successfully"`,
    isDefault: true
  }
];

// ============================================
// Auto Build File Paths
// ============================================

// File paths relative to project
// IMPORTANT: All paths use .auto-claude/ (the installed instance), NOT auto-claude/ (source code)
export const AUTO_BUILD_PATHS = {
  SPECS_DIR: '.auto-claude/specs',
  ROADMAP_DIR: '.auto-claude/roadmap',
  IDEATION_DIR: '.auto-claude/ideation',
  IMPLEMENTATION_PLAN: 'implementation_plan.json',
  SPEC_FILE: 'spec.md',
  QA_REPORT: 'qa_report.md',
  BUILD_PROGRESS: 'build-progress.txt',
  GENERATION_PROGRESS: 'generation_progress.json',
  CONTEXT: 'context.json',
  REQUIREMENTS: 'requirements.json',
  ROADMAP_FILE: 'roadmap.json',
  ROADMAP_DISCOVERY: 'roadmap_discovery.json',
  COMPETITOR_ANALYSIS: 'competitor_analysis.json',
  IDEATION_FILE: 'ideation.json',
  IDEATION_CONTEXT: 'ideation_context.json',
  PROJECT_INDEX: '.auto-claude/project_index.json',
  GRAPHITI_STATE: '.graphiti_state.json'
} as const;

/**
 * Get the specs directory path.
 * All specs go to .auto-claude/specs/ (the project's data directory).
 */
export function getSpecsDir(autoBuildPath: string | undefined): string {
  const basePath = autoBuildPath || '.auto-claude';
  return `${basePath}/specs`;
}
