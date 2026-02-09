#!/usr/bin/env python3
"""
Session Memory System - CLI Interface
======================================

This module serves as the CLI entry point for the memory system.
All actual functionality is now in the memory/ package for better organization.

For library usage, import from the memory package:
    from memory import save_session_insights, load_all_insights, etc.

Usage Examples:
    # Save session insights
    from memory import save_session_insights
    insights = {
        "subtasks_completed": ["subtask-1"],
        "discoveries": {...},
        "what_worked": ["approach"],
        "what_failed": ["mistake"],
        "recommendations_for_next_session": ["tip"]
    }
    save_session_insights(spec_dir, session_num=1, insights=insights)

    # Load all past insights
    from memory import load_all_insights
    all_insights = load_all_insights(spec_dir)

    # Update codebase map
    from memory import update_codebase_map
    discoveries = {
        "src/api/auth.py": "Handles JWT authentication and token validation",
        "src/models/user.py": "User database model with password hashing"
    }
    update_codebase_map(spec_dir, discoveries)

    # Append gotcha
    from memory import append_gotcha
    append_gotcha(spec_dir, "Database connections must be explicitly closed in workers")

    # Append pattern
    from memory import append_pattern
    append_pattern(spec_dir, "Use try/except with specific exceptions, log errors with context")

    # Check if Graphiti is enabled
    from memory import is_graphiti_memory_enabled
    if is_graphiti_memory_enabled():
        # Graphiti will automatically store data alongside file-based memory
        pass
"""

# Re-export all public functions from the memory package
from memory import (
    append_gotcha,
    append_pattern,
    clear_memory,
    get_memory_dir,
    get_memory_summary,
    get_session_insights_dir,
    is_graphiti_memory_enabled,
    load_all_insights,
    load_codebase_map,
    load_gotchas,
    load_patterns,
    save_session_insights,
    update_codebase_map,
)

# Make all functions available for import
__all__ = [
    "is_graphiti_memory_enabled",
    "get_memory_dir",
    "get_session_insights_dir",
    "save_session_insights",
    "load_all_insights",
    "update_codebase_map",
    "load_codebase_map",
    "append_gotcha",
    "load_gotchas",
    "append_pattern",
    "load_patterns",
    "get_memory_summary",
    "clear_memory",
]


# CLI interface for testing and manual management
if __name__ == "__main__":
    import argparse
    import json
    import sys
    from pathlib import Path

    parser = argparse.ArgumentParser(
        description="Session Memory System - Manage memory for ac-jerry specs"
    )
    parser.add_argument(
        "--spec-dir",
        type=Path,
        required=True,
        help="Path to spec directory (e.g., ac-jerry/specs/001-feature)",
    )
    parser.add_argument(
        "--action",
        choices=[
            "summary",
            "list-insights",
            "list-map",
            "list-patterns",
            "list-gotchas",
            "prune",
            "repair",
            "check",
            "clear",
        ],
        default="summary",
        help="Action to perform",
    )

    args = parser.parse_args()

    if not args.spec_dir.exists():
        print(f"Error: Spec directory not found: {args.spec_dir}")
        sys.exit(1)

    if args.action == "summary":
        summary = get_memory_summary(args.spec_dir)
        print("\n" + "=" * 70)
        print("  MEMORY SUMMARY")
        print("=" * 70)
        print(f"\nSpec: {args.spec_dir.name}")
        print(f"Total sessions: {summary['total_sessions']}")
        print(f"Files mapped: {summary['total_files_mapped']}")
        print(f"Patterns: {summary['total_patterns']}")
        print(f"Gotchas: {summary['total_gotchas']}")

        if summary["recent_insights"]:
            print("\nRecent sessions:")
            for insight in summary["recent_insights"]:
                session_num = insight.get("session_number")
                subtasks = len(insight.get("subtasks_completed", []))
                print(f"  Session {session_num}: {subtasks} subtasks completed")

    elif args.action == "list-insights":
        insights = load_all_insights(args.spec_dir)
        print(json.dumps(insights, indent=2))

    elif args.action == "list-map":
        codebase_map = load_codebase_map(args.spec_dir)
        print(json.dumps(codebase_map, indent=2, sort_keys=True))

    elif args.action == "list-patterns":
        patterns = load_patterns(args.spec_dir)
        print("\nCode Patterns:")
        for pattern in patterns:
            print(f"  - {pattern}")

    elif args.action == "list-gotchas":
        gotchas = load_gotchas(args.spec_dir)
        print("\nGotchas:")
        for gotcha in gotchas:
            print(f"  - {gotcha}")

    elif args.action == "prune":
        from memory.pruner import get_memory_size_breakdown, prune_memory

        # Show current size
        breakdown = get_memory_size_breakdown(args.spec_dir)
        total = sum(breakdown.values())
        print(f"\nMemory usage: {total / 1024:.1f} KB")
        for cat, size in sorted(breakdown.items()):
            if size > 0:
                print(f"  {cat}: {size / 1024:.1f} KB")

        result = prune_memory(args.spec_dir)
        total_pruned = (
            result["sessions_pruned"]
            + result["map_entries_pruned"]
            + result["lessons_pruned"]
        )
        if total_pruned > 0:
            print(f"\nPruned {total_pruned} items:")
            if result["sessions_pruned"]:
                print(f"  Sessions: {result['sessions_pruned']} files deleted")
            if result["map_entries_pruned"]:
                print(f"  Codebase map: {result['map_entries_pruned']} entries removed")
            if result["lessons_pruned"]:
                print(f"  Lessons: {result['lessons_pruned']} entries removed")
            print(f"  Size: {result['size_before'] / 1024:.1f} KB → {result['size_after'] / 1024:.1f} KB")
        else:
            print("\nNo pruning needed — under storage cap.")

    elif args.action == "repair":
        from memory.repair import repair_memory

        print(f"\nRepairing memory for {args.spec_dir.name}...")
        result = repair_memory(args.spec_dir, fix=True)
        print(f"\nChecks run: {result['checks_run']}")
        print(f"Issues found: {result['issues_found']}")
        print(f"Issues fixed: {result['issues_fixed']}")
        for detail in result["details"]:
            status_icon = {"ok": "✓", "fixed": "🔧", "error": "✗"}.get(detail["status"], "?")
            print(f"  {status_icon} [{detail['check']}] {detail['message']}")

    elif args.action == "check":
        from memory.repair import repair_memory

        print(f"\nChecking memory integrity for {args.spec_dir.name}...")
        result = repair_memory(args.spec_dir, fix=False)
        print(f"\nChecks run: {result['checks_run']}")
        print(f"Issues found: {result['issues_found']}")
        for detail in result["details"]:
            status_icon = {"ok": "✓", "error": "✗"}.get(detail["status"], "?")
            print(f"  {status_icon} [{detail['check']}] {detail['message']}")

    elif args.action == "clear":
        confirm = input(f"Clear all memory for {args.spec_dir.name}? (yes/no): ")
        if confirm.lower() == "yes":
            clear_memory(args.spec_dir)
            print("Memory cleared.")
        else:
            print("Cancelled.")
