"""
Settings Router
===============

API endpoints for application settings.
"""

import json
import os
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))


router = APIRouter()

# Default model from environment or fallback
# Priority: AUTO_BUILD_MODEL > ANTHROPIC_MODEL > DEFAULT_MODEL > hardcoded fallback
DEFAULT_MODEL = os.getenv(
    "AUTO_BUILD_MODEL",
    os.getenv(
        "ANTHROPIC_MODEL", os.getenv("DEFAULT_MODEL", "gemini-claude-opus-4-5-thinking")
    ),
)

# Get the backend directory path - this is the autoBuildPath for web mode
# The backend directory contains the Python source code for Auto Claude
BACKEND_DIR = str(_PARENT_DIR)


class SettingsModel(BaseModel):
    """Application settings model.

    These settings match the frontend AppSettings interface to ensure compatibility.
    In web mode, autoBuildPath defaults to the backend directory.
    """

    # Core settings
    theme: str = Field(default="system", description="UI theme: light, dark, or system")
    colorTheme: str = Field(default="default", description="Color theme variant")
    defaultModel: str = Field(default="opus", description="Default Claude model")

    # Path settings - critical for web mode
    autoBuildPath: str | None = Field(
        default=BACKEND_DIR,
        description="Path to Auto Claude backend source (auto-set in web mode)",
    )
    pythonPath: str | None = Field(
        default=None, description="Path to Python executable"
    )
    gitPath: str | None = Field(default=None, description="Path to Git executable")
    githubCLIPath: str | None = Field(default=None, description="Path to GitHub CLI")

    # Agent settings
    agentFramework: str = Field(
        default="auto-claude", description="Agent framework to use"
    )
    selectedAgentProfile: str = Field(
        default="auto", description="Selected agent profile"
    )

    # Feature flags
    autoUpdateAutoBuild: bool = Field(
        default=True, description="Auto-update Auto Build"
    )
    autoNameTerminals: bool = Field(
        default=True, description="Auto-name terminal sessions"
    )
    onboardingCompleted: bool = Field(
        default=True, description="Onboarding wizard completed"
    )

    # Notifications
    notifications: dict = Field(
        default={
            "onTaskComplete": True,
            "onTaskFailed": True,
            "onReviewNeeded": True,
            "sound": False,
        },
        description="Notification preferences",
    )

    # API keys (optional - may be set via .env)
    globalClaudeOAuthToken: str | None = Field(
        default=None, description="Global Claude OAuth token"
    )
    globalOpenAIApiKey: str | None = Field(
        default=None, description="Global OpenAI API key"
    )

    # Changelog preferences
    changelogFormat: str = Field(
        default="keep-a-changelog", description="Changelog format"
    )
    changelogAudience: str = Field(
        default="user-facing", description="Changelog audience"
    )
    changelogEmojiLevel: str = Field(default="none", description="Emoji usage level")

    # UI settings
    uiScale: int = Field(default=100, description="UI scale percentage")
    betaUpdates: bool = Field(default=False, description="Receive beta updates")
    language: str = Field(default="en", description="UI language")
    sentryEnabled: bool = Field(
        default=True, description="Enable Sentry error reporting"
    )

    # Legacy fields for compatibility
    auto_qa: bool = Field(default=True, description="Run QA automatically after builds")
    max_iterations: int | None = Field(
        default=None, description="Maximum agent iterations (None = unlimited)"
    )
    workspace_isolation: bool = Field(
        default=True, description="Use workspace isolation by default"
    )
    graphiti_enabled: bool = Field(default=True, description="Enable Graphiti memory")
    linear_enabled: bool = Field(default=False, description="Enable Linear integration")


class SettingsResponse(BaseModel):
    """Response model for settings."""

    settings: SettingsModel
    config_path: str


def get_settings_file() -> Path:
    """Get the path to the settings file."""
    config_dir = Path.home() / ".auto-claude"
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "settings.json"


def load_settings() -> SettingsModel:
    """Load settings from file."""
    settings_file = get_settings_file()
    if not settings_file.exists():
        return SettingsModel()
    try:
        with open(settings_file) as f:
            data = json.load(f)
            return SettingsModel(**data)
    except (json.JSONDecodeError, OSError):
        return SettingsModel()


def save_settings(settings: SettingsModel) -> None:
    """Save settings to file."""
    settings_file = get_settings_file()
    with open(settings_file, "w") as f:
        json.dump(settings.model_dump(), f, indent=2)


@router.get("")
async def get_settings() -> dict:
    """Get current application settings.

    In web mode, autoBuildPath is always set to the backend directory
    to ensure the frontend can initialize projects correctly.
    """
    settings = load_settings()
    settings_dict = settings.model_dump()

    # Ensure autoBuildPath is always set in web mode
    if not settings_dict.get("autoBuildPath"):
        settings_dict["autoBuildPath"] = BACKEND_DIR

    # Ensure onboardingCompleted is True in web mode (skip wizard)
    if not settings_dict.get("onboardingCompleted"):
        settings_dict["onboardingCompleted"] = True

    return {"success": True, "data": settings_dict}


@router.put("")
async def update_settings(settings: SettingsModel) -> dict:
    """Update application settings."""
    save_settings(settings)
    return {"success": True, "data": settings.model_dump()}


@router.patch("")
async def patch_settings(updates: dict[str, Any]) -> dict:
    """Partially update application settings.

    Unknown settings are silently ignored to maintain compatibility
    with different frontend versions.
    """
    current = load_settings()
    current_dict = current.model_dump()

    for key, value in updates.items():
        # Only update known settings, ignore unknown ones for compatibility
        if key in current_dict:
            current_dict[key] = value
        # Silently ignore unknown settings instead of raising an error

    updated = SettingsModel(**current_dict)
    save_settings(updated)

    return {"success": True, "data": updated.model_dump()}
