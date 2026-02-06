/**
 * Application settings types
 */

import type { NotificationSettings, GraphitiEmbeddingProvider } from './project';
import type { ChangelogFormat, ChangelogAudience, ChangelogEmojiLevel } from './changelog';
import type { SupportedLanguage } from '../constants/i18n';

// Color theme types for multi-theme support
export type ColorTheme = 'default' | 'dusk' | 'lime' | 'ocean' | 'retro' | 'neo' | 'forest';

// Developer tools preferences - IDE and terminal selection
// Comprehensive list based on Stack Overflow Developer Survey 2024, JetBrains Survey, and market research
export type SupportedIDE =
  // Microsoft/VS Code Ecosystem
  | 'vscode'           // Visual Studio Code (~73% market share)
  | 'visualstudio'     // Visual Studio (full IDE)
  | 'vscodium'         // VSCodium (OSS VS Code without telemetry)
  // AI-Powered Editors (VS Code forks & alternatives)
  | 'cursor'           // Cursor (AI-first VS Code fork)
  | 'windsurf'         // Windsurf by Codeium (AI editor)
  | 'zed'              // Zed (high-performance, Rust-based, AI features)
  | 'void'             // Void (open-source AI editor)
  | 'pearai'           // PearAI (open-source AI editor)
  | 'kiro'             // Kiro by AWS (spec-driven agentic IDE)
  // JetBrains IDEs
  | 'intellij'         // IntelliJ IDEA
  | 'pycharm'          // PyCharm
  | 'webstorm'         // WebStorm
  | 'phpstorm'         // PhpStorm
  | 'rubymine'         // RubyMine
  | 'goland'           // GoLand
  | 'clion'            // CLion (C/C++)
  | 'rider'            // Rider (.NET)
  | 'datagrip'         // DataGrip (Database)
  | 'fleet'            // Fleet (lightweight)
  | 'androidstudio'    // Android Studio (based on IntelliJ)
  | 'aqua'             // Aqua (test automation)
  | 'rustrover'        // RustRover (Rust IDE)
  // Classic Text Editors
  | 'sublime'          // Sublime Text
  | 'vim'              // Vim
  | 'neovim'           // Neovim
  | 'emacs'            // Emacs
  | 'nano'             // GNU Nano
  | 'micro'            // Micro (modern terminal editor)
  | 'helix'            // Helix (modal editor, Rust-based)
  | 'kakoune'          // Kakoune (modal editor)
  // Platform-Specific IDEs
  | 'xcode'            // Xcode (Apple)
  | 'eclipse'          // Eclipse
  | 'netbeans'         // NetBeans
  | 'qtcreator'        // Qt Creator
  | 'codeblocks'       // Code::Blocks
  // macOS-Specific Editors
  | 'nova'             // Nova by Panic
  | 'bbedit'           // BBEdit
  | 'textmate'         // TextMate
  | 'coteditor'        // CotEditor
  // Windows-Specific Editors
  | 'notepadpp'        // Notepad++
  | 'ultraedit'        // UltraEdit
  // Linux Editors
  | 'kate'             // Kate (KDE)
  | 'gedit'            // gedit (GNOME)
  | 'geany'            // Geany
  | 'lapce'            // Lapce (Rust-based, fast)
  | 'lite-xl'          // Lite XL (lightweight)
  // Cloud/Browser-Based IDEs
  | 'codespaces'       // GitHub Codespaces
  | 'gitpod'           // Gitpod
  | 'replit'           // Replit
  | 'codesandbox'      // CodeSandbox
  | 'stackblitz'       // StackBlitz
  | 'cloud9'           // AWS Cloud9
  | 'cloudshell'       // Google Cloud Shell Editor
  | 'coder'            // Coder (self-hosted)
  | 'glitch'           // Glitch
  | 'codepen'          // CodePen
  | 'jsfiddle'         // JSFiddle
  | 'colab'            // Google Colab (notebooks)
  | 'jupyter'          // Jupyter/JupyterLab
  | 'dataspell'        // DataSpell (JetBrains data science)
  // Archived/Legacy (still in use)
  | 'atom'             // Atom (archived but still used)
  | 'brackets'         // Brackets (archived)
  // Custom option
  | 'custom';

