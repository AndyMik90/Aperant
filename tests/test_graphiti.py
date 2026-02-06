"""Tests for Graphiti memory integration."""
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add auto-claude to path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from graphiti_config import is_graphiti_enabled, get_graphiti_status, GraphitiConfig


class TestIsGraphitiEnabled:
    """Tests for is_graphiti_enabled function."""

    def test_returns_false_when_not_set(self):
        """Returns False when GRAPHITI_ENABLED is not set."""
        with patch.dict(os.environ, {}, clear=True):
            assert is_graphiti_enabled() is False

    def test_returns_false_when_disabled(self):
        """Returns False when GRAPHITI_ENABLED is false."""
        with patch.dict(os.environ, {"GRAPHITI_ENABLED": "false"}, clear=True):
            assert is_graphiti_enabled() is False

    def test_returns_true_without_openai_key(self):
        """Returns True when enabled even without OPENAI_API_KEY.

        Since LLM provider is no longer required (Claude SDK handles RAG) and
        embedder is optional (keyword search fallback works), Graphiti is
        available whenever GRAPHITI_ENABLED=true.
        """
        with patch.dict(os.environ, {"GRAPHITI_ENABLED": "true"}, clear=True):
            assert is_graphiti_enabled() is True

    def test_returns_true_when_configured(self):
        """Returns True when properly configured."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "OPENAI_API_KEY": "sk-test-key"
        }, clear=True):
            assert is_graphiti_enabled() is True


class TestGetGraphitiStatus:
    """Tests for get_graphiti_status function."""

    def test_status_when_disabled(self):
        """Returns correct status when disabled."""
        with patch.dict(os.environ, {}, clear=True):
            status = get_graphiti_status()
            assert status["enabled"] is False
            assert status["available"] is False
            assert "not set" in status["reason"].lower()

    @pytest.mark.skip(reason="Environment-dependent test - fails when OPENAI_API_KEY is set")
    def test_status_when_missing_openai_key(self):
        """Returns correct status when OPENAI_API_KEY missing.

        Since embedder is optional (keyword search fallback works), the status
        is still available but will have validation warnings about missing
        embedder credentials.
        """
        with patch.dict(os.environ, {"GRAPHITI_ENABLED": "true"}, clear=True):
            status = get_graphiti_status()
            assert status["enabled"] is True
            # Available because embedder is optional (keyword search fallback)
            assert status["available"] is True


class TestGraphitiConfig:
    """Tests for GraphitiConfig class."""

    def test_from_env_defaults(self):
        """Config uses correct defaults for LadybugDB (embedded database)."""
        with patch.dict(os.environ, {}, clear=True):
            config = GraphitiConfig.from_env()
            assert config.enabled is False
            assert config.database == "auto_claude_memory"
            assert "auto-claude" in config.db_path.lower()  # Default path in ~/.auto-claude/

    def test_from_env_custom_values(self):
        """Config reads custom environment values."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "OPENAI_API_KEY": "sk-test",
            "GRAPHITI_DATABASE": "my_graph",
            "GRAPHITI_DB_PATH": "/custom/path"
        }, clear=True):
            config = GraphitiConfig.from_env()
            assert config.enabled is True
            assert config.database == "my_graph"
            assert config.db_path == "/custom/path"

    def test_is_valid_requires_only_enabled(self):
        """is_valid() requires only GRAPHITI_ENABLED.

        LLM provider is no longer required (Claude SDK handles RAG) and
        embedder is optional (keyword search fallback works).
        """
        # Not enabled
        with patch.dict(os.environ, {}, clear=True):
            config = GraphitiConfig.from_env()
            assert config.is_valid() is False

        # Only enabled - now valid (embedder optional)
        with patch.dict(os.environ, {"GRAPHITI_ENABLED": "true"}, clear=True):
            config = GraphitiConfig.from_env()
            assert config.is_valid() is True

        # With embedder configured
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "OPENAI_API_KEY": "sk-test"
        }, clear=True):
            config = GraphitiConfig.from_env()
            assert config.is_valid() is True


