"""
Claude client module facade.

Provides Claude API client utilities.
Uses lazy imports to avoid circular dependencies.
"""


def __getattr__(name):
    """Lazy import to avoid circular imports with ac_jerry_tools."""
    from core import client as _client

    return getattr(_client, name)


def create_client(*args, **kwargs):
    """Create a Claude client instance."""
    from core.client import create_client as _create_client

    return _create_client(*args, **kwargs)


__all__ = [
    "create_client",
]
