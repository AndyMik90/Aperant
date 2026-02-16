#!/usr/bin/env python3
"""
GitHub CLI Executable Finder
============================

Utility to find the gh (GitHub CLI) executable, with platform-specific fallbacks.
"""

import os
import shutil
import subprocess

from core.platform import get_where_exe_path

_cached_gh_path: str | None = None


def invalidate_gh_cache() -> None:
    """Invalidate the cached gh executable path.

    Useful when gh may have been uninstalled, updated, or when
    GITHUB_CLI_PATH environment variable has changed.
    """
    global _cached_gh_path
    _cached_gh_path = None


def _verify_gh_executable(path: str) -> bool:
    """Verify that a path is a valid gh executable by checking version.

    Args:
        path: Path to the potential gh executable

    Returns:
        True if the path points to a valid gh executable, False otherwise
    """
    try:
        result = subprocess.run(
            [path, "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def _run_where_command() -> str | None:
    """Run Windows 'where gh' command to find gh executable.

    Returns:
        First path found, or None if command failed
    """
    try:
        result = subprocess.run(
            [get_where_exe_path(), "gh"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            found_path = result.stdout.strip().split("\n")[0].strip()
            if (
                found_path
                and os.path.isfile(found_path)
                and _verify_gh_executable(found_path)
            ):
                return found_path
    except (subprocess.TimeoutExpired, OSError):
        # 'where' command failed or timed out - fall through to return None
        pass
    return None


def get_gh_executable() -> str | None:
    """Find the gh executable, with platform-specific fallbacks.

    Returns the path to gh executable, or None if not found.

    Priority order:
    1. GITHUB_CLI_PATH env var (user-configured path from frontend)
    2. shutil.which (if gh is in PATH)
    3. Homebrew paths on macOS
    4. Windows Program Files paths
    5. Windows 'where' command

    Caches the result after first successful find. Use invalidate_gh_cache()
    to force re-detection (e.g., after gh installation/uninstallation).
    """
    global _cached_gh_path

    # Return cached result if available AND still exists
    if _cached_gh_path is not None and os.path.isfile(_cached_gh_path):
        return _cached_gh_path

    _cached_gh_path = _find_gh_executable()
    return _cached_gh_path


def _find_gh_executable() -> str | None:
    """Internal function to find gh executable."""
    # 1. Check GITHUB_CLI_PATH env var (set by Electron frontend)
    env_path = os.environ.get("GITHUB_CLI_PATH")
    if env_path and os.path.isfile(env_path) and _verify_gh_executable(env_path):
        return env_path

    # 2. Try shutil.which (works if gh is in PATH)
    gh_path = shutil.which("gh")
    if gh_path and _verify_gh_executable(gh_path):
        return gh_path

    # 3. macOS-specific: check Homebrew paths
    if os.name != "nt":  # Unix-like systems (macOS, Linux)
        homebrew_paths = [
            "/opt/homebrew/bin/gh",  # Apple Silicon
            "/usr/local/bin/gh",  # Intel Mac
            "/home/linuxbrew/.linuxbrew/bin/gh",  # Linux Homebrew
        ]
        for path in homebrew_paths:
            if os.path.isfile(path) and _verify_gh_executable(path):
                return path

    # 4. Windows-specific: check Program Files paths
    if os.name == "nt":
        windows_paths = [
            os.path.expandvars(r"%PROGRAMFILES%\GitHub CLI\gh.exe"),
            os.path.expandvars(r"%PROGRAMFILES(X86)%\GitHub CLI\gh.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\GitHub CLI\gh.exe"),
        ]
        for path in windows_paths:
            if os.path.isfile(path) and _verify_gh_executable(path):
                return path

        # 5. Try 'where' command with full path (works even when System32 isn't in PATH)
        return _run_where_command()

    return None


def run_gh(
    args: list[str],
    cwd: str | None = None,
    timeout: int = 60,
    input_data: str | None = None,
) -> subprocess.CompletedProcess:
    """Run a gh command with proper executable finding.

    Args:
        args: gh command arguments (without 'gh' prefix)
        cwd: Working directory for the command
        timeout: Command timeout in seconds (default: 60)
        input_data: Optional string data to pass to stdin

    Returns:
        CompletedProcess with command results.
    """
    gh = get_gh_executable()
    if not gh:
        return subprocess.CompletedProcess(
            args=["gh"] + args,
            returncode=-1,
            stdout="",
            stderr="GitHub CLI (gh) not found. Install from https://cli.github.com/",
        )
    try:
        return subprocess.run(
            [gh] + args,
            cwd=cwd,
            input=input_data,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(
            args=[gh] + args,
            returncode=-1,
            stdout="",
            stderr=f"Command timed out after {timeout} seconds",
        )
    except FileNotFoundError:
        return subprocess.CompletedProcess(
            args=[gh] + args,
            returncode=-1,
            stdout="",
            stderr="GitHub CLI (gh) executable not found. Install from https://cli.github.com/",
        )
