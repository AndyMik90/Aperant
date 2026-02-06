#!/usr/bin/env python3
"""
Secret Scanning Script for Auto-Build Framework
================================================

Scans staged git files for potential secrets before commit.
Designed to prevent accidental exposure of API keys, tokens, and credentials.

Usage:
    python scan_secrets.py [--staged-only] [--all-files] [--path PATH]

Exit codes:
    0 - No secrets detected
    1 - Potential secrets found (commit should be blocked)
    2 - Error occurred during scanning
"""

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# =============================================================================
# SECRET PATTERNS
# =============================================================================

# Generic high-entropy patterns that match common API key formats
GENERIC_PATTERNS = [
    # Generic API key patterns (32+ char alphanumeric strings assigned to variables)
    (
        r'(?:api[_-]?key|apikey|api_secret|secret[_-]?key)\s*[:=]\s*["\']([a-zA-Z0-9_-]{32,})["\']',
        "Generic API key assignment",
    ),
    # Generic token patterns
    (
        r'(?:access[_-]?token|auth[_-]?token|bearer[_-]?token|token)\s*[:=]\s*["\']([a-zA-Z0-9_-]{32,})["\']',
        "Generic access token",
    ),
    # Password patterns
    (
        r'(?:password|passwd|pwd|pass)\s*[:=]\s*["\']([^"\']{8,})["\']',
        "Password assignment",
    ),
    # Generic secret patterns
    (
        r'(?:secret|client_secret|app_secret)\s*[:=]\s*["\']([a-zA-Z0-9_/+=]{16,})["\']',
        "Secret assignment",
    ),
    # Bearer tokens in headers
    (r'["\']?[Bb]earer\s+([a-zA-Z0-9_-]{20,})["\']?', "Bearer token"),
    # Base64-encoded secrets (longer than typical, may be credentials)
    (r'["\'][A-Za-z0-9+/]{64,}={0,2}["\']', "Potential base64-encoded secret"),
]

# Service-specific patterns (known formats)
SERVICE_PATTERNS = [
    # OpenAI / Anthropic style keys
    (r"sk-[a-zA-Z0-9]{20,}", "OpenAI/Anthropic-style API key"),
    (r"sk-ant-[a-zA-Z0-9-]{20,}", "Anthropic API key"),
    (r"sk-proj-[a-zA-Z0-9-]{20,}", "OpenAI project API key"),
    # AWS
    (r"AKIA[0-9A-Z]{16}", "AWS Access Key ID"),
    (
        r'(?:aws_secret_access_key|aws_secret)\s*[:=]\s*["\']?([a-zA-Z0-9/+=]{40})["\']?',
        "AWS Secret Access Key",
    ),
    # Google Cloud
    (r"AIza[0-9A-Za-z_-]{35}", "Google API Key"),
    (r'"type"\s*:\s*"service_account"', "Google Service Account JSON"),
    # GitHub
    (r"ghp_[a-zA-Z0-9]{36}", "GitHub Personal Access Token"),
    (r"github_pat_[a-zA-Z0-9_]{22,}", "GitHub Fine-grained PAT"),
    (r"gho_[a-zA-Z0-9]{36}", "GitHub OAuth Token"),
    (r"ghs_[a-zA-Z0-9]{36}", "GitHub App Installation Token"),
    (r"ghr_[a-zA-Z0-9]{36}", "GitHub Refresh Token"),
    # Stripe
    (r"sk_live_[0-9a-zA-Z]{24,}", "Stripe Live Secret Key"),
    (r"sk_test_[0-9a-zA-Z]{24,}", "Stripe Test Secret Key"),
    (r"pk_live_[0-9a-zA-Z]{24,}", "Stripe Live Publishable Key"),
    (r"rk_live_[0-9a-zA-Z]{24,}", "Stripe Restricted Key"),
    # Slack
    (r"xox[baprs]-[0-9a-zA-Z-]{10,}", "Slack Token"),
    (r"https://hooks\.slack\.com/services/[A-Z0-9/]+", "Slack Webhook URL"),
    # Discord
    (r"[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}", "Discord Bot Token"),
    (r"https://discord(?:app)?\.com/api/webhooks/\d+/[\w-]+", "Discord Webhook URL"),
    # Twilio
    (r"SK[a-f0-9]{32}", "Twilio API Key"),
    (r"AC[a-f0-9]{32}", "Twilio Account SID"),
    # SendGrid
    (r"SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}", "SendGrid API Key"),
    # Mailchimp
    (r"[a-f0-9]{32}-us\d+", "Mailchimp API Key"),
    # NPM
    (r"npm_[a-zA-Z0-9]{36}", "NPM Access Token"),
    # PyPI
    (r"pypi-[a-zA-Z0-9]{60,}", "PyPI API Token"),
    # Supabase/JWT
    (r"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{50,}", "Supabase/JWT Token"),
    # Linear
    (r"lin_api_[a-zA-Z0-9]{40,}", "Linear API Key"),
    # Vercel
    (r"[a-zA-Z0-9]{24}_[a-zA-Z0-9]{28,}", "Potential Vercel Token"),
    # Heroku
    (
        r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
        "Heroku API Key / UUID",
    ),
    # Doppler
    (r"dp\.pt\.[a-zA-Z0-9]{40,}", "Doppler Service Token"),
]

