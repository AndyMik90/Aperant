"""
Tests for Shared File Locking Utilities
========================================

Tests for the shared file_lock module used by both GitHub and GitLab runners.
"""

import asyncio
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from runners.shared.file_lock import (
    FileLock,
    FileLockError,
    FileLockTimeout,
    atomic_write,
    locked_json_read,
    locked_json_update,
    locked_json_write,
    locked_read,
    locked_write,
)


class TestFileLock:
    """Tests for FileLock class."""

    def test_basic_lock_acquire_release(self, tmp_path: Path):
        """Test basic lock acquisition and release."""
        lock_file = tmp_path / "test.json"
        lock = FileLock(lock_file, timeout=1.0)

        with lock:
            assert lock._lock_file is not None
            assert lock._lock_file.exists()

        # Lock file should be cleaned up after release
        assert not lock._lock_file.exists()

    def test_lock_timeout(self, tmp_path: Path):
        """Test that lock acquisition times out when held by another process."""
        lock_file = tmp_path / "test.json"
        lock1 = FileLock(lock_file, timeout=0.5)
        lock2 = FileLock(lock_file, timeout=0.5)

        # Acquire first lock
        lock1._acquire_lock()

        try:
            # Second lock should timeout
            with pytest.raises(FileLockTimeout):
                lock2._acquire_lock()
        finally:
            lock1._release_lock()

    def test_async_context_manager(self, tmp_path: Path):
        """Test async context manager usage."""
        lock_file = tmp_path / "test.json"

        async def use_lock():
            async with FileLock(lock_file, timeout=1.0):
                pass

        asyncio.run(use_lock())

    def test_lock_file_created_in_parent_dir(self, tmp_path: Path):
        """Test that lock file is created in the same directory as target."""
        nested_dir = tmp_path / "nested" / "dir"
        target_file = nested_dir / "test.json"
        lock = FileLock(target_file, timeout=1.0)

        lock._acquire_lock()
        try:
            # Lock file should be in same directory
            assert lock._lock_file.parent == nested_dir
            assert lock._lock_file.name == "test.json.lock"
        finally:
            lock._release_lock()

    def test_reentrant_lock_same_instance(self, tmp_path: Path):
        """Test that the same lock instance can be re-acquired after release."""
        lock_file = tmp_path / "test.json"
        lock = FileLock(lock_file, timeout=1.0)

        # Acquire and release twice
        with lock:
            pass

        with lock:
            pass  # Should work fine


class TestAtomicWrite:
    """Tests for atomic_write function."""

    def test_basic_write(self, tmp_path: Path):
        """Test basic atomic write."""
        target = tmp_path / "test.txt"
        content = "Hello, world!"

        with atomic_write(target) as f:
            f.write(content)

        assert target.exists()
        assert target.read_text() == content

    def test_write_creates_parent_dirs(self, tmp_path: Path):
        """Test that atomic write creates parent directories."""
        target = tmp_path / "nested" / "dir" / "test.txt"

        with atomic_write(target) as f:
            f.write("content")

        assert target.exists()

    def test_atomic_replace_on_success(self, tmp_path: Path):
        """Test that file is atomically replaced on success."""
        target = tmp_path / "test.txt"
        target.write_text("original")

        with atomic_write(target) as f:
            f.write("new content")

        assert target.read_text() == "new content"

    def test_no_replace_on_error(self, tmp_path: Path):
        """Test that original file is preserved on error."""
        target = tmp_path / "test.txt"
        target.write_text("original")

        with pytest.raises(ValueError):
            with atomic_write(target) as f:
                f.write("partial")
                raise ValueError("Simulated error")

        # Original should be preserved
        assert target.read_text() == "original"

    def test_binary_mode(self, tmp_path: Path):
        """Test atomic write in binary mode."""
        target = tmp_path / "test.bin"
        content = b"\x00\x01\x02\x03"

        with atomic_write(target, mode="wb") as f:
            f.write(content)

        assert target.read_bytes() == content

    def test_custom_encoding(self, tmp_path: Path):
        """Test atomic write with custom encoding."""
        target = tmp_path / "test.txt"
        content = "Hello, UTF-8!"

        with atomic_write(target, encoding="utf-8") as f:
            f.write(content)

        assert target.read_text(encoding="utf-8") == content