// Comprehensive terminal emulator support
// Based on GitHub stars, Reddit discussions, and developer surveys
export type SupportedTerminal =
  // System Defaults
  | 'system'           // System default terminal
  // macOS Terminals
  | 'terminal'         // Terminal.app (macOS default)
  | 'iterm2'           // iTerm2 (most popular macOS)
  | 'warp'             // Warp (AI-powered, modern)
  | 'ghostty'          // Ghostty (by Mitchell Hashimoto)
  | 'rio'              // Rio (Rust-based, GPU-accelerated)
  // Windows Terminals
  | 'windowsterminal'  // Windows Terminal (Microsoft)
  | 'powershell'       // PowerShell
  | 'cmd'              // Command Prompt
  | 'conemu'           // ConEmu
  | 'cmder'            // Cmder (ConEmu-based)
  | 'gitbash'          // Git Bash
  | 'cygwin'           // Cygwin
  | 'msys2'            // MSYS2
  // Linux Terminals (Desktop Environment defaults)
  | 'gnometerminal'    // GNOME Terminal
  | 'konsole'          // Konsole (KDE)
  | 'xfce4terminal'    // XFCE4 Terminal
  | 'lxterminal'       // LXTerminal
  | 'mate-terminal'    // MATE Terminal
  // Linux Terminals (Feature-rich)
  | 'terminator'       // Terminator (split panes)
  | 'tilix'            // Tilix (tiling terminal)
  | 'guake'            // Guake (dropdown)
  | 'yakuake'          // Yakuake (KDE dropdown)
  | 'tilda'            // Tilda (dropdown)
  // GPU-Accelerated Terminals (Cross-platform)
  | 'alacritty'        // Alacritty (Rust, ~56k GitHub stars)
  | 'kitty'            // Kitty (Python/C, ~25k GitHub stars)
  | 'wezterm'          // WezTerm (Rust, multiplexer built-in)
  // Cross-Platform Terminals
  | 'hyper'            // Hyper (Electron-based)
  | 'tabby'            // Tabby (formerly Terminus)
  | 'extraterm'        // Extraterm (frames-based)
  | 'contour'          // Contour (modern VT)
  // Minimal/Suckless Terminals
  | 'xterm'            // xterm (X11 classic)
  | 'urxvt'            // rxvt-unicode
  | 'st'               // st (suckless terminal)
  | 'foot'             // Foot (Wayland)
  // Specialty/Retro Terminals
  | 'coolretroterm'    // cool-retro-term (CRT aesthetic)
  // Multiplexers (often used as terminal environment)
  | 'tmux'             // tmux (terminal multiplexer)
  | 'zellij'           // Zellij (modern multiplexer)
  // AI-Enhanced
  | 'fig'              // Fig / Amazon Q Developer (autocomplete)
  // Custom option
  | 'custom';

export interface ThemePreviewColors {
  bg: string;
  accent: string;
  darkBg: string;
  darkAccent?: string;
}

export interface ColorThemeDefinition {
  id: ColorTheme;
  name: string;
  description: string;
  previewColors: ThemePreviewColors;
}

// Thinking level for Claude model (budget token allocation)
export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high' | 'ultrathink';

// Model type shorthand
export type ModelTypeShort = 'haiku' | 'sonnet' | 'opus';

// Phase-based model configuration for Auto profile
// Each phase can use a different model optimized for that task type
export interface PhaseModelConfig {
  spec: ModelTypeShort;       // Spec creation (discovery, requirements, context)
  planning: ModelTypeShort;   // Implementation planning
  coding: ModelTypeShort;     // Actual coding implementation
  qa: ModelTypeShort;         // QA review and fixing
}

// Thinking level configuration per phase
export interface PhaseThinkingConfig {
  spec: ThinkingLevel;
  planning: ThinkingLevel;
  coding: ThinkingLevel;
  qa: ThinkingLevel;
}

// Feature-specific model configuration (for non-pipeline features)
export interface FeatureModelConfig {
  insights: ModelTypeShort;    // Insights chat feature
  ideation: ModelTypeShort;    // Ideation generation
  roadmap: ModelTypeShort;     // Roadmap generation
  githubIssues: ModelTypeShort; // GitHub Issues automation
  githubPrs: ModelTypeShort;    // GitHub PR review automation
  utility: ModelTypeShort;      // Utility agents (commit message, merge resolver)
}

// Feature-specific thinking level configuration
export interface FeatureThinkingConfig {
  insights: ThinkingLevel;
  ideation: ThinkingLevel;
  roadmap: ThinkingLevel;
  githubIssues: ThinkingLevel;
  githubPrs: ThinkingLevel;
  utility: ThinkingLevel;
}

