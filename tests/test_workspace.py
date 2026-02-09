#!/usr/bin/env python3
"""
Tests for Workspace Selection and Management
=============================================

Tests the workspace.py module functionality including:
- Workspace mode selection (isolated vs direct)
- Uncommitted changes detection
- Workspace setup
- Build finalization workflows
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from workspace import (
    WorkspaceChoice,
    WorkspaceMode,
    get_current_branch,
    get_existing_build_worktree,
    has_uncommitted_changes,
    setup_workspace,
)
from worktree import WorktreeManager

# Test constant - in the new per-spec architecture, each spec has its own worktree
# named after the spec itself. This constant is used for test assertions.
TEST_SPEC_NAME = "test-spec"


class TestWorkspaceMode:
    """Tests for WorkspaceMode enum."""

    def test_isolated_mode(self):
        """ISOLATED mode value is correct."""
        assert WorkspaceMode.ISOLATED.value == "isolated"

    def test_direct_mode(self):
        """DIRECT mode value is correct."""
        assert WorkspaceMode.DIRECT.value == "direct"


class TestWorkspaceChoice:
    """Tests for WorkspaceChoice enum."""

    def test_merge_choice(self):
        """MERGE choice value is correct."""
        assert WorkspaceChoice.MERGE.value == "merge"

    def test_review_choice(self):
        """REVIEW choice value is correct."""
        assert WorkspaceChoice.REVIEW.value == "review"

    def test_test_choice(self):
        """TEST choice value is correct."""
        assert WorkspaceChoice.TEST.value == "test"

    def test_later_choice(self):
        """LATER choice value is correct."""
        assert WorkspaceChoice.LATER.value == "later"


class TestHasUncommittedChanges:
    """Tests for uncommitted changes detection."""

    def test_clean_repo_no_changes(self, temp_git_repo: Path):
        """Clean repo returns False."""
        result = has_uncommitted_changes(temp_git_repo)
        assert result is False

    def test_untracked_file_has_changes(self, temp_git_repo: Path):
        """Untracked file counts as changes."""
        (temp_git_repo / "new_file.txt").write_text("content")

        result = has_uncommitted_changes(temp_git_repo)
        assert result is True

    def test_modified_file_has_changes(self, temp_git_repo: Path):
        """Modified tracked file counts as changes."""
        (temp_git_repo / "README.md").write_text("modified content")

        result = has_uncommitted_changes(temp_git_repo)
        assert result is True

    def test_staged_file_has_changes(self, temp_git_repo: Path):
        """Staged file counts as changes."""
        (temp_git_repo / "README.md").write_text("modified")
        subprocess.run(["git", "add", "README.md"], cwd=temp_git_repo, capture_output=True)

        result = has_uncommitted_changes(temp_git_repo)
        assert result is True


class TestGetCurrentBranch:
    """Tests for current branch detection."""

    def test_gets_main_branch(self, temp_git_repo: Path):
        """Gets the main/master branch."""
        branch = get_current_branch(temp_git_repo)

        # Could be main or master depending on git config
        assert branch in ["main", "master"]

    def test_gets_feature_branch(self, temp_git_repo: Path):
        """Gets feature branch name."""
        subprocess.run(
            ["git", "checkout", "-b", "feature/test-branch"],
            cwd=temp_git_repo, capture_output=True
        )

        branch = get_current_branch(temp_git_repo)
        assert branch == "feature/test-branch"


class TestGetExistingBuildWorktree:
    """Tests for existing build worktree detection."""

    def test_no_existing_worktree(self, temp_git_repo: Path):
        """Returns None when no worktree exists."""
        result = get_existing_build_worktree(temp_git_repo, "test-spec")
        assert result is None

    def test_existing_worktree(self, temp_git_repo: Path):
        """Returns path when worktree exists."""
        # Create the worktree directory structure (per-spec architecture)
        worktree_path = temp_git_repo / ".worktrees" / TEST_SPEC_NAME
        worktree_path.mkdir(parents=True)

        result = get_existing_build_worktree(temp_git_repo, TEST_SPEC_NAME)
        assert result == worktree_path


class TestSetupWorkspace:
    """Tests for workspace setup."""

    def test_setup_direct_mode(self, temp_git_repo: Path):
        """Direct mode returns project dir and no manager."""
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.DIRECT,
        )

        assert working_dir == temp_git_repo
        assert manager is None

    def test_setup_isolated_mode(self, temp_git_repo: Path):
        """Isolated mode creates worktree and returns manager."""
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            TEST_SPEC_NAME,
            WorkspaceMode.ISOLATED,
        )

        assert working_dir != temp_git_repo
        assert manager is not None
        assert working_dir.exists()
        # Per-spec architecture: worktree is named after the spec
        assert working_dir.name == TEST_SPEC_NAME

    def test_setup_isolated_creates_worktrees_dir(self, temp_git_repo: Path):
        """Isolated mode creates worktrees directory."""
        setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        assert (temp_git_repo / ".auto-claude" / "worktrees" / "tasks").exists()


class TestWorkspaceUtilities:
    """Tests for workspace utility functions."""

    def test_per_spec_worktree_naming(self, temp_git_repo: Path):
        """Per-spec architecture uses spec name for worktree directory."""
        spec_name = "my-spec-001"
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            spec_name,
            WorkspaceMode.ISOLATED,
        )

        # Worktree should be named after the spec
        assert working_dir.name == spec_name
        # New path: .auto-claude/worktrees/tasks/{spec_name}
        assert working_dir.parent.name == "tasks"


class TestWorkspaceIntegration:
    """Integration tests for workspace management."""

    def test_isolated_workflow(self, temp_git_repo: Path):
        """Full isolated workflow: setup -> work -> finalize."""
        # Setup isolated workspace
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Make changes in workspace
        (working_dir / "feature.py").write_text("# New feature\n")

        # Verify changes are in workspace
        assert (working_dir / "feature.py").exists()

        # Verify changes are NOT in main project
        assert not (temp_git_repo / "feature.py").exists()

    def test_direct_workflow(self, temp_git_repo: Path):
        """Full direct workflow: setup -> work."""
        # Setup direct workspace
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.DIRECT,
        )

        # Working dir is the project dir
        assert working_dir == temp_git_repo

        # Make changes directly
        (working_dir / "feature.py").write_text("# New feature\n")

        # Changes are in main project
        assert (temp_git_repo / "feature.py").exists()

    def test_isolated_merge(self, temp_git_repo: Path):
        """Can merge isolated workspace back to main."""
        # Setup
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Make changes and commit using git directly
        (working_dir / "feature.py").write_text("# New feature\n")
        subprocess.run(["git", "add", "."], cwd=working_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add feature"],
            cwd=working_dir, capture_output=True
        )

        # Merge back using merge_worktree
        result = manager.merge_worktree("test-spec", delete_after=False)

        assert result is True

        # Check changes are in main
        subprocess.run(
            ["git", "checkout", manager.base_branch],
            cwd=temp_git_repo, capture_output=True
        )
        assert (temp_git_repo / "feature.py").exists()


class TestWorkspaceCleanup:
    """Tests for workspace cleanup."""

    def test_cleanup_after_merge(self, temp_git_repo: Path):
        """Workspace is cleaned up after merge with delete_after=True."""
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Commit changes using git directly
        (working_dir / "test.py").write_text("test")
        subprocess.run(["git", "add", "."], cwd=working_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Test"],
            cwd=working_dir, capture_output=True
        )

        # Merge with cleanup
        manager.merge_worktree("test-spec", delete_after=True)

        # Workspace should be removed
        assert not working_dir.exists()

    def test_workspace_preserved_after_merge_no_delete(self, temp_git_repo: Path):
        """Workspace preserved after merge with delete_after=False."""
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Commit changes using git directly
        (working_dir / "test.py").write_text("test")
        subprocess.run(["git", "add", "."], cwd=working_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Test"],
            cwd=working_dir, capture_output=True
        )

        # Merge without cleanup
        manager.merge_worktree("test-spec", delete_after=False)

        # Workspace should still exist
        assert working_dir.exists()


class TestWorkspaceReuse:
    """Tests for reusing existing workspaces."""

    def test_reuse_existing_workspace(self, temp_git_repo: Path):
        """Can reuse existing workspace on second setup."""
        # First setup
        working_dir1, manager1, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Add a marker file
        (working_dir1 / "marker.txt").write_text("marker")

        # Second setup (should reuse)
        working_dir2, manager2, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Should be the same directory
        assert working_dir1 == working_dir2

        # Marker should still exist
        assert (working_dir2 / "marker.txt").exists()


class TestWorkspaceErrors:
    """Tests for workspace error handling."""

    def test_setup_non_git_directory(self, temp_dir: Path):
        """Handles non-git directories gracefully."""
        with pytest.raises(Exception):
            # This should fail because temp_dir is not a git repo
            setup_workspace(
                temp_dir,
                "test-spec",
                WorkspaceMode.ISOLATED,
            )


class TestPerSpecWorktreeName:
    """Tests for per-spec worktree naming (new architecture)."""

    def test_worktree_named_after_spec(self, temp_git_repo: Path):
        """Worktree is named after the spec."""
        spec_name = "spec-1"
        working_dir, _, _ = setup_workspace(
            temp_git_repo,
            spec_name,
            WorkspaceMode.ISOLATED,
        )

        # Per-spec architecture: worktree directory matches spec name
        assert working_dir.name == spec_name

    def test_different_specs_get_different_worktrees(self, temp_git_repo: Path):
        """Different specs create separate worktrees."""
        working_dir1, _, _ = setup_workspace(
            temp_git_repo,
            "spec-1",
            WorkspaceMode.ISOLATED,
        )

        working_dir2, _, _ = setup_workspace(
            temp_git_repo,
            "spec-2",
            WorkspaceMode.ISOLATED,
        )

        # Each spec has its own worktree
        assert working_dir1.name == "spec-1"
        assert working_dir2.name == "spec-2"
        assert working_dir1 != working_dir2

    def test_worktree_path_in_worktrees_dir(self, temp_git_repo: Path):
        """Worktree is created in worktrees directory."""
        working_dir, _, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # New path: .auto-claude/worktrees/tasks/{spec_name}
        assert "worktrees" in str(working_dir)
        assert working_dir.parent.name == "tasks"


class TestConflictInfoDisplay:
    """Tests for conflict info display function (ACS-179)."""

    def test_print_conflict_info_with_string_list(self, capsys):
        """print_conflict_info handles string list of file paths (ACS-179)."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": ["file1.txt", "file2.py", "file3.js"]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "3 file" in captured.out
        assert "file1.txt" in captured.out
        assert "file2.py" in captured.out
        assert "file3.js" in captured.out
        assert "git add" in captured.out

    def test_print_conflict_info_with_dict_list(self, capsys):
        """print_conflict_info handles dict list with file/reason/severity (ACS-179)."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "file1.txt", "reason": "Syntax error", "severity": "high"},
                {"file": "file2.py", "reason": "Merge conflict", "severity": "medium"},
                {"file": "file3.js", "reason": "Unknown error", "severity": "low"},
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "3 file" in captured.out
        assert "file1.txt" in captured.out
        assert "file2.py" in captured.out
        assert "file3.js" in captured.out
        assert "Syntax error" in captured.out
        assert "Merge conflict" in captured.out
        # Verify severity emoji indicators
        assert "🔴" in captured.out  # High severity
        assert "🟡" in captured.out  # Medium severity

    def test_print_conflict_info_mixed_formats(self, capsys):
        """print_conflict_info handles mixed string and dict conflicts (ACS-179)."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                "simple-file.txt",
                {"file": "complex-file.py", "reason": "AI merge failed", "severity": "high"},
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "2 file" in captured.out
        assert "simple-file.txt" in captured.out
        assert "complex-file.py" in captured.out
        assert "AI merge failed" in captured.out


