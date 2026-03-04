"""
Shared MCP Server Configuration Builder
========================================

Centralized helper functions for building MCP server configurations.
Used by both client.py (for agent sessions) and insights_runner.py (for insights chat).

These functions read from environment variables that are set by the frontend
via integrations-env-builder.ts when launching Python processes.

NPM Packages Used:
- JIRA: @aashari/mcp-server-atlassian-jira (community, API token auth)
- GitLab: @modelcontextprotocol/server-gitlab (official MCP)
- Vault: @modelcontextprotocol/server-filesystem (official MCP)

Security Notes:
- Credentials are passed as environment variables to spawned npx processes.
  This is the standard pattern for MCP servers but means credentials are visible
  in /proc/<pid>/environ on Linux. The spawned processes inherit a minimal env.
- Host URLs are validated to prevent SSRF attacks against internal services.
- Vault paths are validated to prevent access to sensitive system directories.
"""

import ipaddress
import logging
import os
from pathlib import Path
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Private/internal IP ranges that should not be used for JIRA/GitLab hosts
_PRIVATE_IP_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # Link-local / cloud metadata
    ipaddress.ip_network("::1/128"),  # IPv6 localhost
    ipaddress.ip_network("fc00::/7"),  # IPv6 private
    ipaddress.ip_network("fe80::/10"),  # IPv6 link-local
]

# Hostnames that should not be used (cloud metadata endpoints, etc.)
_BLOCKED_HOSTNAMES = frozenset(
    [
        "localhost",
        "metadata.google.internal",
        "metadata.gcp.internal",
    ]
)


def _is_safe_host_url(url: str) -> bool:
    """
    Validate that a host URL is safe to use (not an internal/private address).

    This prevents SSRF attacks where a malicious JIRA_HOST or GITLAB_HOST
    could be used to access internal services or cloud metadata endpoints.

    Args:
        url: The URL to validate

    Returns:
        True if the URL is safe to use, False otherwise
    """
    try:
        parsed = urlparse(url)

        # Must use HTTPS for external services (allow HTTP only for localhost in dev)
        if parsed.scheme not in ("https", "http"):
            logger.warning(f"Invalid URL scheme: {parsed.scheme}")
            return False

        hostname = parsed.hostname
        if not hostname:
            return False

        # Check against blocked hostnames
        hostname_lower = hostname.lower()
        if hostname_lower in _BLOCKED_HOSTNAMES:
            logger.warning(f"Blocked hostname: {hostname}")
            return False

        # Try to parse as IP address and check against private ranges
        try:
            ip = ipaddress.ip_address(hostname)
            for network in _PRIVATE_IP_RANGES:
                if ip in network:
                    logger.warning(
                        f"Private/internal IP address not allowed: {hostname}"
                    )
                    return False
        except ValueError:
            # Not an IP address, that's fine - it's a hostname
            pass

        return True

    except Exception as e:
        logger.warning(f"Failed to validate URL {url}: {e}")
        return False


def build_jira_mcp_config() -> dict | None:
    """
    Build JIRA MCP server configuration from env vars.

    Required env vars (set via integrations-env-builder.ts):
    - JIRA_HOST or JIRA_URL: JIRA instance URL (e.g., https://company.atlassian.net)
    - JIRA_EMAIL: User email for authentication
    - JIRA_API_TOKEN or JIRA_TOKEN: API token

    Optional env vars:
    - JIRA_DEFAULT_PROJECT: Default project key (e.g., CAP)
    - JIRA_PROJECT_KEY: Per-project override (takes precedence over JIRA_DEFAULT_PROJECT)

    Returns:
        MCP server config dict for @aashari/mcp-server-atlassian-jira, or None if not configured
    """
    host = os.environ.get("JIRA_HOST") or os.environ.get("JIRA_URL")
    email = os.environ.get("JIRA_EMAIL")
    token = os.environ.get("JIRA_API_TOKEN") or os.environ.get("JIRA_TOKEN")

    if not (host and email and token):
        return None

    # Validate host URL to prevent SSRF
    if not _is_safe_host_url(host):
        logger.error(
            f"JIRA host URL {host} failed security validation. "
            "Please use a valid HTTPS URL for your JIRA instance."
        )
        return None

    # Build minimal environment for the spawned process
    env = {
        "JIRA_HOST": host,
        "JIRA_EMAIL": email,
        "JIRA_API_TOKEN": token,
    }

    # Per-project override takes precedence over global default
    project_key = os.environ.get("JIRA_PROJECT_KEY") or os.environ.get(
        "JIRA_DEFAULT_PROJECT"
    )
    if project_key:
        env["JIRA_DEFAULT_PROJECT"] = project_key

    return {
        "command": "npx",
        "args": ["-y", "@aashari/mcp-server-atlassian-jira"],
        "env": env,
    }


