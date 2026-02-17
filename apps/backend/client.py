"""
LLM client module facade.

Provides LLM client utilities for both Claude Agent SDK and local LLM backends.
Uses lazy imports to avoid circular dependencies.

The active provider is determined by the LLM_PROVIDER environment variable:
  - "claude" (default): Claude Agent SDK (cloud)
  - "local": Local LLM via OpenAI-compatible API (Ollama, vLLM, etc.)
"""


def __getattr__(name):
    """Lazy import to avoid circular imports with ac_jerry_tools."""
    from core import client as _client

    return getattr(_client, name)


def create_client(*args, **kwargs):
    """Create an LLM client instance (auto-selects Claude SDK or local LLM)."""
    from core.client import create_client as _create_client

    return _create_client(*args, **kwargs)


def is_local_llm_enabled():
    """Check if local LLM mode is active (LLM_PROVIDER=local)."""
    from core.client import is_local_llm_enabled as _is_local

    return _is_local()


def get_llm_provider():
    """Get the active LLM provider name ('claude' or 'local')."""
    from core.client import get_llm_provider as _get_provider

    return _get_provider()


__all__ = [
    "create_client",
    "is_local_llm_enabled",
    "get_llm_provider",
]
