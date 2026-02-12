#!/usr/bin/env python3
"""
Tests for CLI Batch Commands
=============================

Tests for batch_commands.py module functionality including:
- handle_batch_create_command() - Create tasks from batch file
- handle_batch_status_command() - Show status of all specs
- handle_batch_cleanup_command() - Clean up completed specs
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from cli.batch_commands import (
    handle_batch_cleanup_command,
    handle_batch_create_command,
    handle_batch_status_command,
)


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def sample_batch_file(temp_dir: Path) -> Path:
    """Create a sample batch JSON file."""
    batch_data = {
        "tasks": [
            {
                "title": "Add user authentication",
                "description": "Implement OAuth2 login with Google provider",
                "workflow_type": "feature",
                "services": ["backend", "frontend"],
                "priority": 8,
                "complexity": "standard",
                "estimated_hours": 6.0,
                "estimated_days": 0.75,
            },
            {
                "title": "Add payment processing",
                "description": "Integrate Stripe for payments",
                "workflow_type": "feature",
                "services": ["backend", "worker"],
                "priority": 7,
                "complexity": "complex",
                "estimated_hours": 12.0,
                "estimated_days": 1.5,
            },
            {
                "title": "Fix navigation bug",
                "description": "Mobile menu not closing properly",
                "workflow_type": "bugfix",
                "services": ["frontend"],
                "priority": 9,
                "complexity": "simple",
            },
        ]
    }

    batch_file = temp_dir / "batch.json"
    batch_file.write_text(json.dumps(batch_data, indent=2))
    return batch_file


@pytest.fixture
def empty_batch_file(temp_dir: Path) -> Path:
    """Create an empty batch JSON file."""
    batch_data = {"tasks": []}
    batch_file = temp_dir / "empty_batch.json"
    batch_file.write_text(json.dumps(batch_data))
    return batch_file


@pytest.fixture
def invalid_json_file(temp_dir: Path) -> Path:
    """Create a file with invalid JSON."""
    batch_file = temp_dir / "invalid.json"
    batch_file.write_text("{ invalid json }")
    return batch_file


@pytest.fixture
def project_with_specs(temp_git_repo: Path) -> Path:
    """Create a project with existing specs."""
    specs_dir = temp_git_repo / ".auto-claude" / "specs"
    specs_dir.mkdir(parents=True)

    # Spec 001 - with spec.md
    spec_001 = specs_dir / "001-existing-feature"
    spec_001.mkdir()
    (spec_001 / "spec.md").write_text("# Existing Feature\n")
    (spec_001 / "requirements.json").write_text('{"task_description": "Existing"}')

    # Spec 002 - with implementation plan
    spec_002 = specs_dir / "002-in-progress"
    spec_002.mkdir()
    (spec_002 / "spec.md").write_text("# In Progress\n")
    (spec_002 / "implementation_plan.json").write_text('{"phases": []}')

    # Spec 003 - complete with QA approval in implementation_plan.json
    spec_003 = specs_dir / "003-completed"
    spec_003.mkdir()
    (spec_003 / "spec.md").write_text("# Completed\n")
    (spec_003 / "implementation_plan.json").write_text(
        '{"phases": [], "qa_signoff": {"status": "approved"}}'
    )
    (spec_003 / "qa_report.md").write_text("# QA Approved\n")

    return temp_git_repo


@pytest.fixture
def project_with_completed_specs_and_worktrees(temp_git_repo: Path) -> Path:
    """Create a project with completed specs and worktrees."""
    specs_dir = temp_git_repo / ".auto-claude" / "specs"
    specs_dir.mkdir(parents=True)

    worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
    worktrees_dir.mkdir(parents=True)

    # Completed spec 001 with worktree (QA approved)
    spec_001 = specs_dir / "001-completed-with-wt"
    spec_001.mkdir()
    (spec_001 / "qa_report.md").write_text("# QA Approved\n")
    (spec_001 / "implementation_plan.json").write_text(
        '{"qa_signoff": {"status": "approved"}}'
    )

    wt_001 = worktrees_dir / "001-completed-with-wt"
    wt_001.mkdir(parents=True)

    # Completed spec 002 without worktree (QA approved)
    spec_002 = specs_dir / "002-completed-no-wt"
    spec_002.mkdir()
    (spec_002 / "qa_report.md").write_text("# QA Approved\n")
    (spec_002 / "implementation_plan.json").write_text(
        '{"qa_signoff": {"status": "approved"}}'
    )

    # Incomplete spec 003
    spec_003 = specs_dir / "003-incomplete"
    spec_003.mkdir()
    (spec_003 / "spec.md").write_text("# In Progress\n")

    return temp_git_repo


# =============================================================================
# HANDLE_BATCH_CREATE_COMMAND TESTS
# =============================================================================

class TestHandleBatchCreateCommand:
    """Tests for handle_batch_create_command() function."""

    def test_creates_specs_from_batch_file(
        self, sample_batch_file: Path, temp_git_repo: Path
    ) -> None:
        """Creates spec directories from batch file."""
        result = handle_batch_create_command(str(sample_batch_file), str(temp_git_repo))

        assert result is True

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        assert specs_dir.exists()

        # Should create 3 specs
        spec_dirs = sorted([d for d in specs_dir.iterdir() if d.is_dir()])
        assert len(spec_dirs) == 3

        # Check spec numbering continues from 001
        assert spec_dirs[0].name == "001-add-user-authentication"
        assert spec_dirs[1].name == "002-add-payment-processing"
        assert spec_dirs[2].name == "003-fix-navigation-bug"

    def test_creates_requirements_json(
        self, sample_batch_file: Path, temp_git_repo: Path
    ) -> None:
        """Creates requirements.json with correct content."""
        handle_batch_create_command(str(sample_batch_file), str(temp_git_repo))

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        spec_001 = specs_dir / "001-add-user-authentication"
        req_file = spec_001 / "requirements.json"

        assert req_file.exists()

        with open(req_file) as f:
            req = json.load(f)

        assert req["task_description"] == "Implement OAuth2 login with Google provider"
        assert req["workflow_type"] == "feature"
        assert req["services_involved"] == ["backend", "frontend"]
        assert req["priority"] == 8
        assert req["complexity_inferred"] == "standard"
        assert req["estimate"]["estimated_hours"] == 6.0
        assert req["estimate"]["estimated_days"] == 0.75

    def test_continues_numbering_from_existing_specs(
        self, project_with_specs: Path, sample_batch_file: Path
    ) -> None:
        """Continues spec numbering from existing specs."""
        handle_batch_create_command(str(sample_batch_file), str(project_with_specs))

        specs_dir = project_with_specs / ".auto-claude" / "specs"
        spec_dirs = sorted([d for d in specs_dir.iterdir() if d.is_dir()])

        # Should have existing 3 specs + 3 new ones
        assert len(spec_dirs) == 6

        # New specs should start at 004
        assert spec_dirs[3].name == "004-add-user-authentication"
        assert spec_dirs[4].name == "005-add-payment-processing"
        assert spec_dirs[5].name == "006-fix-navigation-bug"

    def test_returns_false_for_missing_file(self, temp_git_repo: Path) -> None:
        """Returns False when batch file doesn't exist."""
        result = handle_batch_create_command(
            "nonexistent.json", str(temp_git_repo)
        )

        assert result is False

    def test_returns_false_for_invalid_json(
        self, invalid_json_file: Path, temp_git_repo: Path
    ) -> None:
        """Returns False for invalid JSON."""
        result = handle_batch_create_command(
            str(invalid_json_file), str(temp_git_repo)
        )

        assert result is False

    def test_returns_false_for_empty_tasks(
        self, empty_batch_file: Path, temp_git_repo: Path
    ) -> None:
        """Returns False when batch file has no tasks."""
        result = handle_batch_create_command(
            str(empty_batch_file), str(temp_git_repo)
        )

        assert result is False

    def test_sanitizes_task_title_for_folder_name(
        self, temp_dir: Path, temp_git_repo: Path
    ) -> None:
        """Sanitizes task title when creating folder name."""
        batch_data = {
            "tasks": [
                {
                    "title": "Task With VERY Long Name That Should Be Truncated Because It Exceeds Fifty Characters",
                    "description": "Test",
                }
            ]
        }
        batch_file = temp_dir / "batch.json"
        batch_file.write_text(json.dumps(batch_data))

        handle_batch_create_command(str(batch_file), str(temp_git_repo))

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        spec_dirs = list(specs_dir.iterdir())

        assert len(spec_dirs) == 1
        # Name should be truncated to 50 chars
        assert len(spec_dirs[0].name) <= 59  # "001-" + 50 chars
        assert spec_dirs[0].name.startswith("001-")

    def test_uses_defaults_for_missing_fields(
        self, temp_dir: Path, temp_git_repo: Path
    ) -> None:
        """Uses default values for missing optional fields."""
        batch_data = {
            "tasks": [
                {
                    "title": "Minimal Task",
                }
            ]
        }
        batch_file = temp_dir / "batch.json"
        batch_file.write_text(json.dumps(batch_data))

        handle_batch_create_command(str(batch_file), str(temp_git_repo))

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        req_file = specs_dir / "001-minimal-task" / "requirements.json"

        with open(req_file) as f:
            req = json.load(f)

        assert req["task_description"] == "Minimal Task"
        assert req["workflow_type"] == "feature"
        assert req["services_involved"] == ["frontend"]
        assert req["priority"] == 5
        assert req["complexity_inferred"] == "standard"
        assert req["estimate"]["estimated_hours"] == 4.0
        assert req["estimate"]["estimated_days"] == 0.5


