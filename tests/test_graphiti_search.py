#!/usr/bin/env python3
"""
Unit tests for GraphitiSearch class (ACS-215 bug fix).

Tests the isinstance(dict) validation that prevents AttributeError when
Graphiti returns non-dict objects for session insights.
"""

import json
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

# Add apps/backend to path for imports (idempotent guard)
sys_path = Path(__file__).parent.parent / "apps" / "backend"
if str(sys_path) not in sys.path:
    sys.path.insert(0, str(sys_path))


from integrations.graphiti.queries_pkg.schema import (
    EPISODE_TYPE_GOTCHA,
    EPISODE_TYPE_PATTERN,
    EPISODE_TYPE_SESSION_INSIGHT,
    EPISODE_TYPE_TASK_OUTCOME,
)
from integrations.graphiti.queries_pkg.search import GraphitiSearch

# =============================================================================
# TEST FIXTURES
# =============================================================================


@pytest.fixture
def mock_client():
    """Create a mock GraphitiClient."""
    client = MagicMock()
    client.graphiti = MagicMock()
    client.graphiti.search = AsyncMock()
    return client


@pytest.fixture
def project_dir(tmp_path):
    """Create a temporary project directory."""
    project = tmp_path / "test_project"
    project.mkdir()
    return project


@pytest.fixture
def graphiti_search(mock_client, project_dir):
    """Create a GraphitiSearch instance for testing."""
    return GraphitiSearch(
        client=mock_client,
        group_id="test_group_id",
        spec_context_id="test_spec_123",
        group_id_mode="spec",
        project_dir=project_dir,
    )


# =============================================================================
# MOCK RESULT FACTORIES
# =============================================================================


def _create_mock_result(content: Any = None, score: float = 0.8) -> Mock:
    """Create a mock Graphiti search result."""
    result = Mock()
    result.content = content
    result.fact = content
    result.score = score
    result.name = "test_episode"
    result.type = "test"
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
        "subtasks_completed": ["task-1"],
        "discoveries": {},
    }


def _create_valid_task_outcome() -> dict:
    """Create a valid task outcome dict."""
    return {
        "type": EPISODE_TYPE_TASK_OUTCOME,
        "task_id": "task-123",
        "success": True,
        "outcome": "Completed successfully",
    }


def _create_valid_pattern() -> dict:
    """Create a valid pattern dict."""
    return {
        "type": EPISODE_TYPE_PATTERN,
        "pattern": "Test pattern",
        "applies_to": "auth",
        "example": "Use OAuth2",
    }


def _create_valid_gotcha() -> dict:
    """Create a valid gotcha dict."""
    return {
        "type": EPISODE_TYPE_GOTCHA,
        "gotcha": "Token expires",
        "trigger": "Long session",
        "solution": "Use refresh tokens",
    }


# =============================================================================
# BUG FIX TESTS (ACS-215)
# =============================================================================


