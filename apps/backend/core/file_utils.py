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
