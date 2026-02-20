"""
Investigation Safety Hooks
===========================

PreToolUse hooks for investigation specialist agents.

investigation_bash_guard() validates Bash commands against a strict
allowlist of read-only, investigation-safe commands. This lets
specialists run git history commands, test runners, and dependency
queries without risking destructive operations.

Commands are validated by:
1. Rejecting dangerous shell operators (;, |, &, `, $(), ${}, redirects)
2. Checking the base command against INVESTIGATION_BASH_ALLOWLIST
3. Blocking dangerous find flags (-exec, -execdir, -delete, -ok, -okdir)
"""

from __future__ import annotations

import json
import logging
import re
import shlex
from datetime import datetime, timezone
from typing import Any

try:
    from .io_utils import safe_print
except (ImportError, ValueError, SystemError):
    try:
        from services.io_utils import safe_print
    except (ImportError, ModuleNotFoundError):
        from core.io_utils import safe_print

logger = logging.getLogger(__name__)

# Shell operators and constructs that allow command chaining / injection.
_DANGEROUS_PATTERNS = re.compile(
    r"[;|&`]"
    r"|\$\("
    r"|\$\{"
    r"|>\s"
    r"|<\s"
    r"|>>",
)

# find(1) flags that can execute arbitrary commands or delete files.
_DANGEROUS_FIND_FLAGS = {"-exec", "-execdir", "-delete", "-ok", "-okdir"}

# Commands that investigation agents are allowed to run.
INVESTIGATION_BASH_ALLOWLIST: list[str] = [
    # Git history (read-only)
    "git log",
    "git show",
    "git blame",
    "git diff",
    "git status",
    # Test runners
    "pytest",
    "python -m pytest",
    "npm test",
    "npm run test",
    "npx vitest",
    "vitest",
    "cargo test",
    # Dependency inspection
    "pip list",
    "pip show",
    "npm ls",
    "node -v",
    "node --version",
    "python -V",
    "python --version",
    "python3 --version",
    # Filesystem exploration
    "ls",
    "find",
    "wc",
    "cat",
    "head",
    "tail",
    "file",
    "grep",
    "rg",
]


def _normalize_command(command: str) -> str:
    """Normalize command before safety validation.

    Allows one safe shell prelude form used by agents:
    `cd <path> && <allowlisted-read-only-command>`

    We strip the `cd ... &&` segment so validation can focus on the command
    itself while still rejecting broader chaining patterns.
    """
    stripped = command.strip()
    if "&&" not in stripped:
        return stripped

    left, right = stripped.split("&&", 1)
    # Only allow a single cd prelude, never multi-chain.
    if "&&" in right:
        return stripped

    left_stripped = left.strip()
    right_stripped = right.strip()
    if not left_stripped.startswith("cd ") or not right_stripped:
        return stripped

    try:
        cd_tokens = shlex.split(left_stripped)
    except ValueError:
        return stripped

    # Strictly require `cd <single-path-arg>`
    if len(cd_tokens) != 2 or cd_tokens[0] != "cd":
        return stripped

    return right_stripped


def _is_command_safe(command: str) -> bool:
    """Check if a command is safe for investigation agents.

    Validates that:
    1. No dangerous shell operators are present (;, |, &, `, $(), redirects)
       after optional `cd <path> &&` prelude normalization
    2. The base command is in the allowlist
    3. ``find`` does not use dangerous flags (-exec, -delete, etc.)
    """
    command = _normalize_command(command)

    # Reject shell operators that enable command chaining / injection
    if _DANGEROUS_PATTERNS.search(command):
        return False

    # Parse into tokens to extract the base command
    try:
        tokens = shlex.split(command)
    except ValueError:
        return False

    if not tokens:
        return False

    base_cmd = tokens[0]

    # Check if the base command (or full prefix) is in the allowlist
    # Both conditions must be true: base command matches AND command starts with allowed prefix
    base_cmd_allowed = any(
        base_cmd == allowed or base_cmd == allowed.split()[0]
        for allowed in INVESTIGATION_BASH_ALLOWLIST
    )
    full_prefix_allowed = any(
        command.startswith(allowed) for allowed in INVESTIGATION_BASH_ALLOWLIST
    )

    if not (base_cmd_allowed and full_prefix_allowed):
        return False

    # Extra guard for find: block flags that execute commands or delete files
    if base_cmd == "find":
        lower_tokens = {t.lower() for t in tokens}
        if lower_tokens & _DANGEROUS_FIND_FLAGS:
            return False

    return True


async def investigation_bash_guard(
    input_data: dict[str, Any],
    tool_use_id: str | None = None,
    context: Any | None = None,
) -> dict[str, Any]:
    """
    PreToolUse hook: validate Bash commands for investigation safety.

    Allows only commands that start with an entry in
    INVESTIGATION_BASH_ALLOWLIST. All other commands are denied.

    Args:
        input_data: Dict with tool_name and tool_input from SDK
        tool_use_id: Tool use ID (unused)
        context: Hook context (unused)

    Returns:
        Empty dict to allow, or hookSpecificOutput with deny decision
    """
    tool_input = input_data.get("tool_input")
    if not isinstance(tool_input, dict):
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "Bash tool_input is missing or malformed",
            }
        }

    command = tool_input.get("command", "").strip()
    if not command:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "Empty Bash command",
            }
        }

    # Validate command safety (allowlist + shell-operator rejection)
    if _is_command_safe(command):
        logger.debug(f"[InvestigationHook] Allowed: {command[:80]}")
        return {}

    # Deny with reason
    logger.info(f"[InvestigationHook] Blocked: {command[:100]}")
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"Command not allowed during investigation: {command[:100]}"
            ),
        }
    }


def emit_json_event(event: str, agent: str, **kwargs: Any) -> None:
    """Emit a structured JSON event to stdout for the frontend to parse.

    Args:
        event: Event type (tool_start, tool_end, thinking)
        agent: Specialist agent name (root_cause, impact, etc.)
        **kwargs: Additional event data
    """
    try:
        payload = {
            "event": event,
            "agent": agent,
            "ts": datetime.now(timezone.utc).isoformat(),
            **kwargs,
        }
        safe_print(json.dumps(payload, default=str))
    except Exception:
        pass  # Never crash a specialist due to event emission failure
