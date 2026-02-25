/**
 * Platform Abstraction Types
 *
 * Defines the contract for platform-specific operations.
 * All platform differences should be expressed through these types.
 */

/**
 * Supported operating systems
 */
export enum OS {
  Windows = 'win32',
  macOS = 'darwin',
  Linux = 'linux'
}

/**
 * Shell types available on each platform
 */
export enum ShellType {
  PowerShell = 'powershell',
  CMD = 'cmd',
  Bash = 'bash',
  Zsh = 'zsh',
  Fish = 'fish',
  Unknown = 'unknown'
}

/**
 * Platform-specific executable configuration
 */
export interface ExecutableConfig {
  readonly name: string;
  readonly defaultPath: string;
  readonly alternativePaths: readonly string[];
  readonly extension: string;
}

/**
 * Shell configuration for spawning processes
 */
export interface ShellConfig {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Path configuration for a platform
 */
export interface PathConfig {
  readonly separator: string;
  readonly delimiter: string;
  readonly executableExtensions: readonly string[];
}

/**
 * Common binary directories for each platform
 */
export interface BinaryDirectories {
  readonly user: string[];
  readonly system: string[];
}

/**
 * Tool detection result
 */
export interface ToolDetectionResult {
  readonly found: boolean;
  readonly path?: string;
  readonly error?: string;
}
