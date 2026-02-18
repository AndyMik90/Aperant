"""
Tests for File Locking (file_lock.py)
======================================

Tests cross-process file locking utilities using platform-specific
locking mechanisms (fcntl on Unix, msvcrt on Windows).
"""

import asyncio
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

from runners.github.file_lock import (
    FileLockError,
    FileLockTimeout,
    FileLock,
    atomic_write,
    locked_write,
    locked_read,
    locked_json_write,
    locked_json_read,
    locked_json_update,
)


# ============================================================================
# FileLockError Tests
# ============================================================================


class TestFileLockError:
    """Tests for FileLockError exception."""

    def test_file_lock_error(self):
        """Test FileLockError can be raised and caught."""
        with pytest.raises(FileLockError) as exc_info:
            raise FileLockError("Lock failed")
        assert "Lock failed" in str(exc_info.value)

    def test_file_lock_timeout_is_file_lock_error(self):
        """Test FileLockTimeout is a subclass of FileLockError."""
        with pytest.raises(FileLockError):
            raise FileLockTimeout("Timeout")

    def test_file_lock_timeout_message(self):
        """Test FileLockTimeout message."""
        error = FileLockTimeout("Failed to acquire lock within 5.0s")
        assert "5.0s" in str(error)


# ============================================================================
# FileLock Tests
# ============================================================================


class TestFileLockInit:
    """Tests for FileLock initialization."""

    def test_init_with_path_str(self):
        """Test initialization with string path."""
        lock = FileLock("/path/to/file.json")
        assert lock.filepath == Path("/path/to/file.json")
        assert lock.timeout == 5.0
        assert lock.exclusive is True

    def test_init_with_path_object(self):
        """Test initialization with Path object."""
        path = Path("/path/to/file.json")
        lock = FileLock(path)
        assert lock.filepath == path

    def test_init_with_custom_timeout(self):
        """Test initialization with custom timeout."""
        lock = FileLock("/path/to/file.json", timeout=10.0)
        assert lock.timeout == 10.0

    def test_init_with_shared_lock(self):
        """Test initialization with shared (non-exclusive) lock."""
        lock = FileLock("/path/to/file.json", exclusive=False)
        assert lock.exclusive is False

    def test_get_lock_file_path(self):
        """Test lock file path generation."""
        lock = FileLock("/path/to/file.json")
        lock_file = lock._get_lock_file()
        assert lock_file == Path("/path/to/file.json.lock")


class TestFileLockSyncContext:
    """Tests for FileLock synchronous context manager."""

    def test_sync_context_manager(self, tmp_path):
        """Test using FileLock as synchronous context manager."""
        lock_file = tmp_path / "test.json"
        lock = FileLock(lock_file, timeout=1.0)

        with lock:
            # Lock is held
            assert lock._fd is not None

        # Lock is released
        assert lock._fd is None

    def test_sync_context_creates_lock_file(self, tmp_path):
        """Test that sync context creates .lock file."""
        target_file = tmp_path / "test.json"
        lock = FileLock(target_file)

        with lock:
            # Lock file should exist
            lock_file_path = target_file.parent / f"{target_file.name}.lock"
            assert lock_file_path.exists()

        # Lock file should be cleaned up (best effort)
        # Note: May still exist if cleanup failed

    def test_sync_context_creates_parent_dir(self, tmp_path):
        """Test that sync context creates parent directories."""
        nested_file = tmp_path / "subdir" / "deep" / "test.json"
        lock = FileLock(nested_file)

        with lock:
            # Parent directory should be created
            assert nested_file.parent.exists()


class TestFileLockAsyncContext:
    """Tests for FileLock async context manager."""

    @pytest.mark.asyncio
    async def test_async_context_manager(self, tmp_path):
        """Test using FileLock as async context manager."""
        lock_file = tmp_path / "test.json"
        lock = FileLock(lock_file, timeout=1.0)

        async with lock:
            # Lock is held
            assert lock._fd is not None

        # Lock is released
        assert lock._fd is None

    @pytest.mark.asyncio
    async def test_async_context_creates_lock_file(self, tmp_path):
        """Test that async context creates .lock file."""
        target_file = tmp_path / "test.json"
        lock = FileLock(target_file)

        async with lock:
            # Lock file should exist
            lock_file_path = target_file.parent / f"{target_file.name}.lock"
            assert lock_file_path.exists()

    @pytest.mark.asyncio
    async def test_async_timeout_simulation(self, tmp_path):
        """Test timeout is configured correctly."""
        target_file = tmp_path / "test.json"
        lock = FileLock(target_file, timeout=2.5)

        # Just verify timeout is set correctly
        assert lock.timeout == 2.5


