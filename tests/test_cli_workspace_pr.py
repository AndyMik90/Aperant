#!/usr/bin/env python3
"""
Tests for CLI Workspace PR Commands
===================================

Tests handle_create_pr_command() functionality.
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
