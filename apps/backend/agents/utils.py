"""
Utility Functions for Agent System
===================================

Helper functions for git operations, plan management, and file syncing.
"""

import json
import logging
import shutil
from pathlib import Path

from core.git_executable import run_git

logger = logging.getLogger(__name__)


def get_latest_commit(project_dir: Path) -> str | None:
    """Get the hash of the latest git commit."""
    result = run_git(
        ["rev-parse", "HEAD"],
        cwd=project_dir,
        timeout=10,
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return None


def get_commit_count(project_dir: Path) -> int:
    """Get the total number of commits."""
    result = run_git(
        ["rev-list", "--count", "HEAD"],
        cwd=project_dir,
        timeout=10,
    )
    if result.returncode == 0:
        try:
            return int(result.stdout.strip())
        except ValueError:
            return 0
    return 0


def load_implementation_plan(spec_dir: Path) -> dict | None:
    """Load the implementation plan JSON."""
    plan_file = spec_dir / "implementation_plan.json"
    if not plan_file.exists():
        return None
    try:
        with open(plan_file, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def find_subtask_in_plan(plan: dict, subtask_id: str) -> dict | None:
    """Find a subtask by ID in the plan."""
    for phase in plan.get("phases", []):
        for subtask in phase.get("subtasks", []):
            if subtask.get("id") == subtask_id:
                return subtask
    return None


def find_phase_for_subtask(plan: dict, subtask_id: str) -> dict | None:
    """Find the phase containing a subtask."""
    for phase in plan.get("phases", []):
        for subtask in phase.get("subtasks", []):
            if subtask.get("id") == subtask_id:
                return phase
    return None


def sync_spec_to_source(spec_dir: Path, source_spec_dir: Path | None) -> bool:
    """
    Sync ALL spec files from worktree back to source spec directory.

    When running in isolated mode (worktrees), the agent creates and updates
    many files inside the worktree's spec directory. This function syncs ALL
    of them back to the main project's spec directory.

    IMPORTANT: Since .auto-claude/ is gitignored, this sync happens to the
    local filesystem regardless of what branch the user is on. The worktree
    may be on a different branch (e.g., auto-claude/093-task), but the sync
    target is always the main project's .auto-claude/specs/ directory.

    Files synced (all files in spec directory):
    - implementation_plan.json - Task status and subtask completion
    - build-progress.txt - Session-by-session progress notes
    - task_logs.json - Execution logs
    - review_state.json - QA review state
    - critique_report.json - Spec critique findings
    - suggested_commit_message.txt - Commit suggestions
    - REGRESSION_TEST_REPORT.md - Test regression report
    - spec.md, context.json, etc. - Original spec files (for completeness)
    - memory/ directory - Codebase map, patterns, gotchas, session insights

    Args:
        spec_dir: Current spec directory (inside worktree)
        source_spec_dir: Original spec directory in main project (outside worktree)

    Returns:
        True if sync was performed, False if not needed or failed
    """
    # Skip if no source specified or same path (not in worktree mode)
    if not source_spec_dir:
        return False

    # Resolve paths and check if they're different
    spec_dir_resolved = spec_dir.resolve()
    source_spec_dir_resolved = source_spec_dir.resolve()

    if spec_dir_resolved == source_spec_dir_resolved:
        return False  # Same directory, no sync needed

    synced_any = False

    # Ensure source directory exists
    source_spec_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Sync all files and directories from worktree spec to source spec
        for item in spec_dir.iterdir():
            # Skip symlinks to prevent path traversal attacks
            if item.is_symlink():
                logger.warning(f"Skipping symlink during sync: {item.name}")
                continue

            source_item = source_spec_dir / item.name

            if item.is_file():
                # Copy file (preserves timestamps)
                shutil.copy2(item, source_item)
                logger.debug(f"Synced {item.name} to source")
                synced_any = True

            elif item.is_dir():
                # Recursively sync directory
                _sync_directory(item, source_item)
                synced_any = True

    except Exception as e:
        logger.warning(f"Failed to sync spec directory to source: {e}")

    return synced_any


def _sync_directory(source_dir: Path, target_dir: Path) -> None:
    """
    Recursively sync a directory from source to target.

    Args:
        source_dir: Source directory (in worktree)
        target_dir: Target directory (in main project)
    """
    # Create target directory if needed
    target_dir.mkdir(parents=True, exist_ok=True)

    for item in source_dir.iterdir():
        # Skip symlinks to prevent path traversal attacks
        if item.is_symlink():
            logger.warning(
                f"Skipping symlink during sync: {source_dir.name}/{item.name}"
            )
            continue

        target_item = target_dir / item.name

        if item.is_file():
            shutil.copy2(item, target_item)
            logger.debug(f"Synced {source_dir.name}/{item.name} to source")
        elif item.is_dir():
            # Recurse into subdirectories
            _sync_directory(item, target_item)


# Keep the old name as an alias for backward compatibility
def sync_plan_to_source(spec_dir: Path, source_spec_dir: Path | None) -> bool:
    """Alias for sync_spec_to_source for backward compatibility."""
    return sync_spec_to_source(spec_dir, source_spec_dir)
