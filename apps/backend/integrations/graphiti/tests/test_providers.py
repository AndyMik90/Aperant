"""
Unit tests for graphiti_providers module.

Tests cover:
- EMBEDDING_DIMENSIONS constant
- Provider exceptions
- Factory functions (create_llm_client, create_embedder, create_cross_encoder)
- Validators (test_llm_connection, test_embedder_connection, test_ollama_connection)
- Utility functions (get_expected_embedding_dim, get_graph_hints, is_graphiti_enabled)
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from integrations.graphiti.providers_pkg import (
    EMBEDDING_DIMENSIONS,
    ProviderError,
    ProviderNotInstalled,
    create_cross_encoder,
    create_embedder,
    create_llm_client,
    get_expected_embedding_dim,
    get_graph_hints,
    is_graphiti_enabled,
    test_embedder_connection,
    test_llm_connection,
    test_ollama_connection,
    validate_embedding_config,
)

# =============================================================================
# Test Constants
# =============================================================================


class TestEmbeddingDimensions:
    """Test EMBEDDING_DIMENSIONS constant."""

    def test_embedding_dimensions_contains_expected_providers(self):
        """Verify all expected providers have dimensions defined."""
        expected_models = [
            # OpenAI models
            "text-embedding-3-small",
            "text-embedding-3-large",
            "text-embedding-ada-002",
            # Voyage AI models
            "voyage-3",
            "voyage-3.5",
            "voyage-3-lite",
            "voyage-3.5-lite",
            "voyage-2",
            "voyage-large-2",
            # Ollama models
            "nomic-embed-text",
            "mxbai-embed-large",
            "all-minilm",
            "snowflake-arctic-embed",
        ]

        for model in expected_models:
            assert model in EMBEDDING_DIMENSIONS, (
                f"Model {model} not in EMBEDDING_DIMENSIONS"
            )

    def test_embedding_dimensions_values_are_positive_integers(self):
        """Verify all dimension values are positive integers."""
        for model, dimension in EMBEDDING_DIMENSIONS.items():
            assert isinstance(dimension, int), (
                f"Dimension for {model} is not an integer: {type(dimension)}"
            )
            assert dimension > 0, f"Dimension for {model} is not positive: {dimension}"


class TestGetExpectedEmbeddingDim:
    """Test get_expected_embedding_dim utility function."""

    @pytest.mark.parametrize(
        "model_name,expected_dim",
        [
            # OpenAI models - exact match
            ("text-embedding-3-small", 1536),
            ("text-embedding-3-large", 3072),
            ("text-embedding-ada-002", 1536),
            # Voyage AI models
            ("voyage-3", 1024),
            ("voyage-3.5", 1024),
            ("voyage-3-lite", 512),
            ("voyage-3.5-lite", 512),
            ("voyage-2", 1024),
            ("voyage-large-2", 1536),
            # Ollama models
            ("nomic-embed-text", 768),
            ("mxbai-embed-large", 1024),
            ("all-minilm", 384),
            ("snowflake-arctic-embed", 1024),
        ],
    )
    def test_get_expected_embedding_dim_exact_match(self, model_name, expected_dim):
        """Test exact model name matches return correct dimension."""
        assert get_expected_embedding_dim(model_name) == expected_dim

    @pytest.mark.parametrize(
        "model_name,expected_dim",
        [
            # Partial matches - model name with version suffix
            ("text-embedding-3-small:0", 1536),
            ("voyage-3:latest", 1024),
            ("nomic-embed-text:v1.5", 768),
            # Case insensitive partial match
            ("Text-Embedding-3-Small", 1536),
            ("VOYAGE-3", 1024),
        ],
    )
    def test_get_expected_embedding_dim_partial_match(self, model_name, expected_dim):
        """Test partial model name matches return correct dimension."""
        assert get_expected_embedding_dim(model_name) == expected_dim

    def test_get_expected_embedding_dim_unknown_model(self):
        """Test unknown model returns None."""
        assert get_expected_embedding_dim("unknown-model-x") is None

    def test_get_expected_embedding_dim_empty_string(self):
        """Test empty string behavior (implementation returns match due to substring logic)."""
        # The function's substring matching causes it to find "text-embedding-3-small"
        # because empty string "" is a substring of any string
        result = get_expected_embedding_dim("")
        # This documents actual behavior - empty string matches first model in dict
        assert result is not None


# =============================================================================
# Test Exceptions
# =============================================================================


class TestProviderError:
    """Test ProviderError exception."""

    def test_provider_error_can_be_raised_with_message(self):
        """Test ProviderError can be raised with a message."""
        message = "Test error message"
        with pytest.raises(ProviderError) as exc_info:
            raise ProviderError(message)

        assert str(exc_info.value) == message

    def test_provider_error_is_exception(self):
        """Test ProviderError is an Exception subclass."""
        assert issubclass(ProviderError, Exception)


class TestProviderNotInstalled:
    """Test ProviderNotInstalled exception."""

    def test_provider_not_installed_can_be_raised(self):
        """Test ProviderNotInstalled can be raised."""
        with pytest.raises(ProviderNotInstalled):
            raise ProviderNotInstalled("Package not installed")

    def test_provider_not_installed_is_provider_error(self):
        """Test ProviderNotInstalled is a ProviderError subclass."""
        assert issubclass(ProviderNotInstalled, ProviderError)


# =============================================================================
# Test Factory Functions
# =============================================================================


class TestCreateLLMClient:
    """Test create_llm_client factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.llm_provider = "openai"
        config.openai_api_key = "test-key"
        config.anthropic_api_key = None
        config.azure_openai_api_key = None
        config.ollama_base_url = "http://localhost:11434"
        config.google_api_key = None
        config.openrouter_api_key = None
        return config

    @pytest.mark.parametrize(
        "provider",
        [
            "openai",
            "anthropic",
            "google",
            "openrouter",
        ],
    )
    def test_create_llm_client_returns_correct_client(self, mock_config, provider):
        """Test create_llm_client returns correct client for each provider."""
        mock_config.llm_provider = provider

        # Mock the provider-specific create function
        mock_client = MagicMock()
        provider_map = {
            "openai": "integrations.graphiti.providers_pkg.factory.create_openai_llm_client",
            "anthropic": "integrations.graphiti.providers_pkg.factory.create_anthropic_llm_client",
            "google": "integrations.graphiti.providers_pkg.factory.create_google_llm_client",
            "openrouter": "integrations.graphiti.providers_pkg.factory.create_openrouter_llm_client",
        }

        with patch(provider_map[provider], return_value=mock_client) as mock_create:
            result = create_llm_client(mock_config)
            assert result == mock_client
            mock_create.assert_called_once_with(mock_config)

    def test_create_llm_client_azure_openai(self, mock_config):
        """Test create_llm_client with Azure OpenAI provider."""
        mock_config.llm_provider = "azure_openai"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.factory.create_azure_openai_llm_client",
            return_value=mock_client,
        ) as mock_create:
            result = create_llm_client(mock_config)
            assert result == mock_client
            mock_create.assert_called_once_with(mock_config)

    def test_create_llm_client_ollama(self, mock_config):
        """Test create_llm_client with Ollama provider."""
        mock_config.llm_provider = "ollama"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.factory.create_ollama_llm_client",
            return_value=mock_client,
        ) as mock_create:
            result = create_llm_client(mock_config)
            assert result == mock_client
            mock_create.assert_called_once_with(mock_config)

    def test_create_llm_client_raises_provider_not_installed(self, mock_config):
        """Test create_llm_client raises ProviderNotInstalled when packages unavailable."""
        mock_config.llm_provider = "openai"

        with patch(
            "integrations.graphiti.providers_pkg.factory.create_openai_llm_client",
            side_effect=ProviderNotInstalled("openai package not installed"),
        ):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_llm_client(mock_config)

            assert "openai package not installed" in str(exc_info.value)

    def test_create_llm_client_raises_provider_error_for_invalid_config(
        self, mock_config
    ):
        """Test create_llm_client raises ProviderError for invalid config."""
        mock_config.llm_provider = "openai"

        with patch(
            "integrations.graphiti.providers_pkg.factory.create_openai_llm_client",
            side_effect=ProviderError("Invalid API key"),
        ):
            with pytest.raises(ProviderError) as exc_info:
                create_llm_client(mock_config)

            assert "Invalid API key" in str(exc_info.value)

    def test_create_llm_client_raises_provider_error_for_unknown_provider(
        self, mock_config
    ):
        """Test create_llm_client raises ProviderError for unknown provider."""
        mock_config.llm_provider = "unknown_provider"

        with pytest.raises(ProviderError) as exc_info:
            create_llm_client(mock_config)

        assert "Unknown LLM provider" in str(exc_info.value)
        assert "unknown_provider" in str(exc_info.value)


