"""
GitLab File Lock Tests
=======================

Tests for file locking utilities for concurrent safety.
"""

import json
from pathlib import Path

import pytest


class TestFileLock:
    """Test FileLock for concurrent-safe operations."""

    @pytest.fixture
    def lock_file(self, tmp_path):
        """Create a temporary lock file path."""
        return tmp_path / "test.lock"

    def test_lock_release(self, lock_file):
        """Test lock is released after context."""
        from runners.gitlab.utils.file_lock import FileLock

        with FileLock(lock_file, timeout=5.0):
            pass

        # Lock file should be cleaned up
        assert not lock_file.exists()

    def test_lock_cleanup_on_error(self, lock_file):
        """Test lock is cleaned up even on error."""
        from runners.gitlab.utils.file_lock import FileLock

        try:
            with FileLock(lock_file, timeout=5.0):
                raise ValueError("Test error")
        except ValueError:
            pass

        # Lock should be cleaned up even after error
        assert not lock_file.exists()


class TestAtomicWrite:
    """Test atomic write functionality."""

    @pytest.fixture
    def target_file(self, tmp_path):
        """Create a temporary file path."""
        return tmp_path / "target.txt"

    def test_atomic_write_creates_file(self, target_file):
        """Test atomic write creates the file."""
        from runners.gitlab.utils.file_lock import atomic_write

        with atomic_write(target_file) as f:
            f.write("test content")

        assert target_file.exists()
        assert target_file.read_text(encoding="utf-8") == "test content"

    def test_atomic_write_preserves_on_error(self, target_file):
        """Test atomic write doesn't corrupt file on error."""
        from runners.gitlab.utils.file_lock import atomic_write

        # Write initial content
        target_file.write_text("original", encoding="utf-8")

        # Attempt to write new content but fail
        try:
            with atomic_write(target_file) as f:
                f.write("new content")
                raise ValueError("Simulated error")
        except ValueError:
            pass

        # Original content should be preserved
        assert target_file.read_text(encoding="utf-8") == "original"

    def test_atomic_write_context_manager(self, target_file):
        """Test atomic write works as context manager."""
        from runners.gitlab.utils.file_lock import atomic_write

        with atomic_write(target_file) as f:
            f.write("context manager test")

        assert "context manager test" in target_file.read_text(encoding="utf-8")


class TestFileLockError:
    """Test FileLockError and FileLockTimeout exceptions."""

    def test_file_lock_error(self):
        """Test FileLockError can be raised and caught."""
        from runners.gitlab.utils.file_lock import FileLockError

        with pytest.raises(FileLockError):
            raise FileLockError("Test error")

    def test_file_lock_timeout(self):
        """Test FileLockTimeout is a subclass of FileLockError."""
        from runners.gitlab.utils.file_lock import FileLockError, FileLockTimeout

        # FileLockTimeout should be a subclass of FileLockError
        assert issubclass(FileLockTimeout, FileLockError)

        with pytest.raises(FileLockTimeout):
            raise FileLockTimeout("Lock timeout")

        # Should also catch as FileLockError
        try:
            raise FileLockTimeout("Timeout")
        except FileLockError:
            pass  # Expected
