"""
Unit tests for integrations.graphiti.queries_pkg.graphiti module.

Tests for:
- GraphitiMemory class initialization and properties
- GraphitiMemory.initialize() method
- GraphitiMemory.close() method
- GraphitiMemory save methods (save_session_insights, save_codebase_discoveries, etc.)
- GraphitiMemory search methods (get_relevant_context, get_session_history, etc.)
- GraphitiMemory utility methods (get_status_summary, _ensure_initialized, _record_error)
- Group ID modes (spec vs project)
- Provider change detection and migration warnings
- Error handling and Sentry integration
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

# =============================================================================
# Mock External Dependencies
# =============================================================================


@pytest.fixture(autouse=True)
def mock_external_dependencies():
    """Auto-mock external dependencies for all tests."""
    mock_graphiti_core = MagicMock()
    mock_nodes = MagicMock()
    mock_episode_type = MagicMock()
    mock_episode_type.text = "text"
    mock_nodes.EpisodeType = mock_episode_type
    mock_graphiti_core.nodes = mock_nodes

    import sys

    sys.modules["graphiti_core"] = mock_graphiti_core
    sys.modules["graphiti_core.nodes"] = mock_nodes

    yield mock_episode_type

    # Clean up
    sys.modules.pop("graphiti_core", None)
    sys.modules.pop("graphiti_core.nodes", None)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def graphiti_test_spec_dir(tmp_path):
    """Create a temporary spec directory for GraphitiMemory tests.

    Note: Named differently from conftest.graphiti_test_spec_dir to avoid shadowing.
    GraphitiMemory tests need a slightly different directory structure.
    """
    spec_dir = tmp_path / "specs" / "001-test-spec"
    spec_dir.mkdir(parents=True)
    return spec_dir


@pytest.fixture
def graphiti_test_project_dir(tmp_path):
    """Create a temporary project directory for GraphitiMemory tests.

    Note: Named differently from conftest.graphiti_test_project_dir to avoid shadowing.
    GraphitiMemory tests need a slightly different directory structure.
    """
    project_dir = tmp_path / "test_project"
    project_dir.mkdir(parents=True)
    return project_dir


@pytest.fixture
def mock_graphiti_config():
    """Create a mock GraphitiConfig for GraphitiMemory tests.

    Note: Named differently from conftest.mock_config to avoid shadowing.
    Uses MagicMock instead of real GraphitiConfig for simpler test setup.
    """
    config = MagicMock()
    config.enabled = True
    config.is_valid.return_value = True
    config.database = "test_memory"
    config.db_path = "~/.auto-claude/memories"
    config.llm_provider = "openai"
    config.embedder_provider = "openai"
    config.get_provider_summary.return_value = "LLM: openai, Embedder: openai"
    return config


@pytest.fixture
def mock_graphiti_state():
    """Create a mock GraphitiState for GraphitiMemory tests.

    Note: Named differently from conftest.mock_state to avoid shadowing.
    Uses MagicMock instead of real GraphitiState for simpler test setup.
    """
    state = MagicMock()
    state.initialized = False
    state.database = None
    state.created_at = None
    state.llm_provider = None
    state.embedder_provider = None
    state.last_session = None
    state.episode_count = 0
    state.error_log = []
    state.has_provider_changed.return_value = False
    state.get_migration_info.return_value = None
    return state


@pytest.fixture
def mock_client():
    """Create a mock GraphitiClient."""
    client = MagicMock()
    client.is_initialized = False
    client.initialize = AsyncMock(return_value=True)
    client.close = AsyncMock()
    client.graphiti = MagicMock()
    return client


@pytest.fixture
def mock_queries():
    """Create a mock GraphitiQueries."""
    queries = MagicMock()
    queries.add_session_insight = AsyncMock(return_value=True)
    queries.add_codebase_discoveries = AsyncMock(return_value=True)
    queries.add_pattern = AsyncMock(return_value=True)
    queries.add_gotcha = AsyncMock(return_value=True)
    queries.add_task_outcome = AsyncMock(return_value=True)
    queries.add_structured_insights = AsyncMock(return_value=True)
    return queries


@pytest.fixture
def mock_search():
    """Create a mock GraphitiSearch."""
    search = MagicMock()
    search.get_relevant_context = AsyncMock(return_value=[])
    search.get_session_history = AsyncMock(return_value=[])
    search.get_similar_task_outcomes = AsyncMock(return_value=[])
    search.get_patterns_and_gotchas = AsyncMock(return_value=([], []))
    return search


# =============================================================================
# Test GraphitiMemory Initialization
# =============================================================================


class TestGraphitiMemoryInit:
    """Test GraphitiMemory initialization."""

    def test_init_with_spec_mode(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test initialization with SPEC group_id_mode."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir,
                    graphiti_test_project_dir,
                    group_id_mode="spec",
                )

                assert memory.spec_dir == graphiti_test_spec_dir
                assert memory.project_dir == graphiti_test_project_dir
                assert memory.group_id_mode == "spec"
                assert memory.config == mock_graphiti_config
                assert memory._available is True
                assert memory.state is None
                assert memory._client is None
                assert memory._queries is None
                assert memory._search is None

    def test_init_with_project_mode(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test initialization with PROJECT group_id_mode."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir,
                    graphiti_test_project_dir,
                    group_id_mode="project",
                )

                assert memory.group_id_mode == "project"

    def test_init_with_disabled_config(
        self, graphiti_test_spec_dir, graphiti_test_project_dir
    ):
        """Test initialization when Graphiti is disabled."""
        mock_config = MagicMock()
        mock_config.enabled = False
        mock_config.is_valid.return_value = False

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                assert memory._available is False

    def test_init_loads_existing_state(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
    ):
        """Test initialization loads existing state if available."""
        mock_graphiti_state.initialized = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                assert memory.state == mock_graphiti_state


# =============================================================================
# Test Properties
# =============================================================================


class TestGraphitiMemoryProperties:
    """Test GraphitiMemory properties."""

    def test_is_enabled_returns_available(
        self, graphiti_test_spec_dir, graphiti_test_project_dir
    ):
        """Test is_enabled returns _available."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._available = True

                assert memory.is_enabled is True

                memory._available = False
                assert memory.is_enabled is False

    def test_is_initialized_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test is_initialized returns False when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                assert memory.is_initialized is False

    def test_is_initialized_when_initialized(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test is_initialized returns True when initialized."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client

                assert memory.is_initialized is True

    def test_is_initialized_when_state_missing(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_client,
    ):
        """Test is_initialized returns False when state is None."""
        mock_client.is_initialized = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client

                assert memory.is_initialized is False

    def test_is_initialized_when_state_not_initialized(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test is_initialized returns False when state.initialized is False."""
        mock_graphiti_state.initialized = False
        mock_client.is_initialized = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client

                assert memory.is_initialized is False

    def test_group_id_in_spec_mode(
        self, graphiti_test_spec_dir, graphiti_test_project_dir
    ):
        """Test group_id returns spec_dir.name in SPEC mode."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir,
                    graphiti_test_project_dir,
                    group_id_mode="spec",
                )

                assert memory.group_id == "001-test-spec"

    def test_group_id_in_project_mode(
        self, graphiti_test_spec_dir, graphiti_test_project_dir
    ):
        """Test group_id returns project hash in PROJECT mode."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir,
                    graphiti_test_project_dir,
                    group_id_mode="project",
                )

                # Should start with "project_test_project_"
                assert memory.group_id.startswith("project_test_project_")
                # Should have 8 character hash
                assert len(memory.group_id.split("_")[-1]) == 8

    def test_spec_context_id(self, graphiti_test_spec_dir, graphiti_test_project_dir):
        """Test spec_context_id returns spec_dir.name."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                assert memory.spec_context_id == "001-test-spec"


# =============================================================================
# Test initialize() method
# =============================================================================


class TestInitialize:
    """Test GraphitiMemory.initialize() method."""

    @pytest.mark.asyncio
    async def test_initialize_returns_true_when_already_initialized(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test initialize returns True when already initialized."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import (
                    GraphitiClient,
                    GraphitiMemory,
                    GraphitiQueries,
                    GraphitiSearch,
                )

                with patch(
                    "integrations.graphiti.queries_pkg.graphiti.GraphitiClient",
                    return_value=mock_client,
                ):
                    memory = GraphitiMemory(
                        graphiti_test_spec_dir, graphiti_test_project_dir
                    )
                    memory._client = mock_client

                    result = await memory.initialize()

                    assert result is True

    @pytest.mark.asyncio
    async def test_initialize_returns_false_when_not_available(
        self, graphiti_test_spec_dir, graphiti_test_project_dir
    ):
        """Test initialize returns False when not available."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = False

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                result = await memory.initialize()

                assert result is False

    @pytest.mark.asyncio
    async def test_initialize_creates_client_and_modules(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_client,
        mock_queries,
        mock_search,
    ):
        """Test initialize creates client, queries, and search modules."""
        mock_client.initialize = AsyncMock(return_value=True)

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import (
                    GraphitiClient,
                    GraphitiMemory,
                    GraphitiQueries,
                    GraphitiSearch,
                )

                with patch(
                    "integrations.graphiti.queries_pkg.graphiti.GraphitiClient",
                    return_value=mock_client,
                ):
                    with patch(
                        "integrations.graphiti.queries_pkg.graphiti.GraphitiQueries",
                        return_value=mock_queries,
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.graphiti.GraphitiSearch",
                            return_value=mock_search,
                        ):
                            memory = GraphitiMemory(
                                graphiti_test_spec_dir, graphiti_test_project_dir
                            )

                            result = await memory.initialize()

                            assert result is True
                            assert memory._client == mock_client
                            assert memory._queries == mock_queries
                            assert memory._search == mock_search
                            mock_client.initialize.assert_called_once_with(None)

    @pytest.mark.asyncio
    async def test_initialize_creates_new_state_when_none_exists(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_client,
    ):
        """Test initialize creates new state when none exists."""
        mock_client.initialize = AsyncMock(return_value=True)

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import (
                    GraphitiClient,
                    GraphitiMemory,
                    GraphitiQueries,
                    GraphitiSearch,
                    GraphitiState,
                )

                with patch(
                    "integrations.graphiti.queries_pkg.graphiti.GraphitiClient",
                    return_value=mock_client,
                ):
                    with patch(
                        "integrations.graphiti.queries_pkg.graphiti.GraphitiQueries",
                        return_value=MagicMock(),
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.graphiti.GraphitiSearch",
                            return_value=MagicMock(),
                        ):
                            memory = GraphitiMemory(
                                graphiti_test_spec_dir, graphiti_test_project_dir
                            )

                            result = await memory.initialize()

                            assert result is True
                            assert memory.state is not None
                            assert memory.state.initialized is True
                            assert (
                                memory.state.database == mock_graphiti_config.database
                            )
                            assert (
                                memory.state.llm_provider
                                == mock_graphiti_config.llm_provider
                            )
                            assert (
                                memory.state.embedder_provider
                                == mock_graphiti_config.embedder_provider
                            )

    @pytest.mark.asyncio
    async def test_initialize_saves_state_to_file(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_client,
    ):
        """Test initialize saves state to spec directory."""
        mock_client.initialize = AsyncMock(return_value=True)

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import (
                    GraphitiClient,
                    GraphitiMemory,
                    GraphitiQueries,
                    GraphitiSearch,
                )

                with patch(
                    "integrations.graphiti.queries_pkg.graphiti.GraphitiClient",
                    return_value=mock_client,
                ):
                    with patch(
                        "integrations.graphiti.queries_pkg.graphiti.GraphitiQueries",
                        return_value=MagicMock(),
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.graphiti.GraphitiSearch",
                            return_value=MagicMock(),
                        ):
                            memory = GraphitiMemory(
                                graphiti_test_spec_dir, graphiti_test_project_dir
                            )

                            result = await memory.initialize()

                            assert result is True
                            # Check state file was created
                            state_file = graphiti_test_spec_dir / ".graphiti_state.json"
                            assert state_file.exists()

    @pytest.mark.asyncio
    async def test_initialize_detects_provider_change(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test initialize detects and logs provider change."""
        mock_graphiti_state.initialized = True
        mock_graphiti_state.embedder_provider = "ollama"
        mock_graphiti_config.embedder_provider = "openai"
        mock_graphiti_state.has_provider_changed.return_value = True
        mock_graphiti_state.get_migration_info.return_value = {
            "old_provider": "ollama",
            "new_provider": "openai",
            "episode_count": 5,
        }
        mock_client.initialize = AsyncMock(return_value=True)

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import (
                    GraphitiClient,
                    GraphitiMemory,
                    GraphitiQueries,
                    GraphitiSearch,
                )

                with patch(
                    "integrations.graphiti.queries_pkg.graphiti.GraphitiClient",
                    return_value=mock_client,
                ):
                    with patch(
                        "integrations.graphiti.queries_pkg.graphiti.GraphitiQueries",
                        return_value=MagicMock(),
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.graphiti.GraphitiSearch",
                            return_value=MagicMock(),
                        ):
                            memory = GraphitiMemory(
                                graphiti_test_spec_dir, graphiti_test_project_dir
                            )

                            result = await memory.initialize()

                            assert result is True
                            mock_graphiti_state.has_provider_changed.assert_called_once_with(
                                mock_graphiti_config
                            )

    @pytest.mark.asyncio
    async def test_initialize_returns_false_on_client_init_failure(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_client,
    ):
        """Test initialize returns False when client initialize fails."""
        mock_client.initialize = AsyncMock(return_value=False)

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import (
                    GraphitiClient,
                    GraphitiMemory,
                )

                with patch(
                    "integrations.graphiti.queries_pkg.graphiti.GraphitiClient",
                    return_value=mock_client,
                ):
                    memory = GraphitiMemory(
                        graphiti_test_spec_dir, graphiti_test_project_dir
                    )

                    result = await memory.initialize()

                    assert result is False
                    assert memory._available is False

    @pytest.mark.asyncio
    async def test_initialize_returns_false_on_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
    ):
        """Test initialize returns False on exception."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import (
                    GraphitiClient,
                    GraphitiMemory,
                )

                with patch(
                    "integrations.graphiti.queries_pkg.graphiti.GraphitiClient",
                    side_effect=RuntimeError("Connection failed"),
                ):
                    memory = GraphitiMemory(
                        graphiti_test_spec_dir, graphiti_test_project_dir
                    )

                    result = await memory.initialize()

                    assert result is False
                    assert memory._available is False

    @pytest.mark.asyncio
    async def test_initialize_captures_exception_to_sentry(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
    ):
        """Test initialize captures exception to Sentry."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import (
                    GraphitiClient,
                    GraphitiMemory,
                )

                with patch(
                    "integrations.graphiti.queries_pkg.graphiti.GraphitiClient",
                    side_effect=RuntimeError("Connection error"),
                ):
                    with patch(
                        "integrations.graphiti.queries_pkg.graphiti.capture_exception"
                    ) as mock_capture:
                        memory = GraphitiMemory(
                            graphiti_test_spec_dir, graphiti_test_project_dir
                        )

                        result = await memory.initialize()

                        assert result is False
                        mock_capture.assert_called_once()


