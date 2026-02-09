"""
Graphiti Integration
====================

Integration with Graphiti knowledge graph for semantic memory.

Module-level placeholders (with _ prefix) are defined for CodeQL static
analysis. The actual exported names (without _ prefix) trigger __getattr__
for lazy loading.
"""

from typing import Any

# Config imports don't require graphiti package
from .config import GraphitiConfig, validate_graphiti_config


# Module-level placeholders for CodeQL static analysis.
def create_llm_client(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


def create_embedder(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


class GraphitiMemory:  # type: ignore[misc, no-redef]
    """Stub for lazy import."""


__all__ = [
    "GraphitiConfig",
    "validate_graphiti_config",
    "GraphitiMemory",
    "create_llm_client",
    "create_embedder",
]


def __getattr__(name: str) -> Any:
    """Lazy import to avoid requiring graphiti package for config-only imports."""
    private_map = {
        "GraphitiMemory": "_GraphitiMemory",
        "create_llm_client": "_create_llm_client",
        "create_embedder": "_create_embedder",
    }

    if name in private_map:
        private_name = private_map[name]
        globals()[private_name] = _do_lazy_import(name)
        return globals()[private_name]

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def _do_lazy_import(name: str) -> Any:
    """Perform the actual lazy import for a given name."""
    if name == "GraphitiMemory":
        from .memory import GraphitiMemory

        return GraphitiMemory
    if name == "create_llm_client":
        from .providers import create_llm_client

        return create_llm_client
    if name == "create_embedder":
        from .providers import create_embedder

        return create_embedder
    raise AssertionError(f"Unknown lazy import name: {name}")
