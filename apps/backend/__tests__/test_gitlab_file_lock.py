"""
GitLab File Lock Tests
=======================

Tests for file locking utilities for concurrent safety.
"""

import json
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest


class TestFileLock:
    """Test FileLock for concurrent-safe operations."""

    @pytest.fixture
    def lock_file(self, tmp_path):
        """Create a temporary lock file path."""
        return tmp_path / "test.lock"

    def test_acquire_lock(self, lock_file):
        """Test acquiring a lock."""
        from runners.gitlab.utils.file_lock import FileLock

        with FileLock(lock_file, timeout=5.0):
            # Lock is held here
            assert lock_file.exists()

    def test_lock_release(self, lock_file):
        """Test lock is released after context."""
        from runners.gitlab.utils.file_lock import FileLock

        with FileLock(lock_file, timeout=5.0):
            pass

        # Lock file should be cleaned up
        assert not lock_file.exists()

    def test_lock_timeout(self, lock_file):
        """Test lock timeout when held by another process."""
        from runners.gitlab.utils.file_lock import FileLock, FileLockTimeout

        # Hold lock in separate thread
        def hold_lock():
            with FileLock(lock_file, timeout=5.0):
                time.sleep(0.5)

        thread = threading.Thread(target=hold_lock)
        thread.start()

        # Wait a bit for lock to be acquired
        time.sleep(0.1)

        # Try to acquire with short timeout
        with pytest.raises(FileLockTimeout):
            FileLock(lock_file, timeout=0.1).acquire()

        thread.join()

    def test_exclusive_lock(self, lock_file):
        """Test exclusive lock prevents concurrent writes."""
        from runners.gitlab.utils.file_lock import FileLock

        results = []

        def try_write(value):
            try:
                with FileLock(lock_file, timeout=1.0, exclusive=True):
                    with open(
                        lock_file.with_suffix(".txt"), "w", encoding="utf-8"
                    ) as f:
                        f.write(str(value))
                    results.append(value)
            except Exception:
                results.append(None)

        threads = [
            threading.Thread(target=try_write, args=(1,)),
            threading.Thread(target=try_write, args=(2,)),
        ]

        for t in threads:
            t.start()

        for t in threads:
            t.join()

        # Only one should have succeeded
        successful = [r for r in results if r is not None]
        assert len(successful) == 1

    def test_lock_cleanup_on_error(self, lock_file):
        """Test lock is cleaned up even on error."""
        from runners.gitlab.utils.file_lock import FileLock

        try:
            with FileLock(lock_file, timeout=5.0):
                raise ValueError("Simulated error")
        except ValueError:
            pass

        # Lock should be cleaned up despite error
        assert not lock_file.exists()


class TestAtomicWrite:
    """Test atomic_write for safe file writes."""

    @pytest.fixture
    def target_file(self, tmp_path):
        """Create a temporary target file."""
        return tmp_path / "target.txt"

    def test_atomic_write_creates_file(self, target_file):
        """Test atomic write creates target file."""
        from runners.gitlab.utils.file_lock import atomic_write

        with atomic_write(target_file) as f:
            f.write("test content")

        assert target_file.exists()
        assert target_file.read_text(encoding="utf-8") == "test content"

    def test_atomic_write_preserves_on_error(self, target_file):
        """Test atomic write doesn't corrupt on error."""
        from runners.gitlab.utils.file_lock import atomic_write

        # Create initial content
        target_file.write_text("original content", encoding="utf-8")

        try:
            with atomic_write(target_file) as f:
                f.write("new content")
                raise ValueError("Simulated error")
        except ValueError:
            pass

        # Original content should be preserved
        assert target_file.read_text(encoding="utf-8") == "original content"

    def test_atomic_write_context_manager(self, target_file):
        """Test atomic write context manager."""
        from runners.gitlab.utils.file_lock import atomic_write

        with atomic_write(target_file) as f:
            f.write("line 1\n")
            f.write("line 2\n")

        content = target_file.read_text(encoding="utf-8")
        assert "line 1" in content
        assert "line 2" in content