# =============================================================================
# Test close() method
# =============================================================================


class TestClose:
    """Test GraphitiMemory.close() method."""

    @pytest.mark.asyncio
    async def test_close_closes_client_and_clears_modules(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_client,
    ):
        """Test close closes client and clears modules."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = MagicMock()
                memory._search = MagicMock()

                await memory.close()

                mock_client.close.assert_called_once()
                assert memory._client is None
                assert memory._queries is None
                assert memory._search is None

    @pytest.mark.asyncio
    async def test_close_does_nothing_when_no_client(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test close does nothing when no client exists."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = None

                # Should not raise
                await memory.close()


# =============================================================================
# Test save_session_insights() method
# =============================================================================


class TestSaveSessionInsights:
    """Test GraphitiMemory.save_session_insights() method."""

    @pytest.mark.asyncio
    async def test_save_session_insights_returns_false_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test save_session_insights returns False when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                result = await memory.save_session_insights(1, {})

                assert result is False

    @pytest.mark.asyncio
    async def test_save_session_insights_delegates_to_queries(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_queries,
    ):
        """Test save_session_insights delegates to queries module."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries.add_session_insight = AsyncMock(return_value=True)

        insights = {"key": "value"}

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_session_insights(1, insights)

                assert result is True
                mock_queries.add_session_insight.assert_called_once_with(1, insights)

    @pytest.mark.asyncio
    async def test_save_session_insights_updates_state_on_success(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_queries,
    ):
        """Test save_session_insights updates state on success."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries.add_session_insight = AsyncMock(return_value=True)

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                await memory.save_session_insights(1, {})

                assert mock_graphiti_state.last_session == 1
                assert mock_graphiti_state.episode_count == 1
                mock_graphiti_state.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_save_session_insights_handles_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test save_session_insights handles exceptions."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries = MagicMock()
        mock_queries.add_session_insight = AsyncMock(
            side_effect=RuntimeError("Save failed")
        )

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_session_insights(1, {})

                assert result is False
                mock_graphiti_state.record_error.assert_called_once()


# =============================================================================
# Test save_codebase_discoveries() method
# =============================================================================


class TestSaveCodebaseDiscoveries:
    """Test GraphitiMemory.save_codebase_discoveries() method."""

    @pytest.mark.asyncio
    async def test_save_codebase_discoveries_returns_false_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test save_codebase_discoveries returns False when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                result = await memory.save_codebase_discoveries({})

                assert result is False

    @pytest.mark.asyncio
    async def test_save_codebase_discoveries_delegates_to_queries(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_queries,
    ):
        """Test save_codebase_discoveries delegates to queries module."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries.add_codebase_discoveries = AsyncMock(return_value=True)

        discoveries = {"file1.py": "Test file"}

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_codebase_discoveries(discoveries)

                assert result is True
                mock_queries.add_codebase_discoveries.assert_called_once_with(
                    discoveries
                )

    @pytest.mark.asyncio
    async def test_save_codebase_discoveries_updates_state_on_success(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_queries,
    ):
        """Test save_codebase_discoveries updates state on success."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries.add_codebase_discoveries = AsyncMock(return_value=True)

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                await memory.save_codebase_discoveries({})

                assert mock_graphiti_state.episode_count == 1
                mock_graphiti_state.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_save_codebase_discoveries_handles_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test save_codebase_discoveries handles exceptions."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries = MagicMock()
        mock_queries.add_codebase_discoveries = AsyncMock(
            side_effect=RuntimeError("Save failed")
        )

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_codebase_discoveries({})

                assert result is False
                mock_graphiti_state.record_error.assert_called_once()


# =============================================================================
# Test save_pattern() method
# =============================================================================


class TestSavePattern:
    """Test GraphitiMemory.save_pattern() method."""

    @pytest.mark.asyncio
    async def test_save_pattern_returns_false_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test save_pattern returns False when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                result = await memory.save_pattern("test pattern")

                assert result is False

    @pytest.mark.asyncio
    async def test_save_pattern_delegates_to_queries(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_queries,
    ):
        """Test save_pattern delegates to queries module."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries.add_pattern = AsyncMock(return_value=True)

        pattern = "Use async/await for I/O operations"

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_pattern(pattern)

                assert result is True
                mock_queries.add_pattern.assert_called_once_with(pattern)

    @pytest.mark.asyncio
    async def test_save_pattern_handles_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test save_pattern handles exceptions."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries = MagicMock()
        mock_queries.add_pattern = AsyncMock(side_effect=RuntimeError("Save failed"))

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_pattern("test pattern")

                assert result is False


