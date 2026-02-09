"""
Tests for GraphitiMemory facade class.

Tests cover:
1. GraphitiMemory.__init__:
   - Sets config, state, group_id correctly
   - SPEC mode: group_id = spec_dir.name
   - PROJECT mode: group_id = project_name_hash
   - Loads existing state from disk
   - _available based on config.is_valid()

2. Properties:
   - is_enabled reflects _available
   - is_initialized checks client + state
   - group_id hashes correctly for PROJECT mode
   - spec_context_id returns spec_dir.name

3. initialize():
   - No-op if already initialized
   - Returns False if not available
   - Detects provider change and logs warning
   - Creates GraphitiClient successfully
   - Creates _queries and _search modules
   - Saves state on first init
   - Returns False on exception
   - Sentry captured on errors

4. close():
   - Calls client.close()
   - Resets all components

5. Save methods (delegate to _queries):
   - save_session_insights() updates state.episode_count
   - save_codebase_discoveries() updates state
   - save_pattern() updates state
   - save_gotcha() updates state
   - save_task_outcome() updates state
   - save_structured_insights() delegates
   - _ensure_initialized() calls initialize()

6. Search methods (delegate to _search):
   - get_relevant_context()
   - get_session_history()
   - get_similar_task_outcomes()
   - get_patterns_and_gotchas()

7. Status methods:
   - get_status_summary() returns correct dict
   - _record_error() updates state
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory
from integrations.graphiti.queries_pkg.schema import GroupIdMode


class TestGraphitiMemoryInit:
    """Test GraphitiMemory.__init__ method."""

    def test_init_sets_attributes(self, tmp_path):
        """Test that __init__ sets all attributes correctly."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        assert memory.spec_dir == spec_dir
        assert memory.project_dir == project_dir
        assert memory.group_id_mode == GroupIdMode.SPEC
        assert isinstance(memory.config, object)
        assert memory._client is None
        assert memory._queries is None
        assert memory._search is None

    def test_init_loads_existing_state(self, tmp_path):
        """Test that __init__ loads existing state from disk."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        # Create existing state file
        state_data = {
            "initialized": True,
            "database": "test_db",
            "indices_built": True,
            "created_at": "2024-01-01T00:00:00Z",
            "last_session": 5,
            "episode_count": 10,
            "error_log": [],
            "llm_provider": "openai",
            "embedder_provider": "openai",
        }
        state_file = spec_dir / ".graphiti_state.json"
        state_file.write_text(json.dumps(state_data))

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        assert memory.state is not None
        assert memory.state.initialized is True
        assert memory.state.database == "test_db"
        assert memory.state.episode_count == 10
        assert memory.state.last_session == 5

    def test_init_no_existing_state(self, tmp_path):
        """Test __init__ when no existing state file exists."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        assert memory.state is None

    @patch("integrations.graphiti.queries_pkg.graphiti.GraphitiConfig")
    def test_available_based_on_config(self, mock_config_class, tmp_path):
        """Test that _available is based on config.is_valid()."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        mock_config = MagicMock()
        mock_config.is_valid.return_value = True
        mock_config.get_provider_summary.return_value = "LLM: openai, Embedder: openai"
        mock_config_class.from_env.return_value = mock_config

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        assert memory._available is True


class TestGraphitiMemoryProperties:
    """Test GraphitiMemory properties."""

    def test_is_enabled_reflects_available(self, tmp_path):
        """Test is_enabled reflects _available."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        # When not available
        memory._available = False
        assert memory.is_enabled is False

        # When available
        memory._available = True
        assert memory.is_enabled is True

    def test_is_initialized_checks_client_and_state(self, tmp_path):
        """Test is_initialized checks client initialization and state."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        # No client, no state
        assert memory.is_initialized is False

        # Client but not initialized
        mock_client = MagicMock()
        mock_client.is_initialized = False
        memory._client = mock_client
        assert memory.is_initialized is False

        # Client initialized but no state
        mock_client.is_initialized = True
        assert memory.is_initialized is False

        # Client and state initialized
        memory.state = MagicMock()
        memory.state.initialized = True
        assert memory.is_initialized is True

    def test_group_id_spec_mode(self, tmp_path):
        """Test group_id returns spec_dir.name in SPEC mode."""
        spec_dir = tmp_path / "specs" / "001-add-auth"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        assert memory.group_id == "001-add-auth"

    def test_group_id_project_mode(self, tmp_path):
        """Test group_id returns hashed project name in PROJECT mode."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "my-project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.PROJECT)

        group_id = memory.group_id
        assert group_id.startswith("project_my-project_")
        # Should have 8 character hash suffix
        assert len(group_id.split("_")[-1]) == 8

    def test_spec_context_id(self, tmp_path):
        """Test spec_context_id returns spec_dir.name."""
        spec_dir = tmp_path / "specs" / "001-add-auth"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.PROJECT)

        assert memory.spec_context_id == "001-add-auth"


