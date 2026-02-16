#!/usr/bin/env python3
"""
Tests for CLI Workspace Merge/Review/Discard Commands
=====================================================

Tests the workspace_commands.py module functionality including:
- handle_merge_command()
- handle_review_command()
- handle_discard_command()
- handle_list_worktrees_command()
- handle_cleanup_worktrees_command()
- handle_merge_preview_command()
- handle_create_pr_command()
- _detect_default_branch()
- _get_changed_files_from_git()
- _check_git_merge_conflicts()
- _detect_conflict_scenario()

"""

import subprocess
from pathlib import Path
from typing import Generator
from unittest.mock import patch

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



class TestHandleMergeCommand:
    """Tests for handle_merge_command function."""

    @patch("cli.workspace_commands.merge_existing_build")
    def test_merge_success(self, mock_merge, mock_project_dir: Path):
        """Successful merge returns True."""
        mock_merge.return_value = True

        result = workspace_commands.handle_merge_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result is True
        mock_merge.assert_called_once_with(
            mock_project_dir, TEST_SPEC_NAME, no_commit=False, base_branch=None
        )

    @patch("cli.workspace_commands.merge_existing_build")
    def test_merge_failure(self, mock_merge, mock_project_dir: Path):
        """Failed merge returns False."""
        mock_merge.return_value = False

        result = workspace_commands.handle_merge_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result is False

    @patch("cli.workspace_commands.merge_existing_build")
    def test_merge_with_no_commit(self, mock_merge, mock_project_dir: Path):
        """Merge with no_commit flag."""
        mock_merge.return_value = True

        result = workspace_commands.handle_merge_command(
            mock_project_dir, TEST_SPEC_NAME, no_commit=True
        )

        assert result is True
        mock_merge.assert_called_once_with(
            mock_project_dir, TEST_SPEC_NAME, no_commit=True, base_branch=None
        )

    @patch("cli.workspace_commands.merge_existing_build")
    @patch("cli.workspace_commands._generate_and_save_commit_message")
    def test_no_commit_generates_message(
        self, mock_generate, mock_merge, mock_project_dir: Path
    ):
        """No-commit mode generates commit message."""
        mock_merge.return_value = True

        workspace_commands.handle_merge_command(
            mock_project_dir, TEST_SPEC_NAME, no_commit=True
        )

        mock_generate.assert_called_once_with(mock_project_dir, TEST_SPEC_NAME)

    @patch("cli.workspace_commands.merge_existing_build")
    def test_merge_with_base_branch(self, mock_merge, mock_project_dir: Path):
        """Merge with specified base branch."""
        mock_merge.return_value = True

        result = workspace_commands.handle_merge_command(
            mock_project_dir, TEST_SPEC_NAME, base_branch="develop"
        )

        assert result is True
        mock_merge.assert_called_once_with(
            mock_project_dir, TEST_SPEC_NAME, no_commit=False, base_branch="develop"
        )


# =============================================================================
# TESTS FOR handle_review_command()
# =============================================================================



class TestHandleReviewCommand:
    """Tests for handle_review_command function."""

    @patch("cli.workspace_commands.review_existing_build")
    def test_review_calls_function(self, mock_review, mock_project_dir: Path):
        """Review command calls review_existing_build."""
        workspace_commands.handle_review_command(mock_project_dir, TEST_SPEC_NAME)

        mock_review.assert_called_once_with(mock_project_dir, TEST_SPEC_NAME)


# =============================================================================
# TESTS FOR handle_discard_command()
# =============================================================================



class TestHandleDiscardCommand:
    """Tests for handle_discard_command function."""

    @patch("cli.workspace_commands.discard_existing_build")
    def test_discard_calls_function(self, mock_discard, mock_project_dir: Path):
        """Discard command calls discard_existing_build."""
        workspace_commands.handle_discard_command(mock_project_dir, TEST_SPEC_NAME)

        mock_discard.assert_called_once_with(mock_project_dir, TEST_SPEC_NAME)


# =============================================================================
# TESTS FOR handle_list_worktrees_command()
# =============================================================================