# =============================================================================
# HANDLE_BATCH_STATUS_COMMAND TESTS
# =============================================================================

class TestHandleBatchStatusCommand:
    """Tests for handle_batch_status_command() function."""

    def test_shows_status_for_all_specs(
        self, capsys, project_with_specs: Path
    ) -> None:
        """Shows status for all specs in project."""
        result = handle_batch_status_command(str(project_with_specs))

        assert result is True

        captured = capsys.readouterr()
        assert "3 spec" in captured.out
        assert "001-existing-feature" in captured.out
        assert "002-in-progress" in captured.out
        assert "003-completed" in captured.out

    def test_shows_correct_status_icons(
        self, capsys, project_with_specs: Path
    ) -> None:
        """Shows appropriate status icons for each spec."""
        handle_batch_status_command(str(project_with_specs))

        captured = capsys.readouterr()
        # Status icons for different states:
        # 001: spec.md only → spec_created (📋)
        # 002: spec.md + implementation_plan.json → building (⚙️)
        # 003: qa_report.md → qa_approved (✅)
        assert "📋" in captured.out
        assert "⚙️" in captured.out
        assert "✅" in captured.out

    def test_returns_true_for_no_specs_directory(
        self, capsys, temp_git_repo: Path
    ) -> None:
        """Returns True when no specs directory exists."""
        result = handle_batch_status_command(str(temp_git_repo))

        assert result is True

        captured = capsys.readouterr()
        assert "No specs found" in captured.out

    def test_returns_true_for_empty_specs_directory(
        self, capsys, temp_git_repo: Path
    ) -> None:
        """Returns True when specs directory is empty."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        result = handle_batch_status_command(str(temp_git_repo))

        assert result is True

        captured = capsys.readouterr()
        assert "No specs found" in captured.out

    def test_shows_task_description(
        self, capsys, project_with_specs: Path
    ) -> None:
        """Shows task description from requirements.json."""
        handle_batch_status_command(str(project_with_specs))

        captured = capsys.readouterr()
        assert "Existing" in captured.out

    def test_detects_spec_created_status(
        self, temp_git_repo: Path
    ) -> None:
        """Correctly detects specs with spec.md as 'spec_created'."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        spec_001 = specs_dir / "001-test"
        spec_001.mkdir()
        (spec_001 / "spec.md").write_text("# Test\n")

        result = handle_batch_status_command(str(temp_git_repo))

        assert result is True

    def test_detects_building_status(
        self, temp_git_repo: Path
    ) -> None:
        """Correctly detects specs with implementation_plan.json as 'building'."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        spec_001 = specs_dir / "001-test"
        spec_001.mkdir()
        (spec_001 / "implementation_plan.json").write_text('{"phases": []}')

        result = handle_batch_status_command(str(temp_git_repo))

        assert result is True

    def test_detects_qa_approved_status(
        self, temp_git_repo: Path
    ) -> None:
        """Correctly detects specs with qa_signoff as 'qa_approved'."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        spec_001 = specs_dir / "001-test"
        spec_001.mkdir()
        (spec_001 / "qa_report.md").write_text("# QA Approved\n")
        (spec_001 / "implementation_plan.json").write_text(
            '{"qa_signoff": {"status": "approved"}}'
        )

        result = handle_batch_status_command(str(temp_git_repo))

        assert result is True

    def test_detects_pending_spec_status(
        self, temp_git_repo: Path
    ) -> None:
        """Correctly detects specs with only requirements.json as 'pending_spec'."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        spec_001 = specs_dir / "001-test"
        spec_001.mkdir()
        (spec_001 / "requirements.json").write_text('{"task": "test"}')

        result = handle_batch_status_command(str(temp_git_repo))

        assert result is True

    def test_handles_corrupted_requirements_json(
        self, capsys, temp_git_repo: Path
    ) -> None:
        """Handles corrupted requirements.json gracefully."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        spec_001 = specs_dir / "001-test"
        spec_001.mkdir()
        (spec_001 / "requirements.json").write_text("{ invalid json")

        result = handle_batch_status_command(str(temp_git_repo))

        assert result is True
        captured = capsys.readouterr()
        assert "001-test" in captured.out


