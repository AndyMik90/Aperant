"""
CLI Utilities
==============

Shared utility functions for the Jerry CLI.
"""

import os
import sys
from pathlib import Path

# Ensure parent directory is in path for imports (before other imports)
_PARENT_DIR = Path(__file__).parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from core.auth import get_auth_token, get_auth_token_source
from core.dependency_validator import validate_platform_dependencies


def import_dotenv():
    """
    Import and return load_dotenv with helpful error message if not installed.

    This centralized function ensures consistent error messaging across all
    runner scripts when python-dotenv is not available.

    Returns:
        The load_dotenv function

    Raises:
        SystemExit: If dotenv cannot be imported, with helpful installation instructions.
    """
    try:
        from dotenv import load_dotenv as _load_dotenv

        return _load_dotenv
    except ImportError:
        sys.exit(
            "Error: Required Python package 'python-dotenv' is not installed.\n"
            "\n"
            "This usually means you're not using the virtual environment.\n"
            "\n"
            "To fix this:\n"
            "1. From the 'apps/backend/' directory, activate the venv:\n"
            "   source .venv/bin/activate  # Linux/macOS\n"
            "   .venv\\Scripts\\activate   # Windows\n"
            "\n"
            "2. Or install dependencies directly:\n"
            "   pip install python-dotenv\n"
            "   pip install -r requirements.txt\n"
            "\n"
            f"Current Python: {sys.executable}\n"
        )


# Load .env with helpful error if dependencies not installed
load_dotenv = import_dotenv()
# NOTE: graphiti_config is imported lazily in validate_environment() to avoid
# triggering graphiti_core -> real_ladybug -> pywintypes import chain before
# platform dependency validation can run. See ACS-253.
from linear_integration import LinearManager
from linear_updater import is_linear_enabled
from spec.pipeline import get_specs_dir
from ui import (
    Icons,
    bold,
    box,
    icon,
    muted,
)

# Configuration - uses shorthand that resolves via API Profile if configured
DEFAULT_MODEL = "sonnet"  # Changed from "opus" (fix #433)


def setup_environment() -> Path:
    """
    Set up the environment and return the script directory.

    Returns:
        Path to the auto-claude directory
    """
    # Add auto-claude directory to path for imports
    script_dir = Path(__file__).parent.parent.resolve()
    sys.path.insert(0, str(script_dir))

    # Load .env file - check both auto-claude/ and dev/auto-claude/ locations
    env_file = script_dir / ".env"
    dev_env_file = script_dir.parent / "dev" / "auto-claude" / ".env"
    if env_file.exists():
        load_dotenv(env_file)
    elif dev_env_file.exists():
        load_dotenv(dev_env_file)

    return script_dir


def find_spec(project_dir: Path, spec_identifier: str) -> Path | None:
    """
    Find a spec by number or full name.

    Args:
        project_dir: Project root directory
        spec_identifier: Either "001" or "001-feature-name"

    Returns:
        Path to spec folder, or None if not found
    """
    specs_dir = get_specs_dir(project_dir)

    if specs_dir.exists():
        # Try exact match first
        exact_path = specs_dir / spec_identifier
        if exact_path.exists() and (exact_path / "spec.md").exists():
            return exact_path

        # Try matching by number prefix
        for spec_folder in specs_dir.iterdir():
            if spec_folder.is_dir() and spec_folder.name.startswith(
                spec_identifier + "-"
            ):
                if (spec_folder / "spec.md").exists():
                    return spec_folder

    # Check worktree specs (for merge-preview, merge, review, discard operations)
    worktree_base = project_dir / ".auto-claude" / "worktrees" / "tasks"
    if worktree_base.exists():
        # Try exact match in worktree
        worktree_spec = (
            worktree_base / spec_identifier / ".auto-claude" / "specs" / spec_identifier
        )
        if worktree_spec.exists() and (worktree_spec / "spec.md").exists():
            return worktree_spec

        # Try matching by prefix in worktrees
        for worktree_dir in worktree_base.iterdir():
            if worktree_dir.is_dir() and worktree_dir.name.startswith(
                spec_identifier + "-"
            ):
                spec_in_worktree = (
                    worktree_dir / ".auto-claude" / "specs" / worktree_dir.name
                )
                if (
                    spec_in_worktree.exists()
                    and (spec_in_worktree / "spec.md").exists()
                ):
                    return spec_in_worktree

    return None


