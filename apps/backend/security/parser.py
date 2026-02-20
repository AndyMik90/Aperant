"""
Command Parsing Utilities
==========================

Functions for parsing and extracting commands from shell command strings.
Handles compound commands, pipes, subshells, and various shell constructs.

Windows Compatibility Note:
--------------------------
On Windows, commands containing paths with backslashes can cause shlex.split()
to fail (e.g., incomplete commands with unclosed quotes). This module includes
a fallback parser that extracts command names even from malformed commands,
ensuring security validation can still proceed.
"""

import re
import shlex
from pathlib import PurePosixPath, PureWindowsPath


def _split_fallback_parts(command_string: str) -> list[str]:
    """
    Split command string on shell separators outside of quoted regions.

    Fallback parsing is used when shlex parsing fails (often on malformed or
    partially quoted Windows commands). Even in fallback mode we still need to
    respect quoted pipes like grep patterns: "foo|bar".
    """
    if not command_string:
        return []

    parts: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False
    escaped = False

    i = 0
    while i < len(command_string):
        ch = command_string[i]

        if escaped:
            current.append(ch)
            escaped = False
            i += 1
            continue

        if ch == "\\":
            current.append(ch)
            escaped = True
            i += 1
            continue

        if ch == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
            current.append(ch)
            i += 1
            continue

        if ch == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
            current.append(ch)
            i += 1
            continue

        if not in_single_quote and not in_double_quote:
            if command_string.startswith("&&", i) or command_string.startswith("||", i):
                part = "".join(current).strip()
                if part:
                    parts.append(part)
                current = []
                i += 2
                continue

            if ch in {"|", ";"}:
                part = "".join(current).strip()
                if part:
                    parts.append(part)
                current = []
                i += 1
                continue

        current.append(ch)
        i += 1

    tail = "".join(current).strip()
    if tail:
        parts.append(tail)

    return parts


def _cross_platform_basename(path: str) -> str:
    """
    Extract the basename from a path in a cross-platform way.

    Handles both Windows paths (C:\\dir\\cmd.exe) and POSIX paths (/dir/cmd)
    regardless of the current platform. This is critical for running tests
    on Linux CI while handling Windows-style paths.

    Args:
        path: A file path string (Windows or POSIX format)

    Returns:
        The basename of the path (e.g., "python.exe" from "C:\\Python312\\python.exe")
    """
    # Strip surrounding quotes if present
    path = path.strip("'\"")

    # Check if this looks like a Windows path (contains backslash or drive letter)
    if "\\" in path or (len(path) >= 2 and path[1] == ":"):
        # Use PureWindowsPath to handle Windows paths on any platform
        return PureWindowsPath(path).name

    # For POSIX paths or simple command names, use PurePosixPath
    # (os.path.basename works but PurePosixPath is more explicit)
    return PurePosixPath(path).name


def _fallback_extract_commands(command_string: str) -> list[str]:
    """
    Fallback command extraction when shlex.split() fails.

    Uses regex to extract command names from potentially malformed commands.
    This is more permissive than shlex but ensures we can at least identify
    the commands being executed for security validation.

    Args:
        command_string: The command string to parse

    Returns:
        List of command names extracted from the string
    """
    commands = []

    # Shell keywords to skip
    shell_keywords = {
        "if",
        "then",
        "else",
        "elif",
        "fi",
        "for",
        "while",
        "until",
        "do",
        "done",
        "case",
        "esac",
        "in",
        "function",
    }

    # First, split by common shell operators while preserving quoted regions.
    # This avoids treating grep regex alternation inside quotes as new commands.
    parts = _split_fallback_parts(command_string)

    for part in parts:
        part = part.strip()
        if not part:
            continue

        # Skip variable assignments at the start (VAR=value cmd)
        while re.match(r"^[A-Za-z_][A-Za-z0-9_]*=\S*\s+", part):
            part = re.sub(r"^[A-Za-z_][A-Za-z0-9_]*=\S*\s+", "", part)

        if not part:
            continue

        # Strategy: Extract command from the BEGINNING of the part
        # Handle various formats:
        # - Simple: python3, npm, git
        # - Unix path: /usr/bin/python
        # - Windows path: C:\Python312\python.exe
        # - Quoted with spaces: "C:\Program Files\python.exe"

        # Extract first token, handling quoted strings with spaces
        first_token_match = re.match(r'^(?:"([^"]+)"|\'([^\']+)\'|([^\s]+))', part)
        if not first_token_match:
            continue

        # Pick whichever capture group matched (double-quoted, single-quoted, or unquoted)
        first_token = (
            first_token_match.group(1)
            or first_token_match.group(2)
            or first_token_match.group(3)
        )

        # Now extract just the command name from this token
        # Handle Windows paths (C:\dir\cmd.exe) and Unix paths (/dir/cmd)
        # Use cross-platform basename for reliable path handling on any OS
        cmd = _cross_platform_basename(first_token)

        # Remove Windows extensions
        cmd = re.sub(r"\.(exe|cmd|bat|ps1|sh)$", "", cmd, flags=re.IGNORECASE)

        # Clean up any remaining quotes or special chars at the start
        cmd = re.sub(r'^["\'\\/]+', "", cmd)

        # Skip tokens that look like function calls or code fragments (not shell commands)
        # These appear when splitting on semicolons inside malformed quoted strings
        if "(" in cmd or ")" in cmd or "." in cmd:
            continue

        if cmd and cmd.lower() not in shell_keywords:
            commands.append(cmd)

    return commands


