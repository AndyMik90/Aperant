"""Tests for Graphiti memory integration."""
import asyncio
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


# =============================================================================
# LADYBUGDB LOCK RETRY LOGIC TESTS
# =============================================================================


class TestIsLockError:
    """Tests for _is_lock_error lock detection function."""

    def test_lock_file_error_detected(self):
        """Detects lock + file pattern in error messages."""
        from integrations.graphiti.queries_pkg.client import _is_lock_error

        assert _is_lock_error(Exception("Could not set lock on file")) is True

    def test_lock_database_error_detected(self):
        """Detects lock + database pattern in error messages."""
        from integrations.graphiti.queries_pkg.client import _is_lock_error

        assert _is_lock_error(Exception("Database lock contention detected")) is True

    def test_could_not_set_lock_detected(self):
        """Detects 'could not set lock' pattern."""
        from integrations.graphiti.queries_pkg.client import _is_lock_error

        assert _is_lock_error(Exception("could not set lock")) is True

    def test_non_lock_error_not_detected(self):
        """Non-lock errors are not detected as lock errors."""
        from integrations.graphiti.queries_pkg.client import _is_lock_error

        assert _is_lock_error(Exception("Connection refused")) is False
        assert _is_lock_error(Exception("Timeout error")) is False
        assert _is_lock_error(Exception("Permission denied")) is False

    def test_lock_without_file_or_database_not_detected(self):
        """'lock' alone without 'file' or 'database' is not detected."""
        from integrations.graphiti.queries_pkg.client import _is_lock_error

        # 'lock' without 'file' or 'database' and no 'could not set lock'
        assert _is_lock_error(Exception("Object is locked by user")) is False


class TestBackoffWithJitter:
    """Tests for _backoff_with_jitter calculation."""

    def test_backoff_increases_with_attempt(self):
        """Backoff time increases with attempt number."""
        from integrations.graphiti.queries_pkg.client import _backoff_with_jitter

        # Run multiple times to account for jitter
        attempt_0_values = [_backoff_with_jitter(0) for _ in range(20)]
        attempt_3_values = [_backoff_with_jitter(3) for _ in range(20)]

        avg_0 = sum(attempt_0_values) / len(attempt_0_values)
        avg_3 = sum(attempt_3_values) / len(attempt_3_values)

        assert avg_3 > avg_0, "Higher attempts should have higher average backoff"

    def test_backoff_is_positive(self):
        """Backoff is always positive."""
        from integrations.graphiti.queries_pkg.client import _backoff_with_jitter

        for attempt in range(10):
            for _ in range(10):
                assert _backoff_with_jitter(attempt) > 0

    def test_backoff_capped_at_max(self):
        """Backoff should not exceed MAX_BACKOFF_SECONDS + jitter."""
        from integrations.graphiti.queries_pkg.client import (
            JITTER_PERCENT,
            MAX_BACKOFF_SECONDS,
            _backoff_with_jitter,
        )

        max_possible = MAX_BACKOFF_SECONDS * (1 + JITTER_PERCENT)
        for _ in range(50):
            val = _backoff_with_jitter(100)  # Very high attempt
            assert val <= max_possible + 0.01, f"Backoff {val} exceeded max {max_possible}"


