"""
Dependency Validator
====================

Validates platform-specific dependencies are installed before running agents.
"""

import sys
from pathlib import Path

from core.platform import is_linux, is_windows


def validate_platform_dependencies() -> None:
    """
    Validate that platform-specific dependencies are installed.

    Raises:
        SystemExit: If required platform-specific dependencies are missing,
                   with helpful installation instructions.
    """
    # Check Windows-specific dependencies (all Python versions per ACS-306)
    # pywin32 is required on all Python versions on Windows - MCP library unconditionally imports win32api
    if is_windows():
        try:
            import pywintypes  # noqa: F401
        except ImportError:
            _exit_with_pywin32_error()

    # Check Linux-specific dependencies (ACS-310)
    # Note: secretstorage is optional for app functionality (falls back to .env),
    # but we validate it to ensure proper OAuth token storage via keyring
    if is_linux():
        try:
            import secretstorage  # noqa: F401
        except ImportError:
            _warn_missing_secretstorage()


def _exit_with_pywin32_error() -> None:
    """Exit with helpful error message for missing pywin32."""
    # Use sys.prefix to detect the virtual environment path
    # This works for venv and poetry environments
    # Check for common Windows activation scripts (activate, activate.bat, Activate.ps1)
    scripts_dir = Path(sys.prefix) / "Scripts"
    activation_candidates = [
        scripts_dir / "activate",
        scripts_dir / "activate.bat",
        scripts_dir / "Activate.ps1",
    ]
    venv_activate = next((p for p in activation_candidates if p.exists()), None)

    # Build activation step only if activate script exists
    activation_step = ""
    if venv_activate:
        activation_step = (
            "To fix this:\n"
            "1. Activate your virtual environment:\n"
            f"   {venv_activate}\n"
            "\n"
            "2. Install pywin32:\n"
            "   pip install pywin32>=306\n"
            "\n"
            "   Or reinstall all dependencies:\n"
            "   pip install -r requirements.txt\n"
        )
    else:
        # For system Python or environments without activate script
        activation_step = (
            "To fix this:\n"
            "Install pywin32:\n"
            "   pip install pywin32>=306\n"
            "\n"
            "   Or reinstall all dependencies:\n"
            "   pip install -r requirements.txt\n"
        )

    sys.exit(
        "Error: Required Windows dependency 'pywin32' is not installed.\n"
        "\n"
        "Auto Claude requires pywin32 on Windows for:\n"
        "  - MCP library (win32api, win32con, win32job modules)\n"
        "  - LadybugDB/Graphiti memory integration\n"
        "\n"
        f"{activation_step}"
        "\n"
        f"Current Python: {sys.executable}\n"
    )


def _warn_missing_secretstorage() -> None:
    """Emit warning message for missing secretstorage.

    Note: This is a warning, not a hard error - the app will fall back to .env
    file storage for OAuth tokens. We warn users to ensure they understand the
    security implications.
    """
    # Use sys.prefix to detect the virtual environment path
    venv_activate = Path(sys.prefix) / "bin" / "activate"
    # Only include activation instruction if venv script actually exists
    activation_prefix = (
        f"1. Activate your virtual environment:\n   source {venv_activate}\n\n"
        if venv_activate.exists()
        else ""
    )
    # Adjust step number based on whether activation step is included
    install_step = (
        "2. Install secretstorage:\n"
        if activation_prefix
        else "Install secretstorage:\n"
    )

    sys.stderr.write(
        "Warning: Linux dependency 'secretstorage' is not installed.\n"
        "\n"
        "Auto Claude can use secretstorage for secure OAuth token storage via\n"
        "the system keyring (gnome-keyring, kwallet, etc.). Without it, tokens\n"
        "will be stored in plaintext in your .env file.\n"
        "\n"
        "To enable keyring integration:\n"
        f"{activation_prefix}"
        f"{install_step}"
        "   pip install 'secretstorage>=3.3.3'\n"
        "\n"
        "   Or reinstall all dependencies:\n"
        "   pip install -r requirements.txt\n"
        "\n"
        "Note: The app will continue to work, but OAuth tokens will be stored\n"
        "in your .env file instead of the system keyring.\n"
        "\n"
        f"Current Python: {sys.executable}\n"
    )
    sys.stderr.flush()
    # Continue execution - this is a warning, not a blocking error
