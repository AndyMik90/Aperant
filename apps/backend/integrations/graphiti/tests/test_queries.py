"""
Tests for GraphitiQueries class.

Tests cover:
- GraphitiQueries initialization
- add_session_insight()
- add_codebase_discoveries()
- add_pattern()
- add_gotcha()
- add_task_outcome()
- add_structured_insights()
"""

import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# =============================================================================
# Mock External Dependencies
# =============================================================================


@pytest.fixture(autouse=True)
def mock_graphiti_core_nodes():
    """Auto-mock graphiti_core for all tests."""
    import sys

    # Patch graphiti_core at module level before import
    mock_graphiti_core = MagicMock()
    mock_nodes = MagicMock()
    mock_episode_type = MagicMock()
    mock_episode_type.text = "text"
    mock_nodes.EpisodeType = mock_episode_type
    mock_graphiti_core.nodes = mock_nodes

    sys.modules["graphiti_core"] = mock_graphiti_core
    sys.modules["graphiti_core.nodes"] = mock_nodes

    try:
        yield mock_episode_type
    finally:
        # Clean up - always run even if test fails
        sys.modules.pop("graphiti_core", None)
        sys.modules.pop("graphiti_core.nodes", None)


# =============================================================================
# Client and Queries Fixtures
# =============================================================================


@pytest.fixture
def mock_client():
    """Create a mock GraphitiClient."""
    client = MagicMock()
    client.graphiti = MagicMock()
    client.graphiti.add_episode = AsyncMock()
    return client


@pytest.fixture
def queries(mock_client):
    """Create a GraphitiQueries instance."""
    from integrations.graphiti.queries_pkg.queries import GraphitiQueries

    return GraphitiQueries(
        client=mock_client,
        group_id="test_group",
        spec_context_id="test_spec",
    )


# =============================================================================
# Test Classes
# =============================================================================


class TestGraphitiQueriesInit:
    """Test GraphitiQueries initialization."""

    def test_init_sets_attributes(self, mock_client):
        """Test constructor sets all attributes correctly."""
        from integrations.graphiti.queries_pkg.queries import GraphitiQueries

        queries = GraphitiQueries(
            client=mock_client,
            group_id="my_group",
            spec_context_id="my_spec",
        )

        assert queries.client == mock_client
        assert queries.group_id == "my_group"
        assert queries.spec_context_id == "my_spec"


class TestAddSessionInsight:
    """Test add_session_insight method."""

    @pytest.mark.asyncio
    async def test_add_session_insight_success(self, queries):
        """Test successful session insight save."""
        insights = {
            "subtasks_completed": ["task-1", "task-2"],
            "discoveries": {"files_understood": {}},
            "what_worked": ["Using pytest"],
            "what_failed": [],
        }

        result = await queries.add_session_insight(session_num=1, insights=insights)

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        # Verify episode format
        call_args = queries.client.graphiti.add_episode.call_args
        assert "session_001_test_spec" in call_args[1]["name"]

        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "session_insight"
        assert episode_body["session_number"] == 1
        assert episode_body["spec_id"] == "test_spec"
        assert "subtasks_completed" in episode_body

    @pytest.mark.asyncio
    async def test_add_session_insight_exception(self, queries):
        """Test exception handling in add_session_insight."""
        queries.client.graphiti.add_episode.side_effect = Exception("Database error")

        result = await queries.add_session_insight(session_num=1, insights={})

        assert result is False


class TestAddCodebaseDiscoveries:
    """Test add_codebase_discoveries method."""

    @pytest.mark.asyncio
    async def test_add_codebase_discoveries_empty_dict(self, queries):
        """Test empty discoveries returns True without calling add_episode."""
        result = await queries.add_codebase_discoveries({})

        assert result is True
        queries.client.graphiti.add_episode.assert_not_called()

    @pytest.mark.asyncio
    async def test_add_codebase_discoveries_success(self, queries):
        """Test successful codebase discoveries save."""
        discoveries = {
            "src/main.py": "Entry point for the application",
            "src/config.py": "Configuration module",
        }

        result = await queries.add_codebase_discoveries(discoveries)

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "codebase_discovery"
        assert episode_body["files"] == discoveries

    @pytest.mark.asyncio
    async def test_add_codebase_discoveries_exception(self, queries):
        """Test exception handling in add_codebase_discoveries."""
        queries.client.graphiti.add_episode.side_effect = Exception("Database error")

        result = await queries.add_codebase_discoveries({"file.py": "desc"})

        assert result is False


