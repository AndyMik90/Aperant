"""
Progress Tracking Utilities
===========================

Functions for tracking and displaying progress of the autonomous coding agent.
Uses subtask-based implementation plans (implementation_plan.json).

Enhanced with colored output, icons, and better visual formatting.
"""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

from core.plan_normalization import normalize_subtask_aliases
from ui import (
    Icons,
    bold,
    box,
    highlight,
    icon,
    muted,
    print_phase_status,
    print_status,
    progress_bar,
    success,
    warning,
)


def count_subtasks(spec_dir: Path) -> tuple[int, int]:
    """
    Count completed and total subtasks in implementation_plan.json.

    Args:
        spec_dir: Directory containing implementation_plan.json

    Returns:
        (completed_count, total_count)
    """
    plan_file = spec_dir / "implementation_plan.json"

    if not plan_file.exists():
        return 0, 0

    try:
        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)

        total = 0
        completed = 0

        for phase in plan.get("phases", []):
            for subtask in phase.get("subtasks", []):
                total += 1
                if subtask.get("status") == "completed":
                    completed += 1

        return completed, total
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return 0, 0


def count_subtasks_detailed(spec_dir: Path) -> dict:
    """
    Count subtasks by status.

    Returns:
        Dict with completed, in_progress, pending, failed counts
    """
    plan_file = spec_dir / "implementation_plan.json"

    result = {
        "completed": 0,
        "in_progress": 0,
        "pending": 0,
        "failed": 0,
        "total": 0,
    }

    if not plan_file.exists():
        return result

    try:
        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)

        for phase in plan.get("phases", []):
            for subtask in phase.get("subtasks", []):
                result["total"] += 1
                status = subtask.get("status", "pending")
                if status in result:
                    result[status] += 1
                else:
                    result["pending"] += 1

        return result
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return result


def is_build_complete(spec_dir: Path) -> bool:
    """
    Check if all subtasks are completed.

    Args:
        spec_dir: Directory containing implementation_plan.json

    Returns:
        True if all subtasks complete, False otherwise
    """
    completed, total = count_subtasks(spec_dir)
    return total > 0 and completed == total


def _load_stuck_subtask_ids(spec_dir: Path) -> set[str]:
    """Load IDs of subtasks marked as stuck from attempt_history.json."""
    stuck_subtask_ids: set[str] = set()
    attempt_history_file = spec_dir / "memory" / "attempt_history.json"
    if attempt_history_file.exists():
        try:
            with open(attempt_history_file, encoding="utf-8") as f:
                attempt_history = json.load(f)
            for entry in attempt_history.get("stuck_subtasks", []):
                if "subtask_id" in entry:
                    stuck_subtask_ids.add(entry["subtask_id"])
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            # Corrupted attempt history is non-fatal; skip stuck-subtask filtering
            pass
    return stuck_subtask_ids


def is_build_ready_for_qa(spec_dir: Path) -> bool:
    """
    Check if the build is ready for QA validation.

    Unlike is_build_complete() which requires all subtasks to be "completed",
    this function considers the build ready when all subtasks have reached
    a terminal state: completed, failed, or stuck (exhausted retries in attempt_history.json).

    Args:
        spec_dir: Directory containing implementation_plan.json

    Returns:
        True if all subtasks are in a terminal state, False otherwise
    """
    plan_file = spec_dir / "implementation_plan.json"
    if not plan_file.exists():
        return False

    stuck_subtask_ids = _load_stuck_subtask_ids(spec_dir)

    try:
        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)

        total = 0
        terminal = 0

        for phase in plan.get("phases", []):
            for subtask in phase.get("subtasks", []):
                total += 1
                status = subtask.get("status", "pending")
                subtask_id = subtask.get("id")

                if status in ("completed", "failed") or subtask_id in stuck_subtask_ids:
                    terminal += 1

        return total > 0 and terminal == total

    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return False


def get_progress_percentage(spec_dir: Path) -> float:
    """
    Get the progress as a percentage.

    Args:
        spec_dir: Directory containing implementation_plan.json

    Returns:
        Percentage of subtasks completed (0-100)
    """
    completed, total = count_subtasks(spec_dir)
    if total == 0:
        return 0.0
    return (completed / total) * 100


def print_session_header(
    session_num: int,
    is_planner: bool,
    subtask_id: str = None,
    subtask_desc: str = None,
    phase_name: str = None,
    attempt: int = 1,
) -> None:
    """Print a formatted header for the session."""
    session_type = "PLANNER AGENT" if is_planner else "CODING AGENT"
    session_icon = Icons.GEAR if is_planner else Icons.LIGHTNING

    content = [
        bold(f"{icon(session_icon)} SESSION {session_num}: {session_type}"),
    ]

    if subtask_id:
        content.append("")
        subtask_line = f"{icon(Icons.SUBTASK)} Subtask: {highlight(subtask_id)}"
        if subtask_desc:
            # Truncate long descriptions
            desc = subtask_desc[:50] + "..." if len(subtask_desc) > 50 else subtask_desc
            subtask_line += f" - {desc}"
        content.append(subtask_line)

    if phase_name:
        content.append(f"{icon(Icons.PHASE)} Phase: {phase_name}")

    if attempt > 1:
        content.append(warning(f"{icon(Icons.WARNING)} Attempt: {attempt}"))

    print()
    print(box(content, width=70, style="heavy"))
    print()


