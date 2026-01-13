"""
Tests for Progress Tracking Utilities
=====================================

Tests for core/progress.py which provides functions for tracking
and displaying progress of the autonomous coding agent using
subtask-based implementation plans.
"""

import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


class TestCountSubtasks:
    """Tests for count_subtasks function."""

    def test_returns_zero_when_no_plan_file(self, temp_dir):
        """Should return (0, 0) when implementation_plan.json doesn't exist."""
        from core.progress import count_subtasks

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        completed, total = count_subtasks(spec_dir)
        assert completed == 0
        assert total == 0

    def test_counts_subtasks_correctly(self, temp_dir):
        """Should count completed and total subtasks."""
        from core.progress import count_subtasks

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "1", "status": "completed"},
                        {"id": "2", "status": "completed"},
                        {"id": "3", "status": "pending"},
                    ],
                },
                {
                    "phase": 2,
                    "name": "Phase 2",
                    "subtasks": [
                        {"id": "4", "status": "pending"},
                        {"id": "5", "status": "in_progress"},
                    ],
                },
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        completed, total = count_subtasks(spec_dir)
        assert completed == 2
        assert total == 5

    def test_handles_invalid_json(self, temp_dir):
        """Should return (0, 0) for invalid JSON."""
        from core.progress import count_subtasks

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()
        (spec_dir / "implementation_plan.json").write_text("not valid json")

        completed, total = count_subtasks(spec_dir)
        assert completed == 0
        assert total == 0

    def test_handles_empty_phases(self, temp_dir):
        """Should handle plan with no phases."""
        from core.progress import count_subtasks

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {"phases": []}
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        completed, total = count_subtasks(spec_dir)
        assert completed == 0
        assert total == 0


class TestCountSubtasksDetailed:
    """Tests for count_subtasks_detailed function."""

    def test_returns_zero_counts_when_no_plan(self, temp_dir):
        """Should return zero counts when plan doesn't exist."""
        from core.progress import count_subtasks_detailed

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        result = count_subtasks_detailed(spec_dir)

        assert result["completed"] == 0
        assert result["in_progress"] == 0
        assert result["pending"] == 0
        assert result["failed"] == 0
        assert result["total"] == 0

    def test_counts_by_status(self, temp_dir):
        """Should count subtasks by their status."""
        from core.progress import count_subtasks_detailed

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "1", "status": "completed"},
                        {"id": "2", "status": "completed"},
                        {"id": "3", "status": "in_progress"},
                        {"id": "4", "status": "pending"},
                        {"id": "5", "status": "failed"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = count_subtasks_detailed(spec_dir)

        assert result["completed"] == 2
        assert result["in_progress"] == 1
        assert result["pending"] == 1
        assert result["failed"] == 1
        assert result["total"] == 5

    def test_unknown_status_counts_as_pending(self, temp_dir):
        """Should count unknown statuses as pending."""
        from core.progress import count_subtasks_detailed

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "1", "status": "unknown_status"},
                        {"id": "2"},  # No status
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = count_subtasks_detailed(spec_dir)

        assert result["pending"] == 2
        assert result["total"] == 2