class TestAddPattern:
    """Test add_pattern method."""

    @pytest.mark.asyncio
    async def test_add_pattern_success(self, queries):
        """Test successful pattern save."""
        pattern = "Use dependency injection for database connections"

        result = await queries.add_pattern(pattern)

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "pattern"
        assert episode_body["pattern"] == pattern

    @pytest.mark.asyncio
    async def test_add_pattern_exception(self, queries):
        """Test exception handling in add_pattern."""
        queries.client.graphiti.add_episode.side_effect = Exception("Database error")

        result = await queries.add_pattern("test pattern")

        assert result is False


class TestAddGotcha:
    """Test add_gotcha method."""

    @pytest.mark.asyncio
    async def test_add_gotcha_success(self, queries):
        """Test successful gotcha save."""
        gotcha = "Always close database connections in finally blocks"

        result = await queries.add_gotcha(gotcha)

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "gotcha"
        assert episode_body["gotcha"] == gotcha

    @pytest.mark.asyncio
    async def test_add_gotcha_exception(self, queries):
        """Test exception handling in add_gotcha."""
        queries.client.graphiti.add_episode.side_effect = Exception("Database error")

        result = await queries.add_gotcha("test gotcha")

        assert result is False


class TestAddTaskOutcome:
    """Test add_task_outcome method."""

    @pytest.mark.asyncio
    async def test_add_task_outcome_success(self, queries):
        """Test successful task outcome save."""
        result = await queries.add_task_outcome(
            task_id="task-123",
            success=True,
            outcome="Implementation completed successfully",
            metadata={"duration": 120},
        )

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "task_outcome"
        assert episode_body["task_id"] == "task-123"
        assert episode_body["success"] is True
        assert episode_body["outcome"] == "Implementation completed successfully"
        assert episode_body["duration"] == 120

    @pytest.mark.asyncio
    async def test_add_task_outcome_without_metadata(self, queries):
        """Test task outcome save without metadata."""
        result = await queries.add_task_outcome(
            task_id="task-456",
            success=False,
            outcome="Failed due to timeout",
        )

        assert result is True

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["task_id"] == "task-456"
        assert episode_body["success"] is False
        assert episode_body["outcome"] == "Failed due to timeout"

    @pytest.mark.asyncio
    async def test_add_task_outcome_exception(self, queries):
        """Test exception handling in add_task_outcome."""
        queries.client.graphiti.add_episode.side_effect = Exception("Database error")

        result = await queries.add_task_outcome("task-1", True, "success")

        assert result is False


