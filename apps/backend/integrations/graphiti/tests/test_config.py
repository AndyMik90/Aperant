"""
Tests for Graphiti memory integration configuration.

Tests cover:
- GraphitiConfig.from_env() with various providers
- GraphitiConfig.is_valid()
- GraphitiConfig.get_validation_errors()
- GraphitiConfig.get_embedding_dimension()
- GraphitiConfig.get_provider_signature()
- GraphitiConfig.get_provider_specific_database_name()
- GraphitiState serialization and provider migration
- Module-level functions
"""

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from integrations.graphiti.config import (
    DEFAULT_DATABASE,
    DEFAULT_DB_PATH,
    DEFAULT_OLLAMA_BASE_URL,
    EPISODE_TYPE_CODEBASE_DISCOVERY,
    EPISODE_TYPE_GOTCHA,
    EPISODE_TYPE_HISTORICAL_CONTEXT,
    EPISODE_TYPE_PATTERN,
    EPISODE_TYPE_QA_RESULT,
    EPISODE_TYPE_SESSION_INSIGHT,
    EPISODE_TYPE_TASK_OUTCOME,
    EmbedderProvider,
    GraphitiConfig,
    GraphitiState,
    LLMProvider,
    get_available_providers,
    get_graphiti_status,
    is_graphiti_enabled,
    validate_graphiti_config,
)


class TestGraphitiConfigDefaults:
    """Test default configuration values."""

    def test_default_values(self):
        """Test GraphitiConfig dataclass defaults."""
        config = GraphitiConfig()

        assert config.enabled is False
        assert config.llm_provider == "openai"
        assert config.embedder_provider == "openai"
        assert config.database == DEFAULT_DATABASE
        assert config.db_path == DEFAULT_DB_PATH


