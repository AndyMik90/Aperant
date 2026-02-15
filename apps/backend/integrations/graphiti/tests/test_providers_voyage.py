"""
Unit tests for Voyage AI embedder provider.

Tests cover:
- create_voyage_embedder factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

import sys
from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.embedder_providers.voyage_embedder import (
    create_voyage_embedder,
)
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)

# =============================================================================
# Test create_voyage_embedder
# =============================================================================


class TestCreateVoyageEmbedder:
    """Test create_voyage_embedder factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.voyage_api_key = "test-voyage-key"
        config.voyage_embedding_model = "voyage-3"
        return config

    @pytest.mark.slow
    def test_create_voyage_embedder_success(self, mock_config):
        """Test create_voyage_embedder returns embedder with valid config."""
        mock_embedder = MagicMock()

        with patch(
            "graphiti_core.embedder.voyage.VoyageEmbedder",
            return_value=mock_embedder,
        ):
            result = create_voyage_embedder(mock_config)
            assert result == mock_embedder

    def test_create_voyage_embedder_success_fast(self, mock_config):
        """Fast test for create_voyage_embedder success path."""
        mock_embedder = MagicMock()

        # Mock the graphiti_core imports
        with patch.dict(
            "sys.modules",
            {
                "graphiti_core": MagicMock(),
                "graphiti_core.embedder": MagicMock(),
                "graphiti_core.embedder.voyage": MagicMock(),
            },
        ):
            from graphiti_core.embedder.voyage import VoyageEmbedder

            VoyageEmbedder.return_value = mock_embedder

            result = create_voyage_embedder(mock_config)

            # Verify the embedder was created and returned
            VoyageEmbedder.assert_called_once()
            assert result == mock_embedder

    def test_create_voyage_embedder_missing_api_key(self, mock_config):
        """Test create_voyage_embedder raises ProviderError for missing API key."""

        mock_voyage = MagicMock()
        mock_voyage.VoyageAIConfig = MagicMock()
        mock_voyage.VoyageEmbedder = MagicMock()

        # Clear sys.modules cache to ensure fresh import
        sys.modules.pop("graphiti_core.embedder.voyage", None)

        # Mock the voyage module to allow import to succeed
        with patch.dict(sys.modules, {"graphiti_core.embedder.voyage": mock_voyage}):
            mock_config.voyage_api_key = None

            with pytest.raises(ProviderError) as exc_info:
                create_voyage_embedder(mock_config)

            assert "VOYAGE_API_KEY" in str(exc_info.value)

    def test_create_voyage_embedder_import_error(self, mock_config):
        """Test create_voyage_embedder raises ProviderNotInstalled on ImportError."""
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name.startswith("graphiti_core.embedder.voyage"):
                raise ImportError("graphiti-core[voyage] not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_voyage_embedder(mock_config)

            assert "graphiti-core[voyage]" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_voyage_embedder_passes_config_correctly(self, mock_config):
        """Test create_voyage_embedder passes config values correctly."""
        mock_config.voyage_api_key = "test-voyage-key-123"
        mock_config.voyage_embedding_model = "voyage-3-lite"
        mock_embedder = MagicMock()

        with patch(
            "graphiti_core.embedder.voyage.VoyageAIConfig",
        ) as mock_config_class:
            with patch(
                "graphiti_core.embedder.voyage.VoyageEmbedder",
                return_value=mock_embedder,
            ):
                create_voyage_embedder(mock_config)

                # Verify VoyageAIConfig was called with correct arguments
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["api_key"] == "test-voyage-key-123"
                assert call_kwargs["embedding_model"] == "voyage-3-lite"
