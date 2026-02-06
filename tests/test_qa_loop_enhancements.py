#!/usr/bin/env python3
"""
Tests for qa_loop.py enhancements.

Tests cover:
- Iteration tracking
- Recurring issue detection
- No-test project handling
- Manual test plan creation
"""

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Add auto-claude to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from qa_loop import (
    # Iteration tracking
    get_iteration_history,
    record_iteration,
    # Recurring issue detection
    _normalize_issue_key,
    _issue_similarity,
    has_recurring_issues,
    get_recurring_issue_summary,
    # No-test project handling
    check_test_discovery,
    is_no_test_project,
    create_manual_test_plan,
    # Configuration
    RECURRING_ISSUE_THRESHOLD,
    ISSUE_SIMILARITY_THRESHOLD,
    # Implementation plan helpers
    load_implementation_plan,
    save_implementation_plan,
)


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def temp_dir():
    """Create a temporary directory for tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def spec_dir(temp_dir):
    """Create a spec directory with basic structure."""
    spec = temp_dir / "spec"
    spec.mkdir()
    return spec


@pytest.fixture
def project_dir(temp_dir):
    """Create a project directory."""
    project = temp_dir / "project"
    project.mkdir()
    return project


@pytest.fixture
def spec_with_plan(spec_dir):
    """Create a spec directory with implementation plan."""
    plan = {
        "spec_name": "test-spec",
        "qa_signoff": {
            "status": "pending",
            "qa_session": 0,
        }
    }
    plan_file = spec_dir / "implementation_plan.json"
    with open(plan_file, "w") as f:
        json.dump(plan, f)
    return spec_dir


# =============================================================================
# ITERATION TRACKING TESTS
# =============================================================================


class TestIterationTracking:
    """Tests for iteration tracking functionality."""

    def test_get_iteration_history_empty(self, spec_dir):
        """Test getting history from empty spec."""
        history = get_iteration_history(spec_dir)
        assert history == []

    def test_get_iteration_history_no_plan(self, spec_dir):
        """Test getting history when no plan exists."""
        history = get_iteration_history(spec_dir)
        assert history == []

    def test_record_iteration_creates_history(self, spec_with_plan):
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

    def test_record_multiple_iterations(self, spec_with_plan):
        """Test recording multiple iterations."""
        record_iteration(spec_with_plan, 1, "rejected", [{"title": "Issue 1"}])
        record_iteration(spec_with_plan, 2, "rejected", [{"title": "Issue 2"}])
        record_iteration(spec_with_plan, 3, "approved", [])

        history = get_iteration_history(spec_with_plan)
        assert len(history) == 3
        assert history[0]["iteration"] == 1
        assert history[1]["iteration"] == 2
        assert history[2]["iteration"] == 3

    def test_record_iteration_updates_stats(self, spec_with_plan):
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

    def test_record_iteration_no_duration(self, spec_with_plan):
        """Test recording without duration."""
        record_iteration(spec_with_plan, 1, "approved", [])

        history = get_iteration_history(spec_with_plan)
        assert "duration_seconds" not in history[0]


# =============================================================================
# RECURRING ISSUE DETECTION TESTS
# =============================================================================


class TestIssueNormalization:
    """Tests for issue key normalization."""

    def test_normalize_basic(self):
        """Test basic normalization."""
        issue = {"title": "Test Error", "file": "app.py", "line": 42}
        key = _normalize_issue_key(issue)

        assert "test error" in key
        assert "app.py" in key
        assert "42" in key

    def test_normalize_removes_prefixes(self):
        """Test that common prefixes are removed."""
        issue1 = {"title": "Error: Something wrong"}
        issue2 = {"title": "Something wrong"}

        key1 = _normalize_issue_key(issue1)
        key2 = _normalize_issue_key(issue2)

        # Should be similar after prefix removal
        assert "something wrong" in key1
        assert "something wrong" in key2

    def test_normalize_missing_fields(self):
        """Test normalization with missing fields."""
        issue = {"title": "Test"}
        key = _normalize_issue_key(issue)

        assert "test" in key
        assert "||" in key  # Empty file and line


class TestIssueSimilarity:
    """Tests for issue similarity calculation."""

    def test_identical_issues(self):
        """Test similarity of identical issues."""
        issue = {"title": "Test error", "file": "app.py", "line": 10}

        similarity = _issue_similarity(issue, issue)
        assert similarity == 1.0

    def test_different_issues(self):
        """Test similarity of different issues."""
        issue1 = {"title": "Database connection failed", "file": "db.py"}
        issue2 = {"title": "Frontend rendering error", "file": "ui.js"}

        similarity = _issue_similarity(issue1, issue2)
        assert similarity < 0.5

    def test_similar_issues(self):
        """Test similarity of similar issues."""
        issue1 = {"title": "Type error in function foo", "file": "utils.py", "line": 10}
        issue2 = {"title": "Type error in function foo", "file": "utils.py", "line": 12}

        similarity = _issue_similarity(issue1, issue2)
        assert similarity > ISSUE_SIMILARITY_THRESHOLD


class TestHasRecurringIssues:
    """Tests for recurring issue detection."""

    def test_no_history(self):
        """Test with no history."""
        current = [{"title": "Test issue"}]
        history = []

        has_recurring, recurring = has_recurring_issues(current, history)

        assert has_recurring is False
        assert recurring == []

    def test_no_recurring(self):
        """Test when no issues recur."""
        current = [{"title": "New issue"}]
        history = [
            {"issues": [{"title": "Old issue 1"}]},
            {"issues": [{"title": "Old issue 2"}]},
        ]

        has_recurring, recurring = has_recurring_issues(current, history)

        assert has_recurring is False

    def test_recurring_detected(self):
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

    def test_threshold_respected(self):
        """Test that threshold is respected."""
        current = [{"title": "Issue"}]
        # Only 1 historical occurrence + current = 2, below threshold of 3
        history = [{"issues": [{"title": "Issue"}]}]

        has_recurring, recurring = has_recurring_issues(current, history, threshold=3)

        assert has_recurring is False

    def test_custom_threshold(self):
        """Test with custom threshold."""
        current = [{"title": "Issue"}]
        history = [{"issues": [{"title": "Issue"}]}]

        # With threshold=2, 1 history + 1 current = 2, should trigger
        has_recurring, recurring = has_recurring_issues(current, history, threshold=2)

        assert has_recurring is True


class TestRecurringIssueSummary:
    """Tests for recurring issue summary."""

    def test_empty_history(self):
        """Test summary with empty history."""
        summary = get_recurring_issue_summary([])

        assert summary["total_issues"] == 0
        assert summary["unique_issues"] == 0
        assert summary["most_common"] == []

    def test_summary_counts(self):
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

    def test_most_common_sorted(self):
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

    def test_fix_success_rate(self):
        """Test fix success rate calculation."""
        history = [
            {"status": "rejected", "issues": [{"title": "Issue"}]},
            {"status": "rejected", "issues": [{"title": "Issue"}]},
            {"status": "approved", "issues": [{"title": "Fixed"}]},
            {"status": "approved", "issues": [{"title": "Fixed"}]},
        ]

        summary = get_recurring_issue_summary(history)

        assert summary["fix_success_rate"] == 0.5


# =============================================================================
# NO-TEST PROJECT HANDLING TESTS
# =============================================================================


class TestCheckTestDiscovery:
    """Tests for test discovery check."""

    def test_no_discovery_file(self, spec_dir):
        """Test when discovery file doesn't exist."""
        result = check_test_discovery(spec_dir)
        assert result is None

    def test_valid_discovery_file(self, spec_dir):
        """Test reading valid discovery file."""
        discovery = {
            "frameworks": [{"name": "pytest", "type": "unit"}],
            "test_directories": ["tests/"]
        }
        discovery_file = spec_dir / "test_discovery.json"
        with open(discovery_file, "w") as f:
            json.dump(discovery, f)

        result = check_test_discovery(spec_dir)

        assert result is not None
        assert len(result["frameworks"]) == 1

    def test_invalid_json(self, spec_dir):
        """Test handling of invalid JSON."""
        discovery_file = spec_dir / "test_discovery.json"
        discovery_file.write_text("invalid json{")

        result = check_test_discovery(spec_dir)
        assert result is None


