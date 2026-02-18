"""
Platform Abstraction Layer

Centralized platform-specific operations for the Python backend.
All code that checks sys.platform or handles OS differences should use this module.

Design principles:
- Single source of truth for platform detection
- Feature detection over platform detection when possible
- Clear, intention-revealing names
- Immutable configurations where possible
"""

import os
import platform
import re
import shutil
import subprocess
from enum import Enum
from pathlib import Path

# ============================================================================
# Type Definitions
# ============================================================================


class OS(Enum):
    """Supported operating systems."""

    WINDOWS = "Windows"
    MACOS = "Darwin"
    LINUX = "Linux"


class ShellType(Enum):
    """Available shell types."""

    POWERSHELL = "powershell"
    CMD = "cmd"
    BASH = "bash"
    ZSH = "zsh"
    FISH = "fish"
    UNKNOWN = "unknown"


# ============================================================================
# Platform Detection
# ============================================================================


def get_current_os() -> OS:
    """Get the current operating system.

    Returns the OS enum for the current platform. For unsupported Unix-like
    systems (e.g., FreeBSD, SunOS), defaults to Linux for compatibility.
    """
    system = platform.system()
    if system == "Windows":
        return OS.WINDOWS
    elif system == "Darwin":
        return OS.MACOS
    # Default to Linux for other Unix-like systems (FreeBSD, SunOS, etc.)
    return OS.LINUX


def is_windows() -> bool:
    """Check if running on Windows."""
    return platform.system() == "Windows"


def is_macos() -> bool:
    """Check if running on macOS."""
    return platform.system() == "Darwin"


def is_linux() -> bool:
    """Check if running on Linux."""
    return platform.system() == "Linux"


def is_unix() -> bool:
    """Check if running on a Unix-like system (macOS or Linux)."""
    return not is_windows()


# ============================================================================
# Path Configuration
# ============================================================================


def get_path_delimiter() -> str:
    """Get the PATH separator for environment variables."""
    return ";" if is_windows() else ":"


def get_executable_extension() -> str:
    """Get the default file extension for executables."""
    return ".exe" if is_windows() else ""


def with_executable_extension(base_name: str) -> str:
    """Add executable extension to a base name if needed."""
    if not base_name:
        return base_name

    # Check if already has extension
    if os.path.splitext(base_name)[1]:
        return base_name

    exe_ext = get_executable_extension()
    return f"{base_name}{exe_ext}" if exe_ext else base_name


# ============================================================================
# Binary Directories
# ============================================================================


def get_binary_directories() -> dict[str, list[str]]:
    """
    Get common binary directories for the current platform.

    Returns:
        Dict with 'user' and 'system' keys containing lists of directories.
    """
    home_dir = Path.home()

    if is_windows():
        return {
            "user": [
                str(home_dir / "AppData" / "Local" / "Programs"),
                str(home_dir / "AppData" / "Roaming" / "npm"),
                str(home_dir / ".local" / "bin"),
            ],
            "system": [
                os.environ.get("ProgramFiles", "C:\\Program Files"),
                os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"),
                os.path.join(os.environ.get("SystemRoot", "C:\\Windows"), "System32"),
            ],
        }

    if is_macos():
        return {
            "user": [
                str(home_dir / ".local" / "bin"),
                str(home_dir / "bin"),
            ],
            "system": [
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
            ],
        }

    # Linux
    return {
        "user": [
            str(home_dir / ".local" / "bin"),
            str(home_dir / "bin"),
        ],
        "system": [
            "/usr/bin",
            "/usr/local/bin",
            "/snap/bin",
        ],
    }


def get_homebrew_path() -> str | None:
    """
    Get Homebrew binary directory (macOS only).

    Returns:
        Homebrew bin path or None if not on macOS.
    """
    if not is_macos():
        return None

    homebrew_paths = [
        "/opt/homebrew/bin",  # Apple Silicon
        "/usr/local/bin",  # Intel
    ]

    for brew_path in homebrew_paths:
        if os.path.exists(brew_path):
            return brew_path

    return homebrew_paths[0]  # Default to Apple Silicon


# ============================================================================
# Tool Detection
# ============================================================================


