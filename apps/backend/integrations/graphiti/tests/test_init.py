"""
Tests for integrations.graphiti.__init__ module.

Tests cover:
- __getattr__ lazy import functionality
- Direct imports (GraphitiConfig, validate_graphiti_config)
- Invalid attribute access raises AttributeError
"""

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestInitModuleDirectImports:
    """Test direct imports that don't require lazy loading."""

    def test_import_graphiti_config_directly(self):
        """Test GraphitiConfig can be imported directly."""
        from integrations.graphiti import GraphitiConfig

        assert GraphitiConfig is not None

    def test_import_validate_graphiti_config_directly(self):
        """Test validate_graphiti_config can be imported directly."""
        from integrations.graphiti import validate_graphiti_config

        assert validate_graphiti_config is not None

    def test___all___exports(self):
        """Test __all__ contains expected exports."""
        import integrations.graphiti as graphiti_module

        expected_all = [
            "GraphitiConfig",
            "validate_graphiti_config",
            "GraphitiMemory",
            "create_llm_client",
            "create_embedder",
        ]
        assert graphiti_module.__all__ == expected_all


class TestInitModuleLazyImports:
    """Test __getattr__ lazy import functionality."""

    @pytest.fixture
    def mock_memory_module(self):
        """Mock the memory module."""
        memory_mock = MagicMock()
        memory_mock.GraphitiMemory = MagicMock
        return memory_mock

    @pytest.fixture
    def mock_providers_module(self):
        """Mock the providers module."""
        providers_mock = MagicMock()
        providers_mock.create_llm_client = MagicMock(return_value=AsyncMock())
        providers_mock.create_embedder = MagicMock(return_value=AsyncMock())
        return providers_mock

    def test_getattr_graphiti_memory_lazy_import(self, mock_memory_module):
        """Test accessing GraphitiMemory triggers lazy import."""
        import integrations.graphiti as graphiti_module

        with patch.dict(
            "sys.modules",
            {
                "integrations.graphiti.memory": mock_memory_module,
            },
        ):
            # Access the attribute via __getattr__
            result = graphiti_module.__getattr__("GraphitiMemory")

            assert result == mock_memory_module.GraphitiMemory

    def test_getattr_create_llm_client_lazy_import(self, mock_providers_module):
        """Test accessing create_llm_client triggers lazy import."""
        import integrations.graphiti as graphiti_module

        with patch.dict(
            "sys.modules",
            {
                "integrations.graphiti.providers": mock_providers_module,
            },
        ):
            result = graphiti_module.__getattr__("create_llm_client")

            assert result == mock_providers_module.create_llm_client

    def test_getattr_create_embedder_lazy_import(self, mock_providers_module):
        """Test accessing create_embedder triggers lazy import."""
        import integrations.graphiti as graphiti_module

        with patch.dict(
            "sys.modules",
            {
                "integrations.graphiti.providers": mock_providers_module,
            },
        ):
            result = graphiti_module.__getattr__("create_embedder")

            assert result == mock_providers_module.create_embedder

    def test_getattr_invalid_attribute_raises_attribute_error(self):
        """Test accessing invalid attribute raises AttributeError."""
        import integrations.graphiti as graphiti_module

        with pytest.raises(AttributeError) as exc_info:
            graphiti_module.__getattr__("NonExistentAttribute")

        assert "has no attribute" in str(exc_info.value)
        assert "NonExistentAttribute" in str(exc_info.value)

    def test_getattr_empty_string_attribute(self):
        """Test accessing empty string attribute raises AttributeError."""
        import integrations.graphiti as graphiti_module

        with pytest.raises(AttributeError):
            graphiti_module.__getattr__("")

    def test_getattr_case_sensitive(self):
        """Test that __getattr__ is case-sensitive."""
        import integrations.graphiti as graphiti_module

        # lowercase should fail
        with pytest.raises(AttributeError):
            graphiti_module.__getattr__("graphitimemory")

        # mixed case should fail
        with pytest.raises(AttributeError):
            graphiti_module.__getattr__("Graphiti_Memory")


class TestInitModuleAccessPatterns:
    """Test various access patterns for the init module."""

    def test_hasattr_on_graphiti_memory(self):
        """Test hasattr works correctly with lazy imports."""
        import integrations.graphiti as graphiti_module

        # Mock the import
        with patch.dict(
            "sys.modules",
            {
                "integrations.graphiti.memory": MagicMock(GraphitiMemory=MagicMock),
            },
        ):
            # hasattr should call __getattr__ and not raise
            result = hasattr(graphiti_module, "GraphitiMemory")
            assert result is True

    def test_hasattr_on_invalid_attribute(self):
        """Test hasattr returns False for invalid attributes."""
        import integrations.graphiti as graphiti_module

        result = hasattr(graphiti_module, "InvalidAttribute")
        assert result is False

    def test_getattr_on_existing_direct_import(self):
        """Test __getattr__ is not called for direct imports."""
        import integrations.graphiti as graphiti_module

        # GraphitiConfig is imported directly, so __getattr__ shouldn't be called
        # This tests that the normal import mechanism works
        assert hasattr(graphiti_module, "GraphitiConfig")

    def test_module_docstring(self):
        """Test the module has a docstring."""
        import integrations.graphiti as graphiti_module

        assert graphiti_module.__doc__ is not None
        assert "Graphiti" in graphiti_module.__doc__


class TestInitModuleIntegration:
    """Integration tests for the init module."""

    def test_import_star(self):
        """Test 'from integrations.graphiti import *' includes direct imports."""
        # Create a new namespace for the import
        namespace = {}
        exec("from integrations.graphiti import *", namespace)

        # Direct imports should be available
        assert "GraphitiConfig" in namespace
        assert "validate_graphiti_config" in namespace

    def test_reimport_does_not_fail(self):
        """Test that re-importing the module doesn't cause issues."""
        import importlib

        import integrations.graphiti

        # Reload the module
        importlib.reload(integrations.graphiti)

        # Should still work
        assert hasattr(integrations.graphiti, "GraphitiConfig")

    @pytest.mark.slow
    def test_concurrent_attribute_access(self):
        """Test that concurrent attribute access doesn't cause issues."""
        import concurrent.futures

        import integrations.graphiti as graphiti_module

        # Mock the imports
        with patch.dict(
            "sys.modules",
            {
                "integrations.graphiti.memory": MagicMock(GraphitiMemory=MagicMock),
                "integrations.graphiti.providers": MagicMock(
                    create_llm_client=MagicMock(return_value=AsyncMock()),
                    create_embedder=MagicMock(return_value=AsyncMock()),
                ),
            },
        ):

            def access_attribute(attr_name):
                try:
                    return getattr(graphiti_module, attr_name)
                except AttributeError:
                    return None

            # Access multiple attributes concurrently
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                futures = [
                    executor.submit(access_attribute, "GraphitiMemory"),
                    executor.submit(access_attribute, "create_llm_client"),
                    executor.submit(access_attribute, "create_embedder"),
                ]
                results = [f.result() for f in concurrent.futures.as_completed(futures)]

            # All should succeed
            assert len(results) == 3
            assert all(r is not None for r in results)
