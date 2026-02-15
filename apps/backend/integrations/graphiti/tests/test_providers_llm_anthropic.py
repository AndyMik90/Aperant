"""
Unit tests for Anthropic LLM provider.

Tests cover:
- create_anthropic_llm_client factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

import sys
from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)
from integrations.graphiti.providers_pkg.llm_providers.anthropic_llm import (
    create_anthropic_llm_client,
)

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

        # Patch at the location where the import happens (local import inside function)
        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.anthropic_llm.AnthropicClient",
            return_value=mock_client,
        ):
            result = create_anthropic_llm_client(mock_config)
            assert result == mock_client

    def test_create_anthropic_llm_client_success_fast(self, mock_config):
        """Fast test for create_anthropic_llm_client success path."""
        mock_llm_client = MagicMock()

        # Create the config mock
        mock_config_module = MagicMock()
        mock_config_module.LLMConfig = MagicMock

        # Mock the graphiti_core imports
        with patch.dict(
            "sys.modules",
            {
                "graphiti_core": MagicMock(),
                "graphiti_core.llm_client": MagicMock(),
                "graphiti_core.llm_client.anthropic_client": MagicMock(),
                "graphiti_core.llm_client.config": mock_config_module,
            },
        ):
            from graphiti_core.llm_client.anthropic_client import AnthropicClient

            AnthropicClient.return_value = mock_llm_client

            result = create_anthropic_llm_client(mock_config)

            # Verify the client was created and returned
            AnthropicClient.assert_called_once()
            assert result == mock_llm_client

    def test_create_anthropic_llm_client_missing_api_key_fast(self, mock_config):
        """Fast test for API key validation (line 41)."""
        # Mock the graphiti_core imports first to avoid ImportError
        mock_config_module = MagicMock()
        mock_config_module.LLMConfig = MagicMock

        with patch.dict(
            "sys.modules",
            {
                "graphiti_core": MagicMock(),
                "graphiti_core.llm_client": MagicMock(),
                "graphiti_core.llm_client.anthropic_client": MagicMock(),
                "graphiti_core.llm_client.config": mock_config_module,
            },
        ):
            from graphiti_core.llm_client.anthropic_client import AnthropicClient

            AnthropicClient.return_value = MagicMock()

            # Now set API key to None to test validation
            mock_config.anthropic_api_key = None

            with pytest.raises(ProviderError) as exc_info:
                create_anthropic_llm_client(mock_config)

            assert "ANTHROPIC_API_KEY" in str(exc_info.value)

    def test_create_anthropic_llm_client_import_error(self, mock_config):
        """Test create_anthropic_llm_client raises ProviderNotInstalled on ImportError."""
        from types import ModuleType

        # Create a broken module that raises ImportError on attribute access
        def broken_getattr(name):
            if name in ("llm_client", "anthropic_client", "config"):
                raise ImportError("graphiti-core[anthropic] not installed")
            raise AttributeError(f"module has no attribute '{name}'")

        broken_module = ModuleType("graphiti_core")
        broken_module.__getattr__ = broken_getattr

        # Patch both modules that are imported
        with patch.dict(sys.modules, {"graphiti_core": broken_module}):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_anthropic_llm_client(mock_config)

            assert "graphiti-core[anthropic]" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_anthropic_llm_client_passes_config_correctly(self, mock_config):
        """Test create_anthropic_llm_client passes config values correctly."""
        mock_config.anthropic_api_key = "sk-ant-test-key-123"
        mock_config.anthropic_model = "claude-opus-4-20250514"
        mock_client = MagicMock()

        # Patch at the location where the imports happen (local imports inside function)
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
