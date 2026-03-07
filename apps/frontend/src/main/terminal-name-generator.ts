import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { detectRateLimit, createSDKRateLimitInfo, getBestAvailableProfileEnv } from './rate-limit-detector';
import { parsePythonCommand } from './python-detector';
import { pythonEnvManager } from './python-env-manager';
import { getEffectiveSourcePath } from './updater/path-resolver';

/**
 * Debug logging - only logs when DEBUG=true or in development mode
 */
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debug(...args: unknown[]): void {
  if (DEBUG) {
    console.warn('[TerminalNameGenerator]', ...args);
  }
}

/**
 * Service for generating terminal names from commands using Claude AI
 */
export class TerminalNameGenerator extends EventEmitter {
  private autoBuildSourcePath: string = '';

  constructor() {
    super();
    debug('TerminalNameGenerator initialized');
  }

  /**
   * Configure the auto-claude source path
   */
  configure(autoBuildSourcePath?: string): void {
    if (autoBuildSourcePath) {
      this.autoBuildSourcePath = autoBuildSourcePath;
    }
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
   * Generate a terminal name from a command using Claude AI
   * @param command - The command or recent output to generate a name from
   * @param cwd - Current working directory for context
   * @returns Promise resolving to the generated name (2-3 words) or null on failure
   */
  async generateName(command: string, cwd?: string): Promise<string | null> {
    const autoBuildSource = this.getAutoBuildSourcePath();

    if (!autoBuildSource) {
      debug('Auto-claude source path not found');
      return null;
    }

    // Check if Python environment is ready (has claude_agent_sdk installed)
    if (!pythonEnvManager.isEnvReady()) {
      debug('Python environment not ready, initializing...');
      const status = await pythonEnvManager.initialize(autoBuildSource);
      if (!status.ready) {
        debug('Python environment initialization failed:', status.error);
        return null;
      }
    }

    // Get the venv Python path (where claude_agent_sdk is installed)
    const venvPythonPath = pythonEnvManager.getPythonPath();
    if (!venvPythonPath) {
      debug('Venv Python path not available');
      return null;
    }

    const prompt = this.createNamePrompt(command, cwd);
    const script = this.createGenerationScript(prompt);

    debug('Generating terminal name for command:', command.substring(0, 100) + '...');

    const autoBuildEnv = this.loadAutoBuildEnv();
    debug('Environment loaded', {
      hasOAuthToken: !!autoBuildEnv.CLAUDE_CODE_OAUTH_TOKEN
    });

    // Use centralized function that automatically handles rate limits and capacity
    const profileResult = getBestAvailableProfileEnv();
    const profileEnv = profileResult.env;

    if (profileResult.wasSwapped) {
      debug('Using alternative profile for terminal name generation:', {
        originalProfile: profileResult.originalProfile?.name,
        selectedProfile: profileResult.profileName,
        reason: profileResult.swapReason
      });
    }

    return new Promise((resolve) => {
      // Use the venv Python where claude_agent_sdk is installed
      const [pythonCommand, pythonBaseArgs] = parsePythonCommand(venvPythonPath);
      const childProcess = spawn(pythonCommand, [...pythonBaseArgs, '-c', script], {
        cwd: autoBuildSource,
        env: {
          ...process.env,
          ...autoBuildEnv,
          ...profileEnv, // Include active Claude profile config
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        }
      });

      let output = '';
      let errorOutput = '';
      const timeout = setTimeout(() => {
        debug('Terminal name generation timed out after 30s');
        childProcess.kill();
        resolve(null);
      }, 30000); // 30 second timeout

      childProcess.stdout?.on('data', (data: Buffer) => {
        output += data.toString('utf-8');
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString('utf-8');
      });

      childProcess.on('exit', (code: number | null) => {
        clearTimeout(timeout);

        if (code === 0 && output.trim()) {
          const name = this.cleanName(output.trim());
          debug('Generated terminal name:', name);
          resolve(name);
        } else {
          // Check for rate limit
          const combinedOutput = `${output}\n${errorOutput}`;
          const rateLimitDetection = detectRateLimit(combinedOutput);
          if (rateLimitDetection.isRateLimited) {
            debug('Rate limit detected:', {
              resetTime: rateLimitDetection.resetTime,
              limitType: rateLimitDetection.limitType,
              suggestedProfile: rateLimitDetection.suggestedProfile?.name
            });

            const rateLimitInfo = createSDKRateLimitInfo('other', rateLimitDetection);
            this.emit('sdk-rate-limit', rateLimitInfo);
          }

          if (!rateLimitDetection.isRateLimited) {
            debug('Terminal name generation failed', {
              code,
              errorOutput: errorOutput.substring(0, 500)
            });
          }
          resolve(null);
        }
      });

      childProcess.on('error', (err) => {
        clearTimeout(timeout);
        debug('Process error:', err.message);
        resolve(null);
      });
    });
  }

  /**
   * Create the prompt for terminal name generation
   */
  private createNamePrompt(command: string, cwd?: string): string {
    let prompt = `Generate a very short, descriptive name (2-3 words MAX) for a terminal window based on what it's doing. The name should be concise and help identify the terminal at a glance.

Command or activity:
${command}`;

    if (cwd) {
      prompt += `

Working directory:
${cwd}`;
    }

    prompt += `

Output ONLY the name (2-3 words), nothing else. Examples: "npm build", "git logs", "python tests", "claude dev"`;

    return prompt;
  }

  /**
   * Create the Python script to generate terminal name using Claude Agent SDK
   */
  private createGenerationScript(prompt: string): string {
    // Escape the prompt for Python string - use JSON.stringify for safe escaping
    const escapedPrompt = JSON.stringify(prompt);

    return `
import asyncio
import sys

async def generate_name():
    try:
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

        prompt = ${escapedPrompt}

        # Create a minimal client for simple text generation (no tools needed)
        client = ClaudeSDKClient(
            options=ClaudeAgentOptions(
                model="claude-haiku-4-5",
                system_prompt="You generate very short, concise terminal names (2-3 words MAX). Output ONLY the name, nothing else. No quotes, no explanation, no preamble. Keep it as short as possible while being descriptive.",
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
                name = response_text.strip()
                # Remove any quotes
                name = name.strip('"').strip("'")
                # Take first line only
                name = name.split('\\n')[0].strip()
                if name:
                    print(name)
                    sys.exit(0)

        # If we get here, no valid response
        sys.exit(1)

    except ImportError as e:
        print(f"Import error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

asyncio.run(generate_name())
`;
  }

  /**
   * Clean up the generated name
   */
  private cleanName(name: string): string {
    // Remove quotes if present
    let cleaned = name.replace(/^["']|["']$/g, '');

    // Remove any "Terminal:" or similar prefixes
    cleaned = cleaned.replace(/^(terminal|name)[:\s]*/i, '');

    // Truncate if too long (max 30 chars for terminal names)
    if (cleaned.length > 30) {
      cleaned = cleaned.substring(0, 27) + '...';
    }

    return cleaned.trim();
  }
}

// Export singleton instance
export const terminalNameGenerator = new TerminalNameGenerator();
