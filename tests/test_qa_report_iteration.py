#!/usr/bin/env python3
"""
Tests for QA Report - Iteration Tracking
=========================================

Tests the iteration tracking functionality of qa/report.py including:
- get_iteration_history()
- record_iteration()
- Iteration statistics tracking
"""

import json
import sys
from pathlib import Path

import pytest

# Add tests directory to path for helper imports
sys.path.insert(0, str(Path(__file__).parent))

# Setup mocks before importing auto-claude modules
from qa_report_helpers import cleanup_qa_report_mocks, setup_qa_report_mocks

# Setup mocks
setup_qa_report_mocks()

# Import report functions after mocking
from qa.criteria import (
    load_implementation_plan,
    save_implementation_plan,
)
from qa.report import (
    get_iteration_history,
    record_iteration,
)

# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture(scope="module", autouse=True)
def cleanup_mocked_modules():
    """Restore original modules after all tests in this module complete."""
    yield  # Run all tests first
    cleanup_qa_report_mocks()


# =============================================================================
# ITERATION TRACKING TESTS
# =============================================================================


class TestGetIterationHistory:
    """Tests for get_iteration_history() function."""

    def test_empty_spec_dir(self, spec_dir: Path) -> None:
        """Test getting history from empty spec."""
        history = get_iteration_history(spec_dir)
        assert history == []

    def test_no_plan_file(self, spec_dir: Path) -> None:
        """Test getting history when no plan exists."""
        history = get_iteration_history(spec_dir)
        assert history == []

    def test_plan_without_history_key(self, spec_dir: Path) -> None:
        """Test getting history when plan exists but no history key."""
        plan = {"spec_name": "test"}
        save_implementation_plan(spec_dir, plan)

        history = get_iteration_history(spec_dir)
        assert history == []

    def test_with_history_data(self, spec_dir: Path) -> None:
        """Test getting history when data exists."""
        plan = {
            "spec_name": "test",
            "qa_iteration_history": [
                {"iteration": 1, "status": "rejected", "issues": []},
                {"iteration": 2, "status": "approved", "issues": []},
            ]
        }
        save_implementation_plan(spec_dir, plan)

        history = get_iteration_history(spec_dir)
        assert len(history) == 2
        assert history[0]["iteration"] == 1
        assert history[1]["status"] == "approved"


class TestRecordIteration:
    """Tests for record_iteration() function."""

    def test_creates_history(self, spec_with_plan: Path) -> None:
        """Test that recording an iteration creates history."""
        issues = [{"title": "Test issue", "type": "error"}]
        result = record_iteration(spec_with_plan, 1, "rejected", issues, 5.5)

        assert result is True

        history = get_iteration_history(spec_with_plan)
        assert len(history) == 1
        assert history[0]["iteration"] == 1
        assert history[0]["status"] == "rejected"
        assert history[0]["issues"] == issues
        assert history[0]["duration_seconds"] == 5.5

    def test_multiple_iterations(self, spec_with_plan: Path) -> None:
        """Test recording multiple iterations."""
        record_iteration(spec_with_plan, 1, "rejected", [{"title": "Issue 1"}])
        record_iteration(spec_with_plan, 2, "rejected", [{"title": "Issue 2"}])
        record_iteration(spec_with_plan, 3, "approved", [])

        history = get_iteration_history(spec_with_plan)
        assert len(history) == 3
        assert history[0]["iteration"] == 1
        assert history[1]["iteration"] == 2
        assert history[2]["iteration"] == 3

    def test_updates_qa_stats(self, spec_with_plan: Path) -> None:
        """Test that recording updates qa_stats."""
        record_iteration(spec_with_plan, 1, "rejected", [{"title": "Error", "type": "error"}])
        record_iteration(spec_with_plan, 2, "rejected", [{"title": "Warning", "type": "warning"}])

        plan = load_implementation_plan(spec_with_plan)
        stats = plan.get("qa_stats", {})

        assert stats["total_iterations"] == 2
        assert stats["last_iteration"] == 2
        assert stats["last_status"] == "rejected"
        assert "error" in stats["issues_by_type"]
        assert "warning" in stats["issues_by_type"]

    def test_no_duration(self, spec_with_plan: Path) -> None:
        """Test recording without duration."""
        record_iteration(spec_with_plan, 1, "approved", [])

        history = get_iteration_history(spec_with_plan)
        assert "duration_seconds" not in history[0]

    def test_creates_plan_if_missing(self, spec_dir: Path) -> None:
        """Test recording when plan file doesn't exist."""
        # Should create the file
        result = record_iteration(spec_dir, 1, "rejected", [])

        assert result is True
        plan = load_implementation_plan(spec_dir)
        assert "qa_iteration_history" in plan

    def test_rounds_duration(self, spec_with_plan: Path) -> None:
        """Test that duration is rounded to 2 decimal places."""
        record_iteration(spec_with_plan, 1, "rejected", [], 12.345678)

        history = get_iteration_history(spec_with_plan)
        assert history[0]["duration_seconds"] == 12.35

    def test_includes_timestamp(self, spec_with_plan: Path) -> None:
        """Test that timestamp is included in record."""
        record_iteration(spec_with_plan, 1, "rejected", [])

        history = get_iteration_history(spec_with_plan)
        assert "timestamp" in history[0]
        # Verify it's a valid ISO format timestamp
        assert "T" in history[0]["timestamp"]

    def test_counts_issues_by_type(self, spec_with_plan: Path) -> None:
        """Test that issues are counted by type."""
        record_iteration(spec_with_plan, 1, "rejected", [
            {"title": "Error 1", "type": "error"},
            {"title": "Error 2", "type": "error"},
            {"title": "Warning 1", "type": "warning"},
        ])

        plan = load_implementation_plan(spec_with_plan)
        assert plan["qa_stats"]["issues_by_type"]["error"] == 2
        assert plan["qa_stats"]["issues_by_type"]["warning"] == 1

    def test_unknown_issue_type(self, spec_with_plan: Path) -> None:
        """Test issues without type are counted as unknown."""
        record_iteration(spec_with_plan, 1, "rejected", [
            {"title": "Issue without type"},
        ])

        plan = load_implementation_plan(spec_with_plan)
        assert plan["qa_stats"]["issues_by_type"]["unknown"] == 1
