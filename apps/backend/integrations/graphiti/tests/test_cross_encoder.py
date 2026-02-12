"""
Tests for integrations.graphiti.providers_pkg.cross_encoder module.

Tests cover:
1. create_cross_encoder():
   - Returns None for non-Ollama providers
   - Returns None when llm_client is None
   - Returns None on ImportError (graphiti_core not available)
   - Returns None on Exception during creation
   - Creates correct base_url for Ollama
   - Creates LLMConfig with correct parameters
"""

import builtins
from unittest.mock import MagicMock, patch

import pytest

# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def mock_config():
    """Mock GraphitiConfig."""
    config = MagicMock()
    config.llm_provider = "ollama"
    config.ollama_base_url = "http://localhost:11434"
    config.ollama_llm_model = "llama3.2"
    return config


@pytest.fixture
def mock_llm_client():
    """Mock LLM client."""
    return MagicMock()


@pytest.fixture
def graphiti_core_mocks():
    """Mock graphiti_core modules and capture LLMConfig calls."""
    captured_config = {}

    def capture_llm_config(**kwargs):
        captured_config.update(kwargs)
        return MagicMock()

    with patch.dict(
        "sys.modules",
        {
            "graphiti_core": MagicMock(),
            "graphiti_core.cross_encoder": MagicMock(),
            "graphiti_core.cross_encoder.openai_reranker_client": MagicMock(),
            "graphiti_core.llm_client": MagicMock(),
            "graphiti_core.llm_client.config": MagicMock(),
        },
    ):
        from graphiti_core.cross_encoder.openai_reranker_client import (
            OpenAIRerankerClient,
        )
        from graphiti_core.llm_client.config import LLMConfig

        LLMConfig.side_effect = capture_llm_config
        OpenAIRerankerClient.return_value = MagicMock()

        yield captured_config


# =============================================================================
# Test create_cross_encoder()
# =============================================================================


class TestCreateCrossEncoder:
    """Tests for create_cross_encoder() function."""

    def test_returns_none_for_non_ollama_provider(self, mock_config, mock_llm_client):
        """Test create_cross_encoder returns None for non-Ollama providers."""
        mock_config.llm_provider = "openai"

        import integrations.graphiti.providers_pkg.cross_encoder as ce_module

        # The function returns None for non-ollama providers
        result = ce_module.create_cross_encoder(mock_config, mock_llm_client)

        assert result is None

    def test_returns_none_for_anthropic_provider(self, mock_config, mock_llm_client):
        """Test create_cross_encoder returns None for Anthropic provider."""
        mock_config.llm_provider = "anthropic"

        from integrations.graphiti.providers_pkg.cross_encoder import (
            create_cross_encoder,
        )

        result = create_cross_encoder(mock_config, mock_llm_client)

        assert result is None

    def test_returns_none_for_google_provider(self, mock_config, mock_llm_client):
        """Test create_cross_encoder returns None for Google provider."""
        mock_config.llm_provider = "google"

        from integrations.graphiti.providers_pkg.cross_encoder import (
            create_cross_encoder,
        )

        result = create_cross_encoder(mock_config, mock_llm_client)

        assert result is None

    def test_returns_none_when_llm_client_is_none(self, mock_config):
        """Test create_cross_encoder returns None when llm_client is None."""
        from integrations.graphiti.providers_pkg.cross_encoder import (
            create_cross_encoder,
        )

        result = create_cross_encoder(mock_config, llm_client=None)

        assert result is None

    def test_base_url_without_v1_gets_suffix_added(
        self, mock_config, mock_llm_client, graphiti_core_mocks
    ):
        """Test that base_url without /v1 gets /v1 suffix added."""
        mock_config.ollama_base_url = "http://localhost:11434"

        from integrations.graphiti.providers_pkg.cross_encoder import (
            create_cross_encoder,
        )

        _ = create_cross_encoder(mock_config, mock_llm_client)

        # Verify base_url was captured and has /v1 suffix added
        assert "base_url" in graphiti_core_mocks
        assert graphiti_core_mocks["base_url"] == "http://localhost:11434/v1"

    def test_base_url_with_v1_is_preserved(
        self, mock_config, mock_llm_client, graphiti_core_mocks
    ):
        """Test that base_url with /v1 suffix is preserved."""
        mock_config.ollama_base_url = "http://localhost:11434/v1"

        from integrations.graphiti.providers_pkg.cross_encoder import (
            create_cross_encoder,
        )

        _ = create_cross_encoder(mock_config, mock_llm_client)

        # Verify base_url was preserved with /v1 suffix
        assert "base_url" in graphiti_core_mocks
        assert graphiti_core_mocks["base_url"] == "http://localhost:11434/v1"

    def test_import_error_returns_none(self, mock_config, mock_llm_client):
        """Test create_cross_encoder returns None when graphiti_core modules not available."""
        from integrations.graphiti.providers_pkg.cross_encoder import (
            create_cross_encoder,
        )

        # Mock the import to raise ImportError
        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "graphiti_core.cross_encoder.openai_reranker_client":
                raise ImportError("graphiti_core not installed")
            if name == "graphiti_core.llm_client.config":
                raise ImportError("graphiti_core not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            result = create_cross_encoder(mock_config, mock_llm_client)

        assert result is None

    def test_exception_during_creation_returns_none(self, mock_config, mock_llm_client):
        """Test create_cross_encoder returns None on exception during creation."""
        from integrations.graphiti.providers_pkg.cross_encoder import (
            create_cross_encoder,
        )

        # Mock the graphiti_core modules but make LLMConfig raise an exception
        with patch.dict(
            "sys.modules",
            {
                "graphiti_core": MagicMock(),
                "graphiti_core.cross_encoder": MagicMock(),
                "graphiti_core.cross_encoder.openai_reranker_client": MagicMock(),
                "graphiti_core.llm_client": MagicMock(),
                "graphiti_core.llm_client.config": MagicMock(),
            },
        ):
            from graphiti_core.llm_client.config import LLMConfig

            # Make LLMConfig raise an exception
            LLMConfig.side_effect = Exception("Config creation failed")

            result = create_cross_encoder(mock_config, mock_llm_client)

        assert result is None


# =============================================================================
# Test module exports
# =============================================================================


class TestModuleExports:
    """Tests for cross_encoder module exports."""

    def test_create_cross_encoder_is_exported(self):
        """Test that create_cross_encoder is exported from module."""
        from integrations.graphiti.providers_pkg import cross_encoder

        assert hasattr(cross_encoder, "create_cross_encoder")
        assert callable(cross_encoder.create_cross_encoder)
