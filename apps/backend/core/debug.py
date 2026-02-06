#!/usr/bin/env python3
"""
Debug Logging Utility
=====================

Centralized debug logging for the Auto-Claude framework.
Controlled via environment variables:
  - DEBUG=true          Enable debug mode
  - DEBUG_LEVEL=1|2|3   Log verbosity (1=basic, 2=detailed, 3=verbose)
  - DEBUG_LOG_FILE=path Optional file output

Usage:
    from debug import debug, debug_detailed, debug_verbose, is_debug_enabled

    debug("run.py", "Starting task execution", task_id="001")
    debug_detailed("agent", "Agent response received", response_length=1234)
    debug_verbose("client", "Full request payload", payload=data)
"""

import json
import os
import sys
import time
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any


# ANSI color codes for terminal output
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    # Debug colors
    DEBUG = "\033[36m"  # Cyan
    DEBUG_DIM = "\033[96m"  # Light cyan
    TIMESTAMP = "\033[90m"  # Gray
    MODULE = "\033[33m"  # Yellow
    KEY = "\033[35m"  # Magenta
    VALUE = "\033[37m"  # White
    SUCCESS = "\033[32m"  # Green
    WARNING = "\033[33m"  # Yellow
    ERROR = "\033[31m"  # Red


def _get_debug_enabled() -> bool:
    """Check if debug mode is enabled via environment variable."""
    return os.environ.get("DEBUG", "").lower() in ("true", "1", "yes", "on")


def _get_debug_level() -> int:
    """Get debug verbosity level (1-3)."""
    try:
        level = int(os.environ.get("DEBUG_LEVEL", "1"))
        return max(1, min(3, level))  # Clamp to 1-3
    except ValueError:
        return 1


def _get_log_file() -> Path | None:
    """Get optional log file path."""
    log_file = os.environ.get("DEBUG_LOG_FILE")
    if log_file:
        return Path(log_file)
    return None


def is_debug_enabled() -> bool:
    """Check if debug mode is enabled."""
    return _get_debug_enabled()


def get_debug_level() -> int:
    """Get current debug level."""
    return _get_debug_level()


def _format_value(value: Any, max_length: int = 200) -> str:
    """Format a value for debug output, truncating if necessary."""
    if value is None:
        return "None"

    if isinstance(value, (dict, list)):
        try:
            formatted = json.dumps(value, indent=2, default=str)
            if len(formatted) > max_length:
                formatted = formatted[:max_length] + "..."
            return formatted
        except (TypeError, ValueError):
            return str(value)[:max_length]

    str_value = str(value)
    if len(str_value) > max_length:
        return str_value[:max_length] + "..."
    return str_value


def _write_log(message: str, to_file: bool = True) -> None:
    """Write log message to stdout and optionally to file."""
    print(message, file=sys.stderr)

    if to_file:
        log_file = _get_log_file()
        if log_file:
            try:
                log_file.parent.mkdir(parents=True, exist_ok=True)
                # Strip ANSI codes for file output
                import re

                clean_message = re.sub(r"\033\[[0-9;]*m", "", message)
                with open(log_file, "a", encoding="utf-8") as f:
                    f.write(clean_message + "\n")
            except Exception:
                pass  # Silently fail file logging


def debug(module: str, message: str, level: int = 1, **kwargs) -> None:
    """
    Log a debug message.

    Args:
        module: Source module name (e.g., "run.py", "ideation_runner")
        message: Debug message
        level: Required debug level (1=basic, 2=detailed, 3=verbose)
        **kwargs: Additional key-value pairs to log
    """
    if not _get_debug_enabled():
        return

    if _get_debug_level() < level:
        return

    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]

    # Build the log line
    parts = [
        f"{Colors.TIMESTAMP}[{timestamp}]{Colors.RESET}",
        f"{Colors.DEBUG}[DEBUG]{Colors.RESET}",
        f"{Colors.MODULE}[{module}]{Colors.RESET}",
        f"{Colors.DEBUG_DIM}{message}{Colors.RESET}",
    ]

    log_line = " ".join(parts)

    # Add kwargs on separate lines if present
    if kwargs:
        for key, value in kwargs.items():
            formatted_value = _format_value(value)
            if "\n" in formatted_value:
                # Multi-line value
                log_line += f"\n  {Colors.KEY}{key}{Colors.RESET}:"
                for line in formatted_value.split("\n"):
                    log_line += f"\n    {Colors.VALUE}{line}{Colors.RESET}"
            else:
                log_line += f"\n  {Colors.KEY}{key}{Colors.RESET}: {Colors.VALUE}{formatted_value}{Colors.RESET}"

    _write_log(log_line)


def debug_detailed(module: str, message: str, **kwargs) -> None:
    """Log a detailed debug message (level 2)."""
    debug(module, message, level=2, **kwargs)


def debug_verbose(module: str, message: str, **kwargs) -> None:
    """Log a verbose debug message (level 3)."""
    debug(module, message, level=3, **kwargs)


def debug_success(module: str, message: str, **kwargs) -> None:
    """Log a success debug message."""
    if not _get_debug_enabled():
        return

    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    log_line = f"{Colors.TIMESTAMP}[{timestamp}]{Colors.RESET} {Colors.SUCCESS}[OK]{Colors.RESET} {Colors.MODULE}[{module}]{Colors.RESET} {message}"

    if kwargs:
        for key, value in kwargs.items():
            log_line += f"\n  {Colors.KEY}{key}{Colors.RESET}: {Colors.VALUE}{_format_value(value)}{Colors.RESET}"

    _write_log(log_line)


