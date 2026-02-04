#!/usr/bin/env python3
"""
Git Executable Finder and Isolation
====================================

Utility to find the git executable, with Windows-specific fallbacks.
Also provides environment isolation to prevent pre-commit hooks and
other git configurations from affecting worktree operations.

Separated into its own module to avoid circular imports.
"""

import os
import shutil
import subprocess
from pathlib import Path

from core.platform import get_where_exe_path

# Git environment variables that can interfere with worktree operations
# when set by pre-commit hooks or other git configurations.
# These must be cleared to prevent cross-worktree contamination.
GIT_ENV_VARS_TO_CLEAR = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    # Identity variables that could be set by hooks
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_AUTHOR_DATE",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_COMMITTER_DATE",
]

_cached_git_path: str | None = None


def get_isolated_git_env(base_env: dict | None = None) -> dict:
    """
    Create an isolated environment for git operations.

    Clears git environment variables that may be set by pre-commit hooks
    or other git configurations, preventing cross-worktree contamination
    and ensuring git operations target the intended repository.

    Args:
        base_env: Base environment dict to copy from. If None, uses os.environ.

    Returns:
        Environment dict safe for git subprocess operations.
    """
    env = dict(base_env) if base_env is not None else os.environ.copy()

    for key in GIT_ENV_VARS_TO_CLEAR:
        env.pop(key, None)

    # Disable user's pre-commit hooks during Auto-Claude managed git operations
    # to prevent double-hook execution and potential conflicts
    env["HUSKY"] = "0"

    return env


def get_git_executable() -> str:
    """Find the git executable, with Windows-specific fallbacks.

    Returns the path to git executable. On Windows, checks multiple sources:
    1. CLAUDE_CODE_GIT_BASH_PATH env var (set by Electron frontend)
    2. shutil.which (if git is in PATH)
    3. Common installation locations
    4. Windows 'where' command

    Caches the result after first successful find.
    """
    global _cached_git_path

    # Return cached result if available
    if _cached_git_path is not None:
        return _cached_git_path

    git_path = _find_git_executable()
    _cached_git_path = git_path
    return git_path


def _find_git_executable() -> str:
    """Internal function to find git executable."""
    # 1. Check CLAUDE_CODE_GIT_BASH_PATH (set by Electron frontend)
    # This env var points to bash.exe, we can derive git.exe from it
    bash_path = os.environ.get("CLAUDE_CODE_GIT_BASH_PATH")
    if bash_path:
        try:
            bash_path_obj = Path(bash_path)
            if bash_path_obj.exists():
                git_dir = bash_path_obj.parent.parent
                # Try cmd/git.exe first (preferred), then bin/git.exe
                for git_subpath in ["cmd/git.exe", "bin/git.exe"]:
                    git_path = git_dir / git_subpath
                    if git_path.is_file():
                        return str(git_path)
        except (OSError, ValueError):
            pass  # Invalid path or permission error - try next method

    # 2. Try shutil.which (works if git is in PATH)
    git_path = shutil.which("git")
    if git_path:
        return git_path

    # 3. Windows-specific: check common installation locations
    if os.name == "nt":
        common_paths = [
            os.path.expandvars(r"%PROGRAMFILES%\Git\cmd\git.exe"),
            os.path.expandvars(r"%PROGRAMFILES%\Git\bin\git.exe"),
            os.path.expandvars(r"%PROGRAMFILES(X86)%\Git\cmd\git.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\cmd\git.exe"),
            r"C:\Program Files\Git\cmd\git.exe",
            r"C:\Program Files (x86)\Git\cmd\git.exe",
        ]
        for path in common_paths:
            try:
                if os.path.isfile(path):
                    return path
            except OSError:
                continue

        # 4. Try 'where' command with full path (works even when System32 isn't in PATH)
        try:
            result = subprocess.run(
                [get_where_exe_path(), "git"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                found_path = result.stdout.strip().split("\n")[0].strip()
                if found_path and os.path.isfile(found_path):
                    return found_path
        except (subprocess.TimeoutExpired, OSError):
            pass  # 'where' command failed - fall through to default

    # Default fallback - let subprocess handle it (may fail)
    return "git"


def run_git(
    args: list[str],
    cwd: Path | str | None = None,
    timeout: int = 60,
    input_data: str | None = None,
    env: dict | None = None,
    isolate_env: bool = True,
) -> subprocess.CompletedProcess:
    """Run a git command with proper executable finding and environment isolation.

    Args:
        args: Git command arguments (without 'git' prefix)
        cwd: Working directory for the command
        timeout: Command timeout in seconds (default: 60)
        input_data: Optional string data to pass to stdin
        env: Custom environment dict. If None and isolate_env=True, uses isolated env.
        isolate_env: If True (default), clears git env vars to prevent hook interference.

    Returns:
        CompletedProcess with command results.
    """
    git = get_git_executable()

    if env is None and isolate_env:
        env = get_isolated_git_env()

    try:
        return subprocess.run(
            [git] + args,
            cwd=cwd,
            input=input_data,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(
            args=[git] + args,
            returncode=-1,
            stdout="",
            stderr=f"Command timed out after {timeout} seconds",
        )
    except FileNotFoundError:
        return subprocess.CompletedProcess(
            args=[git] + args,
            returncode=-1,
            stdout="",
            stderr="Git executable not found. Please ensure git is installed and in PATH.",
        )