# =============================================================================
# HANDLE_BATCH_CLEANUP_COMMAND TESTS
# =============================================================================

class TestHandleBatchCleanupCommand:
    """Tests for handle_batch_cleanup_command() function."""

    def test_dry_run_shows_what_would_be_deleted(
        self, capsys, project_with_completed_specs_and_worktrees: Path
    ) -> None:
        """Dry run shows what would be deleted without actually deleting."""
        result = handle_batch_cleanup_command(
            str(project_with_completed_specs_and_worktrees), dry_run=True
        )

        assert result is True

        captured = capsys.readouterr()
        assert "2 completed spec" in captured.out
        assert "001-completed-with-wt" in captured.out
        assert "002-completed-no-wt" in captured.out
        assert "Would remove:" in captured.out
        assert "Run with --no-dry-run" in captured.out

    def test_dry_run_does_not_delete(
        self, project_with_completed_specs_and_worktrees: Path
    ) -> None:
        """Dry run does not actually delete anything."""
        specs_dir = project_with_completed_specs_and_worktrees / ".auto-claude" / "specs"

        handle_batch_cleanup_command(
            str(project_with_completed_specs_and_worktrees), dry_run=True
        )

        # Specs should still exist
        assert (specs_dir / "001-completed-with-wt").exists()
        assert (specs_dir / "002-completed-no-wt").exists()

    def test_cleanup_deletes_specs_and_worktrees(
        self, project_with_completed_specs_and_worktrees: Path
    ) -> None:
        """Actually deletes completed specs and worktrees when dry_run=False."""
        specs_dir = project_with_completed_specs_and_worktrees / ".auto-claude" / "specs"
        worktrees_dir = project_with_completed_specs_and_worktrees / ".auto-claude" / "worktrees" / "tasks"

        handle_batch_cleanup_command(
            str(project_with_completed_specs_and_worktrees), dry_run=False
        )

        # Completed specs should be deleted
        assert not (specs_dir / "001-completed-with-wt").exists()
        assert not (specs_dir / "002-completed-no-wt").exists()

        # Worktree should be deleted
        assert not (worktrees_dir / "001-completed-with-wt").exists()

    def test_cleanup_preserves_incomplete_specs(
        self, project_with_completed_specs_and_worktrees: Path
    ) -> None:
        """Does not delete specs without qa_report.md."""
        specs_dir = project_with_completed_specs_and_worktrees / ".auto-claude" / "specs"

        handle_batch_cleanup_command(
            str(project_with_completed_specs_and_worktrees), dry_run=False
        )

        # Incomplete spec should still exist
        assert (specs_dir / "003-incomplete").exists()

    def test_returns_true_for_no_specs_directory(
        self, capsys, temp_git_repo: Path
    ) -> None:
        """Returns True when no specs directory exists."""
        result = handle_batch_cleanup_command(str(temp_git_repo), dry_run=True)

        assert result is True

        captured = capsys.readouterr()
        assert "No specs directory found" in captured.out

    def test_returns_true_for_no_completed_specs(
        self, capsys, temp_git_repo: Path
    ) -> None:
        """Returns True when no completed specs exist."""
        # Create specs without qa_report.md
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        spec_001 = specs_dir / "001-incomplete"
        spec_001.mkdir()
        (spec_001 / "spec.md").write_text("# In Progress\n")

        result = handle_batch_cleanup_command(str(temp_git_repo), dry_run=True)

        assert result is True

        captured = capsys.readouterr()
        assert "No completed specs to clean up" in captured.out

    def test_cleanup_with_git_worktree_remove(
        self, project_with_completed_specs_and_worktrees: Path
    ) -> None:
        """Uses git worktree remove when available."""
        with patch('subprocess.run') as mock_run:
            # Mock git worktree remove to succeed
            mock_run.return_value = MagicMock(returncode=0)

            handle_batch_cleanup_command(
                str(project_with_completed_specs_and_worktrees), dry_run=False
            )

            # Should have called git worktree remove
            # Check that the first argument of any call contains "git", "worktree", "remove"
            assert any(
                "git" in str(call.args) and
                "worktree" in str(call.args) and
                "remove" in str(call.args)
                for call in mock_run.call_args_list
            )

    def test_cleanup_fallback_to_manual_removal(
        self, project_with_completed_specs_and_worktrees: Path
    ) -> None:
        """Falls back to manual removal when git worktree remove fails."""
        specs_dir = project_with_completed_specs_and_worktrees / ".auto-claude" / "specs"

        with patch('subprocess.run') as mock_run:
            # Mock git worktree remove to fail
            mock_run.return_value = MagicMock(returncode=1)

            handle_batch_cleanup_command(
                str(project_with_completed_specs_and_worktrees), dry_run=False
            )

            # Should still delete the spec
            assert not (specs_dir / "001-completed-with-wt").exists()

    def test_cleanup_handles_timeout_gracefully(
        self, project_with_completed_specs_and_worktrees: Path
    ) -> None:
        """Handles git command timeout gracefully."""
        specs_dir = project_with_completed_specs_and_worktrees / ".auto-claude" / "specs"

        with patch('subprocess.run') as mock_run:
            # Mock timeout
            from subprocess import TimeoutExpired
            mock_run.side_effect = TimeoutExpired("git", 30)

            handle_batch_cleanup_command(
                str(project_with_completed_specs_and_worktrees), dry_run=False
            )

            # Should still delete the spec (fallback)
            assert not (specs_dir / "001-completed-with-wt").exists()

    def test_cleanup_handles_exceptions(
        self, capsys, project_with_completed_specs_and_worktrees: Path
    ) -> None:
        """Handles exceptions during cleanup gracefully."""
        with patch('subprocess.run') as mock_run:
            # Mock exception
            mock_run.side_effect = Exception("Test error")

            handle_batch_cleanup_command(
                str(project_with_completed_specs_and_worktrees), dry_run=False
            )

            # Should continue and delete specs
            captured = capsys.readouterr()
            assert "Cleaned up" in captured.out

    def test_cleanup_shows_worktree_path_in_dry_run(
        self, capsys, project_with_completed_specs_and_worktrees: Path
    ) -> None:
        """Shows worktree path in dry run output."""
        handle_batch_cleanup_command(
            str(project_with_completed_specs_and_worktrees), dry_run=True
        )

        captured = capsys.readouterr()
        assert ".auto-claude/worktrees/tasks/001-completed-with-wt" in captured.out


