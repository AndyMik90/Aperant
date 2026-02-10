#!/usr/bin/env python3
"""
Quick test to demonstrate provider-specific database naming.

Shows how Auto Claude automatically generates provider-specific database names
to prevent embedding dimension mismatches.
"""

from integrations.graphiti.config import GraphitiConfig


def test_provider_naming():
    """Demonstrate provider-specific database naming."""

    print("\n" + "=" * 70)
    print("  PROVIDER-SPECIFIC DATABASE NAMING")
    print("=" * 70 + "\n")

    providers = [
        ("openai", None, None),
        ("ollama", "embeddinggemma", 768),
        ("ollama", "qwen3-embedding:0.6b", 1024),
        ("voyage", None, None),
        ("google", None, None),
    ]

    for provider, model, dim in providers:
        # Create config
        config = GraphitiConfig.from_env()
        config.embedder_provider = provider

        if provider == "ollama" and model:
            config.ollama_embedding_model = model
            if dim:
                config.ollama_embedding_dim = dim

        # Get naming info
        dimension = config.get_embedding_dimension()
        signature = config.get_provider_signature()
        db_name = config.get_provider_specific_database_name("auto_claude_memory")

        # Add assertions to verify behavior
        assert dimension is not None, f"Dimension should not be None for {provider}"
        assert signature is not None, f"Signature should not be None for {provider}"
        assert db_name is not None, f"Database name should not be None for {provider}"
        assert "auto_claude_memory" in db_name or provider in db_name, (
            f"Database name should contain base or provider name for {provider}"
        )


if __name__ == "__main__":
    test_provider_naming()
