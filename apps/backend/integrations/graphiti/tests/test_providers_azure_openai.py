"""
Unit tests for Azure OpenAI embedder provider.

Tests cover:
- create_azure_openai_embedder factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.embedder_providers.azure_openai_embedder import (
    create_azure_openai_embedder,
)
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)

# =============================================================================
# Test create_azure_openai_embedder
# =============================================================================


class TestCreateAzureOpenAIEmbedder:
    """Test create_azure_openai_embedder factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.azure_openai_api_key = "test-azure-key"
        config.azure_openai_base_url = "https://test.openai.azure.com"
        config.azure_openai_embedding_deployment = "test-embedding-deployment"
        return config

    @pytest.mark.slow
    def test_create_azure_openai_embedder_success(self, mock_config):
        """Test create_azure_openai_embedder returns embedder with valid config."""
        mock_azure_client = MagicMock()
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.azure_openai_embedder.AsyncOpenAI",
            return_value=mock_azure_client,
        ):
            with patch(
                "graphiti_core.embedder.azure_openai.AzureOpenAIEmbedderClient",
                return_value=mock_embedder,
            ):
                result = create_azure_openai_embedder(mock_config)
                assert result == mock_embedder

    def test_create_azure_openai_embedder_success_fast(self, mock_config):
        """Fast test for create_azure_openai_embedder success path."""
        mock_embedder = MagicMock()

        # Mock the graphiti_core imports
        with patch.dict(
            "sys.modules",
            {
                "graphiti_core": MagicMock(),
                "graphiti_core.embedder": MagicMock(),
                "graphiti_core.embedder.azure_openai": MagicMock(),
            },
        ):
            from graphiti_core.embedder.azure_openai import AzureOpenAIEmbedderClient

            AzureOpenAIEmbedderClient.return_value = mock_embedder

            result = create_azure_openai_embedder(mock_config)

            # Verify the embedder was created and returned
            AzureOpenAIEmbedderClient.assert_called_once()
            assert result == mock_embedder

    def test_create_azure_openai_embedder_missing_api_key(self, mock_config):
        """Test create_azure_openai_embedder raises ProviderError for missing API key."""
        mock_config.azure_openai_api_key = None

        with pytest.raises(ProviderError) as exc_info:
            create_azure_openai_embedder(mock_config)

        assert "AZURE_OPENAI_API_KEY" in str(exc_info.value)

    def test_create_azure_openai_embedder_missing_base_url(self, mock_config):
        """Test create_azure_openai_embedder raises ProviderError for missing base URL."""
        mock_config.azure_openai_base_url = None

        with pytest.raises(ProviderError) as exc_info:
            create_azure_openai_embedder(mock_config)

        assert "AZURE_OPENAI_BASE_URL" in str(exc_info.value)

    def test_create_azure_openai_embedder_missing_deployment(self, mock_config):
        """Test create_azure_openai_embedder raises ProviderError for missing deployment."""
        mock_config.azure_openai_embedding_deployment = None

        with pytest.raises(ProviderError) as exc_info:
            create_azure_openai_embedder(mock_config)

        assert "AZURE_OPENAI_EMBEDDING_DEPLOYMENT" in str(exc_info.value)

    def test_create_azure_openai_embedder_import_error(self, mock_config):
        """Test create_azure_openai_embedder raises ProviderNotInstalled on ImportError."""
        # Mock the import to raise ImportError
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "graphiti_core.embedder.azure_openai":
                raise ImportError("graphiti-core not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_azure_openai_embedder(mock_config)

            assert "graphiti-core" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_azure_openai_embedder_passes_config_correctly(self, mock_config):
        """Test create_azure_openai_embedder passes config values correctly."""
        mock_azure_client = MagicMock()
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.azure_openai_embedder.AsyncOpenAI",
            return_value=mock_azure_client,
        ) as mock_openai:
            with patch(
                "graphiti_core.embedder.azure_openai.AzureOpenAIEmbedderClient",
                return_value=mock_embedder,
            ) as mock_azure_embedder:
                create_azure_openai_embedder(mock_config)

                # Verify AsyncOpenAI was called with correct arguments
                mock_openai.assert_called_once_with(
                    base_url=mock_config.azure_openai_base_url,
                    api_key=mock_config.azure_openai_api_key,
                )

                # Verify AzureOpenAIEmbedderClient was called with correct arguments
                mock_azure_embedder.assert_called_once_with(
                    azure_client=mock_azure_client,
                    model=mock_config.azure_openai_embedding_deployment,
                )
