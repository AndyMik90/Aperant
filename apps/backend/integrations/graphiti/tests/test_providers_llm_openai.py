"""
Unit tests for OpenAI LLM provider.

Tests cover:
- create_openai_llm_client factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)
from integrations.graphiti.providers_pkg.llm_providers.openai_llm import (
    create_openai_llm_client,
)

# =============================================================================
# Test create_openai_llm_client
# =============================================================================


class TestCreateOpenAILLMClient:
    """Test create_openai_llm_client factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.openai_api_key = "sk-test-key"
        config.openai_model = "gpt-4o"
        return config

    @pytest.mark.slow
    def test_create_openai_llm_client_success(self, mock_config):
        """Test create_openai_llm_client returns client with valid config."""
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.openai_llm.OpenAIClient",
            return_value=mock_client,
        ):
            result = create_openai_llm_client(mock_config)
            assert result == mock_client

    def test_create_openai_llm_client_missing_api_key(self, mock_config):
        """Test create_openai_llm_client raises ProviderError for missing API key."""
        mock_config.openai_api_key = None

        with pytest.raises(ProviderError) as exc_info:
            create_openai_llm_client(mock_config)

        assert "OPENAI_API_KEY" in str(exc_info.value)

    def test_create_openai_llm_client_import_error(self, mock_config):
        """Test create_openai_llm_client raises ProviderNotInstalled on ImportError."""
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name.startswith("graphiti_core.llm_client"):
                raise ImportError("graphiti-core not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_openai_llm_client(mock_config)

            assert "graphiti-core" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_openai_llm_client_gpt5_model_with_reasoning(self, mock_config):
        """Test create_openai_llm_client with GPT-5 model supports reasoning."""
        mock_config.openai_model = "gpt-5-turbo"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.openai_llm.OpenAIClient",
            return_value=mock_client,
        ) as mock_openai_client:
            create_openai_llm_client(mock_config)

            # GPT-5 models should be created with default reasoning/verbosity
            mock_openai_client.assert_called_once()

    @pytest.mark.slow
    def test_create_openai_llm_client_o1_model_with_reasoning(self, mock_config):
        """Test create_openai_llm_client with o1 model supports reasoning."""
        mock_config.openai_model = "o1-preview"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.openai_llm.OpenAIClient",
            return_value=mock_client,
        ) as mock_openai_client:
            create_openai_llm_client(mock_config)

            # o1 models should be created with default reasoning/verbosity
            mock_openai_client.assert_called_once()

    @pytest.mark.slow
    def test_create_openai_llm_client_o3_model_with_reasoning(self, mock_config):
        """Test create_openai_llm_client with o3 model supports reasoning."""
        mock_config.openai_model = "o3-mini"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.openai_llm.OpenAIClient",
            return_value=mock_client,
        ) as mock_openai_client:
            create_openai_llm_client(mock_config)

            # o3 models should be created with default reasoning/verbosity
            mock_openai_client.assert_called_once()

    @pytest.mark.slow
    def test_create_openai_llm_client_gpt4_model_without_reasoning(self, mock_config):
        """Test create_openai_llm_client with GPT-4 model disables reasoning."""
        mock_config.openai_model = "gpt-4o"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.openai_llm.OpenAIClient",
            return_value=mock_client,
        ) as mock_openai_client:
            create_openai_llm_client(mock_config)

            # GPT-4 models should be created with reasoning=None, verbosity=None
            call_kwargs = mock_openai_client.call_args.kwargs
            assert call_kwargs.get("reasoning") is None
            assert call_kwargs.get("verbosity") is None

    @pytest.mark.slow
    def test_create_openai_llm_client_passes_config_correctly(self, mock_config):
        """Test create_openai_llm_client passes config values correctly."""
        mock_config.openai_api_key = "sk-test-key-123"
        mock_config.openai_model = "gpt-4o-mini"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.openai_llm.LLMConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.llm_providers.openai_llm.OpenAIClient",
                return_value=mock_client,
            ):
                create_openai_llm_client(mock_config)

                # Verify LLMConfig was called with correct arguments
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["api_key"] == "sk-test-key-123"
                assert call_kwargs["model"] == "gpt-4o-mini"