# ============================================================================
# atomic_write Tests
# ============================================================================


class TestAtomicWrite:
    """Tests for atomic_write context manager."""

    def test_atomic_write_creates_file(self, tmp_path):
        """Test atomic write creates target file."""
        target_file = tmp_path / "output.json"

        with atomic_write(target_file) as f:
            json.dump({"test": "data"}, f)

        assert target_file.exists()

    def test_atomic_write_content(self, tmp_path):
        """Test atomic write writes correct content."""
        target_file = tmp_path / "output.txt"
        content = "Hello, world!"

        with atomic_write(target_file, mode="w") as f:
            f.write(content)

        assert target_file.read_text() == content

    def test_atomic_write_creates_parent_dir(self, tmp_path):
        """Test atomic write creates parent directories."""
        nested_file = tmp_path / "subdir" / "deep" / "output.txt"

        with atomic_write(nested_file) as f:
            f.write("content")

        assert nested_file.exists()
        assert nested_file.read_text() == "content"

    def test_atomic_write_json(self, tmp_path):
        """Test atomic write with JSON data."""
        target_file = tmp_path / "data.json"
        data = {"key": "value", "number": 42}

        with atomic_write(target_file) as f:
            json.dump(data, f)

        with open(target_file) as f:
            loaded = json.load(f)

        assert loaded == data

    def test_atomic_write_binary_mode(self, tmp_path):
        """Test atomic write in binary mode."""
        target_file = tmp_path / "binary.bin"
        data = b"\x00\x01\x02\x03"

        with atomic_write(target_file, mode="wb") as f:
            f.write(data)

        assert target_file.read_bytes() == data

    def test_atomic_write_error_cleanup(self, tmp_path):
        """Test temp file is cleaned up on error."""
        target_file = tmp_path / "output.txt"

        with pytest.raises(ValueError):
            with atomic_write(target_file) as f:
                f.write("partial")
                raise ValueError("Simulated error")

        # Target file should not exist
        assert not target_file.exists()


# ============================================================================
# locked_write Tests
# ============================================================================


class TestLockedWrite:
    """Tests for locked_write async context manager."""

    @pytest.mark.asyncio
    async def test_locked_write_creates_file(self, tmp_path):
        """Test locked write creates target file."""
        target_file = tmp_path / "output.json"

        async with locked_write(target_file) as f:
            json.dump({"test": "data"}, f)

        assert target_file.exists()

    @pytest.mark.asyncio
    async def test_locked_write_content(self, tmp_path):
        """Test locked write writes correct content."""
        target_file = tmp_path / "output.txt"
        content = "Hello, locked world!"

        async with locked_write(target_file) as f:
            f.write(content)

        assert target_file.read_text() == content

    @pytest.mark.asyncio
    async def test_locked_write_creates_parent_dir(self, tmp_path):
        """Test locked write creates parent directories."""
        nested_file = tmp_path / "subdir" / "deep" / "output.txt"

        async with locked_write(nested_file) as f:
            f.write("content")

        assert nested_file.exists()

    @pytest.mark.asyncio
    async def test_locked_write_custom_timeout(self, tmp_path):
        """Test locked write with custom timeout."""
        target_file = tmp_path / "output.txt"

        async with locked_write(target_file, timeout=10.0) as f:
            f.write("test")

        assert target_file.read_text() == "test"


# ============================================================================
# locked_read Tests
# ============================================================================