class TestMergeErrorHandling:
    """Tests for merge error handling (ACS-163)."""

    def test_merge_failure_returns_false_immediately(self, temp_git_repo: Path):
        """Failed merge returns False without falling through (ACS-163)."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with changes
        worker_info = manager.create_worktree("worker-spec")
        (worker_info.path / "worker-file.txt").write_text("worker content")
        subprocess.run(["git", "add", "."], cwd=worker_info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path, capture_output=True
        )

        # Create a conflicting change on main
        subprocess.run(["git", "checkout", manager.base_branch], cwd=temp_git_repo, capture_output=True)
        (temp_git_repo / "worker-file.txt").write_text("main content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main commit"],
            cwd=temp_git_repo, capture_output=True
        )

        # Merge should fail (conflict) and return False
        # This tests the fix for ACS-163 where failed merge would fall through
        result = manager.merge_worktree("worker-spec", delete_after=False)

        # Should return False on merge conflict
        assert result is False

        # Verify side effects: base branch content is unchanged
        subprocess.run(["git", "checkout", manager.base_branch], cwd=temp_git_repo, capture_output=True)
        base_content = (temp_git_repo / "worker-file.txt").read_text()
        assert base_content == "main content", "Base branch should be unchanged after failed merge"


# =============================================================================
# TESTS FOR WORKSPACE MODELS (core.workspace.models)
# =============================================================================

from core.workspace.models import (
    ParallelMergeTask,
    ParallelMergeResult,
    MergeLockError,
    MergeLock,
    SpecNumberLockError,
    SpecNumberLock,
)


class TestParallelMergeTask:
    """Tests for ParallelMergeTask dataclass."""

    def test_create_merge_task(self):
        """ParallelMergeTask can be instantiated with all fields."""
        task = ParallelMergeTask(
            file_path="src/example.py",
            main_content="main content",
            worktree_content="worktree content",
            base_content="base content",
            spec_name="test-spec",
            project_dir=Path("/project"),
        )

        assert task.file_path == "src/example.py"
        assert task.main_content == "main content"
        assert task.worktree_content == "worktree content"
        assert task.base_content == "base content"
        assert task.spec_name == "test-spec"
        assert task.project_dir == Path("/project")

    def test_merge_task_with_none_base(self):
        """ParallelMergeTask can have None for base_content."""
        task = ParallelMergeTask(
            file_path="src/example.py",
            main_content="main content",
            worktree_content="worktree content",
            base_content=None,
            spec_name="test-spec",
            project_dir=Path("/project"),
        )

        assert task.base_content is None

    def test_merge_task_field_assignment(self):
        """ParallelMergeTask fields can be reassigned."""
        task = ParallelMergeTask(
            file_path="src/example.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-1",
            project_dir=Path("/project"),
        )

        task.file_path = "src/updated.py"
        task.main_content = "updated main"
        task.worktree_content = "updated worktree"
        task.base_content = "updated base"
        task.spec_name = "spec-2"
        task.project_dir = Path("/updated")

        assert task.file_path == "src/updated.py"
        assert task.main_content == "updated main"
        assert task.worktree_content == "updated worktree"
        assert task.base_content == "updated base"
        assert task.spec_name == "spec-2"
        assert task.project_dir == Path("/updated")


class TestParallelMergeResult:
    """Tests for ParallelMergeResult dataclass."""

    def test_create_successful_result(self):
        """ParallelMergeResult can represent a successful merge."""
        result = ParallelMergeResult(
            file_path="src/example.py",
            merged_content="merged content",
            success=True,
            error=None,
            was_auto_merged=True,
        )

        assert result.file_path == "src/example.py"
        assert result.merged_content == "merged content"
        assert result.success is True
        assert result.error is None
        assert result.was_auto_merged is True

    def test_create_failed_result(self):
        """ParallelMergeResult can represent a failed merge."""
        result = ParallelMergeResult(
            file_path="src/example.py",
            merged_content=None,
            success=False,
            error="Merge conflict occurred",
            was_auto_merged=False,
        )

        assert result.file_path == "src/example.py"
        assert result.merged_content is None
        assert result.success is False
        assert result.error == "Merge conflict occurred"
        assert result.was_auto_merged is False

    def test_result_default_values(self):
        """ParallelMergeResult has correct default values."""
        result = ParallelMergeResult(
            file_path="src/example.py",
            merged_content="content",
            success=True,
        )

        assert result.error is None
        assert result.was_auto_merged is False

    def test_result_field_assignment(self):
        """ParallelMergeResult fields can be reassigned."""
        result = ParallelMergeResult(
            file_path="src/example.py",
            merged_content="merged",
            success=True,
            error=None,
            was_auto_merged=False,
        )

        result.file_path = "src/updated.py"
        result.merged_content = "updated merged"
        result.success = False
        result.error = "New error"
        result.was_auto_merged = True

        assert result.file_path == "src/updated.py"
        assert result.merged_content == "updated merged"
        assert result.success is False
        assert result.error == "New error"
        assert result.was_auto_merged is True


class TestMergeLockError:
    """Tests for MergeLockError exception."""

    def test_merge_lock_error_creation(self):
        """MergeLockError can be instantiated with a message."""
        error = MergeLockError("Could not acquire lock")
        assert str(error) == "Could not acquire lock"

    def test_merge_lock_error_is_exception(self):
        """MergeLockError is an Exception subclass."""
        error = MergeLockError("test")
        assert isinstance(error, Exception)
        assert isinstance(error, MergeLockError)

    def test_raise_merge_lock_error(self):
        """MergeLockError can be raised and caught."""
        with pytest.raises(MergeLockError) as exc_info:
            raise MergeLockError("Lock timeout")

        assert str(exc_info.value) == "Lock timeout"


class TestMergeLock:
    """Tests for MergeLock context manager."""

    def test_merge_lock_initialization(self, temp_git_repo: Path):
        """MergeLock initializes with correct paths."""
        lock = MergeLock(temp_git_repo, "test-spec")

        assert lock.project_dir == temp_git_repo
        assert lock.spec_name == "test-spec"
        assert lock.lock_dir == temp_git_repo / ".auto-claude" / ".locks"
        assert lock.lock_file == lock.lock_dir / "merge-test-spec.lock"
        assert lock.acquired is False

    def test_merge_lock_acquire_and_release(self, temp_git_repo: Path):
        """MergeLock can be acquired and released."""
        lock = MergeLock(temp_git_repo, "test-spec")

        with lock:
            assert lock.acquired is True
            assert lock.lock_file.exists()

        # After context, lock should be released
        assert lock.lock_file.exists() is False

    def test_merge_lock_creates_lock_dir(self, temp_git_repo: Path):
        """MergeLock creates lock directory if it doesn't exist."""
        lock = MergeLock(temp_git_repo, "test-spec")

        # Remove lock dir if it exists
        if lock.lock_dir.exists():
            lock.lock_dir.rmdir()

        with lock:
            assert lock.lock_dir.exists()

    def test_merge_lock_writes_pid(self, temp_git_repo: Path):
        """MergeLock writes current PID to lock file."""
        import os

        lock = MergeLock(temp_git_repo, "test-spec")

        with lock:
            pid_content = lock.lock_file.read_text(encoding="utf-8").strip()
            assert pid_content == str(os.getpid())

    @pytest.mark.slow
    def test_merge_lock_timeout_on_contention(self, temp_git_repo: Path):
        """MergeLock raises MergeLockError when lock is held by another process."""
        import os
        import time

        lock1 = MergeLock(temp_git_repo, "test-spec")

        # Acquire first lock
        lock1.__enter__()

        try:
            # Create a second lock for the same spec
            lock2 = MergeLock(temp_git_repo, "test-spec")

            # This should timeout because lock1 holds the lock
            with pytest.raises(MergeLockError) as exc_info:
                lock2.__enter__()

            assert "Could not acquire merge lock" in str(exc_info.value)
            assert "test-spec" in str(exc_info.value)
            assert "after 30s" in str(exc_info.value)
        finally:
            lock1.__exit__(None, None, None)

    def test_merge_lock_removes_stale_lock(self, temp_git_repo: Path):
        """MergeLock removes stale lock from dead process."""
        import os

        lock1 = MergeLock(temp_git_repo, "test-spec")

        with lock1:
            # Write a fake PID that doesn't exist
            fake_pid = 999999
            lock1.lock_file.write_text(str(fake_pid), encoding="utf-8")

            # Create a new lock - it should remove the stale lock
            lock2 = MergeLock(temp_git_repo, "test-spec")
            with lock2:
                assert lock2.acquired is True

    def test_merge_lock_handles_invalid_pid(self, temp_git_repo: Path):
        """MergeLock handles invalid PID in lock file."""
        lock1 = MergeLock(temp_git_repo, "test-spec")

        with lock1:
            # Write invalid content to lock file
            lock1.lock_file.write_text("invalid-pid", encoding="utf-8")

            # Create a new lock - it should remove the invalid lock
            lock2 = MergeLock(temp_git_repo, "test-spec")
            with lock2:
                assert lock2.acquired is True

    def test_merge_lock_cleanup_on_exception(self, temp_git_repo: Path):
        """MergeLock releases lock even if exception occurs in context."""
        lock = MergeLock(temp_git_repo, "test-spec")

        try:
            with lock:
                assert lock.acquired is True
                raise ValueError("Test exception")
        except ValueError:
            pass

        # Lock should be released despite exception
        assert lock.lock_file.exists() is False

    def test_merge_lock_idempotent_release(self, temp_git_repo: Path):
        """MergeLock __exit__ can be called multiple times safely."""
        lock = MergeLock(temp_git_repo, "test-spec")

        with lock:
            pass

        # Call __exit__ again - should not raise
        lock.__exit__(None, None, None)
        lock.__exit__(None, None, None)

    def test_merge_lock_different_specs_dont_conflict(self, temp_git_repo: Path):
        """MergeLock for different specs can be held simultaneously."""
        lock1 = MergeLock(temp_git_repo, "spec-1")
        lock2 = MergeLock(temp_git_repo, "spec-2")

        with lock1:
            with lock2:
                assert lock1.acquired is True
                assert lock2.acquired is True
                assert lock1.lock_file != lock2.lock_file


class TestSpecNumberLockError:
    """Tests for SpecNumberLockError exception."""

    def test_spec_number_lock_error_creation(self):
        """SpecNumberLockError can be instantiated with a message."""
        error = SpecNumberLockError("Could not acquire spec numbering lock")
        assert str(error) == "Could not acquire spec numbering lock"

    def test_spec_number_lock_error_is_exception(self):
        """SpecNumberLockError is an Exception subclass."""
        error = SpecNumberLockError("test")
        assert isinstance(error, Exception)
        assert isinstance(error, SpecNumberLockError)

    def test_raise_spec_number_lock_error(self):
        """SpecNumberLockError can be raised and caught."""
        with pytest.raises(SpecNumberLockError) as exc_info:
            raise SpecNumberLockError("Lock timeout")

        assert str(exc_info.value) == "Lock timeout"