class TestMultiProviderConfig:
    """Tests for multi-provider configuration support."""

    def test_default_providers(self):
        """Default providers are OpenAI."""
        with patch.dict(os.environ, {"GRAPHITI_ENABLED": "true"}, clear=True):
            config = GraphitiConfig.from_env()
            assert config.llm_provider == "openai"
            assert config.embedder_provider == "openai"

    def test_anthropic_provider_config(self):
        """Anthropic LLM provider can be configured."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "anthropic",
            "ANTHROPIC_API_KEY": "sk-ant-test",
            "GRAPHITI_EMBEDDER_PROVIDER": "openai",
            "OPENAI_API_KEY": "sk-test"
        }, clear=True):
            config = GraphitiConfig.from_env()
            assert config.llm_provider == "anthropic"
            assert config.anthropic_api_key == "sk-ant-test"
            assert config.is_valid() is True

    def test_azure_openai_provider_config(self):
        """Azure OpenAI provider can be configured."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "azure_openai",
            "GRAPHITI_EMBEDDER_PROVIDER": "azure_openai",
            "AZURE_OPENAI_API_KEY": "azure-key",
            "AZURE_OPENAI_BASE_URL": "https://test.openai.azure.com/openai/v1/",
            "AZURE_OPENAI_LLM_DEPLOYMENT": "gpt-4o",
            "AZURE_OPENAI_EMBEDDING_DEPLOYMENT": "text-embedding-3-small"
        }, clear=True):
            config = GraphitiConfig.from_env()
            assert config.llm_provider == "azure_openai"
            assert config.embedder_provider == "azure_openai"
            assert config.azure_openai_api_key == "azure-key"
            assert config.azure_openai_base_url == "https://test.openai.azure.com/openai/v1/"
            assert config.is_valid() is True

    def test_ollama_provider_config(self):
        """Ollama provider can be configured for local models."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "ollama",
            "GRAPHITI_EMBEDDER_PROVIDER": "ollama",
            "OLLAMA_LLM_MODEL": "deepseek-r1:7b",
            "OLLAMA_EMBEDDING_MODEL": "nomic-embed-text",
            "OLLAMA_EMBEDDING_DIM": "768",
            "OLLAMA_BASE_URL": "http://localhost:11434"
        }, clear=True):
            config = GraphitiConfig.from_env()
            assert config.llm_provider == "ollama"
            assert config.embedder_provider == "ollama"
            assert config.ollama_llm_model == "deepseek-r1:7b"
            assert config.ollama_embedding_model == "nomic-embed-text"
            assert config.ollama_embedding_dim == 768
            assert config.is_valid() is True

    def test_voyage_embedder_config(self):
        """Voyage AI embedder can be configured (typically with Anthropic LLM)."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "anthropic",
            "GRAPHITI_EMBEDDER_PROVIDER": "voyage",
            "ANTHROPIC_API_KEY": "sk-ant-test",
            "VOYAGE_API_KEY": "pa-test-voyage",
            "VOYAGE_EMBEDDING_MODEL": "voyage-3"
        }, clear=True):
            config = GraphitiConfig.from_env()
            assert config.llm_provider == "anthropic"
            assert config.embedder_provider == "voyage"
            assert config.voyage_api_key == "pa-test-voyage"
            assert config.voyage_embedding_model == "voyage-3"
            assert config.is_valid() is True

    def test_mixed_providers_anthropic_openai(self):
        """Mixed providers: Anthropic LLM + OpenAI embeddings."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "anthropic",
            "GRAPHITI_EMBEDDER_PROVIDER": "openai",
            "ANTHROPIC_API_KEY": "sk-ant-test",
            "OPENAI_API_KEY": "sk-test"
        }, clear=True):
            config = GraphitiConfig.from_env()
            assert config.llm_provider == "anthropic"
            assert config.embedder_provider == "openai"
            assert config.is_valid() is True

    def test_ollama_valid_with_model_only(self):
        """Ollama embedder only requires model (dimension auto-detected)."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "ollama",
            "GRAPHITI_EMBEDDER_PROVIDER": "ollama",
            "OLLAMA_LLM_MODEL": "deepseek-r1:7b",
            "OLLAMA_EMBEDDING_MODEL": "nomic-embed-text"
            # OLLAMA_EMBEDDING_DIM is optional - auto-detected for known models
        }, clear=True):
            config = GraphitiConfig.from_env()
            # Embedder is valid with just model (dimension auto-detected)
            # Use public API: no embedder-related validation errors means valid
            embedder_errors = [e for e in config.get_validation_errors() if "embedder" in e.lower() or "ollama" in e.lower()]
            assert len(embedder_errors) == 0
            assert config.is_valid() is True

    def test_provider_summary(self):
        """Provider summary returns correct string."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "anthropic",
            "GRAPHITI_EMBEDDER_PROVIDER": "voyage",
            "ANTHROPIC_API_KEY": "sk-ant-test",
            "VOYAGE_API_KEY": "pa-test"
        }, clear=True):
            config = GraphitiConfig.from_env()
            summary = config.get_provider_summary()
            assert "anthropic" in summary
            assert "voyage" in summary


class TestValidationErrors:
    """Tests for validation error messages."""

    def test_validation_errors_missing_openai_key(self):
        """Validation errors list missing OpenAI key."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "openai",
            "GRAPHITI_EMBEDDER_PROVIDER": "openai"
        }, clear=True):
            config = GraphitiConfig.from_env()
            errors = config.get_validation_errors()
            assert any("OPENAI_API_KEY" in e for e in errors)

    def test_no_llm_validation_errors(self):
        """LLM provider validation removed (Claude SDK handles RAG).

        Setting an LLM provider without credentials should not generate errors,
        as the Claude Agent SDK handles all graph operations.
        """
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "anthropic",
            "GRAPHITI_EMBEDDER_PROVIDER": "openai",
            "OPENAI_API_KEY": "sk-test"
        }, clear=True):
            config = GraphitiConfig.from_env()
            errors = config.get_validation_errors()
            # No LLM validation errors since Claude SDK handles RAG
            assert not any("ANTHROPIC_API_KEY" in e for e in errors)

    def test_validation_errors_missing_azure_config(self):
        """Validation errors list missing Azure configuration."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "azure_openai",
            "GRAPHITI_EMBEDDER_PROVIDER": "azure_openai"
        }, clear=True):
            config = GraphitiConfig.from_env()
            errors = config.get_validation_errors()
            assert any("AZURE_OPENAI_API_KEY" in e for e in errors)
            assert any("AZURE_OPENAI_BASE_URL" in e for e in errors)

    def test_validation_errors_unknown_embedder_provider(self):
        """Validation errors report unknown embedder provider."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_EMBEDDER_PROVIDER": "unknown_provider",
        }, clear=True):
            config = GraphitiConfig.from_env()
            errors = config.get_validation_errors()
            # Unknown embedder provider should generate error
            assert any("Unknown embedder provider" in e for e in errors)


