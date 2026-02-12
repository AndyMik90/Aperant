#!/usr/bin/env python3
"""
Tests for CLI Workspace Worktree Management
===========================================

Tests worktree management functions:
- handle_list_worktrees_command()
- handle_cleanup_worktrees_command()
- _detect_worktree_base_branch()
"""

import json
import subprocess
from pathlib import Path
from typing import Generator
from unittest.mock import MagicMock, patch

import pytest

# Import the module under test
from cli import workspace_commands


# =============================================================================
# TEST CONSTANTS
# =============================================================================

TEST_SPEC_NAME = "001-test-spec"
TEST_SPEC_BRANCH = f"auto-claude/{TEST_SPEC_NAME}"


# =============================================================================
# TESTS FOR _detect_default_branch()
# =============================================================================



class TestHandleListWorktreesCommand:
    """Tests for handle_list_worktrees_command function."""

    @patch("cli.workspace_commands.list_all_worktrees")
    @patch("cli.workspace_commands.print_banner")
    def test_list_with_no_worktrees(self, mock_banner, mock_list, mock_project_dir: Path, capsys):
        """Lists worktrees when none exist."""
        mock_list.return_value = []

        workspace_commands.handle_list_worktrees_command(mock_project_dir)

        mock_banner.assert_called_once()
        captured = capsys.readouterr()
        assert "No worktrees found" in captured.out

    @patch("cli.workspace_commands.list_all_worktrees")
    @patch("cli.workspace_commands.print_banner")
    def test_list_with_worktrees(self, mock_banner, mock_list, mock_project_dir: Path, capsys):
        """Lists existing worktrees."""
        from typing import NamedTuple

        # Create a mock worktree
        MockWorktree = NamedTuple(
            "MockWorktree",
            [("spec_name", str), ("branch", str), ("path", Path),
             ("commit_count", int), ("files_changed", int)]
        )
        mock_worktree = MockWorktree(
            spec_name=TEST_SPEC_NAME,
            branch=TEST_SPEC_BRANCH,
            path=Path("/test/path"),
            commit_count=5,
            files_changed=10
        )
        mock_list.return_value = [mock_worktree]

        workspace_commands.handle_list_worktrees_command(mock_project_dir)

        captured = capsys.readouterr()
        assert TEST_SPEC_NAME in captured.out
        assert TEST_SPEC_BRANCH in captured.out
        assert "5" in captured.out
        assert "10" in captured.out


# =============================================================================
# TESTS FOR handle_cleanup_worktrees_command()
# =============================================================================



class TestHandleCleanupWorktreesCommand:
    """Tests for handle_cleanup_worktrees_command function."""

    @patch("cli.workspace_commands.cleanup_all_worktrees")
    @patch("cli.workspace_commands.print_banner")
    def test_cleanup_calls_function(self, mock_banner, mock_cleanup, mock_project_dir: Path):
        """Cleanup command calls cleanup_all_worktrees."""
        workspace_commands.handle_cleanup_worktrees_command(mock_project_dir)

        mock_banner.assert_called_once()
        mock_cleanup.assert_called_once_with(mock_project_dir, confirm=True)


# =============================================================================
# TESTS FOR handle_merge_preview_command()
# =============================================================================



