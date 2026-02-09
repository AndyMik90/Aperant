"""
AC Jerry Migration Module
=========================

Handles migration from legacy .auto-claude/ directory structure to .ac.jerry/.
Called at startup to seamlessly upgrade existing projects.
"""

import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

# Legacy → new file/directory mappings
MIGRATION_MAP = {
    ".auto-claude": ".ac.jerry",
    ".auto-claude-security.json": ".ac-jerry-security.json",
    ".auto-claude-allowlist": ".ac-jerry-allowlist",
    ".auto-claude-status": ".ac-jerry-status",
}

# Legacy gitignore entries to replace
LEGACY_GITIGNORE_ENTRIES = {
    ".auto-claude/": ".ac.jerry/",
    ".auto-claude-security.json": ".ac-jerry-security.json",
    ".auto-claude-status": ".ac-jerry-status",
}


def migrate_project_directory(project_dir: Path) -> bool:
    """
    Detect and migrate legacy .auto-claude/ directory to .ac.jerry/.

    Migration steps:
    1. Check if .auto-claude/ exists AND .ac.jerry/ does NOT exist
    2. Rename .auto-claude/ to .ac.jerry/
    3. Rename legacy security/status files
    4. Update .gitignore entries

    If both old and new directories exist, logs a warning and skips.

    Args:
        project_dir: The project root directory

    Returns:
        True if migration occurred, False otherwise
    """
    project_dir = Path(project_dir)
    old_dir = project_dir / ".auto-claude"
    new_dir = project_dir / ".ac.jerry"

    if not old_dir.exists():
        return False

    if new_dir.exists():
        logger.warning(
            "Both .auto-claude/ and .ac.jerry/ exist in %s. "
            "Skipping migration — please resolve manually.",
            project_dir,
        )
        return False

    migrated = False

    # 1. Rename the main data directory
    try:
        old_dir.rename(new_dir)
        logger.info("Migrated .auto-claude/ → .ac.jerry/ in %s", project_dir)
        migrated = True
    except OSError as e:
        logger.error("Failed to rename .auto-claude/ to .ac.jerry/: %s", e)
        return False

    # 2. Rename legacy files (security, allowlist, status)
    for old_name, new_name in MIGRATION_MAP.items():
        if old_name == ".auto-claude":
            continue  # Already handled above
        old_path = project_dir / old_name
        new_path = project_dir / new_name
        if old_path.exists() and not new_path.exists():
            try:
                old_path.rename(new_path)
                logger.info("Migrated %s → %s", old_name, new_name)
            except OSError as e:
                logger.warning("Failed to rename %s: %s", old_name, e)

    # 3. Update .gitignore entries
    try:
        _migrate_gitignore(project_dir)
    except Exception as e:
        logger.warning("Failed to update .gitignore during migration: %s", e)

    return migrated


def _migrate_gitignore(project_dir: Path) -> bool:
    """
    Update .gitignore to replace legacy entries with new ones.

    Args:
        project_dir: The project root directory

    Returns:
        True if .gitignore was updated
    """
    gitignore_path = project_dir / ".gitignore"
    if not gitignore_path.exists():
        return False

    content = gitignore_path.read_text()
    original = content

    for old_entry, new_entry in LEGACY_GITIGNORE_ENTRIES.items():
        content = content.replace(old_entry, new_entry)

    # Also update comments
    content = content.replace("# Auto Claude", "# AC Jerry")
    content = content.replace("# auto-claude", "# ac-jerry")

    if content != original:
        gitignore_path.write_text(content)
        logger.info("Updated .gitignore with new AC Jerry entries")
        return True

    return False


def migrate_user_home_directory() -> bool:
    """
    Migrate legacy ~/.auto-claude/ user home directory to ~/.ac.jerry/.

    This handles the global memories/profiles directory.

    Returns:
        True if migration occurred
    """
    import os

    home = Path(os.path.expanduser("~"))
    old_dir = home / ".auto-claude"
    new_dir = home / ".ac.jerry"

    if not old_dir.exists():
        return False

    if new_dir.exists():
        logger.warning(
            "Both ~/.auto-claude/ and ~/.ac.jerry/ exist. "
            "Skipping home directory migration."
        )
        return False

    try:
        old_dir.rename(new_dir)
        logger.info("Migrated ~/.auto-claude/ → ~/.ac.jerry/")
        return True
    except OSError as e:
        logger.error("Failed to migrate home directory: %s", e)
        return False
