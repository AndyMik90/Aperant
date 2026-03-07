#!/usr/bin/env python3
"""
Tests for QA Criteria Module
============================

Tests the qa/criteria.py module functionality including:
- Implementation plan I/O
- QA signoff status management
- QA readiness checks (should_run_qa, should_run_fixes)
- Status display functions

Note: This test module mocks all dependencies to avoid importing
the Claude SDK which is not available in the test environment.
"""

import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# =============================================================================
# MOCK SETUP - Must happen before ANY imports from auto-claude
# =============================================================================

# Store original modules for cleanup
_original_modules = {}
_mocked_module_names = [
    'claude_agent_sdk',
    'ui',
    'progress',
    'task_logger',
    'linear_updater',
    'client',
]

for name in _mocked_module_names:
    if name in sys.modules:
        _original_modules[name] = sys.modules[name]

# Mock claude_agent_sdk FIRST (before any other imports)
mock_sdk = MagicMock()
mock_sdk.ClaudeSDKClient = MagicMock()
mock_sdk.ClaudeAgentOptions = MagicMock()
mock_sdk.ClaudeCodeOptions = MagicMock()
sys.modules['claude_agent_sdk'] = mock_sdk

# Mock UI module (used by progress)
mock_ui = MagicMock()
mock_ui.Icons = MagicMock()
mock_ui.icon = MagicMock(return_value="")
mock_ui.color = MagicMock()
mock_ui.Color = MagicMock()
mock_ui.success = MagicMock(return_value="")
mock_ui.error = MagicMock(return_value="")
mock_ui.warning = MagicMock(return_value="")
mock_ui.info = MagicMock(return_value="")
mock_ui.muted = MagicMock(return_value="")
mock_ui.highlight = MagicMock(return_value="")
mock_ui.bold = MagicMock(return_value="")
mock_ui.box = MagicMock(return_value="")
mock_ui.divider = MagicMock(return_value="")
mock_ui.progress_bar = MagicMock(return_value="")
mock_ui.print_header = MagicMock()
mock_ui.print_section = MagicMock()
mock_ui.print_status = MagicMock()
mock_ui.print_phase_status = MagicMock()
mock_ui.print_key_value = MagicMock()
sys.modules['ui'] = mock_ui

# Mock progress module
mock_progress = MagicMock()
mock_progress.count_subtasks = MagicMock(return_value=(3, 3))
mock_progress.is_build_complete = MagicMock(return_value=True)
sys.modules['progress'] = mock_progress

# Mock task_logger
mock_task_logger = MagicMock()
mock_task_logger.LogPhase = MagicMock()
mock_task_logger.LogEntryType = MagicMock()
mock_task_logger.get_task_logger = MagicMock(return_value=None)
sys.modules['task_logger'] = mock_task_logger

# Mock linear_updater
mock_linear = MagicMock()
mock_linear.is_linear_enabled = MagicMock(return_value=False)
mock_linear.LinearTaskState = MagicMock()
mock_linear.linear_qa_started = MagicMock()
mock_linear.linear_qa_approved = MagicMock()
mock_linear.linear_qa_rejected = MagicMock()
mock_linear.linear_qa_max_iterations = MagicMock()
sys.modules['linear_updater'] = mock_linear

# Mock client module
mock_client = MagicMock()
mock_client.create_client = MagicMock()
sys.modules['client'] = mock_client

# Now we can safely add the auto-claude path and import
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

# Import criteria functions directly to avoid going through qa/__init__.py
# which imports reviewer and fixer that need the SDK
from qa.criteria import (
    load_implementation_plan,
    save_implementation_plan,
    get_qa_signoff_status,
    is_qa_approved,
    is_qa_rejected,
    is_fixes_applied,
    get_qa_iteration_count,
    should_run_qa,
    should_run_fixes,
    print_qa_status,
)

# Mock the qa.report import inside print_qa_status
mock_report = MagicMock()
mock_report.get_iteration_history = MagicMock(return_value=[])
mock_report.get_recurring_issue_summary = MagicMock(return_value={})


