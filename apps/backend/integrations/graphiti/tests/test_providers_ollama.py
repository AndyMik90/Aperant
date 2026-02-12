"""
Unit tests for Ollama embedder provider.

Tests cover:
- get_embedding_dim_for_model helper function
- create_ollama_embedder factory function
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder import (
    KNOWN_OLLAMA_EMBEDDING_MODELS,
    create_ollama_embedder,
    get_embedding_dim_for_model,
)
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)

# =============================================================================
# Test get_embedding_dim_for_model
# =============================================================================


class TestGetEmbeddingDimForModel:
    """Test get_embedding_dim_for_model helper function."""

    def test_get_embedding_dim_for_model_exact_match(self):
        """Test get_embedding_dim_for_model with exact model match."""
        result = get_embedding_dim_for_model("nomic-embed-text")
        assert result == 768

    def test_get_embedding_dim_for_model_with_tag(self):
        """Test get_embedding_dim_for_model with tagged model."""
        result = get_embedding_dim_for_model("qwen3-embedding:8b")
        assert result == 4096

    def test_get_embedding_dim_for_model_base_name_fallback(self):
        """Test get_embedding_dim_for_model falls back to base name."""
        result = get_embedding_dim_for_model("nomic-embed-text:custom-tag")
        assert result == 768  # Should use base model dimension

    def test_get_embedding_dim_for_model_configured_dim_override(self):
        """Test get_embedding_dim_for_model with configured dimension override."""
        result = get_embedding_dim_for_model("unknown-model", configured_dim=512)
        assert result == 512

    def test_get_embedding_dim_for_model_unknown_model(self):
        """Test get_embedding_dim_for_model raises ProviderError for unknown model."""
        with pytest.raises(ProviderError) as exc_info:
            get_embedding_dim_for_model("totally-unknown-model")

        assert "Unknown Ollama embedding model" in str(exc_info.value)
        assert "totally-unknown-model" in str(exc_info.value)
        assert "OLLAMA_EMBEDDING_DIM" in str(exc_info.value)

    def test_get_embedding_dim_for_model_configured_dim_zero(self):
        """Test get_embedding_dim_for_model ignores zero configured dimension."""
        # When configured_dim is 0, should use known model dimension
        result = get_embedding_dim_for_model("nomic-embed-text", configured_dim=0)
        assert result == 768


# =============================================================================
# Test KNOWN_OLLAMA_EMBEDDING_MODELS constant
# =============================================================================


class TestKnownOllamaEmbeddingModels:
    """Test KNOWN_OLLAMA_EMBEDDING_MODELS constant."""

    def test_known_models_contains_expected_entries(self):
        """Test KNOWN_OLLAMA_EMBEDDING_MODELS has expected models."""
        expected_models = [
            "embeddinggemma",
            "qwen3-embedding",
            "nomic-embed-text",
            "mxbai-embed-large",
            "bge-large",
            "all-minilm",
        ]

        for model in expected_models:
            # Check if base model exists (without tag)
            base_found = any(
                key.startswith(model) for key in KNOWN_OLLAMA_EMBEDDING_MODELS.keys()
            )
            assert base_found, (
                f"Model {model} not found in KNOWN_OLLAMA_EMBEDDING_MODELS"
            )

    def test_known_models_dimensions_are_positive(self):
        """Test all dimensions in KNOWN_OLLAMA_EMBEDDING_MODELS are positive integers."""
        for model, dimension in KNOWN_OLLAMA_EMBEDDING_MODELS.items():
            assert isinstance(dimension, int), f"Dimension for {model} is not int"
            assert dimension > 0, f"Dimension for {model} is not positive: {dimension}"


# =============================================================================
# Test create_ollama_embedder
# =============================================================================


class TestCreateOllamaEmbedder:
    """Test create_ollama_embedder factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.ollama_embedding_model = "nomic-embed-text"
        config.ollama_embedding_dim = None
        config.ollama_base_url = "http://localhost:11434"
        return config

    @pytest.mark.slow
    def test_create_ollama_embedder_success(self, mock_config):
        """Test create_ollama_embedder returns embedder with valid config."""
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedder",
            return_value=mock_embedder,
        ):
            result = create_ollama_embedder(mock_config)
            assert result == mock_embedder

    def test_create_ollama_embedder_success_fast(self, mock_config):
        """Fast test for create_ollama_embedder success path."""
        mock_embedder = MagicMock()

        # Set embedding_dim to 0 to allow auto-detection
        mock_config.ollama_embedding_dim = 0

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

            result = create_ollama_embedder(mock_config)

            # Verify the embedder was created and returned
            OpenAIEmbedder.assert_called_once()
            assert result == mock_embedder

    def test_create_ollama_embedder_missing_model(self, mock_config):
        """Test create_ollama_embedder raises ProviderError for missing model."""
        mock_config.ollama_embedding_model = None

        with pytest.raises(ProviderError) as exc_info:
            create_ollama_embedder(mock_config)

        assert "OLLAMA_EMBEDDING_MODEL" in str(exc_info.value)

    def test_create_ollama_embedder_import_error(self, mock_config):
        """Test create_ollama_embedder raises ProviderNotInstalled on ImportError."""
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            # Only block the specific import that create_ollama_embedder uses
            if name == "graphiti_core.embedder.openai" or name.startswith(
                "graphiti_core.embedder.openai."
            ):
                raise ImportError("graphiti-core not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_ollama_embedder(mock_config)

            assert "graphiti-core" in str(exc_info.value)

    @pytest.mark.slow
    def test_create_ollama_embedder_base_url_without_v1(self, mock_config):
        """Test create_ollama_embedder appends /v1 to base URL if missing."""
        mock_config.ollama_base_url = "http://localhost:11434"
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedderConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedder",
                return_value=mock_embedder,
            ):
                create_ollama_embedder(mock_config)

                # Verify base_url has /v1 appended
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["base_url"] == "http://localhost:11434/v1"

    @pytest.mark.slow
    def test_create_ollama_embedder_base_url_with_v1(self, mock_config):
        """Test create_ollama_embedder doesn't duplicate /v1 in base URL."""
        mock_config.ollama_base_url = "http://localhost:11434/v1"
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedderConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedder",
                return_value=mock_embedder,
            ):
                create_ollama_embedder(mock_config)

                # Verify base_url is not duplicated
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["base_url"] == "http://localhost:11434/v1"

    @pytest.mark.slow
    def test_create_ollama_embedder_base_url_with_trailing_slash(self, mock_config):
        """Test create_ollama_embedder handles trailing slash correctly."""
        mock_config.ollama_base_url = "http://localhost:11434/"
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedderConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedder",
                return_value=mock_embedder,
            ):
                create_ollama_embedder(mock_config)

                # Verify trailing slash is handled
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["base_url"] == "http://localhost:11434/v1"

    @pytest.mark.slow
    def test_create_ollama_embedder_passes_config_correctly(self, mock_config):
        """Test create_ollama_embedder passes config values correctly."""
        mock_config.ollama_embedding_model = "mxbai-embed-large"
        mock_config.ollama_embedding_dim = None
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedderConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedder",
                return_value=mock_embedder,
            ):
                create_ollama_embedder(mock_config)

                # Verify OpenAIEmbedderConfig was called with correct arguments
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["api_key"] == "ollama"
                assert call_kwargs["embedding_model"] == "mxbai-embed-large"
                assert (
                    call_kwargs["embedding_dim"] == 1024
                )  # Known dimension for mxbai-embed-large

    @pytest.mark.slow
    def test_create_ollama_embedder_with_configured_dimension(self, mock_config):
        """Test create_ollama_embedder uses configured dimension when set."""
        mock_config.ollama_embedding_dim = 512
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedderConfig",
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.providers_pkg.embedder_providers.ollama_embedder.OpenAIEmbedder",
                return_value=mock_embedder,
            ):
                create_ollama_embedder(mock_config)

                # Verify configured dimension is used
                call_kwargs = mock_config_class.call_args.kwargs
                assert call_kwargs["embedding_dim"] == 512
