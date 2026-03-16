/**
 * Jules Dispatcher
 * ================
 *
 * Dispatches tasks to Google Jules (async coding agent) when
 * agentFramework is set to 'jules' in app settings.
 *
 * Jules runs tasks in isolated cloud VMs and creates PRs automatically.
 * Uses the Jules CLI (`jules new`) for task creation and
 * `jules remote list --session` for status polling.
 *
 * Auth: Jules CLI uses Google OAuth (via `jules login`).
 * The JULES_API_KEY is only needed for the MCP server, not the CLI.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { AppSettings } from '../../shared/types';

export interface JulesDispatchResult {
  success: boolean;
  sessionId?: string;
  error?: string;
  output: string;
}

export interface JulesSessionStatus {
  id: string;
  description: string;
  repo: string;
  lastActive: string;
  status: string;
}

/**
 * Dispatch a task to Jules via the CLI.
 *
 * @param prompt - Task description / spec content
 * @param settings - App settings containing Jules config
 * @param cwd - Working directory (used to infer repo if julesDefaultRepo not set)
 * @returns Dispatch result with session ID
 */
export async function dispatchToJules(
  prompt: string,
  settings: AppSettings,
  cwd: string
): Promise<JulesDispatchResult> {
  const repo = settings.julesDefaultRepo;
  const autoCreatePr = settings.julesAutoCreatePr ?? true;

  // Append project context to the prompt
  const fullPrompt = `${prompt}

## Instructions
- Read CLAUDE.md / README.md for project conventions before starting
- Run the project's lint/check/build commands before committing
- ${autoCreatePr ? 'Create a PR when done' : 'Push to a branch (do not create PR)'}`;

  // Use stdin pipe instead of CLI arg to avoid Windows command-line length limits (~8K chars).
  // Jules CLI supports: cat prompt.txt | jules new --repo owner/repo
  const args = ['new'];
  if (repo) {
    args.push('--repo', repo);
  }

  return new Promise((resolve) => {
    const child = spawn('jules', args, {
      cwd,
      env: {
        ...process.env,
        ...(settings.julesApiKey ? { JULES_API_KEY: settings.julesApiKey } : {}),
      },
      shell: true,
    });

    // Pipe the prompt via stdin (avoids arg length limits)
    child.stdin?.write(fullPrompt);
    child.stdin?.end();

    let output = '';
    let errorOutput = '';

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    child.on('error', (err: Error) => {
      resolve({
        success: false,
        error: `Failed to launch jules CLI: ${err.message}. Is jules installed? (npm i -g @google/jules)`,
        output: errorOutput,
      });
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        // Try to extract session ID from output
        const sessionMatch = output.match(/session[:\s]+(\d+)/i) ||
                            output.match(/ID[:\s]+(\d+)/i);
        resolve({
          success: true,
          sessionId: sessionMatch?.[1],
          output,
        });
      } else {
        resolve({
          success: false,
          error: `jules exited with code ${code}`,
          output: output + errorOutput,
        });
      }
    });
  });
}

/**
 * List recent Jules sessions.
 */
export async function listJulesSessions(): Promise<JulesSessionStatus[]> {
  return new Promise((resolve) => {
    const child = spawn('jules', ['remote', 'list', '--session'], {
      shell: true,
    });

    let output = '';

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.on('error', () => {
      resolve([]);
    });

    child.on('close', () => {
      // Parse the table output from jules remote list
      const lines = output.split('\n').filter(l => l.trim() && !l.includes('ID'));
      const sessions: JulesSessionStatus[] = lines.map(line => {
        const parts = line.trim().split(/\s{2,}/);
        return {
          id: parts[0] || '',
          description: parts[1] || '',
          repo: parts[2] || '',
          lastActive: parts[3] || '',
          status: parts[4] || '',
        };
      }).filter(s => s.id);

      resolve(sessions);
    });
  });
}

/**
 * Pull and apply a Jules session result to the local repo.
 */
export async function pullJulesSession(
  sessionId: string,
  apply: boolean = false
): Promise<{ success: boolean; output: string }> {
  const args = ['remote', 'pull', '--session', sessionId];
  if (apply) {
    args.push('--apply');
  }

  return new Promise((resolve) => {
    const child = spawn('jules', args, { shell: true });
    let output = '';

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.on('error', (err: Error) => {
      resolve({ success: false, output: err.message });
    });

    child.on('close', (code: number | null) => {
      resolve({ success: code === 0, output });
    });
  });
}