# =============================================================================
# FIXTURES
# =============================================================================


# Cleanup fixture to restore original modules after all tests in this module
@pytest.fixture(scope="module", autouse=True)
def cleanup_mocked_modules():
    """Restore original modules after all tests in this module complete."""
    yield  # Run all tests first
    # Cleanup: restore original modules or remove mocks
    for name in _mocked_module_names:
        if name in _original_modules:
            sys.modules[name] = _original_modules[name]
        elif name in sys.modules:
            del sys.modules[name]


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
def qa_signoff_approved():
    """Return an approved QA signoff structure."""
    return {
        "status": "approved",
        "qa_session": 1,
        "timestamp": "2024-01-01T12:00:00",
        "tests_passed": {
            "unit": True,
            "integration": True,
            "e2e": True,
        },
    }


@pytest.fixture
def qa_signoff_rejected():
    """Return a rejected QA signoff structure."""
    return {
        "status": "rejected",
        "qa_session": 1,
        "timestamp": "2024-01-01T12:00:00",
        "issues_found": [
            {"title": "Test failure", "type": "unit_test"},
            {"title": "Missing validation", "type": "acceptance"},
        ],
    }


@pytest.fixture
def sample_implementation_plan():
    """Return a sample implementation plan structure."""
    return {
        "feature": "User Avatar Upload",
        "workflow_type": "feature",
        "services_involved": ["backend", "worker", "frontend"],
        "phases": [
            {
                "phase": 1,
                "name": "Backend Foundation",
                "subtasks": [
                    {"id": "subtask-1-1", "description": "Add avatar fields", "status": "completed"},
                ],
            },
        ],
    }


class TestImplementationPlanIO:
    """Tests for implementation plan loading/saving."""

    def test_load_implementation_plan(self, spec_dir: Path, sample_implementation_plan: dict):
        """Loads implementation plan from JSON."""
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(sample_implementation_plan))

        plan = load_implementation_plan(spec_dir)

        assert plan is not None
        assert plan["feature"] == "User Avatar Upload"

    def test_load_missing_plan_returns_none(self, spec_dir: Path):
        """Returns None when plan file doesn't exist."""
        plan = load_implementation_plan(spec_dir)
        assert plan is None

    def test_load_invalid_json_returns_none(self, spec_dir: Path):
        """Returns None for invalid JSON."""
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text("{ invalid json }")

        plan = load_implementation_plan(spec_dir)
        assert plan is None

    def test_load_empty_file_returns_none(self, spec_dir: Path):
        """Returns None for empty file."""
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text("")

        plan = load_implementation_plan(spec_dir)
        assert plan is None

    def test_save_implementation_plan(self, spec_dir: Path):
        """Saves implementation plan to JSON."""
        plan = {"feature": "Test", "phases": []}

        result = save_implementation_plan(spec_dir, plan)

        assert result is True
        assert (spec_dir / "implementation_plan.json").exists()

        loaded = json.loads((spec_dir / "implementation_plan.json").read_text())
        assert loaded["feature"] == "Test"

    def test_save_implementation_plan_creates_file(self, spec_dir: Path):
        """Creates the file if it doesn't exist."""
        plan = {"feature": "New Feature", "phases": []}

        result = save_implementation_plan(spec_dir, plan)

        assert result is True
        assert (spec_dir / "implementation_plan.json").exists()

    def test_save_implementation_plan_overwrites(self, spec_dir: Path):
        """Overwrites existing plan file."""
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text('{"feature": "Old"}')

        new_plan = {"feature": "New", "phases": []}
        save_implementation_plan(spec_dir, new_plan)

        loaded = json.loads(plan_file.read_text())
        assert loaded["feature"] == "New"

    def test_save_implementation_plan_with_indentation(self, spec_dir: Path):
        """Saves with proper JSON indentation."""
        plan = {"feature": "Test", "phases": [{"name": "Phase 1"}]}

        save_implementation_plan(spec_dir, plan)

        content = (spec_dir / "implementation_plan.json").read_text()
        # Check for indentation (2 spaces as per json.dump with indent=2)
        assert "  " in content