def print_progress_summary(spec_dir: Path, show_next: bool = True) -> None:
    """Print a summary of current progress with enhanced formatting."""
    completed, total = count_subtasks(spec_dir)

    if total > 0:
        print()
        # Progress bar
        print(f"Progress: {progress_bar(completed, total, width=40)}")

        # Status message
        if completed == total:
            print_status("BUILD COMPLETE - All subtasks completed!", "success")
        else:
            remaining = total - completed
            print_status(f"{remaining} subtasks remaining", "info")

        # Phase summary
        try:
            with open(spec_dir / "implementation_plan.json", encoding="utf-8") as f:
                plan = json.load(f)

            print("\nPhases:")
            for phase in plan.get("phases", []):
                phase_subtasks = phase.get("subtasks", [])
                phase_completed = sum(
                    1 for s in phase_subtasks if s.get("status") == "completed"
                )
                phase_total = len(phase_subtasks)
                phase_name = phase.get("name", phase.get("id", "Unknown"))

                if phase_completed == phase_total:
                    status = "complete"
                elif phase_completed > 0 or any(
                    s.get("status") == "in_progress" for s in phase_subtasks
                ):
                    status = "in_progress"
                else:
                    # Check if blocked by dependencies
                    deps = phase.get("depends_on", [])
                    all_deps_complete = True
                    for dep_id in deps:
                        for p in plan.get("phases", []):
                            if p.get("id") == dep_id or p.get("phase") == dep_id:
                                p_subtasks = p.get("subtasks", [])
                                if not all(
                                    s.get("status") == "completed" for s in p_subtasks
                                ):
                                    all_deps_complete = False
                                break
                    status = "pending" if all_deps_complete else "blocked"

                print_phase_status(phase_name, phase_completed, phase_total, status)

            # Show next subtask if requested
            if show_next and completed < total:
                next_subtask = get_next_subtask(spec_dir)
                if next_subtask:
                    print()
                    next_id = next_subtask.get("id", "unknown")
                    next_desc = next_subtask.get("description", "")
                    if len(next_desc) > 60:
                        next_desc = next_desc[:57] + "..."
                    print(
                        f"  {icon(Icons.ARROW_RIGHT)} Next: {highlight(next_id)} - {next_desc}"
                    )

        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
            logger.debug(f"Failed to load plan file for phase summary: {e}")
    else:
        print()
        print_status("No implementation subtasks yet - planner needs to run", "pending")


def print_build_complete_banner(spec_dir: Path) -> None:
    """Print a completion banner."""
    content = [
        success(f"{icon(Icons.SUCCESS)} BUILD COMPLETE!"),
        "",
        "All subtasks have been implemented successfully.",
        "",
        muted("Next steps:"),
        f"  1. Review the {highlight('auto-claude/*')} branch",
        "  2. Run manual tests",
        "  3. Create a PR and merge to main",
    ]

    print()
    print(box(content, width=70, style="heavy"))
    print()


def print_paused_banner(
    spec_dir: Path,
    spec_name: str,
    has_worktree: bool = False,
) -> None:
    """Print a paused banner with resume instructions."""
    completed, total = count_subtasks(spec_dir)

    content = [
        warning(f"{icon(Icons.PAUSE)} BUILD PAUSED"),
        "",
        f"Progress saved: {completed}/{total} subtasks complete",
    ]

    if has_worktree:
        content.append("")
        content.append(muted("Your build is in a separate workspace and is safe."))

    print()
    print(box(content, width=70, style="heavy"))