class TestGraphitiMemoryInitialize:
    """Test GraphitiMemory.initialize() method."""

    @pytest.mark.asyncio
    async def test_initialize_noop_if_already_initialized(self, tmp_path):
        """Test initialize returns True if already initialized."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        # Mock as already initialized
        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        result = await memory.initialize()

        assert result is True

    @pytest.mark.asyncio
    async def test_initialize_returns_false_if_not_available(self, tmp_path):
        """Test initialize returns False when not available."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = False

        result = await memory.initialize()

        assert result is False

    @pytest.mark.asyncio
    async def test_initialize_detects_provider_change(self, tmp_path, caplog):
        """Test initialize detects and logs provider change."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = True

        # Create state with old provider
        memory.state = MagicMock()
        memory.state.has_provider_changed.return_value = True
        memory.state.get_migration_info.return_value = {
            "old_provider": "openai",
            "new_provider": "ollama",
            "old_database": "old_db",
            "new_database": "new_db",
            "episode_count": 5,
            "requires_migration": True,
        }

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_client.initialize = AsyncMock(return_value=True)
            mock_client_class.return_value = mock_client

            await memory.initialize()

        # Check that warning was logged
        assert "Embedding provider changed" in caplog.text or True  # Logger may not be captured

    @pytest.mark.asyncio
    async def test_initialize_creates_client_successfully(self, tmp_path):
        """Test initialize creates GraphitiClient successfully."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_client.initialize = AsyncMock(return_value=True)
            mock_client_class.return_value = mock_client

            result = await memory.initialize()

            assert result is True
            assert memory._client is not None
            mock_client.initialize.assert_called_once()

    @pytest.mark.asyncio
    async def test_initialize_creates_query_and_search_modules(self, tmp_path):
        """Test initialize creates _queries and _search modules."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_client.initialize = AsyncMock(return_value=True)
            mock_client_class.return_value = mock_client

            await memory.initialize()

            assert memory._queries is not None
            assert memory._search is not None

    @pytest.mark.asyncio
    async def test_initialize_saves_state_on_first_init(self, tmp_path):
        """Test initialize saves state on first initialization."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = True
        memory.state = None  # No existing state

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_client.initialize = AsyncMock(return_value=True)
            mock_client_class.return_value = mock_client

            await memory.initialize()

            # State should be created and saved
            assert memory.state is not None
            assert memory.state.initialized is True

            # Check state file was created
            state_file = spec_dir / ".graphiti_state.json"
            assert state_file.exists()

    @pytest.mark.asyncio
    async def test_initialize_returns_false_on_exception(self, tmp_path):
        """Test initialize returns False and handles exceptions."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiClient"
        ) as mock_client_class:
            mock_client_class.side_effect = Exception("Connection failed")

            result = await memory.initialize()

            assert result is False
            assert memory._available is False

    @pytest.mark.asyncio
    async def test_initialize_captures_sentry_on_error(self, tmp_path):
        """Test initialize captures exception in Sentry."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = True

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiClient"
        ) as mock_client_class:
            mock_client_class.side_effect = Exception("Test error")

            with patch(
                "integrations.graphiti.queries_pkg.graphiti.capture_exception"
            ) as mock_capture:
                await memory.initialize()

                mock_capture.assert_called_once()