class TestGetQASignoffStatus:
    """Tests for get_qa_signoff_status function."""

    def test_get_qa_signoff_status(self, spec_dir: Path):
        """Gets QA signoff status from plan."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "approved",
                "qa_session": 1,
                "timestamp": "2024-01-01T12:00:00",
            },
        }
        save_implementation_plan(spec_dir, plan)

        status = get_qa_signoff_status(spec_dir)

        assert status is not None
        assert status["status"] == "approved"

    def test_get_qa_signoff_status_none(self, spec_dir: Path):
        """Returns None when no signoff status."""
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        status = get_qa_signoff_status(spec_dir)
        assert status is None

    def test_get_qa_signoff_status_missing_plan(self, spec_dir: Path):
        """Returns None when plan doesn't exist."""
        status = get_qa_signoff_status(spec_dir)
        assert status is None

    def test_get_qa_signoff_status_empty_signoff(self, spec_dir: Path):
        """Returns empty dict when qa_signoff is empty."""
        plan = {"feature": "Test", "qa_signoff": {}}
        save_implementation_plan(spec_dir, plan)

        status = get_qa_signoff_status(spec_dir)
        assert status == {}


class TestIsQAApproved:
    """Tests for is_qa_approved function."""

    def test_is_qa_approved_true(self, spec_dir: Path, qa_signoff_approved: dict):
        """is_qa_approved returns True when approved."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_approved}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is True

    def test_is_qa_approved_false_when_rejected(self, spec_dir: Path, qa_signoff_rejected: dict):
        """is_qa_approved returns False when rejected."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_rejected}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is False

    def test_is_qa_approved_no_signoff(self, spec_dir: Path):
        """is_qa_approved returns False when no signoff."""
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is False

    def test_is_qa_approved_no_plan(self, spec_dir: Path):
        """is_qa_approved returns False when no plan exists."""
        assert is_qa_approved(spec_dir) is False

    def test_is_qa_approved_other_status(self, spec_dir: Path):
        """is_qa_approved returns False for other status values."""
        plan = {
            "feature": "Test",
            "qa_signoff": {"status": "in_progress"},
        }
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is False


class TestIsQARejected:
    """Tests for is_qa_rejected function."""

    def test_is_qa_rejected_true(self, spec_dir: Path, qa_signoff_rejected: dict):
        """is_qa_rejected returns True when rejected."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_rejected}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_rejected(spec_dir) is True

    def test_is_qa_rejected_false_when_approved(self, spec_dir: Path, qa_signoff_approved: dict):
        """is_qa_rejected returns False when approved."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_approved}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_rejected(spec_dir) is False

    def test_is_qa_rejected_no_signoff(self, spec_dir: Path):
        """is_qa_rejected returns False when no signoff."""
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_rejected(spec_dir) is False

    def test_is_qa_rejected_no_plan(self, spec_dir: Path):
        """is_qa_rejected returns False when no plan exists."""
        assert is_qa_rejected(spec_dir) is False

    def test_is_qa_rejected_fixes_applied(self, spec_dir: Path):
        """is_qa_rejected returns False when status is fixes_applied."""
        plan = {
            "feature": "Test",
            "qa_signoff": {"status": "fixes_applied"},
        }
        save_implementation_plan(spec_dir, plan)

        assert is_qa_rejected(spec_dir) is False