class TestCreateEmbedder:
    """Test create_embedder factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.embedder_provider = "openai"
        config.openai_api_key = "test-key"
        config.voyage_api_key = None
        config.azure_openai_api_key = None
        config.ollama_embedding_dim = None
        config.google_api_key = None
        config.openrouter_api_key = None
        return config

    @pytest.mark.parametrize(
        "provider",
        [
            "openai",
            "voyage",
            "azure_openai",
            "ollama",
            "google",
            "openrouter",
        ],
    )
    def test_create_embedder_returns_correct_embedder(self, mock_config, provider):
        """Test create_embedder returns correct embedder for each provider."""
        mock_config.embedder_provider = provider
        mock_embedder = MagicMock()

        provider_map = {
            "openai": "integrations.graphiti.providers_pkg.factory.create_openai_embedder",
            "voyage": "integrations.graphiti.providers_pkg.factory.create_voyage_embedder",
            "azure_openai": "integrations.graphiti.providers_pkg.factory.create_azure_openai_embedder",
            "ollama": "integrations.graphiti.providers_pkg.factory.create_ollama_embedder",
            "google": "integrations.graphiti.providers_pkg.factory.create_google_embedder",
            "openrouter": "integrations.graphiti.providers_pkg.factory.create_openrouter_embedder",
        }

        with patch(provider_map[provider], return_value=mock_embedder) as mock_create:
            result = create_embedder(mock_config)
            assert result == mock_embedder
            mock_create.assert_called_once_with(mock_config)

    def test_create_embedder_raises_provider_not_installed(self, mock_config):
        """Test create_embedder raises ProviderNotInstalled when packages unavailable."""
        mock_config.embedder_provider = "openai"

        with patch(
            "integrations.graphiti.providers_pkg.factory.create_openai_embedder",
            side_effect=ProviderNotInstalled("openai package not installed"),
        ):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                create_embedder(mock_config)

            assert "openai package not installed" in str(exc_info.value)

    def test_create_embedder_raises_provider_error_for_invalid_config(
        self, mock_config
    ):
        """Test create_embedder raises ProviderError for invalid config."""
        mock_config.embedder_provider = "voyage"

        with patch(
            "integrations.graphiti.providers_pkg.factory.create_voyage_embedder",
            side_effect=ProviderError("Invalid API key"),
        ):
            with pytest.raises(ProviderError) as exc_info:
                create_embedder(mock_config)

            assert "Invalid API key" in str(exc_info.value)

    def test_create_embedder_raises_provider_error_for_unknown_provider(
        self, mock_config
    ):
        """Test create_embedder raises ProviderError for unknown provider."""
        mock_config.embedder_provider = "unknown_provider"

        with pytest.raises(ProviderError) as exc_info:
            create_embedder(mock_config)

        assert "Unknown embedder provider" in str(exc_info.value)
        assert "unknown_provider" in str(exc_info.value)


class TestCreateCrossEncoder:
    """Test create_cross_encoder factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.llm_provider = "ollama"
        config.ollama_base_url = "http://localhost:11434/v1"
        config.ollama_llm_model = "llama3.2"
        return config

    @pytest.mark.skip("Requires graphiti_core package")
    def test_create_cross_encoder_with_ollama_provider(self, mock_config):
        """Test create_cross_encoder with Ollama provider returns cross-encoder."""
        mock_llm_client = MagicMock()
        mock_reranker = MagicMock()

        with patch(
            "graphiti_core.cross_encoder.openai_reranker_client.OpenAIRerankerClient",
            return_value=mock_reranker,
        ):
            result = create_cross_encoder(mock_config, mock_llm_client)
            assert result == mock_reranker

    def test_create_cross_encoder_without_llm_client(self, mock_config):
        """Test create_cross_encoder without LLM client returns None."""
        result = create_cross_encoder(mock_config, llm_client=None)
        assert result is None

    def test_create_cross_encoder_non_ollama_provider(self, mock_config):
        """Test create_cross_encoder with non-Ollama provider returns None."""
        mock_config.llm_provider = "openai"
        mock_llm_client = MagicMock()

        result = create_cross_encoder(mock_config, mock_llm_client)
        assert result is None

    @pytest.mark.skip("Requires graphiti_core package")
    def test_create_cross_encoder_import_error_returns_none(self, mock_config):
        """Test create_cross_encoder returns None when cross-encoder not available."""
        mock_llm_client = MagicMock()

        with patch(
            "graphiti_core.cross_encoder.openai_reranker_client.OpenAIRerankerClient",
            side_effect=ImportError("Module not found"),
        ):
            result = create_cross_encoder(mock_config, mock_llm_client)
            assert result is None

    @pytest.mark.skip("Requires graphiti_core package")
    def test_create_cross_encoder_exception_returns_none(self, mock_config):
        """Test create_cross_encoder returns None on exception."""
        mock_llm_client = MagicMock()

        with patch(
            "graphiti_core.cross_encoder.openai_reranker_client.OpenAIRerankerClient",
            side_effect=Exception("Creation failed"),
        ):
            result = create_cross_encoder(mock_config, mock_llm_client)
            assert result is None


