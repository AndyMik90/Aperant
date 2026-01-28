"""
Tests for PR Worktree Manager
==============================

Tests the worktree lifecycle management including cleanup policies.
"""

# Import the module to test - use direct path to avoid package imports
import importlib.util
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import pytest

backend_path = Path(__file__).parent.parent / "apps" / "backend"
module_path = backend_path / "runners" / "github" / "services" / "pr_worktree_manager.py"

# Load module directly without importing parent packages
spec = importlib.util.spec_from_file_location("pr_worktree_manager", module_path)
pr_worktree_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pr_worktree_module)

PRWorktreeManager = pr_worktree_module.PRWorktreeManager


@pytest.fixture
def temp_git_repo():
    """Create a temporary git repository with remote origin for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Save original environment values to restore later
        orig_env = {}

        # These git env vars are set by pre-commit hooks and MUST be cleared
        # to avoid interference with worktree operations in our isolated test repo.
        # GIT_INDEX_FILE especially causes "index file open failed: Not a directory"
        git_vars_to_clear = [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        ]

        env_vars_to_set = {
            "GIT_AUTHOR_NAME": "Test User",
            "GIT_AUTHOR_EMAIL": "test@example.com",
            "GIT_COMMITTER_NAME": "Test User",
            "GIT_COMMITTER_EMAIL": "test@example.com",
            # GIT_CEILING_DIRECTORIES prevents git from discovering parent .git directories
            # This is critical for test isolation when running inside another git repo
            "GIT_CEILING_DIRECTORIES": tmpdir,
        }

        # Clear interfering git environment variables
        for key in git_vars_to_clear:
            orig_env[key] = os.environ.get(key)
            if key in os.environ:
                del os.environ[key]

        # Set our isolated environment variables
        for key, value in env_vars_to_set.items():
            orig_env[key] = os.environ.get(key)
            os.environ[key] = value

        try:
            # Create a bare repo to act as "origin"
            origin_dir = Path(tmpdir) / "origin.git"
            origin_dir.mkdir()
            subprocess.run(
                ["git", "init", "--bare"], cwd=origin_dir, check=True, capture_output=True
            )

            # Create the working repo
            repo_dir = Path(tmpdir) / "test_repo"
            repo_dir.mkdir()

            # Initialize git repo with explicit initial branch name
            subprocess.run(
                ["git", "init", "--initial-branch=main"],
                cwd=repo_dir,
                check=True,
                capture_output=True,
            )

            # Add origin remote
            subprocess.run(
                ["git", "remote", "add", "origin", str(origin_dir)],
                cwd=repo_dir,
                check=True,
                capture_output=True,
            )

            # Create initial commit
            test_file = repo_dir / "test.txt"
            test_file.write_text("initial content")
            subprocess.run(
                ["git", "add", "."], cwd=repo_dir, check=True, capture_output=True
            )
            subprocess.run(
                ["git", "commit", "-m", "Initial commit"],
                cwd=repo_dir,
                check=True,
                capture_output=True,
            )

            # Push to origin so refs exist
            subprocess.run(
                ["git", "push", "-u", "origin", "main"],
                cwd=repo_dir,
                check=True,
                capture_output=True,
            )

            # Get the commit SHA
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=repo_dir,
                check=True,
                capture_output=True,
                text=True,
            )
            commit_sha = result.stdout.strip()

            # Verify repository is in clean state before yielding
            # This ensures the git index is properly initialized
            status_result = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=repo_dir,
                check=True,
                capture_output=True,
                text=True,
            )
            assert status_result.stdout.strip() == "", f"Git repo not clean: {status_result.stdout}"

            # Prune any stale worktree references before tests
            subprocess.run(
                ["git", "worktree", "prune"],
                cwd=repo_dir,
                capture_output=True,
            )

            yield repo_dir, commit_sha

            # Cleanup: First remove all worktrees, then prune
            worktree_base = repo_dir / ".test-worktrees"
            if worktree_base.exists():
                # Force remove each worktree
                for item in worktree_base.iterdir():
                    if item.is_dir():
                        subprocess.run(
                            ["git", "worktree", "remove", "--force", str(item)],
                            cwd=repo_dir,
                            capture_output=True,
                        )
                # Clean up any remaining directories
                shutil.rmtree(worktree_base, ignore_errors=True)

            # Final prune
            subprocess.run(
                ["git", "worktree", "prune"],
                cwd=repo_dir,
                capture_output=True,
            )

        finally:
            # Restore original environment
            for key, orig_value in orig_env.items():
                if orig_value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = orig_value


def test_create_and_remove_worktree(temp_git_repo):
    """Test basic worktree creation and removal."""
    repo_dir, commit_sha = temp_git_repo
    manager = PRWorktreeManager(repo_dir, ".test-worktrees")

    # Create worktree
    worktree_path = manager.create_worktree(commit_sha, pr_number=123)

    assert worktree_path.exists()
    assert worktree_path.is_dir()
    assert "pr-123" in worktree_path.name

    # Remove worktree
    manager.remove_worktree(worktree_path)

    assert not worktree_path.exists()


def test_cleanup_orphaned_worktrees(temp_git_repo):
    """Test cleanup of orphaned worktrees (not registered with git)."""
    repo_dir, commit_sha = temp_git_repo
    manager = PRWorktreeManager(repo_dir, ".test-worktrees")

    # Manually create an orphan directory (looks like worktree but not registered)
    orphan_path = manager.worktree_base_dir / "pr-456-orphaned-12345"
    orphan_path.mkdir(parents=True)
    (orphan_path / "test.txt").write_text("orphan content")

    # Verify directory exists but is not in git worktree list
    assert orphan_path.exists()
    registered = manager.get_registered_worktrees()
    assert orphan_path not in registered

    # Cleanup should remove orphaned directory
    stats = manager.cleanup_worktrees()

    assert stats['orphaned'] >= 1
    assert not orphan_path.exists()


def test_cleanup_expired_worktrees(temp_git_repo):
    """Test cleanup of worktrees older than max age."""
    repo_dir, commit_sha = temp_git_repo

    # Set a very short max age for testing
    original_age = os.environ.get("PR_WORKTREE_MAX_AGE_DAYS")
    os.environ["PR_WORKTREE_MAX_AGE_DAYS"] = "0"  # 0 days = instant expiration

    try:
        manager = PRWorktreeManager(repo_dir, ".test-worktrees")

        # Create a worktree
        worktree_path = manager.create_worktree(commit_sha, pr_number=789)
        assert worktree_path.exists()

        # Make it "old" by modifying mtime
        old_time = time.time() - (2 * 86400)  # 2 days ago
        os.utime(worktree_path, (old_time, old_time))

        # Cleanup should remove expired worktree
        stats = manager.cleanup_worktrees()

        assert stats['expired'] >= 1
        assert not worktree_path.exists()

    finally:
        # Restore original setting
        if original_age is not None:
            os.environ["PR_WORKTREE_MAX_AGE_DAYS"] = original_age
        else:
            os.environ.pop("PR_WORKTREE_MAX_AGE_DAYS", None)


def test_cleanup_excess_worktrees(temp_git_repo):
    """Test cleanup when exceeding max worktree count."""
    repo_dir, commit_sha = temp_git_repo

    # Set a very low limit for testing
    original_max = os.environ.get("MAX_PR_WORKTREES")
    os.environ["MAX_PR_WORKTREES"] = "2"  # Only keep 2 worktrees

    try:
        manager = PRWorktreeManager(repo_dir, ".test-worktrees")

        # Create 4 worktrees (disable auto_cleanup so they all exist initially)
        worktrees = []
        for i in range(4):
            wt = manager.create_worktree(commit_sha, pr_number=1000 + i, auto_cleanup=False)
            worktrees.append(wt)
            # Add small delay to ensure different timestamps
            time.sleep(0.1)

        # All should exist initially
        for wt in worktrees:
            assert wt.exists()

        # Cleanup should remove 2 oldest (excess over limit of 2)
        stats = manager.cleanup_worktrees()

        assert stats['excess'] == 2

        # Check that oldest worktrees were removed
        existing = [wt for wt in worktrees if wt.exists()]
        assert len(existing) == 2

    finally:
        # Restore original setting
        if original_max is not None:
            os.environ["MAX_PR_WORKTREES"] = original_max
        else:
            os.environ.pop("MAX_PR_WORKTREES", None)


def test_get_worktree_info(temp_git_repo):
    """Test retrieving worktree information."""
    repo_dir, commit_sha = temp_git_repo
    manager = PRWorktreeManager(repo_dir, ".test-worktrees")

    # Create multiple worktrees (disable auto_cleanup so they both exist)
    wt1 = manager.create_worktree(commit_sha, pr_number=111, auto_cleanup=False)
    time.sleep(0.1)
    wt2 = manager.create_worktree(commit_sha, pr_number=222, auto_cleanup=False)

    # Get info
    info_list = manager.get_worktree_info()

    assert len(info_list) >= 2

    # Should be sorted by age (oldest first)
    assert info_list[0].path == wt1 or info_list[1].path == wt1
    assert info_list[0].path == wt2 or info_list[1].path == wt2

    # Check PR numbers were extracted
    pr_numbers = {info.pr_number for info in info_list}
    assert 111 in pr_numbers
    assert 222 in pr_numbers

    # Cleanup
    manager.cleanup_all_worktrees()