class TestIsFixesApplied:
    """Tests for is_fixes_applied function."""

    def test_is_fixes_applied_true(self, spec_dir: Path):
        """is_fixes_applied returns True when status is fixes_applied and ready."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "fixes_applied",
                "ready_for_qa_revalidation": True,
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is True

    def test_is_fixes_applied_not_ready(self, spec_dir: Path):
        """is_fixes_applied returns False when not ready for revalidation."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "fixes_applied",
                "ready_for_qa_revalidation": False,
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is False

    def test_is_fixes_applied_missing_ready_flag(self, spec_dir: Path):
        """is_fixes_applied returns False when ready flag is missing."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "fixes_applied",
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is False

    def test_is_fixes_applied_wrong_status(self, spec_dir: Path):
        """is_fixes_applied returns False when status is not fixes_applied."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "ready_for_qa_revalidation": True,
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is False

    def test_is_fixes_applied_no_signoff(self, spec_dir: Path):
        """is_fixes_applied returns False when no signoff."""
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is False


class TestGetQAIterationCount:
    """Tests for get_qa_iteration_count function."""

    def test_get_qa_iteration_count(self, spec_dir: Path):
        """Gets QA iteration count from signoff."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 3,
            },
        }
        save_implementation_plan(spec_dir, plan)

        count = get_qa_iteration_count(spec_dir)
        assert count == 3

    def test_get_qa_iteration_count_zero(self, spec_dir: Path):
        """Returns 0 when no QA sessions."""
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        count = get_qa_iteration_count(spec_dir)
        assert count == 0

    def test_get_qa_iteration_count_no_plan(self, spec_dir: Path):
        """Returns 0 when no plan exists."""
        count = get_qa_iteration_count(spec_dir)
        assert count == 0

    def test_get_qa_iteration_count_missing_session(self, spec_dir: Path):
        """Returns 0 when qa_session is missing from signoff."""
        plan = {
            "feature": "Test",
            "qa_signoff": {"status": "rejected"},
        }
        save_implementation_plan(spec_dir, plan)

        count = get_qa_iteration_count(spec_dir)
        assert count == 0

    def test_get_qa_iteration_count_high_value(self, spec_dir: Path):
        """Handles high iteration count."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 25,
            },
        }
        save_implementation_plan(spec_dir, plan)

        count = get_qa_iteration_count(spec_dir)
        assert count == 25


class TestShouldRunQA:
    """Tests for should_run_qa function."""

    def test_should_run_qa_build_not_complete(self, spec_dir: Path):
        """Returns False when build not complete."""
        from unittest.mock import patch

        plan = {"feature": "Test", "phases": []}
        save_implementation_plan(spec_dir, plan)

        with patch('qa.criteria.is_build_ready_for_qa', return_value=False):
            result = should_run_qa(spec_dir)
            assert result is False

    def test_should_run_qa_already_approved(self, spec_dir: Path, qa_signoff_approved: dict):
        """Returns False when already approved."""
        from unittest.mock import patch

        plan = {"feature": "Test", "qa_signoff": qa_signoff_approved}
        save_implementation_plan(spec_dir, plan)

        with patch('qa.criteria.is_build_ready_for_qa', return_value=True):
            result = should_run_qa(spec_dir)
            assert result is False

    def test_should_run_qa_build_complete_not_approved(self, spec_dir: Path):
        """Returns True when build complete but not approved."""
        # Explicitly patch is_build_ready_for_qa to return True
        from unittest.mock import patch
        with patch('qa.criteria.is_build_ready_for_qa', return_value=True):
            plan = {"feature": "Test", "phases": []}
            save_implementation_plan(spec_dir, plan)

            result = should_run_qa(spec_dir)
            assert result is True

    def test_should_run_qa_rejected_status(self, spec_dir: Path, qa_signoff_rejected: dict):
        """Returns True when rejected (needs re-review after fixes)."""
        from unittest.mock import patch

        qa_signoff_rejected["qa_session"] = 1
        plan = {"feature": "Test", "qa_signoff": qa_signoff_rejected}
        save_implementation_plan(spec_dir, plan)

        with patch('qa.criteria.is_build_ready_for_qa', return_value=True):
            result = should_run_qa(spec_dir)
            assert result is True

    def test_should_run_qa_no_plan(self, spec_dir: Path):
        """Returns False when no plan exists (build not ready)."""
        from unittest.mock import patch

        with patch('qa.criteria.is_build_ready_for_qa', return_value=False):
            result = should_run_qa(spec_dir)
            assert result is False


