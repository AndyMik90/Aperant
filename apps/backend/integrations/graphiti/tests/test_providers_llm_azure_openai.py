"""
Unit tests for Azure OpenAI LLM provider.

Tests cover:
- create_azure_openai_llm_client factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)
from integrations.graphiti.providers_pkg.llm_providers.azure_openai_llm import (
    create_azure_openai_llm_client,
)

# =============================================================================
# Test create_azure_openai_llm_client
# =============================================================================


class TestCreateAzureOpenAILLMClient:
    """Test create_azure_openai_llm_client factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.azure_openai_api_key = "test-azure-key"
        config.azure_openai_base_url = "https://test.openai.azure.com"
        config.azure_openai_llm_deployment = "test-llm-deployment"
        return config

    @pytest.mark.slow
    def test_create_azure_openai_llm_client_success(self, mock_config):
        """Test create_azure_openai_llm_client returns client with valid config."""
        mock_azure_client = MagicMock()
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.azure_openai_llm.AsyncOpenAI",
            return_value=mock_azure_client,
        ):
            with patch(
                "graphiti_core.llm_client.azure_openai_client.AzureOpenAILLMClient",
                return_value=mock_client,
            ):
                result = create_azure_openai_llm_client(mock_config)
                assert result == mock_client

    def test_create_azure_openai_llm_client_success_fast(self, mock_config):
        """Fast test for create_azure_openai_llm_client success path."""
        mock_llm_client = MagicMock()

        # Mock the graphiti_core imports
        with patch.dict(
            "sys.modules",
            {
                "graphiti_core": MagicMock(),
                "graphiti_core.llm_client": MagicMock(),
                "graphiti_core.llm_client.azure_openai_client": MagicMock(),
                "graphiti_core.llm_client.config": MagicMock(),
            },
        ):
            from graphiti_core.llm_client.azure_openai_client import (
                AzureOpenAILLMClient,
            )

            AzureOpenAILLMClient.return_value = mock_llm_client

            result = create_azure_openai_llm_client(mock_config)

            # Verify the client was created and returned
            AzureOpenAILLMClient.assert_called_once()
            assert result == mock_llm_client

    def test_create_azure_openai_llm_client_missing_api_key(self, mock_config):
        """Test create_azure_openai_llm_client raises ProviderError for missing API key."""
        mock_config.azure_openai_api_key = None

        with pytest.raises(ProviderError) as exc_info:
            create_azure_openai_llm_client(mock_config)

        assert "AZURE_OPENAI_API_KEY" in str(exc_info.value)

    def test_create_azure_openai_llm_client_missing_base_url(self, mock_config):
        """Test create_azure_openai_llm_client raises ProviderError for missing base URL."""
        mock_config.azure_openai_base_url = None

        with pytest.raises(ProviderError) as exc_info:
            create_azure_openai_llm_client(mock_config)

        assert "AZURE_OPENAI_BASE_URL" in str(exc_info.value)

    def test_create_azure_openai_llm_client_missing_deployment(self, mock_config):
        """Test create_azure_openai_llm_client raises ProviderError for missing deployment."""
        mock_config.azure_openai_llm_deployment = None

        with pytest.raises(ProviderError) as exc_info:
            create_azure_openai_llm_client(mock_config)

        assert "AZURE_OPENAI_LLM_DEPLOYMENT" in str(exc_info.value)

    def test_create_azure_openai_llm_client_import_error(self, mock_config):
        """Test create_azure_openai_llm_client raises ProviderNotInstalled on ImportError."""
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if (
                name.startswith("graphiti_core.llm_client")
                or name == "openai"
                or name.startswith("openai.")
            ):
                raise ImportError("Required package not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_azure_openai_llm_client(mock_config)

            assert "graphiti-core" in str(exc_info.value)
            assert "openai" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_azure_openai_llm_client_passes_config_correctly(self, mock_config):
        """Test create_azure_openai_llm_client passes config values correctly."""
        mock_azure_client = MagicMock()
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.azure_openai_llm.AsyncOpenAI",
            return_value=mock_azure_client,
        ) as mock_openai:
            with patch(
                "integrations.graphiti.providers_pkg.llm_providers.azure_openai_llm.LLMConfig",
            ) as mock_config_class:
                with patch(
                    "graphiti_core.llm_client.azure_openai_client.AzureOpenAILLMClient",
                    return_value=mock_client,
                ):
                    create_azure_openai_llm_client(mock_config)

                    # Verify AsyncOpenAI was called with correct arguments
                    mock_openai.assert_called_once_with(
                        base_url=mock_config.azure_openai_base_url,
                        api_key=mock_config.azure_openai_api_key,
                    )

                    # Verify LLMConfig was called with correct arguments
                    call_kwargs = mock_config_class.call_args.kwargs
                    assert (
                        call_kwargs["model"] == mock_config.azure_openai_llm_deployment
                    )
                    assert (
                        call_kwargs["small_model"]
                        == mock_config.azure_openai_llm_deployment
                    )