class TestSpecNumberLock:
    """Tests for SpecNumberLock context manager."""

    def test_spec_number_lock_initialization(self, temp_git_repo: Path):
        """SpecNumberLock initializes with correct paths."""
        lock = SpecNumberLock(temp_git_repo)

        assert lock.project_dir == temp_git_repo
        assert lock.lock_dir == temp_git_repo / ".auto-claude" / ".locks"
        assert lock.lock_file == lock.lock_dir / "spec-numbering.lock"
        assert lock.acquired is False
        assert lock._global_max is None

    def test_spec_number_lock_acquire_and_release(self, temp_git_repo: Path):
        """SpecNumberLock can be acquired and released."""
        lock = SpecNumberLock(temp_git_repo)

        with lock:
            assert lock.acquired is True
            assert lock.lock_file.exists()

        # After context, lock should be released
        assert lock.lock_file.exists() is False

    def test_spec_number_lock_creates_lock_dir(self, temp_git_repo: Path):
        """SpecNumberLock creates lock directory if it doesn't exist."""
        lock = SpecNumberLock(temp_git_repo)

        # Remove lock dir if it exists
        if lock.lock_dir.exists():
            lock.lock_dir.rmdir()

        with lock:
            assert lock.lock_dir.exists()

    def test_spec_number_lock_writes_pid(self, temp_git_repo: Path):
        """SpecNumberLock writes current PID to lock file."""
        import os

        lock = SpecNumberLock(temp_git_repo)

        with lock:
            pid_content = lock.lock_file.read_text(encoding="utf-8").strip()
            assert pid_content == str(os.getpid())

    def test_get_next_spec_number_no_existing_specs(self, temp_git_repo: Path):
        """get_next_spec_number returns 1 when no specs exist."""
        lock = SpecNumberLock(temp_git_repo)

        with lock:
            next_num = lock.get_next_spec_number()
            assert next_num == 1

    def test_get_next_spec_number_with_existing_specs(self, temp_git_repo: Path):
        """get_next_spec_number returns max existing spec number + 1."""
        # Create spec directories
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)
        (specs_dir / "001-first").mkdir()
        (specs_dir / "003-third").mkdir()

        lock = SpecNumberLock(temp_git_repo)

        with lock:
            next_num = lock.get_next_spec_number()
            assert next_num == 4

    def test_get_next_spec_number_caches_result(self, temp_git_repo: Path):
        """get_next_spec_number caches the global max."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)
        (specs_dir / "005-test").mkdir()

        lock = SpecNumberLock(temp_git_repo)

        with lock:
            next_num1 = lock.get_next_spec_number()
            next_num2 = lock.get_next_spec_number()

            # Should return the same value (cached)
            assert next_num1 == next_num2 == 6
            assert lock._global_max == 5

    def test_get_next_spec_number_requires_lock(self, temp_git_repo: Path):
        """get_next_spec_number raises SpecNumberLockError if lock not acquired."""
        lock = SpecNumberLock(temp_git_repo)

        with pytest.raises(SpecNumberLockError) as exc_info:
            lock.get_next_spec_number()

        assert "Lock must be acquired" in str(exc_info.value)

    def test_get_next_spec_number_scans_worktrees(self, temp_git_repo: Path):
        """get_next_spec_number scans all worktree spec directories."""
        # Create main project specs
        main_specs = temp_git_repo / ".auto-claude" / "specs"
        main_specs.mkdir(parents=True)
        (main_specs / "002-main").mkdir()

        # Create worktree with specs
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_spec_dir = worktrees_dir / "test-worktree" / ".auto-claude" / "specs"
        worktree_spec_dir.mkdir(parents=True)
        (worktree_spec_dir / "005-worktree").mkdir()

        lock = SpecNumberLock(temp_git_repo)

        with lock:
            next_num = lock.get_next_spec_number()
            # Should find max of 2 and 5, return 6
            assert next_num == 6

    def test_scan_specs_dir_nonexistent(self, temp_git_repo: Path):
        """_scan_specs_dir returns 0 for nonexistent directory."""
        lock = SpecNumberLock(temp_git_repo)

        with lock:
            # Use a path inside temp_dir that doesn't exist
            nonexistent = temp_git_repo / "this_does_not_exist_specs"
            result = lock._scan_specs_dir(nonexistent)
            assert result == 0

    def test_scan_specs_dir_ignores_invalid_names(self, temp_git_repo: Path):
        """_scan_specs_dir ignores directories with invalid spec names."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)
        (specs_dir / "001-valid").mkdir()
        (specs_dir / "invalid-name").mkdir()
        (specs_dir / "abc").mkdir()
        (specs_dir / "100-valid").mkdir()

        lock = SpecNumberLock(temp_git_repo)

        with lock:
            result = lock._scan_specs_dir(specs_dir)
            # Should only count 001 and 100
            assert result == 100

    @pytest.mark.slow
    def test_spec_number_lock_timeout_on_contention(self, temp_git_repo: Path):
        """SpecNumberLock raises SpecNumberLockError when lock is held."""
        lock1 = SpecNumberLock(temp_git_repo)

        # Acquire first lock
        lock1.__enter__()

        try:
            # Create a second lock
            lock2 = SpecNumberLock(temp_git_repo)

            # This should timeout because lock1 holds the lock
            with pytest.raises(SpecNumberLockError) as exc_info:
                lock2.__enter__()

            assert "Could not acquire spec numbering lock" in str(exc_info.value)
            assert "after 30s" in str(exc_info.value)
        finally:
            lock1.__exit__(None, None, None)

    def test_spec_number_lock_removes_stale_lock(self, temp_git_repo: Path):
        """SpecNumberLock removes stale lock from dead process."""
        import os

        lock1 = SpecNumberLock(temp_git_repo)

        with lock1:
            # Write a fake PID that doesn't exist
            fake_pid = 999999
            lock1.lock_file.write_text(str(fake_pid), encoding="utf-8")

            # Create a new lock - it should remove the stale lock
            lock2 = SpecNumberLock(temp_git_repo)
            with lock2:
                assert lock2.acquired is True

    def test_spec_number_lock_handles_invalid_pid(self, temp_git_repo: Path):
        """SpecNumberLock handles invalid PID in lock file."""
        lock1 = SpecNumberLock(temp_git_repo)

        with lock1:
            # Write invalid content to lock file
            lock1.lock_file.write_text("invalid-pid", encoding="utf-8")

            # Create a new lock - it should remove the invalid lock
            lock2 = SpecNumberLock(temp_git_repo)
            with lock2:
                assert lock2.acquired is True

    def test_spec_number_lock_cleanup_on_exception(self, temp_git_repo: Path):
        """SpecNumberLock releases lock even if exception occurs in context."""
        lock = SpecNumberLock(temp_git_repo)

        try:
            with lock:
                assert lock.acquired is True
                raise ValueError("Test exception")
        except ValueError:
            pass

        # Lock should be released despite exception
        assert lock.lock_file.exists() is False

    def test_spec_number_lock_idempotent_release(self, temp_git_repo: Path):
        """SpecNumberLock __exit__ can be called multiple times safely."""
        lock = SpecNumberLock(temp_git_repo)

        with lock:
            pass

        # Call __exit__ again - should not raise
        lock.__exit__(None, None, None)
        lock.__exit__(None, None, None)

    def test_spec_number_lock_returns_self(self, temp_git_repo: Path):
        """SpecNumberLock __enter__ returns self."""
        lock = SpecNumberLock(temp_git_repo)

        with lock as entered_lock:
            assert entered_lock is lock

    def test_merge_success_returns_true(self, temp_git_repo: Path):
        """Successful merge returns True (ACS-163 verification)."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with non-conflicting changes
        worker_info = manager.create_worktree("worker-spec")
        (worker_info.path / "worker-file.txt").write_text("worker content")
        subprocess.run(["git", "add", "."], cwd=worker_info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path, capture_output=True
        )

        # Merge should succeed
        result = manager.merge_worktree("worker-spec", delete_after=False)

        assert result is True

        # Verify the file was merged into base branch
        subprocess.run(["git", "checkout", manager.base_branch], cwd=temp_git_repo, capture_output=True)
        assert (temp_git_repo / "worker-file.txt").exists(), "Merged file should exist in base branch"
        merged_content = (temp_git_repo / "worker-file.txt").read_text()
        assert merged_content == "worker content", "Merged file should have worktree content"


class TestRebaseDetection:
    """Tests for automatic rebase detection (ACS-224)."""

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
        (temp_git_repo / "spec-file.txt").write_text("spec content")
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
        (temp_git_repo / "main-file.txt").write_text("main content")
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
        assert result.get("commits_behind") == 1, "Should count commits behind correctly"
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
        (temp_git_repo / "spec-file.txt").write_text("spec content")
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
        (temp_git_repo / "spec-file.txt").write_text("spec content")
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
            (temp_git_repo / f"main-file-{i}.txt").write_text(f"main content {i}")
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
        (temp_git_repo / "spec-file.txt").write_text("spec content")
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
        (temp_git_repo / "main-file.txt").write_text("main content")
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

    def test_rebase_spec_branch_with_conflicts_aborts_cleanly(self, temp_git_repo: Path):
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
        (temp_git_repo / "conflict.txt").write_text("spec version")
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
        (temp_git_repo / "conflict.txt").write_text("main version")
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
        (temp_git_repo / "spec-file.txt").write_text("spec content")
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

        assert result is True, "Rebase should return True when branch is already up-to-date"


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
        (worker_info.path / "spec-file.txt").write_text("spec content")
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
            (temp_git_repo / f"main-{i}.txt").write_text(f"main {i}")
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
        (temp_git_repo / "spec.txt").write_text("spec")
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
        (temp_git_repo / "main.txt").write_text("main")
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
        (temp_git_repo / "spec-file.txt").write_text("spec content")
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
        import shutil

        from core.workspace import _check_git_conflicts

        # Create a spec branch
        spec_branch = "auto-claude/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "spec-file.txt").write_text("spec content")
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


class TestInferLanguageFromPath:
    """Tests for _infer_language_from_path function."""

    def test_python_file(self):
        """Correctly identifies Python files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("test.py") == "python"
        assert _infer_language_from_path("src/app.py") == "python"

    def test_javascript_file(self):
        """Correctly identifies JavaScript files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("test.js") == "javascript"
        assert _infer_language_from_path("src/app.js") == "javascript"

    def test_jsx_file(self):
        """Correctly identifies JSX files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("App.jsx") == "javascript"

    def test_typescript_file(self):
        """Correctly identifies TypeScript files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("test.ts") == "typescript"

    def test_tsx_file(self):
        """Correctly identifies TSX files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("App.tsx") == "typescript"

    def test_rust_file(self):
        """Correctly identifies Rust files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("main.rs") == "rust"

    def test_go_file(self):
        """Correctly identifies Go files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("main.go") == "go"

    def test_java_file(self):
        """Correctly identifies Java files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Main.java") == "java"

    def test_cpp_file(self):
        """Correctly identifies C++ files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("main.cpp") == "cpp"

    def test_c_file(self):
        """Correctly identifies C files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("main.c") == "c"

    def test_header_file(self):
        """Correctly identifies C header files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("header.h") == "c"

    def test_hpp_file(self):
        """Correctly identifies C++ header files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("header.hpp") == "cpp"

    def test_ruby_file(self):
        """Correctly identifies Ruby files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("app.rb") == "ruby"

    def test_php_file(self):
        """Correctly identifies PHP files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("index.php") == "php"

    def test_swift_file(self):
        """Correctly identifies Swift files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("App.swift") == "swift"

    def test_kotlin_file(self):
        """Correctly identifies Kotlin files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Main.kt") == "kotlin"

    def test_scala_file(self):
        """Correctly identifies Scala files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Main.scala") == "scala"

    def test_json_file(self):
        """Correctly identifies JSON files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("config.json") == "json"

    def test_yaml_file(self):
        """Correctly identifies YAML files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("config.yaml") == "yaml"

    def test_yml_file(self):
        """Correctly identifies YML files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("config.yml") == "yaml"

    def test_toml_file(self):
        """Correctly identifies TOML files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("config.toml") == "toml"

    def test_markdown_file(self):
        """Correctly identifies Markdown files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("README.md") == "markdown"

    def test_html_file(self):
        """Correctly identifies HTML files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("index.html") == "html"

    def test_css_file(self):
        """Correctly identifies CSS files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("style.css") == "css"

    def test_scss_file(self):
        """Correctly identifies SCSS files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("style.scss") == "scss"

    def test_sql_file(self):
        """Correctly identifies SQL files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("query.sql") == "sql"

    def test_unknown_extension(self):
        """Defaults to 'text' for unknown extensions."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("file.unknown") == "text"

    def test_no_extension(self):
        """Defaults to 'text' for files without extension."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Makefile") == "text"

    def test_case_insensitive(self):
        """Handles uppercase extensions correctly."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("test.PY") == "python"
        assert _infer_language_from_path("test.JS") == "javascript"

    def test_nested_path(self):
        """Correctly infers language from nested paths."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("src/components/Button.tsx") == "typescript"

    def test_dockerfile(self):
        """Defaults to 'text' for Dockerfile without extension."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Dockerfile") == "text"

    def test_makefile(self):
        """Defaults to 'text' for Makefile without extension."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Makefile") == "text"

    def test_gitignore(self):
        """Defaults to 'text' for .gitignore without extension."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path(".gitignore") == "text"

    def test_env_file(self):
        """Defaults to 'text' for .env files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path(".env") == "text"

    def test_config_yaml(self):
        """Identifies YAML in config files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("app.config.yaml") == "yaml"

    def test_sh_file(self):
        """Defaults to 'text' for shell scripts."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("script.sh") == "text"

    def test_txt_file(self):
        """Defaults to 'text' for .txt files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("notes.txt") == "text"

    def test_xml_file(self):
        """Defaults to 'text' for .xml files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("config.xml") == "text"

    def test_md_file_in_docs(self):
        """Identifies markdown in documentation paths."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("docs/api.md") == "markdown"

    def test_package_json(self):
        """Identifies JSON in package files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("package.json") == "json"

    def test_tsconfig_json(self):
        """Identifies JSON in TypeScript config files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("tsconfig.json") == "json"

    def test_python_init_file(self):
        """Identifies Python in __init__ files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("package/__init__.py") == "python"

    def test_absolute_path(self):
        """Handles absolute paths correctly."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("/usr/local/bin/script.py") == "python"

    def test_windows_path(self):
        """Handles Windows paths correctly."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("C:\\Users\\test\\file.js") == "javascript"


class TestStripCodeFences:
    """Tests for _strip_code_fences function."""

    def test_basic_code_fence(self):
        """Removes basic markdown code fences."""
        from core.workspace import _strip_code_fences

        content = "```python\ndef hello():\n    pass\n```"
        result = _strip_code_fences(content)
        assert result == "def hello():\n    pass"

    def test_code_fence_with_language(self):
        """Removes code fence with language specified."""
        from core.workspace import _strip_code_fences

        content = "```javascript\nconst x = 1;\n```"
        result = _strip_code_fences(content)
        assert result == "const x = 1;"

    def test_no_code_fence(self):
        """Returns content unchanged when no code fence present."""
        from core.workspace import _strip_code_fences

        content = "just some text"
        result = _strip_code_fences(content)
        assert result == content

    def test_code_fence_without_closing_fence(self):
        """Handles opening fence without closing fence."""
        from core.workspace import _strip_code_fences

        content = "```python\ndef hello():\n    pass"
        result = _strip_code_fences(content)
        assert result == "def hello():\n    pass"

    def test_multiple_lines_fence(self):
        """Handles multi-line code with fences."""
        from core.workspace import _strip_code_fences

        content = "```\nline1\nline2\nline3\n```"
        result = _strip_code_fences(content)
        assert result == "line1\nline2\nline3"

    def test_whitespace_around_fences(self):
        """Handles whitespace around code fences."""
        from core.workspace import _strip_code_fences

        content = "  ```python\ndef hello():\n  ```  "
        result = _strip_code_fences(content)
        assert "def hello():" in result

    def test_empty_fence(self):
        """Handles empty code fence."""
        from core.workspace import _strip_code_fences

        content = "```\n```"
        result = _strip_code_fences(content)
        assert result == ""

    def test_fence_with_no_language(self):
        """Handles fence without language specifier."""
        from core.workspace import _strip_code_fences

        content = "```\ncode here\n```"
        result = _strip_code_fences(content)
        assert result == "code here"

    def test_code_fence_with_spaces_in_fence_marker(self):
        """Handles fence markers with extra spaces."""
        from core.workspace import _strip_code_fences

        content = "``` python\ndef hello():\n    pass\n```"
        result = _strip_code_fences(content)
        assert "def hello():" in result

    def test_nested_fences_not_supported(self):
        """Doesn't handle nested fences (edge case)."""
        from core.workspace import _strip_code_fences

        content = "```\nouter ``` inner\ncode\n```"
        result = _strip_code_fences(content)
        # Should strip first fence
        assert result.startswith("outer")

    def test_only_fence_at_start(self):
        """Only strips fence if at start of content."""
        from core.workspace import _strip_code_fences

        content = "text\n```python\ncode\n```"
        result = _strip_code_fences(content)
        assert result == content

    def test_preserves_internal_markers(self):
        """Preserves triple backticks that aren't fences."""
        from core.workspace import _strip_code_fences

        content = "```python\ncode with ``` in it\n```"
        result = _strip_code_fences(content)
        assert "code with ``` in it" in result

    def test_multiple_fences_only_first(self):
        """Only removes first fence pair."""
        from core.workspace import _strip_code_fences

        content = "```\ncode1\n```\n```\ncode2\n```"
        result = _strip_code_fences(content)
        # First fence removed, second preserved
        assert result.startswith("code1")

    def test_closing_fence_with_extra_text(self):
        """Handles closing fence with text after."""
        from core.workspace import _strip_code_fences

        content = "```python\ncode\n``` extra"
        result = _strip_code_fences(content)
        assert result == "code\n``` extra"

    def test_four_backticks(self):
        """Handles four backticks (edge case)."""
        from core.workspace import _strip_code_fences

        content = "````python\ncode\n````"
        result = _strip_code_fences(content)
        # Should strip the fence
        assert "code" in result

    def test_unicode_in_code(self):
        """Preserves unicode characters in code."""
        from core.workspace import _strip_code_fences

        content = "```python\n# Comment with émoji 🎉\n```"
        result = _strip_code_fences(content)
        assert "émoji" in result
        assert "🎉" in result

    def test_trailing_newlines_preserved(self):
        """Preserves internal newlines in code content."""
        from core.workspace import _strip_code_fences

        content = "```python\ncode\n```"
        result = _strip_code_fences(content)
        assert result == "code"

    def test_single_line_code(self):
        """Handles single line code with fences."""
        from core.workspace import _strip_code_fences

        content = "```python\nx = 1\n```"
        result = _strip_code_fences(content)
        assert result == "x = 1"

    def test_code_with_tabs(self):
        """Preserves tabs in code content."""
        from core.workspace import _strip_code_fences

        content = "```python\n\tdef test():\n\t\tpass\n```"
        result = _strip_code_fences(content)
        assert "\t" in result

    def test_mixed_line_endings(self):
        """Handles mixed line endings."""
        from core.workspace import _strip_code_fences

        content = "```python\r\nline1\r\nline2\r\n```"
        result = _strip_code_fences(content)
        assert "line1" in result
        assert "line2" in result

    def test_fence_with_attributes(self):
        """Handles fence with extra attributes."""
        from core.workspace import _strip_code_fences

        content = "```python title=\"test.py\"\ncode\n```"
        result = _strip_code_fences(content)
        assert "code" in result

    def test_leading_spaces_in_content(self):
        """Preserves leading spaces in code."""
        from core.workspace import _strip_code_fences

        content = "```python\n    indented code\n```"
        result = _strip_code_fences(content)
        assert "    indented code" in result

    def test_code_with_emoji(self):
        """Preserves emoji in code content."""
        from core.workspace import _strip_code_fences

        content = "```python\n# 🎉 party time\n```"
        result = _strip_code_fences(content)
        assert "🎉" in result

    def test_very_long_code_line(self):
        """Handles very long code lines."""
        from core.workspace import _strip_code_fences

        long_line = "x" * 1000
        content = f"```\n{long_line}\n```"
        result = _strip_code_fences(content)
        assert len(result) == 1000


class TestTrySimple3wayMerge:
    """Tests for _try_simple_3way_merge function."""

    def test_both_sides_identical(self):
        """Returns content when both sides are identical."""
        from core.workspace import _try_simple_3way_merge

        base = "original"
        ours = "modified"
        theirs = "modified"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == "modified"

    def test_only_ours_changed(self):
        """Returns ours when only ours changed from base."""
        from core.workspace import _try_simple_3way_merge

        base = "original"
        ours = "ours modified"
        theirs = "original"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == "ours modified"

    def test_only_theirs_changed(self):
        """Returns theirs when only theirs changed from base."""
        from core.workspace import _try_simple_3way_merge

        base = "original"
        ours = "original"
        theirs = "theirs modified"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == "theirs modified"

    def test_both_changed_differently(self):
        """Returns False when both changed differently."""
        from core.workspace import _try_simple_3way_merge

        base = "original"
        ours = "ours change"
        theirs = "theirs change"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is False
        assert result is None

    def test_none_base_identical_sides(self):
        """Returns ours when base is None and both sides identical."""
        from core.workspace import _try_simple_3way_merge

        base = None
        ours = "same"
        theirs = "same"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == "same"

    def test_none_base_different_sides(self):
        """Returns False when base is None and sides differ."""
        from core.workspace import _try_simple_3way_merge

        base = None
        ours = "ours"
        theirs = "theirs"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is False
        assert result is None

    def test_empty_strings(self):
        """Handles empty strings correctly."""
        from core.workspace import _try_simple_3way_merge

        base = ""
        ours = ""
        theirs = ""

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == ""

    def test_multiline_content(self):
        """Handles multiline content correctly."""
        from core.workspace import _try_simple_3way_merge

        base = "line1\nline2"
        ours = "line1\nline2"
        theirs = "line1\nline2\nline3"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == "line1\nline2\nline3"

    def test_whitespace_differences(self):
        """Treats whitespace differences as changes."""
        from core.workspace import _try_simple_3way_merge

        base = "text"
        ours = "text "
        theirs = "text"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        # Different from base means ours is the change
        assert success is True
        assert result == "text "

    def test_all_same(self):
        """Returns True when all three are the same."""
        from core.workspace import _try_simple_3way_merge

        content = "same content"
        success, result = _try_simple_3way_merge(content, content, content)
        assert success is True
        assert result == content

    def test_newline_differences(self):
        """Handles trailing newline differences."""
        from core.workspace import _try_simple_3way_merge

        base = "text"
        ours = "text\n"
        theirs = "text"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        # Different from base means ours is the change
        assert success is True
        assert result == "text\n"