# =============================================================================
# Test save_gotcha() method
# =============================================================================


class TestSaveGotcha:
    """Test GraphitiMemory.save_gotcha() method."""

    @pytest.mark.asyncio
    async def test_save_gotcha_returns_false_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test save_gotcha returns False when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                result = await memory.save_gotcha("test gotcha")

                assert result is False

    @pytest.mark.asyncio
    async def test_save_gotcha_delegates_to_queries(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_queries,
    ):
        """Test save_gotcha delegates to queries module."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries.add_gotcha = AsyncMock(return_value=True)

        gotcha = "Don't use mutable default arguments"

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_gotcha(gotcha)

                assert result is True
                mock_queries.add_gotcha.assert_called_once_with(gotcha)

    @pytest.mark.asyncio
    async def test_save_gotcha_handles_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test save_gotcha handles exceptions."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries = MagicMock()
        mock_queries.add_gotcha = AsyncMock(side_effect=RuntimeError("Save failed"))

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_gotcha("test gotcha")

                assert result is False


# =============================================================================
# Test save_task_outcome() method
# =============================================================================


class TestSaveTaskOutcome:
    """Test GraphitiMemory.save_task_outcome() method."""

    @pytest.mark.asyncio
    async def test_save_task_outcome_returns_false_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test save_task_outcome returns False when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                result = await memory.save_task_outcome("task-1", True, "Success")

                assert result is False

    @pytest.mark.asyncio
    async def test_save_task_outcome_delegates_to_queries(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_queries,
    ):
        """Test save_task_outcome delegates to queries module."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries.add_task_outcome = AsyncMock(return_value=True)

        task_id = "task-123"
        success = True
        outcome = "Task completed successfully"
        metadata = {"duration": 100}

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_task_outcome(
                    task_id, success, outcome, metadata
                )

                assert result is True
                mock_queries.add_task_outcome.assert_called_once_with(
                    task_id, success, outcome, metadata
                )

    @pytest.mark.asyncio
    async def test_save_task_outcome_with_none_metadata(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_queries,
    ):
        """Test save_task_outcome with None metadata."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries.add_task_outcome = AsyncMock(return_value=True)

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                await memory.save_task_outcome("task-1", True, "Success", None)

                mock_queries.add_task_outcome.assert_called_once_with(
                    "task-1", True, "Success", None
                )

    @pytest.mark.asyncio
    async def test_save_task_outcome_handles_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test save_task_outcome handles exceptions."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries = MagicMock()
        mock_queries.add_task_outcome = AsyncMock(
            side_effect=RuntimeError("Save failed")
        )

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_task_outcome("task-1", True, "Success")

                assert result is False


# =============================================================================
# Test save_structured_insights() method
# =============================================================================


class TestSaveStructuredInsights:
    """Test GraphitiMemory.save_structured_insights() method."""

    @pytest.mark.asyncio
    async def test_save_structured_insights_returns_false_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test save_structured_insights returns False when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                result = await memory.save_structured_insights({})

                assert result is False

    @pytest.mark.asyncio
    async def test_save_structured_insights_delegates_to_queries(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_queries,
    ):
        """Test save_structured_insights delegates to queries module."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries.add_structured_insights = AsyncMock(return_value=True)

        insights = {"patterns": ["pattern1"], "gotchas": ["gotcha1"]}

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_structured_insights(insights)

                assert result is True
                mock_queries.add_structured_insights.assert_called_once_with(insights)

    @pytest.mark.asyncio
    async def test_save_structured_insights_handles_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test save_structured_insights handles exceptions."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_queries = MagicMock()
        mock_queries.add_structured_insights = AsyncMock(
            side_effect=RuntimeError("Save failed")
        )

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._queries = mock_queries
                memory.state = mock_graphiti_state

                result = await memory.save_structured_insights({})

                assert result is False