class TestShouldRunFixes:
    """Tests for should_run_fixes function."""

    def test_should_run_fixes_when_rejected(self, spec_dir: Path, qa_signoff_rejected: dict):
        """Returns True when QA rejected and under max iterations."""
        # Ensure qa_session is below MAX_QA_ITERATIONS
        qa_signoff_rejected["qa_session"] = 1
        plan = {"feature": "Test", "qa_signoff": qa_signoff_rejected}
        save_implementation_plan(spec_dir, plan)

        result = should_run_fixes(spec_dir)
        assert result is True

    def test_should_run_fixes_max_iterations(self, spec_dir: Path):
        """Returns False when max iterations reached."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 50,  # MAX_QA_ITERATIONS
            },
        }
        save_implementation_plan(spec_dir, plan)

        result = should_run_fixes(spec_dir)
        assert result is False

    def test_should_run_fixes_over_max_iterations(self, spec_dir: Path):
        """Returns False when over max iterations."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 100,
            },
        }
        save_implementation_plan(spec_dir, plan)

        result = should_run_fixes(spec_dir)
        assert result is False

    def test_should_run_fixes_not_rejected(self, spec_dir: Path, qa_signoff_approved: dict):
        """Returns False when not rejected."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_approved}
        save_implementation_plan(spec_dir, plan)

        result = should_run_fixes(spec_dir)
        assert result is False

    def test_should_run_fixes_no_signoff(self, spec_dir: Path):
        """Returns False when no signoff exists."""
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        result = should_run_fixes(spec_dir)
        assert result is False

    def test_should_run_fixes_fixes_applied_status(self, spec_dir: Path):
        """Returns False when status is fixes_applied (not rejected)."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "fixes_applied",
                "qa_session": 1,
            },
        }
        save_implementation_plan(spec_dir, plan)

        result = should_run_fixes(spec_dir)
        assert result is False


