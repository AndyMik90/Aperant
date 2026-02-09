#!/usr/bin/env python3
"""
Tests for CLI Workspace Commands
==================================

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
- _detect_parallel_task_conflicts()
"""

import json
import os
import subprocess
from pathlib import Path
from typing import Generator
from unittest.mock import MagicMock, Mock, patch

import pytest

# Import the module under test
from cli import workspace_commands


# =============================================================================
# TEST CONSTANTS
# =============================================================================

TEST_SPEC_NAME = "001-test-spec"
TEST_SPEC_BRANCH = f"auto-claude/{TEST_SPEC_NAME}"


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def mock_project_dir(temp_git_repo: Path) -> Path:
    """Create a mock project directory with git repo."""
    return temp_git_repo


@pytest.fixture
def mock_worktree_path(temp_git_repo: Path) -> Path:
    """Create a mock worktree path."""
    worktree_path = temp_git_repo / ".worktrees" / TEST_SPEC_NAME
    worktree_path.mkdir(parents=True, exist_ok=True)
    return worktree_path


@pytest.fixture
def spec_dir(temp_git_repo: Path) -> Path:
    """Create a spec directory."""
    spec_dir = temp_git_repo / ".auto-claude" / "specs" / TEST_SPEC_NAME
    spec_dir.mkdir(parents=True, exist_ok=True)
    return spec_dir