class TestAddStructuredInsights:
    """Test add_structured_insights method."""

    @pytest.mark.asyncio
    async def test_add_structured_insights_empty_dict(self, queries):
        """Test empty insights returns True."""
        result = await queries.add_structured_insights({})

        assert result is True
        queries.client.graphiti.add_episode.assert_not_called()

    @pytest.mark.asyncio
    async def test_add_structured_insights_with_file_insights(self, queries):
        """Test structured insights with file insights."""
        insights = {
            "file_insights": [
                {
                    "path": "src/main.py",
                    "purpose": "Entry point",
                    "changes_made": "Added error handling",
                    "patterns_used": ["error boundaries"],
                    "gotchas": ["needs timeout"],
                }
            ]
        }

        result = await queries.add_structured_insights(insights)

        assert result is True
        assert queries.client.graphiti.add_episode.call_count == 1

    @pytest.mark.asyncio
    async def test_add_structured_insights_with_patterns(self, queries):
        """Test structured insights with discovered patterns."""
        insights = {
            "patterns_discovered": [
                {
                    "pattern": "Use factory pattern for object creation",
                    "applies_to": "Complex object initialization",
                    "example": "src/factory.py",
                },
                "Simple pattern string",  # Test non-dict pattern
            ]
        }

        result = await queries.add_structured_insights(insights)

        assert result is True
        assert queries.client.graphiti.add_episode.call_count == 2

    @pytest.mark.asyncio
    async def test_add_structured_insights_with_gotchas(self, queries):
        """Test structured insights with discovered gotchas."""
        insights = {
            "gotchas_discovered": [
                {
                    "gotcha": "Don't use mutable default arguments",
                    "trigger": "Function definition with [] as default",
                    "solution": "Use None and check in function body",
                }
            ]
        }

        result = await queries.add_structured_insights(insights)

        assert result is True

    @pytest.mark.asyncio
    async def test_add_structured_insights_with_outcome(self, queries):
        """Test structured insights with approach outcome."""
        insights = {
            "subtask_id": "task-1",
            "approach_outcome": {
                "success": True,
                "approach_used": "Used Graphiti for memory",
                "why_it_worked": "Efficient semantic search",
                "alternatives_tried": ["PostgreSQL"],
            },
            "changed_files": ["src/memory.py"],
        }

        result = await queries.add_structured_insights(insights)

        assert result is True

    @pytest.mark.asyncio
    async def test_add_structured_insights_with_recommendations(self, queries):
        """Test structured insights with recommendations."""
        insights = {
            "subtask_id": "task-2",
            "recommendations": [
                "Add error handling",
                "Improve test coverage",
            ],
        }

        result = await queries.add_structured_insights(insights)

        assert result is True

    @pytest.mark.asyncio
    async def test_add_structured_insights_handles_duplicate_facts_error(self, queries):
        """Test that duplicate_facts error is handled as non-fatal."""
        insights = {"file_insights": [{"path": "src/test.py", "purpose": "Test file"}]}

        # First call fails with duplicate_facts, second succeeds
        queries.client.graphiti.add_episode.side_effect = [
            Exception("invalid duplicate_facts idx"),
            None,  # Second call succeeds
        ]

        result = await queries.add_structured_insights(insights)

        assert result is True

    @pytest.mark.asyncio
    async def test_add_structured_insights_string_pattern(self, queries):
        """Test string pattern (non-dict) handling."""
        insights = {"patterns_discovered": ["Simple string pattern"]}

        result = await queries.add_structured_insights(insights)

        assert result is True

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["pattern"] == "Simple string pattern"
        assert episode_body["applies_to"] == ""
        assert episode_body["example"] == ""

    @pytest.mark.asyncio
    async def test_add_structured_insights_string_gotcha(self, queries):
        """Test string gotcha (non-dict) handling."""
        insights = {"gotchas_discovered": ["Simple string gotcha"]}

        result = await queries.add_structured_insights(insights)

        assert result is True

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["gotcha"] == "Simple string gotcha"
        assert episode_body["trigger"] == ""
        assert episode_body["solution"] == ""

    @pytest.mark.asyncio
    async def test_add_structured_insights_file_insight_with_all_fields(self, queries):
        """Test file insight with all optional fields."""
        insights = {
            "file_insights": [
                {
                    "path": "src/test.py",
                    "purpose": "Test module",
                    "changes_made": "Added new tests",
                    "patterns_used": ["pattern1", "pattern2"],
                    "gotchas": ["gotcha1", "gotcha2"],
                }
            ]
        }

        result = await queries.add_structured_insights(insights)

        assert result is True

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["file_path"] == "src/test.py"
        assert episode_body["purpose"] == "Test module"
        assert episode_body["changes_made"] == "Added new tests"
        assert episode_body["patterns_used"] == ["pattern1", "pattern2"]
        assert episode_body["gotchas"] == ["gotcha1", "gotcha2"]

    @pytest.mark.asyncio
    async def test_add_structured_insights_gotcha_non_duplicate_exception(
        self, queries
    ):
        """Test gotcha save with non-duplicate_facts exception."""
        insights = {"gotchas_discovered": [{"gotcha": "Test gotcha"}]}

        # Raise non-duplicate error
        queries.client.graphiti.add_episode.side_effect = Exception("Other error")

        result = await queries.add_structured_insights(insights)

        # Should return False since all saves failed
        assert result is False

    @pytest.mark.asyncio
    async def test_add_structured_insights_gotcha_duplicate_facts_exception(
        self, queries
    ):
        """Test gotcha save with duplicate_facts exception (lines 418-419)."""
        insights = {"gotchas_discovered": [{"gotcha": "Test gotcha"}]}

        # Raise duplicate_facts error (should be counted as success)
        queries.client.graphiti.add_episode.side_effect = Exception(
            "invalid duplicate_facts idx"
        )

        result = await queries.add_structured_insights(insights)

        # Should return True because duplicate_facts is non-fatal
        assert result is True

    @pytest.mark.asyncio
    async def test_add_structured_insights_outcome_non_duplicate_exception(
        self, queries
    ):
        """Test outcome save with non-duplicate_facts exception."""
        insights = {
            "subtask_id": "task-1",
            "approach_outcome": {"success": True, "approach_used": "Test approach"},
        }

        # Raise non-duplicate error
        queries.client.graphiti.add_episode.side_effect = Exception("Other error")

        result = await queries.add_structured_insights(insights)

        # Should return False since all saves failed
        assert result is False

    @pytest.mark.asyncio
    async def test_add_structured_insights_outcome_duplicate_facts_exception(
        self, queries
    ):
        """Test outcome save with duplicate_facts exception (lines 457-458)."""
        insights = {
            "subtask_id": "task-1",
            "approach_outcome": {"success": True, "approach_used": "Test approach"},
        }

        # Raise duplicate_facts error (should be counted as success)
        queries.client.graphiti.add_episode.side_effect = Exception(
            "invalid duplicate_facts idx"
        )

        result = await queries.add_structured_insights(insights)

        # Should return True because duplicate_facts is non-fatal
        assert result is True

    @pytest.mark.asyncio
    async def test_add_structured_insights_recommendations_non_duplicate_exception(
        self, queries
    ):
        """Test recommendations save with non-duplicate_facts exception."""
        insights = {"subtask_id": "task-1", "recommendations": ["Test recommendation"]}

        # Raise non-duplicate error
        queries.client.graphiti.add_episode.side_effect = Exception("Other error")

        result = await queries.add_structured_insights(insights)

        # Should return False since all saves failed
        assert result is False

    @pytest.mark.asyncio
    async def test_add_structured_insights_recommendations_duplicate_facts_exception(
        self, queries
    ):
        """Test recommendations save with duplicate_facts exception (lines 488-489)."""
        insights = {"subtask_id": "task-1", "recommendations": ["Test recommendation"]}

        # Raise duplicate_facts error (should be counted as success)
        queries.client.graphiti.add_episode.side_effect = Exception(
            "invalid duplicate_facts idx"
        )

        result = await queries.add_structured_insights(insights)

        # Should return True because duplicate_facts is non-fatal
        assert result is True

    @pytest.mark.asyncio
    async def test_add_structured_insights_top_level_exception_with_content(
        self, queries
    ):
        """Test top-level exception with insights content."""
        insights = {
            "file_insights": [{"path": "test.py", "purpose": "test"}],
            "patterns_discovered": [{"pattern": "test pattern"}],
            "gotchas_discovered": [{"gotcha": "test gotcha"}],
            "approach_outcome": {"success": True},
            "recommendations": ["test recommendation"],
        }

        # Mock exception during processing
        with patch(
            "integrations.graphiti.queries_pkg.queries.json.dumps",
            side_effect=Exception("JSON error"),
        ):
            result = await queries.add_structured_insights(insights)

            assert result is False

    @pytest.mark.asyncio
    async def test_add_structured_insights_outer_exception_handler(self, queries):
        """Test outer exception handler for add_structured_insights (lines 499-523)."""
        insights = {
            "file_insights": [{"path": "test.py", "purpose": "test"}],
            "patterns_discovered": [{"pattern": "Test pattern"}],
            "gotchas_discovered": [{"gotcha": "Test gotcha"}],
            "approach_outcome": {"success": True, "approach_used": "Test approach"},
            "recommendations": ["Test recommendation"],
        }

        # Mock EpisodeType import to fail, triggering outer exception handler
        import builtins

        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "graphiti_core.nodes":
                raise ImportError("EpisodeType not available")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            result = await queries.add_structured_insights(insights)

        # Should return False and trigger outer exception handler
        assert result is False

    @pytest.mark.asyncio
    async def test_add_structured_insights_all_fail(self, queries):
        """Test when all episode saves fail."""
        insights = {"file_insights": [{"path": "test.py", "purpose": "test"}]}

        queries.client.graphiti.add_episode.side_effect = Exception("Total failure")

        result = await queries.add_structured_insights(insights)

        assert result is False


