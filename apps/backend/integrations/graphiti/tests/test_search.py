#!/usr/bin/env python3
"""
Unit tests for GraphitiSearch class.

Tests cover initialization, context retrieval, session history,
task outcomes, and patterns/gotchas functionality.
"""

import json
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import pytest
from integrations.graphiti.queries_pkg.schema import (
    EPISODE_TYPE_GOTCHA,
    EPISODE_TYPE_PATTERN,
    EPISODE_TYPE_SESSION_INSIGHT,
    EPISODE_TYPE_TASK_OUTCOME,
    MAX_CONTEXT_RESULTS,
    GroupIdMode,
)
from integrations.graphiti.queries_pkg.search import GraphitiSearch

# =============================================================================
# TEST FIXTURES
# =============================================================================


@pytest.fixture
def mock_client():
    """Create a mock GraphitiClient."""
    client = Mock()
    client.graphiti = Mock()
    client.graphiti.search = AsyncMock()
    return client


@pytest.fixture
def project_dir(tmp_path):
    """Create a temporary project directory."""
    project = tmp_path / "test_project"
    project.mkdir()
    return project


@pytest.fixture
def spec_dir(tmp_path):
    """Create a temporary spec directory."""
    spec = tmp_path / "test_spec"
    spec.mkdir()
    return spec


@pytest.fixture
def graphiti_search(mock_client, project_dir):
    """Create a GraphitiSearch instance for testing."""
    return GraphitiSearch(
        client=mock_client,
        group_id="test_group_id",
        spec_context_id="test_spec_123",
        group_id_mode=GroupIdMode.SPEC,
        project_dir=project_dir,
    )


# =============================================================================
# MOCK RESULT FACTORIES
# =============================================================================


def _create_mock_result(
    content: Any = None, score: float = 0.8, result_type: str = "unknown"
) -> Mock:
    """Create a mock Graphiti search result with various attributes."""
    result = Mock()
    result.content = content
    result.fact = content
    result.score = score
    result.name = "test_episode"
    result.type = result_type
    return result


def _create_valid_session_insight(
    session_number: int = 1,
    spec_id: str = "test_spec_123",
) -> dict:
    """Create a valid session insight dict."""
    return {
        "type": EPISODE_TYPE_SESSION_INSIGHT,
        "session_number": session_number,
        "spec_id": spec_id,
        "subtasks_completed": ["task-1", "task-2"],
        "discoveries": {
            "files_understood": {"app.py": "Main application file"},
            "patterns_found": ["Use async/await for I/O"],
            "gotchas_encountered": [],
        },
        "recommendations_for_next_session": ["Add error handling"],
    }


def _create_valid_task_outcome(
    task_id: str = "task-123",
    success: bool = True,
    outcome: str = "Completed successfully",
) -> dict:
    """Create a valid task outcome dict."""
    return {
        "type": EPISODE_TYPE_TASK_OUTCOME,
        "task_id": task_id,
        "success": success,
        "outcome": outcome,
    }


def _create_valid_pattern(
    pattern: str = "Test pattern",
    applies_to: str = "auth",
    example: str = "Use OAuth2",
) -> dict:
    """Create a valid pattern dict."""
    return {
        "type": EPISODE_TYPE_PATTERN,
        "pattern": pattern,
        "applies_to": applies_to,
        "example": example,
    }


def _create_valid_gotcha(
    gotcha: str = "Token expires",
    trigger: str = "Long session",
    solution: str = "Use refresh tokens",
) -> dict:
    """Create a valid gotcha dict."""
    return {
        "type": EPISODE_TYPE_GOTCHA,
        "gotcha": gotcha,
        "trigger": trigger,
        "solution": solution,
    }


# =============================================================================
# GraphitiSearch.__init__ TESTS
# =============================================================================


class TestGraphitiSearchInit:
    """Tests for GraphitiSearch.__init__ method."""

    def test_init_sets_all_attributes(self, mock_client, project_dir):
        """Test __init__ sets client, group_id, spec_context_id, group_id_mode, project_dir."""
        search = GraphitiSearch(
            client=mock_client,
            group_id="test_group",
            spec_context_id="spec_456",
            group_id_mode=GroupIdMode.PROJECT,
            project_dir=project_dir,
        )

        assert search.client == mock_client
        assert search.group_id == "test_group"
        assert search.spec_context_id == "spec_456"
        assert search.group_id_mode == GroupIdMode.PROJECT
        assert search.project_dir == project_dir

    def test_init_with_spec_mode(self, mock_client, project_dir):
        """Test __init__ with SPEC mode."""
        search = GraphitiSearch(
            client=mock_client,
            group_id="spec_group",
            spec_context_id="spec_789",
            group_id_mode=GroupIdMode.SPEC,
            project_dir=project_dir,
        )

        assert search.group_id_mode == GroupIdMode.SPEC

    def test_init_with_project_mode(self, mock_client, project_dir):
        """Test __init__ with PROJECT mode."""
        search = GraphitiSearch(
            client=mock_client,
            group_id="project_group",
            spec_context_id="spec_101",
            group_id_mode=GroupIdMode.PROJECT,
            project_dir=project_dir,
        )

        assert search.group_id_mode == GroupIdMode.PROJECT


# =============================================================================
# get_relevant_context() TESTS
# =============================================================================


