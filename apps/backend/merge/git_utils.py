"""
Git Utilities
==============

Helper functions for git operations used in merge orchestration.

This module provides utilities for:
- Finding git worktrees
- Getting file content from branches
- Working with git repositories
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def find_worktree(project_dir: Path, task_id: str) -> Path | None:
    """
    Find the worktree path for a task.

    Args:
        project_dir: The project root directory
        task_id: The task identifier

    Returns:
        Path to the worktree, or None if not found
    """
    # Check new path first
    new_worktrees_dir = project_dir / ".ac.jerry" / "worktrees" / "tasks"
    if new_worktrees_dir.exists():
        for entry in new_worktrees_dir.iterdir():
            if entry.is_dir() and task_id in entry.name:
                return entry

    # Legacy fallback for backwards compatibility
    legacy_worktrees_dir = project_dir / ".worktrees"
    if legacy_worktrees_dir.exists():
        for entry in legacy_worktrees_dir.iterdir():
            if entry.is_dir() and task_id in entry.name:
                return entry

    return None


def get_file_from_branch(project_dir: Path, file_path: str, branch: str) -> str | None:
    """
    Get file content from a specific git branch.

    Args:
        project_dir: The project root directory
        file_path: Path to the file relative to project root
        branch: Branch name

    Returns:
        File content as string, or None if file doesn't exist on branch
    """
    try:
        result = subprocess.run(
            ["git", "show", f"{branch}:{file_path}"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout
    except subprocess.CalledProcessError:
        return None
