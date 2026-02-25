#!/usr/bin/env python3
"""
Tests for CLI QA Commands
==========================

Tests for qa_commands.py module functionality including:
- handle_qa_status_command() - Display QA status for a spec
- handle_review_status_command() - Display review status for a spec
- handle_qa_command() - Run QA validation loop
"""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from cli.qa_commands import (
    handle_qa_command,
    handle_qa_status_command,
    handle_review_status_command,
)
from review import ReviewState


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def spec_dir_with_qa_report(temp_dir: Path) -> Path:
    """Create a spec directory with QA report."""
    spec_dir = temp_dir / "001-test-spec"
    spec_dir.mkdir()

    qa_report = spec_dir / "qa_report.md"
    qa_report.write_text(
        "# QA Report\n\n"
        "## Status: Approved\n\n"
        "All tests passed.\n"
    )

    return spec_dir


@pytest.fixture
def spec_dir_with_fix_request(temp_dir: Path) -> Path:
    """Create a spec directory with QA fix request."""
    spec_dir = temp_dir / "001-test-spec"
    spec_dir.mkdir()

    fix_request = spec_dir / "QA_FIX_REQUEST.md"
    fix_request.write_text(
        "# QA Fix Request\n\n"
        "## Issues Found\n\n"
        "1. Unit tests failing\n"
        "2. Missing error handling\n"
    )

    return spec_dir


@pytest.fixture
def spec_dir_with_implementation_plan(temp_dir: Path) -> Path:
    """Create a spec directory with implementation plan (incomplete)."""
    spec_dir = temp_dir / "001-test-spec"
    spec_dir.mkdir()

    plan = {
        "phases": [
            {
                "phase": 1,
                "name": "Phase 1",
                "subtasks": [
                    {"id": "1-1", "status": "completed"},
                    {"id": "1-2", "status": "pending"},
                ]
            }
        ]
    }
    plan_file = spec_dir / "implementation_plan.json"
    plan_file.write_text(json.dumps(plan))

    return spec_dir


@pytest.fixture
def spec_dir_complete(temp_dir: Path) -> Path:
    """Create a spec directory with complete implementation."""
    spec_dir = temp_dir / "001-test-spec"
    spec_dir.mkdir()

    plan = {
        "phases": [
            {
                "phase": 1,
                "name": "Phase 1",
                "subtasks": [
                    {"id": "1-1", "status": "completed"},
                    {"id": "1-2", "status": "completed"},
                ]
            }
        ]
    }
    plan_file = spec_dir / "implementation_plan.json"
    plan_file.write_text(json.dumps(plan))

    return spec_dir


@pytest.fixture
def spec_dir_with_review_state(temp_dir: Path) -> Path:
    """Create a spec directory with review state."""
    spec_dir = temp_dir / "001-test-spec"
    spec_dir.mkdir()

    # Create spec.md first so the hash can match
    (spec_dir / "spec.md").write_text("# Test Spec\n")

    review_state = ReviewState(
        approved=True,
        approved_by="test_user",
        approved_at="2024-01-15T10:30:00",
        feedback=["Looks good!"],
        spec_hash="",  # Empty hash will be calculated and should match
        review_count=1,
    )
    review_state.save(spec_dir)

    return spec_dir


@pytest.fixture
def spec_dir_with_review_state_changed(temp_dir: Path) -> Path:
    """Create a spec with approved review but changed spec."""
    spec_dir = temp_dir / "001-test-spec"
    spec_dir.mkdir()

    # Save review state
    review_state = ReviewState(
        approved=True,
        approved_by="test_user",
        spec_hash="old_hash",
    )
    review_state.save(spec_dir)

    # Create spec.md (will have different hash)
    (spec_dir / "spec.md").write_text("# Updated Spec\n")

    return spec_dir


# =============================================================================
# HANDLE_QA_STATUS_COMMAND TESTS
# =============================================================================

class TestHandleQaStatusCommand:
    """Tests for handle_qa_status_command() function."""

    def test_prints_qa_status(self, capsys, spec_dir_with_qa_report: Path) -> None:
        """Prints QA status for the spec."""
        handle_qa_status_command(spec_dir_with_qa_report)

        captured = capsys.readouterr()
        assert "001-test-spec" in captured.out
        # Check that some QA status output is present
        assert len(captured.out) > 0

    def test_prints_banner(self, capsys, spec_dir_with_qa_report: Path) -> None:
        """Prints banner before status."""
        handle_qa_status_command(spec_dir_with_qa_report)

        captured = capsys.readouterr()
        # Banner should be printed (check for some visual separator)
        assert "001-test-spec" in captured.out

    def test_handles_missing_qa_report(self, capsys, temp_dir: Path) -> None:
        """Handles spec directory without QA report gracefully."""
        spec_dir = temp_dir / "001-no-qa"
        spec_dir.mkdir()

        handle_qa_status_command(spec_dir)

        captured = capsys.readouterr()
        # Should print something even without QA report
        assert len(captured.out) > 0


