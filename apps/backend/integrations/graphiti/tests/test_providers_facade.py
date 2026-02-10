"""
Tests for integrations.graphiti.providers module.

This module is a re-export facade that re-exports all public APIs
from the graphiti_providers package.
"""

import pytest

# Expected exports from integrations.graphiti.providers module
EXPECTED_EXPORTS = [
    "ProviderError",
    "ProviderNotInstalled",
    "create_llm_client",
    "create_embedder",
    "create_cross_encoder",
    "EMBEDDING_DIMENSIONS",
    "get_expected_embedding_dim",
    "validate_embedding_config",
    "test_llm_connection",
    "test_embedder_connection",
    "test_ollama_connection",
    "is_graphiti_enabled",
    "get_graph_hints",
]

# =============================================================================
# Tests for module imports
# =============================================================================


class TestModuleImports:
    """Test that all expected exports are available."""

    def test_import_ProviderError(self):
        """Test ProviderError can be imported."""
        from integrations.graphiti.providers import ProviderError

        assert ProviderError is not None
        # Should be an exception class
        assert issubclass(ProviderError, Exception)

    def test_import_ProviderNotInstalled(self):
        """Test ProviderNotInstalled can be imported."""
        from integrations.graphiti.providers import ProviderNotInstalled

        assert ProviderNotInstalled is not None
        # Should be an exception class
        assert issubclass(ProviderNotInstalled, Exception)

    def test_import_create_llm_client(self):
        """Test create_llm_client can be imported."""
        from integrations.graphiti.providers import create_llm_client

        assert create_llm_client is not None
        assert callable(create_llm_client)

    def test_import_create_embedder(self):
        """Test create_embedder can be imported."""
        from integrations.graphiti.providers import create_embedder

        assert create_embedder is not None
        assert callable(create_embedder)

    def test_import_create_cross_encoder(self):
        """Test create_cross_encoder can be imported."""
        from integrations.graphiti.providers import create_cross_encoder

        assert create_cross_encoder is not None
        assert callable(create_cross_encoder)

    def test_import_EMBEDDING_DIMENSIONS(self):
        """Test EMBEDDING_DIMENSIONS can be imported."""
        from integrations.graphiti.providers import EMBEDDING_DIMENSIONS

        assert EMBEDDING_DIMENSIONS is not None
        assert isinstance(EMBEDDING_DIMENSIONS, dict)

    def test_import_get_expected_embedding_dim(self):
        """Test get_expected_embedding_dim can be imported."""
        from integrations.graphiti.providers import get_expected_embedding_dim

        assert get_expected_embedding_dim is not None
        assert callable(get_expected_embedding_dim)

    def test_import_validate_embedding_config(self):
        """Test validate_embedding_config can be imported."""
        from integrations.graphiti.providers import validate_embedding_config

        assert validate_embedding_config is not None
        assert callable(validate_embedding_config)

    def test_import_test_llm_connection(self):
        """Test test_llm_connection can be imported."""
        from integrations.graphiti.providers import test_llm_connection

        assert test_llm_connection is not None
        assert callable(test_llm_connection)

    def test_import_test_embedder_connection(self):
        """Test test_embedder_connection can be imported."""
        from integrations.graphiti.providers import test_embedder_connection

        assert test_embedder_connection is not None
        assert callable(test_embedder_connection)

    def test_import_test_ollama_connection(self):
        """Test test_ollama_connection can be imported."""
        from integrations.graphiti.providers import test_ollama_connection

        assert test_ollama_connection is not None
        assert callable(test_ollama_connection)

    def test_import_is_graphiti_enabled(self):
        """Test is_graphiti_enabled can be imported."""
        from integrations.graphiti.providers import is_graphiti_enabled

        assert is_graphiti_enabled is not None
        assert callable(is_graphiti_enabled)

    def test_import_get_graph_hints(self):
        """Test get_graph_hints can be imported."""
        from integrations.graphiti.providers import get_graph_hints

        assert get_graph_hints is not None
        assert callable(get_graph_hints)