def split_command_segments(command_string: str) -> list[str]:
    """
    Split a compound command into individual command segments.

    Handles command chaining (&&, ||, ;) but not pipes (those are single commands).
    """
    # Split on && and || while preserving the ability to handle each segment
    segments = re.split(r"\s*(?:&&|\|\|)\s*", command_string)

    # Further split on semicolons
    result = []
    for segment in segments:
        sub_segments = re.split(r'(?<!["\'])\s*;\s*(?!["\'])', segment)
        for sub in sub_segments:
            sub = sub.strip()
            if sub:
                result.append(sub)

    return result


def _contains_windows_path(command_string: str) -> bool:
    """
    Check if a command string contains Windows-style paths.

    Windows paths with backslashes cause issues with shlex.split() because
    backslashes are interpreted as escape characters in POSIX mode.

    Args:
        command_string: The command string to check

    Returns:
        True if Windows paths are detected
    """
    # Pattern matches:
    # - Drive letter paths: C:\, D:\, etc.
    # - Backslash followed by a path component (2+ chars to avoid escape sequences like \n, \t)
    #   The second char must be alphanumeric, underscore, or another path separator
    #   This avoids false positives on escape sequences which are single-char after backslash
    return bool(re.search(r"[A-Za-z]:\\|\\[A-Za-z][A-Za-z0-9_\\/]", command_string))


def extract_commands(command_string: str) -> list[str]:
    """
    Extract command names from a shell command string.

    Handles pipes, command chaining (&&, ||, ;), and subshells.
    Returns the base command names (without paths).

    On Windows or when commands contain malformed quoting (common with
    Windows paths in bash-style commands), falls back to regex-based
    extraction to ensure security validation can proceed.
    """
    # If command contains Windows paths, use fallback parser directly
    # because shlex.split() interprets backslashes as escape characters
    if _contains_windows_path(command_string):
        fallback_commands = _fallback_extract_commands(command_string)
        if fallback_commands:
            return fallback_commands
        # Continue with shlex if fallback found nothing

    commands = []

    # Split on semicolons that aren't inside quotes
    segments = re.split(r'(?<!["\'])\s*;\s*(?!["\'])', command_string)

    for segment in segments:
        segment = segment.strip()
        if not segment:
            continue

        try:
            tokens = shlex.split(segment)
        except ValueError:
            # Malformed command (unclosed quotes, etc.)
            # This is common on Windows with backslash paths in quoted strings
            # Use fallback parser instead of blocking
            fallback_commands = _fallback_extract_commands(command_string)
            if fallback_commands:
                return fallback_commands
            # If fallback also found nothing, return empty to trigger block
            return []

        if not tokens:
            continue

        # Track when we expect a command vs arguments
        expect_command = True

        for token in tokens:
            # Shell operators indicate a new command follows
            if token in ("|", "||", "&&", "&"):
                expect_command = True
                continue

            # Skip shell keywords that precede commands
            if token in (
                "if",
                "then",
                "else",
                "elif",
                "fi",
                "for",
                "while",
                "until",
                "do",
                "done",
                "case",
                "esac",
                "in",
                "!",
                "{",
                "}",
                "(",
                ")",
                "function",
            ):
                continue

            # Skip flags/options
            if token.startswith("-"):
                continue

            # Skip variable assignments (VAR=value)
            if "=" in token and not token.startswith("="):
                continue

            # Skip here-doc markers
            if token in ("<<", "<<<", ">>", ">", "<", "2>", "2>&1", "&>"):
                continue

            if expect_command:
                # Extract the base command name (handle paths like /usr/bin/python)
                # Use cross-platform basename for Windows paths on Linux CI
                cmd = _cross_platform_basename(token)
                commands.append(cmd)
                expect_command = False

    return commands


def get_command_for_validation(cmd: str, segments: list[str]) -> str:
    """
    Find the specific command segment that contains the given command.
    """
    for segment in segments:
        segment_commands = extract_commands(segment)
        if cmd in segment_commands:
            return segment
    return ""
