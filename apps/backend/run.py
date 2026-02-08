#!/usr/bin/env python3
# Copyright (C) 2024-2026 Jerry Team
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Auto Claude Framework
=====================

A multi-session autonomous coding framework for building features and applications.
Uses subtask-based implementation plans with phase dependencies.

Key Features:
- Safe workspace isolation (builds in separate workspace by default)
- Parallel execution with Git worktrees
- Smart recovery from interruptions
- Linear integration for project management

Usage:
    python auto-claude/run.py --spec 001-initial-app
    python auto-claude/run.py --spec 001
    python auto-claude/run.py --list

    # Workspace management
    python auto-claude/run.py --spec 001 --merge     # Add completed build to project
    python auto-claude/run.py --spec 001 --review    # See what was built
    python auto-claude/run.py --spec 001 --discard   # Delete build (requires confirmation)

Prerequisites:
    - CLAUDE_CODE_OAUTH_TOKEN environment variable set (run: claude setup-token)
    - Spec created via: claude /spec
    - Claude Code CLI installed
"""

import sys

# Python version check - must be before any imports using 3.10+ syntax
if sys.version_info < (3, 10):  # noqa: UP036
    sys.exit(
        f"Error: Auto Claude requires Python 3.10 or higher.\n"
        f"You are running Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}\n"
        f"\n"
        f"Please upgrade Python: https://www.python.org/downloads/"
    )

import io

# Configure safe encoding on Windows BEFORE any imports that might print
# This handles both TTY and piped output (e.g., from Electron)
if sys.platform == "win32":
    for _stream_name in ("stdout", "stderr"):
        _stream = getattr(sys, _stream_name)
        # Method 1: Try reconfigure (works for TTY)
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
                continue
            except (AttributeError, io.UnsupportedOperation, OSError):
                pass
        # Method 2: Wrap with TextIOWrapper for piped output
        try:
            if hasattr(_stream, "buffer"):
                _new_stream = io.TextIOWrapper(
                    _stream.buffer,
                    encoding="utf-8",
                    errors="replace",
                    line_buffering=True,
                )
                setattr(sys, _stream_name, _new_stream)
        except (AttributeError, io.UnsupportedOperation, OSError):
            pass
    # Clean up temporary variables
    del _stream_name, _stream
    if "_new_stream" in dir():
        del _new_stream

# Validate platform-specific dependencies BEFORE any imports that might
# trigger graphiti_core -> real_ladybug -> pywintypes import chain (ACS-253)
from core.dependency_validator import validate_platform_dependencies

validate_platform_dependencies()

from cli import main

if __name__ == "__main__":
    main()