def debug_info(module: str, message: str, **kwargs) -> None:
    """Log an info debug message."""
    if not _get_debug_enabled():
        return

    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    log_line = f"{Colors.TIMESTAMP}[{timestamp}]{Colors.RESET} {Colors.DEBUG}[INFO]{Colors.RESET} {Colors.MODULE}[{module}]{Colors.RESET} {message}"

    if kwargs:
        for key, value in kwargs.items():
            log_line += f"\n  {Colors.KEY}{key}{Colors.RESET}: {Colors.VALUE}{_format_value(value)}{Colors.RESET}"

    _write_log(log_line)


def debug_error(module: str, message: str, **kwargs) -> None:
    """Log an error debug message (always shown if debug enabled)."""
    if not _get_debug_enabled():
        return

    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    log_line = f"{Colors.TIMESTAMP}[{timestamp}]{Colors.RESET} {Colors.ERROR}[ERROR]{Colors.RESET} {Colors.MODULE}[{module}]{Colors.RESET} {Colors.ERROR}{message}{Colors.RESET}"

    if kwargs:
        for key, value in kwargs.items():
            log_line += f"\n  {Colors.KEY}{key}{Colors.RESET}: {Colors.VALUE}{_format_value(value)}{Colors.RESET}"

    _write_log(log_line)


def debug_warning(module: str, message: str, **kwargs) -> None:
    """Log a warning debug message."""
    if not _get_debug_enabled():
        return

    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    log_line = f"{Colors.TIMESTAMP}[{timestamp}]{Colors.RESET} {Colors.WARNING}[WARN]{Colors.RESET} {Colors.MODULE}[{module}]{Colors.RESET} {Colors.WARNING}{message}{Colors.RESET}"

    if kwargs:
        for key, value in kwargs.items():
            log_line += f"\n  {Colors.KEY}{key}{Colors.RESET}: {Colors.VALUE}{_format_value(value)}{Colors.RESET}"

    _write_log(log_line)


def debug_section(module: str, title: str) -> None:
    """Log a section header for organizing debug output."""
    if not _get_debug_enabled():
        return

    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    separator = "─" * 60
    log_line = f"\n{Colors.TIMESTAMP}[{timestamp}]{Colors.RESET} {Colors.DEBUG}{Colors.BOLD}┌{separator}┐{Colors.RESET}"
    log_line += f"\n{Colors.TIMESTAMP}         {Colors.RESET} {Colors.DEBUG}{Colors.BOLD}│ {module}: {title}{' ' * (58 - len(module) - len(title) - 2)}│{Colors.RESET}"
    log_line += f"\n{Colors.TIMESTAMP}         {Colors.RESET} {Colors.DEBUG}{Colors.BOLD}└{separator}┘{Colors.RESET}"

    _write_log(log_line)


def debug_timer(module: str):
    """
    Decorator to time function execution.

    Usage:
        @debug_timer("run.py")
        def my_function():
            ...
    """

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            if not _get_debug_enabled():
                return func(*args, **kwargs)

            start = time.time()
            debug_detailed(module, f"Starting {func.__name__}()")

            try:
                result = func(*args, **kwargs)
                elapsed = time.time() - start
                debug_success(
                    module,
                    f"Completed {func.__name__}()",
                    elapsed_ms=f"{elapsed * 1000:.1f}ms",
                )
                return result
            except Exception as e:
                elapsed = time.time() - start
                debug_error(
                    module,
                    f"Failed {func.__name__}()",
                    error=str(e),
                    elapsed_ms=f"{elapsed * 1000:.1f}ms",
                )
                raise

        return wrapper

    return decorator


def debug_async_timer(module: str):
    """
    Decorator to time async function execution.

    Usage:
        @debug_async_timer("ideation_runner")
        async def my_async_function():
            ...
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if not _get_debug_enabled():
                return await func(*args, **kwargs)

            start = time.time()
            debug_detailed(module, f"Starting {func.__name__}()")

            try:
                result = await func(*args, **kwargs)
                elapsed = time.time() - start
                debug_success(
                    module,
                    f"Completed {func.__name__}()",
                    elapsed_ms=f"{elapsed * 1000:.1f}ms",
                )
                return result
            except Exception as e:
                elapsed = time.time() - start
                debug_error(
                    module,
                    f"Failed {func.__name__}()",
                    error=str(e),
                    elapsed_ms=f"{elapsed * 1000:.1f}ms",
                )
                raise

        return wrapper

    return decorator


def debug_env_status() -> None:
    """Print debug environment status on startup."""
    if not _get_debug_enabled():
        return

    debug_section("debug", "Debug Mode Enabled")
    debug(
        "debug",
        "Environment configuration",
        DEBUG=os.environ.get("DEBUG", "not set"),
        DEBUG_LEVEL=_get_debug_level(),
        DEBUG_LOG_FILE=os.environ.get("DEBUG_LOG_FILE", "not set"),
    )


# Print status on import if debug is enabled
if _get_debug_enabled():
    debug_env_status()