# =============================================================================
# INTEGRATION TESTS
# =============================================================================

class TestBatchCommandsIntegration:
    """Integration tests for batch commands."""

    def test_create_then_status_workflow(
        self, sample_batch_file: Path, temp_git_repo: Path
    ) -> None:
        """Test creating specs then checking status."""
        # Create specs
        create_result = handle_batch_create_command(
            str(sample_batch_file), str(temp_git_repo)
        )
        assert create_result is True

        # Check status
        status_result = handle_batch_status_command(str(temp_git_repo))
        assert status_result is True

    def test_create_then_cleanup_workflow(
        self, temp_dir: Path, temp_git_repo: Path
    ) -> None:
        """Test creating specs, marking complete, then cleanup."""
        # Create a spec
        batch_data = {"tasks": [{"title": "Test Task"}]}
        batch_file = temp_dir / "batch.json"
        batch_file.write_text(json.dumps(batch_data))

        handle_batch_create_command(str(batch_file), str(temp_git_repo))

        # Mark as complete with proper QA approval
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        spec_001 = specs_dir / "001-test-task"
        (spec_001 / "qa_report.md").write_text("# QA Approved\n")
        (spec_001 / "implementation_plan.json").write_text(
            '{"qa_signoff": {"status": "approved"}}'
        )

        # Dry run cleanup
        result = handle_batch_cleanup_command(str(temp_git_repo), dry_run=True)
        assert result is True

        # Actual cleanup
        result = handle_batch_cleanup_command(str(temp_git_repo), dry_run=False)
        assert result is True

        # Spec should be deleted
        assert not spec_001.exists()