# =============================================================================
# Test Validators
# =============================================================================


class TestValidateEmbeddingConfig:
    """Test validate_embedding_config validator."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.embedder_provider = "openai"
        config.openai_embedding_model = "text-embedding-3-small"
        config.voyage_embedding_model = "voyage-3"
        config.ollama_embedding_model = "nomic-embed-text"
        config.ollama_embedding_dim = 768
        return config

    def test_validate_embedding_config_valid_openai(self, mock_config):
        """Test validate_embedding_config with valid OpenAI config."""
        mock_config.embedder_provider = "openai"
        is_valid, message = validate_embedding_config(mock_config)
        assert is_valid is True
        assert "valid" in message.lower()

    def test_validate_embedding_config_valid_voyage(self, mock_config):
        """Test validate_embedding_config with valid Voyage config."""
        mock_config.embedder_provider = "voyage"
        is_valid, message = validate_embedding_config(mock_config)
        assert is_valid is True
        assert "valid" in message.lower()

    def test_validate_embedding_config_ollama_without_dim(self, mock_config):
        """Test validate_embedding_config with Ollama but no dimension."""
        mock_config.embedder_provider = "ollama"
        mock_config.ollama_embedding_dim = None
        mock_config.ollama_embedding_model = "nomic-embed-text"

        is_valid, message = validate_embedding_config(mock_config)
        assert is_valid is False
        assert "OLLAMA_EMBEDDING_DIM" in message
        assert "768" in message  # Expected dimension

    def test_validate_embedding_config_ollama_with_dim(self, mock_config):
        """Test validate_embedding_config with Ollama and dimension set."""
        mock_config.embedder_provider = "ollama"
        mock_config.ollama_embedding_dim = 768

        is_valid, message = validate_embedding_config(mock_config)
        assert is_valid is True
        assert "valid" in message.lower()

    def test_validate_embedding_config_ollama_unknown_model(self, mock_config):
        """Test validate_embedding_config with Ollama unknown model."""
        mock_config.embedder_provider = "ollama"
        mock_config.ollama_embedding_dim = None
        mock_config.ollama_embedding_model = "unknown-model"

        is_valid, message = validate_embedding_config(mock_config)
        assert is_valid is False
        assert "OLLAMA_EMBEDDING_DIM" in message

    def test_validate_embedding_config_openai_logs_dimension(self, mock_config):
        """Test validate_embedding_config logs OpenAI dimension (lines 52-58)."""
        mock_config.embedder_provider = "openai"
        mock_config.openai_embedding_model = "text-embedding-3-small"

        with patch(
            "integrations.graphiti.providers_pkg.validators.logger"
        ) as mock_logger:
            is_valid, message = validate_embedding_config(mock_config)
            assert is_valid is True
            # Verify debug log was called for OpenAI model dimension
            mock_logger.debug.assert_called_once()
            call_args = mock_logger.debug.call_args[0][0]
            assert "text-embedding-3-small" in call_args
            assert "1536" in call_args

    def test_validate_embedding_config_voyage_logs_dimension(self, mock_config):
        """Test validate_embedding_config logs Voyage dimension (lines 60-65)."""
        mock_config.embedder_provider = "voyage"
        mock_config.voyage_embedding_model = "voyage-3"

        with patch(
            "integrations.graphiti.providers_pkg.validators.logger"
        ) as mock_logger:
            is_valid, message = validate_embedding_config(mock_config)
            assert is_valid is True
            # Verify debug log was called for Voyage model dimension
            mock_logger.debug.assert_called_once()
            call_args = mock_logger.debug.call_args[0][0]
            assert "voyage-3" in call_args
            assert "1024" in call_args

    def test_validate_embedding_config_openai_unknown_model_no_log(self, mock_config):
        """Test validate_embedding_config with OpenAI unknown model doesn't crash."""
        mock_config.embedder_provider = "openai"
        mock_config.openai_embedding_model = "unknown-model"

        # Should still succeed even with unknown model (OpenAI handles this)
        is_valid, message = validate_embedding_config(mock_config)
        assert is_valid is True

    def test_validate_embedding_config_voyage_unknown_model_no_log(self, mock_config):
        """Test validate_embedding_config with Voyage unknown model doesn't crash."""
        mock_config.embedder_provider = "voyage"
        mock_config.voyage_embedding_model = "unknown-model"

        # Should still succeed even with unknown model
        is_valid, message = validate_embedding_config(mock_config)
        assert is_valid is True

    def test_validate_embedding_config_unknown_provider(self, mock_config):
        """Test validate_embedding_config with unknown provider."""
        mock_config.embedder_provider = "unknown_provider"

        # Unknown providers should just pass validation
        is_valid, message = validate_embedding_config(mock_config)
        assert is_valid is True


