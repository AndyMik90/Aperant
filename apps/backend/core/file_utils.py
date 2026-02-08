#!/usr/bin/env python3
"""
Atomic File Write Utilities
============================

Synchronous utilities for atomic file writes to prevent corruption.

Uses temp file + os.replace() pattern which is atomic on POSIX systems
and atomic on Windows when source and destination are on the same volume.

Usage:
    from core.file_utils import write_json_atomic

    write_json_atomic("/path/to/file.json", {"key": "value"})
"""

import fcntl
import json
import logging
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import IO, Any, Literal


@contextmanager
def atomic_write(
    filepath: str | Path,
    mode: Literal["w", "wb", "wt"] = "w",
    encoding: str | None = "utf-8",
) -> Iterator[IO]:
    """
    Atomic file write using temp file and rename.

    Writes to .tmp file first, then atomically replaces target file
    using os.replace() which is atomic on POSIX systems and same-volume Windows.

    Note: This function supports both text and binary modes. For binary modes
    (mode containing 'b'), encoding must be None.

    Args:
        filepath: Target file path
        mode: File open mode (default: "w", text mode only)
        encoding: File encoding for text modes, None for binary (default: "utf-8")

    Example:
        with atomic_write("/path/to/file.json") as f:
            json.dump(data, f)

    Yields:
        File handle to temp file
    """
    filepath = Path(filepath)
    filepath.parent.mkdir(parents=True, exist_ok=True)

    # Binary modes require encoding=None
    actual_encoding = None if "b" in mode else encoding

    # Create temp file in same directory for atomic rename
    fd, tmp_path = tempfile.mkstemp(
        dir=filepath.parent, prefix=f".{filepath.name}.tmp.", suffix=""
    )

    # Open temp file with requested mode
    # If fdopen fails, close fd and clean up temp file
    try:
        f = os.fdopen(fd, mode, encoding=actual_encoding)
    except Exception as e:
        logging.error(f"Failed to open temp file {tmp_path}: {e}", exc_info=True)
        os.close(fd)
        try:
            os.unlink(tmp_path)
        except OSError as cleanup_err:
            logging.warning(f"Failed to cleanup temp file after fdopen error: {cleanup_err}")
        raise

    try:
        with f:
            yield f
    except Exception:
        # Clean up temp file on error (replace didn't happen yet)
        try:
            os.unlink(tmp_path)
        except Exception as cleanup_err:
            # Best-effort cleanup, ignore errors to not mask original exception
            # Log cleanup failure for debugging (orphaned temp files may accumulate)
            logging.warning(
                f"Failed to cleanup temp file {tmp_path}: {cleanup_err}",
                exc_info=True,
            )
        raise
    else:
        # Atomic replace - only runs if no exception was raised
        # If os.replace itself fails, do NOT clean up (may be partially renamed)
        os.replace(tmp_path, filepath)


def write_json_atomic(
    filepath: str | Path,
    data: Any,
    indent: int = 2,
    ensure_ascii: bool = False,
    encoding: str = "utf-8",
) -> None:
    """
    Write JSON data to file atomically.

    This function prevents file corruption by:
    1. Writing to a temporary file first
    2. Only replacing the target file if the write succeeds
    3. Using os.replace() for atomicity

    Args:
        filepath: Target file path
        data: Data to serialize as JSON
        indent: JSON indentation (default: 2)
        ensure_ascii: Whether to escape non-ASCII characters (default: False)
        encoding: File encoding (default: "utf-8")

    Example:
        write_json_atomic("/path/to/file.json", {"key": "value"})
    """
    with atomic_write(filepath, "w", encoding=encoding) as f:
        json.dump(data, f, indent=indent, ensure_ascii=ensure_ascii)


def write_json_atomic_locked(
    filepath: str | Path,
    data: Any,
    indent: int = 2,
    ensure_ascii: bool = False,
    encoding: str = "utf-8",
    lock_timeout: float = 10.0,
) -> None:
    """
    Write JSON data atomically with inter-process advisory locking.

    FIX-021: Multiple processes (coder, session post-processing, QA loop) may
    write to shared files like implementation_plan.json concurrently. This
    function uses fcntl.flock() advisory locks to serialize writes, preventing
    lost updates from concurrent read-modify-write cycles.

    The lock file is a sibling of the target file with a .lock suffix.

    Args:
        filepath: Target file path
        data: Data to serialize as JSON
        indent: JSON indentation (default: 2)
        ensure_ascii: Whether to escape non-ASCII characters (default: False)
        encoding: File encoding (default: "utf-8")
        lock_timeout: Max seconds to wait for lock (default: 10)
    """
    filepath = Path(filepath)
    lock_path = filepath.parent / f".{filepath.name}.lock"
    filepath.parent.mkdir(parents=True, exist_ok=True)

    lock_fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR)
    try:
        # Acquire exclusive lock (blocking, with timeout via alarm)
        import signal

        def _timeout_handler(signum, frame):
            raise TimeoutError(
                f"Could not acquire lock on {lock_path} within {lock_timeout}s"
            )

        old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
        signal.setitimer(signal.ITIMER_REAL, lock_timeout)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, old_handler)

        # Lock acquired — perform atomic write
        write_json_atomic(filepath, data, indent, ensure_ascii, encoding)
    finally:
        # Release lock and close
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
        except OSError:
            pass
        os.close(lock_fd)