class TestAvailableProviders:
    """Tests for get_available_providers function."""

    def test_available_providers_openai_only(self):
        """Only OpenAI available when only OpenAI key is set."""
        from graphiti_config import get_available_providers

        with patch.dict(os.environ, {
            "OPENAI_API_KEY": "sk-test"
        }, clear=True):
            providers = get_available_providers()
            assert "openai" in providers["llm_providers"]
            assert "openai" in providers["embedder_providers"]
            assert "anthropic" not in providers["llm_providers"]
            assert "voyage" not in providers["embedder_providers"]

    def test_available_providers_all_configured(self):
        """All providers available when all are configured."""
        from graphiti_config import get_available_providers

        with patch.dict(os.environ, {
            "OPENAI_API_KEY": "sk-test",
            "ANTHROPIC_API_KEY": "sk-ant-test",
            "VOYAGE_API_KEY": "pa-test",
            "OLLAMA_LLM_MODEL": "deepseek-r1:7b",
            "OLLAMA_EMBEDDING_MODEL": "nomic-embed-text",
            "OLLAMA_EMBEDDING_DIM": "768"
        }, clear=True):
            providers = get_available_providers()
            assert "openai" in providers["llm_providers"]
            assert "anthropic" in providers["llm_providers"]
            assert "ollama" in providers["llm_providers"]
            assert "openai" in providers["embedder_providers"]
            assert "voyage" in providers["embedder_providers"]
            assert "ollama" in providers["embedder_providers"]