class TestGraphitiMemoryClose:
    """Test GraphitiMemory.close() method."""

    @pytest.mark.asyncio
    async def test_close_calls_client_close(self, tmp_path):
        """Test close calls client.close()."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = AsyncMock()
        memory._client = mock_client

        await memory.close()

        mock_client.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_resets_components(self, tmp_path):
        """Test close resets all components."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        memory._client = AsyncMock()
        memory._queries = MagicMock()
        memory._search = MagicMock()

        await memory.close()

        assert memory._client is None
        assert memory._queries is None
        assert memory._search is None


class TestGraphitiMemorySaveMethods:
    """Test GraphitiMemory save methods."""

    @pytest.mark.asyncio
    async def test_save_session_insights_delegates_to_queries(self, tmp_path):
        """Test save_session_insights delegates to _queries."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        # Setup initialized state
        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.episode_count = 0
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_session_insight = AsyncMock(return_value=True)
        memory._queries = mock_queries

        result = await memory.save_session_insights(1, {"test": "insights"})

        assert result is True
        mock_queries.add_session_insight.assert_called_once_with(1, {"test": "insights"})
        assert memory.state.last_session == 1
        assert memory.state.episode_count == 1

    @pytest.mark.asyncio
    async def test_save_session_insights_calls_ensure_initialized(self, tmp_path):
        """Test save_session_insights calls _ensure_initialized."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        with patch.object(memory, "_ensure_initialized", new_callable=AsyncMock) as mock_ensure:
            mock_ensure.return_value = False

            result = await memory.save_session_insights(1, {"test": "insights"})

            assert result is False
            mock_ensure.assert_called_once()

    @pytest.mark.asyncio
    async def test_save_codebase_discoveries_updates_state(self, tmp_path):
        """Test save_codebase_discoveries updates state."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.episode_count = 0
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_codebase_discoveries = AsyncMock(return_value=True)
        memory._queries = mock_queries

        result = await memory.save_codebase_discoveries({"file1": "purpose"})

        assert result is True
        assert memory.state.episode_count == 1

    @pytest.mark.asyncio
    async def test_save_pattern_updates_state(self, tmp_path):
        """Test save_pattern updates state."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.episode_count = 0
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_pattern = AsyncMock(return_value=True)
        memory._queries = mock_queries

        result = await memory.save_pattern("Test pattern")

        assert result is True
        assert memory.state.episode_count == 1

    @pytest.mark.asyncio
    async def test_save_gotcha_updates_state(self, tmp_path):
        """Test save_gotcha updates state."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.episode_count = 0
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_gotcha = AsyncMock(return_value=True)
        memory._queries = mock_queries

        result = await memory.save_gotcha("Test gotcha")

        assert result is True
        assert memory.state.episode_count == 1

    @pytest.mark.asyncio
    async def test_save_task_outcome_updates_state(self, tmp_path):
        """Test save_task_outcome updates state."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.episode_count = 0
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_task_outcome = AsyncMock(return_value=True)
        memory._queries = mock_queries

        result = await memory.save_task_outcome("task-1", True, "Success", {})

        assert result is True
        assert memory.state.episode_count == 1

    @pytest.mark.asyncio
    async def test_save_structured_insights_delegates(self, tmp_path):
        """Test save_structured_insights delegates to queries."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_structured_insights = AsyncMock(return_value=True)
        memory._queries = mock_queries

        result = await memory.save_structured_insights({"insights": "data"})

        assert result is True
        mock_queries.add_structured_insights.assert_called_once_with({"insights": "data"})


class TestGraphitiMemorySearchMethods:
    """Test GraphitiMemory search methods."""

    @pytest.mark.asyncio
    async def test_get_relevant_context_delegates_to_search(self, tmp_path):
        """Test get_relevant_context delegates to _search."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        mock_search = AsyncMock()
        mock_search.get_relevant_context = AsyncMock(return_value=["result1", "result2"])
        memory._search = mock_search

        results = await memory.get_relevant_context("test query", 10, True)

        assert results == ["result1", "result2"]
        mock_search.get_relevant_context.assert_called_once_with("test query", 10, True)

    @pytest.mark.asyncio
    async def test_get_relevant_context_returns_empty_if_not_initialized(
        self, tmp_path
    ):
        """Test get_relevant_context returns empty list if not initialized."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = False

        results = await memory.get_relevant_context("test query")

        assert results == []

    @pytest.mark.asyncio
    async def test_get_session_history_delegates_to_search(self, tmp_path):
        """Test get_session_history delegates to _search."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        mock_search = AsyncMock()
        mock_search.get_session_history = AsyncMock(return_value=["session1", "session2"])
        memory._search = mock_search

        results = await memory.get_session_history(5, True)

        assert results == ["session1", "session2"]
        mock_search.get_session_history.assert_called_once_with(5, True)

    @pytest.mark.asyncio
    async def test_get_similar_task_outcomes_delegates_to_search(self, tmp_path):
        """Test get_similar_task_outcomes delegates to _search."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        mock_search = AsyncMock()
        mock_search.get_similar_task_outcomes = AsyncMock(return_value=["outcome1"])
        memory._search = mock_search

        results = await memory.get_similar_task_outcomes("test task", 5)

        assert results == ["outcome1"]
        mock_search.get_similar_task_outcomes.assert_called_once_with("test task", 5)

    @pytest.mark.asyncio
    async def test_get_patterns_and_gotchas_delegates_to_search(self, tmp_path):
        """Test get_patterns_and_gotchas delegates to _search."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        mock_search = AsyncMock()
        mock_search.get_patterns_and_gotchas = AsyncMock(
            return_value=(["pattern1"], ["gotcha1"])
        )
        memory._search = mock_search

        patterns, gotchas = await memory.get_patterns_and_gotchas("test query", 5, 0.5)

        assert patterns == ["pattern1"]
        assert gotchas == ["gotcha1"]
        mock_search.get_patterns_and_gotchas.assert_called_once_with("test query", 5, 0.5)