class TestBatchCommandsExceptionCoverage:
    """Tests for exception handling paths to increase coverage."""

    def test_cleanup_with_permission_error(
        self, temp_dir: Path, temp_git_repo: Path, monkeypatch
    ) -> None:
        """Test cleanup handles permission errors gracefully."""

        # Create a completed spec with proper QA approval
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        spec_001 = specs_dir / "001-test-task"
        spec_001.mkdir(parents=True)
        (spec_001 / "qa_report.md").write_text("# QA Approved\n")
        (spec_001 / "implementation_plan.json").write_text(
            '{"qa_signoff": {"status": "approved"}}'
        )

        # Mock shutil.rmtree to raise permission error
        def mock_rmtree_raises(path, *args, **kwargs):
            if "001-test-task" in str(path):
                raise PermissionError(f"Permission denied: {path}")

        monkeypatch.setattr("cli.batch_commands.shutil.rmtree", mock_rmtree_raises)

        # Should handle the error gracefully and not crash
        result = handle_batch_cleanup_command(str(temp_git_repo), dry_run=False)
        assert result is True

    def test_cleanup_with_generic_exception(
        self, temp_dir: Path, temp_git_repo: Path, monkeypatch
    ) -> None:
        """Test cleanup handles generic exceptions gracefully."""

        # Create a completed spec with proper QA approval
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        spec_001 = specs_dir / "001-test-task"
        spec_001.mkdir(parents=True)
        (spec_001 / "qa_report.md").write_text("# QA Approved\n")
        (spec_001 / "implementation_plan.json").write_text(
            '{"qa_signoff": {"status": "approved"}}'
        )

        # Mock shutil.rmtree to raise generic exception
        def mock_rmtree_raises(path, *args, **kwargs):
            if "001-test-task" in str(path):
                raise RuntimeError(f"Cannot delete: {path}")

        monkeypatch.setattr("cli.batch_commands.shutil.rmtree", mock_rmtree_raises)

        # Should handle the error gracefully and not crash
        result = handle_batch_cleanup_command(str(temp_git_repo), dry_run=False)
        assert result is True