class TestBugFixACS215:
    """
    Test suite for ACS-215 bug fix.

    Bug: Graphiti memory returns non-dict objects that cause
    AttributeError: 'str' object has no attribute 'get'

    Fix: Added isinstance(data, dict) check before processing data.
    """

    # --------------------------------------------------------------------------
    # get_session_history() tests
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_get_session_history_with_string_content(
        self, graphiti_search, mock_client
    ):
        """Test get_session_history handles string JSON content correctly."""
        # Setup: Return string JSON content (valid case)
        valid_insight = _create_valid_session_insight(session_number=1)
        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=json.dumps(valid_insight), score=0.9),
        ]

        # Execute
        result = await graphiti_search.get_session_history(limit=5)

        # Verify
        assert len(result) == 1
        assert result[0]["session_number"] == 1

    @pytest.mark.asyncio
    async def test_get_session_history_with_dict_content(
        self, graphiti_search, mock_client
    ):
        """Test get_session_history handles dict content correctly."""
        # Setup: Return dict content (valid case)
        valid_insight = _create_valid_session_insight(session_number=2)
        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_insight, score=0.9),
        ]

        # Execute
        result = await graphiti_search.get_session_history(limit=5)

        # Verify
        assert len(result) == 1
        assert result[0]["session_number"] == 2

    @pytest.mark.asyncio
    async def test_get_session_history_with_non_dict_object(
        self, graphiti_search, mock_client
    ):
        """
        BUG FIX TEST: Non-dict objects should be filtered out gracefully.

        This is the core bug fix for ACS-215. Previously, when Graphiti
        returned a non-string, non-dict object, the code would call
        .get() on it and crash with AttributeError.
        """
        # Create a non-dict object (simulates buggy Graphiti response)
        class NonDictObject:
            def __str__(self):
                return f"{EPISODE_TYPE_SESSION_INSIGHT} data"

        bad_object = NonDictObject()

        # Setup: Mix of valid and invalid data
        valid_insight = _create_valid_session_insight(session_number=1)
        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_insight, score=0.9),  # Valid dict
            _create_mock_result(content=bad_object, score=0.5),  # Invalid non-dict
            _create_mock_result(content="random string", score=0.3),  # Invalid string
        ]

        # Execute - should NOT crash
        result = await graphiti_search.get_session_history(limit=5)

        # Verify: Only valid dict results should be returned
        assert len(result) == 1
        assert result[0]["session_number"] == 1

    @pytest.mark.asyncio
    async def test_get_session_history_with_custom_object(
        self, graphiti_search, mock_client
    ):
        """
        BUG FIX TEST: Custom objects with matching type string are filtered out.

        Tests edge case where a custom object has a __str__ that contains
        EPISODE_TYPE_SESSION_INSIGHT but isn't a dict.
        """
        # Create a custom object that pretends to be a session insight
        class FakeSessionInsight:
            def __str__(self):
                return f'{{"type": "{EPISODE_TYPE_SESSION_INSIGHT}"}}'

        fake_object = FakeSessionInsight()

        # Setup: Return fake object
        valid_insight = _create_valid_session_insight(session_number=3)
        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_insight, score=0.9),
            _create_mock_result(content=fake_object, score=0.6),
        ]

        # Execute - should NOT crash
        result = await graphiti_search.get_session_history(limit=5)

        # Verify: Only the actual dict should be returned
        assert len(result) == 1
        assert result[0]["session_number"] == 3

    @pytest.mark.asyncio
    async def test_get_session_history_sorting_does_not_crash(
        self, graphiti_search, mock_client
    ):
        """
        BUG FIX TEST: Sorting with .get() should not crash on non-dict items.

        The bug manifested during the sort() call which uses .get() on each item.
        """
        # Create multiple results including non-dict
        insights = [
            _create_valid_session_insight(session_number=3),
            _create_valid_session_insight(session_number=1),
            _create_valid_session_insight(session_number=2),
        ]

        # Add some non-dict objects in the middle
        results = [
            _create_mock_result(content=insights[0], score=0.9),
            _create_mock_result(content=object(), score=0.5),  # Non-dict
            _create_mock_result(content=insights[1], score=0.8),
            _create_mock_result(content="invalid", score=0.3),  # Non-dict
            _create_mock_result(content=insights[2], score=0.7),
        ]

        mock_client.graphiti.search.return_value = results

        # Execute - sorting with .get() should work
        result = await graphiti_search.get_session_history(limit=5)

        # Verify: Results are sorted by session_number (descending)
        assert len(result) == 3
        assert result[0]["session_number"] == 3
        assert result[1]["session_number"] == 2
        assert result[2]["session_number"] == 1

    # --------------------------------------------------------------------------
    # get_similar_task_outcomes() tests
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_get_similar_task_outcomes_with_non_dict_object(
        self, graphiti_search, mock_client
    ):
        """
        BUG FIX TEST: Non-dict objects should be filtered in task outcomes.
        """
        valid_outcome = _create_valid_task_outcome()

        # Create non-dict object with EPISODE_TYPE marker to trigger parsing
        class NonDictTaskOutcome:
            def __str__(self):
                return f"{EPISODE_TYPE_TASK_OUTCOME} invalid"

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=valid_outcome, score=0.9),
            _create_mock_result(content=NonDictTaskOutcome(), score=0.5),
        ]

        # Execute
        result = await graphiti_search.get_similar_task_outcomes(
            task_description="test task", limit=5
        )

        # Verify: Only valid dict results
        assert len(result) == 1
        assert result[0]["task_id"] == "task-123"

    # --------------------------------------------------------------------------
    # get_patterns_and_gotchas() tests
    # --------------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_get_patterns_and_gotchas_with_non_dict_objects(
        self, graphiti_search, mock_client
    ):
        """
        BUG FIX TEST: Non-dict objects should be filtered in patterns/gotchas.
        """
        valid_pattern = _create_valid_pattern()
        valid_gotcha = _create_valid_gotcha()

        # Create non-dict objects with EPISODE_TYPE markers
        class NonDictPattern:
            def __str__(self):
                return f"{EPISODE_TYPE_PATTERN} invalid"

        class NonDictGotcha:
            def __str__(self):
                return f"{EPISODE_TYPE_GOTCHA} invalid"

        # Mock pattern results with non-dict
        mock_client.graphiti.search = AsyncMock(
            side_effect=[
                [  # Pattern search results
                    _create_mock_result(content=valid_pattern, score=0.9),
                    _create_mock_result(content=NonDictPattern(), score=0.5),
                ],
                [  # Gotcha search results
                    _create_mock_result(content=valid_gotcha, score=0.8),
                    _create_mock_result(content=NonDictGotcha(), score=0.4),
                ],
            ]
        )

        # Execute
        patterns, gotchas = await graphiti_search.get_patterns_and_gotchas(
            query="auth task", num_results=5, min_score=0.3
        )

        # Verify: Only valid dict results
        assert len(patterns) == 1
        assert patterns[0]["pattern"] == "Test pattern"
        assert len(gotchas) == 1
        assert gotchas[0]["gotcha"] == "Token expires"