class TestHandleMergePreviewCommand:
    """Tests for handle_merge_preview_command function."""

    @patch("cli.workspace_commands.get_existing_build_worktree")
    def test_no_worktree_returns_error(self, mock_get, mock_project_dir: Path):
        """Returns error when no worktree exists."""
        mock_get.return_value = None

        result = workspace_commands.handle_merge_preview_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is False
        assert "No existing build found" in result["error"]

    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands._detect_default_branch")
    @patch("cli.workspace_commands._get_changed_files_from_git")
    @patch("cli.workspace_commands._check_git_merge_conflicts")
    @patch("cli.workspace_commands._detect_parallel_task_conflicts")
    def test_successful_preview(
        self,
        mock_parallel,
        mock_git_conflicts,
        mock_changed_files,
        mock_default_branch,
        mock_get,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Successful preview returns correct structure."""
        mock_get.return_value = mock_worktree_path
        mock_default_branch.return_value = "main"
        mock_changed_files.return_value = ["file1.txt", "file2.txt"]
        mock_git_conflicts.return_value = {
            "has_conflicts": False,
            "conflicting_files": [],
            "needs_rebase": False,
            "base_branch": "main",
            "spec_branch": TEST_SPEC_BRANCH,
            "commits_behind": 0,
        }
        mock_parallel.return_value = []

        result = workspace_commands.handle_merge_preview_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        assert result["files"] == ["file1.txt", "file2.txt"]
        assert result["conflicts"] == []
        assert result["summary"]["totalFiles"] == 2
        assert result["summary"]["totalConflicts"] == 0

    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands._detect_default_branch")
    @patch("cli.workspace_commands._get_changed_files_from_git")
    @patch("cli.workspace_commands._check_git_merge_conflicts")
    @patch("cli.workspace_commands._detect_parallel_task_conflicts")
    def test_preview_with_git_conflicts(
        self,
        mock_parallel,
        mock_git_conflicts,
        mock_changed_files,
        mock_default_branch,
        mock_get,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Preview detects git conflicts."""
        mock_get.return_value = mock_worktree_path
        mock_default_branch.return_value = "main"
        mock_changed_files.return_value = ["file1.txt"]
        mock_git_conflicts.return_value = {
            "has_conflicts": True,
            "conflicting_files": ["file1.txt"],
            "needs_rebase": False,
            "base_branch": "main",
            "spec_branch": TEST_SPEC_BRANCH,
            "commits_behind": 0,
        }
        mock_parallel.return_value = []

        result = workspace_commands.handle_merge_preview_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        assert result["gitConflicts"]["hasConflicts"] is True
        assert result["gitConflicts"]["conflictingFiles"] == ["file1.txt"]
        assert len(result["conflicts"]) == 1

    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands._detect_default_branch")
    @patch("cli.workspace_commands._get_changed_files_from_git")
    @patch("cli.workspace_commands._check_git_merge_conflicts")
    @patch("cli.workspace_commands._detect_parallel_task_conflicts")
    def test_preview_with_parallel_conflicts(
        self,
        mock_parallel,
        mock_git_conflicts,
        mock_changed_files,
        mock_default_branch,
        mock_get,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Preview detects parallel task conflicts."""
        mock_get.return_value = mock_worktree_path
        mock_default_branch.return_value = "main"
        mock_changed_files.return_value = ["file1.txt"]
        mock_git_conflicts.return_value = {
            "has_conflicts": False,
            "conflicting_files": [],
            "needs_rebase": False,
            "base_branch": "main",
            "spec_branch": TEST_SPEC_BRANCH,
            "commits_behind": 0,
        }
        mock_parallel.return_value = [
            {"file": "file1.txt", "tasks": [TEST_SPEC_NAME, "002-other-spec"]}
        ]

        result = workspace_commands.handle_merge_preview_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        assert len(result["conflicts"]) == 1
        assert result["conflicts"][0]["type"] == "parallel"
        assert result["conflicts"][0]["file"] == "file1.txt"

    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands._detect_default_branch")
    @patch("cli.workspace_commands._get_changed_files_from_git")
    @patch("cli.workspace_commands._check_git_merge_conflicts")
    @patch("cli.workspace_commands._detect_parallel_task_conflicts")
    def test_preview_with_lock_file_excluded(
        self,
        mock_parallel,
        mock_git_conflicts,
        mock_changed_files,
        mock_default_branch,
        mock_get,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Preview excludes lock files from conflicts."""
        from core.workspace.git_utils import is_lock_file

        mock_get.return_value = mock_worktree_path
        mock_default_branch.return_value = "main"
        mock_changed_files.return_value = ["package-lock.json", "file1.txt"]
        mock_git_conflicts.return_value = {
            "has_conflicts": True,
            "conflicting_files": ["package-lock.json"],
            "needs_rebase": False,
            "base_branch": "main",
            "spec_branch": TEST_SPEC_BRANCH,
            "commits_behind": 0,
        }
        mock_parallel.return_value = []

        result = workspace_commands.handle_merge_preview_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        # Lock files should be excluded
        assert result["gitConflicts"]["hasConflicts"] is False
        assert "package-lock.json" in result["lockFilesExcluded"]

    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands._detect_default_branch")
    @patch("cli.workspace_commands._get_changed_files_from_git")
    @patch("cli.workspace_commands._check_git_merge_conflicts")
    @patch("cli.workspace_commands._detect_parallel_task_conflicts")
    def test_preview_exception_returns_error(
        self,
        mock_parallel,
        mock_git_conflicts,
        mock_changed_files,
        mock_default_branch,
        mock_get,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Exception during preview returns error result."""
        mock_get.side_effect = Exception("Test error")

        result = workspace_commands.handle_merge_preview_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is False
        assert "error" in result


# =============================================================================
# TESTS FOR handle_create_pr_command()
# =============================================================================



class TestMergePreviewPathMapping:
    """Tests for path mapping and rename detection in merge preview."""

    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands._detect_default_branch")
    @patch("cli.workspace_commands._get_changed_files_from_git")
    @patch("cli.workspace_commands._check_git_merge_conflicts")
    @patch("cli.workspace_commands._detect_parallel_task_conflicts")
    @patch("cli.workspace_commands.get_merge_base")
    @patch("cli.workspace_commands.detect_file_renames")
    @patch("cli.workspace_commands.apply_path_mapping")
    @patch("cli.workspace_commands.get_file_content_from_ref")
    def test_detects_file_renames_and_path_mappings(
        self,
        mock_get_content,
        mock_apply_mapping,
        mock_detect_renames,
        mock_get_merge_base,
        mock_parallel,
        mock_git_conflicts,
        mock_changed_files,
        mock_default_branch,
        mock_get,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Detects file renames and creates AI merge entries for renamed files."""
        mock_get.return_value = mock_worktree_path
        mock_default_branch.return_value = "main"
        mock_changed_files.return_value = ["old_path/file.py"]
        mock_git_conflicts.return_value = {
            "has_conflicts": False,
            "conflicting_files": [],
            "needs_rebase": True,
            "commits_behind": 5,
            "base_branch": "main",
            "spec_branch": TEST_SPEC_BRANCH,
        }
        mock_parallel.return_value = []
        mock_get_merge_base.return_value = "abc123"
        mock_detect_renames.return_value = {"old_path/file.py": "new_path/file.py"}
        mock_apply_mapping.side_effect = lambda x, m: m.get(x, x)
        mock_get_content.side_effect = [
            "worktree content",
            "target content",
        ]

        result = workspace_commands.handle_merge_preview_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        assert result["gitConflicts"]["totalRenames"] == 1
        assert len(result["gitConflicts"]["pathMappedAIMerges"]) == 1
        assert result["gitConflicts"]["pathMappedAIMerges"][0]["oldPath"] == "old_path/file.py"
        assert result["gitConflicts"]["pathMappedAIMerges"][0]["newPath"] == "new_path/file.py"

    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands._detect_default_branch")
    @patch("cli.workspace_commands._get_changed_files_from_git")
    @patch("cli.workspace_commands._check_git_merge_conflicts")
    @patch("cli.workspace_commands._detect_parallel_task_conflicts")
    def test_no_path_mapping_when_no_rebase_needed(
        self,
        mock_parallel,
        mock_git_conflicts,
        mock_changed_files,
        mock_default_branch,
        mock_get,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Skips path mapping detection when no rebase is needed."""
        mock_get.return_value = mock_worktree_path
        mock_default_branch.return_value = "main"
        mock_changed_files.return_value = ["file.py"]
        mock_git_conflicts.return_value = {
            "has_conflicts": False,
            "conflicting_files": [],
            "needs_rebase": False,  # No rebase needed
            "commits_behind": 0,
            "base_branch": "main",
            "spec_branch": TEST_SPEC_BRANCH,
        }
        mock_parallel.return_value = []

        result = workspace_commands.handle_merge_preview_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        assert result["gitConflicts"]["totalRenames"] == 0
        assert len(result["gitConflicts"]["pathMappedAIMerges"]) == 0

    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands._detect_default_branch")
    @patch("cli.workspace_commands._get_changed_files_from_git")
    @patch("cli.workspace_commands._check_git_merge_conflicts")
    @patch("cli.workspace_commands._detect_parallel_task_conflicts")
    @patch("cli.workspace_commands.get_merge_base")
    def test_no_merge_base_returns_no_path_mappings(
        self,
        mock_get_merge_base,
        mock_parallel,
        mock_git_conflicts,
        mock_changed_files,
        mock_default_branch,
        mock_get,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Handles no merge base gracefully."""
        mock_get.return_value = mock_worktree_path
        mock_default_branch.return_value = "main"
        mock_changed_files.return_value = ["file.py"]
        mock_git_conflicts.return_value = {
            "has_conflicts": False,
            "conflicting_files": [],
            "needs_rebase": True,
            "commits_behind": 5,
            "base_branch": "main",
            "spec_branch": TEST_SPEC_BRANCH,
        }
        mock_parallel.return_value = []
        mock_get_merge_base.return_value = None  # No merge base

        result = workspace_commands.handle_merge_preview_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        assert result["gitConflicts"]["totalRenames"] == 0

    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands._detect_default_branch")
    @patch("cli.workspace_commands._get_changed_files_from_git")
    @patch("cli.workspace_commands._check_git_merge_conflicts")
    @patch("cli.workspace_commands._detect_parallel_task_conflicts")
    @patch("cli.workspace_commands.get_merge_base")
    @patch("cli.workspace_commands.detect_file_renames")
    @patch("cli.workspace_commands.apply_path_mapping")
    @patch("cli.workspace_commands.get_file_content_from_ref")
    def test_skips_files_without_both_contents(
        self,
        mock_get_content,
        mock_apply_mapping,
        mock_detect_renames,
        mock_get_merge_base,
        mock_parallel,
        mock_git_conflicts,
        mock_changed_files,
        mock_default_branch,
        mock_get,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Skips files when content cannot be retrieved from both refs."""
        mock_get.return_value = mock_worktree_path
        mock_default_branch.return_value = "main"
        mock_changed_files.return_value = ["old_path/file.py"]
        mock_git_conflicts.return_value = {
            "has_conflicts": False,
            "conflicting_files": [],
            "needs_rebase": True,
            "commits_behind": 5,
            "base_branch": "main",
            "spec_branch": TEST_SPEC_BRANCH,
        }
        mock_parallel.return_value = []
        mock_get_merge_base.return_value = "abc123"
        mock_detect_renames.return_value = {"old_path/file.py": "new_path/file.py"}
        mock_apply_mapping.side_effect = lambda x, m: m.get(x, x)
        # Only one content available, not both
        mock_get_content.side_effect = ["worktree content", None]

        result = workspace_commands.handle_merge_preview_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        # Should not add to path mapped merges since both contents aren't available
        assert len(result["gitConflicts"]["pathMappedAIMerges"]) == 0


# =============================================================================
# TESTS FOR _detect_default_branch() - FALLBACK
# =============================================================================



class TestGenerateAndSaveCommitMessageEdgeCases:
    """Tests for edge cases in commit message generation."""

    @patch("commit_message.generate_commit_message_sync")
    @patch("subprocess.run")
    def test_git_diff_failure_returns_empty_summary(
        self, mock_run, mock_generate, mock_project_dir: Path, workspace_spec_dir: Path
    ):
        """Handles git diff failure gracefully."""
        mock_run.side_effect = Exception("Git command failed")
        mock_generate.return_value = "Test commit message"

        workspace_commands._generate_and_save_commit_message(mock_project_dir, TEST_SPEC_NAME)

        # Should still call generate_commit_message_sync with empty summary
        mock_generate.assert_called_once()
        call_args = mock_generate.call_args
        assert call_args.kwargs["diff_summary"] == ""
        assert call_args.kwargs["files_changed"] == []

    @patch("commit_message.generate_commit_message_sync")
    def test_spec_dir_not_found_logs_warning(
        self, mock_generate, mock_project_dir: Path
    ):
        """Logs warning when spec directory not found."""
        mock_generate.return_value = "Test commit message"
        # Use non-existent spec name
        workspace_commands._generate_and_save_commit_message(
            mock_project_dir, "nonexistent-spec"
        )

        # Should not crash, just handle gracefully

    @patch("commit_message.generate_commit_message_sync", return_value=None)
    def test_no_commit_message_generated_logs_warning(
        self, mock_generate, mock_project_dir: Path, workspace_spec_dir: Path
    ):
        """Logs warning when no commit message is generated."""
        workspace_commands._generate_and_save_commit_message(
            mock_project_dir, TEST_SPEC_NAME
        )

        # Should handle None return value gracefully

    @patch("commit_message.generate_commit_message_sync", side_effect=ImportError)
    def test_import_error_logs_warning(
        self, mock_generate, mock_project_dir: Path, workspace_spec_dir: Path
    ):
        """Logs warning when commit_message module import fails."""
        workspace_commands._generate_and_save_commit_message(
            mock_project_dir, TEST_SPEC_NAME
        )

        # Should handle ImportError gracefully

    @patch("commit_message.generate_commit_message_sync", side_effect=Exception("Generation failed"))
    def test_generation_exception_logs_warning(
        self, mock_generate, mock_project_dir: Path, workspace_spec_dir: Path
    ):
        """Logs warning when commit message generation raises exception."""
        workspace_commands._generate_and_save_commit_message(
            mock_project_dir, TEST_SPEC_NAME
        )

        # Should handle exception gracefully


# =============================================================================
# TESTS FOR _detect_conflict_scenario() - EDGE CASES
# =============================================================================
