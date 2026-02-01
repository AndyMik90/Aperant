"""
Source Environment Router
=========================

API endpoints for Auto Claude source environment configuration.
"""

import os
import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))


from ..utils.security import get_secure_logger

router = APIRouter()
logger = get_secure_logger("auto-claude-api")

# Backend .env file location
ENV_FILE = _PARENT_DIR / ".env"


class SourceEnvConfig(BaseModel):
    """Source environment configuration."""

    claudeOAuthToken: str | None = None


class SourceEnvCheckResult(BaseModel):
    """Result of checking source token."""

    valid: bool
    message: str
    email: str | None = None


def load_env_file() -> dict[str, str]:
    """Load environment variables from .env file."""
    env_vars = {}
    if ENV_FILE.exists():
        try:
            content = ENV_FILE.read_text()
            for line in content.split("\n"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    # Remove quotes if present
                    value = value.strip().strip('"').strip("'")
                    env_vars[key.strip()] = value
        except OSError:
            pass
    return env_vars


def save_env_file(env_vars: dict[str, str]) -> None:
    """Save environment variables to .env file."""
    lines = []
    for key, value in sorted(env_vars.items()):
        if value:
            # Quote values with spaces
            if " " in value:
                value = f'"{value}"'
            lines.append(f"{key}={value}")

    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    ENV_FILE.write_text("\n".join(lines) + "\n")


@router.get("/source-env")
async def get_source_env() -> dict:
    """Get source environment configuration."""
    env_vars = load_env_file()

    # Mask token for display (show only last 4 chars)
    token = env_vars.get("CLAUDE_CODE_OAUTH_TOKEN", "")
    masked_token = f"***{token[-4:]}" if token and len(token) > 4 else None

    return {
        "success": True,
        "data": {
            "claudeOAuthToken": masked_token,
            "hasToken": bool(token),
        },
    }


class UpdateSourceEnvRequest(BaseModel):
    """Request to update source environment."""

    claudeOAuthToken: str | None = None


@router.patch("/source-env")
async def update_source_env(request: UpdateSourceEnvRequest) -> dict:
    """Update source environment configuration."""
    env_vars = load_env_file()

    if request.claudeOAuthToken is not None:
        if request.claudeOAuthToken:
            env_vars["CLAUDE_CODE_OAUTH_TOKEN"] = request.claudeOAuthToken
            # Also set in current process environment
            os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = request.claudeOAuthToken
        else:
            # Remove if empty
            env_vars.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
            os.environ.pop("CLAUDE_CODE_OAUTH_TOKEN", None)

    save_env_file(env_vars)

    return {"success": True}


@router.get("/source-env/check-token")
async def check_source_token() -> dict:
    """Check if the source token is valid."""
    env_vars = load_env_file()
    token = env_vars.get("CLAUDE_CODE_OAUTH_TOKEN") or os.environ.get(
        "CLAUDE_CODE_OAUTH_TOKEN"
    )

    if not token:
        return {
            "success": True,
            "data": {
                "valid": False,
                "message": "No OAuth token configured",
                "email": None,
            },
        }

    # Basic validation - token should be non-empty
    # In a real implementation, you would validate against Claude API
    if len(token) < 10:
        return {
            "success": True,
            "data": {
                "valid": False,
                "message": "Token appears invalid (too short)",
                "email": None,
            },
        }

    return {
        "success": True,
        "data": {
            "valid": True,
            "message": "OAuth token is configured",
            "email": None,  # Would need API call to get email
        },
    }
