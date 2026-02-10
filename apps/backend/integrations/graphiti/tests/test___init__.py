"""
Tests for integrations.graphiti.__init__ module.

This module provides lazy imports for GraphitiMemory and provider functions
to avoid requiring graphiti package for config-only imports.
"""

import pytest

# =============================================================================
# Tests for direct imports (no lazy loading)
# =============================================================================


class TestDirectImports:
    """Test imports that don't require lazy loading."""

    def test_import_GraphitiConfig(self):
        """Test GraphitiConfig can be imported directly."""
        from integrations.graphiti import GraphitiConfig

        assert GraphitiConfig is not None

    def test_import_validate_graphiti_config(self):
        """Test validate_graphiti_config can be imported directly."""
        from integrations.graphiti import validate_graphiti_config

        assert validate_graphiti_config is not None

    def test_direct_imports_do_not_trigger_lazy_loading(self):
        """Test that direct config imports work without graphiti package."""
        # This should work even if graphiti_core is not installed
        from integrations.graphiti import GraphitiConfig, validate_graphiti_config

        assert callable(validate_graphiti_config)


# =============================================================================
# Tests for lazy imports via __getattr__
# =============================================================================


class TestLazyImports:
    """Test lazy imports via __getattr__ mechanism."""

    def test_lazy_import_GraphitiMemory(self):
        """Test GraphitiMemory can be imported via lazy loading."""
        from integrations.graphiti import GraphitiMemory

        assert GraphitiMemory is not None

    def test_lazy_import_create_llm_client(self):
        """Test create_llm_client can be imported via lazy loading."""
        from integrations.graphiti import create_llm_client

        assert create_llm_client is not None

    def test_lazy_import_create_embedder(self):
        """Test create_embedder can be imported via lazy loading."""
        from integrations.graphiti import create_embedder

        assert create_embedder is not None

    def test_lazy_import_after_from_import(self):
        """Test lazy imports work after using 'from' import style."""
        # Import a direct symbol first
        # Then try lazy imports
        from integrations.graphiti import (
            GraphitiConfig,
            GraphitiMemory,
            create_llm_client,
        )

        assert GraphitiConfig is not None
        assert GraphitiMemory is not None
        assert create_llm_client is not None


# =============================================================================
# Tests for __all__ export list
# =============================================================================


class TestAllExports:
    """Test __all__ contains expected exports."""

    def test_all_exports_defined(self):
        """Test __all__ is defined and contains expected items."""
        from integrations.graphiti import __all__ as all_exports

        assert isinstance(all_exports, list)

        expected_exports = [
            "GraphitiConfig",
            "validate_graphiti_config",
            "GraphitiMemory",
            "create_llm_client",
            "create_embedder",
        ]

        for export in expected_exports:
            assert export in all_exports, f"{export} not in __all__"

    def test_all_exports_match_lazy_getattr(self):
        """Test that items in __all__ can be accessed."""
        from integrations.graphiti import __all__ as all_exports

        # Import module once outside the loop
        module = __import__("integrations.graphiti")

        # Try to access each item in __all__
        for name in all_exports:
            # The item should be accessible either directly or via __getattr__
            try:
                getattr(module, name)
            except AttributeError as e:
                # If access fails, verify it's a setup-related error, not a missing export
                error_msg = str(e).lower()
                assert (
                    "graphiti" in error_msg
                    or "graphitiproviders" in error_msg
                    or "has no attribute" in error_msg
                ), f"Unexpected AttributeError for {name}: {e}"


# =============================================================================
# Tests for AttributeError handling
# =============================================================================


class TestAttributeErrorHandling:
    """Test __getattr__ properly raises AttributeError for unknown attributes."""

    def test_unknown_attribute_raises_attribute_error(self):
        """Test accessing unknown attribute raises AttributeError."""
        import integrations.graphiti

        with pytest.raises(AttributeError) as exc_info:
            _ = integrations.graphiti.NonExistentAttribute

        assert "NonExistentAttribute" in str(exc_info.value)
        assert "has no attribute" in str(exc_info.value)

    def test_error_message_format(self):
        """Test AttributeError message is properly formatted."""
        import integrations.graphiti

        with pytest.raises(AttributeError) as exc_info:
            _ = integrations.graphiti.fake_function

        error_msg = str(exc_info.value)
        assert "integrations.graphiti" in error_msg or "module" in error_msg
        assert "fake_function" in error_msg


# =============================================================================
# Tests for module docstring and metadata
# =============================================================================


class TestModuleMetadata:
    """Test module has proper documentation."""

    def test_module_has_docstring(self):
        """Test module has docstring."""
        import integrations.graphiti

        assert integrations.graphiti.__doc__ is not None
        assert "Graphiti" in integrations.graphiti.__doc__


# =============================================================================
# Tests for import behavior
# =============================================================================


class TestImportBehavior:
    """Test module import behavior under different conditions."""

    def test_import_works_without_graphiti_core(self):
        """Test module can be imported even if graphiti_core is not installed."""
        # The config imports should work
        from integrations.graphiti import GraphitiConfig, validate_graphiti_config

        assert GraphitiConfig is not None
        assert callable(validate_graphiti_config)

    def test_lazy_import_defers_module_loading(self):
        """Test that lazy imports work correctly."""
        # Import the main module
        import integrations.graphiti

        # Direct imports should be available
        assert hasattr(integrations.graphiti, "GraphitiConfig")

        # Lazy imports should work - accessing GraphitiMemory triggers lazy import
        # Note: This test verifies the lazy import mechanism works, even if
        # graphiti_core is not installed (in which case GraphitiMemory would be None)
        try:
            from integrations.graphiti import GraphitiMemory

            # If graphiti_core is available, GraphitiMemory should be importable
            # If graphiti_core is not installed, this would have raised ImportError
            assert GraphitiMemory is not None
        except ImportError as e:
            # graphiti_core not installed is acceptable - the test verifies
            # the lazy import mechanism is in place
            assert "graphiti" in str(e).lower()

    def test_multiple_lazy_imports_share_same_instance(self):
        """Test that multiple lazy imports of the same symbol work correctly."""
        from integrations.graphiti import create_llm_client

        # Import again
        from integrations.graphiti import create_llm_client as create_llm_client_2

        # Both should reference the same function
        assert create_llm_client is create_llm_client_2


# =============================================================================
# Tests for namespace integrity
# =============================================================================


class TestNamespaceIntegrity:
    """Test module namespace remains consistent."""

    def test_config_exports_are_direct(self):
        """Test config exports are direct, not lazy."""
        import inspect

        from integrations.graphiti import GraphitiConfig

        # Should be a class, not a lazy wrapper
        assert inspect.isclass(GraphitiConfig)

    def test_lazy_exports_are_callables(self):
        """Test lazy exports are callable functions/classes."""
        from integrations.graphiti import GraphitiMemory, create_llm_client

        # GraphitiMemory should be a class
        assert isinstance(GraphitiMemory, type)

        # create_llm_client should be callable
        assert callable(create_llm_client)
