# Copyright (C) 2024-2026 Jerry Team
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Simple LLM Client Factory
===========================

Factory for creating minimal LLM clients for single-turn utility operations
like commit message generation, merge conflict resolution, and batch analysis.

Supports both Claude Agent SDK (cloud) and local LLM backends.
Provider is selected via LLM_PROVIDER env var ("claude" or "local").

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

from pathlib import Path

from agents.tools_pkg import get_agent_config, get_default_thinking_level
from core.client import is_local_llm_enabled
from phase_config import get_role_model, get_thinking_budget

# Sentinel to distinguish "not passed" from "explicitly passed None"
_UNSET = object()


def create_simple_client(
    agent_type: str = "merge_resolver",
    model: str | object = _UNSET,
    system_prompt: str | None = None,
    cwd: Path | None = None,
    max_turns: int = 1,
    max_thinking_tokens: int | None = None,
    spec_dir: Path | None = None,
):
    """
    Create a minimal LLM client for single-turn utility operations.

    Automatically selects Claude SDK or local LLM based on LLM_PROVIDER env var.

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
        model: Model to use. If not provided, uses role-based routing
               from ROLE_MODEL_DEFAULTS (haiku for utility, sonnet for review, etc.)
        system_prompt: Optional custom system prompt (for specialized tasks)
        cwd: Working directory for file operations (optional)
        max_turns: Maximum conversation turns (default: 1 for single-turn)
        max_thinking_tokens: Override thinking budget (None = use agent default from
                            AGENT_CONFIGS, converted using phase_config.THINKING_BUDGET_MAP)
        spec_dir: Optional spec directory for reading per-task role model overrides

    Returns:
        Configured client (ClaudeSDKClient or LocalLLMClient)

    Raises:
        ValueError: If agent_type is not found in AGENT_CONFIGS
    """
    if is_local_llm_enabled():
        return _create_simple_local_client(
            agent_type=agent_type,
            model=model if model is not _UNSET else None,
            system_prompt=system_prompt,
            cwd=cwd,
            max_turns=max_turns,
        )
    else:
        return _create_simple_claude_client(
            agent_type=agent_type,
            model=model,
            system_prompt=system_prompt,
            cwd=cwd,
            max_turns=max_turns,
            max_thinking_tokens=max_thinking_tokens,
            spec_dir=spec_dir,
        )


def _create_simple_claude_client(
    agent_type: str,
    model: str | object,
    system_prompt: str | None,
    cwd: Path | None,
    max_turns: int,
    max_thinking_tokens: int | None,
    spec_dir: Path | None,
):
    """Create a simple Claude SDK client (original implementation)."""
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
    from core.auth import get_sdk_env_vars, require_auth_token, validate_token_not_encrypted
    from core.client import find_claude_cli

    # Resolve model via role-based routing if not explicitly provided
    if model is _UNSET:
        model = get_role_model(agent_type, spec_dir=spec_dir)
    else:
        model = str(model)

    # Get authentication
    oauth_token = require_auth_token()
    validate_token_not_encrypted(oauth_token)

    import os
    os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = oauth_token

    # Get environment variables for SDK
    sdk_env = get_sdk_env_vars()

    # Get agent configuration (raises ValueError if unknown type)
    config = get_agent_config(agent_type)
    allowed_tools = list(config.get("tools", []))

    # Determine thinking budget
    if max_thinking_tokens is None:
        thinking_level = get_default_thinking_level(agent_type)
        max_thinking_tokens = get_thinking_budget(thinking_level)

    # Find Claude CLI path
    cli_path = find_claude_cli()

    # Build options dict
    options_kwargs = {
        "model": model,
        "system_prompt": system_prompt,
        "allowed_tools": allowed_tools,
        "max_turns": max_turns,
        "cwd": str(cwd.resolve()) if cwd else None,
        "env": sdk_env,
    }

    if max_thinking_tokens is not None:
        options_kwargs["max_thinking_tokens"] = max_thinking_tokens

    if cli_path:
        options_kwargs["cli_path"] = cli_path

    return ClaudeSDKClient(options=ClaudeAgentOptions(**options_kwargs))


def _create_simple_local_client(
    agent_type: str,
    model: str | None,
    system_prompt: str | None,
    cwd: Path | None,
    max_turns: int,
):
    """Create a simple local LLM client for utility operations."""
    from core.local_llm import LocalLLMClient, LocalLLMConfig

    config = get_agent_config(agent_type)
    raw_tools = list(config.get("tools", []))

    # Filter to locally-executable tools
    local_tool_names = {"Bash", "Read", "Write", "Edit", "Glob", "Grep"}
    allowed_tools = [t for t in raw_tools if t in local_tool_names]

    project_dir = cwd or Path.cwd()

    llm_config = LocalLLMConfig(
        model=model or "",
        system_prompt=system_prompt or "",
        project_dir=project_dir,
        max_turns=max_turns,
        allowed_tools=allowed_tools,
    )

    return LocalLLMClient(config=llm_config, project_dir=project_dir)