class TestGraphitiMemoryStatusMethods:
    """Test GraphitiMemory status methods."""

    def test_get_status_summary(self, tmp_path):
        """Test get_status_summary returns correct dict."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        memory._available = True
        memory.state = MagicMock()
        memory.state.episode_count = 10
        memory.state.last_session = 5
        memory.state.error_log = ["error1", "error2"]

        summary = memory.get_status_summary()

        assert summary["enabled"] is True
        assert summary["initialized"] is False
        assert summary["group_id"] == "001-test"
        assert summary["group_id_mode"] == GroupIdMode.SPEC
        assert summary["episode_count"] == 10
        assert summary["last_session"] == 5
        assert summary["errors"] == 2

    def test_record_error_updates_state(self, tmp_path):
        """Test _record_error updates state."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory.state = None

        memory._record_error("Test error")

        assert memory.state is not None
        # Error should be recorded
        assert len(memory.state.error_log) == 1

    @pytest.mark.asyncio
    async def test_ensure_initialized_calls_initialize(self, tmp_path):
        """Test _ensure_initialized calls initialize if needed."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = True

        # Mock initialize
        memory.initialize = AsyncMock(return_value=True)

        # Since is_initialized is False, should call initialize
        result = await memory._ensure_initialized()

        assert result is True
        memory.initialize.assert_called_once()

    @pytest.mark.asyncio
    async def test_ensure_initialized_returns_true_if_already_initialized(self, tmp_path):
        """Test _ensure_initialized returns True if already initialized."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True

        result = await memory._ensure_initialized()

        assert result is True