# =============================================================================
# HANDLE_REVIEW_STATUS_COMMAND TESTS
# =============================================================================

class TestHandleReviewStatusCommand:
    """Tests for handle_review_status_command() function."""

    def test_prints_review_status(self, capsys, spec_dir_with_review_state: Path) -> None:
        """Prints review status for the spec."""
        handle_review_status_command(spec_dir_with_review_state)

        captured = capsys.readouterr()
        assert "001-test-spec" in captured.out

    def test_shows_ready_to_build_when_approval_valid(
        self, capsys, spec_dir_with_review_state: Path
    ) -> None:
        """Shows 'Ready to build' message when approval is valid."""
        handle_review_status_command(spec_dir_with_review_state)

        captured = capsys.readouterr()
        assert "Ready to build" in captured.out
        assert "approval is valid" in captured.out

    def test_shows_re_review_required_when_spec_changed(
        self, capsys, spec_dir_with_review_state_changed: Path
    ) -> None:
        """Shows 're-review required' message when spec changed after approval."""
        handle_review_status_command(spec_dir_with_review_state_changed)

        captured = capsys.readouterr()
        assert "re-review required" in captured.out
        assert "Spec changed" in captured.out

    def test_shows_review_required_when_not_approved(
        self, capsys, temp_dir: Path
    ) -> None:
        """Shows 'review required' message when spec is not approved."""
        spec_dir = temp_dir / "001-not-approved"
        spec_dir.mkdir()
        (spec_dir / "spec.md").write_text("# Not Approved\n")

        handle_review_status_command(spec_dir)

        captured = capsys.readouterr()
        assert "Review required" in captured.out

    def test_prints_banner(self, capsys, spec_dir_with_review_state: Path) -> None:
        """Prints banner before review status."""
        handle_review_status_command(spec_dir_with_review_state)

        captured = capsys.readouterr()
        assert "001-test-spec" in captured.out


# =============================================================================
# HANDLE_QA_COMMAND TESTS
# =============================================================================