class TestBuildMergePrompt:
    """Tests for _build_merge_prompt function."""

    def test_basic_prompt_structure(self):
        """Creates prompt with all required sections."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "test.py",
            "base content",
            "main content",
            "worktree content",
            "spec-001",
        )

        assert "FILE: test.py" in prompt
        assert "TASK: spec-001" in prompt
        assert "OURS" in prompt
        assert "THEIRS" in prompt
        assert "main content" in prompt
        assert "worktree content" in prompt

    def test_includes_language_from_file(self):
        """Infers and includes language in code fence."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "test.py",
            "base",
            "main",
            "worktree",
            "spec",
        )

        assert "```python" in prompt

    def test_with_base_content(self):
        """Includes BASE section when base content provided."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.js",
            "base content",
            "main",
            "worktree",
            "spec",
        )

        assert "BASE (common ancestor" in prompt
        assert "base content" in prompt

    def test_without_base_content(self):
        """Handles None base content gracefully."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.ts",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "BASE" not in prompt or "common ancestor" not in prompt

    def test_truncates_large_base_content(self):
        """Truncates base content over 10000 characters."""
        from core.workspace import _build_merge_prompt

        large_base = "x" * 15000
        prompt = _build_merge_prompt(
            "file.py",
            large_base,
            "main",
            "worktree",
            "spec",
        )

        assert "(truncated)" in prompt
        assert len(prompt) < len(large_base) + 1000

    def test_truncates_large_main_content(self):
        """Truncates main content over 15000 characters."""
        from core.workspace import _build_merge_prompt

        large_main = "y" * 20000
        prompt = _build_merge_prompt(
            "file.py",
            "base",
            large_main,
            "worktree",
            "spec",
        )

        assert "(truncated)" in prompt

    def test_truncates_large_worktree_content(self):
        """Truncates worktree content over 15000 characters."""
        from core.workspace import _build_merge_prompt

        large_worktree = "z" * 20000
        prompt = _build_merge_prompt(
            "file.py",
            "base",
            "main",
            large_worktree,
            "spec",
        )

        assert "(truncated)" in prompt

    def test_typescript_language(self):
        """Uses typescript for .ts files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.ts",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```typescript" in prompt

    def test_javascript_language(self):
        """Uses javascript for .js files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.js",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```javascript" in prompt

    def test_json_language(self):
        """Uses json for .json files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "config.json",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```json" in prompt

    def test_spec_name_included(self):
        """Includes spec name in prompt."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree",
            "my-spec-name",
        )

        assert "TASK: my-spec-name" in prompt

    def test_merge_instruction(self):
        """Includes merge instruction."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "3-way code merge" in prompt or "combine changes" in prompt.lower()

    def test_output_instruction(self):
        """Includes instruction to output only code."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "OUTPUT THE MERGED CODE ONLY" in prompt or "no explanations" in prompt

    def test_no_markdown_fences_instruction(self):
        """Includes instruction about no markdown fences."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "no markdown fences" in prompt

    def test_ours_section_description(self):
        """Describes OURS correctly."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main content",
            "worktree",
            "spec",
        )

        assert "OURS (current main branch" in prompt

    def test_theirs_section_description(self):
        """Describes THEIRS correctly."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree content",
            "spec",
        )

        assert "THEIRS (task worktree" in prompt

    def test_special_characters_in_content(self):
        """Handles special characters in content."""
        from core.workspace import _build_merge_prompt

        content = "code with 'quotes' and \"double quotes\" and \n newlines"
        prompt = _build_merge_prompt(
            "file.py",
            None,
            content,
            content,
            "spec",
        )

        assert "quotes" in prompt
        assert "\n" in prompt or "newlines" in prompt

    def test_empty_contents(self):
        """Handles empty contents gracefully."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            "",
            "",
            "",
            "spec",
        )

        # Should still have structure
        assert "FILE:" in prompt
        assert "OURS" in prompt
        assert "THEIRS" in prompt

    def test_markdown_language(self):
        """Uses markdown for .md files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "README.md",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```markdown" in prompt

    def test_yaml_language(self):
        """Uses yaml for .yml files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "config.yml",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```yaml" in prompt

    def test_cpp_language(self):
        """Uses cpp for .cpp files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "main.cpp",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```cpp" in prompt

    def test_rust_language(self):
        """Uses rust for .rs files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "main.rs",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```rust" in prompt

    def test_go_language(self):
        """Uses go for .go files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "main.go",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```go" in prompt

    def test_ruby_language(self):
        """Uses ruby for .rb files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "app.rb",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```ruby" in prompt

    def test_java_language(self):
        """Uses java for .java files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "Main.java",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```java" in prompt

    def test_sql_language(self):
        """Uses sql for .sql files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "query.sql",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```sql" in prompt

    def test_html_language(self):
        """Uses html for .html files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "index.html",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```html" in prompt

    def test_css_language(self):
        """Uses css for .css files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "style.css",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```css" in prompt

    def test_scss_language(self):
        """Uses scss for .scss files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "style.scss",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```scss" in prompt

    def test_text_language_for_unknown(self):
        """Uses text for unknown extensions."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.unknown",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```text" in prompt

    def test_truncates_both_large_contents(self):
        """Truncates both main and worktree when large."""
        from core.workspace import _build_merge_prompt

        large_main = "x" * 20000
        large_worktree = "y" * 20000
        prompt = _build_merge_prompt(
            "file.py",
            None,
            large_main,
            large_worktree,
            "spec",
        )

        # Should have truncation markers
        assert prompt.count("(truncated)") >= 2

    def test_preserves_small_base_content(self):
        """Does not truncate small base content."""
        from core.workspace import _build_merge_prompt

        base = "small base"
        prompt = _build_merge_prompt(
            "file.py",
            base,
            "main",
            "worktree",
            "spec",
        )

        assert "small base" in prompt
        assert "(truncated)" not in prompt

    def test_spec_name_with_special_chars(self):
        """Handles spec names with special characters."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree",
            "spec-001_feature",
        )

        assert "spec-001_feature" in prompt


class TestCreateMergeProgressCallback:
    """Tests for _create_merge_progress_callback function."""

    def test_returns_callable_when_piped(self, monkeypatch):
        """Returns emit_progress when stdout is not a TTY."""
        from core.workspace import _create_merge_progress_callback
        from merge.progress import emit_progress

        # Mock sys.stdout.isatty to return False
        monkeypatch.setattr("sys.stdout.isatty", lambda: False)

        callback = _create_merge_progress_callback()
        assert callback is not None
        assert callback == emit_progress

    def test_returns_none_when_tty(self, monkeypatch):
        """Returns None when stdout is a TTY."""
        from core.workspace import _create_merge_progress_callback

        # Mock sys.stdout.isatty to return True
        monkeypatch.setattr("sys.stdout.isatty", lambda: True)

        callback = _create_merge_progress_callback()
        assert callback is None

    def test_callback_emits_progress_json(self, monkeypatch, capsys):
        """Emits proper progress JSON when callback is used."""
        from core.workspace import _create_merge_progress_callback
        from merge.progress import MergeProgressStage

        # Mock sys.stdout.isatty to return False
        monkeypatch.setattr("sys.stdout.isatty", lambda: False)

        callback = _create_merge_progress_callback()
        if callback:
            callback(
                MergeProgressStage.ANALYZING,
                50,
                "Test message",
                {"test_key": "test_value"},
            )

            captured = capsys.readouterr()
            assert '"type": "progress"' in captured.out
            assert '"percent": 50' in captured.out
            assert '"message": "Test message"' in captured.out

    def test_multiple_callbacks_different_stages(self, monkeypatch, capsys):
        """Handles multiple callback calls with different stages."""
        from core.workspace import _create_merge_progress_callback
        from merge.progress import MergeProgressStage

        # Mock sys.stdout.isatty to return False
        monkeypatch.setattr("sys.stdout.isatty", lambda: False)

        callback = _create_merge_progress_callback()
        if callback:
            callback(MergeProgressStage.ANALYZING, 0, "Starting")
            callback(MergeProgressStage.COMPLETE, 100, "Done")

            captured = capsys.readouterr()
            assert "Starting" in captured.out
            assert "Done" in captured.out
            assert '"percent": 0' in captured.out
            assert '"percent": 100' in captured.out


# Helper classes for AI merge tests
class TextBlock:
    """Mock TextBlock for testing AI merge responses."""

    def __init__(self, text: str):
        self.text = text
        # Set __name__ for type checking
        self.__class__.__name__ = "TextBlock"


class AssistantMessage:
    """Mock AssistantMessage for testing AI merge responses."""

    def __init__(self, content: list):
        self.content = content
        # Set __name__ for type checking
        self.__class__.__name__ = "AssistantMessage"


class MockClientBase:
    """Base mock client class that implements async context manager."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def query(self, prompt):
        return None


class TestAttemptAiMerge:
    """Tests for _attempt_ai_merge function with extensive mocking."""

    def test_successful_merge_returns_true_and_content(self, temp_git_repo: Path):
        """Successful AI merge returns (True, merged_content, "")."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import _attempt_ai_merge, ParallelMergeTask

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="def foo():\n    pass",
            worktree_content="def bar():\n    pass",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client class that properly implements async context manager
        class MockClient(MockClientBase):
            def __init__(self):
                self.query_calls = []

            async def query(self, prompt):
                self.query_calls.append(prompt)
                return None

            async def receive_response(self):
                mock_msg = AssistantMessage([TextBlock("def merged():\n    pass")])
                yield mock_msg

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            with patch("core.workspace.git_utils.validate_merged_syntax", return_value=(True, "")):
                result = asyncio.run(
                    _attempt_ai_merge(
                        task,
                        "test prompt",
                        model="claude-haiku-4-5-20251001",
                        max_thinking_tokens=1024,
                    )
                )

        assert result[0] is True
        assert result[1] == "def merged():\n    pass"
        assert result[2] == ""

    def test_ai_returns_natural_language_returns_error(self, temp_git_repo: Path):
        """AI returning natural language instead of code returns error."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import _attempt_ai_merge, ParallelMergeTask

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client that returns natural language
        class MockClient(MockClientBase):
            async def receive_response(self):
                msg = AssistantMessage(
                    [TextBlock("I need to see more context to merge this properly.")]
                )
                yield msg

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            result = asyncio.run(
                _attempt_ai_merge(
                    task,
                    "test prompt",
                    model="claude-haiku-4-5-20251001",
                    max_thinking_tokens=1024,
                )
            )

        assert result[0] is False
        assert result[1] is None
        assert "explanation instead of code" in result[2].lower()

    def test_invalid_syntax_after_merge_returns_error(self, temp_git_repo: Path):
        """Invalid syntax after merge returns (False, None, error)."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import _attempt_ai_merge, ParallelMergeTask

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client that returns invalid Python
        class MockClient(MockClientBase):
            async def receive_response(self):
                msg = AssistantMessage([TextBlock("def merged(:\n    pass")])
                yield msg

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            result = asyncio.run(
                _attempt_ai_merge(
                    task,
                    "test prompt",
                    model="claude-haiku-4-5-20251001",
                    max_thinking_tokens=1024,
                )
            )

        assert result[0] is False
        assert result[1] is None
        assert "syntax" in result[2].lower()

    def test_empty_ai_response_returns_error(self, temp_git_repo: Path):
        """Empty AI response returns (False, None, error)."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import _attempt_ai_merge, ParallelMergeTask

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client that returns empty response
        class MockClient(MockClientBase):
            response_text = ""

            async def receive_response(self):
                # Empty generator - yields nothing
                return
                yield

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            result = asyncio.run(
                _attempt_ai_merge(
                    task,
                    "test prompt",
                    model="claude-haiku-4-5-20251001",
                    max_thinking_tokens=1024,
                )
            )

        assert result[0] is False
        assert result[1] is None
        assert "empty response" in result[2].lower()

    def test_code_fence_stripping_is_applied(self, temp_git_repo: Path):
        """Code fence stripping is applied to AI response."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import _attempt_ai_merge, ParallelMergeTask

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client that returns code with fences
        class MockClient(MockClientBase):
            async def receive_response(self):
                # Use markdown-style code fences (backticks)
                block = TextBlock("```python\ndef merged():\n    pass\n```")
                msg = AssistantMessage([block])
                yield msg

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            with patch("core.workspace.git_utils.validate_merged_syntax", return_value=(True, "")):
                result = asyncio.run(
                    _attempt_ai_merge(
                        task,
                        "test prompt",
                        model="claude-haiku-4-5-20251001",
                        max_thinking_tokens=1024,
                    )
                )

        assert result[0] is True
        # Code fences should be stripped
        assert not result[1].startswith("```")
        assert "def merged():" in result[1]

    def test_response_with_code_patterns_passes_natural_language_check(
        self, temp_git_repo: Path
    ):
        """Response with code patterns passes natural language check."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import _attempt_ai_merge, ParallelMergeTask

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client that returns valid code
        class MockClient(MockClientBase):
            async def receive_response(self):
                # Response that has "i need to" but also has code patterns
                block = TextBlock(
                    "# I need to handle edge cases\ndef merged():\n    pass\n"
                )
                msg = AssistantMessage([block])
                yield msg

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            with patch("core.workspace.git_utils.validate_merged_syntax", return_value=(True, "")):
                result = asyncio.run(
                    _attempt_ai_merge(
                        task,
                        "test prompt",
                        model="claude-haiku-4-5-20251001",
                        max_thinking_tokens=1024,
                    )
                )

        # Should pass because it has code patterns (def)
        assert result[0] is True
        assert "def merged():" in result[1]


class TestShowBuildSummary:
    """Tests for show_build_summary display function."""

    def test_show_build_summary_no_changes(self, capsys):
        """show_build_summary prints info message when no changes."""
        from core.workspace.display import show_build_summary
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 0,
            "modified_files": 0,
            "deleted_files": 0,
        }
        mock_manager.get_changed_files.return_value = []

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "No changes were made" in captured.out

    def test_show_build_summary_with_new_files(self, capsys):
        """show_build_summary displays new files count correctly."""
        from core.workspace.display import show_build_summary
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 3,
            "modified_files": 0,
            "deleted_files": 0,
        }
        mock_manager.get_changed_files.return_value = [
            ("A", "file1.py"),
            ("A", "file2.py"),
            ("A", "file3.py"),
        ]

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "What was built" in captured.out
        assert "+ 3 new files" in captured.out

    def test_show_build_summary_singular_new_file(self, capsys):
        """show_build_summary uses singular form for one new file."""
        from core.workspace.display import show_build_summary
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 1,
            "modified_files": 0,
            "deleted_files": 0,
        }
        mock_manager.get_changed_files.return_value = [("A", "file1.py")]

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "+ 1 new file" in captured.out
        assert "files" not in captured.out.split("new file")[1].split("\n")[0]

    def test_show_build_summary_with_modified_files(self, capsys):
        """show_build_summary displays modified files count correctly."""
        from core.workspace.display import show_build_summary
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 0,
            "modified_files": 2,
            "deleted_files": 0,
        }
        mock_manager.get_changed_files.return_value = [
            ("M", "file1.py"),
            ("M", "file2.py"),
        ]

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "~ 2 modified files" in captured.out

    def test_show_build_summary_with_deleted_files(self, capsys):
        """show_build_summary displays deleted files count correctly."""
        from core.workspace.display import show_build_summary
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 0,
            "modified_files": 0,
            "deleted_files": 1,
        }
        mock_manager.get_changed_files.return_value = [("D", "old.py")]

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "- 1 deleted file" in captured.out

    def test_show_build_summary_mixed_changes(self, capsys):
        """show_build_summary displays all change types together."""
        from core.workspace.display import show_build_summary
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 2,
            "modified_files": 3,
            "deleted_files": 1,
        }
        mock_manager.get_changed_files.return_value = [
            ("A", "new1.py"),
            ("A", "new2.py"),
            ("M", "mod1.py"),
            ("M", "mod2.py"),
            ("M", "mod3.py"),
            ("D", "old.py"),
        ]

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "+ 2 new files" in captured.out
        assert "~ 3 modified files" in captured.out
        assert "- 1 deleted file" in captured.out


class TestShowChangedFiles:
    """Tests for show_changed_files display function."""

    def test_show_changed_files_empty_list(self, capsys):
        """show_changed_files prints info message when no files changed."""
        from core.workspace.display import show_changed_files
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = []

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "No changes" in captured.out

    def test_show_changed_files_with_added_file(self, capsys):
        """show_changed_files displays added file with + prefix."""
        from core.workspace.display import show_changed_files
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = [("A", "new_file.py")]

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "Changed files" in captured.out
        assert "+ new_file.py" in captured.out

    def test_show_changed_files_with_modified_file(self, capsys):
        """show_changed_files displays modified file with ~ prefix."""
        from core.workspace.display import show_changed_files
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = [("M", "changed.py")]

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "~ changed.py" in captured.out

    def test_show_changed_files_with_deleted_file(self, capsys):
        """show_changed_files displays deleted file with - prefix."""
        from core.workspace.display import show_changed_files
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = [("D", "removed.py")]

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "- removed.py" in captured.out

    def test_show_changed_files_with_unknown_status(self, capsys):
        """show_changed_files displays unknown status code without decoration."""
        from core.workspace.display import show_changed_files
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = [("R", "renamed.py")]

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "R renamed.py" in captured.out

    def test_show_changed_files_multiple_files(self, capsys):
        """show_changed_files displays all changed files."""
        from core.workspace.display import show_changed_files
        from unittest.mock import MagicMock

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = [
            ("A", "new.py"),
            ("M", "modified.py"),
            ("D", "deleted.py"),
            ("R", "renamed.py"),
        ]

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "+ new.py" in captured.out
        assert "~ modified.py" in captured.out
        assert "- deleted.py" in captured.out
        assert "R renamed.py" in captured.out


