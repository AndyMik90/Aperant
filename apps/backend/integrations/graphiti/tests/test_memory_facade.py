"""
Unit tests for integrations.graphiti.memory facade module.

Tests for:
- get_graphiti_memory() convenience function
- fn_test_graphiti_connection() async function
- fn_test_provider_configuration() async function
- __all__ re-exports
"""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from integrations.graphiti.memory import (
    EPISODE_TYPE_CODEBASE_DISCOVERY,
    EPISODE_TYPE_GOTCHA,
    EPISODE_TYPE_HISTORICAL_CONTEXT,
    EPISODE_TYPE_PATTERN,
    EPISODE_TYPE_QA_RESULT,
    EPISODE_TYPE_SESSION_INSIGHT,
    EPISODE_TYPE_TASK_OUTCOME,
    MAX_CONTEXT_RESULTS,
    GraphitiMemory,
    GroupIdMode,
    get_graphiti_memory,
    is_graphiti_enabled,
)

# =============================================================================
# Pytest Fixtures
# =============================================================================


@pytest.fixture
def test_graphiti_connection_fixture():
    """Provide test_graphiti_connection function."""
    from integrations.graphiti.memory import test_graphiti_connection

    return test_graphiti_connection


@pytest.fixture
def test_provider_configuration_fixture():
    """Provide test_provider_configuration function."""
    from integrations.graphiti.memory import test_provider_configuration

    return test_provider_configuration


# Helper functions to get test functions without triggering pytest collection
# These are called at module level to provide the functions for tests
def _get_fn_test_graphiti_connection():
    from integrations.graphiti.memory import test_graphiti_connection

    return test_graphiti_connection


def _get_fn_test_provider_configuration():
    from integrations.graphiti.memory import test_provider_configuration

    return test_provider_configuration


# Module-level references for use in tests
# Note: Names start with 'fn_' to avoid pytest collection (must not start with 'test_')
fn_test_graphiti_connection = _get_fn_test_graphiti_connection()
fn_test_provider_configuration = _get_fn_test_provider_configuration()


# =============================================================================
# Tests for get_graphiti_memory()
# =============================================================================


class TestGetGraphitiMemory:
    """Tests for the get_graphiti_memory convenience function."""

    def test_returns_graphiti_memory_instance(self):
        """Returns GraphitiMemory instance."""
        spec_dir = Path("/test/spec")
        project_dir = Path("/test/project")

        with patch("integrations.graphiti.memory.GraphitiMemory") as MockGraphitiMemory:
            mock_instance = MagicMock()
            MockGraphitiMemory.return_value = mock_instance

            result = get_graphiti_memory(spec_dir, project_dir)

            assert result is mock_instance

    def test_passes_spec_dir_parameter(self):
        """Passes spec_dir parameter to GraphitiMemory."""
        spec_dir = Path("/test/spec")
        project_dir = Path("/test/project")

        with patch("integrations.graphiti.memory.GraphitiMemory") as MockGraphitiMemory:
            get_graphiti_memory(spec_dir, project_dir)

            MockGraphitiMemory.assert_called_once()
            call_args = MockGraphitiMemory.call_args
            assert call_args[0][0] == spec_dir

    def test_passes_project_dir_parameter(self):
        """Passes project_dir parameter to GraphitiMemory."""
        spec_dir = Path("/test/spec")
        project_dir = Path("/test/project")

        with patch("integrations.graphiti.memory.GraphitiMemory") as MockGraphitiMemory:
            get_graphiti_memory(spec_dir, project_dir)

            MockGraphitiMemory.assert_called_once()
            call_args = MockGraphitiMemory.call_args
            assert call_args[0][1] == project_dir

    def test_default_group_id_mode_is_project(self):
        """Default group_id_mode is PROJECT."""
        spec_dir = Path("/test/spec")
        project_dir = Path("/test/project")

        with patch("integrations.graphiti.memory.GraphitiMemory") as MockGraphitiMemory:
            get_graphiti_memory(spec_dir, project_dir)

            MockGraphitiMemory.assert_called_once()
            call_args = MockGraphitiMemory.call_args
            assert call_args[0][2] == GroupIdMode.PROJECT

    def test_can_override_group_id_mode_to_spec(self):
        """Can override group_id_mode to SPEC."""
        spec_dir = Path("/test/spec")
        project_dir = Path("/test/project")

        with patch("integrations.graphiti.memory.GraphitiMemory") as MockGraphitiMemory:
            get_graphiti_memory(spec_dir, project_dir, group_id_mode=GroupIdMode.SPEC)

            MockGraphitiMemory.assert_called_once()
            call_args = MockGraphitiMemory.call_args
            assert call_args[0][2] == GroupIdMode.SPEC

    def test_can_use_string_for_group_id_mode(self):
        """Can use string value for group_id_mode."""
        spec_dir = Path("/test/spec")
        project_dir = Path("/test/project")

        with patch("integrations.graphiti.memory.GraphitiMemory") as MockGraphitiMemory:
            get_graphiti_memory(spec_dir, project_dir, group_id_mode="spec")

            MockGraphitiMemory.assert_called_once()
            call_args = MockGraphitiMemory.call_args
            assert call_args[0][2] == "spec"


