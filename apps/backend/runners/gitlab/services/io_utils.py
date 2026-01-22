"""
I/O Utilities for GitLab Runner
=================================

Re-exports from core.io_utils to avoid duplication.
"""

from __future__ import annotations

# Re-export all functions from core.io_utils
from core.io_utils import is_pipe_broken, reset_pipe_state, safe_print

__all__ = ["safe_print", "is_pipe_broken", "reset_pipe_state"]