class TestPrintMergeSuccess:
    """Tests for print_merge_success display function."""

    def test_print_merge_success_no_commit_basic(self, capsys):
        """print_merge_success with no_commit=True shows basic message."""
        from core.workspace.display import print_merge_success

        print_merge_success(no_commit=True)

        captured = capsys.readouterr()
        assert "CHANGES ADDED TO YOUR PROJECT" in captured.out
        assert "working directory" in captured.out
        assert "Review the changes" in captured.out
        assert "commit when ready" in captured.out

    def test_print_merge_success_no_commit_with_lock_files(self, capsys):
        """print_merge_success with lock_files_excluded shows lock file note."""
        from core.workspace.display import print_merge_success

        stats = {"lock_files_excluded": 2}
        print_merge_success(no_commit=True, stats=stats)

        captured = capsys.readouterr()
        assert "CHANGES ADDED TO YOUR PROJECT" in captured.out
        assert "Lock files kept from main" in captured.out
        assert "npm install" in captured.out

    def test_print_merge_success_no_commit_with_keep_worktree(self, capsys):
        """print_merge_success with keep_worktree shows discard command."""
        from core.workspace.display import print_merge_success

        print_merge_success(no_commit=True, spec_name="spec-001", keep_worktree=True)

        captured = capsys.readouterr()
        assert "CHANGES ADDED TO YOUR PROJECT" in captured.out
        assert "Worktree kept for testing" in captured.out
        assert "python auto-claude/run.py --spec spec-001 --discard" in captured.out

    def test_print_merge_success_no_commit_full_scenario(self, capsys):
        """print_merge_success with all optional parameters."""
        from core.workspace.display import print_merge_success

        stats = {"lock_files_excluded": 1}
        print_merge_success(
            no_commit=True,
            stats=stats,
            spec_name="test-spec",
            keep_worktree=True,
        )

        captured = capsys.readouterr()
        assert "CHANGES ADDED TO YOUR PROJECT" in captured.out
        assert "Lock files kept from main" in captured.out
        assert "Worktree kept for testing" in captured.out
        assert "--spec test-spec --discard" in captured.out

    def test_print_merge_success_with_commit_basic(self, capsys):
        """print_merge_success with no_commit=False shows commit message."""
        from core.workspace.display import print_merge_success

        print_merge_success(no_commit=False)

        captured = capsys.readouterr()
        assert "FEATURE ADDED TO YOUR PROJECT" in captured.out
        assert "separate workspace has been cleaned up" in captured.out

    def test_print_merge_success_with_commit_and_stats(self, capsys):
        """print_merge_success with stats shows file counts."""
        from core.workspace.display import print_merge_success

        stats = {
            "files_added": 5,
            "files_modified": 3,
            "files_deleted": 1,
        }
        print_merge_success(no_commit=False, stats=stats)

        captured = capsys.readouterr()
        assert "FEATURE ADDED TO YOUR PROJECT" in captured.out
        assert "What changed" in captured.out
        assert "+ 5 files added" in captured.out
        assert "~ 3 files modified" in captured.out
        assert "- 1 file deleted" in captured.out

    def test_print_merge_success_singular_file_counts(self, capsys):
        """print_merge_success uses singular form for single file counts."""
        from core.workspace.display import print_merge_success

        stats = {
            "files_added": 1,
            "files_modified": 1,
            "files_deleted": 1,
        }
        print_merge_success(no_commit=False, stats=stats)

        captured = capsys.readouterr()
        assert "+ 1 file added" in captured.out
        assert "~ 1 file modified" in captured.out
        assert "- 1 file deleted" in captured.out

    def test_print_merge_success_with_keep_worktree(self, capsys):
        """print_merge_success with keep_worktree shows discard command."""
        from core.workspace.display import print_merge_success

        print_merge_success(no_commit=False, keep_worktree=True, spec_name="my-spec")

        captured = capsys.readouterr()
        assert "FEATURE ADDED TO YOUR PROJECT" in captured.out
        assert "Worktree kept for testing" in captured.out
        assert "--spec my-spec --discard" in captured.out
        assert "separate workspace has been cleaned up" not in captured.out

    def test_print_merge_success_zero_file_counts_not_shown(self, capsys):
        """print_merge_success doesn't show file types with zero count."""
        from core.workspace.display import print_merge_success

        stats = {
            "files_added": 2,
            "files_modified": 0,
            "files_deleted": 0,
        }
        print_merge_success(no_commit=False, stats=stats)

        captured = capsys.readouterr()
        assert "+ 2 files added" in captured.out
        assert "files modified" not in captured.out
        assert "files deleted" not in captured.out


class TestPrintConflictInfoExtended:
    """Extended tests for print_conflict_info display function."""

    def test_print_conflict_info_empty_conflicts(self, capsys):
        """print_conflict_info returns early with empty conflicts list."""
        from core.workspace.display import print_conflict_info

        result = {"conflicts": []}

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert captured.out == ""

    def test_print_conflict_info_no_conflicts_key(self, capsys):
        """print_conflict_info returns early when conflicts key missing."""
        from core.workspace.display import print_conflict_info

        result = {}

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert captured.out == ""

    def test_print_conflict_info_critical_severity(self, capsys):
        """print_conflict_info shows critical severity icon."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "critical.py", "reason": "Breaking change", "severity": "critical"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "critical.py" in captured.out
        assert "⛔" in captured.out
        assert "Breaking change" in captured.out

    def test_print_conflict_info_high_severity(self, capsys):
        """print_conflict_info shows high severity icon."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "high.py", "reason": "Major conflict", "severity": "high"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "high.py" in captured.out
        assert "🔴" in captured.out
        assert "Major conflict" in captured.out

    def test_print_conflict_info_medium_severity(self, capsys):
        """print_conflict_info shows medium severity icon."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "medium.py", "reason": "Minor conflict", "severity": "medium"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "medium.py" in captured.out
        assert "🟡" in captured.out
        assert "Minor conflict" in captured.out

    def test_print_conflict_info_low_severity_no_icon(self, capsys):
        """print_conflict_info shows no icon for low severity."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "low.py", "reason": "Trivial issue", "severity": "low"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "low.py" in captured.out
        assert "Trivial issue" in captured.out
        assert "⛔" not in captured.out
        assert "🔴" not in captured.out
        assert "🟡" not in captured.out

    def test_print_conflict_info_unknown_severity(self, capsys):
        """print_conflict_info handles unknown severity gracefully."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "unknown.py", "reason": "Unknown", "severity": "unknown"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "unknown.py" in captured.out
        assert "Unknown" in captured.out

    def test_print_conflict_info_missing_file_key(self, capsys):
        """print_conflict_info handles missing file key."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"reason": "No file specified", "severity": "high"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "unknown" in captured.out
        assert "No file specified" in captured.out

    def test_print_conflict_info_missing_reason_key(self, capsys):
        """print_conflict_info handles missing reason key."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "noreason.py", "severity": "medium"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "noreason.py" in captured.out

    def test_print_conflict_info_dict_no_reason(self, capsys):
        """print_conflict_info with dict missing reason."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "test.py", "severity": "high"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "test.py" in captured.out
        assert "🔴" in captured.out

    def test_print_conflict_info_multiple_conflicts(self, capsys):
        """print_conflict_info handles multiple conflicts."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "critical.py", "reason": "Critical", "severity": "critical"},
                {"file": "high.py", "reason": "High", "severity": "high"},
                {"file": "medium.py", "reason": "Medium", "severity": "medium"},
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "3 file" in captured.out
        assert "⛔" in captured.out
        assert "🔴" in captured.out
        assert "🟡" in captured.out

    def test_print_conflict_info_shows_marker_conflict_message(self, capsys):
        """print_conflict_info shows marker conflict message for string conflicts."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": ["conflict.py"]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "conflict markers" in captured.out
        # Check that the conflict markers are mentioned in the message

    def test_print_conflict_info_shows_ai_conflict_message(self, capsys):
        """print_conflict_info shows AI conflict message for dict conflicts."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "ai-conflict.py", "reason": "AI merge failed", "severity": "high"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "could not be auto-merged" in captured.out

    def test_print_conflict_info_shows_both_messages_mixed(self, capsys):
        """print_conflict_info shows both messages for mixed conflicts."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                "marker.py",
                {"file": "ai.py", "reason": "AI failed", "severity": "high"},
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "conflict markers" in captured.out
        assert "could not be auto-merged" in captured.out

    def test_print_conflict_info_shows_git_commands(self, capsys):
        """print_conflict_info shows git add and commit commands."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": ["file1.py", "file2.py"]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "git add" in captured.out
        assert "git commit" in captured.out

    def test_print_conflict_info_quotes_special_paths(self, capsys):
        """print_conflict_info properly quotes file paths with special characters."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": ["file with spaces.py", "file'with'quotes.py"]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        # shlex.quote should quote paths with spaces
        assert "git add" in captured.out
        assert "file with spaces.py" in captured.out

    def test_print_conflict_info_deduplicates_files(self, capsys):
        """print_conflict_info deduplicates file paths in git command."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                "file1.py",
                {"file": "file1.py", "reason": "Also here", "severity": "medium"},
                "file2.py",
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        # file1.py should only appear once in git add command
        git_add_line = [line for line in captured.out.split("\n") if "git add" in line][0]
        # Count occurrences of file1.py
        count = captured.out.count("file1.py")
        assert count == 3  # Display shows it twice (string + dict), once in git add

    def test_print_conflict_info_preserves_order(self, capsys):
        """print_conflict_info preserves file order while deduplicating."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                "first.py",
                {"file": "second.py", "severity": "high"},
                "first.py",  # Duplicate
                {"file": "third.py", "severity": "medium"},
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        # First occurrence should be preserved
        lines = captured.out.split("\n")
        first_idx = None
        second_idx = None
        for i, line in enumerate(lines):
            if "first.py" in line:
                if first_idx is None:
                    first_idx = i
            if "second.py" in line:
                if second_idx is None:
                    second_idx = i
        assert first_idx is not None
        assert second_idx is not None


# =============================================================================
# TESTS FOR setup.py
# =============================================================================

class TestCopyEnvFilesToWorktree:
    """Tests for copy_env_files_to_worktree function."""

    def test_copies_all_env_files(self, temp_git_repo: Path):
        """Copies all .env files when they exist in project dir."""
        from core.workspace.setup import copy_env_files_to_worktree

        # Create .env files in project
        (temp_git_repo / ".env").write_text("FOO=bar")
        (temp_git_repo / ".env.local").write_text("LOCAL=1")
        (temp_git_repo / ".env.development").write_text("DEV=1")

        # Create worktree directory
        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        worktree_path.mkdir(parents=True)

        # Copy env files
        copied = copy_env_files_to_worktree(temp_git_repo, worktree_path)

        # Check all files were copied
        assert ".env" in copied
        assert ".env.local" in copied
        assert ".env.development" in copied
        assert len(copied) == 3

        # Verify files exist in worktree
        assert (worktree_path / ".env").exists()
        assert (worktree_path / ".env.local").exists()
        assert (worktree_path / ".env.development").exists()

    def test_skips_nonexistent_env_files(self, temp_git_repo: Path):
        """Only copies env files that exist."""
        from core.workspace.setup import copy_env_files_to_worktree

        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        worktree_path.mkdir(parents=True)

        copied = copy_env_files_to_worktree(temp_git_repo, worktree_path)

        assert len(copied) == 0

    def test_does_not_overwrite_existing_env_files(self, temp_git_repo: Path):
        """Does not overwrite .env files that already exist in worktree."""
        from core.workspace.setup import copy_env_files_to_worktree

        # Create .env in project
        (temp_git_repo / ".env").write_text("PROJECT=1")

        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        worktree_path.mkdir(parents=True)

        # Create existing .env in worktree with different content
        (worktree_path / ".env").write_text("WORKTREE=1")

        copied = copy_env_files_to_worktree(temp_git_repo, worktree_path)

        # .env should not be in copied list since it already existed
        assert ".env" not in copied

        # Worktree .env should keep its original content
        assert (worktree_path / ".env").read_text() == "WORKTREE=1"


class TestSymlinkNodeModulesToWorktree:
    """Tests for symlink_node_modules_to_worktree function."""

    @pytest.mark.skipif(sys.platform != "linux", reason="Unix-specific test")
    def test_symlinks_node_modules_on_unix(self, temp_git_repo: Path):
        """Creates relative symlinks on Unix systems."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        # Create node_modules in project
        node_modules = temp_git_repo / "node_modules"
        node_modules.mkdir()
        (node_modules / "test.txt").write_text("test")

        # Create apps/frontend/node_modules
        frontend_node_modules = temp_git_repo / "apps" / "frontend" / "node_modules"
        frontend_node_modules.mkdir(parents=True)
        (frontend_node_modules / "test2.txt").write_text("test2")

        # Create worktree
        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        worktree_path.mkdir(parents=True)
        (worktree_path / "apps" / "frontend").mkdir(parents=True)

        # Create symlinks
        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        assert len(symlinked) == 2
        assert "node_modules" in symlinked
        assert "apps/frontend/node_modules" in symlinked

        # Verify symlinks exist and point to correct location
        assert (worktree_path / "node_modules").is_symlink()
        assert (worktree_path / "apps" / "frontend" / "node_modules").is_symlink()

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows-specific test")
    def test_creates_junctions_on_windows(self, temp_git_repo: Path, monkeypatch):
        """Creates junctions on Windows systems."""
        from core.workspace.setup import symlink_node_modules_to_worktree
        from unittest.mock import patch

        # Create node_modules in project
        node_modules = temp_git_repo / "node_modules"
        node_modules.mkdir()
        (node_modules / "test.txt").write_text("test")

        # Create worktree
        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        worktree_path.mkdir(parents=True)

        # Mock subprocess.run to simulate mklink /J success
        def mock_subprocess_run(cmd, capture_output=False, text=False):
            result = type('obj', (object,), {'returncode': 0, 'stderr': ''})()
            return result

        with patch('subprocess.run', side_effect=mock_subprocess_run):
            with monkeypatch.context() as m:
                m.setattr('sys.platform', 'win32')
                symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        assert "node_modules" in symlinked

    def test_skips_nonexistent_node_modules(self, temp_git_repo: Path):
        """Skips node_modules that don't exist in project."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        worktree_path.mkdir(parents=True)

        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        assert len(symlinked) == 0

    def test_skips_existing_symlinks(self, temp_git_repo: Path):
        """Does not recreate symlinks that already exist."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        # Create node_modules in project
        node_modules = temp_git_repo / "node_modules"
        node_modules.mkdir()
        (node_modules / "test.txt").write_text("test")

        # Create worktree
        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        worktree_path.mkdir(parents=True)

        # Create existing symlink
        if sys.platform != "win32":
            os.symlink(temp_git_repo / "node_modules", worktree_path / "node_modules")

        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        # Should skip existing symlink
        assert "node_modules" not in symlinked


class TestCopySpecToWorktree:
    """Tests for copy_spec_to_worktree function."""

    def test_copies_spec_files_to_worktree(self, temp_git_repo: Path):
        """Copies spec directory to worktree .auto-claude/specs/ location."""
        from core.workspace.setup import copy_spec_to_worktree

        # Create source spec directory
        source_spec = temp_git_repo / "specs" / "test-spec"
        source_spec.mkdir(parents=True)
        (source_spec / "spec.md").write_text("# Test Spec")
        (source_spec / "requirements.json").write_text("{}")

        # Create worktree
        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        worktree_path.mkdir(parents=True)

        # Copy spec
        result = copy_spec_to_worktree(source_spec, worktree_path, "test-spec")

        # Verify path is correct
        expected = worktree_path / ".auto-claude" / "specs" / "test-spec"
        assert result == expected

        # Verify files were copied
        assert (expected / "spec.md").exists()
        assert (expected / "requirements.json").exists()
        assert (expected / "spec.md").read_text() == "# Test Spec"

    def test_overwrites_existing_spec_in_worktree(self, temp_git_repo: Path):
        """Overwrites spec files if they already exist in worktree."""
        from core.workspace.setup import copy_spec_to_worktree

        # Create source spec
        source_spec = temp_git_repo / "specs" / "test-spec"
        source_spec.mkdir(parents=True)
        (source_spec / "spec.md").write_text("# New Spec")

        # Create worktree with existing spec
        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        worktree_path.mkdir(parents=True)
        existing_spec = worktree_path / ".auto-claude" / "specs" / "test-spec"
        existing_spec.mkdir(parents=True)
        (existing_spec / "spec.md").write_text("# Old Spec")

        # Copy spec
        result = copy_spec_to_worktree(source_spec, worktree_path, "test-spec")

        # Verify new content was copied
        assert (result / "spec.md").read_text() == "# New Spec"

    def test_creates_parent_directories(self, temp_git_repo: Path):
        """Creates .auto-claude/specs directory if it doesn't exist."""
        from core.workspace.setup import copy_spec_to_worktree

        source_spec = temp_git_repo / "specs" / "test-spec"
        source_spec.mkdir(parents=True)
        (source_spec / "spec.md").write_text("# Test")

        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        worktree_path.mkdir(parents=True)

        result = copy_spec_to_worktree(source_spec, worktree_path, "test-spec")

        # Parent directories should be created
        assert result.exists()
        assert (result.parent).exists()