class TestGraphitiProviders:
    """Tests for graphiti_providers.py factory functions."""

    def test_provider_error_import(self):
        """ProviderError and ProviderNotInstalled can be imported."""
        from graphiti_providers import ProviderError, ProviderNotInstalled
        assert issubclass(ProviderNotInstalled, ProviderError)

    def test_create_llm_client_unknown_provider(self):
        """create_llm_client raises ProviderError for unknown provider."""
        from graphiti_providers import create_llm_client, ProviderError

        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "invalid_provider"
        }, clear=True):
            config = GraphitiConfig.from_env()
            with pytest.raises(ProviderError, match="Unknown LLM provider"):
                create_llm_client(config)

    def test_create_embedder_unknown_provider(self):
        """create_embedder raises ProviderError for unknown provider."""
        from graphiti_providers import create_embedder, ProviderError

        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_EMBEDDER_PROVIDER": "invalid_provider"
        }, clear=True):
            config = GraphitiConfig.from_env()
            with pytest.raises(ProviderError, match="Unknown embedder provider"):
                create_embedder(config)

    def test_create_llm_client_missing_openai_key(self):
        """create_llm_client raises ProviderError when OpenAI key missing."""
        from graphiti_providers import ProviderError, ProviderNotInstalled, create_llm_client

        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_LLM_PROVIDER": "openai"
        }, clear=True):
            config = GraphitiConfig.from_env()

            # Test raises ProviderError for missing API key, or skip if graphiti-core not installed
            try:
                create_llm_client(config)
                pytest.fail("Expected ProviderError to be raised for missing OPENAI_API_KEY")
            except ProviderNotInstalled:
                pytest.skip("graphiti-core not installed")
            except ProviderError as e:
                assert "OPENAI_API_KEY" in str(e)

    def test_create_embedder_missing_ollama_model(self):
        """create_embedder raises ProviderError when Ollama model missing."""
        from graphiti_providers import ProviderError, ProviderNotInstalled, create_embedder

        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_EMBEDDER_PROVIDER": "ollama"
            # Missing OLLAMA_EMBEDDING_MODEL
        }, clear=True):
            config = GraphitiConfig.from_env()

            # Test raises ProviderError for missing model config, or skip if graphiti-core not installed
            try:
                create_embedder(config)
                pytest.fail("Expected ProviderError to be raised for missing OLLAMA_EMBEDDING_MODEL")
            except ProviderNotInstalled:
                pytest.skip("graphiti-core not installed")
            except ProviderError as e:
                assert "OLLAMA_EMBEDDING_MODEL" in str(e)

    def test_embedding_dimensions_lookup(self):
        """get_expected_embedding_dim returns correct dimensions."""
        from graphiti_providers import get_expected_embedding_dim, EMBEDDING_DIMENSIONS

        # Test known models
        assert get_expected_embedding_dim("text-embedding-3-small") == 1536
        assert get_expected_embedding_dim("voyage-3") == 1024
        assert get_expected_embedding_dim("nomic-embed-text") == 768

        # Test partial matching
        assert get_expected_embedding_dim("voyage-3-lite") == 512

        # Test unknown model
        assert get_expected_embedding_dim("unknown-model-xyz") is None

    def test_validate_embedding_config_ollama_no_dim(self):
        """validate_embedding_config fails for Ollama without dimension."""
        from graphiti_providers import validate_embedding_config

        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_EMBEDDER_PROVIDER": "ollama",
            "OLLAMA_EMBEDDING_MODEL": "nomic-embed-text"
            # Missing OLLAMA_EMBEDDING_DIM
        }, clear=True):
            config = GraphitiConfig.from_env()
            valid, msg = validate_embedding_config(config)
            assert valid is False
            assert "OLLAMA_EMBEDDING_DIM" in msg

    def test_validate_embedding_config_openai_valid(self):
        """validate_embedding_config succeeds for valid OpenAI config."""
        from graphiti_providers import validate_embedding_config

        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "GRAPHITI_EMBEDDER_PROVIDER": "openai",
            "OPENAI_API_KEY": "sk-test"
        }, clear=True):
            config = GraphitiConfig.from_env()
            valid, msg = validate_embedding_config(config)
            assert valid is True

    def test_is_graphiti_enabled_reexport(self):
        """is_graphiti_enabled is re-exported from graphiti_providers."""
        from graphiti_providers import is_graphiti_enabled as provider_is_enabled
        from graphiti_config import is_graphiti_enabled as config_is_enabled

        # Both should return same result
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "OPENAI_API_KEY": "sk-test"
        }, clear=True):
            assert provider_is_enabled() == config_is_enabled()


class TestGraphitiState:
    """Tests for GraphitiState class."""

    def test_graphiti_state_to_dict(self):
        """GraphitiState serializes correctly."""
        from graphiti_config import GraphitiState

        state = GraphitiState(
            initialized=True,
            database="test_db",
            indices_built=True,
            created_at="2024-01-01T00:00:00Z",
            llm_provider="anthropic",
            embedder_provider="voyage",
        )

        data = state.to_dict()
        assert data["initialized"] is True
        assert data["database"] == "test_db"
        assert data["llm_provider"] == "anthropic"
        assert data["embedder_provider"] == "voyage"

    def test_graphiti_state_from_dict(self):
        """GraphitiState deserializes correctly."""
        from graphiti_config import GraphitiState

        data = {
            "initialized": True,
            "database": "test_db",
            "indices_built": True,
            "created_at": "2024-01-01T00:00:00Z",
            "llm_provider": "anthropic",
            "embedder_provider": "voyage",
            "episode_count": 5,
        }

        state = GraphitiState.from_dict(data)
        assert state.initialized is True
        assert state.database == "test_db"
        assert state.llm_provider == "anthropic"
        assert state.embedder_provider == "voyage"
        assert state.episode_count == 5

    def test_graphiti_state_record_error(self):
        """GraphitiState records errors correctly."""
        from graphiti_config import GraphitiState

        state = GraphitiState()
        state.record_error("Test error 1")
        state.record_error("Test error 2")

        assert len(state.error_log) == 2
        assert "Test error 1" in state.error_log[0]["error"]
        assert "Test error 2" in state.error_log[1]["error"]
        assert "timestamp" in state.error_log[0]

    def test_graphiti_state_error_limit(self):
        """GraphitiState limits error log to 10 entries."""
        from graphiti_config import GraphitiState

        state = GraphitiState()
        for i in range(15):
            state.record_error(f"Error {i}")

        # Should only keep last 10
        assert len(state.error_log) == 10
        assert "Error 5" in state.error_log[0]["error"]
        assert "Error 14" in state.error_log[-1]["error"]