class TestIsNoTestProject:
    """Tests for no-test project detection."""

    def test_empty_project_is_no_test(self, spec_dir, project_dir):
        """Test that empty project has no tests."""
        result = is_no_test_project(spec_dir, project_dir)
        assert result is True

    def test_project_with_pytest_ini(self, spec_dir, project_dir):
        """Test detection of pytest.ini."""
        (project_dir / "pytest.ini").write_text("[pytest]")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_jest_config(self, spec_dir, project_dir):
        """Test detection of Jest config."""
        (project_dir / "jest.config.js").write_text("module.exports = {}")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_test_directory(self, spec_dir, project_dir):
        """Test detection of test directory."""
        tests_dir = project_dir / "tests"
        tests_dir.mkdir()
        (tests_dir / "test_app.py").write_text("def test_example(): pass")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_spec_files(self, spec_dir, project_dir):
        """Test detection of spec files."""
        tests_dir = project_dir / "__tests__"
        tests_dir.mkdir()
        (tests_dir / "app.spec.js").write_text("describe('app', () => {})")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_uses_discovery_json_if_available(self, spec_dir, project_dir):
        """Test that discovery.json takes precedence."""
        # Project has no test files
        # But discovery.json says there are frameworks
        discovery = {"frameworks": [{"name": "pytest"}]}
        discovery_file = spec_dir / "test_discovery.json"
        with open(discovery_file, "w") as f:
            json.dump(discovery, f)

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_empty_discovery_means_no_tests(self, spec_dir, project_dir):
        """Test that empty discovery means no tests."""
        discovery = {"frameworks": []}
        discovery_file = spec_dir / "test_discovery.json"
        with open(discovery_file, "w") as f:
            json.dump(discovery, f)

        result = is_no_test_project(spec_dir, project_dir)
        assert result is True