# Private key patterns
PRIVATE_KEY_PATTERNS = [
    (r"-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----", "RSA Private Key"),
    (r"-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----", "OpenSSH Private Key"),
    (r"-----BEGIN\s+DSA\s+PRIVATE\s+KEY-----", "DSA Private Key"),
    (r"-----BEGIN\s+EC\s+PRIVATE\s+KEY-----", "EC Private Key"),
    (r"-----BEGIN\s+PGP\s+PRIVATE\s+KEY\s+BLOCK-----", "PGP Private Key"),
    (r"-----BEGIN\s+CERTIFICATE-----", "Certificate (may contain private key)"),
]

# Database connection strings with embedded credentials
DATABASE_PATTERNS = [
    (
        r'mongodb(?:\+srv)?://[^"\s:]+:[^@"\s]+@[^\s"]+',
        "MongoDB Connection String with credentials",
    ),
    (
        r'postgres(?:ql)?://[^"\s:]+:[^@"\s]+@[^\s"]+',
        "PostgreSQL Connection String with credentials",
    ),
    (r'mysql://[^"\s:]+:[^@"\s]+@[^\s"]+', "MySQL Connection String with credentials"),
    (r'redis://[^"\s:]+:[^@"\s]+@[^\s"]+', "Redis Connection String with credentials"),
    (
        r'amqp://[^"\s:]+:[^@"\s]+@[^\s"]+',
        "RabbitMQ Connection String with credentials",
    ),
]

# Combine all patterns
ALL_PATTERNS = (
    GENERIC_PATTERNS + SERVICE_PATTERNS + PRIVATE_KEY_PATTERNS + DATABASE_PATTERNS
)


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class SecretMatch:
    """A potential secret found in a file."""

    file_path: str
    line_number: int
    pattern_name: str
    matched_text: str
    line_content: str


# =============================================================================
# IGNORE LIST
# =============================================================================

# Files/directories to always skip
DEFAULT_IGNORE_PATTERNS = [
    r"\.git/",
    r"node_modules/",
    r"\.venv/",
    r"venv/",
    r"__pycache__/",
    r"\.pyc$",
    r"dist/",
    r"build/",
    r"\.egg-info/",
    r"\.example$",
    r"\.sample$",
    r"\.template$",
    r"\.md$",  # Documentation files
    r"\.rst$",
    r"\.txt$",
    r"package-lock\.json$",
    r"yarn\.lock$",
    r"pnpm-lock\.yaml$",
    r"Cargo\.lock$",
    r"poetry\.lock$",
]

# Binary file extensions to skip
BINARY_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".webp",
    ".svg",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".otf",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".zip",
    ".tar",
    ".gz",
    ".bz2",
    ".7z",
    ".rar",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".mp3",
    ".mp4",
    ".wav",
    ".avi",
    ".mov",
    ".pyc",
    ".pyo",
    ".class",
    ".o",
}

