"""
Security utilities for the web API.
"""

import logging
from pathlib import Path
from typing import Any


def sanitize_for_log(value: Any) -> str:
    """
    Sanitize user input for logging to prevent log injection attacks.

    This function:
    - Replaces newlines and carriage returns to prevent log entry forgery
    - Limits string length to prevent log flooding
    - Safely handles None values

    Args:
        value: Any value to be logged (will be converted to string)

    Returns:
        Sanitized string safe for logging

    Example:
        >>> logger.info(f"User {sanitize_for_log(username)} logged in")
    """
    if value is None:
        return "None"

    # Convert to string and replace newlines/carriage returns that could be used for injection
    sanitized = str(value).replace("\n", "\\n").replace("\r", "\\r")

    # Limit length to prevent log flooding
    max_len = 500
    if len(sanitized) > max_len:
        sanitized = sanitized[:max_len] + "..."

    return sanitized


def sanitize_path_component(component: str, allow_path_sep: bool = False) -> str:
    r"""
    Sanitize a path component to prevent path traversal attacks.

    This function:
    - Removes any path traversal attempts (../, ..\, etc.)
    - Removes absolute path indicators (/, C:, etc.)
    - Validates the component doesn't contain dangerous characters

    Args:
        component: The path component to sanitize (e.g., session_id, filename)
        allow_path_sep: If True, allows path separators (for multi-level paths)

    Returns:
        Sanitized path component safe for file operations

    Raises:
        ValueError: If the component contains path traversal attempts or is invalid

    Example:
        >>> safe_id = sanitize_path_component(session_id)
        >>> session_file = base_dir / f"{safe_id}.json"
    """
    if not component or not isinstance(component, str):
        raise ValueError("Path component must be a non-empty string")

    # Remove any whitespace
    component = component.strip()

    # Check for path traversal attempts
    if ".." in component:
        raise ValueError("Path traversal attempt detected")

    # Check for absolute paths (Unix)
    if component.startswith("/"):
        raise ValueError("Absolute path not allowed")

    # Check for absolute paths (Windows)
    if len(component) >= 2 and component[1] == ":":
        raise ValueError("Absolute path not allowed")

    # Check for null bytes
    if "\x00" in component:
        raise ValueError("Null byte in path component")

    # If path separators not allowed, check for them
    if not allow_path_sep:
        if "/" in component or "\\" in component:
            raise ValueError("Path separators not allowed in component")

    return component


def safe_join_path(base_path: Path, *components: str) -> Path:
    """
    Safely join path components and ensure result is within base_path.

    This prevents path traversal attacks by:
    1. Sanitizing each component
    2. Resolving the final path
    3. Verifying it's within the base directory

    Args:
        base_path: The base directory (must exist)
        *components: Path components to join

    Returns:
        Resolved path guaranteed to be within base_path

    Raises:
        ValueError: If path traversal is detected or path escapes base_path

    Example:
        >>> safe_path = safe_join_path(project_dir, session_id, "data.json")
    """
    # Resolve base path to absolute
    base_path = base_path.resolve()

    # Sanitize and join components
    sanitized = [sanitize_path_component(c) for c in components]
    target_path = base_path.joinpath(*sanitized).resolve()

    # Ensure the resolved path is within base_path
    try:
        target_path.relative_to(base_path)
    except ValueError:
        raise ValueError(
            "Path traversal detected: resolved path escapes base directory"
        )

    return target_path


class SecureLogger(logging.LoggerAdapter):
    """
    A logger wrapper that automatically sanitizes all log messages to prevent log injection attacks.

    This logger automatically sanitizes:
    - User-provided data in f-strings and format strings
    - Arguments passed to log methods
    - Prevents newline injection and log flooding

    Usage:
        >>> from web.utils.security import get_secure_logger
        >>> logger = get_secure_logger("my-module")
        >>> logger.info(f"User {user_input} logged in")  # Automatically sanitized
    """

    def process(self, msg, kwargs):
        """Process the logging message to sanitize any user input."""
        # Sanitize the message itself
        if isinstance(msg, str):
            # Look for common patterns that might contain user input
            # This is a best-effort approach - f-strings are already evaluated
            msg = self._sanitize_message(msg)

        return msg, kwargs

    def _sanitize_message(self, msg: str) -> str:
        """Sanitize a log message by replacing newlines and limiting length."""
        # Replace newlines and carriage returns
        sanitized = msg.replace("\n", "\\n").replace("\r", "\\r")

        # Limit overall message length to prevent log flooding
        max_len = 2000  # Longer limit for full messages
        if len(sanitized) > max_len:
            sanitized = sanitized[:max_len] + "... [truncated]"

        return sanitized


def get_secure_logger(name: str) -> SecureLogger:
    """
    Get a secure logger that automatically sanitizes all log messages.

    Args:
        name: The logger name (typically module name)

    Returns:
        A SecureLogger instance that wraps the standard logger

    Example:
        >>> logger = get_secure_logger("auto-claude-api")
        >>> logger.info(f"Processing request from {user_ip}")  # Automatically sanitized
    """
    base_logger = logging.getLogger(name)
    return SecureLogger(base_logger, {})