class TestLockedWrite:
    """Tests for locked_write async function."""

    @pytest.mark.asyncio
    async def test_basic_locked_write(self, tmp_path: Path):
        """Test basic locked write."""
        target = tmp_path / "test.txt"

        async with locked_write(target, timeout=1.0) as f:
            f.write("content")

        assert target.read_text() == "content"

    @pytest.mark.asyncio
    async def test_locked_write_with_json(self, tmp_path: Path):
        """Test locked write with JSON data."""
        target = tmp_path / "test.json"
        data = {"key": "value", "number": 42}

        async with locked_write(target, timeout=1.0) as f:
            json.dump(data, f)

        assert json.loads(target.read_text()) == data


class TestLockedRead:
    """Tests for locked_read async function."""

    @pytest.mark.asyncio
    async def test_basic_locked_read(self, tmp_path: Path):
        """Test basic locked read."""
        target = tmp_path / "test.txt"
        target.write_text("content")

        async with locked_read(target, timeout=1.0) as f:
            content = f.read()

        assert content == "content"

    @pytest.mark.asyncio
    async def test_locked_read_file_not_found(self, tmp_path: Path):
        """Test that locked read raises FileNotFoundError for missing file."""
        target = tmp_path / "missing.txt"

        with pytest.raises(FileNotFoundError):
            async with locked_read(target, timeout=1.0):
                pass


class TestLockedJsonOperations:
    """Tests for locked JSON helper functions."""

    @pytest.mark.asyncio
    async def test_locked_json_write(self, tmp_path: Path):
        """Test locked JSON write helper."""
        target = tmp_path / "test.json"
        data = {"key": "value"}

        await locked_json_write(target, data, timeout=1.0)

        assert json.loads(target.read_text()) == data

    @pytest.mark.asyncio
    async def test_locked_json_read(self, tmp_path: Path):
        """Test locked JSON read helper."""
        target = tmp_path / "test.json"
        data = {"key": "value"}
        target.write_text(json.dumps(data))

        result = await locked_json_read(target, timeout=1.0)

        assert result == data

    @pytest.mark.asyncio
    async def test_locked_json_update(self, tmp_path: Path):
        """Test locked JSON update helper."""
        target = tmp_path / "test.json"
        target.write_text(json.dumps({"items": [1, 2]}))

        def add_item(data):
            if data is None:
                data = {"items": []}
            data["items"].append(3)
            return data

        result = await locked_json_update(target, add_item, timeout=1.0)

        assert result["items"] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_locked_json_update_missing_file(self, tmp_path: Path):
        """Test locked JSON update with missing file."""
        target = tmp_path / "missing.json"

        def init_data(data):
            return {"initialized": True}

        result = await locked_json_update(target, init_data, timeout=1.0)

        assert result == {"initialized": True}


class TestFileLockError:
    """Tests for FileLockError exceptions."""

    def test_file_lock_error_is_exception(self):
        """Test that FileLockError is a proper exception."""
        with pytest.raises(Exception):
            raise FileLockError("test error")

    def test_file_lock_timeout_is_file_lock_error(self):
        """Test that FileLockTimeout is a subclass of FileLockError."""
        with pytest.raises(FileLockError):
            raise FileLockTimeout("timeout")


class TestCrossProcessLocking:
    """Tests for cross-process locking behavior."""

    def test_lock_prevents_concurrent_access(self, tmp_path: Path):
        """Test that lock prevents concurrent access from same process."""
        target = tmp_path / "test.json"
        lock1 = FileLock(target, timeout=0.5)
        lock2 = FileLock(target, timeout=0.5)

        # Acquire first lock
        lock1._acquire_lock()

        try:
            # Second lock should timeout
            with pytest.raises(FileLockTimeout):
                lock2._acquire_lock()
        finally:
            lock1._release_lock()

    def test_lock_can_be_reacquired_after_release(self, tmp_path: Path):
        """Test that lock can be reacquired after release."""
        target = tmp_path / "test.json"
        lock = FileLock(target, timeout=1.0)

        # Acquire and release
        lock._acquire_lock()
        lock._release_lock()

        # Should be able to acquire again
        lock._acquire_lock()
        lock._release_lock()
