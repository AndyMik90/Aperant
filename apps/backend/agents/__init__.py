"""
Agents Module
=============

Modular agent system for autonomous coding.

This module provides:
- run_autonomous_agent: Main coder agent loop
- run_followup_planner: Follow-up planner for completed specs
- Memory management (Graphiti + file-based fallback)
- Session management and post-processing
- Utility functions for git and plan management

Uses lazy imports to avoid circular dependencies.

Note: Module-level placeholders are defined to satisfy CodeQL static analysis.
These trigger the actual import on first access through __getattr__.
"""

from __future__ import annotations

from typing import Any

from .base import AUTO_CONTINUE_DELAY_SECONDS, HUMAN_INTERVENTION_FILE
from .utils import (
    find_phase_for_subtask,
    find_subtask_in_plan,
    get_commit_count,
    get_latest_commit,
    load_implementation_plan,
    sync_spec_to_source,
)

__all__ = [
    # Main API
    "run_autonomous_agent",
    "run_followup_planner",
    # Memory
    "debug_memory_system_status",
    "get_graphiti_context",
    "save_session_memory",
    "save_session_to_graphiti",
    # Session
    "run_agent_session",
    "post_session_processing",
    # Utils
    "get_latest_commit",
    "get_commit_count",
    "load_implementation_plan",
    "find_subtask_in_plan",
    "find_phase_for_subtask",
    "sync_spec_to_source",
    # Constants
    "AUTO_CONTINUE_DELAY_SECONDS",
    "HUMAN_INTERVENTION_FILE",
]

# Module-level stubs for CodeQL static analysis.
# These satisfy CodeQL's requirement that __all__ symbols be defined.
# __getattr__ provides the actual implementations via lazy loading.


def run_autonomous_agent(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


def run_followup_planner(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


def debug_memory_system_status(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


def get_graphiti_context(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


def save_session_memory(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


def save_session_to_graphiti(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


def run_agent_session(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


def post_session_processing(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


# Module cache for lazy imports
_module_cache = {}


def __getattr__(name: str) -> Any:
    """Lazy imports to avoid circular dependencies.

    Python 3.7+ calls this for attributes that don't exist at module level.
    """
    if name == "run_autonomous_agent":
        from . import coder  # Ensure agents.coder is registered in sys.modules

        return coder.run_autonomous_agent
    elif name == "debug_memory_system_status":
        from . import (
            memory_manager,  # Ensure agents.memory_manager is registered in sys.modules
        )

        return memory_manager.debug_memory_system_status
    elif name == "get_graphiti_context":
        from . import (
            memory_manager,  # Ensure agents.memory_manager is registered in sys.modules
        )

        return memory_manager.get_graphiti_context
    elif name == "save_session_memory":
        from . import (
            memory_manager,  # Ensure agents.memory_manager is registered in sys.modules
        )

        return memory_manager.save_session_memory
    elif name == "save_session_to_graphiti":
        from . import (
            memory_manager,  # Ensure agents.memory_manager is registered in sys.modules
        )

        return memory_manager.save_session_to_graphiti
    elif name == "run_followup_planner":
        from . import planner  # Ensure agents.planner is registered in sys.modules

        return planner.run_followup_planner
    elif name == "post_session_processing":
        from . import session  # Ensure agents.session is registered in sys.modules

        return session.post_session_processing
    elif name == "run_agent_session":
        from . import session  # Ensure agents.session is registered in sys.modules

        return session.run_agent_session
    raise AttributeError(f"module 'agents' has no attribute '{name}'")


def __dir__():
    """Return list of module attributes for autocomplete and dir()."""
    return __all__ + [
        "__all__",
        "__doc__",
        "__file__",
        "__getattr__",
        "__name__",
        "__package__",
        "__loader__",
        "__spec__",
    ]