class TestGetRelevantContext:
    """Tests for GraphitiSearch.get_relevant_context method."""

    @pytest.mark.asyncio
    async def test_calls_search_with_correct_params(self, graphiti_search, mock_client):
        """Test get_relevant_context calls client.graphiti.search with correct params."""
        mock_results = [
            _create_mock_result(
                content="Test content 1", score=0.9, result_type="codebase"
            ),
            _create_mock_result(
                content="Test content 2", score=0.7, result_type="pattern"
            ),
        ]
        mock_client.graphiti.search.return_value = mock_results

        result = await graphiti_search.get_relevant_context(
            query="authentication logic",
            num_results=5,
            include_project_context=False,  # Avoid project group_id in SPEC mode
        )

        # Verify search was called with correct parameters
        mock_client.graphiti.search.assert_called_once_with(
            query="authentication logic",
            group_ids=["test_group_id"],
            num_results=5,
        )

    @pytest.mark.asyncio
    async def test_returns_context_items_with_content_score_type(
        self, graphiti_search, mock_client
    ):
        """Test get_relevant_context returns list of context items with content, score, type."""
        mock_results = [
            _create_mock_result(
                content="Auth content", score=0.9, result_type="pattern"
            ),
            _create_mock_result(content="Code snippet", score=0.7, result_type="code"),
        ]
        mock_client.graphiti.search.return_value = mock_results

        _result = await graphiti_search.get_relevant_context(query="auth")

        assert len(_result) == 2
        assert _result[0]["content"] == "Auth content"
        assert _result[0]["score"] == 0.9
        assert _result[0]["type"] == "pattern"
        assert _result[1]["content"] == "Code snippet"
        assert _result[1]["score"] == 0.7
        assert _result[1]["type"] == "code"

    @pytest.mark.asyncio
    async def test_filters_by_min_score(self, graphiti_search, mock_client):
        """Test get_relevant_context filters by min_score when specified."""
        mock_results = [
            _create_mock_result(content="High score", score=0.9, result_type="pattern"),
            _create_mock_result(content="Low score", score=0.3, result_type="code"),
            _create_mock_result(
                content="Medium score", score=0.6, result_type="pattern"
            ),
        ]
        mock_client.graphiti.search.return_value = mock_results

        result = await graphiti_search.get_relevant_context(
            query="test",
            min_score=0.5,
        )

        assert len(result) == 2
        assert all(item["score"] >= 0.5 for item in result)
        assert result[0]["content"] == "High score"
        assert result[1]["content"] == "Medium score"

    @pytest.mark.asyncio
    async def test_spec_mode_includes_project_group_id(
        self, graphiti_search, mock_client, project_dir
    ):
        """Test get_relevant_context in SPEC mode with include_project_context=True adds project group_id."""
        # Create search instance with SPEC mode
        search = GraphitiSearch(
            client=mock_client,
            group_id="spec_123_group",
            spec_context_id="spec_123",
            group_id_mode=GroupIdMode.SPEC,
            project_dir=project_dir,
        )

        mock_results = [
            _create_mock_result(content="Result", score=0.8),
        ]
        mock_client.graphiti.search.return_value = mock_results

        await search.get_relevant_context(
            query="test",
            include_project_context=True,
        )

        # Verify project group_id was included
        call_args = mock_client.graphiti.search.call_args
        group_ids = call_args[1]["group_ids"]

        # Should have both spec and project group_ids
        assert len(group_ids) == 2
        assert "spec_123_group" in group_ids
        # Project group_id format: project_{project_name}_{path_hash}
        assert any(gid.startswith("project_test_project_") for gid in group_ids)

    @pytest.mark.asyncio
    async def test_spec_mode_no_project_context(self, graphiti_search, mock_client):
        """Test get_relevant_context with include_project_context=False uses only spec group_id."""
        mock_results = [
            _create_mock_result(content="Result", score=0.8),
        ]
        mock_client.graphiti.search.return_value = mock_results

        await graphiti_search.get_relevant_context(
            query="test",
            include_project_context=False,
        )

        # Verify only spec group_id was used
        call_args = mock_client.graphiti.search.call_args
        group_ids = call_args[1]["group_ids"]

        assert len(group_ids) == 1
        assert group_ids[0] == "test_group_id"

    @pytest.mark.asyncio
    async def test_project_mode_uses_only_project_group_id(
        self, mock_client, project_dir
    ):
        """Test get_relevant_context in PROJECT mode uses only project group_id."""
        # Create search instance with PROJECT mode
        search = GraphitiSearch(
            client=mock_client,
            group_id="project_group",
            spec_context_id="spec_123",
            group_id_mode=GroupIdMode.PROJECT,
            project_dir=project_dir,
        )

        mock_results = [
            _create_mock_result(content="Result", score=0.8),
        ]
        mock_client.graphiti.search.return_value = mock_results

        await search.get_relevant_context(
            query="test",
            include_project_context=True,  # Should be ignored in PROJECT mode
        )

        # Verify only project group_id was used
        call_args = mock_client.graphiti.search.call_args
        group_ids = call_args[1]["group_ids"]

        assert len(group_ids) == 1
        assert group_ids[0] == "project_group"

    @pytest.mark.asyncio
    async def test_returns_empty_list_on_exception(self, graphiti_search, mock_client):
        """Test get_relevant_context returns empty list on exception."""
        mock_client.graphiti.search.side_effect = Exception("Search failed")

        result = await graphiti_search.get_relevant_context(query="test")

        assert result == []

    @pytest.mark.asyncio
    async def test_captures_exception_via_sentry(self, graphiti_search, mock_client):
        """Test get_relevant_context captures exception via sentry."""
        mock_client.graphiti.search.side_effect = Exception("Search error")

        with patch(
            "integrations.graphiti.queries_pkg.search.capture_exception"
        ) as mock_capture:
            await graphiti_search.get_relevant_context(query="test query")

            # Verify capture_exception was called with correct parameters
            mock_capture.assert_called_once()
            call_kwargs = mock_capture.call_args[1]
            assert "query_summary" in call_kwargs
            assert call_kwargs["query_summary"] == "test query"
            assert call_kwargs["group_id"] == "test_group_id"
            assert call_kwargs["operation"] == "get_relevant_context"

    @pytest.mark.asyncio
    async def test_limits_num_results_to_max_context_results(
        self, graphiti_search, mock_client
    ):
        """Test get_relevant_context respects MAX_CONTEXT_RESULTS limit."""
        mock_results = [
            _create_mock_result(content=f"Result {i}", score=0.8) for i in range(20)
        ]
        mock_client.graphiti.search.return_value = mock_results

        # Request more than MAX_CONTEXT_RESULTS
        result = await graphiti_search.get_relevant_context(
            query="test",
            num_results=20,
            include_project_context=False,  # Avoid project group_id in SPEC mode
        )

        # Should cap at MAX_CONTEXT_RESULTS
        mock_client.graphiti.search.assert_called_once_with(
            query="test",
            group_ids=["test_group_id"],
            num_results=MAX_CONTEXT_RESULTS,
        )

    @pytest.mark.asyncio
    async def test_extracts_content_from_fact_attribute(
        self, graphiti_search, mock_client
    ):
        """Test get_relevant_context extracts content from fact attribute when content is None."""
        mock_result = Mock()
        mock_result.content = None
        mock_result.fact = "Fact content"
        mock_result.score = 0.8
        mock_result.type = "fact"

        mock_client.graphiti.search.return_value = [mock_result]

        result = await graphiti_search.get_relevant_context(query="test")

        assert len(result) == 1
        assert result[0]["content"] == "Fact content"

    @pytest.mark.asyncio
    async def test_falls_back_to_str_representation(self, graphiti_search, mock_client):
        """Test get_relevant_context falls back to str(result) when content and fact are None."""
        mock_result = Mock()
        mock_result.content = None
        mock_result.fact = None
        mock_result.score = 0.8
        mock_result.type = "unknown"
        mock_result.__str__ = lambda self: "String representation"

        mock_client.graphiti.search.return_value = [mock_result]

        result = await graphiti_search.get_relevant_context(query="test")

        assert len(result) == 1
        assert result[0]["content"] == "String representation"