class TestAddStructuredInsightsExceptionHandling:
    """Test add_structured_insights exception handling branches."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "insights_key,insights_value",
        [
            ("patterns_discovered", [{"pattern": "Test pattern"}]),
            ("gotchas_discovered", [{"gotcha": "Test gotcha"}]),
            (
                "approach_outcome",
                {
                    "subtask_id": "task-1",
                    "success": True,
                    "approach_used": "Test approach",
                },
            ),
            (
                "recommendations",
                {"subtask_id": "task-1", "recommendations": ["Test recommendation"]},
            ),
        ],
    )
    async def test_add_structured_insights_non_duplicate_exception(
        self, queries, insights_key, insights_value
    ):
        """Test exception handling for non-duplicate errors across different insight types."""
        insights = {insights_key: insights_value}

        queries.client.graphiti.add_episode.side_effect = Exception(
            "Non-duplicate error"
        )

        result = await queries.add_structured_insights(insights)

        assert result is False

    @pytest.mark.asyncio
    async def test_add_structured_insights_top_level_exception(self, queries):
        """Test top-level exception handling in add_structured_insights."""
        insights = {"file_insights": [{"path": "test.py", "purpose": "test"}]}

        # Simulate exception during JSON serialization
        with patch(
            "integrations.graphiti.queries_pkg.queries.json.dumps",
            side_effect=Exception("JSON error"),
        ):
            result = await queries.add_structured_insights(insights)

            assert result is False

    @pytest.mark.asyncio
    async def test_add_structured_insights_mixed_success_failure(self, queries):
        """Test mixed success and failure in structured insights."""
        insights = {
            "file_insights": [
                {"path": "test1.py", "purpose": "test1"},
                {"path": "test2.py", "purpose": "test2"},
            ]
        }

        # First succeeds, second fails with non-duplicate error
        queries.client.graphiti.add_episode.side_effect = [
            None,  # First succeeds
            Exception("Non-duplicate error"),  # Second fails
        ]

        result = await queries.add_structured_insights(insights)

        # Should return True because at least one succeeded
        assert result is True

    @pytest.mark.asyncio
    async def test_add_structured_insights_all_patterns_fail_with_duplicate(
        self, queries
    ):
        """Test all pattern saves fail with duplicate_facts error."""
        insights = {
            "patterns_discovered": [{"pattern": "Pattern 1"}, {"pattern": "Pattern 2"}]
        }

        # Both fail with duplicate_facts error (should be counted as success)
        queries.client.graphiti.add_episode.side_effect = [
            Exception("invalid duplicate_facts idx"),
            Exception("invalid duplicate_facts idx"),
        ]

        result = await queries.add_structured_insights(insights)

        # Should return True because duplicate_facts is non-fatal
        assert result is True

    @pytest.mark.asyncio
    async def test_add_structured_insights_dict_pattern_with_all_fields(self, queries):
        """Test dict pattern with applies_to and example fields."""
        insights = {
            "patterns_discovered": [
                {
                    "pattern": "Factory pattern",
                    "applies_to": "Object creation",
                    "example": "src/factory.py",
                }
            ]
        }

        result = await queries.add_structured_insights(insights)

        assert result is True
        assert queries.client.graphiti.add_episode.call_count == 1

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["pattern"] == "Factory pattern"
        assert episode_body["applies_to"] == "Object creation"
        assert episode_body["example"] == "src/factory.py"

    @pytest.mark.asyncio
    async def test_add_structured_insights_dict_gotcha_with_all_fields(self, queries):
        """Test dict gotcha with trigger and solution fields."""
        insights = {
            "gotchas_discovered": [
                {
                    "gotcha": "Mutable default args",
                    "trigger": "Function with [] as default",
                    "solution": "Use None and check in body",
                }
            ]
        }

        result = await queries.add_structured_insights(insights)

        assert result is True

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["gotcha"] == "Mutable default args"
        assert episode_body["trigger"] == "Function with [] as default"
        assert episode_body["solution"] == "Use None and check in body"

    @pytest.mark.asyncio
    async def test_add_structured_insights_outcome_with_all_fields(self, queries):
        """Test outcome with all optional fields."""
        insights = {
            "subtask_id": "task-1",
            "approach_outcome": {
                "success": True,
                "approach_used": "Test approach",
                "why_it_worked": "Because reasons",
                "why_it_failed": None,
                "alternatives_tried": ["Alt1", "Alt2"],
            },
            "changed_files": ["file1.py", "file2.py"],
        }

        result = await queries.add_structured_insights(insights)

        assert result is True

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["task_id"] == "task-1"
        assert episode_body["success"] is True
        assert episode_body["outcome"] == "Test approach"
        assert episode_body["why_worked"] == "Because reasons"
        assert episode_body["why_failed"] is None
        assert episode_body["alternatives_tried"] == ["Alt1", "Alt2"]
        assert episode_body["changed_files"] == ["file1.py", "file2.py"]