# =============================================================================
# EDGE CASE TESTS
# =============================================================================


class TestEdgeCases:
    """Additional edge case tests for robustness."""

    @pytest.mark.asyncio
    async def test_get_session_history_with_none_content(
        self, graphiti_search, mock_client
    ):
        """Test handling of None content."""
        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=None, score=0.5),
        ]

        result = await graphiti_search.get_session_history(limit=5)

        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_get_session_history_with_invalid_json(
        self, graphiti_search, mock_client
    ):
        """Test handling of invalid JSON string with EPISODE_TYPE marker."""
        # Malformed JSON that includes the session_insight marker
        # so it triggers the json.loads path
        invalid_json = f'{{"type": "{EPISODE_TYPE_SESSION_INSIGHT}", invalid json}}'
        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=invalid_json, score=0.5),
        ]

        # Should not crash, just skip invalid JSON
        result = await graphiti_search.get_session_history(limit=5)

        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_get_session_history_with_list_content(
        self, graphiti_search, mock_client
    ):
        """Test handling of list content (not a dict)."""
        mock_client.graphiti.search.return_value = [
            _create_mock_result(
                content=[
                    EPISODE_TYPE_SESSION_INSIGHT,
                    {"data": "value"},
                ],
                score=0.5,
            ),
        ]

        # List should be filtered out by isinstance check
        result = await graphiti_search.get_session_history(limit=5)

        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_get_session_history_spec_filtering(
        self, graphiti_search, mock_client
    ):
        """Test spec_id filtering works correctly."""
        # Create insights for different specs
        insight_1 = _create_valid_session_insight(
            session_number=1, spec_id="test_spec_123"
        )
        insight_2 = _create_valid_session_insight(
            session_number=2, spec_id="other_spec_456"
        )

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=insight_1, score=0.9),
            _create_mock_result(content=insight_2, score=0.8),
        ]

        # Execute with spec_only=True (default)
        result = await graphiti_search.get_session_history(
            limit=5, spec_only=True
        )

        # Verify: Only matching spec_id should be returned
        assert len(result) == 1
        assert result[0]["spec_id"] == "test_spec_123"

    @pytest.mark.asyncio
    async def test_get_session_history_all_specs(
        self, graphiti_search, mock_client
    ):
        """Test getting sessions from all specs."""
        insight_1 = _create_valid_session_insight(
            session_number=1, spec_id="test_spec_123"
        )
        insight_2 = _create_valid_session_insight(
            session_number=2, spec_id="other_spec_456"
        )

        mock_client.graphiti.search.return_value = [
            _create_mock_result(content=insight_1, score=0.9),
            _create_mock_result(content=insight_2, score=0.8),
        ]

        # Execute with spec_only=False
        result = await graphiti_search.get_session_history(
            limit=5, spec_only=False
        )

        # Verify: All insights should be returned
        assert len(result) == 2