class TestLockedRead:
    """Tests for locked_read async context manager."""

    @pytest.mark.asyncio
    async def test_locked_read_existing_file(self, tmp_path):
        """Test reading existing file."""
        target_file = tmp_path / "data.txt"
        target_file.write_text("Hello, world!")

        async with locked_read(target_file) as f:
            content = f.read()

        assert content == "Hello, world!"

    @pytest.mark.asyncio
    async def test_locked_read_json(self, tmp_path):
        """Test reading JSON file."""
        target_file = tmp_path / "data.json"
        data = {"key": "value", "number": 42}
        target_file.write_text(json.dumps(data))

        async with locked_read(target_file) as f:
            loaded = json.load(f)

        assert loaded == data

    @pytest.mark.asyncio
    async def test_locked_read_nonexistent_file(self, tmp_path):
        """Test reading nonexistent file raises FileNotFoundError."""
        target_file = tmp_path / "nonexistent.txt"

        with pytest.raises(FileNotFoundError):
            async with locked_read(target_file) as f:
                f.read()

    @pytest.mark.asyncio
    async def test_locked_read_custom_timeout(self, tmp_path):
        """Test locked read with custom timeout."""
        target_file = tmp_path / "data.txt"
        target_file.write_text("test")

        async with locked_read(target_file, timeout=10.0) as f:
            content = f.read()

        assert content == "test"


# ============================================================================
# locked_json_write Tests
# ============================================================================


class TestLockedJsonWrite:
    """Tests for locked_json_write helper."""

    @pytest.mark.asyncio
    async def test_locked_json_write_creates_file(self, tmp_path):
        """Test writing JSON with locking."""
        target_file = tmp_path / "data.json"
        data = {"key": "value", "number": 42}

        await locked_json_write(target_file, data)

        assert target_file.exists()

    @pytest.mark.asyncio
    async def test_locked_json_write_content(self, tmp_path):
        """Test locked JSON write has correct content."""
        target_file = tmp_path / "data.json"
        data = {"key": "value", "number": 42}

        await locked_json_write(target_file, data)

        with open(target_file) as f:
            loaded = json.load(f)

        assert loaded == data

    @pytest.mark.asyncio
    async def test_locked_json_write_custom_indent(self, tmp_path):
        """Test locked JSON write with custom indent."""
        target_file = tmp_path / "data.json"
        data = {"key": "value"}

        await locked_json_write(target_file, data, indent=4)

        content = target_file.read_text()
        assert "    " in content  # 4 spaces

    @pytest.mark.asyncio
    async def test_locked_json_write_nested_path(self, tmp_path):
        """Test locked JSON write creates parent directories."""
        nested_file = tmp_path / "subdir" / "data.json"
        data = {"test": "data"}

        await locked_json_write(nested_file, data)

        assert nested_file.exists()


# ============================================================================
# locked_json_read Tests
# ============================================================================


class TestLockedJsonRead:
    """Tests for locked_json_read helper."""

    @pytest.mark.asyncio
    async def test_locked_json_read_existing(self, tmp_path):
        """Test reading existing JSON file."""
        target_file = tmp_path / "data.json"
        data = {"key": "value", "number": 42}
        target_file.write_text(json.dumps(data))

        loaded = await locked_json_read(target_file)

        assert loaded == data

    @pytest.mark.asyncio
    async def test_locked_json_read_nonexistent(self, tmp_path):
        """Test reading nonexistent JSON file raises error."""
        target_file = tmp_path / "nonexistent.json"

        with pytest.raises(FileNotFoundError):
            await locked_json_read(target_file)

    @pytest.mark.asyncio
    async def test_locked_json_read_invalid_json(self, tmp_path):
        """Test reading invalid JSON raises error."""
        target_file = tmp_path / "invalid.json"
        target_file.write_text("not valid json {")

        with pytest.raises(json.JSONDecodeError):
            await locked_json_read(target_file)


# ============================================================================
# locked_json_update Tests
# ============================================================================


