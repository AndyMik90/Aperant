"""
Core Framework Module
=====================

Core components for the Auto Claude autonomous coding framework.

Note: We use lazy imports here because the full agent module has many dependencies
that may not be needed for basic operations.
"""

from typing import Any


# Module-level placeholders for CodeQL static analysis.
# The actual exported names trigger __getattr__ for lazy loading.
def run_autonomous_agent(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


def run_followup_planner(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


class WorktreeManager:  # type: ignore[misc, no-redef]
    """Stub for lazy import."""


def create_claude_client(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


class ClaudeClient:  # type: ignore[misc, no-redef]
    """Stub for lazy import."""


__all__ = [
    "run_autonomous_agent",
    "run_followup_planner",
    "WorktreeManager",
    "create_claude_client",
    "ClaudeClient",
]


def __getattr__(name: str) -> Any:
    """Lazy imports to avoid circular dependencies and heavy imports."""
    if name == "run_autonomous_agent":
        from .agent import run_autonomous_agent

        return run_autonomous_agent
    elif name == "run_followup_planner":
        from .agent import run_followup_planner

        return run_followup_planner
    elif name == "WorktreeManager":
        from .worktree import WorktreeManager

        return WorktreeManager
    elif name in ("create_claude_client", "ClaudeClient"):
        from . import client as _client

        return getattr(_client, name)

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def _do_lazy_import(name: str) -> Any:
    """Perform the actual lazy import for a given name."""
    if name == "run_autonomous_agent":
        from .agent import run_autonomous_agent

        return run_autonomous_agent
    if name == "run_followup_planner":
        from .agent import run_followup_planner

        return run_followup_planner
    if name == "WorktreeManager":
        from .worktree import WorktreeManager

        return WorktreeManager
    raise AssertionError(f"Unknown lazy import name: {name}")
