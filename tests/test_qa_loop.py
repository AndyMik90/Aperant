#!/usr/bin/env python3
"""
Tests for QA Validation Loop
============================

Tests the qa_loop.py module functionality including:
- QA signoff status management
- Build completion checks
- QA/Fixer session logic
- Loop control flow
"""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Store original modules for cleanup
_original_modules = {}
_mocked_module_names = [
    'claude_code_sdk',
    'claude_code_sdk.types',
    'claude_agent_sdk',
    'claude_agent_sdk.types',
]

for name in _mocked_module_names:
    if name in sys.modules:
        _original_modules[name] = sys.modules[name]

# Mock claude_code_sdk and claude_agent_sdk before importing qa_loop
# The SDKs aren't available in the test environment
mock_code_sdk = MagicMock()
mock_code_sdk.ClaudeSDKClient = MagicMock()
mock_code_sdk.ClaudeCodeOptions = MagicMock()
mock_code_types = MagicMock()
mock_code_types.HookMatcher = MagicMock()
sys.modules['claude_code_sdk'] = mock_code_sdk
sys.modules['claude_code_sdk.types'] = mock_code_types

mock_agent_sdk = MagicMock()
mock_agent_sdk.ClaudeSDKClient = MagicMock()
mock_agent_sdk.ClaudeCodeOptions = MagicMock()
mock_agent_types = MagicMock()
mock_agent_types.HookMatcher = MagicMock()
sys.modules['claude_agent_sdk'] = mock_agent_sdk
sys.modules['claude_agent_sdk.types'] = mock_agent_types

from qa_loop import (
    MAX_QA_ITERATIONS,
    get_qa_iteration_count,
    get_qa_signoff_status,
    is_fixes_applied,
    is_qa_approved,
    is_qa_rejected,
    load_implementation_plan,
    save_implementation_plan,
    should_run_fixes,
    should_run_qa,
)


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

    def test_save_implementation_plan(self, spec_dir: Path):
        """Saves implementation plan to JSON."""
        plan = {"feature": "Test", "phases": []}

        result = save_implementation_plan(spec_dir, plan)

        assert result is True
        assert (spec_dir / "implementation_plan.json").exists()

        loaded = json.loads((spec_dir / "implementation_plan.json").read_text())
        assert loaded["feature"] == "Test"


class TestQASignoffStatus:
    """Tests for QA signoff status management."""

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

    def test_is_qa_approved_true(self, spec_dir: Path, qa_signoff_approved: dict):
        """is_qa_approved returns True when approved."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_approved}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is True

    def test_is_qa_approved_false(self, spec_dir: Path, qa_signoff_rejected: dict):
        """is_qa_approved returns False when rejected."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_rejected}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is False

    def test_is_qa_approved_no_signoff(self, spec_dir: Path):
        """is_qa_approved returns False when no signoff."""
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is False

    def test_is_qa_rejected_true(self, spec_dir: Path, qa_signoff_rejected: dict):
        """is_qa_rejected returns True when rejected."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_rejected}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_rejected(spec_dir) is True

    def test_is_qa_rejected_false(self, spec_dir: Path, qa_signoff_approved: dict):
        """is_qa_rejected returns False when approved."""
        plan = {"feature": "Test", "qa_signoff": qa_signoff_approved}
        save_implementation_plan(spec_dir, plan)

        assert is_qa_rejected(spec_dir) is False

    def test_is_fixes_applied(self, spec_dir: Path):
        """is_fixes_applied checks status and ready_for_qa_revalidation."""
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
        """is_fixes_applied returns False when not ready."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "fixes_applied",
                "ready_for_qa_revalidation": False,
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is False

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


class TestShouldRunQA:
    """Tests for should_run_qa logic."""

    @pytest.mark.xfail(
        reason="Test isolation issue: progress module mocked by test_qa_criteria.py persists due to Python import caching. Passes when run individually.",
        strict=False,
    )
    def test_should_run_qa_build_not_complete(self, spec_dir: Path):
        """Returns False when build not complete."""
        # Create plan with incomplete subtasks
        plan = {
            "feature": "Test",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "subtasks": [
                        {"id": "c1", "description": "Test", "status": "pending"},
                    ],
                },
            ],
        }
        save_implementation_plan(spec_dir, plan)

        result = should_run_qa(spec_dir)
        assert result is False

    def test_should_run_qa_already_approved(self, spec_dir: Path, qa_signoff_approved: dict):
        """Returns False when already approved."""
        plan = {
            "feature": "Test",
            "qa_signoff": qa_signoff_approved,
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "subtasks": [
                        {"id": "c1", "description": "Test", "status": "completed"},
                    ],
                },
            ],
        }
        save_implementation_plan(spec_dir, plan)

        result = should_run_qa(spec_dir)
        assert result is False

    def test_should_run_qa_build_complete_not_approved(self, spec_dir: Path):
        """Returns True when build complete but not approved."""
        plan = {
            "feature": "Test",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "subtasks": [
                        {"id": "c1", "description": "Test", "status": "completed"},
                    ],
                },
            ],
        }
        save_implementation_plan(spec_dir, plan)

        result = should_run_qa(spec_dir)
        assert result is True