def build_gitlab_mcp_config() -> dict | None:
    """
    Build GitLab MCP server configuration from env vars.

    Required env vars (set via integrations-env-builder.ts):
    - GITLAB_HOST or GITLAB_URL: GitLab instance URL (e.g., https://gitlab.com)
    - GITLAB_TOKEN or GITLAB_PRIVATE_TOKEN: Personal Access Token with 'api' scope

    Returns:
        MCP server config dict for @modelcontextprotocol/server-gitlab, or None if not configured
    """
    host = os.environ.get("GITLAB_HOST") or os.environ.get("GITLAB_URL")
    token = os.environ.get("GITLAB_TOKEN") or os.environ.get("GITLAB_PRIVATE_TOKEN")

    if not (host and token):
        return None

    # Validate host URL to prevent SSRF
    if not _is_safe_host_url(host):
        logger.error(
            f"GitLab host URL {host} failed security validation. "
            "Please use a valid HTTPS URL for your GitLab instance."
        )
        return None

    # Ensure we have the API URL format
    # Strip trailing slashes first to handle both "https://gitlab.com/" and "https://gitlab.com/api/v4/"
    api_url = host.rstrip("/")
    if not api_url.endswith("/api/v4"):
        api_url = f"{api_url}/api/v4"

    return {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-gitlab"],
        "env": {
            "GITLAB_PERSONAL_ACCESS_TOKEN": token,
            "GITLAB_API_URL": api_url,
        },
    }


# Sensitive directories that should not be used as vault paths
_SENSITIVE_VAULT_DIRECTORIES = frozenset(
    [
        "/etc",
        "/var",
        "/usr",
        "/bin",
        "/sbin",
        "/lib",
        "/lib64",
        "/boot",
        "/dev",
        "/proc",
        "/sys",
        "/run",
        "/tmp",
        "/private/etc",
        "/private/var",  # macOS
        "/Windows",
        "/Program Files",
        "/Program Files (x86)",  # Windows
    ]
)


def _is_safe_vault_path(path: Path) -> bool:
    """
    Validate that the vault path is safe to use.

    Prevents path traversal to sensitive system directories.
    """
    try:
        resolved = path.resolve()
        str_path = str(resolved).lower()

        # Check against sensitive directories
        for sensitive in _SENSITIVE_VAULT_DIRECTORIES:
            if str_path.startswith(sensitive.lower()):
                return False

        return True

    except Exception:
        return False


def build_obsidian_mcp_config() -> dict | None:
    """
    Build Obsidian/Vault MCP server configuration from env vars.

    Required env vars (set via integrations-env-builder.ts):
    - VAULT_PATH or OBSIDIAN_VAULT_PATH: Path to the vault directory

    Optional env vars:
    - VAULT_WRITE_ENABLED: Set to 'true' to allow write access (default: read-only)

    Security Note:
    The @modelcontextprotocol/server-filesystem MCP server provides read/write
    access to the specified directory. By default, agents have write access.
    Set VAULT_WRITE_ENABLED=false to restrict to read-only mode.

    Returns:
        MCP server config dict for @modelcontextprotocol/server-filesystem, or None if not configured
    """
    vault_path = os.environ.get("VAULT_PATH") or os.environ.get("OBSIDIAN_VAULT_PATH")

    if not vault_path:
        return None

    # Expand ~ and resolve to absolute path
    expanded = Path(vault_path).expanduser().resolve()

    # Validate vault path is safe
    if not _is_safe_vault_path(expanded):
        logger.error(
            f"Vault path {expanded} points to a sensitive system directory. "
            "Please use a path within your home directory."
        )
        return None

    return {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", str(expanded)],
    }


# ============================================================================
# Centralized Environment Variable Resolution
# ============================================================================
# These functions provide a single source of truth for env var name resolution,
# avoiding duplication across models.py, client.py, and mcp_config.py.


def get_jira_host() -> str | None:
    """Get JIRA host URL from environment (supports multiple env var names)."""
    return os.environ.get("JIRA_HOST") or os.environ.get("JIRA_URL")


def get_jira_email() -> str | None:
    """Get JIRA email from environment."""
    return os.environ.get("JIRA_EMAIL")


def get_jira_token() -> str | None:
    """Get JIRA API token from environment (supports multiple env var names)."""
    return os.environ.get("JIRA_API_TOKEN") or os.environ.get("JIRA_TOKEN")


def get_gitlab_host() -> str | None:
    """Get GitLab host URL from environment (supports multiple env var names)."""
    return os.environ.get("GITLAB_HOST") or os.environ.get("GITLAB_URL")


def get_gitlab_token() -> str | None:
    """Get GitLab token from environment (supports multiple env var names)."""
    return os.environ.get("GITLAB_TOKEN") or os.environ.get("GITLAB_PRIVATE_TOKEN")


def get_vault_path() -> str | None:
    """Get vault path from environment (supports multiple env var names)."""
    return os.environ.get("VAULT_PATH") or os.environ.get("OBSIDIAN_VAULT_PATH")


def is_jira_fully_configured() -> bool:
    """Check if JIRA has all required credentials configured."""
    return bool(get_jira_host() and get_jira_email() and get_jira_token())


def is_gitlab_fully_configured() -> bool:
    """Check if GitLab has all required credentials configured."""
    return bool(get_gitlab_host() and get_gitlab_token())


def is_vault_configured() -> bool:
    """Check if vault path is configured."""
    return bool(get_vault_path())