class TestGraphitiConfigFromEnv:
    """Test GraphitiConfig.from_env() method."""

    @pytest.fixture
    def clean_env(self):
        """Fixture to ensure clean environment for each test."""
        # Store original env vars
        original = {}
        env_keys = [
            "GRAPHITI_ENABLED",
            "GRAPHITI_LLM_PROVIDER",
            "GRAPHITI_EMBEDDER_PROVIDER",
            "GRAPHITI_DATABASE",
            "GRAPHITI_DB_PATH",
            "OPENAI_API_KEY",
            "OPENAI_MODEL",
            "OPENAI_EMBEDDING_MODEL",
            "ANTHROPIC_API_KEY",
            "GRAPHITI_ANTHROPIC_MODEL",
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_BASE_URL",
            "AZURE_OPENAI_LLM_DEPLOYMENT",
            "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
            "VOYAGE_API_KEY",
            "VOYAGE_EMBEDDING_MODEL",
            "GOOGLE_API_KEY",
            "GOOGLE_LLM_MODEL",
            "GOOGLE_EMBEDDING_MODEL",
            "OPENROUTER_API_KEY",
            "OPENROUTER_BASE_URL",
            "OPENROUTER_LLM_MODEL",
            "OPENROUTER_EMBEDDING_MODEL",
            "OLLAMA_BASE_URL",
            "OLLAMA_LLM_MODEL",
            "OLLAMA_EMBEDDING_MODEL",
            "OLLAMA_EMBEDDING_DIM",
        ]

        for key in env_keys:
            original[key] = os.environ.get(key)
            if key in os.environ:
                os.environ.pop(key)

        yield

        # Restore original env vars
        for key, value in original.items():
            if value is not None:
                os.environ[key] = value

    def test_from_env_defaults(self, clean_env):
        """Test from_env with no environment variables set."""
        config = GraphitiConfig.from_env()

        assert config.enabled is False
        assert config.llm_provider == "openai"
        assert config.embedder_provider == "openai"
        assert config.database == DEFAULT_DATABASE
        assert config.db_path == DEFAULT_DB_PATH
        assert config.openai_api_key == ""
        assert config.openai_model == "gpt-5-mini"
        assert config.openai_embedding_model == "text-embedding-3-small"

    @pytest.mark.parametrize(
        "enabled_value,expected",
        [
            ("true", True),
            ("True", True),
            ("TRUE", True),
            ("1", True),
            ("yes", True),
            ("Yes", True),
            ("false", False),
            ("False", False),
            ("0", False),
            ("no", False),
            ("", False),
        ],
    )
    def test_from_env_enabled_values(self, clean_env, enabled_value, expected):
        """Test various GRAPHITI_ENABLED values."""
        os.environ["GRAPHITI_ENABLED"] = enabled_value
        config = GraphitiConfig.from_env()

        assert config.enabled is expected

    @pytest.mark.parametrize(
        "llm_provider,embedder_provider",
        [
            ("openai", "openai"),
            ("anthropic", "voyage"),
            ("azure_openai", "azure_openai"),
            ("ollama", "ollama"),
            ("google", "google"),
            ("openrouter", "openrouter"),
        ],
    )
    def test_from_env_providers(self, clean_env, llm_provider, embedder_provider):
        """Test from_env with different providers."""
        os.environ["GRAPHITI_ENABLED"] = "true"
        os.environ["GRAPHITI_LLM_PROVIDER"] = llm_provider
        os.environ["GRAPHITI_EMBEDDER_PROVIDER"] = embedder_provider

        config = GraphitiConfig.from_env()

        assert config.llm_provider == llm_provider
        assert config.embedder_provider == embedder_provider

    def test_from_env_openai(self, clean_env):
        """Test OpenAI provider configuration."""
        os.environ["GRAPHITI_ENABLED"] = "true"
        os.environ["OPENAI_API_KEY"] = "sk-test-key"
        os.environ["OPENAI_MODEL"] = "gpt-4"
        os.environ["OPENAI_EMBEDDING_MODEL"] = "text-embedding-3-large"

        config = GraphitiConfig.from_env()

        assert config.openai_api_key == "sk-test-key"
        assert config.openai_model == "gpt-4"
        assert config.openai_embedding_model == "text-embedding-3-large"

    def test_from_env_anthropic(self, clean_env):
        """Test Anthropic provider configuration."""
        os.environ["GRAPHITI_ENABLED"] = "true"
        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test-key"
        os.environ["GRAPHITI_ANTHROPIC_MODEL"] = "claude-3-5-sonnet-20241022"

        config = GraphitiConfig.from_env()

        assert config.anthropic_api_key == "sk-ant-test-key"
        assert config.anthropic_model == "claude-3-5-sonnet-20241022"

    def test_from_env_azure_openai(self, clean_env):
        """Test Azure OpenAI provider configuration."""
        os.environ["GRAPHITI_ENABLED"] = "true"
        os.environ["AZURE_OPENAI_API_KEY"] = "azure-test-key"
        os.environ["AZURE_OPENAI_BASE_URL"] = "https://test.openai.azure.com"
        os.environ["AZURE_OPENAI_LLM_DEPLOYMENT"] = "gpt-4-deployment"
        os.environ["AZURE_OPENAI_EMBEDDING_DEPLOYMENT"] = "embedding-deployment"

        config = GraphitiConfig.from_env()

        assert config.azure_openai_api_key == "azure-test-key"
        assert config.azure_openai_base_url == "https://test.openai.azure.com"
        assert config.azure_openai_llm_deployment == "gpt-4-deployment"
        assert config.azure_openai_embedding_deployment == "embedding-deployment"

    def test_from_env_voyage(self, clean_env):
        """Test Voyage AI provider configuration."""
        os.environ["GRAPHITI_ENABLED"] = "true"
        os.environ["VOYAGE_API_KEY"] = "voyage-test-key"
        os.environ["VOYAGE_EMBEDDING_MODEL"] = "voyage-3-lite"

        config = GraphitiConfig.from_env()

        assert config.voyage_api_key == "voyage-test-key"
        assert config.voyage_embedding_model == "voyage-3-lite"

    def test_from_env_google(self, clean_env):
        """Test Google AI provider configuration."""
        os.environ["GRAPHITI_ENABLED"] = "true"
        os.environ["GOOGLE_API_KEY"] = "google-test-key"
        os.environ["GOOGLE_LLM_MODEL"] = "gemini-1.5-pro"
        os.environ["GOOGLE_EMBEDDING_MODEL"] = "text-embedding-004"

        config = GraphitiConfig.from_env()

        assert config.google_api_key == "google-test-key"
        assert config.google_llm_model == "gemini-1.5-pro"
        assert config.google_embedding_model == "text-embedding-004"

    def test_from_env_openrouter(self, clean_env):
        """Test OpenRouter provider configuration."""
        os.environ["GRAPHITI_ENABLED"] = "true"
        os.environ["OPENROUTER_API_KEY"] = "or-test-key"
        os.environ["OPENROUTER_BASE_URL"] = "https://openrouter.ai/api/v1"
        os.environ["OPENROUTER_LLM_MODEL"] = "anthropic/claude-3-opus"
        os.environ["OPENROUTER_EMBEDDING_MODEL"] = "openai/text-embedding-3-large"

        config = GraphitiConfig.from_env()

        assert config.openrouter_api_key == "or-test-key"
        assert config.openrouter_base_url == "https://openrouter.ai/api/v1"
        assert config.openrouter_llm_model == "anthropic/claude-3-opus"
        assert config.openrouter_embedding_model == "openai/text-embedding-3-large"

    def test_from_env_ollama(self, clean_env):
        """Test Ollama provider configuration."""
        os.environ["GRAPHITI_ENABLED"] = "true"
        os.environ["OLLAMA_BASE_URL"] = "http://localhost:11434"
        os.environ["OLLAMA_LLM_MODEL"] = "deepseek-r1:7b"
        os.environ["OLLAMA_EMBEDDING_MODEL"] = "nomic-embed-text"
        os.environ["OLLAMA_EMBEDDING_DIM"] = "768"

        config = GraphitiConfig.from_env()

        assert config.ollama_base_url == "http://localhost:11434"
        assert config.ollama_llm_model == "deepseek-r1:7b"
        assert config.ollama_embedding_model == "nomic-embed-text"
        assert config.ollama_embedding_dim == 768

    def test_from_env_database_settings(self, clean_env):
        """Test custom database settings."""
        os.environ["GRAPHITI_DATABASE"] = "custom_memory"
        os.environ["GRAPHITI_DB_PATH"] = "/custom/path"

        config = GraphitiConfig.from_env()

        assert config.database == "custom_memory"
        assert config.db_path == "/custom/path"

    def test_from_env_ollama_dimension_invalid(self, clean_env):
        """Test Ollama embedding dimension with invalid value."""
        os.environ["OLLAMA_EMBEDDING_DIM"] = "invalid"

        config = GraphitiConfig.from_env()

        assert config.ollama_embedding_dim == 0


