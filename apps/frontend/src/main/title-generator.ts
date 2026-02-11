import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { detectRateLimit, createSDKRateLimitInfo, getBestAvailableProfileEnv } from './rate-limit-detector';
import { parsePythonCommand, getValidatedPythonPath } from './python-detector';
import { pythonEnvManager, getConfiguredPythonPath } from './python-env-manager';
import { getAPIProfileEnv } from './services/profile';
import { getOAuthModeClearVars } from './agent/env-utils';
import { getEffectiveSourcePath } from './updater/path-resolver';
import { getSentryEnvForSubprocess, safeBreadcrumb, safeCaptureException } from './sentry';
import { maskUserPaths } from '../shared/utils/sentry-privacy';

/**
 * Debug logging - only logs when DEBUG=true or in development mode
 */
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debug(...args: unknown[]): void {
  if (DEBUG) {
    console.warn('[TitleGenerator]', ...args);
  }
}

/**
 * Service for generating task titles from descriptions using Claude AI
 */
export class TitleGenerator extends EventEmitter {
  // Python path will be configured by pythonEnvManager after venv is ready
  private _pythonPath: string | null = null;
  private autoBuildSourcePath: string = '';

  constructor() {
    super();
    debug('TitleGenerator initialized');
  }

  configure(pythonPath?: string, autoBuildSourcePath?: string): void {
    if (pythonPath) {
      this._pythonPath = getValidatedPythonPath(pythonPath, 'TitleGenerator');
    }
    if (autoBuildSourcePath) {
      this.autoBuildSourcePath = autoBuildSourcePath;
    }
  }

  /**
   * Get the configured Python path.
   * Returns explicitly configured path, or falls back to getConfiguredPythonPath()
   * which uses the venv Python if ready.
   */
  private get pythonPath(): string {
    if (this._pythonPath) {
      return this._pythonPath;
    }
    return getConfiguredPythonPath();
  }

  /**
   * Get the auto-claude source path (detects automatically if not configured)
   */
  private getAutoBuildSourcePath(): string | null {
    if (this.autoBuildSourcePath && existsSync(this.autoBuildSourcePath)) {
      return this.autoBuildSourcePath;
    }

    // Use shared path resolver which handles:
    // 1. User settings (autoBuildPath)
    // 2. userData override (backend-source) for user-updated backend
    // 3. Bundled backend (process.resourcesPath/backend)
    // 4. Development paths
    const effectivePath = getEffectiveSourcePath();
    if (existsSync(effectivePath) && existsSync(path.join(effectivePath, 'runners', 'spec_runner.py'))) {
      return effectivePath;
    }

    return null;
  }