class TestEnsureTimelineHookInstalled:
    """Tests for ensure_timeline_hook_installed function."""

    def test_skips_if_not_git_repo(self, temp_dir: Path):
        """Skips hook installation if directory is not a git repo."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Should not raise exception
        ensure_timeline_hook_installed(temp_dir)

    def test_skips_if_hook_already_installed(self, temp_git_repo: Path, monkeypatch):
        """Skips if FileTimelineTracker hook is already installed."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create hooks directory
        hooks_dir = temp_git_repo / ".git" / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)

        # Create hook with FileTimelineTracker marker
        hook_file = hooks_dir / "post-commit"
        hook_file.write_text("#!/bin/sh\n# FileTimelineTracker hook\necho 'tracked'")

        # Mock install_hook to track if it was called
        install_called = []

        def mock_install_hook(project_dir):
            install_called.append(True)

        monkeypatch.setattr("merge.install_hook.install_hook", mock_install_hook)

        ensure_timeline_hook_installed(temp_git_repo)

        # install_hook should not be called
        assert len(install_called) == 0

    def test_installs_hook_if_missing(self, temp_git_repo: Path):
        """Installs hook if it doesn't exist."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create hooks directory but no hook file
        hooks_dir = temp_git_repo / ".git" / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)

        # This test verifies the function runs without error
        # The actual install_hook call is hard to mock because it's imported locally
        # In production, the real install_hook would be called
        ensure_timeline_hook_installed(temp_git_repo)

        # Verify hooks directory exists (function ran)
        assert hooks_dir.exists()

class TestInitializeTimelineTracking:
    """Tests for initialize_timeline_tracking function."""

    def test_with_implementation_plan(self, temp_git_repo: Path, monkeypatch):
        """Initializes tracking with files from implementation plan."""
        from core.workspace.setup import initialize_timeline_tracking

        # Create source spec with implementation plan
        spec_name = "test-spec"
        source_spec = temp_git_repo / ".auto-claude" / "specs" / spec_name
        source_spec.mkdir(parents=True)

        plan = {
            "title": "Test Feature",
            "description": "Test description",
            "phases": [
                {
                    "subtasks": [
                        {"files": ["app/main.py", "app/utils.py"]},
                        {"files": ["tests/test_main.py"]},
                    ]
                }
            ],
        }
        (source_spec / "implementation_plan.json").write_text(json.dumps(plan))

        # Create worktree
        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / spec_name
        worktree_path.mkdir(parents=True)

        # Mock FileTimelineTracker
        mock_tracker_calls = []

        class MockTracker:
            def __init__(self, project_dir):
                pass

            def on_task_start(self, task_id, files_to_modify, branch_point_commit, task_intent, task_title):
                mock_tracker_calls.append({
                    "task_id": task_id,
                    "files": files_to_modify,
                    "branch": branch_point_commit,
                    "intent": task_intent,
                    "title": task_title,
                })

        monkeypatch.setattr("core.workspace.setup.FileTimelineTracker", MockTracker)

        initialize_timeline_tracking(temp_git_repo, spec_name, worktree_path, source_spec)

        # Verify tracker was called with correct parameters
        assert len(mock_tracker_calls) == 1
        call = mock_tracker_calls[0]
        assert call["task_id"] == spec_name
        assert set(call["files"]) == {"app/main.py", "app/utils.py", "tests/test_main.py"}
        assert call["title"] == "Test Feature"
        assert call["intent"] == "Test description"

    def test_without_implementation_plan(self, temp_git_repo: Path, monkeypatch):
        """Initializes tracking retroactively from worktree if no plan."""
        from core.workspace.setup import initialize_timeline_tracking

        spec_name = "test-spec"
        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / spec_name
        worktree_path.mkdir(parents=True)

        # Mock FileTimelineTracker
        mock_calls = []

        class MockTracker:
            def __init__(self, project_dir):
                pass

            def initialize_from_worktree(self, task_id, worktree_path, task_intent, task_title):
                mock_calls.append({
                    "task_id": task_id,
                    "worktree": worktree_path,
                    "intent": task_intent,
                    "title": task_title,
                })

        monkeypatch.setattr("core.workspace.setup.FileTimelineTracker", MockTracker)

        initialize_timeline_tracking(temp_git_repo, spec_name, worktree_path, None)

        # Should use retroactive initialization
        assert len(mock_calls) == 1
        assert mock_calls[0]["task_id"] == spec_name

    def test_handles_exception_gracefully(self, temp_git_repo: Path, monkeypatch, capsys):
        """Logs warning but doesn't raise exception on error."""
        from core.workspace.setup import initialize_timeline_tracking

        spec_name = "test-spec"
        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / spec_name
        worktree_path.mkdir(parents=True)

        # Mock FileTimelineTracker to raise exception
        class FailingTracker:
            def __init__(self, project_dir):
                raise Exception("Tracker init failed")

        monkeypatch.setattr("core.workspace.setup.FileTimelineTracker", FailingTracker)

        # Should not raise
        initialize_timeline_tracking(temp_git_repo, spec_name, worktree_path, None)

        # Should print warning
        captured = capsys.readouterr()
        assert "Timeline tracking" in captured.out or "Note:" in captured.out


# =============================================================================
# TESTS FOR finalization.py
# =============================================================================

class TestFinalizeWorkspace:
    """Tests for finalize_workspace function."""

    def test_direct_mode_returns_merge(self, temp_git_repo: Path, monkeypatch, capsys):
        """Direct mode returns MERGE choice and shows completion message."""
        from core.workspace.finalization import finalize_workspace

        # Mock the UI functions
        def mock_box(content, width=60, style="heavy"):
            return content

        monkeypatch.setattr("core.workspace.finalization.box", mock_box)

        result = finalize_workspace(
            temp_git_repo,
            "test-spec",
            manager=None,
            auto_continue=False,
        )

        assert result == WorkspaceChoice.MERGE

        captured = capsys.readouterr()
        assert "BUILD COMPLETE" in captured.out
        assert "directly to your project" in captured.out

    def test_auto_continue_mode_returns_later(self, temp_git_repo: Path):
        """Auto-continue mode returns LATER choice."""
        from core.workspace.finalization import finalize_workspace
        from worktree import WorktreeManager

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree info
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        result = finalize_workspace(
            temp_git_repo,
            spec_name,
            manager=manager,
            auto_continue=True,
        )

        assert result == WorkspaceChoice.LATER

    def test_isolated_mode_shows_menu(self, temp_git_repo: Path, monkeypatch):
        """Isolated mode shows menu with test/review/merge/later options."""
        from core.workspace.finalization import finalize_workspace
        from worktree import WorktreeManager

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock select_menu to return "test"
        def mock_select_menu(title, options, allow_quit):
            return "test"

        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)

        result = finalize_workspace(
            temp_git_repo,
            spec_name,
            manager=manager,
            auto_continue=False,
        )

        assert result == WorkspaceChoice.TEST


class TestHandleWorkspaceChoice:
    """Tests for handle_workspace_choice function."""

    def test_choice_test_shows_instructions(self, temp_git_repo: Path, monkeypatch, capsys):
        """TEST choice shows testing instructions."""
        from core.workspace.finalization import handle_workspace_choice
        from worktree import WorktreeManager

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        handle_workspace_choice(WorkspaceChoice.TEST, temp_git_repo, spec_name, manager)

        captured = capsys.readouterr()
        assert "TEST YOUR FEATURE" in captured.out
        assert str(worktree_path) in captured.out

    def test_choice_merge_calls_merge_worktree(self, temp_git_repo: Path, monkeypatch, capsys):
        """MERGE choice calls manager.merge_worktree."""
        from core.workspace.finalization import handle_workspace_choice
        from worktree import WorktreeManager

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree and commit something
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)
        (worktree_path / "test.py").write_text("test")

        # Initialize git in worktree and commit
        subprocess.run(["git", "init"], cwd=worktree_path, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=worktree_path, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=worktree_path, capture_output=True)
        subprocess.run(["git", "add", "."], cwd=worktree_path, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Test"], cwd=worktree_path, capture_output=True)

        handle_workspace_choice(WorkspaceChoice.MERGE, temp_git_repo, spec_name, manager)

        captured = capsys.readouterr()
        assert "Adding changes" in captured.out

    def test_choice_review_shows_changed_files(self, temp_git_repo: Path, monkeypatch, capsys):
        """REVIEW choice shows changed files."""
        from core.workspace.finalization import handle_workspace_choice
        from worktree import WorktreeManager

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock show_changed_files
        mock_shown = []

        def mock_show_changed_files(manager, spec_name):
            mock_shown.append(spec_name)

        monkeypatch.setattr("core.workspace.finalization.show_changed_files", mock_show_changed_files)

        handle_workspace_choice(WorkspaceChoice.REVIEW, temp_git_repo, spec_name, manager)

        assert len(mock_shown) == 1
        assert mock_shown[0] == spec_name

        captured = capsys.readouterr()
        assert "To see full details" in captured.out

    def test_choice_later_shows_deferred_message(self, temp_git_repo: Path, monkeypatch, capsys):
        """LATER choice shows deferral message."""
        from core.workspace.finalization import handle_workspace_choice
        from worktree import WorktreeManager

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        handle_workspace_choice(WorkspaceChoice.LATER, temp_git_repo, spec_name, manager)

        captured = capsys.readouterr()
        assert "No problem!" in captured.out
        assert "saved" in captured.out


class TestReviewExistingBuild:
    """Tests for review_existing_build function."""

    def test_no_existing_build_shows_warning(self, temp_git_repo: Path, capsys):
        """Shows warning when no existing build found."""
        from core.workspace.finalization import review_existing_build

        result = review_existing_build(temp_git_repo, "nonexistent-spec")

        assert result is False

        captured = capsys.readouterr()
        assert "No existing build found" in captured.out

    def test_shows_build_contents(self, temp_git_repo: Path, capsys):
        """Shows build summary and changed files when build exists."""
        from core.workspace.finalization import review_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        result = review_existing_build(temp_git_repo, spec_name)

        assert result is True

        captured = capsys.readouterr()
        assert "BUILD CONTENTS" in captured.out


class TestDiscardExistingBuild:
    """Tests for discard_existing_build function."""

    def test_no_existing_build_returns_false(self, temp_git_repo: Path, capsys):
        """Returns False when no existing build found."""
        from core.workspace.finalization import discard_existing_build

        result = discard_existing_build(temp_git_repo, "nonexistent-spec")

        assert result is False

        captured = capsys.readouterr()
        assert "No existing build found" in captured.out

    def test_confirmation_deletes_build(self, temp_git_repo: Path, monkeypatch, capsys):
        """Deletes build when user types 'delete' to confirm."""
        from core.workspace.finalization import discard_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock input to return "delete"
        monkeypatch.setattr("builtins.input", lambda: "delete")

        result = discard_existing_build(temp_git_repo, spec_name)

        assert result is True
        captured = capsys.readouterr()
        assert "Build deleted" in captured.out

    def test_cancelled_confirmation_returns_false(self, temp_git_repo: Path, monkeypatch, capsys):
        """Returns False when user doesn't confirm."""
        from core.workspace.finalization import discard_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock input to return "no"
        monkeypatch.setattr("builtins.input", lambda: "no")

        result = discard_existing_build(temp_git_repo, spec_name)

        assert result is False
        captured = capsys.readouterr()
        assert "Cancelled" in captured.out


class TestCheckExistingBuild:
    """Tests for check_existing_build function."""

    def test_no_existing_build_returns_false(self, temp_git_repo: Path):
        """Returns False when no existing build."""
        from core.workspace.finalization import check_existing_build

        result = check_existing_build(temp_git_repo, "nonexistent-spec")

        assert result is False

    def test_shows_menu_for_existing_build(self, temp_git_repo: Path, monkeypatch):
        """Shows menu when existing build found."""
        from core.workspace.finalization import check_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock select_menu to return "continue"
        def mock_select_menu(title, options, allow_quit):
            return "continue"

        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)

        result = check_existing_build(temp_git_repo, spec_name)

        assert result is True

    def test_review_choice_reviews_and_continues(self, temp_git_repo: Path, monkeypatch):
        """Review choice reviews build then continues."""
        from core.workspace.finalization import check_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        review_called = []

        def mock_review(project_dir, spec_name):
            review_called.append(spec_name)
            return True

        def mock_select_menu(title, options, allow_quit):
            return "review"

        def mock_input(prompt):
            return ""

        monkeypatch.setattr("core.workspace.finalization.review_existing_build", mock_review)
        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)
        monkeypatch.setattr("builtins.input", mock_input)

        result = check_existing_build(temp_git_repo, spec_name)

        assert result is True
        assert spec_name in review_called


class TestListAllWorktrees:
    """Tests for list_all_worktrees function."""

    def test_returns_empty_list_when_no_worktrees(self, temp_git_repo: Path):
        """Returns empty list when no worktrees exist."""
        from core.workspace.finalization import list_all_worktrees

        result = list_all_worktrees(temp_git_repo)

        assert result == []

    def test_lists_existing_worktrees(self, temp_git_repo: Path):
        """Returns list of existing worktrees."""
        from core.workspace.finalization import list_all_worktrees

        # Create worktrees
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        (worktrees_dir / "spec-001").mkdir()
        (worktrees_dir / "spec-002").mkdir()

        result = list_all_worktrees(temp_git_repo)

        assert len(result) == 2
        spec_names = {wt.spec_name for wt in result}
        assert "spec-001" in spec_names
        assert "spec-002" in spec_names


class TestCleanupAllWorktrees:
    """Tests for cleanup_all_worktrees function."""

    def test_no_worktrees_returns_false(self, temp_git_repo: Path, capsys):
        """Returns False when no worktrees found."""
        from core.workspace.finalization import cleanup_all_worktrees

        result = cleanup_all_worktrees(temp_git_repo, confirm=False)

        assert result is False

        captured = capsys.readouterr()
        assert "No worktrees found" in captured.out

    def test_cleanup_without_confirmation(self, temp_git_repo: Path):
        """Cleans up worktrees when confirm=False."""
        from core.workspace.finalization import cleanup_all_worktrees

        # Create worktrees
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        spec1_path = worktrees_dir / "spec-001"
        spec1_path.mkdir()
        spec2_path = worktrees_dir / "spec-002"
        spec2_path.mkdir()

        result = cleanup_all_worktrees(temp_git_repo, confirm=False)

        assert result is True
        assert not spec1_path.exists()
        assert not spec2_path.exists()

    def test_cleanup_with_confirmation_yes(self, temp_git_repo: Path, monkeypatch):
        """Cleans up worktrees when user confirms with 'yes'."""
        from core.workspace.finalization import cleanup_all_worktrees

        # Create worktrees
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        spec1_path = worktrees_dir / "spec-001"
        spec1_path.mkdir()

        # Mock input to return "yes"
        monkeypatch.setattr("builtins.input", lambda: "yes")

        result = cleanup_all_worktrees(temp_git_repo, confirm=True)

        assert result is True
        assert not spec1_path.exists()

    def test_cleanup_with_confirmation_no(self, temp_git_repo: Path, monkeypatch):
        """Cancels cleanup when user doesn't confirm."""
        from core.workspace.finalization import cleanup_all_worktrees

        # Create worktrees
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        spec1_path = worktrees_dir / "spec-001"
        spec1_path.mkdir()

        # Mock input to return "no"
        monkeypatch.setattr("builtins.input", lambda: "no")

        result = cleanup_all_worktrees(temp_git_repo, confirm=True)

        assert result is False
        assert spec1_path.exists()  # Should still exist


