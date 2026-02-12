"""
Unit tests for Google LLM provider.

Tests cover:
- create_google_llm_client factory function
- GoogleLLMClient class (generate_response, generate_response_with_tools)
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
from integrations.graphiti.providers_pkg.llm_providers.google_llm import (
    DEFAULT_GOOGLE_LLM_MODEL,
    GoogleLLMClient,
    create_google_llm_client,
)

# =============================================================================
# Test GoogleLLMClient class
# =============================================================================


class TestGoogleLLMClient:
    """Test GoogleLLMClient class."""

    def test_google_llm_client_init_success(self):
        """Test GoogleLLMClient initializes with API key and model."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model = MagicMock()
        mock_genai.GenerativeModel = MagicMock(return_value=mock_model)

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            client = GoogleLLMClient(api_key="test-key", model="test-model")

            assert client.api_key == "test-key"
            assert client.model == "test-model"
            mock_genai.configure.assert_called_once_with(api_key="test-key")
            mock_genai.GenerativeModel.assert_called_once_with("test-model")

    def test_google_llm_client_init_default_model(self):
        """Test GoogleLLMClient uses default model when not specified."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model = MagicMock()
        mock_genai.GenerativeModel = MagicMock(return_value=mock_model)

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            client = GoogleLLMClient(api_key="test-key")

            assert client.model == DEFAULT_GOOGLE_LLM_MODEL

    def test_google_llm_client_init_import_error(self):
        """Test GoogleLLMClient raises ProviderNotInstalled on ImportError."""
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "google.generativeai" or name.startswith("google.generativeai."):
                raise ImportError("google-generativeai not installed")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            with pytest.raises(ProviderNotInstalled) as exc_info:
                GoogleLLMClient(api_key="test-key")

            assert "google-generativeai" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_google_llm_client_generate_response_with_user_message(self):
        """Test GoogleLLMClient.generate_response with user message (lines 73-133)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model = MagicMock()
        mock_genai.GenerativeModel = MagicMock(return_value=mock_model)
        mock_response = MagicMock()
        mock_response.text = "Test response"
        mock_model.generate_content = MagicMock(return_value=mock_response)

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            client = GoogleLLMClient(api_key="test-key")
            result = await client.generate_response(
                [{"role": "user", "content": "Hello"}]
            )

            assert result == "Test response"

    @pytest.mark.slow
    @pytest.mark.asyncio
    async def test_google_llm_client_generate_response_with_user_message_slow(self):
        """Test GoogleLLMClient.generate_response with user message (slow variant)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model = MagicMock()
        mock_genai.GenerativeModel = MagicMock(return_value=mock_model)
        mock_response = MagicMock()
        mock_response.text = "Test response"
        mock_model.generate_content = MagicMock(return_value=mock_response)

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            client = GoogleLLMClient(api_key="test-key")
            result = await client.generate_response(
                [{"role": "user", "content": "Hello"}]
            )

            assert result == "Test response"

    @pytest.mark.asyncio
    async def test_google_llm_client_generate_response_with_system_message(self):
        """Test GoogleLLMClient.generate_response with system instruction (lines 84-98)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model_with_sys = MagicMock()
        mock_model_without_sys = MagicMock()
        mock_genai.GenerativeModel = MagicMock(
            side_effect=[mock_model_without_sys, mock_model_with_sys]
        )
        mock_response = MagicMock()
        mock_response.text = "Test response"
        mock_model_with_sys.generate_content = MagicMock(return_value=mock_response)

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            client = GoogleLLMClient(api_key="test-key")
            result = await client.generate_response(
                [
                    {"role": "system", "content": "You are helpful"},
                    {"role": "user", "content": "Hello"},
                ]
            )

            assert result == "Test response"

    @pytest.mark.slow
    @pytest.mark.asyncio
    async def test_google_llm_client_generate_response_with_system_message_slow(self):
        """Test GoogleLLMClient.generate_response with system instruction (slow variant)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model_with_sys = MagicMock()
        mock_model_without_sys = MagicMock()
        mock_genai.GenerativeModel = MagicMock(
            side_effect=[mock_model_without_sys, mock_model_with_sys]
        )
        mock_response = MagicMock()
        mock_response.text = "Test response"
        mock_model_with_sys.generate_content = MagicMock(return_value=mock_response)

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            client = GoogleLLMClient(api_key="test-key")
            result = await client.generate_response(
                [
                    {"role": "system", "content": "You are helpful"},
                    {"role": "user", "content": "Hello"},
                ]
            )

            assert result == "Test response"

    @pytest.mark.asyncio
    async def test_google_llm_client_generate_response_with_assistant_message(self):
        """Test GoogleLLMClient.generate_response with assistant role (lines 87-88)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model = MagicMock()
        mock_genai.GenerativeModel = MagicMock(return_value=mock_model)
        mock_response = MagicMock()
        mock_response.text = "Test response"
        mock_model.generate_content = MagicMock(return_value=mock_response)

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            client = GoogleLLMClient(api_key="test-key")
            result = await client.generate_response(
                [
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "Hi there"},
                    {"role": "user", "content": "How are you?"},
                ]
            )

            assert result == "Test response"

    @pytest.mark.asyncio
    async def test_google_llm_client_generate_response_with_response_model(self):
        """Test GoogleLLMClient.generate_response with structured output (lines 103-127)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model = MagicMock()
        mock_genai.GenerativeModel = MagicMock(return_value=mock_model)
        mock_response = MagicMock()
        mock_response.text = '{"key": "value"}'
        mock_model.generate_content = MagicMock(return_value=mock_response)
        mock_genai.GenerationConfig = MagicMock()

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            from pydantic import BaseModel

            class TestModel(BaseModel):
                key: str

            client = GoogleLLMClient(api_key="test-key")
            result = await client.generate_response(
                [{"role": "user", "content": "Hello"}],
                response_model=TestModel,
            )

            assert isinstance(result, TestModel)
            assert result.key == "value"

    @pytest.mark.slow
    @pytest.mark.asyncio
    async def test_google_llm_client_generate_response_with_response_model_slow(self):
        """Test GoogleLLMClient.generate_response with structured output (slow variant)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model = MagicMock()
        mock_genai.GenerativeModel = MagicMock(return_value=mock_model)
        mock_response = MagicMock()
        mock_response.text = '{"key": "value"}'
        mock_model.generate_content = MagicMock(return_value=mock_response)
        mock_genai.GenerationConfig = MagicMock()

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            from pydantic import BaseModel

            class TestModel(BaseModel):
                key: str

            client = GoogleLLMClient(api_key="test-key")
            result = await client.generate_response(
                [{"role": "user", "content": "Hello"}],
                response_model=TestModel,
            )

            assert isinstance(result, TestModel)
            assert result.key == "value"

    @pytest.mark.asyncio
    async def test_google_llm_client_generate_response_json_decode_error(self):
        """Test GoogleLLMClient.generate_response with JSON decode error (lines 122-127)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model = MagicMock()
        mock_genai.GenerativeModel = MagicMock(return_value=mock_model)
        mock_response = MagicMock()
        mock_response.text = "Not valid JSON"
        mock_model.generate_content = MagicMock(return_value=mock_response)
        mock_genai.GenerationConfig = MagicMock()

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            from pydantic import BaseModel

            class TestModel(BaseModel):
                key: str

            client = GoogleLLMClient(api_key="test-key")
            result = await client.generate_response(
                [{"role": "user", "content": "Hello"}],
                response_model=TestModel,
            )

            # Should return raw text when JSON parsing fails
            assert result == "Not valid JSON"

    @pytest.mark.asyncio
    async def test_google_llm_client_generate_response_with_tools(self):
        """Test GoogleLLMClient.generate_response_with_tools (lines 155-160)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model = MagicMock()
        mock_genai.GenerativeModel = MagicMock(return_value=mock_model)
        mock_response = MagicMock()
        mock_response.text = "Test response"
        mock_model.generate_content = MagicMock(return_value=mock_response)

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            client = GoogleLLMClient(api_key="test-key")

            with patch(
                "integrations.graphiti.providers_pkg.llm_providers.google_llm.logger"
            ) as mock_logger:
                result = await client.generate_response_with_tools(
                    [{"role": "user", "content": "Hello"}],
                    tools=[{"name": "test_tool"}],
                )

                # Should log warning about tools not being supported
                mock_logger.warning.assert_called_once()
                assert "does not yet support tool calling" in str(
                    mock_logger.warning.call_args
                )
                assert result == "Test response"

    @pytest.mark.slow
    @pytest.mark.asyncio
    async def test_google_llm_client_generate_response_with_tools_slow(self):
        """Test GoogleLLMClient.generate_response_with_tools (slow variant)."""
        mock_genai = MagicMock()
        mock_genai.configure = MagicMock()
        mock_model = MagicMock()
        mock_genai.GenerativeModel = MagicMock(return_value=mock_model)
        mock_response = MagicMock()
        mock_response.text = "Test response"
        mock_model.generate_content = MagicMock(return_value=mock_response)

        with patch.dict(sys.modules, {"google.generativeai": mock_genai}):
            client = GoogleLLMClient(api_key="test-key")

            with patch(
                "integrations.graphiti.providers_pkg.llm_providers.google_llm.logger"
            ) as mock_logger:
                result = await client.generate_response_with_tools(
                    [{"role": "user", "content": "Hello"}],
                    tools=[{"name": "test_tool"}],
                )

                mock_logger.warning.assert_called_once()
                assert "does not yet support tool calling" in str(
                    mock_logger.warning.call_args
                )
                assert result == "Test response"


