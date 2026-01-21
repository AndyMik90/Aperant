"""
I/O Utilities for GitLab Runner
=================================

Safe I/O operations for subprocess output.
"""

from __future__ import annotations

import logging
import sys

logger = logging.getLogger(__name__)

# Track if pipe is broken to avoid repeated failed writes
_pipe_broken = False


def safe_print(message: str, flush: bool = True) -> None:
    """
    Print to stdout with BrokenPipeError handling.

    When running as a subprocess (e.g., from Electron), the parent process
    may close the pipe at any time. This function gracefully handles that
    case instead of raising an exception.

    Args:
        message: The message to print
        flush: Whether to flush stdout after printing (default True)
    """
    global _pipe_broken

    # Skip if we already know the pipe is broken
    if _pipe_broken:
        return

    try:
        print(message, flush=flush)
    except BrokenPipeError:
        # Pipe closed by parent process - this is expected during shutdown
        _pipe_broken = True
        # Quietly close stdout to prevent further errors
        try:
            sys.stdout.close()
        except Exception:
            pass
        logger.debug("Output pipe closed by parent process")
    except ValueError as e:
        # Handle writes to closed file (can happen after stdout.close())
        if "closed file" in str(e).lower():
            _pipe_broken = True
            logger.debug("Output stream closed")
        else:
            # Re-raise unexpected ValueErrors
            raise
    except OSError as e:
        # Handle other pipe-related errors (EPIPE, etc.)
        if e.errno == 32:  # EPIPE - Broken pipe
            _pipe_broken = True
            try:
                sys.stdout.close()
            except Exception:
                pass
            logger.debug("Output pipe closed (EPIPE)")
        else:
            # Re-raise unexpected OS errors
            raise


def is_pipe_broken() -> bool:
    """Check if the output pipe has been closed."""
    return _pipe_broken


def reset_pipe_state() -> None:
    """
    Reset pipe broken state.

    Useful for testing or when starting a new subprocess context where
    stdout has been reopened. Should only be called when stdout is known
    to be functional (e.g., in a fresh subprocess with a new stdout).

    Warning:
        Calling this after stdout has been closed will result in safe_print()
        attempting to write to the closed stream. The ValueError will be
        caught and the pipe will be marked as broken again.
    """
    global _pipe_broken
    _pipe_broken = False