class TestShouldRunFixes:
    """Tests for should_run_fixes logic."""

    def test_should_run_fixes_when_rejected(self, spec_dir: Path, qa_signoff_rejected: dict):
        """Returns True when QA rejected and under max iterations."""
        plan = {
            "feature": "Test",
            "qa_signoff": qa_signoff_rejected,
        }
        save_implementation_plan(spec_dir, plan)

        result = should_run_fixes(spec_dir)
        assert result is True

    def test_should_run_fixes_max_iterations(self, spec_dir: Path):
        """Returns False when max iterations reached."""
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": MAX_QA_ITERATIONS,
            },
        }
        save_implementation_plan(spec_dir, plan)

        result = should_run_fixes(spec_dir)
        assert result is False

    def test_should_run_fixes_not_rejected(self, spec_dir: Path, qa_signoff_approved: dict):
        """Returns False when not rejected."""
        plan = {
            "feature": "Test",
            "qa_signoff": qa_signoff_approved,
        }
        save_implementation_plan(spec_dir, plan)

        result = should_run_fixes(spec_dir)
        assert result is False


class TestQASignoffStructures:
    """Tests for QA signoff data structures."""

    def test_approved_signoff_structure(self, qa_signoff_approved: dict):
        """Approved signoff has correct structure."""
        assert qa_signoff_approved["status"] == "approved"
        assert "qa_session" in qa_signoff_approved
        assert "timestamp" in qa_signoff_approved
        assert "tests_passed" in qa_signoff_approved

    def test_rejected_signoff_structure(self, qa_signoff_rejected: dict):
        """Rejected signoff has correct structure."""
        assert qa_signoff_rejected["status"] == "rejected"
        assert "issues_found" in qa_signoff_rejected
        assert len(qa_signoff_rejected["issues_found"]) > 0

    def test_issues_have_title_and_type(self, qa_signoff_rejected: dict):
        """Issues have title and type fields."""
        for issue in qa_signoff_rejected["issues_found"]:
            assert "title" in issue
            assert "type" in issue


class TestMaxIterationsConstant:
    """Tests for MAX_QA_ITERATIONS configuration."""

    def test_max_iterations_is_positive(self):
        """MAX_QA_ITERATIONS is a positive integer."""
        assert MAX_QA_ITERATIONS > 0
        assert isinstance(MAX_QA_ITERATIONS, int)

    def test_max_iterations_reasonable(self):
        """MAX_QA_ITERATIONS is a reasonable value."""
        # Should be high enough to fix real issues but not infinite
        assert 5 <= MAX_QA_ITERATIONS <= 100


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

        # Transition to fixes_applied
        plan["qa_signoff"] = {
            "status": "fixes_applied",
            "ready_for_qa_revalidation": True,
            "qa_session": 1,
        }
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is True

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
    """Integration tests for QA loop logic."""

    def test_full_qa_workflow_approved_first_try(self, spec_dir: Path):
        """Full workflow where QA approves on first try."""
        # Build complete
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Implementation",
                    "subtasks": [
                        {"id": "c1", "description": "Test", "status": "completed"},
                    ],
                },
            ],
        }
        save_implementation_plan(spec_dir, plan)

        # Should run QA
        assert should_run_qa(spec_dir) is True

        # QA approves
        plan["qa_signoff"] = {
            "status": "approved",
            "qa_session": 1,
            "tests_passed": {"unit": True, "integration": True, "e2e": True},
        }
        save_implementation_plan(spec_dir, plan)

        # Should not run QA again or fixes
        assert should_run_qa(spec_dir) is False
        assert should_run_fixes(spec_dir) is False
        assert is_qa_approved(spec_dir) is True

    def test_full_qa_workflow_with_fixes(self, spec_dir: Path):
        """Full workflow with reject-fix-approve cycle."""
        # Build complete
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Implementation",
                    "subtasks": [
                        {"id": "c1", "description": "Test", "status": "completed"},
                    ],
                },
            ],
        }
        save_implementation_plan(spec_dir, plan)

        # QA rejects
        plan["qa_signoff"] = {
            "status": "rejected",
            "qa_session": 1,
            "issues_found": [{"title": "Missing test", "type": "unit_test"}],
        }
        save_implementation_plan(spec_dir, plan)

        assert should_run_fixes(spec_dir) is True

        # Fixes applied
        plan["qa_signoff"]["status"] = "fixes_applied"
        plan["qa_signoff"]["ready_for_qa_revalidation"] = True
        save_implementation_plan(spec_dir, plan)

        # QA approves on second attempt
        plan["qa_signoff"] = {
            "status": "approved",
            "qa_session": 2,
            "tests_passed": {"unit": True, "integration": True, "e2e": True},
        }
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is True
        assert get_qa_iteration_count(spec_dir) == 2