class TestPrintQAStatus:
    """Tests for print_qa_status function."""

    def test_print_qa_status_not_started(self, spec_dir: Path, capsys):
        """Prints 'Not started' when no signoff exists."""
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock the report module functions
        mock_report.get_iteration_history.return_value = []

        print_qa_status(spec_dir)

        captured = capsys.readouterr()
        assert "Not started" in captured.out

    def test_print_qa_status_approved(self, spec_dir: Path, qa_signoff_approved: dict, capsys):
        """Prints approved status with test results."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_approved}
        save_implementation_plan(spec_dir, plan)

        mock_report.get_iteration_history.return_value = []

        print_qa_status(spec_dir)

        captured = capsys.readouterr()
        assert "APPROVED" in captured.out
        assert "Tests:" in captured.out

    def test_print_qa_status_rejected(self, spec_dir: Path, qa_signoff_rejected: dict, capsys):
        """Prints rejected status with issues found."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_rejected}
        save_implementation_plan(spec_dir, plan)

        mock_report.get_iteration_history.return_value = []

        print_qa_status(spec_dir)

        captured = capsys.readouterr()
        assert "REJECTED" in captured.out
        assert "Issues Found:" in captured.out

    def test_print_qa_status_with_history(self, spec_dir: Path, qa_signoff_rejected: dict, capsys):
        """Prints iteration history summary when available."""
        from unittest.mock import patch

        plan = {"feature": "Test", "qa_signoff": qa_signoff_rejected}
        save_implementation_plan(spec_dir, plan)

        # Mock iteration history using patch for the actual import location
        import qa.report as report_module
        with patch.object(report_module, 'get_iteration_history', return_value=[
            {"iteration": 1, "status": "rejected", "issues": []},
            {"iteration": 2, "status": "rejected", "issues": []},
        ]), patch.object(report_module, 'get_recurring_issue_summary', return_value={
            "iterations_approved": 0,
            "iterations_rejected": 2,
            "most_common": [],
        }):
            print_qa_status(spec_dir)

        captured = capsys.readouterr()
        assert "Iteration History:" in captured.out
        assert "Total iterations:" in captured.out

    def test_print_qa_status_missing_plan(self, spec_dir: Path, capsys):
        """Prints 'Not started' when plan doesn't exist."""
        mock_report.get_iteration_history.return_value = []

        print_qa_status(spec_dir)

        captured = capsys.readouterr()
        assert "Not started" in captured.out

    def test_print_qa_status_shows_qa_sessions(self, spec_dir: Path, capsys):
        """Prints QA session count."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 5,
                "timestamp": "2024-01-01T12:00:00",
            },
        }
        save_implementation_plan(spec_dir, plan)

        mock_report.get_iteration_history.return_value = []

        print_qa_status(spec_dir)

        captured = capsys.readouterr()
        assert "QA Sessions: 5" in captured.out

    def test_print_qa_status_shows_timestamp(self, spec_dir: Path, capsys):
        """Prints last updated timestamp."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "approved",
                "qa_session": 1,
                "timestamp": "2024-01-15T10:30:00",
            },
        }
        save_implementation_plan(spec_dir, plan)

        mock_report.get_iteration_history.return_value = []

        print_qa_status(spec_dir)

        captured = capsys.readouterr()
        assert "Last Updated:" in captured.out

    def test_print_qa_status_truncates_issues(self, spec_dir: Path, capsys):
        """Shows only first 3 issues and indicates more."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 1,
                "issues_found": [
                    {"title": "Issue 1", "type": "unit_test"},
                    {"title": "Issue 2", "type": "unit_test"},
                    {"title": "Issue 3", "type": "unit_test"},
                    {"title": "Issue 4", "type": "unit_test"},
                    {"title": "Issue 5", "type": "unit_test"},
                ],
            },
        }
        save_implementation_plan(spec_dir, plan)

        mock_report.get_iteration_history.return_value = []

        print_qa_status(spec_dir)

        captured = capsys.readouterr()
        assert "Issue 1" in captured.out
        assert "Issue 2" in captured.out
        assert "Issue 3" in captured.out
        assert "and 2 more" in captured.out

    def test_print_qa_status_with_most_common_issues(self, spec_dir: Path, capsys):
        """Prints most common issues from history."""
        from unittest.mock import patch

        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 3,
            },
        }
        save_implementation_plan(spec_dir, plan)

        # Mock iteration history using patch for the actual import location
        import qa.report as report_module
        with patch.object(report_module, 'get_iteration_history', return_value=[
            {"iteration": 1, "status": "rejected"},
            {"iteration": 2, "status": "rejected"},
            {"iteration": 3, "status": "rejected"},
        ]), patch.object(report_module, 'get_recurring_issue_summary', return_value={
            "iterations_approved": 0,
            "iterations_rejected": 3,
            "most_common": [
                {"title": "Common Issue", "occurrences": 3},
            ],
        }):
            print_qa_status(spec_dir)

        captured = capsys.readouterr()
        assert "Most common issues:" in captured.out
        assert "Common Issue" in captured.out


class TestQAStateMachine:
    """Tests for QA state transitions."""

    def test_pending_to_rejected(self, spec_dir: Path):
        """Can transition from no signoff to rejected."""
        # Start with no signoff
        plan = {"feature": "Test", "phases": []}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is False
        assert is_qa_rejected(spec_dir) is False

        # Transition to rejected
        plan["qa_signoff"] = {"status": "rejected", "qa_session": 1}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_rejected(spec_dir) is True

    def test_rejected_to_fixes_applied(self, spec_dir: Path):
        """Can transition from rejected to fixes_applied."""
        plan = {
            "feature": "Test",
            "qa_signoff": {"status": "rejected", "qa_session": 1},
        }
        save_implementation_plan(spec_dir, plan)

        assert is_qa_rejected(spec_dir) is True

        # Transition to fixes_applied
        plan["qa_signoff"] = {
            "status": "fixes_applied",
            "ready_for_qa_revalidation": True,
            "qa_session": 1,
        }
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is True
        assert is_qa_rejected(spec_dir) is False

    def test_fixes_applied_to_approved(self, spec_dir: Path):
        """Can transition from fixes_applied to approved."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "fixes_applied",
                "ready_for_qa_revalidation": True,
            },
        }
        save_implementation_plan(spec_dir, plan)

        # Transition to approved
        plan["qa_signoff"] = {"status": "approved", "qa_session": 2}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is True
        assert is_fixes_applied(spec_dir) is False

    def test_iteration_count_increments(self, spec_dir: Path):
        """QA session counter increments through iterations."""
        plan = {"feature": "Test", "qa_signoff": {"status": "rejected", "qa_session": 1}}
        save_implementation_plan(spec_dir, plan)
        assert get_qa_iteration_count(spec_dir) == 1

        plan["qa_signoff"]["qa_session"] = 2
        save_implementation_plan(spec_dir, plan)
        assert get_qa_iteration_count(spec_dir) == 2

        plan["qa_signoff"]["qa_session"] = 3
        save_implementation_plan(spec_dir, plan)
        assert get_qa_iteration_count(spec_dir) == 3