# =============================================================================
# Tests for __all__ export list
# =============================================================================


class TestAllExports:
    """Test __all__ contains expected exports."""

    def test_all_exports_defined(self):
        """Test __all__ is defined and contains expected items."""
        from integrations.graphiti import providers

        assert hasattr(providers, "__all__")
        assert isinstance(providers.__all__, list)

        for export in EXPECTED_EXPORTS:
            assert export in providers.__all__, f"{export} not in __all__"

    def test_all_exports_count(self):
        """Test __all__ contains the expected number of exports."""
        from integrations.graphiti import providers

        # Should have same number of exports as EXPECTED_EXPORTS list
        assert len(providers.__all__) == len(EXPECTED_EXPORTS)


# =============================================================================
# Tests for module docstring and metadata
# =============================================================================


class TestModuleMetadata:
    """Test module has proper documentation."""

    def test_module_has_docstring(self):
        """Test module has docstring."""
        import integrations.graphiti.providers

        assert integrations.graphiti.providers.__doc__ is not None
        assert len(integrations.graphiti.providers.__doc__) > 0


# =============================================================================
# Tests for re-export behavior
# =============================================================================


class TestReExportBehavior:
    """Test that re-exports work correctly."""

    def test_ProviderError_is_exception(self):
        """Test ProviderError can be raised and caught."""
        from integrations.graphiti.providers import ProviderError

        with pytest.raises(ProviderError):
            raise ProviderError("Test error")

    def test_ProviderNotInstalled_is_exception(self):
        """Test ProviderNotInstalled can be raised and caught."""
        from integrations.graphiti.providers import ProviderNotInstalled

        with pytest.raises(ProviderNotInstalled):
            raise ProviderNotInstalled("Test error")

    def test_ProviderNotInstalled_subclass_of_ProviderError(self):
        """Test ProviderNotInstalled is a subclass of ProviderError."""
        from integrations.graphiti.providers import ProviderError, ProviderNotInstalled

        assert issubclass(ProviderNotInstalled, ProviderError)

    def test_EMBEDDING_DIMENSIONS_has_expected_keys(self):
        """Test EMBEDDING_DIMENSIONS has expected model keys."""
        from integrations.graphiti.providers import EMBEDDING_DIMENSIONS

        # Check that expected model names exist in EMBEDDING_DIMENSIONS
        # Note: EMBEDDING_DIMENSIONS is keyed by model name, not provider name
        expected_models = [
            "text-embedding-3-small",  # OpenAI
            "voyage-3",  # Voyage AI
            "nomic-embed-text",  # Ollama
            "all-minilm",  # Ollama
        ]

        for model in expected_models:
            assert model in EMBEDDING_DIMENSIONS, f"{model} not in EMBEDDING_DIMENSIONS"
            assert isinstance(EMBEDDING_DIMENSIONS[model], int)


# =============================================================================
# Tests for namespace integrity
# =============================================================================


class TestNamespaceIntegrity:
    """Test module namespace remains consistent."""

    def test_exports_are_accessible(self):
        """Test all exports in __all__ are accessible."""
        from integrations.graphiti import providers

        for name in providers.__all__:
            # Each export should be accessible
            assert hasattr(providers, name), f"{name} not accessible"

    def test_import_from_module_works(self):
        """Test 'from' imports work correctly."""
        # This tests the re-export mechanism
        from integrations.graphiti.providers import (
            ProviderError,
            create_embedder,
            create_llm_client,
        )

        assert ProviderError is not None
        assert create_llm_client is not None
        assert create_embedder is not None

    def test_module_level_import_works(self):
        """Test module-level import works."""
        import integrations.graphiti.providers as providers

        assert providers.ProviderError is not None
        assert providers.create_llm_client is not None
        assert providers.create_embedder is not None