# False positive patterns to filter out
FALSE_POSITIVE_PATTERNS = [
    r"process\.env\.",  # Environment variable references
    r"os\.environ",  # Python env references
    r"ENV\[",  # Ruby/other env references
    r"\$\{[A-Z_]+\}",  # Shell variable substitution
    r"your[-_]?api[-_]?key",  # Placeholder values
    r"xxx+",  # Placeholder
    r"placeholder",  # Placeholder
    r"example",  # Example value
    r"sample",  # Sample value
    r"test[-_]?key",  # Test placeholder
    r"<[A-Z_]+>",  # Placeholder like <API_KEY>
    r"TODO",  # Comment markers
    r"FIXME",
    r"CHANGEME",
    r"INSERT[-_]?YOUR",
    r"REPLACE[-_]?WITH",
]


# =============================================================================
# CORE FUNCTIONS
# =============================================================================


def load_secretsignore(project_dir: Path) -> list[str]:
    """Load custom ignore patterns from .secretsignore file."""
    ignore_file = project_dir / ".secretsignore"
    if not ignore_file.exists():
        return []

    patterns = []
    try:
        content = ignore_file.read_text(encoding="utf-8")
        for line in content.splitlines():
            line = line.strip()
            # Skip comments and empty lines
            if line and not line.startswith("#"):
                patterns.append(line)
    except OSError:
        pass

    return patterns


def should_skip_file(file_path: str, custom_ignores: list[str]) -> bool:
    """Check if a file should be skipped based on ignore patterns."""
    path = Path(file_path)

    # Check binary extensions
    if path.suffix.lower() in BINARY_EXTENSIONS:
        return True

    # Check default ignore patterns
    for pattern in DEFAULT_IGNORE_PATTERNS:
        if re.search(pattern, file_path):
            return True

    # Check custom ignore patterns
    for pattern in custom_ignores:
        if re.search(pattern, file_path):
            return True

    return False


def is_false_positive(line: str, matched_text: str) -> bool:
    """Check if a match is likely a false positive."""
    line_lower = line.lower()

    for pattern in FALSE_POSITIVE_PATTERNS:
        if re.search(pattern, line_lower):
            return True

    # Check if it's just a variable name or type hint
    if re.match(r"^[a-z_]+:\s*str\s*$", line.strip(), re.IGNORECASE):
        return True

    # Check if it's in a comment
    stripped = line.strip()
    if (
        stripped.startswith("#")
        or stripped.startswith("//")
        or stripped.startswith("*")
    ):
        # But still flag if there's an actual long key-like string
        if not re.search(r"[a-zA-Z0-9_-]{40,}", matched_text):
            return True

    return False


def mask_secret(text: str, visible_chars: int = 8) -> str:
    """Mask a secret, showing only first few characters."""
    if len(text) <= visible_chars:
        return text
    return text[:visible_chars] + "***"


def scan_content(content: str, file_path: str) -> list[SecretMatch]:
    """Scan file content for potential secrets."""
    matches = []
    lines = content.splitlines()

    for line_num, line in enumerate(lines, 1):
        for pattern, pattern_name in ALL_PATTERNS:
            try:
                for match in re.finditer(pattern, line, re.IGNORECASE):
                    matched_text = match.group(0)

                    # Skip false positives
                    if is_false_positive(line, matched_text):
                        continue

                    matches.append(
                        SecretMatch(
                            file_path=file_path,
                            line_number=line_num,
                            pattern_name=pattern_name,
                            matched_text=matched_text,
                            line_content=line.strip()[:100],  # Truncate long lines
                        )
                    )
            except re.error:
                # Invalid regex, skip
                continue

    return matches


def get_staged_files() -> list[str]:
    """Get list of staged files from git (excluding deleted files)."""
    try:
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
            capture_output=True,
            text=True,
            check=True,
        )
        files = [f.strip() for f in result.stdout.splitlines() if f.strip()]
        return files
    except subprocess.CalledProcessError:
        return []


def get_all_tracked_files() -> list[str]:
    """Get all tracked files in the repository."""
    try:
        result = subprocess.run(
            ["git", "ls-files"],
            capture_output=True,
            text=True,
            check=True,
        )
        files = [f.strip() for f in result.stdout.splitlines() if f.strip()]
        return files
    except subprocess.CalledProcessError:
        return []


