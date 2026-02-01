"""
Debug module facade.

Provides debug logging utilities for the Jerry framework.
Re-exports from core.debug for clean imports.
"""

from core.debug import (
    Colors,
    debug,
    debug_async_timer,
    debug_detailed,
    debug_env_status,
    debug_error,
    debug_info,
    debug_section,
    debug_success,
    debug_timer,
    debug_verbose,
    debug_warning,
    get_debug_level,
    is_debug_enabled,
)

__all__ = [
    "Colors",
    "debug",
    "debug_async_timer",
    "debug_detailed",
    "debug_env_status",
    "debug_error",
    "debug_info",
    "debug_section",
    "debug_success",
    "debug_timer",
    "debug_verbose",
    "debug_warning",
    "get_debug_level",
    "is_debug_enabled",
]