# =============================================================================
# Tests for fn_test_graphiti_connection()
# =============================================================================


class TestTestGraphitiConnection:
    """Tests for the test_graphiti_connection async function.

    Note: The function now uses embedded LadybugDB via patched KuzuDriver
    instead of remote database with host/port credentials.
    """

    @pytest.mark.asyncio
    async def test_returns_true_when_successful(self):
        """Returns (True, message) when successful."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = []
        mock_config.get_db_path.return_value = Path("/test/db/memory.db")
        mock_config.get_provider_summary.return_value = "LLM: openai, Embedder: openai"

        mock_llm_client = MagicMock()
        mock_embedder = MagicMock()
        mock_driver = MagicMock()
        mock_graphiti = AsyncMock()
        mock_graphiti.build_indices_and_constraints = AsyncMock()
        mock_graphiti.close = AsyncMock()

        # Mock sys.modules for graphiti_core
        mock_graphiti_core = MagicMock()
        mock_graphiti_core.Graphiti = lambda **kwargs: mock_graphiti

        sys.modules["graphiti_core"] = mock_graphiti_core

        try:
            with patch(
                "integrations.graphiti.memory.GraphitiConfig.from_env",
                return_value=mock_config,
            ):
                with patch(
                    "graphiti_providers.create_llm_client", return_value=mock_llm_client
                ):
                    with patch(
                        "graphiti_providers.create_embedder", return_value=mock_embedder
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                            return_value=True,
                        ):
                            with patch(
                                "integrations.graphiti.queries_pkg.kuzu_driver_patched.create_patched_kuzu_driver",
                                return_value=mock_driver,
                            ):
                                success, message = await fn_test_graphiti_connection()

                                assert success is True
                                assert "Connected to LadybugDB" in message
                                assert "/test/db/memory.db" in message
        finally:
            # Clean up sys.modules
            sys.modules.pop("graphiti_core", None)

    @pytest.mark.asyncio
    async def test_returns_false_when_not_enabled(self):
        """Returns (False, error) when not enabled."""
        mock_config = MagicMock()
        mock_config.enabled = False

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            success, message = await fn_test_graphiti_connection()

            assert success is False
            assert "not enabled" in message
            assert "GRAPHITI_ENABLED" in message

    @pytest.mark.asyncio
    async def test_returns_false_for_validation_errors(self):
        """Returns (False, error) for validation errors."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = [
            "API key missing",
            "Invalid model",
        ]

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            success, message = await fn_test_graphiti_connection()

            assert success is False
            assert "Configuration errors" in message
            assert "API key missing" in message

    @pytest.mark.asyncio
    async def test_returns_false_for_provider_error(self):
        """Returns (False, error) for ProviderError."""
        from integrations.graphiti.providers_pkg import ProviderError

        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = []

        # Mock sys.modules for graphiti_core
        mock_graphiti_core = MagicMock()
        sys.modules["graphiti_core"] = mock_graphiti_core

        try:
            with patch(
                "integrations.graphiti.memory.GraphitiConfig.from_env",
                return_value=mock_config,
            ):
                with patch("graphiti_providers.create_llm_client") as mock_create_llm:
                    mock_create_llm.side_effect = ProviderError("Invalid API key")

                    success, message = await fn_test_graphiti_connection()

                    assert success is False
                    assert "Provider error" in message
        finally:
            # Clean up sys.modules
            sys.modules.pop("graphiti_core", None)

    @pytest.mark.asyncio
    async def test_returns_false_for_import_error(self):
        """Returns (False, error) for ImportError."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = []

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch("builtins.__import__") as mock_import:
                mock_import.side_effect = ImportError("graphiti_core not found")

                success, message = await fn_test_graphiti_connection()

                assert success is False
                assert "not installed" in message

    @pytest.mark.asyncio
    async def test_returns_false_for_generic_exception(self):
        """Returns (False, error) for generic Exception."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = []
        mock_config.get_db_path.return_value = Path("/test/db/memory.db")

        mock_llm_client = MagicMock()
        mock_embedder = MagicMock()

        # Mock sys.modules for graphiti_core
        mock_graphiti_core = MagicMock()
        sys.modules["graphiti_core"] = mock_graphiti_core

        try:
            with patch(
                "integrations.graphiti.memory.GraphitiConfig.from_env",
                return_value=mock_config,
            ):
                with patch(
                    "graphiti_providers.create_llm_client", return_value=mock_llm_client
                ):
                    with patch(
                        "graphiti_providers.create_embedder", return_value=mock_embedder
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                            return_value=True,
                        ):
                            with patch(
                                "integrations.graphiti.queries_pkg.kuzu_driver_patched.create_patched_kuzu_driver",
                                side_effect=RuntimeError("Connection failed"),
                            ):
                                success, message = await fn_test_graphiti_connection()

                                assert success is False
                                assert "Connection failed" in message
        finally:
            # Clean up sys.modules
            sys.modules.pop("graphiti_core", None)

    @pytest.mark.asyncio
    async def test_builds_indices_on_successful_connection(self):
        """Builds indices on successful connection."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = []
        mock_config.get_db_path.return_value = Path("/test/db/memory.db")
        mock_config.get_provider_summary.return_value = "LLM: openai, Embedder: openai"

        mock_llm_client = MagicMock()
        mock_embedder = MagicMock()
        mock_driver = MagicMock()
        mock_graphiti = AsyncMock()
        mock_graphiti.build_indices_and_constraints = AsyncMock()
        mock_graphiti.close = AsyncMock()

        # Mock sys.modules for graphiti_core
        mock_graphiti_core = MagicMock()
        mock_graphiti_core.Graphiti = lambda **kwargs: mock_graphiti

        sys.modules["graphiti_core"] = mock_graphiti_core

        try:
            with patch(
                "integrations.graphiti.memory.GraphitiConfig.from_env",
                return_value=mock_config,
            ):
                with patch(
                    "graphiti_providers.create_llm_client", return_value=mock_llm_client
                ):
                    with patch(
                        "graphiti_providers.create_embedder", return_value=mock_embedder
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                            return_value=True,
                        ):
                            with patch(
                                "integrations.graphiti.queries_pkg.kuzu_driver_patched.create_patched_kuzu_driver",
                                return_value=mock_driver,
                            ):
                                await fn_test_graphiti_connection()

                                mock_graphiti.build_indices_and_constraints.assert_called_once()
        finally:
            # Clean up sys.modules
            sys.modules.pop("graphiti_core", None)

    @pytest.mark.asyncio
    async def test_closes_connection_after_test(self):
        """Closes connection after test."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = []
        mock_config.get_db_path.return_value = Path("/test/db/memory.db")
        mock_config.get_provider_summary.return_value = "LLM: openai, Embedder: openai"

        mock_llm_client = MagicMock()
        mock_embedder = MagicMock()
        mock_driver = MagicMock()
        mock_graphiti = AsyncMock()
        mock_graphiti.build_indices_and_constraints = AsyncMock()
        mock_graphiti.close = AsyncMock()

        # Mock sys.modules for graphiti_core
        mock_graphiti_core = MagicMock()
        mock_graphiti_core.Graphiti = lambda **kwargs: mock_graphiti

        sys.modules["graphiti_core"] = mock_graphiti_core

        try:
            with patch(
                "integrations.graphiti.memory.GraphitiConfig.from_env",
                return_value=mock_config,
            ):
                with patch(
                    "graphiti_providers.create_llm_client", return_value=mock_llm_client
                ):
                    with patch(
                        "graphiti_providers.create_embedder", return_value=mock_embedder
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                            return_value=True,
                        ):
                            with patch(
                                "integrations.graphiti.queries_pkg.kuzu_driver_patched.create_patched_kuzu_driver",
                                return_value=mock_driver,
                            ):
                                await fn_test_graphiti_connection()

                                mock_graphiti.close.assert_called_once()
        finally:
            # Clean up sys.modules
            sys.modules.pop("graphiti_core", None)

    @pytest.mark.asyncio
    async def test_creates_llm_client_with_config(self):
        """Creates LLM client with config."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = []
        mock_config.get_db_path.return_value = Path("/test/db/memory.db")
        mock_config.get_provider_summary.return_value = "LLM: openai, Embedder: openai"

        mock_llm_client = MagicMock()
        mock_embedder = MagicMock()
        mock_driver = MagicMock()
        mock_graphiti = AsyncMock()
        mock_graphiti.build_indices_and_constraints = AsyncMock()
        mock_graphiti.close = AsyncMock()

        # Mock sys.modules for graphiti_core
        mock_graphiti_core = MagicMock()
        mock_graphiti_core.Graphiti = lambda **kwargs: mock_graphiti

        sys.modules["graphiti_core"] = mock_graphiti_core

        try:
            with patch(
                "integrations.graphiti.memory.GraphitiConfig.from_env",
                return_value=mock_config,
            ):
                with patch(
                    "graphiti_providers.create_llm_client", return_value=mock_llm_client
                ) as mock_create_llm:
                    with patch(
                        "graphiti_providers.create_embedder", return_value=mock_embedder
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                            return_value=True,
                        ):
                            with patch(
                                "integrations.graphiti.queries_pkg.kuzu_driver_patched.create_patched_kuzu_driver",
                                return_value=mock_driver,
                            ):
                                await fn_test_graphiti_connection()

                                mock_create_llm.assert_called_once_with(mock_config)
        finally:
            # Clean up sys.modules
            sys.modules.pop("graphiti_core", None)

    @pytest.mark.asyncio
    async def test_creates_embedder_with_config(self):
        """Creates embedder with config."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = []
        mock_config.get_db_path.return_value = Path("/test/db/memory.db")
        mock_config.get_provider_summary.return_value = "LLM: openai, Embedder: openai"

        mock_llm_client = MagicMock()
        mock_embedder = MagicMock()
        mock_driver = MagicMock()
        mock_graphiti = AsyncMock()
        mock_graphiti.build_indices_and_constraints = AsyncMock()
        mock_graphiti.close = AsyncMock()

        # Mock sys.modules for graphiti_core
        mock_graphiti_core = MagicMock()
        mock_graphiti_core.Graphiti = lambda **kwargs: mock_graphiti

        sys.modules["graphiti_core"] = mock_graphiti_core

        try:
            with patch(
                "integrations.graphiti.memory.GraphitiConfig.from_env",
                return_value=mock_config,
            ):
                with patch(
                    "graphiti_providers.create_llm_client", return_value=mock_llm_client
                ):
                    with patch(
                        "graphiti_providers.create_embedder", return_value=mock_embedder
                    ) as mock_create_emb:
                        with patch(
                            "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                            return_value=True,
                        ):
                            with patch(
                                "integrations.graphiti.queries_pkg.kuzu_driver_patched.create_patched_kuzu_driver",
                                return_value=mock_driver,
                            ):
                                await fn_test_graphiti_connection()

                                mock_create_emb.assert_called_once_with(mock_config)
        finally:
            # Clean up sys.modules
            sys.modules.pop("graphiti_core", None)

    @pytest.mark.asyncio
    async def test_creates_patched_kuzu_driver_with_db_path(self):
        """Creates patched KuzuDriver with db_path from config."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = []
        mock_config.get_db_path.return_value = Path("/custom/db/memory.db")
        mock_config.get_provider_summary.return_value = "LLM: openai, Embedder: openai"

        mock_llm_client = MagicMock()
        mock_embedder = MagicMock()
        mock_driver = MagicMock()
        mock_graphiti = AsyncMock()
        mock_graphiti.build_indices_and_constraints = AsyncMock()
        mock_graphiti.close = AsyncMock()

        # Mock sys.modules for graphiti_core
        mock_graphiti_core = MagicMock()
        mock_graphiti_core.Graphiti = lambda **kwargs: mock_graphiti

        sys.modules["graphiti_core"] = mock_graphiti_core

        try:
            with patch(
                "integrations.graphiti.memory.GraphitiConfig.from_env",
                return_value=mock_config,
            ):
                with patch(
                    "graphiti_providers.create_llm_client", return_value=mock_llm_client
                ):
                    with patch(
                        "graphiti_providers.create_embedder", return_value=mock_embedder
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                            return_value=True,
                        ):
                            with patch(
                                "integrations.graphiti.queries_pkg.kuzu_driver_patched.create_patched_kuzu_driver",
                                return_value=mock_driver,
                            ) as mock_create_driver:
                                await fn_test_graphiti_connection()

                                mock_create_driver.assert_called_once_with(
                                    db="/custom/db/memory.db"
                                )
        finally:
            # Clean up sys.modules
            sys.modules.pop("graphiti_core", None)

    @pytest.mark.asyncio
    async def test_creates_graphiti_with_driver_and_providers(self):
        """Creates Graphiti with driver and providers."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.get_validation_errors.return_value = []
        mock_config.get_db_path.return_value = Path("/test/db/memory.db")
        mock_config.get_provider_summary.return_value = "LLM: openai, Embedder: openai"

        mock_llm_client = MagicMock()
        mock_embedder = MagicMock()
        mock_driver = MagicMock()
        mock_graphiti = AsyncMock()
        mock_graphiti.build_indices_and_constraints = AsyncMock()
        mock_graphiti.close = AsyncMock()

        # Mock sys.modules for graphiti_core
        mock_graphiti_core = MagicMock()
        mock_graphiti_core.Graphiti = MagicMock(return_value=mock_graphiti)

        sys.modules["graphiti_core"] = mock_graphiti_core

        try:
            with patch(
                "integrations.graphiti.memory.GraphitiConfig.from_env",
                return_value=mock_config,
            ):
                with patch(
                    "graphiti_providers.create_llm_client", return_value=mock_llm_client
                ):
                    with patch(
                        "graphiti_providers.create_embedder", return_value=mock_embedder
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch",
                            return_value=True,
                        ):
                            with patch(
                                "integrations.graphiti.queries_pkg.kuzu_driver_patched.create_patched_kuzu_driver",
                                return_value=mock_driver,
                            ):
                                await fn_test_graphiti_connection()

                                mock_graphiti_core.Graphiti.assert_called_once()
                                call_kwargs = mock_graphiti_core.Graphiti.call_args[1]
                                assert call_kwargs["graph_driver"] == mock_driver
                                assert call_kwargs["llm_client"] == mock_llm_client
                                assert call_kwargs["embedder"] == mock_embedder
        finally:
            # Clean up sys.modules
            sys.modules.pop("graphiti_core", None)