class TestTestLLMConnection:
    """Test test_llm_connection validator."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.llm_provider = "openai"
        return config

    @pytest.mark.asyncio
    async def test_test_llm_connection_success(self, mock_config):
        """Test test_llm_connection returns success tuple."""
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.factory.create_llm_client",
            return_value=mock_client,
        ):
            is_connected, message = await test_llm_connection(mock_config)
            assert is_connected is True
            assert "success" in message.lower()
            assert "openai" in message

    @pytest.mark.asyncio
    async def test_test_llm_connection_provider_not_installed(self, mock_config):
        """Test test_llm_connection handles ProviderNotInstalled."""
        with patch(
            "integrations.graphiti.providers_pkg.factory.create_llm_client",
            side_effect=ProviderNotInstalled("Package not installed"),
        ):
            is_connected, message = await test_llm_connection(mock_config)
            assert is_connected is False
            assert "Package not installed" in message

    @pytest.mark.asyncio
    async def test_test_llm_connection_provider_error(self, mock_config):
        """Test test_llm_connection handles ProviderError."""
        with patch(
            "integrations.graphiti.providers_pkg.factory.create_llm_client",
            side_effect=ProviderError("Invalid configuration"),
        ):
            is_connected, message = await test_llm_connection(mock_config)
            assert is_connected is False
            assert "Invalid configuration" in message

    @pytest.mark.asyncio
    async def test_test_llm_connection_generic_exception(self, mock_config):
        """Test test_llm_connection handles generic exceptions."""
        with patch(
            "integrations.graphiti.providers_pkg.factory.create_llm_client",
            side_effect=Exception("Connection failed"),
        ):
            is_connected, message = await test_llm_connection(mock_config)
            assert is_connected is False
            assert "Failed to create LLM client" in message


class TestTestEmbedderConnection:
    """Test test_embedder_connection validator."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.embedder_provider = "openai"
        return config

    @pytest.mark.asyncio
    async def test_test_embedder_connection_success(self, mock_config):
        """Test test_embedder_connection returns success tuple."""
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.validators.validate_embedding_config",
            return_value=(True, "Valid"),
        ):
            with patch(
                "integrations.graphiti.providers_pkg.factory.create_embedder",
                return_value=mock_embedder,
            ):
                is_connected, message = await test_embedder_connection(mock_config)
                assert is_connected is True
                assert "success" in message.lower()

    @pytest.mark.asyncio
    async def test_test_embedder_connection_invalid_config(self, mock_config):
        """Test test_embedder_connection with invalid config."""
        with patch(
            "integrations.graphiti.providers_pkg.validators.validate_embedding_config",
            return_value=(False, "Invalid dimension"),
        ):
            is_connected, message = await test_embedder_connection(mock_config)
            assert is_connected is False
            assert "Invalid dimension" in message

    @pytest.mark.asyncio
    async def test_test_embedder_connection_provider_not_installed(self, mock_config):
        """Test test_embedder_connection handles ProviderNotInstalled."""
        with patch(
            "integrations.graphiti.providers_pkg.validators.validate_embedding_config",
            return_value=(True, "Valid"),
        ):
            with patch(
                "integrations.graphiti.providers_pkg.factory.create_embedder",
                side_effect=ProviderNotInstalled("Package not installed"),
            ):
                is_connected, message = await test_embedder_connection(mock_config)
                assert is_connected is False
                assert "Package not installed" in message

    @pytest.mark.asyncio
    async def test_test_embedder_connection_provider_error(self, mock_config):
        """Test test_embedder_connection handles ProviderError."""
        with patch(
            "integrations.graphiti.providers_pkg.validators.validate_embedding_config",
            return_value=(True, "Valid"),
        ):
            with patch(
                "integrations.graphiti.providers_pkg.factory.create_embedder",
                side_effect=ProviderError("Invalid configuration"),
            ):
                is_connected, message = await test_embedder_connection(mock_config)
                assert is_connected is False
                assert "Invalid configuration" in message

    @pytest.mark.asyncio
    async def test_test_embedder_connection_generic_exception(self, mock_config):
        """Test test_embedder_connection handles generic exceptions (lines 124-125)."""
        with patch(
            "integrations.graphiti.providers_pkg.validators.validate_embedding_config",
            return_value=(True, "Valid"),
        ):
            with patch(
                "integrations.graphiti.providers_pkg.factory.create_embedder",
                side_effect=Exception("Unexpected error"),
            ):
                is_connected, message = await test_embedder_connection(mock_config)
                assert is_connected is False
                assert "Failed to create embedder" in message


