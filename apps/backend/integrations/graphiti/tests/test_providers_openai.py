"""
Unit tests for OpenAI embedder provider.

Tests cover:
- create_openai_embedder factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.embedder_providers.openai_embedder import (
    create_openai_embedder,
)
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)

# =============================================================================
# Test create_openai_embedder
# =============================================================================


class TestCreateOpenAIEmbedder:
    """Test create_openai_embedder factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.openai_api_key = "sk-test-key"
        config.openai_embedding_model = "text-embedding-3-small"
        return config

    @pytest.mark.slow
    def test_create_openai_embedder_success(self, mock_config):
        """Test create_openai_embedder returns embedder with valid config."""
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.openai_embedder.OpenAIEmbedder",
            return_value=mock_embedder,
        ):
            result = create_openai_embedder(mock_config)
            assert result == mock_embedder

    def test_create_openai_embedder_success_fast(self, mock_config):
        """Fast test for create_openai_embedder success path."""
        mock_embedder = MagicMock()

        # Mock the graphiti_core imports
        with patch.dict(
            "sys.modules",
            {
                "graphiti_core": MagicMock(),
                "graphiti_core.embedder": MagicMock(),
                "graphiti_core.embedder.openai": MagicMock(),
            },
        ):
            from graphiti_core.embedder.openai import OpenAIEmbedder

            OpenAIEmbedder.return_value = mock_embedder

            result = create_openai_embedder(mock_config)

            # Verify the embedder was created and returned
            OpenAIEmbedder.assert_called_once()
            assert result == mock_embedder

    def test_create_openai_embedder_missing_api_key(self, mock_config):
        """Test create_openai_embedder raises ProviderError for missing API key."""
        mock_config.openai_api_key = None

        with pytest.raises(ProviderError) as exc_info:
            create_openai_embedder(mock_config)

        assert "OPENAI_API_KEY" in str(exc_info.value)

    def test_create_openai_embedder_import_error(self, mock_config):
        """Test create_openai_embedder raises ProviderNotInstalled on ImportError."""
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name.startswith("graphiti_core.embedder"):
                raise ImportError("graphiti-core not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_openai_embedder(mock_config)

            assert "graphiti-core" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_openai_embedder_passes_config_correctly(self, mock_config):
        """Test create_openai_embedder passes config values correctly."""
        mock_config.openai_api_key = "sk-test-key-123"
        mock_config.openai_embedding_model = "text-embedding-3-large"
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.openai_embedder.OpenAIEmbedderConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.embedder_providers.openai_embedder.OpenAIEmbedder",
                return_value=mock_embedder,
            ):
                create_openai_embedder(mock_config)

                # Verify OpenAIEmbedderConfig was called with correct arguments
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["api_key"] == "sk-test-key-123"
                assert call_kwargs["embedding_model"] == "text-embedding-3-large"
