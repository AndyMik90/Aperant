"""
Tests for integrations.graphiti.providers module.

Tests cover:
- All re-exported items are accessible
- __all__ exports match documentation
- Module has proper docstring
"""

import pytest


class TestProvidersModuleReExports:
    """Test that all items are properly re-exported from graphiti_providers."""

    def test_import_provider_error(self):
        """Test ProviderError is re-exported."""
        from integrations.graphiti.providers import ProviderError

        assert ProviderError is not None
        assert Exception in ProviderError.__mro__

    def test_import_provider_not_installed(self):
        """Test ProviderNotInstalled is re-exported."""
        from integrations.graphiti.providers import ProviderNotInstalled

        assert ProviderNotInstalled is not None
        assert Exception in ProviderNotInstalled.__mro__

    def test_import_create_llm_client(self):
        """Test create_llm_client is re-exported."""
        from integrations.graphiti.providers import create_llm_client

        assert create_llm_client is not None
        assert callable(create_llm_client)

    def test_import_create_embedder(self):
        """Test create_embedder is re-exported."""
        from integrations.graphiti.providers import create_embedder

        assert create_embedder is not None
        assert callable(create_embedder)

    def test_import_create_cross_encoder(self):
        """Test create_cross_encoder is re-exported."""
        from integrations.graphiti.providers import create_cross_encoder

        assert create_cross_encoder is not None
        assert callable(create_cross_encoder)

    def test_import_embedding_dimensions(self):
        """Test EMBEDDING_DIMENSIONS is re-exported."""
        from integrations.graphiti.providers import EMBEDDING_DIMENSIONS

        assert EMBEDDING_DIMENSIONS is not None
        assert isinstance(EMBEDDING_DIMENSIONS, dict)

    def test_import_get_expected_embedding_dim(self):
        """Test get_expected_embedding_dim is re-exported."""
        from integrations.graphiti.providers import get_expected_embedding_dim

        assert get_expected_embedding_dim is not None
        assert callable(get_expected_embedding_dim)

    def test_import_validate_embedding_config(self):
        """Test validate_embedding_config is re-exported."""
        from integrations.graphiti.providers import validate_embedding_config

        assert validate_embedding_config is not None
        assert callable(validate_embedding_config)

    def test_import_test_llm_connection(self):
        """Test test_llm_connection is re-exported."""
        from integrations.graphiti.providers import test_llm_connection

        assert test_llm_connection is not None
        assert callable(test_llm_connection)

    def test_import_test_embedder_connection(self):
        """Test test_embedder_connection is re-exported."""
        from integrations.graphiti.providers import test_embedder_connection

        assert test_embedder_connection is not None
        assert callable(test_embedder_connection)

    def test_import_test_ollama_connection(self):
        """Test test_ollama_connection is re-exported."""
        from integrations.graphiti.providers import test_ollama_connection

        assert test_ollama_connection is not None
        assert callable(test_ollama_connection)

    def test_import_is_graphiti_enabled(self):
        """Test is_graphiti_enabled is re-exported."""
        from integrations.graphiti.providers import is_graphiti_enabled

        assert is_graphiti_enabled is not None
        assert callable(is_graphiti_enabled)

    def test_import_get_graph_hints(self):
        """Test get_graph_hints is re-exported."""
        from integrations.graphiti.providers import get_graph_hints

        assert get_graph_hints is not None
        assert callable(get_graph_hints)


class TestProvidersModuleAll:
    """Test __all__ exports match documented exports."""

    def test___all___contains_all_exports(self):
        """Test __all__ contains all expected exports."""
        import integrations.graphiti.providers as providers_module

        expected_all = [
            # Exceptions
            "ProviderError",
            "ProviderNotInstalled",
            # Factory functions
            "create_llm_client",
            "create_embedder",
            "create_cross_encoder",
            # Models
            "EMBEDDING_DIMENSIONS",
            "get_expected_embedding_dim",
            # Validators
            "validate_embedding_config",
            "test_llm_connection",
            "test_embedder_connection",
            "test_ollama_connection",
            # Utilities
            "is_graphiti_enabled",
            "get_graph_hints",
        ]

        assert providers_module.__all__ == expected_all

    def test_import_star_includes_all_exports(self):
        """Test 'from integrations.graphiti.providers import *' works."""
        namespace = {}
        exec("from integrations.graphiti.providers import *", namespace)

        # Verify all __all__ items are in the namespace
        import integrations.graphiti.providers as providers_module

        for item in providers_module.__all__:
            assert item in namespace, f"{item} not found in namespace"

    def test_all_exports_are_accessible(self):
        """Test all items in __all__ are accessible."""
        import integrations.graphiti.providers as providers_module

        for item in providers_module.__all__:
            assert hasattr(providers_module, item), f"{item} not accessible"


class TestProvidersModuleDocumentation:
    """Test module documentation."""

    def test_module_has_docstring(self):
        """Test the module has a docstring."""
        import integrations.graphiti.providers as providers_module

        assert providers_module.__doc__ is not None
        assert len(providers_module.__doc__) > 0

    def test_docstring_contains_key_terms(self):
        """Test the docstring contains key terms."""
        import integrations.graphiti.providers as providers_module

        docstring = providers_module.__doc__.lower()
        assert "provider" in docstring
        assert "graphiti" in docstring


class TestProvidersModuleReExportBehavior:
    """Test re-export behavior matches the source module."""

    def test_create_llm_client_matches_source(self):
        """Test create_llm_client is the same as the source."""
        from graphiti_providers import create_llm_client as source
        from integrations.graphiti.providers import create_llm_client as re_export

        assert re_export is source

    def test_create_embedder_matches_source(self):
        """Test create_embedder is the same as the source."""
        from graphiti_providers import create_embedder as source
        from integrations.graphiti.providers import create_embedder as re_export

        assert re_export is source

    def test_exceptions_match_source(self):
        """Test exceptions are the same as the source."""
        from graphiti_providers import ProviderError as source_error
        from graphiti_providers import ProviderNotInstalled as source_not_installed
        from integrations.graphiti.providers import (
            ProviderError as re_export_error,
        )
        from integrations.graphiti.providers import (
            ProviderNotInstalled as re_export_not_installed,
        )

        assert re_export_error is source_error
        assert re_export_not_installed is source_not_installed

    def test_embedding_dimensions_matches_source(self):
        """Test EMBEDDING_DIMENSIONS is the same as the source."""
        from graphiti_providers import EMBEDDING_DIMENSIONS as source
        from integrations.graphiti.providers import EMBEDDING_DIMENSIONS as re_export

        assert re_export is source


class TestProvidersModuleIntegration:
    """Integration tests for the providers module."""

    def test_module_can_be_imported_multiple_times(self):
        """Test the module can be imported multiple times without issues."""
        import importlib

        import integrations.graphiti.providers

        importlib.reload(integrations.graphiti.providers)

        # Should still work
        from integrations.graphiti.providers import create_llm_client

        assert create_llm_client is not None

    def test_concurrent_imports(self):
        """Test concurrent imports don't cause issues."""
        import concurrent.futures

        def import_module():
            from integrations.graphiti.providers import create_llm_client

            return create_llm_client

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            futures = [executor.submit(import_module) for _ in range(5)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        # All should succeed
        assert len(results) == 5
        assert all(r is not None for r in results)
