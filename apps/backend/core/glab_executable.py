#!/usr/bin/env python3
"""
GitLab CLI Executable Finder
============================

Utility to find the glab (GitLab CLI) executable, with platform-specific fallbacks.
"""

import os
import shutil
import subprocess

from core.platform import get_where_exe_path

_cached_glab_path: str | None = None


def invalidate_glab_cache() -> None:
    """Invalidate the cached glab executable path.

    Useful when glab may have been uninstalled, updated, or when
    GITLAB_CLI_PATH environment variable has changed.
    """
    global _cached_glab_path
    _cached_glab_path = None


def _verify_glab_executable(path: str) -> bool:
    """Verify that a path is a valid glab executable by checking version.

    Args:
        path: Path to the potential glab executable

    Returns:
        True if the path points to a valid glab executable, False otherwise
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
    """Run Windows 'where glab' command to find glab executable.

    Returns:
        First path found, or None if command failed
    """
    try:
        result = subprocess.run(
            [get_where_exe_path(), "glab"],
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
                and _verify_glab_executable(found_path)
            ):
                return found_path
    except (subprocess.TimeoutExpired, OSError):
        # 'where' command failed or timed out - fall through to return None
        pass
    return None


def get_glab_executable() -> str | None:
    """Find the glab executable, with platform-specific fallbacks.

    Returns the path to glab executable, or None if not found.

    Priority order:
    1. GITLAB_CLI_PATH env var (user-configured path from frontend)
    2. shutil.which (if glab is in PATH)
    3. Homebrew paths on macOS
    4. Windows Program Files paths
    5. Windows 'where' command

    Caches the result after first successful find. Use invalidate_glab_cache()
    to force re-detection (e.g., after glab installation/uninstallation).
    """
    global _cached_glab_path

    # Return cached result if available AND still exists
    if _cached_glab_path is not None and os.path.isfile(_cached_glab_path):
        return _cached_glab_path

    _cached_glab_path = _find_glab_executable()
    return _cached_glab_path


def _find_glab_executable() -> str | None:
    """Internal function to find glab executable."""
    # 1. Check GITLAB_CLI_PATH env var (set by Electron frontend)
    env_path = os.environ.get("GITLAB_CLI_PATH")
    if env_path and os.path.isfile(env_path) and _verify_glab_executable(env_path):
        return env_path

    # 2. Try shutil.which (works if glab is in PATH)
    glab_path = shutil.which("glab")
    if glab_path and _verify_glab_executable(glab_path):
        return glab_path

    # 3. macOS-specific: check Homebrew paths
    if os.name != "nt":  # Unix-like systems (macOS, Linux)
        homebrew_paths = [
            "/opt/homebrew/bin/glab",  # Apple Silicon
            "/usr/local/bin/glab",  # Intel Mac
            "/home/linuxbrew/.linuxbrew/bin/glab",  # Linux Homebrew
        ]
        for path in homebrew_paths:
            if os.path.isfile(path) and _verify_glab_executable(path):
                return path

    # 4. Windows-specific: check Program Files paths
    # glab uses Inno Setup with DefaultDirName={autopf}\glab
    if os.name == "nt":
        windows_paths = [
            os.path.expandvars(r"%PROGRAMFILES%\glab\glab.exe"),
            os.path.expandvars(r"%PROGRAMFILES(X86)%\glab\glab.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\glab\glab.exe"),
        ]
        for path in windows_paths:
            if os.path.isfile(path) and _verify_glab_executable(path):
                return path

        # 5. Try 'where' command with full path (works even when System32 isn't in PATH)
        return _run_where_command()

    return None


def run_glab(
    args: list[str],
    cwd: str | None = None,
    timeout: int = 60,
    input_data: str | None = None,
) -> subprocess.CompletedProcess:
    """Run a glab command with proper executable finding.

    Args:
        args: glab command arguments (without 'glab' prefix)
        cwd: Working directory for the command
        timeout: Command timeout in seconds (default: 60)
        input_data: Optional string data to pass to stdin

    Returns:
        CompletedProcess with command results.
    """
    glab = get_glab_executable()
    if not glab:
        return subprocess.CompletedProcess(
            args=["glab"] + args,
            returncode=-1,
            stdout="",
            stderr="GitLab CLI (glab) not found. Install from https://gitlab.com/gitlab-org/cli",
        )
    try:
        return subprocess.run(
            [glab] + args,
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
            args=[glab] + args,
            returncode=-1,
            stdout="",
            stderr=f"Command timed out after {timeout} seconds",
        )
    except FileNotFoundError:
        return subprocess.CompletedProcess(
            args=[glab] + args,
            returncode=-1,
            stdout="",
            stderr="GitLab CLI (glab) executable not found. Install from https://gitlab.com/gitlab-org/cli",
        )
