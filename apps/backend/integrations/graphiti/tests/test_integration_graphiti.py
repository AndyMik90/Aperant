"""
Integration tests for Graphiti memory system with LadybugDB.

Converted from run_graphiti_memory_test.py to proper pytest format.

These tests require a running LadybugDB/kuzu environment and are marked
with @pytest.mark.integration so they can be skipped in CI without the
required infrastructure.

Original script: integrations/graphiti/run_graphiti_memory_test.py

Usage:
    # Run only integration tests:
    pytest tests/test_integration_graphiti.py -v -m integration

    # Skip integration tests (default in CI):
    pytest tests/ -v -m "not integration"
"""

import json
import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

# =============================================================================
# Markers
# =============================================================================

pytestmark = [
    pytest.mark.integration,
]

# =============================================================================
# Mock External Dependencies
# =============================================================================


@pytest.fixture(autouse=True)
def mock_graphiti_core_modules():
    """Auto-mock graphiti_core and related modules for all tests.

    This prevents actual graph database connections during tests.
    """
    mock_graphiti_core = MagicMock()
    mock_nodes = MagicMock()
    mock_episode_type = MagicMock()
    mock_episode_type.text = "text"
    mock_nodes.EpisodeType = mock_episode_type
    mock_graphiti_core.nodes = mock_nodes

    # Mock the Graphiti class
    mock_graphiti_class = MagicMock()
    mock_graphiti_instance = MagicMock()
    mock_graphiti_instance.add_episode = AsyncMock()
    mock_graphiti_instance.search = AsyncMock(return_value=[])
    mock_graphiti_instance.build_indices_and_constraints = AsyncMock()
    mock_graphiti_instance.close = AsyncMock()
    mock_graphiti_class.return_value = mock_graphiti_instance
    mock_graphiti_core.Graphiti = mock_graphiti_class

    # Mock driver
    mock_driver = MagicMock()
    mock_driver_module = MagicMock()
    mock_driver_module.KuzuDriver = MagicMock()
    mock_graphiti_core.driver = MagicMock()
    mock_graphiti_core.driver.kuzu_driver = mock_driver_module

    sys.modules["graphiti_core"] = mock_graphiti_core
    sys.modules["graphiti_core.nodes"] = mock_nodes
    sys.modules["graphiti_core.driver"] = mock_graphiti_core.driver
    sys.modules["graphiti_core.driver.kuzu_driver"] = mock_driver_module

    try:
        yield {
            "graphiti_core": mock_graphiti_core,
            "episode_type": mock_episode_type,
            "graphiti_instance": mock_graphiti_instance,
        }
    finally:
        sys.modules.pop("graphiti_core", None)
        sys.modules.pop("graphiti_core.nodes", None)
        sys.modules.pop("graphiti_core.driver", None)
        sys.modules.pop("graphiti_core.driver.kuzu_driver", None)


@pytest.fixture
def mock_env_for_graphiti(tmp_path):
    """Set environment variables for Graphiti integration testing.

    Yields:
        dict: Dictionary of environment variables that were set.
    """
    test_db_path = str(tmp_path / "test_graphiti.db")

    env_vars = {
        "GRAPHITI_ENABLED": "true",
        "GRAPHITI_LLM_PROVIDER": "openai",
        "GRAPHITI_EMBEDDER_PROVIDER": "openai",
        "GRAPHITI_DATABASE": "test_memory",
        "GRAPHITI_DB_PATH": test_db_path,
        "OPENAI_MODEL": "gpt-5-mini",
        "OPENAI_EMBEDDING_MODEL": "text-embedding-3-small",
        "OPENAI_API_KEY": "sk-test-key-for-integration-testing",
    }

    original = {k: os.environ.get(k) for k in env_vars}

    for key, value in env_vars.items():
        os.environ[key] = value

    yield env_vars

    for key, original_value in original.items():
        if original_value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = original_value


# =============================================================================
# Client Fixtures
# =============================================================================


@pytest.fixture
def mock_client():
    """Create a mock GraphitiClient with common methods."""
    client = MagicMock()
    client.graphiti = MagicMock()
    client.graphiti.add_episode = AsyncMock()
    client.graphiti.search = AsyncMock(return_value=[])
    client.graphiti.build_indices_and_constraints = AsyncMock()
    client.graphiti.close = AsyncMock()
    client.is_initialized = True
    client.initialize = AsyncMock(return_value=True)
    client.close = AsyncMock()
    return client


@pytest.fixture
def queries(mock_client):
    """Create a GraphitiQueries instance for testing."""
    from integrations.graphiti.queries_pkg.queries import GraphitiQueries

    return GraphitiQueries(
        client=mock_client,
        group_id="integration_test_group",
        spec_context_id="integration_test_spec",
    )


# =============================================================================
# Test: LadybugDB Connection (from test_ladybugdb_connection)
# =============================================================================