class TestGraphitiConfigIsValid:
    """Test GraphitiConfig.is_valid() method."""

    def test_is_valid_not_enabled(self):
        """Test is_valid returns False when not enabled."""
        config = GraphitiConfig(enabled=False)
        assert config.is_valid() is False

    def test_is_valid_enabled(self):
        """Test is_valid returns True when enabled."""
        config = GraphitiConfig(enabled=True)
        assert config.is_valid() is True

    @pytest.mark.parametrize(
        "embedder_provider,api_key_field",
        [
            ("openai", "openai_api_key"),
            ("voyage", "voyage_api_key"),
            ("google", "google_api_key"),
            ("openrouter", "openrouter_api_key"),
        ],
    )
    def test_is_valid_with_embedder(self, embedder_provider, api_key_field):
        """Test is_valid with various embedder providers."""
        config = GraphitiConfig(enabled=True, embedder_provider=embedder_provider)
        setattr(config, api_key_field, "test-key")

        assert config.is_valid() is True


class TestGraphitiConfigValidateEmbedderProvider:
    """Test GraphitiConfig._validate_embedder_provider() private method."""

    def test_validate_embedder_provider_openai_valid(self):
        """Test _validate_embedder_provider returns True for OpenAI with API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="openai", openai_api_key="sk-test-key"
        )
        assert config._validate_embedder_provider() is True

    def test_validate_embedder_provider_openai_invalid(self):
        """Test _validate_embedder_provider returns False for OpenAI without API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="openai", openai_api_key=""
        )
        assert config._validate_embedder_provider() is False

    def test_validate_embedder_provider_voyage_valid(self):
        """Test _validate_embedder_provider returns True for Voyage with API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="voyage", voyage_api_key="voyage-test-key"
        )
        assert config._validate_embedder_provider() is True

    def test_validate_embedder_provider_voyage_invalid(self):
        """Test _validate_embedder_provider returns False for Voyage without API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="voyage", voyage_api_key=""
        )
        assert config._validate_embedder_provider() is False

    def test_validate_embedder_provider_azure_openai_valid(self):
        """Test _validate_embedder_provider returns True for Azure OpenAI with all required fields."""
        config = GraphitiConfig(
            enabled=True,
            embedder_provider="azure_openai",
            azure_openai_api_key="azure-test-key",
            azure_openai_base_url="https://test.openai.azure.com",
            azure_openai_embedding_deployment="embedding-deployment",
        )
        assert config._validate_embedder_provider() is True

    def test_validate_embedder_provider_azure_openai_missing_api_key(self):
        """Test _validate_embedder_provider returns False for Azure OpenAI missing API key."""
        config = GraphitiConfig(
            enabled=True,
            embedder_provider="azure_openai",
            azure_openai_api_key="",
            azure_openai_base_url="https://test.openai.azure.com",
            azure_openai_embedding_deployment="embedding-deployment",
        )
        assert config._validate_embedder_provider() is False

    def test_validate_embedder_provider_azure_openai_missing_base_url(self):
        """Test _validate_embedder_provider returns False for Azure OpenAI missing base URL."""
        config = GraphitiConfig(
            enabled=True,
            embedder_provider="azure_openai",
            azure_openai_api_key="azure-test-key",
            azure_openai_base_url="",
            azure_openai_embedding_deployment="embedding-deployment",
        )
        assert config._validate_embedder_provider() is False

    def test_validate_embedder_provider_azure_openai_missing_deployment(self):
        """Test _validate_embedder_provider returns False for Azure OpenAI missing deployment."""
        config = GraphitiConfig(
            enabled=True,
            embedder_provider="azure_openai",
            azure_openai_api_key="azure-test-key",
            azure_openai_base_url="https://test.openai.azure.com",
            azure_openai_embedding_deployment="",
        )
        assert config._validate_embedder_provider() is False

    def test_validate_embedder_provider_ollama_valid(self):
        """Test _validate_embedder_provider returns True for Ollama with model."""
        config = GraphitiConfig(
            enabled=True,
            embedder_provider="ollama",
            ollama_embedding_model="nomic-embed-text",
        )
        assert config._validate_embedder_provider() is True

    def test_validate_embedder_provider_ollama_invalid(self):
        """Test _validate_embedder_provider returns False for Ollama without model."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="ollama", ollama_embedding_model=""
        )
        assert config._validate_embedder_provider() is False

    def test_validate_embedder_provider_google_valid(self):
        """Test _validate_embedder_provider returns True for Google with API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="google", google_api_key="google-test-key"
        )
        assert config._validate_embedder_provider() is True

    def test_validate_embedder_provider_google_invalid(self):
        """Test _validate_embedder_provider returns False for Google without API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="google", google_api_key=""
        )
        assert config._validate_embedder_provider() is False

    def test_validate_embedder_provider_openrouter_valid(self):
        """Test _validate_embedder_provider returns True for OpenRouter with API key."""
        config = GraphitiConfig(
            enabled=True,
            embedder_provider="openrouter",
            openrouter_api_key="or-test-key",
        )
        assert config._validate_embedder_provider() is True

    def test_validate_embedder_provider_openrouter_invalid(self):
        """Test _validate_embedder_provider returns False for OpenRouter without API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="openrouter", openrouter_api_key=""
        )
        assert config._validate_embedder_provider() is False

    def test_validate_embedder_provider_unknown(self):
        """Test _validate_embedder_provider returns False for unknown provider."""
        config = GraphitiConfig(enabled=True, embedder_provider="unknown")
        assert config._validate_embedder_provider() is False