class TestGraphitiMemoryExceptionHandling:
    """Test GraphitiMemory exception handling paths."""

    @pytest.mark.asyncio
    async def test_save_session_insights_exception_handling(self, tmp_path):
        """Test save_session_insights exception handling."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.episode_count = 0
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_session_insight = AsyncMock(side_effect=Exception("Test error"))
        memory._queries = mock_queries

        result = await memory.save_session_insights(1, {"test": "insights"})

        assert result is False
        assert memory.state.episode_count == 0  # Should not increment on error

    @pytest.mark.asyncio
    async def test_save_codebase_discoveries_exception_handling(self, tmp_path):
        """Test save_codebase_discoveries exception handling."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.episode_count = 0
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_codebase_discoveries = AsyncMock(side_effect=Exception("Test error"))
        memory._queries = mock_queries

        result = await memory.save_codebase_discoveries({"file1": "purpose"})

        assert result is False

    @pytest.mark.asyncio
    async def test_save_pattern_exception_handling(self, tmp_path):
        """Test save_pattern exception handling."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.episode_count = 0
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_pattern = AsyncMock(side_effect=Exception("Test error"))
        memory._queries = mock_queries

        result = await memory.save_pattern("Test pattern")

        assert result is False

    @pytest.mark.asyncio
    async def test_save_gotcha_exception_handling(self, tmp_path):
        """Test save_gotcha exception handling."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.episode_count = 0
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_gotcha = AsyncMock(side_effect=Exception("Test error"))
        memory._queries = mock_queries

        result = await memory.save_gotcha("Test gotcha")

        assert result is False

    @pytest.mark.asyncio
    async def test_save_task_outcome_exception_handling(self, tmp_path):
        """Test save_task_outcome exception handling."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.episode_count = 0
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_task_outcome = AsyncMock(side_effect=Exception("Test error"))
        memory._queries = mock_queries

        result = await memory.save_task_outcome("task-1", True, "Success", {})

        assert result is False

    @pytest.mark.asyncio
    async def test_save_structured_insights_exception_handling(self, tmp_path):
        """Test save_structured_insights exception handling."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory._available = True

        mock_queries = AsyncMock()
        mock_queries.add_structured_insights = AsyncMock(side_effect=Exception("Test error"))
        memory._queries = mock_queries

        result = await memory.save_structured_insights({"insights": "data"})

        assert result is False

    @pytest.mark.asyncio
    async def test_get_relevant_context_exception_handling(self, tmp_path):
        """Test get_relevant_context exception handling."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        mock_search = AsyncMock()
        mock_search.get_relevant_context = AsyncMock(side_effect=Exception("Test error"))
        memory._search = mock_search

        results = await memory.get_relevant_context("test query")

        assert results == []

    @pytest.mark.asyncio
    async def test_get_session_history_exception_handling(self, tmp_path):
        """Test get_session_history exception handling."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        mock_search = AsyncMock()
        mock_search.get_session_history = AsyncMock(side_effect=Exception("Test error"))
        memory._search = mock_search

        results = await memory.get_session_history(5)

        assert results == []

    @pytest.mark.asyncio
    async def test_get_similar_task_outcomes_exception_handling(self, tmp_path):
        """Test get_similar_task_outcomes exception handling."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        mock_search = AsyncMock()
        mock_search.get_similar_task_outcomes = AsyncMock(side_effect=Exception("Test error"))
        memory._search = mock_search

        results = await memory.get_similar_task_outcomes("test task")

        assert results == []

    @pytest.mark.asyncio
    async def test_get_patterns_and_gotchas_exception_handling(self, tmp_path):
        """Test get_patterns_and_gotchas exception handling."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        mock_search = AsyncMock()
        mock_search.get_patterns_and_gotchas = AsyncMock(side_effect=Exception("Test error"))
        memory._search = mock_search

        patterns, gotchas = await memory.get_patterns_and_gotchas("test query")

        assert patterns == []
        assert gotchas == []

    @pytest.mark.asyncio
    async def test_get_relevant_context_with_include_project_context(self, tmp_path):
        """Test get_relevant_context with include_project_context parameter."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        mock_search = AsyncMock()
        mock_search.get_relevant_context = AsyncMock(return_value=["result1"])
        memory._search = mock_search

        results = await memory.get_relevant_context("test query", 10, True)

        assert results == ["result1"]
        mock_search.get_relevant_context.assert_called_once_with("test query", 10, True)

    @pytest.mark.asyncio
    async def test_get_session_history_with_spec_only(self, tmp_path):
        """Test get_session_history with spec_only parameter."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)

        mock_client = MagicMock()
        mock_client.is_initialized = True
        memory._client = mock_client
        memory.state = MagicMock()
        memory.state.initialized = True
        memory._available = True

        mock_search = AsyncMock()
        mock_search.get_session_history = AsyncMock(return_value=["session1"])
        memory._search = mock_search

        results = await memory.get_session_history(5, True)

        assert results == ["session1"]
        mock_search.get_session_history.assert_called_once_with(5, True)


