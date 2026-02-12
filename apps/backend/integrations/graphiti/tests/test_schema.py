"""
Tests for Graphiti schema constants and types.

Tests cover:
- Episode type constants
- MAX_CONTEXT_RESULTS constant
- GroupIdMode enum values
"""

import pytest
from integrations.graphiti.queries_pkg.schema import (
    EPISODE_TYPE_CODEBASE_DISCOVERY,
    EPISODE_TYPE_GOTCHA,
    EPISODE_TYPE_HISTORICAL_CONTEXT,
    EPISODE_TYPE_PATTERN,
    EPISODE_TYPE_QA_RESULT,
    EPISODE_TYPE_SESSION_INSIGHT,
    EPISODE_TYPE_TASK_OUTCOME,
    MAX_CONTEXT_RESULTS,
    MAX_RETRIES,
    RETRY_DELAY_SECONDS,
    GroupIdMode,
)


class TestEpisodeTypeConstants:
    """Test episode type constants."""

    def test_session_insight_constant(self):
        """Test EPISODE_TYPE_SESSION_INSIGHT constant."""
        assert EPISODE_TYPE_SESSION_INSIGHT == "session_insight"
        assert isinstance(EPISODE_TYPE_SESSION_INSIGHT, str)

    def test_codebase_discovery_constant(self):
        """Test EPISODE_TYPE_CODEBASE_DISCOVERY constant."""
        assert EPISODE_TYPE_CODEBASE_DISCOVERY == "codebase_discovery"
        assert isinstance(EPISODE_TYPE_CODEBASE_DISCOVERY, str)

    def test_pattern_constant(self):
        """Test EPISODE_TYPE_PATTERN constant."""
        assert EPISODE_TYPE_PATTERN == "pattern"
        assert isinstance(EPISODE_TYPE_PATTERN, str)

    def test_gotcha_constant(self):
        """Test EPISODE_TYPE_GOTCHA constant."""
        assert EPISODE_TYPE_GOTCHA == "gotcha"
        assert isinstance(EPISODE_TYPE_GOTCHA, str)

    def test_task_outcome_constant(self):
        """Test EPISODE_TYPE_TASK_OUTCOME constant."""
        assert EPISODE_TYPE_TASK_OUTCOME == "task_outcome"
        assert isinstance(EPISODE_TYPE_TASK_OUTCOME, str)

    def test_qa_result_constant(self):
        """Test EPISODE_TYPE_QA_RESULT constant."""
        assert EPISODE_TYPE_QA_RESULT == "qa_result"
        assert isinstance(EPISODE_TYPE_QA_RESULT, str)

    def test_historical_context_constant(self):
        """Test EPISODE_TYPE_HISTORICAL_CONTEXT constant."""
        assert EPISODE_TYPE_HISTORICAL_CONTEXT == "historical_context"
        assert isinstance(EPISODE_TYPE_HISTORICAL_CONTEXT, str)

    def test_all_episode_types_are_unique(self):
        """Test that all episode type constants have unique values."""
        episode_types = [
            EPISODE_TYPE_SESSION_INSIGHT,
            EPISODE_TYPE_CODEBASE_DISCOVERY,
            EPISODE_TYPE_PATTERN,
            EPISODE_TYPE_GOTCHA,
            EPISODE_TYPE_TASK_OUTCOME,
            EPISODE_TYPE_QA_RESULT,
            EPISODE_TYPE_HISTORICAL_CONTEXT,
        ]
        assert len(episode_types) == len(set(episode_types)), (
            "Episode types must be unique"
        )


class TestMaxContextResults:
    """Test MAX_CONTEXT_RESULTS constant."""

    def test_max_context_results_is_positive_integer(self):
        """Test MAX_CONTEXT_RESULTS is a positive integer."""
        assert isinstance(MAX_CONTEXT_RESULTS, int)
        assert MAX_CONTEXT_RESULTS > 0

    def test_max_context_results_reasonable_value(self):
        """Test MAX_CONTEXT_RESULTS has a reasonable value."""
        # Should be between 1 and 100 for practical use
        assert 1 <= MAX_CONTEXT_RESULTS <= 100


class TestRetryConfiguration:
    """Test retry configuration constants."""

    def test_max_retries_is_positive_integer(self):
        """Test MAX_RETRIES is a positive integer."""
        assert isinstance(MAX_RETRIES, int)
        assert MAX_RETRIES > 0

    def test_retry_delay_is_positive_number(self):
        """Test RETRY_DELAY_SECONDS is a positive number."""
        assert isinstance(RETRY_DELAY_SECONDS, (int, float))
        assert RETRY_DELAY_SECONDS >= 0


class TestGroupIdMode:
    """Test GroupIdMode class."""

    def test_spec_mode_constant(self):
        """Test GroupIdMode.SPEC constant."""
        assert GroupIdMode.SPEC == "spec"
        assert isinstance(GroupIdMode.SPEC, str)

    def test_project_mode_constant(self):
        """Test GroupIdMode.PROJECT constant."""
        assert GroupIdMode.PROJECT == "project"
        assert isinstance(GroupIdMode.PROJECT, str)

    def test_modes_are_unique(self):
        """Test that mode values are unique."""
        assert GroupIdMode.SPEC != GroupIdMode.PROJECT