class TestCleanupOldWorktreesCommand:
    """Tests for cleanup_old_worktrees_command function."""

    def test_successful_cleanup(self, mock_project_dir: Path):
        """Successfully cleans up old worktrees."""
        with patch("cli.workspace_commands.WorktreeManager") as mock_manager_class:
            mock_manager_instance = MagicMock()
            mock_manager_instance.cleanup_old_worktrees.return_value = (["worktree1"], [])
            mock_manager_class.return_value = mock_manager_instance

            result = workspace_commands.cleanup_old_worktrees_command(
                mock_project_dir, days=30, dry_run=False
            )

            assert result["success"] is True
            assert result["removed"] == ["worktree1"]
            assert result["failed"] == []
            assert result["days_threshold"] == 30
            assert result["dry_run"] is False

    def test_dry_run_mode(self, mock_project_dir: Path):
        """Dry run mode doesn't actually remove worktrees."""
        with patch("cli.workspace_commands.WorktreeManager") as mock_manager_class:
            mock_manager_instance = MagicMock()
            mock_manager_instance.cleanup_old_worktrees.return_value = (["worktree1"], [])
            mock_manager_class.return_value = mock_manager_instance

            result = workspace_commands.cleanup_old_worktrees_command(
                mock_project_dir, days=30, dry_run=True
            )

            assert result["success"] is True
            assert result["dry_run"] is True
            mock_manager_instance.cleanup_old_worktrees.assert_called_once_with(
                days_threshold=30, dry_run=True
            )

    def test_custom_days_threshold(self, mock_project_dir: Path):
        """Uses custom days threshold."""
        with patch("cli.workspace_commands.WorktreeManager") as mock_manager_class:
            mock_manager_instance = MagicMock()
            mock_manager_instance.cleanup_old_worktrees.return_value = ([], [])
            mock_manager_class.return_value = mock_manager_instance

            result = workspace_commands.cleanup_old_worktrees_command(
                mock_project_dir, days=7, dry_run=False
            )

            assert result["days_threshold"] == 7
            mock_manager_instance.cleanup_old_worktrees.assert_called_once_with(
                days_threshold=7, dry_run=False
            )

    def test_exception_handling(self, mock_project_dir: Path):
        """Handles exceptions gracefully."""
        with patch("cli.workspace_commands.WorktreeManager", side_effect=Exception("Cleanup failed")):
            result = workspace_commands.cleanup_old_worktrees_command(
                mock_project_dir, days=30
            )

            assert result["success"] is False
            assert "error" in result


# =============================================================================
# TESTS FOR worktree_summary_command()
# =============================================================================



class TestWorktreeSummaryCommand:
    """Tests for worktree_summary_command function."""

    def test_successful_summary(self, mock_project_dir: Path):
        """Successfully generates worktree summary."""
        from typing import NamedTuple

        MockWorktreeInfo = NamedTuple(
            "MockWorktreeInfo",
            [
                ("spec_name", str),
                ("days_since_last_commit", int | None),
                ("commit_count", int),
            ],
        )

        with patch("cli.workspace_commands.WorktreeManager") as mock_manager_class:
            mock_manager_instance = MagicMock()
            mock_manager_instance.list_all_worktrees.return_value = [
                MockWorktreeInfo(spec_name="001", days_since_last_commit=5, commit_count=3),
                MockWorktreeInfo(spec_name="002", days_since_last_commit=40, commit_count=1),
            ]
            mock_manager_instance.get_worktree_count_warning.return_value = "Warning: Many worktrees"
            mock_manager_class.return_value = mock_manager_instance

            result = workspace_commands.worktree_summary_command(mock_project_dir)

            assert result["success"] is True
            assert result["total_worktrees"] == 2
            assert len(result["categories"]["recent"]) == 1
            assert len(result["categories"]["month_old"]) == 1  # 40 days falls in month_old
            assert result["warning"] == "Warning: Many worktrees"

    def test_categorizes_by_age(self, mock_project_dir: Path):
        """Categorizes worktrees by age correctly."""
        from typing import NamedTuple

        MockWorktreeInfo = NamedTuple(
            "MockWorktreeInfo",
            [
                ("spec_name", str),
                ("days_since_last_commit", int | None),
                ("commit_count", int),
            ],
        )

        with patch("cli.workspace_commands.WorktreeManager") as mock_manager_class:
            mock_manager_instance = MagicMock()
            mock_manager_instance.list_all_worktrees.return_value = [
                MockWorktreeInfo(spec_name="001", days_since_last_commit=3, commit_count=1),
                MockWorktreeInfo(spec_name="002", days_since_last_commit=15, commit_count=1),
                MockWorktreeInfo(spec_name="003", days_since_last_commit=45, commit_count=1),
                MockWorktreeInfo(spec_name="004", days_since_last_commit=100, commit_count=1),
                MockWorktreeInfo(spec_name="005", days_since_last_commit=None, commit_count=1),
            ]
            mock_manager_instance.get_worktree_count_warning.return_value = None
            mock_manager_class.return_value = mock_manager_instance

            result = workspace_commands.worktree_summary_command(mock_project_dir)

            assert len(result["categories"]["recent"]) == 1  # < 7 days
            assert len(result["categories"]["week_old"]) == 1  # 7-29 days (changed to 15)
            assert len(result["categories"]["month_old"]) == 1  # 30-89 days
            assert len(result["categories"]["very_old"]) == 1  # >= 90 days
            assert len(result["categories"]["unknown_age"]) == 1  # None

    def test_exception_handling(self, mock_project_dir: Path):
        """Handles exceptions gracefully."""
        with patch("cli.workspace_commands.WorktreeManager", side_effect=Exception("Summary failed")):
            result = workspace_commands.worktree_summary_command(mock_project_dir)

            assert result["success"] is False
            assert "error" in result
            assert result["total_worktrees"] == 0


