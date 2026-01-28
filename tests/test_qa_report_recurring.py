#!/usr/bin/env python3
"""
Tests for QA Report - Recurring Issue Detection
================================================

Tests the recurring issue detection functionality of qa/report.py including:
- _normalize_issue_key()
- _issue_similarity()
- has_recurring_issues()
- get_recurring_issue_summary()
"""

import sys
from pathlib import Path
from typing import Dict, List, Tuple

import pytest

# Add tests directory to path for helper imports
sys.path.insert(0, str(Path(__file__).parent))

# Setup mocks before importing auto-claude modules
from qa_report_helpers import cleanup_qa_report_mocks, setup_qa_report_mocks

# Setup mocks
setup_qa_report_mocks()

# Import report functions after mocking
from qa.report import (
    ISSUE_SIMILARITY_THRESHOLD,
    RECURRING_ISSUE_THRESHOLD,
    _issue_similarity,
    _normalize_issue_key,
    get_recurring_issue_summary,
    has_recurring_issues,
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
# ISSUE NORMALIZATION TESTS
# =============================================================================


class TestIssueNormalization:
    """Tests for _normalize_issue_key() function."""

    def test_basic_normalization(self) -> None:
        """Test basic normalization."""
        issue = {"title": "Test Error", "file": "app.py", "line": 42}
        key = _normalize_issue_key(issue)

        assert "test error" in key
        assert "app.py" in key
        assert "42" in key

    def test_removes_error_prefix(self) -> None:
        """Test that error: prefix is removed."""
        issue1 = {"title": "Error: Something wrong"}
        issue2 = {"title": "Something wrong"}

        key1 = _normalize_issue_key(issue1)
        key2 = _normalize_issue_key(issue2)

        # Should be similar after prefix removal
        assert "something wrong" in key1
        assert "something wrong" in key2

    def test_removes_issue_prefix(self) -> None:
        """Test that issue: prefix is removed."""
        issue = {"title": "Issue: Connection failed"}
        key = _normalize_issue_key(issue)

        assert key.startswith("connection failed")

    def test_removes_bug_prefix(self) -> None:
        """Test that bug: prefix is removed."""
        issue = {"title": "Bug: Memory leak"}
        key = _normalize_issue_key(issue)

        assert key.startswith("memory leak")

    def test_removes_fix_prefix(self) -> None:
        """Test that fix: prefix is removed."""
        issue = {"title": "Fix: Missing validation"}
        key = _normalize_issue_key(issue)

        assert key.startswith("missing validation")

    def test_missing_fields(self) -> None:
        """Test normalization with missing fields."""
        issue = {"title": "Test"}
        key = _normalize_issue_key(issue)

        assert "test" in key
        assert "||" in key  # Empty file and line

    def test_with_none_values(self) -> None:
        """Test handling of None values in issues."""
        issue = {"title": None, "file": None, "line": None}
        key = _normalize_issue_key(issue)

        # Should not crash
        assert isinstance(key, str)

    def test_empty_issue(self) -> None:
        """Test handling of empty issue."""
        issue = {}
        key = _normalize_issue_key(issue)

        assert key == "||"  # All empty fields

    def test_case_insensitive(self) -> None:
        """Test that normalization is case insensitive."""
        issue1 = {"title": "TEST ERROR", "file": "APP.PY"}
        issue2 = {"title": "test error", "file": "app.py"}

        key1 = _normalize_issue_key(issue1)
        key2 = _normalize_issue_key(issue2)

        assert key1 == key2


# =============================================================================
# ISSUE SIMILARITY TESTS
# =============================================================================


class TestIssueSimilarity:
    """Tests for _issue_similarity() function."""

    def test_identical_issues(self) -> None:
        """Test similarity of identical issues."""
        issue = {"title": "Test error", "file": "app.py", "line": 10}

        similarity = _issue_similarity(issue, issue)
        assert similarity == 1.0

    def test_different_issues(self) -> None:
        """Test similarity of different issues."""
        issue1 = {"title": "Database connection failed", "file": "db.py"}
        issue2 = {"title": "Frontend rendering error", "file": "ui.js"}

        similarity = _issue_similarity(issue1, issue2)
        assert similarity < 0.5

    def test_similar_issues(self) -> None:
        """Test similarity of similar issues."""
        issue1 = {"title": "Type error in function foo", "file": "utils.py", "line": 10}
        issue2 = {"title": "Type error in function foo", "file": "utils.py", "line": 12}

        similarity = _issue_similarity(issue1, issue2)
        assert similarity > ISSUE_SIMILARITY_THRESHOLD

    def test_empty_issues(self) -> None:
        """Test similarity of empty issues."""
        issue1 = {}
        issue2 = {}

        similarity = _issue_similarity(issue1, issue2)
        assert similarity == 1.0  # Both empty = identical

    def test_returns_float(self) -> None:
        """Test that similarity returns a float between 0 and 1."""
        issue1 = {"title": "Error A"}
        issue2 = {"title": "Error B"}

        similarity = _issue_similarity(issue1, issue2)
        assert isinstance(similarity, float)
        assert 0.0 <= similarity <= 1.0


# =============================================================================
# RECURRING ISSUE DETECTION TESTS
# =============================================================================


class TestHasRecurringIssues:
    """Tests for has_recurring_issues() function."""

    def test_no_history(self) -> None:
        """Test with no history."""
        current: List[Dict] = [{"title": "Test issue"}]
        history: List[Dict] = []

        has_recurring, recurring = has_recurring_issues(current, history)

        assert has_recurring is False
        assert recurring == []

    def test_no_current_issues(self) -> None:
        """Test with no current issues."""
        current: List[Dict] = []
        history = [{"issues": [{"title": "Old issue"}]}]

        has_recurring, recurring = has_recurring_issues(current, history)

        assert has_recurring is False
        assert recurring == []

    def test_no_recurring(self) -> None:
        """Test when no issues recur."""
        current = [{"title": "New issue"}]
        history = [
            {"issues": [{"title": "Old issue 1"}]},
            {"issues": [{"title": "Old issue 2"}]},
        ]

        has_recurring, recurring = has_recurring_issues(current, history)

        assert has_recurring is False

    def test_recurring_detected(self) -> None:
        """Test detection of recurring issues."""
        current = [{"title": "Same error", "file": "app.py"}]
        history = [
            {"issues": [{"title": "Same error", "file": "app.py"}]},
            {"issues": [{"title": "Same error", "file": "app.py"}]},
        ]

        # Current + 2 history = 3 occurrences >= threshold
        has_recurring, recurring = has_recurring_issues(current, history)

        assert has_recurring is True
        assert len(recurring) == 1
        assert recurring[0]["occurrence_count"] >= RECURRING_ISSUE_THRESHOLD

    def test_threshold_respected(self) -> None:
        """Test that threshold is respected."""
        current = [{"title": "Issue"}]
        # Only 1 historical occurrence + current = 2, below threshold of 3
        history = [{"issues": [{"title": "Issue"}]}]

        has_recurring, recurring = has_recurring_issues(current, history, threshold=3)

        assert has_recurring is False

    def test_custom_threshold(self) -> None:
        """Test with custom threshold."""
        current = [{"title": "Issue"}]
        history = [{"issues": [{"title": "Issue"}]}]

        # With threshold=2, 1 history + 1 current = 2, should trigger
        has_recurring, recurring = has_recurring_issues(current, history, threshold=2)

        assert has_recurring is True

    def test_multiple_recurring_issues(self) -> None:
        """Test detection of multiple recurring issues."""
        current = [
            {"title": "Error A", "file": "a.py"},
            {"title": "Error B", "file": "b.py"},
        ]
        history = [
            {"issues": [{"title": "Error A", "file": "a.py"}, {"title": "Error B", "file": "b.py"}]},
            {"issues": [{"title": "Error A", "file": "a.py"}, {"title": "Error B", "file": "b.py"}]},
        ]

        has_recurring, recurring = has_recurring_issues(current, history)

        assert has_recurring is True
        assert len(recurring) == 2

    def test_includes_occurrence_count(self) -> None:
        """Test that recurring issues include occurrence count."""
        current = [{"title": "Error", "file": "app.py"}]
        history = [
            {"issues": [{"title": "Error", "file": "app.py"}]},
            {"issues": [{"title": "Error", "file": "app.py"}]},
            {"issues": [{"title": "Error", "file": "app.py"}]},
        ]

        has_recurring, recurring = has_recurring_issues(current, history)

        assert has_recurring is True
        assert recurring[0]["occurrence_count"] == 4  # current + 3 history

    def test_history_with_missing_issues_key(self) -> None:
        """Test history records missing issues key."""
        current = [{"title": "Issue"}]
        history = [
            {"status": "rejected"},  # Missing 'issues' key
            {"status": "approved", "issues": []},
        ]

        # Should not crash
        has_recurring, recurring = has_recurring_issues(current, history)
        assert has_recurring is False


# =============================================================================
# RECURRING ISSUE SUMMARY TESTS
# =============================================================================


class TestRecurringIssueSummary:
    """Tests for get_recurring_issue_summary() function."""

    def test_empty_history(self) -> None:
        """Test summary with empty history."""
        summary = get_recurring_issue_summary([])

        assert summary["total_issues"] == 0
        assert summary["unique_issues"] == 0
        assert summary["most_common"] == []

    def test_summary_counts(self) -> None:
        """Test that summary counts are correct."""
        history = [
            {"status": "rejected", "issues": [{"title": "Error A"}, {"title": "Error B"}]},
            {"status": "rejected", "issues": [{"title": "Error A"}]},
            {"status": "approved", "issues": []},
        ]

        summary = get_recurring_issue_summary(history)

        assert summary["total_issues"] == 3
        assert summary["iterations_approved"] == 1
        assert summary["iterations_rejected"] == 2

    def test_most_common_sorted(self) -> None:
        """Test that most common issues are sorted."""
        history = [
            {"issues": [{"title": "Common"}, {"title": "Rare"}]},
            {"issues": [{"title": "Common"}]},
            {"issues": [{"title": "Common"}]},
        ]

        summary = get_recurring_issue_summary(history)

        # "Common" should be first with 3 occurrences
        assert len(summary["most_common"]) > 0
        assert summary["most_common"][0]["title"] == "Common"
        assert summary["most_common"][0]["occurrences"] == 3

    def test_most_common_limited_to_five(self) -> None:
        """Test that most_common is limited to 5 issues."""
        history = [
            {"issues": [
                {"title": "Issue 1"},
                {"title": "Issue 2"},
                {"title": "Issue 3"},
                {"title": "Issue 4"},
                {"title": "Issue 5"},
                {"title": "Issue 6"},
                {"title": "Issue 7"},
            ]},
        ]

        summary = get_recurring_issue_summary(history)

        assert len(summary["most_common"]) <= 5

    def test_fix_success_rate(self) -> None:
        """Test fix success rate calculation."""
        history = [
            {"status": "rejected", "issues": [{"title": "Issue"}]},
            {"status": "rejected", "issues": [{"title": "Issue"}]},
            {"status": "approved", "issues": []},
            {"status": "approved", "issues": []},
        ]

        summary = get_recurring_issue_summary(history)

        assert summary["fix_success_rate"] == 0.5

    def test_fix_success_rate_all_approved(self) -> None:
        """Test fix success rate when all approved with some issues."""
        # Note: When all issues lists are empty, the function returns early
        # with only basic stats. We need at least one issue to get fix_success_rate.
        history = [
            {"status": "approved", "issues": [{"title": "Fixed issue"}]},
            {"status": "approved", "issues": []},
        ]

        summary = get_recurring_issue_summary(history)

        assert summary["fix_success_rate"] == 1.0

    def test_fix_success_rate_all_rejected(self) -> None:
        """Test fix success rate when all rejected."""
        history = [
            {"status": "rejected", "issues": [{"title": "Issue"}]},
            {"status": "rejected", "issues": [{"title": "Issue"}]},
        ]

        summary = get_recurring_issue_summary(history)

        assert summary["fix_success_rate"] == 0.0

    def test_unique_issues_groups_similar(self) -> None:
        """Test that similar issues are grouped."""
        history = [
            {"issues": [{"title": "Type error in foo", "file": "app.py"}]},
            {"issues": [{"title": "Type error in foo", "file": "app.py"}]},
        ]

        summary = get_recurring_issue_summary(history)

        # Should group similar issues
        assert summary["unique_issues"] == 1
        assert summary["total_issues"] == 2

    def test_most_common_includes_file(self) -> None:
        """Test that most_common includes file path."""
        history = [
            {"issues": [{"title": "Error", "file": "app.py"}]},
        ]

        summary = get_recurring_issue_summary(history)

        assert summary["most_common"][0]["file"] == "app.py"

    def test_history_with_missing_issues_key(self) -> None:
        """Test history records missing issues key."""
        history = [
            {"status": "rejected"},  # Missing 'issues' key
            {"status": "approved", "issues": []},
        ]

        summary = get_recurring_issue_summary(history)
        # Should not crash
        assert summary["total_issues"] == 0
