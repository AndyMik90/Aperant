"""
AC Jerry project initialization utilities.

Handles first-time setup of .ac.jerry directory and ensures proper gitignore configuration.
"""

import logging
import os
import subprocess
from pathlib import Path

from core.git_executable import get_git_executable

logger = logging.getLogger(__name__)

# All entries that should be added to .gitignore for ac-jerry projects
AC_JERRY_GITIGNORE_ENTRIES = [
    ".ac.jerry/",
    ".ac-jerry-security.json",
    ".ac-jerry-status",
    ".claude_settings.json",
    ".worktrees/",
    ".security-key",
    "logs/security/",
]


def _entry_exists_in_gitignore(lines: list[str], entry: str) -> bool:
    """Check if an entry already exists in gitignore (handles trailing slash variations)."""
    entry_normalized = entry.rstrip("/")
    for line in lines:
        line_stripped = line.strip()
        # Match both "entry" and "entry/"
        if (
            line_stripped == entry
            or line_stripped == entry_normalized
            or line_stripped == entry_normalized + "/"
        ):
            return True
    return False


def ensure_gitignore_entry(project_dir: Path, entry: str = ".ac.jerry/") -> bool:
    """
    Ensure an entry exists in the project's .gitignore file.

    Creates .gitignore if it doesn't exist.

    Args:
        project_dir: The project root directory
        entry: The gitignore entry to add (default: ".ac.jerry/")

    Returns:
        True if entry was added, False if it already existed
    """
    gitignore_path = project_dir / ".gitignore"

    # Check if .gitignore exists and if entry is already present
    if gitignore_path.exists():
        content = gitignore_path.read_text()
        lines = content.splitlines()

        if _entry_exists_in_gitignore(lines, entry):
            return False  # Already exists

        # Entry doesn't exist, append it
        # Ensure file ends with newline before adding our entry
        if content and not content.endswith("\n"):
            content += "\n"

        # Add a comment and the entry
        content += "\n# AC Jerry data directory\n"
        content += entry + "\n"

        gitignore_path.write_text(content)
        return True
    else:
        # Create new .gitignore with the entry
        content = "# AC Jerry data directory\n"
        content += entry + "\n"

        gitignore_path.write_text(content)
        return True


