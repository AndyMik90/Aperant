"""
Unit tests for Ollama LLM provider.

Tests cover:
- create_ollama_llm_client factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)
from integrations.graphiti.providers_pkg.llm_providers.ollama_llm import (
    create_ollama_llm_client,
)

# =============================================================================
# Test create_ollama_llm_client
# =============================================================================


class TestCreateOllamaLLMClient:
    """Test create_ollama_llm_client factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.ollama_llm_model = "llama3.2"
        config.ollama_base_url = "http://localhost:11434"
        return config

    @pytest.mark.slow
    def test_create_ollama_llm_client_success(self, mock_config):
        """Test create_ollama_llm_client returns client with valid config."""
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.ollama_llm.OpenAIGenericClient",
            return_value=mock_client,
        ):
            result = create_ollama_llm_client(mock_config)
            assert result == mock_client

    def test_create_ollama_llm_client_success_fast(self, mock_config):
        """Fast test for create_ollama_llm_client success path."""
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
                "graphiti_core.llm_client.config": mock_config_module,
                "graphiti_core.llm_client.openai_generic_client": MagicMock(),
            },
        ):
            from graphiti_core.llm_client.openai_generic_client import (
                OpenAIGenericClient,
            )

            OpenAIGenericClient.return_value = mock_llm_client

            result = create_ollama_llm_client(mock_config)

            # Verify the client was created and returned
            OpenAIGenericClient.assert_called_once()
            assert result == mock_llm_client

    def test_create_ollama_llm_client_missing_model(self, mock_config):
        """Test create_ollama_llm_client raises ProviderError for missing model."""
        mock_config.ollama_llm_model = None

        with pytest.raises(ProviderError) as exc_info:
            create_ollama_llm_client(mock_config)

        assert "OLLAMA_LLM_MODEL" in str(exc_info.value)

    def test_create_ollama_llm_client_import_error(self, mock_config):
        """Test create_ollama_llm_client raises ProviderNotInstalled on ImportError."""
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name.startswith("graphiti_core.llm_client"):
                raise ImportError("graphiti-core not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_ollama_llm_client(mock_config)

            assert "graphiti-core" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_ollama_llm_client_base_url_without_v1(self, mock_config):
        """Test create_ollama_llm_client appends /v1 to base URL if missing."""
        mock_config.ollama_base_url = "http://localhost:11434"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.ollama_llm.LLMConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.llm_providers.ollama_llm.OpenAIGenericClient",
                return_value=mock_client,
            ):
                create_ollama_llm_client(mock_config)

                # Verify base_url has /v1 appended
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["base_url"] == "http://localhost:11434/v1"

    @pytest.mark.slow
    def test_create_ollama_llm_client_base_url_with_v1(self, mock_config):
        """Test create_ollama_llm_client doesn't duplicate /v1 in base URL."""
        mock_config.ollama_base_url = "http://localhost:11434/v1"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.ollama_llm.LLMConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.llm_providers.ollama_llm.OpenAIGenericClient",
                return_value=mock_client,
            ):
                create_ollama_llm_client(mock_config)

                # Verify base_url is not duplicated
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["base_url"] == "http://localhost:11434/v1"

    @pytest.mark.slow
    def test_create_ollama_llm_client_base_url_with_trailing_slash(self, mock_config):
        """Test create_ollama_llm_client handles trailing slash correctly."""
        mock_config.ollama_base_url = "http://localhost:11434/"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.ollama_llm.LLMConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.llm_providers.ollama_llm.OpenAIGenericClient",
                return_value=mock_client,
            ):
                create_ollama_llm_client(mock_config)

                # Verify trailing slash is handled
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["base_url"] == "http://localhost:11434/v1"

    @pytest.mark.slow
    def test_create_ollama_llm_client_passes_config_correctly(self, mock_config):
        """Test create_ollama_llm_client passes config values correctly."""
        mock_config.ollama_llm_model = "qwen2.5"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.ollama_llm.LLMConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.llm_providers.ollama_llm.OpenAIGenericClient",
                return_value=mock_client,
            ):
                create_ollama_llm_client(mock_config)

                # Verify LLMConfig was called with correct arguments
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["api_key"] == "ollama"
                assert call_kwargs["model"] == "qwen2.5"
                assert call_kwargs["small_model"] == "qwen2.5"