class TestTestOllamaConnection:
    """Test test_ollama_connection validator."""

    @pytest.mark.asyncio
    async def test_test_ollama_connection_success_aiohttp(self):
        """Test test_ollama_connection with successful aiohttp connection."""
        # Mock the aiohttp import
        mock_aiohttp = MagicMock()

        # Create a mock response
        mock_response = AsyncMock()
        mock_response.status = 200

        # Mock the ClientSession and context manager
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)
        mock_session.get = MagicMock(return_value=mock_response)
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=None)

        mock_client_session = MagicMock(return_value=mock_session)

        mock_aiohttp.ClientSession = mock_client_session
        mock_aiohttp.ClientTimeout = MagicMock()

        # Patch sys.modules to make aiohttp import succeed
        import sys

        with patch.dict(sys.modules, {"aiohttp": mock_aiohttp}):
            is_connected, message = await test_ollama_connection(
                "http://localhost:11434"
            )
            assert is_connected is True
            assert "Ollama is running" in message

    @pytest.mark.asyncio
    async def test_test_ollama_connection_with_v1_suffix(self):
        """Test test_ollama_connection removes /v1 suffix from URL."""
        # Mock the aiohttp import
        mock_aiohttp = MagicMock()

        # Create a mock response
        mock_response = AsyncMock()
        mock_response.status = 200

        # Mock the ClientSession and context manager
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)
        mock_session.get = MagicMock(return_value=mock_response)
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=None)

        mock_client_session = MagicMock(return_value=mock_session)

        mock_aiohttp.ClientSession = mock_client_session
        mock_aiohttp.ClientTimeout = MagicMock()

        # Patch sys.modules to make aiohttp import succeed
        import sys

        with patch.dict(sys.modules, {"aiohttp": mock_aiohttp}):
            is_connected, message = await test_ollama_connection(
                "http://localhost:11434/v1"
            )
            assert is_connected is True
            # URL should be normalized (without /v1)
            assert "localhost:11434" in message

    @pytest.mark.asyncio
    async def test_test_ollama_connection_failure_aiohttp(self):
        """Test test_ollama_connection with aiohttp connection failure."""
        # Mock the aiohttp import
        mock_aiohttp = MagicMock()

        # Create a ClientError subclass
        class MockClientError(Exception):
            pass

        mock_aiohttp.ClientError = MockClientError
        mock_aiohttp.ClientTimeout = MagicMock()

        # Patch sys.modules to make aiohttp import succeed
        import sys

        with patch.dict(sys.modules, {"aiohttp": mock_aiohttp}):
            # Mock ClientSession to raise ClientError
            mock_client_session = MagicMock(
                side_effect=MockClientError("Connection refused")
            )
            mock_aiohttp.ClientSession = mock_client_session

            is_connected, message = await test_ollama_connection(
                "http://localhost:11434"
            )
            assert is_connected is False
            assert "Cannot connect" in message

    @pytest.mark.asyncio
    async def test_test_ollama_connection_timeout_aiohttp(self):
        """Test test_ollama_connection with aiohttp timeout."""
        # Mock the aiohttp import
        mock_aiohttp = MagicMock()

        # Patch sys.modules to make aiohttp import succeed
        import sys

        with patch.dict(sys.modules, {"aiohttp": mock_aiohttp}):
            # Import asyncio inside the patched context
            import asyncio

            # Mock ClientSession to raise TimeoutError
            mock_client_session = MagicMock(side_effect=asyncio.TimeoutError())
            mock_aiohttp.ClientSession = mock_client_session

            is_connected, message = await test_ollama_connection(
                "http://localhost:11434"
            )
            assert is_connected is False
            assert "timed out" in message

    @pytest.mark.asyncio
    async def test_test_ollama_connection_non_200_status(self):
        """Test test_ollama_connection with non-200 status code."""
        # Mock the aiohttp import
        mock_aiohttp = MagicMock()

        # Create a mock response with 500 status
        mock_response = AsyncMock()
        mock_response.status = 500

        # Mock the ClientSession and context manager
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)
        mock_session.get = MagicMock(return_value=mock_response)
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=None)

        mock_client_session = MagicMock(return_value=mock_session)

        mock_aiohttp.ClientSession = mock_client_session
        mock_aiohttp.ClientTimeout = MagicMock()

        # Patch sys.modules to make aiohttp import succeed
        import sys

        with patch.dict(sys.modules, {"aiohttp": mock_aiohttp}):
            is_connected, message = await test_ollama_connection(
                "http://localhost:11434"
            )
            assert is_connected is False
            assert "returned status" in message

    @pytest.mark.asyncio
    async def test_test_ollama_connection_urllib_fallback_success(self):
        """Test test_ollama_connection falls back to urllib when aiohttp not available."""
        # Mock aiohttp import to fail
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "aiohttp":
                raise ImportError("aiohttp not installed")
            return original_import(name, *args, **kwargs)

        # Mock urllib.request.urlopen to succeed
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=None)

        with patch("builtins.__import__", side_effect=mock_import):
            with patch("urllib.request.urlopen", return_value=mock_response):
                is_connected, message = await test_ollama_connection(
                    "http://localhost:11434"
                )
                assert is_connected is True
                assert "Ollama is running" in message

    @pytest.mark.asyncio
    async def test_test_ollama_connection_urllib_fallback_failure(self):
        """Test test_ollama_connection urllib fallback handles connection errors."""
        # Mock aiohttp import to fail
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "aiohttp":
                raise ImportError("aiohttp not installed")
            return original_import(name, *args, **kwargs)

        # Mock urllib.request.urlopen to raise URLError
        import urllib.error

        mock_error = urllib.error.URLError("Connection refused")

        with patch("builtins.__import__", side_effect=mock_import):
            with patch("urllib.request.urlopen", side_effect=mock_error):
                is_connected, message = await test_ollama_connection(
                    "http://localhost:11434"
                )
                assert is_connected is False
                assert "Cannot connect" in message

    @pytest.mark.asyncio
    async def test_test_ollama_connection_generic_exception_aiohttp(self):
        """Test test_ollama_connection handles generic exceptions with aiohttp."""
        # Mock the aiohttp import with proper ClientError exception
        mock_aiohttp = MagicMock()

        # Create a proper ClientError exception class
        class MockClientError(Exception):
            pass

        mock_aiohttp.ClientError = MockClientError
        mock_aiohttp.ClientTimeout = MagicMock()

        # Patch sys.modules to make aiohttp import succeed
        import sys

        with patch.dict(sys.modules, {"aiohttp": mock_aiohttp}):
            # Mock ClientSession to raise generic Exception (not ClientError)
            # This will be caught by the generic exception handler
            mock_client_session = MagicMock(
                side_effect=RuntimeError("Unexpected error")
            )
            mock_aiohttp.ClientSession = mock_client_session

            is_connected, message = await test_ollama_connection(
                "http://localhost:11434"
            )
            assert is_connected is False
            assert "Ollama connection error" in message

    @pytest.mark.asyncio
    async def test_test_ollama_connection_urllib_trailing_slash(self):
        """Test test_ollama_connection handles trailing slash in URL with urllib fallback."""
        # Mock aiohttp import to fail
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "aiohttp":
                raise ImportError("aiohttp not installed")
            return original_import(name, *args, **kwargs)

        # Mock urllib.request.urlopen to succeed
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=None)

        with patch("builtins.__import__", side_effect=mock_import):
            with patch(
                "urllib.request.urlopen", return_value=mock_response
            ) as mock_urlopen:
                is_connected, message = await test_ollama_connection(
                    "http://localhost:11434/"
                )
                assert is_connected is True
                # Verify the URL was normalized (check the Request object's full_url)
                request_obj = mock_urlopen.call_args[0][0]
                assert "api/tags" in str(request_obj.full_url)

    @pytest.mark.asyncio
    async def test_test_ollama_connection_urllib_v1_suffix_removal(self):
        """Test test_ollama_connection removes /v1 suffix in urllib fallback (line 153)."""
        # Mock aiohttp import to fail
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "aiohttp":
                raise ImportError("aiohttp not installed")
            return original_import(name, *args, **kwargs)

        # Mock urllib.request.urlopen to succeed
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=None)

        with patch("builtins.__import__", side_effect=mock_import):
            with patch(
                "urllib.request.urlopen", return_value=mock_response
            ) as mock_urlopen:
                is_connected, message = await test_ollama_connection(
                    "http://localhost:11434/v1"
                )
                assert is_connected is True
                # Verify the /v1 suffix was removed in the URL
                request_obj = mock_urlopen.call_args[0][0]
                # The URL should have /v1 removed before adding /api/tags
                assert "localhost:11434/api/tags" in str(request_obj.full_url)

    @pytest.mark.asyncio
    async def test_test_ollama_connection_urllib_non_200_status(self):
        """Test test_ollama_connection handles non-200 status in urllib fallback (line 159)."""
        # Mock aiohttp import to fail
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "aiohttp":
                raise ImportError("aiohttp not installed")
            return original_import(name, *args, **kwargs)

        # Mock urllib.request.urlopen to return 500 status
        mock_response = MagicMock()
        mock_response.status = 500
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=None)

        with patch("builtins.__import__", side_effect=mock_import):
            with patch("urllib.request.urlopen", return_value=mock_response):
                is_connected, message = await test_ollama_connection(
                    "http://localhost:11434"
                )
                assert is_connected is False
                assert "returned status" in message
                assert "500" in message

    @pytest.mark.asyncio
    async def test_test_ollama_connection_urllib_generic_exception(self):
        """Test test_ollama_connection handles generic exception in urllib fallback (lines 162-163)."""
        # Mock aiohttp import to fail
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "aiohttp":
                raise ImportError("aiohttp not installed")
            return original_import(name, *args, **kwargs)

        # Mock urllib.request.urlopen to raise generic exception
        with patch("builtins.__import__", side_effect=mock_import):
            with patch(
                "urllib.request.urlopen", side_effect=ValueError("Unexpected error")
            ):
                is_connected, message = await test_ollama_connection(
                    "http://localhost:11434"
                )
                assert is_connected is False
                assert "Ollama connection error" in message