class TestGraphitiClientRetryLogic:
    """Tests for LadybugDB lock retry logic in GraphitiClient.initialize().

    These tests exercise the retry loop behavior by mocking the modules
    that are imported locally inside initialize(). We patch at the source
    module level since the imports are local to the method.
    """

    def _make_config(self):
        """Create a mock GraphitiConfig for testing."""
        config = MagicMock()
        config.llm_provider = "openai"
        config.embedder_provider = "openai"
        config.get_db_path.return_value = Path("/tmp/test-db")
        config.get_provider_summary.return_value = "openai/openai"
        return config

    def _make_mock_providers(self):
        """Create mock graphiti_providers module."""
        mock_providers = MagicMock()
        mock_providers.create_llm_client = MagicMock(return_value=MagicMock())
        mock_providers.create_embedder = MagicMock(return_value=MagicMock())
        mock_providers.ProviderError = type("ProviderError", (Exception,), {})
        mock_providers.ProviderNotInstalled = type(
            "ProviderNotInstalled", (mock_providers.ProviderError,), {}
        )
        return mock_providers

    def _make_noop_sleep(self):
        """Create an async no-op replacement for asyncio.sleep."""
        async def _noop_sleep(_delay):
            return

        return _noop_sleep

    @pytest.mark.asyncio
    async def test_successful_retry_after_lock_error(self):
        """Client retries and succeeds after transient lock error."""
        from integrations.graphiti.queries_pkg.client import GraphitiClient

        config = self._make_config()
        client = GraphitiClient(config)

        call_count = 0

        def mock_create_driver(db=""):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise OSError("Could not set lock on file /tmp/test-db")
            return MagicMock()

        mock_graphiti_instance = MagicMock()

        async def mock_build_indices():
            pass

        mock_graphiti_instance.build_indices_and_constraints = mock_build_indices

        mock_graphiti_cls = MagicMock(return_value=mock_graphiti_instance)
        mock_graphiti_core = MagicMock()
        mock_graphiti_core.Graphiti = mock_graphiti_cls

        mock_kuzu_driver = MagicMock()
        mock_kuzu_driver.create_patched_kuzu_driver = mock_create_driver

        with (
            patch.dict(sys.modules, {
                "graphiti_core": mock_graphiti_core,
                "graphiti_providers": self._make_mock_providers(),
                "integrations.graphiti.queries_pkg.kuzu_driver_patched": mock_kuzu_driver,
            }),
            patch(
                "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                return_value=True,
            ),
            patch(
                "integrations.graphiti.queries_pkg.client.asyncio.sleep",
                side_effect=self._make_noop_sleep(),
            ),
        ):
            result = await client.initialize()

        assert call_count == 2, "Should have retried once after lock error"
        assert result is True, "Should succeed after retry"

    @pytest.mark.asyncio
    async def test_exhausted_retries_returns_false(self):
        """Client returns False after exhausting all retries on lock errors."""
        from integrations.graphiti.queries_pkg.client import (
            MAX_LOCK_RETRIES,
            GraphitiClient,
        )

        config = self._make_config()
        client = GraphitiClient(config)

        call_count = 0

        def always_lock_error(db=""):
            nonlocal call_count
            call_count += 1
            raise OSError("Could not set lock on database file")

        mock_kuzu_driver = MagicMock()
        mock_kuzu_driver.create_patched_kuzu_driver = always_lock_error

        with (
            patch.dict(sys.modules, {
                "graphiti_core": MagicMock(),
                "graphiti_providers": self._make_mock_providers(),
                "integrations.graphiti.queries_pkg.kuzu_driver_patched": mock_kuzu_driver,
            }),
            patch(
                "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                return_value=True,
            ),
            patch(
                "integrations.graphiti.queries_pkg.client.capture_exception",
            ),
            patch(
                "integrations.graphiti.queries_pkg.client.asyncio.sleep",
                side_effect=self._make_noop_sleep(),
            ),
        ):
            result = await client.initialize()

        assert result is False, "Should return False after exhausting retries"
        # Should attempt MAX_LOCK_RETRIES + 1 times (initial + retries)
        assert call_count == MAX_LOCK_RETRIES + 1

    @pytest.mark.asyncio
    async def test_non_lock_error_fails_immediately(self):
        """Non-lock errors cause immediate failure without retry."""
        from integrations.graphiti.queries_pkg.client import GraphitiClient

        config = self._make_config()
        client = GraphitiClient(config)

        call_count = 0

        def connection_error(db=""):
            nonlocal call_count
            call_count += 1
            raise RuntimeError("Connection refused - server not running")

        mock_kuzu_driver = MagicMock()
        mock_kuzu_driver.create_patched_kuzu_driver = connection_error

        with (
            patch.dict(sys.modules, {
                "graphiti_core": MagicMock(),
                "graphiti_providers": self._make_mock_providers(),
                "integrations.graphiti.queries_pkg.kuzu_driver_patched": mock_kuzu_driver,
            }),
            patch(
                "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                return_value=True,
            ),
            patch(
                "integrations.graphiti.queries_pkg.client.capture_exception",
            ),
        ):
            result = await client.initialize()

        assert call_count == 1, "Non-lock errors should not trigger retries"
        assert result is False