class TestLockedJsonOperations:
    """Test locked JSON operations."""

    @pytest.fixture
    def data_file(self, tmp_path):
        """Create a temporary data file."""
        return tmp_path / "data.json"

    def test_locked_json_write(self, data_file):
        """Test writing JSON with file locking."""
        from runners.gitlab.utils.file_lock import locked_json_write

        data = {"key": "value", "number": 42}

        locked_json_write(data_file, data)

        assert data_file.exists()
        with open(data_file, encoding="utf-8") as f:
            loaded = json.load(f)
        assert loaded == data

    def test_locked_json_read(self, data_file):
        """Test reading JSON with file locking."""
        from runners.gitlab.utils.file_lock import locked_json_read, locked_json_write

        data = {"key": "value", "nested": {"item": 1}}
        locked_json_write(data_file, data)

        loaded = locked_json_read(data_file)

        assert loaded == data

    def test_locked_json_update(self, data_file):
        """Test updating JSON with file locking."""
        from runners.gitlab.utils.file_lock import (
            locked_json_read,
            locked_json_update,
            locked_json_write,
        )

        initial = {"key": "value"}
        locked_json_write(data_file, initial)

        def update_fn(data):
            data["new_key"] = "new_value"
            return data

        locked_json_update(data_file, update_fn)

        loaded = locked_json_read(data_file)
        assert loaded["key"] == "value"
        assert loaded["new_key"] == "new_value"

    def test_locked_json_read_missing_file(self, tmp_path):
        """Test reading missing JSON file returns None."""
        from runners.gitlab.utils.file_lock import locked_json_read

        result = locked_json_read(tmp_path / "nonexistent.json")

        assert result is None

    def test_concurrent_json_writes(self, tmp_path):
        """Test concurrent JSON writes are safe."""
        from runners.gitlab.utils.file_lock import (
            locked_json_read,
            locked_json_update,
            locked_json_write,
        )

        data_file = tmp_path / "concurrent.json"

        # Initialize
        locked_json_write(data_file, {"counter": 0})

        results = []

        def increment():
            def updater(data):
                data["counter"] += 1
                return data

            locked_json_update(data_file, updater)
            result = locked_json_read(data_file)
            results.append(result["counter"])

        threads = [
            threading.Thread(target=increment),
            threading.Thread(target=increment),
            threading.Thread(target=increment),
        ]

        for t in threads:
            t.start()

        for t in threads:
            t.join()

        # Final value should be 3
        final = locked_json_read(data_file)
        assert final["counter"] == 3


class TestLockedReadWrite:
    """Test general locked read/write operations."""

    @pytest.fixture
    def data_file(self, tmp_path):
        """Create a temporary data file."""
        return tmp_path / "data.txt"

    def test_locked_write(self, data_file):
        """Test writing with lock."""
        from runners.gitlab.utils.file_lock import locked_write

        with locked_write(data_file) as f:
            f.write("test content")

        assert data_file.read_text(encoding="utf-8") == "test content"

    def test_locked_read(self, data_file):
        """Test reading with lock."""
        from runners.gitlab.utils.file_lock import locked_read, locked_write

        with locked_write(data_file) as f:
            f.write("read test")

        with locked_read(data_file) as f:
            content = f.read()

        assert content == "read test"

    def test_locked_write_file_lock(self, data_file):
        """Test locked_write with custom FileLock."""
        from runners.gitlab.utils.file_lock import FileLock, locked_write

        with FileLock(data_file, timeout=5.0):
            with locked_write(data_file, lock=None) as f:
                f.write("custom lock")

        assert data_file.read_text(encoding="utf-8") == "custom lock"


class TestFileLockError:
    """Test FileLockError exceptions."""

    def test_file_lock_error(self):
        """Test FileLockError is raised correctly."""
        from runners.gitlab.utils.file_lock import FileLockError

        error = FileLockError("Custom error message")
        assert str(error) == "Custom error message"

    def test_file_lock_timeout(self):
        """Test FileLockTimeout is raised correctly."""
        from runners.gitlab.utils.file_lock import FileLockTimeout

        error = FileLockTimeout("Timeout message")
        assert "Timeout" in str(error)


class TestConcurrentSafety:
    """Test concurrent safety scenarios."""

    def test_multiple_readers(self, tmp_path):
        """Test multiple readers can access file concurrently."""
        from runners.gitlab.utils.file_lock import locked_json_read, locked_json_write

        data_file = tmp_path / "readers.json"
        locked_json_write(data_file, {"value": 42})

        results = []

        def read_value():
            data = locked_json_read(data_file)
            results.append(data["value"])

        threads = [threading.Thread(target=read_value) for _ in range(5)]

        for t in threads:
            t.start()

        for t in threads:
            t.join()

        assert len(results) == 5
        assert all(r == 42 for r in results)

    def test_writers_exclusive(self, tmp_path):
        """Test writers have exclusive access."""
        from runners.gitlab.utils.file_lock import (
            locked_json_read,
            locked_json_update,
            locked_json_write,
        )

        data_file = tmp_path / "writers.json"
        locked_json_write(data_file, {"counter": 0})

        results = []

        def increment():
            def updater(data):
                data["counter"] += 1
                return data

            locked_json_update(data_file, updater)
            result = locked_json_read(data_file)
            results.append(result["counter"])

        threads = [threading.Thread(target=increment) for _ in range(10)]

        for t in threads:
            t.start()

        for t in threads:
            t.join()

        # All increments should be applied
        final = locked_json_read(data_file)
        assert final["counter"] == 10
        assert len(results) == 10

    def test_reader_writer_conflict(self, tmp_path):
        """Test readers and writers don't conflict."""
        from runners.gitlab.utils.file_lock import (
            locked_json_read,
            locked_json_update,
            locked_json_write,
        )

        data_file = tmp_path / "rw.json"
        locked_json_write(data_file, {"reads": 0, "writes": 0})

        read_results = []

        def reader():
            for _ in range(10):
                data = locked_json_read(data_file)
                read_results.append(data["reads"])

        def writer():
            for _ in range(5):

                def updater(data):
                    data["writes"] += 1
                    return data

                locked_json_update(data_file, updater)

        threads = [
            threading.Thread(target=reader),
            threading.Thread(target=writer),
        ]

        for t in threads:
            t.start()

        for t in threads:
            t.join()

        # All operations should complete
        final = locked_json_read(data_file)
        assert final["writes"] == 5
        assert len(read_results) == 10
