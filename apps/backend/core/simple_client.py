"""
Simple Claude SDK Client Factory
================================

Factory for creating minimal Claude SDK clients for single-turn utility operations
like commit message generation, merge conflict resolution, and batch analysis.

These clients don't need full security configurations, MCP servers, or hooks.
Use `create_client()` from `core.client` for full agent sessions with security.

Example usage:
    from core.simple_client import create_simple_client

    # For commit message generation (text-only, no tools)
    client = create_simple_client(agent_type="commit_message")

    # For merge conflict resolution (text-only, no tools)
    client = create_simple_client(agent_type="merge_resolver")

    # For insights extraction (read tools only)
    client = create_simple_client(agent_type="insights", cwd=project_dir)
"""

import logging
import os
from pathlib import Path

from agents.tools_pkg import get_agent_config, get_default_thinking_level
from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from core.auth import (
    configure_sdk_authentication,
    get_sdk_env_vars,
)
from core.fast_mode import ensure_fast_mode_in_user_settings
from core.platform import validate_cli_path
from phase_config import get_thinking_budget

logger = logging.getLogger(__name__)


def create_simple_client(
    agent_type: str = "merge_resolver",
    model: str = "claude-haiku-4-5-20251001",
    system_prompt: str | None = None,
    cwd: Path | None = None,
    max_turns: int = 1,
    max_thinking_tokens: int | None = None,
    betas: list[str] | None = None,
    effort_level: str | None = None,
    fast_mode: bool = False,
) -> ClaudeSDKClient:
    """
    Create a minimal Claude SDK client for single-turn utility operations.

    This factory creates lightweight clients without MCP servers, security hooks,
    or full permission configurations. Use for text-only analysis tasks.

    Args:
        agent_type: Agent type from AGENT_CONFIGS. Determines available tools.
                   Common utility types:
                   - "merge_resolver" - Text-only merge conflict analysis
                   - "commit_message" - Text-only commit message generation
                   - "insights" - Read-only code insight extraction
                   - "batch_analysis" - Read-only batch issue analysis
                   - "batch_validation" - Read-only validation
        model: Claude model to use (defaults to Haiku for fast/cheap operations)
        system_prompt: Optional custom system prompt (for specialized tasks)
        cwd: Working directory for file operations (optional)
        max_turns: Maximum conversation turns (default: 1 for single-turn)
        max_thinking_tokens: Override thinking budget (None = use agent default from
                            AGENT_CONFIGS, converted using phase_config.THINKING_BUDGET_MAP)
        betas: Optional list of SDK beta header strings (e.g., ["context-1m-2025-08-07"])
        effort_level: Optional effort level for adaptive thinking models (e.g., "low",
                     "medium", "high"). Injected as CLAUDE_CODE_EFFORT_LEVEL env var.
        fast_mode: Enable Fast Mode for faster Opus 4.6 output. Enables the "user"
                  setting source so the CLI reads fastMode from ~/.claude/settings.json.

    Returns:
        Configured ClaudeSDKClient for single-turn operations

    Raises:
        ValueError: If agent_type is not found in AGENT_CONFIGS
    """
    # Get environment variables for SDK (including CLAUDE_CONFIG_DIR if set)
    sdk_env = get_sdk_env_vars()

    # Get the config dir for profile-specific credential lookup
    # CLAUDE_CONFIG_DIR enables per-profile Keychain entries with SHA256-hashed service names
    config_dir = sdk_env.get("CLAUDE_CONFIG_DIR")

    # Configure SDK authentication (OAuth or API profile mode)
    configure_sdk_authentication(config_dir)

    # Inject effort level for adaptive thinking models (e.g., Opus 4.6)
    if effort_level:
        sdk_env["CLAUDE_CODE_EFFORT_LEVEL"] = effort_level

    # Fast mode: the CLI reads "fastMode" from user settings (~/.claude/settings.json).
    # By default the SDK passes --setting-sources "" which blocks all filesystem settings.
    # We enable "user" source so the CLI can read fastMode from user settings.
    if fast_mode:
        ensure_fast_mode_in_user_settings()
        logger.info("[Fast Mode] ACTIVE — will enable user setting source for fastMode")

    # Get agent configuration (raises ValueError if unknown type)
    config = get_agent_config(agent_type)

    # Get tools from config (no MCP tools for simple clients)
    allowed_tools = list(config.get("tools", []))

    # Determine thinking budget using the single source of truth (phase_config.py)
    if max_thinking_tokens is None:
        thinking_level = get_default_thinking_level(agent_type)
        max_thinking_tokens = get_thinking_budget(thinking_level)

    # Build options dict
    # Note: SDK bundles its own CLI, so no cli_path detection needed
    options_kwargs = {
        "model": model,
        "system_prompt": system_prompt,
        "allowed_tools": allowed_tools,
        "max_turns": max_turns,
        "cwd": str(cwd.resolve()) if cwd else None,
        "env": sdk_env,
    }

    # Fast mode: enable user setting source so CLI reads fastMode from
    # ~/.claude/settings.json. Without this, --setting-sources "" blocks it.
    if fast_mode:
        options_kwargs["setting_sources"] = ["user"]

    # Only add max_thinking_tokens if not None (Haiku doesn't support extended thinking)
    if max_thinking_tokens is not None:
        options_kwargs["max_thinking_tokens"] = max_thinking_tokens

    # Add beta headers if specified (e.g., for 1M context window)
    if betas:
        options_kwargs["betas"] = betas

    # Optional: Allow CLI path override via environment variable
    env_cli_path = os.environ.get("CLAUDE_CLI_PATH")
    if env_cli_path and validate_cli_path(env_cli_path):
        options_kwargs["cli_path"] = env_cli_path
        logger.info(f"Using CLAUDE_CLI_PATH override: {env_cli_path}")

    return ClaudeSDKClient(options=ClaudeAgentOptions(**options_kwargs))
