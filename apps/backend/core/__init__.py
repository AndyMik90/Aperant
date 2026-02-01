"""
Core Framework Module
=====================

Core components for the Jerry autonomous coding framework.
"""

# Note: We use lazy imports here because the full agent module has many dependencies
# that may not be needed for basic operations like workspace management.

__all__ = [
    "run_autonomous_agent",
    "run_followup_planner",
    "WorkspaceManager",
    "WorktreeManager",
    "ProgressTracker",
]


def __getattr__(name):
    """Lazy imports to avoid circular dependencies and heavy imports."""
    if name in ("run_autonomous_agent", "run_followup_planner"):
        from .agent import run_autonomous_agent, run_followup_planner

        return locals()[name]
    elif name == "WorkspaceManager":
        from .workspace import WorkspaceManager

        return WorkspaceManager
    elif name == "WorktreeManager":
        from .worktree import WorktreeManager

        return WorktreeManager
    elif name == "ProgressTracker":
        from .progress import ProgressTracker

        return ProgressTracker
    elif name in ("create_claude_client", "ClaudeClient"):
        from . import client as _client

        return getattr(_client, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