# =============================================================================
# get_session_history() TESTS
# =============================================================================


class TestGetSessionHistory:
    """Tests for GraphitiSearch.get_session_history method."""

    @pytest.mark.asyncio
    async def test_searches_with_session_insight_query(
        self, graphiti_search, mock_client
    ):
        """Test get_session_history searches for 'session insight' query."""
        valid_insight = _create_valid_session_insight(session_number=1)
        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_insight, score=0.9),
        ]

        await graphiti_search.get_session_history(limit=5)

        # Verify search query includes session insight keywords
        call_args = mock_client.graphiti.search.call_args
        query = call_args[1]["query"]
        assert "session insight" in query
        assert "completed" in query
        assert "subtasks" in query

    @pytest.mark.asyncio
    async def test_returns_sessions_sorted_by_session_number_desc(
        self, graphiti_search, mock_client
    ):
        """Test get_session_history returns sessions sorted by session_number desc."""
        insights = [
            _create_valid_session_insight(session_number=3),
            _create_valid_session_insight(session_number=1),
            _create_valid_session_insight(session_number=5),
            _create_valid_session_insight(session_number=2),
        ]

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=insight, score=0.9) for insight in insights
        ]

        result = await graphiti_search.get_session_history(limit=5)

        # Verify sorting (descending)
        assert result[0]["session_number"] == 5
        assert result[1]["session_number"] == 3
        assert result[2]["session_number"] == 2
        assert result[3]["session_number"] == 1

    @pytest.mark.asyncio
    async def test_filters_by_spec_id_when_spec_only_true(
        self, graphiti_search, mock_client
    ):
        """Test get_session_history filters by spec_id when spec_only=True."""
        insight_same_spec = _create_valid_session_insight(
            session_number=1,
            spec_id="test_spec_123",
        )
        insight_other_spec = _create_valid_session_insight(
            session_number=2,
            spec_id="other_spec_456",
        )

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=insight_same_spec, score=0.9),
            _create_mock_result(content=insight_other_spec, score=0.8),
        ]

        result = await graphiti_search.get_session_history(
            limit=5,
            spec_only=True,
        )

        # Only same spec should be returned
        assert len(result) == 1
        assert result[0]["spec_id"] == "test_spec_123"

    @pytest.mark.asyncio
    async def test_returns_all_specs_when_spec_only_false(
        self, graphiti_search, mock_client
    ):
        """Test get_session_history returns all specs when spec_only=False."""
        insight_1 = _create_valid_session_insight(
            session_number=1,
            spec_id="test_spec_123",
        )
        insight_2 = _create_valid_session_insight(
            session_number=2,
            spec_id="other_spec_456",
        )

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=insight_1, score=0.9),
            _create_mock_result(content=insight_2, score=0.8),
        ]

        result = await graphiti_search.get_session_history(
            limit=5,
            spec_only=False,
        )

        # Both insights should be returned
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_handles_json_decode_errors_gracefully(
        self, graphiti_search, mock_client
    ):
        """Test get_session_history handles JSON decode errors gracefully."""
        invalid_json = '{"type": "session_insight", "session_number": 1, invalid json'
        valid_insight = _create_valid_session_insight(session_number=2)

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=invalid_json, score=0.9),
            _create_mock_result(content=valid_insight, score=0.8),
        ]

        result = await graphiti_search.get_session_history(limit=5)

        # Should skip invalid JSON and return valid insight
        assert len(result) == 1
        assert result[0]["session_number"] == 2

    @pytest.mark.asyncio
    async def test_skips_non_dict_content(self, graphiti_search, mock_client):
        """Test get_session_history skips non-dict content (ACS-215 fix)."""
        valid_insight = _create_valid_session_insight(session_number=1)
        non_dict_object = object()  # Not a dict

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_insight, score=0.9),
            _create_mock_result(content=non_dict_object, score=0.5),
        ]

        result = await graphiti_search.get_session_history(limit=5)

        # Only dict content should be returned
        assert len(result) == 1
        assert result[0]["session_number"] == 1

    @pytest.mark.asyncio
    async def test_skips_json_array_content(self, graphiti_search, mock_client):
        """Test get_session_history skips JSON array content (line 167)."""
        valid_insight = _create_valid_session_insight(session_number=1)
        # JSON array that contains the episode type but is not a dict
        non_dict_json = '["item1", "session_insight", "item3"]'

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_insight, score=0.9),
            _create_mock_result(content=non_dict_json, score=0.5),
        ]

        result = await graphiti_search.get_session_history(limit=5)

        # Only dict content should be returned (array is skipped)
        assert len(result) == 1
        assert result[0]["session_number"] == 1

    @pytest.mark.asyncio
    async def test_skips_json_string_content(self, graphiti_search, mock_client):
        """Test get_session_history skips JSON string content (line 167)."""
        valid_insight = _create_valid_session_insight(session_number=1)
        # JSON string that contains the episode type but is not a dict
        non_dict_json = '"session_insight text"'

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_insight, score=0.9),
            _create_mock_result(content=non_dict_json, score=0.5),
        ]

        result = await graphiti_search.get_session_history(limit=5)

        # Only dict content should be returned (string is skipped)
        assert len(result) == 1
        assert result[0]["session_number"] == 1

    @pytest.mark.asyncio
    async def test_returns_empty_list_on_exception(self, graphiti_search, mock_client):
        """Test get_session_history returns empty list on exception."""
        mock_client.graphiti.search.side_effect = Exception("Search failed")

        result = await graphiti_search.get_session_history(limit=5)

        assert result == []

    @pytest.mark.asyncio
    async def test_captures_exception_via_sentry(self, graphiti_search, mock_client):
        """Test get_session_history captures exception via sentry."""
        mock_client.graphiti.search.side_effect = Exception("Search error")

        with patch(
            "integrations.graphiti.queries_pkg.search.capture_exception"
        ) as mock_capture:
            await graphiti_search.get_session_history(limit=5)

            # Verify capture_exception was called
            mock_capture.assert_called_once()
            call_kwargs = mock_capture.call_args[1]
            assert call_kwargs["group_id"] == "test_group_id"
            assert call_kwargs["operation"] == "get_session_history"

    @pytest.mark.asyncio
    async def test_limits_results_to_limit_parameter(
        self, graphiti_search, mock_client
    ):
        """Test get_session_history respects the limit parameter."""
        insights = [
            _create_valid_session_insight(session_number=i)
            for i in range(10, 0, -1)  # 10 down to 1
        ]

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=insight, score=0.9) for insight in insights
        ]

        result = await graphiti_search.get_session_history(limit=5)

        # Should return only 5 results (highest session numbers)
        assert len(result) == 5
        assert result[0]["session_number"] == 10
        assert result[4]["session_number"] == 6

    @pytest.mark.asyncio
    async def test_searches_more_than_limit_for_filtering(
        self, graphiti_search, mock_client
    ):
        """Test get_session_history searches limit*2 results for filtering."""
        mock_client.graphiti.search.return_value = []

        await graphiti_search.get_session_history(limit=5)

        # Should search for limit * 2
        call_args = mock_client.graphiti.search.call_args
        assert call_args[1]["num_results"] == 10