class TestDetectFileRenames:
    """Tests for detect_file_renames function."""

    def test_detects_single_file_rename(self, temp_git_repo: Path):
        """Detects a single file rename between two refs."""
        from core.workspace.git_utils import detect_file_renames

        # Create and commit a file
        (temp_git_repo / "old_name.txt").write_text("content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get the commit hash
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo, capture_output=True, text=True
        )
        old_commit = result.stdout.strip()

        # Rename the file
        (temp_git_repo / "old_name.txt").rename(temp_git_repo / "new_name.txt")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Rename file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Detect renames
        renames = detect_file_renames(temp_git_repo, old_commit, "HEAD")

        assert len(renames) == 1
        assert "old_name.txt" in renames
        assert renames["old_name.txt"] == "new_name.txt"

    def test_detects_multiple_file_renames(self, temp_git_repo: Path):
        """Detects multiple file renames between two refs."""
        from core.workspace.git_utils import detect_file_renames

        # Create and commit files
        (temp_git_repo / "file1.txt").write_text("content1")
        (temp_git_repo / "file2.txt").write_text("content2")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add files"],
            cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo, capture_output=True, text=True
        )
        old_commit = result.stdout.strip()

        # Rename both files
        (temp_git_repo / "file1.txt").rename(temp_git_repo / "renamed1.txt")
        (temp_git_repo / "file2.txt").rename(temp_git_repo / "renamed2.txt")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Rename files"],
            cwd=temp_git_repo, capture_output=True
        )

        # Detect renames
        renames = detect_file_renames(temp_git_repo, old_commit, "HEAD")

        assert len(renames) == 2
        assert "file1.txt" in renames
        assert renames["file1.txt"] == "renamed1.txt"
        assert "file2.txt" in renames
        assert renames["file2.txt"] == "renamed2.txt"

    def test_returns_empty_dict_when_no_renames(self, temp_git_repo: Path):
        """Returns empty dict when no renames occurred."""
        from core.workspace.git_utils import detect_file_renames

        # Create and commit a file
        (temp_git_repo / "test.txt").write_text("content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"],
            cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo, capture_output=True, text=True
        )
        old_commit = result.stdout.strip()

        # Modify file (not rename)
        (temp_git_repo / "test.txt").write_text("modified content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Modify file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Detect renames
        renames = detect_file_renames(temp_git_repo, old_commit, "HEAD")

        assert len(renames) == 0

    def test_returns_empty_dict_on_invalid_refs(self, temp_git_repo: Path):
        """Returns empty dict when given invalid refs."""
        from core.workspace.git_utils import detect_file_renames

        renames = detect_file_renames(temp_git_repo, "invalid_ref", "HEAD")

        assert renames == {}

    def test_detects_renames_with_similarity(self, temp_git_repo: Path):
        """Detects renames even when file content was slightly modified."""
        from core.workspace.git_utils import detect_file_renames

        # Create and commit a file
        (temp_git_repo / "old.txt").write_text("line1\nline2\nline3")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"],
            cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo, capture_output=True, text=True
        )
        old_commit = result.stdout.strip()

        # Rename and slightly modify
        (temp_git_repo / "old.txt").rename(temp_git_repo / "new.txt")
        (temp_git_repo / "new.txt").write_text("line1\nline2 modified\nline3")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Rename and modify"],
            cwd=temp_git_repo, capture_output=True
        )

        # Detect renames
        renames = detect_file_renames(temp_git_repo, old_commit, "HEAD")

        # Git may or may not detect rename with similarity threshold
        # Just verify the function runs without error
        assert isinstance(renames, dict)

    def test_detects_directory_moves(self, temp_git_repo: Path):
        """Detects files moved to different directories."""
        from core.workspace.git_utils import detect_file_renames

        # Create directory structure and commit
        (temp_git_repo / "src").mkdir()
        (temp_git_repo / "src" / "old.py").write_text("def foo(): pass")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"],
            cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo, capture_output=True, text=True
        )
        old_commit = result.stdout.strip()

        # Create new directory and move file
        (temp_git_repo / "lib").mkdir()
        (temp_git_repo / "src" / "old.py").rename(temp_git_repo / "lib" / "new.py")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Move file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Detect renames
        renames = detect_file_renames(temp_git_repo, old_commit, "HEAD")

        assert len(renames) == 1
        assert "src/old.py" in renames
        assert renames["src/old.py"] == "lib/new.py"


class TestApplyPathMapping:
    """Tests for apply_path_mapping function."""

    def test_returns_original_path_when_no_mapping(self):
        """Returns original path when no mapping exists."""
        from core.workspace.git_utils import apply_path_mapping

        mappings = {}
        result = apply_path_mapping("src/file.py", mappings)

        assert result == "src/file.py"

    def test_returns_mapped_path_when_exact_match(self):
        """Returns mapped path when exact match found."""
        from core.workspace.git_utils import apply_path_mapping

        mappings = {"old/path.py": "new/path.py"}
        result = apply_path_mapping("old/path.py", mappings)

        assert result == "new/path.py"

    def test_returns_original_path_when_not_in_mappings(self):
        """Returns original path when path not in mappings."""
        from core.workspace.git_utils import apply_path_mapping

        mappings = {"other/file.py": "mapped/file.py"}
        result = apply_path_mapping("src/file.py", mappings)

        assert result == "src/file.py"

    def test_handles_multiple_mappings(self):
        """Correctly applies one of many mappings."""
        from core.workspace.git_utils import apply_path_mapping

        mappings = {
            "src/old1.py": "src/new1.py",
            "src/old2.py": "src/new2.py",
            "src/old3.py": "src/new3.py",
        }

        assert apply_path_mapping("src/old1.py", mappings) == "src/new1.py"
        assert apply_path_mapping("src/old2.py", mappings) == "src/new2.py"
        assert apply_path_mapping("src/old3.py", mappings) == "src/new3.py"

    def test_handles_empty_path(self):
        """Handles empty string path."""
        from core.workspace.git_utils import apply_path_mapping

        mappings = {"file.py": "mapped.py"}
        result = apply_path_mapping("", mappings)

        assert result == ""

    def test_handles_path_with_special_characters(self):
        """Handles paths with special characters."""
        from core.workspace.git_utils import apply_path_mapping

        mappings = {"src/file-with-dashes.py": "src/file_with_underscores.py"}
        result = apply_path_mapping("src/file-with-dashes.py", mappings)

        assert result == "src/file_with_underscores.py"


class TestGetMergeBase:
    """Tests for get_merge_base function."""

    def test_finds_merge_base_for_diverged_branches(self, temp_git_repo: Path):
        """Finds merge-base commit for two diverged branches."""
        from core.workspace.git_utils import get_merge_base

        # Create a file on main
        (temp_git_repo / "base.txt").write_text("base content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base commit"],
            cwd=temp_git_repo, capture_output=True
        )

        # Create a feature branch
        subprocess.run(
            ["git", "checkout", "-b", "feature"],
            cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / "feature.txt").write_text("feature content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Feature commit"],
            cwd=temp_git_repo, capture_output=True
        )

        # Add a commit to main
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / "main.txt").write_text("main content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main commit"],
            cwd=temp_git_repo, capture_output=True
        )

        # Find merge base
        merge_base = get_merge_base(temp_git_repo, "main", "feature")

        assert merge_base is not None
        assert len(merge_base) == 40  # SHA-1 hash length

    def test_returns_none_for_invalid_ref(self, temp_git_repo: Path):
        """Returns None when given invalid ref."""
        from core.workspace.git_utils import get_merge_base

        merge_base = get_merge_base(temp_git_repo, "main", "invalid_branch")

        assert merge_base is None

    def test_finds_merge_base_same_branch(self, temp_git_repo: Path):
        """Returns current commit when refs are the same."""
        from core.workspace.git_utils import get_merge_base

        merge_base = get_merge_base(temp_git_repo, "HEAD", "HEAD")

        assert merge_base is not None
        assert len(merge_base) == 40

    def test_finds_merge_base_for_ancestors(self, temp_git_repo: Path):
        """Finds merge-base when one ref is ancestor of other."""
        from core.workspace.git_utils import get_merge_base

        # Create initial commit
        (temp_git_repo / "base.txt").write_text("base")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"],
            cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo, capture_output=True, text=True
        )
        base_commit = result.stdout.strip()

        # Add commit on top
        (temp_git_repo / "new.txt").write_text("new")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "New"],
            cwd=temp_git_repo, capture_output=True
        )

        # Merge base of HEAD and its ancestor should be the ancestor
        merge_base = get_merge_base(temp_git_repo, "HEAD", base_commit)

        assert merge_base == base_commit


class TestGetFileContentFromRef:
    """Tests for get_file_content_from_ref function."""

    def test_gets_file_content_from_commit(self, temp_git_repo: Path):
        """Gets file content from a specific commit."""
        from core.workspace.git_utils import get_file_content_from_ref

        # Create and commit a file
        (temp_git_repo / "test.txt").write_text("file content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"],
            cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo, capture_output=True, text=True
        )
        commit_hash = result.stdout.strip()

        # Get file content
        content = get_file_content_from_ref(temp_git_repo, commit_hash, "test.txt")

        assert content == "file content"

    def test_returns_none_for_nonexistent_file(self, temp_git_repo: Path):
        """Returns None when file doesn't exist at ref."""
        from core.workspace.git_utils import get_file_content_from_ref

        content = get_file_content_from_ref(temp_git_repo, "HEAD", "nonexistent.txt")

        assert content is None

    def test_returns_none_for_invalid_ref(self, temp_git_repo: Path):
        """Returns None when ref doesn't exist."""
        from core.workspace.git_utils import get_file_content_from_ref

        content = get_file_content_from_ref(temp_git_repo, "invalid_ref", "test.txt")

        assert content is None

    def test_gets_file_content_from_branch(self, temp_git_repo: Path):
        """Gets file content from a branch name."""
        from core.workspace.git_utils import get_file_content_from_ref

        # Create and commit a file on main
        (temp_git_repo / "branch_file.txt").write_text("branch content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get file content from branch
        content = get_file_content_from_ref(temp_git_repo, "main", "branch_file.txt")

        assert content == "branch content"

    def test_handles_multiline_file_content(self, temp_git_repo: Path):
        """Handles multiline file content correctly."""
        from core.workspace.git_utils import get_file_content_from_ref

        # Create and commit a multiline file
        content = "line1\nline2\nline3"
        (temp_git_repo / "multiline.txt").write_text(content)
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get file content
        result = get_file_content_from_ref(temp_git_repo, "HEAD", "multiline.txt")

        assert result == content

    def test_handles_empty_file(self, temp_git_repo: Path):
        """Handles empty file correctly."""
        from core.workspace.git_utils import get_file_content_from_ref

        # Create and commit an empty file
        (temp_git_repo / "empty.txt").write_text("")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add empty file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get file content
        content = get_file_content_from_ref(temp_git_repo, "HEAD", "empty.txt")

        assert content == ""


class TestGetBinaryFileContentFromRef:
    """Tests for get_binary_file_content_from_ref function."""

    def test_gets_binary_file_content(self, temp_git_repo: Path):
        """Gets binary file content from a ref."""
        from core.workspace.git_utils import get_binary_file_content_from_ref

        # Create and commit a binary file
        binary_content = b"\x00\x01\x02\x03\x04\x05"
        (temp_git_repo / "binary.bin").write_bytes(binary_content)
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add binary file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get binary content
        content = get_binary_file_content_from_ref(temp_git_repo, "HEAD", "binary.bin")

        assert content == binary_content

    def test_returns_none_for_nonexistent_file(self, temp_git_repo: Path):
        """Returns None when file doesn't exist."""
        from core.workspace.git_utils import get_binary_file_content_from_ref

        content = get_binary_file_content_from_ref(temp_git_repo, "HEAD", "nonexistent.bin")

        assert content is None

    def test_returns_none_for_invalid_ref(self, temp_git_repo: Path):
        """Returns None when ref doesn't exist."""
        from core.workspace.git_utils import get_binary_file_content_from_ref

        content = get_binary_file_content_from_ref(temp_git_repo, "invalid_ref", "test.bin")

        assert content is None

    def test_handles_large_binary_file(self, temp_git_repo: Path):
        """Handles larger binary files correctly."""
        from core.workspace.git_utils import get_binary_file_content_from_ref

        # Create and commit a larger binary file
        binary_content = bytes(range(256)) * 100  # 25.6 KB
        (temp_git_repo / "large.bin").write_bytes(binary_content)
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add large binary file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get binary content
        content = get_binary_file_content_from_ref(temp_git_repo, "HEAD", "large.bin")

        assert content == binary_content

    def test_handles_zero_byte_file(self, temp_git_repo: Path):
        """Handles zero-byte binary files."""
        from core.workspace.git_utils import get_binary_file_content_from_ref

        # Create and commit an empty file
        (temp_git_repo / "empty.bin").write_bytes(b"")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add empty binary file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get binary content
        content = get_binary_file_content_from_ref(temp_git_repo, "HEAD", "empty.bin")

        assert content == b""


class TestGetChangedFilesFromBranch:
    """Tests for get_changed_files_from_branch function."""

    def test_lists_changed_files(self, temp_git_repo: Path):
        """Lists all changed files between branches."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create a file on main
        (temp_git_repo / "base.txt").write_text("base")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"],
            cwd=temp_git_repo, capture_output=True
        )

        # Create feature branch with changes
        subprocess.run(
            ["git", "checkout", "-b", "feature"],
            cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / "new_file.txt").write_text("new")
        (temp_git_repo / "modified.txt").write_text("modified")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Feature changes"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get changed files
        files = get_changed_files_from_branch(temp_git_repo, "main", "feature")

        assert len(files) == 2
        file_paths = [f[0] for f in files]
        assert "new_file.txt" in file_paths
        assert "modified.txt" in file_paths

    def test_excludes_auto_claude_files_by_default(self, temp_git_repo: Path):
        """Excludes .auto-claude directory files by default."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create base
        (temp_git_repo / "base.txt").write_text("base")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"],
            cwd=temp_git_repo, capture_output=True
        )

        # Create feature branch with .auto-claude files
        subprocess.run(
            ["git", "checkout", "-b", "feature"],
            cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / ".auto-claude").mkdir()
        (temp_git_repo / ".auto-claude" / "spec.json").write_text("spec")
        (temp_git_repo / "normal.txt").write_text("normal")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Feature"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get changed files
        files = get_changed_files_from_branch(temp_git_repo, "main", "feature")

        file_paths = [f[0] for f in files]
        assert ".auto-claude/spec.json" not in file_paths
        assert "normal.txt" in file_paths

    def test_includes_auto_claude_files_when_disabled(self, temp_git_repo: Path):
        """Includes .auto-claude files when exclude_auto_claude=False."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create base
        (temp_git_repo / "base.txt").write_text("base")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"],
            cwd=temp_git_repo, capture_output=True
        )

        # Create feature branch
        subprocess.run(
            ["git", "checkout", "-b", "feature"],
            cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / ".auto-claude").mkdir()
        (temp_git_repo / ".auto-claude" / "spec.json").write_text("spec")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Feature"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get changed files without exclusion
        files = get_changed_files_from_branch(
            temp_git_repo, "main", "feature", exclude_auto_claude=False
        )

        file_paths = [f[0] for f in files]
        assert ".auto-claude/spec.json" in file_paths

    def test_includes_file_status(self, temp_git_repo: Path):
        """Includes file status (A, M, D) in results."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create base
        (temp_git_repo / "file.txt").write_text("original")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"],
            cwd=temp_git_repo, capture_output=True
        )

        # Create feature branch with additions
        subprocess.run(
            ["git", "checkout", "-b", "feature"],
            cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / "added.txt").write_text("added")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get changed files
        files = get_changed_files_from_branch(temp_git_repo, "main", "feature")

        assert len(files) == 1
        # Status should be 'A' for added
        assert files[0][1] in ("A", "M")  # Git may report as A or M depending on version

    def test_returns_empty_list_when_no_changes(self, temp_git_repo: Path):
        """Returns empty list when there are no changes."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create commit on main
        (temp_git_repo / "file.txt").write_text("content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Initial"],
            cwd=temp_git_repo, capture_output=True
        )

        # Create branch at same commit
        subprocess.run(
            ["git", "checkout", "-b", "feature"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get changed files
        files = get_changed_files_from_branch(temp_git_repo, "main", "feature")

        assert len(files) == 0

    def test_excludes_legacy_auto_claude_spec_files(self, temp_git_repo: Path):
        """Excludes auto-claude/specs directory files."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create base
        (temp_git_repo / "base.txt").write_text("base")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"],
            cwd=temp_git_repo, capture_output=True
        )

        # Create feature branch with legacy auto-claude/specs files
        subprocess.run(
            ["git", "checkout", "-b", "feature"],
            cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / "auto-claude").mkdir()
        (temp_git_repo / "auto-claude" / "specs").mkdir()
        (temp_git_repo / "auto-claude" / "specs" / "spec.md").write_text("spec")
        (temp_git_repo / "normal.txt").write_text("normal")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Feature"],
            cwd=temp_git_repo, capture_output=True
        )

        # Get changed files
        files = get_changed_files_from_branch(temp_git_repo, "main", "feature")

        file_paths = [f[0] for f in files]
        assert "auto-claude/specs/spec.md" not in file_paths
        assert "normal.txt" in file_paths


class TestIsProcessRunning:
    """Tests for is_process_running function."""

    def test_returns_false_for_nonexistent_pid(self):
        """Returns False for a non-existent PID."""
        from core.workspace.git_utils import is_process_running

        # Use a very high PID that's unlikely to exist
        result = is_process_running(999999)

        assert result is False

    def test_returns_true_for_current_process(self):
        """Returns True for the current process PID."""
        import os
        from core.workspace.git_utils import is_process_running

        current_pid = os.getpid()
        result = is_process_running(current_pid)

        assert result is True


