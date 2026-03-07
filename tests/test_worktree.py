#!/usr/bin/env python3
"""
Tests for Git Worktree Management
=================================

Tests the worktree.py module functionality including:
- Worktree creation and removal
- Staging worktree management
- Branch operations
- Merge operations
- Change tracking
- Worktree cleanup and age detection
"""

import subprocess
from datetime import datetime
from pathlib import Path

import pytest

from worktree import WorktreeManager


class TestWorktreeManagerInitialization:
    """Tests for WorktreeManager initialization."""

    def test_init_with_valid_git_repo(self, temp_git_repo: Path):
        """Manager initializes correctly with valid git repo."""
        manager = WorktreeManager(temp_git_repo)

        assert manager.project_dir == temp_git_repo
        assert (
            manager.worktrees_dir
            == temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        )
        assert manager.base_branch is not None

    def test_init_prefers_main_over_current_branch(self, temp_git_repo: Path):
        """Manager prefers main/master over current branch when detecting base branch."""
        # Create and switch to a new branch
        subprocess.run(
            ["git", "checkout", "-b", "feature-branch"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Even though we're on feature-branch, manager should prefer main
        manager = WorktreeManager(temp_git_repo)
        assert manager.base_branch == "main"

    def test_init_falls_back_to_current_branch(self, temp_git_repo: Path):
        """Manager falls back to current branch when main/master don't exist."""
        # Delete main branch to force fallback
        subprocess.run(
            ["git", "checkout", "-b", "feature-branch"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        subprocess.run(
            ["git", "branch", "-D", "main"], cwd=temp_git_repo, capture_output=True
        )

        manager = WorktreeManager(temp_git_repo)
        assert manager.base_branch == "feature-branch"

    def test_init_with_explicit_base_branch(self, temp_git_repo: Path):
        """Manager uses explicitly provided base branch."""
        manager = WorktreeManager(temp_git_repo, base_branch="main")
        assert manager.base_branch == "main"

    def test_setup_creates_worktrees_directory(self, temp_git_repo: Path):
        """Setup creates the worktrees directory."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        assert manager.worktrees_dir.exists()
        assert manager.worktrees_dir.is_dir()


class TestWorktreeCreation:
    """Tests for creating worktrees."""

    def test_create_worktree(self, temp_git_repo: Path):
        """Can create a new worktree."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        info = manager.create_worktree("test-spec")

        assert info.path.exists()
        assert info.branch == "auto-claude/test-spec"
        assert info.is_active is True
        assert (info.path / "README.md").exists()

    def test_create_worktree_with_spec_name(self, temp_git_repo: Path):
        """Worktree branch is derived from spec name."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        info = manager.create_worktree("my-feature-spec")

        assert info.branch == "auto-claude/my-feature-spec"

    def test_get_or_create_replaces_existing_worktree(self, temp_git_repo: Path):
        """get_or_create_worktree returns existing worktree."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        info1 = manager.create_worktree("test-spec")
        # Create a file in the worktree
        (info1.path / "test-file.txt").write_text("test")

        # get_or_create should return existing
        info2 = manager.get_or_create_worktree("test-spec")

        assert info2.path.exists()
        # The test file should still be there (same worktree)
        assert (info2.path / "test-file.txt").exists()

    def test_create_worktree_idempotent(self, temp_git_repo: Path):
        """create_worktree succeeds when called twice with same spec name."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # First creation should succeed
        info1 = manager.create_worktree("test-spec")
        assert info1.path.exists()
        assert info1.branch == "auto-claude/test-spec"

        # Create a file in the worktree to verify it's preserved
        (info1.path / "test-file.txt").write_text("test content")

        # Second creation should also succeed (idempotent)
        info2 = manager.create_worktree("test-spec")

        # Should return valid worktree info
        assert info2.path.exists()
        assert info2.branch == "auto-claude/test-spec"
        # The test file should still be there (same worktree returned)
        assert (info2.path / "test-file.txt").exists()
        assert (info2.path / "test-file.txt").read_text() == "test content"

    def test_create_worktree_branch_exists_no_worktree(self, temp_git_repo: Path):
        """create_worktree reuses existing branch when worktree is missing."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create initial worktree
        info1 = manager.create_worktree("test-spec")
        branch_name = info1.branch
        assert info1.path.exists()
        assert branch_name == "auto-claude/test-spec"

        # Remove worktree but keep the branch (delete_branch=False is default)
        manager.remove_worktree("test-spec", delete_branch=False)

        # Verify worktree directory is gone
        assert not info1.path.exists()

        # Verify branch still exists
        result = subprocess.run(
            ["git", "branch", "--list", branch_name],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert branch_name in result.stdout, (
            "Branch should still exist after worktree removal"
        )

        # Create worktree again - should succeed by reusing existing branch
        info2 = manager.create_worktree("test-spec")

        # Should return valid worktree info with the same branch
        assert info2.path.exists()
        assert info2.branch == branch_name
        assert info2.is_active is True
        # README should exist (copied from base branch)
        assert (info2.path / "README.md").exists()

    def test_create_worktree_stale_directory(self, temp_git_repo: Path):
        """create_worktree cleans up stale directory and recreates worktree."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree normally
        info = manager.create_worktree("test-spec")
        worktree_path = info.path
        branch_name = info.branch
        assert worktree_path.exists()

        # Add a file to the worktree so we can verify it gets cleaned up
        (worktree_path / "test-file.txt").write_text("test content")

        # Force-remove the worktree from git's tracking, but leave directory intact
        # This simulates a stale state where directory exists but git doesn't track it
        result = subprocess.run(
            ["git", "worktree", "remove", "--force", str(worktree_path)],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert result.returncode == 0, (
            f"Failed to force remove worktree: {result.stderr}"
        )

        # Recreate the directory manually to simulate stale state
        # (git worktree remove also deletes the directory, so we recreate it)
        worktree_path.mkdir(parents=True, exist_ok=True)
        (worktree_path / "stale-file.txt").write_text("stale content")

        # Verify directory exists but is not tracked by git
        assert worktree_path.exists()
        wt_list_result = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert str(worktree_path) not in wt_list_result.stdout, (
            "Worktree should not be registered"
        )

        # Now create_worktree should clean up the stale directory and recreate successfully
        info2 = manager.create_worktree("test-spec")

        # Should return valid worktree info
        assert info2.path.exists()
        assert info2.branch == branch_name
        assert info2.is_active is True
        # README should exist (from base branch)
        assert (info2.path / "README.md").exists()
        # Stale file should be gone (directory was cleaned up)
        assert not (info2.path / "stale-file.txt").exists()

    def test_create_worktree_stale_directory_with_existing_branch(
        self, temp_git_repo: Path
    ):
        """create_worktree handles stale directory when branch already exists."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree normally
        info = manager.create_worktree("test-spec")
        worktree_path = info.path
        branch_name = info.branch
        assert worktree_path.exists()

        # Unregister the worktree but KEEP the branch
        # Use 'git worktree remove' which removes directory, then manually recreate stale dir
        # But first we need to ensure the branch survives
        result = subprocess.run(
            ["git", "worktree", "remove", "--force", str(worktree_path)],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert result.returncode == 0, f"Failed to remove worktree: {result.stderr}"

        # Verify branch still exists (git worktree remove doesn't delete branch)
        result = subprocess.run(
            ["git", "branch", "--list", branch_name],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert branch_name in result.stdout, (
            "Branch should still exist after worktree removal"
        )

        # Recreate stale directory manually (simulates orphaned directory)
        worktree_path.mkdir(parents=True, exist_ok=True)
        (worktree_path / "stale-file.txt").write_text("stale content")

        # Verify: directory exists, worktree NOT registered, branch EXISTS
        assert worktree_path.exists()
        wt_list_result = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert str(worktree_path) not in wt_list_result.stdout, (
            "Worktree should not be registered"
        )

        # Now create_worktree should:
        # 1. Detect stale directory (not registered)
        # 2. Clean up stale directory
        # 3. Detect existing branch
        # 4. Reuse existing branch (no -b flag)
        info2 = manager.create_worktree("test-spec")

        # Should return valid worktree info with SAME branch (reused)
        assert info2.path.exists()
        assert info2.branch == branch_name
        assert info2.is_active is True
        # README should exist (from branch content)
        assert (info2.path / "README.md").exists()
        # Stale file should be gone (directory was cleaned up before worktree add)
        assert not (info2.path / "stale-file.txt").exists()


class TestWorktreeRemoval:
    """Tests for removing worktrees."""

    def test_remove_worktree(self, temp_git_repo: Path):
        """Can remove a worktree."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        info = manager.create_worktree("test-spec")

        manager.remove_worktree("test-spec")

        assert not info.path.exists()

    def test_remove_with_delete_branch(self, temp_git_repo: Path):
        """Removing worktree can also delete the branch."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        info = manager.create_worktree("test-spec")
        branch_name = info.branch

        manager.remove_worktree("test-spec", delete_branch=True)

        # Verify branch is deleted
        result = subprocess.run(
            ["git", "branch", "--list", branch_name],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert branch_name not in result.stdout


class TestWorktreeCommitAndMerge:
    """Tests for commit and merge operations."""

    def test_merge_worktree(self, temp_git_repo: Path):
        """Can merge a worktree back to main."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with changes
        worker_info = manager.create_worktree("worker-spec")
        (worker_info.path / "worker-file.txt").write_text("worker content")
        subprocess.run(["git", "add", "."], cwd=worker_info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path,
            capture_output=True,
        )

        # Merge worktree back to main
        result = manager.merge_worktree("worker-spec", delete_after=False)

        assert result is True

        # Verify file is in main branch
        subprocess.run(
            ["git", "checkout", manager.base_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert (temp_git_repo / "worker-file.txt").exists()

    def test_merge_worktree_already_on_target_branch(self, temp_git_repo: Path):
        """merge_worktree succeeds when already on target branch (ACS-174)."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Ensure we're on the base branch
        result = subprocess.run(
            ["git", "checkout", manager.base_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert result.returncode == 0, f"Checkout failed: {result.stderr}"

        # Create a worktree with changes
        worker_info = manager.create_worktree("worker-spec")
        (worker_info.path / "worker-file.txt").write_text("worker content")
        result = subprocess.run(
            ["git", "add", "."], cwd=worker_info.path, capture_output=True
        )
        assert result.returncode == 0, f"Git add failed: {result.stderr}"
        result = subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path,
            capture_output=True,
        )
        assert result.returncode == 0, f"Commit failed: {result.stderr}"

        # Already on target branch, should skip checkout and still merge successfully
        result = manager.merge_worktree("worker-spec", delete_after=False)

        assert result is True

        # Verify file is in main branch
        assert (temp_git_repo / "worker-file.txt").exists()

    def test_merge_worktree_already_up_to_date(self, temp_git_repo: Path):
        """merge_worktree succeeds when branch is already up to date (ACS-226)."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with changes
        worker_info = manager.create_worktree("worker-spec")
        (worker_info.path / "worker-file.txt").write_text("worker content")
        add_result = subprocess.run(
            ["git", "add", "."], cwd=worker_info.path, capture_output=True
        )
        assert add_result.returncode == 0, f"git add failed: {add_result.stderr}"
        commit_result = subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path,
            capture_output=True,
        )
        assert commit_result.returncode == 0, (
            f"git commit failed: {commit_result.stderr}"
        )

        # First merge succeeds
        result = manager.merge_worktree("worker-spec", delete_after=False)
        assert result is True

        # Second merge should also succeed (already up to date)
        result = manager.merge_worktree("worker-spec", delete_after=False)
        assert result is True

    def test_merge_worktree_already_up_to_date_with_no_commit(
        self, temp_git_repo: Path
    ):
        """merge_worktree with no_commit=True succeeds when already up to date (ACS-226)."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with changes
        worker_info = manager.create_worktree("worker-spec")
        (worker_info.path / "worker-file.txt").write_text("worker content")
        add_result = subprocess.run(
            ["git", "add", "."], cwd=worker_info.path, capture_output=True
        )
        assert add_result.returncode == 0, f"git add failed: {add_result.stderr}"
        commit_result = subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path,
            capture_output=True,
        )
        assert commit_result.returncode == 0, (
            f"git commit failed: {commit_result.stderr}"
        )

        # First merge with no_commit succeeds
        result = manager.merge_worktree(
            "worker-spec", no_commit=True, delete_after=False
        )
        assert result is True

        # Commit the staged changes
        merge_commit_result = subprocess.run(
            ["git", "commit", "-m", "Merge commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert merge_commit_result.returncode == 0, (
            f"git commit failed: {merge_commit_result.stderr}"
        )

        # Second merge should also succeed (already up to date)
        result = manager.merge_worktree(
            "worker-spec", no_commit=True, delete_after=False
        )
        assert result is True

    def test_merge_worktree_already_up_to_date_with_delete_after(
        self, temp_git_repo: Path
    ):
        """merge_worktree with delete_after=True succeeds when already up to date (ACS-226)."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with changes
        worker_info = manager.create_worktree("worker-spec")
        branch_name = worker_info.branch
        (worker_info.path / "worker-file.txt").write_text("worker content")
        add_result = subprocess.run(
            ["git", "add", "."], cwd=worker_info.path, capture_output=True
        )
        assert add_result.returncode == 0, f"git add failed: {add_result.stderr}"
        commit_result = subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path,
            capture_output=True,
        )
        assert commit_result.returncode == 0, (
            f"git commit failed: {commit_result.stderr}"
        )

        # First merge succeeds
        result = manager.merge_worktree("worker-spec", delete_after=False)
        assert result is True

        # Second merge with delete_after=True should also succeed and clean up
        result = manager.merge_worktree("worker-spec", delete_after=True)
        assert result is True

        # Verify worktree was deleted
        assert not worker_info.path.exists()

        # Verify branch was deleted
        branch_list_result = subprocess.run(
            ["git", "branch", "--list", branch_name],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert branch_name not in branch_list_result.stdout, (
            f"Branch {branch_name} should be deleted"
        )

    def test_merge_worktree_conflict_detection(self, temp_git_repo: Path):
        """merge_worktree correctly detects and handles merge conflicts."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create initial file on base branch
        (temp_git_repo / "shared.txt").write_text("base content")
        add_result = subprocess.run(
            ["git", "add", "."], cwd=temp_git_repo, capture_output=True
        )
        assert add_result.returncode == 0, f"git add failed: {add_result.stderr}"
        commit_result = subprocess.run(
            ["git", "commit", "-m", "Add shared file"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert commit_result.returncode == 0, (
            f"git commit failed: {commit_result.stderr}"
        )

        # Create worktree with conflicting change
        worker_info = manager.create_worktree("worker-spec")
        (worker_info.path / "shared.txt").write_text("worker content")
        add_result = subprocess.run(
            ["git", "add", "."], cwd=worker_info.path, capture_output=True
        )
        assert add_result.returncode == 0, f"git add failed: {add_result.stderr}"
        commit_result = subprocess.run(
            ["git", "commit", "-m", "Worker change"],
            cwd=worker_info.path,
            capture_output=True,
        )
        assert commit_result.returncode == 0, (
            f"git commit failed: {commit_result.stderr}"
        )

        # Make conflicting change on base branch
        (temp_git_repo / "shared.txt").write_text("base change")
        add_result = subprocess.run(
            ["git", "add", "."], cwd=temp_git_repo, capture_output=True
        )
        assert add_result.returncode == 0, f"git add failed: {add_result.stderr}"
        commit_result = subprocess.run(
            ["git", "commit", "-m", "Base change"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert commit_result.returncode == 0, (
            f"git commit failed: {commit_result.stderr}"
        )

        # Merge should detect conflict and fail
        result = manager.merge_worktree("worker-spec", delete_after=False)
        assert result is False

        # Verify merge was aborted (no merge state exists)
        # Check that MERGE_HEAD does not exist
        merge_head_result = subprocess.run(
            ["git", "rev-parse", "--verify", "MERGE_HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert merge_head_result.returncode != 0, (
            "MERGE_HEAD should not exist after abort"
        )

        # Verify git status shows no unmerged/conflict status codes
        git_status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        # Should have no output (clean working directory)
        assert git_status.returncode == 0
        assert not git_status.stdout.strip(), (
            f"Expected clean status, got: {git_status.stdout}"
        )

    def test_merge_worktree_conflict_with_no_commit(self, temp_git_repo: Path):
        """merge_worktree with no_commit=True handles conflicts correctly."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create initial file on base branch
        (temp_git_repo / "shared.txt").write_text("base content")
        add_result = subprocess.run(
            ["git", "add", "."], cwd=temp_git_repo, capture_output=True
        )
        assert add_result.returncode == 0, f"git add failed: {add_result.stderr}"
        commit_result = subprocess.run(
            ["git", "commit", "-m", "Add shared file"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert commit_result.returncode == 0, (
            f"git commit failed: {commit_result.stderr}"
        )

        # Create worktree with conflicting change
        worker_info = manager.create_worktree("worker-spec")
        (worker_info.path / "shared.txt").write_text("worker content")
        add_result = subprocess.run(
            ["git", "add", "."], cwd=worker_info.path, capture_output=True
        )
        assert add_result.returncode == 0, f"git add failed: {add_result.stderr}"
        commit_result = subprocess.run(
            ["git", "commit", "-m", "Worker change"],
            cwd=worker_info.path,
            capture_output=True,
        )
        assert commit_result.returncode == 0, (
            f"git commit failed: {commit_result.stderr}"
        )

        # Make conflicting change on base branch
        (temp_git_repo / "shared.txt").write_text("base change")
        add_result = subprocess.run(
            ["git", "add", "."], cwd=temp_git_repo, capture_output=True
        )
        assert add_result.returncode == 0, f"git add failed: {add_result.stderr}"
        commit_result = subprocess.run(
            ["git", "commit", "-m", "Base change"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert commit_result.returncode == 0, (
            f"git commit failed: {commit_result.stderr}"
        )

        # Merge with no_commit should detect conflict and fail
        result = manager.merge_worktree(
            "worker-spec", no_commit=True, delete_after=False
        )
        assert result is False

        # Verify merge was aborted (no merge state exists)
        # Check that MERGE_HEAD does not exist
        merge_head_result = subprocess.run(
            ["git", "rev-parse", "--verify", "MERGE_HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert merge_head_result.returncode != 0, (
            "MERGE_HEAD should not exist after abort"
        )

        # Verify git status shows no staged/unstaged changes
        git_status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert git_status.returncode == 0
        assert not git_status.stdout.strip(), (
            f"Expected clean status, got: {git_status.stdout}"
        )


class TestChangeTracking:
    """Tests for tracking changes in worktrees."""

    def test_has_uncommitted_changes_false(self, temp_git_repo: Path):
        """has_uncommitted_changes returns False when clean."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        assert manager.has_uncommitted_changes() is False

    def test_has_uncommitted_changes_true(self, temp_git_repo: Path):
        """has_uncommitted_changes returns True when dirty."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Make uncommitted changes
        (temp_git_repo / "dirty.txt").write_text("uncommitted")

        assert manager.has_uncommitted_changes() is True

    def test_get_change_summary(self, temp_git_repo: Path):
        """get_change_summary returns correct counts."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        info = manager.create_worktree("test-spec")

        # Make various changes
        (info.path / "new-file.txt").write_text("new")
        (info.path / "README.md").write_text("modified")
        subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Changes"], cwd=info.path, capture_output=True
        )

        summary = manager.get_change_summary("test-spec")

        assert summary["new_files"] == 1  # new-file.txt
        assert summary["modified_files"] == 1  # README.md

    def test_get_changed_files(self, temp_git_repo: Path):
        """get_changed_files returns list of changed files."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        info = manager.create_worktree("test-spec")

        # Make changes
        (info.path / "added.txt").write_text("new file")
        subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"], cwd=info.path, capture_output=True
        )

        files = manager.get_changed_files("test-spec")

        assert len(files) > 0
        file_names = [f[1] for f in files]
        assert "added.txt" in file_names


class TestWorktreeUtilities:
    """Tests for utility methods."""

    def test_list_worktrees(self, temp_git_repo: Path):
        """list_all_worktrees returns active worktrees."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        manager.create_worktree("spec-1")
        manager.create_worktree("spec-2")

        worktrees = manager.list_all_worktrees()

        assert len(worktrees) == 2

    def test_get_info(self, temp_git_repo: Path):
        """get_worktree_info returns correct WorktreeInfo."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        manager.create_worktree("test-spec")

        info = manager.get_worktree_info("test-spec")

        assert info is not None
        assert info.branch == "auto-claude/test-spec"

    def test_get_worktree_path(self, temp_git_repo: Path):
        """get_worktree_path returns correct path."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        info = manager.create_worktree("test-spec")

        path = manager.get_worktree_path("test-spec")

        assert path == info.path

    def test_cleanup_all(self, temp_git_repo: Path):
        """cleanup_all removes all worktrees."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        manager.create_worktree("spec-1")
        manager.create_worktree("spec-2")
        manager.create_worktree("spec-3")

        manager.cleanup_all()

        assert len(manager.list_all_worktrees()) == 0

    def test_cleanup_stale_worktrees(self, temp_git_repo: Path):
        """cleanup_stale_worktrees removes directories without git tracking."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a stale worktree directory (exists but not tracked by git)
        stale_dir = manager.worktrees_dir / "stale-worktree"
        stale_dir.mkdir(parents=True, exist_ok=True)

        # This should clean up the stale directory
        manager.cleanup_stale_worktrees()

        # Stale directory should be removed
        assert not stale_dir.exists()

    def test_get_test_commands_python(self, temp_git_repo: Path):
        """get_test_commands detects Python project commands."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        info = manager.create_worktree("test-spec")

        # Create requirements.txt
        (info.path / "requirements.txt").write_text("flask\n")

        commands = manager.get_test_commands("test-spec")

        assert any("pip" in cmd for cmd in commands)

    def test_get_test_commands_node(self, temp_git_repo: Path):
        """get_test_commands detects Node.js project commands."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        info = manager.create_worktree("test-spec-node")

        # Create package.json
        (info.path / "package.json").write_text('{"name": "test"}')

        commands = manager.get_test_commands("test-spec-node")

        assert any("npm" in cmd for cmd in commands)


class TestWorktreeCleanup:
    """Tests for worktree cleanup and age detection functionality."""

    def test_get_worktree_stats_includes_age(self, temp_git_repo: Path):
        """Worktree stats include last commit date and age in days."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()
        info = manager.create_worktree("test-spec")

        # Make a commit in the worktree
        test_file = info.path / "test.txt"
        test_file.write_text("test")
        subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "test commit"], cwd=info.path, capture_output=True
        )

        # Get stats
        stats = manager._get_worktree_stats("test-spec")

        assert stats["last_commit_date"] is not None
        assert isinstance(stats["last_commit_date"], datetime)
        assert stats["days_since_last_commit"] is not None
        assert stats["days_since_last_commit"] == 0  # Just committed

    def test_get_old_worktrees(self, temp_git_repo: Path):
        """get_old_worktrees identifies worktrees based on age threshold."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with a commit
        info = manager.create_worktree("test-spec")
        test_file = info.path / "test.txt"
        test_file.write_text("test")
        subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "test commit"], cwd=info.path, capture_output=True
        )

        # Should not be considered old with default threshold (30 days)
        old_worktrees = manager.get_old_worktrees(days_threshold=30)
        assert len(old_worktrees) == 0

        # Should be considered old with 0 day threshold
        old_worktrees = manager.get_old_worktrees(days_threshold=0)
        assert len(old_worktrees) == 1
        assert "test-spec" in old_worktrees

    def test_get_old_worktrees_with_stats(self, temp_git_repo: Path):
        """get_old_worktrees returns full WorktreeInfo when include_stats=True."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with a commit
        info = manager.create_worktree("test-spec")
        test_file = info.path / "test.txt"
        test_file.write_text("test")
        subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "test commit"], cwd=info.path, capture_output=True
        )

        # Get old worktrees with stats
        old_worktrees = manager.get_old_worktrees(days_threshold=0, include_stats=True)

        assert len(old_worktrees) == 1
        assert old_worktrees[0].spec_name == "test-spec"
        assert old_worktrees[0].days_since_last_commit is not None

    def test_cleanup_old_worktrees_dry_run(self, temp_git_repo: Path):
        """cleanup_old_worktrees dry run does not remove worktrees."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with a commit
        info = manager.create_worktree("test-spec")
        test_file = info.path / "test.txt"
        test_file.write_text("test")
        subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "test commit"], cwd=info.path, capture_output=True
        )

        # Dry run should not remove anything
        removed, failed = manager.cleanup_old_worktrees(days_threshold=0, dry_run=True)

        assert len(removed) == 0
        assert len(failed) == 0
        assert info.path.exists()  # Worktree still exists

    def test_cleanup_old_worktrees_removes_old(self, temp_git_repo: Path):
        """cleanup_old_worktrees removes worktrees older than threshold."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with a commit
        info = manager.create_worktree("test-spec")
        test_file = info.path / "test.txt"
        test_file.write_text("test")
        subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "test commit"], cwd=info.path, capture_output=True
        )

        # Actually remove with 0 day threshold
        removed, failed = manager.cleanup_old_worktrees(days_threshold=0, dry_run=False)

        assert len(removed) == 1
        assert "test-spec" in removed
        assert len(failed) == 0
        assert not info.path.exists()  # Worktree should be removed

    def test_get_worktree_count_warning(self, temp_git_repo: Path):
        """get_worktree_count_warning returns appropriate warnings based on count."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # No warning with few worktrees
        warning = manager.get_worktree_count_warning(warning_threshold=10)
        assert warning is None

        # Create 11 worktrees to trigger warning
        for i in range(11):
            info = manager.create_worktree(f"test-spec-{i}")
            test_file = info.path / "test.txt"
            test_file.write_text("test")
            subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", "test commit"],
                cwd=info.path,
                capture_output=True,
            )

        warning = manager.get_worktree_count_warning(warning_threshold=10)
        assert warning is not None
        assert "WARNING" in warning

    def test_get_worktree_count_critical_warning(self, temp_git_repo: Path):
        """get_worktree_count_warning returns critical warning for high counts."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create 21 worktrees to trigger critical warning
        for i in range(21):
            info = manager.create_worktree(f"test-spec-{i}")
            test_file = info.path / "test.txt"
            test_file.write_text("test")
            subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", "test commit"],
                cwd=info.path,
                capture_output=True,
            )

        warning = manager.get_worktree_count_warning(critical_threshold=20)
        assert warning is not None
        assert "CRITICAL" in warning
