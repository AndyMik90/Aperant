import { existsSync } from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { findExecutable } from './env-utils';
import { isWindows } from './platform';
import { getWhereExePath } from './utils/windows-paths';

const WINDOWS_CODEX_EXTENSIONS = new Set(['.exe', '.cmd', '.bat']);

export interface CodexCliResolution {
  cliPath: string | null;
  requiresShell: boolean;
  candidates: string[];
}

function isAllowedWindowsCodexPath(candidate: string): boolean {
  const extension = path.extname(candidate).toLowerCase();
  return WINDOWS_CODEX_EXTENSIONS.has(extension);
}

function getWindowsCodexCandidatesFromWhere(): string[] {
  try {
    const result = execFileSync(getWhereExePath(), ['codex'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    }).trim();

    return result
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .filter(isAllowedWindowsCodexPath);
  } catch {
    return [];
  }
}

function scoreWindowsCodexCandidate(candidate: string): number {
  const normalized = candidate.toLowerCase();
  const extension = path.extname(normalized);

  let score = 0;

  if (extension === '.exe') {
    score += 300;
  } else if (extension === '.cmd') {
    score += 200;
  } else if (extension === '.bat') {
    score += 180;
  }

  if (normalized.includes('\\openai.chatgpt-')) {
    score += 50;
  }

  if (normalized.includes('\\appdata\\roaming\\npm\\')) {
    score += 10;
  }

  return score;
}

export function resolveCodexCli(): CodexCliResolution {
  if (!isWindows()) {
    const cliPath = findExecutable('codex');
    return {
      cliPath,
      requiresShell: !!cliPath && /\.(cmd|bat)$/i.test(cliPath),
      candidates: cliPath ? [cliPath] : [],
    };
  }

  const initialCandidate = findExecutable('codex');
  const candidates = Array.from(new Set([
    initialCandidate,
    ...getWindowsCodexCandidatesFromWhere(),
  ].filter((candidate): candidate is string => !!candidate)))
    .filter((candidate) => existsSync(candidate))
    .filter(isAllowedWindowsCodexPath)
    .sort((left, right) => scoreWindowsCodexCandidate(right) - scoreWindowsCodexCandidate(left));

  const cliPath = candidates[0] ?? null;

  return {
    cliPath,
    requiresShell: !!cliPath && /\.(cmd|bat)$/i.test(cliPath),
    candidates,
  };
}
