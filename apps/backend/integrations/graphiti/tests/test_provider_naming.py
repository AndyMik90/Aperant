#!/usr/bin/env python3
"""
Quick test to demonstrate provider-specific database naming.

Shows how Auto Claude automatically generates provider-specific database names
to prevent embedding dimension mismatches.
"""

import os
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

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

        print(f"Provider: {provider}")
        if model:
            print(f"  Model: {model}")
        print(f"  Embedding Dimension: {dimension}")
        print(f"  Provider Signature: {signature}")
        print(f"  Database Name: {db_name}")
        print(f"  Full Path: ~/.auto-claude/memories/{db_name}/")
        print()

    print("=" * 70)
    print("\nKey Benefits:")
    print("  ✅ No dimension mismatch errors")
    print("  ✅ Each provider uses its own database")
    print("  ✅ Can switch providers without conflicts")
    print("  ✅ Migration utility available for data transfer")
    print()


if __name__ == "__main__":
    test_provider_naming()
