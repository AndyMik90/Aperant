#!/usr/bin/env python3
"""
Status Line Provider for ccstatusline Integration
=================================================

Provides compact, real-time build status for display in Claude Code's status line
via ccstatusline's Custom Command widget.

Usage:
    # Get current status (auto-detect active spec)
    python statusline.py

    # Get status for specific spec
    python statusline.py --spec 001-feature

    # Different output formats
    python statusline.py --format compact   # "▣ 3/12 │ ◆ Setup → │ 25%"
    python statusline.py --format full      # More detailed output
    python statusline.py --format json      # Raw JSON data

ccstatusline Configuration:
    Add to ~/.config/ccstatusline/settings.json:
    {
        "widgets": [
            {
                "type": "custom_command",
                "command": "python /path/to/ac-jerry/statusline.py",
                "refresh": 5000
            }
        ]
    }
"""

import argparse
import json
import sys
from pathlib import Path

# Add ac-jerry to path
sys.path.insert(0, str(Path(__file__).parent))

from ui import (
    BuildState,
    BuildStatus,
    Icons,
    StatusManager,
    icon,
    supports_unicode,
)


def find_project_root() -> Path:
    """Find the project root by looking for .ac.jerry or .ac-jerry-status."""
    cwd = Path.cwd()

    # Check current directory - prioritize .ac.jerry (installed instance)
    if (cwd / ".ac.jerry").exists():
        return cwd
    if (cwd / ".ac-jerry-status").exists():
        return cwd

    # Walk up to find project root
    for parent in cwd.parents:
        if (parent / ".ac.jerry").exists():
            return parent
        if (parent / ".ac-jerry-status").exists():
            return parent

    return cwd


def format_compact(status: BuildStatus) -> str:
    """Format status as compact single line for status bar."""
    if not status.active:
        return ""

    parts = []

    # State indicator
    state_icons = {
        BuildState.PLANNING: ("", "P"),
        BuildState.BUILDING: (icon(Icons.LIGHTNING), "B"),
        BuildState.QA: ("", "Q"),
        BuildState.PAUSED: (icon(Icons.PAUSE), "||"),
        BuildState.COMPLETE: (icon(Icons.SUCCESS), "OK"),
        BuildState.ERROR: (icon(Icons.ERROR), "ERR"),
    }

    # Subtasks progress
    if status.subtasks_total > 0:
        subtask_icon = icon(Icons.SUBTASK)
        parts.append(
            f"{subtask_icon} {status.subtasks_completed}/{status.subtasks_total}"
        )

    # Current phase
    if status.phase_current:
        phase_icon = icon(Icons.PHASE)
        phase_status = (
            icon(Icons.ARROW_RIGHT) if status.state == BuildState.BUILDING else ""
        )
        parts.append(f"{phase_icon} {status.phase_current} {phase_status}".strip())

    # Workers (only in parallel mode)
    if status.workers_max > 1:
        worker_icon = icon(Icons.WORKER)
        parts.append(f"{worker_icon}{status.workers_active}")

    # Percentage
    if status.subtasks_total > 0:
        pct = int(100 * status.subtasks_completed / status.subtasks_total)
        parts.append(f"{pct}%")

    # State prefix for special states
    state_prefix = ""
    if status.state == BuildState.PAUSED:
        state_prefix = icon(Icons.PAUSE) + " "
    elif status.state == BuildState.COMPLETE:
        state_prefix = icon(Icons.SUCCESS) + " "
    elif status.state == BuildState.ERROR:
        state_prefix = icon(Icons.ERROR) + " "

    separator = " │ " if supports_unicode() else " | "
    return state_prefix + separator.join(parts)


def format_full(status: BuildStatus) -> str:
    """Format status with more detail."""
    if not status.active:
        return "No active build"

    lines = []
    lines.append(f"Spec: {status.spec}")
    lines.append(f"State: {status.state.value}")

    if status.subtasks_total > 0:
        pct = int(100 * status.subtasks_completed / status.subtasks_total)
        lines.append(
            f"Progress: {status.subtasks_completed}/{status.subtasks_total} subtasks ({pct}%)"
        )

        if status.subtasks_in_progress > 0:
            lines.append(f"In Progress: {status.subtasks_in_progress}")
        if status.subtasks_failed > 0:
            lines.append(f"Failed: {status.subtasks_failed}")

    if status.phase_current:
        lines.append(
            f"Phase: {status.phase_current} ({status.phase_id}/{status.phase_total})"
        )

    if status.workers_max > 1:
        lines.append(f"Workers: {status.workers_active}/{status.workers_max}")

    if status.session_number > 0:
        lines.append(f"Session: {status.session_number}")

    return "\n".join(lines)


def format_json(status: BuildStatus) -> str:
    """Format status as JSON."""
    return json.dumps(status.to_dict(), indent=2)


def main():
    parser = argparse.ArgumentParser(
        description="Status line provider for ccstatusline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Output Formats:
  compact  - Single line for status bar: "▣ 3/12 │ ◆ Setup → │ 25%"
  full     - Multi-line detailed status
  json     - Raw JSON data

Examples:
  python statusline.py                    # Default compact format
  python statusline.py --format full      # Detailed output
  python statusline.py --format json      # JSON for scripting
        """,
    )

    parser.add_argument(
        "--format",
        "-f",
        choices=["compact", "full", "json"],
        default="compact",
        help="Output format (default: compact)",
    )

    parser.add_argument(
        "--spec",
        "-s",
        help="Specific spec to check (default: auto-detect from status file)",
    )

    parser.add_argument(
        "--project-dir",
        "-p",
        type=Path,
        help="Project directory (default: auto-detect)",
    )

    args = parser.parse_args()

    # Find project root
    project_dir = args.project_dir or find_project_root()

    # Read status
    manager = StatusManager(project_dir)
    status = manager.read()

    # If spec filter provided, check if it matches
    if args.spec and status.spec and args.spec not in status.spec:
        # Spec doesn't match, treat as inactive
        status = BuildStatus()

    # Format output
    if args.format == "compact":
        output = format_compact(status)
    elif args.format == "full":
        output = format_full(status)
    else:  # json
        output = format_json(status)

    if output:
        print(output)


if __name__ == "__main__":
    main()