class TestHandleQaCommand:
    """Tests for handle_qa_command() function."""

    def test_already_approved_message(
        self, capsys, spec_dir_complete: Path, temp_git_repo: Path
    ) -> None:
        """Shows already approved message when QA already passed."""
        # Create qa_report.md
        (spec_dir_complete / "qa_report.md").write_text("# QA Approved\n")

        # Mock both validate_environment and should_run_qa/is_qa_approved
        with patch('cli.qa_commands.validate_environment', return_value=True):
            with patch('cli.qa_commands.should_run_qa', return_value=False):
                with patch('cli.qa_commands.is_qa_approved', return_value=True):
                    handle_qa_command(
                        project_dir=temp_git_repo,
                        spec_dir=spec_dir_complete,
                        model="test-model",
                        verbose=False,
                    )

        captured = capsys.readouterr()
        # Should print the "already approved" message
        assert "already approved" in captured.out

    def test_incomplete_build_message(
        self, capsys, spec_dir_with_implementation_plan: Path, temp_git_repo: Path
    ) -> None:
        """Shows incomplete build message when subtasks not complete."""
        with patch('cli.qa_commands.validate_environment', return_value=True):
            handle_qa_command(
                project_dir=temp_git_repo,
                spec_dir=spec_dir_with_implementation_plan,
                model="test-model",
                verbose=False,
            )

        captured = capsys.readouterr()
        assert "Build not ready for QA" in captured.out
        assert "1/2" in captured.out

    def test_processes_human_feedback(
        self, capsys, spec_dir_with_fix_request: Path, temp_git_repo: Path
    ) -> None:
        """Processes fix request when human feedback present."""
        # Add implementation plan so should_run_qa would normally return True
        plan = {
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "1-1", "status": "completed"},
                        {"id": "1-2", "status": "completed"},
                    ]
                }
            ]
        }
        (spec_dir_with_fix_request / "implementation_plan.json").write_text(json.dumps(plan))

        with patch('cli.qa_commands.validate_environment', return_value=True):
            with patch('cli.qa_commands.run_qa_validation_loop') as mock_loop:
                mock_loop.return_value = True

                handle_qa_command(
                    project_dir=temp_git_repo,
                    spec_dir=spec_dir_with_fix_request,
                    model="test-model",
                    verbose=False,
                )

        captured = capsys.readouterr()
        assert "Human feedback detected" in captured.out
        assert "processing fix request" in captured.out

    def test_runs_qa_validation_loop(
        self, spec_dir_complete: Path, temp_git_repo: Path
    ) -> None:
        """Runs QA validation loop when conditions are met."""
        with patch('cli.qa_commands.validate_environment', return_value=True):
            with patch('cli.qa_commands.run_qa_validation_loop') as mock_loop:
                mock_loop.return_value = True

                handle_qa_command(
                    project_dir=temp_git_repo,
                    spec_dir=spec_dir_complete,
                    model="test-model",
                    verbose=True,
                )

                # Should run the validation loop
                assert mock_loop.called
                call_args = mock_loop.call_args
                assert call_args[1]["project_dir"] == temp_git_repo
                assert call_args[1]["spec_dir"] == spec_dir_complete
                assert call_args[1]["model"] == "test-model"
                assert call_args[1]["verbose"] is True

    def test_qa_approved_message(
        self, capsys, spec_dir_complete: Path, temp_git_repo: Path
    ) -> None:
        """Shows QA approved message when validation passes."""
        with patch('cli.qa_commands.validate_environment', return_value=True):
            with patch('cli.qa_commands.run_qa_validation_loop') as mock_loop:
                mock_loop.return_value = True

                handle_qa_command(
                    project_dir=temp_git_repo,
                    spec_dir=spec_dir_complete,
                    model="test-model",
                    verbose=False,
                )

        captured = capsys.readouterr()
        assert "QA validation passed" in captured.out
        assert "Ready for merge" in captured.out

    def test_qa_incomplete_message(
        self, capsys, spec_dir_complete: Path, temp_git_repo: Path
    ) -> None:
        """Shows incomplete message and exits when validation fails."""
        with patch('cli.qa_commands.validate_environment', return_value=True):
            with patch('cli.qa_commands.run_qa_validation_loop') as mock_loop:
                mock_loop.return_value = False

                with pytest.raises(SystemExit) as exc_info:
                    handle_qa_command(
                        project_dir=temp_git_repo,
                        spec_dir=spec_dir_complete,
                        model="test-model",
                        verbose=False,
                    )

        assert exc_info.value.code == 1

    def test_exits_on_invalid_environment(
        self, spec_dir_complete: Path, temp_git_repo: Path
    ) -> None:
        """Exits when environment validation fails."""
        with patch('cli.qa_commands.validate_environment', return_value=False):
            with pytest.raises(SystemExit) as exc_info:
                handle_qa_command(
                    project_dir=temp_git_repo,
                    spec_dir=spec_dir_complete,
                    model="test-model",
                    verbose=False,
                )

        assert exc_info.value.code == 1

    def test_handles_keyboard_interrupt(
        self, capsys, spec_dir_complete: Path, temp_git_repo: Path
    ) -> None:
        """Handles KeyboardInterrupt gracefully during QA loop."""
        with patch('cli.qa_commands.validate_environment', return_value=True):
            with patch('cli.qa_commands.run_qa_validation_loop') as mock_loop:
                mock_loop.side_effect = KeyboardInterrupt()

                handle_qa_command(
                    project_dir=temp_git_repo,
                    spec_dir=spec_dir_complete,
                    model="test-model",
                    verbose=False,
                )

        captured = capsys.readouterr()
        assert "QA validation paused" in captured.out
        assert "--qa" in captured.out

    def test_prints_banner(
        self, capsys, spec_dir_complete: Path, temp_git_repo: Path
    ) -> None:
        """Prints banner before running QA."""
        with patch('cli.qa_commands.validate_environment', return_value=True):
            with patch('cli.qa_commands.run_qa_validation_loop'):
                handle_qa_command(
                    project_dir=temp_git_repo,
                    spec_dir=spec_dir_complete,
                    model="test-model",
                    verbose=False,
                )

        captured = capsys.readouterr()
        # Should show banner
        assert "QA validation" in captured.out


# =============================================================================
# INTEGRATION TESTS
# =============================================================================

