#!/usr/bin/env python3
"""
PR Worktree Cleanup Utility
============================

Command-line tool for managing PR review worktrees.

Usage:
    python cleanup_pr_worktrees.py --list           # List all worktrees
    python cleanup_pr_worktrees.py --cleanup        # Run cleanup policies
    python cleanup_pr_worktrees.py --cleanup-all    # Remove ALL worktrees
    python cleanup_pr_worktrees.py --stats          # Show cleanup statistics
"""

import argparse

# Load module directly to avoid import issues
import importlib.util
import sys
from pathlib import Path

services_dir = Path(__file__).parent / "services"
module_path = services_dir / "pr_worktree_manager.py"

spec = importlib.util.spec_from_file_location("pr_worktree_manager", module_path)
pr_worktree_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pr_worktree_module)

PRWorktreeManager = pr_worktree_module.PRWorktreeManager
DEFAULT_PR_WORKTREE_MAX_AGE_DAYS = pr_worktree_module.DEFAULT_PR_WORKTREE_MAX_AGE_DAYS
DEFAULT_MAX_PR_WORKTREES = pr_worktree_module.DEFAULT_MAX_PR_WORKTREES
_get_max_age_days = pr_worktree_module._get_max_age_days
_get_max_pr_worktrees = pr_worktree_module._get_max_pr_worktrees


def find_project_root() -> Path:
    """Find the git project root directory."""
    current = Path.cwd()
    while current != current.parent:
        if (current / ".git").exists():
            return current
        current = current.parent
    raise RuntimeError("Not in a git repository")


def list_worktrees(manager: PRWorktreeManager) -> None:
    """List all PR review worktrees."""
    worktrees = manager.get_worktree_info()

    if not worktrees:
        print("No PR review worktrees found.")
        return

    print(f"\nFound {len(worktrees)} PR review worktrees:\n")
    print(f"{'Directory':<40} {'Age (days)':<12} {'PR':<6}")
    print("-" * 60)

    for wt in worktrees:
        pr_str = f"#{wt.pr_number}" if wt.pr_number else "N/A"
        print(f"{wt.path.name:<40} {wt.age_days:>10.1f}  {pr_str:>6}")

    print()


def show_stats(manager: PRWorktreeManager) -> None:
    """Show worktree cleanup statistics."""
    worktrees = manager.get_worktree_info()
    registered = manager.get_registered_worktrees()
    # Use resolved paths for consistent comparison (handles macOS symlinks)
    registered_resolved = {p.resolve() for p in registered}

    # Get current policy values (may be overridden by env vars)
    max_age_days = _get_max_age_days()
    max_worktrees = _get_max_pr_worktrees()

    total = len(worktrees)
    orphaned = sum(
        1 for wt in worktrees if wt.path.resolve() not in registered_resolved
    )
    expired = sum(1 for wt in worktrees if wt.age_days > max_age_days)
    excess = max(0, total - max_worktrees)

    print("\nPR Worktree Statistics:")
    print(f"  Total worktrees:      {total}")
    print(f"  Registered with git:  {len(registered)}")
    print(f"  Orphaned (not in git): {orphaned}")
    print(f"  Expired (>{max_age_days} days):    {expired}")
    print(f"  Excess (>{max_worktrees} limit):   {excess}")
    print()
    print("Cleanup Policies:")
    print(f"  Max age:     {max_age_days} days")
    print(f"  Max count:   {max_worktrees} worktrees")
    print()


def cleanup_worktrees(manager: PRWorktreeManager, force: bool = False) -> None:
    """Run cleanup policies on worktrees."""
    print("\nRunning PR worktree cleanup...")
    if force:
        print("WARNING: Force cleanup - removing ALL worktrees!")
        count = manager.cleanup_all_worktrees()
        print(f"Removed {count} worktrees.")
    else:
        stats = manager.cleanup_worktrees()
        if stats["total"] == 0:
            print("No worktrees needed cleanup.")
        else:
            print("\nCleanup complete:")
            print(f"  Orphaned removed: {stats['orphaned']}")
            print(f"  Expired removed:  {stats['expired']}")
            print(f"  Excess removed:   {stats['excess']}")
            print(f"  Total removed:    {stats['total']}")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Manage PR review worktrees",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python cleanup_pr_worktrees.py --list
  python cleanup_pr_worktrees.py --cleanup
  python cleanup_pr_worktrees.py --stats
  python cleanup_pr_worktrees.py --cleanup-all

Environment variables:
  MAX_PR_WORKTREES=10           # Max number of worktrees to keep
  PR_WORKTREE_MAX_AGE_DAYS=7    # Max age in days before cleanup
        """,
    )

    parser.add_argument(
        "--list", action="store_true", help="List all PR review worktrees"
    )

    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Run cleanup policies (remove orphaned, expired, and excess worktrees)",
    )

    parser.add_argument(
        "--cleanup-all",
        action="store_true",
        help="Remove ALL PR review worktrees (dangerous!)",
    )

    parser.add_argument("--stats", action="store_true", help="Show cleanup statistics")

    parser.add_argument(
        "--project-dir",
        type=Path,
        help="Project directory (default: auto-detect git root)",
    )

    args = parser.parse_args()

    # Require at least one action
    if not any([args.list, args.cleanup, args.cleanup_all, args.stats]):
        parser.print_help()
        return 1

    try:
        # Find project directory
        if args.project_dir:
            project_dir = args.project_dir
        else:
            project_dir = find_project_root()

        print(f"Project directory: {project_dir}")

        # Create manager
        manager = PRWorktreeManager(
            project_dir=project_dir, worktree_dir=".ac.jerry/github/pr/worktrees"
        )

        # Execute actions
        if args.stats:
            show_stats(manager)

        if args.list:
            list_worktrees(manager)

        if args.cleanup:
            cleanup_worktrees(manager, force=False)

        if args.cleanup_all:
            response = input(
                "This will remove ALL PR worktrees. Are you sure? (yes/no): "
            )
            if response.lower() == "yes":
                cleanup_worktrees(manager, force=True)
            else:
                print("Aborted.")

        return 0

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
