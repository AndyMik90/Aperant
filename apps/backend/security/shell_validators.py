"""
Shell Interpreter Validators
=============================

Validators for shell interpreter commands (bash, sh, zsh) that execute
inline commands via the -c flag.

This closes a security bypass where `bash -c "npm test"` could execute
arbitrary commands since `bash` is in BASE_COMMANDS but the commands
inside -c were not being validated.
"""

import os
import shlex
from pathlib import Path

from project_analyzer import is_command_allowed

from .parser import _cross_platform_basename, extract_commands, split_command_segments
from .profile import get_security_profile
from .validation_models import ValidationResult

# Shell interpreters that can execute nested commands
SHELL_INTERPRETERS = {"bash", "sh", "zsh"}


def _extract_c_argument(command_string: str) -> str | None:
    """
    Extract the command string from a shell -c invocation.

    Handles various formats:
    - bash -c 'command'
    - bash -c "command"
    - sh -c 'cmd1 && cmd2'
    - zsh -c "complex command"

    Args:
        command_string: The full shell command (e.g., "bash -c 'npm test'")

    Returns:
        The command string after -c, or None if not a -c invocation
    """
    try:
        tokens = shlex.split(command_string)
    except ValueError:
        # Malformed command - let it fail safely
        return None

    if len(tokens) < 3:
        return None

    # Look for -c flag (standalone or combined with other flags like -xc, -ec, -ic)
    for i, token in enumerate(tokens):
        # Check for standalone -c or combined flags containing 'c'
        # Combined flags: -xc, -ec, -ic, -exc, etc. (short options bundled together)
        is_c_flag = token == "-c" or (
            token.startswith("-") and not token.startswith("--") and "c" in token[1:]
        )
        if is_c_flag and i + 1 < len(tokens):
            # The next token is the command to execute
            return tokens[i + 1]

    return None


def validate_shell_c_command(command_string: str) -> ValidationResult:
    """
    Validate commands inside bash/sh/zsh -c '...' strings.

    This prevents using shell interpreters to bypass the security allowlist.
    All commands inside the -c string must also be allowed by the profile.

    Args:
        command_string: The full shell command (e.g., "bash -c 'npm test'")

    Returns:
        Tuple of (is_valid, error_message)
    """
    # Extract the command after -c
    inner_command = _extract_c_argument(command_string)

    if inner_command is None:
        # Not a -c invocation (e.g., "bash script.sh")
        # Block dangerous shell constructs that could bypass sandbox restrictions:
        # - Process substitution: <(...) or >(...)
        # - Command substitution in dangerous contexts: $(...)
        dangerous_patterns = ["<(", ">("]
        for pattern in dangerous_patterns:
            if pattern in command_string:
                return (
                    False,
                    f"Process substitution '{pattern}' not allowed in shell commands",
                )
        # Allow simple shell invocations (e.g., "bash script.sh")
        # The script itself would need to be in allowed commands
        return True, ""

    # Get the security profile for the current project
    # Use PROJECT_DIR_ENV_VAR if set, otherwise use cwd
    from .constants import PROJECT_DIR_ENV_VAR

    project_dir = os.environ.get(PROJECT_DIR_ENV_VAR)
    if not project_dir:
        project_dir = os.getcwd()

    try:
        profile = get_security_profile(Path(project_dir))
    except Exception:
        # If we can't get the profile, fail safe by blocking
        return False, "Could not load security profile to validate shell -c command"

    # Extract command names for allowlist validation
    inner_command_names = extract_commands(inner_command)

    if not inner_command_names:
        # Could not parse - be permissive for empty commands
        # (e.g., bash -c "" is harmless)
        if not inner_command.strip():
            return True, ""
        return False, f"Could not parse commands inside shell -c: {inner_command}"

    # Validate each command name against the security profile
    for cmd_name in inner_command_names:
        is_allowed, reason = is_command_allowed(cmd_name, profile)
        if not is_allowed:
            return (
                False,
                f"Command '{cmd_name}' inside shell -c is not allowed: {reason}",
            )

    # Get full command segments for recursive shell validation
    # (split_command_segments gives us full commands, not just names)
    inner_segments = split_command_segments(inner_command)

    for segment in inner_segments:
        # Check if this segment is a shell invocation that needs recursive validation
        segment_commands = extract_commands(segment)
        if segment_commands:
            first_cmd = segment_commands[0]
            # Handle paths like /bin/bash or C:\Windows\System32\bash.exe
            base_cmd = _cross_platform_basename(first_cmd)
            if base_cmd in SHELL_INTERPRETERS:
                valid, err = validate_shell_c_command(segment)
                if not valid:
                    return False, f"Nested shell command not allowed: {err}"

    return True, ""


# Alias for common shell interpreters - they all use the same validation
validate_bash_command = validate_shell_c_command
validate_sh_command = validate_shell_c_command
validate_zsh_command = validate_shell_c_command