def validate_environment(spec_dir: Path) -> bool:
    """
    Validate that the environment is set up correctly.

    Returns:
        True if valid, False otherwise (with error messages printed)
    """
    # Validate platform-specific dependencies first (exits if missing)
    validate_platform_dependencies()

    valid = True

    # Check for OAuth token (API keys are not supported)
    if not get_auth_token():
        print("Error: No OAuth token found")
        print("\nJerry requires Claude Code OAuth authentication.")
        print("Direct API keys (ANTHROPIC_API_KEY) are not supported.")
        print("\nTo authenticate, run:")
        print("  claude setup-token")
        valid = False
    else:
        # Show which auth source is being used
        source = get_auth_token_source()
        if source:
            print(f"Auth: {source}")

        # Show custom base URL if set
        base_url = os.environ.get("ANTHROPIC_BASE_URL")
        if base_url:
            print(f"API Endpoint: {base_url}")

    # Check for spec.md in spec directory
    spec_file = spec_dir / "spec.md"
    if not spec_file.exists():
        print(f"\nError: spec.md not found in {spec_dir}")
        valid = False

    # Check Linear integration (optional but show status)
    if is_linear_enabled():
        print("Linear integration: ENABLED")
        # Show Linear project status if initialized
        project_dir = (
            spec_dir.parent.parent
        )  # auto-claude/specs/001-name -> project root
        linear_manager = LinearManager(spec_dir, project_dir)
        if linear_manager.is_initialized:
            summary = linear_manager.get_progress_summary()
            print(f"  Project: {summary.get('project_name', 'Unknown')}")
            print(
                f"  Issues: {summary.get('mapped_subtasks', 0)}/{summary.get('total_subtasks', 0)} mapped"
            )
        else:
            print("  Status: Will be initialized during planner session")
    else:
        print("Linear integration: DISABLED (set LINEAR_API_KEY to enable)")

    # Check Graphiti integration (optional but show status)
    # Lazy import to avoid triggering pywintypes import before validation (ACS-253)
    from graphiti_config import get_graphiti_status

    graphiti_status = get_graphiti_status()
    if graphiti_status["available"]:
        print("Graphiti memory: ENABLED")
        print(f"  Database: {graphiti_status['database']}")
        if graphiti_status.get("db_path"):
            print(f"  Path: {graphiti_status['db_path']}")
    elif graphiti_status["enabled"]:
        print(
            f"Graphiti memory: CONFIGURED but unavailable ({graphiti_status['reason']})"
        )
    else:
        print("Graphiti memory: DISABLED (set GRAPHITI_ENABLED=true to enable)")

    print()
    return valid


def print_banner() -> None:
    """Print the Auto-Build banner."""
    content = [
        bold(f"{icon(Icons.LIGHTNING)} AUTO-BUILD FRAMEWORK"),
        "",
        "Autonomous Multi-Session Coding Agent",
        muted("Subtask-Based Implementation with Phase Dependencies"),
    ]
    print()
    print(box(content, width=70, style="heavy"))


def get_project_dir(provided_dir: Path | None) -> Path:
    """
    Determine the project directory.

    Args:
        provided_dir: User-provided project directory (or None)

    Returns:
        Resolved project directory path
    """
    if provided_dir:
        return provided_dir.resolve()

    project_dir = Path.cwd()

    # Auto-detect if running from within apps/backend directory (the source code)
    if project_dir.name == "backend" and (project_dir / "run.py").exists():
        # Running from within apps/backend/ source directory, go up 2 levels
        project_dir = project_dir.parent.parent

    return project_dir


def find_specs_dir(project_dir: Path) -> Path:
    """
    Find the specs directory for a project.

    Returns the '.auto-claude/specs' directory path.
    The directory is guaranteed to exist (get_specs_dir calls init_auto_claude_dir).

    Args:
        project_dir: Project root directory

    Returns:
        Path to specs directory (always returns a valid Path)
    """
    return get_specs_dir(project_dir)