# =============================================================================
# get_similar_task_outcomes() TESTS
# =============================================================================


class TestGetSimilarTaskOutcomes:
    """Tests for GraphitiSearch.get_similar_task_outcomes method."""

    @pytest.mark.asyncio
    async def test_searches_with_task_description_in_query(
        self, graphiti_search, mock_client
    ):
        """Test get_similar_task_outcomes searches with task description in query."""
        valid_outcome = _create_valid_task_outcome()
        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_outcome, score=0.9),
        ]

        await graphiti_search.get_similar_task_outcomes(
            task_description="Implement authentication",
            limit=5,
        )

        # Verify query includes task description
        call_args = mock_client.graphiti.search.call_args
        query = call_args[1]["query"]
        assert "task outcome:" in query
        assert "Implement authentication" in query

    @pytest.mark.asyncio
    async def test_returns_outcomes_with_task_id_success_outcome_score(
        self, graphiti_search, mock_client
    ):
        """Test get_similar_task_outcomes returns list of outcomes with task_id, success, outcome, score."""
        outcomes = [
            _create_valid_task_outcome(
                task_id="task-1",
                success=True,
                outcome="Completed successfully",
            ),
            _create_valid_task_outcome(
                task_id="task-2",
                success=False,
                outcome="Failed due to timeout",
            ),
        ]

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=outcome, score=0.9) for outcome in outcomes
        ]

        result = await graphiti_search.get_similar_task_outcomes(
            task_description="test",
            limit=5,
        )

        assert len(result) == 2
        assert result[0]["task_id"] == "task-1"
        assert result[0]["success"] is True
        assert result[0]["outcome"] == "Completed successfully"
        assert result[0]["score"] == 0.9

        assert result[1]["task_id"] == "task-2"
        assert result[1]["success"] is False
        assert result[1]["outcome"] == "Failed due to timeout"
        assert result[1]["score"] == 0.9

    @pytest.mark.asyncio
    async def test_filters_by_episode_type_task_outcome(
        self, graphiti_search, mock_client
    ):
        """Test get_similar_task_outcomes filters by EPISODE_TYPE_TASK_OUTCOME."""
        task_outcome = _create_valid_task_outcome()
        pattern = _create_valid_pattern()

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=task_outcome, score=0.9),
            _create_mock_result(content=pattern, score=0.8),
        ]

        result = await graphiti_search.get_similar_task_outcomes(
            task_description="test",
            limit=5,
        )

        # Only task outcome should be returned
        assert len(result) == 1
        assert result[0]["task_id"] == "task-123"

    @pytest.mark.asyncio
    async def test_handles_json_decode_errors_gracefully(
        self, graphiti_search, mock_client
    ):
        """Test get_similar_task_outcomes handles JSON decode errors gracefully."""
        invalid_json = '{"type": "task_outcome", "task_id": "1", invalid json'
        valid_outcome = _create_valid_task_outcome()

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=invalid_json, score=0.9),
            _create_mock_result(content=valid_outcome, score=0.8),
        ]

        result = await graphiti_search.get_similar_task_outcomes(
            task_description="test",
            limit=5,
        )

        # Should skip invalid JSON and return valid outcome
        assert len(result) == 1
        assert result[0]["task_id"] == "task-123"

    @pytest.mark.asyncio
    async def test_skips_non_dict_content(self, graphiti_search, mock_client):
        """Test get_similar_task_outcomes skips non-dict content including EPISODE_TYPE_TASK_OUTCOME."""
        valid_outcome = _create_valid_task_outcome()
        non_dict_object = ["list", "of", "items"]  # Not a dict, even though it's a list

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_outcome, score=0.9),
            _create_mock_result(content=non_dict_object, score=0.5),
        ]

        result = await graphiti_search.get_similar_task_outcomes(
            task_description="test",
            limit=5,
        )

        # Only dict content should be returned (list is skipped)
        # Note: The valid_outcome should have EPISODE_TYPE_TASK_OUTCOME in it
        assert len(result) == 1
        assert result[0]["task_id"] == "task-123"

    @pytest.mark.asyncio
    async def test_skips_json_array_content(self, graphiti_search, mock_client):
        """Test get_similar_task_outcomes skips JSON array content (line 226)."""
        valid_outcome = _create_valid_task_outcome()
        # JSON array that contains the episode type but is not a dict
        non_dict_json = '["item1", "task_outcome", "item3"]'

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_outcome, score=0.9),
            _create_mock_result(content=non_dict_json, score=0.5),
        ]

        result = await graphiti_search.get_similar_task_outcomes(
            task_description="test",
            limit=5,
        )

        # Only dict content should be returned (array is skipped)
        assert len(result) == 1
        assert result[0]["task_id"] == "task-123"

    @pytest.mark.asyncio
    async def test_skips_json_string_content(self, graphiti_search, mock_client):
        """Test get_similar_task_outcomes skips JSON string content (line 226)."""
        valid_outcome = _create_valid_task_outcome()
        # JSON string that contains the episode type but is not a dict
        non_dict_json = '"task_outcome text"'

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_outcome, score=0.9),
            _create_mock_result(content=non_dict_json, score=0.5),
        ]

        result = await graphiti_search.get_similar_task_outcomes(
            task_description="test",
            limit=5,
        )

        # Only dict content should be returned (string is skipped)
        assert len(result) == 1
        assert result[0]["task_id"] == "task-123"

    @pytest.mark.asyncio
    async def test_returns_empty_list_on_exception(self, graphiti_search, mock_client):
        """Test get_similar_task_outcomes returns empty list on exception."""
        mock_client.graphiti.search.side_effect = Exception("Search failed")

        result = await graphiti_search.get_similar_task_outcomes(
            task_description="test",
            limit=5,
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_captures_exception_via_sentry(self, graphiti_search, mock_client):
        """Test get_similar_task_outcomes captures exception via sentry."""
        mock_client.graphiti.search.side_effect = Exception("Search error")

        with patch(
            "integrations.graphiti.queries_pkg.search.capture_exception"
        ) as mock_capture:
            await graphiti_search.get_similar_task_outcomes(
                task_description="test task",
                limit=5,
            )

            # Verify capture_exception was called
            mock_capture.assert_called_once()
            call_kwargs = mock_capture.call_args[1]
            assert call_kwargs["query_summary"] == "test task"
            assert call_kwargs["group_id"] == "test_group_id"
            assert call_kwargs["operation"] == "get_similar_task_outcomes"

    @pytest.mark.asyncio
    async def test_limits_results_to_limit_parameter(
        self, graphiti_search, mock_client
    ):
        """Test get_similar_task_outcomes respects the limit parameter."""
        outcomes = [_create_valid_task_outcome(task_id=f"task-{i}") for i in range(10)]

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=outcome, score=0.9) for outcome in outcomes
        ]

        result = await graphiti_search.get_similar_task_outcomes(
            task_description="test",
            limit=5,
        )

        # Should return only 5 results
        assert len(result) == 5


