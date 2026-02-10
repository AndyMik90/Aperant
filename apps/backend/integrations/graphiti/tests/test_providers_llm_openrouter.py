"""
Unit tests for OpenRouter LLM provider.

Tests cover:
- create_openrouter_llm_client factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)
from integrations.graphiti.providers_pkg.llm_providers.openrouter_llm import (
    create_openrouter_llm_client,
)

# =============================================================================
# Test create_openrouter_llm_client
# =============================================================================


class TestCreateOpenRouterLLMClient:
    """Test create_openrouter_llm_client factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.openrouter_api_key = "sk-or-test-key"
        config.openrouter_llm_model = "anthropic/claude-sonnet-4"
        config.openrouter_base_url = "https://openrouter.ai/api/v1"
        return config

    @pytest.mark.slow
    def test_create_openrouter_llm_client_success(self, mock_config):
        """Test create_openrouter_llm_client returns client with valid config."""
        mock_client = MagicMock()

        with patch(
            "graphiti_core.llm_client.openai_client.OpenAIClient",
            return_value=mock_client,
        ):
            result = create_openrouter_llm_client(mock_config)
            assert result == mock_client

    def test_create_openrouter_llm_client_missing_api_key(self, mock_config):
        """Test create_openrouter_llm_client raises ProviderError for missing API key."""
        mock_config.openrouter_api_key = None

        with pytest.raises(ProviderError) as exc_info:
            create_openrouter_llm_client(mock_config)

        assert "OPENROUTER_API_KEY" in str(exc_info.value)

    def test_create_openrouter_llm_client_import_error(self, mock_config):
        """Test create_openrouter_llm_client raises ProviderNotInstalled on ImportError."""
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name.startswith("graphiti_core.llm_client"):
                raise ImportError("graphiti-core not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_openrouter_llm_client(mock_config)

            assert "graphiti-core" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_openrouter_llm_client_passes_config_correctly(self, mock_config):
        """Test create_openrouter_llm_client passes config values correctly."""
        mock_config.openrouter_api_key = "sk-or-test-key-123"
        mock_config.openrouter_llm_model = "openai/gpt-4o"
        mock_config.openrouter_base_url = "https://custom.openrouter.ai/api/v1"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.openrouter_llm.LLMConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.llm_providers.openrouter_llm.OpenAIClient",
                return_value=mock_client,
            ):
                create_openrouter_llm_client(mock_config)

                # Verify LLMConfig was called with correct arguments
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["api_key"] == "sk-or-test-key-123"
                assert call_kwargs["model"] == "openai/gpt-4o"
                assert call_kwargs["base_url"] == "https://custom.openrouter.ai/api/v1"

    @pytest.mark.slow
    def test_create_openrouter_llm_client_disables_reasoning(self, mock_config):
        """Test create_openrouter_llm_client disables reasoning/verbosity for compatibility."""
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.openrouter_llm.OpenAIClient",
            return_value=mock_client,
        ) as mock_openai_client:
            create_openrouter_llm_client(mock_config)

            # OpenRouter should have reasoning=None, verbosity=None for compatibility
            call_kwargs = mock_openai_client.call_args.kwargs
            assert call_kwargs.get("reasoning") is None
            assert call_kwargs.get("verbosity") is None