# =============================================================================
# Tests for fn_test_provider_configuration()
# =============================================================================


@pytest.fixture(autouse=True)
def mock_validator_functions():
    """Mock validator functions for all tests in this module.

    This fixture runs automatically for all tests and mocks the validator
    functions from graphiti_providers that are imported locally in
    fn_test_provider_configuration().

    The graphiti_providers module is a shim that re-exports from
    integrations.graphiti.providers_pkg, so we patch at the shim level
    to affect imports in memory.py.

    Returns:
        Tuple of (mock_llm, mock_embedder, mock_ollama) AsyncMock objects
    """
    import graphiti_providers

    # Create AsyncMock objects that track calls
    mock_llm = AsyncMock()
    mock_llm.return_value = (True, "LLM OK")

    mock_embedder = AsyncMock()
    mock_embedder.return_value = (True, "Embedder OK")

    mock_ollama = AsyncMock()
    mock_ollama.return_value = (True, "Ollama OK")

    # Store original functions
    original_test_llm = graphiti_providers.test_llm_connection
    original_test_embedder = graphiti_providers.test_embedder_connection
    original_test_ollama = graphiti_providers.test_ollama_connection

    # Replace with mocks
    graphiti_providers.test_llm_connection = mock_llm
    graphiti_providers.test_embedder_connection = mock_embedder
    graphiti_providers.test_ollama_connection = mock_ollama

    yield mock_llm, mock_embedder, mock_ollama

    # Restore original functions
    graphiti_providers.test_llm_connection = original_test_llm
    graphiti_providers.test_embedder_connection = original_test_embedder
    graphiti_providers.test_ollama_connection = original_test_ollama