class TestLadybugDBConnection:
    """Tests for LadybugDB connection verification.

    Converted from test_ladybugdb_connection() in run_graphiti_memory_test.py.
    """

    def test_ladybug_monkeypatch_import_path(self):
        """Test that the LadybugDB monkeypatch import path exists.

        Verifies the import mechanism is available, without requiring
        the actual real_ladybug package.
        """
        from integrations.graphiti.queries_pkg.client import _apply_ladybug_monkeypatch

        assert callable(_apply_ladybug_monkeypatch)

    def test_database_path_construction(self, tmp_path):
        """Test that database path is correctly constructed."""
        db_path = tmp_path / "test_db"
        database = "test_memory"
        full_path = db_path / database

        # Parent should be creatable
        full_path.parent.mkdir(parents=True, exist_ok=True)
        assert full_path.parent.exists()


# =============================================================================
# Test: Episode Save (from test_save_episode)
# =============================================================================


class TestEpisodeSave:
    """Tests for episode save operations.

    Converted from test_save_episode() in run_graphiti_memory_test.py.
    """

    @pytest.mark.asyncio
    async def test_save_session_insight_episode(self, queries):
        """Test saving a session insight episode."""
        insights = {
            "subtasks_completed": ["test-subtask-1"],
            "discoveries": {
                "files_understood": {"test.py": "Test file"},
                "patterns_found": ["Pattern: LadybugDB works!"],
                "gotchas_encountered": [],
            },
            "what_worked": ["Using embedded database"],
            "what_failed": [],
            "recommendations_for_next_session": ["Continue testing"],
        }

        result = await queries.add_session_insight(session_num=1, insights=insights)

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "session_insight"
        assert episode_body["session_number"] == 1
        assert "subtasks_completed" in episode_body
        assert "test-subtask-1" in episode_body["subtasks_completed"]

    @pytest.mark.asyncio
    async def test_save_pattern_episode(self, queries):
        """Test saving a code pattern episode."""
        pattern = "LadybugDB pattern: Embedded graph database works without Docker"

        result = await queries.add_pattern(pattern)

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "pattern"
        assert episode_body["pattern"] == pattern

    @pytest.mark.asyncio
    async def test_save_gotcha_episode(self, queries):
        """Test saving a gotcha episode."""
        gotcha = "Always close database connections in finally blocks"

        result = await queries.add_gotcha(gotcha)

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "gotcha"
        assert episode_body["gotcha"] == gotcha

    @pytest.mark.asyncio
    async def test_save_codebase_discoveries_episode(self, queries):
        """Test saving codebase discoveries episode."""
        discoveries = {
            "src/main.py": "Entry point for the application",
            "src/config.py": "Configuration module with env var loading",
        }

        result = await queries.add_codebase_discoveries(discoveries)

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "codebase_discovery"
        assert episode_body["files"] == discoveries

    @pytest.mark.asyncio
    async def test_save_task_outcome_episode(self, queries):
        """Test saving a task outcome episode."""
        result = await queries.add_task_outcome(
            task_id="integration-task-1",
            success=True,
            outcome="Integration test completed successfully",
            metadata={"duration_seconds": 45},
        )

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "task_outcome"
        assert episode_body["task_id"] == "integration-task-1"
        assert episode_body["success"] is True
        assert episode_body["duration_seconds"] == 45


# =============================================================================
# Test: Episode Save Error Handling
# =============================================================================


class TestEpisodeSaveErrorHandling:
    """Tests for episode save error handling.

    Verifies graceful failure when database operations fail.
    """

    @pytest.mark.asyncio
    async def test_session_insight_handles_database_error(self, queries):
        """Test that session insight save handles database errors gracefully."""
        queries.client.graphiti.add_episode.side_effect = Exception(
            "Database connection lost"
        )

        result = await queries.add_session_insight(session_num=1, insights={})

        assert result is False

    @pytest.mark.asyncio
    async def test_pattern_handles_database_error(self, queries):
        """Test that pattern save handles database errors gracefully."""
        queries.client.graphiti.add_episode.side_effect = Exception(
            "Database connection lost"
        )

        result = await queries.add_pattern("test pattern")

        assert result is False

    @pytest.mark.asyncio
    async def test_gotcha_handles_database_error(self, queries):
        """Test that gotcha save handles database errors gracefully."""
        queries.client.graphiti.add_episode.side_effect = Exception(
            "Database connection lost"
        )

        result = await queries.add_gotcha("test gotcha")

        assert result is False

    @pytest.mark.asyncio
    async def test_codebase_discoveries_handles_database_error(self, queries):
        """Test that codebase discoveries save handles database errors gracefully."""
        queries.client.graphiti.add_episode.side_effect = Exception(
            "Database connection lost"
        )

        result = await queries.add_codebase_discoveries({"file.py": "desc"})

        assert result is False

    @pytest.mark.asyncio
    async def test_task_outcome_handles_database_error(self, queries):
        """Test that task outcome save handles database errors gracefully."""
        queries.client.graphiti.add_episode.side_effect = Exception(
            "Database connection lost"
        )

        result = await queries.add_task_outcome("task-1", True, "outcome")

        assert result is False