  /**
   * Load environment variables from auto-claude .env file
   */
  private loadAutoBuildEnv(): Record<string, string> {
    const autoBuildSource = this.getAutoBuildSourcePath();
    if (!autoBuildSource) return {};

    const envPath = path.join(autoBuildSource, '.env');
    if (!existsSync(envPath)) return {};

    try {
      const envContent = readFileSync(envPath, 'utf-8');
      const envVars: Record<string, string> = {};

      // Handle both Unix (\n) and Windows (\r\n) line endings
      for (const line of envContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();

          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          envVars[key] = value;
        }
      }

      return envVars;
    } catch {
      return {};
    }
  }

  /**
   * Generate a task title from a description using Claude AI
   * @param description - The task description to generate a title from
   * @returns Promise resolving to the generated title or null on failure
   */
  async generateTitle(description: string): Promise<string | null> {
    const autoBuildSource = this.getAutoBuildSourcePath();

    if (!autoBuildSource) {
      debug('Auto-claude source path not found');
      safeBreadcrumb({
        category: 'title-generator',
        message: 'Source path not found',
        level: 'warning',
        data: {
          hasConfiguredPath: !!this.autoBuildSourcePath,
          effectivePathExists: existsSync(getEffectiveSourcePath()),
        },
      });
      return null;
    }

    safeBreadcrumb({
      category: 'title-generator',
      message: 'Source path resolved',
      level: 'info',
      data: { sourcePath: maskUserPaths(autoBuildSource) },
    });

    const prompt = this.createTitlePrompt(description);
    const script = this.createGenerationScript(prompt);

    debug('Generating title for description:', description.substring(0, 100) + '...');

    const autoBuildEnv = this.loadAutoBuildEnv();
    debug('Environment loaded', {
      hasOAuthToken: !!autoBuildEnv.CLAUDE_CODE_OAUTH_TOKEN
    });

    // Get active API profile environment variables (ANTHROPIC_* vars)
    const apiProfileEnv = await getAPIProfileEnv();
    const isApiProfileActive = Object.keys(apiProfileEnv).length > 0;

    // Only get OAuth profile env if no API profile is active to avoid conflicts
    let profileEnv: Record<string, string> = {};
    if (!isApiProfileActive) {
      // Use centralized function that automatically handles rate limits and capacity
      const profileResult = getBestAvailableProfileEnv();
      profileEnv = profileResult.env;

      if (profileResult.wasSwapped) {
        debug('Using alternative profile for title generation:', {
          originalProfile: profileResult.originalProfile?.name,
          selectedProfile: profileResult.profileName,
          reason: profileResult.swapReason
        });
      }
    }

    // Get OAuth mode clearing vars (clears stale ANTHROPIC_* vars when in OAuth mode)
    const oauthModeClearVars = getOAuthModeClearVars(apiProfileEnv);

    // Debug: Log the final environment that will be used
    // Note: profileEnv from getBestAvailableProfileEnv() already includes CLAUDE_CODE_OAUTH_TOKEN=''
    // when CLAUDE_CONFIG_DIR is set, ensuring the subprocess uses the correct credentials
    debug('Final subprocess environment:', {
      profileEnvCLAUDE_CONFIG_DIR: profileEnv.CLAUDE_CONFIG_DIR,
      profileEnvClearsOAuthToken: profileEnv.CLAUDE_CODE_OAUTH_TOKEN === ''
    });

    // Resolve Python path and check env readiness
    const resolvedPythonPath = this.pythonPath;
    const venvReady = pythonEnvManager.isEnvReady();

    safeBreadcrumb({
      category: 'title-generator',
      message: 'Python path resolved',
      level: 'info',
      data: {
        pythonPath: maskUserPaths(resolvedPythonPath),
        venvReady,
        isApiProfileActive,
        hasOAuthEnv: !!profileEnv.CLAUDE_CONFIG_DIR,
      },
    });

    // Guard: if Python env isn't ready, log and fall back gracefully
    if (!venvReady) {
      debug('Python environment not ready, skipping title generation');
      safeBreadcrumb({
        category: 'title-generator',
        message: 'Python environment not ready - skipping title generation',
        level: 'warning',
      });
      return null;
    }

    return new Promise((resolve) => {
      // Parse Python command to handle space-separated commands like "py -3"
      const [pythonCommand, pythonBaseArgs] = parsePythonCommand(resolvedPythonPath);

      safeBreadcrumb({
        category: 'title-generator',
        message: 'Spawning process',
        level: 'info',
        data: { pythonCommand: maskUserPaths(pythonCommand) },
      });

      const childProcess = spawn(pythonCommand, [...pythonBaseArgs, '-c', script], {
        cwd: autoBuildSource,
        env: {
          ...pythonEnvManager.getPythonEnv(), // Python environment including PYTHONPATH (fixes subprocess Python resolution)
          ...getSentryEnvForSubprocess(), // Sentry config for subprocess error tracking
          ...autoBuildEnv,
          ...profileEnv, // Claude OAuth profile - includes CLAUDE_CONFIG_DIR and clears CLAUDE_CODE_OAUTH_TOKEN
          ...apiProfileEnv, // API profile (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, etc.)
          ...oauthModeClearVars, // Clear stale ANTHROPIC_* vars when in OAuth mode
          PYTHONUNBUFFERED: '1', // Ensure stdout isn't buffered (critical for reading output before kill/timeout)
        }
      });

      let output = '';
      let errorOutput = '';
      const timeout = setTimeout(() => {
        console.warn('[TitleGenerator] Title generation timed out after 60s');
        safeBreadcrumb({
          category: 'title-generator',
          message: 'Process timed out after 60s',
          level: 'warning',
        });
        safeCaptureException(new Error('TitleGenerator: process timed out'), {
          contexts: {
            titleGenerator: {
              pythonPath: maskUserPaths(resolvedPythonPath),
              sourcePath: maskUserPaths(autoBuildSource),
              venvReady,
              stderrSnippet: maskUserPaths(errorOutput.substring(0, 500)),
            },
          },
        });
        childProcess.kill();
        resolve(null);
      }, 60000); // 60 second timeout for SDK initialization + API call

      childProcess.stdout?.on('data', (data: Buffer) => {
        output += data.toString('utf-8');
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString('utf-8');
      });

      childProcess.on('exit', (code: number | null) => {
        clearTimeout(timeout);

        if (code === 0 && output.trim()) {
          const title = this.cleanTitle(output.trim());
          debug('Generated title:', title);
          safeBreadcrumb({
            category: 'title-generator',
            message: 'Title generated successfully',
            level: 'info',
          });
          resolve(title);
        } else {
          // Check for rate limit
          const combinedOutput = `${output}\n${errorOutput}`;
          const rateLimitDetection = detectRateLimit(combinedOutput);
          if (rateLimitDetection.isRateLimited) {
            console.warn('[TitleGenerator] Rate limit detected:', {
              resetTime: rateLimitDetection.resetTime,
              limitType: rateLimitDetection.limitType,
              suggestedProfile: rateLimitDetection.suggestedProfile?.name
            });

            safeBreadcrumb({
              category: 'title-generator',
              message: 'Rate limit detected',
              level: 'warning',
              data: {
                limitType: rateLimitDetection.limitType,
                resetTime: rateLimitDetection.resetTime,
              },
            });

            const rateLimitInfo = createSDKRateLimitInfo('title-generator', rateLimitDetection);
            this.emit('sdk-rate-limit', rateLimitInfo);
          }

          // Always log failures to help diagnose issues
          console.warn('[TitleGenerator] Title generation failed', {
            code,
            errorOutput: errorOutput.substring(0, 500),
            output: output.substring(0, 200),
            isRateLimited: rateLimitDetection.isRateLimited
          });

          safeCaptureException(
            new Error(`TitleGenerator: process exited with code ${code}`),
            {
              contexts: {
                titleGenerator: {
                  exitCode: code,
                  pythonPath: maskUserPaths(resolvedPythonPath),
                  sourcePath: maskUserPaths(autoBuildSource),
                  venvReady,
                  isRateLimited: rateLimitDetection.isRateLimited,
                  isApiProfileActive,
                  stderrSnippet: maskUserPaths(errorOutput.substring(0, 500)),
                },
              },
            }
          );

          resolve(null);
        }
      });

      childProcess.on('error', (err) => {
        clearTimeout(timeout);
        console.warn('[TitleGenerator] Process error:', err.message);
        safeCaptureException(err, {
          contexts: {
            titleGenerator: {
              pythonPath: maskUserPaths(resolvedPythonPath),
              sourcePath: maskUserPaths(autoBuildSource),
              venvReady,
              isApiProfileActive,
            },
          },
        });
        resolve(null);
      });
    });
  }

  /**
   * Create the prompt for title generation
   */
  private createTitlePrompt(description: string): string {
    return `Generate a short, concise task title (3-7 words) for the following task description. The title should be action-oriented and describe what will be done. Output ONLY the title, nothing else.

Description:
${description}

Title:`;
  }

  /**
   * Create the Python script to generate title using Claude Agent SDK
   */
  private createGenerationScript(prompt: string): string {
    // Escape the prompt for Python string - use JSON.stringify for safe escaping
    const escapedPrompt = JSON.stringify(prompt);

    return `
import asyncio
import sys

async def generate_title():
    try:
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

        prompt = ${escapedPrompt}

        # Create a minimal client for simple text generation (no tools needed)
        client = ClaudeSDKClient(
            options=ClaudeAgentOptions(
                model="claude-haiku-4-5",
                system_prompt="You generate short, concise task titles (3-7 words). Output ONLY the title, nothing else. No quotes, no explanation, no preamble.",
                max_turns=1,
            )
        )

        async with client:
            # Send the query
            await client.query(prompt)

            # Collect response text from AssistantMessage
            response_text = ""
            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            response_text += block.text

            if response_text:
                # Clean up the result
                title = response_text.strip()
                # Remove any quotes
                title = title.strip('"').strip("'")
                # Take first line only
                title = title.split('\\n')[0].strip()
                if title:
                    print(title)
                    sys.exit(0)

        # If we get here, no valid response
        sys.exit(1)

    except ImportError as e:
        print(f"Import error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

asyncio.run(generate_title())
`;
  }

  /**
   * Clean up the generated title
   */
  private cleanTitle(title: string): string {
    // Remove quotes if present
    let cleaned = title.replace(/^["']|["']$/g, '');

    // Remove any "Title:" or similar prefixes
    cleaned = cleaned.replace(/^(title|task|feature)[:\s]*/i, '');

    // Capitalize first letter
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

    // Truncate if too long (max 100 chars)
    if (cleaned.length > 100) {
      cleaned = cleaned.substring(0, 97) + '...';
    }

    return cleaned.trim();
  }
}

// Export singleton instance
export const titleGenerator = new TitleGenerator();