class TestQAIntegration:
    """Integration tests for QA criteria logic."""

    def test_full_qa_workflow_approved_first_try(self, spec_dir: Path):
        """Full workflow where QA approves on first try."""
        from unittest.mock import patch

        # Build complete
        plan = {"feature": "Test Feature", "phases": []}
        save_implementation_plan(spec_dir, plan)

        # Should run QA
        with patch('qa.criteria.is_build_ready_for_qa', return_value=True):
            assert should_run_qa(spec_dir) is True

        # QA approves
        plan["qa_signoff"] = {
            "status": "approved",
            "qa_session": 1,
            "tests_passed": {"unit": True, "integration": True, "e2e": True},
        }
        save_implementation_plan(spec_dir, plan)

        # Should not run QA again or fixes
        with patch('qa.criteria.is_build_ready_for_qa', return_value=True):
            assert should_run_qa(spec_dir) is False
        assert should_run_fixes(spec_dir) is False
        assert is_qa_approved(spec_dir) is True

    def test_full_qa_workflow_with_fixes(self, spec_dir: Path):
        """Full workflow with reject-fix-approve cycle."""
        from unittest.mock import patch

        # Build complete
        plan = {"feature": "Test Feature", "phases": []}
        save_implementation_plan(spec_dir, plan)

        # Should run QA
        with patch('qa.criteria.is_build_ready_for_qa', return_value=True):
            assert should_run_qa(spec_dir) is True

        # QA rejects
        plan["qa_signoff"] = {
            "status": "rejected",
            "qa_session": 1,
            "issues_found": [{"title": "Missing test", "type": "unit_test"}],
        }
        save_implementation_plan(spec_dir, plan)

        assert should_run_fixes(spec_dir) is True
        assert is_qa_rejected(spec_dir) is True

        # Fixes applied
        plan["qa_signoff"]["status"] = "fixes_applied"
        plan["qa_signoff"]["ready_for_qa_revalidation"] = True
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is True

        # QA approves on second attempt
        plan["qa_signoff"] = {
            "status": "approved",
            "qa_session": 2,
            "tests_passed": {"unit": True, "integration": True, "e2e": True},
        }
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is True
        assert get_qa_iteration_count(spec_dir) == 2

    def test_qa_workflow_max_iterations(self, spec_dir: Path):
        """Test behavior when max iterations are reached."""
        from unittest.mock import patch

        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 50,
            },
        }
        save_implementation_plan(spec_dir, plan)

        # Should not run more fixes after max iterations
        assert should_run_fixes(spec_dir) is False
        # But QA can still be run (to re-check)
        with patch('qa.criteria.is_build_ready_for_qa', return_value=True):
            assert should_run_qa(spec_dir) is True