class TestGraphitiConfigValidationErrors:
    """Test GraphitiConfig.get_validation_errors() method."""

    def test_validation_errors_not_enabled(self):
        """Test validation errors when not enabled."""
        config = GraphitiConfig(enabled=False)
        errors = config.get_validation_errors()

        assert len(errors) == 1
        assert "GRAPHITI_ENABLED must be set to true" in errors[0]

    def test_validation_errors_empty_when_valid(self):
        """Test validation returns empty list when config is valid."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="openai", openai_api_key="test-key"
        )
        errors = config.get_validation_errors()

        # Embedder errors are warnings, not blockers for is_valid()
        assert errors == []

    def test_validation_errors_openai_missing_key(self):
        """Test validation errors for OpenAI without API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="openai", openai_api_key=""
        )
        errors = config.get_validation_errors()

        assert len(errors) == 1
        assert "OPENAI_API_KEY" in errors[0]

    def test_validation_errors_voyage_missing_key(self):
        """Test validation errors for Voyage without API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="voyage", voyage_api_key=""
        )
        errors = config.get_validation_errors()

        assert len(errors) == 1
        assert "VOYAGE_API_KEY" in errors[0]

    def test_validation_errors_azure_missing_config(self):
        """Test validation errors for Azure OpenAI with missing config."""
        config = GraphitiConfig(
            enabled=True,
            embedder_provider="azure_openai",
            azure_openai_api_key="",
            azure_openai_base_url="",
            azure_openai_embedding_deployment="",
        )
        errors = config.get_validation_errors()

        assert len(errors) == 3
        assert any("AZURE_OPENAI_API_KEY" in e for e in errors)
        assert any("AZURE_OPENAI_BASE_URL" in e for e in errors)
        assert any("AZURE_OPENAI_EMBEDDING_DEPLOYMENT" in e for e in errors)

    def test_validation_errors_ollama_missing_model(self):
        """Test validation errors for Ollama without model."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="ollama", ollama_embedding_model=""
        )
        errors = config.get_validation_errors()

        assert len(errors) == 1
        assert "OLLAMA_EMBEDDING_MODEL" in errors[0]

    def test_validation_errors_google_missing_key(self):
        """Test validation errors for Google without API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="google", google_api_key=""
        )
        errors = config.get_validation_errors()

        assert len(errors) == 1
        assert "GOOGLE_API_KEY" in errors[0]

    def test_validation_errors_openrouter_missing_key(self):
        """Test validation errors for OpenRouter without API key."""
        config = GraphitiConfig(
            enabled=True, embedder_provider="openrouter", openrouter_api_key=""
        )
        errors = config.get_validation_errors()

        assert len(errors) == 1
        assert "OPENROUTER_API_KEY" in errors[0]

    def test_validation_errors_unknown_provider(self):
        """Test validation errors for unknown provider."""
        config = GraphitiConfig(enabled=True, embedder_provider="unknown")
        errors = config.get_validation_errors()

        assert len(errors) == 1
        assert "Unknown embedder provider" in errors[0]


class TestGraphitiConfigEmbeddingDimension:
    """Test GraphitiConfig.get_embedding_dimension() method."""

    def test_embedding_dimension_openai(self):
        """Test embedding dimension for OpenAI."""
        config = GraphitiConfig(embedder_provider="openai")
        assert config.get_embedding_dimension() == 1536

    def test_embedding_dimension_voyage(self):
        """Test embedding dimension for Voyage."""
        config = GraphitiConfig(embedder_provider="voyage")
        assert config.get_embedding_dimension() == 1024

    def test_embedding_dimension_google(self):
        """Test embedding dimension for Google."""
        config = GraphitiConfig(embedder_provider="google")
        assert config.get_embedding_dimension() == 768

    def test_embedding_dimension_azure_openai(self):
        """Test embedding dimension for Azure OpenAI."""
        config = GraphitiConfig(embedder_provider="azure_openai")
        assert config.get_embedding_dimension() == 1536

    def test_embedding_dimension_ollama_with_explicit_dim(self):
        """Test Ollama embedding dimension with explicit value."""
        config = GraphitiConfig(
            embedder_provider="ollama",
            ollama_embedding_model="nomic-embed-text",
            ollama_embedding_dim=512,
        )
        assert config.get_embedding_dimension() == 512

    @pytest.mark.parametrize(
        "model,expected_dim",
        [
            ("embeddinggemma", 768),
            ("nomic-embed-text", 768),
            ("mxbai-embed-large", 1024),
            ("bge-large", 1024),
            ("qwen3-embedding:0.6b", 1024),
            ("qwen3-embedding:4b", 2560),
            ("qwen3-embedding:8b", 4096),
            ("unknown-model", 768),  # Default fallback
        ],
    )
    def test_embedding_dimension_ollama_auto_detect(self, model, expected_dim):
        """Test Ollama embedding dimension auto-detection for known models."""
        config = GraphitiConfig(
            embedder_provider="ollama",
            ollama_embedding_model=model,
            ollama_embedding_dim=0,
        )
        assert config.get_embedding_dimension() == expected_dim

    @pytest.mark.parametrize(
        "model,expected_dim",
        [
            ("openai/text-embedding-3-small", 1536),
            ("openai/text-embedding-3-large", 1536),
            ("voyage/voyage-3", 1024),
            ("voyage/voyage-3-lite", 1024),
            ("google/text-embedding-004", 768),
            ("unknown/model", 1536),  # Default fallback
        ],
    )
    def test_embedding_dimension_openrouter(self, model, expected_dim):
        """Test OpenRouter embedding dimension extraction."""
        config = GraphitiConfig(
            embedder_provider="openrouter", openrouter_embedding_model=model
        )
        assert config.get_embedding_dimension() == expected_dim

    def test_embedding_dimension_unknown_provider_default(self):
        """Test embedding dimension for unknown provider returns safe default."""
        # This tests line 413: return 768  # Safe default
        config = GraphitiConfig(embedder_provider="unknown_provider")
        assert config.get_embedding_dimension() == 768


class TestGraphitiConfigProviderSignature:
    """Test GraphitiConfig.get_provider_signature() method."""

    def test_provider_signature_openai(self):
        """Test provider signature for OpenAI."""
        config = GraphitiConfig(embedder_provider="openai")
        assert config.get_provider_signature() == "openai_1536"

    def test_provider_signature_voyage(self):
        """Test provider signature for Voyage."""
        config = GraphitiConfig(embedder_provider="voyage")
        assert config.get_provider_signature() == "voyage_1024"

    def test_provider_signature_google(self):
        """Test provider signature for Google."""
        config = GraphitiConfig(embedder_provider="google")
        assert config.get_provider_signature() == "google_768"

    def test_provider_signature_azure_openai(self):
        """Test provider signature for Azure OpenAI."""
        config = GraphitiConfig(embedder_provider="azure_openai")
        assert config.get_provider_signature() == "azure_openai_1536"

    def test_provider_signature_ollama(self):
        """Test provider signature for Ollama includes model name."""
        config = GraphitiConfig(
            embedder_provider="ollama",
            ollama_embedding_model="nomic-embed-text",
            ollama_embedding_dim=768,
        )
        assert config.get_provider_signature() == "ollama_nomic-embed-text_768"

    def test_provider_signature_ollama_sanitizes_model_name(self):
        """Test Ollama signature sanitizes colons and dots in model names."""
        config = GraphitiConfig(
            embedder_provider="ollama",
            ollama_embedding_model="qwen3-embedding:0.6b",
            ollama_embedding_dim=1024,
        )
        assert config.get_provider_signature() == "ollama_qwen3-embedding_0_6b_1024"

    def test_provider_signature_openrouter(self):
        """Test provider signature for OpenRouter."""
        config = GraphitiConfig(
            embedder_provider="openrouter",
            openrouter_embedding_model="openai/text-embedding-3-small",
        )
        assert config.get_provider_signature() == "openrouter_1536"


class TestGraphitiConfigProviderSpecificDatabaseName:
    """Test GraphitiConfig.get_provider_specific_database_name() method."""

    def test_provider_specific_database_openai(self):
        """Test provider-specific database name for OpenAI."""
        config = GraphitiConfig(
            database="auto_claude_memory", embedder_provider="openai"
        )
        assert (
            config.get_provider_specific_database_name()
            == "auto_claude_memory_openai_1536"
        )

    def test_provider_specific_database_voyage(self):
        """Test provider-specific database name for Voyage."""
        config = GraphitiConfig(
            database="auto_claude_memory", embedder_provider="voyage"
        )
        assert (
            config.get_provider_specific_database_name()
            == "auto_claude_memory_voyage_1024"
        )

    def test_provider_specific_database_custom_base(self):
        """Test provider-specific database name with custom base."""
        config = GraphitiConfig(embedder_provider="openai")
        assert (
            config.get_provider_specific_database_name("my_memory")
            == "my_memory_openai_1536"
        )

    def test_provider_specific_database_removes_old_suffix(self):
        """Test that old provider suffix is removed when switching."""
        config = GraphitiConfig(
            database="auto_claude_memory_ollama_768", embedder_provider="openai"
        )
        # Should remove old _ollama_768 suffix and add new _openai_1536
        assert (
            config.get_provider_specific_database_name()
            == "auto_claude_memory_openai_1536"
        )

    def test_provider_specific_database_multiple_providers(self):
        """Test provider-specific database name for various providers."""
        test_cases = [
            ("ollama", "auto_claude_memory_ollama_nomic-embed-text_768"),
            ("google", "auto_claude_memory_google_768"),
            ("azure_openai", "auto_claude_memory_azure_openai_1536"),
            ("openrouter", "auto_claude_memory_openrouter_1536"),
        ]

        for provider, expected in test_cases:
            config = GraphitiConfig(
                database="auto_claude_memory", embedder_provider=provider
            )
            if provider == "ollama":
                config.ollama_embedding_model = "nomic-embed-text"
                config.ollama_embedding_dim = 768

            assert config.get_provider_specific_database_name() == expected


class TestGraphitiConfigGetDbPath:
    """Test GraphitiConfig.get_db_path() method."""

    def test_get_db_path_expands_tilde(self, tmp_path, monkeypatch):
        """Test get_db_path expands tilde to home directory."""
        config = GraphitiConfig(db_path="~/.auto-claude/memories")

        # Use monkeypatch to set HOME environment variable
        monkeypatch.setenv("HOME", str(tmp_path))

        db_path = config.get_db_path()

        assert db_path == tmp_path / ".auto-claude" / "memories" / DEFAULT_DATABASE

    def test_get_db_path_creates_parent_directory(self, tmp_path):
        """Test get_db_path creates parent directory."""
        base_path = tmp_path / "test_memories"
        config = GraphitiConfig(db_path=str(base_path))

        db_path = config.get_db_path()

        assert db_path.parent.exists()
        assert db_path == base_path / DEFAULT_DATABASE


class TestGraphitiConfigGetProviderSummary:
    """Test GraphitiConfig.get_provider_summary() method."""

    def test_get_provider_summary(self):
        """Test provider summary string."""
        config = GraphitiConfig(llm_provider="openai", embedder_provider="voyage")
        summary = config.get_provider_summary()

        assert summary == "LLM: openai, Embedder: voyage"


class TestGraphitiState:
    """Test GraphitiState dataclass."""

    def test_to_dict(self):
        """Test GraphitiState.to_dict() method."""
        state = GraphitiState(
            initialized=True,
            database="test_db",
            indices_built=True,
            created_at="2024-01-01T00:00:00",
            last_session=5,
            episode_count=10,
            error_log=[{"timestamp": "2024-01-01", "error": "test error"}],
            llm_provider="openai",
            embedder_provider="voyage",
        )

        data = state.to_dict()

        assert data["initialized"] is True
        assert data["database"] == "test_db"
        assert data["indices_built"] is True
        assert data["created_at"] == "2024-01-01T00:00:00"
        assert data["last_session"] == 5
        assert data["episode_count"] == 10
        assert len(data["error_log"]) == 1
        assert data["llm_provider"] == "openai"
        assert data["embedder_provider"] == "voyage"

    def test_to_dict_limits_error_log(self):
        """Test to_dict limits error log to 10 entries."""
        state = GraphitiState(
            error_log=[
                {"timestamp": f"2024-01-0{i}", "error": f"error {i}"} for i in range(15)
            ]
        )

        data = state.to_dict()

        assert len(data["error_log"]) == 10

    def test_from_dict(self):
        """Test GraphitiState.from_dict() class method."""
        data = {
            "initialized": True,
            "database": "test_db",
            "indices_built": True,
            "created_at": "2024-01-01T00:00:00",
            "last_session": 5,
            "episode_count": 10,
            "error_log": [{"timestamp": "2024-01-01", "error": "test error"}],
            "llm_provider": "openai",
            "embedder_provider": "voyage",
        }

        state = GraphitiState.from_dict(data)

        assert state.initialized is True
        assert state.database == "test_db"
        assert state.indices_built is True
        assert state.created_at == "2024-01-01T00:00:00"
        assert state.last_session == 5
        assert state.episode_count == 10
        assert len(state.error_log) == 1
        assert state.llm_provider == "openai"
        assert state.embedder_provider == "voyage"

    def test_from_dict_with_missing_fields(self):
        """Test from_dict handles missing fields with defaults."""
        data = {"initialized": True}

        state = GraphitiState.from_dict(data)

        assert state.initialized is True
        assert state.database is None
        assert state.indices_built is False
        assert state.created_at is None
        assert state.last_session is None
        assert state.episode_count == 0
        assert state.error_log == []
        assert state.llm_provider is None
        assert state.embedder_provider is None

    def test_save_and_load_roundtrip(self, tmp_path):
        """Test save and load roundtrip."""
        state = GraphitiState(
            initialized=True,
            database="test_db",
            indices_built=True,
            created_at="2024-01-01T00:00:00",
            last_session=5,
            episode_count=10,
            error_log=[{"timestamp": "2024-01-01", "error": "test error"}],
            llm_provider="openai",
            embedder_provider="voyage",
        )

        state.save(tmp_path)
        loaded_state = GraphitiState.load(tmp_path)

        assert loaded_state.initialized == state.initialized
        assert loaded_state.database == state.database
        assert loaded_state.indices_built == state.indices_built
        assert loaded_state.created_at == state.created_at
        assert loaded_state.last_session == state.last_session
        assert loaded_state.episode_count == state.episode_count
        assert loaded_state.error_log == state.error_log
        assert loaded_state.llm_provider == state.llm_provider
        assert loaded_state.embedder_provider == state.embedder_provider

    def test_load_returns_none_when_file_not_exists(self, tmp_path):
        """Test load returns None when marker file doesn't exist."""
        state = GraphitiState.load(tmp_path)
        assert state is None

    def test_load_returns_none_on_invalid_json(self, tmp_path):
        """Test load returns None on invalid JSON."""
        marker_file = tmp_path / ".graphiti_state.json"
        with open(marker_file, "w", encoding="utf-8") as f:
            f.write("invalid json")

        state = GraphitiState.load(tmp_path)
        assert state is None

    def test_record_error(self):
        """Test record_error adds to error log."""
        state = GraphitiState()

        state.record_error("Test error message")

        assert len(state.error_log) == 1
        assert state.error_log[0]["error"] == "Test error message"
        assert "timestamp" in state.error_log[0]

    def test_record_error_limits_to_10(self):
        """Test record_error limits error log to 10 entries."""
        state = GraphitiState()

        for i in range(15):
            state.record_error(f"Error {i}")

        assert len(state.error_log) == 10
        assert state.error_log[0]["error"] == "Error 5"
        assert state.error_log[-1]["error"] == "Error 14"

    def test_record_error_truncates_long_messages(self):
        """Test record_error truncates long error messages."""
        state = GraphitiState()

        long_error = "x" * 1000
        state.record_error(long_error)

        assert len(state.error_log[0]["error"]) == 500

    def test_has_provider_changed_true(self):
        """Test has_provider_changed returns True when changed."""
        state = GraphitiState(
            initialized=True, embedder_provider="openai", database="test_db"
        )
        config = GraphitiConfig(embedder_provider="voyage")

        assert state.has_provider_changed(config) is True

    def test_has_provider_changed_false_same_provider(self):
        """Test has_provider_changed returns False when same provider."""
        state = GraphitiState(
            initialized=True, embedder_provider="openai", database="test_db"
        )
        config = GraphitiConfig(embedder_provider="openai")

        assert state.has_provider_changed(config) is False

    def test_has_provider_changed_false_not_initialized(self):
        """Test has_provider_changed returns False when not initialized."""
        state = GraphitiState(initialized=False, embedder_provider="openai")
        config = GraphitiConfig(embedder_provider="voyage")

        assert state.has_provider_changed(config) is False

    def test_has_provider_changed_false_no_embedder_provider(self):
        """Test has_provider_changed returns False when no embedder_provider."""
        state = GraphitiState(initialized=True, embedder_provider=None)
        config = GraphitiConfig(embedder_provider="voyage")

        assert state.has_provider_changed(config) is False

    def test_get_migration_info(self):
        """Test get_migration_info returns correct dict."""
        state = GraphitiState(
            initialized=True,
            embedder_provider="openai",
            database="auto_claude_memory_openai_1536",
            episode_count=100,
        )
        config = GraphitiConfig(
            embedder_provider="voyage", database="auto_claude_memory"
        )

        migration_info = state.get_migration_info(config)

        assert migration_info is not None
        assert migration_info["old_provider"] == "openai"
        assert migration_info["new_provider"] == "voyage"
        assert migration_info["old_database"] == "auto_claude_memory_openai_1536"
        assert "voyage" in migration_info["new_database"]
        assert migration_info["episode_count"] == 100
        assert migration_info["requires_migration"] is True

    def test_get_migration_info_none_when_no_change(self):
        """Test get_migration_info returns None when no provider change."""
        state = GraphitiState(
            initialized=True, embedder_provider="openai", database="test_db"
        )
        config = GraphitiConfig(embedder_provider="openai")

        migration_info = state.get_migration_info(config)

        assert migration_info is None