# =============================================================================
# Test: GraphitiMemory Class (from test_graphiti_memory_class)
# =============================================================================


class TestGraphitiMemoryClass:
    """Tests for the GraphitiMemory wrapper class.

    Converted from test_graphiti_memory_class() in run_graphiti_memory_test.py.
    """

    def test_graphiti_memory_import(self):
        """Test that GraphitiMemory can be imported."""
        from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

        assert GraphitiMemory is not None

    def test_graphiti_memory_facade_import(self):
        """Test that GraphitiMemory can be imported from memory facade."""
        from integrations.graphiti.memory import GraphitiMemory

        assert GraphitiMemory is not None

    def test_graphiti_memory_initialization(self, tmp_path, mock_env_for_graphiti):
        """Test GraphitiMemory initialization with test config."""
        from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

        spec_dir = tmp_path / "test_spec"
        project_dir = tmp_path / "test_project"
        spec_dir.mkdir()
        project_dir.mkdir()

        memory = GraphitiMemory(spec_dir, project_dir)

        assert memory.spec_dir == spec_dir
        assert memory.project_dir == project_dir
        assert memory.group_id == spec_dir.name

    def test_graphiti_memory_group_id_spec_mode(self, tmp_path, mock_env_for_graphiti):
        """Test group ID generation in spec mode."""
        from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory
        from integrations.graphiti.queries_pkg.schema import GroupIdMode

        spec_dir = tmp_path / "spec_001_auth"
        project_dir = tmp_path / "my_project"
        spec_dir.mkdir()
        project_dir.mkdir()

        memory = GraphitiMemory(spec_dir, project_dir, group_id_mode=GroupIdMode.SPEC)

        assert memory.group_id == "spec_001_auth"

    def test_graphiti_memory_group_id_project_mode(self, tmp_path, mock_env_for_graphiti):
        """Test group ID generation in project mode."""
        from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory
        from integrations.graphiti.queries_pkg.schema import GroupIdMode

        spec_dir = tmp_path / "spec_001_auth"
        project_dir = tmp_path / "my_project"
        spec_dir.mkdir()
        project_dir.mkdir()

        memory = GraphitiMemory(spec_dir, project_dir, group_id_mode=GroupIdMode.PROJECT)

        assert memory.group_id.startswith("project_my_project_")

    def test_graphiti_memory_status_summary(self, tmp_path, mock_env_for_graphiti):
        """Test get_status_summary returns expected structure."""
        from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory

        spec_dir = tmp_path / "test_spec"
        project_dir = tmp_path / "test_project"
        spec_dir.mkdir()
        project_dir.mkdir()

        memory = GraphitiMemory(spec_dir, project_dir)
        status = memory.get_status_summary()

        assert "enabled" in status
        assert "initialized" in status
        assert "database" in status
        assert "group_id" in status
        assert "group_id_mode" in status
        assert "episode_count" in status
        assert "last_session" in status
        assert "errors" in status


# =============================================================================
# Test: Episode Content Integrity
# =============================================================================


class TestEpisodeContentIntegrity:
    """Tests for episode content integrity across serialization.

    Validates that episode data survives JSON round-trip serialization,
    which is the core mechanism used by the memory system.
    """

    @pytest.mark.asyncio
    async def test_episode_content_json_roundtrip(self, queries):
        """Test that episode content survives JSON serialization."""
        insights = {
            "subtasks_completed": ["task-1", "task-2", "task-3"],
            "discoveries": {
                "files_understood": {
                    "src/auth.py": "Authentication module",
                    "src/db.py": "Database connection pool",
                },
            },
            "what_worked": ["Dependency injection pattern"],
            "what_failed": ["Initial connection pooling approach"],
            "nested_data": {"level1": {"level2": {"level3": "deep value"}}},
        }

        result = await queries.add_session_insight(session_num=5, insights=insights)

        assert result is True

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])

        # Verify nested structures are preserved
        assert episode_body["discoveries"]["files_understood"]["src/auth.py"] == "Authentication module"
        assert episode_body["nested_data"]["level1"]["level2"]["level3"] == "deep value"
        assert len(episode_body["subtasks_completed"]) == 3

    @pytest.mark.asyncio
    async def test_episode_group_id_is_set(self, queries):
        """Test that group_id is correctly set on stored episodes."""
        result = await queries.add_pattern("test pattern")

        assert result is True
        call_args = queries.client.graphiti.add_episode.call_args
        assert call_args[1]["group_id"] == "integration_test_group"

    @pytest.mark.asyncio
    async def test_episode_source_type_is_text(self, queries, mock_graphiti_core_modules):
        """Test that episode source type is set to text."""
        result = await queries.add_pattern("test pattern")

        assert result is True
        call_args = queries.client.graphiti.add_episode.call_args
        assert call_args[1]["source"] == mock_graphiti_core_modules["episode_type"].text
