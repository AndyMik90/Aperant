#!/usr/bin/env python3
"""
Quick test to demonstrate provider-specific database naming.

Shows how Auto Claude automatically generates provider-specific database names
to prevent embedding dimension mismatches.
"""

import pytest
from integrations.graphiti.config import GraphitiConfig


@pytest.mark.parametrize(
    "provider,model,dim",
    [
        ("openai", None, None),
        ("ollama", "embeddinggemma", 768),
        ("ollama", "qwen3-embedding:0.6b", 1024),
        ("voyage", None, None),
        ("google", None, None),
    ],
)
def test_provider_naming(provider, model, dim):
    """Demonstrate provider-specific database naming."""
    # Create explicit config without relying on environment
    config = GraphitiConfig()
    config.embedder_provider = provider
    config.openai_embedding_model = "text-embedding-3-small"

    if provider == "ollama" and model:
        config.ollama_embedding_model = model
        if dim is not None:
            config.ollama_embedding_dim = dim
    elif provider == "voyage":
        config.voyage_embedding_model = "voyage-3"
    elif provider == "google":
        config.google_embedding_model = "text-embedding-004"

    # Get naming info
    dimension = config.get_embedding_dimension()
    signature = config.get_provider_signature()
    db_name = config.get_provider_specific_database_name("auto_claude_memory")

    # Strengthened assertions with exact expected values where known
    if provider == "openai":
        assert dimension == 1536, f"OpenAI dimension should be 1536, got {dimension}"
        assert "openai" in signature.lower(), "OpenAI signature should contain 'openai'"
        # Signature format is provider_dimension for openai
        assert signature == "openai_1536", f"Expected 'openai_1536', got '{signature}'"
    elif provider == "ollama" and model == "embeddinggemma":
        assert dimension == 768, (
            f"Ollama gemma dimension should be 768, got {dimension}"
        )
        assert signature == f"ollama_{model}_{dimension}", (
            f"Expected 'ollama_{model}_{dimension}', got '{signature}'"
        )
    elif provider == "ollama" and model == "qwen3-embedding:0.6b":
        assert dimension == 1024, (
            f"Ollama qwen dimension should be 1024, got {dimension}"
        )
        # Colons in model names are replaced with underscores in signature
        assert signature == "ollama_qwen3-embedding_0_6b_1024", (
            f"Expected 'ollama_qwen3-embedding_0_6b_1024', got '{signature}'"
        )
    elif provider == "voyage":
        assert dimension == 1024, f"Voyage dimension should be 1024, got {dimension}"
        assert signature == "voyage_1024", f"Expected 'voyage_1024', got '{signature}'"
    elif provider == "google":
        assert dimension == 768, f"Google dimension should be 768, got {dimension}"
        assert signature == "google_768", f"Expected 'google_768', got '{signature}'"

    # Verify signature appears in db_name
    assert signature is not None and signature != "", (
        f"Signature should be non-empty for {provider}"
    )
    assert signature in db_name, (
        f"Signature '{signature}' should appear in db_name '{db_name}' for {provider}"
    )
