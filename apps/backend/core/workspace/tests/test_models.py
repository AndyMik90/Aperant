#!/usr/bin/env python3
"""
Tests for Workspace Models
==========================

Tests the workspace.py module models including:
- WorkspaceMode enum
- WorkspaceChoice enum
- ParallelMergeTask
- ParallelMergeResult
- MergeLock and MergeLockError
- SpecNumberLock and SpecNumberLockError
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

# Add parent directory to path so we can import the workspace module
# When co-located at workspace/tests/, we need to add backend to path
# workspace/tests -> workspace -> core -> backend (4 levels up)
_backend = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(_backend))

from core.workspace.models import (
    MergeLock,
    MergeLockError,
    ParallelMergeResult,
    ParallelMergeTask,
    SpecNumberLock,
    SpecNumberLockError,
)
from worktree import WorktreeError, WorktreeManager

# Test constant - in the new per-spec architecture, each spec has its own worktree
# named after the spec itself. This constant is used for test assertions.
TEST_SPEC_NAME = "test-spec"


class TestWorkspaceMode:
    """Tests for WorkspaceMode enum."""

    def test_isolated_mode(self):
        """ISOLATED mode value is correct."""
        from core.workspace.models import WorkspaceMode

        assert WorkspaceMode.ISOLATED.value == "isolated"

    def test_direct_mode(self):
        """DIRECT mode value is correct."""
        from core.workspace.models import WorkspaceMode

        assert WorkspaceMode.DIRECT.value == "direct"


class TestWorkspaceChoice:
    """Tests for WorkspaceChoice enum."""

    def test_merge_choice(self):
        """MERGE choice value is correct."""
        from core.workspace.models import WorkspaceChoice

        assert WorkspaceChoice.MERGE.value == "merge"

    def test_review_choice(self):
        """REVIEW choice value is correct."""
        from core.workspace.models import WorkspaceChoice

        assert WorkspaceChoice.REVIEW.value == "review"

    def test_test_choice(self):
        """TEST choice value is correct."""
        from core.workspace.models import WorkspaceChoice

        assert WorkspaceChoice.TEST.value == "test"

    def test_later_choice(self):
        """LATER choice value is correct."""
        from core.workspace.models import WorkspaceChoice

        assert WorkspaceChoice.LATER.value == "later"


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
        lock = MergeLock(temp_git_repo, "test-spec")

        with lock:
            pid_content = lock.lock_file.read_text(encoding="utf-8").strip()
            assert pid_content == str(os.getpid())

    @pytest.mark.slow
    def test_merge_lock_timeout_on_contention(self, temp_git_repo: Path):
        """MergeLock raises MergeLockError when lock is held by another process."""
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
        (worker_info.path / "worker-file.txt").write_text(
            "worker content", encoding="utf-8"
        )
        subprocess.run(["git", "add", "."], cwd=worker_info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path,
            capture_output=True,
        )

        # Merge should succeed
        result = manager.merge_worktree("worker-spec", delete_after=False)

        assert result is True

        # Verify the file was merged into base branch
        subprocess.run(
            ["git", "checkout", manager.base_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert (temp_git_repo / "worker-file.txt").exists(), (
            "Merged file should exist in base branch"
        )
        merged_content = (temp_git_repo / "worker-file.txt").read_text(encoding="utf-8")
        assert merged_content == "worker content", (
            "Merged file should have worktree content"
        )
