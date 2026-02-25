"""
Pipeline Models and Utilities
==============================

Data structures, helper functions, and utilities for the spec creation pipeline.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from init import init_auto_claude_dir
from task_logger import update_task_logger_path
from ui import Icons, highlight, print_status

if TYPE_CHECKING:
    from core.workspace.models import SpecNumberLock


def get_specs_dir(project_dir: Path) -> Path:
    """Get the specs directory path.

    IMPORTANT: Only .auto-claude/ is considered an "installed" auto-claude.
    The auto-claude/ folder (if it exists) is SOURCE CODE being developed,
    not an installation. This allows Auto Claude to be used to develop itself.

    This function also ensures .auto-claude is added to .gitignore on first use.

    Args:
        project_dir: The project root directory

    Returns:
        Path to the specs directory within .auto-claude/
    """
    # Initialize .auto-claude directory and ensure it's in .gitignore
    init_auto_claude_dir(project_dir)

    # Return the specs directory path
    return project_dir / ".auto-claude" / "specs"


def cleanup_orphaned_pending_folders(specs_dir: Path) -> None:
    """Remove orphaned pending folders that have no substantial content.

    Args:
        specs_dir: The specs directory to clean up
    """
    if not specs_dir.exists():
        return

    orphaned = []
    for folder in specs_dir.glob("[0-9][0-9][0-9]-pending"):
        if not folder.is_dir():
            continue

        # Check if folder has substantial content
        requirements_file = folder / "requirements.json"
        spec_file = folder / "spec.md"
        plan_file = folder / "implementation_plan.json"

        if requirements_file.exists() or spec_file.exists() or plan_file.exists():
            continue

        # Check folder age - only clean up folders older than 10 minutes
        try:
            folder_mtime = datetime.fromtimestamp(folder.stat().st_mtime)
            if datetime.now() - folder_mtime < timedelta(minutes=10):
                continue
        except OSError:
            continue

        orphaned.append(folder)

    # Clean up orphaned folders
    for folder in orphaned:
        try:
            shutil.rmtree(folder)
        except OSError:
            pass


def create_spec_dir(specs_dir: Path, lock: SpecNumberLock | None = None) -> Path:
    """Create a new spec directory with incremented number and placeholder name.

    Args:
        specs_dir: The parent specs directory
        lock: Optional SpecNumberLock for coordinated numbering across worktrees.
              If provided, uses global scan to prevent spec number collisions.
              If None, uses local scan only (legacy behavior for single process).

    Returns:
        Path to the new spec directory
    """
    if lock is not None:
        # Use global coordination via lock - scans main project + all worktrees
        next_num = lock.get_next_spec_number()
    else:
        # Legacy local scan (fallback for cases without lock)
        existing = list(specs_dir.glob("[0-9][0-9][0-9]-*"))

        if existing:
            # Find the HIGHEST folder number
            numbers = []
            for folder in existing:
                try:
                    num = int(folder.name[:3])
                    numbers.append(num)
                except ValueError:
                    pass
            next_num = max(numbers) + 1 if numbers else 1
        else:
            next_num = 1

    # Start with placeholder - will be renamed after requirements gathering
    name = "pending"
    return specs_dir / f"{next_num:03d}-{name}"


def generate_spec_name(task_description: str) -> str:
    """Generate a clean kebab-case name from task description.

    Args:
        task_description: The task description to convert

    Returns:
        A kebab-case name suitable for a directory
    """
    skip_words = {
        "a",
        "an",
        "the",
        "to",
        "for",
        "of",
        "in",
        "on",
        "at",
        "by",
        "with",
        "and",
        "or",
        "but",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "will",
        "would",
        "could",
        "should",
        "may",
        "might",
        "must",
        "can",
        "this",
        "that",
        "these",
        "those",
        "i",
        "you",
        "we",
        "they",
        "it",
        "add",
        "create",
        "make",
        "implement",
        "build",
        "new",
        "using",
        "use",
        "via",
        "from",
    }

    # Clean and tokenize
    text = task_description.lower()
    text = "".join(c if c.isalnum() or c == " " else " " for c in text)
    words = text.split()

    # Filter out skip words and short words
    meaningful = [w for w in words if w not in skip_words and len(w) > 2]

    # Take first 4 meaningful words
    name_parts = meaningful[:4]

    if not name_parts:
        name_parts = words[:4]

    return "-".join(name_parts) if name_parts else "spec"


def rename_spec_dir_from_requirements(spec_dir: Path) -> Path:
    """Rename spec directory based on requirements.json task description.

    Args:
        spec_dir: The current spec directory

    Returns:
        The new spec directory path (or the original if no rename was needed/possible).
    """
    requirements_file = spec_dir / "requirements.json"

    if not requirements_file.exists():
        return spec_dir

    try:
        with open(requirements_file, encoding="utf-8") as f:
            req = json.load(f)

        task_desc = req.get("task_description", "")
        if not task_desc:
            return spec_dir

        # Generate new name
        new_name = generate_spec_name(task_desc)

        # Extract the number prefix from current dir
        current_name = spec_dir.name
        if current_name[:3].isdigit():
            prefix = current_name[:4]  # "001-"
        else:
            prefix = ""

        new_dir_name = f"{prefix}{new_name}"
        new_spec_dir = spec_dir.parent / new_dir_name

        # Don't rename if it's already a good name (not "pending")
        if "pending" not in current_name:
            return spec_dir

        # Don't rename if target already exists
        if new_spec_dir.exists():
            return spec_dir

        # Rename the directory
        shutil.move(str(spec_dir), str(new_spec_dir))

        # Update the global task logger to use the new path
        update_task_logger_path(new_spec_dir)

        print_status(f"Spec folder: {highlight(new_dir_name)}", "success")
        return new_spec_dir

    except (json.JSONDecodeError, OSError) as e:
        print_status(f"Could not rename spec folder: {e}", "warning")
        return spec_dir


# Phase display configuration
PHASE_DISPLAY: dict[str, tuple[str, str]] = {
    "discovery": ("PROJECT DISCOVERY", Icons.FOLDER),
    "historical_context": ("HISTORICAL CONTEXT", Icons.SEARCH),
    "requirements": ("REQUIREMENTS GATHERING", Icons.FILE),
    "complexity_assessment": ("COMPLEXITY ASSESSMENT", Icons.GEAR),
    "research": ("INTEGRATION RESEARCH", Icons.SEARCH),
    "context": ("CONTEXT DISCOVERY", Icons.FOLDER),
    "quick_spec": ("QUICK SPEC", Icons.LIGHTNING),
    "spec_writing": ("SPEC DOCUMENT CREATION", Icons.FILE),
    "self_critique": ("SPEC SELF-CRITIQUE", Icons.GEAR),
    "planning": ("IMPLEMENTATION PLANNING", Icons.SUBTASK),
    "validation": ("FINAL VALIDATION", Icons.SUCCESS),
}