class TestCreateManualTestPlan:
    """Tests for manual test plan creation."""

    def test_creates_file(self, spec_dir):
        """Test that file is created."""
        result = create_manual_test_plan(spec_dir, "test-feature")

        assert result.exists()
        assert result.name == "MANUAL_TEST_PLAN.md"

    def test_contains_spec_name(self, spec_dir):
        """Test that plan contains spec name."""
        result = create_manual_test_plan(spec_dir, "my-feature")

        content = result.read_text()
        assert "my-feature" in content

    def test_contains_checklist(self, spec_dir):
        """Test that plan contains checklist items."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "[ ]" in content  # Checkbox items

    def test_contains_sections(self, spec_dir):
        """Test that plan contains required sections."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "## Overview" in content
        assert "## Functional Tests" in content
        assert "## Non-Functional Tests" in content
        assert "## Sign-off" in content

    def test_extracts_acceptance_criteria(self, spec_dir):
        """Test extraction of acceptance criteria from spec."""
        # Create spec with acceptance criteria
        spec_content = """# Feature Spec

## Description
A test feature.

## Acceptance Criteria
- Feature does X
- Feature handles Y
- Feature reports Z

## Implementation
Details here.
"""
        (spec_dir / "spec.md").write_text(spec_content)

        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "Feature does X" in content
        assert "Feature handles Y" in content
        assert "Feature reports Z" in content


# =============================================================================
# CONFIGURATION TESTS
# =============================================================================


class TestConfiguration:
    """Tests for configuration values."""

    def test_recurring_threshold_default(self):
        """Test default recurring issue threshold."""
        assert RECURRING_ISSUE_THRESHOLD == 3

    def test_similarity_threshold_default(self):
        """Test default similarity threshold."""
        assert ISSUE_SIMILARITY_THRESHOLD == 0.8
        assert 0 < ISSUE_SIMILARITY_THRESHOLD <= 1


# =============================================================================
# EDGE CASES
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases."""

    def test_record_iteration_no_plan_file(self, spec_dir):
        """Test recording when plan file doesn't exist."""
        # Should create the file
        result = record_iteration(spec_dir, 1, "rejected", [])

        assert result is True
        plan = load_implementation_plan(spec_dir)
        assert "qa_iteration_history" in plan

    def test_issue_with_none_values(self):
        """Test handling of None values in issues."""
        issue = {"title": None, "file": None, "line": None}
        key = _normalize_issue_key(issue)

        # Should not crash
        assert isinstance(key, str)

    def test_empty_issue(self):
        """Test handling of empty issue."""
        issue = {}
        key = _normalize_issue_key(issue)

        assert key == "||"  # All empty fields

    def test_similarity_empty_issues(self):
        """Test similarity of empty issues."""
        issue1 = {}
        issue2 = {}

        similarity = _issue_similarity(issue1, issue2)
        assert similarity == 1.0  # Both empty = identical

    def test_history_with_missing_issues_key(self):
        """Test history records missing issues key."""
        history = [
            {"status": "rejected"},  # Missing 'issues' key
            {"status": "approved", "issues": []},
        ]

        summary = get_recurring_issue_summary(history)
        # Should not crash
        assert summary["total_issues"] == 0