def _is_git_repo(project_dir: Path) -> bool:
    """Check if the directory is a git repository."""
    try:
        result = subprocess.run(
            [get_git_executable(), "rev-parse", "--is-inside-work-tree"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, Exception) as e:
        logger.debug("Git repo check failed: %s", e)
        return False


def _commit_gitignore(project_dir: Path) -> bool:
    """
    Commit .gitignore changes with a standard message.

    FIX (#1087): Auto-commit .gitignore changes to prevent merge failures.
    Without this, merging tasks fails with "local changes would be overwritten".

    Args:
        project_dir: The project root directory

    Returns:
        True if commit succeeded, False otherwise
    """
    if not _is_git_repo(project_dir):
        return False

    try:
        # Use LC_ALL=C to ensure English git output for reliable parsing
        git_env = {**os.environ, "LC_ALL": "C"}

        # Stage .gitignore
        result = subprocess.run(
            [get_git_executable(), "add", ".gitignore"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=30,
            env=git_env,
        )
        if result.returncode != 0:
            return False

        # Commit with standard message - explicitly specify .gitignore to avoid
        # committing other staged files the user may have
        result = subprocess.run(
            [
                get_git_executable(),
                "commit",
                ".gitignore",
                "-m",
                "chore: add ac-jerry entries to .gitignore",
            ],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=30,
            env=git_env,
        )
        # Return True even if commit "fails" due to nothing to commit
        # Check both stdout and stderr as message location varies by git version
        combined_output = result.stdout + result.stderr
        return result.returncode == 0 or "nothing to commit" in combined_output

    except (subprocess.TimeoutExpired, Exception) as e:
        logger.debug("Git commit failed: %s", e)
        return False


def ensure_all_gitignore_entries(
    project_dir: Path, auto_commit: bool = False
) -> list[str]:
    """
    Ensure all ac-jerry related entries exist in the project's .gitignore file.

    Creates .gitignore if it doesn't exist.

    Args:
        project_dir: The project root directory
        auto_commit: If True, automatically commit the .gitignore changes

    Returns:
        List of entries that were added (empty if all already existed)
    """
    gitignore_path = project_dir / ".gitignore"
    added_entries: list[str] = []

    # Read existing content or start fresh
    if gitignore_path.exists():
        content = gitignore_path.read_text()
        lines = content.splitlines()
    else:
        content = ""
        lines = []

    # Find entries that need to be added
    entries_to_add = [
        entry
        for entry in AC_JERRY_GITIGNORE_ENTRIES
        if not _entry_exists_in_gitignore(lines, entry)
    ]

    if not entries_to_add:
        return []

    # Build the new content to append
    # Ensure file ends with newline before adding our entries
    if content and not content.endswith("\n"):
        content += "\n"

    content += "\n# AC Jerry generated files\n"
    for entry in entries_to_add:
        content += entry + "\n"
        added_entries.append(entry)

    gitignore_path.write_text(content)

    # Auto-commit if requested and entries were added
    if auto_commit and added_entries:
        if not _commit_gitignore(project_dir):
            logger.warning(
                "Failed to auto-commit .gitignore changes in %s. "
                "Manual commit may be required to avoid merge conflicts.",
                project_dir,
            )

    return added_entries


def init_ac_jerry_dir(project_dir: Path) -> tuple[Path, bool]:
    """
    Initialize the .ac.jerry directory for a project.

    Creates the directory if needed and ensures all ac-jerry files are in .gitignore.
    Automatically migrates legacy .auto-claude/ directories if found.

    Args:
        project_dir: The project root directory

    Returns:
        Tuple of (ac_jerry_dir path, gitignore_was_updated)
    """
    project_dir = Path(project_dir)
    ac_jerry_dir = project_dir / ".ac.jerry"

    # Migrate legacy .auto-claude/ directory if it exists
    if not ac_jerry_dir.exists():
        try:
            from migration import migrate_project_directory

            migrate_project_directory(project_dir)
        except Exception as e:
            logger.debug("Migration check failed: %s", e)

    # Create the directory if it doesn't exist
    dir_created = not ac_jerry_dir.exists()
    ac_jerry_dir.mkdir(parents=True, exist_ok=True)

    # Ensure all ac-jerry entries are in .gitignore (only on first creation)
    # FIX (#1087): Auto-commit the changes to prevent merge failures
    gitignore_updated = False
    if dir_created:
        added = ensure_all_gitignore_entries(project_dir, auto_commit=True)
        gitignore_updated = len(added) > 0
    else:
        # Even if dir exists, check gitignore on first run
        # Use a marker file to track if we've already checked
        marker = ac_jerry_dir / ".gitignore_checked"
        if not marker.exists():
            added = ensure_all_gitignore_entries(project_dir, auto_commit=True)
            gitignore_updated = len(added) > 0
            marker.touch()

    return ac_jerry_dir, gitignore_updated


def get_ac_jerry_dir(project_dir: Path, ensure_exists: bool = True) -> Path:
    """
    Get the .ac.jerry directory path, optionally ensuring it exists.

    Args:
        project_dir: The project root directory
        ensure_exists: If True, create directory and update gitignore if needed

    Returns:
        Path to the .ac.jerry directory
    """
    if ensure_exists:
        ac_jerry_dir, _ = init_ac_jerry_dir(project_dir)
        return ac_jerry_dir

    return Path(project_dir) / ".ac.jerry"


def repair_gitignore(project_dir: Path) -> list[str]:
    """
    Repair an existing project's .gitignore to include all ac-jerry entries.

    This is useful for projects created before all entries were being added,
    or when gitignore entries were manually removed.

    Also resets the .gitignore_checked marker to allow future updates.
    Changes are automatically committed if the project is a git repository.

    Args:
        project_dir: The project root directory

    Returns:
        List of entries that were added (empty if all already existed)
    """
    project_dir = Path(project_dir)
    ac_jerry_dir = project_dir / ".ac.jerry"

    # Remove the marker file so future checks will also run
    marker = ac_jerry_dir / ".gitignore_checked"
    if marker.exists():
        marker.unlink()

    # Add all missing entries and auto-commit
    added = ensure_all_gitignore_entries(project_dir, auto_commit=True)

    # Re-create the marker
    if ac_jerry_dir.exists():
        marker.touch()

    return added
