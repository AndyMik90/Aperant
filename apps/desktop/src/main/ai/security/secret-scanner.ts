/**
 * Secret Scanner
 * ==============
 *
 * Scans file content for potential secrets before commit.
 * Designed to prevent accidental exposure of API keys, tokens, and credentials.
 *
 * See apps/desktop/src/main/ai/security/secret-scanner.ts for the TypeScript implementation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Secret Patterns
// ---------------------------------------------------------------------------

/** Generic high-entropy patterns that match common API key formats */
export const GENERIC_PATTERNS: Array<[RegExp, string]> = [
  // Generic API key patterns (32+ char alphanumeric strings assigned to variables)
  [
    /(?:api[_-]?key|apikey|api_secret|secret[_-]?key)\s*[:=]\s*["']([a-zA-Z0-9_-]{32,})["']/i,
    'Generic API key assignment',
  ],
  // Generic token patterns
  [
    /(?:access[_-]?token|auth[_-]?token|bearer[_-]?token|token)\s*[:=]\s*["']([a-zA-Z0-9_-]{32,})["']/i,
    'Generic access token',
  ],
  // Password patterns
  [
    /(?:password|passwd|pwd|pass)\s*[:=]\s*["']([^"']{8,})["']/i,
    'Password assignment',
  ],
  // Generic secret patterns
  [
    /(?:secret|client_secret|app_secret)\s*[:=]\s*["']([a-zA-Z0-9_/+=]{16,})["']/i,
    'Secret assignment',
  ],
  // Bearer tokens in headers
  [/["']?[Bb]earer\s+([a-zA-Z0-9_-]{20,})["']?/, 'Bearer token'],
  // Base64-encoded secrets (longer than typical, may be credentials)
  [/["'][A-Za-z0-9+/]{64,}={0,2}["']/, 'Potential base64-encoded secret'],
];

/** Service-specific patterns (known formats) */
export const SERVICE_PATTERNS: Array<[RegExp, string]> = [
  // OpenAI / Anthropic style keys
  [/sk-[a-zA-Z0-9]{20,}/, 'OpenAI/Anthropic-style API key'],
  [/sk-ant-[a-zA-Z0-9-]{20,}/, 'Anthropic API key'],
  [/sk-proj-[a-zA-Z0-9-]{20,}/, 'OpenAI project API key'],
  // AWS
  [/AKIA[0-9A-Z]{16}/, 'AWS Access Key ID'],
  [
    /(?:aws_secret_access_key|aws_secret)\s*[:=]\s*["']?([a-zA-Z0-9/+=]{40})["']?/i,
    'AWS Secret Access Key',
  ],
  // Google Cloud
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API Key'],
  [/"type"\s*:\s*"service_account"/, 'Google Service Account JSON'],
  // GitHub
  [/ghp_[a-zA-Z0-9]{36}/, 'GitHub Personal Access Token'],
  [/github_pat_[a-zA-Z0-9_]{22,}/, 'GitHub Fine-grained PAT'],
  [/gho_[a-zA-Z0-9]{36}/, 'GitHub OAuth Token'],
  [/ghs_[a-zA-Z0-9]{36}/, 'GitHub App Installation Token'],
  [/ghr_[a-zA-Z0-9]{36}/, 'GitHub Refresh Token'],
  // Stripe
  [/sk_live_[0-9a-zA-Z]{24,}/, 'Stripe Live Secret Key'],
  [/sk_test_[0-9a-zA-Z]{24,}/, 'Stripe Test Secret Key'],
  [/pk_live_[0-9a-zA-Z]{24,}/, 'Stripe Live Publishable Key'],
  [/rk_live_[0-9a-zA-Z]{24,}/, 'Stripe Restricted Key'],
  // Slack
  [/xox[baprs]-[0-9a-zA-Z-]{10,}/, 'Slack Token'],
  [/https:\/\/hooks\.slack\.com\/services\/[A-Z0-9/]+/, 'Slack Webhook URL'],
  // Discord
  [/[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}/, 'Discord Bot Token'],
  [
    /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/,
    'Discord Webhook URL',
  ],
  // Twilio
  [/SK[a-f0-9]{32}/, 'Twilio API Key'],
  [/AC[a-f0-9]{32}/, 'Twilio Account SID'],
  // SendGrid
  [/SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/, 'SendGrid API Key'],
  // Mailchimp
  [/[a-f0-9]{32}-us\d+/, 'Mailchimp API Key'],
  // NPM
  [/npm_[a-zA-Z0-9]{36}/, 'NPM Access Token'],
  // PyPI
  [/pypi-[a-zA-Z0-9]{60,}/, 'PyPI API Token'],
  // Supabase/JWT
  [
    /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{50,}/,
    'Supabase/JWT Token',
  ],
  // Linear
  [/lin_api_[a-zA-Z0-9]{40,}/, 'Linear API Key'],
  // Vercel
  [/[a-zA-Z0-9]{24}_[a-zA-Z0-9]{28,}/, 'Potential Vercel Token'],
  // Heroku
  [
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/,
    'Heroku API Key / UUID',
  ],
  // Doppler
  [/dp\.pt\.[a-zA-Z0-9]{40,}/, 'Doppler Service Token'],
];

/** Private key patterns */
export const PRIVATE_KEY_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/, 'RSA Private Key'],
  [/-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/, 'OpenSSH Private Key'],
  [/-----BEGIN\s+DSA\s+PRIVATE\s+KEY-----/, 'DSA Private Key'],
  [/-----BEGIN\s+EC\s+PRIVATE\s+KEY-----/, 'EC Private Key'],
  [/-----BEGIN\s+PGP\s+PRIVATE\s+KEY\s+BLOCK-----/, 'PGP Private Key'],
  [
    /-----BEGIN\s+CERTIFICATE-----/,
    'Certificate (may contain private key)',
  ],
];

/** Database connection strings with embedded credentials */
export const DATABASE_PATTERNS: Array<[RegExp, string]> = [
  [
    /mongodb(?:\+srv)?:\/\/[^"\s:]+:[^@"\s]+@[^\s"]+/,
    'MongoDB Connection String with credentials',
  ],
  [
    /postgres(?:ql)?:\/\/[^"\s:]+:[^@"\s]+@[^\s"]+/,
    'PostgreSQL Connection String with credentials',
  ],
  [
    /mysql:\/\/[^"\s:]+:[^@"\s]+@[^\s"]+/,
    'MySQL Connection String with credentials',
  ],
  [
    /redis:\/\/[^"\s:]+:[^@"\s]+@[^\s"]+/,
    'Redis Connection String with credentials',
  ],
  [
    /amqp:\/\/[^"\s:]+:[^@"\s]+@[^\s"]+/,
    'RabbitMQ Connection String with credentials',
  ],
];

/** All patterns combined */
export const ALL_PATTERNS: Array<[RegExp, string]> = [
  ...GENERIC_PATTERNS,
  ...SERVICE_PATTERNS,
  ...PRIVATE_KEY_PATTERNS,
  ...DATABASE_PATTERNS,
];

// ---------------------------------------------------------------------------
// Data Types
// ---------------------------------------------------------------------------

/** A potential secret found in a file */
export interface SecretMatch {
  filePath: string;
  lineNumber: number;
  patternName: string;
  matchedText: string;
  lineContent: string;
}

// ---------------------------------------------------------------------------
// Ignore Lists
// ---------------------------------------------------------------------------

/** Files/directories to always skip */
const DEFAULT_IGNORE_PATTERNS: RegExp[] = [
  /\.git\//,
  /node_modules\//,
  /\.venv\//,
  /venv\//,
  /__pycache__\//,
  /\.pyc$/,
  /dist\//,
  /build\//,
  /\.egg-info\//,
  /\.example$/,
  /\.sample$/,
  /\.template$/,
  /\.md$/,
  /\.rst$/,
  /\.txt$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /Cargo\.lock$/,
  /poetry\.lock$/,
];

/** Binary file extensions to skip */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.pyc', '.pyo', '.class', '.o',
]);

/** False positive patterns to filter out */
const FALSE_POSITIVE_PATTERNS: RegExp[] = [
  /process\.env\./,         // Environment variable references
  /os\.environ/,            // Python env references
  /ENV\[/,                  // Ruby/other env references
  /\$\{[A-Z_]+\}/,         // Shell variable substitution
  /your[-_]?api[-_]?key/i, // Placeholder values
  /xxx+/i,                  // Placeholder
  /placeholder/i,           // Placeholder
  /example/i,               // Example value
  /sample/i,                // Sample value
  /test[-_]?key/i,          // Test placeholder
  /<[A-Z_]+>/,              // Placeholder like <API_KEY>
  /TODO/,                   // Comment markers
  /FIXME/,
  /CHANGEME/,
  /INSERT[-_]?YOUR/i,
  /REPLACE[-_]?WITH/i,
];

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Load custom ignore patterns from .secretsignore file.
 *
 * Ported from: load_secretsignore()
 */
export function loadSecretsIgnore(projectDir: string): RegExp[] {
  const ignoreFile = path.join(projectDir, '.secretsignore');
  try {
    const content = fs.readFileSync(ignoreFile, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => {
        try {
          return new RegExp(line);
        } catch {
          return null;
        }
      })
      .filter((p): p is RegExp => p !== null);
  } catch {
    return [];
  }
}

/**
 * Check if a file should be skipped based on ignore patterns.
 *
 * Ported from: should_skip_file()
 */
export function shouldSkipFile(
  filePath: string,
  customIgnores: RegExp[],
): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;

  for (const pattern of DEFAULT_IGNORE_PATTERNS) {
    if (pattern.test(filePath)) return true;
  }

  for (const pattern of customIgnores) {
    if (pattern.test(filePath)) return true;
  }

  return false;
}

/**
 * Check if a match is likely a false positive.
 *
 * Ported from: is_false_positive()
 */
export function isFalsePositive(line: string, matchedText: string): boolean {
  for (const pattern of FALSE_POSITIVE_PATTERNS) {
    if (pattern.test(line)) return true;
  }

  // Check if it's just a variable name or type hint
  if (/^[a-z_]+:\s*str\s*$/i.test(line.trim())) {
    return true;
  }

  // Check if it's in a comment (but still flag long key-like strings)
  const stripped = line.trim();
  if (
    stripped.startsWith('#') ||
    stripped.startsWith('//') ||
    stripped.startsWith('*')
  ) {
    if (!/[a-zA-Z0-9_-]{40,}/.test(matchedText)) {
      return true;
    }
  }

  return false;
}

/**
 * Mask a secret, showing only first few characters.
 *
 * Ported from: mask_secret()
 */
export function maskSecret(text: string, visibleChars = 8): string {
  if (text.length <= visibleChars) return text;
  return text.slice(0, visibleChars) + '***';
}

/**
 * Scan file content for potential secrets.
 *
 * Ported from: scan_content()
 */
export function scanContent(
  content: string,
  filePath: string,
): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = content.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNumber = lineIdx + 1;

    for (const [pattern, patternName] of ALL_PATTERNS) {
      try {
        // Use exec loop to handle global flag correctly
        const globalPattern = new RegExp(
          pattern.source,
          pattern.flags.includes('g')
            ? pattern.flags
            : pattern.flags + 'g',
        );
        let match: RegExpExecArray | null;
        while ((match = globalPattern.exec(line)) !== null) {
          const matchedText = match[0];

          if (isFalsePositive(line, matchedText)) continue;

          matches.push({
            filePath,
            lineNumber,
            patternName,
            matchedText,
            lineContent: line.trim().slice(0, 100),
          });
        }
      } catch {
      }
    }
  }

  return matches;
}

/**
 * Scan a list of files for secrets.
 *
 * Ported from: scan_files()
 */
export function scanFiles(
  files: string[],
  projectDir?: string,
): SecretMatch[] {
  const resolvedProjectDir = projectDir ?? process.cwd();
  const customIgnores = loadSecretsIgnore(resolvedProjectDir);
  const allMatches: SecretMatch[] = [];

  for (const filePath of files) {
    if (shouldSkipFile(filePath, customIgnores)) continue;

    const fullPath = path.join(resolvedProjectDir, filePath);

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const matches = scanContent(content, filePath);
      allMatches.push(...matches);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'EISDIR' && code !== 'EACCES') throw err;
    }
  }

  return allMatches;
}