# =============================================================================
# get_patterns_and_gotchas() TESTS
# =============================================================================


class TestGetPatternsAndGotchas:
    """Tests for GraphitiSearch.get_patterns_and_gotchas method."""

    @pytest.mark.asyncio
    async def test_returns_tuple_of_patterns_and_gotchas(
        self, graphiti_search, mock_client
    ):
        """Test get_patterns_and_gotchas returns tuple of (patterns, gotchas)."""
        pattern = _create_valid_pattern()
        gotcha = _create_valid_gotcha()

        # Mock search to return different results for patterns and gotchas
        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [_create_mock_result(content=pattern, score=0.9)],  # Pattern search
                [_create_mock_result(content=gotcha, score=0.8)],  # Gotcha search
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="authentication",
            num_results=5,
        )

        assert isinstance(patterns, list)
        assert isinstance(gotchas, list)
        assert len(patterns) == 1
        assert len(gotchas) == 1

    @pytest.mark.asyncio
    async def test_patterns_filtered_by_episode_type_pattern(
        self, graphiti_search, mock_client
    ):
        """Test get_patterns_and_gotchas filters patterns by EPISODE_TYPE_PATTERN."""
        pattern = _create_valid_pattern()
        gotcha = _create_valid_gotcha()

        # Mix patterns and gotchas in pattern search results
        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [
                    _create_mock_result(content=pattern, score=0.9),
                    _create_mock_result(
                        content=gotcha, score=0.8
                    ),  # Should be filtered
                ],
                [],  # Gotcha search
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
        )

        # Only pattern should be in patterns list
        assert len(patterns) == 1
        assert patterns[0]["pattern"] == "Test pattern"
        assert len(gotchas) == 0

    @pytest.mark.asyncio
    async def test_gotchas_filtered_by_episode_type_gotcha(
        self, graphiti_search, mock_client
    ):
        """Test get_patterns_and_gotchas filters gotchas by EPISODE_TYPE_GOTCHA."""
        pattern = _create_valid_pattern()
        gotcha = _create_valid_gotcha()

        # Mix patterns and gotchas in gotcha search results
        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [],  # Pattern search
                [
                    _create_mock_result(content=gotcha, score=0.8),
                    _create_mock_result(
                        content=pattern, score=0.9
                    ),  # Should be filtered
                ],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
        )

        # Only gotcha should be in gotchas list
        assert len(patterns) == 0
        assert len(gotchas) == 1
        assert gotchas[0]["gotcha"] == "Token expires"

    @pytest.mark.asyncio
    async def test_filters_by_min_score(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas filters by min_score."""
        high_score_pattern = _create_valid_pattern()
        low_score_pattern = _create_valid_pattern(pattern="Low score pattern")
        high_score_gotcha = _create_valid_gotcha()
        low_score_gotcha = _create_valid_gotcha(gotcha="Low score gotcha")

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [
                    _create_mock_result(content=high_score_pattern, score=0.9),
                    _create_mock_result(content=low_score_pattern, score=0.3),
                ],
                [
                    _create_mock_result(content=high_score_gotcha, score=0.8),
                    _create_mock_result(content=low_score_gotcha, score=0.4),
                ],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
            min_score=0.5,
        )

        # Only high-score items should be returned
        assert len(patterns) == 1
        assert patterns[0]["score"] == 0.9
        assert len(gotchas) == 1
        assert gotchas[0]["score"] == 0.8

    @pytest.mark.asyncio
    async def test_sorts_both_lists_by_score_desc(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas sorts both lists by score desc."""
        patterns_data = [
            _create_valid_pattern(pattern="Pattern 3"),
            _create_valid_pattern(pattern="Pattern 1"),
            _create_valid_pattern(pattern="Pattern 2"),
        ]
        gotchas_data = [
            _create_valid_gotcha(gotcha="Gotcha 2"),
            _create_valid_gotcha(gotcha="Gotcha 3"),
            _create_valid_gotcha(gotcha="Gotcha 1"),
        ]

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [
                    _create_mock_result(content=patterns_data[0], score=0.7),
                    _create_mock_result(content=patterns_data[1], score=0.9),
                    _create_mock_result(content=patterns_data[2], score=0.8),
                ],
                [
                    _create_mock_result(content=gotchas_data[0], score=0.8),
                    _create_mock_result(content=gotchas_data[1], score=0.6),
                    _create_mock_result(content=gotchas_data[2], score=0.95),
                ],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
        )

        # Verify patterns are sorted by score desc
        assert patterns[0]["score"] == 0.9
        assert patterns[1]["score"] == 0.8
        assert patterns[2]["score"] == 0.7

        # Verify gotchas are sorted by score desc
        assert gotchas[0]["score"] == 0.95
        assert gotchas[1]["score"] == 0.8
        assert gotchas[2]["score"] == 0.6

    @pytest.mark.asyncio
    async def test_limits_results_to_num_results(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas limits results to num_results."""
        patterns_data = [
            _create_valid_pattern(pattern=f"Pattern {i}") for i in range(10)
        ]
        gotchas_data = [_create_valid_gotcha(gotcha=f"Gotcha {i}") for i in range(10)]

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [
                    _create_mock_result(content=p, score=0.9 - (i * 0.05))
                    for i, p in enumerate(patterns_data)
                ],
                [
                    _create_mock_result(content=g, score=0.9 - (i * 0.05))
                    for i, g in enumerate(gotchas_data)
                ],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
            min_score=0.0,
        )

        # Should return only num_results for each
        assert len(patterns) == 5
        assert len(gotchas) == 5

    @pytest.mark.asyncio
    async def test_handles_json_decode_errors_gracefully(
        self, graphiti_search, mock_client
    ):
        """Test get_patterns_and_gotchas handles JSON decode errors gracefully."""
        invalid_pattern_json = '{"type": "pattern", invalid json'
        valid_pattern = _create_valid_pattern()
        valid_gotcha = _create_valid_gotcha()

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [
                    _create_mock_result(content=invalid_pattern_json, score=0.9),
                    _create_mock_result(content=valid_pattern, score=0.8),
                ],
                [_create_mock_result(content=valid_gotcha, score=0.7)],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
        )

        # Should skip invalid JSON and return valid items
        assert len(patterns) == 1
        assert len(gotchas) == 1

    @pytest.mark.asyncio
    async def test_skips_non_dict_content(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas skips non-dict content (ACS-215 fix)."""
        valid_pattern = _create_valid_pattern()
        non_dict_pattern = object()
        valid_gotcha = _create_valid_gotcha()
        non_dict_gotcha = ["not", "a", "dict"]

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [
                    _create_mock_result(content=valid_pattern, score=0.9),
                    _create_mock_result(content=non_dict_pattern, score=0.5),
                ],
                [
                    _create_mock_result(content=valid_gotcha, score=0.8),
                    _create_mock_result(content=non_dict_gotcha, score=0.4),
                ],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
        )

        # Only dict content should be returned
        assert len(patterns) == 1
        assert len(gotchas) == 1

    @pytest.mark.asyncio
    async def test_skips_json_array_content(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas skips JSON array content (lines 299, 335)."""
        valid_pattern = _create_valid_pattern()
        # JSON array that contains the episode type but is not a dict
        non_dict_pattern_json = '["item1", "pattern", "item3"]'
        valid_gotcha = _create_valid_gotcha()
        non_dict_gotcha_json = '["item1", "gotcha", "item3"]'

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [
                    _create_mock_result(content=valid_pattern, score=0.9),
                    _create_mock_result(content=non_dict_pattern_json, score=0.6),
                ],
                [
                    _create_mock_result(content=valid_gotcha, score=0.8),
                    _create_mock_result(content=non_dict_gotcha_json, score=0.7),
                ],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
            min_score=0.5,
        )

        # Only dict content should be returned (arrays are skipped)
        assert len(patterns) == 1
        assert len(gotchas) == 1

    @pytest.mark.asyncio
    async def test_skips_json_string_content(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas skips JSON string content (lines 299, 335)."""
        valid_pattern = _create_valid_pattern()
        # JSON string that contains the episode type but is not a dict
        non_dict_pattern_json = '"pattern text"'
        valid_gotcha = _create_valid_gotcha()
        non_dict_gotcha_json = '"gotcha text"'

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [
                    _create_mock_result(content=valid_pattern, score=0.9),
                    _create_mock_result(content=non_dict_pattern_json, score=0.6),
                ],
                [
                    _create_mock_result(content=valid_gotcha, score=0.8),
                    _create_mock_result(content=non_dict_gotcha_json, score=0.7),
                ],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
            min_score=0.5,
        )

        # Only dict content should be returned (strings are skipped)
        assert len(patterns) == 1
        assert len(gotchas) == 1

    @pytest.mark.asyncio
    async def test_handles_gotcha_json_decode_error(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas handles gotcha JSON decode errors (lines 345-346)."""
        valid_pattern = _create_valid_pattern()
        valid_gotcha = _create_valid_gotcha()
        # Invalid JSON that contains the episode type "gotcha"
        invalid_gotcha_json = '{"type": "gotcha", "gotcha": "test" invalid'

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [_create_mock_result(content=valid_pattern, score=0.9)],
                [
                    _create_mock_result(content=valid_gotcha, score=0.8),
                    _create_mock_result(content=invalid_gotcha_json, score=0.7),
                ],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
            min_score=0.5,
        )

        # Should skip invalid JSON and return valid items
        assert len(patterns) == 1
        assert len(gotchas) == 1

    @pytest.mark.asyncio
    async def test_returns_empty_lists_on_exception(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas returns empty lists on exception."""
        mock_client.graphiti.search.side_effect = Exception("Search failed")

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
        )

        assert patterns == []
        assert gotchas == []

    @pytest.mark.asyncio
    async def test_captures_exception_via_sentry(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas captures exception via sentry."""
        mock_client.graphiti.search.side_effect = Exception("Search error")

        with patch(
            "integrations.graphiti.queries_pkg.search.capture_exception"
        ) as mock_capture:
            _patterns, _gotchas = await graphiti_search.get_patterns_and_gotchas(
                query="test query",
                num_results=5,
            )

            # Verify capture_exception was called
            mock_capture.assert_called_once()
            call_kwargs = mock_capture.call_args[1]
            assert call_kwargs["query_summary"] == "test query"
            assert call_kwargs["group_id"] == "test_group_id"
            assert call_kwargs["operation"] == "get_patterns_and_gotchas"

    @pytest.mark.asyncio
    async def test_searches_with_pattern_focused_query(
        self, graphiti_search, mock_client
    ):
        """Test get_patterns_and_gotchas searches with 'pattern:' prefix for patterns."""
        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [],  # Pattern search
                [],  # Gotcha search
            ]
        )

        await graphiti_search.get_patterns_and_gotchas(
            query="authentication",
            num_results=5,
        )

        # Verify pattern search query
        pattern_call_args = mock_client.graphiti.search.call_args_list[0]
        pattern_query = pattern_call_args[1]["query"]
        assert "pattern:" in pattern_query
        assert "authentication" in pattern_query

    @pytest.mark.asyncio
    async def test_searches_with_gotcha_focused_query(
        self, graphiti_search, mock_client
    ):
        """Test get_patterns_and_gotchas searches with gotcha/pitfall keywords for gotchas."""
        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [],  # Pattern search
                [],  # Gotcha search
            ]
        )

        await graphiti_search.get_patterns_and_gotchas(
            query="authentication",
            num_results=5,
        )

        # Verify gotcha search query
        gotcha_call_args = mock_client.graphiti.search.call_args_list[1]
        gotcha_query = gotcha_call_args[1]["query"]
        assert "gotcha" in gotcha_query
        assert "pitfall" in gotcha_query
        assert "avoid" in gotcha_query
        assert "authentication" in gotcha_query

    @pytest.mark.asyncio
    async def test_returns_pattern_with_all_fields(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas returns patterns with all expected fields."""
        pattern = _create_valid_pattern(
            pattern="Use dependency injection",
            applies_to="service layer",
            example="Inject repositories into services",
        )

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [_create_mock_result(content=pattern, score=0.9)],
                [],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
        )

        assert len(patterns) == 1
        assert patterns[0]["pattern"] == "Use dependency injection"
        assert patterns[0]["applies_to"] == "service layer"
        assert patterns[0]["example"] == "Inject repositories into services"
        assert patterns[0]["score"] == 0.9

    @pytest.mark.asyncio
    async def test_returns_gotcha_with_all_fields(self, graphiti_search, mock_client):
        """Test get_patterns_and_gotchas returns gotchas with all expected fields."""
        gotcha = _create_valid_gotcha(
            gotcha="Database connection leak",
            trigger="Long-running queries without connection pooling",
            solution="Use connection pool with proper timeout",
        )

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [],
                [_create_mock_result(content=gotcha, score=0.85)],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
        )

        assert len(gotchas) == 1
        assert gotchas[0]["gotcha"] == "Database connection leak"
        assert (
            gotchas[0]["trigger"] == "Long-running queries without connection pooling"
        )
        assert gotchas[0]["solution"] == "Use connection pool with proper timeout"
        assert gotchas[0]["score"] == 0.85


