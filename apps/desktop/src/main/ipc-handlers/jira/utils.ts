/**
 * JIRA utility functions
 */

import { readFile, access } from 'fs/promises';
import path from 'path';
import type { Project } from '../../../shared/types';
import { parseEnvFile } from '../utils';
import type { JiraConfig } from './types';

// Default timeout for JIRA API requests (30 seconds)
const JIRA_API_TIMEOUT_MS = 30000;

/**
 * Custom error class for JIRA API errors with structured status code
 */
export class JiraAPIError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'JiraAPIError';
    this.statusCode = statusCode;
  }
}

// JIRA environment variable keys
const JIRA_ENV_KEYS = {
  ENABLED: 'JIRA_ENABLED',
  HOST: 'JIRA_HOST',
  EMAIL: 'JIRA_EMAIL',
  TOKEN: 'JIRA_TOKEN',
  PROJECT_KEY: 'JIRA_PROJECT_KEY'
} as const;

/**
 * Check if a file exists (async)
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Private IP ranges to block for SSRF prevention
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./, // 127.0.0.0/8 (loopback)
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // 169.254.0.0/16 (link-local, includes cloud metadata)
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 unique local
  /^fe80:/i // IPv6 link-local
];

/**
 * Check if a hostname resolves to a private/internal IP
 */
function isPrivateHost(hostname: string): boolean {
  // Block known private hostnames
  if (hostname === 'localhost' || hostname === 'metadata.google.internal') {
    return true;
  }

  // Check if the hostname itself is an IP address matching private ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitize and validate a JIRA host URL
 *
 * Validates:
 * - Must be a valid URL
 * - Protocol must be https (allow http only for localhost in development)
 * - No credentials in URL
 * - Block private/internal IPs (SSRF prevention)
 * - Block cloud metadata endpoints
 */
export function sanitizeJiraHost(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);

    // Must be https (allow http only for localhost in development)
    if (parsed.protocol !== 'https:') {
      if (parsed.protocol === 'http:' && parsed.hostname === 'localhost' && process.env.NODE_ENV === 'development') {
        // Allow http://localhost in development only
      } else {
        return null;
      }
    }

    // No credentials in URL
    if (parsed.username || parsed.password) {
      return null;
    }

    // Must have a hostname
    if (!parsed.hostname) {
      return null;
    }

    // Block private/internal IPs
    if (isPrivateHost(parsed.hostname)) {
      return null;
    }

    // Return origin (protocol + host, no trailing path)
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Sanitize a token value - strip control characters and limit length
 */
function sanitizeToken(value: string | undefined): string | null {
  if (!value) return null;
  let sanitized = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      continue;
    }
    sanitized += value[i];
  }
  const trimmed = sanitized.trim();
  if (!trimmed) return null;
  return trimmed.length > 512 ? trimmed.substring(0, 512) : trimmed;
}

/**
 * Sanitize an email value - basic validation
 */
function sanitizeEmail(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed.length > 254 ? null : trimmed;
}

/**
 * Get JIRA configuration from project environment file
 * Returns null if JIRA is explicitly disabled or not configured
 */
export async function getJiraConfig(project: Project): Promise<JiraConfig | null> {
  if (!project.autoBuildPath) return null;
  const envPath = path.join(project.path, project.autoBuildPath, '.env');
  if (!(await fileExists(envPath))) return null;

  try {
    const content = await readFile(envPath, 'utf-8');
    const vars = parseEnvFile(content);

    // Check if JIRA is explicitly disabled
    if (vars[JIRA_ENV_KEYS.ENABLED]?.toLowerCase() === 'false') {
      return null;
    }

    const host = sanitizeJiraHost(vars[JIRA_ENV_KEYS.HOST] ?? '');
    const email = sanitizeEmail(vars[JIRA_ENV_KEYS.EMAIL]);
    const token = sanitizeToken(vars[JIRA_ENV_KEYS.TOKEN]);
    const projectKey = vars[JIRA_ENV_KEYS.PROJECT_KEY]?.trim() || undefined;

    if (!host || !email || !token) return null;

    return { host, email, token, projectKey };
  } catch {
    return null;
  }
}

/**
 * Make a request to the JIRA REST API with timeout
 *
 * Uses Basic authentication with email:token encoded as base64
 */
export async function jiraFetch(
  config: JiraConfig,
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  const host = sanitizeJiraHost(config.host);
  if (!host) {
    throw new JiraAPIError('Invalid JIRA host URL', 0);
  }
  if (!endpoint.startsWith('/')) {
    throw new JiraAPIError('JIRA endpoint must be a relative path', 0);
  }

  const url = `${host}/rest/api/3${endpoint}`;

  // Basic auth: base64(email:token)
  const credentials = Buffer.from(`${config.email}:${config.token}`).toString('base64');

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), JIRA_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
        Authorization: `Basic ${credentials}`
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new JiraAPIError(
        `JIRA API error: ${response.status} ${response.statusText} - ${errorBody}`,
        response.status
      );
    }

    // Some JIRA endpoints return 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new JiraAPIError(`JIRA API timeout after ${JIRA_API_TIMEOUT_MS / 1000}s: ${url}`, 0);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