class TestIsBuildComplete:
    """Tests for is_build_complete function."""

    def test_returns_false_when_no_plan(self, temp_dir):
        """Should return False when no plan exists."""
        from core.progress import is_build_complete

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        assert is_build_complete(spec_dir) is False

    def test_returns_true_when_all_complete(self, temp_dir):
        """Should return True when all subtasks are completed."""
        from core.progress import is_build_complete

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "1", "status": "completed"},
                        {"id": "2", "status": "completed"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        assert is_build_complete(spec_dir) is True

    def test_returns_false_when_not_all_complete(self, temp_dir):
        """Should return False when some subtasks are not completed."""
        from core.progress import is_build_complete

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "1", "status": "completed"},
                        {"id": "2", "status": "pending"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        assert is_build_complete(spec_dir) is False

    def test_returns_false_for_empty_plan(self, temp_dir):
        """Should return False for plan with no subtasks."""
        from core.progress import is_build_complete

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {"phases": []}
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        assert is_build_complete(spec_dir) is False


class TestGetProgressPercentage:
    """Tests for get_progress_percentage function."""

    def test_returns_zero_when_no_plan(self, temp_dir):
        """Should return 0.0 when no plan exists."""
        from core.progress import get_progress_percentage

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        assert get_progress_percentage(spec_dir) == 0.0

    def test_returns_correct_percentage(self, temp_dir):
        """Should calculate percentage correctly."""
        from core.progress import get_progress_percentage

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "1", "status": "completed"},
                        {"id": "2", "status": "completed"},
                        {"id": "3", "status": "pending"},
                        {"id": "4", "status": "pending"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        assert get_progress_percentage(spec_dir) == 50.0

    def test_returns_100_when_complete(self, temp_dir):
        """Should return 100.0 when all complete."""
        from core.progress import get_progress_percentage

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "1", "status": "completed"},
                        {"id": "2", "status": "completed"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        assert get_progress_percentage(spec_dir) == 100.0


class TestGetNextSubtask:
    """Tests for get_next_subtask function."""

    def test_returns_none_when_no_plan(self, temp_dir):
        """Should return None when no plan exists."""
        from core.progress import get_next_subtask

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        assert get_next_subtask(spec_dir) is None

    def test_returns_first_pending_subtask(self, temp_dir):
        """Should return first pending subtask."""
        from core.progress import get_next_subtask

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "1", "status": "completed", "description": "Done"},
                        {"id": "2", "status": "pending", "description": "Next task"},
                        {"id": "3", "status": "pending", "description": "Later"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = get_next_subtask(spec_dir)

        assert result is not None
        assert result["id"] == "2"
        assert result["description"] == "Next task"

    def test_returns_next_workable_subtask(self, temp_dir):
        """Should return a non-completed subtask."""
        from core.progress import get_next_subtask

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "1", "status": "completed", "description": "Done"},
                        {"id": "2", "status": "in_progress", "description": "Currently working"},
                        {"id": "3", "status": "pending", "description": "Pending task"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = get_next_subtask(spec_dir)

        assert result is not None
        # Should return either in_progress or pending subtask (implementation may vary)
        assert result["status"] in ("in_progress", "pending")
        assert result["id"] in ("2", "3")

    def test_returns_none_when_all_complete(self, temp_dir):
        """Should return None when all subtasks are completed."""
        from core.progress import get_next_subtask

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "1", "status": "completed"},
                        {"id": "2", "status": "completed"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        assert get_next_subtask(spec_dir) is None

    def test_includes_phase_info_in_result(self, temp_dir):
        """Should include phase information in the returned subtask."""
        from core.progress import get_next_subtask

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "name": "Backend Setup",
                    "subtasks": [
                        {"id": "1", "status": "pending", "description": "Task 1"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = get_next_subtask(spec_dir)

        assert result is not None
        assert result.get("phase_name") == "Backend Setup"


class TestGetCurrentPhase:
    """Tests for get_current_phase function."""

    def test_returns_none_when_no_plan(self, temp_dir):
        """Should return None when no plan exists."""
        from core.progress import get_current_phase

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        assert get_current_phase(spec_dir) is None

    def test_returns_phase_with_in_progress_subtask(self, temp_dir):
        """Should return phase containing in_progress subtask."""
        from core.progress import get_current_phase

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [{"id": "1", "status": "completed"}],
                },
                {
                    "phase": 2,
                    "name": "Phase 2",
                    "subtasks": [{"id": "2", "status": "in_progress"}],
                },
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = get_current_phase(spec_dir)

        assert result is not None
        assert result["name"] == "Phase 2"


class TestGetPlanSummary:
    """Tests for get_plan_summary function."""

    def test_returns_empty_summary_when_no_plan(self, temp_dir):
        """Should return empty summary when no plan exists."""
        from core.progress import get_plan_summary

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        result = get_plan_summary(spec_dir)

        assert result["total_phases"] == 0
        assert result["total_subtasks"] == 0

    def test_returns_comprehensive_summary(self, temp_dir):
        """Should return comprehensive plan summary."""
        from core.progress import get_plan_summary

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        plan = {
            "workflow_type": "feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Backend",
                    "subtasks": [
                        {"id": "1", "status": "completed"},
                        {"id": "2", "status": "completed"},
                    ],
                },
                {
                    "phase": 2,
                    "name": "Frontend",
                    "subtasks": [
                        {"id": "3", "status": "in_progress"},
                        {"id": "4", "status": "pending"},
                    ],
                },
            ],
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = get_plan_summary(spec_dir)

        assert result["workflow_type"] == "feature"
        assert result["total_phases"] == 2
        assert result["total_subtasks"] == 4
        assert result["completed_subtasks"] == 2
        assert result["pending_subtasks"] == 1
        assert result["in_progress_subtasks"] == 1


class TestFormatDuration:
    """Tests for format_duration function."""

    def test_formats_seconds(self):
        """Should format seconds correctly."""
        from core.progress import format_duration

        result = format_duration(30)
        assert "30" in result or "0.5" in result  # Could be 30s or 0.5m

    def test_formats_minutes(self):
        """Should format minutes correctly."""
        from core.progress import format_duration

        result = format_duration(90)
        # Accepts either "1m 30s" or "1.5m" format
        assert "1" in result and ("m" in result or "min" in result.lower())

    def test_formats_hours(self):
        """Should format hours correctly."""
        from core.progress import format_duration

        result = format_duration(3600)
        # Accepts either "1h 0m" or "1.0h" format
        assert "1" in result and "h" in result

    def test_handles_zero(self):
        """Should handle zero duration."""
        from core.progress import format_duration

        result = format_duration(0)
        assert "0" in result


class TestPrintFunctions:
    """Tests for print functions to ensure they don't raise errors."""

    def test_print_session_header_basic(self, temp_dir, capsys):
        """Should print session header without errors."""
        from core.progress import print_session_header

        print_session_header(
            session_num=1,
            is_planner=True,
        )

        captured = capsys.readouterr()
        assert "SESSION 1" in captured.out
        assert "PLANNER" in captured.out

    def test_print_session_header_with_subtask(self, temp_dir, capsys):
        """Should print session header with subtask info."""
        from core.progress import print_session_header

        print_session_header(
            session_num=2,
            is_planner=False,
            subtask_id="chunk-1-1",
            subtask_desc="Add user authentication",
            phase_name="Backend Setup",
            attempt=2,
        )

        captured = capsys.readouterr()
        assert "SESSION 2" in captured.out
        assert "chunk-1-1" in captured.out

    def test_print_progress_summary_no_plan(self, temp_dir, capsys):
        """Should print message when no plan exists."""
        from core.progress import print_progress_summary

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        print_progress_summary(spec_dir)

        captured = capsys.readouterr()
        assert "planner needs to run" in captured.out.lower() or "No implementation" in captured.out

    def test_print_build_complete_banner(self, temp_dir, capsys):
        """Should print completion banner without errors."""
        from core.progress import print_build_complete_banner

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        print_build_complete_banner(spec_dir)

        captured = capsys.readouterr()
        assert "BUILD COMPLETE" in captured.out

    def test_print_paused_banner(self, temp_dir, capsys):
        """Should print paused banner without errors."""
        from core.progress import print_paused_banner

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        # Create a plan so we have progress to display
        plan = {
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "1", "status": "completed"},
                        {"id": "2", "status": "pending"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        print_paused_banner(spec_dir, "test-spec", has_worktree=True)

        captured = capsys.readouterr()
        assert "PAUSED" in captured.out
        assert "1/2" in captured.out