# =============================================================================
# EDGE CASE TESTS
# =============================================================================


class TestEdgeCases:
    """Additional edge case tests for robustness."""

    @pytest.mark.asyncio
    async def test_get_relevant_context_with_empty_results(
        self, graphiti_search, mock_client
    ):
        """Test get_relevant_context handles empty search results."""
        mock_client.graphiti.search.return_value = []

        result = await graphiti_search.get_relevant_context(query="test")

        assert result == []

    @pytest.mark.asyncio
    async def test_get_session_history_with_no_matching_results(
        self, graphiti_search, mock_client
    ):
        """Test get_session_history handles no matching session insights."""
        # Return results that don't match session_insight type
        pattern = _create_valid_pattern()
        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=pattern, score=0.9),
        ]

        result = await graphiti_search.get_session_history(limit=5)

        assert result == []

    @pytest.mark.asyncio
    async def test_get_similar_task_outcomes_with_no_matching_results(
        self, graphiti_search, mock_client
    ):
        """Test get_similar_task_outcomes handles no matching task outcomes."""
        # Return results that don't match task_outcome type
        gotcha = _create_valid_gotcha()
        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=gotcha, score=0.9),
        ]

        result = await graphiti_search.get_similar_task_outcomes(
            task_description="test",
            limit=5,
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_get_patterns_and_gotchas_with_no_matching_results(
        self, graphiti_search, mock_client
    ):
        """Test get_patterns_and_gotchas handles no matching patterns or gotchas."""
        # Return task outcomes instead of patterns/gotchas
        task_outcome = _create_valid_task_outcome()

        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [_create_mock_result(content=task_outcome, score=0.9)],
                [_create_mock_result(content=task_outcome, score=0.8)],
            ]
        )

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test",
            num_results=5,
        )

        assert patterns == []
        assert gotchas == []

    @pytest.mark.asyncio
    async def test_get_relevant_context_with_none_score(
        self, graphiti_search, mock_client
    ):
        """Test get_relevant_context handles results with None score."""
        mock_result = Mock()
        mock_result.content = "Test content"
        mock_result.fact = None
        mock_result.score = None  # None score
        mock_result.type = "test"

        mock_client.graphiti.search.return_value = [mock_result]

        # Without min_score filter, None score should be handled gracefully
        result = await graphiti_search.get_relevant_context(
            query="test",
        )

        # Should handle None score gracefully (converts to 0.0 in result)
        assert len(result) == 1
        assert result[0]["content"] == "Test content"
        # The score will be 0.0 since production code converts None to 0.0
        assert result[0]["score"] == 0.0

        # With min_score filter, None score should be filtered out
        result_filtered = await graphiti_search.get_relevant_context(
            query="test",
            min_score=0.5,
        )

        # None scores are filtered out by the min_score check
        assert len(result_filtered) == 0

    @pytest.mark.asyncio
    async def test_get_similar_task_outcomes_with_none_score(
        self, graphiti_search, mock_client
    ):
        """Test get_similar_task_outcomes handles results with None score."""
        task_outcome = {
            "type": "task_outcome",
            "task_id": "task-123",
            "task_description": "Test task",
            "success": True,
            "outcome": "Completed successfully",
        }
        mock_result = Mock()
        mock_result.content = json.dumps(task_outcome)
        mock_result.fact = None
        mock_result.score = None  # None score

        mock_client.graphiti.search.return_value = [mock_result]

        result = await graphiti_search.get_similar_task_outcomes(
            task_description="Test task"
        )

        # Should handle None score gracefully (converts to 0.0 in result)
        assert len(result) == 1
        assert result[0]["task_id"] == "task-123"
        # The score will be 0.0 since production code converts None to 0.0
        assert result[0]["score"] == 0.0

    @pytest.mark.asyncio
    async def test_get_patterns_and_gotchas_with_none_score(
        self, graphiti_search, mock_client
    ):
        """Test get_patterns_and_gotchas handles results with None score."""
        pattern = {
            "type": "pattern",
            "pattern": "Test pattern content",
            "applies_to": "test scenarios",
            "example": "test example",
        }
        mock_result = Mock()
        mock_result.content = json.dumps(pattern)
        mock_result.fact = None
        mock_result.score = None  # None score

        mock_client.graphiti.search.return_value = [mock_result]

        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="test patterns",
            min_score=0.0,  # Allow 0.0 score to pass through
        )

        # Should handle None score gracefully (converts to 0.0 in result)
        assert len(patterns) == 1
        assert patterns[0]["pattern"] == "Test pattern content"
        # The score will be 0.0 since production code converts None to 0.0
        assert patterns[0]["score"] == 0.0
        assert len(gotchas) == 0

    @pytest.mark.asyncio
    async def test_all_methods_handle_string_and_dict_content(
        self, graphiti_search, mock_client
    ):
        """Test all methods handle both string JSON and dict content."""
        # String JSON
        string_insight = json.dumps(_create_valid_session_insight(session_number=1))
        # Dict
        dict_insight = _create_valid_session_insight(session_number=2)

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=string_insight, score=0.9),
            _create_mock_result(content=dict_insight, score=0.8),
        ]

        result = await graphiti_search.get_session_history(limit=5)

        # Both should be parsed correctly
        assert len(result) == 2
        # Results are sorted by session_number DESC, so 2 comes first
        assert result[0]["session_number"] == 2
        assert result[1]["session_number"] == 1
