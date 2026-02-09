"""
FileTimelineTracker CLI
=======================

CLI interface for the FileTimelineTracker service.
Used by git hooks and manual operations.

Usage:
    python -m ac_jerry.merge.tracker_cli notify-commit <hash>
    python -m ac_jerry.merge.tracker_cli show-timeline <file_path>
    python -m ac_jerry.merge.tracker_cli show-drift <task_id>
"""

import argparse
import sys
from pathlib import Path

from .file_timeline import FileTimelineTracker


def find_project_root() -> Path:
    """Find the project root by looking for .ac.jerry or .git directory."""
    current = Path.cwd()

    # Walk up until we find .ac.jerry or .git
    while current != current.parent:
        if (current / ".ac.jerry").exists() or (current / ".git").exists():
            return current
        current = current.parent

    # Default to cwd
    return Path.cwd()


def get_tracker() -> FileTimelineTracker:
    """Get the FileTimelineTracker instance for this project."""
    project_path = find_project_root()
    return FileTimelineTracker(project_path)


def cmd_notify_commit(args):
    """Handle the notify-commit command from git post-commit hook."""
    tracker = get_tracker()
    commit_hash = args.commit_hash

    print(f"[FileTimelineTracker] Processing commit: {commit_hash[:8]}")
    tracker.on_main_branch_commit(commit_hash)
    print("[FileTimelineTracker] Commit processed successfully")


def cmd_show_timeline(args):
    """Show the timeline for a file."""
    tracker = get_tracker()
    file_path = args.file_path

    timeline = tracker.get_timeline(file_path)
    if not timeline:
        print(f"No timeline found for: {file_path}")
        return

    print(f"\n=== Timeline for: {file_path} ===\n")
    print(f"Created: {timeline.created_at}")
    print(f"Last Updated: {timeline.last_updated}")

    print(f"\n--- Main Branch History ({len(timeline.main_branch_history)} events) ---")
    for i, event in enumerate(timeline.main_branch_history):
        print(
            f"  [{i + 1}] {event.commit_hash[:8]} ({event.source}): {event.commit_message[:50]}..."
        )

    print(f"\n--- Task Views ({len(timeline.task_views)} tasks) ---")
    for task_id, view in timeline.task_views.items():
        status = f"[{view.status.upper()}]"
        behind = f"{view.commits_behind_main} commits behind"
        print(f"  {task_id} {status} - {behind}")
        print(f"    Branch point: {view.branch_point.commit_hash[:8]}")
        print(f"    Intent: {view.task_intent.title}")


def cmd_show_drift(args):
    """Show commits-behind-main for a task."""
    tracker = get_tracker()
    task_id = args.task_id

    drift = tracker.get_task_drift(task_id)
    if not drift:
        print(f"No files found for task: {task_id}")
        return

    print(f"\n=== Drift Report for: {task_id} ===\n")
    total_drift = 0
    for file_path, commits_behind in sorted(drift.items()):
        print(f"  {file_path}: {commits_behind} commits behind")
        total_drift = max(total_drift, commits_behind)

    print(f"\n  Max drift: {total_drift} commits")


def cmd_show_context(args):
    """Show merge context for a task and file."""
    tracker = get_tracker()
    task_id = args.task_id
    file_path = args.file_path

    context = tracker.get_merge_context(task_id, file_path)
    if not context:
        print(f"No merge context available for {task_id} -> {file_path}")
        return

    print(f"\n=== Merge Context for: {task_id} -> {file_path} ===\n")
    print(f"Task Intent: {context.task_intent.title}")
    print(f"  {context.task_intent.description}")
    print(f"\nBranch Point: {context.task_branch_point.commit_hash[:8]}")
    print(f"Current Main: {context.current_main_commit[:8]}")
    print(f"Commits Behind: {context.total_commits_behind}")
    print(f"Other Pending Tasks: {context.total_pending_tasks}")

    if context.other_pending_tasks:
        print("\n--- Other Pending Tasks ---")
        for task in context.other_pending_tasks:
            print(f"  {task['task_id']}: {task['intent'][:50]}...")

    print(f"\n--- Main Evolution ({len(context.main_evolution)} events) ---")
    for event in context.main_evolution:
        print(
            f"  {event.commit_hash[:8]} ({event.source}): {event.commit_message[:50]}..."
        )


def cmd_list_files(args):
    """List all tracked files."""
    tracker = get_tracker()

    print("\n=== Tracked Files ===\n")

    # Access internal _timelines
    if not tracker._timelines:
        print("No files currently tracked.")
        return

    for file_path in sorted(tracker._timelines.keys()):
        timeline = tracker._timelines[file_path]
        active_tasks = len(
            [tv for tv in timeline.task_views.values() if tv.status == "active"]
        )
        main_events = len(timeline.main_branch_history)
        print(f"  {file_path}: {active_tasks} active tasks, {main_events} main events")


def cmd_init_from_worktree(args):
    """Initialize tracking from an existing worktree."""
    tracker = get_tracker()
    task_id = args.task_id
    worktree_path = Path(args.worktree_path).resolve()

    if not worktree_path.exists():
        print(f"Worktree path does not exist: {worktree_path}")
        sys.exit(1)

    print(f"Initializing tracking for {task_id} from {worktree_path}")
    tracker.initialize_from_worktree(
        task_id=task_id,
        worktree_path=worktree_path,
        task_intent=args.intent or "",
        task_title=args.title or task_id,
    )
    print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="FileTimelineTracker CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # notify-commit
    notify_parser = subparsers.add_parser(
        "notify-commit",
        help="Notify tracker of a new commit (called by git post-commit hook)",
    )
    notify_parser.add_argument("commit_hash", help="The commit hash")
    notify_parser.set_defaults(func=cmd_notify_commit)

    # show-timeline
    timeline_parser = subparsers.add_parser(
        "show-timeline", help="Show the timeline for a file"
    )
    timeline_parser.add_argument(
        "file_path", help="The file path (relative to project)"
    )
    timeline_parser.set_defaults(func=cmd_show_timeline)

    # show-drift
    drift_parser = subparsers.add_parser(
        "show-drift", help="Show commits-behind-main for a task"
    )
    drift_parser.add_argument("task_id", help="The task ID")
    drift_parser.set_defaults(func=cmd_show_drift)

    # show-context
    context_parser = subparsers.add_parser(
        "show-context", help="Show merge context for a task and file"
    )
    context_parser.add_argument("task_id", help="The task ID")
    context_parser.add_argument("file_path", help="The file path")
    context_parser.set_defaults(func=cmd_show_context)

    # list-files
    list_parser = subparsers.add_parser("list-files", help="List all tracked files")
    list_parser.set_defaults(func=cmd_list_files)

    # init-from-worktree
    init_parser = subparsers.add_parser(
        "init-from-worktree", help="Initialize tracking from an existing worktree"
    )
    init_parser.add_argument("task_id", help="The task ID")
    init_parser.add_argument("worktree_path", help="Path to the worktree")
    init_parser.add_argument("--intent", help="Task intent description")
    init_parser.add_argument("--title", help="Task title")
    init_parser.set_defaults(func=cmd_init_from_worktree)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