def get_plan_summary(spec_dir: Path) -> dict:
    """
    Get a detailed summary of implementation plan status.

    Args:
        spec_dir: Directory containing implementation_plan.json

    Returns:
        Dictionary with plan statistics
    """
    plan_file = spec_dir / "implementation_plan.json"

    if not plan_file.exists():
        return {
            "workflow_type": None,
            "total_phases": 0,
            "total_subtasks": 0,
            "completed_subtasks": 0,
            "pending_subtasks": 0,
            "in_progress_subtasks": 0,
            "failed_subtasks": 0,
            "phases": [],
        }

    try:
        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)

        summary = {
            "workflow_type": plan.get("workflow_type"),
            "total_phases": len(plan.get("phases", [])),
            "total_subtasks": 0,
            "completed_subtasks": 0,
            "pending_subtasks": 0,
            "in_progress_subtasks": 0,
            "failed_subtasks": 0,
            "phases": [],
        }

        for phase in plan.get("phases", []):
            phase_info = {
                "id": phase.get("id"),
                "phase": phase.get("phase"),
                "name": phase.get("name"),
                "depends_on": phase.get("depends_on", []),
                "subtasks": [],
                "completed": 0,
                "total": 0,
            }

            for subtask in phase.get("subtasks", []):
                status = subtask.get("status", "pending")
                summary["total_subtasks"] += 1
                phase_info["total"] += 1

                if status == "completed":
                    summary["completed_subtasks"] += 1
                    phase_info["completed"] += 1
                elif status == "in_progress":
                    summary["in_progress_subtasks"] += 1
                elif status == "failed":
                    summary["failed_subtasks"] += 1
                else:
                    summary["pending_subtasks"] += 1

                phase_info["subtasks"].append(
                    {
                        "id": subtask.get("id"),
                        "description": subtask.get("description"),
                        "status": status,
                        "service": subtask.get("service"),
                    }
                )

            summary["phases"].append(phase_info)

        return summary

    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {
            "workflow_type": None,
            "total_phases": 0,
            "total_subtasks": 0,
            "completed_subtasks": 0,
            "pending_subtasks": 0,
            "in_progress_subtasks": 0,
            "failed_subtasks": 0,
            "phases": [],
        }


def get_current_phase(spec_dir: Path) -> dict | None:
    """Get the current phase being worked on."""
    plan_file = spec_dir / "implementation_plan.json"

    if not plan_file.exists():
        return None

    try:
        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)

        for phase in plan.get("phases", []):
            subtasks = phase.get("subtasks", phase.get("chunks", []))
            # Phase is current if it has incomplete subtasks and dependencies are met
            has_incomplete = any(s.get("status") != "completed" for s in subtasks)
            if has_incomplete:
                return {
                    "id": phase.get("id"),
                    "phase": phase.get("phase"),
                    "name": phase.get("name"),
                    "completed": sum(
                        1 for s in subtasks if s.get("status") == "completed"
                    ),
                    "total": len(subtasks),
                }

        return None

    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def get_next_subtask(spec_dir: Path) -> dict | None:
    """
    Find the next subtask to work on, respecting phase dependencies.

    Skips subtasks that are marked as stuck in the recovery manager's attempt history.

    Args:
        spec_dir: Directory containing implementation_plan.json

    Returns:
        The next subtask dict to work on, or None if all complete
    """
    plan_file = spec_dir / "implementation_plan.json"

    if not plan_file.exists():
        return None

    stuck_subtask_ids = _load_stuck_subtask_ids(spec_dir)

    try:
        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)

        phases = plan.get("phases", [])

        # Build a map of phase completion
        phase_complete: dict[str, bool] = {}
        for i, phase in enumerate(phases):
            phase_id_value = phase.get("id")
            phase_id_raw = (
                phase_id_value if phase_id_value is not None else phase.get("phase")
            )
            phase_id_key = (
                str(phase_id_raw) if phase_id_raw is not None else f"unknown:{i}"
            )
            subtasks = phase.get("subtasks", phase.get("chunks", []))
            # Stuck subtasks count as "resolved" for phase dependency purposes.
            # This prevents one stuck subtask from blocking all downstream phases.
            phase_complete[phase_id_key] = all(
                s.get("status") == "completed" or s.get("id") in stuck_subtask_ids
                for s in subtasks
            )

        # Find next available subtask
        for phase in phases:
            phase_id_value = phase.get("id")
            phase_id = (
                phase_id_value if phase_id_value is not None else phase.get("phase")
            )
            depends_on_raw = phase.get("depends_on", [])
            if isinstance(depends_on_raw, list):
                depends_on = [str(d) for d in depends_on_raw if d is not None]
            elif depends_on_raw is None:
                depends_on = []
            else:
                depends_on = [str(depends_on_raw)]

            # Check if dependencies are satisfied
            deps_satisfied = all(phase_complete.get(dep, False) for dep in depends_on)
            if not deps_satisfied:
                continue

            # Find first pending subtask in this phase (skip stuck subtasks)
            for subtask in phase.get("subtasks", phase.get("chunks", [])):
                status = subtask.get("status", "pending")
                subtask_id = subtask.get("id")

                # Skip stuck subtasks
                if subtask_id in stuck_subtask_ids:
                    continue

                if status in {"pending", "not_started", "not started"}:
                    subtask_out, _changed = normalize_subtask_aliases(subtask)
                    subtask_out["status"] = "pending"
                    return {
                        **subtask_out,
                        "phase_id": phase_id,
                        "phase_name": phase.get("name"),
                        "phase_num": phase.get("phase"),
                    }

        return None

    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def format_duration(seconds: float) -> str:
    """Format a duration in human-readable form."""
    if seconds < 60:
        return f"{seconds:.0f}s"
    elif seconds < 3600:
        minutes = seconds / 60
        return f"{minutes:.1f}m"
    else:
        hours = seconds / 3600
        return f"{hours:.1f}h"