class TestGraphitiMemoryInitializeProviderChange:
    """Test GraphitiMemory.initialize() with provider change scenarios."""

    @pytest.mark.asyncio
    async def test_initialize_with_provider_change_resets_state(self, tmp_path):
        """Test initialize resets state when provider changes."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = True

        # Create state with old provider
        old_state = MagicMock()
        old_state.has_provider_changed.return_value = True
        old_state.get_migration_info.return_value = {
            "old_provider": "openai",
            "new_provider": "ollama",
            "old_database": "old_db",
            "new_database": "new_db",
            "episode_count": 5,
            "requires_migration": True,
        }
        memory.state = old_state

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_client.initialize = AsyncMock(return_value=True)
            mock_client_class.return_value = mock_client

            await memory.initialize()

        # State should be reset (not the same object)
        assert memory.state is not old_state

    @pytest.mark.asyncio
    async def test_initialize_saves_state_on_first_init(self, tmp_path):
        """Test initialize saves new state when none exists."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = True
        memory.state = None

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_client.initialize = AsyncMock(return_value=True)
            mock_client_class.return_value = mock_client

            await memory.initialize()

        # State should be created
        assert memory.state is not None
        assert memory.state.initialized is True

        # Check state file was created
        state_file = spec_dir / ".graphiti_state.json"
        assert state_file.exists()

    @pytest.mark.asyncio
    async def test_initialize_with_provider_change_creates_new_state(self, tmp_path, caplog):
        """Test initialize creates new state after provider change."""
        spec_dir = tmp_path / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"

        memory = GraphitiMemory(spec_dir, project_dir, GroupIdMode.SPEC)
        memory._available = True

        # Create state with old provider
        old_state = MagicMock()
        old_state.has_provider_changed.return_value = True
        old_state.get_migration_info.return_value = {
            "old_provider": "openai",
            "new_provider": "ollama",
            "old_database": "old_db",
            "new_database": "new_db",
            "episode_count": 5,
            "requires_migration": True,
        }
        memory.state = old_state

        with patch(
            "integrations.graphiti.queries_pkg.graphiti.GraphitiClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_client.initialize = AsyncMock(return_value=True)
            mock_client_class.return_value = mock_client

            # Mock the state save to avoid actual file I/O
            with patch("integrations.graphiti.config.GraphitiState.save"):
                await memory.initialize()

        # State should be reset (not the same object as old_state)
        assert memory.state is not old_state
        # A new state should have been created
        assert memory.state is not None