# =============================================================================
# Test Utility Functions
# =============================================================================


class TestIsGraphitiEnabled:
    """Test is_graphiti_enabled utility function."""

    def test_is_graphiti_enabled_delegates_to_config(self):
        """Test is_graphiti_enabled delegates to graphiti_config module."""
        with patch(
            "graphiti_config.is_graphiti_enabled",
            return_value=True,
        ) as mock_enabled:
            result = is_graphiti_enabled()
            assert result is True
            mock_enabled.assert_called_once_with()


class TestGetGraphHints:
    """Test get_graph_hints utility function."""

    @pytest.mark.asyncio
    @pytest.mark.asyncio
    async def test_get_graph_hints_when_disabled(self):
        """Test get_graph_hints returns empty list when Graphiti disabled."""
        with patch(
            "graphiti_config.is_graphiti_enabled",
            return_value=False,
        ):
            hints = await get_graph_hints("test query", "project-123")
            assert hints == []

    @pytest.mark.asyncio
    async def test_get_graph_hints_success_fast(self):
        """Test get_graph_hints returns hints successfully (covers lines 85-94)."""
        # Create a mock memory instance
        mock_memory = AsyncMock()
        mock_memory.get_relevant_context.return_value = [
            {"content": "hint 1", "score": 0.9, "type": "pattern"},
            {"content": "hint 2", "score": 0.8, "type": "gotcha"},
        ]
        mock_memory.close = AsyncMock()

        # Create the GraphitiMemory mock
        mock_graphiti_memory_class = MagicMock(return_value=mock_memory)

        # Create GroupIdMode mock
        mock_group_id_mode = MagicMock()
        mock_group_id_mode.PROJECT = "project"

        # Patch at the graphiti_config level (where is_graphiti_enabled comes from)
        with patch(
            "graphiti_config.is_graphiti_enabled",
            return_value=True,
        ):
            # Patch the local imports inside the function
            with patch(
                "integrations.graphiti.memory.GraphitiMemory",
                mock_graphiti_memory_class,
            ):
                with patch(
                    "integrations.graphiti.memory.GroupIdMode",
                    mock_group_id_mode,
                ):
                    # Patch tempfile and Path to avoid file system operations
                    with patch("tempfile.mkdtemp", return_value="/tmp/spec_dir"):
                        with patch("pathlib.Path.cwd") as mock_cwd:
                            mock_cwd.return_value = MagicMock()

                            hints = await get_graph_hints(
                                "authentication patterns", "project-123", max_results=10
                            )

                            # Verify results
                            assert len(hints) == 2
                            assert hints[0]["content"] == "hint 1"
                            assert hints[1]["score"] == 0.8

                            # Verify memory.get_relevant_context was called
                            mock_memory.get_relevant_context.assert_called_once()
                            call_kwargs = (
                                mock_memory.get_relevant_context.call_args.kwargs
                            )
                            assert call_kwargs["query"] == "authentication patterns"
                            assert call_kwargs["num_results"] == 10
                            assert call_kwargs["include_project_context"] is True

                            # Verify memory.close was called
                            mock_memory.close.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.skip("Requires complex mocking of multiple imports inside function")
    async def test_get_graph_hints_success(self):
        """Test get_graph_hints returns hints successfully."""
        mock_memory = AsyncMock()
        mock_memory.get_relevant_context.return_value = [
            {"content": "hint 1", "score": 0.9, "type": "pattern"},
            {"content": "hint 2", "score": 0.8, "type": "gotcha"},
        ]
        mock_memory.close = AsyncMock()

        mock_graphiti_memory = MagicMock(return_value=mock_memory)

        with patch(
            "graphiti_config.is_graphiti_enabled",
            return_value=True,
        ):
            with patch(
                "integrations.graphiti.memory.GraphitiMemory",
                mock_graphiti_memory,
            ):
                with patch("pathlib.Path.cwd"):
                    with patch(
                        "tempfile.mkdtemp",
                        return_value="/tmp/spec_dir",
                    ):
                        with patch(
                            "integrations.graphiti.providers_pkg.utils.Path",
                            side_effect=lambda x: MagicMock(spec="Path"),
                        ):
                            hints = await get_graph_hints(
                                "authentication patterns", "project-123", max_results=10
                            )
                            assert len(hints) == 2
                            assert hints[0]["content"] == "hint 1"
                            assert hints[1]["score"] == 0.8

    @pytest.mark.asyncio
    @pytest.mark.asyncio
    async def test_get_graph_hints_import_error_returns_empty(self):
        """Test get_graph_hints returns empty list on ImportError."""
        with patch(
            "graphiti_config.is_graphiti_enabled",
            return_value=True,
        ):
            with patch(
                "integrations.graphiti.memory.GraphitiMemory",
                side_effect=ImportError("graphiti_core not installed"),
            ):
                hints = await get_graph_hints("test query", "project-123")
                assert hints == []

    @pytest.mark.asyncio
    @pytest.mark.asyncio
    async def test_get_graph_hints_exception_returns_empty(self):
        """Test get_graph_hints returns empty list on exception."""
        with patch(
            "graphiti_config.is_graphiti_enabled",
            return_value=True,
        ):
            with patch(
                "integrations.graphiti.memory.GraphitiMemory",
                side_effect=Exception("Memory creation failed"),
            ):
                hints = await get_graph_hints("test query", "project-123")
                assert hints == []

    @pytest.mark.asyncio
    @pytest.mark.skip("Requires complex mocking of multiple imports inside function")
    async def test_get_graph_hints_with_spec_dir(self):
        """Test get_graph_hints with custom spec_dir parameter."""
        from pathlib import Path

        mock_memory = AsyncMock()
        mock_memory.get_relevant_context.return_value = []
        mock_memory.close = AsyncMock()

        mock_graphiti_memory = MagicMock(return_value=mock_memory)

        spec_dir = Path("/custom/spec/dir")

        with patch(
            "graphiti_config.is_graphiti_enabled",
            return_value=True,
        ):
            with patch(
                "integrations.graphiti.memory.GraphitiMemory",
                mock_graphiti_memory,
            ):
                with patch("pathlib.Path.cwd"):
                    hints = await get_graph_hints(
                        "test query", "project-123", spec_dir=spec_dir
                    )
                    assert hints == []

    @pytest.mark.asyncio
    @pytest.mark.skip("Requires complex mocking of multiple imports inside function")
    async def test_get_graph_hints_respects_max_results(self):
        """Test get_graph_hints passes max_results parameter."""
        mock_memory = AsyncMock()
        mock_memory.get_relevant_context.return_value = []
        mock_memory.close = AsyncMock()

        mock_graphiti_memory = MagicMock(return_value=mock_memory)

        with patch(
            "graphiti_config.is_graphiti_enabled",
            return_value=True,
        ):
            with patch(
                "integrations.graphiti.memory.GraphitiMemory",
                mock_graphiti_memory,
            ):
                with patch("pathlib.Path.cwd"):
                    with patch(
                        "tempfile.mkdtemp",
                        return_value="/tmp/spec_dir",
                    ):
                        with patch(
                            "integrations.graphiti.providers_pkg.utils.Path",
                            side_effect=lambda x: MagicMock(spec="Path"),
                        ):
                            await get_graph_hints(
                                "test query", "project-123", max_results=5
                            )

                            mock_memory.get_relevant_context.assert_called_once()
                            call_kwargs = (
                                mock_memory.get_relevant_context.call_args.kwargs
                            )
                            assert call_kwargs.get("num_results") == 5
