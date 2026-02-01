"""
Claude CLI Router
==================

API endpoints for Claude Code CLI detection and management.

This enables web mode to detect and use the Claude CLI installed
on the backend server.
"""

import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from ..utils.security import get_secure_logger

router = APIRouter()
logger = get_secure_logger("auto-claude-api")


class ClaudeVersionInfo(BaseModel):
    """Claude Code CLI version information."""

    installed: str | None = None
    latest: str = "1.0.0"
    isOutdated: bool = False
    path: str | None = None
    detectionResult: dict = {}


class ClaudeAuthStatus(BaseModel):
    """Claude authentication status."""

    authenticated: bool = False
    tokenSet: bool = False
    message: str | None = None


def find_claude_cli() -> tuple[str | None, str | None]:
    """Find the Claude CLI executable and get its version.

    Returns:
        Tuple of (path, version) or (None, None) if not found.
    """
    # Check common locations
    search_paths = [
        # Direct path lookup
        shutil.which("claude"),
        # Common installation locations
        Path.home() / ".local" / "bin" / "claude",
        Path.home() / ".npm-global" / "bin" / "claude",
        Path("/usr/local/bin/claude"),
        Path("/opt/homebrew/bin/claude"),
    ]

    for path in search_paths:
        if path is None:
            continue

        path = Path(path) if isinstance(path, str) else path

        if path.exists() and path.is_file():
            try:
                # Get version
                result = subprocess.run(
                    [str(path), "--version"], capture_output=True, text=True, timeout=10
                )

                if result.returncode == 0:
                    # Parse version from output like "2.1.3 (Claude Code)"
                    output = result.stdout.strip()
                    # Get first word which should be the version number
                    version = output.split()[0] if output else "unknown"
                    return str(path), version
            except (
                subprocess.TimeoutExpired,
                subprocess.SubprocessError,
                OSError,
            ) as e:
                logger.warning(f"Failed to check Claude CLI at {path}: {e}")
                continue

    return None, None


def check_claude_auth() -> ClaudeAuthStatus:
    """Check if Claude is authenticated.

    Returns:
        ClaudeAuthStatus with authentication state.
    """
    # Check if OAuth token is set in environment or .env
    import os

    # First check environment
    if os.getenv("CLAUDE_CODE_OAUTH_TOKEN"):
        return ClaudeAuthStatus(
            authenticated=True,
            tokenSet=True,
            message="OAuth token configured in environment",
        )

    # Check .env file
    env_file = Path(__file__).parent.parent.parent / ".env"
    if env_file.exists():
        try:
            content = env_file.read_text()
            if "CLAUDE_CODE_OAUTH_TOKEN=" in content:
                # Verify it's not empty
                for line in content.split("\n"):
                    if line.startswith("CLAUDE_CODE_OAUTH_TOKEN="):
                        value = line.split("=", 1)[1].strip().strip("'\"")
                        if value and not value.startswith("#"):
                            return ClaudeAuthStatus(
                                authenticated=True,
                                tokenSet=True,
                                message="OAuth token configured in .env",
                            )
        except Exception as e:
            logger.warning(f"Failed to read .env: {e}")

    # Try running claude auth status
    cli_path, _ = find_claude_cli()
    if cli_path:
        try:
            result = subprocess.run(
                [cli_path, "auth", "status"], capture_output=True, text=True, timeout=10
            )

            if result.returncode == 0 and "authenticated" in result.stdout.lower():
                return ClaudeAuthStatus(
                    authenticated=True,
                    tokenSet=True,
                    message="Authenticated via Claude CLI",
                )
        except Exception:
            pass

    return ClaudeAuthStatus(
        authenticated=False,
        tokenSet=False,
        message="Not authenticated. Run 'claude login' or set CLAUDE_CODE_OAUTH_TOKEN",
    )


@router.get("/claude-cli/version")
async def get_claude_version() -> dict:
    """Check if Claude Code CLI is installed and get version info."""
    cli_path, version = find_claude_cli()

    if cli_path and version:
        return {
            "success": True,
            "data": {
                "installed": version,
                "latest": "1.0.0",  # Could fetch from npm registry
                "isOutdated": False,
                "path": cli_path,
                "detectionResult": {
                    "found": True,
                    "path": cli_path,
                    "version": version,
                    "source": "system-path",
                    "message": f"Claude CLI found at {cli_path}",
                },
            },
        }

    return {
        "success": True,
        "data": {
            "installed": None,
            "latest": "1.0.0",
            "isOutdated": False,
            "path": None,
            "detectionResult": {
                "found": False,
                "path": None,
                "version": None,
                "source": "system-path",
                "message": "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
            },
        },
    }


@router.get("/claude-cli/auth")
async def get_claude_auth() -> dict:
    """Check Claude authentication status."""
    auth_status = check_claude_auth()

    return {"success": True, "data": auth_status.model_dump()}


@router.post("/claude-cli/setup-token")
async def setup_claude_token(request: dict) -> dict:
    """Set up Claude OAuth token.

    This saves the token to the backend .env file.
    """
    token = request.get("token", "").strip()

    if not token:
        return {"success": False, "error": "Token is required"}

    env_file = Path(__file__).parent.parent.parent / ".env"

    try:
        # Read existing content
        existing_content = ""
        if env_file.exists():
            existing_content = env_file.read_text()

        # Check if token line already exists
        lines = existing_content.split("\n")
        token_found = False
        new_lines = []

        for line in lines:
            if line.startswith("CLAUDE_CODE_OAUTH_TOKEN="):
                new_lines.append(f"CLAUDE_CODE_OAUTH_TOKEN={token}")
                token_found = True
            else:
                new_lines.append(line)

        if not token_found:
            new_lines.append(
                f"\n# Claude Code OAuth Token\nCLAUDE_CODE_OAUTH_TOKEN={token}"
            )

        # Write back
        env_file.write_text("\n".join(new_lines))

        return {
            "success": True,
            "data": {"message": "Token saved successfully", "authenticated": True},
        }
    except Exception as e:
        logger.exception("Failed to save Claude token")
        return {"success": False, "error": str(e)}


@router.get("/claude-cli/capabilities")
async def get_cli_capabilities() -> dict:
    """Get Claude CLI capabilities for web mode.

    Returns what features are available based on CLI and auth status.
    """
    cli_path, version = find_claude_cli()
    auth_status = check_claude_auth()

    capabilities = {
        "cliInstalled": cli_path is not None,
        "cliVersion": version,
        "cliPath": cli_path,
        "authenticated": auth_status.authenticated,
        "features": {
            "insights": cli_path is not None and auth_status.authenticated,
            "agentTasks": cli_path is not None and auth_status.authenticated,
            "codeSearch": cli_path is not None,
            "terminals": False,  # Terminals not supported in web mode
        },
    }

    return {"success": True, "data": capabilities}