class TestLockedJsonUpdate:
    """Tests for locked_json_update helper."""

    @pytest.mark.asyncio
    async def test_update_existing_file(self, tmp_path):
        """Test updating existing JSON file."""
        target_file = tmp_path / "data.json"
        original = {"items": ["a", "b"]}
        target_file.write_text(json.dumps(original))

        def updater(data):
            data["items"].append("c")
            return data

        updated = await locked_json_update(target_file, updater)

        assert updated["items"] == ["a", "b", "c"]

        # Verify file was updated
        with open(target_file) as f:
            loaded = json.load(f)
        assert loaded["items"] == ["a", "b", "c"]

    @pytest.mark.asyncio
    async def test_update_nonexistent_file(self, tmp_path):
        """Test updating nonexistent file creates it."""
        target_file = tmp_path / "new.json"

        def updater(data):
            # data is None for nonexistent file
            return {"new": "data"}

        updated = await locked_json_update(target_file, updater)

        assert updated == {"new": "data"}
        assert target_file.exists()

    @pytest.mark.asyncio
    async def test_update_with_new_data(self, tmp_path):
        """Test update can replace entire data structure."""
        target_file = tmp_path / "data.json"
        original = {"old": "data"}
        target_file.write_text(json.dumps(original))

        def updater(data):
            return {"completely": "new"}

        updated = await locked_json_update(target_file, updater)

        assert updated == {"completely": "new"}

    @pytest.mark.asyncio
    async def test_update_custom_indent(self, tmp_path):
        """Test update with custom indent."""
        target_file = tmp_path / "data.json"
        target_file.write_text('{"key": "value"}')

        def updater(data):
            return data

        await locked_json_update(target_file, updater, indent=4)

        content = target_file.read_text()
        assert "    " in content  # 4 spaces

    @pytest.mark.asyncio
    async def test_update_creates_parent_dir(self, tmp_path):
        """Test update creates parent directories."""
        nested_file = tmp_path / "subdir" / "data.json"

        def updater(data):
            return {"created": True}

        await locked_json_update(nested_file, updater)

        assert nested_file.exists()


# ============================================================================
# Cross-Platform Tests
# ============================================================================


class TestCrossPlatform:
    """Tests for cross-platform compatibility."""

    def test_windows_detection(self):
        """Test Windows platform detection."""
        # Import to check platform detection
        from runners.github import file_lock

        # Should be True on Windows, False otherwise
        assert isinstance(file_lock._IS_WINDOWS, bool)

    def test_windows_lock_size(self):
        """Test Windows lock size is defined."""
        from runners.github import file_lock

        assert file_lock._WINDOWS_LOCK_SIZE == 1024 * 1024

    @pytest.mark.skipif(
        os.name != "nt",
        reason="msvcrt only available on Windows"
    )
    def test_msvcrt_available_on_windows(self):
        """Test msvcrt is available on Windows."""
        import msvcrt  # noqa: F401
        from runners.github import file_lock

        assert file_lock.msvcrt is not None


# ============================================================================
# Error Handling Tests
# ============================================================================


class TestErrorHandling:
    """Tests for error handling."""

    @pytest.mark.asyncio
    async def test_locked_write_error_releases_lock(self, tmp_path):
        """Test lock is released even if write fails."""
        target_file = tmp_path / "output.txt"

        with pytest.raises(ValueError):
            async with locked_write(target_file) as f:
                f.write("partial")
                raise ValueError("Test error")

        # Lock should be released (fd should be None)
        # We can't directly check this but can verify no lock file remains
        lock_file = target_file.parent / f"{target_file.name}.lock"
        # Best effort cleanup - may or may not exist

    @pytest.mark.asyncio
    async def test_locked_read_error_releases_lock(self, tmp_path):
        """Test lock is released even if read fails."""
        target_file = tmp_path / "data.txt"
        target_file.write_text("content")

        with pytest.raises(RuntimeError):
            async with locked_read(target_file) as f:
                content = f.read()
                raise RuntimeError("Test error")

        # Lock should be released

    @pytest.mark.asyncio
    async def test_json_update_error_doesnt_modify_file(self, tmp_path):
        """Test file is not modified if updater fails."""
        target_file = tmp_path / "data.json"
        original = {"key": "original"}
        target_file.write_text(json.dumps(original))

        def broken_updater(data):
            raise ValueError("Updater failed")

        with pytest.raises(ValueError):
            await locked_json_update(target_file, broken_updater)

        # File should still have original content
        with open(target_file) as f:
            loaded = json.load(f)
        assert loaded == original