class TestModuleLevelFunctions:
    """Test module-level utility functions."""

    @pytest.fixture
    def clean_env(self):
        """Fixture to ensure clean environment for each test."""
        original = {}
        env_keys = [
            "GRAPHITI_ENABLED",
            "GRAPHITI_LLM_PROVIDER",
            "GRAPHITI_EMBEDDER_PROVIDER",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "VOYAGE_API_KEY",
            "GOOGLE_API_KEY",
            "OPENROUTER_API_KEY",
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_BASE_URL",
            "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
            "OLLAMA_LLM_MODEL",
            "OLLAMA_EMBEDDING_MODEL",
            "OLLAMA_EMBEDDING_DIM",
        ]

        for key in env_keys:
            original[key] = os.environ.get(key)
            if key in os.environ:
                os.environ.pop(key)

        yield

        for key, value in original.items():
            if value is not None:
                os.environ[key] = value

    def test_is_graphiti_enabled_false(self, clean_env):
        """Test is_graphiti_enabled returns False when not enabled."""
        assert is_graphiti_enabled() is False

    def test_is_graphiti_enabled_true(self, clean_env):
        """Test is_graphiti_enabled returns True when enabled."""
        os.environ["GRAPHITI_ENABLED"] = "true"
        assert is_graphiti_enabled() is True

    def test_get_graphiti_status_not_enabled(self, clean_env):
        """Test get_graphiti_status when not enabled."""
        status = get_graphiti_status()

        assert status["enabled"] is False
        assert status["available"] is False
        assert "not set to true" in status["reason"]
        assert status["errors"] == []

    def test_get_graphiti_status_enabled(self, clean_env):
        """Test get_graphiti_status when enabled."""
        os.environ["GRAPHITI_ENABLED"] = "true"

        status = get_graphiti_status()

        # Should be enabled - availability depends on whether packages are installed
        assert status["enabled"] is True
        # We can't assert on 'available' since it depends on test environment
        # Just verify the structure is correct
        assert "available" in status
        assert "database" in status
        assert "llm_provider" in status
        assert "embedder_provider" in status

    def test_get_graphiti_status_with_validation_errors(self, clean_env):
        """Test get_graphiti_status includes validation errors."""
        os.environ["GRAPHITI_ENABLED"] = "true"
        os.environ["GRAPHITI_EMBEDDER_PROVIDER"] = "openai"

        status = get_graphiti_status()

        assert status["enabled"] is True
        assert len(status["errors"]) > 0
        assert "OPENAI_API_KEY" in status["errors"][0]

    def test_get_graphiti_status_invalid_config_sets_reason(self, clean_env):
        """Test get_graphiti_status with validation errors (embedder misconfigured).

        When packages are installed but embedder config has errors, available should
        still be True (embedder is optional - keyword search fallback exists).
        Validation errors are reported in the errors list for informational purposes.
        """
        os.environ["GRAPHITI_ENABLED"] = "true"
        os.environ["GRAPHITI_EMBEDDER_PROVIDER"] = "voyage"

        # Mock imports to ensure test is independent of environment
        with patch.dict(
            "sys.modules",
            {"graphiti_core": MagicMock(), "real_ladybug": MagicMock()},
        ):
            status = get_graphiti_status()

        assert status["enabled"] is True
        # available depends on whether mocked packages are resolved correctly;
        # sys.modules patching should make imports succeed, but guard against
        # environment quirks (consistent with test_get_graphiti_status_enabled)
        assert status["available"] is True
        assert len(status["errors"]) > 0
        assert "VOYAGE_API_KEY" in status["errors"][0]

    def test_get_graphiti_status_no_graph_backend(self, clean_env):
        """Test get_graphiti_status when graphiti_core exists but no graph DB backend.

        This tests the error path in config.py lines 645-650 where graphiti_core
        imports successfully but neither real_ladybug nor kuzu is available.
        """
        os.environ["GRAPHITI_ENABLED"] = "true"

        # Mock graphiti_core as present, but ensure real_ladybug and kuzu are absent
        with patch.dict(
            "sys.modules",
            {"graphiti_core": MagicMock(), "real_ladybug": None, "kuzu": None},
        ):
            status = get_graphiti_status()

        assert status["enabled"] is True
        assert status["available"] is False
        assert "real_ladybug or kuzu" in status["reason"]

    @pytest.mark.slow
    def test_get_graphiti_status_with_graphiti_installed(self, clean_env):
        """Test get_graphiti_status when Graphiti packages are installed.

        This tests line 641 where status["available"] is set to True
        when imports succeed. Marked as slow since it requires actual imports.
        """
        os.environ["GRAPHITI_ENABLED"] = "true"

        status = get_graphiti_status()

        assert status["enabled"] is True
        # Verify all expected fields are present
        assert "available" in status
        assert "database" in status
        assert "llm_provider" in status
        assert "embedder_provider" in status
        assert "reason" in status
        assert "errors" in status

        # Note: Line 644 (status["available"] = True) requires LadybugDB/kuzu to be installed.
        # Since LadybugDB/kuzu may not be installed in all test environments, that line
        # may be marked with pragma: no cover. The except clause is tested here.

    def test_get_available_providers_empty(self, clean_env):
        """Test get_available_providers with no credentials."""
        providers = get_available_providers()

        assert providers["llm_providers"] == []
        assert providers["embedder_providers"] == []

    def test_get_available_providers_openai(self, clean_env):
        """Test get_available_providers with OpenAI credentials."""
        os.environ["OPENAI_API_KEY"] = "sk-test-key"

        providers = get_available_providers()

        assert "openai" in providers["llm_providers"]
        assert "openai" in providers["embedder_providers"]

    def test_get_available_providers_anthropic(self, clean_env):
        """Test get_available_providers with Anthropic credentials."""
        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test-key"

        providers = get_available_providers()

        assert "anthropic" in providers["llm_providers"]

    def test_get_available_providers_voyage(self, clean_env):
        """Test get_available_providers with Voyage credentials."""
        os.environ["VOYAGE_API_KEY"] = "voyage-test-key"

        providers = get_available_providers()

        assert "voyage" in providers["embedder_providers"]

    def test_get_available_providers_google(self, clean_env):
        """Test get_available_providers with Google credentials."""
        os.environ["GOOGLE_API_KEY"] = "google-test-key"

        providers = get_available_providers()

        assert "google" in providers["llm_providers"]
        assert "google" in providers["embedder_providers"]

    def test_get_available_providers_openrouter(self, clean_env):
        """Test get_available_providers with OpenRouter credentials."""
        os.environ["OPENROUTER_API_KEY"] = "or-test-key"

        providers = get_available_providers()

        assert "openrouter" in providers["llm_providers"]
        assert "openrouter" in providers["embedder_providers"]

    def test_get_available_providers_azure_openai(self, clean_env):
        """Test get_available_providers with Azure OpenAI credentials."""
        os.environ["AZURE_OPENAI_API_KEY"] = "azure-test-key"
        os.environ["AZURE_OPENAI_BASE_URL"] = "https://test.openai.azure.com"
        os.environ["AZURE_OPENAI_LLM_DEPLOYMENT"] = "gpt-4"
        os.environ["AZURE_OPENAI_EMBEDDING_DEPLOYMENT"] = "embedding"

        providers = get_available_providers()

        assert "azure_openai" in providers["llm_providers"]
        assert "azure_openai" in providers["embedder_providers"]

    def test_get_available_providers_ollama(self, clean_env):
        """Test get_available_providers with Ollama configuration."""
        os.environ["OLLAMA_LLM_MODEL"] = "llama2"
        os.environ["OLLAMA_EMBEDDING_MODEL"] = "nomic-embed-text"
        os.environ["OLLAMA_EMBEDDING_DIM"] = "768"

        providers = get_available_providers()

        assert "ollama" in providers["llm_providers"]
        assert "ollama" in providers["embedder_providers"]

    def test_validate_graphiti_config_valid(self, clean_env):
        """Test validate_graphiti_config with valid config."""
        os.environ["GRAPHITI_ENABLED"] = "true"

        is_valid, errors = validate_graphiti_config()

        assert is_valid is True
        assert errors == []

    def test_validate_graphiti_config_invalid(self, clean_env):
        """Test validate_graphiti_config with invalid config."""
        is_valid, errors = validate_graphiti_config()

        assert is_valid is False
        assert len(errors) > 0