def find_executable(name: str, additional_paths: list[str] | None = None) -> str | None:
    """
    Find an executable in standard locations.

    Searches:
    1. System PATH
    2. Platform-specific binary directories
    3. Additional custom paths

    Args:
        name: Name of the executable (without extension)
        additional_paths: Optional list of additional paths to search

    Returns:
        Full path to executable if found, None otherwise
    """
    # First check system PATH
    in_path = shutil.which(name)
    if in_path:
        return in_path

    # Check with extension on Windows
    if is_windows():
        for ext in [".exe", ".cmd", ".bat"]:
            in_path = shutil.which(f"{name}{ext}")
            if in_path:
                return in_path

    # Search in platform-specific directories
    bins = get_binary_directories()
    search_dirs = bins["user"] + bins["system"]

    if additional_paths:
        search_dirs.extend(additional_paths)

    for directory in search_dirs:
        if not os.path.isdir(directory):
            continue

        # Try without extension
        exe_path = os.path.join(directory, with_executable_extension(name))
        if os.path.isfile(exe_path):
            return exe_path

        # Try common extensions on Windows
        if is_windows():
            for ext in [".exe", ".cmd", ".bat"]:
                exe_path = os.path.join(directory, f"{name}{ext}")
                if os.path.isfile(exe_path):
                    return exe_path

    return None


def get_claude_detection_paths() -> list[str]:
    """
    Get platform-specific paths for Claude CLI detection.

    Returns:
        List of possible Claude CLI executable paths.
    """
    home_dir = Path.home()
    paths = []

    if is_windows():
        paths.extend(
            [
                str(
                    home_dir
                    / "AppData"
                    / "Local"
                    / "Programs"
                    / "claude"
                    / "claude.exe"
                ),
                str(home_dir / "AppData" / "Roaming" / "npm" / "claude.cmd"),
                str(home_dir / ".local" / "bin" / "claude.exe"),
                r"C:\Program Files\Claude\claude.exe",
                r"C:\Program Files (x86)\Claude\claude.exe",
            ]
        )
    else:
        paths.extend(
            [
                str(home_dir / ".local" / "bin" / "claude"),
                str(home_dir / "bin" / "claude"),
            ]
        )

    # Add Homebrew path on macOS
    if is_macos():
        brew_path = get_homebrew_path()
        if brew_path:
            paths.append(os.path.join(brew_path, "claude"))

    return paths


def get_claude_detection_paths_structured() -> dict[str, list[str] | str]:
    """
    Get platform-specific paths for Claude CLI detection in structured format.

    Returns a dict with categorized paths for different detection strategies:
    - 'homebrew': Homebrew installation paths (macOS)
    - 'platform': Platform-specific standard installation locations
    - 'nvm_versions_dir': NVM versions directory path for scanning Node installations

    This structured format allows callers to implement custom detection logic
    for each category (e.g., iterating NVM version directories).

    Returns:
        Dict with 'homebrew', 'platform', and 'nvm_versions_dir' keys
    """
    home_dir = Path.home()

    homebrew_paths = [
        "/opt/homebrew/bin/claude",  # Apple Silicon
        "/usr/local/bin/claude",  # Intel Mac
    ]

    if is_windows():
        platform_paths = [
            str(home_dir / "AppData/Local/Programs/claude/claude.exe"),
            str(home_dir / "AppData/Roaming/npm/claude.cmd"),
            str(home_dir / ".local/bin/claude.exe"),
            r"C:\Program Files\Claude\claude.exe",
            r"C:\Program Files (x86)\Claude\claude.exe",
        ]
    else:
        platform_paths = [
            str(home_dir / ".local" / "bin" / "claude"),
            str(home_dir / "bin" / "claude"),
        ]

    nvm_versions_dir = str(home_dir / ".nvm" / "versions" / "node")

    return {
        "homebrew": homebrew_paths,
        "platform": platform_paths,
        "nvm_versions_dir": nvm_versions_dir,
    }


def get_python_commands() -> list[list[str]]:
    """
    Get platform-specific Python command variations as argument sequences.

    Returns command arguments as sequences so callers can pass each entry
    directly to subprocess.run(cmd) or use cmd[0] with shutil.which().

    Returns:
        List of command argument lists to try, in order of preference.
        Each inner list contains the executable and any required arguments.

    Example:
        for cmd in get_python_commands():
            if shutil.which(cmd[0]):
                subprocess.run(cmd + ["--version"])
                break
    """
    if is_windows():
        return [["py", "-3"], ["python"], ["python3"], ["py"]]
    return [["python3"], ["python"]]


