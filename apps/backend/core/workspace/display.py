#!/usr/bin/env python3
"""
Workspace Display
=================

Functions for displaying workspace information and build summaries.
"""

from ui import (
    bold,
    error,
    info,
    print_status,
    success,
)
from worktree import WorktreeManager


def show_build_summary(manager: WorktreeManager, spec_name: str) -> None:
    """Show a summary of what was built."""
    summary = manager.get_change_summary(spec_name)
    files = manager.get_changed_files(spec_name)

    total = summary["new_files"] + summary["modified_files"] + summary["deleted_files"]

    if total == 0:
        print_status("No changes were made.", "info")
        return

    print()
    print(bold("What was built:"))
    if summary["new_files"] > 0:
        print(
            success(
                f"  + {summary['new_files']} new file{'s' if summary['new_files'] != 1 else ''}"
            )
        )
    if summary["modified_files"] > 0:
        print(
            info(
                f"  ~ {summary['modified_files']} modified file{'s' if summary['modified_files'] != 1 else ''}"
            )
        )
    if summary["deleted_files"] > 0:
        print(
            error(
                f"  - {summary['deleted_files']} deleted file{'s' if summary['deleted_files'] != 1 else ''}"
            )
        )


def show_changed_files(manager: WorktreeManager, spec_name: str) -> None:
    """Show detailed list of changed files."""
    files = manager.get_changed_files(spec_name)

    if not files:
        print_status("No changes.", "info")
        return

    print()
    print(bold("Changed files:"))
    for status, filepath in files:
        if status == "A":
            print(success(f"  + {filepath}"))
        elif status == "M":
            print(info(f"  ~ {filepath}"))
        elif status == "D":
            print(error(f"  - {filepath}"))
        else:
            print(f"  {status} {filepath}")


def print_merge_success(
    no_commit: bool,
    stats: dict | None = None,
    spec_name: str | None = None,
    keep_worktree: bool = False,
) -> None:
    """Print a success message after merge."""
    from ui import Icons, box, icon

    if no_commit:
        lines = [
            success(f"{icon(Icons.SUCCESS)} CHANGES ADDED TO YOUR PROJECT"),
            "",
            "The new code is in your working directory.",
            "Review the changes, then commit when ready.",
        ]

        # Add note about lock files if any were excluded
        if stats and stats.get("lock_files_excluded", 0) > 0:
            lines.append("")
            lines.append("Note: Lock files kept from main.")
            lines.append("Regenerate: npm install / pip install / cargo update")

        # Add worktree cleanup instructions
        if keep_worktree and spec_name:
            lines.append("")
            lines.append("Worktree kept for testing. Delete when satisfied:")
            lines.append(f"  python ac-jerry/run.py --spec {spec_name} --discard")

        content = lines
    else:
        lines = [
            success(f"{icon(Icons.SUCCESS)} FEATURE ADDED TO YOUR PROJECT!"),
            "",
        ]

        if stats:
            lines.append("What changed:")
            if stats.get("files_added", 0) > 0:
                lines.append(
                    f"  + {stats['files_added']} file{'s' if stats['files_added'] != 1 else ''} added"
                )
            if stats.get("files_modified", 0) > 0:
                lines.append(
                    f"  ~ {stats['files_modified']} file{'s' if stats['files_modified'] != 1 else ''} modified"
                )
            if stats.get("files_deleted", 0) > 0:
                lines.append(
                    f"  - {stats['files_deleted']} file{'s' if stats['files_deleted'] != 1 else ''} deleted"
                )
            lines.append("")

        if keep_worktree:
            lines.extend(
                [
                    "Your new feature is now part of your project.",
                    "",
                    "Worktree kept for testing. Delete when satisfied:",
                ]
            )
            if spec_name:
                lines.append(
                    f"  python ac-jerry/run.py --spec {spec_name} --discard"
                )
        else:
            lines.extend(
                [
                    "Your new feature is now part of your project.",
                    "The separate workspace has been cleaned up.",
                ]
            )
        content = lines

    print()
    print(box(content, width=60, style="heavy"))
    print()


def print_conflict_info(result: dict) -> None:
    """Print information about conflicts that occurred during merge.

    The conflicts can be either:
    - List of strings (file paths) - for git conflict markers
    - List of dicts with keys: file, reason, severity - for AI merge failures
    """
    import shlex

    from ui import highlight, muted, warning

    conflicts = result.get("conflicts", [])
    if not conflicts:
        return

    print()
    print(
        warning(
            f"  {len(conflicts)} file{'s' if len(conflicts) != 1 else ''} had conflicts:"
        )
    )

    # Extract file paths from conflicts (handle both strings and dicts)
    file_paths: list[str] = []
    has_marker_conflicts = False
    has_ai_conflicts = False
    for conflict in conflicts:
        if isinstance(conflict, str):
            # Simple string - just the file path
            file_paths.append(conflict)
            print(f"    {highlight(conflict)}")
            has_marker_conflicts = True
        elif isinstance(conflict, dict):
            # Dict with file, reason, severity keys
            file_path = conflict.get("file", "unknown")
            reason = conflict.get("reason", "")
            severity = conflict.get("severity", "medium")

            # Add severity indicator
            severity_icon = ""
            if severity == "critical":
                severity_icon = "⛔"
            elif severity == "high":
                severity_icon = "🔴"
            elif severity == "medium":
                severity_icon = "🟡"

            file_paths.append(file_path)
            # Only add space if icon is present (no trailing space when empty)
            icon_with_space = f" {severity_icon}" if severity_icon else ""
            print(f"    {highlight(file_path)}{icon_with_space}")
            if reason:
                print(f"      {muted(reason)}")
            has_ai_conflicts = True

    print()
    if has_marker_conflicts:
        print(
            muted(
                "  Some files may contain conflict markers (<<<<<<< =======  >>>>>>>)."
            )
        )
    if has_ai_conflicts:
        print(
            muted(
                "  Some files could not be auto-merged; review and resolve as needed."
            )
        )
    print(muted("  Then run:"))
    # Quote paths and dedupe while preserving order
    quoted = " ".join(shlex.quote(p) for p in dict.fromkeys(file_paths))
    print(f"    git add {quoted}")
    print("    git commit")
    print()


# Export private names for backward compatibility
_print_merge_success = print_merge_success
_print_conflict_info = print_conflict_info
