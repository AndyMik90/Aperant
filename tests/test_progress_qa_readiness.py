#!/usr/bin/env python3
"""
Tests for Progress Module - QA Readiness Check
===============================================

Tests the core/progress.py is_build_ready_for_qa() function which determines
if a build has reached a terminal state (all subtasks completed, failed, or stuck).

This function differs from is_build_complete() in that it considers builds with
failed/stuck subtasks as ready for QA validation.
"""

import json
import sys
from pathlib import Path

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from core.progress import is_build_ready_for_qa


@pytest.fixture
def spec_dir(tmp_path):
    """Create a spec directory for testing."""
    spec = tmp_path / "spec"
    spec.mkdir()
    return spec


@pytest.fixture
def memory_dir(spec_dir):
    """Create a memory directory for attempt_history.json."""
    memory = spec_dir / "memory"
    memory.mkdir()
    return memory


class TestIsBuildReadyForQA:
    """Tests for is_build_ready_for_qa function."""

    def test_all_subtasks_completed(self, spec_dir: Path):
        """Returns True when all subtasks are completed."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "completed"},
                        {"id": "subtask-1-2", "status": "completed"},
                    ],
                },
                {
                    "phase": 2,
                    "name": "Phase 2",
                    "subtasks": [
                        {"id": "subtask-2-1", "status": "completed"},
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        result = is_build_ready_for_qa(spec_dir)
        assert result is True

    def test_mix_completed_and_pending(self, spec_dir: Path):
        """Returns False when some subtasks are still pending."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "completed"},
                        {"id": "subtask-1-2", "status": "pending"},
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        result = is_build_ready_for_qa(spec_dir)
        assert result is False

    def test_mix_completed_and_failed(self, spec_dir: Path):
        """Returns True when all subtasks are terminal (completed + failed)."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "completed"},
                        {"id": "subtask-1-2", "status": "failed"},
                    ],
                },
                {
                    "phase": 2,
                    "name": "Phase 2",
                    "subtasks": [
                        {"id": "subtask-2-1", "status": "completed"},
                        {"id": "subtask-2-2", "status": "failed"},
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        result = is_build_ready_for_qa(spec_dir)
        assert result is True

    def test_subtask_stuck_in_attempt_history(self, spec_dir: Path, memory_dir: Path):
        """Returns True when subtask is marked stuck in attempt_history even if plan shows pending."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "completed"},
                        {"id": "subtask-1-2", "status": "pending"},  # Stuck but plan not updated
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        # Create attempt_history with stuck subtask
        attempt_history = {
            "stuck_subtasks": [
                {
                    "subtask_id": "subtask-1-2",
                    "reason": "Circular fix after 3 attempts",
                    "escalated_at": "2024-01-01T12:00:00Z",
                    "attempt_count": 3,
                }
            ],
            "subtasks": {},
        }
        history_file = memory_dir / "attempt_history.json"
        history_file.write_text(json.dumps(attempt_history))

        result = is_build_ready_for_qa(spec_dir)
        assert result is True

    def test_no_plan_file(self, spec_dir: Path):
        """Returns False when implementation_plan.json doesn't exist."""
        result = is_build_ready_for_qa(spec_dir)
        assert result is False

    def test_empty_phases(self, spec_dir: Path):
        """Returns False when plan has no subtasks (total=0)."""
        plan = {
            "feature": "Test Feature",
            "phases": [],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        result = is_build_ready_for_qa(spec_dir)
        assert result is False

    def test_phases_with_no_subtasks(self, spec_dir: Path):
        """Returns False when phases exist but contain no subtasks."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        result = is_build_ready_for_qa(spec_dir)
        assert result is False

    def test_no_attempt_history_file(self, spec_dir: Path):
        """Returns True based on plan file alone when attempt_history.json doesn't exist."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "completed"},
                        {"id": "subtask-1-2", "status": "failed"},
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        # No attempt_history.json created
        result = is_build_ready_for_qa(spec_dir)
        assert result is True

    def test_invalid_json_in_attempt_history(self, spec_dir: Path, memory_dir: Path):
        """Gracefully handles invalid JSON in attempt_history and falls back to plan-only check."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "completed"},
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        # Create invalid JSON in attempt_history
        history_file = memory_dir / "attempt_history.json"
        history_file.write_text("{ invalid json }")

        # Should fallback to plan-only check and return True
        result = is_build_ready_for_qa(spec_dir)
        assert result is True

    def test_invalid_json_in_plan(self, spec_dir: Path):
        """Returns False when implementation_plan.json contains invalid JSON."""
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text("{ invalid json }")

        result = is_build_ready_for_qa(spec_dir)
        assert result is False

    def test_empty_plan_file(self, spec_dir: Path):
        """Returns False when implementation_plan.json is empty."""
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text("")

        result = is_build_ready_for_qa(spec_dir)
        assert result is False

    def test_multiple_stuck_subtasks(self, spec_dir: Path, memory_dir: Path):
        """Returns True when multiple subtasks are stuck in attempt_history."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "pending"},
                        {"id": "subtask-1-2", "status": "pending"},
                        {"id": "subtask-1-3", "status": "completed"},
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        # Mark two subtasks as stuck
        attempt_history = {
            "stuck_subtasks": [
                {"subtask_id": "subtask-1-1", "reason": "Error 1"},
                {"subtask_id": "subtask-1-2", "reason": "Error 2"},
            ],
            "subtasks": {},
        }
        history_file = memory_dir / "attempt_history.json"
        history_file.write_text(json.dumps(attempt_history))

        result = is_build_ready_for_qa(spec_dir)
        assert result is True

    def test_mix_of_all_terminal_states(self, spec_dir: Path, memory_dir: Path):
        """Returns True with completed, failed, and stuck subtasks."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "completed"},
                        {"id": "subtask-1-2", "status": "failed"},
                        {"id": "subtask-1-3", "status": "pending"},  # Will be stuck
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        attempt_history = {
            "stuck_subtasks": [
                {"subtask_id": "subtask-1-3", "reason": "Stuck"},
            ],
            "subtasks": {},
        }
        history_file = memory_dir / "attempt_history.json"
        history_file.write_text(json.dumps(attempt_history))

        result = is_build_ready_for_qa(spec_dir)
        assert result is True

    def test_in_progress_status(self, spec_dir: Path):
        """Returns False when subtasks are in_progress."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "completed"},
                        {"id": "subtask-1-2", "status": "in_progress"},
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        result = is_build_ready_for_qa(spec_dir)
        assert result is False

    def test_missing_status_field(self, spec_dir: Path):
        """Returns False when subtask has no status field (defaults to pending)."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "completed"},
                        {"id": "subtask-1-2"},  # No status field
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        result = is_build_ready_for_qa(spec_dir)
        assert result is False

    def test_stuck_subtask_without_id_field(self, spec_dir: Path, memory_dir: Path):
        """Ignores stuck subtasks without subtask_id field in attempt_history."""
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "pending"},
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan))

        # Malformed stuck subtask entry without subtask_id
        attempt_history = {
            "stuck_subtasks": [
                {"reason": "Error", "escalated_at": "2024-01-01T12:00:00Z"}
            ],
            "subtasks": {},
        }
        history_file = memory_dir / "attempt_history.json"
        history_file.write_text(json.dumps(attempt_history))

        # Should return False since subtask-1-1 is still pending
        result = is_build_ready_for_qa(spec_dir)
        assert result is False

    def test_unicode_encoding_in_files(self, spec_dir: Path, memory_dir: Path):
        """Handles UTF-8 encoded content correctly."""
        plan = {
            "feature": "Test Feature 测试功能",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "subtask-1-1", "status": "completed", "notes": "完成"},
                    ],
                },
            ],
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")

        attempt_history = {
            "stuck_subtasks": [],
            "subtasks": {},
        }
        history_file = memory_dir / "attempt_history.json"
        history_file.write_text(json.dumps(attempt_history, ensure_ascii=False), encoding="utf-8")

        result = is_build_ready_for_qa(spec_dir)
        assert result is True
