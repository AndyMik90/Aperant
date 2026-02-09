"""
OpenRouter Embedder Provider
=============================

OpenRouter embedder implementation for Graphiti.
Uses OpenAI-compatible embedding API.
"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ...config import GraphitiConfig

from ..exceptions import ProviderError, ProviderNotInstalled


def create_openrouter_embedder(config: "GraphitiConfig") -> Any:
    """
    Create OpenRouter embedder client.

    OpenRouter uses OpenAI-compatible API, so we use the OpenAI embedder
    with custom base URL.

    Args:
        config: GraphitiConfig with OpenRouter settings

    Returns:
        OpenAI-compatible embedder instance

    Raises:
        ProviderNotInstalled: If graphiti-core is not installed
        ProviderError: If API key is missing

    Example:
        >>> from ac_jerry.integrations.graphiti.config import GraphitiConfig
        >>> config = GraphitiConfig(
        ...     openrouter_api_key="sk-or-...",
        ...     openrouter_embedding_model="openai/text-embedding-3-small"
        ... )
        >>> embedder = create_openrouter_embedder(config)
    """
    try:
        from graphiti_core.embedder import EmbedderConfig, OpenAIEmbedder
    except ImportError as e:
        raise ProviderNotInstalled(
            f"OpenRouter provider requires graphiti-core. "
            f"Install with: pip install graphiti-core\n"
            f"Error: {e}"
        )

    if not config.openrouter_api_key:
        raise ProviderError("OpenRouter provider requires OPENROUTER_API_KEY")

    embedder_config = EmbedderConfig(
        api_key=config.openrouter_api_key,
        model=config.openrouter_embedding_model,
        base_url=config.openrouter_base_url,
    )

    return OpenAIEmbedder(config=embedder_config)