class TestTestProviderConfiguration:
    """Tests for the test_provider_configuration async function."""

    @pytest.mark.asyncio
    async def test_returns_dict_with_expected_keys(self):
        """Returns dict with config_valid, validation_errors, llm_provider, embedder_provider."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            result = await fn_test_provider_configuration()

            assert "config_valid" in result
            assert "validation_errors" in result
            assert "llm_provider" in result
            assert "embedder_provider" in result
            assert "llm_test" in result
            assert "embedder_test" in result

    @pytest.mark.asyncio
    async def test_includes_config_valid_from_config(self):
        """Includes config_valid from config.is_valid()."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            result = await fn_test_provider_configuration()

            assert result["config_valid"] is True

    @pytest.mark.asyncio
    async def test_includes_validation_errors_from_config(self):
        """Includes validation_errors from config.get_validation_errors()."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = False
        mock_config.get_validation_errors.return_value = ["Error 1", "Error 2"]
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            result = await fn_test_provider_configuration()

            assert result["validation_errors"] == ["Error 1", "Error 2"]

    @pytest.mark.asyncio
    async def test_includes_llm_provider_from_config(self):
        """Includes llm_provider from config."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "anthropic"
        mock_config.embedder_provider = "voyage"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            result = await fn_test_provider_configuration()

            assert result["llm_provider"] == "anthropic"

    @pytest.mark.asyncio
    async def test_includes_embedder_provider_from_config(self):
        """Includes embedder_provider from config."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "anthropic"
        mock_config.embedder_provider = "voyage"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            result = await fn_test_provider_configuration()

            assert result["embedder_provider"] == "voyage"

    @pytest.mark.asyncio
    async def test_calls_test_llm_connection(self, mock_validator_functions):
        """Calls test_llm_connection()."""
        mock_llm, _, _ = mock_validator_functions
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            await fn_test_provider_configuration()

            mock_llm.assert_called_once_with(mock_config)

    @pytest.mark.asyncio
    async def test_includes_llm_test_results(self, mock_validator_functions):
        """Includes llm_test results with success and message."""
        mock_llm, _, _ = mock_validator_functions
        mock_llm.return_value = (True, "LLM Connected")
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            result = await fn_test_provider_configuration()

            assert result["llm_test"]["success"] is True
            assert result["llm_test"]["message"] == "LLM Connected"

    @pytest.mark.asyncio
    async def test_calls_test_embedder_connection(self, mock_validator_functions):
        """Calls test_embedder_connection()."""
        _, mock_embedder, _ = mock_validator_functions
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            await fn_test_provider_configuration()

            mock_embedder.assert_called_once_with(mock_config)

    @pytest.mark.asyncio
    async def test_includes_embedder_test_results(self, mock_validator_functions):
        """Includes embedder_test results with success and message."""
        _, mock_embedder, _ = mock_validator_functions
        mock_embedder.return_value = (False, "Embedder failed")
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            result = await fn_test_provider_configuration()

            assert result["embedder_test"]["success"] is False
            assert result["embedder_test"]["message"] == "Embedder failed"

    @pytest.mark.asyncio
    async def test_includes_ollama_test_when_using_ollama_llm(
        self, mock_validator_functions
    ):
        """Includes ollama_test when using ollama for LLM."""
        _, _, mock_ollama = mock_validator_functions
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "ollama"
        mock_config.embedder_provider = "openai"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            result = await fn_test_provider_configuration()

            mock_ollama.assert_called_once_with("http://localhost:11434")
            assert "ollama_test" in result
            assert result["ollama_test"]["success"] is True

    @pytest.mark.asyncio
    async def test_includes_ollama_test_when_using_ollama_embedder(
        self, mock_validator_functions
    ):
        """Includes ollama_test when using ollama for embedder."""
        _, _, mock_ollama = mock_validator_functions
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "ollama"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            result = await fn_test_provider_configuration()

            mock_ollama.assert_called_once_with("http://localhost:11434")
            assert "ollama_test" in result
            assert result["ollama_test"]["success"] is True

    @pytest.mark.asyncio
    async def test_uses_ollama_base_url_from_config(self, mock_validator_functions):
        """Uses ollama_base_url from config when testing ollama."""
        _, _, mock_ollama = mock_validator_functions
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "ollama"
        mock_config.embedder_provider = "ollama"
        mock_config.ollama_base_url = "http://custom-ollama:8080"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            await fn_test_provider_configuration()

            mock_ollama.assert_called_once_with("http://custom-ollama:8080")

    @pytest.mark.asyncio
    async def test_does_not_include_ollama_test_when_not_using_ollama(
        self, mock_validator_functions
    ):
        """Does not include ollama_test when not using ollama."""
        _, _, mock_ollama = mock_validator_functions
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_validation_errors.return_value = []
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "voyage"
        mock_config.ollama_base_url = "http://localhost:11434"

        with patch(
            "integrations.graphiti.memory.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            result = await fn_test_provider_configuration()

            mock_ollama.assert_not_called()
            assert "ollama_test" not in result


# =============================================================================
# Tests for __all__ re-exports
# =============================================================================


class TestModuleExports:
    """Tests for __all__ re-exports."""

    def test_exports_graphiti_memory(self):
        """Verify GraphitiMemory is exported."""
        from integrations.graphiti import memory

        assert hasattr(memory, "GraphitiMemory")
        assert memory.GraphitiMemory is GraphitiMemory

    def test_exports_group_id_mode(self):
        """Verify GroupIdMode is exported."""
        from integrations.graphiti import memory

        assert hasattr(memory, "GroupIdMode")
        assert memory.GroupIdMode is GroupIdMode

    def test_exports_max_context_results(self):
        """Verify MAX_CONTEXT_RESULTS is exported."""
        from integrations.graphiti import memory

        assert hasattr(memory, "MAX_CONTEXT_RESULTS")
        assert memory.MAX_CONTEXT_RESULTS == MAX_CONTEXT_RESULTS

    def test_exports_all_episode_type_constants(self):
        """Verify all episode type constants are exported."""
        from integrations.graphiti import memory

        assert hasattr(memory, "EPISODE_TYPE_SESSION_INSIGHT")
        assert memory.EPISODE_TYPE_SESSION_INSIGHT == EPISODE_TYPE_SESSION_INSIGHT

        assert hasattr(memory, "EPISODE_TYPE_CODEBASE_DISCOVERY")
        assert memory.EPISODE_TYPE_CODEBASE_DISCOVERY == EPISODE_TYPE_CODEBASE_DISCOVERY

        assert hasattr(memory, "EPISODE_TYPE_PATTERN")
        assert memory.EPISODE_TYPE_PATTERN == EPISODE_TYPE_PATTERN

        assert hasattr(memory, "EPISODE_TYPE_GOTCHA")
        assert memory.EPISODE_TYPE_GOTCHA == EPISODE_TYPE_GOTCHA

        assert hasattr(memory, "EPISODE_TYPE_TASK_OUTCOME")
        assert memory.EPISODE_TYPE_TASK_OUTCOME == EPISODE_TYPE_TASK_OUTCOME

        assert hasattr(memory, "EPISODE_TYPE_QA_RESULT")
        assert memory.EPISODE_TYPE_QA_RESULT == EPISODE_TYPE_QA_RESULT

        assert hasattr(memory, "EPISODE_TYPE_HISTORICAL_CONTEXT")
        assert memory.EPISODE_TYPE_HISTORICAL_CONTEXT == EPISODE_TYPE_HISTORICAL_CONTEXT

    def test_exports_get_graphiti_memory(self):
        """Verify get_graphiti_memory is exported."""
        from integrations.graphiti import memory

        assert hasattr(memory, "get_graphiti_memory")
        assert memory.get_graphiti_memory is get_graphiti_memory

    def test_exports_is_graphiti_enabled(self):
        """Verify is_graphiti_enabled is exported."""
        from integrations.graphiti import memory

        assert hasattr(memory, "is_graphiti_enabled")
        assert memory.is_graphiti_enabled is is_graphiti_enabled

    def test_exports_test_graphiti_connection(self):
        """Verify test_graphiti_connection is exported."""
        from integrations.graphiti import memory

        assert hasattr(memory, "test_graphiti_connection")

    def test_exports_test_provider_configuration(self):
        """Verify test_provider_configuration is exported."""
        from integrations.graphiti import memory

        assert hasattr(memory, "test_provider_configuration")

    def test_all_list_contains_expected_exports(self):
        """Verify __all__ contains all expected exports."""
        from integrations.graphiti import memory

        expected_exports = [
            "GraphitiMemory",
            "GroupIdMode",
            "get_graphiti_memory",
            "is_graphiti_enabled",
            "test_graphiti_connection",
            "test_provider_configuration",
            "MAX_CONTEXT_RESULTS",
            "EPISODE_TYPE_SESSION_INSIGHT",
            "EPISODE_TYPE_CODEBASE_DISCOVERY",
            "EPISODE_TYPE_PATTERN",
            "EPISODE_TYPE_GOTCHA",
            "EPISODE_TYPE_TASK_OUTCOME",
            "EPISODE_TYPE_QA_RESULT",
            "EPISODE_TYPE_HISTORICAL_CONTEXT",
        ]

        for export in expected_exports:
            assert export in memory.__all__, f"{export} not in __all__"

    def test_all_list_length_matches_expected(self):
        """Verify __all__ list has expected length."""
        from integrations.graphiti import memory

        # Expected: 14 exports based on the __all__ list in memory.py
        assert len(memory.__all__) == 14
