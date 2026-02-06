import path from 'path';
import { getAugmentedEnv, getAugmentedEnvAsync } from './env-utils';
import { getToolPath, getToolPathAsync } from './cli-tool-manager';
import { isWindows, getPathDelimiter } from './platform';

export type ClaudeCliInvocation = {
  command: string;
  env: Record<string, string>;
};

function ensureCommandDirInPath(command: string, env: Record<string, string>): Record<string, string> {
  if (!path.isAbsolute(command)) {
    return env;
  }

  const pathSeparator = getPathDelimiter();
  const commandDir = path.dirname(command);
  const currentPath = env.PATH || '';
  const pathEntries = currentPath.split(pathSeparator);
  const normalizedCommandDir = path.normalize(commandDir);
  const hasCommandDir = isWindows()
    ? pathEntries
      .map((entry) => path.normalize(entry).toLowerCase())
      .includes(normalizedCommandDir.toLowerCase())
    : pathEntries
      .map((entry) => path.normalize(entry))
      .includes(normalizedCommandDir);

  if (hasCommandDir) {
    return env;
  }

  return {
    ...env,
    PATH: [commandDir, currentPath].filter(Boolean).join(pathSeparator),
  };
}

/**
 * Returns the Claude CLI command path and an environment with PATH updated to include the CLI directory.
 *
 * WARNING: This function uses synchronous subprocess calls that block the main process.
 * For use in Electron main process, prefer getClaudeCliInvocationAsync() instead.
 */
export function getClaudeCliInvocation(): ClaudeCliInvocation {
  const command = getToolPath('claude');
  const env = getAugmentedEnv();

  return {
    command,
    env: ensureCommandDirInPath(command, env),
  };
}

/**
 * Returns the Claude CLI command path and environment asynchronously (non-blocking).
 *
 * Safe to call from Electron main process without blocking the event loop.
 * Uses cached values if available for instant response.
 *
 * @example
 * ```typescript
 * const { command, env } = await getClaudeCliInvocationAsync();
 * spawn(command, ['--version'], { env });
 * ```
 */
export async function getClaudeCliInvocationAsync(): Promise<ClaudeCliInvocation> {
  // Run both detections in parallel for efficiency
  const [command, env] = await Promise.all([
    getToolPathAsync('claude'),
    getAugmentedEnvAsync(),
  ]);

  return {
    command,
    env: ensureCommandDirInPath(command, env),
  };
}