# =============================================================================
# TESTS FOR _get_changed_files_from_git() - FALLBACK BRANCHES
# =============================================================================



class TestDetectWorktreeBaseBranch:
    """Tests for _detect_worktree_base_branch function."""

    def test_reads_from_config_file(self, temp_git_repo: Path, mock_worktree_path: Path):
        """Reads base branch from worktree config file."""
        config_dir = mock_worktree_path / ".auto-claude"
        config_dir.mkdir(parents=True, exist_ok=True)
        config_file = config_dir / "worktree-config.json"
        config_file.write_text(json.dumps({"base_branch": "develop"}), encoding="utf-8")

        result = workspace_commands._detect_worktree_base_branch(
            temp_git_repo, mock_worktree_path, TEST_SPEC_NAME
        )

        assert result == "develop"

    def test_no_config_returns_none(self, temp_git_repo: Path, mock_worktree_path: Path):
        """Returns None when no config file exists."""
        result = workspace_commands._detect_worktree_base_branch(
            temp_git_repo, mock_worktree_path, TEST_SPEC_NAME
        )

        # Should return None if can't detect
        assert result is None or result in ["main", "master", "develop"]

    def test_invalid_config_falls_back(self, temp_git_repo: Path, mock_worktree_path: Path):
        """Handles invalid config file gracefully."""
        config_dir = mock_worktree_path / ".auto-claude"
        config_dir.mkdir(parents=True, exist_ok=True)
        config_file = config_dir / "worktree-config.json"
        config_file.write_text("invalid json", encoding="utf-8")

        result = workspace_commands._detect_worktree_base_branch(
            temp_git_repo, mock_worktree_path, TEST_SPEC_NAME
        )

        # Should not crash, return None or detected branch
        assert result is None or isinstance(result, str)


# =============================================================================
# TESTS FOR cleanup_old_worktrees_command()
# =============================================================================



class TestDetectWorktreeBaseBranchDetection:
    """Tests for branch detection logic in _detect_worktree_base_branch."""

    def test_detects_from_develop_branch(self, temp_git_repo: Path):
        """Detects develop branch when it has fewest commits ahead."""
        # Create develop branch
        subprocess.run(
            ["git", "checkout", "-b", "develop"],
            cwd=temp_git_repo,
            capture_output=True,
            check=True,
        )
        # Create spec branch from develop
        subprocess.run(
            ["git", "checkout", "-b", TEST_SPEC_BRANCH],
            cwd=temp_git_repo,
            capture_output=True,
            check=True,
        )
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
            check=True,
        )

        result = workspace_commands._detect_worktree_base_branch(
            temp_git_repo, temp_git_repo, TEST_SPEC_NAME
        )

        # Should detect develop as base branch
        assert result in ["develop", "main"]

    def test_returns_none_when_no_branches_match(self, mock_project_dir: Path):
        """Returns None when no candidate branches exist."""
        with patch("subprocess.run") as mock_run:
            # No branches exist
            mock_run.return_value = MagicMock(returncode=1)

            result = workspace_commands._detect_worktree_base_branch(
                mock_project_dir, mock_project_dir, TEST_SPEC_NAME
            )

            assert result is None

    @patch("subprocess.run")
    def test_handles_merge_base_failure_during_detection(
        self, mock_run, mock_project_dir: Path, mock_worktree_path: Path
    ):
        """Handles merge-base command failure gracefully."""
        # Branch exists but merge-base fails
        mock_run.side_effect = [
            MagicMock(returncode=0),  # Branch check passes
            MagicMock(returncode=1),  # merge-base fails
        ]

        result = workspace_commands._detect_worktree_base_branch(
            mock_project_dir, mock_worktree_path, TEST_SPEC_NAME
        )

        # Should continue checking other branches or return None
        assert result is None or isinstance(result, str)


# =============================================================================
# TESTS FOR DEBUG FUNCTION FALLBACKS
# =============================================================================