# =============================================================================
# Test get_relevant_context() method
# =============================================================================


class TestGetRelevantContext:
    """Test GraphitiMemory.get_relevant_context() method."""

    @pytest.mark.asyncio
    async def test_get_relevant_context_returns_empty_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test get_relevant_context returns [] when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                result = await memory.get_relevant_context("test query")

                assert result == []

    @pytest.mark.asyncio
    async def test_get_relevant_context_delegates_to_search(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_search,
    ):
        """Test get_relevant_context delegates to search module."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        expected_results = [{"content": "result1"}, {"content": "result2"}]
        mock_search.get_relevant_context = AsyncMock(return_value=expected_results)

        query = "database connection patterns"
        num_results = 5

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._search = mock_search
                memory.state = mock_graphiti_state

                result = await memory.get_relevant_context(query, num_results)

                assert result == expected_results
                mock_search.get_relevant_context.assert_called_once_with(
                    query, num_results, True
                )

    @pytest.mark.asyncio
    async def test_get_relevant_context_passes_include_project_context(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_search,
    ):
        """Test get_relevant_context passes include_project_context parameter."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_search.get_relevant_context = AsyncMock(return_value=[])

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._search = mock_search
                memory.state = mock_graphiti_state

                await memory.get_relevant_context(
                    "query", include_project_context=False
                )

                mock_search.get_relevant_context.assert_called_once_with(
                    "query", 10, False
                )

    @pytest.mark.asyncio
    async def test_get_relevant_context_handles_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test get_relevant_context handles exceptions."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_search = MagicMock()
        mock_search.get_relevant_context = AsyncMock(
            side_effect=RuntimeError("Search failed")
        )

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._search = mock_search
                memory.state = mock_graphiti_state

                result = await memory.get_relevant_context("query")

                assert result == []


