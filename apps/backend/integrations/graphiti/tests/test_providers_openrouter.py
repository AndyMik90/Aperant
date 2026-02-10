"""
Unit tests for OpenRouter embedder provider.

Tests cover:
- create_openrouter_embedder factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

import sys
from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.embedder_providers.openrouter_embedder import (
    create_openrouter_embedder,
)
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)

# =============================================================================
# Test create_openrouter_embedder
# =============================================================================


class TestCreateOpenRouterEmbedder:
    """Test create_openrouter_embedder factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.openrouter_api_key = "sk-or-test-key"
        config.openrouter_embedding_model = "openai/text-embedding-3-small"
        config.openrouter_base_url = "https://openrouter.ai/api/v1"
        return config

    @pytest.mark.slow
    def test_create_openrouter_embedder_success(self, mock_config):
        """Test create_openrouter_embedder returns embedder with valid config."""
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.openrouter_embedder.OpenAIEmbedder",
            return_value=mock_embedder,
        ):
            result = create_openrouter_embedder(mock_config)
            assert result == mock_embedder

    def test_create_openrouter_embedder_success_fast(self, mock_config):
        """Fast test for create_openrouter_embedder success path."""
        mock_embedder = MagicMock()

        # Mock the graphiti_core imports
        with patch.dict(
            "sys.modules",
            {
                "graphiti_core": MagicMock(),
                "graphiti_core.embedder": MagicMock(),
            },
        ):
            from graphiti_core.embedder import OpenAIEmbedder

            OpenAIEmbedder.return_value = mock_embedder

            result = create_openrouter_embedder(mock_config)

            # Verify the embedder was created and returned
            OpenAIEmbedder.assert_called_once()
            assert result == mock_embedder

    def test_create_openrouter_embedder_missing_api_key(self, mock_config):
        """Test create_openrouter_embedder raises ProviderError for missing API key."""

        mock_graphiti_core_embedder = MagicMock()
        mock_graphiti_core_embedder.EmbedderConfig = MagicMock
        mock_graphiti_core_embedder.OpenAIEmbedder = MagicMock

        # Mock the graphiti_core.embedder module to allow import to succeed
        with patch.dict(
            sys.modules, {"graphiti_core.embedder": mock_graphiti_core_embedder}
        ):
            mock_config.openrouter_api_key = None

            with pytest.raises(ProviderError) as exc_info:
                create_openrouter_embedder(mock_config)

            assert "OPENROUTER_API_KEY" in str(exc_info.value)

    def test_create_openrouter_embedder_import_error(self, mock_config):
        """Test create_openrouter_embedder raises ProviderNotInstalled on ImportError."""
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name.startswith("graphiti_core.embedder"):
                raise ImportError("graphiti-core not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_openrouter_embedder(mock_config)

            assert "graphiti-core" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_openrouter_embedder_passes_config_correctly(self, mock_config):
        """Test create_openrouter_embedder passes config values correctly."""
        mock_config.openrouter_api_key = "sk-or-test-key-123"
        mock_config.openrouter_embedding_model = "voyage/voyage-3"
        mock_config.openrouter_base_url = "https://custom.openrouter.ai/api/v1"
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.openrouter_embedder.EmbedderConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.embedder_providers.openrouter_embedder.OpenAIEmbedder",
                return_value=mock_embedder,
            ):
                create_openrouter_embedder(mock_config)

                # Verify EmbedderConfig was called with correct arguments
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["api_key"] == "sk-or-test-key-123"
                assert call_kwargs["model"] == "voyage/voyage-3"
                assert call_kwargs["base_url"] == "https://custom.openrouter.ai/api/v1"