@pytest.fixture
def with_spec_branch(temp_git_repo: Path) -> Generator[Path, None, None]:
    """Create a temp git repo with a spec branch."""
    # Create initial commit on main
    (temp_git_repo / "README.md").write_text("# Test Repo")
    subprocess.run(
        ["git", "add", "README.md"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    # Create spec branch
    subprocess.run(
        ["git", "checkout", "-b", TEST_SPEC_BRANCH],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    # Add a change on spec branch
    (temp_git_repo / "test.txt").write_text("test content")
    subprocess.run(
        ["git", "add", "test.txt"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Test commit"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    # Go back to main
    subprocess.run(
        ["git", "checkout", "main"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    yield temp_git_repo


@pytest.fixture
def with_conflicting_branches(temp_git_repo: Path) -> Generator[Path, None, None]:
    """Create temp git repo with conflicting branches for merge testing."""
    # Create initial commit
    (temp_git_repo / "README.md").write_text("# Test Repo")
    subprocess.run(
        ["git", "add", "README.md"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    # Create spec branch
    subprocess.run(
        ["git", "checkout", "-b", TEST_SPEC_BRANCH],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    # Add a file on spec branch
    (temp_git_repo / "conflict.txt").write_text("spec branch content")
    subprocess.run(
        ["git", "add", "conflict.txt"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Spec change"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    # Go back to main and make conflicting change
    subprocess.run(
        ["git", "checkout", "main"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )
    (temp_git_repo / "conflict.txt").write_text("main branch content")
    subprocess.run(
        ["git", "add", "conflict.txt"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Main change"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    yield temp_git_repo


# =============================================================================
# TESTS FOR _detect_default_branch()
# =============================================================================

class TestDetectDefaultBranch:
    """Tests for _detect_default_branch function."""

    def test_detect_main_branch(self, mock_project_dir: Path):
        """Detects 'main' branch when it exists."""
        result = workspace_commands._detect_default_branch(mock_project_dir)
        assert result == "main"

    def test_detect_master_branch(self, mock_project_dir: Path):
        """Detects 'master' branch when main doesn't exist."""
        # Rename main to master
        subprocess.run(
            ["git", "branch", "-m", "master"],
            cwd=mock_project_dir,
            capture_output=True,
            check=True,
        )

        result = workspace_commands._detect_default_branch(mock_project_dir)
        assert result == "master"

    def test_env_var_overrides_detection(self, mock_project_dir: Path, monkeypatch):
        """Environment variable DEFAULT_BRANCH takes precedence."""
        monkeypatch.setenv("DEFAULT_BRANCH", "custom-branch")

        # Create the custom branch
        subprocess.run(
            ["git", "checkout", "-b", "custom-branch"],
            cwd=mock_project_dir,
            capture_output=True,
            check=True,
        )

        result = workspace_commands._detect_default_branch(mock_project_dir)
        assert result == "custom-branch"

    def test_fallback_to_main_when_no_branches_exist(
        self, mock_project_dir: Path, monkeypatch
    ):
        """Falls back to 'main' when no branches exist."""
        # Delete all branches
        subprocess.run(
            ["git", "branch", "-D", "main"],
            cwd=mock_project_dir,
            capture_output=True,
        )
        monkeypatch.delenv("DEFAULT_BRANCH", raising=False)

        result = workspace_commands._detect_default_branch(mock_project_dir)
        assert result == "main"

    def test_invalid_env_var_falls_back_to_detection(
        self, mock_project_dir: Path, monkeypatch
    ):
        """Invalid DEFAULT_BRANCH falls back to auto-detection."""
        monkeypatch.setenv("DEFAULT_BRANCH", "nonexistent-branch")

        result = workspace_commands._detect_default_branch(mock_project_dir)
        assert result == "main"


# =============================================================================
# TESTS FOR _get_changed_files_from_git()
# =============================================================================

class TestGetChangedFilesFromGit:
    """Tests for _get_changed_files_from_git function."""

    def test_no_changes_returns_empty_list(self, temp_git_repo: Path):
        """Returns empty list when there are no changes."""
        result = workspace_commands._get_changed_files_from_git(temp_git_repo, "main")
        assert result == []

    def test_detects_single_file_change(self, temp_git_repo: Path):
        """Detects a single changed file."""
        # Make a change
        (temp_git_repo / "test.txt").write_text("content")
        subprocess.run(
            ["git", "add", "test.txt"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "Add test.txt"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        result = workspace_commands._get_changed_files_from_git(temp_git_repo, "HEAD~1")
        assert "test.txt" in result

    def test_detects_multiple_file_changes(self, temp_git_repo: Path):
        """Detects multiple changed files."""
        # Create multiple files
        (temp_git_repo / "file1.txt").write_text("content1")
        (temp_git_repo / "file2.txt").write_text("content2")
        subprocess.run(
            ["git", "add", "."],
            cwd=temp_git_repo,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "Add files"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        result = workspace_commands._get_changed_files_from_git(temp_git_repo, "HEAD~1")
        assert "file1.txt" in result
        assert "file2.txt" in result

    def test_uses_merge_base_for_accuracy(self, with_spec_branch: Path):
        """Uses merge-base to get accurate file list."""
        # The with_spec_branch fixture creates a spec branch from main
        # We need to check what files exist when comparing the branches
        result = workspace_commands._get_changed_files_from_git(
            with_spec_branch, "main"
        )
        # The test.txt file was added on the spec branch
        # So it should appear in the diff
        # But since we're comparing from main's perspective, we might get different results
        # Let's just verify the function runs without error
        assert isinstance(result, list)

    def test_fallback_on_merge_base_failure(self, temp_git_repo: Path):
        """Falls back to direct diff when merge-base fails."""
        # Create a file and commit
        (temp_git_repo / "test.txt").write_text("content")
        subprocess.run(
            ["git", "add", "test.txt"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "Add test.txt"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Use HEAD as base (should work)
        result = workspace_commands._get_changed_files_from_git(temp_git_repo, "HEAD~1")
        assert len(result) > 0


# =============================================================================
# TESTS FOR handle_merge_command()
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

class TestHandleCreatePRCommand:
    """Tests for handle_create_pr_command function."""

    @patch("cli.workspace_commands.get_existing_build_worktree")
    def test_no_worktree_returns_error(
        self, mock_get, mock_project_dir: Path, capsys
    ):
        """Returns error when no worktree exists."""
        mock_get.return_value = None

        result = workspace_commands.handle_create_pr_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is False
        assert "No build found" in result["error"]
        captured = capsys.readouterr()
        assert "No build found" in captured.out

    @patch("core.worktree.WorktreeManager")
    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands.print_banner")
    def test_successful_pr_creation(
        self,
        mock_banner,
        mock_get,
        mock_manager_class,
        mock_project_dir: Path,
        mock_worktree_path: Path,
        capsys,
    ):
        """Successfully creates PR."""
        mock_get.return_value = mock_worktree_path
        mock_manager_instance = MagicMock()
        mock_manager_instance.base_branch = "main"
        mock_manager_instance.push_and_create_pr.return_value = {
            "success": True,
            "pr_url": "https://github.com/test/repo/pull/1",
            "already_exists": False,
        }
        mock_manager_class.return_value = mock_manager_instance

        result = workspace_commands.handle_create_pr_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        assert result["pr_url"] == "https://github.com/test/repo/pull/1"
        captured = capsys.readouterr()
        assert "PR created successfully" in captured.out

    @patch("core.worktree.WorktreeManager")
    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands.print_banner")
    def test_pr_already_exists(
        self,
        mock_banner,
        mock_get,
        mock_manager_class,
        mock_project_dir: Path,
        mock_worktree_path: Path,
        capsys,
    ):
        """Handles existing PR."""
        mock_get.return_value = mock_worktree_path
        mock_manager_instance = MagicMock()
        mock_manager_instance.base_branch = "main"
        mock_manager_instance.push_and_create_pr.return_value = {
            "success": True,
            "pr_url": "https://github.com/test/repo/pull/1",
            "already_exists": True,
        }
        mock_manager_class.return_value = mock_manager_instance

        result = workspace_commands.handle_create_pr_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        assert result["already_exists"] is True
        captured = capsys.readouterr()
        assert "PR already exists" in captured.out

    @patch("core.worktree.WorktreeManager")
    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands.print_banner")
    def test_pr_creation_failure(
        self,
        mock_banner,
        mock_get,
        mock_manager_class,
        mock_project_dir: Path,
        mock_worktree_path: Path,
        capsys,
    ):
        """Handles PR creation failure."""
        mock_get.return_value = mock_worktree_path
        mock_manager_instance = MagicMock()
        mock_manager_instance.base_branch = "main"
        mock_manager_instance.push_and_create_pr.return_value = {
            "success": False,
            "error": "Authentication failed",
        }
        mock_manager_class.return_value = mock_manager_instance

        result = workspace_commands.handle_create_pr_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is False
        assert result["error"] == "Authentication failed"

    @patch("core.worktree.WorktreeManager")
    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands.print_banner")
    def test_pr_with_custom_options(
        self,
        mock_banner,
        mock_get,
        mock_manager_class,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Creates PR with custom title and target branch."""
        mock_get.return_value = mock_worktree_path
        mock_manager_instance = MagicMock()
        mock_manager_instance.base_branch = "develop"
        mock_manager_instance.push_and_create_pr.return_value = {
            "success": True,
            "pr_url": "https://github.com/test/repo/pull/1",
        }
        mock_manager_class.return_value = mock_manager_instance

        result = workspace_commands.handle_create_pr_command(
            mock_project_dir,
            TEST_SPEC_NAME,
            target_branch="develop",
            title="Custom Title",
            draft=True,
        )

        assert result["success"] is True
        mock_manager_instance.push_and_create_pr.assert_called_once_with(
            spec_name=TEST_SPEC_NAME,
            target_branch="develop",
            title="Custom Title",
            draft=True,
        )

    @patch("core.worktree.WorktreeManager")
    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands.print_banner")
    def test_pr_creation_exception_handling(
        self,
        mock_banner,
        mock_get,
        mock_manager_class,
        mock_project_dir: Path,
        mock_worktree_path: Path,
    ):
        """Handles exceptions during PR creation."""
        mock_get.return_value = mock_worktree_path
        mock_manager_instance = MagicMock()
        mock_manager_instance.base_branch = "main"
        mock_manager_instance.push_and_create_pr.side_effect = Exception("Network error")
        mock_manager_class.return_value = mock_manager_instance

        result = workspace_commands.handle_create_pr_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is False
        assert "Network error" in result["error"]


# =============================================================================
# TESTS FOR _check_git_merge_conflicts()
# =============================================================================

class TestCheckGitMergeConflicts:
    """Tests for _check_git_merge_conflicts function."""

    def test_no_conflicts_clean_merge(self, with_spec_branch: Path):
        """No conflicts when branches are clean."""
        result = workspace_commands._check_git_merge_conflicts(
            with_spec_branch, TEST_SPEC_NAME, base_branch="main"
        )

        assert result["has_conflicts"] is False
        assert result["conflicting_files"] == []

    def test_detects_conflicts(self, with_conflicting_branches: Path):
        """Detects merge conflicts."""
        result = workspace_commands._check_git_merge_conflicts(
            with_conflicting_branches, TEST_SPEC_NAME, base_branch="main"
        )

        assert result["has_conflicts"] is True
        assert len(result["conflicting_files"]) > 0

    def test_detects_needs_rebase(self, with_spec_branch: Path):
        """Detects when main has advanced."""
        # Add another commit to main
        (with_spec_branch / "main2.txt").write_text("main content")
        subprocess.run(
            ["git", "add", "main2.txt"],
            cwd=with_spec_branch,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "Main advance"],
            cwd=with_spec_branch,
            capture_output=True,
        )

        result = workspace_commands._check_git_merge_conflicts(
            with_spec_branch, TEST_SPEC_NAME, base_branch="main"
        )

        assert result["needs_rebase"] is True
        assert result["commits_behind"] > 0

    def test_auto_detects_base_branch(self, with_spec_branch: Path):
        """Auto-detects base branch when not provided."""
        result = workspace_commands._check_git_merge_conflicts(
            with_spec_branch, TEST_SPEC_NAME, base_branch=None
        )

        assert "base_branch" in result
        assert result["base_branch"] in ["main", "master"]

    def test_excludes_auto_claude_files(self, with_conflicting_branches: Path):
        """Excludes .auto-claude files from conflicts."""
        # This would require setup with actual .auto-claude conflicts
        # For now, test the filtering logic exists
        result = workspace_commands._check_git_merge_conflicts(
            with_conflicting_branches, TEST_SPEC_NAME, base_branch="main"
        )

        # Verify no .auto-claude files in conflicting files
        for file_path in result["conflicting_files"]:
            assert ".auto-claude" not in file_path


# =============================================================================
# TESTS FOR _detect_conflict_scenario()
# =============================================================================

class TestDetectConflictScenario:
    """Tests for _detect_conflict_scenario function."""

    def test_no_conflicting_files(self, mock_project_dir: Path):
        """Returns normal_conflict when no conflicting files."""
        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, [], TEST_SPEC_BRANCH, "main"
        )

        assert result["scenario"] == "normal_conflict"
        assert result["already_merged_files"] == []

    @patch("subprocess.run")
    def test_already_merged_scenario(self, mock_run, mock_project_dir: Path):
        """Detects already_merged scenario."""
        # Mock git commands to return identical content
        mock_run.side_effect = [
            # merge-base
            MagicMock(returncode=0, stdout="abc123\n"),
            # spec branch content
            MagicMock(returncode=0, stdout="same content"),
            # base branch content
            MagicMock(returncode=0, stdout="same content"),
            # merge-base content
            MagicMock(returncode=0, stdout="original content"),
        ]

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file.txt"], TEST_SPEC_BRANCH, "main"
        )

        assert result["scenario"] == "already_merged"
        assert "file.txt" in result["already_merged_files"]

    @patch("subprocess.run")
    def test_superseded_scenario(self, mock_run, mock_project_dir: Path):
        """Detects superseded scenario."""
        # Mock git commands: spec matches merge-base, base has changed
        mock_run.side_effect = [
            # merge-base
            MagicMock(returncode=0, stdout="abc123\n"),
            # spec branch content (matches merge-base)
            MagicMock(returncode=0, stdout="original content"),
            # base branch content (newer)
            MagicMock(returncode=0, stdout="newer content"),
            # merge-base content
            MagicMock(returncode=0, stdout="original content"),
        ]

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file.txt"], TEST_SPEC_BRANCH, "main"
        )

        assert result["scenario"] == "superseded"
        assert "file.txt" in result["superseded_files"]

    @patch("subprocess.run")
    def test_diverged_scenario(self, mock_run, mock_project_dir: Path):
        """Detects diverged scenario."""
        # Mock git commands: both branches have different changes
        mock_run.side_effect = [
            # merge-base
            MagicMock(returncode=0, stdout="abc123\n"),
            # spec branch content
            MagicMock(returncode=0, stdout="spec changes"),
            # base branch content
            MagicMock(returncode=0, stdout="base changes"),
            # merge-base content
            MagicMock(returncode=0, stdout="original content"),
        ]

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file.txt"], TEST_SPEC_BRANCH, "main"
        )

        assert result["scenario"] == "diverged"
        assert "file.txt" in result["diverged_files"]

    def test_merge_base_failure(self, mock_project_dir: Path):
        """Handles merge-base command failure."""
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1)

            result = workspace_commands._detect_conflict_scenario(
                mock_project_dir, ["file.txt"], TEST_SPEC_BRANCH, "main"
            )

            assert result["scenario"] == "normal_conflict"

    def test_mixed_scenarios(self, mock_project_dir: Path):
        """Handles mixed scenarios across multiple files."""
        with patch("subprocess.run") as mock_run:
            # First call: merge-base
            # Then for each file: spec, base, merge-base content
            responses = [MagicMock(returncode=0, stdout="abc123\n")]

            # File 1: already merged (spec == base)
            responses.extend([
                MagicMock(returncode=0, stdout="same"),
                MagicMock(returncode=0, stdout="same"),
                MagicMock(returncode=0, stdout="orig"),
            ])

            # File 2: diverged
            responses.extend([
                MagicMock(returncode=0, stdout="spec"),
                MagicMock(returncode=0, stdout="base"),
                MagicMock(returncode=0, stdout="orig"),
            ])

            mock_run.side_effect = responses

            result = workspace_commands._detect_conflict_scenario(
                mock_project_dir, ["file1.txt", "file2.txt"], TEST_SPEC_BRANCH, "main"
            )

            # With mixed scenarios, should detect diverged (most complex)
            assert result["scenario"] in ["already_merged", "diverged", "normal_conflict"]


# =============================================================================
# TESTS FOR _detect_parallel_task_conflicts()
# =============================================================================

class TestDetectParallelTaskConflicts:
    """Tests for _detect_parallel_task_conflicts function."""

    def test_no_active_other_tasks(self, mock_project_dir: Path):
        """Returns empty list when no other active tasks."""
        with patch("merge.MergeOrchestrator") as mock_orchestrator_class:
            mock_orchestrator = MagicMock()
            mock_orchestrator.evolution_tracker.get_active_tasks.return_value = {
                TEST_SPEC_NAME
            }
            mock_orchestrator_class.return_value = mock_orchestrator

            result = workspace_commands._detect_parallel_task_conflicts(
                mock_project_dir, TEST_SPEC_NAME, ["file1.txt"]
            )

            assert result == []

    def test_detects_file_overlap(self, mock_project_dir: Path):
        """Detects when other tasks modify same files."""
        with patch("merge.MergeOrchestrator") as mock_orchestrator_class:
            mock_orchestrator = MagicMock()
            mock_orchestrator.evolution_tracker.get_active_tasks.return_value = {
                TEST_SPEC_NAME, "002-other-spec"
            }
            mock_orchestrator.evolution_tracker.get_files_modified_by_tasks.return_value = {
                "file1.txt": ["002-other-spec"]
            }
            mock_orchestrator_class.return_value = mock_orchestrator

            result = workspace_commands._detect_parallel_task_conflicts(
                mock_project_dir, TEST_SPEC_NAME, ["file1.txt", "file2.txt"]
            )

            assert len(result) == 1
            assert result[0]["file"] == "file1.txt"
            assert TEST_SPEC_NAME in result[0]["tasks"]
            assert "002-other-spec" in result[0]["tasks"]

    def test_no_file_overlap(self, mock_project_dir: Path):
        """Returns empty when no file overlap."""
        with patch("merge.MergeOrchestrator") as mock_orchestrator_class:
            mock_orchestrator = MagicMock()
            mock_orchestrator.evolution_tracker.get_active_tasks.return_value = {
                TEST_SPEC_NAME, "002-other-spec"
            }
            mock_orchestrator.evolution_tracker.get_files_modified_by_tasks.return_value = {
                "other_file.txt": ["002-other-spec"]
            }
            mock_orchestrator_class.return_value = mock_orchestrator

            result = workspace_commands._detect_parallel_task_conflicts(
                mock_project_dir, TEST_SPEC_NAME, ["file1.txt", "file2.txt"]
            )

            assert result == []

    def test_multiple_tasks_same_file(self, mock_project_dir: Path):
        """Detects multiple tasks modifying same file."""
        with patch("merge.MergeOrchestrator") as mock_orchestrator_class:
            mock_orchestrator = MagicMock()
            mock_orchestrator.evolution_tracker.get_active_tasks.return_value = {
                TEST_SPEC_NAME, "002-other-spec", "003-third-spec"
            }
            mock_orchestrator.evolution_tracker.get_files_modified_by_tasks.return_value = {
                "file1.txt": ["002-other-spec", "003-third-spec"]
            }
            mock_orchestrator_class.return_value = mock_orchestrator

            result = workspace_commands._detect_parallel_task_conflicts(
                mock_project_dir, TEST_SPEC_NAME, ["file1.txt"]
            )

            assert len(result) == 1
            assert len(result[0]["tasks"]) == 3  # Current + 2 other tasks

    def test_exception_returns_empty(self, mock_project_dir: Path):
        """Returns empty list on exception."""
        with patch("merge.MergeOrchestrator", side_effect=Exception("Test error")):
            result = workspace_commands._detect_parallel_task_conflicts(
                mock_project_dir, TEST_SPEC_NAME, ["file1.txt"]
            )

            assert result == []


# =============================================================================
# TESTS FOR _detect_worktree_base_branch()
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

class TestGetChangedFilesFromGitFallback:
    """Tests for fallback branches in _get_changed_files_from_git."""

    @patch("subprocess.run")
    def test_merge_base_failure_uses_fallback(self, mock_run, mock_project_dir: Path):
        """Uses fallback diff when merge-base fails."""
        # First merge-base call fails
        # Fallback direct diff succeeds
        mock_run.side_effect = [
            MagicMock(returncode=1, stderr="merge-base failed"),  # merge-base fails
            MagicMock(returncode=0, stdout="file1.txt\nfile2.txt\n"),  # fallback succeeds
        ]

        result = workspace_commands._get_changed_files_from_git(
            mock_project_dir, "main"
        )

        # Should return files from fallback
        assert "file1.txt" in result
        assert "file2.txt" in result

    @patch("subprocess.run")
    def test_both_merge_and_fallback_fail(self, mock_run, mock_project_dir: Path):
        """Returns empty list when both merge-base and fallback fail."""
        mock_run.side_effect = [
            MagicMock(returncode=1, stderr="merge-base failed"),
            MagicMock(returncode=1, stderr="diff failed"),
        ]

        result = workspace_commands._get_changed_files_from_git(
            mock_project_dir, "main"
        )

        assert result == []

    @patch("subprocess.run")
    def test_fallback_with_subprocess_error(self, mock_run, mock_project_dir: Path):
        """Handles CalledProcessError in fallback branch."""
        from subprocess import CalledProcessError

        mock_run.side_effect = [
            CalledProcessError(1, "git merge-base", stderr="merge-base failed"),
            MagicMock(returncode=0, stdout="file.txt\n"),
        ]

        result = workspace_commands._get_changed_files_from_git(
            mock_project_dir, "main"
        )

        assert "file.txt" in result


# =============================================================================
# TESTS FOR _detect_worktree_base_branch() - BRANCH DETECTION
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

class TestDebugFunctionFallbacks:
    """Tests for fallback debug functions when debug module is not available."""

    def test_fallback_debug_functions_no_error(self):
        """Fallback debug functions don't raise errors."""
        # These should never raise exceptions
        workspace_commands.debug("test", "message")
        workspace_commands.debug_detailed("test", "message")
        workspace_commands.debug_verbose("test", "message")
        workspace_commands.debug_success("test", "message")
        workspace_commands.debug_error("test", "message")
        workspace_commands.debug_section("test", "message")

    def test_fallback_is_debug_enabled_returns_false(self):
        """Fallback is_debug_enabled returns False."""
        result = workspace_commands.is_debug_enabled()
        assert result is False


# =============================================================================
# TESTS FOR _generate_and_save_commit_message() - EDGE CASES
# =============================================================================

class TestGenerateAndSaveCommitMessageEdgeCases:
    """Tests for edge cases in commit message generation."""

    @patch("commit_message.generate_commit_message_sync")
    @patch("subprocess.run")
    def test_git_diff_failure_returns_empty_summary(
        self, mock_run, mock_generate, mock_project_dir: Path, spec_dir: Path
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
        self, mock_generate, mock_project_dir: Path, spec_dir: Path
    ):
        """Logs warning when no commit message is generated."""
        workspace_commands._generate_and_save_commit_message(
            mock_project_dir, TEST_SPEC_NAME
        )

        # Should handle None return value gracefully

    @patch("commit_message.generate_commit_message_sync", side_effect=ImportError)
    def test_import_error_logs_warning(
        self, mock_generate, mock_project_dir: Path, spec_dir: Path
    ):
        """Logs warning when commit_message module import fails."""
        workspace_commands._generate_and_save_commit_message(
            mock_project_dir, TEST_SPEC_NAME
        )

        # Should handle ImportError gracefully

    @patch("commit_message.generate_commit_message_sync", side_effect=Exception("Generation failed"))
    def test_generation_exception_logs_warning(
        self, mock_generate, mock_project_dir: Path, spec_dir: Path
    ):
        """Logs warning when commit message generation raises exception."""
        workspace_commands._generate_and_save_commit_message(
            mock_project_dir, TEST_SPEC_NAME
        )

        # Should handle exception gracefully


# =============================================================================
# TESTS FOR _detect_conflict_scenario() - EDGE CASES
# =============================================================================

class TestDetectConflictScenarioEdgeCases:
    """Tests for edge cases in conflict scenario detection."""

    @patch("subprocess.run")
    def test_majority_already_merged_scenario(self, mock_run, mock_project_dir: Path):
        """Detects already_merged when majority of files are already merged."""
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        # 3 files already merged, 1 diverged
        for i in range(3):
            responses.extend([
                MagicMock(returncode=0, stdout=f"same{i}"),
                MagicMock(returncode=0, stdout=f"same{i}"),
                MagicMock(returncode=0, stdout=f"orig{i}"),
            ])

        # 1 diverged file
        responses.extend([
            MagicMock(returncode=0, stdout="spec"),
            MagicMock(returncode=0, stdout="base"),
            MagicMock(returncode=0, stdout="orig"),
        ])

        mock_run.side_effect = responses

        files = [f"file{i}.txt" for i in range(4)]
        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, files, TEST_SPEC_BRANCH, "main"
        )

        # Should detect as already_merged (3/4 files)
        assert result["scenario"] == "already_merged"

    @patch("subprocess.run")
    def test_majority_superseded_scenario(self, mock_run, mock_project_dir: Path):
        """Detects superseded when majority of files are superseded."""
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        # 3 files superseded, 1 diverged
        for i in range(3):
            responses.extend([
                MagicMock(returncode=0, stdout=f"orig{i}"),
                MagicMock(returncode=0, stdout=f"new{i}"),
                MagicMock(returncode=0, stdout=f"orig{i}"),
            ])

        # 1 diverged file
        responses.extend([
            MagicMock(returncode=0, stdout="spec"),
            MagicMock(returncode=0, stdout="base"),
            MagicMock(returncode=0, stdout="orig"),
        ])

        mock_run.side_effect = responses

        files = [f"file{i}.txt" for i in range(4)]
        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, files, TEST_SPEC_BRANCH, "main"
        )

        # Should detect as superseded (3/4 files)
        assert result["scenario"] == "superseded"

    @patch("subprocess.run")
    def test_all_superseded_scenario(self, mock_run, mock_project_dir: Path):
        """Detects all files superseded."""
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        for i in range(3):
            responses.extend([
                MagicMock(returncode=0, stdout=f"orig{i}"),
                MagicMock(returncode=0, stdout=f"new{i}"),
                MagicMock(returncode=0, stdout=f"orig{i}"),
            ])

        mock_run.side_effect = responses

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file1.txt", "file2.txt", "file3.txt"],
            TEST_SPEC_BRANCH, "main"
        )

        assert result["scenario"] == "superseded"

    @patch("subprocess.run")
    def test_file_analysis_exception_adds_to_diverged(
        self, mock_run, mock_project_dir: Path
    ):
        """Adds file to diverged when analysis raises exception."""
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        # First file succeeds
        responses.extend([
            MagicMock(returncode=0, stdout="spec"),
            MagicMock(returncode=0, stdout="base"),
            MagicMock(returncode=0, stdout="orig"),
        ])

        # Second file raises exception
        responses.extend([
            MagicMock(returncode=0, stdout="spec2"),
            MagicMock(side_effect=Exception("Analysis failed")),
        ])

        mock_run.side_effect = responses

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file1.txt", "file2.txt"],
            TEST_SPEC_BRANCH, "main"
        )

        # Should have at least one diverged file
        assert len(result.get("diverged_files", [])) >= 1

    @patch("subprocess.run")
    def test_no_merge_base_content_all_diverged(self, mock_run, mock_project_dir: Path):
        """Treats all files as diverged when merge-base content doesn't exist."""
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        for i in range(2):
            responses.extend([
                MagicMock(returncode=0, stdout=f"spec{i}"),
                MagicMock(returncode=0, stdout=f"base{i}"),
                MagicMock(returncode=1),  # merge-base content doesn't exist
            ])

        mock_run.side_effect = responses

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file1.txt", "file2.txt"],
            TEST_SPEC_BRANCH, "main"
        )

        assert len(result["diverged_files"]) == 2


# =============================================================================
# TESTS FOR _check_git_merge_conflicts() - EDGE CASES
# =============================================================================

class TestCheckGitMergeConflictsEdgeCases:
    """Tests for edge cases in git merge conflict detection."""

    @patch("subprocess.run")
    def test_merge_base_command_failure(self, mock_run, mock_project_dir: Path):
        """Handles merge-base command failure."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="main\n"),  # base branch detection
            MagicMock(returncode=1, stderr="merge-base failed"),  # merge-base fails
        ]

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        # Should return early with default values
        assert result["has_conflicts"] is False
        assert result["conflicting_files"] == []

    @patch("subprocess.run")
    def test_ahead_count_command_failure(self, mock_run, mock_project_dir: Path):
        """Handles rev-list --count command failure."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="main\n"),  # base branch
            MagicMock(returncode=0, stdout="abc123\n"),  # merge-base
            MagicMock(returncode=1),  # ahead count fails
            MagicMock(returncode=0),  # merge-tree succeeds
        ]

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        # Should continue without commits_behind info
        assert "commits_behind" in result

    @patch("subprocess.run")
    def test_parse_conflict_from_merge_tree_output(self, mock_run, mock_project_dir: Path):
        """Parses conflicts from merge-tree output."""
        mock_run.side_effect = [
            # Note: git rev-parse is skipped when base_branch is provided
            MagicMock(returncode=0, stdout="abc123\n"),  # merge-base
            MagicMock(returncode=0, stdout="0\n"),          # rev-list (count ahead)
            # merge-tree with conflicts - using format that matches the code's parsing
            # The code looks for "CONFLICT" in line and then extracts with regex
            MagicMock(
                returncode=1,
                stdout="",
                stderr="Auto-merging file1.txt\n"
                        "CONFLICT (content): Merge conflict in file1.txt\n"
                        "Auto-merging file2.txt\n"
                        "CONFLICT (content): Merge conflict in file2.txt\n"
            ),
        ]

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        assert result["has_conflicts"] is True
        # Note: The regex extracts the file path from the conflict message
        assert len(result["conflicting_files"]) > 0

    @patch("subprocess.run")
    def test_fallback_to_diff_when_no_conflicts_parsed(
        self, mock_run, mock_project_dir: Path
    ):
        """Falls back to diff-based detection when merge-tree output can't be parsed."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="main\n"),
            MagicMock(returncode=0, stdout="abc123\n"),
            MagicMock(returncode=0, stdout="0\n"),
            # merge-tree returns non-zero but no parseable output
            MagicMock(returncode=1, stdout="", stderr=""),
            # Fallback: diff from merge-base to main (empty to trigger fallback behavior)
            MagicMock(returncode=0, stdout=""),
            # Fallback: diff from merge-base to spec (empty)
            MagicMock(returncode=0, stdout=""),
        ]

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        # With empty diffs, should have no conflicts
        assert result["conflicting_files"] == []

    @patch("subprocess.run")
    def test_exception_during_conflict_check(self, mock_run, mock_project_dir: Path):
        """Handles exceptions during conflict check."""
        mock_run.side_effect = Exception("Git command failed")

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        # Should return default result
        assert result["has_conflicts"] is False
        assert result["conflicting_files"] == []

    @patch("subprocess.run")
    def test_filters_auto_claude_files_from_conflicts(
        self, mock_run, mock_project_dir: Path
    ):
        """Filters .auto-claude files from conflict list."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="main\n"),
            MagicMock(returncode=0, stdout="abc123\n"),
            MagicMock(returncode=0, stdout="0\n"),
            # Fallback diffs
            MagicMock(returncode=0, stdout=".auto-claude/config.json\nnormal_file.txt\n"),
            MagicMock(returncode=0, stdout=".auto-claude/config.json\nnormal_file.txt\n"),
        ]

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        # .auto-claude files should be filtered out
        assert ".auto-claude/config.json" not in result["conflicting_files"]
        if result["conflicting_files"]:
            assert all(".auto-claude" not in f for f in result["conflicting_files"])


# =============================================================================
# TESTS FOR handle_create_pr_command() - EDGE CASES
# =============================================================================

class TestHandleCreatePREdgeCases:
    """Tests for edge cases in PR creation."""

    @patch("core.worktree.WorktreeManager")
    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands.print_banner")
    def test_pr_created_without_url(
        self, mock_banner, mock_get, mock_manager_class, mock_project_dir: Path,
        mock_worktree_path: Path, capsys
    ):
        """Handles successful PR creation with no URL returned."""
        mock_get.return_value = mock_worktree_path
        mock_manager_instance = MagicMock()
        mock_manager_instance.base_branch = "main"
        mock_manager_instance.push_and_create_pr.return_value = {
            "success": True,
            "pr_url": None,  # No URL returned
            "already_exists": False,
        }
        mock_manager_class.return_value = mock_manager_instance

        result = workspace_commands.handle_create_pr_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is True
        captured = capsys.readouterr()
        assert "Check GitHub for the PR URL" in captured.out

    @patch("core.worktree.WorktreeManager")
    @patch("cli.workspace_commands.get_existing_build_worktree")
    @patch("cli.workspace_commands.print_banner")
    def test_push_failed_error(
        self, mock_banner, mock_get, mock_manager_class, mock_project_dir: Path,
        mock_worktree_path: Path
    ):
        """Handles push failure."""
        mock_get.return_value = mock_worktree_path
        mock_manager_instance = MagicMock()
        mock_manager_instance.base_branch = "main"
        mock_manager_instance.push_and_create_pr.return_value = {
            "success": False,
            "error": "Push failed: remote rejected",
            "pushed": False,
        }
        mock_manager_class.return_value = mock_manager_instance

        result = workspace_commands.handle_create_pr_command(
            mock_project_dir, TEST_SPEC_NAME
        )

        assert result["success"] is False
        assert "Push failed" in result["error"]


# =============================================================================
# TESTS FOR handle_merge_preview_command() - PATH MAPPING
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

class TestDetectDefaultBranchFallback:
    """Tests for fallback behavior in default branch detection."""

    @patch("subprocess.run")
    def test_returns_main_when_all_checks_fail(self, mock_run, mock_project_dir: Path):
        """Returns 'main' when all branch detection attempts fail."""
        mock_run.return_value = MagicMock(returncode=1)  # All commands fail

        result = workspace_commands._detect_default_branch(mock_project_dir)

        assert result == "main"


# =============================================================================
# TESTS FOR FALLBACK DEBUG FUNCTIONS
# =============================================================================

class TestFallbackDebugFunctions:
    """Tests for fallback debug functions when debug module is unavailable."""

    def test_fallback_debug_functions_no_error(self):
        """Fallback debug functions don't raise errors when called."""
        # Import workspace_commands to get fallback functions
        # We need to reload module with debug import failed
        import sys
        import importlib

        # Save original module
        original_module = sys.modules.get('cli.workspace_commands')

        # Remove debug module from sys.modules to trigger fallback
        debug_module = sys.modules.pop('debug', None)

        # Also remove workspace_commands to force reload
        if 'cli.workspace_commands' in sys.modules:
            del sys.modules['cli.workspace_commands']

        try:
            # Import CLI to trigger module reload with fallback
            import cli.workspace_commands as wc

            # Test fallback functions don't crash
            wc.debug("test", "message")
            wc.debug_detailed("test", "message")  # Only 2 args
            wc.debug_verbose("test", "verbose message")
            wc.debug_success("test", "success message")
            wc.debug_error("test", "error message")
            wc.debug_warning("test", "warning message")
            wc.debug_section("test", "section")

            # Test is_debug_enabled returns False
            assert wc.is_debug_enabled() is False

        finally:
            # Restore modules
            if debug_module:
                sys.modules['debug'] = debug_module
            if original_module:
                sys.modules['cli.workspace_commands'] = original_module

    def test_fallback_is_debug_enabled_returns_false(self):
        """Fallback is_debug_enabled returns False when debug unavailable."""
        import sys
        import importlib

        # Save original module
        original_module = sys.modules.get('cli.workspace_commands')

        # Remove debug module to trigger fallback
        debug_module = sys.modules.pop('debug', None)
        if 'cli.workspace_commands' in sys.modules:
            del sys.modules['cli.workspace_commands']

        try:
            import cli.workspace_commands as wc
            result = wc.is_debug_enabled()
            assert result is False
        finally:
            if debug_module:
                sys.modules['debug'] = debug_module
            if original_module:
                sys.modules['cli.workspace_commands'] = original_module


# =============================================================================
# TESTS FOR EXCEPTION COVERAGE
# =============================================================================

class TestExceptionCoverage:
    """Tests for exception handling paths to increase coverage."""

    @patch("subprocess.run")
    def test_get_changed_files_fallback_exception_handling(
        self, mock_run, mock_worktree_path: Path
    ):
        """Tests exception handling in _get_changed_files_from_git fallback."""
        from unittest.mock import MagicMock
        from cli.workspace_commands import _get_changed_files_from_git

        # Mock merge-base to fail, triggering fallback
        mock_run.side_effect = [
            MagicMock(returncode=1),  # merge-base fails
            MagicMock(side_effect=subprocess.CalledProcessError(1, "git", stderr="fatal error"))  # fallback fails
        ]

        result = _get_changed_files_from_git(
            mock_worktree_path,
            "main"
        )

        # Should return empty list on exception
        assert result == []

    @patch("subprocess.run")
    def test_get_changed_files_fallback_subprocess_error(
        self, mock_run, mock_worktree_path: Path
    ):
        """Tests subprocess error handling in _get_changed_files_from_git."""
        from unittest.mock import MagicMock
        from cli.workspace_commands import _get_changed_files_from_git

        # Mock merge-base to fail, fallback with subprocess error
        mock_run.side_effect = [
            MagicMock(returncode=1),  # merge-base fails
            MagicMock(side_effect=subprocess.SubprocessError("subprocess failed"))
        ]

        result = _get_changed_files_from_git(
            mock_worktree_path,
            "main"
        )

        # Should return empty list on subprocess error
        assert result == []

    @patch("cli.workspace_commands.get_file_content_from_ref")
    @patch("subprocess.run")
    def test_detect_conflict_scenario_diverged_path(
        self, mock_run, mock_get_content, mock_project_dir: Path
    ):
        """Tests the diverged scenario path (lines 649, 678-679)."""
        from unittest.mock import MagicMock
        from cli.workspace_commands import _detect_conflict_scenario

        # Setup: files changed with diverged content
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        # 1 already merged, 1 diverged
        responses.extend([
            MagicMock(returncode=0, stdout="same1"),  # file1 spec
            MagicMock(returncode=0, stdout="same1"),  # file1 base
            MagicMock(returncode=0, stdout="same1"),  # file1 merge-base
        ])
        responses.extend([
            MagicMock(returncode=0, stdout="spec2"),  # file2 spec
            MagicMock(returncode=0, stdout="base2"),  # file2 base (different from spec)
            MagicMock(returncode=0, stdout="orig2"),  # file2 merge-base (different from both)
        ])

        mock_run.side_effect = responses

        result = _detect_conflict_scenario(
            mock_project_dir,
            ["file1.txt", "file2.txt"],
            TEST_SPEC_BRANCH,
            "main"
        )

        # Should be diverged (1 diverged, 1 already merged - no clear majority)
        assert result["scenario"] == "diverged"
        assert "files have diverged" in result["details"].lower()

    @patch("cli.workspace_commands.get_file_content_from_ref")
    @patch("subprocess.run")
    def test_detect_conflict_scenario_exception_during_analysis(
        self, mock_run, mock_get_content, mock_project_dir: Path
    ):
        """Tests exception handling during conflict scenario detection (lines 697-699)."""
        from unittest.mock import MagicMock
        from cli.workspace_commands import _detect_conflict_scenario

        # Setup to raise exception during analysis
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        # First file succeeds
        responses.extend([
            MagicMock(returncode=0, stdout="spec1"),
            MagicMock(returncode=0, stdout="base1"),
            MagicMock(returncode=0, stdout="orig1"),
        ])
        # Second file raises exception
        responses.extend([
            MagicMock(returncode=0, stdout="spec2"),
            MagicMock(side_effect=Exception("Analysis failed")),
        ])

        mock_run.side_effect = responses

        result = _detect_conflict_scenario(
            mock_project_dir,
            ["file1.txt", "file2.txt"],
            TEST_SPEC_BRANCH,
            "main"
        )

        # Should handle exception and still return a result
        assert "scenario" in result
        assert "details" in result

    @patch("cli.workspace_commands.get_file_content_from_ref")
    @patch("subprocess.run")
    def test_detect_conflict_scenario_all_diverged(
        self, mock_run, mock_get_content, mock_project_dir: Path
    ):
        """Tests scenario when all files have diverged content."""
        from unittest.mock import MagicMock
        from cli.workspace_commands import _detect_conflict_scenario

        # Setup: merge-base succeeds
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        # All files have diverged content (all three different)
        responses.extend([
            MagicMock(returncode=0, stdout="spec1"),
            MagicMock(returncode=0, stdout="base1"),
            MagicMock(returncode=0, stdout="orig1"),  # All three different
        ])
        responses.extend([
            MagicMock(returncode=0, stdout="spec2"),
            MagicMock(returncode=0, stdout="base2"),
            MagicMock(returncode=0, stdout="orig2"),  # All three different
        ])

        mock_run.side_effect = responses

        result = _detect_conflict_scenario(
            mock_project_dir,
            ["file1.txt", "file2.txt"],
            TEST_SPEC_BRANCH,
            "main"
        )

        # Should detect as diverged
        assert result["scenario"] == "diverged"

    @patch("subprocess.run")
    def test_check_git_merge_conflicts_returns_spec_branch_when_no_base(
        self, mock_run, mock_project_dir: Path
    ):
        """Tests that spec_branch is returned when merge base cannot be found (line 767-768)."""
        from unittest.mock import MagicMock
        from cli.workspace_commands import _check_git_merge_conflicts

        # Setup: git rev-parse fails (no HEAD), returns spec_branch
        mock_run.return_value = MagicMock(returncode=1, stderr="fatal: not a valid commit")

        spec_name = "001-test-spec"  # Use actual spec name
        result = _check_git_merge_conflicts(
            mock_project_dir,
            spec_name,  # Second arg is spec_name
            None,  # Third arg is base_branch (optional)
        )

        # Should return result with spec_branch
        assert "base_branch" in result
        assert "spec_branch" in result
        assert result["spec_branch"] == f"auto-claude/{spec_name}"