# =============================================================================
# Test get_session_history() method
# =============================================================================


class TestGetSessionHistory:
    """Test GraphitiMemory.get_session_history() method."""

    @pytest.mark.asyncio
    async def test_get_session_history_returns_empty_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test get_session_history returns [] when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                result = await memory.get_session_history()

                assert result == []

    @pytest.mark.asyncio
    async def test_get_session_history_delegates_to_search(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_search,
    ):
        """Test get_session_history delegates to search module."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        expected_history = [
            {"session": 1, "content": "insights1"},
            {"session": 2, "content": "insights2"},
        ]
        mock_search.get_session_history = AsyncMock(return_value=expected_history)

        limit = 10
        spec_only = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._search = mock_search
                memory.state = mock_graphiti_state

                result = await memory.get_session_history(limit, spec_only)

                assert result == expected_history
                mock_search.get_session_history.assert_called_once_with(
                    limit, spec_only
                )

    @pytest.mark.asyncio
    async def test_get_session_history_handles_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test get_session_history handles exceptions."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_search = MagicMock()
        mock_search.get_session_history = AsyncMock(
            side_effect=RuntimeError("Search failed")
        )

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._search = mock_search
                memory.state = mock_graphiti_state

                result = await memory.get_session_history()

                assert result == []


# =============================================================================
# Test get_similar_task_outcomes() method
# =============================================================================


class TestGetSimilarTaskOutcomes:
    """Test GraphitiMemory.get_similar_task_outcomes() method."""

    @pytest.mark.asyncio
    async def test_get_similar_task_outcomes_returns_empty_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test get_similar_task_outcomes returns [] when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                result = await memory.get_similar_task_outcomes("task description")

                assert result == []

    @pytest.mark.asyncio
    async def test_get_similar_task_outcomes_delegates_to_search(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_search,
    ):
        """Test get_similar_task_outcomes delegates to search module."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        expected_outcomes = [
            {"task_id": "task-1", "success": True, "outcome": "Completed"},
        ]
        mock_search.get_similar_task_outcomes = AsyncMock(
            return_value=expected_outcomes
        )

        task_description = "Implement user authentication"
        limit = 5

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._search = mock_search
                memory.state = mock_graphiti_state

                result = await memory.get_similar_task_outcomes(task_description, limit)

                assert result == expected_outcomes
                mock_search.get_similar_task_outcomes.assert_called_once_with(
                    task_description, limit
                )

    @pytest.mark.asyncio
    async def test_get_similar_task_outcomes_handles_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test get_similar_task_outcomes handles exceptions."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_search = MagicMock()
        mock_search.get_similar_task_outcomes = AsyncMock(
            side_effect=RuntimeError("Search failed")
        )

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._search = mock_search
                memory.state = mock_graphiti_state

                result = await memory.get_similar_task_outcomes("task description")

                assert result == []