class TestQaCommandsIntegration:
    """Integration tests for QA commands."""

    def test_qa_status_to_review_status_workflow(
        self, capsys, spec_dir_with_review_state: Path
    ) -> None:
        """Test checking both QA and review status."""
        # Check QA status
        handle_qa_status_command(spec_dir_with_review_state)
        capsys.readouterr()

        # Check review status
        handle_review_status_command(spec_dir_with_review_state)
        captured = capsys.readouterr()

        # Both should print spec name
        assert "001-test-spec" in captured.out

    def test_qa_command_with_complete_workflow(
        self, capsys, spec_dir_complete: Path, temp_git_repo: Path
    ) -> None:
        """Test full QA workflow from start to approval."""
        with patch('cli.qa_commands.validate_environment', return_value=True):
            with patch('cli.qa_commands.run_qa_validation_loop') as mock_loop:
                # Simulate successful QA
                mock_loop.return_value = True

                handle_qa_command(
                    project_dir=temp_git_repo,
                    spec_dir=spec_dir_complete,
                    model="test-model",
                    verbose=False,
                )

        captured = capsys.readouterr()
        assert "QA validation passed" in captured.out

    def test_qa_command_with_fix_request_workflow(
        self, capsys, spec_dir_with_fix_request: Path, temp_git_repo: Path
    ) -> None:
        """Test QA workflow with human feedback."""
        # Mark as complete
        plan = {
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "1-1", "status": "completed"},
                        {"id": "1-2", "status": "completed"},
                    ]
                }
            ]
        }
        (spec_dir_with_fix_request / "implementation_plan.json").write_text(json.dumps(plan))

        with patch('cli.qa_commands.validate_environment', return_value=True):
            with patch('cli.qa_commands.run_qa_validation_loop') as mock_loop:
                mock_loop.return_value = True

                handle_qa_command(
                    project_dir=temp_git_repo,
                    spec_dir=spec_dir_with_fix_request,
                    model="test-model",
                    verbose=False,
                )

        captured = capsys.readouterr()
        assert "Human feedback detected" in captured.out
        assert "QA validation passed" in captured.out

    def test_review_status_scenarios(
        self, capsys, temp_dir: Path
    ) -> None:
        """Test different review status scenarios."""
        # Scenario 1: No review state
        spec_dir = temp_dir / "001-test"
        spec_dir.mkdir()
        (spec_dir / "spec.md").write_text("# Test\n")

        handle_review_status_command(spec_dir)
        captured = capsys.readouterr()
        assert "Review required" in captured.out

        # Scenario 2: Approved and valid
        review_state = ReviewState(approved=True, spec_hash="")
        review_state.save(spec_dir)

        handle_review_status_command(spec_dir)
        captured = capsys.readouterr()
        # Should show either "Ready to build" or "APPROVED" status
        assert "APPROVED" in captured.out or "Ready to build" in captured.out


# =============================================================================
# MODULE IMPORT PATH INSERTION TESTS
# =============================================================================

class TestModuleImportPathInsertion:
    """Tests for module-level path manipulation logic (line 15)."""

    def test_inserts_parent_dir_to_sys_path_when_not_present(self):
        """
        Test that line 15 executes: sys.path.insert(0, str(_PARENT_DIR))

        This test covers the scenario where _PARENT_DIR is not in sys.path
        when the module-level code executes.
        """
        import importlib

        # Use import_module to get the actual module object
        qa_commands_module = importlib.import_module("cli.qa_commands")

        # Get the parent dir that should be inserted by line 15
        parent_dir_str = str(qa_commands_module._PARENT_DIR)

        # Verify parent_dir_str is the apps/backend directory
        # Use os.path.normpath for cross-platform path comparison
        import os
        normalized_path = os.path.normpath(parent_dir_str)
        # Check that the normalized path contains apps/backend or apps\backend (Windows)
        assert ("apps" + os.sep + "backend") in normalized_path or "apps/backend" in normalized_path or "apps\\backend" in normalized_path

        # Save current sys.path state to restore later
        original_path = sys.path.copy()

        # Remove the parent dir from sys.path
        for p in sys.path[:]:
            if p == parent_dir_str or p.rstrip("/") == parent_dir_str.rstrip("/"):
                sys.path.remove(p)

        try:
            # Verify parent_dir_str is NOT in sys.path now
            assert parent_dir_str not in sys.path

            # Reload the module - this should execute lines 14-15 since path is not present
            importlib.reload(qa_commands_module)

            # Verify the parent dir was added to sys.path by line 15
            assert parent_dir_str in sys.path, f"Parent dir {parent_dir_str} should be in sys.path"

        finally:
            # Restore sys.path to original state
            sys.path[:] = original_path
