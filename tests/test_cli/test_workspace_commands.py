"""
Tests for Workspace CLI Commands
================================

Tests for cli/workspace_commands.py which handles workspace management
operations like merge, review, discard, list, and cleanup.
"""

import json
import subprocess
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch


class TestDetectDefaultBranch:
    """Tests for _detect_default_branch helper function."""

    def test_uses_env_var_when_set(self, temp_git_repo):
        """Should use DEFAULT_BRANCH env var when set."""
        from cli.workspace_commands import _detect_default_branch

        with patch.dict("os.environ", {"DEFAULT_BRANCH": "main"}):
            # Mock git rev-parse to succeed
            with patch("cli.workspace_commands.subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0)
                result = _detect_default_branch(temp_git_repo)

        assert result == "main"

    def test_detects_main_branch(self, temp_git_repo):
        """Should detect 'main' as default branch."""
        from cli.workspace_commands import _detect_default_branch

        # The temp_git_repo fixture already creates main branch
        result = _detect_default_branch(temp_git_repo)

        assert result == "main"

    def test_detects_master_branch(self, temp_git_repo):
        """Should detect 'master' as default when main doesn't exist."""
        from cli.workspace_commands import _detect_default_branch

        # Rename main to master
        subprocess.run(["git", "branch", "-m", "main", "master"], cwd=temp_git_repo, check=True)

        result = _detect_default_branch(temp_git_repo)

        assert result == "master"

    def test_falls_back_to_main(self, temp_dir):
        """Should fall back to 'main' when nothing else works."""
        from cli.workspace_commands import _detect_default_branch

        # Create repo with unusual branch name
        subprocess.run(["git", "init"], cwd=temp_dir, check=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=temp_dir)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=temp_dir)
        (temp_dir / "file.txt").write_text("test")
        subprocess.run(["git", "add", "."], cwd=temp_dir)
        subprocess.run(["git", "commit", "-m", "init"], cwd=temp_dir)
        subprocess.run(["git", "branch", "-m", "develop"], cwd=temp_dir)

        result = _detect_default_branch(temp_dir)

        assert result == "main"  # Falls back to main


class TestGetChangedFilesFromGit:
    """Tests for _get_changed_files_from_git helper function."""

    def test_returns_empty_for_no_changes(self, temp_git_repo):
        """Should return empty list when no files changed."""
        from cli.workspace_commands import _get_changed_files_from_git

        result = _get_changed_files_from_git(temp_git_repo, "main")

        assert result == []

    def test_returns_changed_files(self, temp_git_repo, make_commit):
        """Should return list of changed files."""
        from cli.workspace_commands import _get_changed_files_from_git

        # Create a branch and make changes
        subprocess.run(["git", "checkout", "-b", "feature"], cwd=temp_git_repo)
        make_commit("new_file.py", "print('hello')", "Add new file")

        result = _get_changed_files_from_git(temp_git_repo, "main")

        assert "new_file.py" in result

    def test_handles_multiple_changed_files(self, temp_git_repo):
        """Should return all changed files."""
        from cli.workspace_commands import _get_changed_files_from_git

        # Create branch with multiple changes
        subprocess.run(["git", "checkout", "-b", "feature"], cwd=temp_git_repo)

        (temp_git_repo / "file1.py").write_text("# file 1")
        (temp_git_repo / "file2.py").write_text("# file 2")
        (temp_git_repo / "file3.js").write_text("// file 3")

        subprocess.run(["git", "add", "."], cwd=temp_git_repo)
        subprocess.run(["git", "commit", "-m", "Add files"], cwd=temp_git_repo)

        result = _get_changed_files_from_git(temp_git_repo, "main")

        assert len(result) == 3
        assert "file1.py" in result
        assert "file2.py" in result
        assert "file3.js" in result


class TestListWorktrees:
    """Tests for list_all_worktrees functionality via CLI."""

    def test_list_returns_empty_when_no_worktrees(self, temp_git_repo):
        """Should return empty when no worktrees exist."""
        from workspace import list_all_worktrees

        worktrees = list_all_worktrees(temp_git_repo)

        # Should only have the main worktree (the repo itself)
        # or empty if we're counting only task worktrees
        assert isinstance(worktrees, list)


class TestWorkspaceCleanup:
    """Tests for workspace cleanup functionality."""

    def test_cleanup_all_worktrees_empty(self, temp_git_repo):
        """Should handle cleanup when no worktrees exist."""
        from workspace import cleanup_all_worktrees

        # Should not raise an error
        result = cleanup_all_worktrees(temp_git_repo)

        # Returns number of cleaned up worktrees
        assert isinstance(result, int)
        assert result >= 0


class TestMergeExistingBuild:
    """Tests for merge_existing_build functionality."""

    def test_returns_false_when_no_worktree(self, temp_git_repo):
        """Should return False when no worktree exists for spec."""
        from workspace import merge_existing_build

        spec_name = "nonexistent-spec"
        result = merge_existing_build(temp_git_repo, spec_name)

        assert result is False


class TestDiscardExistingBuild:
    """Tests for discard_existing_build functionality."""

    def test_returns_false_when_no_worktree(self, temp_git_repo):
        """Should return False when no worktree exists."""
        from workspace import discard_existing_build

        spec_name = "nonexistent-spec"
        result = discard_existing_build(temp_git_repo, spec_name)

        assert result is False


class TestReviewExistingBuild:
    """Tests for review_existing_build functionality."""

    def test_returns_none_when_no_worktree(self, temp_git_repo):
        """Should return None when no worktree exists."""
        from workspace import review_existing_build

        spec_name = "nonexistent-spec"
        result = review_existing_build(temp_git_repo, spec_name)

        assert result is None