# =============================================================================
# Test get_patterns_and_gotchas() method
# =============================================================================


class TestGetPatternsAndGotchas:
    """Test GraphitiMemory.get_patterns_and_gotchas() method."""

    @pytest.mark.asyncio
    async def test_get_patterns_and_gotchas_returns_empty_when_not_initialized(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test get_patterns_and_gotchas returns [], [] when not initialized."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                patterns, gotchas = await memory.get_patterns_and_gotchas("query")

                assert patterns == []
                assert gotchas == []

    @pytest.mark.asyncio
    async def test_get_patterns_and_gotchas_delegates_to_search(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
        mock_search,
    ):
        """Test get_patterns_and_gotchas delegates to search module."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        expected_patterns = [
            {"content": "Use async/await"},
            {"content": "Type hint everything"},
        ]
        expected_gotchas = [
            {"content": "Don't use mutable defaults"},
            {"content": "Beware of late binding closures"},
        ]
        mock_search.get_patterns_and_gotchas = AsyncMock(
            return_value=(expected_patterns, expected_gotchas)
        )

        query = "database operations"
        num_results = 5
        min_score = 0.6

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._search = mock_search
                memory.state = mock_graphiti_state

                patterns, gotchas = await memory.get_patterns_and_gotchas(
                    query, num_results, min_score
                )

                assert patterns == expected_patterns
                assert gotchas == expected_gotchas
                mock_search.get_patterns_and_gotchas.assert_called_once_with(
                    query, num_results, min_score
                )

    @pytest.mark.asyncio
    async def test_get_patterns_and_gotchas_handles_exception(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test get_patterns_and_gotchas handles exceptions."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True
        mock_search = MagicMock()
        mock_search.get_patterns_and_gotchas = AsyncMock(
            side_effect=RuntimeError("Search failed")
        )

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client
                memory._search = mock_search
                memory.state = mock_graphiti_state

                patterns, gotchas = await memory.get_patterns_and_gotchas("query")

                assert patterns == []
                assert gotchas == []


# =============================================================================
# Test get_status_summary() method
# =============================================================================


class TestGetStatusSummary:
    """Test GraphitiMemory.get_status_summary() method."""

    def test_get_status_summary_with_disabled_memory(
        self, graphiti_test_spec_dir, graphiti_test_project_dir
    ):
        """Test get_status_summary returns None values when disabled."""
        mock_config = MagicMock()
        mock_config.enabled = False
        mock_config.is_valid.return_value = False

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                status = memory.get_status_summary()

                assert status["enabled"] is False
                assert status["initialized"] is False
                assert status["database"] is None
                assert status["db_path"] is None
                assert status["llm_provider"] is None
                assert status["embedder_provider"] is None
                assert status["episode_count"] == 0
                assert status["last_session"] is None
                assert status["errors"] == 0

    def test_get_status_summary_with_enabled_memory(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
    ):
        """Test get_status_summary returns config values when enabled."""
        mock_graphiti_config.enabled = True
        mock_graphiti_config.is_valid.return_value = True
        mock_graphiti_config.database = "test_db"
        mock_graphiti_config.db_path = "~/.auto-claude/memories"
        mock_graphiti_config.llm_provider = "openai"
        mock_graphiti_config.embedder_provider = "openai"

        mock_graphiti_state.episode_count = 10
        mock_graphiti_state.last_session = 5
        mock_graphiti_state.error_log = ["error1", "error2"]

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                status = memory.get_status_summary()

                assert status["enabled"] is True
                assert status["database"] == "test_db"
                assert status["db_path"] == "~/.auto-claude/memories"
                assert status["llm_provider"] == "openai"
                assert status["embedder_provider"] == "openai"
                assert status["episode_count"] == 10
                assert status["last_session"] == 5
                assert status["errors"] == 2

    def test_get_status_summary_includes_group_id(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test get_status_summary includes group_id."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )

                status = memory.get_status_summary()

                assert "group_id" in status
                assert "group_id_mode" in status


# =============================================================================
# Test _ensure_initialized() method
# =============================================================================


class TestEnsureInitialized:
    """Test GraphitiMemory._ensure_initialized() method."""

    @pytest.mark.asyncio
    async def test_ensure_initialized_returns_true_when_already_initialized(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
        mock_client,
    ):
        """Test _ensure_initialized returns True when already initialized."""
        mock_graphiti_state.initialized = True
        mock_client.is_initialized = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._client = mock_client

                result = await memory._ensure_initialized()

                assert result is True

    @pytest.mark.asyncio
    async def test_ensure_initialized_returns_false_when_not_available(
        self, graphiti_test_spec_dir, graphiti_test_project_dir
    ):
        """Test _ensure_initialized returns False when not available."""
        mock_config = MagicMock()
        mock_config.is_valid.return_value = False

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory._available = False

                result = await memory._ensure_initialized()

                assert result is False

    @pytest.mark.asyncio
    async def test_ensure_initialized_calls_initialize(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_client,
    ):
        """Test _ensure_initialized calls initialize when needed."""
        mock_client.is_initialized = False
        mock_client.initialize = AsyncMock(return_value=True)

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import (
                    GraphitiClient,
                    GraphitiMemory,
                    GraphitiQueries,
                    GraphitiSearch,
                )

                with patch(
                    "integrations.graphiti.queries_pkg.graphiti.GraphitiClient",
                    return_value=mock_client,
                ):
                    with patch(
                        "integrations.graphiti.queries_pkg.graphiti.GraphitiQueries",
                        return_value=MagicMock(),
                    ):
                        with patch(
                            "integrations.graphiti.queries_pkg.graphiti.GraphitiSearch",
                            return_value=MagicMock(),
                        ):
                            memory = GraphitiMemory(
                                graphiti_test_spec_dir, graphiti_test_project_dir
                            )

                            result = await memory._ensure_initialized()

                            assert result is True


# =============================================================================
# Test _record_error() method
# =============================================================================


class TestRecordError:
    """Test GraphitiMemory._record_error() method."""

    def test_record_error_creates_state_when_none(
        self, graphiti_test_spec_dir, graphiti_test_project_dir, mock_graphiti_config
    ):
        """Test _record_error creates state when None."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=None,
            ):
                from integrations.graphiti.queries_pkg.graphiti import (
                    GraphitiMemory,
                    GraphitiState,
                )

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory.state = None

                with patch(
                    "integrations.graphiti.queries_pkg.graphiti.GraphitiState"
                ) as MockState:
                    mock_state = MagicMock()
                    MockState.return_value = mock_state

                    memory._record_error("Test error")

                    assert memory.state == mock_state
                    mock_state.record_error.assert_called_once_with("Test error")

    def test_record_error_records_and_saves(
        self,
        graphiti_test_spec_dir,
        graphiti_test_project_dir,
        mock_graphiti_config,
        mock_graphiti_state,
    ):
        """Test _record_error records error and saves state."""
        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiConfig.from_env",
            return_value=mock_graphiti_config,
        ):
            with patch(
                "integrations.graphiti.queries_pkg.graphiti.GraphitiState.load",
                return_value=mock_graphiti_state,
            ):
                from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

                memory = GraphitiMemory(
                    graphiti_test_spec_dir, graphiti_test_project_dir
                )
                memory.state = mock_graphiti_state

                memory._record_error("Test error message")

                mock_graphiti_state.record_error.assert_called_once_with(
                    "Test error message"
                )
                mock_graphiti_state.save.assert_called_once_with(graphiti_test_spec_dir)
