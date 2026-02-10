#!/usr/bin/env python3
"""
Tests for Workspace Rebase Operations
======================================

Tests the rebase functionality including:
- Rebase detection (_check_git_conflicts)
- Spec branch rebase operations
- Rebase integration tests
- Rebase error handling
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from worktree import WorktreeError, WorktreeManager

# Test constant - in the new per-spec architecture, each spec has its own worktree
# named after the spec itself. This constant is used for test assertions.
TEST_SPEC_NAME = "test-spec"


class TestRebaseDetection:
    def test_check_git_conflicts_detects_branch_behind(self, temp_git_repo: Path):
        """_check_git_conflicts detects when spec branch is behind base branch (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Create a spec branch
        spec_branch = "auto-claude/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to spec branch
        (temp_git_repo / "spec-file.txt").write_text("spec content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Go back to main and add a commit (making spec branch behind)
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "main-file.txt").write_text("main content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main commit after spec"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Check git conflicts - should detect spec branch is behind
        result = _check_git_conflicts(temp_git_repo, "test-spec")

        assert result is not None
        assert result.get("needs_rebase") is True, "Should detect branch is behind"
        assert result.get("commits_behind") == 1, (
            "Should count commits behind correctly"
        )
        assert result.get("spec_branch") == spec_branch

    def test_check_git_conflicts_no_commits_behind(self, temp_git_repo: Path):
        """_check_git_conflicts returns commits_behind=0 when branch is up to date (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Create a spec branch that's ahead (not behind)
        spec_branch = "auto-claude/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "spec-file.txt").write_text("spec content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Switch back to main before checking conflicts
        # (otherwise _check_git_conflicts would compare spec to itself)
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Check git conflicts - spec branch is ahead, not behind
        result = _check_git_conflicts(temp_git_repo, "test-spec")

        assert result is not None
        assert result.get("needs_rebase") is False, "Should not need rebase when ahead"
        assert result.get("commits_behind") == 0, "Should have 0 commits behind"

    def test_check_git_conflicts_multiple_commits_behind(self, temp_git_repo: Path):
        """_check_git_conflicts correctly counts multiple commits behind (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Create a spec branch
        spec_branch = "auto-claude/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to spec branch
        (temp_git_repo / "spec-file.txt").write_text("spec content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Go back to main and add multiple commits
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        for i in range(3):
            (temp_git_repo / f"main-file-{i}.txt").write_text(
                f"main content {i}", encoding="utf-8"
            )
            subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", f"Main commit {i}"],
                cwd=temp_git_repo,
                capture_output=True,
            )

        # Check git conflicts - should detect 3 commits behind
        result = _check_git_conflicts(temp_git_repo, "test-spec")

        assert result is not None
        assert result.get("needs_rebase") is True
        assert result.get("commits_behind") == 3, "Should count all commits behind"


class TestRebaseSpecBranch:
    """Tests for _rebase_spec_branch function (ACS-224)."""

    def test_rebase_spec_branch_clean_rebase(self, temp_git_repo: Path):
        """_rebase_spec_branch successfully rebases clean branch (ACS-224)."""
        from core.workspace import _rebase_spec_branch

        # Create a spec branch
        spec_branch = "auto-claude/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to spec branch
        (temp_git_repo / "spec-file.txt").write_text("spec content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to main (making spec behind)
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "main-file.txt").write_text("main content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Get spec branch commit before rebase
        before_commit = subprocess.run(
            ["git", "rev-parse", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        ).stdout.strip()

        # Rebase the spec branch
        result = _rebase_spec_branch(temp_git_repo, "test-spec", "main")

        assert result is True, "Rebase should succeed"

        # Get spec branch commit after rebase
        after_commit = subprocess.run(
            ["git", "rev-parse", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        ).stdout.strip()

        # Commits should be different (rebase changed the commit hash)
        assert before_commit != after_commit, "Rebase should change commit hash"

        # Verify spec branch now has main's commit in its history
        log = subprocess.run(
            ["git", "log", "--oneline", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        ).stdout
        assert "Main commit" in log, "Spec branch should have main commit after rebase"

    def test_rebase_spec_branch_with_conflicts_aborts_cleanly(
        self, temp_git_repo: Path
    ):
        """_rebase_spec_branch handles conflicts by aborting and returning False (ACS-224)."""
        from core.workspace import _rebase_spec_branch

        # Create a spec branch
        spec_branch = "auto-claude/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Create a file that will conflict
        (temp_git_repo / "conflict.txt").write_text("spec version", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec conflict"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Modify the same file on main
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "conflict.txt").write_text("main version", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main conflict"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Rebase should handle conflict by aborting
        result = _rebase_spec_branch(temp_git_repo, "test-spec", "main")

        # Should return False (rebase was aborted due to conflicts, no ref movement)
        assert result is False, "Rebase with conflicts should return False after abort"

        # Verify we're not in a rebase state (was aborted)
        # Check both possible rebase state directories across git versions
        rebase_merge_dir = temp_git_repo / ".git" / "rebase-merge"
        rebase_apply_dir = temp_git_repo / ".git" / "rebase-apply"
        assert not rebase_merge_dir.exists(), (
            "Should not be in rebase-merge state after abort"
        )
        assert not rebase_apply_dir.exists(), (
            "Should not be in rebase-apply state after abort"
        )

    def test_rebase_spec_branch_invalid_branch(self, temp_git_repo: Path):
        """_rebase_spec_branch handles invalid branch gracefully (ACS-224)."""
        from core.workspace import _rebase_spec_branch

        # Try to rebase a non-existent spec branch
        result = _rebase_spec_branch(temp_git_repo, "nonexistent-spec", "main")

        assert result is False, "Rebase of non-existent branch should fail"

        # NEW-004: Verify repo state after failure - should be clean and unchanged
        # (1) Current branch should still be 'main'
        current_branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert current_branch.stdout.strip() == "main", "Should still be on main branch"

        # (2) No rebase state directories should exist
        rebase_merge_dir = temp_git_repo / ".git" / "rebase-merge"
        rebase_apply_dir = temp_git_repo / ".git" / "rebase-apply"
        assert not rebase_merge_dir.exists(), "Should not be in rebase-merge state"
        assert not rebase_apply_dir.exists(), "Should not be in rebase-apply state"

        # (3) Git status should show clean state
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert status_result.stdout.strip() == "", "Git status should be clean"

    def test_rebase_spec_branch_already_up_to_date(self, temp_git_repo: Path):
        """_rebase_spec_branch returns True when spec branch is already up-to-date (ACS-224)."""
        from core.workspace import _rebase_spec_branch

        # Create a spec branch and add a commit
        spec_branch = "auto-claude/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "spec-file.txt").write_text("spec content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Switch back to main (no new commits added to main)
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Spec branch is ahead of main (not behind), so rebase should return True
        # (branch already up-to-date is a success condition)
        result = _rebase_spec_branch(temp_git_repo, "test-spec", "main")

        assert result is True, (
            "Rebase should return True when branch is already up-to-date"
        )


class TestRebaseIntegration:
    """Integration tests for automatic rebase in merge flow (ACS-224)."""

    def test_smart_merge_auto_rebases_when_behind(self, temp_git_repo: Path):
        """Smart merge automatically rebases spec branch when behind (ACS-224)."""
        from core.workspace import merge_existing_build

        # Create a spec worktree
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        worker_info = manager.create_worktree("test-spec")

        # Add a file in spec worktree and commit
        (worker_info.path / "spec-file.txt").write_text(
            "spec content", encoding="utf-8"
        )
        subprocess.run(["git", "add", "."], cwd=worker_info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=worker_info.path,
            capture_output=True,
        )

        # Add commits to main (making spec branch behind)
        subprocess.run(
            ["git", "checkout", manager.base_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        for i in range(2):
            (temp_git_repo / f"main-{i}.txt").write_text(f"main {i}", encoding="utf-8")
            subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", f"Main {i}"],
                cwd=temp_git_repo,
                capture_output=True,
            )

        # Merge should succeed (auto-rebase + merge)
        result = merge_existing_build(
            temp_git_repo,
            "test-spec",
            no_commit=True,
            use_smart_merge=True,
        )

        # Merge should return True (success)
        assert result is True, "Merge with auto-rebase should succeed"

    def test_check_git_conflicts_with_diverged_branches(self, temp_git_repo: Path):
        """_check_git_conflicts correctly detects diverged branches (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Create a spec branch
        spec_branch = "auto-claude/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to spec
        (temp_git_repo / "spec.txt").write_text("spec", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add different commits to main
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "main.txt").write_text("main", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Check git conflicts
        result = _check_git_conflicts(temp_git_repo, "test-spec")

        assert result is not None
        assert result.get("needs_rebase") is True
        assert result.get("commits_behind") == 1
        assert result.get("base_branch") == "main"
        assert result.get("spec_branch") == spec_branch


class TestRebaseErrorHandling:
    """Tests for rebase error handling (ACS-224)."""

    def test_check_git_conflicts_handles_invalid_spec(self, temp_git_repo: Path):
        """_check_git_conflicts handles non-existent spec branch gracefully (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Check conflicts for non-existent spec
        result = _check_git_conflicts(temp_git_repo, "nonexistent-spec")

        # Should return a valid dict structure even for non-existent branch
        assert result is not None
        assert "needs_rebase" in result
        assert "commits_behind" in result
        assert result.get("needs_rebase") is False
        assert result.get("commits_behind") == 0

    def test_check_git_conflicts_handles_detached_head(self, temp_git_repo: Path):
        """_check_git_conflicts handles detached HEAD state gracefully (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Create a spec branch first
        spec_branch = "auto-claude/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "spec-file.txt").write_text("spec content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Get the commit hash and checkout to detached HEAD state
        commit_result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        commit_hash = commit_result.stdout.strip()
        subprocess.run(
            ["git", "checkout", commit_hash],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Check conflicts while in detached HEAD state
        result = _check_git_conflicts(temp_git_repo, "test-spec")

        # Should return a valid dict structure with safe defaults
        assert result is not None
        assert "needs_rebase" in result
        assert "commits_behind" in result
        # In detached HEAD, base_branch will be "HEAD" and results may vary
        # The important thing is it doesn't crash

        # Cleanup: return to main branch
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )

    def test_check_git_conflicts_handles_corrupted_repo(self, temp_git_repo: Path):
        """_check_git_conflicts handles corrupted repo metadata gracefully (ACS-224)."""

        from core.workspace import _check_git_conflicts

        # Create a spec branch
        spec_branch = "auto-claude/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "spec-file.txt").write_text("spec content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Return to main
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Backup .git directory
        git_dir = temp_git_repo / ".git"
        backup_dir = temp_git_repo / ".git.backup"

        try:
            # Simulate corrupted repo by temporarily moving .git
            shutil.move(str(git_dir), str(backup_dir))

            # Check conflicts should handle gracefully (no exception)
            result = _check_git_conflicts(temp_git_repo, "test-spec")

            # Should return a valid dict structure with default/false values
            assert result is not None
            assert "needs_rebase" in result
            assert "commits_behind" in result
            # When repo is corrupted, should return safe defaults
            assert result.get("needs_rebase") is False
            assert result.get("commits_behind") == 0

        finally:
            # Restore .git directory
            if backup_dir.exists():
                shutil.move(str(backup_dir), str(git_dir))
            # Ensure we're back on main
            subprocess.run(
                ["git", "checkout", "main"],
                cwd=temp_git_repo,
                capture_output=True,
            )
