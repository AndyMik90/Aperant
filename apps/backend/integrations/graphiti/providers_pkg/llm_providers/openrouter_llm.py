"""
OpenRouter LLM Provider
=======================

OpenRouter LLM client implementation for Graphiti.
Uses OpenAI-compatible API.
"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ...config import GraphitiConfig

from ..exceptions import ProviderError, ProviderNotInstalled


def create_openrouter_llm_client(config: "GraphitiConfig") -> Any:
    """
    Create OpenRouter LLM client.

    OpenRouter uses OpenAI-compatible API, so we use the OpenAI client
    with custom base URL.

    Args:
        config: GraphitiConfig with OpenRouter settings

    Returns:
        OpenAI-compatible LLM client instance

    Raises:
        ProviderNotInstalled: If graphiti-core is not installed
        ProviderError: If API key is missing

    Example:
        >>> from auto_claude.integrations.graphiti.config import GraphitiConfig
        >>> config = GraphitiConfig(
        ...     openrouter_api_key="sk-or-...",
        ...     openrouter_llm_model="anthropic/claude-sonnet-4"
        ... )
        >>> client = create_openrouter_llm_client(config)
    """
    try:
        from graphiti_core.llm_client.config import LLMConfig
        from graphiti_core.llm_client.openai_client import OpenAIClient
    except ImportError as e:
        raise ProviderNotInstalled(
            f"OpenRouter provider requires graphiti-core. "
            f"Install with: pip install graphiti-core\n"
            f"Error: {e}"
        )

    if not config.openrouter_api_key:
        raise ProviderError("OpenRouter provider requires OPENROUTER_API_KEY")

    llm_config = LLMConfig(
        api_key=config.openrouter_api_key,
        model=config.openrouter_llm_model,
        base_url=config.openrouter_base_url,
    )

    # OpenRouter uses OpenAI-compatible API
    # Disable reasoning/verbosity for compatibility
    return OpenAIClient(config=llm_config, reasoning=None, verbosity=None)