def scan_files(
    files: list[str],
    project_dir: Path | None = None,
) -> list[SecretMatch]:
    """Scan a list of files for secrets."""
    if project_dir is None:
        project_dir = Path.cwd()

    custom_ignores = load_secretsignore(project_dir)
    all_matches = []

    for file_path in files:
        # Skip files based on ignore patterns
        if should_skip_file(file_path, custom_ignores):
            continue

        full_path = project_dir / file_path

        # Skip if file doesn't exist or is a directory
        if not full_path.exists() or full_path.is_dir():
            continue

        try:
            content = full_path.read_text(encoding="utf-8", errors="ignore")
            matches = scan_content(content, file_path)
            all_matches.extend(matches)
        except (OSError, UnicodeDecodeError):
            # Skip files that can't be read
            continue

    return all_matches


# =============================================================================
# OUTPUT FORMATTING
# =============================================================================

# ANSI color codes
RED = "\033[0;31m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
CYAN = "\033[0;36m"
NC = "\033[0m"  # No Color


def print_results(matches: list[SecretMatch]) -> None:
    """Print scan results in a formatted way."""
    if not matches:
        print(f"{GREEN}No secrets detected. Commit allowed.{NC}")
        return

    print(f"{RED}POTENTIAL SECRETS DETECTED!{NC}")
    print(f"{RED}{'=' * 60}{NC}")

    # Group by file
    files_with_matches: dict[str, list[SecretMatch]] = {}
    for match in matches:
        if match.file_path not in files_with_matches:
            files_with_matches[match.file_path] = []
        files_with_matches[match.file_path].append(match)

    for file_path, file_matches in files_with_matches.items():
        print(f"\n{YELLOW}File: {file_path}{NC}")
        for match in file_matches:
            masked = mask_secret(match.matched_text)
            print(f"  Line {match.line_number}: [{match.pattern_name}]")
            print(f"    {CYAN}{masked}{NC}")

    print(f"\n{RED}{'=' * 60}{NC}")
    print(f"\n{YELLOW}If these are false positives, you can:{NC}")
    print("  1. Add patterns to .secretsignore (create if needed)")
    print("  2. Use environment variables instead of hardcoded values")
    print()
    print(f"{RED}Commit blocked to protect against leaking secrets.{NC}")


def print_json_results(matches: list[SecretMatch]) -> None:
    """Print scan results as JSON (for programmatic use)."""
    import json

    results = {
        "secrets_found": len(matches) > 0,
        "count": len(matches),
        "matches": [
            {
                "file": m.file_path,
                "line": m.line_number,
                "type": m.pattern_name,
                "preview": mask_secret(m.matched_text),
            }
            for m in matches
        ],
    }
    print(json.dumps(results, indent=2))


# =============================================================================
# MAIN
# =============================================================================


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Scan files for potential secrets before commit"
    )
    parser.add_argument(
        "--staged-only",
        "-s",
        action="store_true",
        default=True,
        help="Only scan staged files (default)",
    )
    parser.add_argument(
        "--all-files", "-a", action="store_true", help="Scan all tracked files"
    )
    parser.add_argument(
        "--path", "-p", type=str, help="Scan a specific file or directory"
    )
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    parser.add_argument(
        "--quiet", "-q", action="store_true", help="Only output if secrets are found"
    )

    args = parser.parse_args()

    project_dir = Path.cwd()

    # Determine which files to scan
    if args.path:
        path = Path(args.path)
        if path.is_file():
            files = [str(path)]
        elif path.is_dir():
            files = [
                str(f.relative_to(project_dir)) for f in path.rglob("*") if f.is_file()
            ]
        else:
            print(f"{RED}Error: Path not found: {args.path}{NC}", file=sys.stderr)
            return 2
    elif args.all_files:
        files = get_all_tracked_files()
    else:
        files = get_staged_files()

    if not files:
        if not args.quiet:
            print(f"{GREEN}No files to scan.{NC}")
        return 0

    if not args.quiet and not args.json:
        print(f"Scanning {len(files)} file(s) for secrets...")

    # Scan files
    matches = scan_files(files, project_dir)

    # Output results
    if args.json:
        print_json_results(matches)
    elif matches or not args.quiet:
        print_results(matches)

    # Return exit code
    return 1 if matches else 0


if __name__ == "__main__":
    sys.exit(main())