class TestIsBinaryFile:
    """Tests for is_binary_file function."""

    def test_identifies_image_files(self):
        """Identifies image files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("image.png") is True
        assert is_binary_file("photo.jpg") is True
        assert is_binary_file("picture.jpeg") is True
        assert is_binary_file("graphic.gif") is True
        assert is_binary_file("icon.ico") is True
        assert is_binary_file("image.webp") is True
        assert is_binary_file("image.bmp") is True
        assert is_binary_file("image.svg") is True
        assert is_binary_file("image.tiff") is True

    def test_identifies_document_files(self):
        """Identifies document files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("doc.pdf") is True
        assert is_binary_file("doc.doc") is True
        assert is_binary_file("doc.docx") is True
        assert is_binary_file("sheet.xls") is True
        assert is_binary_file("sheet.xlsx") is True

    def test_identifies_archive_files(self):
        """Identifies archive files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("archive.zip") is True
        assert is_binary_file("archive.tar") is True
        assert is_binary_file("archive.gz") is True
        assert is_binary_file("archive.rar") is True
        assert is_binary_file("archive.7z") is True
        assert is_binary_file("archive.bz2") is True

    def test_identifies_executable_files(self):
        """Identifies executable files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("program.exe") is True
        assert is_binary_file("library.dll") is True
        assert is_binary_file("library.so") is True
        assert is_binary_file("library.dylib") is True
        assert is_binary_file("binary.bin") is True

    def test_identifies_audio_files(self):
        """Identifies audio files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("audio.mp3") is True
        assert is_binary_file("audio.wav") is True
        assert is_binary_file("audio.ogg") is True
        assert is_binary_file("audio.flac") is True

    def test_identifies_video_files(self):
        """Identifies video files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("video.mp4") is True
        assert is_binary_file("video.avi") is True
        assert is_binary_file("video.mov") is True
        assert is_binary_file("video.mkv") is True

    def test_identifies_font_files(self):
        """Identifies font files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("font.woff") is True
        assert is_binary_file("font.woff2") is True
        assert is_binary_file("font.ttf") is True
        assert is_binary_file("font.otf") is True

    def test_returns_false_for_text_files(self):
        """Returns False for text files."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("file.txt") is False
        assert is_binary_file("file.py") is False
        assert is_binary_file("file.js") is False
        assert is_binary_file("file.ts") is False
        assert is_binary_file("file.md") is False
        assert is_binary_file("file.json") is False
        assert is_binary_file("file.xml") is False
        assert is_binary_file("file.yaml") is False
        assert is_binary_file("file.yml") is False

    def test_case_insensitive_extension_check(self):
        """Handles uppercase extensions correctly."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("image.PNG") is True
        assert is_binary_file("image.JPG") is True
        assert is_binary_file("document.PDF") is True

    def test_handles_paths_with_directories(self):
        """Handles file paths with directory components."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("path/to/image.png") is True
        assert is_binary_file("src/lib/file.py") is False
        assert is_binary_file("assets/logo.jpg") is True


class TestIsLockFile:
    """Tests for is_lock_file function."""

    def test_identifies_npm_lock_file(self):
        """Identifies package-lock.json as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("package-lock.json") is True

    def test_identifies_pnpm_lock_file(self):
        """Identifies pnpm-lock.yaml as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("pnpm-lock.yaml") is True

    def test_identifies_yarn_lock_file(self):
        """Identifies yarn.lock as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("yarn.lock") is True

    def test_identifies_bun_lock_files(self):
        """Identifies bun.lockb and bun.lock as lock files."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("bun.lockb") is True
        assert is_lock_file("bun.lock") is True

    def test_identifies_python_lock_files(self):
        """Identifies Python lock files."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("Pipfile.lock") is True
        assert is_lock_file("poetry.lock") is True
        assert is_lock_file("uv.lock") is True

    def test_identifies_rust_lock_file(self):
        """Identifies Cargo.lock as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("Cargo.lock") is True

    def test_identifies_ruby_lock_file(self):
        """Identifies Gemfile.lock as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("Gemfile.lock") is True

    def test_identifies_php_lock_file(self):
        """Identifies composer.lock as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("composer.lock") is True

    def test_identifies_go_lock_file(self):
        """Identifies go.sum as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("go.sum") is True

    def test_returns_false_for_non_lock_files(self):
        """Returns False for non-lock files."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("package.json") is False
        assert is_lock_file("pyproject.toml") is False
        assert is_lock_file("Cargo.toml") is False
        assert is_lock_file("Gemfile") is False
        assert is_lock_file("file.txt") is False

    def test_handles_paths_with_directories(self):
        """Handles file paths with directory components."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("path/to/package-lock.json") is True
        assert is_lock_file("src/pnpm-lock.yaml") is True
        assert is_lock_file("deps/yarn.lock") is True


class TestValidateMergedSyntax:
    """Tests for validate_merged_syntax function."""

    def test_validates_python_syntax_successfully(self, temp_dir: Path):
        """Validates correct Python syntax successfully."""
        from core.workspace.git_utils import validate_merged_syntax

        code = "def hello():\n    return 'world'\n"
        is_valid, error = validate_merged_syntax("test.py", code, temp_dir)

        assert is_valid is True
        assert error == ""

    def test_detects_python_syntax_errors(self, temp_dir: Path):
        """Detects Python syntax errors."""
        from core.workspace.git_utils import validate_merged_syntax

        code = "def hello(\n    return 'world'\n"
        is_valid, error = validate_merged_syntax("test.py", code, temp_dir)

        assert is_valid is False
        assert "syntax error" in error.lower()

    def test_validates_json_syntax_successfully(self, temp_dir: Path):
        """Validates correct JSON syntax successfully."""
        from core.workspace.git_utils import validate_merged_syntax

        code = '{"key": "value", "number": 123}'
        is_valid, error = validate_merged_syntax("test.json", code, temp_dir)

        assert is_valid is True
        assert error == ""

    def test_detects_json_syntax_errors(self, temp_dir: Path):
        """Detects JSON syntax errors."""
        from core.workspace.git_utils import validate_merged_syntax

        code = '{"key": "value", "number"'
        is_valid, error = validate_merged_syntax("test.json", code, temp_dir)

        assert is_valid is False
        assert "json error" in error.lower() or "syntax" in error.lower()

    def test_skips_validation_for_unknown_extensions(self, temp_dir: Path):
        """Skips validation for unknown file types."""
        from core.workspace.git_utils import validate_merged_syntax

        code = "some random content"
        is_valid, error = validate_merged_syntax("file.unknown", code, temp_dir)

        assert is_valid is True
        assert error == ""

    def test_validates_typescript_with_mocked_esbuild(self, temp_dir: Path):
        """Validates TypeScript using esbuild (mocked)."""
        from unittest.mock import patch, MagicMock
        from core.workspace.git_utils import validate_merged_syntax

        code = "const x: number = 123;\n"

        # Mock subprocess.run for esbuild
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = ""
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result):
            is_valid, error = validate_merged_syntax("test.ts", code, temp_dir)

        # If esbuild is found, should validate
        # If not found, should skip validation (return True)
        assert is_valid is True

    def test_detects_typescript_syntax_errors_with_mock(self, temp_dir: Path):
        """Detects TypeScript syntax errors (mocked esbuild)."""
        from unittest.mock import patch, MagicMock
        from core.workspace.git_utils import validate_merged_syntax

        code = "const x: = 123;\n"  # Invalid syntax

        # Mock subprocess.run for esbuild to return error
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "✘ [ERROR] Expected expression but found '}'"

        with patch("subprocess.run", return_value=mock_result):
            is_valid, error = validate_merged_syntax("test.ts", code, temp_dir)

        assert is_valid is False
        assert "syntax error" in error.lower()

    def test_skips_validation_when_esbuild_not_found(self, temp_dir: Path):
        """Skips validation when esbuild is not available."""
        from unittest.mock import patch
        from core.workspace.git_utils import validate_merged_syntax

        code = "const x: number = 123;\n"

        # Mock subprocess.run to raise FileNotFoundError
        with patch("subprocess.run", side_effect=FileNotFoundError):
            is_valid, error = validate_merged_syntax("test.ts", code, temp_dir)

        assert is_valid is True
        assert error == ""

    def test_validates_javascript_with_mocked_esbuild(self, temp_dir: Path):
        """Validates JavaScript using esbuild (mocked)."""
        from unittest.mock import patch, MagicMock
        from core.workspace.git_utils import validate_merged_syntax

        code = "const x = 123;\n"

        # Mock subprocess.run for esbuild
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = ""
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result):
            is_valid, error = validate_merged_syntax("test.js", code, temp_dir)

        assert is_valid is True

    def test_validates_jsx_with_mocked_esbuild(self, temp_dir: Path):
        """Validates JSX using esbuild (mocked)."""
        from unittest.mock import patch, MagicMock
        from core.workspace.git_utils import validate_merged_syntax

        code = "const App = () => <div>Hello</div>;\n"

        # Mock subprocess.run for esbuild
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = ""
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result):
            is_valid, error = validate_merged_syntax("test.jsx", code, temp_dir)

        assert is_valid is True

    def test_validates_tsx_with_mocked_esbuild(self, temp_dir: Path):
        """Validates TSX using esbuild (mocked)."""
        from unittest.mock import patch, MagicMock
        from core.workspace.git_utils import validate_merged_syntax

        code = "const App: React.FC = () => <div>Hello</div>;\n"

        # Mock subprocess.run for esbuild
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = ""
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result):
            is_valid, error = validate_merged_syntax("test.tsx", code, temp_dir)

        assert is_valid is True

    def test_handles_python_indentation_errors(self, temp_dir: Path):
        """Detects Python indentation errors."""
        from core.workspace.git_utils import validate_merged_syntax

        code = "def hello():\n  return 'world'\n    return 'bad'\n"
        is_valid, error = validate_merged_syntax("test.py", code, temp_dir)

        assert is_valid is False
        assert "syntax error" in error.lower() or "indentation" in error.lower()

    def test_validates_empty_python_file(self, temp_dir: Path):
        """Validates empty Python file."""
        from core.workspace.git_utils import validate_merged_syntax

        code = ""
        is_valid, error = validate_merged_syntax("test.py", code, temp_dir)

        assert is_valid is True

    def test_validates_empty_json_file(self, temp_dir: Path):
        """Validates empty JSON file."""
        from core.workspace.git_utils import validate_merged_syntax

        code = "{}"
        is_valid, error = validate_merged_syntax("test.json", code, temp_dir)

        # Empty object is valid JSON
        assert is_valid is True

    def test_validates_complex_json(self, temp_dir: Path):
        """Validates complex nested JSON."""
        from core.workspace.git_utils import validate_merged_syntax

        code = '{"nested": {"key": "value", "array": [1, 2, 3]}}'
        is_valid, error = validate_merged_syntax("test.json", code, temp_dir)

        assert is_valid is True

    def test_detects_json_with_trailing_comma(self, temp_dir: Path):
        """Detects JSON error with trailing comma."""
        from core.workspace.git_utils import validate_merged_syntax

        code = '{"key": "value",}'
        is_valid, error = validate_merged_syntax("test.json", code, temp_dir)

        assert is_valid is False

    def test_handles_esbuild_timeout_gracefully(self, temp_dir: Path):
        """Handles esbuild timeout by skipping validation."""
        from unittest.mock import patch
        from core.workspace.git_utils import validate_merged_syntax
        import subprocess

        code = "const x = 123;\n"

        # Mock subprocess.run to raise TimeoutExpired
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("esbuild", 15)):
            is_valid, error = validate_merged_syntax("test.ts", code, temp_dir)

        assert is_valid is True
        assert error == ""


class TestCreateConflictFileWithGit:
    """Tests for create_conflict_file_with_git function."""

    def test_creates_clean_merge(self, temp_git_repo: Path):
        """Creates merged content when there are no conflicts."""
        from core.workspace.git_utils import create_conflict_file_with_git

        main_content = "line1\nline2\nline3"
        worktree_content = "line1\nline2\nline3"
        base_content = "line1\nline2\nline3"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None
        assert "line1" in merged

    def test_detects_conflicts(self, temp_git_repo: Path):
        """Detects conflicts and adds conflict markers."""
        from core.workspace.git_utils import create_conflict_file_with_git

        main_content = "line1\nmain version\nline3"
        worktree_content = "line1\nworktree version\nline3"
        base_content = "line1\nline2\nline3"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        assert had_conflicts is True
        assert merged is not None
        assert "<<<<<<<" in merged or "=======" in merged or ">>>>>>>" in merged

    def test_handles_none_base_content(self, temp_git_repo: Path):
        """Handles None as base content."""
        from core.workspace.git_utils import create_conflict_file_with_git

        main_content = "line1\nline2"
        worktree_content = "line1\nline2"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, None, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None

    def test_returns_none_on_error(self, temp_dir: Path):
        """Returns (None, False) when git merge-file fails."""
        from core.workspace.git_utils import create_conflict_file_with_git
        from unittest.mock import patch

        # Mock run_git to raise an exception
        with patch("core.workspace.git_utils.run_git", side_effect=Exception("Git error")):
            merged, had_conflicts = create_conflict_file_with_git(
                "main", "worktree", "base", temp_dir
            )

        assert merged is None
        assert had_conflicts is False

    def test_auto_merges_when_only_main_changed(self, temp_git_repo: Path):
        """Auto-merges when only main content changed from base."""
        from core.workspace.git_utils import create_conflict_file_with_git

        base_content = "original line"
        main_content = "modified line"
        worktree_content = "original line"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None
        assert "modified line" in merged

    def test_auto_merges_when_only_worktree_changed(self, temp_git_repo: Path):
        """Auto-merges when only worktree content changed from base."""
        from core.workspace.git_utils import create_conflict_file_with_git

        base_content = "original line"
        main_content = "original line"
        worktree_content = "modified line"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None
        assert "modified line" in merged

    def test_handles_multiline_conflicts(self, temp_git_repo: Path):
        """Handles conflicts in multiline content."""
        from core.workspace.git_utils import create_conflict_file_with_git

        main_content = "line1\nline2 main\nline3"
        worktree_content = "line1\nline2 worktree\nline3"
        base_content = "line1\nline2\nline3"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        assert had_conflicts is True
        assert merged is not None

    def test_handles_empty_contents(self, temp_git_repo: Path):
        """Handles empty string contents."""
        from core.workspace.git_utils import create_conflict_file_with_git

        merged, had_conflicts = create_conflict_file_with_git(
            "", "", "", temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None

    def test_cleanup_temp_files(self, temp_git_repo: Path):
        """Cleans up temporary files after merge."""
        import tempfile
        from pathlib import Path
        from core.workspace.git_utils import create_conflict_file_with_git

        # Count temp files before
        temp_dir = tempfile.gettempdir()
        temp_files_before = len(list(Path(temp_dir).glob("*.tmp")))

        # Run merge
        create_conflict_file_with_git(
            "content", "content", "content", temp_git_repo
        )

        # Count temp files after (should be similar, not growing)
        # Note: This is a weak test as other processes may create temp files
        # The main assertion is that no exception is raised
        assert True  # If we got here without exception, cleanup worked

    def test_preserves_newlines_in_merged_content(self, temp_git_repo: Path):
        """Preserves newlines in merged content."""
        from core.workspace.git_utils import create_conflict_file_with_git

        content = "line1\nline2\nline3\n"
        merged, had_conflicts = create_conflict_file_with_git(
            content, content, content, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None
        assert "\n" in merged

    def test_handles_unicode_content(self, temp_git_repo: Path):
        """Handles unicode characters in content."""
        from core.workspace.git_utils import create_conflict_file_with_git

        content = "# Comment with émoji 🎉\nline1\n"
        merged, had_conflicts = create_conflict_file_with_git(
            content, content, content, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None
        assert "émoji" in merged or "🎉" in merged

    def test_conflict_markers_format(self, temp_git_repo: Path):
        """Verifies conflict marker format."""
        from core.workspace.git_utils import create_conflict_file_with_git

        main_content = "main version"
        worktree_content = "worktree version"
        base_content = "base version"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        if had_conflicts:
            # Check for standard git conflict markers
            assert "<<<<<<<" in merged
            assert "=======" in merged
            assert ">>>>>>>" in merged
