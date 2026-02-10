"""
Unit tests for Google embedder provider.

Tests cover:
- create_google_embedder factory function
- GoogleEmbedder class (create, create_batch methods)
- ProviderNotInstalled exception handling
- ProviderError for missing configuration
"""

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from integrations.graphiti.providers_pkg.embedder_providers.google_embedder import (
    DEFAULT_GOOGLE_EMBEDDING_MODEL,
    GoogleEmbedder,
    create_google_embedder,
)
from integrations.graphiti.providers_pkg.exceptions import (
    ProviderError,
    ProviderNotInstalled,
)

# =============================================================================
# Test GoogleEmbedder class
# =============================================================================


class TestGoogleEmbedder:
    """Test GoogleEmbedder class."""

    def test_google_embedder_init_success(self):
        """Test GoogleEmbedder initializes with API key and model."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()

        # Inject mock into sys.modules before importing
        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key", model="test-model")

            assert embedder.api_key == "test-key"
            assert embedder.model == "test-model"
            mock_genai.configure.assert_called_once_with(api_key="test-key")

    def test_google_embedder_init_default_model(self):
        """Test GoogleEmbedder uses default model when not specified."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()

        # Inject mock into sys.modules before importing
        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")

            assert embedder.model == DEFAULT_GOOGLE_EMBEDDING_MODEL

    def test_google_embedder_init_import_error(self):
        """Test GoogleEmbedder raises ProviderNotInstalled on ImportError."""
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "google.generativeai" or name.startswith("google.generativeai."):
                raise ImportError("google-generativeai not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                GoogleEmbedder(api_key="test-key")

            assert "google-generativeai" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_google_embedder_create_with_string(self):
        """Test GoogleEmbedder.create with string input."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_genai.embed_content = MagicMock(
            return_value={"embedding": [0.1, 0.2, 0.3]}
        )

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")
            result = await embedder.create("test text")

            assert result == [0.1, 0.2, 0.3]

    @pytest.mark.slow
    @pytest.mark.asyncio
    async def test_google_embedder_create_with_string_slow(self):
        """Test GoogleEmbedder.create with string input (slow variant)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_genai.embed_content = MagicMock(
            return_value={"embedding": [0.1, 0.2, 0.3]}
        )

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")
            result = await embedder.create("test text")

            assert result == [0.1, 0.2, 0.3]

    @pytest.mark.asyncio
    async def test_google_embedder_create_with_list(self):
        """Test GoogleEmbedder.create with list input."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_genai.embed_content = MagicMock(
            return_value={"embedding": [0.1, 0.2, 0.3]}
        )

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")
            result = await embedder.create(["test", "text"])

            assert result == [0.1, 0.2, 0.3]

    @pytest.mark.slow
    @pytest.mark.asyncio
    async def test_google_embedder_create_with_list_slow(self):
        """Test GoogleEmbedder.create with list input (slow variant)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_genai.embed_content = MagicMock(
            return_value={"embedding": [0.1, 0.2, 0.3]}
        )

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")
            result = await embedder.create(["test", "text"])

            assert result == [0.1, 0.2, 0.3]

    @pytest.mark.asyncio
    async def test_google_embedder_create_with_non_string_list(self):
        """Test GoogleEmbedder.create with non-string list items (lines 71-73)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_genai.embed_content = MagicMock(
            return_value={"embedding": [0.1, 0.2, 0.3]}
        )

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")
            # List with non-string items - should convert to string
            result = await embedder.create([123, 456])

            assert result == [0.1, 0.2, 0.3]

    @pytest.mark.asyncio
    async def test_google_embedder_create_with_empty_list(self):
        """Test GoogleEmbedder.create with empty or invalid input (line 75)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_genai.embed_content = MagicMock(
            return_value={"embedding": [0.1, 0.2, 0.3]}
        )

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")
            # Empty list - should be converted to string
            result = await embedder.create([])

            assert result == [0.1, 0.2, 0.3]

    @pytest.mark.asyncio
    async def test_google_embedder_create_batch(self):
        """Test GoogleEmbedder.create_batch with multiple inputs (lines 100-127)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        # Mock batch embedding response - nested list for batch
        mock_genai.embed_content = MagicMock(
            return_value={"embedding": [[0.1, 0.2], [0.3, 0.4]]}
        )

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")
            result = await embedder.create_batch(["text1", "text2"])

            # Should handle nested list response (lines 122-125)
            assert len(result) == 2

    @pytest.mark.asyncio
    async def test_google_embedder_create_batch_single_response(self):
        """Test GoogleEmbedder.create_batch with single embedding response (lines 124-125)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        # Mock single embedding response (not nested)
        mock_genai.embed_content = MagicMock(
            return_value={"embedding": [0.1, 0.2, 0.3]}
        )

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")
            result = await embedder.create_batch(["text1"])

            # Should handle single embedding response (line 125)
            assert len(result) == 1
            assert result[0] == [0.1, 0.2, 0.3]

    @pytest.mark.slow
    @pytest.mark.asyncio
    async def test_google_embedder_create_batch_slow(self):
        """Test GoogleEmbedder.create_batch with multiple inputs (slow variant)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        # Mock batch embedding response
        mock_genai.embed_content = MagicMock(
            return_value={"embedding": [[0.1, 0.2], [0.3, 0.4]]}
        )

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")
            result = await embedder.create_batch(["text1", "text2"])

            assert len(result) == 2

    @pytest.mark.slow
    @pytest.mark.asyncio
    async def test_google_embedder_create_batch_large_input(self):
        """Test GoogleEmbedder.create_batch with >100 items (batching)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        # Mock batch embedding response
        mock_genai.embed_content = MagicMock(return_value={"embedding": [[0.1, 0.2]]})

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            embedder = GoogleEmbedder(api_key="test-key")
            # Create 250 items - should be split into 3 batches (100, 100, 50)
            result = await embedder.create_batch([f"text{i}" for i in range(250)])

            # Should call embed_content 3 times
            assert mock_genai.embed_content.call_count == 3


# =============================================================================
# Test create_google_embedder
# =============================================================================


class TestCreateGoogleEmbedder:
    """Test create_google_embedder factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.google_api_key = "test-google-key"
        config.google_embedding_model = None
        return config

    def test_create_google_embedder_success(self, mock_config):
        """Test create_google_embedder returns embedder with valid config."""
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.google_embedder.GoogleEmbedder",
            return_value=mock_embedder,
        ):
            result = create_google_embedder(mock_config)
            assert result == mock_embedder

    def test_create_google_embedder_missing_api_key(self, mock_config):
        """Test create_google_embedder raises ProviderError for missing API key."""
        mock_config.google_api_key = None

        with pytest.raises(ProviderError) as exc_info:
            create_google_embedder(mock_config)

        assert "GOOGLE_API_KEY" in str(exc_info.value)

    def test_create_google_embedder_with_custom_model(self, mock_config):
        """Test create_google_embedder uses custom model when specified."""
        mock_config.google_embedding_model = "custom-model"
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.google_embedder.GoogleEmbedder",
            return_value=mock_embedder,
        ) as mock_google_embedder:
            create_google_embedder(mock_config)

            mock_google_embedder.assert_called_once_with(
                api_key=mock_config.google_api_key,
                model="custom-model",
            )

    def test_create_google_embedder_with_default_model(self, mock_config):
        """Test create_google_embedder uses default model when not specified."""
        mock_config.google_embedding_model = None
        mock_embedder = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.embedder_providers.google_embedder.GoogleEmbedder",
            return_value=mock_embedder,
        ) as mock_google_embedder:
            create_google_embedder(mock_config)

            mock_google_embedder.assert_called_once_with(
                api_key=mock_config.google_api_key,
                model=DEFAULT_GOOGLE_EMBEDDING_MODEL,
            )


# =============================================================================
# Test Constants
# =============================================================================


class TestGoogleEmbedderConstants:
    """Test Google embedder constants."""

    def test_default_google_embedding_model(self):
        """Test DEFAULT_GOOGLE_EMBEDDING_MODEL is set correctly."""
        assert DEFAULT_GOOGLE_EMBEDDING_MODEL == "text-embedding-004"