// Agent profile for preset model/thinking configurations
// All profiles have per-phase configuration (phaseModels/phaseThinking)
export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  model: ModelTypeShort;           // Primary model (shown in profile card)
  thinkingLevel: ThinkingLevel;    // Primary thinking level (shown in profile card)
  icon?: string;                   // Lucide icon name
  // Per-phase configuration - all profiles now have this
  phaseModels?: PhaseModelConfig;
  phaseThinking?: PhaseThinkingConfig;
  /** @deprecated Use phaseModels and phaseThinking for per-phase configuration. Will be removed in v3.0. */
  isAutoProfile?: boolean;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  colorTheme?: ColorTheme;
  defaultModel: string;
  agentFramework: string;
  pythonPath?: string;
  gitPath?: string;
  githubCLIPath?: string;
  gitlabCLIPath?: string;
  claudePath?: string;
  autoBuildPath?: string;
  autoUpdateAutoBuild: boolean;
  autoNameTerminals: boolean;
  notifications: NotificationSettings;
  // Global API keys (used as defaults for all projects)
  globalClaudeOAuthToken?: string;
  globalOpenAIApiKey?: string;
  globalAnthropicApiKey?: string;
  globalGoogleApiKey?: string;
  globalGroqApiKey?: string;
  globalOpenRouterApiKey?: string;
  // Graphiti LLM provider settings (legacy)
  graphitiLlmProvider?: 'openai' | 'anthropic' | 'google' | 'groq' | 'ollama';
  ollamaBaseUrl?: string;
  // Memory/Graphiti configuration (app-wide, set during onboarding)
  memoryEnabled?: boolean;
  memoryEmbeddingProvider?: GraphitiEmbeddingProvider;
  memoryOllamaEmbeddingModel?: string;
  memoryOllamaEmbeddingDim?: number;
  memoryVoyageApiKey?: string;
  memoryVoyageEmbeddingModel?: string;
  memoryAzureApiKey?: string;
  memoryAzureBaseUrl?: string;
  memoryAzureEmbeddingDeployment?: string;
  // Agent Memory Access (MCP) - app-wide defaults
  graphitiMcpEnabled?: boolean;
  graphitiMcpUrl?: string;
  // Onboarding wizard completion state
  onboardingCompleted?: boolean;
  // Selected agent profile for preset model/thinking configurations
  selectedAgentProfile?: string;
  // Custom phase configuration for Auto profile (overrides defaults)
  customPhaseModels?: PhaseModelConfig;
  customPhaseThinking?: PhaseThinkingConfig;
  // Feature-specific configuration (insights, ideation, roadmap)
  featureModels?: FeatureModelConfig;
  featureThinking?: FeatureThinkingConfig;
  // Changelog preferences
  changelogFormat?: ChangelogFormat;
  changelogAudience?: ChangelogAudience;
  changelogEmojiLevel?: ChangelogEmojiLevel;
  // UI Scale setting (75-200%, default 100)
  uiScale?: number;
  // Log order setting for task detail view
  logOrder?: 'chronological' | 'reverse-chronological';
  // Beta updates opt-in (receive pre-release updates)
  betaUpdates?: boolean;
  // Migration flags (internal use)
  _migratedAgentProfileToAuto?: boolean;
  _migratedDefaultModelSync?: boolean;
  // Language preference for UI (i18n)
  language?: SupportedLanguage;
  // Developer tools preferences
  preferredIDE?: SupportedIDE;
  customIDEPath?: string;      // For 'custom' IDE
  preferredTerminal?: SupportedTerminal;
  customTerminalPath?: string; // For 'custom' terminal
  // YOLO mode: invoke Claude with --dangerously-skip-permissions flag
  dangerouslySkipPermissions?: boolean;
  // Anonymous error reporting (Sentry) - enabled by default to help improve the app
  sentryEnabled?: boolean;
  // Auto-name Claude terminals based on initial message (only triggers once per session)
  autoNameClaudeTerminals?: boolean;
  // Track which version warnings have been shown (e.g., ["2.7.5"])
  seenVersionWarnings?: string[];
  // Sidebar collapsed state (icons only when true)
  sidebarCollapsed?: boolean;
}

// Auto-Claude Source Environment Configuration (for auto-claude repo .env)
export interface SourceEnvConfig {
  // Claude Authentication (required for ideation, roadmap generation, etc.)
  hasClaudeToken: boolean;
  claudeOAuthToken?: string;

  // Source path info
  sourcePath?: string;
  envExists: boolean;
}

export interface SourceEnvCheckResult {
  hasToken: boolean;
  sourcePath?: string;
  error?: string;
}