# =============================================================================
# Test create_google_llm_client
# =============================================================================


class TestCreateGoogleLLMClient:
    """Test create_google_llm_client factory function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock GraphitiConfig."""
        config = MagicMock()
        config.google_api_key = "test-google-key"
        config.google_llm_model = None
        return config

    def test_create_google_llm_client_success(self, mock_config):
        """Test create_google_llm_client returns client with valid config."""
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.google_llm.GoogleLLMClient",
            return_value=mock_client,
        ):
            result = create_google_llm_client(mock_config)
            assert result == mock_client

    def test_create_google_llm_client_missing_api_key(self, mock_config):
        """Test create_google_llm_client raises ProviderError for missing API key."""
        mock_config.google_api_key = None

        with pytest.raises(ProviderError) as exc_info:
            create_google_llm_client(mock_config)

        assert "GOOGLE_API_KEY" in str(exc_info.value)

    def test_create_google_llm_client_with_custom_model(self, mock_config):
        """Test create_google_llm_client uses custom model when specified."""
        mock_config.google_llm_model = "custom-model"
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.google_llm.GoogleLLMClient",
            return_value=mock_client,
        ) as mock_google_client:
            create_google_llm_client(mock_config)

            mock_google_client.assert_called_once_with(
                api_key=mock_config.google_api_key,
                model="custom-model",
            )

    def test_create_google_llm_client_with_default_model(self, mock_config):
        """Test create_google_llm_client uses default model when not specified."""
        mock_config.google_llm_model = None
        mock_client = MagicMock()

        with patch(
            "integrations.graphiti.providers_pkg.llm_providers.google_llm.GoogleLLMClient",
            return_value=mock_client,
        ) as mock_google_client:
            create_google_llm_client(mock_config)

            mock_google_client.assert_called_once_with(
                api_key=mock_config.google_api_key,
                model=DEFAULT_GOOGLE_LLM_MODEL,
            )


# =============================================================================
# Test Constants
# =============================================================================


class TestGoogleLLMConstants:
    """Test Google LLM constants."""

    def test_default_google_llm_model(self):
        """Test DEFAULT_GOOGLE_LLM_MODEL is set correctly."""
        assert DEFAULT_GOOGLE_LLM_MODEL == "gemini-2.0-flash"