class TestConstants:
    """Test module constants."""

    def test_episode_type_constants(self):
        """Test episode type constants are defined."""
        assert EPISODE_TYPE_SESSION_INSIGHT == "session_insight"
        assert EPISODE_TYPE_CODEBASE_DISCOVERY == "codebase_discovery"
        assert EPISODE_TYPE_PATTERN == "pattern"
        assert EPISODE_TYPE_GOTCHA == "gotcha"
        assert EPISODE_TYPE_TASK_OUTCOME == "task_outcome"
        assert EPISODE_TYPE_QA_RESULT == "qa_result"
        assert EPISODE_TYPE_HISTORICAL_CONTEXT == "historical_context"

    def test_default_constants(self):
        """Test default configuration constants."""
        assert DEFAULT_DATABASE == "auto_claude_memory"
        assert DEFAULT_DB_PATH == "~/.auto-claude/memories"
        assert DEFAULT_OLLAMA_BASE_URL == "http://localhost:11434"

    def test_llm_provider_enum(self):
        """Test LLMProvider enum values."""
        assert LLMProvider.OPENAI == "openai"
        assert LLMProvider.ANTHROPIC == "anthropic"
        assert LLMProvider.AZURE_OPENAI == "azure_openai"
        assert LLMProvider.OLLAMA == "ollama"
        assert LLMProvider.GOOGLE == "google"
        assert LLMProvider.OPENROUTER == "openrouter"

    def test_embedder_provider_enum(self):
        """Test EmbedderProvider enum values."""
        assert EmbedderProvider.OPENAI == "openai"
        assert EmbedderProvider.VOYAGE == "voyage"
        assert EmbedderProvider.AZURE_OPENAI == "azure_openai"
        assert EmbedderProvider.OLLAMA == "ollama"
        assert EmbedderProvider.GOOGLE == "google"
        assert EmbedderProvider.OPENROUTER == "openrouter"