def validate_cli_path(cli_path: str) -> bool:
    """
    Validate that a CLI path is secure and executable.

    Prevents command injection attacks by rejecting paths with shell metacharacters,
    directory traversal patterns, or environment variable expansion.

    Args:
        cli_path: Path to validate

    Returns:
        True if path is secure, False otherwise
    """
    if not cli_path or not cli_path.strip():
        return False

    # Security validation: reject paths with shell metacharacters or other dangerous patterns
    dangerous_patterns = [
        r'[;&|`${}[\]<>!"^]',  # Shell metacharacters
        r"%[^%]+%",  # Windows environment variable expansion
        r"\.\./",  # Unix directory traversal
        r"\.\.\\",  # Windows directory traversal
        r"[\r\n\x00]",  # Newlines (command injection), null bytes (path truncation)
    ]

    for pattern in dangerous_patterns:
        if re.search(pattern, cli_path):
            return False

    # On Windows, validate executable name additionally
    if is_windows():
        # Extract just the executable name
        exe_name = os.path.basename(cli_path)
        name_without_ext = os.path.splitext(exe_name)[0]

        # Allow only alphanumeric, dots, hyphens, underscores in the name
        if not name_without_ext or not all(
            c.isalnum() or c in "._-" for c in name_without_ext
        ):
            return False

    # Check if path exists (if absolute)
    if os.path.isabs(cli_path):
        return os.path.isfile(cli_path)

    return True


# ============================================================================
# Shell Execution
# ============================================================================


def requires_shell(command: str) -> bool:
    """
    Check if a command requires shell execution on Windows.

    Windows needs shell execution for .cmd and .bat files.

    Args:
        command: Command string to check

    Returns:
        True if shell execution is required
    """
    if not is_windows():
        return False

    _, ext = os.path.splitext(command)
    return ext.lower() in {".cmd", ".bat", ".ps1"}


def get_where_exe_path() -> str:
    """Get full path to where.exe on Windows.

    Using the full path ensures where.exe works even when System32 isn't in PATH,
    which can happen in restricted environments or when the app doesn't inherit
    the full system PATH.

    Returns:
        Full path to where.exe (e.g., C:\\Windows\\System32\\where.exe)
    """
    system_root = os.environ.get(
        "SystemRoot", os.environ.get("SYSTEMROOT", "C:\\Windows")
    )
    return os.path.join(system_root, "System32", "where.exe")


def get_comspec_path() -> str:
    """
    Get the path to cmd.exe on Windows.

    Returns:
        Path to cmd.exe or default location.
    """
    if is_windows():
        return os.environ.get(
            "ComSpec",
            os.path.join(
                os.environ.get("SystemRoot", "C:\\Windows"), "System32", "cmd.exe"
            ),
        )
    return "/bin/sh"


def build_windows_command(cli_path: str, args: list[str]) -> list[str]:
    """
    Build a command array for Windows execution.

    Handles .cmd/.bat files that require shell execution.

    Args:
        cli_path: Path to the CLI executable
        args: Command arguments

    Returns:
        Command array suitable for subprocess.run
    """
    if is_windows() and cli_path.lower().endswith((".cmd", ".bat")):
        # Use cmd.exe to execute .cmd/.bat files
        cmd_exe = get_comspec_path()
        # Properly escape arguments for Windows command line
        escaped_args = subprocess.list2cmdline(args)
        return [cmd_exe, "/d", "/s", "/c", f'"{cli_path}" {escaped_args}']

    return [cli_path] + args


# ============================================================================
# Environment Variables
# ============================================================================


def get_env_var(name: str, default: str | None = None) -> str | None:
    """
    Get environment variable value with case-insensitive support on Windows.

    Args:
        name: Environment variable name
        default: Default value if not found

    Returns:
        Environment variable value or default
    """
    if is_windows():
        # Case-insensitive lookup on Windows
        for key, value in os.environ.items():
            if key.lower() == name.lower():
                return value
        return default

    return os.environ.get(name, default)


# ============================================================================
# Platform Description
# ============================================================================


def get_platform_description() -> str:
    """
    Get a human-readable platform description.

    Returns:
        String like "Windows (AMD64)" or "macOS (arm64)"
    """
    os_name = {OS.WINDOWS: "Windows", OS.MACOS: "macOS", OS.LINUX: "Linux"}.get(
        get_current_os(), platform.system()
    )

    arch = platform.machine()
    return f"{os_name} ({arch})"
