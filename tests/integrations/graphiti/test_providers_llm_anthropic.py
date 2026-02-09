"""
Unit tests for Anthropic LLM provider.

Tests cover:
- create_anthropic_llm_client factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

from unittest.mock import MagicMock, patch

import pytest

from integrations.graphiti.providers_pkg.llm_providers.anthropic_llm import (
    create_anthropic_llm_client,
)
from integrations.graphiti.providers_pkg.exceptions import ProviderError, ProviderNotInstalled


# =============================================================================
# Test create_anthropic_llm_client
# =============================================================================


class TestCreateAnthropicLLMClient:
    """Test create_anthropic_llm_client factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.anthropic_api_key = "sk-ant-test-key"
        config.anthropic_model = "claude-sonnet-4-20250514"
        return config

    @pytest.mark.slow
    def test_create_anthropic_llm_client_success(self, mock_config):
        """Test create_anthropic_llm_client returns client with valid config."""
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.anthropic_llm.AnthropicClient",
            return_value=mock_client,
        ):
            result = create_anthropic_llm_client(mock_config)
            assert result == mock_client

    def test_create_anthropic_llm_client_missing_api_key(self, mock_config):
        """Test create_anthropic_llm_client raises ProviderError for missing API key."""
        mock_config.anthropic_api_key = None

        with pytest.raises(ProviderError) as exc_info:
            create_anthropic_llm_client(mock_config)

        assert "ANTHROPIC_API_KEY" in str(exc_info.value)

    def test_create_anthropic_llm_client_import_error(self, mock_config):
        """Test create_anthropic_llm_client raises ProviderNotInstalled on ImportError."""
        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.anthropic_llm.AnthropicClient",
            side_effect=ImportError("graphiti-core[anthropic] not installed"),
        ):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_anthropic_llm_client(mock_config)

            assert "graphiti-core[anthropic]" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_anthropic_llm_client_passes_config_correctly(self, mock_config):
        """Test create_anthropic_llm_client passes config values correctly."""
        mock_config.anthropic_api_key = "sk-ant-test-key-123"
        mock_config.anthropic_model = "claude-opus-4-20250514"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.anthropic_llm.LLMConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.llm_providers.anthropic_llm.AnthropicClient",
                return_value=mock_client,
            ):
                create_anthropic_llm_client(mock_config)

                # Verify LLMConfig was called with correct arguments
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["api_key"] == "sk-ant-test-key-123"
                assert call_kwargs["model"] == "claude-opus-4-20250514"
